/**
 * Acceptance tests for CourtEdge trust-accuracy engine v2.
 * Usage: node betbrain-server/scripts/testTrustAccuracyEngineV2.js
 */
import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  resolveWnbaGapFloors,
  resolveWnbaDataModeAudit,
} from "../engines/wnba/wnbaGraduatedDataModeV1.js";
import { syncWnbaDataModeOnPick } from "../engines/wnba/wnbaGateInputs.js";
import { evaluateFlipFirstSideSelection } from "../engines/decisionIntelligence/flipFirstSideSelectionV1.js";
import {
  evaluateSlateSameTeamCollisions,
  applySlateCollisionAdjustments,
} from "../engines/decisionIntelligence/slateSameTeamCollisionV1.js";
import { evaluateWnbaTrackingGateV2 } from "../engines/wnba/wnbaTrackingGateV2.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import { selectControlledBestSix, BEST_SIX_LIMIT } from "../engines/topProps/controlledBestSixSelector.js";

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
    bookLine: 12.5,
    bookCount: 5,
    marketQuality: 70,
    dataMode: "WNBA_FULL_DATA",
    minutesVolatility: "stable",
    season: { points: 14, minutes: 26, fga: 10, ptsPerFGA: 1.05 },
    last5: { points: 15, minutes: 27, fga: 10, ptsPerFGA: 1.05, games: 5 },
    injuryAvailability: { level: "ACTIVE", blocksPlay: false },
    projection: { projection: 16.5, expectedMinutes: 27, expectedFGA: 10 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 65 },
    dataMissingFlags: [],
    opponentDefense: {
      score: 62,
      proxyUsed: false,
      defenseSource: "wnba_games_proxy",
      opponentPPG: 84.2,
    },
    gameEnvironment: { impliedTeamTotal: 82, total: 164, spread: -3 },
    ...overrides,
  };
}

function makePick(overrides = {}) {
  const card = baseCard(overrides.wnbaDataCard || {});
  const reader = overrides.wnbaReader || readWnbaProp(card);
  const side = overrides.side || "Over";
  return {
    player: overrides.player || "Test Player",
    team: overrides.team || "dallaswings",
    opponent: overrides.opponent || "newyorkliberty",
    line: card.bookLine,
    side,
    pick: side,
    league: "WNBA",
    projection: card.projection.projection,
    bookCount: card.bookCount,
    marketQuality: card.marketQuality,
    wnbaDataCard: card,
    wnbaReader: reader,
    wnbaGameContext: { impliedTeamTotal: 82, playerTeam: overrides.team || "dallaswings" },
    defenseResult: {
      defenseScore: 62,
      source: "wnba_games_proxy",
      opponentPPG: 84.2,
      proxyUsed: false,
    },
    ...overrides,
  };
}

test("01 dataMode audit propagates end-to-end on sync", () => {
  const pick = makePick({
    dataMode: "WNBA_LIMITED_DATA",
    wnbaDataCard: baseCard({ dataMode: "WNBA_FULL_DATA" }),
  });
  const synced = syncWnbaDataModeOnPick(pick, pick.wnbaDataCard, pick.wnbaReader);
  assert.strictEqual(synced.dataMode, "WNBA_FULL_DATA");
  assert.ok(synced.wnbaDataModeAudit);
  assert.strictEqual(synced.wnbaDataModeAudit.resolvedDataMode, "WNBA_FULL_DATA");
  assert.ok(synced.wnbaDataModeAudit.dataModeSource);
  assert.strictEqual(synced.wnbaDataModeAudit.gapFloorApplied, 4);
  assert.strictEqual(synced.wnbaDataModeAudit.stableMinutesEligibilitySatisfied, true);
});

test("02 FULL_DATA card never silently falls back to LIMITED", () => {
  const audit = resolveWnbaDataModeAudit({
    league: "WNBA",
    cardDataMode: "WNBA_FULL_DATA",
    dataMissingFlags: [],
    volatility: "stable",
    playerId: "1",
    last5Count: 5,
    seasonPoints: 14,
    recentMinutes: 26,
    seasonMinutes: 25,
    recentFGA: 10,
    seasonFGA: 9,
    bookCount: 4,
    projection: 15,
  });
  assert.strictEqual(audit.resolvedDataMode, "WNBA_FULL_DATA");
  assert.notStrictEqual(audit.dataModeSource, "computed_limited_coverage");
});

test("03 flip-first fragile side triggers audit without force flip", () => {
  const pick = makePick({
    projection: 13.8,
    wnbaDataCard: baseCard({
      projection: { projection: 13.8, expectedMinutes: 27, expectedFGA: 10 },
    }),
    volumeDangerGates: { gates: ["efficiency_only_scoring"] },
  });
  const fd = evaluateFlipFirstSideSelection(pick, {
    reader: pick.wnbaReader,
    dataCard: pick.wnbaDataCard,
    originalSide: "OVER",
    decisionDataIntelligence: {
      marketIntelligence: { marketWarning: true, sideImpact: "UNDER", reasons: ["Line moved up."] },
      roleStability: { status: "GOOD", score: 70 },
      usageShare: { status: "GOOD", score: 70 },
      projectionQuality: { status: "MIXED", score: 55 },
    },
  });
  assert.strictEqual(fd.flipTriggered, true);
  assert.ok(fd.flipTriggerReasons.length > 0);
  assert.ok(fd.oppositeSideEvidence);
  assert.ok(fd.whyRetainedFlippedOrPass);
  assert.strictEqual(fd.flipRecommended, false);
  assert.ok(["CHECK_UNDER", "KEPT_ORIGINAL"].includes(fd.action));
});

test("04 slate collision applies penalty without blocking Best 6 size", () => {
  const candidates = [
    makePick({ player: "A", team: "dallaswings", line: 21.5, bestPropScore: 90 }),
    makePick({ player: "B", team: "dallaswings", line: 14.5, bestPropScore: 70 }),
    makePick({ player: "C", team: "chicagosky", line: 18.5, bestPropScore: 80 }),
    makePick({ player: "D", team: "phoenixmercury", line: 16.5, bestPropScore: 75 }),
    makePick({ player: "E", team: "lasvegasaces", line: 17.5, bestPropScore: 72 }),
    makePick({ player: "F", team: "seattlestorm", line: 12.5, bestPropScore: 68 }),
    makePick({ player: "G", team: "indianafever", line: 19.5, bestPropScore: 66 }),
  ].map((p) => ({
    ...p,
    trackingEligibility: "TRACK",
    wnbaTrackingDecision: "TRACK",
    decisionIntelligence: { trackEligibility: "TRACK", bestSixEligibility: true },
  }));

  const evalResult = evaluateSlateSameTeamCollisions(candidates);
  assert.ok(evalResult.teamClusterCount >= 1);
  const adjusted = applySlateCollisionAdjustments(candidates, evalResult);
  const weaker = adjusted.find((p) => p.player === "B");
  assert.ok(weaker?.slateCollisionAudit?.scorePenalty >= 0);

  const { bestSix } = selectControlledBestSix(adjusted, "WNBA");
  assert.ok(bestSix.length <= BEST_SIX_LIMIT);
});

test("05 defense and implied team total audits attach when data exists", () => {
  const pick = makePick();
  const synced = syncWnbaDataModeOnPick(pick, pick.wnbaDataCard, pick.wnbaReader);
  assert.strictEqual(synced.defenseAudit.proxyUsed, false);
  assert.ok(synced.defenseAudit.resolvedDefenseScore > 50);
  assert.strictEqual(synced.impliedTeamTotalAudit.value, 82);
  assert.notStrictEqual(synced.impliedTeamTotalAudit.source, "unavailable");
});

test("06 live Over floor stays 4.0; retro FULL stable can use 3.5", () => {
  const live = resolveWnbaGapFloors({
    side: "OVER",
    dataMode: "WNBA_FULL_DATA",
    volatility: "stable",
  });
  assert.strictEqual(live.gapFloor, 4);
  assert.strictEqual(live.scenario, "live");

  const retro = resolveWnbaGapFloors(
    { side: "OVER", dataMode: "WNBA_FULL_DATA", volatility: "stable" },
    { scenario: "retro_full_data_stable" }
  );
  assert.strictEqual(retro.gapFloor, 3.5);

  const pick = makePick({
    wnbaDataCard: baseCard({
      projection: { projection: 16, expectedMinutes: 27, expectedFGA: 10 },
      bookLine: 12.5,
    }),
    projection: 16,
    line: 12.5,
  });
  const synced = syncWnbaDataModeOnPick(pick, pick.wnbaDataCard, pick.wnbaReader);
  const gate = evaluateWnbaTrackingGateV2(synced);
  assert.ok(gate.keyMetrics?.gapFloorApplied === 4 || synced.wnbaDataModeAudit?.gapFloorApplied === 4);
});

function runRegression(script) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: SERVER_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${script} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

test("07 regression suites still pass", () => {
  runRegression("testWnbaGraduatedDataModeV1.js");
  runRegression("testPropDecisionIntelligenceV1.js");
  runRegression("testFlipFirstDecisionIntelligenceV1.js");
  runRegression("testControlledBestSix.js");
  runRegression("testWnbaTrackingGateV2.js");
});

if (process.exitCode) {
  console.error("\nTrust-accuracy engine v2: FAILED");
  process.exit(process.exitCode);
}
console.log("\nTrust-accuracy engine v2: all acceptance tests passed");
