/**
 * Mandatory Team Over/Under Pair Selection V2 — acceptance tests.
 * Usage: node scripts/testControlledBestBoardPairSelectionV2.js
 */
import assert from "node:assert/strict";
import {
  selectTeamSidePair,
  selectControlledBestBoard,
  buildDualSideCandidates,
  evaluateHardMarketValidity,
  HARD_EXCLUDE_REASONS,
  EMPTY_SLOT_REASONS,
  CONTROLLED_BEST_BOARD_BUILD,
  MARKET_SANITY_GAP_POINTS,
} from "../engines/topProps/controlledBestBoardV2.js";

let passed = 0;
let failed = 0;
const failures = [];

function test(num, name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${num}: ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ num, name, err });
    console.error(`FAIL ${num}: ${name} — ${err.message}`);
  }
}

function makePick(o = {}) {
  const side = o.side || "Over";
  const sideNorm = String(side).toUpperCase().startsWith("UNDER") ? "UNDER" : "OVER";
  return {
    player: o.player || "P",
    team: o.team || "TeamA",
    opponent: o.opponent || "TeamB",
    league: "WNBA",
    side,
    pick: side,
    line: o.line ?? 12.5,
    projection: o.projection ?? 14,
    fairLine: o.fairLine ?? o.projection ?? 14,
    bestPropScore: o.bestPropScore ?? 70,
    confidence: o.confidence ?? 58,
    naturalDecision: o.naturalDecision || "TRACK",
    commenceTime: o.commenceTime || "2026-08-05T17:00:00Z",
    gameId: o.gameId || "evt-1",
    providerEventId: o.gameId || "evt-1",
    officialPropId: o.officialPropId || `2026-08-05|${o.player || "P"}|points`,
    slateDate: "2026-08-05",
    canonicalSlateDate: "2026-08-05",
    bookCount: o.bookCount ?? 3,
    roleStability: o.roleStability || "STABLE",
    sideRescue: o.sideRescue || { action: null },
    inactive: o.inactive === true,
    confirmedActive: o.confirmedActive !== false,
    blowoutRisk: o.blowoutRisk ?? 15,
    originalModelSide: o.originalModelSide || sideNorm,
    expectedFGA: o.expectedFGA ?? (sideNorm === "UNDER" ? 10 : 14),
    last5Average: o.last5Average,
    seasonAverage: o.seasonAverage,
    ...o.extra,
  };
}

test(1, "Strong team pair selects distinct Over/Under", () => {
  const picks = [
    makePick({ player: "A", projection: 18, line: 12.5, bestPropScore: 80 }),
    makePick({ player: "B", projection: 10, line: 14.5, bestPropScore: 70 }),
    makePick({ player: "C", projection: 9, line: 13.5, bestPropScore: 65 }),
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.ok(r.selectedOver);
  assert.ok(r.selectedUnder);
  assert.notEqual(r.selectedOver.player, r.selectedUnder.player);
  assert.equal(r.forcedSide, false);
  assert.equal(r.debug.earlySameTeamDemotionCount, 0);
});

test(2, "Greedy collision: Player A best both sides → pair with others", () => {
  const picks = [
    makePick({ player: "A", projection: 20, line: 12.5, bestPropScore: 90 }), // strong Over
    makePick({ player: "B", projection: 15, line: 12.5, bestPropScore: 70 }),
    makePick({ player: "C", projection: 8, line: 14.5, bestPropScore: 68 }), // strong Under
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.ok(r.selectedOver);
  assert.ok(r.selectedUnder);
  assert.notEqual(r.selectedOver.player, r.selectedUnder.player);
  // A should win Over; Under should be C (not A)
  assert.equal(r.selectedOver.player, "A");
  assert.equal(r.selectedUnder.player, "C");
  assert.ok(r.debug.pairs.length >= 2);
});

test(3, "Three Overs weak Unders → Over may seal; Under slot stays empty (no last-valid fill)", () => {
  const picks = [
    makePick({ player: "O1", projection: 18, line: 12.5, bestPropScore: 80 }),
    makePick({ player: "O2", projection: 17, line: 12.5, bestPropScore: 75 }),
    makePick({ player: "O3", projection: 16, line: 12.5, bestPropScore: 70 }),
  ];
  // All lean Over; Under sides have negative edge → not Official-eligible
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.ok(r.selectedOver);
  assert.equal(r.selectedUnder, null);
  assert.ok(
    /NO_QUALIFIED_TEAM_UNDER|EDGE_BELOW_MEMBERSHIP_FLOOR|TEAM_SIDE_LAST_VALID|UNDER_PROJECTION_ABOVE_LINE|UNDER_FAIR_LINE_ABOVE_LINE/.test(
      r.debug.emptyUnder?.reason || ""
    )
  );
});

test(4, "Sub-floor scores do not independently hard-block Official membership", () => {
  const picks = [
    makePick({ player: "A", projection: 16, line: 12.5, bestPropScore: 40 }),
    makePick({ player: "B", projection: 9, line: 14.5, bestPropScore: 35 }),
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  // Low bestPropScore is ranking/confidence packaging — evidence gates decide membership.
  assert.ok(r.selected.length <= 2);
  if (r.selectedOver) {
    assert.ok((r.selectedOver.sideEdge ?? 0) >= 1.5);
    assert.ok(r.selectedOver.officialMembershipEligible !== false);
  }
  if (r.selectedUnder) {
    assert.ok((r.selectedUnder.sideEdge ?? 0) >= 1.5);
    assert.ok(r.selectedUnder.officialMembershipEligible !== false);
  }
});

test(5, "NO_DECISIVE_RESCUE remains eligible with risk penalty", () => {
  const picks = [
    makePick({ player: "A", projection: 17, line: 12.5, bestPropScore: 70 }),
    makePick({
      player: "B",
      projection: 9,
      line: 14.5,
      bestPropScore: 55,
      sideRescue: { action: "NO_DECISIVE_RESCUE" },
    }),
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.ok(r.selectedUnder);
  assert.ok(
    r.selectedUnder.softPenalties?.includes("NO_DECISIVE_RESCUE") ||
      r.selectedUnder.trueRisk === "HIGH" ||
      r.selectedUnder.trueRisk === "MEDIUM"
  );
});

test(6, "BOARD_ONLY best Over still eligible when edge clears membership floor", () => {
  const picks = [
    makePick({
      player: "A",
      projection: 18,
      line: 12.5,
      bestPropScore: 72,
      naturalDecision: "BOARD_ONLY",
    }),
    makePick({ player: "B", projection: 9, line: 14.5, bestPropScore: 60 }),
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.equal(r.selectedOver.player, "A");
  assert.ok(r.selectedOver.softPenalties?.includes("BOARD_ONLY_OR_SHADOW"));
  // Team-slot must not invent TRACK over BOARD_ONLY
  assert.equal(r.selectedOver.resultsDecisionLabel, "BOARD_ONLY");
});

test(7, "Wrong-date hard rejected", () => {
  const pick = makePick({
    commenceTime: "2026-08-06T17:00:00Z",
    officialPropId: "2026-08-05|A|points",
  });
  const hard = evaluateHardMarketValidity(pick, {
    requestedSlateDate: "2026-08-05",
  });
  assert.equal(hard.ok, false);
  assert.ok(hard.reasons.includes(HARD_EXCLUDE_REASONS.DATE_VERIFICATION_FAILED));
});

test(8, "Extreme single-book line → MARKET_SANITY_HOLD", () => {
  const pick = makePick({
    player: "Paige",
    line: 8.5,
    projection: 20,
    fairLine: 19.7,
    bookCount: 1,
    bestPropScore: 70,
  });
  const hard = evaluateHardMarketValidity(pick, {
    requestedSlateDate: "2026-08-05",
  });
  assert.equal(hard.ok, false);
  assert.ok(hard.reasons.includes(HARD_EXCLUDE_REASONS.MARKET_SANITY_HOLD));
  assert.ok(hard.gap >= MARKET_SANITY_GAP_POINTS);

  // Next valid candidate still selected
  const picks = [
    pick,
    makePick({ player: "OtherO", projection: 15, line: 12.5, bookCount: 3 }),
    makePick({ player: "OtherU", projection: 9, line: 14.5, bookCount: 3 }),
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.notEqual(r.selectedOver?.player, "Paige");
  assert.ok(r.selectedOver);
  assert.ok(r.selectedUnder);
});

test(9, "earlySameTeamDemotionCount is 0", () => {
  const picks = [
    makePick({ player: "A", projection: 18, line: 12.5 }),
    makePick({ player: "B", projection: 17, line: 12.5 }),
    makePick({ player: "C", projection: 8, line: 14.5 }),
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.equal(r.debug.earlySameTeamDemotionCount, 0);
  assert.equal(r.debug.forcedSideCount, 0);
  assert.equal(r.debug.autoFlipCount, 0);
});

test(10, "Two-game board → eight props", () => {
  const picks = [];
  for (const [g, tA, tB] of [
    ["g1", "Sun", "Wings"],
    ["g2", "Tempo", "Valks"],
  ]) {
    picks.push(
      makePick({ player: `${tA}1`, team: tA, opponent: tB, gameId: g, projection: 16, line: 12 }),
      makePick({ player: `${tA}2`, team: tA, opponent: tB, gameId: g, projection: 9, line: 14 }),
      makePick({ player: `${tB}1`, team: tB, opponent: tA, gameId: g, projection: 15, line: 11 }),
      makePick({ player: `${tB}2`, team: tB, opponent: tA, gameId: g, projection: 8, line: 13 })
    );
  }
  const board = selectControlledBestBoard(picks, { requestedSlateDate: "2026-08-05" });
  assert.equal(board.board.length, 8);
  const overs = board.board.filter((p) => String(p.side).toUpperCase().startsWith("OVER"));
  const unders = board.board.filter((p) => String(p.side).toUpperCase().startsWith("UNDER"));
  assert.equal(overs.length, 4);
  assert.equal(unders.length, 4);
});

test(11, "Three-game board → twelve props", () => {
  const picks = [];
  for (let g = 1; g <= 3; g++) {
    const tA = `A${g}`;
    const tB = `B${g}`;
    const gameId = `g${g}`;
    picks.push(
      makePick({ player: `${tA}1`, team: tA, opponent: tB, gameId, projection: 16, line: 12 }),
      makePick({ player: `${tA}2`, team: tA, opponent: tB, gameId, projection: 9, line: 14 }),
      makePick({ player: `${tB}1`, team: tB, opponent: tA, gameId, projection: 15, line: 11 }),
      makePick({ player: `${tB}2`, team: tB, opponent: tA, gameId, projection: 8, line: 13 })
    );
  }
  const board = selectControlledBestBoard(picks, { requestedSlateDate: "2026-08-05" });
  assert.equal(board.board.length, 12);
});

test(12, "One valid player → at most one Official side; other slot empty", () => {
  const picks = [makePick({ player: "Solo", projection: 16, line: 12.5, bestPropScore: 75 })];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.ok(r.selected.length <= 1);
  assert.ok(r.debug.emptyOver || r.debug.emptyUnder);
  const emptyReason =
    r.debug.emptyOver?.reason || r.debug.emptyUnder?.reason || "";
  assert.ok(
    /NO_VALID_DIFFERENT_PLAYER|FEWER_THAN_TWO|NO_QUALIFIED_TEAM_|EDGE_BELOW|TEAM_SIDE_LAST_VALID|UNDER_PROJECTION|UNDER_FAIR/.test(
      emptyReason
    )
  );
});

test(13, "All Under candidates inactive → empty Under with inactive/membership reason", () => {
  const picks = [
    makePick({ player: "Active", projection: 16, line: 12.5, bestPropScore: 75 }),
    makePick({ player: "Out1", projection: 8, line: 14.5, inactive: true }),
    makePick({ player: "Out2", projection: 7, line: 13.5, inactive: true }),
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  // Active Over can seal; distinct Under from inactive players is unavailable
  if (r.selectedOver) {
    assert.equal(r.selectedOver.player, "Active");
  }
  if (!r.selectedUnder) {
    assert.ok(
      /NO_VALID_DIFFERENT_PLAYER|FEWER_THAN_TWO|ALL_PLAYERS_INACTIVE|NO_VALID|NO_QUALIFIED_TEAM_UNDER|EDGE_BELOW|UNDER_PROJECTION|UNDER_FAIR/.test(
        r.debug.emptyUnder?.reason || ""
      )
    );
  } else {
    assert.notEqual(r.selectedUnder.player, "Out1");
    assert.notEqual(r.selectedUnder.player, "Out2");
  }
});

test(14, "Date contamination excluded before pair ranking", () => {
  const picks = [
    makePick({ player: "Good1", projection: 16, line: 12.5 }),
    makePick({ player: "Good2", projection: 9, line: 14.5 }),
    makePick({
      player: "Bad",
      projection: 20,
      line: 10,
      commenceTime: "2026-08-06T17:00:00Z",
      officialPropId: "2026-08-06|Bad|points",
    }),
  ];
  const r = selectTeamSidePair(picks, { requestedSlateDate: "2026-08-05" });
  assert.ok(r.selectedOver);
  assert.ok(r.selectedUnder);
  assert.notEqual(r.selectedOver.player, "Bad");
  assert.notEqual(r.selectedUnder.player, "Bad");
});

test(15, "Eight props Official / Best 6 Overall removed from product", () => {
  const picks = [];
  for (const [g, tA, tB] of [
    ["g1", "T1", "T2"],
    ["g2", "T3", "T4"],
  ]) {
    picks.push(
      makePick({ player: `${tA}a`, team: tA, opponent: tB, gameId: g, projection: 16, line: 12 }),
      makePick({ player: `${tA}b`, team: tA, opponent: tB, gameId: g, projection: 9, line: 14 }),
      makePick({ player: `${tB}a`, team: tB, opponent: tA, gameId: g, projection: 15, line: 11 }),
      makePick({ player: `${tB}b`, team: tB, opponent: tA, gameId: g, projection: 8, line: 13 })
    );
  }
  const board = selectControlledBestBoard(picks, { requestedSlateDate: "2026-08-05" });
  assert.equal(board.board.length, 8);
  assert.ok(board.board.every((p) => p.resultsAdmissionEligible === true));
  assert.ok(board.board.every((p) => p.controlledBestBoard === true));
  // Best 6 Overall / Top removed — empty compatibility arrays only
  assert.equal(board.bestSixOverall.length, 0);
  assert.equal(board.topPicks.length, 0);
  assert.equal(board.selectedProps.length, board.board.length);
  assert.equal(
    CONTROLLED_BEST_BOARD_BUILD,
    "courteedge-clear-side-strong-edge-membership-path-v1"
  );
});

console.log("\n==============================");
console.log(`Pair selection V2 tests: ${passed} passed, ${failed} failed`);
console.log("==============================");
if (failed > 0) {
  for (const f of failures) console.error(`#${f.num} ${f.name}: ${f.err?.stack || f.err}`);
  process.exit(1);
}
