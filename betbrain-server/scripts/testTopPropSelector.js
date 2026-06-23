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
  collectAllGeneratedCandidates,
} from "../engines/topProps/topPropSelector.js";

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

function testWnbaUsesReaderScoreNotTierOnly() {
  const leanLowConf = makeWnbaPick({
    player: "Lean Low",
    tier: "LEAN",
    confidence: 52,
    overScore: 55,
    readerConfidence: 74,
  });
  const premiumLowReader = makeWnbaPick({
    player: "Premium Shell",
    tier: "PREMIUM",
    confidence: 78,
    overScore: 18,
    readerConfidence: 48,
  });

  const leanScore = scoreWnbaTopProp(leanLowConf).finalBestPropScore;
  const premiumScore = scoreWnbaTopProp(premiumLowReader).finalBestPropScore;

  assert.ok(
    leanScore > premiumScore,
    `WNBA score should follow reader case (${leanScore}) not tier alone (${premiumScore})`
  );
}

function testFifthPropFromGameNotLostBeforeGlobalRank() {
  const gamePicks = [
    makeWnbaPick({ player: "P1", overScore: 30, line: 10.5 }),
    makeWnbaPick({ player: "P2", overScore: 28, line: 11.5 }),
    makeWnbaPick({ player: "P3", overScore: 26, line: 12.5 }),
    makeWnbaPick({ player: "P4", overScore: 24, line: 13.5 }),
    makeWnbaPick({ player: "P5 Star", overScore: 60, line: 14.5 }),
  ];

  const displayPicks = gamePicks.slice(0, 4);
  const game = makeGame(displayPicks, gamePicks, { gameId: "wnba-a" });

  const otherHigh = makeWnbaPick({
    player: "Other Star",
    overScore: 22,
    line: 16.5,
    team: "TeamC",
  });
  const game2 = makeGame([otherHigh], [otherHigh], {
    gameId: "wnba-b",
    game: "C @ D",
  });

  const result = selectTopProps([game, game2], { league: "WNBA", limit: 8 });
  const names = result.topProps.map((p) => p.player);

  assert.ok(
    names.includes("P5 Star"),
    `5th in-game candidate should survive global rank; got: ${names.join(", ")}`
  );
  assert.ok(
    names[0] === "P5 Star",
    `Highest reader-case prop should rank first; got: ${names.join(", ")}`
  );
}

function testReturnsOnlyTwoMax() {
  const picks = [
    makeWnbaPick({ player: "A", overScore: 50, line: 10.5 }),
    makeWnbaPick({ player: "B", overScore: 45, line: 11.5 }),
    makeWnbaPick({ player: "C", overScore: 40, line: 12.5 }),
    makeWnbaPick({ player: "D", overScore: 35, line: 13.5 }),
    makeWnbaPick({ player: "E", overScore: 30, line: 14.5 }),
  ];
  const game = makeGame(picks, picks);
  const result = selectTopProps([game], { league: "WNBA" });

  assert.strictEqual(result.topProps.length, 2);
  assert.strictEqual(result.selectedCount, 2);
  assert.ok(result.topSelectionAudit.hiddenDueToLimit >= 3);
}

function testHighestScoresSelected() {
  const low = makeWnbaPick({ player: "Low", overScore: 20, line: 10.5 });
  const mid = makeWnbaPick({ player: "Mid", overScore: 40, line: 11.5 });
  const high = makeWnbaPick({ player: "High", overScore: 60, line: 12.5 });
  const top = makeWnbaPick({ player: "Top", overScore: 80, line: 13.5 });

  const game = makeGame([low, mid, high, top], [low, mid, high, top]);
  const result = selectTopProps([game], { league: "WNBA" });

  assert.strictEqual(result.topProps.length, 2);
  assert.strictEqual(result.topProps[0].player, "Top");
  assert.strictEqual(result.topProps[1].player, "High");
}

function testNoBalanceForcing() {
  const officialHigh = makeWnbaPick({
    player: "Official High",
    officialEligible: true,
    readerDecision: "OFFICIAL",
    finalDecision: "OFFICIAL",
    trackingType: "OFFICIAL",
    overScore: 70,
    line: 10.5,
  });
  const officialHigher = makeWnbaPick({
    player: "Official Higher",
    officialEligible: true,
    readerDecision: "OFFICIAL",
    finalDecision: "OFFICIAL",
    trackingType: "OFFICIAL",
    overScore: 90,
    line: 11.5,
  });
  const testHigher = makeWnbaPick({
    player: "Test Higher",
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
  assert.strictEqual(result.topProps[1].player, "Official High");
}

function testBothTestWhenNoOfficial() {
  const testA = makeWnbaPick({
    player: "Test A",
    officialEligible: false,
    readerDecision: "TEST",
    finalDecision: "TEST",
    trackingType: "TEST",
    overScore: 55,
    line: 10.5,
  });
  const testB = makeWnbaPick({
    player: "Test B",
    officialEligible: false,
    readerDecision: "TEST",
    finalDecision: "TEST",
    trackingType: "TEST",
    overScore: 50,
    line: 11.5,
  });
  const testC = makeWnbaPick({
    player: "Test C",
    officialEligible: false,
    readerDecision: "TEST",
    finalDecision: "TEST",
    trackingType: "TEST",
    overScore: 30,
    line: 12.5,
  });

  const game = makeGame([testA, testB, testC], [testA, testB, testC]);
  const result = selectTopProps([game], { league: "WNBA" });

  assert.strictEqual(result.topProps.length, 2);
  assert.strictEqual(result.topOfficialProps.length, 0);
  assert.strictEqual(result.topTestProps.length, 2);
  assert.strictEqual(result.topTestProps[0].player, "Test A");
  assert.strictEqual(result.topTestProps[1].player, "Test B");
}

function testBothOfficialWhenHighest() {
  const officialA = makeWnbaPick({
    player: "Official A",
    officialEligible: true,
    readerDecision: "OFFICIAL",
    finalDecision: "OFFICIAL",
    trackingType: "OFFICIAL",
    overScore: 65,
    line: 10.5,
  });
  const officialB = makeWnbaPick({
    player: "Official B",
    officialEligible: true,
    readerDecision: "OFFICIAL",
    finalDecision: "OFFICIAL",
    trackingType: "OFFICIAL",
    overScore: 60,
    line: 11.5,
  });
  const testPick = makeWnbaPick({
    player: "Test Low",
    officialEligible: false,
    readerDecision: "TEST",
    finalDecision: "TEST",
    trackingType: "TEST",
    overScore: 20,
    line: 12.5,
  });

  const game = makeGame([officialA, officialB, testPick], [officialA, officialB, testPick]);
  const result = selectTopProps([game], { league: "WNBA" });

  assert.strictEqual(result.topProps.length, 2);
  assert.strictEqual(result.topOfficialProps.length, 2);
  assert.strictEqual(result.topTestProps.length, 0);
}

function testWnbaMetadataPreserved() {
  const pick = makeWnbaPick({
    player: "Meta Player",
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
}

function testTestInTestListNotOfficial() {
  const official = makeWnbaPick({
    player: "Official One",
    officialEligible: true,
    readerDecision: "OFFICIAL",
    finalDecision: "OFFICIAL",
    trackingType: "OFFICIAL",
    tier: "PREMIUM",
    overScore: 50,
    line: 10.5,
  });
  const testPick = makeWnbaPick({
    player: "Test One",
    officialEligible: false,
    readerDecision: "TEST",
    finalDecision: "TEST",
    trackingType: "TEST",
    tier: "WATCHLIST",
    overScore: 45,
    line: 11.5,
  });

  const game = makeGame([official, testPick], [official, testPick]);
  const result = selectTopProps([game], { league: "WNBA" });

  assert.strictEqual(result.topProps.length, 2);
  assert.strictEqual(result.topOfficialProps.length, 1);
  assert.strictEqual(result.topTestProps.length, 1);
  assert.strictEqual(result.topOfficialProps[0].player, "Official One");
  assert.strictEqual(result.topTestProps[0].player, "Test One");
  assert.ok(isOfficialPick(result.topOfficialProps[0]));
  assert.ok(isTestPick(result.topTestProps[0]));
  assert.ok(!isOfficialPick(result.topTestProps[0]));
}

function testNoBetExcluded() {
  const playable = makeWnbaPick({ player: "Playable", overScore: 40 });
  const noBet = makeWnbaPick({
    player: "No Bet",
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

function testNbaUnchanged() {
  const nbaPick = {
    player: "NBA Star",
    team: "LAL",
    line: 24.5,
    pick: "Over",
    side: "Over",
    league: "NBA",
    tier: "PREMIUM",
    confidence: 78,
    netEdge: 8,
    supportScore: 12,
    chosenRisk: 35,
    dataQuality: 70,
    marketQuality: 65,
    bookCount: 6,
    noPlay: false,
  };

  const viaAdapter = scoreNbaTopProp(nbaPick).finalBestPropScore;
  const viaRanker = getPickScore(nbaPick);
  assert.strictEqual(viaAdapter, viaRanker);

  const game = makeGame([nbaPick], [nbaPick], { league: "NBA" });
  const result = selectTopProps([game], { league: "NBA" });
  assert.strictEqual(result.topProps.length, 1);
  assert.strictEqual(result.topProps[0].player, "NBA Star");
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

function run() {
  const tests = [
    ["WNBA uses reader score not tier only", testWnbaUsesReaderScoreNotTierOnly],
    ["returns only 2 max (default limit)", testReturnsOnlyTwoMax],
    ["explicit limit 8 still works for ranking audit", testFifthPropFromGameNotLostBeforeGlobalRank],
    ["highest scores selected", testHighestScoresSelected],
    ["no balance forcing", testNoBalanceForcing],
    ["both TEST when no official", testBothTestWhenNoOfficial],
    ["both Official when highest", testBothOfficialWhenHighest],
    ["WNBA metadata preserved", testWnbaMetadataPreserved],
    ["TEST in test list not official", testTestInTestListNotOfficial],
    ["NO_BET excluded", testNoBetExcluded],
    ["NBA unchanged", testNbaUnchanged],
    ["collects from allGeneratedCandidates", testCollectsFromAllGeneratedCandidates],
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
