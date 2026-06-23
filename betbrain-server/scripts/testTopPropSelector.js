/**
 * Top Prop Selector unit tests (no prod mutation).
 * Usage: node betbrain-server/scripts/testTopPropSelector.js
 */
import assert from "assert";
import { getPickScore } from "../engines/pickRanker.js";
import { scoreNbaTopProp } from "../engines/topProps/nbaTopPropScore.js";
import { scoreWnbaTopProp } from "../engines/topProps/wnbaTopPropScore.js";
import {
  isOfficialPick,
  isTestPick,
  isNoBetPick,
} from "../engines/topProps/topPropSelectionAudit.js";
import {
  selectTopProps,
  selectCombinedTopProps,
  collectAllGeneratedCandidates,
  getPickTeamKey,
} from "../engines/topProps/topPropSelector.js";

function buildCopyReportPreview(nbaCards = [], wnbaCards = []) {
  const lines = [
    "Top Props — CourtEdge",
    "--- Best 2 NBA Props ---",
    ...nbaCards.map((card) => card.pick.player),
    "--- Best 2 WNBA Props ---",
    ...wnbaCards.map((card) => card.pick.player),
  ];
  return lines.join("\n");
}

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
    picks,
    allGeneratedCandidates: allGeneratedCandidates || picks,
    ...overrides,
  };
}

function makeWnbaPick(overrides = {}) {
  const reader = {
    finalSide: "OVER",
    decision: overrides.readerDecision || "TEST",
    readerConfidence: overrides.readerConfidence ?? 68,
    whyOver: ["Volume path supports over"],
    whyUnder: [],
    supports: ["Volume path supports over"],
    disagrees: overrides.disagrees || [],
    overCase: { score: overrides.overScore ?? 42 },
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
    finalDecision: overrides.finalDecision || (overrides.officialEligible ? "OFFICIAL" : "TEST"),
    trackingType: overrides.trackingType || (overrides.officialEligible ? "OFFICIAL" : "TEST"),
    readerDecision: reader.decision,
    wnbaReader: reader,
    wnbaDataCard: {
      bookLine: overrides.line ?? 14.5,
      dataConfidenceScore: overrides.dataConfidenceScore ?? 72,
      projection: { projection: overrides.projection ?? 18 },
      last5: { points: 17, minutes: 30, fga: 12 },
      bookCount: 5,
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
    supportScore: overrides.supportScore ?? 12,
    chosenRisk: overrides.chosenRisk ?? 35,
    dataQuality: 70,
    marketQuality: 65,
    bookCount: 6,
    noPlay: false,
    bestPropScore: overrides.bestPropScore,
    ...overrides,
  };
}

function testWnbaMaxTwo() {
  const picks = [
    makeWnbaPick({ player: "A", team: "TeamA", overScore: 50, line: 10.5 }),
    makeWnbaPick({ player: "B", team: "TeamB", overScore: 45, line: 11.5 }),
    makeWnbaPick({ player: "C", team: "TeamC", overScore: 40, line: 12.5 }),
    makeWnbaPick({ player: "D", team: "TeamD", overScore: 35, line: 13.5 }),
  ];
  const result = selectTopProps([makeGame(picks, picks)], { league: "WNBA" });
  assert.strictEqual(result.topProps.length, 2);
}

function testNbaMaxTwo() {
  const picks = [
    makeNbaPick({ player: "A", team: "LAL", confidence: 90, netEdge: 12 }),
    makeNbaPick({ player: "B", team: "BOS", confidence: 85, netEdge: 10 }),
    makeNbaPick({ player: "C", team: "MIA", confidence: 80, netEdge: 9 }),
  ];
  const result = selectTopProps([makeGame(picks, picks, { league: "NBA" })], {
    league: "NBA",
  });
  assert.strictEqual(result.topProps.length, 2);
}

function testWnbaDifferentTeams() {
  const picks = [
    makeWnbaPick({ player: "A", team: "Mystics", overScore: 80 }),
    makeWnbaPick({ player: "B", team: "Mercury", overScore: 70 }),
  ];
  const result = selectTopProps([makeGame(picks, picks)], { league: "WNBA" });
  assert.strictEqual(result.topProps.length, 2);
  assert.notStrictEqual(
    getPickTeamKey(result.topProps[0]),
    getPickTeamKey(result.topProps[1])
  );
}

function testNbaDifferentTeams() {
  const picks = [
    makeNbaPick({ player: "A", team: "LAL", confidence: 90 }),
    makeNbaPick({ player: "B", team: "BOS", confidence: 85 }),
  ];
  const result = selectTopProps([makeGame(picks, picks, { league: "NBA" })], {
    league: "NBA",
  });
  assert.strictEqual(result.topProps.length, 2);
  assert.notStrictEqual(
    getPickTeamKey(result.topProps[0]),
    getPickTeamKey(result.topProps[1])
  );
}

function testSkipsSameTeamForSecondSlot() {
  const picks = [
    makeWnbaPick({ player: "Star A", team: "Mystics", overScore: 90 }),
    makeWnbaPick({ player: "Star B", team: "Mystics", overScore: 85 }),
    makeWnbaPick({ player: "Other", team: "Mercury", overScore: 60 }),
  ];
  const result = selectTopProps([makeGame(picks, picks)], { league: "WNBA" });
  assert.strictEqual(result.topProps.length, 2);
  assert.strictEqual(result.topProps[0].player, "Star A");
  assert.strictEqual(result.topProps[1].player, "Other");
  assert.ok(result.topSelectionAudit.hiddenDueToSameTeam >= 1);
}

function testNoDifferentTeamCandidate() {
  const picks = [
    makeWnbaPick({ player: "Only A", team: "Mystics", overScore: 90 }),
    makeWnbaPick({ player: "Only B", team: "Mystics", overScore: 80 }),
  ];
  const result = selectTopProps([makeGame(picks, picks)], { league: "WNBA" });
  assert.strictEqual(result.topProps.length, 1);
  assert.strictEqual(result.topSelectionAudit.noDifferentTeamCandidate, true);
}

function testNoBalanceForcing() {
  const officialHigh = makeWnbaPick({
    player: "Official High",
    team: "TeamA",
    officialEligible: true,
    readerDecision: "OFFICIAL",
    finalDecision: "OFFICIAL",
    trackingType: "OFFICIAL",
    overScore: 70,
    line: 10.5,
  });
  const officialHigher = makeWnbaPick({
    player: "Official Higher",
    team: "TeamB",
    officialEligible: true,
    readerDecision: "OFFICIAL",
    finalDecision: "OFFICIAL",
    trackingType: "OFFICIAL",
    overScore: 90,
    line: 11.5,
  });
  const testHigher = makeWnbaPick({
    player: "Test Higher",
    team: "TeamC",
    officialEligible: false,
    readerDecision: "TEST",
    finalDecision: "TEST",
    trackingType: "TEST",
    overScore: 50,
    line: 12.5,
  });

  const game = makeGame(
    [officialHigh, officialHigher, testHigher],
    [officialHigh, officialHigher, testHigher]
  );
  const result = selectTopProps([game], { league: "WNBA" });

  assert.strictEqual(result.topProps.length, 2);
  assert.strictEqual(result.topOfficialProps.length, 2);
  assert.strictEqual(result.topTestProps.length, 0);
  assert.strictEqual(result.topProps[0].player, "Official Higher");
}

function testLeaguesSeparated() {
  const nba = makeNbaPick({ player: "NBA Star", team: "LAL", confidence: 95 });
  const wnba = makeWnbaPick({ player: "WNBA Star", team: "Mystics", overScore: 95 });
  const result = selectCombinedTopProps([
    makeGame([nba], [nba], { league: "NBA", gameId: "nba-1" }),
    makeGame([wnba], [wnba], { league: "WNBA", gameId: "wnba-1" }),
  ]);

  assert.strictEqual(result.topNBAProps.length, 1);
  assert.strictEqual(result.topWNBAProps.length, 1);
  assert.strictEqual(result.topProps.length, 2);
  assert.strictEqual(result.topNBAProps[0].league, "NBA");
  assert.strictEqual(result.topWNBAProps[0].league, "WNBA");
}

function testWnbaMetadataPreserved() {
  const pick = makeWnbaPick({
    player: "Meta Player",
    team: "TeamA",
    officialEligible: true,
    overScore: 55,
    wnbaDataCard: { bookLine: 15.5, dataConfidenceScore: 88 },
  });
  const game = makeGame([pick], [pick]);
  const result = selectTopProps([game], { league: "WNBA" });

  assert.strictEqual(result.topProps.length, 1);
  assert.ok(result.topProps[0].wnbaReader);
  assert.ok(result.topProps[0].wnbaDataCard);
  assert.strictEqual(result.topProps[0].engineHandled, "WNBA_V2");
  assert.ok(Number.isFinite(result.topProps[0].bestPropScore));
  assert.strictEqual(result.topProps[0].topPickLabel, "Top WNBA #1");
}

function testNbaPathProtected() {
  const nbaPick = makeNbaPick({ player: "NBA Star", team: "LAL" });
  const viaAdapter = scoreNbaTopProp(nbaPick).finalBestPropScore;
  const viaRanker = getPickScore(nbaPick);
  assert.strictEqual(viaAdapter, viaRanker);

  const game = makeGame([nbaPick], [nbaPick], { league: "NBA" });
  const result = selectTopProps([game], { league: "NBA" });
  assert.strictEqual(result.topProps.length, 1);
  assert.strictEqual(result.topProps[0].player, "NBA Star");
  assert.strictEqual(result.topProps[0].topPickLabel, "Top NBA #1");
}

function testNoBetExcluded() {
  const playable = makeWnbaPick({ player: "Playable", team: "TeamA", overScore: 40 });
  const noBet = makeWnbaPick({
    player: "No Bet",
    team: "TeamB",
    noPlay: true,
    readerDecision: "NO_BET",
    finalDecision: "NO_BET",
    trackingType: "NO_BET",
  });

  const game = makeGame([playable], [playable, noBet]);
  const result = selectTopProps([game], { league: "WNBA" });

  assert.strictEqual(result.noBetCount, 1);
  assert.ok(!result.topProps.some((p) => p.player === "No Bet"));
  assert.ok(isNoBetPick(noBet));
}

function testCopyReportLeagueSections() {
  const report = buildCopyReportPreview(
    [{ pick: { player: "NBA One", topPickLabel: "Top NBA #1" }, playType: "Official" }],
    [{ pick: { player: "WNBA One", topPickLabel: "Top WNBA #1" }, playType: "Test" }]
  );

  assert.ok(report.includes("Best 2 NBA Props"));
  assert.ok(report.includes("Best 2 WNBA Props"));
  assert.ok(report.includes("NBA One"));
  assert.ok(report.includes("WNBA One"));
}

function testCollectsFromAllGeneratedCandidates() {
  const full = [
    makeWnbaPick({ player: "A", overScore: 10 }),
    makeWnbaPick({ player: "B", overScore: 12 }),
    makeWnbaPick({ player: "C", overScore: 14 }),
  ];
  const game = makeGame(full.slice(0, 1), full);
  const collected = collectAllGeneratedCandidates([game]);
  assert.strictEqual(collected.length, 3);
}

function testWnbaUsesReaderScoreNotTierOnly() {
  const leanLowConf = makeWnbaPick({
    player: "Lean Low",
    team: "TeamA",
    tier: "LEAN",
    confidence: 52,
    overScore: 55,
    readerConfidence: 74,
  });
  const premiumLowReader = makeWnbaPick({
    player: "Premium Shell",
    team: "TeamB",
    tier: "PREMIUM",
    confidence: 78,
    overScore: 18,
    readerConfidence: 48,
  });

  const leanScore = scoreWnbaTopProp(leanLowConf).finalBestPropScore;
  const premiumScore = scoreWnbaTopProp(premiumLowReader).finalBestPropScore;

  assert.ok(leanScore > premiumScore);
}

function run() {
  const tests = [
    ["1. WNBA top props returns max 2", testWnbaMaxTwo],
    ["2. NBA top props returns max 2", testNbaMaxTwo],
    ["3. WNBA selected two different teams", testWnbaDifferentTeams],
    ["4. NBA selected two different teams", testNbaDifferentTeams],
    ["5. skips same team for second slot", testSkipsSameTeamForSecondSlot],
    ["6. no different team returns one + audit", testNoDifferentTeamCandidate],
    ["7. official/test balancing not forced", testNoBalanceForcing],
    ["8. NBA and WNBA are separate sections", testLeaguesSeparated],
    ["14. WNBA_V2 metadata survives", testWnbaMetadataPreserved],
    ["15. NBA path remains protected", testNbaPathProtected],
    ["NO_BET excluded", testNoBetExcluded],
    ["13. copy report league sections only", testCopyReportLeagueSections],
    ["collects from allGeneratedCandidates", testCollectsFromAllGeneratedCandidates],
    ["WNBA uses reader score not tier only", testWnbaUsesReaderScoreNotTierOnly],
  ];

  let passed = 0;
  for (const [name, fn] of tests) {
    fn();
    console.log(`✓ ${name}`);
    passed += 1;
  }

  console.log(`\nAll ${passed}/${tests.length} top prop selector tests passed.`);
}

run();
