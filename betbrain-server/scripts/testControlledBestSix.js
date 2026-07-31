/**
 * Controlled Best 6 unit tests (no prod mutation).
 * Usage: node betbrain-server/scripts/testControlledBestSix.js
 */
import assert from "assert";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

import { getPickScore } from "../engines/pickRanker.js";
import {
  evaluateWnbaTrackingEligibility,
} from "../engines/wnba/wnbaResultsQualityGate.js";
import { scoreNbaTopProp } from "../engines/topProps/nbaTopPropScore.js";
import {
  selectControlledBestSix,
  selectControlledBestSixCombined,
  selectBestSixDisplay,
  selectTopTwoFromBestSix,
  BEST_SIX_LIMIT,
  CONTROLLED_BEST_SIX_VERSION,
} from "../engines/topProps/controlledBestSixSelector.js";
import { getPickTeamKey } from "../engines/topProps/topPropSelector.js";
import {
  buildBestSixReview,
  buildTopPicksReview,
  saveBestSixSnapshot,
  saveTopPicksSnapshot,
} from "../services/topPicksSnapshotService.js";
import {
  buildResultsTrackingCohort,
  buildTrackingCohortDiagnostics,
  getStableTrackedPropKey,
} from "../services/trackedPropService.js";
import { buildSlateResultsSnapshot } from "../services/slateResultsSnapshot.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

function makeGame(picks, allGeneratedCandidates, overrides = {}) {
  return {
    gameId: overrides.gameId || "game-1",
    game: overrides.game || "Away @ Home",
    league: overrides.league || "WNBA",
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

function makeWnbaPick(overrides = {}) {
  const reader = {
    finalSide: "OVER",
    decision: overrides.readerDecision || "TEST",
    readerConfidence: overrides.readerConfidence ?? 68,
    supports: ["Volume path supports over"],
    overCase: { score: overrides.overScore ?? 50 },
    underCase: { score: overrides.underScore ?? 20 },
    ...overrides.reader,
  };

  return {
    player: overrides.player || "Test Player",
    team: overrides.team || "TeamA",
    opponent: "TeamB",
    line: overrides.line ?? 14.5,
    pick: "Over",
    side: "Over",
    league: "WNBA",
    tier: overrides.tier || "WATCHLIST",
    confidence: overrides.confidence ?? 65,
    noPlay: false,
    engineHandled: "WNBA_V2",
    officialEligible: overrides.officialEligible ?? false,
    finalDecision: overrides.finalDecision || "TEST",
    trackingType: overrides.trackingType || "TEST",
    readerDecision: reader.decision,
    wnbaReader: reader,
    wnbaDataCard: {
      playerId: overrides.playerId ?? "test-player-1",
      bookLine: overrides.line ?? 14.5,
      dataConfidenceScore: overrides.dataConfidenceScore ?? 72,
      projection: { projection: overrides.projection ?? 19, expectedMinutes: 30, expectedFGA: 12 },
      season: { points: 16, minutes: 28, fga: 11, ptsPerFGA: 1.05 },
      last5: { points: 17, minutes: 30, fga: 12, ptsPerFGA: 1.05, games: 5 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 70 },
      bookCount: 5,
      marketQuality: 70,
      minutesVolatility: "stable",
      dataMissingFlags: overrides.missingFlags || [],
      ...overrides.wnbaDataCard,
    },
    ...overrides,
  };
}

function makeNbaPick(overrides = {}) {
  return {
    player: overrides.player || "NBA Player",
    team: overrides.team || "LAL",
    opponent: "BOS",
    line: overrides.line ?? 24.5,
    pick: "Over",
    side: "Over",
    league: "NBA",
    tier: overrides.tier || "PREMIUM",
    confidence: overrides.confidence ?? 78,
    netEdge: overrides.netEdge ?? 8,
    noPlay: false,
    ...overrides,
  };
}

function testWnbaBestSixMaxSix() {
  const picks = Array.from({ length: 10 }, (_, i) =>
    makeWnbaPick({
      player: `P${i}`,
      team: `Team${i}`,
      overScore: 90 - i,
      line: 10 + i,
    })
  );
  const { bestSix } = selectControlledBestSix(picks, "WNBA");
  assert.ok(bestSix.length <= BEST_SIX_LIMIT);
}

function testNbaBestSixMaxSix() {
  const picks = Array.from({ length: 10 }, (_, i) =>
    makeNbaPick({
      player: `P${i}`,
      team: `T${i}`,
      confidence: 90 - i,
      line: 20 + i,
    })
  );
  const { bestSix } = selectControlledBestSix(picks, "NBA");
  assert.ok(bestSix.length <= BEST_SIX_LIMIT);
}

function testTopWnbaMaxTwo() {
  const picks = Array.from({ length: 6 }, (_, i) =>
    makeWnbaPick({ player: `P${i}`, team: `Team${i}`, overScore: 80 - i, line: 10 + i })
  );
  const { bestSix } = selectControlledBestSix(picks, "WNBA");
  const { topProps } = selectTopTwoFromBestSix(bestSix, "WNBA");
  assert.ok(topProps.length <= 2);
}

function testTopNbaMaxTwo() {
  const picks = Array.from({ length: 6 }, (_, i) =>
    makeNbaPick({ player: `P${i}`, team: `T${i}`, confidence: 80 - i, line: 20 + i })
  );
  const { bestSix } = selectControlledBestSix(picks, "NBA");
  const { topProps } = selectTopTwoFromBestSix(bestSix, "NBA");
  assert.ok(topProps.length <= 2);
}

function testTopWnbaFromBestSixOnly() {
  const picks = [
    makeWnbaPick({ player: "A", team: "T1", overScore: 90, line: 10.5 }),
    makeWnbaPick({ player: "B", team: "T2", overScore: 85, line: 11.5 }),
    makeWnbaPick({ player: "C", team: "T3", overScore: 80, line: 12.5 }),
  ];
  const game = makeGame(picks.slice(0, 1), picks);
  const result = selectControlledBestSixCombined([game]);
  const displayKeys = new Set(result.bestSixDisplayWNBA.map((p) => p.player));
  for (const top of result.topWNBAProps) {
    assert.ok(displayKeys.has(top.player));
  }
}

function testTopNbaFromBestSixOnly() {
  const picks = [
    makeNbaPick({ player: "A", team: "LAL", confidence: 90 }),
    makeNbaPick({ player: "B", team: "BOS", confidence: 85 }),
  ];
  const game = makeGame(picks, picks, { league: "NBA" });
  const result = selectControlledBestSixCombined([game]);
  const displayKeys = new Set(result.bestSixDisplayNBA.map((p) => p.player));
  for (const top of result.topNBAProps) {
    assert.ok(displayKeys.has(top.player));
  }
}

function testTopWnbaDifferentTeams() {
  const picks = [
    makeWnbaPick({ player: "A", team: "Mystics", overScore: 90 }),
    makeWnbaPick({ player: "B", team: "Mercury", overScore: 85 }),
  ];
  const { bestSix } = selectControlledBestSix(picks, "WNBA");
  const { topProps } = selectTopTwoFromBestSix(bestSix, "WNBA");
  if (topProps.length === 2) {
    assert.notStrictEqual(getPickTeamKey(topProps[0]), getPickTeamKey(topProps[1]));
  }
}

function testTopNbaDifferentTeams() {
  const picks = [
    makeNbaPick({ player: "A", team: "LAL", confidence: 90 }),
    makeNbaPick({ player: "B", team: "BOS", confidence: 85 }),
  ];
  const { bestSix } = selectControlledBestSix(picks, "NBA");
  const { topProps } = selectTopTwoFromBestSix(bestSix, "NBA");
  if (topProps.length === 2) {
    assert.notStrictEqual(getPickTeamKey(topProps[0]), getPickTeamKey(topProps[1]));
  }
}

function testNoDifferentTeamCandidate() {
  // Top-2 same-team constraint: when Best 6 only has one team, take one Top pick.
  // (Selection integrity may demote a second same-team Over before Best 6; test Top-2 directly.)
  const bestSix = [
    {
      ...makeWnbaPick({ player: "A", team: "Mystics", overScore: 90, confidence: 90 }),
      bestSixRank: 1,
      controlledBestSixRank: 1,
      bestPropScore: 90,
      decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
    },
    {
      ...makeWnbaPick({ player: "B", team: "Mystics", overScore: 85, confidence: 85 }),
      bestSixRank: 2,
      controlledBestSixRank: 2,
      bestPropScore: 85,
      decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
    },
  ];
  const { topProps, audit } = selectTopTwoFromBestSix(bestSix, "WNBA");
  assert.strictEqual(topProps.length, 1);
  assert.strictEqual(audit.noDifferentTeamCandidate, true);
}

function testTopTwoPicksSafestNotDisplayRank() {
  const display = [
    {
      ...makeWnbaPick({ player: "Best Rank", team: "T1", overScore: 92, confidence: 90 }),
      bestSixRank: 1,
      controlledBestSixRank: 1,
      decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "LOW", riskDebts: [] },
    },
    {
      ...makeWnbaPick({ player: "Weak Rank Two", team: "T2", overScore: 70, confidence: 55 }),
      bestSixRank: 2,
      controlledBestSixRank: 2,
      decisionIntelligence: {
        trackEligibility: "TRACK",
        trueRisk: "HIGH",
        riskDebts: [{ code: "THIN_EDGE" }, { code: "VOLATILE_MINUTES" }],
        dangerGateCount: 3,
        bestSixPromoted: true,
      },
    },
    {
      ...makeWnbaPick({ player: "Safer Rank Three", team: "T3", overScore: 85, confidence: 82 }),
      bestSixRank: 3,
      controlledBestSixRank: 3,
      decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM", riskDebts: [] },
    },
  ];
  const { topProps } = selectTopTwoFromBestSix(display, "WNBA");
  assert.strictEqual(topProps.length, 2);
  assert.strictEqual(topProps[0].player, "Best Rank");
  assert.strictEqual(topProps[1].player, "Safer Rank Three");
  assert.notStrictEqual(topProps[1].player, "Weak Rank Two");
}

function testTopTwoIncludesPromotedDisplayRanks() {
  const display = [
    {
      ...makeWnbaPick({ player: "Track Star", team: "T1", overScore: 92 }),
      decisionIntelligence: { trackEligibility: "TRACK", topPickEligibility: false },
    },
    {
      ...makeWnbaPick({ player: "Board Star", team: "T2", overScore: 88 }),
      decisionIntelligence: { trackEligibility: "BOARD_ONLY", topPickEligibility: false },
    },
  ];
  const { topProps } = selectTopTwoFromBestSix(display, "WNBA");
  assert.strictEqual(topProps.length, 2);
  assert.strictEqual(topProps[0].player, "Track Star");
  assert.strictEqual(topProps[1].player, "Board Star");
  assert.strictEqual(topProps[1].topPickLabel, "Top WNBA #2");
}

function testUsesFullCandidatePool() {
  const full = Array.from({ length: 8 }, (_, i) =>
    makeWnbaPick({
      player: `P${i}`,
      team: `Team${i}`,
      overScore: 90 - i,
      line: 10 + i,
    })
  );
  const game = makeGame(full.slice(0, 2), full);
  const result = selectControlledBestSixCombined([game]);
  assert.ok(result.bestSixWNBA.length > 2);
  assert.ok(result.controlledBestSixAudit.candidateCount >= 8);
}

function testQualityGateBlocksTrash() {
  const blocked = makeWnbaPick({
    player: "Blocked",
    team: "T1",
    overScore: 40,
    readerDecision: "TEST",
    finalDecision: "TEST",
    trackingType: "TEST",
    netEdge: 3,
    wnbaDataCard: {
      bookLine: 14.5,
      dataConfidenceScore: 40,
      projection: { projection: 12 },
      last5: { points: 10, minutes: 20, fga: 6 },
      bookCount: 1,
      marketQuality: 40,
      dataMissingFlags: [],
      roleTrend: "down",
      minutesVolatility: "volatile",
    },
    wnbaReader: {
      decision: "TEST",
      finalSide: "OVER",
      readerConfidence: 40,
      margin: 3,
      overCase: { score: 40 },
      underCase: { score: 20 },
    },
  });
  const gate = evaluateWnbaTrackingEligibility(
    blocked,
    blocked.wnbaDataCard,
    blocked.wnbaReader
  );
  assert.notStrictEqual(gate.trackingEligibility, "TRACK");

  const good = makeWnbaPick({ player: "Good", team: "T2", overScore: 80, line: 11.5 });
  const { bestSix, controlledBestSixAudit } = selectControlledBestSix(
    [blocked, good],
    "WNBA"
  );
  assert.ok(!bestSix.some((p) => p.player === "Blocked"));
  assert.ok(controlledBestSixAudit.hiddenDueToQualityGate >= 1);
}

function testExcludesInvalidCandidates() {
  const picks = [
    makeWnbaPick({ player: "Valid", team: "T1", overScore: 80 }),
    makeWnbaPick({
      player: "NoBet",
      team: "T2",
      noPlay: true,
      readerDecision: "NO_BET",
      finalDecision: "NO_BET",
    }),
    makeWnbaPick({ player: "Started", team: "T3", isStarted: true }),
  ];
  const { bestSix } = selectControlledBestSix(picks, "WNBA");
  assert.strictEqual(bestSix.length, 1);
  assert.strictEqual(bestSix[0].player, "Valid");
}

function testBestSixNoDuplicateTrackedKeys() {
  const picks = [
    makeWnbaPick({ player: "Same", team: "T1", line: 10.5, overScore: 80 }),
    makeWnbaPick({ player: "Same", team: "T1", line: 11.5, overScore: 70 }),
  ];
  const { bestSix } = selectControlledBestSix(picks, "WNBA");
  const keys = bestSix.map(getStableTrackedPropKey);
  assert.strictEqual(new Set(keys).size, keys.length);
}

function testTopPicksNoDuplicateTrackedKeys() {
  const picks = Array.from({ length: 4 }, (_, i) =>
    makeWnbaPick({ player: `P${i}`, team: `Team${i}`, overScore: 80 - i, line: 10 + i })
  );
  const game = makeGame(picks, picks);
  const result = selectControlledBestSixCombined([game]);
  const keys = result.topProps.map(getStableTrackedPropKey);
  assert.strictEqual(new Set(keys).size, keys.length);
}

function testResultsTracksBestSixOnly() {
  const candidates = Array.from({ length: 8 }, (_, i) =>
    makeWnbaPick({
      player: `P${i}`,
      team: `Team${i}`,
      overScore: 90 - i,
      line: 10 + i,
      trackingType: "TEST",
    })
  );
  const game = makeGame(candidates.slice(0, 3), candidates);
  const selection = selectControlledBestSixCombined([game]);
  const bestSixCohort = [...selection.bestSixWNBA, ...selection.bestSixNBA];
  const { cohort } = buildResultsTrackingCohort(bestSixCohort, {
    sourcePool: "CONTROLLED_BEST_SIX",
  });
  assert.ok(cohort.length <= BEST_SIX_LIMIT);
  assert.ok(cohort.length < candidates.length);
}

function testLabReviewsReferenceOriginalProps() {
  const slateDate = "2026-06-23";
  const pick = makeWnbaPick({ player: "Lab Player", team: "Mystics", overScore: 88 });
  saveBestSixSnapshot([pick], { slateDate });
  saveTopPicksSnapshot([{ ...pick, topPickLabel: "Top WNBA #1" }], { slateDate });
  const key = getStableTrackedPropKey(pick);
  const tracked = [{ ...pick, trackedKey: key, status: "win", slateDate }];
  const bestSixReview = buildBestSixReview(slateDate, tracked);
  const topReview = buildTopPicksReview(slateDate, tracked);
  assert.ok(bestSixReview);
  assert.ok(topReview);
  assert.strictEqual(bestSixReview.record.total, 1);
  assert.strictEqual(topReview.record.total, 1);
  assert.strictEqual(topReview.subsetAnalysisOnly, true);
}

function testHistoryArchivesOnce() {
  const slateDate = "2026-06-22";
  const pick = makeNbaPick({ player: "Archive", team: "LAL", slateDate });
  const key = getStableTrackedPropKey(pick);
  const tracked = [{ ...pick, trackedKey: key, status: "win", slateDate }];
  saveBestSixSnapshot([pick], { slateDate });
  saveTopPicksSnapshot([pick], { slateDate });
  const bestSixReview = buildBestSixReview(slateDate, tracked);
  const topReview = buildTopPicksReview(slateDate, tracked);
  assert.strictEqual(bestSixReview.picks[0].trackedKey, key);
  assert.strictEqual(topReview.picks[0].trackedKey, key);
}

function testNbaPathProtected() {
  const nbaPick = makeNbaPick({ player: "NBA Star", team: "LAL" });
  const viaAdapter = scoreNbaTopProp(nbaPick).finalBestPropScore;
  const viaRanker = getPickScore(nbaPick);
  assert.strictEqual(viaAdapter, viaRanker);
  const { bestSix } = selectControlledBestSix([nbaPick], "NBA");
  assert.strictEqual(bestSix[0].player, "NBA Star");
}

function runExistingSuite(scriptName) {
  execSync(`node ${path.join(SERVER_ROOT, "scripts", scriptName)}`, {
    cwd: SERVER_ROOT,
    stdio: "inherit",
  });
}

function testExistingTopPropSelector() {
  runExistingSuite("testTopPropSelector.js");
}

function testExistingTopPicksLifecycle() {
  runExistingSuite("testTopPicksLifecycle.js");
}

function testExistingWnbaReaderCalibration() {
  runExistingSuite("testWnbaReaderFixes.js");
}

function testExistingWnbaQualityGate() {
  runExistingSuite("testWnbaResultsQualityGate.js");
}

function testControlledBestSixMetadata() {
  const pick = makeWnbaPick({ player: "Meta", team: "T1", overScore: 90 });
  const { bestSix } = selectControlledBestSix([pick], "WNBA");
  assert.strictEqual(bestSix[0].controlledBestSixRank, 1);
  assert.strictEqual(bestSix[0].trackingAdmissionSource, "CONTROLLED_BEST_SIX");
  assert.strictEqual(bestSix[0].controlledBestSixVersion, CONTROLLED_BEST_SIX_VERSION);
}

function testTrackingAdmissionSourceOnCohort() {
  const pick = makeWnbaPick({ player: "Cohort", team: "T1", overScore: 90, trackingType: "TEST" });
  const { cohort } = buildResultsTrackingCohort([pick], {
    sourcePool: "CONTROLLED_BEST_SIX",
  });
  assert.strictEqual(cohort[0].trackingAdmissionSource, "CONTROLLED_BEST_SIX");
  assert.strictEqual(cohort[0].controlledBestSixApplied, true);
}

function testDiagnosticsExposeCapFields() {
  const candidates = Array.from({ length: 8 }, (_, i) =>
    makeWnbaPick({
      player: `Diag${i}`,
      team: `Team${i}`,
      overScore: 90 - i,
      line: 10 + i,
      trackingType: "TEST",
    })
  );
  const game = makeGame(candidates.slice(0, 3), candidates);
  const tracked = candidates.map((pick, i) => ({
    ...pick,
    trackedKey: getStableTrackedPropKey(pick),
    slateDate: "2026-06-24",
    league: "WNBA",
  }));
  const diag = buildTrackingCohortDiagnostics([game], tracked, [], {
    todayLocalDate: "2026-06-24",
    activeResultsSlateDate: "2026-06-24",
  });
  assert.ok(diag.controlledBestSixApplied);
  assert.strictEqual(diag.trackingAdmissionSource, "CONTROLLED_BEST_SIX");
  assert.ok(diag.bestSixWNBACount <= BEST_SIX_LIMIT);
  assert.ok(typeof diag.excessTrackedDueToPreCap === "number");
  assert.ok(diag.qualityGatePassedCountByLeague);
}

function testSlateResultsSnapshotUtility() {
  const snapshot = buildSlateResultsSnapshot(
    [
      {
        ...makeWnbaPick({ player: "Winner" }),
        status: "win",
        resultMargin: 4,
        slateDate: "2026-06-24",
      },
    ],
    { slateDate: "2026-06-24" }
  );
  assert.strictEqual(snapshot.winsCount, 1);
  assert.ok(snapshot.winningProps[0].formattedLine.includes("[WIN]"));
}

function testSyncPathUsesBestSixNotFullPool() {
  const candidates = Array.from({ length: 10 }, (_, i) =>
    makeWnbaPick({
      player: `Sync${i}`,
      team: `Team${i}`,
      overScore: 90 - i,
      line: 10 + i,
      trackingType: "TEST",
    })
  );
  const game = makeGame(candidates.slice(0, 3), candidates);
  const selection = selectControlledBestSixCombined([game]);
  const bestSixCohort = [...selection.bestSixWNBA, ...selection.bestSixNBA];
  const { cohort } = buildResultsTrackingCohort(bestSixCohort, {
    sourcePool: "CONTROLLED_BEST_SIX",
  });
  assert.ok(cohort.length <= BEST_SIX_LIMIT);
  assert.ok(cohort.length < candidates.length);
}

function testExistingResultsTrackingCohort() {
  runExistingSuite("testResultsTrackingCohort.js");
}

function testExistingSlateResultsSnapshot() {
  runExistingSuite("testSlateResultsSnapshot.js");
}

function makeBoardOnlyWnbaPick(overrides = {}) {
  return makeWnbaPick({
    overScore: overrides.overScore ?? 70,
    netEdge: overrides.netEdge ?? 6,
    confidence: overrides.confidence ?? 72,
    wnbaDataCard: {
      bookLine: overrides.line ?? 14.5,
      dataConfidenceScore: 55,
      projection: { projection: 12 },
      last5: { points: 10, minutes: 20, fga: 6 },
      bookCount: 2,
      marketQuality: 45,
      dataMissingFlags: [],
      roleTrend: "down",
      minutesVolatility: "volatile",
      dataMode: "WNBA_LIMITED_DATA",
      ...overrides.wnbaDataCard,
    },
    wnbaReader: {
      decision: "TEST",
      finalSide: "OVER",
      readerConfidence: 55,
      margin: 4,
      overCase: { score: overrides.overScore ?? 70 },
      underCase: { score: 20 },
      ...overrides.wnbaReader,
    },
    ...overrides,
  });
}

function testDisplayBestSixFromFullAnalyzedBoard() {
  const trackPick = makeWnbaPick({
    player: "Track Star",
    team: "T1",
    overScore: 92,
    line: 10.5,
    netEdge: 10,
    confidence: 85,
  });
  const boardPicks = Array.from({ length: 14 }, (_, i) =>
    makeBoardOnlyWnbaPick({
      player: `Board${i}`,
      team: `Team${i % 6}`,
      gameId: `game-${i % 5}`,
      overScore: 88 - i,
      line: 11 + i,
      netEdge: 8 - i * 0.2,
      confidence: 80 - i,
    })
  );
  const pool = [trackPick, ...boardPicks];
  const display = selectBestSixDisplay(pool, "WNBA");
  const results = selectControlledBestSix(pool, "WNBA");

  assert.strictEqual(display.controlledBestSixDisplayAudit.candidateCount, 15);
  assert.strictEqual(display.bestSix.length, BEST_SIX_LIMIT);
  assert.ok(results.bestSix.length <= display.bestSix.length);

  for (const pick of display.bestSix) {
    assert.ok(pick.decisionIntelligence, `missing DI on ${pick.player}`);
    assert.ok(pick.decisionIntelligence.trueRisk, `missing Risk Truth on ${pick.player}`);
    assert.ok(
      pick.sideRescue || pick.decisionIntelligence.trackEligibility,
      `missing Side Rescue / eligibility on ${pick.player}`
    );
    assert.strictEqual(pick.controlledBestSixDisplay, true);
  }

  const trackInDisplay = display.bestSix.filter(
    (p) => p.decisionIntelligence?.trackEligibility === "TRACK"
  ).length;
  assert.strictEqual(trackInDisplay, display.bestSix.length);
  assert.ok(results.bestSix.length <= trackInDisplay);
  assert.ok(
    display.bestSix.every((pick) => pick.resultsAdmissionEligible === true),
    "display Best 6 should all admit to Results"
  );
  assert.ok(
    display.bestSix.every((pick) => pick.resultsDecisionLabel === "TRACK"),
    "display Best 6 should all show TRACK decision label"
  );
}

function testDisplayDoesNotPreFilterBoardOnly() {
  const strongBoard = makeWnbaPick({
    player: "Strong Board",
    team: "T1",
    overScore: 95,
    line: 10.5,
    netEdge: 12,
    confidence: 90,
    wnbaDataCard: {
      bookLine: 14.5,
      dataConfidenceScore: 55,
      projection: { projection: 12 },
      last5: { points: 10, minutes: 20, fga: 6 },
      bookCount: 2,
      marketQuality: 45,
      dataMissingFlags: [],
      roleTrend: "down",
      minutesVolatility: "volatile",
    },
    wnbaReader: {
      decision: "TEST",
      finalSide: "OVER",
      readerConfidence: 55,
      margin: 3,
      overCase: { score: 55 },
      underCase: { score: 20 },
    },
  });
  const display = selectBestSixDisplay([strongBoard], "WNBA");
  assert.strictEqual(display.bestSix.length, 1);
  assert.strictEqual(display.bestSix[0].decisionIntelligence?.trackEligibility, "TRACK");
  assert.strictEqual(display.bestSix[0].resultsAdmissionEligible, true);
  assert.strictEqual(display.bestSix[0].resultsDecisionLabel, "TRACK");
  assert.ok(display.bestSix[0].decisionIntelligence?.bestSixPromoted);
}

function run() {
  assert.strictEqual(
    CONTROLLED_BEST_SIX_VERSION,
    "controlled-best-six-selection-integrity-v1"
  );

  const tests = [
    ["1. WNBA Best 6 returns max 6", testWnbaBestSixMaxSix],
    ["2. NBA Best 6 returns max 6", testNbaBestSixMaxSix],
    ["3. Top WNBA Props return max 2", testTopWnbaMaxTwo],
    ["4. Top NBA Props return max 2", testTopNbaMaxTwo],
    ["5. Top WNBA from Best 6 only", testTopWnbaFromBestSixOnly],
    ["6. Top NBA from Best 6 only", testTopNbaFromBestSixOnly],
    ["7. Top 2 WNBA different teams", testTopWnbaDifferentTeams],
    ["8. Top 2 NBA different teams", testTopNbaDifferentTeams],
    ["9. no different team returns one", testNoDifferentTeamCandidate],
    ["9b. Top 2 picks safest two by safety score", testTopTwoPicksSafestNotDisplayRank],
    ["9c. Top 2 includes promoted display picks", testTopTwoIncludesPromotedDisplayRanks],
    ["10. uses full candidate pool", testUsesFullCandidatePool],
    ["11. quality gate blocks trash", testQualityGateBlocksTrash],
    ["12. excludes invalid candidates", testExcludesInvalidCandidates],
    ["13. Best 6 no duplicate keys", testBestSixNoDuplicateTrackedKeys],
    ["14. Top Picks no duplicate keys", testTopPicksNoDuplicateTrackedKeys],
    ["15. Results tracks Best 6 only", testResultsTracksBestSixOnly],
    ["16. Lab reviews reference originals", testLabReviewsReferenceOriginalProps],
    ["17. History archives once", testHistoryArchivesOnce],
    ["18. NBA path protected", testNbaPathProtected],
    ["19. existing Top Props tests", testExistingTopPropSelector],
    ["20. existing lifecycle tests", testExistingTopPicksLifecycle],
    ["21. existing WNBA reader calibration", testExistingWnbaReaderCalibration],
    ["22. existing WNBA quality gate", testExistingWnbaQualityGate],
    ["23. controlled metadata on Best 6", testControlledBestSixMetadata],
    ["24. tracking admission source on cohort", testTrackingAdmissionSourceOnCohort],
    ["25. diagnostics expose cap fields", testDiagnosticsExposeCapFields],
    ["26. slate results snapshot utility", testSlateResultsSnapshotUtility],
    ["27. sync path uses Best 6 not full pool", testSyncPathUsesBestSixNotFullPool],
    ["28. existing results tracking cohort", testExistingResultsTrackingCohort],
    ["29. existing slate results snapshot", testExistingSlateResultsSnapshot],
    ["30. display Best 6 from full analyzed board (15 pool)", testDisplayBestSixFromFullAnalyzedBoard],
    ["31. display promotes former BOARD_ONLY to TRACK", testDisplayDoesNotPreFilterBoardOnly],
  ];

  let passed = 0;
  for (const [name, fn] of tests) {
    fn();
    console.log(`✓ ${name}`);
    passed += 1;
  }

  console.log(`\nAll ${passed}/${tests.length} controlled Best 6 tests passed.`);
}

run();
