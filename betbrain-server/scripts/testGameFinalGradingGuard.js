import assert from "node:assert/strict";

import {
  evaluateGradingBlock,
  getTodayLocalDate,
  gradePointsPick,
  resolvePlayerStatForPick,
} from "../services/resultService.js";

const CHI_DAL_LIVE_PICK = {
  player: "Gabriela Jaquez",
  team: "chicagosky",
  opponent: "dallaswings",
  gameLabel: "CHICAGOSKY vs DALLASWINGS",
  league: "WNBA",
  slateDate: "2026-06-20",
  gameDate: "2026-06-20",
  commenceTime: "2026-06-21T00:00:00.000Z",
  side: "Under",
  line: 9.5,
  officialLine: 9.5,
};

const FUTURE_PICK = {
  player: "Future Player",
  team: "SEA",
  opponent: "PHX",
  league: "WNBA",
  slateDate: "2099-12-31",
  commenceTime: "2099-12-31T02:00:00.000Z",
  side: "Under",
  line: 12.5,
};

const FINAL_WITH_ROW_PICK = {
  player: "Test Final Player",
  team: "chicagosky",
  opponent: "dallaswings",
  gameLabel: "CHICAGOSKY vs DALLASWINGS",
  league: "WNBA",
  slateDate: "2026-06-19",
  gameDate: "2026-06-19",
  commenceTime: "2026-06-19T23:00:00.000Z",
  side: "Over",
  line: 10.5,
  officialLine: 10.5,
};

const FINAL_AWAITING_STATS_PICK = {
  player: "Synthetic Awaiting Stats Player",
  team: "phoenixmercury",
  opponent: "seattlestorm",
  gameLabel: "SEATTLESTORM vs PHOENIXMERCURY",
  league: "WNBA",
  slateDate: "2026-06-20",
  gameDate: "2026-06-20",
  commenceTime: "2026-06-20T19:00:00.000Z",
  side: "Under",
  line: 9.5,
  officialLine: 9.5,
};

const LIVE_GAME_FINAL_CHECK = {
  gameFinal: false,
  gameStatus: "In Progress",
  blockedByGameNotFinal: true,
  blockedByLiveGame: true,
  verifiedSource: null,
  providers: [{ source: "ESPN", status: "In Progress", isFinal: false, isLive: true }],
};

const FINAL_GAME_FINAL_CHECK = {
  gameFinal: true,
  gameStatus: "Final",
  blockedByGameNotFinal: false,
  blockedByLiveGame: false,
  verifiedSource: "ESPN",
  providers: [{ source: "ESPN", status: "Final", isFinal: true, isLive: false }],
};

async function testChiDalLiveStaysPending() {
  const resolved = await resolvePlayerStatForPick(
    CHI_DAL_LIVE_PICK,
    [
      {
        source: "BallDontLie",
        league: "WNBA",
        date: "2026-06-20",
        player: "Gabriela Jaquez",
        team: "chicagosky",
        opponent: "dallaswings",
        points: 2,
      },
    ],
    { gameFinalOverride: LIVE_GAME_FINAL_CHECK }
  );

  assert.equal(resolved.statResult, null);
  assert.equal(resolved.pendingReason, "Game not final yet.");
  assert.equal(resolved.resolveDebug.blockedByGameNotFinal, true);
  assert.equal(resolved.resolveDebug.blockedByLiveGame, true);
  assert.equal(resolved.resolveDebug.gameStatus, "In Progress");

  const graded = gradePointsPick(CHI_DAL_LIVE_PICK, resolved.statResult, resolved);
  assert.equal(graded.status, "pending");
}

async function testFutureBlocked() {
  const block = evaluateGradingBlock(FUTURE_PICK);
  assert.equal(block.blocked, true);
  assert.equal(block.blockedByFutureGame, true);

  const resolved = await resolvePlayerStatForPick(FUTURE_PICK, []);
  assert.equal(resolved.gradingBlocked, true);
  assert.equal(resolved.statResult, null);
}

async function testFinalWithRowGrades() {
  const statResult = {
    source: "BallDontLie",
    league: "WNBA",
    date: "2026-06-19",
    player: "Test Final Player",
    team: "chicagosky",
    opponent: "dallaswings",
    points: 18,
    matchMeta: {
      matchedSource: "BallDontLie",
      matchedDate: "2026-06-19",
      matchedConfidence: "high",
    },
  };

  const resolved = await resolvePlayerStatForPick(FINAL_WITH_ROW_PICK, [statResult], {
    gameFinalOverride: FINAL_GAME_FINAL_CHECK,
  });

  assert.ok(resolved.statResult);
  assert.equal(resolved.resolveDebug.gameFinal, true);
  assert.equal(resolved.resolveDebug.blockedByGameNotFinal, false);

  const graded = gradePointsPick(FINAL_WITH_ROW_PICK, resolved.statResult, resolved);
  assert.equal(graded.status, "win");
  assert.equal(graded.actualStat, 18);
}

async function testFinalWithoutRowAwaitsStats() {
  const resolved = await resolvePlayerStatForPick(FINAL_AWAITING_STATS_PICK, [], {
    gameFinalOverride: FINAL_GAME_FINAL_CHECK,
  });

  assert.equal(resolved.statResult, null);
  assert.equal(resolved.resolveDebug.gameFinal, true);
  assert.equal(resolved.resolveDebug.blockedByGameNotFinal, false);
  assert.match(
    resolved.pendingReason || "",
    /awaiting official player stat row|unavailable from source/i
  );

  const graded = gradePointsPick(FINAL_AWAITING_STATS_PICK, resolved.statResult, resolved);
  assert.equal(graded.status, "pending");
}

async function run() {
  await testChiDalLiveStaysPending();
  await testFutureBlocked();
  await testFinalWithRowGrades();
  await testFinalWithoutRowAwaitsStats();
  console.log("GAME FINAL GRADING GUARD TESTS: PASS");
}

run().catch((err) => {
  console.error("GAME FINAL GRADING GUARD TESTS: FAIL", err);
  process.exit(1);
});
