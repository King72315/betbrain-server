/**
 * Acceptance tests — Canonical Controlled Best Board Sealing Path V3
 */
import assert from "node:assert/strict";
import {
  buildCanonicalControlledBoardPacket,
  assertOfficialMatchesControlledBoard,
  validateCanonicalBoardInvariants,
  MEMBERSHIP_FAIL,
  CANONICAL_BOARD_MEMBERSHIP_MODEL,
} from "../engines/topProps/controlledBestBoardCanonicalV3.js";
import {
  evaluateOfficialSealEligibility,
  BEST_SIX_FULL_COUNT,
} from "../services/officialSlateService.js";

function mkProp({
  player,
  team,
  side,
  line,
  slot,
  eventId = "e1",
  slateDate = "2026-08-03",
  score = 80,
}) {
  return {
    player,
    team,
    teamKey: team,
    opponent: "OPP",
    side,
    pick: side,
    line,
    officialLine: line,
    teamSlot: slot,
    providerEventId: eventId,
    gameId: eventId,
    league: "WNBA",
    slateDate,
    canonicalSlateDate: slateDate,
    projection: line + (side === "Over" ? 2 : -2),
    confidence: score,
    risk: 20,
    playerId: player.replace(/\s+/g, "").toLowerCase(),
    teamSideScore: score,
  };
}

const twelve = [
  mkProp({ player: "A1", team: "NYL", side: "Over", line: 19.5, slot: "Over", eventId: "g1", score: 90 }),
  mkProp({ player: "A2", team: "NYL", side: "Under", line: 21.5, slot: "Under", eventId: "g1", score: 88 }),
  mkProp({ player: "B1", team: "SEA", side: "Over", line: 14.5, slot: "Over", eventId: "g1", score: 87 }),
  mkProp({ player: "B2", team: "SEA", side: "Under", line: 14.5, slot: "Under", eventId: "g1", score: 86 }),
  mkProp({ player: "C1", team: "LVA", side: "Over", line: 11.5, slot: "Over", eventId: "g2", score: 85 }),
  mkProp({ player: "C2", team: "LVA", side: "Under", line: 10.5, slot: "Under", eventId: "g2", score: 84 }),
  mkProp({ player: "D1", team: "ATL", side: "Over", line: 18.5, slot: "Over", eventId: "g2", score: 83 }),
  mkProp({ player: "D2", team: "ATL", side: "Under", line: 15.5, slot: "Under", eventId: "g2", score: 82 }),
  mkProp({ player: "E1", team: "PHX", side: "Over", line: 10.5, slot: "Over", eventId: "g3", score: 81 }),
  mkProp({ player: "E2", team: "PHX", side: "Under", line: 22.5, slot: "Under", eventId: "g3", score: 80 }),
  mkProp({ player: "F1", team: "CHI", side: "Over", line: 17.5, slot: "Over", eventId: "g3", score: 79 }),
  mkProp({ player: "F2", team: "CHI", side: "Under", line: 13.5, slot: "Under", eventId: "g3", score: 78 }),
];

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err.message || err) });
    console.error(`FAIL  ${name}: ${err.message || err}`);
  }
}

test("Test 1 — Twelve-prop board seal (no six-row cap)", () => {
  const packet = buildCanonicalControlledBoardPacket(
    { board: twelve, bestSixOverall: twelve.slice(0, 6), topPicks: twelve.slice(0, 2) },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-test-1" }
  );
  assert.equal(packet.selectedProps.length, 12);
  assert.equal(packet.officialCount, 12);
  assert.equal(packet.membershipValid, true);
  const elig = evaluateOfficialSealEligibility(12, {
    variableBoardSize: true,
    membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
    membershipValid: true,
    forceSealVariableBoard: true,
  });
  assert.equal(elig.eligible, true);
  assert.equal(elig.sealReason, "FULL_CONTROLLED_BEST_BOARD");
  assert.equal(elig.officialCount, 12);
  assert.equal(elig.controlledBestSixCount, 12);
});

test("Test 2 — Best 6 / Top surfaces removed from active packet", () => {
  const packet = buildCanonicalControlledBoardPacket(
    { board: twelve, bestSixOverall: twelve.slice(0, 6), topPicks: twelve.slice(0, 2) },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-test-2" }
  );
  assert.equal(packet.bestSixOverall.length, 0);
  assert.equal(packet.topPicks.length, 0);
  assert.equal(packet.bestSixRemoved, true);
  assert.equal(packet.topPicksRemoved, true);
  assert.equal(packet.officialMembership.length, 12);
  const ranks7to12 = packet.selectedProps.slice(6);
  assert.equal(ranks7to12.length, 6);
});

test("Test 3 — Official-only injection rejected", () => {
  const packet = buildCanonicalControlledBoardPacket(
    { board: twelve },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-test-3" }
  );
  const outsider = mkProp({
    player: "Alyssa Thomas",
    team: "PHX",
    side: "Over",
    line: 14.5,
    slot: "Over",
    eventId: "wrong",
  });
  const check = assertOfficialMatchesControlledBoard({
    officialProps: [...packet.selectedProps, outsider],
    selectedProps: packet.selectedProps,
    selectionBuildId: "build-test-3",
    sealRequestBuildId: "build-test-3",
  });
  assert.equal(check.ok, false);
  assert.ok(
    check.reasons.some((r) => r.includes("NOT_IN_CONTROLLED_BOARD"))
  );
});

test("Test 4 — Displayed Unders remain Official", () => {
  const packet = buildCanonicalControlledBoardPacket(
    { board: twelve },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-test-4" }
  );
  const unders = packet.selectedProps.filter(
    (p) => String(p.side).toUpperCase().startsWith("U")
  );
  assert.equal(unders.length, 6);
  const check = assertOfficialMatchesControlledBoard({
    officialProps: packet.selectedProps,
    selectedProps: packet.selectedProps,
  });
  assert.equal(check.ok, true);
});

test("Test 5 — Seattle duplicate Over rejected by invariants", () => {
  const bad = [
    mkProp({ player: "Flaujae", team: "SEA", side: "Over", line: 14.5, slot: "Over" }),
    mkProp({ player: "Malonga", team: "SEA", side: "Over", line: 14.5, slot: "Over" }),
  ];
  const packet = buildCanonicalControlledBoardPacket(
    { board: bad },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-test-5" }
  );
  assert.equal(packet.membershipValid, false);
  assert.ok(
    packet.invariants.reasons.some((r) => r.includes("DUPLICATE_TEAM_OVER"))
  );
});

test("Test 6 — Team caps", () => {
  const packet = buildCanonicalControlledBoardPacket(
    { board: twelve },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-test-6" }
  );
  const inv = validateCanonicalBoardInvariants(packet);
  assert.equal(inv.ok, true);
  for (const [, t] of Object.entries(inv.teamCounts)) {
    assert.ok(t.overs <= 1);
    assert.ok(t.unders <= 1);
    assert.ok(t.total <= 2);
  }
});

test("Test 7 — Build ID mismatch blocks seal", () => {
  const packet = buildCanonicalControlledBoardPacket(
    { board: twelve },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-B" }
  );
  const check = assertOfficialMatchesControlledBoard({
    officialProps: packet.selectedProps,
    selectedProps: packet.selectedProps,
    selectionBuildId: "build-B",
    sealRequestBuildId: "build-A",
  });
  assert.equal(check.ok, false);
  assert.ok(check.reasons.includes(MEMBERSHIP_FAIL.STALE_SELECTION_BUILD));
});

test("Test 8 — Variable Results admission count", () => {
  const packet = buildCanonicalControlledBoardPacket(
    { board: twelve },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-test-8" }
  );
  // Results denominator = officialCount, not 6
  assert.equal(packet.officialCount, 12);
  assert.notEqual(packet.officialCount, BEST_SIX_FULL_COUNT);
});

test("Test 9 — Variable History count (Lab removed)", () => {
  const packet = buildCanonicalControlledBoardPacket(
    { board: twelve },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-test-9" }
  );
  assert.equal(packet.selectedProps.length, 12);
  assert.equal(packet.bestSixOverallCount, 0);
  assert.equal(packet.labLifecycleRemoved, true);
  assert.equal(packet.officialCount, 12);
});

test("Test 10 — Historical six-row bundle shape preserved conceptually", () => {
  // Legacy eligibility still uses fixed six when variableBoardSize is false
  const elig = evaluateOfficialSealEligibility(6, {
    variableBoardSize: false,
    membershipModel: null,
  });
  assert.equal(elig.eligible, true);
  assert.equal(elig.reason, "FULL_BEST_SIX");
});

test("Test 11 — Pregame invalid seal: variable board eligible at 12", () => {
  const elig = evaluateOfficialSealEligibility(12, {
    variableBoardSize: true,
    membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
    membershipValid: true,
    forceSealVariableBoard: true,
  });
  assert.equal(elig.eligible, true);
  assert.equal(elig.officialCount, 12);
});

test("Test 12 — Slot/side mismatch rejected", () => {
  const bad = [
    mkProp({
      player: "X",
      team: "SEA",
      side: "Over",
      line: 14.5,
      slot: "Under",
    }),
  ];
  const packet = buildCanonicalControlledBoardPacket(
    { board: bad },
    { requestedSlateDate: "2026-08-03", selectionBuildId: "build-test-12" }
  );
  assert.equal(packet.membershipValid, false);
  assert.ok(
    packet.invariants.reasons.some((r) =>
      r.includes(MEMBERSHIP_FAIL.TEAM_SLOT_SIDE_MISMATCH)
    )
  );
});

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${passed} passed, ${failed} failed of ${results.length}`);
process.exit(failed ? 1 : 0);
