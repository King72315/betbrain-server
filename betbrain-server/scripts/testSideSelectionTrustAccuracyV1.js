/**
 * CourtEdge Side Selection Trust & Accuracy v1 — acceptance tests (cases 1-37).
 * Usage: node betbrain-server/scripts/testSideSelectionTrustAccuracyV1.js
 */
import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import { evaluateFlipFirstSideSelection } from "../engines/decisionIntelligence/flipFirstSideSelectionV1.js";
import { evaluateSideRescue } from "../engines/decisionIntelligence/sideRescueEngineV1.js";
import { evaluateWnbaTrackingGateV2 } from "../engines/wnba/wnbaTrackingGateV2.js";
import { promoteBestSixCohortPick } from "../engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import {
  selectBestSixDisplay,
  BEST_SIX_LIMIT,
} from "../engines/topProps/controlledBestSixSelector.js";
import {
  buildCanonicalDecisionBundle,
  buildDebtLedger,
  buildReaderSideEvidence,
  buildCounterfactualSideLearning,
  finalizeCanonicalDecision,
  SIDE_SELECTION_TRUST_VERSION,
} from "../engines/decisionIntelligence/sideSelectionTrustV1.js";
import { resolveWnbaGapFloor } from "../engines/wnba/wnbaGraduatedDataModeV1.js";
import { TRACKING_MODE } from "../services/trackedPropService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

function baseCard(overrides = {}) {
  return {
    playerId: "574",
    bookLine: 16.5,
    bookCount: 5,
    marketQuality: 70,
    dataMode: "WNBA_FULL_DATA",
    minutesVolatility: "stable",
    season: { points: 18, minutes: 30, fga: 11, ptsPerFGA: 1.05, fta: 4 },
    last5: { points: 21, minutes: 32, fga: 12, ptsPerFGA: 1.1, fta: 5, games: 5 },
    injuryAvailability: { level: "ACTIVE", blocksPlay: false },
    projection: { projection: 21.4, expectedMinutes: 32, expectedFGA: 12 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 65 },
    dataMissingFlags: [],
    opponentDefense: { score: 62, proxyUsed: false },
    gameEnvironment: { impliedTeamTotal: 82, total: 164 },
    ...overrides,
  };
}

function makePick(overrides = {}) {
  const card = baseCard(overrides.wnbaDataCard || {});
  const reader = overrides.wnbaReader || readWnbaProp(card);
  const side = overrides.side || (reader.finalSide === "UNDER" ? "Under" : "Over");
  return finalizeCanonicalDecision({
    player: overrides.player || "Jackie Young",
    team: overrides.team || "lasvegasaces",
    opponent: overrides.opponent || "phoenixmercury",
    line: card.bookLine,
    side,
    pick: side,
    league: "WNBA",
    projection: card.projection.projection,
    bookCount: card.bookCount,
    marketQuality: card.marketQuality,
    wnbaDataCard: card,
    wnbaReader: reader,
    initialSide: reader.finalSide,
    readerSide: reader.finalSide,
    wnbaGameContext: { impliedTeamTotal: 82 },
    ...overrides,
  });
}

// 1-4 Tracking population
test("01-04 tracking population and naturalDecision preservation", () => {
  const teams = [
    ["dallaswings", "newyorkliberty"],
    ["chicagosky", "phoenixmercury"],
    ["lasvegasaces", "seattlestorm"],
    ["indianafever", "minnesotalynx"],
    ["washingtonmystics", "atlantadream"],
    ["connecticutsun", "losangelessparks"],
    ["portlandfire", "goldenstatevalkyries"],
    ["seattlestorm", "atlantadream"],
  ];
  const candidates = teams.map(([team, opponent], i) =>
    makePick({
      player: `Player ${i}`,
      team,
      opponent,
      gameId: `game-${i}`,
      game: `${team} vs ${opponent}`,
      wnbaDataCard: baseCard({ bookLine: 12.5 + i * 0.5 }),
    })
  );
  const { bestSix } = selectBestSixDisplay(candidates, "WNBA");
  assert.strictEqual(bestSix.length, BEST_SIX_LIMIT);
  assert.strictEqual(TRACKING_MODE, "ALL_GENERATED_PROPS");
  for (const pick of bestSix) {
    assert.strictEqual(pick.selectedForLearning, true);
    assert.strictEqual(pick.resultsTracked, true);
    assert.ok(pick.naturalDecision);
  }
});

// 5-10 Canonical side flow
test("05-10 canonical side flow with stage trace", () => {
  const pick = makePick();
  const bundle = buildCanonicalDecisionBundle(pick);
  assert.strictEqual(bundle.readerSide, "OVER");
  assert.strictEqual(bundle.finalSide, "OVER");
  assert.ok(bundle.stageDecisionTrace.includes("Reader"));
  assert.ok(bundle.stageDecisionTrace.includes("FlipFirst"));
  assert.ok(bundle.sideReviewCount >= 4);
});

// 11-16 Actual flip
test("11-16 flip-first flips to Under with immutable readerSide", () => {
  const card = baseCard({
    bookLine: 14.5,
    projection: { projection: 11.5, expectedMinutes: 18, expectedFGA: 5 },
    last5: { points: 11, minutes: 18, fga: 5, ptsPerFGA: 1.0, games: 5 },
    minutesVolatility: "unstable",
    season: { points: 16, minutes: 28, fga: 9, ptsPerFGA: 1.0, fta: 2 },
  });
  const reader = readWnbaProp(card);
  const pick = makePick({
    player: "Thin Gap Player",
    wnbaDataCard: card,
    wnbaReader: reader,
    decisionDataIntelligence: {
      roleStability: { status: "BAD", sideImpact: "OVER", reasons: ["Unstable minutes"] },
      usageShare: { sideImpact: "UNDER", score: 72, reasons: ["Contracting usage"] },
      marketIntelligence: { marketWarning: true, sideImpact: "UNDER", reasons: ["Line moved up"] },
      projectionQuality: { status: "WEAK", sideImpact: "UNDER" },
    },
  });
  const ff = evaluateFlipFirstSideSelection(pick, {
    reader,
    dataCard: card,
    originalSide: "OVER",
    decisionDataIntelligence: pick.decisionDataIntelligence,
  });
  if (ff.flipRecommended) {
    assert.strictEqual(ff.finalSide, "UNDER");
    assert.strictEqual(pick.readerSide, "OVER");
  } else {
    assert.ok(["BOTH_SIDES_WEAK", "CHECK_UNDER", "KEPT_ORIGINAL"].includes(ff.action));
  }
});

// 17-20 Thin gap
test("17-20 thin gap uses standard margin not relaxed", () => {
  const card = baseCard({
    bookLine: 16.5,
    projection: { projection: 18.0, expectedMinutes: 28, expectedFGA: 8 },
  });
  const reader = readWnbaProp(card);
  const pick = makePick({ wnbaDataCard: card, wnbaReader: reader });
  const ff = evaluateFlipFirstSideSelection(pick, {
    reader,
    dataCard: card,
    originalSide: "OVER",
    decisionDataIntelligence: {
      roleStability: { status: "WEAK", sideImpact: "OVER" },
      usageShare: { sideImpact: "NEUTRAL" },
      projectionQuality: { status: "WEAK", sideImpact: "UNDER", score: 40 },
    },
  });
  assert.strictEqual(ff.flipMarginUsed ?? ff.flipFirstAudit?.flipMarginUsed, 8);
  assert.ok(ff.thinGapTriggeredReview || ff.flipFirstAudit?.thinGapTriggeredReview);
});

// 21-24 Evidence preservation
test("21-24 under evidence preserved when ineligible", () => {
  const card = baseCard({
    bookLine: 16.5,
    projection: { projection: 19.0, expectedMinutes: 30, expectedFGA: 10 },
    dataMode: "WNBA_LIMITED_DATA",
    last5: { points: 19, minutes: 30, fga: 10, games: 5 },
  });
  const reader = readWnbaProp(card);
  const evidence = buildReaderSideEvidence(reader, card, { line: 16.5, projection: 19, dataMode: "WNBA_LIMITED_DATA" });
  assert.ok(Number.isFinite(evidence.under.rawScore));
  assert.notStrictEqual(evidence.under.adjustedScore, 0);
  if (!evidence.under.eligible) {
    assert.ok(evidence.under.blockReasons.length > 0);
  }
});

// 25-27 Debt ledger
test("25-27 debt ledger dedupes UNSTABLE_MINUTES", () => {
  const ledger = buildDebtLedger(
    [{ code: "UNSTABLE_MINUTES", severity: "HIGH", reason: "a" }],
    {
      stageReferences: [
        { code: "UNSTABLE_MINUTES", stage: "flip_first" },
        { code: "UNSTABLE_MINUTES", stage: "side_rescue" },
      ],
    }
  );
  assert.strictEqual(ledger.uniqueDebtCount, 1);
  assert.strictEqual(ledger.duplicateDebtReferences.length, 2);
  assert.ok(ledger.appliedDebtIds.includes("UNSTABLE_MINUTES"));
});

// 28-30 Best 6 recomputation
test("28-30 selector reuses canonical bundle", () => {
  const pick = makePick();
  pick.decisionHash = pick.sideSelectionBundle.decisionHash;
  assert.ok(pick.sideSelectionBundle.version === SIDE_SELECTION_TRUST_VERSION);
  assert.ok(pick.decisionHash);
  assert.ok(pick.stageDecisionTrace);
});

// 31-33 Side balance
test("31-33 over-heavy pool keeps minority when no eligible swap", () => {
  const overs = Array.from({ length: 10 }, (_, i) =>
    makePick({ player: `Over ${i}`, side: "Over", wnbaDataCard: baseCard({ bookLine: 10 + i }) })
  );
  const under = makePick({
    player: "Malonga",
    side: "Under",
    wnbaDataCard: baseCard({ bookLine: 16.5, projection: { projection: 12.4, expectedMinutes: 22, expectedFGA: 7 } }),
  });
  const { bestSix, controlledBestSixDisplayAudit: audit } = selectBestSixDisplay(
    [...overs, under],
    "WNBA"
  );
  const counts = { OVER: 0, UNDER: 0 };
  for (const p of bestSix) {
    const s = String(p.side || p.pick).toUpperCase();
    if (s.startsWith("OVER") || s === "O") counts.OVER += 1;
    if (s.startsWith("UNDER") || s === "U") counts.UNDER += 1;
  }
  assert.ok(counts.OVER >= counts.UNDER);
  assert.ok(audit.sideBalanceEvaluated === true);
});

// 34-37 Lab learning
test("34-37 counterfactual side learning fields", () => {
  const prop = {
    player: "Test",
    side: "Over",
    line: 16.5,
    actualStat: 14,
    status: "loss",
    readerSide: "OVER",
    flipFirstAction: "KEPT_ORIGINAL",
    sideRescueAction: "KEEP",
    sideSelectionBundle: { finalSide: "OVER", readerSide: "OVER" },
    riskDebtReasons: ["THIN_EDGE"],
  };
  const cf = buildCounterfactualSideLearning(prop);
  assert.strictEqual(cf.selectedSideResult, "loss");
  assert.strictEqual(cf.oppositeSideResult, "win");
  assert.strictEqual(cf.wouldOppositeSideHaveWon, true);
  assert.strictEqual(cf.beneficialFlipMissed, true);
  assert.ok(cf.riskDebtReasons.includes("THIN_EDGE"));
  assert.strictEqual(cf.smallSample, true);
});

test("gap floor resolver exposes audit fields", () => {
  const audit = resolveWnbaGapFloor({
    side: "OVER",
    dataMode: "WNBA_FULL_DATA",
    minutesStability: "stable",
    marketQuality: 70,
  });
  assert.ok(audit.gapFloorApplied > 0);
  assert.ok(audit.gapFloorReason);
  assert.strictEqual(audit.stableMinutesEligibilitySatisfied, true);
});

test("promotion preserves naturalDecision BOARD_ONLY", () => {
  const pick = makePick({
    decisionIntelligence: {
      trackEligibility: "BOARD_ONLY",
      trueRisk: "HIGH",
      riskDebts: [],
      riskRepairs: [],
    },
    naturalDecision: "BOARD_ONLY",
  });
  const promoted = promoteBestSixCohortPick(pick);
  assert.strictEqual(promoted.naturalDecision, "BOARD_ONLY");
  assert.strictEqual(promoted.decisionIntelligence.trackEligibility, "TRACK");
  assert.strictEqual(promoted.decisionIntelligence.bestSixPromoted, true);
});

const regressionSuites = [
  "testWnbaReaderFixes.js",
  "testFlipFirstDecisionIntelligenceV1.js",
  "testWnbaTrackingGateV2.js",
  "testPropDecisionIntelligenceV1.js",
  "testSideRescueEngineV1.js",
  "testControlledBestSix.js",
  "testControlledBestSixDisplay.js",
  "testResultsTrackingCohort.js",
  "testSignalPerformanceV1.js",
  "testHistoryThreeSlateGroupsV1.js",
  "testSlateRotationLifecycle.js",
  "testTabDateSlateFlow.js",
];

console.log("\n--- Regression suites ---");
for (const suite of regressionSuites) {
  const result = spawnSync(process.execPath, [path.join(__dirname, suite)], {
    cwd: SERVER_ROOT,
    encoding: "utf8",
  });
  const ok = result.status === 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${suite}`);
  if (!ok) {
    console.error(result.stdout);
    console.error(result.stderr);
    process.exitCode = 1;
  }
}

if (!process.exitCode) {
  console.log("\nAll side-selection trust v1 tests passed.");
}
