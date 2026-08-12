/**
 * CourtEdge Single Machine / Control-Plane Consolidation V1 tests.
 */
import assert from "assert";
import {
  selectOfficialMembershipV1,
  CONTROL_PLANE_CONTRACT,
  OFFICIAL_BOARD_MAX,
  OFFICIAL_BOARD_MIN,
  HIGH_POLICY,
} from "../engines/courtEdgeControlPlaneV1/index.js";
import {
  buildCanonicalPlayerForecastPacketV1,
  selectOfficialBoardFromProbabilitySafetyV1,
  resolveOfficialDisplayMetaV1,
} from "../engines/probabilitySafetyV1/canonicalPlayerForecastPacketV1.js";
import { isOfficialPick } from "../engines/topProps/topPropSelectionAudit.js";
import { isDirectionNoBetBlockingOfficial } from "../engines/empiricalDirectionV1/featureFlag.js";

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

function pkt(overrides = {}) {
  const {
    risk: riskCode = "MEDIUM",
    rel = 0.7,
    trust = 60,
    edge = 1,
    directionAdmission = "BEST_GUESS",
    directionConfidence = "NONE",
    membership: membershipExtra = {},
    ...rest
  } = overrides;
  return {
    playerName: "P",
    playerId: "id",
    eventId: "evt",
    selectedSide: "UNDER",
    line: 10.5,
    boardCandidate: true,
    membership: {
      boardCandidate: true,
      analysisEligible: true,
      directionAdmission,
      ...membershipExtra,
    },
    direction: {
      decision: rest.selectedSide || "UNDER",
      confidence: directionConfidence,
      directionAdmission,
    },
    risk: { risk: riskCode },
    c2Risk: riskCode,
    reliabilityProbability: rel,
    trustScore: trust,
    overPacket: { projectionEdge: edge },
    underPacket: { projectionEdge: edge },
    ...rest,
  };
}

test("contract hard-codes 2–6 and HIGH fill policy", () => {
  assert.strictEqual(OFFICIAL_BOARD_MIN, 2);
  assert.strictEqual(OFFICIAL_BOARD_MAX, 6);
  assert.strictEqual(HIGH_POLICY, "MINIMUM_2_FILL_ONLY");
  assert.strictEqual(CONTROL_PLANE_CONTRACT.legacyBestSixAuthority, false);
  assert.strictEqual(CONTROL_PLANE_CONTRACT.clientOfficialRebuild, false);
  assert.strictEqual(isDirectionNoBetBlockingOfficial(), false);
});

test("8 LOW/MEDIUM → max 6 Official, no HIGH", () => {
  const pool = Array.from({ length: 8 }, (_, i) =>
    pkt({
      playerName: `LM${i}`,
      playerId: `lm${i}`,
      eventId: `e${i}`,
      risk: i % 2 ? "LOW" : "MEDIUM",
      rel: 0.9 - i * 0.01,
    })
  );
  const out = selectOfficialMembershipV1(pool);
  assert.strictEqual(out.officialCount, 6);
  assert.strictEqual(out.highFillCount, 0);
  assert.ok(out.selectedPackets.every((p) => p.c2Risk !== "HIGH"));
});

test("4 LOW/MEDIUM → 4 Official", () => {
  const pool = Array.from({ length: 4 }, (_, i) =>
    pkt({ playerName: `M${i}`, playerId: `m${i}`, eventId: `e${i}`, risk: "MEDIUM" })
  );
  const out = selectOfficialMembershipV1(pool);
  assert.strictEqual(out.officialCount, 4);
  assert.strictEqual(out.highFillCount, 0);
});

test("1 MEDIUM + HIGH pool → MEDIUM + 1 HIGH", () => {
  const pool = [
    pkt({ playerName: "Med", playerId: "med", risk: "MEDIUM", rel: 0.8 }),
    pkt({ playerName: "H1", playerId: "h1", eventId: "eh1", risk: "HIGH", rel: 0.6 }),
    pkt({ playerName: "H2", playerId: "h2", eventId: "eh2", risk: "HIGH", rel: 0.55 }),
  ];
  const out = selectOfficialMembershipV1(pool);
  assert.strictEqual(out.officialCount, 2);
  assert.strictEqual(out.highFillCount, 1);
  assert.ok(out.selectedPackets.some((p) => p.playerName === "Med"));
  assert.ok(out.selectedPackets.some((p) => p.c2Risk === "HIGH"));
});

test("PRIMARY outranks BEST_GUESS inside same C2 tier", () => {
  const pool = [
    pkt({
      playerName: "Guess",
      playerId: "g1",
      eventId: "eg",
      risk: "MEDIUM",
      rel: 0.95,
      directionAdmission: "BEST_GUESS",
    }),
    pkt({
      playerName: "Primary",
      playerId: "p1",
      eventId: "ep",
      risk: "MEDIUM",
      rel: 0.5,
      directionAdmission: "PRIMARY",
      directionConfidence: "STANDARD",
    }),
  ];
  const out = selectOfficialMembershipV1(pool);
  assert.strictEqual(out.selectedPackets[0].playerName, "Primary");
});

test("HIGH fill prefers PRIMARY over BEST_GUESS", () => {
  const pool = [
    pkt({
      playerName: "Med",
      playerId: "med",
      risk: "MEDIUM",
      rel: 0.8,
      directionAdmission: "BEST_GUESS",
    }),
    pkt({
      playerName: "GuessHigh",
      playerId: "gh",
      eventId: "egh",
      risk: "HIGH",
      rel: 0.99,
      directionAdmission: "BEST_GUESS",
    }),
    pkt({
      playerName: "PrimaryHigh",
      playerId: "ph",
      eventId: "eph",
      risk: "HIGH",
      rel: 0.4,
      directionAdmission: "PRIMARY",
      directionConfidence: "WEAK",
    }),
  ];
  const out = selectOfficialMembershipV1(pool);
  assert.strictEqual(out.officialCount, 2);
  assert.ok(out.selectedPackets.some((p) => p.playerName === "Med"));
  assert.ok(out.selectedPackets.some((p) => p.playerName === "PrimaryHigh"));
  assert.ok(!out.selectedPackets.some((p) => p.playerName === "GuessHigh"));
});

test("all HIGH → safest 2 HIGH only", () => {
  const pool = Array.from({ length: 5 }, (_, i) =>
    pkt({
      playerName: `H${i}`,
      playerId: `h${i}`,
      eventId: `eh${i}`,
      risk: "HIGH",
      rel: 0.5 + i * 0.05,
    })
  );
  const out = selectOfficialMembershipV1(pool);
  assert.strictEqual(out.officialCount, 2);
  assert.strictEqual(out.highFillCount, 2);
  assert.ok(out.selectedPackets.every((p) => p.c2Risk === "HIGH"));
});

test("HIGH cannot outrank available LOW/MEDIUM", () => {
  const pool = [
    pkt({ playerName: "Low", playerId: "low", risk: "LOW", rel: 0.5 }),
    pkt({ playerName: "Med", playerId: "med", eventId: "em", risk: "MEDIUM", rel: 0.5 }),
    pkt({ playerName: "HighElite", playerId: "hi", eventId: "eh", risk: "HIGH", rel: 0.99 }),
  ];
  const out = selectOfficialMembershipV1(pool);
  assert.strictEqual(out.officialCount, 2);
  assert.ok(!out.selectedPackets.some((p) => p.playerName === "HighElite"));
  assert.strictEqual(out.highFillCount, 0);
});

test("only 1 valid market → thin slate of 1", () => {
  const out = selectOfficialMembershipV1([
    pkt({ playerName: "Only", playerId: "only", risk: "MEDIUM" }),
  ]);
  assert.strictEqual(out.officialCount, 1);
  assert.strictEqual(out.thinSlate, true);
});

test("only selector writes officialSelected", () => {
  const before = pkt({ risk: "LOW" });
  assert.notStrictEqual(before.officialSelected, true);
  const out = selectOfficialMembershipV1([before, pkt({ playerName: "B", playerId: "b", eventId: "eb", risk: "LOW" })]);
  assert.ok(out.selectedPackets.every((p) => p.officialSelected === true));
  assert.ok(
    out.boardCandidates.filter((p) => !p.officialSelected).every((p) => p.officialEligible === false)
  );
});

test("isOfficialPick requires officialSelected / OFFICIAL tracking", () => {
  assert.strictEqual(isOfficialPick({ officialEligible: true }), false);
  assert.strictEqual(isOfficialPick({ trackingType: "TRACK" }), false);
  assert.strictEqual(isOfficialPick({ officialSelected: true }), true);
  assert.strictEqual(
    isOfficialPick({
      officialEligible: true,
      trackingType: "OFFICIAL",
    }),
    true
  );
});

test("Direction NO_BET still yields BEST_GUESS side on packet", () => {
  const weak = {
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
  const p = buildCanonicalPlayerForecastPacketV1(weak, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    simulationCount: 600,
    seed: 21,
  });
  assert.ok(p.selectedSide === "OVER" || p.selectedSide === "UNDER");
  assert.strictEqual(p.membership.directionAdmission, "BEST_GUESS");
  assert.strictEqual(p.membership.boardCandidate, true);
  assert.strictEqual(p.membership.officialSelected, false);
  assert.strictEqual(p.direction.researchDecision, "NO_BET");
  assert.ok(p.direction.decision === "OVER" || p.direction.decision === "UNDER");
  assert.strictEqual(p.c2MembershipAppliedTo, "BOTH_THEN_SAFER_SIDE");
  assert.ok(String(p.direction.reason || "").startsWith("BEST_GUESS_DUAL_C2_"));
});

test("display meta uses one risk and displayConfidence", () => {
  const meta = resolveOfficialDisplayMetaV1({
    directionDecision: "UNDER",
    directionAdmission: "BEST_GUESS",
    directionConfidence: "NONE",
    c2Risk: "MEDIUM",
    reliabilityProbability: 0.7,
  });
  assert.strictEqual(meta.c2Risk, "MEDIUM");
  assert.strictEqual(meta.trueRisk, "MEDIUM");
  assert.strictEqual(meta.riskLabel, "Medium Risk");
  assert.ok(Number.isFinite(meta.displayConfidence));
  assert.strictEqual(meta.signalStrength, null);
});

test("end-to-end board count ≤6 and stamps OFFICIAL", () => {
  const candidates = Array.from({ length: 10 }, (_, i) => ({
    playerName: `Pool ${i}`,
    playerId: `pool-${i}`,
    eventId: `evt-${i}`,
    team: "ATL",
    opponent: "TOR",
    slateDate: "2026-08-10",
    line: 12.5 + (i % 4),
    projection: 12.5 + (i % 4) + (i % 3 === 0 ? 3.5 : 0.3),
    fairLine: 12.5 + (i % 4) + (i % 3 === 0 ? 2.5 : 0.1),
    bookCount: 3,
    marketQualityScore: 70,
    availabilityStatus: "ACTIVE",
    expectedMinutes: 28,
    roleStabilityScore: 70,
    minutesStabilityScore: 75,
  }));
  const board = selectOfficialBoardFromProbabilitySafetyV1(candidates, {
    empiricalDirectionV1: true,
    empiricalSafePropV2: true,
    requestedSlateDate: "2026-08-10",
    simulationCount: 500,
  });
  assert.ok(board.officialCount >= 2);
  assert.ok(board.officialCount <= 6);
  assert.strictEqual(board.boardSizePolicy, "SAFEST_2_TO_6");
  for (const p of board.selectedProps) {
    assert.strictEqual(p.officialSelected, true);
    assert.strictEqual(p.trackingType, "OFFICIAL");
    assert.ok(p.side === "OVER" || p.side === "UNDER");
    assert.ok(
      p.directionAdmission === "PRIMARY" || p.directionAdmission === "BEST_GUESS"
    );
    assert.ok(["LOW", "MEDIUM", "HIGH"].includes(p.c2Risk || p.trueRisk));
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
