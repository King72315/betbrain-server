/**
 * Reader ↔ Tracking Gate Over alignment fixtures (in-memory only).
 * Usage: node scripts/testReaderGateAlignV1.js
 */
import assert from "assert";
import {
  resolveWnbaGapFloors,
  WNBA_FULL_OVER_GAP_FLOOR,
  WNBA_LIMITED_OVER_GAP_FLOOR,
  WNBA_UNDER_GAP_FLOOR,
  WNBA_READER_MEANINGFUL_OVER_GAP,
} from "../engines/wnba/wnbaGraduatedDataModeV1.js";
import { evaluateWnbaTrackingGateV2 } from "../engines/wnba/wnbaTrackingGateV2.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import { promoteBestSixCohortPick } from "../engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import {
  selectControlledBestSixCombined,
  selectBestSixDisplay,
  BEST_SIX_LIMIT,
  computeSafetyScore,
} from "../engines/topProps/controlledBestSixSelector.js";

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
    version: "wnba-data-card-v2",
    playerId: "123",
    player: "Test Player",
    team: "Team A",
    opponent: "Team B",
    propType: "Points",
    bookLine: 21.5,
    currentLine: 21.5,
    bookCount: 5,
    marketQuality: 70,
    dataMode: "WNBA_FULL_DATA",
    minutesVolatility: "stable",
    season: { points: 22, minutes: 32, fga: 16, ptsPerFGA: 1.1 },
    last5: { points: 24, minutes: 32, fga: 16, ptsPerFGA: 1.1, games: 5 },
    scoringTrend: "stable",
    roleTrend: "stable",
    injuryAvailability: { level: "ACTIVE", blocksPlay: false },
    projection: { projection: 25.1, expectedMinutes: 32, expectedFGA: 16 },
    fairLine: { fairLine: 24, fairLineSide: "OVER", fairLineEdge: 3.6, fairLineQuality: 70 },
    dataMissingFlags: [],
    dataConfidenceScore: 80,
    ...overrides,
  };
}

function makePick(cardOverrides = {}, pickOverrides = {}) {
  const card = baseCard(cardOverrides);
  const reader = readWnbaProp(card);
  const side = pickOverrides.side || (reader.finalSide === "UNDER" ? "Under" : "Over");
  return {
    player: card.player,
    team: card.team,
    opponent: card.opponent,
    line: card.bookLine,
    side,
    pick: side,
    league: "WNBA",
    engineHandled: "WNBA_V2",
    projection: card.projection.projection,
    bookCount: card.bookCount,
    marketQuality: card.marketQuality,
    dataMode: card.dataMode,
    netEdge: pickOverrides.netEdge ?? 6,
    confidence: pickOverrides.confidence ?? 70,
    wnbaDataCard: card,
    wnbaReader: reader,
    ...pickOverrides,
  };
}

test("constants: meaningful Over = FULL Over floor = 3.0; Under/Limited unchanged", () => {
  assert.strictEqual(WNBA_FULL_OVER_GAP_FLOOR, 3);
  assert.strictEqual(WNBA_READER_MEANINGFUL_OVER_GAP, 3);
  assert.strictEqual(WNBA_LIMITED_OVER_GAP_FLOOR, 4);
  assert.strictEqual(WNBA_UNDER_GAP_FLOOR, 3.5);
});

test("1 Full-data Over +3.6: Reader meaningful, Gate TRACK, no promotion needed", () => {
  const pick = makePick({
    player: "Kelsey Mitchell",
    bookLine: 21.5,
    projection: { projection: 25.1, expectedMinutes: 32, expectedFGA: 16 },
    fairLine: { fairLine: 24, fairLineSide: "OVER", fairLineEdge: 3.6, fairLineQuality: 70 },
  });
  const gap = 25.1 - 21.5;
  assert.ok(Math.abs(gap - 3.6) < 1e-9);
  assert.ok(gap >= WNBA_READER_MEANINGFUL_OVER_GAP);
  const floors = resolveWnbaGapFloors({
    side: "OVER",
    dataMode: "WNBA_FULL_DATA",
    volatility: "stable",
  });
  assert.strictEqual(floors.gapFloor, 3);
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.wnbaTrackingDecision, "TRACK");
  const promoted = promoteBestSixCohortPick({
    ...pick,
    naturalDecision: gate.wnbaTrackingDecision,
    decisionIntelligence: {
      trackEligibility: gate.wnbaTrackingDecision,
      gateReason: gate.wnbaTrackingReason,
      originalGateEligibility: gate.wnbaTrackingDecision,
    },
  });
  assert.strictEqual(promoted.naturalDecision, "TRACK");
  assert.strictEqual(promoted.promotedForBestSix, false);
});

test("2 Full-data Over +2.9: below meaningful, Gate BOARD_ONLY", () => {
  const pick = makePick({
    bookLine: 21.5,
    projection: { projection: 24.4, expectedMinutes: 32, expectedFGA: 16 },
    fairLine: { fairLine: 23, fairLineSide: "OVER", fairLineEdge: 2.9, fairLineQuality: 65 },
  });
  const gap = 24.4 - 21.5;
  assert.ok(Math.abs(gap - 2.9) < 1e-9);
  assert.ok(gap < WNBA_READER_MEANINGFUL_OVER_GAP);
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.ok(["BOARD_ONLY", "NO_BET"].includes(gate.wnbaTrackingDecision));
});

test("3 Full-data Over +4.2: Reader strong gap, Gate TRACK", () => {
  const pick = makePick({
    bookLine: 21.5,
    projection: { projection: 25.7, expectedMinutes: 32, expectedFGA: 16 },
    fairLine: { fairLine: 25, fairLineSide: "OVER", fairLineEdge: 4.2, fairLineQuality: 75 },
  });
  assert.ok(25.7 - 21.5 >= 4);
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.wnbaTrackingDecision, "TRACK");
});

test("4 Limited-data Over floor unchanged at 4.0", () => {
  const floors = resolveWnbaGapFloors({
    side: "OVER",
    dataMode: "WNBA_LIMITED_DATA",
    volatility: "stable",
  });
  assert.strictEqual(floors.gapFloor, 4);
  const pick = makePick({
    dataMode: "WNBA_LIMITED_DATA",
    bookLine: 14.5,
    bookCount: 2,
    marketQuality: 40,
    dataConfidenceScore: 40,
    last5: { points: 16, minutes: 28, fga: 10, ptsPerFGA: 1.05, games: 1 },
    projection: { projection: 17.5, expectedMinutes: 28, expectedFGA: 10 },
    dataMissingFlags: [
      { key: "last5", missing: true, note: "Only 1 recent games" },
      { key: "market", missing: true },
    ],
  }, { netEdge: 4 });
  pick.dataMissingFlags = pick.wnbaDataCard.dataMissingFlags;
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.keyMetrics?.gapFloorApplied, 4);
  assert.strictEqual(gate.sideGatePassed, false);
  assert.ok(["BOARD_ONLY", "NO_BET"].includes(gate.wnbaTrackingDecision));
});

test("5 Full-data Under floor unchanged at 3.5", () => {
  const floors = resolveWnbaGapFloors({
    side: "UNDER",
    dataMode: "WNBA_FULL_DATA",
    volatility: "stable",
  });
  assert.strictEqual(floors.gapFloor, 3.5);
});

test("6 Limited-data Under floor unchanged at 3.5", () => {
  const floors = resolveWnbaGapFloors({
    side: "UNDER",
    dataMode: "WNBA_LIMITED_DATA",
    volatility: "stable",
  });
  assert.strictEqual(floors.gapFloor, 3.5);
});

test("7 Hiedeman-style +1.7 Over remains BOARD_ONLY", () => {
  const pick = makePick({
    player: "Natisha Hiedeman",
    bookLine: 15.5,
    projection: { projection: 17.2, expectedMinutes: 30, expectedFGA: 10 },
    last5: { points: 16, minutes: 29, fga: 10, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLine: 16.5, fairLineSide: "OVER", fairLineEdge: 1.7, fairLineQuality: 60 },
  });
  assert.ok(Math.abs(17.2 - 15.5 - 1.7) < 1e-9);
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.ok(["BOARD_ONLY", "NO_BET"].includes(gate.wnbaTrackingDecision));
});

test("8 Kelsey-style +3.6: gap floor passes; natural TRACK only if danger allows", () => {
  // Clean fixture without volatile volume / missing defense → natural TRACK.
  const clean = makePick({
    player: "Kelsey Mitchell",
    bookLine: 21.5,
    projection: { projection: 25.1, expectedMinutes: 32.9, expectedFGA: 16 },
    minutesVolatility: "stable",
    roleTrend: "stable",
    defenseProxyUsed: false,
  });
  clean.volumeProfile = {
    minutesVolatility: "stable",
    volumeStability: "STABLE",
  };
  clean.defenseAudit = { proxyUsed: false, resolvedDefenseScore: 55 };
  const gate = evaluateWnbaTrackingGateV2(clean);
  assert.strictEqual(gate.sideGatePassed, true);
  assert.ok(
    gate.wnbaTrackingDecision === "TRACK" ||
      !(gate.wnbaTrackingReason || "").includes("OVER_GAP_BELOW"),
    `gap floor must not be the reject reason; got ${gate.wnbaTrackingDecision}/${gate.wnbaTrackingReason}`
  );
});

test("8b Snapshot-shaped Kelsey: gap floor not the reject reason after alignment", () => {
  const pick = makePick({
    player: "Kelsey Mitchell",
    bookLine: 21.5,
    projection: { projection: 25.1, expectedMinutes: 32.9, expectedFGA: 16 },
  });
  pick.volumeProfile = {
    minutesVolatility: "stable",
    volumeStability: "VOLATILE",
  };
  pick.defenseAudit = { proxyUsed: true, resolvedDefenseScore: 50 };
  pick.defenseProxyUsed = true;
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.sideGatePassed, true);
  assert.ok(!(gate.wnbaTrackingReason || "").includes("OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR"));
  assert.ok(
    gate.dangerGateStack?.includes("volatileMinutes") ||
      gate.dangerGateStack?.includes("missingOpponentDefense") ||
      ["BOARD_ONLY", "NO_BET", "TRACK"].includes(gate.wnbaTrackingDecision)
  );
});

test("9 No side flip from threshold-only alignment fixtures", () => {
  const over = makePick({
    bookLine: 21.5,
    projection: { projection: 25.1, expectedMinutes: 32, expectedFGA: 16 },
  });
  const under = makePick({
    bookLine: 16.5,
    projection: { projection: 14, expectedMinutes: 23, expectedFGA: 8 },
    last5: { points: 14, minutes: 23, fga: 8, ptsPerFGA: 1.0, games: 5 },
    fairLine: { fairLine: 14.5, fairLineSide: "UNDER", fairLineEdge: 2.5, fairLineQuality: 65 },
  }, { side: "Under" });
  assert.strictEqual(String(over.wnbaReader.finalSide).toUpperCase(), "OVER");
  assert.strictEqual(String(under.wnbaReader.finalSide).toUpperCase(), "UNDER");
});

test("10 Best 6 still selects six", () => {
  assert.strictEqual(BEST_SIX_LIMIT, 6);
  const picks = [];
  for (let i = 0; i < 8; i++) {
    picks.push(
      makePick(
        {
          player: `Player ${i}`,
          playerId: String(100 + i),
          team: `Team${i % 4}`,
          bookLine: 15.5,
          projection: { projection: 20 - i * 0.2, expectedMinutes: 28, expectedFGA: 11 },
        },
        {
          confidence: 70 - i,
          netEdge: 8 - i * 0.3,
          dayBucket: "TOMORROW",
          dateLabel: "tomorrow",
          trackingEligibility: "TRACK",
          wnbaTrackingDecision: "TRACK",
        }
      )
    );
  }
  const { bestSix } = selectBestSixDisplay(picks, "WNBA");
  assert.ok(Array.isArray(bestSix));
  assert.strictEqual(bestSix.length, 6);
  void selectControlledBestSixCombined;
});

test("11 Top selection still exposes computeSafetyScore", () => {
  assert.strictEqual(typeof computeSafetyScore, "function");
  const score = computeSafetyScore(
    makePick({
      projection: { projection: 25.1, expectedMinutes: 32, expectedFGA: 16 },
    })
  );
  assert.ok(Number.isFinite(score) || score == null || typeof score === "object");
});

test("13 Natural decision remains preserved after promotion", () => {
  const promoted = promoteBestSixCohortPick({
    player: "Board Only Fill",
    naturalDecision: "BOARD_ONLY",
    decisionIntelligence: {
      trackEligibility: "BOARD_ONLY",
      originalGateEligibility: "BOARD_ONLY",
      gateReason: "OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR",
      trueRisk: "MEDIUM",
    },
  });
  assert.strictEqual(promoted.naturalDecision, "BOARD_ONLY");
  assert.strictEqual(promoted.decisionIntelligence.naturalDecision, "BOARD_ONLY");
  assert.strictEqual(promoted.promotedForBestSix, true);
  assert.strictEqual(promoted.promotedDecision, "TRACK");
  assert.strictEqual(promoted.trackingEligibility, "TRACK");
});

console.log(process.exitCode ? "DONE WITH FAILURES" : "ALL PASS");
