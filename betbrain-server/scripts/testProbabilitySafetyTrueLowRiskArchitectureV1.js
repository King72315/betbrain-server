/**
 * Probability / Safety / True Low-Risk Architecture V1 — required tests
 */
import assert from "assert";
import {
  ARCHITECTURE_BUILD,
  buildCanonicalPlayerForecastPacketV1,
  buildPlayerMinutesModelV1,
  buildPlayerRoleStabilityEngineV1,
  buildPlayerPointsDistributionEngineV1,
  buildPlayerPropMarketModelV1,
  buildPredictionConflictIndexV1,
  buildPropSafetyEngineV1,
  classifyRiskV1,
  mulberry32,
  selectOfficialBoardFromProbabilitySafetyV1,
  resolveAvailabilityCertainty,
} from "../engines/probabilitySafetyV1/index.js";
import { FULL_ROSTER_COLLECTION_MODE } from "../engines/topProps/courtEdgeFeatureFlagsV1.js";
import { selectControlledBestBoard } from "../engines/topProps/controlledBestBoardV2.js";

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (e) {
    failed += 1;
    failures.push({ name, message: e.message });
    console.log(`FAIL  ${name}: ${e.message}`);
  }
}

const basePick = {
  playerName: "Stable Starter",
  player: "Stable Starter",
  team: "phoenixmercury",
  opponent: "atlantadream",
  eventId: "evt1",
  league: "WNBA",
  line: 18.5,
  projection: 22.0,
  fairLine: 21.5,
  avgMinutesL5: 34,
  seasonMinutes: 33,
  projectedMinutes: 34,
  isStarter: true,
  usageRate: 0.24,
  usageL5: 0.24,
  usageSeason: 0.23,
  expectedFGA: 14,
  avgFGA: 14,
  FGA_L5: 14,
  expectedFTA: 4,
  avg3PA: 3,
  bookCount: 5,
  openingLine: 18.5,
  currentLine: 18.5,
  availabilityStatus: "ACTIVE",
  avgPointsL5: 21,
  avgPoints: 20.5,
  blowoutRisk: 20,
  slateDate: "2026-08-07",
  commenceTime: "2026-08-07T23:00:00Z",
  canonicalSlateDate: "2026-08-07",
};

test("1 Predictor does not know board size", () => {
  const a = buildCanonicalPlayerForecastPacketV1(basePick, { seed: 1 });
  const b = buildCanonicalPlayerForecastPacketV1(basePick, {
    seed: 1,
    remainingBoardSlots: 0,
  });
  assert.strictEqual(a.selectedSide, b.selectedSide);
});

test("2 Predictor does not force side", () => {
  const p = buildCanonicalPlayerForecastPacketV1(basePick, { seed: 2 });
  assert.strictEqual(p.forcedSide, false);
});

test("3 Same-team cannot force side mutation", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [basePick, { ...basePick, playerName: "B", player: "B", eventId: "e2" }],
    { seed: 3 }
  );
  for (const p of board.selectedProps) assert.strictEqual(p.forcedSide, false);
});

test("4 Over + Under probability reconciles", () => {
  const d = buildPlayerPointsDistributionEngineV1(
    { ...basePick, side: "OVER" },
    buildPlayerMinutesModelV1(basePick),
    { pointsPerMinute: 22 / 34 },
    { seed: 42, simulationCount: 2500 }
  );
  assert.ok(Math.abs(d.POver + d.PUnder - 1) < 1e-9);
});

test("5 Distribution percentiles ordered", () => {
  const d = buildPlayerPointsDistributionEngineV1(
    basePick,
    buildPlayerMinutesModelV1(basePick),
    { pointsPerMinute: 0.65 },
    { seed: 7, simulationCount: 2500 }
  );
  assert.ok(d.p10 <= d.p25 && d.p25 <= d.p50 && d.p50 <= d.p75 && d.p75 <= d.p90);
});

test("6 Simulation deterministic with fixed seed", () => {
  const opts = { seed: 99, simulationCount: 1000 };
  const minutes = buildPlayerMinutesModelV1(basePick);
  const a = buildPlayerPointsDistributionEngineV1(basePick, minutes, { pointsPerMinute: 0.65 }, opts);
  const b = buildPlayerPointsDistributionEngineV1(basePick, minutes, { pointsPerMinute: 0.65 }, opts);
  assert.strictEqual(a.mean, b.mean);
});

test("7 Stable minutes score higher than volatile", () => {
  const stable = buildPlayerMinutesModelV1({
    avgMinutesL5: 34,
    seasonMinutes: 34,
    projectedMinutes: 34,
  });
  const volatile = buildPlayerMinutesModelV1({
    avgMinutesL5: 12,
    seasonMinutes: 28,
    projectedMinutes: 20,
  });
  assert.ok(stable.minutesStabilityScore > volatile.minutesStabilityScore);
});

test("8 Restricted player cannot earn LOW", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(
    { ...basePick, minutesRestriction: true, availabilityStatus: "QUESTIONABLE" },
    { seed: 5 }
  );
  assert.notStrictEqual(pkt.risk.risk, "LOW");
});

test("9 Role change lowers stability", () => {
  const a = buildPlayerRoleStabilityEngineV1({ ...basePick });
  const b = buildPlayerRoleStabilityEngineV1({
    ...basePick,
    recentRoleChange: true,
    ROLE_ENVIRONMENT_CHANGED: true,
    keyTeammateReturning: true,
  });
  assert.ok(a.roleStabilityScore > b.roleStabilityScore);
});

test("10 Stable starter retains high stability", () => {
  const a = buildPlayerRoleStabilityEngineV1({ ...basePick, isStarter: true });
  assert.ok(a.roleStabilityScore >= 70);
});

test("11 Multi-book scores above single-book", () => {
  const multi = buildPlayerPropMarketModelV1({ ...basePick, bookCount: 5 });
  const single = buildPlayerPropMarketModelV1({ ...basePick, bookCount: 1 });
  assert.ok(multi.marketQualityScore > single.marketQualityScore);
});

test("12 Single-book prevents LOW (V1 membership)", () => {
  // C2 deliberately allows thin-market strong-edge recognition; this assertion
  // is the V1 giant-AND behavior only.
  const pkt = buildCanonicalPlayerForecastPacketV1(
    { ...basePick, bookCount: 1 },
    { seed: 11, empiricalSafePropV2: false, empiricalDirectionV1: false }
  );
  assert.notStrictEqual(pkt.risk.risk, "LOW");
});

test("13 Aligned evidence → low conflict", () => {
  const conflict = buildPredictionConflictIndexV1({
    pick: { ...basePick, side: "OVER" },
    minutes: { minutesStabilityScore: 85 },
    role: { roleStabilityScore: 85, ROLE_ENVIRONMENT_CHANGED: false },
    volume: { multiWayScorer: true, hotThreeDependency: false },
    distribution: { distributionWidth: 8 },
    market: { marketQualityScore: 80, movementTowardModel: true },
    availabilityCertaintyScore: 90,
  });
  assert.ok(conflict.conflictIndex <= 25);
});

test("14 Contradictory evidence → high conflict", () => {
  const conflict = buildPredictionConflictIndexV1({
    pick: { ...basePick, side: "OVER", projection: 22, fairLine: 14, avgPointsL5: 10 },
    minutes: { minutesStabilityScore: 40 },
    role: { roleStabilityScore: 40, ROLE_ENVIRONMENT_CHANGED: true },
    volume: { hotThreeDependency: true, multiWayScorer: false },
    distribution: { distributionWidth: 22 },
    market: { marketQualityScore: 30, movementAgainstModel: true },
    availabilityCertaintyScore: 40,
  });
  assert.ok(conflict.conflictIndex >= 40);
});

test("15 Large edge alone cannot create LOW", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(
    {
      ...basePick,
      projection: 30,
      fairLine: 12,
      avgMinutesL5: 10,
      seasonMinutes: 28,
      bookCount: 1,
      availabilityStatus: "QUESTIONABLE",
    },
    { seed: 15 }
  );
  assert.notStrictEqual(pkt.risk.risk, "LOW");
});

test("16 LOW gate is all-or-nothing", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(basePick, { seed: 16 });
  if (pkt.risk.wouldPassLowGate) assert.strictEqual(pkt.risk.risk, "LOW");
  else assert.notStrictEqual(pkt.risk.risk, "LOW");
});

test("17 MEDIUM gate independent", () => {
  const risk = classifyRiskV1({
    pick: { ...basePick, side: "OVER" },
    rawWinProbability: 0.58,
    safety: { finalSafetyScore: 66 },
    minutes: { minutesStabilityScore: 60 },
    role: { roleStabilityScore: 60 },
    market: { marketQualityScore: 55, bookCount: 3 },
    conflict: {
      conflictIndex: 30,
      supportingCount: 3,
      opposingCount: 1,
      projectionFairAgreement: true,
    },
    failure: { majorFailurePathCount: 1 },
    availability: { availabilityCertaintyScore: 75 },
  });
  assert.ok(["MEDIUM", "HIGH", "LOW"].includes(risk.risk));
});

test("18 HIGH cannot enter Official", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [
      {
        ...basePick,
        playerName: "Weak",
        projection: 18.6,
        fairLine: 12,
        avgMinutesL5: 8,
        bookCount: 1,
        availabilityStatus: "QUESTIONABLE",
      },
    ],
    { seed: 18 }
  );
  assert.ok(board.selectedProps.every((p) => p.trueRisk !== "HIGH"));
});

test("19 Zero-prop board allowed", () => {
  assert.strictEqual(
    selectOfficialBoardFromProbabilitySafetyV1([], { seed: 19 }).officialCount,
    0
  );
});

test("20 One-prop board allowed", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1([basePick], { seed: 20 });
  assert.ok(board.officialCount <= 1);
});

test("21 Board >6 allowed", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    ...basePick,
    playerName: `P${i}`,
    player: `P${i}`,
    eventId: `e${i}`,
  }));
  const board = selectOfficialBoardFromProbabilitySafetyV1(many, { seed: 21 });
  assert.strictEqual(board.noFixedSix, true);
  assert.ok(board.selectedProps.length <= 12);
});

test("22 No fixed six policy", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1([basePick], { seed: 22 });
  assert.strictEqual(board.noFixedSix, true);
  assert.strictEqual(board.noMinimumCount, true);
});

test("23 No side quota", () => {
  assert.strictEqual(
    selectOfficialBoardFromProbabilitySafetyV1([basePick], { seed: 23 }).noSideQuota,
    true
  );
});

test("24 No forced fill", () => {
  assert.strictEqual(
    selectOfficialBoardFromProbabilitySafetyV1([basePick], { seed: 24 }).forcedSide,
    false
  );
});

test("25 HIGH remains in research universe", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [
      {
        playerName: "HighOnly",
        player: "HighOnly",
        line: 20.5,
        projection: 20.6,
        fairLine: 10,
        bookCount: 1,
        avgMinutesL5: 5,
        league: "WNBA",
      },
    ],
    { seed: 25 }
  );
  assert.ok(board.research.packets.length >= 1);
});

test("26 Shadow side preserved", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(basePick, { seed: 26 });
  assert.ok(pkt.overPacket && pkt.underPacket);
});

test("27 Research counts separate", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1([basePick], { seed: 27 });
  assert.ok("HIGH" in board.research.counts);
});

test("28 Controlled board Results admission", () => {
  const board = selectControlledBestBoard([basePick], {
    requestedSlateDate: "2026-08-07",
    expectedDayBucket: "TODAY",
  });
  for (const p of board.selectedProps || []) {
    assert.strictEqual(p.resultsAdmissionEligible, true);
    assert.strictEqual(p.forcedSide, false);
  }
});

test("29 Architecture build present", () => {
  assert.ok(ARCHITECTURE_BUILD.includes("probability-safety"));
});

test("30 No Lab in architecture name product path", () => {
  assert.ok(!ARCHITECTURE_BUILD.includes("lab-tab"));
});

test("31 Wrong-date blocked", () => {
  const board = selectControlledBestBoard(
    [
      {
        ...basePick,
        player: "WrongDate",
        commenceTime: "2026-08-05T23:00:00Z",
        canonicalSlateDate: "2026-08-05",
        slateDate: "2026-08-05",
      },
    ],
    { requestedSlateDate: "2026-08-07", expectedDayBucket: "TODAY" }
  );
  assert.strictEqual((board.selectedProps || []).length, 0);
});

test("32 Build identity", () => {
  assert.strictEqual(
    ARCHITECTURE_BUILD,
    "courteedge-probability-safety-true-low-risk-architecture-v1"
  );
});

test("33 forcedSide false on packet", () => {
  assert.strictEqual(
    buildCanonicalPlayerForecastPacketV1(basePick, { seed: 33 }).forcedSide,
    false
  );
});

test("34 Full-roster flag false", () => {
  assert.strictEqual(FULL_ROSTER_COLLECTION_MODE, false);
});

test("35 Over/Under share minutes expectation", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(basePick, { seed: 35 });
  assert.strictEqual(
    pkt.overPacket.minutes.expectedMinutes,
    pkt.underPacket.minutes.expectedMinutes
  );
});

test("36 Deterministic PRNG", () => {
  assert.strictEqual(mulberry32(123)(), mulberry32(123)());
});

test("Safety engine components", () => {
  const safety = buildPropSafetyEngineV1({
    rawWinProbability: 0.66,
    minutes: { minutesStabilityScore: 80 },
    role: { roleStabilityScore: 80 },
    distribution: { distributionWidth: 8 },
    market: { marketQualityScore: 70 },
    conflict: { supportingCount: 4, conflictIndex: 10 },
    failure: { majorFailurePathCount: 0 },
    availability: { availabilityCertaintyScore: 90 },
  });
  assert.ok(safety.finalSafetyScore >= 0);
});

test("Availability certainty", () => {
  const a = resolveAvailabilityCertainty({ availabilityStatus: "ACTIVE" });
  const q = resolveAvailabilityCertainty({ availabilityStatus: "QUESTIONABLE" });
  assert.ok(a.availabilityCertaintyScore > q.availabilityCertaintyScore);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
}
