/**
 * WNBA team alias resolver tests.
 * Usage: node betbrain-server/scripts/testWnbaTeamAliasResolver.js
 */
import assert from "assert";
import {
  resolveWnbaTeamId,
  teamsMatch,
  formatWnbaTeamDisplay,
  listWnbaTeamAliases,
} from "../engines/wnba/wnbaTeamAliasResolver.js";

function testPortlandFireNoSpace() {
  assert.strictEqual(resolveWnbaTeamId("PORTLANDFIRE"), "portlandfire");
  assert.strictEqual(resolveWnbaTeamId("portland fire"), "portlandfire");
  assert.strictEqual(resolveWnbaTeamId("POR"), "portlandfire");
  console.log("✓ Portland Fire aliases");
}

function testChicagoSkyNoSpace() {
  assert.strictEqual(resolveWnbaTeamId("CHICAGOSKY"), "chicagosky");
  assert.strictEqual(resolveWnbaTeamId("Chicago Sky"), "chicagosky");
  assert.strictEqual(resolveWnbaTeamId("CHI"), "chicagosky");
  console.log("✓ Chicago Sky aliases");
}

function testTeamsMatchBidirectional() {
  assert.strictEqual(teamsMatch("POR", "portlandfire"), true);
  assert.strictEqual(teamsMatch("portlandfire", "POR"), true);
  assert.strictEqual(teamsMatch("CHI", "CHICAGOSKY"), true);
  assert.strictEqual(teamsMatch("chicagosky", "chi"), true);
  assert.strictEqual(teamsMatch("portlandfire", "chicagosky"), false);
  console.log("✓ bidirectional team match");
}

function testTeamObjectResolution() {
  const teamObj = {
    city: "Portland",
    name: "Fire",
    abbreviation: "POR",
  };
  assert.strictEqual(resolveWnbaTeamId(teamObj), "portlandfire");
  console.log("✓ team object resolution");
}

function testDisplayFormatting() {
  assert.strictEqual(formatWnbaTeamDisplay("CHI"), "Chicago Sky");
  assert.strictEqual(formatWnbaTeamDisplay("portlandfire"), "Portland Fire");
  console.log("✓ display formatting");
}

function testAliasListing() {
  const aliases = listWnbaTeamAliases("CHICAGOSKY");
  assert.ok(aliases.includes("chi"));
  assert.ok(aliases.includes("chicagosky"));
  console.log("✓ alias listing");
}

function testUnknownTeamReturnsEmpty() {
  assert.strictEqual(resolveWnbaTeamId("NOTAREALTEAM"), "");
  console.log("✓ unknown team empty");
}

function testMinnesotaLynxCompact() {
  assert.strictEqual(resolveWnbaTeamId("MINNESOTALYNX"), "minnesotalynx");
  assert.strictEqual(resolveWnbaTeamId("MIN"), "minnesotalynx");
  console.log("✓ Minnesota Lynx compact alias");
}

function main() {
  testPortlandFireNoSpace();
  testChicagoSkyNoSpace();
  testTeamsMatchBidirectional();
  testTeamObjectResolution();
  testDisplayFormatting();
  testAliasListing();
  testUnknownTeamReturnsEmpty();
  testMinnesotaLynxCompact();
  console.log("\nAll WNBA team alias resolver tests passed (8).");
}

main();
