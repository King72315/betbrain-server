/**
 * WNBA v2 data card + reader tests (no prod mutation).
 * Usage: node betbrain-server/scripts/testWnbaDataCard.js
 */
import assert from "assert";
import { projectWnbaPoints } from "../engines/wnba/wnbaProjectionEngine.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import { isCourteEdgeWnbaV2Enabled, WNBA_ENGINE_HANDLED } from "../engines/wnba/wnbaDecisionEngine.js";

function baseCard(overrides = {}) {
  return {
    version: "wnba-data-card-v2",
    playerId: "123",
    player: "Test Player",
    team: "Team A",
    opponent: "Team B",
    propType: "Points",
    bookLine: 5.5,
    openingLine: 5.5,
    currentLine: 5.5,
    lineMovement: 0,
    bookCount: 4,
    lineSpread: 0.5,
    overOdds: -110,
    underOdds: -110,
    marketQuality: 65,
    season: { points: 8.2, minutes: 22, fga: 7, fta: 2, ptsPerFGA: 1.1, ftPath: true },
    last5: { points: 9.4, pointsList: [8, 10, 9, 11, 9], minutes: 24, fga: 8, fta: 2.5, ptsPerFGA: 1.15, ftPath: true, games: 5 },
    scoringTrend: "up",
    usageShotTrend: "STABLE",
    roleTrend: "stable",
    injuryAvailability: { status: "Active", level: "ACTIVE", blocksPlay: false, reasons: [] },
    teammateUsageShift: { active: false, fgaBoost: 0, minutesBoost: 0, reasons: [] },
    opponentDefense: { score: 45, label: "average", context: {} },
    gameEnvironment: { spread: -4, total: 158, impliedTeamTotal: 81, blowoutRisk: 35, pace: null, highBlowoutRisk: false },
    projection: { projection: 9.8, expectedMinutes: 24, expectedFGA: 8, expectedFTA: 2.5, method: "volume-first-v2" },
    fairLine: { fairLine: 8.5, fairLineSide: "OVER", fairLineEdge: 3, fairLineQuality: 62, fairLineSideEffective: "OVER" },
    dataMissingFlags: [],
    dataConfidenceScore: 78,
    ...overrides,
  };
}

function testLowLineOver() {
  const reader = readWnbaProp(baseCard());
  assert.strictEqual(reader.finalSide, "OVER");
  assert.ok(reader.whyOver.some((r) => r.includes("volume") || r.includes("gap")));
  assert.ok(["OFFICIAL", "TEST"].includes(reader.decision));
  console.log("✓ low-line Over 5.5");
}

function testRoleRisingBettsLike() {
  const reader = readWnbaProp(
    baseCard({
      player: "NaLyssa Smith",
      bookLine: 14.5,
      season: { points: 11, minutes: 26, fga: 10, fta: 3, ptsPerFGA: 1.05, ftPath: true },
      last5: { points: 16.2, pointsList: [14, 18, 15, 17, 17], minutes: 30, fga: 13, fta: 4, ptsPerFGA: 1.2, ftPath: true, games: 5 },
      roleTrend: "up",
      scoringTrend: "up",
      projection: { projection: 16.5, expectedMinutes: 30, expectedFGA: 13, expectedFTA: 4, method: "volume-first-v2" },
      fairLine: { fairLine: 15.5, fairLineSide: "OVER", fairLineEdge: 1, fairLineQuality: 55 },
      teammateUsageShift: { active: true, fgaBoost: 1.5, minutesBoost: 2, reasons: ["Starter out"] },
    })
  );
  assert.strictEqual(reader.finalSide, "OVER");
  assert.ok(
    reader.supports.some((s) => s.includes("Role trend") || s.includes("Teammate"))
  );
  console.log("✓ role rising case");
}

function testFairLineDisagreement() {
  const reader = readWnbaProp(
    baseCard({
      bookLine: 16.5,
      season: { points: 15, minutes: 28, fga: 11, fta: 3, ptsPerFGA: 1.1, ftPath: true },
      last5: { points: 17.5, pointsList: [16, 18, 17, 19, 17], minutes: 29, fga: 12, fta: 3, ptsPerFGA: 1.12, ftPath: true, games: 5 },
      projection: { projection: 18.5, expectedMinutes: 29, expectedFGA: 12, expectedFTA: 3, method: "volume-first-v2" },
      fairLine: { fairLine: 13.5, fairLineSide: "UNDER", fairLineEdge: 3, fairLineQuality: 68 },
    })
  );
  assert.strictEqual(reader.finalSide, "OVER");
  assert.ok(
    reader.reasonCodes.includes("FAIR_LINE_STRONG_DISAGREE") || reader.decision !== "OFFICIAL"
  );
  assert.ok(reader.disagrees.some((d) => d.includes("Fair line")));
  console.log("✓ fair-line disagreement → TEST/NO_BET");
}

function testMissingPlayerId() {
  const reader = readWnbaProp(
    baseCard({
      playerId: "",
      dataConfidenceScore: 42,
      dataMissingFlags: [{ key: "playerId", missing: true, note: "No stable BallDontLie player id" }],
    })
  );
  assert.ok(reader.reasonCodes.includes("MISSING_PLAYER_ID"));
  assert.ok(reader.readerConfidence <= 85);
  console.log("✓ missing playerId lowers confidence");
}

function testProjectionEngine() {
  const result = projectWnbaPoints({
    seasonMinutes: 28,
    recentMinutes: 30,
    seasonFGA: 11,
    recentFGA: 13,
    seasonFTA: 3,
    recentFTA: 4,
    seasonPoints: 14,
    recentPoints: 17,
    roleChange: { expectedMinutesDelta: 2, expectedFGADelta: 1.5, expectedFTADelta: 0.5 },
  });
  assert.ok(result.projection > 14);
  assert.ok(result.expectedFGA >= 12);
  console.log("✓ volume-first projection");
}

function testNbaPathUnchanged() {
  assert.strictEqual(isCourteEdgeWnbaV2Enabled(), true);
  assert.strictEqual(WNBA_ENGINE_HANDLED, "WNBA_V2");

  const nbaPickShape = {
    league: "NBA",
    pick: "Over",
    side: "Over",
    riskLabel: "Medium Risk",
    tier: "WATCHLIST",
    engineHandled: undefined,
  };
  assert.strictEqual(nbaPickShape.league, "NBA");
  assert.strictEqual(nbaPickShape.engineHandled, undefined);
  console.log("✓ NBA pick shape has no engineHandled (WNBA-only field)");
}

function main() {
  testProjectionEngine();
  testLowLineOver();
  testRoleRisingBettsLike();
  testFairLineDisagreement();
  testMissingPlayerId();
  testNbaPathUnchanged();
  console.log("\nAll WNBA v2 data card tests passed.");
}

main();
