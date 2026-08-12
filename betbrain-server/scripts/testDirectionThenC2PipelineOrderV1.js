/**
 * Direction → selected side → C2 risk order (control-plane V1).
 */
import assert from "assert";
import {
  buildCanonicalPlayerForecastPacketV1,
  chooseSaferC2SideV1,
  evaluateSideForecastPacketV1,
  selectOfficialBoardFromProbabilitySafetyV1,
} from "../engines/probabilitySafetyV1/canonicalPlayerForecastPacketV1.js";

let passed = 0;
let failed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log("PASS", name);
  } catch (err) {
    failed += 1;
    console.error("FAIL", name, err.message || err);
  }
}

const strongUnder = {
  playerName: "Direction First Under",
  playerId: "df-under-1",
  eventId: "evt-df-1",
  team: "SEA",
  opponent: "LAS",
  slateDate: "2026-08-10",
  side: "UNDER",
  pick: "UNDER",
  line: 18.5,
  projection: 13.5,
  fairLine: 14.0,
  bookCount: 3,
  marketQualityScore: 70,
  availabilityStatus: "ACTIVE",
  expectedMinutes: 30,
  roleStabilityScore: 75,
  minutesStabilityScore: 85,
};

const weakBothSides = {
  playerName: "Weak Edge Both",
  playerId: "df-weak-1",
  eventId: "evt-df-2",
  team: "CHI",
  opponent: "NYL",
  slateDate: "2026-08-10",
  line: 14.5,
  projection: 15.0,
  fairLine: 14.8,
  bookCount: 4,
  marketQualityScore: 80,
  availabilityStatus: "ACTIVE",
  expectedMinutes: 28,
  roleStabilityScore: 70,
  minutesStabilityScore: 80,
};

test("1 pipelineOrder is INTEGRITY_DIRECTION_C2_SAFEST_2_TO_6", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(strongUnder, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 11,
  });
  assert.strictEqual(
    pkt.membership.pipelineOrder,
    "INTEGRITY_DIRECTION_C2_SAFEST_2_TO_6"
  );
  assert.strictEqual(pkt.membership.requiresDirectionApproval, false);
});

test("2 opposite side does not receive C2 membership", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(strongUnder, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 12,
  });
  assert.ok(pkt.selectedSide === "OVER" || pkt.selectedSide === "UNDER");
  const opposite =
    pkt.selectedSide === "OVER" ? pkt.underPacket : pkt.overPacket;
  assert.strictEqual(opposite.risk?.risk, "NOT_SELECTED");
});

test("3 selected side C2 is POST_DIRECTION", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(strongUnder, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 13,
  });
  const selected =
    pkt.selectedSide === "OVER" ? pkt.overPacket : pkt.underPacket;
  assert.strictEqual(selected.risk?.membershipStage, "POST_DIRECTION");
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(selected.risk?.risk));
});

test("4 NO_BET research still BEST_GUESS boardCandidate", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(weakBothSides, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 14,
  });
  assert.strictEqual(pkt.direction?.researchDecision, "NO_BET");
  assert.ok(pkt.selectedSide === "OVER" || pkt.selectedSide === "UNDER");
  assert.strictEqual(pkt.membership.directionAdmission, "BEST_GUESS");
  assert.strictEqual(pkt.membership.boardCandidate, true);
  assert.strictEqual(pkt.membership.officialSelected, false);
  assert.strictEqual(pkt.c2MembershipAppliedTo, "BOTH_THEN_SAFER_SIDE");
  assert.ok(
    String(pkt.direction?.reason || "").startsWith("BEST_GUESS_DUAL_C2_")
  );
  assert.strictEqual(pkt.direction?.dualC2SaferSide, true);
});

test("4b dual-C2 helper prefers safer risk tier", () => {
  const pick = chooseSaferC2SideV1({
    overPacket: {
      risk: { risk: "HIGH", reliabilityProbability: 0.9 },
      reliabilityProbability: 0.9,
      safety: { finalSafetyScore: 80 },
    },
    underPacket: {
      risk: { risk: "MEDIUM", reliabilityProbability: 0.4 },
      reliabilityProbability: 0.4,
      safety: { finalSafetyScore: 50 },
    },
    overScore: 0.9,
    underScore: 0.2,
  });
  assert.strictEqual(pick.selectedSide, "UNDER");
  assert.strictEqual(pick.reason, "BEST_GUESS_DUAL_C2_SAFER_TIER");
});

test("4c dual-C2 helper uses reliability when tiers tie", () => {
  const pick = chooseSaferC2SideV1({
    overPacket: {
      risk: { risk: "MEDIUM", reliabilityProbability: 0.55 },
      reliabilityProbability: 0.55,
      safety: { finalSafetyScore: 60 },
    },
    underPacket: {
      risk: { risk: "MEDIUM", reliabilityProbability: 0.8 },
      reliabilityProbability: 0.8,
      safety: { finalSafetyScore: 60 },
    },
    overScore: 0.7,
    underScore: 0.3,
  });
  assert.strictEqual(pick.selectedSide, "UNDER");
  assert.strictEqual(pick.reason, "BEST_GUESS_DUAL_C2_SAFER_RANK");
});

test("5 Official board uses SAFEST_2_TO_6 selector", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [strongUnder, weakBothSides],
    {
      empiricalDirectionV1: true,
      empiricalSafePropV2: true,
      requestedSlateDate: "2026-08-10",
      simulationCount: 700,
    }
  );
  assert.strictEqual(board.boardSizePolicy, "SAFEST_2_TO_6");
  assert.ok(board.officialCount >= 2);
  assert.ok(board.officialCount <= 6);
  for (const p of board.selectedProps || []) {
    assert.strictEqual(p.officialSelected, true);
    assert.ok(p.side === "OVER" || p.side === "UNDER");
  }
});

test("6 deferred side eval awaits Direction", () => {
  const side = evaluateSideForecastPacketV1(
    { ...strongUnder, side: "UNDER", pick: "UNDER" },
    {
      empiricalDirectionV1: true,
      empiricalSafePropV2: true,
      applyRiskClassification: false,
      simulationCount: 500,
      seed: 16,
    }
  );
  assert.strictEqual(side.risk?.deferred, true);
  assert.strictEqual(side.risk?.membershipStage, "AWAITING_DIRECTION");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
