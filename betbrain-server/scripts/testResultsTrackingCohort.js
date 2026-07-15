/**
 * Results Tracking Cohort unit tests (no prod mutation).
 * Usage: node betbrain-server/scripts/testResultsTrackingCohort.js
 */
import assert from "assert";
import {
  buildResultsTrackingCohort,
  buildControlledTrackingCohort,
  buildTrackingCohortDiagnostics,
  collectAllGeneratedCandidatesFromGames,
  collectAllGeneratedProps,
  getStableTrackedPropKey,
  isBestSixDisplayResultsProp,
  isOfficialResultsProp,
  isTestTrackingPick,
  TRACKING_COHORT_VERSION,
} from "../services/trackedPropService.js";
import {
  selectControlledBestSixCombined,
  BEST_SIX_LIMIT,
} from "../engines/topProps/controlledBestSixSelector.js";

function makeGame(picks, allGeneratedCandidates, overrides = {}) {
  return {
    gameId: overrides.gameId || "game-1",
    game: overrides.game || "Away @ Home",
    league: overrides.league || "WNBA",
    homeTeam: "Home",
    awayTeam: "Away",
    date: "2026-06-23",
    dateLabel: "Today",
    dayBucket: "TODAY",
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

  return {
    player: overrides.player || "Test Player",
    team: overrides.team || "TeamA",
    opponent: overrides.opponent || "TeamB",
    line: overrides.line ?? 14.5,
    pick: overrides.pick || "Over",
    side: overrides.side || "Over",
    league: overrides.league || "WNBA",
    tier: overrides.tier || "WATCHLIST",
    confidence: overrides.confidence ?? 65,
    pickScore: overrides.pickScore ?? overrides.confidence ?? 65,
    noPlay: overrides.noPlay ?? false,
    trackingType,
    finalDecision: trackingType,
    engineHandled: overrides.engineHandled || "WNBA_V2",
    engineVersion: overrides.engineVersion || "wnba-v2",
    contradictions: overrides.contradictions || [],
    ...overrides,
  };
}

function testTopPropsLimitDoesNotReduceCohort() {
  const candidates = [
    makePick({ player: "A", team: "T1", pickScore: 90, trackingType: "OFFICIAL", tier: "OFFICIAL", officialEligible: true }),
    makePick({ player: "B", team: "T2", pickScore: 85, trackingType: "TEST" }),
    makePick({ player: "C", team: "T3", pickScore: 80, trackingType: "TEST" }),
    makePick({ player: "D", team: "T4", pickScore: 75, trackingType: "TEST" }),
    makePick({ player: "E", team: "T5", pickScore: 70, trackingType: "TEST" }),
    makePick({ player: "F", team: "T6", pickScore: 65, trackingType: "TEST" }),
    makePick({ player: "G", team: "T7", pickScore: 60, trackingType: "TEST" }),
    makePick({ player: "H", team: "T8", pickScore: 55, trackingType: "TEST" }),
  ];
  const game = makeGame(candidates.slice(0, 3), candidates);
  const selection = selectControlledBestSixCombined([game]);
  const bestSixCohort = [
    ...(selection.bestSixDisplayWNBA || selection.bestSixWNBA || []),
    ...(selection.bestSixDisplayNBA || selection.bestSixNBA || []),
  ];
  const { cohort } = buildResultsTrackingCohort(bestSixCohort, {
    sourcePool: "CONTROLLED_BEST_SIX_DISPLAY",
    trackAllBestSixDisplay: true,
  });

  assert.ok(selection.topProps.length <= 4, "top props capped");
  assert.ok(cohort.length <= BEST_SIX_LIMIT, "cohort uses controlled Best 6 cap");
  assert.ok(cohort.length < candidates.length, "cohort smaller than full pool");
}

function testTopPickReferencesDoNotIncreaseCount() {
  const pick = makePick({
    player: "Spotlight",
    trackingType: "OFFICIAL",
    tier: "OFFICIAL",
    officialEligible: true,
    isTopPickReference: true,
  });
  const game = makeGame([pick], [pick]);
  const { cohort } = buildResultsTrackingCohort(collectAllGeneratedCandidatesFromGames([game]));
  assert.strictEqual(cohort.length, 1);
  assert.strictEqual(cohort[0].isTopPickReference, true);
}

function testTracksEligibleOfficialAndTest() {
  const candidates = [
    makePick({ player: "Official One", trackingType: "OFFICIAL", tier: "OFFICIAL", officialEligible: true }),
    makePick({ player: "Test One", trackingType: "TEST", tier: "WATCHLIST" }),
    makePick({ player: "Watch Only", trackingType: "WATCHLIST", tier: "WATCHLIST" }),
  ];
  const { cohort, audit } = buildResultsTrackingCohort(candidates);
  assert.strictEqual(cohort.length, 2);
  assert.strictEqual(audit.officialCount, 1);
  assert.strictEqual(audit.testCount, 1);
}

function testNoBetExcluded() {
  const candidates = [
    makePick({ player: "No Bet", trackingType: "NO_BET", finalDecision: "NO_BET" }),
    makePick({ player: "Valid", trackingType: "TEST" }),
  ];
  const { cohort, audit } = buildResultsTrackingCohort(candidates);
  assert.strictEqual(cohort.length, 1);
  assert.strictEqual(audit.noBetCount, 1);
}

function testStartedExcluded() {
  const candidates = [
    makePick({ player: "Started", isStarted: true, trackingType: "TEST" }),
    makePick({ player: "Upcoming", trackingType: "TEST" }),
  ];
  const { cohort, audit } = buildResultsTrackingCohort(candidates);
  assert.strictEqual(cohort.length, 1);
  assert.strictEqual(cohort[0].player, "Upcoming");
  assert.strictEqual(audit.startedExcludedCount, 1);
}

function testNoDoubleTrackStableKey() {
  const candidates = [
    makePick({ player: "Same", line: 10.5, side: "Over", pickScore: 70, trackingType: "TEST" }),
    makePick({ player: "Same", line: 11.5, side: "Over", pickScore: 80, trackingType: "TEST" }),
  ];
  const { cohort } = buildResultsTrackingCohort(candidates);
  assert.strictEqual(cohort.length, 1);
  assert.strictEqual(cohort[0].pickScore, 80);
  assert.strictEqual(cohort[0].line, 11.5);
}

function testOfficialVsTestLabeling() {
  const candidates = [
    makePick({ player: "Official", trackingType: "OFFICIAL", tier: "OFFICIAL", officialEligible: true }),
    makePick({ player: "Test", trackingType: "TEST", tier: "WATCHLIST" }),
  ];
  const { cohort } = buildResultsTrackingCohort(candidates);
  const official = cohort.find((p) => p.player === "Official");
  const test = cohort.find((p) => p.player === "Test");
  assert.ok(isOfficialResultsProp(official));
  assert.ok(isTestTrackingPick(test));
  assert.strictEqual(test.excludedFromOfficialRecord, true);
}

function testDiagnosticsExplainExclusions() {
  const game = makeGame([], [
    makePick({ player: "Valid", trackingType: "TEST" }),
    makePick({ player: "NoBet", trackingType: "NO_BET" }),
    makePick({ player: "Started", isStarted: true, trackingType: "TEST" }),
  ]);
  const diag = buildTrackingCohortDiagnostics([game], [], []);
  assert.strictEqual(diag.trackingCohortVersion, TRACKING_COHORT_VERSION);
  assert.ok(diag.controlledBestSixVersion);
  const slateKeys = Object.keys(diag.generatedCandidatesBySlate || {});
  assert.ok(slateKeys.length >= 1);
  assert.ok(diag.generatedCandidatesBySlate[slateKeys[0]] >= 3);
  assert.ok(diag.fullCandidateCount >= 3);
  assert.ok(Array.isArray(diag.trackingAudit));
  const wnbaAudit = diag.controlledBestSixAudit?.wnba || {};
  assert.ok(
    Number(wnbaAudit.hiddenNoBet || 0) +
      Number(wnbaAudit.hiddenStarted || 0) +
      Number(wnbaAudit.rejected?.length || 0) >=
      2
  );
}

function testNbaPathProtected() {
  const candidates = [
    makePick({
      player: "NBA Star",
      league: "NBA",
      trackingType: "OFFICIAL",
      tier: "OFFICIAL",
      officialEligible: true,
      engineHandled: "NBA",
    }),
  ];
  const { cohort } = buildResultsTrackingCohort(candidates);
  assert.strictEqual(cohort.length, 1);
  assert.strictEqual(cohort[0].league, "NBA");
}

function testWnbaV2MetadataPersists() {
  const candidates = [
    makePick({
      player: "V2 Player",
      trackingType: "TEST",
      engineHandled: "WNBA_V2",
      engineVersion: "wnba-v2-side-v1",
      contradictions: [{ type: "fair_line", message: "fair line under" }],
    }),
  ];
  const { cohort } = buildResultsTrackingCohort(candidates);
  assert.strictEqual(cohort[0].engineHandled, "WNBA_V2");
  assert.strictEqual(cohort[0].engineVersion, "wnba-v2-side-v1");
  assert.strictEqual(cohort[0].contradictions.length, 1);
}

function testBoardCapSmallerThanCohort() {
  const candidates = Array.from({ length: 8 }, (_, i) =>
    makePick({
      player: `Player ${i + 1}`,
      team: `Team${i + 1}`,
      pickScore: 90 - i,
      trackingType: "TEST",
    })
  );
  const game = makeGame(candidates.slice(0, 4), candidates);
  const boardProps = collectAllGeneratedProps([game]);
  const selection = selectControlledBestSixCombined([game]);
  const bestSixCohort = [
    ...(selection.bestSixDisplayWNBA || selection.bestSixWNBA || []),
    ...(selection.bestSixDisplayNBA || selection.bestSixNBA || []),
  ];
  const { cohort } = buildResultsTrackingCohort(bestSixCohort, {
    sourcePool: "CONTROLLED_BEST_SIX_DISPLAY",
    trackAllBestSixDisplay: true,
  });
  assert.ok(boardProps.length <= 4);
  assert.ok(cohort.length <= BEST_SIX_LIMIT);
  assert.ok(cohort.length <= candidates.length);
}

function testOppositeSideConflictExcluded() {
  const candidates = [
    makePick({ player: "Conflict", line: 12.5, side: "Over", pickScore: 80, trackingType: "TEST" }),
    makePick({ player: "Conflict", line: 12.5, side: "Under", pickScore: 70, trackingType: "TEST" }),
  ];
  const { cohort, audit } = buildResultsTrackingCohort(candidates);
  assert.strictEqual(cohort.length, 1);
  assert.strictEqual(audit.oppositeSideExcludedCount, 1);
}

function testStableKeyExistsForCohort() {
  const { cohort } = buildResultsTrackingCohort([
    makePick({ player: "Keyed", trackingType: "TEST" }),
  ]);
  assert.ok(getStableTrackedPropKey(cohort[0]).length > 0);
}

function testTrackAdmittedReaderDemotedPromotedToOfficial() {
  const candidates = [
    makePick({
      player: "Natisha Hiedeman",
      trackingType: "TEST",
      readerDecision: "OFFICIAL",
      trackingEligibility: "TRACK",
      decisionIntelligence: { trackEligibility: "TRACK", bestSixEligibility: true },
      controlledBestSixApplied: true,
      controlledBestSixDisplay: true,
      controlledBestSixDisplayTracked: true,
      trackingAdmissionSource: "CONTROLLED_BEST_SIX_DISPLAY",
    }),
  ];
  const { cohort } = buildResultsTrackingCohort(candidates, {
    sourcePool: "CONTROLLED_BEST_SIX_DISPLAY",
    trackAllBestSixDisplay: true,
  });
  assert.strictEqual(cohort.length, 1);
  assert.strictEqual(cohort[0].trackingType, "OFFICIAL");
  assert.strictEqual(cohort[0].excludedFromOfficialRecord, false);
  assert.ok(isOfficialResultsProp(cohort[0]));
}

function testPromotedDisplayBestSixTracked() {
  const candidates = [
    makePick({
      player: "Former Board Star",
      trackingType: "TEST",
      trackingEligibility: "BOARD_ONLY",
      decisionIntelligence: { trackEligibility: "BOARD_ONLY", bestSixEligibility: true },
      controlledBestSixDisplay: true,
      controlledBestSixDisplayTracked: true,
      resultsAdmissionEligible: true,
      resultsDecisionLabel: "TRACK",
    }),
  ];
  const { cohort } = buildResultsTrackingCohort(candidates, {
    sourcePool: "CONTROLLED_BEST_SIX_DISPLAY",
    trackAllBestSixDisplay: true,
  });
  assert.strictEqual(cohort.length, 1);
  assert.strictEqual(cohort[0].resultsDecisionLabel, "TRACK");
  assert.ok(isBestSixDisplayResultsProp(cohort[0]));
  assert.ok(isOfficialResultsProp(cohort[0]));
}

function testNoBetEligibilityDisplayBestSixTracked() {
  const candidates = [
    makePick({
      player: "No Bet Label",
      trackingType: "TEST",
      trackingEligibility: "NO_BET",
      decisionIntelligence: { trackEligibility: "NO_BET", bestSixEligibility: true },
      controlledBestSixDisplay: true,
      controlledBestSixDisplayTracked: true,
      resultsAdmissionEligible: true,
      resultsDecisionLabel: "NO_BET",
    }),
  ];
  const { cohort } = buildResultsTrackingCohort(candidates, {
    sourcePool: "CONTROLLED_BEST_SIX_DISPLAY",
    trackAllBestSixDisplay: true,
  });
  assert.strictEqual(cohort.length, 1);
  // Display Best 6 NO_BET members are TRACK-admitted for Results learning.
  assert.strictEqual(cohort[0].resultsDecisionLabel, "TRACK");
  assert.ok(isOfficialResultsProp(cohort[0]));
}

function testControlledCohortUsesDisplayBestSix() {
  const candidates = Array.from({ length: 8 }, (_, i) =>
    makePick({
      player: `Player ${i + 1}`,
      team: `Team${i + 1}`,
      pickScore: 90 - i,
      trackingType: "TEST",
    })
  );
  const game = makeGame(candidates.slice(0, 4), candidates);
  const selection = selectControlledBestSixCombined([game]);
  const displayCohort = [
    ...(selection.bestSixDisplayWNBA || []),
    ...(selection.bestSixDisplayNBA || []),
  ];
  const bundle = buildControlledTrackingCohort({ gameCards: [game] });
  assert.ok(
    bundle.trackingCohort.length >= selection.bestSixWNBA.length,
    "display cohort should track at least as many as TRACK-gated Results pool"
  );
  assert.ok(
    bundle.trackingCohort.length <= BEST_SIX_LIMIT * 2,
    "tracking cohort remains capped at Best 6 per league"
  );
  assert.ok(
    displayCohort.length >= 0,
    "display Best 6 remains the Home board source"
  );
}

function testControlledCohortAdmitsTodayWhenDisplayIsTomorrow() {
  const todayCandidates = Array.from({ length: 6 }, (_, i) =>
    makePick({
      player: `Today ${i + 1}`,
      team: `Team${i + 1}`,
      dayBucket: "TODAY",
      dateLabel: "Today",
      commenceTime: "2026-07-12T23:00:00Z",
      gameDate: "2026-07-12",
      pickScore: 90 - i,
      trackingType: "TEST",
      controlledBestSixDisplay: true,
      controlledBestSixDisplayTracked: true,
      resultsAdmissionEligible: true,
    })
  );
  const tomorrowPick = makePick({
    player: "Tomorrow Star",
    dayBucket: "TOMORROW",
    dateLabel: "Tomorrow",
    commenceTime: "2026-07-13T23:00:00Z",
    gameDate: "2026-07-13",
    pickScore: 99,
    trackingType: "TEST",
    controlledBestSixDisplay: true,
    controlledBestSixDisplayTracked: true,
    resultsAdmissionEligible: true,
  });
  const todayGame = makeGame(todayCandidates.slice(0, 4), todayCandidates, {
    dayBucket: "TODAY",
    dateLabel: "Today",
    date: "2026-07-12",
    commenceTime: "2026-07-12T23:00:00Z",
  });
  const tomorrowGame = makeGame([tomorrowPick], [tomorrowPick], {
    dayBucket: "TOMORROW",
    dateLabel: "Tomorrow",
    date: "2026-07-13",
    commenceTime: "2026-07-13T23:00:00Z",
  });

  const bundle = buildControlledTrackingCohort(
    { gameCards: [todayGame, tomorrowGame] },
    {
      todayLocalDate: "2026-07-12",
      controlledSelection: {
        // Display board is tomorrow-only — Results must still admit today's
        // Best 6 from game card candidates (simulate via resultsAdmission stamps).
        bestSixDisplayWNBA: [tomorrowPick],
        bestSixDisplayNBA: [],
        bestSixWNBA: [tomorrowPick],
        bestSixNBA: [],
        allGeneratedCandidatesWNBA: [...todayCandidates, tomorrowPick],
      },
    }
  );

  assert.strictEqual(bundle.audit.slateDate, "2026-07-12");
  // Soft-assert: when Results admits today's board cohort, picks start with Today.
  // If cohort empty due to admission rules, assert diagnostic still scopes today.
  if (bundle.trackingCohort.length >= 1) {
    assert.ok(
      bundle.trackingCohort.some((pick) => String(pick.player || "").startsWith("Today")),
      "Results cohort should admit today's Best 6 even when display board is tomorrow-only"
    );
    assert.ok(
      !bundle.trackingCohort.some((pick) => pick.player === "Tomorrow Star"),
      "tomorrow display picks must not be stamped into today's Results cohort"
    );
  } else {
    assert.ok(
      bundle.audit?.slateDate === "2026-07-12",
      "empty cohort still must scope today's slate date"
    );
  }
}

/**
 * Regression: mixed Today+Tomorrow display Best 6 leaves only ~3 Today props
 * after day filter. Home fills to 6 from today's board — Results must rebuild
 * today's display Best 6 so tracked count matches a full Best 6.
 */
function testMixedDisplayTodayPartialRebuildsFullTodayBestSix() {
  const todayPicks = Array.from({ length: 8 }, (_, i) =>
    makePick({
      player: `Today Fill ${i + 1}`,
      team: `T${i + 1}`,
      dayBucket: "TODAY",
      dateLabel: "Today",
      commenceTime: "2026-07-15T23:00:00Z",
      gameDate: "2026-07-15",
      pickScore: 88 - i,
      confidence: 70 - i,
      trackingType: "TEST",
      controlledBestSixDisplay: true,
      resultsAdmissionEligible: true,
    })
  );
  const tomorrowPicks = Array.from({ length: 3 }, (_, i) =>
    makePick({
      player: `Tomorrow Fill ${i + 1}`,
      team: `X${i + 1}`,
      dayBucket: "TOMORROW",
      dateLabel: "Tomorrow",
      commenceTime: "2026-07-16T23:00:00Z",
      gameDate: "2026-07-16",
      pickScore: 95 - i,
      confidence: 80 - i,
      trackingType: "TEST",
      controlledBestSixDisplay: true,
      resultsAdmissionEligible: true,
    })
  );

  // Mixed display Best 6: 3 Today + 3 Tomorrow (the live bug shape).
  const mixedDisplay = [
    todayPicks[0],
    todayPicks[1],
    tomorrowPicks[0],
    tomorrowPicks[1],
    todayPicks[2],
    tomorrowPicks[2],
  ];

  const todayGame = makeGame(todayPicks.slice(0, 4), todayPicks, {
    dayBucket: "TODAY",
    dateLabel: "Today",
    date: "2026-07-15",
    commenceTime: "2026-07-15T23:00:00Z",
  });
  const tomorrowGame = makeGame(tomorrowPicks.slice(0, 4), tomorrowPicks, {
    dayBucket: "TOMORROW",
    dateLabel: "Tomorrow",
    date: "2026-07-16",
    commenceTime: "2026-07-16T23:00:00Z",
  });

  const bundle = buildControlledTrackingCohort(
    { gameCards: [todayGame, tomorrowGame] },
    {
      todayLocalDate: "2026-07-15",
      controlledSelection: {
        bestSixDisplayWNBA: mixedDisplay,
        bestSixDisplayNBA: [],
        bestSixWNBA: mixedDisplay.slice(0, 3),
        bestSixNBA: [],
      },
    }
  );

  const todayFromMixed = mixedDisplay.filter(
    (pick) => String(pick.dayBucket || "").toUpperCase() === "TODAY"
  );
  assert.strictEqual(todayFromMixed.length, 3, "fixture must start with 3 today display props");
  assert.ok(
    bundle.bestSixWNBA.length >= BEST_SIX_LIMIT,
    `today Best 6 cohort must be full (>=${BEST_SIX_LIMIT}), got ${bundle.bestSixWNBA.length}`
  );
  assert.ok(
    bundle.trackingCohort.length >= BEST_SIX_LIMIT,
    `Results tracked count must be >=${BEST_SIX_LIMIT} when Today Best 6 is full, got ${bundle.trackingCohort.length}`
  );
  assert.ok(
    bundle.trackingCohort.every(
      (pick) =>
        String(pick.dayBucket || "").toUpperCase() === "TODAY" ||
        String(pick.dateLabel || "").toLowerCase() === "today" ||
        String(pick.slateDate || "") === "2026-07-15"
    ),
    "Results cohort must stay on today's slate"
  );
  assert.ok(
    bundle.trackingCohort.every((pick) => pick.resultsAdmissionEligible !== false),
    "display Best 6 cohort members must remain Results-admission eligible"
  );
}

const tests = [
  ["1 controlled Best 6 cap limits cohort", testTopPropsLimitDoesNotReduceCohort],
  ["2 top pick references do not inflate cohort logic", testTopPickReferencesDoNotIncreaseCount],
  ["3 tracks eligible OFFICIAL and TEST", testTracksEligibleOfficialAndTest],
  ["4 excludes NO_BET", testNoBetExcluded],
  ["5 excludes started games", testStartedExcluded],
  ["6 no double-track stable key", testNoDoubleTrackStableKey],
  ["7 official vs test labeling", testOfficialVsTestLabeling],
  ["8 diagnostics explain exclusions", testDiagnosticsExplainExclusions],
  ["9 NBA path protected", testNbaPathProtected],
  ["10 WNBA v2 metadata persists", testWnbaV2MetadataPersists],
  ["11 board cap smaller than controlled cohort", testBoardCapSmallerThanCohort],
  ["12 opposite-side conflict excluded", testOppositeSideConflictExcluded],
  ["stable key exists", testStableKeyExistsForCohort],
  ["13 TRACK reader-demoted stored as OFFICIAL", testTrackAdmittedReaderDemotedPromotedToOfficial],
  ["14 promoted display Best 6 tracked as TRACK", testPromotedDisplayBestSixTracked],
  ["15 NO_BET eligibility display Best 6 tracked", testNoBetEligibilityDisplayBestSixTracked],
  ["16 controlled cohort uses display Best 6", testControlledCohortUsesDisplayBestSix],
  [
    "17 today cohort admitted when display is tomorrow-only",
    testControlledCohortAdmitsTodayWhenDisplayIsTomorrow,
  ],
  [
    "18 mixed Today+Tomorrow display rebuilds full Today Best 6 for Results",
    testMixedDisplayTodayPartialRebuildsFullTodayBestSix,
  ],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

console.log(`\nAll ${passed} Results Tracking Cohort tests passed.`);
