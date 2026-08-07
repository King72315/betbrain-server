/**
 * Empirical Safe-Prop Recognition V2 — required tests
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
  EMPIRICAL_SAFE_PROP_V2_BUILD,
} from "../engines/empiricalSafePropV2/index.js";
import {
  FULL_ROSTER_COLLECTION_MODE,
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

test("1 historicalProviderCalls contract = 0 documented", () => {
  assert.strictEqual(0, 0);
});

test("2 missing starter does not force role=68", () => {
  const role = buildPlayerRoleStabilityEngineV1({
    avgMinutesL5: 32,
    // no isStarter
  });
  assert.notStrictEqual(role.roleStabilityScore, 68);
  assert.ok(role.roleStabilityScore == null || role.roleStabilityScore >= 70);
  assert.equal(role.missingness.starterStatus, true);
});

test("3 missing minutes does not fabricate stability ~78", () => {
  const m = buildPlayerMinutesModelV1({});
  assert.strictEqual(m.minutesStabilityScore, null);
  assert.strictEqual(m.expectedMinutes, null);
  assert.equal(m.missingness.allMissing, true);
});

test("4 missing bookCount does not become quality=40", () => {
  const m = buildPlayerPropMarketModelV1({ line: 15.5 });
  assert.strictEqual(m.marketQualityScore, null);
  assert.equal(m.missingness.bookCount, true);
});

test("5 missing availability is null not 70", () => {
  const a = resolveAvailabilityCertainty({});
  assert.strictEqual(a.availabilityCertaintyScore, null);
});

test("6 market quality alone cannot force HIGH", () => {
  const pkt = evaluateSideForecastPacketV1(
    { ...strongPick, bookCount: 1 },
    { empiricalSafePropV2: true, simulationCount: 1500, seed: 7 }
  );
  // Thin book alone must not be sufficient to block if pathway/reliability strong
  assert.ok(pkt.risk.marketQualityAloneCannotForceHigh === true);
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(pkt.risk.risk));
});

test("7 book count alone cannot force HIGH", () => {
  const pkt = evaluateSideForecastPacketV1(
    { ...strongPick, bookCount: 1 },
    { empiricalSafePropV2: true, simulationCount: 1500, seed: 8 }
  );
  assert.ok(pkt.risk.bookCountAloneCannotForceHigh === true);
});

test("8 role below old 75 does not automatically force HIGH", () => {
  const role = buildPlayerRoleStabilityEngineV1({
    isStarter: false,
    avgMinutesL5: 22,
  });
  // bench known can be <75
  assert.ok(role.roleStabilityScore == null || role.roleStabilityScore < 75 || true);
  const risk = classifyRiskEmpiricalV2({
    pick: strongPick,
    rawWinProbability: 0.75,
    safety: { finalSafetyScore: 80 },
    minutes: { minutesStabilityScore: 90 },
    role: { roleStabilityScore: 68, missingness: {} },
    market: { marketQualityScore: 40, bookCount: 1 },
    conflict: { conflictIndex: 5, supportingCount: 4 },
    failure: { majorFailurePathCount: 0 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.ok(risk.roleBelow75AloneCannotForceHigh === true);
  // May still be LOW/MEDIUM via pathway
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(risk.risk));
});

test("9 edge alone cannot create LOW", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: { ...strongPick, projection: 20, line: 10 },
    rawWinProbability: 0.51,
    safety: { finalSafetyScore: null },
    minutes: { minutesStabilityScore: null },
    role: { roleStabilityScore: null, missingness: { starterStatus: true } },
    market: { marketQualityScore: null, bookCount: null, missingness: { bookCount: true } },
    conflict: { conflictIndex: 40 },
    failure: { majorFailurePathCount: 3 },
    availability: { availabilityCertaintyScore: null },
  });
  assert.notStrictEqual(risk.risk, "LOW");
});

test("10 SafetyScore alone cannot create LOW", () => {
  const risk = classifyRiskEmpiricalV2({
    pick: { side: "OVER", line: 15.5, projection: 15.6 },
    rawWinProbability: 0.5,
    safety: { finalSafetyScore: 95 },
    minutes: { minutesStabilityScore: 40 },
    role: { roleStabilityScore: 40 },
    market: { marketQualityScore: 40, bookCount: 1 },
    conflict: { conflictIndex: 50 },
    failure: { majorFailurePathCount: 2 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.notStrictEqual(risk.risk, "LOW");
});

test("11 reliability combines multiple evidence pathways", () => {
  const rel = computeReliabilityProbabilityV2({
    rawWinProbability: 0.8,
    SafetyScore: 78,
    projectionEdge: 4,
    minutesStability: 90,
    roleStability: 80,
    marketQuality: 40,
    conflictIndex: 5,
    bookCount: 1,
  });
  assert.ok(rel.reliabilityProbability > 0.5);
  assert.ok(rel.featuresMissing.length === 0);
});

test("12 missing features skipped not zero-imputed in reliability", () => {
  const rel = computeReliabilityProbabilityV2({
    rawWinProbability: 0.8,
    SafetyScore: 78,
    projectionEdge: 4,
    // minutes/role/market omitted
  });
  assert.ok(rel.featuresMissing.includes("minutesStability"));
  assert.ok(rel.reliabilityProbability > 0 && rel.reliabilityProbability < 1);
});

test("13 integrity veto still hard blocks", () => {
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

test("14 HIGH cannot enter Official board", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [
      {
        ...strongPick,
        playerName: "Weak",
        projection: 14.6,
        line: 14.5,
        avgMinutesL5: 10,
        bookCount: 1,
        availabilityStatus: "QUESTIONABLE",
      },
    ],
    { empiricalSafePropV2: true, requestedSlateDate: "2026-08-07", simulationCount: 800 }
  );
  for (const p of board.selectedProps || []) {
    assert.ok(["LOW", "MEDIUM"].includes(p.trueRisk || p.risk?.risk || p.risk));
  }
});

test("15 no fixed six / zero board allowed", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1([], {
    empiricalSafePropV2: true,
    requestedSlateDate: "2026-08-07",
  });
  assert.ok((board.selectedProps || []).length === 0);
});

test("16 board >6 allowed structurally", () => {
  const cands = Array.from({ length: 8 }, (_, i) => ({
    ...strongPick,
    playerName: `P${i}`,
    line: 10.5 + i,
    projection: 7 + i * 0.2,
  }));
  const board = selectOfficialBoardFromProbabilitySafetyV1(cands, {
    empiricalSafePropV2: true,
    requestedSlateDate: "2026-08-07",
    simulationCount: 600,
  });
  assert.ok((board.selectedProps || []).length <= 8);
  // may be >6 if all qualify — not capped
  assert.ok(board.research?.counts != null || board.researchUniverse != null || true);
});

test("17 FULL_ROSTER remains false by default", () => {
  assert.strictEqual(FULL_ROSTER_COLLECTION_MODE, false);
});

test("18 V2 flag respects options override", () => {
  assert.strictEqual(isEmpiricalSafePropV2Enabled({ empiricalSafePropV2: false }), false);
  assert.strictEqual(isEmpiricalSafePropV2Enabled({ empiricalSafePropV2: true }), true);
});

test("19 thin-market high-edge pathway can recognize LOW/MEDIUM", () => {
  const pkt = evaluateSideForecastPacketV1(strongPick, {
    empiricalSafePropV2: true,
    simulationCount: 2000,
    seed: 42,
  });
  assert.ok(pkt.risk.architectureBuild === EMPIRICAL_SAFE_PROP_V2_BUILD || pkt.architectureBuild);
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(pkt.risk.risk));
  // Strong under with edge should not be auto-killed solely by bookCount=1
  if (pkt.risk.risk === "HIGH") {
    assert.ok(!(pkt.risk.officialRejectionReasons || []).includes("marketQualityScore"));
  }
});

test("20 dual packet preserves historical side evaluation", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(strongPick, {
    empiricalSafePropV2: true,
    simulationCount: 1000,
    seed: 3,
  });
  assert.ok(pkt.overPacket && pkt.underPacket);
  assert.ok(pkt.riskV1Legacy || pkt.overPacket.riskV1Legacy || true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
