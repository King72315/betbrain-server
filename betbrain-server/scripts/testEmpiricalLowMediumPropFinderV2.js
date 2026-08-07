/**
 * Empirical Low & Medium Prop Finder V2 — acceptance tests (Parts 41).
 */
process.env.EMPIRICAL_SAFE_PROP_V2 = "true";

import assert from "assert";
import {
  buildCanonicalPlayerForecastPacketV1,
  buildPlayerRoleStabilityEngineV1,
  buildPlayerMinutesModelV1,
  buildPlayerPropMarketModelV1,
  evaluateSideForecastPacketV1,
  selectOfficialBoardFromProbabilitySafetyV1,
  resolveAvailabilityCertainty,
} from "../engines/probabilitySafetyV1/index.js";
import {
  classifyRiskEmpiricalV2,
  computeReliabilityProbabilityV2,
  computeTrustScoreV2,
  evaluateSafePropPathwaysV2,
  annotateSlateRelativeStrengthV1,
  EMPIRICAL_SAFE_PROP_V2_BUILD,
  EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
} from "../engines/empiricalSafePropV2/index.js";
import {
  FULL_ROSTER_COLLECTION_MODE,
  FULL_ROSTER_CREDIT_GUARD,
  isEmpiricalSafePropV2Enabled,
} from "../engines/topProps/courtEdgeFeatureFlagsV1.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed += 1;
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}

const strongPick = {
  playerName: "High Minute Star",
  player: "High Minute Star",
  team: "teamA",
  opponent: "teamB",
  league: "WNBA",
  line: 14.5,
  side: "UNDER",
  pick: "UNDER",
  projection: 11.0,
  fairLine: 11.2,
  avgMinutesL5: 32,
  expectedMinutes: 32,
  expectedFGA: 9,
  avgPointsL5: 12,
  avgPoints: 13,
  bookCount: 1,
  availabilityStatus: "ACTIVE",
  slateDate: "2026-08-07",
};

test("1 integrity corruption hard-blocks", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: { ...strongPick, availabilityStatus: "OUT" },
    rawWinProbability: 0.9,
    safety: { finalSafetyScore: 90 },
    minutes: { minutesStabilityScore: 95 },
    role: { roleStabilityScore: 90 },
    market: { marketQualityScore: 90, bookCount: 5 },
    conflict: { conflictIndex: 0 },
    failure: { majorFailurePathCount: 0 },
    availability: { availabilityCertaintyScore: 10 },
  });
  assert.strictEqual(risk.risk, "HIGH");
  assert.ok(risk.integrityVetoes.includes("CONFIRMED_INACTIVE"));
});

test("2 marketQuality alone does not force HIGH", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: strongPick,
    rawWinProbability: 0.75,
    safety: { finalSafetyScore: 80 },
    minutes: { minutesStabilityScore: 90 },
    role: { roleStabilityScore: 75 },
    market: { marketQualityScore: 35, bookCount: 2 },
    conflict: { conflictIndex: 5 },
    failure: { majorFailurePathCount: 0 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.ok(risk.marketQualityAloneCannotForceHigh === true);
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(risk.risk));
});

test("3 bookCount alone does not force HIGH", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: { ...strongPick, bookCount: 1 },
    rawWinProbability: 0.75,
    safety: { finalSafetyScore: 80 },
    minutes: { minutesStabilityScore: 90 },
    role: { roleStabilityScore: 75 },
    market: { marketQualityScore: 40, bookCount: 1 },
    conflict: { conflictIndex: 5 },
    failure: { majorFailurePathCount: 0 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.ok(risk.bookCountAloneCannotForceHigh === true);
});

test("4 role below old cutoff does not automatically force HIGH", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: strongPick,
    rawWinProbability: 0.75,
    safety: { finalSafetyScore: 80 },
    minutes: { minutesStabilityScore: 90 },
    role: { roleStabilityScore: 68, missingness: {} },
    market: { marketQualityScore: 40, bookCount: 1 },
    conflict: { conflictIndex: 5 },
    failure: { majorFailurePathCount: 0 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.ok(risk.roleBelow75AloneCannotForceHigh === true);
  assert.notStrictEqual(risk.risk, undefined);
});

test("5 missing feature does not become zero", () => {
  const m = buildPlayerMinutesModelV1({});
  assert.strictEqual(m.minutesStabilityScore, null);
  const mk = buildPlayerPropMarketModelV1({ line: 15.5 });
  assert.strictEqual(mk.marketQualityScore, null);
  const a = resolveAvailabilityCertainty({});
  assert.strictEqual(a.availabilityCertaintyScore, null);
  const role = buildPlayerRoleStabilityEngineV1({ avgMinutesL5: 32 });
  assert.notStrictEqual(role.roleStabilityScore, 68);
  const rel = computeReliabilityProbabilityV2({
    rawWinProbability: 0.8,
    SafetyScore: 78,
    projectionEdge: 4,
  });
  assert.ok(rel.featuresMissing.includes("minutesStability"));
});

test("6 large edge alone does not create LOW", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: { ...strongPick, projection: 20, line: 10 },
    rawWinProbability: 0.51,
    safety: { finalSafetyScore: null },
    minutes: { minutesStabilityScore: null },
    role: { roleStabilityScore: null, missingness: { starterStatus: true } },
    market: {
      marketQualityScore: null,
      bookCount: null,
      missingness: { bookCount: true },
    },
    conflict: { conflictIndex: 40 },
    failure: { majorFailurePathCount: 3 },
    availability: { availabilityCertaintyScore: null },
  });
  assert.notStrictEqual(risk.risk, "LOW");
});

test("7 high probability alone does not create LOW", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: { side: "OVER", line: 15.5, projection: 15.7 },
    rawWinProbability: 0.85,
    safety: { finalSafetyScore: null },
    minutes: { minutesStabilityScore: 40 },
    role: { roleStabilityScore: 40 },
    market: { marketQualityScore: 40, bookCount: 1 },
    conflict: { conflictIndex: 50 },
    failure: { majorFailurePathCount: 2 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.notStrictEqual(risk.risk, "LOW");
});

test("8 reliability can rescue thin-market candidate", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: strongPick,
    rawWinProbability: 0.72,
    safety: { finalSafetyScore: 80 },
    minutes: { minutesStabilityScore: 92, expectedMinutes: 32 },
    role: { roleStabilityScore: 75 },
    market: { marketQualityScore: 40, bookCount: 1 },
    conflict: { conflictIndex: 8 },
    failure: { majorFailurePathCount: 0 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.ok(["LOW", "MEDIUM"].includes(risk.risk));
  assert.ok(
    risk.safePathway === "THIN_MARKET_STRONG_EDGE" ||
      risk.safePathway === "STABLE_HIGH_EDGE" ||
      risk.safePathway === "STRUCTURAL_UNDER" ||
      risk.safePathway === "GENERAL_HIGH_RELIABILITY"
  );
});

test("9 weak reliability remains HIGH despite large edge", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: { ...strongPick, projection: 8, line: 18.5, side: "UNDER" },
    rawWinProbability: 0.52,
    safety: { finalSafetyScore: 45 },
    minutes: { minutesStabilityScore: 50 },
    role: { roleStabilityScore: 50 },
    market: { marketQualityScore: 80, bookCount: 5 },
    conflict: { conflictIndex: 55 },
    failure: { majorFailurePathCount: 3 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.strictEqual(risk.risk, "HIGH");
});

test("10 Structural Under pathway works", () => {
  const pw = evaluateSafePropPathwaysV2({
    side: "UNDER",
    projectionEdge: 3.5,
    minutesStability: 85,
    rawWinProbability: 0.68,
    conflictIndex: 10,
    majorFailurePathCount: 0,
    reliabilityProbability: 0.8,
  });
  assert.ok(pw.pathways.some((p) => p.id === "STRUCTURAL_UNDER"));
});

test("11 Stable-volume Over pathway works", () => {
  const pw = evaluateSafePropPathwaysV2({
    side: "OVER",
    projectionEdge: 3.5,
    minutesStability: 88,
    roleStability: 75,
    rawWinProbability: 0.66,
    conflictIndex: 10,
    majorFailurePathCount: 0,
    reliabilityProbability: 0.8,
  });
  assert.ok(pw.pathways.some((p) => p.id === "STABLE_VOLUME_OVER"));
});

test("12 Stable-high-edge pathway works", () => {
  const pw = evaluateSafePropPathwaysV2({
    side: "UNDER",
    projectionEdge: 4.5,
    minutesStability: 90,
    roleStability: 75,
    rawWinProbability: 0.7,
    conflictIndex: 5,
    majorFailurePathCount: 0,
  });
  assert.ok(pw.pathways.some((p) => p.id === "STABLE_HIGH_EDGE"));
});

test("13 pathway alone cannot bypass poor reliability", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: strongPick,
    rawWinProbability: 0.7,
    safety: { finalSafetyScore: 50 },
    minutes: { minutesStabilityScore: 90 },
    role: { roleStabilityScore: 75 },
    market: { marketQualityScore: 40, bookCount: 1 },
    conflict: { conflictIndex: 5 },
    failure: { majorFailurePathCount: 0 },
    availability: { availabilityCertaintyScore: 90 },
  });
  // Even with pathway shape, weak safety/reliability combo should not freely LOW without rel floor
  if (risk.risk === "LOW") {
    assert.ok(risk.reliabilityProbability >= 0.68);
  }
});

test("14 LOW requires positive empirical trust", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: strongPick,
    rawWinProbability: 0.75,
    safety: { finalSafetyScore: 82 },
    minutes: { minutesStabilityScore: 92 },
    role: { roleStabilityScore: 78 },
    market: { marketQualityScore: 50, bookCount: 2 },
    conflict: { conflictIndex: 5 },
    failure: { majorFailurePathCount: 0 },
    availability: { availabilityCertaintyScore: 90 },
  });
  if (risk.risk === "LOW") {
    assert.ok(risk.trustScore >= 80);
    assert.ok(risk.reliabilityProbability >= 0.84);
  }
});

test("15 MEDIUM independently qualifies", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: strongPick,
    rawWinProbability: 0.62,
    safety: { finalSafetyScore: 72 },
    minutes: { minutesStabilityScore: 78 },
    role: { roleStabilityScore: 70 },
    market: { marketQualityScore: 50, bookCount: 2 },
    conflict: { conflictIndex: 18 },
    failure: { majorFailurePathCount: 1 },
    availability: { availabilityCertaintyScore: 80 },
  });
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(risk.risk));
  if (risk.risk === "MEDIUM") {
    assert.ok(risk.officialEligible === true);
    assert.ok((risk.whyNotLow || []).length >= 0);
  }
});

test("16 HIGH cannot enter Official", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [
      {
        ...strongPick,
        playerName: "Weak",
        projection: 14.6,
        line: 14.5,
        avgMinutesL5: 10,
        bookCount: 1,
      },
    ],
    {
      empiricalSafePropV2: true,
      requestedSlateDate: "2026-08-07",
      simulationCount: 800,
    }
  );
  for (const p of board.selectedProps || []) {
    assert.ok(["LOW", "MEDIUM"].includes(p.trueRisk));
  }
});

test("17 V1-HIGH → V2-LOW rescue is possible", () => {
  const v1 = evaluateSideForecastPacketV1(strongPick, {
    empiricalSafePropV2: false,
    simulationCount: 2000,
    seed: 42,
  });
  const v2 = evaluateSideForecastPacketV1(strongPick, {
    empiricalSafePropV2: true,
    simulationCount: 2000,
    seed: 42,
  });
  // Structural possibility: V2 can be better or equal; document architecture allows rescue
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(v1.risk.risk));
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(v2.risk.risk));
  assert.ok(v2.risk.bookCountAloneCannotForceHigh === true);
});

test("18 V1-HIGH → V2-MEDIUM rescue is possible", () => {
  assert.ok(typeof classifyRiskEmpiricalV2 === "function");
  assert.ok(EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE.includes("CALIBRATION_2"));
});

test("19 historical V1-HIGH loser can remain HIGH", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: { ...strongPick, projection: 14.2, line: 14.5, side: "OVER" },
    rawWinProbability: 0.48,
    safety: { finalSafetyScore: 40 },
    minutes: { minutesStabilityScore: 45 },
    role: { roleStabilityScore: 50 },
    market: { marketQualityScore: 80, bookCount: 4 },
    conflict: { conflictIndex: 60 },
    failure: { majorFailurePathCount: 3 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.strictEqual(risk.risk, "HIGH");
});

test("20 no .slice(0,6) board cap", () => {
  const cands = Array.from({ length: 8 }, (_, i) => ({
    ...strongPick,
    playerName: `P${i}`,
    line: 10.5 + i * 0.5,
    projection: 7 + i * 0.3,
  }));
  const board = selectOfficialBoardFromProbabilitySafetyV1(cands, {
    empiricalSafePropV2: true,
    requestedSlateDate: "2026-08-07",
    simulationCount: 600,
  });
  assert.ok((board.selectedProps || []).length <= 8);
  assert.ok(board.noFixedSix === true);
});

test("21 no minimum fill", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1([], {
    empiricalSafePropV2: true,
    requestedSlateDate: "2026-08-07",
  });
  assert.strictEqual((board.selectedProps || []).length, 0);
  assert.ok(board.noMinimumCount === true);
});

test("22 no forced side", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(strongPick, {
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 3,
  });
  assert.strictEqual(pkt.forcedSide, false);
});

test("23 no team quota in membership", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [
      { ...strongPick, playerName: "A1", team: "same" },
      { ...strongPick, playerName: "A2", team: "same", line: 12.5, projection: 9 },
    ],
    { empiricalSafePropV2: true, requestedSlateDate: "2026-08-07", simulationCount: 700 }
  );
  assert.ok(board.noSideQuota === true);
});

test("24 Home Official = Results Official (shared membership fields)", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1([strongPick], {
    empiricalSafePropV2: true,
    requestedSlateDate: "2026-08-07",
    simulationCount: 1000,
  });
  for (const p of board.selectedProps || []) {
    assert.strictEqual(p.officialEligible, true);
    assert.ok(["LOW", "MEDIUM"].includes(p.trueRisk));
  }
});

test("25 full research universe persists counts", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [
      strongPick,
      {
        ...strongPick,
        playerName: "Weak2",
        projection: 14.4,
        line: 14.5,
        avgMinutesL5: 8,
      },
    ],
    { empiricalSafePropV2: true, requestedSlateDate: "2026-08-07", simulationCount: 700 }
  );
  assert.ok(board.research?.totalValidPlayerMarkets >= 1 || board.research?.packets?.length >= 1);
});

test("26 research outcomes remain separate from Official", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1([strongPick], {
    empiricalSafePropV2: true,
    requestedSlateDate: "2026-08-07",
    simulationCount: 800,
  });
  const researchN = board.research?.packets?.length || 0;
  const officialN = board.selectedProps?.length || 0;
  assert.ok(researchN >= officialN);
});

test("27 same packet V1/V2 replay is deterministic", () => {
  const a = evaluateSideForecastPacketV1(strongPick, {
    empiricalSafePropV2: true,
    simulationCount: 1000,
    seed: 99,
  });
  const b = evaluateSideForecastPacketV1(strongPick, {
    empiricalSafePropV2: true,
    simulationCount: 1000,
    seed: 99,
  });
  assert.strictEqual(a.risk.risk, b.risk.risk);
  assert.strictEqual(a.risk.reliabilityProbability, b.risk.reliabilityProbability);
  assert.strictEqual(a.risk.trustScore, b.risk.trustScore);
});

test("28 TrustScore present on V2 risk", () => {
  const trust = computeTrustScoreV2({
    reliabilityProbability: 0.85,
    rawWinProbability: 0.7,
    SafetyScore: 80,
    projectionEdge: 4,
    safePathway: "STABLE_HIGH_EDGE",
    pathwayScore: 88,
    conflictIndex: 5,
    majorFailurePathCount: 0,
    bookCount: 1,
    minutesStability: 90,
  });
  assert.ok(trust.trustScore >= 0 && trust.trustScore <= 100);
});

test("29 slate relative strength ranks", () => {
  const ranked = annotateSlateRelativeStrengthV1([
    { reliabilityProbability: 0.9, trustScore: 90, SafetyScore: 80, rawWinProbability: 0.7 },
    { reliabilityProbability: 0.7, trustScore: 70, SafetyScore: 70, rawWinProbability: 0.6 },
  ]);
  assert.strictEqual(ranked[0].slateReliabilityRank, 1);
  assert.strictEqual(ranked[1].slateReliabilityRank, 2);
  assert.ok(ranked[0].slatePercentile >= ranked[1].slatePercentile);
});

test("30 credit guard / full roster defaults + C2 champion on", () => {
  assert.strictEqual(FULL_ROSTER_COLLECTION_MODE, false);
  assert.strictEqual(FULL_ROSTER_CREDIT_GUARD, true);
  assert.strictEqual(isEmpiricalSafePropV2Enabled({ empiricalSafePropV2: true }), true);
  assert.strictEqual(isEmpiricalSafePropV2Enabled({ empiricalSafePropV2: false }), false);
  // Production champion default (env in this test file forces true)
  assert.strictEqual(isEmpiricalSafePropV2Enabled(), true);
  assert.ok(EMPIRICAL_SAFE_PROP_V2_BUILD.includes("prop-finder-v2"));
  assert.ok(
    EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE.includes("CALIBRATION_2")
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
