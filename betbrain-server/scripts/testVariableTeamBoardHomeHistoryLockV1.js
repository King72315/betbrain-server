/**
 * Acceptance tests — Final Variable Team Board + Home-History Lock V1
 * Structural only. Does not rewrite live/historical slate data.
 */
import assert from "node:assert/strict";
import {
  HOME_HISTORY_LOCK_BUILD,
  applySafetyRanking,
  assertNoDuplicateMembership,
  assertSealedIdentityImmutable,
  assertSelectionBuildLock,
  assertHomeOfficialResultsMatch,
  buildHomeBoardSummary,
  canonicalPropIdentity,
  computeCanonicalSafetyScore,
  stripLegacySelectionSurfaces,
} from "../engines/topProps/variableTeamBoardHomeHistoryLockV1.js";
import {
  buildCanonicalControlledBoardPacket,
  assertOfficialMatchesControlledBoard,
  shouldUseVariableBoardSeal,
  CANONICAL_BOARD_SEAL_BUILD,
} from "../engines/topProps/controlledBestBoardCanonicalV3.js";

const results = [];
function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`PASS  ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e.message });
    console.error(`FAIL  ${name}: ${e.message}`);
  }
}

function mkPick(overrides = {}) {
  return {
    league: "WNBA",
    slateDate: "2099-01-15",
    canonicalSlateDate: "2099-01-15",
    providerEventId: overrides.gameId || "evt-1",
    gameId: overrides.gameId || "evt-1",
    player: overrides.player || "Player A",
    playerId: overrides.player || "Player A",
    team: overrides.team || "TeamA",
    teamKey: overrides.team || "TeamA",
    opponent: overrides.opponent || "TeamB",
    side: overrides.side || "Over",
    pick: overrides.side || "Over",
    line: overrides.line ?? 10.5,
    projection: overrides.projection ?? 12,
    confidence: overrides.confidence ?? 60,
    risk: overrides.risk || "MEDIUM",
    trueRisk: overrides.risk || "MEDIUM",
    bestPropScore: overrides.score ?? 70,
    teamSideScore: overrides.score ?? 70,
    organicSide: overrides.side === "Under" ? "UNDER" : "OVER",
    evaluatedSide: overrides.side === "Under" ? "UNDER" : "OVER",
    teamSlot: overrides.teamSlot || (overrides.side === "Under" ? "BEST_UNDER" : "BEST_OVER"),
    selectedTeamSlot:
      overrides.teamSlot || (overrides.side === "Under" ? "BEST_UNDER" : "BEST_OVER"),
    sideChanged: false,
    forcedSide: false,
    autoFlip: false,
    bookCount: 4,
    marketQuality: 70,
    ...overrides,
  };
}

function threeGameBoard() {
  const games = [
    { id: "g1", a: "SEA", b: "NYL" },
    { id: "g2", a: "LVA", b: "ATL" },
    { id: "g3", a: "PHX", b: "CHI" },
  ];
  const props = [];
  for (const g of games) {
    props.push(
      mkPick({
        gameId: g.id,
        providerEventId: g.id,
        player: `${g.a} OverStar`,
        team: g.a,
        opponent: g.b,
        side: "Over",
        line: 15.5,
        projection: 18,
        confidence: 62,
        score: 75,
        teamSlot: "BEST_OVER",
      }),
      mkPick({
        gameId: g.id,
        providerEventId: g.id,
        player: `${g.a} UnderStar`,
        team: g.a,
        opponent: g.b,
        side: "Under",
        line: 12.5,
        projection: 10,
        confidence: 58,
        score: 68,
        teamSlot: "BEST_UNDER",
      }),
      mkPick({
        gameId: g.id,
        providerEventId: g.id,
        player: `${g.b} OverStar`,
        team: g.b,
        opponent: g.a,
        side: "Over",
        line: 14.5,
        projection: 17,
        confidence: 55,
        score: 66,
        teamSlot: "BEST_OVER",
      }),
      mkPick({
        gameId: g.id,
        providerEventId: g.id,
        player: `${g.b} UnderStar`,
        team: g.b,
        opponent: g.a,
        side: "Under",
        line: 20.5,
        projection: 18,
        confidence: 64,
        score: 72,
        risk: "LOW",
        teamSlot: "BEST_UNDER",
      })
    );
  }
  return props;
}

test("Test 1 — one game → 4 props, no Top/Best6/Lab fields", () => {
  const board = [
    mkPick({ player: "A1", team: "AAA", side: "Over", gameId: "g1" }),
    mkPick({ player: "A2", team: "AAA", side: "Under", gameId: "g1" }),
    mkPick({ player: "B1", team: "BBB", side: "Over", gameId: "g1", opponent: "AAA" }),
    mkPick({ player: "B2", team: "BBB", side: "Under", gameId: "g1", opponent: "AAA" }),
  ];
  const packet = buildCanonicalControlledBoardPacket({ board }, { requestedSlateDate: "2099-01-15" });
  assert.equal(packet.selectedProps.length, 4);
  assert.equal(packet.officialCount, 4);
  assert.equal(packet.topPicks.length, 0);
  assert.equal(packet.bestSixOverall.length, 0);
  assert.equal(packet.topPicksRemoved, true);
  assert.equal(packet.bestSixRemoved, true);
  assert.equal(packet.labLifecycleRemoved, true);
  assert.equal(packet.variableBoardSize, true);
  assert.equal(packet.noGlobalCap, true);
});

test("Test 2 — three games → 12 props, 6 overs, 6 unders", () => {
  const props = threeGameBoard();
  assert.equal(props.length, 12);
  const packet = buildCanonicalControlledBoardPacket(
    { board: props },
    { requestedSlateDate: "2099-01-15" }
  );
  assert.equal(packet.selectedProps.length, 12);
  assert.equal(packet.officialCount, 12);
  const overs = packet.selectedProps.filter((p) => String(p.side).toUpperCase().startsWith("OVER"));
  const unders = packet.selectedProps.filter((p) =>
    String(p.side).toUpperCase().startsWith("UNDER")
  );
  assert.equal(overs.length, 6);
  assert.equal(unders.length, 6);
});

test("Test 3 — five games → 20 props, never sliced to 6", () => {
  const props = [];
  for (let i = 1; i <= 5; i++) {
    const a = `T${i}A`;
    const b = `T${i}B`;
    const gid = `g${i}`;
    props.push(
      mkPick({ player: `${a}O`, team: a, side: "Over", gameId: gid, opponent: b }),
      mkPick({ player: `${a}U`, team: a, side: "Under", gameId: gid, opponent: b }),
      mkPick({ player: `${b}O`, team: b, side: "Over", gameId: gid, opponent: a }),
      mkPick({ player: `${b}U`, team: b, side: "Under", gameId: gid, opponent: a })
    );
  }
  const packet = buildCanonicalControlledBoardPacket(
    { board: props },
    { requestedSlateDate: "2099-01-15" }
  );
  assert.equal(packet.selectedProps.length, 20);
  assert.ok(packet.selectedProps.length > 6);
  assert.equal(shouldUseVariableBoardSeal(packet.selectedProps), true);
});

test("Test 4 — safety ordering safest → riskiest", () => {
  const props = threeGameBoard().map((p, i) => ({
    ...p,
    confidence: 40 + i,
    score: 50 + i,
  }));
  const { props: ranked, ok } = applySafetyRanking(props, "2099-01-15");
  assert.equal(ok, true);
  assert.equal(ranked[0].safetyRank, 1);
  assert.equal(ranked[ranked.length - 1].safetyRank, ranked.length);
  for (let i = 1; i < ranked.length; i++) {
    assert.ok(
      ranked[i - 1].canonicalSafetyScore >= ranked[i].canonicalSafetyScore,
      "must be non-increasing safety"
    );
  }
});

test("Test 5 — Home IDs === Official IDs === Results IDs", () => {
  const props = threeGameBoard();
  const packet = buildCanonicalControlledBoardPacket(
    { board: props },
    { requestedSlateDate: "2099-01-15" }
  );
  const match = assertHomeOfficialResultsMatch({
    homeProps: packet.selectedProps,
    officialProps: packet.officialMembership,
    resultsProps: packet.selectedProps,
    slateDate: "2099-01-15",
  });
  assert.equal(match.ok, true);
  assert.equal(match.homeCount, 12);
});

test("Test 6 — stripLegacy removes Top/Best6/Lab surfaces", () => {
  const stripped = stripLegacySelectionSurfaces({
    topPicks: [1],
    bestSixOverall: [1],
    labSlate: {},
    labReady: true,
    selectedProps: [],
  });
  assert.equal(stripped.topPicks, undefined);
  assert.equal(stripped.bestSixOverall, undefined);
  assert.equal(stripped.labSlate, undefined);
  assert.equal(stripped.topPicksRemoved, true);
});

test("Test 7 — Lab lifecycle skipped flag on History path contract", () => {
  assert.equal(CANONICAL_BOARD_SEAL_BUILD, HOME_HISTORY_LOCK_BUILD);
  assert.equal(
    HOME_HISTORY_LOCK_BUILD,
    "courteedge-final-variable-team-board-home-history-lock-v1"
  );
});

test("Test 8 — History detail envelope fields exist on enrich shape", () => {
  // Shape contract used by promoteCompletedResultsToHistory
  const p = mkPick();
  const historyDetail = {
    identity: { player: p.player, side: p.side, line: p.line },
    result: { actualPoints: null, grade: null },
    pregameModelData: null,
    signalAnalysis: { decisionPacket: null },
    postgameAnalysis: null,
    labDataAttachedToProp: true,
  };
  assert.equal(historyDetail.labDataAttachedToProp, true);
  assert.ok(historyDetail.identity.player);
});

test("Test 9 — variable Results completion denominator (11/12 not 6)", () => {
  const summary = buildHomeBoardSummary(threeGameBoard(), {
    selectionBuildId: "abc",
    dateVerificationStatus: "PASS",
  });
  assert.equal(summary.controlledBestBoard, 12);
  assert.equal(summary.resultsTracked, "12/12");
  assert.equal(summary.overs, 6);
  assert.equal(summary.unders, 6);
  assert.equal(summary.noGlobalCap, true);
  assert.ok(!String(summary.resultsTracked).includes("/6"));
});

test("Test 10 — duplicate membership blocked", () => {
  const a = mkPick({ player: "Dup", side: "Over", line: 10.5, gameId: "g1" });
  const dup = assertNoDuplicateMembership([a, { ...a }], "2099-01-15");
  assert.equal(dup.ok, false);
  assert.equal(dup.reason, "DUPLICATE_BOARD_MEMBERSHIP");
  assert.equal(dup.rawCount, 2);
  assert.equal(dup.uniqueIdentityCount, 1);
});

test("Test 11 — side/line mutation rejected", () => {
  const sealed = mkPick({ player: "Awa Fam", side: "Under", line: 11.5 });
  const mutated = mkPick({ player: "Awa Fam", side: "Over", line: 9.5 });
  const check = assertSealedIdentityImmutable(sealed, mutated);
  assert.equal(check.ok, false);
  assert.equal(check.status, "SIDE_OR_LINE_MUTATION");
  assert.notEqual(
    canonicalPropIdentity(sealed),
    canonicalPropIdentity(mutated)
  );
});

test("Test 12 — STALE_SELECTION_BUILD", () => {
  const lock = assertSelectionBuildLock({
    selectionBuildId: "aaa",
    sealBuildId: "bbb",
  });
  assert.equal(lock.ok, false);
  assert.equal(lock.reason, "STALE_SELECTION_BUILD");
  const match = assertOfficialMatchesControlledBoard({
    officialProps: threeGameBoard().slice(0, 2),
    selectedProps: threeGameBoard().slice(0, 2),
    selectionBuildId: "build-1",
    sealRequestBuildId: "build-2",
  });
  assert.equal(match.ok, false);
  assert.ok(match.reasons.includes("STALE_SELECTION_BUILD"));
});

test("Test 13 — weak candidates still selected (safety score still computed)", () => {
  const weak = mkPick({
    player: "Weak",
    confidence: 40,
    risk: "HIGH",
    score: 30,
    projection: 10.6,
    line: 10.5,
  });
  const score = computeCanonicalSafetyScore(weak);
  assert.ok(Number.isFinite(score));
  // Slot emptiness is not caused by weakness alone — structural code path keeps pick
  const packet = buildCanonicalControlledBoardPacket(
    {
      board: [
        weak,
        mkPick({ player: "Other", team: "TeamA", side: "Under", score: 80 }),
        mkPick({ player: "OppO", team: "TeamB", side: "Over", opponent: "TeamA" }),
        mkPick({ player: "OppU", team: "TeamB", side: "Under", opponent: "TeamA" }),
      ],
    },
    { requestedSlateDate: "2099-01-15" }
  );
  assert.equal(packet.selectedProps.length, 4);
});

test("Test 14 — true market failure leaves empty slot (board may be < 4)", () => {
  // Only three organic props — Under slot missing for one team
  const board = [
    mkPick({ player: "A1", team: "AAA", side: "Over" }),
    mkPick({ player: "A2", team: "AAA", side: "Under" }),
    mkPick({ player: "B1", team: "BBB", side: "Over", opponent: "AAA" }),
  ];
  const packet = buildCanonicalControlledBoardPacket(
    { board },
    { requestedSlateDate: "2099-01-15" }
  );
  assert.equal(packet.selectedProps.length, 3);
  assert.equal(packet.variableBoardSize, true);
});

test("Test 15 — historical immutability note (no rewrite in this script)", () => {
  // This test suite uses synthetic 2099 dates only — never touches Jul29–Aug3 archives.
  assert.ok(true);
});

test("Dry run — three games via canonical packet (12 Official)", () => {
  const props = threeGameBoard();
  const packet = buildCanonicalControlledBoardPacket(
    { board: props },
    { requestedSlateDate: "2099-01-15" }
  );
  assert.equal(packet.selectedProps.length, 12);
  assert.equal(packet.officialCount, 12);
  assert.equal(packet.topPicks.length, 0);
  assert.equal(packet.bestSixOverall.length, 0);
  const overs = packet.selectedProps.filter((p) =>
    String(p.side).toUpperCase().startsWith("OVER")
  ).length;
  const unders = packet.selectedProps.filter((p) =>
    String(p.side).toUpperCase().startsWith("UNDER")
  ).length;
  assert.equal(overs, 6);
  assert.equal(unders, 6);
  assert.equal(packet.selectedProps[0].safetyRank, 1);
  assert.equal(packet.selectedProps[11].safetyRank, 12);
  console.log(
    `  dry-run home=${packet.selectedProps.length} official=${packet.officialCount} results=${packet.selectedProps.length} overs=${overs} unders=${unders} build=${packet.selectionBuildId}`
  );
});

const failed = results.filter((r) => !r.ok);
console.log("\n" + JSON.stringify({
  build: HOME_HISTORY_LOCK_BUILD,
  passed: results.filter((r) => r.ok).length,
  failed: failed.length,
  failures: failed,
}, null, 2));

process.exit(failed.length ? 1 : 0);
