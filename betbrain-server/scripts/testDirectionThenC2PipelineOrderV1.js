/**
 * Direction → selected side → C2 membership order.
 * Does not retune O2.5 / U4 or C2 thresholds.
 */
import assert from "assert";
import {
  buildCanonicalPlayerForecastPacketV1,
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
  projection: 13.5, // UNDER edge = 5.0
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
  projection: 15.0, // OVER edge 0.5 / UNDER edge -0.5
  fairLine: 14.8,
  bookCount: 4,
  marketQualityScore: 80,
  availabilityStatus: "ACTIVE",
  expectedMinutes: 28,
  roleStabilityScore: 70,
  minutesStabilityScore: 80,
};

test("1 pipelineOrder is DIRECTION_THEN_C2 when Direction on", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(strongUnder, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 11,
  });
  assert.strictEqual(pkt.pipelineOrder, "DIRECTION_THEN_C2");
  assert.strictEqual(pkt.membership.pipelineOrder, "DIRECTION_THEN_C2");
  assert.strictEqual(pkt.membership.requiresDirectionApproval, true);
});

test("2 opposite side does not receive C2 LOW/MEDIUM membership", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(strongUnder, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 12,
  });
  assert.ok(
    pkt.direction?.decision === "OVER" || pkt.direction?.decision === "UNDER"
  );
  const opposite =
    pkt.selectedSide === "OVER" ? pkt.underPacket : pkt.overPacket;
  assert.strictEqual(opposite.risk?.risk, "NOT_SELECTED");
  assert.strictEqual(opposite.risk?.officialEligible, false);
  assert.ok(
    (opposite.risk?.reasons || []).includes(
      "OPPOSITE_SIDE_NOT_SELECTED_AFTER_DIRECTION"
    )
  );
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
  assert.strictEqual(selected.risk?.membershipStageApplied, true);
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(selected.risk?.risk));
});

test("4 Direction NO_BET never Official even if C2 would like research side", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(weakBothSides, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 14,
  });
  assert.strictEqual(pkt.direction?.decision, "NO_BET");
  assert.strictEqual(pkt.membership.officialEligible, false);
  assert.strictEqual(pkt.risk.officialEligible, false);
  assert.strictEqual(pkt.membership.blockedByDirectionNoBet, true);
});

test("5 Official board hardens Direction approval", () => {
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [strongUnder, weakBothSides],
    {
      empiricalDirectionV1: true,
      empiricalSafePropV2: true,
      requestedSlateDate: "2026-08-10",
      simulationCount: 700,
    }
  );
  for (const p of board.selectedProps || []) {
    assert.ok(p.officialEligible === true);
    assert.ok(p.directionDecision === "OVER" || p.directionDecision === "UNDER");
    assert.ok(p.blockedByDirectionNoBet !== true);
    assert.ok(["LOW", "MEDIUM"].includes(p.trueRisk));
  }
  // Weak both-sides must not appear Official
  assert.ok(
    !(board.selectedProps || []).some((p) => p.playerName === "Weak Edge Both")
  );
});

test("6 deferred side eval exposes reliability feature without risk band", () => {
  const side = evaluateSideForecastPacketV1(
    { ...strongUnder, side: "UNDER", pick: "UNDER" },
    {
      empiricalSafePropV2: true,
      applyRiskClassification: false,
      simulationCount: 600,
      seed: 15,
    }
  );
  assert.strictEqual(side.risk?.deferred, true);
  assert.strictEqual(side.risk?.risk, null);
  assert.strictEqual(side.risk?.officialEligible, false);
  assert.ok(typeof side.reliabilityProbability === "number");
});

test("7 Direction off keeps legacy dual-C2 path marker", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(strongUnder, {
    empiricalDirectionV1: false,
    empiricalSafePropV2: true,
    simulationCount: 600,
    seed: 16,
  });
  assert.strictEqual(pkt.pipelineOrder, "LEGACY_DUAL_C2_THEN_SCORE");
  assert.strictEqual(pkt.c2MembershipAppliedTo, "BOTH");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
