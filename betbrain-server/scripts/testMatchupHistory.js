/**
 * Opponent matchup history lookup tests — games-first Ball flow.
 * Usage: node betbrain-server/scripts/testMatchupHistory.js
 */
import assert from "assert";
import { teamsMatch, resolveWnbaTeamId } from "../engines/wnba/wnbaTeamAliasResolver.js";
import {
  MATCHUP_LOOKUP_CLASS,
  buildWnbaGamesMatchupUrl,
  buildWnbaPlayerStatsUrl,
  buildWrongOpponentTeamStatsUrl,
  classifyWnbaMatchupProbe,
  filterWnbaGamesVsOpponent,
  gameInvolvesBallTeams,
} from "../engines/wnba/wnbaMatchupLookupV1.js";

const CHI_BALL_ID = 5;
const POR_BALL_ID = 18;
const AZURA_ID = 525;
const JUNE_24_GAME_ID = 401234;

function filterVsOpponent(games = [], opponent = "") {
  const targetId = resolveWnbaTeamId(opponent);
  return games
    .filter((g) => teamsMatch(g.opponentTeamId || g.opponent, targetId))
    .slice(0, 3);
}

function testChiPorAliasMatch() {
  const games = [
    { opponent: "portlandfire", opponentTeamId: "portlandfire", points: 14 },
    { opponent: "minnesotalynx", opponentTeamId: "minnesotalynx", points: 11 },
    { opponent: "portlandfire", opponentTeamId: "portlandfire", points: 18 },
  ];
  const vsPor = filterVsOpponent(games, "POR");
  assert.strictEqual(vsPor.length, 2);
  const vsChi = filterVsOpponent(games, "CHICAGOSKY");
  assert.strictEqual(vsChi.length, 0);
  console.log("✓ POR alias matches portlandfire games");
}

function testNoSpaceUppercaseOpponent() {
  const games = [
    { opponent: "chicagosky", opponentTeamId: "chicagosky", points: 20 },
  ];
  const matches = filterVsOpponent(games, "CHICAGOSKY");
  assert.strictEqual(matches.length, 1);
  console.log("✓ CHICAGOSKY matches chicagosky");
}

function testBidirectionalAbbrev() {
  assert.strictEqual(
    teamsMatch("portlandfire", resolveWnbaTeamId("POR")),
    true
  );
  assert.strictEqual(
    teamsMatch("CHI", resolveWnbaTeamId("chicagosky")),
    true
  );
  console.log("✓ abbreviation bidirectional");
}

function testWrongOpponentNoMatch() {
  const games = [
    { opponent: "dallaswings", opponentTeamId: "dallaswings", points: 9 },
  ];
  const matches = filterVsOpponent(games, "portlandfire");
  assert.strictEqual(matches.length, 0);
  console.log("✓ wrong opponent no match");
}

function testLegacyCleanOpponentStillWorks() {
  const games = [{ opponent: "seattlestorm", points: 15 }];
  const matches = filterVsOpponent(games, "SEA");
  assert.strictEqual(matches.length, 1);
  console.log("✓ legacy opponent string + abbrev");
}

function testMultipleOpponentsPicksCorrect() {
  const games = [
    { opponent: "portlandfire", opponentTeamId: "portlandfire", points: 12 },
    { opponent: "portlandfire", opponentTeamId: "portlandfire", points: 16 },
    { opponent: "portlandfire", opponentTeamId: "portlandfire", points: 10 },
    { opponent: "indianafever", opponentTeamId: "indianafever", points: 22 },
  ];
  const last3 = filterVsOpponent(games, "PORTLANDFIRE");
  assert.strictEqual(last3.length, 3);
  console.log("✓ last-3 cap against opponent");
}

function testAzuraScenarioTeamIds() {
  const azuraGames = [
    {
      date: "2026-05-10",
      opponent: "chicagosky",
      opponentTeamId: "chicagosky",
      points: 14,
    },
    {
      date: "2026-04-02",
      opponent: "chicagosky",
      opponentTeamId: "chicagosky",
      points: 11,
    },
    {
      date: "2026-03-15",
      opponent: "portlandfire",
      opponentTeamId: "portlandfire",
      points: 9,
    },
  ];
  const vsChi = filterVsOpponent(azuraGames, "CHI");
  const vsPor = filterVsOpponent(azuraGames, "portlandfire");
  assert.strictEqual(vsChi.length, 2);
  assert.strictEqual(vsPor.length, 1);
  const avgChi =
    vsChi.reduce((s, g) => s + g.points, 0) / vsChi.length;
  assert.ok(avgChi > 0);
  console.log("✓ Azura-style CHI/POR history resolves");
}

function testEmptyGames() {
  assert.strictEqual(filterVsOpponent([], "CHI").length, 0);
  console.log("✓ empty games");
}

function testGamesUrlUsesPlayerTeamNotOpponent() {
  const url = buildWnbaGamesMatchupUrl(CHI_BALL_ID, 2026, {
    startDate: "2026-05-01",
    endDate: "2026-06-25",
  });
  assert.ok(url.includes(`team_ids%5B%5D=${CHI_BALL_ID}`));
  assert.ok(!url.includes(String(POR_BALL_ID)));
  console.log("✓ games URL uses player team id only");
}

function testFixedPlayerStatsUsesGameIdsNotOpponentTeamId() {
  const fixed = buildWnbaPlayerStatsUrl({
    playerId: AZURA_ID,
    gameIds: [JUNE_24_GAME_ID, 401100],
  });
  const wrong = buildWrongOpponentTeamStatsUrl(AZURA_ID, POR_BALL_ID, 2026);

  assert.ok(fixed.includes(`player_ids%5B%5D=${AZURA_ID}`));
  assert.ok(fixed.includes(`game_ids%5B%5D=${JUNE_24_GAME_ID}`));
  assert.ok(!fixed.includes("team_ids"));
  assert.ok(wrong.includes(`team_ids%5B%5D=${POR_BALL_ID}`));
  assert.ok(!wrong.includes("game_ids"));
  console.log("✓ fixed stats uses game_ids; wrong pattern uses opponent team_ids");
}

function testFilterWnbaGamesJune24PorChi() {
  const games = [
    {
      id: JUNE_24_GAME_ID,
      date: "2026-06-24",
      home_team: { id: POR_BALL_ID, abbreviation: "POR" },
      visitor_team: { id: CHI_BALL_ID, abbreviation: "CHI" },
    },
    {
      id: 401100,
      date: "2026-05-09",
      home_team: { id: CHI_BALL_ID, abbreviation: "CHI" },
      visitor_team: { id: POR_BALL_ID, abbreviation: "POR" },
    },
    {
      id: 999,
      date: "2026-06-20",
      home_team: { id: CHI_BALL_ID, abbreviation: "CHI" },
      visitor_team: { id: 3, abbreviation: "MIN" },
    },
  ];

  const matched = filterWnbaGamesVsOpponent(games, CHI_BALL_ID, POR_BALL_ID);
  assert.strictEqual(matched.length, 2);
  assert.ok(matched.some((g) => g.date === "2026-06-24"));
  assert.ok(gameInvolvesBallTeams(matched[0], CHI_BALL_ID, POR_BALL_ID));
  console.log("✓ June 24 POR/CHI found in games filter");
}

function testClassifyPlayerH2HWhenGameStatsExist() {
  const cls = classifyWnbaMatchupProbe({
    gamesCount: 12,
    matchedGameIds: [JUNE_24_GAME_ID],
    playerStatsCount: 1,
    wrongQueryStatsCount: 0,
    legacySeasonFilterCount: 0,
  });
  assert.strictEqual(cls, MATCHUP_LOOKUP_CLASS.WRONG_QUERY_KEY_SUSPECTED);
  console.log("✓ classify WRONG_QUERY when legacy empty but game_ids stats exist");
}

function testClassifyDidNotPlayWhenGamesButNoStats() {
  const cls = classifyWnbaMatchupProbe({
    gamesCount: 12,
    matchedGameIds: [401100, JUNE_24_GAME_ID],
    playerStatsCount: 0,
    wrongQueryStatsCount: 0,
    legacySeasonFilterCount: 0,
  });
  assert.strictEqual(cls, MATCHUP_LOOKUP_CLASS.PLAYER_DID_NOT_PLAY_IN_MATCHUP);
  console.log("✓ classify DID_NOT_PLAY when games exist but no player stats");
}

function testAzuraJune24StatRow() {
  const statRow = {
    pts: 11,
    min: "28:12",
    team: { id: CHI_BALL_ID, abbreviation: "CHI" },
    game: {
      id: JUNE_24_GAME_ID,
      date: "2026-06-24",
      home_team: { id: POR_BALL_ID },
      visitor_team: { id: CHI_BALL_ID },
    },
  };
  const url = buildWnbaPlayerStatsUrl({
    playerId: AZURA_ID,
    gameIds: [JUNE_24_GAME_ID],
  });
  assert.ok(url.includes(String(AZURA_ID)));
  assert.ok(url.includes(String(JUNE_24_GAME_ID)));
  assert.strictEqual(statRow.pts, 11);
  assert.strictEqual(statRow.game.date, "2026-06-24");
  console.log("✓ Azura 525 June 24 stat row shape");
}

function main() {
  testChiPorAliasMatch();
  testNoSpaceUppercaseOpponent();
  testBidirectionalAbbrev();
  testWrongOpponentNoMatch();
  testLegacyCleanOpponentStillWorks();
  testMultipleOpponentsPicksCorrect();
  testAzuraScenarioTeamIds();
  testEmptyGames();
  testGamesUrlUsesPlayerTeamNotOpponent();
  testFixedPlayerStatsUsesGameIdsNotOpponentTeamId();
  testFilterWnbaGamesJune24PorChi();
  testClassifyPlayerH2HWhenGameStatsExist();
  testClassifyDidNotPlayWhenGamesButNoStats();
  testAzuraJune24StatRow();
  console.log("\nAll matchup history tests passed (14).");
}

main();
