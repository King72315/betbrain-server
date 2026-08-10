/**
 * Direction → selected side → C2 membership order.
 * Product policy: NO BET still picks a side (BEST_GUESS); Official = safest 2–6.
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

function makeCandidate(i, edgeBoost = 0) {
  return {
    playerName: `Pool Player ${i}`,
    playerId: `pool-${i}`,
    eventId: `evt-pool-${i}`,
    team: "ATL",
    opponent: "TOR",
    slateDate: "2026-08-10",
    line: 12.5 + (i % 5),
    projection: 12.5 + (i % 5) + 0.4 + edgeBoost,
    fairLine: 12.5 + (i % 5) + 0.2 + edgeBoost * 0.5,
    bookCount: 3,
    marketQualityScore: 70,
    availabilityStatus: "ACTIVE",
    expectedMinutes: 26 + (i % 4),
    roleStabilityScore: 65 + (i % 10),
    minutesStabilityScore: 70 + (i % 10),
  };
}

test("1 pipelineOrder is DIRECTION_THEN_C2 when Direction on", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(strongUnder, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 11,
  });
  assert.strictEqual(pkt.pipelineOrder, "DIRECTION_THEN_C2");
  assert.strictEqual(pkt.membership.pipelineOrder, "DIRECTION_THEN_C2");
  // Default product policy: Direction does not close Official.
  assert.strictEqual(pkt.membership.requiresDirectionApproval, false);
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

test("4 Direction NO_BET still picks BEST_GUESS side and stays Official-eligible", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(weakBothSides, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 800,
    seed: 14,
  });
  assert.strictEqual(pkt.direction?.decision, "NO_BET");
  assert.ok(pkt.selectedSide === "OVER" || pkt.selectedSide === "UNDER");
  assert.strictEqual(pkt.membership.directionAdmission, "BEST_GUESS");
  assert.strictEqual(pkt.membership.educatedGuess, true);
  assert.strictEqual(pkt.membership.officialEligible, true);
  assert.strictEqual(pkt.membership.blockedByDirectionNoBet, false);
});

test("4b closed-gate env restores NO_BET Official block", () => {
  const pkt = buildCanonicalPlayerForecastPacketV1(weakBothSides, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    directionNoBetBlocksOfficial: true,
    simulationCount: 800,
    seed: 15,
  });
  assert.strictEqual(pkt.direction?.decision, "NO_BET");
  assert.strictEqual(pkt.membership.officialEligible, false);
  assert.strictEqual(pkt.membership.blockedByDirectionNoBet, true);
  assert.strictEqual(pkt.membership.requiresDirectionApproval, true);
});

test("5 Official board keeps safest top N (2–6) including educated guesses", () => {
  const pool = [
    strongUnder,
    weakBothSides,
    ...Array.from({ length: 8 }, (_, i) => makeCandidate(i, 0.1)),
  ];
  const board = selectOfficialBoardFromProbabilitySafetyV1(pool, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    requestedSlateDate: "2026-08-10",
    simulationCount: 700,
    officialBoardMin: 2,
    officialBoardMax: 6,
  });
  const selected = board.selectedProps || [];
  assert.ok(selected.length >= 2, `expected >=2 got ${selected.length}`);
  assert.ok(selected.length <= 6, `expected <=6 got ${selected.length}`);
  assert.strictEqual(board.boardSizePolicy, "SAFEST_TOP_N_EDUCATED_GUESS");
  for (const p of selected) {
    assert.ok(p.officialEligible === true);
    assert.ok(p.blockedByDirectionNoBet !== true);
    assert.ok(
      p.directionAdmission === "PRIMARY" ||
        p.directionAdmission === "BEST_GUESS" ||
        p.directionAdmission === "SCORE_SIDE"
    );
    assert.ok(p.side === "OVER" || p.side === "UNDER");
  }
});

test("6 deferred side eval exposes reliability feature without risk band", () => {
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
  assert.ok(
    side.reliabilityProbability == null ||
      Number.isFinite(side.reliabilityProbability)
  );
  assert.strictEqual(side.risk?.deferred, true);
  assert.strictEqual(side.risk?.membershipStage, "AWAITING_DIRECTION");
  assert.strictEqual(side.risk?.risk, null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
