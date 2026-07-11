/**
 * Flip-First Decision Intelligence v1 tests.
 * Usage: node betbrain-server/scripts/testFlipFirstDecisionIntelligenceV1.js
 */
import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateDecisionDataIntelligence,
  runFlipFirstDecisionPipeline,
  DECISION_DATA_INTELLIGENCE_VERSION,
  buildFlipFirstCompactLabels,
} from "../engines/decisionIntelligence/decisionDataIntelligenceV1.js";
import { evaluateFlipFirstSideSelection } from "../engines/decisionIntelligence/flipFirstSideSelectionV1.js";
import { evaluateSameTeamUsageCollision } from "../engines/decisionIntelligence/sameTeamUsageCollisionV1.js";
import { evaluateMarketMovementIntelligence } from "../engines/decisionIntelligence/marketMovementIntelligenceV1.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import {
  selectBestSixDisplay,
  CONTROLLED_BEST_SIX_VERSION,
} from "../engines/topProps/controlledBestSixSelector.js";
import { evaluateSideRescue } from "../engines/decisionIntelligence/sideRescueEngineV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");

function baseCard(overrides = {}) {
  return {
    version: "wnba-data-card-v2",
    playerId: "123",
    player: "Test Player",
    team: "seattlestorm",
    opponent: "lasvegasaces",
    propType: "Points",
    bookLine: 12.5,
    currentLine: 12.5,
    bookCount: 5,
    marketQuality: 70,
    dataMode: "WNBA_FULL",
    season: { points: 11, minutes: 26, fga: 10, fta: 3, ptsPerFGA: 1.05 },
    last5: { points: 10, minutes: 24, fga: 9, fta: 3, ptsPerFGA: 1.05, games: 5 },
    scoringTrend: "stable",
    roleTrend: "stable",
    minutesVolatility: "stable",
    injuryAvailability: { level: "ACTIVE", blocksPlay: false },
    projection: { projection: 10.5, expectedMinutes: 24, expectedFGA: 9 },
    fairLine: { fairLine: 11.5, fairLineSide: "UNDER", fairLineEdge: 1, fairLineQuality: 55 },
    dataMissingFlags: [],
    dataConfidenceScore: 72,
    ...overrides,
  };
}

function makeWnbaPick(overrides = {}) {
  const card = baseCard(overrides.wnbaDataCard || {});
  const reader = overrides.wnbaReader || readWnbaProp(card);
  const side = overrides.side || (reader.finalSide === "UNDER" ? "Under" : "Over");
  return {
    player: card.player || "Test Player",
    team: card.team || "seattlestorm",
    opponent: card.opponent || "lasvegasaces",
    line: card.bookLine,
    side,
    pick: side,
    league: "WNBA",
    engineHandled: "WNBA_V2",
    wnbaDataCard: card,
    wnbaReader: reader,
    readerDecision: reader.decision,
    readerConfidence: reader.readerConfidence ?? 55,
    projection: card.projection.projection,
    bookCount: card.bookCount,
    ...overrides,
  };
}

function runScript(name) {
  const result = spawnSync(process.execPath, [path.join(__dirname, name)], {
    cwd: SERVER_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${name} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

const tests = [];

tests.push({
  name: "01 decisionDataIntelligence schema version",
  fn() {
    const pick = makeWnbaPick();
    const ddi = evaluateDecisionDataIntelligence(pick);
    assert.strictEqual(ddi.version, DECISION_DATA_INTELLIGENCE_VERSION);
    assert.ok(ddi.roleStability);
    assert.ok(ddi.usageShare);
    assert.ok(ddi.sameTeamCollision);
    assert.ok(ddi.marketIntelligence);
    assert.ok(ddi.availabilityImpact);
    assert.ok(ddi.projectionQuality);
    assert.ok(ddi.flipFirstDecision);
    assert.ok(ddi.finalInfluence);
  },
});

tests.push({
  name: "02 same-team collision detects teammate overs",
  fn() {
    const a = makeWnbaPick({
      player: "Natisha Hiedeman",
      side: "Over",
      line: 14.5,
      wnbaDataCard: baseCard({ player: "Natisha Hiedeman", bookLine: 14.5, last5: { points: 16, minutes: 28, fga: 11, games: 5 } }),
    });
    const b = makeWnbaPick({
      player: "Dominique Malonga",
      side: "Over",
      line: 17.5,
      wnbaDataCard: baseCard({ player: "Dominique Malonga", bookLine: 17.5, last5: { points: 18, minutes: 27, fga: 10, games: 5 } }),
    });
    const collision = evaluateSameTeamUsageCollision(a, {
      slateCandidates: [a, b],
      impliedTeamTotal: 78,
    });
    assert.strictEqual(collision.detected, true);
    assert.ok(collision.teammatesInConflict.includes("Dominique Malonga"));
  },
});

tests.push({
  name: "03 line movement edge shrink signals Under review",
  fn() {
    const pick = makeWnbaPick({
      player: "Marina Mabrey",
      side: "Over",
      line: 26,
      openingLine: 22.5,
      projection: 27,
      marketIntelligence: { openingLine: 22.5, currentLine: 26, lineDelta: 3.5 },
      wnbaDataCard: baseCard({
        player: "Marina Mabrey",
        bookLine: 26,
        projection: { projection: 27, expectedMinutes: 30, expectedFGA: 12 },
        last5: { points: 22, minutes: 30, fga: 12, games: 5 },
      }),
    });
    const market = evaluateMarketMovementIntelligence(pick, { side: "OVER" });
    assert.ok(Number(market.edgeAtOpen) > Number(market.edgeNow));
    const ddi = evaluateDecisionDataIntelligence(pick, { originalSide: "OVER" });
    assert.ok(ddi.marketIntelligence.reasons.some((r) => r.includes("Edge shrank")));
  },
});

tests.push({
  name: "04 usage weakness supports Under review",
  fn() {
    const pick = makeWnbaPick({
      side: "Over",
      roleChange: { recentMinutesTrend: "DOWN", recentFGATrend: "DOWN" },
      wnbaDataCard: baseCard({
        projection: { projection: 13, expectedMinutes: 18, expectedFGA: 6 },
        last5: { points: 11, minutes: 18, fga: 6, games: 5 },
      }),
    });
    const ddi = evaluateDecisionDataIntelligence(pick);
    assert.strictEqual(ddi.usageShare.sideImpact, "UNDER");
  },
});

tests.push({
  name: "05 hot-game inflation flags projection quality",
  fn() {
    const pick = makeWnbaPick({
      side: "Over",
      volumeProfile: { efficiencyWarning: "Efficiency-only scoring spike" },
      wnbaDataCard: baseCard({
        last5: { points: 22, minutes: 24, fga: 7, ptsPerFGA: 1.35, games: 5 },
        season: { points: 14, minutes: 26, fga: 10, ptsPerFGA: 1.05 },
      }),
    });
    const ddi = evaluateDecisionDataIntelligence(pick);
    assert.strictEqual(ddi.projectionQuality.hotGameRisk, true);
  },
});

tests.push({
  name: "06 availability unknown adds uncertainty",
  fn() {
    const pick = makeWnbaPick({
      availabilityGate: { availabilityDataMissing: true, availabilitySourceStatus: "SOURCE_UNAVAILABLE" },
      wnbaDataCard: baseCard({
        injuryAvailability: { level: "UNKNOWN", availabilityDataMissing: true },
      }),
    });
    const ddi = evaluateDecisionDataIntelligence(pick);
    assert.strictEqual(ddi.availabilityImpact.uncertaintyAdded, true);
  },
});

tests.push({
  name: "07b flip-first thin Under gap below floor → BOTH_SIDES_WEAK",
  fn() {
    const pick = makeWnbaPick({
      side: "Under",
      wnbaDataCard: baseCard({
        dataMode: "WNBA_FULL_DATA",
        bookLine: 18.5,
        projection: { projection: 16.8, expectedMinutes: 33, expectedFGA: 14 },
        last5: { points: 15.2, minutes: 33, fga: 14.2, games: 5 },
        fairLine: { fairLineSide: "UNDER", fairLineEdge: 1.6, fairLineQuality: 90 },
        minutesVolatility: "volatile",
      }),
      projection: 16.8,
      netEdge: 32,
      volumeDangerGates: { gates: ["volatile_minutes"] },
      dangerGateStack: ["volatileMinutes", "thinGap"],
    });
    const ff = evaluateFlipFirstSideSelection(pick, { originalSide: "UNDER" });
    assert.strictEqual(ff.action, "BOTH_SIDES_WEAK");
    assert.strictEqual(ff.flipRecommended, false);
  },
});

tests.push({
  name: "07 flip-first keeps clean Over without flip",
  fn() {
    const pick = makeWnbaPick({
      side: "Over",
      wnbaDataCard: baseCard({
        bookLine: 14.5,
        projection: { projection: 18, expectedMinutes: 30, expectedFGA: 12 },
        last5: { points: 17, minutes: 30, fga: 12, games: 5 },
        fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 75 },
        roleTrend: "up",
        minutesVolatility: "stable",
      }),
      roleChange: { recentMinutesTrend: "UP", recentFGATrend: "UP" },
    });
    const ddi = evaluateDecisionDataIntelligence(pick, { originalSide: "OVER" });
    assert.strictEqual(ddi.flipFirstDecision.flipRecommended, false);
    assert.strictEqual(ddi.flipFirstDecision.finalSide, "OVER");
  },
});

tests.push({
  name: "08 compact labels built",
  fn() {
    const pick = makeWnbaPick();
    const enriched = runFlipFirstDecisionPipeline(pick);
    assert.ok(enriched.flipFirstLabels);
    assert.ok(enriched.flipFirstLabels.usage);
    assert.ok(enriched.flipFirstLabels.flipCheck);
  },
});

tests.push({
  name: "09 Best 6 display promotes board-only picks to TRACK",
  fn() {
    const boardOnly = makeWnbaPick({
      trackingType: "TEST",
      wnbaDataCard: baseCard({
        minutesVolatility: "volatile",
        projection: { projection: 11, expectedMinutes: 24, expectedFGA: 8 },
        last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, games: 5 },
        season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
      }),
    });
    const result = selectBestSixDisplay([boardOnly], "WNBA");
    assert.ok(Array.isArray(result.bestSix));
    assert.strictEqual(CONTROLLED_BEST_SIX_VERSION, "controlled-best-six-over-balance-v2");
    if (result.bestSix.length) {
      assert.strictEqual(result.bestSix[0].resultsDecisionLabel, "TRACK");
    }
  },
});

tests.push({
  name: "10 Side Rescue still requires independent evidence",
  fn() {
    const pick = makeWnbaPick({
      side: "Under",
      wnbaDataCard: baseCard({
        minutesVolatility: "volatile",
        projection: { projection: 11, expectedMinutes: 24, expectedFGA: 8 },
        last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, games: 5 },
      }),
    });
    const enriched = runFlipFirstDecisionPipeline(pick);
    const sr = evaluateSideRescue(enriched, {
      decisionIntelligence: enriched.decisionIntelligence,
      dataCard: enriched.wnbaDataCard,
      reader: enriched.wnbaReader,
      originalSide: enriched.initialSide,
    });
    if (sr.action === "FLIP_SIDE") {
      assert.ok(sr.oppositeSideEvidence.length >= 2 || sr.flipConfidence >= 60);
    }
  },
});

tests.push({
  name: "10b thin gap triggers CHECK_UNDER review without auto-flip",
  fn() {
    const pick = makeWnbaPick({
      side: "Over",
      line: 14.5,
      wnbaDataCard: baseCard({
        bookLine: 14.5,
        dataMode: "WNBA_FULL_DATA",
        minutesVolatility: "stable",
        projection: { projection: 17.8, expectedMinutes: 30, expectedFGA: 12 },
        last5: { points: 17, minutes: 30, fga: 12, games: 5 },
        fairLine: { fairLineSide: "OVER", fairLineEdge: 2.5, fairLineQuality: 60 },
      }),
      volumeDangerGates: { gates: ["thinGap"] },
    });
    const fd = evaluateFlipFirstSideSelection(pick, {
      decisionDataIntelligence: evaluateDecisionDataIntelligence(pick, { originalSide: "OVER" }),
      reader: pick.wnbaReader,
      dataCard: pick.wnbaDataCard,
      originalSide: "OVER",
    });
    assert.strictEqual(fd.oppositeSideChecked, true);
    assert.strictEqual(fd.flipRecommended, false);
    assert.strictEqual(fd.action, "CHECK_UNDER");
  },
});

tests.push({
  name: "11 controlled best six regression",
  fn() {
    runScript("testControlledBestSix.js");
  },
});

tests.push({
  name: "12 side rescue regression",
  fn() {
    runScript("testSideRescueEngineV1.js");
  },
});

tests.push({
  name: "13 decision intelligence regression",
  fn() {
    runScript("testPropDecisionIntelligenceV1.js");
  },
});

tests.push({
  name: "14 data flow regression",
  fn() {
    runScript("testCourtEdgeDataFlow.js");
  },
});

tests.push({
  name: "15 slate rotation regression",
  fn() {
    runScript("testSlateRotationLifecycle.js");
  },
});

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err.message || err);
  }
}

console.log(`\nFlip-First Decision Intelligence v1: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
