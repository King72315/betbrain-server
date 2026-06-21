import assert from "node:assert/strict";

import {
  evaluateGradingBlock,
  getTodayLocalDate,
  isFutureSlateDate,
  resolvePlayerStatForPick,
} from "../services/resultService.js";

function testFutureSlateBlocked() {
  const today = getTodayLocalDate();
  const futureDate = "2099-12-31";

  assert.equal(isFutureSlateDate(futureDate, today), true);

  const pick = {
    player: "Test Player",
    team: "CHI",
    opponent: "DAL",
    league: "WNBA",
    slateDate: futureDate,
    commenceTime: `${futureDate}T23:00:00.000Z`,
    side: "Over",
    line: 15.5,
  };

  const block = evaluateGradingBlock(pick);
  assert.equal(block.blocked, true);
  assert.equal(block.blockedByFutureGame, true);
  assert.equal(block.gameStarted, false);
}

async function testResolveBlocksFutureGame() {
  const futureDate = "2099-12-31";
  const pick = {
    player: "Future Player",
    team: "SEA",
    opponent: "PHX",
    league: "WNBA",
    slateDate: futureDate,
    commenceTime: `${futureDate}T02:00:00.000Z`,
    side: "Under",
    line: 12.5,
  };

  const resolved = await resolvePlayerStatForPick(pick, []);
  assert.equal(resolved.statResult, null);
  assert.equal(resolved.gradingBlocked, true);
  assert.equal(resolved.resolveDebug.blockedByFutureGame, true);
  assert.equal(resolved.resolveDebug.gameStarted, false);
  assert.equal(resolved.resolveDebug.matchVerified, false);
  assert.match(resolved.pendingReason, /blocked/i);
}

async function testPastSlateNotFutureBlocked() {
  const today = getTodayLocalDate();
  const pick = {
    player: "Past Player",
    team: "CHI",
    opponent: "DAL",
    league: "WNBA",
    slateDate: "2026-06-19",
    commenceTime: "2026-06-19T23:00:00.000Z",
    side: "Over",
    line: 10.5,
  };

  const block = evaluateGradingBlock(pick);
  assert.equal(isFutureSlateDate(pick.slateDate, today), false);
  assert.equal(block.blockedByFutureGame, false);
}

async function run() {
  testFutureSlateBlocked();
  await testResolveBlocksFutureGame();
  await testPastSlateNotFutureBlocked();
  console.log("FUTURE GRADING BLOCK TESTS: PASS");
}

run().catch((err) => {
  console.error("FUTURE GRADING BLOCK TESTS: FAIL", err);
  process.exit(1);
});
