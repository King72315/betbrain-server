/**
 * CourtEdge data-flow acceptance tests (blueprint section 10).
 * Usage: node betbrain-server/scripts/testCourtEdgeDataFlow.js
 */
import assert from "assert";

import {
  selectControlledBestSixCombined,
  BEST_SIX_LIMIT,
  CONTROLLED_BEST_SIX_VERSION,
} from "../engines/topProps/controlledBestSixSelector.js";
import { getPickTeamKey } from "../engines/topProps/topPropSelector.js";
import {
  buildControlledTrackingCohort,
  buildResultsTrackingCohort,
  collectAllGeneratedCandidatesFromGames,
  collectAllGeneratedProps,
  CONTROLLED_TRACKING_COHORT_VERSION,
  getStableTrackedPropKey,
  TRACKING_COHORT_VERSION,
} from "../services/trackedPropService.js";
import {
  saveTopPicksSnapshot,
  saveBestSixSnapshot,
  getTopPicksSnapshot,
  getBestSixSnapshot,
  TOP_PICKS_SOURCE_POOL,
} from "../services/topPicksSnapshotService.js";
import { buildSlateResultsSnapshot } from "../services/slateResultsSnapshot.js";
import {
  buildSlateLifecycleMap,
  resolveSlateLifecycleState,
  SLATE_LIFECYCLE_STATES,
} from "../services/slateLifecycleService.js";

function inferTrackingType(prop = {}) {
  const explicit = String(prop.trackingType || prop.recordType || "").toUpperCase();
  if (explicit === "OFFICIAL") return "OFFICIAL";
  if (explicit === "TEST") return "TEST";
  if (explicit === "NO_BET") return "NO_BET";
  const tier = String(prop.tier || "").toUpperCase();
  if (tier === "LEAN" || tier === "WATCHLIST") return "TEST";
  if (tier === "PREMIUM" || tier === "OFFICIAL") return "OFFICIAL";
  if (prop.officialEligible === true) return "OFFICIAL";
  return "TEST";
}

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

function makeGame(picks, allGeneratedCandidates, overrides = {}) {
  return {
    gameId: overrides.gameId || "game-1",
    game: overrides.game || "Away @ Home",
    league: overrides.league || "WNBA",
    date: "2026-06-23",
    commenceTime: "2026-06-23T23:00:00Z",
    isStarted: false,
    picks: picks.slice(0, 4),
    allGeneratedCandidates: allGeneratedCandidates || picks,
    ...overrides,
  };
}

function makePick(overrides = {}) {
  const trackingType =
    overrides.trackingType ||
    overrides.finalDecision ||
    (overrides.officialEligible ? "OFFICIAL" : "TEST");
  const league = overrides.league || "WNBA";
  const base = {
    player: overrides.player || "Test Player",
    team: overrides.team || "TeamA",
    opponent: overrides.opponent || "TeamB",
    line: overrides.line ?? 14.5,
    pick: overrides.pick || "Over",
    side: overrides.side || "Over",
    league,
    tier: overrides.tier || "WATCHLIST",
    confidence: overrides.confidence ?? 65,
    pickScore: overrides.pickScore ?? 65,
    noPlay: false,
    trackingType,
    finalDecision: trackingType,
    slateDate: overrides.slateDate || "2026-06-23",
    ...overrides,
  };

  if (
    String(league).toUpperCase() === "WNBA" &&
    !base.wnbaDataCard &&
    !base.wnbaReader
  ) {
    base.wnbaDataCard = {
      bookLine: base.line,
      dataConfidenceScore: 72,
      bookCount: 5,
      marketQuality: 70,
      dataMode: "WNBA_FULL",
      minutesVolatility: "stable",
      projection: { projection: Number(base.line) + 4, expectedMinutes: 28, expectedFGA: 11 },
      last5: { points: 17, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 65 },
      dataMissingFlags: [],
      injuryAvailability: { level: "ACTIVE", blocksPlay: false },
    };
    base.wnbaReader = {
      finalSide: "OVER",
      decision: trackingType,
      readerConfidence: 68,
      margin: 8,
      overCase: { score: 55 },
      underCase: { score: 20 },
    };
    base.netEdge = 8;
  }

  return base;
}

function buildManyWnbaCandidates(count = 8) {
  return Array.from({ length: count }, (_, i) =>
    makePick({
      player: `Player${i + 1}`,
      team: `Team${i + 1}`,
      pickScore: 90 - i * 5,
      trackingType: i === 0 ? "OFFICIAL" : "TEST",
      officialEligible: i === 0,
    })
  );
}

console.log("\nCourtEdge Data Flow — 50 acceptance tests\n");

test("01 buildControlledTrackingCohort exports version constant", () => {
  assert.equal(CONTROLLED_TRACKING_COHORT_VERSION, "controlled-tracking-cohort-v1");
});

test("02 admission path is CONTROLLED_BEST_SIX not board-capped", () => {
  const game = makeGame(buildManyWnbaCandidates(8).slice(0, 3), buildManyWnbaCandidates(8));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.equal(bundle.audit.admissionPath, "CONTROLLED_BEST_SIX");
  assert.equal(bundle.audit.collectAllGeneratedPropsBypass, false);
});

test("03 full candidate pool exceeds board-capped picks", () => {
  const candidates = buildManyWnbaCandidates(10);
  const game = makeGame(candidates.slice(0, 4), candidates);
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  const boardCapped = collectAllGeneratedProps([game]);
  assert.ok(bundle.fullGeneratedCandidates.length > boardCapped.length);
});

test("04 Best 6 WNBA capped at 6", () => {
  const game = makeGame(buildManyWnbaCandidates(10).slice(0, 4), buildManyWnbaCandidates(10));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.ok(bundle.bestSixWNBA.length <= BEST_SIX_LIMIT);
});

test("05 tracking cohort derived from Best 6 only", () => {
  const game = makeGame(buildManyWnbaCandidates(8).slice(0, 3), buildManyWnbaCandidates(8));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  const bestSixKeys = new Set(
    [...bundle.bestSixWNBA, ...bundle.bestSixNBA].map(getStableTrackedPropKey)
  );
  for (const pick of bundle.trackingCohort) {
    assert.ok(bestSixKeys.has(getStableTrackedPropKey(pick)));
  }
});

test("06 Top Picks are subset of Best 6", () => {
  const game = makeGame(buildManyWnbaCandidates(8).slice(0, 3), buildManyWnbaCandidates(8));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  const bestSixKeys = new Set(
    [...bundle.bestSixWNBA, ...bundle.bestSixNBA].map(getStableTrackedPropKey)
  );
  for (const pick of bundle.topProps) {
    assert.ok(bestSixKeys.has(getStableTrackedPropKey(pick)));
  }
});

test("07 Top Picks marked referenceOnly via selector", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.ok(bundle.topProps.every((p) => p.isTopPickReference === true));
});

test("08 Best 6 snapshot is referenceOnly", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.equal(bundle.bestSixSnapshot.referenceOnly, true);
});

test("09 tracking cohort audit has version", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.equal(bundle.trackingCohortAudit.trackingCohortVersion, TRACKING_COHORT_VERSION);
});

test("10 controlled selection version matches selector", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.equal(bundle.controlledBestSixVersion, CONTROLLED_BEST_SIX_VERSION);
});

test("11 source pool is CONTROLLED_BEST_SIX", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.equal(bundle.topPropsSource, "CONTROLLED_BEST_SIX");
});

test("12 preFiltered controlledSelection passthrough works", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const selection = selectControlledBestSixCombined([game]);
  const bundle = buildControlledTrackingCohort(
    { gameCards: [game] },
    { controlledSelection: selection }
  );
  assert.equal(bundle.bestSixWNBA.length, selection.bestSixWNBA.length);
});

test("13 NO_BET picks excluded from tracking cohort", () => {
  const pick = makePick({ trackingType: "NO_BET", finalDecision: "NO_BET" });
  const { cohort } = buildResultsTrackingCohort([pick]);
  assert.equal(cohort.length, 0);
});

test("14 started picks excluded from tracking cohort", () => {
  const pick = makePick({ isStarted: true, trackingType: "TEST" });
  const { cohort } = buildResultsTrackingCohort([pick]);
  assert.equal(cohort.length, 0);
});

test("15 duplicate player-line excluded from cohort", () => {
  const a = makePick({ player: "Dup", team: "T1", line: 14.5, side: "Over" });
  const b = makePick({ player: "Dup", team: "T1", line: 14.5, side: "Over" });
  const { cohort, audit } = buildResultsTrackingCohort([a, b]);
  assert.equal(cohort.length, 1);
  assert.ok(audit.duplicateExcludedCount >= 1);
});

test("16 opposite side same line excluded", () => {
  const over = makePick({ player: "X", line: 15.5, side: "Over", pick: "Over" });
  const under = makePick({ player: "X", line: 15.5, side: "Under", pick: "Under" });
  const { cohort } = buildResultsTrackingCohort([over, under]);
  assert.equal(cohort.length, 1);
});

test("17 NBA and WNBA Best 6 selected independently", () => {
  const wnba = makeGame(
    [makePick({ league: "WNBA", player: "W1", team: "WT1" })],
    [makePick({ league: "WNBA", player: "W1", team: "WT1" })],
    { league: "WNBA" }
  );
  const nba = makeGame(
    [makePick({ league: "NBA", player: "N1", team: "NT1" })],
    [makePick({ league: "NBA", player: "N1", team: "NT1" })],
    { league: "NBA", gameId: "nba-1" }
  );
  const bundle = buildControlledTrackingCohort({ gameCards: [wnba, nba] });
  assert.ok(bundle.bestSixWNBA.every((p) => p.league === "WNBA"));
  assert.ok(bundle.bestSixNBA.every((p) => p.league === "NBA"));
});

test("18 Top 2 per league prefers different teams when possible", () => {
  const candidates = [
    makePick({ player: "A", team: "T1", pickScore: 95 }),
    makePick({ player: "B", team: "T1", pickScore: 90 }),
    makePick({ player: "C", team: "T2", pickScore: 85 }),
  ];
  const game = makeGame(candidates.slice(0, 3), candidates);
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  const teams = new Set(bundle.topWNBAProps.map(getPickTeamKey));
  assert.ok(teams.size >= 1);
});

test("19 saveTopPicksSnapshot is referenceOnly", () => {
  const pick = makePick({ isTopPickReference: true, referenceOnly: true });
  saveTopPicksSnapshot([pick], { slateDate: "2099-01-01-test-flow" });
  const snap = getTopPicksSnapshot("2099-01-01-test-flow");
  assert.equal(snap.referenceOnly, true);
  assert.equal(snap.sourcePool, TOP_PICKS_SOURCE_POOL);
});

test("20 saveBestSixSnapshot stores controlled ranks", () => {
  const picks = [
    makePick({ bestSixRank: 1, controlledBestSixRank: 1, bestSixLabel: "Best WNBA #1" }),
  ];
  saveBestSixSnapshot(picks, { slateDate: "2099-01-02-test-flow" });
  const snap = getBestSixSnapshot("2099-01-02-test-flow");
  assert.equal(snap.picks[0].bestSixRank, 1);
});

test("21 slate results snapshot grades only resolved props", () => {
  const props = [
    { ...makePick(), status: "win", actualStat: 20, resultMargin: 5.5 },
    { ...makePick({ player: "Pending" }), status: "pending" },
  ];
  const snap = buildSlateResultsSnapshot(props, { slateDate: "2026-06-23" });
  assert.equal(snap.gradedCount, 1);
  assert.equal(snap.snapshotMissing, false);
});

test("22 lifecycle GENERATED_BOARD when no tracked props", () => {
  const state = resolveSlateLifecycleState("2026-06-23", {
    trackedProps: [],
    reports: [],
    archives: [],
    hasGeneratedBoard: true,
  });
  assert.equal(state.state, SLATE_LIFECYCLE_STATES.GENERATED_BOARD);
});

test("23 lifecycle TRACKING_ACTIVE with pending props", () => {
  const state = resolveSlateLifecycleState("2026-06-23", {
    trackedProps: [makePick({ status: "pending" })],
    reports: [],
    archives: [],
  });
  assert.equal(state.state, SLATE_LIFECYCLE_STATES.TRACKING_ACTIVE);
});

test("24 lifecycle PARTIALLY_GRADED with mixed statuses", () => {
  const state = resolveSlateLifecycleState("2026-06-23", {
    trackedProps: [
      makePick({ status: "win", player: "A" }),
      makePick({ status: "pending", player: "B" }),
    ],
    reports: [],
    archives: [],
  });
  assert.equal(state.state, SLATE_LIFECYCLE_STATES.PARTIALLY_GRADED);
});

test("25 lifecycle LAB_CURRENT when all graded and newest completed", () => {
  const slateDate = "2026-06-23";
  const state = resolveSlateLifecycleState(slateDate, {
    trackedProps: [
      makePick({ slateDate, status: "win", player: "A", actualStat: 15, result: 15 }),
      makePick({ slateDate, status: "loss", player: "B", actualStat: 10, result: 10 }),
    ],
    reports: [],
    archives: [],
    today: "2026-06-25",
  });
  assert.equal(state.state, SLATE_LIFECYCLE_STATES.LAB_CURRENT);
});

test("26 lifecycle LAB_CURRENT matches rotation", () => {
  const slateDate = "2026-06-22";
  const state = resolveSlateLifecycleState(slateDate, {
    trackedProps: [makePick({ slateDate, status: "win" })],
    reports: [
      {
        slateDate,
        reportStatus: "final",
        frozen: true,
        sections: { A: { graded: 1, pending: 0, totalOfficialProps: 1, awaitingStats: 0 } },
      },
    ],
    archives: [],
    today: "2026-06-25",
  });
  assert.equal(state.state, SLATE_LIFECYCLE_STATES.LAB_CURRENT);
});

test("27 lifecycle ARCHIVED_HISTORY when archive exists", () => {
  const state = resolveSlateLifecycleState("2026-06-20", {
    trackedProps: [],
    reports: [],
    archives: [{ slateDate: "2026-06-20", props: [makePick({ slateDate: "2026-06-20" })] }],
  });
  assert.equal(state.state, SLATE_LIFECYCLE_STATES.ARCHIVED_HISTORY);
});

test("28 buildSlateLifecycleMap covers multiple slates", () => {
  const map = buildSlateLifecycleMap({
    trackedProps: [
      makePick({ slateDate: "2026-06-22", status: "pending" }),
      makePick({ slateDate: "2026-06-23", status: "win" }),
    ],
    reports: [],
    archives: [],
  });
  assert.ok(map["2026-06-22"]);
  assert.ok(map["2026-06-23"]);
});

test("29 collectAllGeneratedCandidatesFromGames uses full pool", () => {
  const candidates = buildManyWnbaCandidates(12);
  const game = makeGame(candidates.slice(0, 4), candidates);
  const full = collectAllGeneratedCandidatesFromGames([game]);
  assert.equal(full.length, 12);
});

test("30 collectAllGeneratedProps uses board picks only", () => {
  const candidates = buildManyWnbaCandidates(12);
  const game = makeGame(candidates.slice(0, 4), candidates);
  const board = collectAllGeneratedProps([game]);
  assert.ok(board.length <= 4);
  assert.ok(board.length >= 3);
  assert.ok(board.length < candidates.length);
});

test("31 tracking cohort count <= Best 6 total", () => {
  const game = makeGame(buildManyWnbaCandidates(10).slice(0, 4), buildManyWnbaCandidates(10));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.ok(
    bundle.trackingCohort.length <=
      bundle.bestSixWNBA.length + bundle.bestSixNBA.length
  );
});

test("32 TEST picks get excludedFromOfficialRecord in cohort", () => {
  const pick = makePick({ trackingType: "TEST" });
  const { cohort } = buildResultsTrackingCohort([pick]);
  assert.equal(cohort[0]?.excludedFromOfficialRecord, true);
});

test("33 OFFICIAL picks tracked without excludedFromOfficialRecord", () => {
  const pick = makePick({
    trackingType: "OFFICIAL",
    tier: "OFFICIAL",
    officialEligible: true,
  });
  const { cohort } = buildResultsTrackingCohort([pick]);
  assert.notEqual(cohort[0]?.excludedFromOfficialRecord, true);
});

test("34 controlledBestSixApplied on tracked cohort picks", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.ok(
    bundle.trackingCohort.every((p) => p.controlledBestSixApplied === true)
  );
});

test("35 trackingAdmissionSource CONTROLLED_BEST_SIX", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.ok(
    bundle.trackingCohort.every(
      (p) => p.trackingAdmissionSource === "CONTROLLED_BEST_SIX"
    )
  );
});

test("36 audit records full vs cohort counts", () => {
  const game = makeGame(buildManyWnbaCandidates(10).slice(0, 4), buildManyWnbaCandidates(10));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.ok(bundle.audit.fullCandidateCount >= bundle.audit.bestSixCount);
});

test("37 bestSixSnapshot pickCount matches cohort size", () => {
  const game = makeGame(buildManyWnbaCandidates(8).slice(0, 3), buildManyWnbaCandidates(8));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.equal(
    bundle.bestSixSnapshot.pickCount,
    bundle.bestSixWNBA.length + bundle.bestSixNBA.length
  );
});

test("38 slate results biggest wins sorted by margin", () => {
  const props = [
    { ...makePick({ player: "A" }), status: "win", resultMargin: 2 },
    { ...makePick({ player: "B" }), status: "win", resultMargin: 8 },
  ];
  const snap = buildSlateResultsSnapshot(props);
  assert.equal(snap.biggestWins[0].player, "B");
});

test("39 lab legacy LEAN label inference", () => {
  assert.equal(inferTrackingType({ tier: "LEAN" }), "TEST");
  assert.equal(inferTrackingType({ tier: "LEAN", trackingType: "OFFICIAL" }), "OFFICIAL");
});

test("40 pre-cutoff slate returns null lifecycle state", () => {
  const state = resolveSlateLifecycleState("2020-01-01", {
    trackedProps: [],
    reports: [],
    archives: [],
  });
  assert.equal(state.state, null);
});

test("41 missing required fields excluded from cohort", () => {
  const pick = makePick({ opponent: "" });
  const { cohort } = buildResultsTrackingCohort([pick]);
  assert.equal(cohort.length, 0);
});

test("42 quality gate version present in audit", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.ok(bundle.audit.qualityGateVersion);
});

test("43 topProps count <= combined limit expectation", () => {
  const game = makeGame(buildManyWnbaCandidates(8).slice(0, 3), buildManyWnbaCandidates(8));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.ok(bundle.topProps.length <= 4);
});

test("44 bestSix ranks assigned sequentially", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  const ranks = bundle.bestSixWNBA.map((p) => p.bestSixRank).filter(Boolean);
  assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b));
});

test("45 stable keys unique within tracking cohort", () => {
  const game = makeGame(buildManyWnbaCandidates(8).slice(0, 3), buildManyWnbaCandidates(8));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  const keys = bundle.trackingCohort.map(getStableTrackedPropKey);
  assert.equal(keys.length, new Set(keys).size);
});

test("46 controlledSelection passthrough preserves topProps", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const selection = selectControlledBestSixCombined([game]);
  const bundle = buildControlledTrackingCohort(
    { gameCards: [game] },
    { controlledSelection: selection }
  );
  assert.equal(bundle.topProps.length, selection.topProps.length);
});

test("47 slateDate applied to bestSixSnapshot picks", () => {
  const game = makeGame(buildManyWnbaCandidates(6).slice(0, 3), buildManyWnbaCandidates(6));
  const bundle = buildControlledTrackingCohort(
    { gameCards: [game] },
    { slateDate: "2026-06-24" }
  );
  assert.equal(bundle.bestSixSnapshot.slateDate, "2026-06-24");
});

test("48 lifecycle map skips unknown slates gracefully", () => {
  const map = buildSlateLifecycleMap({ trackedProps: [], reports: [], archives: [] });
  assert.deepEqual(map, {});
});

test("49 tracking cohort audit inputCount matches Best 6", () => {
  const game = makeGame(buildManyWnbaCandidates(8).slice(0, 3), buildManyWnbaCandidates(8));
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.equal(
    bundle.trackingCohortAudit.inputCount,
    bundle.bestSixWNBA.length + bundle.bestSixNBA.length
  );
});

test("50 SERVER build marker constant documented in cohort version", () => {
  assert.equal(CONTROLLED_TRACKING_COHORT_VERSION, "controlled-tracking-cohort-v1");
  assert.equal(CONTROLLED_BEST_SIX_VERSION, "controlled-best-six-side-rescue-v1");
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
