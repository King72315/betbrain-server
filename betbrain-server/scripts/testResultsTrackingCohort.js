/**
 * Results Tracking Cohort unit tests (no prod mutation).
 * Usage: node betbrain-server/scripts/testResultsTrackingCohort.js
 */
import assert from "assert";
import {
  buildResultsTrackingCohort,
  buildTrackingCohortDiagnostics,
  collectAllGeneratedCandidatesFromGames,
  collectAllGeneratedProps,
  getStableTrackedPropKey,
  isOfficialResultsProp,
  isTestTrackingPick,
  TRACKING_COHORT_VERSION,
} from "../services/trackedPropService.js";
import { selectCombinedTopProps } from "../engines/topProps/topPropSelector.js";

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
  ];
  const game = makeGame(candidates.slice(0, 3), candidates);
  const top = selectCombinedTopProps([game]);
  const { cohort } = buildResultsTrackingCohort(collectAllGeneratedCandidatesFromGames([game]));

  assert.ok(top.topProps.length <= 4, "top props capped");
  assert.strictEqual(cohort.length, 6, "cohort uses full candidate pool");
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
  const slateKeys = Object.keys(diag.generatedCandidatesBySlate || {});
  assert.ok(slateKeys.length >= 1);
  assert.ok(diag.generatedCandidatesBySlate[slateKeys[0]] >= 3);
  const reasonSlates = Object.values(diag.notTrackedReasonsBySlate || {});
  const totalReasons = reasonSlates.reduce(
    (sum, slate) => sum + Object.keys(slate).length,
    0
  );
  assert.ok(totalReasons >= 2);
  assert.ok(Array.isArray(diag.trackingAudit));
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
  const { cohort } = buildResultsTrackingCohort(collectAllGeneratedCandidatesFromGames([game]));
  assert.ok(boardProps.length <= 4);
  assert.strictEqual(cohort.length, 8);
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

const tests = [
  ["1 top props limit does not reduce cohort", testTopPropsLimitDoesNotReduceCohort],
  ["2 top pick references do not inflate cohort logic", testTopPickReferencesDoNotIncreaseCount],
  ["3 tracks eligible OFFICIAL and TEST", testTracksEligibleOfficialAndTest],
  ["4 excludes NO_BET", testNoBetExcluded],
  ["5 excludes started games", testStartedExcluded],
  ["6 no double-track stable key", testNoDoubleTrackStableKey],
  ["7 official vs test labeling", testOfficialVsTestLabeling],
  ["8 diagnostics explain exclusions", testDiagnosticsExplainExclusions],
  ["9 NBA path protected", testNbaPathProtected],
  ["10 WNBA v2 metadata persists", testWnbaV2MetadataPersists],
  ["11 board cap smaller than cohort", testBoardCapSmallerThanCohort],
  ["12 opposite-side conflict excluded", testOppositeSideConflictExcluded],
  ["stable key exists", testStableKeyExistsForCohort],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

console.log(`\nAll ${passed} Results Tracking Cohort tests passed.`);
