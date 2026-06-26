/**
 * Opponent matchup history lookup tests (team-id bidirectional).
 * Usage: node betbrain-server/scripts/testMatchupHistory.js
 */
import assert from "assert";
import { teamsMatch, resolveWnbaTeamId } from "../engines/wnba/wnbaTeamAliasResolver.js";

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

function main() {
  testChiPorAliasMatch();
  testNoSpaceUppercaseOpponent();
  testBidirectionalAbbrev();
  testWrongOpponentNoMatch();
  testLegacyCleanOpponentStillWorks();
  testMultipleOpponentsPicksCorrect();
  testAzuraScenarioTeamIds();
  testEmptyGames();
  console.log("\nAll matchup history tests passed (8).");
}

main();
