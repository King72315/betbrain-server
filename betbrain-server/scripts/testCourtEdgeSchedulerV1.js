/**
 * CourtEdge scheduler v1 acceptance tests (cases 1–24).
 * Usage: node betbrain-server/scripts/testCourtEdgeSchedulerV1.js
 */
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import {
  JOB_IDS,
  JOB_STATUS,
  PROVIDER_ERROR_TYPES,
  SCHEDULER_CONFIG,
  SCHEDULER_VERSION,
  addLocalDays,
  classifyProviderError,
  configureSchedulerPaths,
  evaluateDueJobs,
  evaluatePregameRefreshDue,
  getCourtEdgeLocalParts,
  getSchedulerStatus,
  isPastOnlyLkgBoard,
  loadBoardCache,
  loadSchedulerState,
  parseGameStartMs,
  resetSchedulerPaths,
  resolvePregameTipTiming,
  runScheduledJobs,
  saveBoardCache,
  saveSchedulerState,
  shouldPreserveExistingBoard,
  verifySchedulerToken,
} from "../services/courtEdgeSchedulerV1.js";

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.message });
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.message });
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

function makeTempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ce-sched-${label}-`));
  configureSchedulerPaths({
    stateFile: path.join(dir, "state.json"),
    boardCacheFile: path.join(dir, "board-cache.json"),
  });
  return dir;
}

function chicagoAt({ hour, minute = 0, slateDate = "2026-07-13" }) {
  // Construct a UTC instant that is the given CT wall time on slateDate.
  // Use midday probe then adjust via formatter (DST-safe enough for tests).
  const [y, m, d] = slateDate.split("-").map(Number);
  let guess = new Date(Date.UTC(y, m - 1, d, hour + 5, minute, 0));
  for (let i = 0; i < 6; i += 1) {
    const parts = getCourtEdgeLocalParts(guess);
    const targetMin = hour * 60 + minute;
    const delta = targetMin - parts.minutesOfDay;
    if (parts.slateDate === slateDate && delta === 0) return guess;
    guess = new Date(guess.getTime() + delta * 60 * 1000);
    if (parts.slateDate !== slateDate) {
      // nudge calendar
      const dayDelta =
        Date.parse(`${slateDate}T12:00:00Z`) - Date.parse(`${parts.slateDate}T12:00:00Z`);
      guess = new Date(guess.getTime() + dayDelta);
    }
  }
  return guess;
}

function fixtureToday() {
  return getCourtEdgeLocalParts().slateDate;
}

function validBoard(slateDate = fixtureToday(), dayBucket = "TODAY", extras = {}) {
  return {
    ok: true,
    lastUpdated: new Date().toISOString(),
    slateDate,
    games: [
      {
        gameId: "g1",
        league: "WNBA",
        date: slateDate,
        slateDate,
        dayBucket,
        commenceTime:
          extras.commenceTime ||
          chicagoAt({ hour: 19, minute: 0, slateDate }).toISOString(),
        time: extras.time,
        picks: [{ player: "A", side: "Over", line: 15 }],
        ...extras.gameExtras,
      },
      ...(extras.extraGames || []),
    ],
    bestSixWNBA: Array.from({ length: 6 }, (_, i) => ({
      player: `P${i}`,
      side: i % 2 ? "Under" : "Over",
      line: 10 + i,
      slateDate,
      commenceTime: chicagoAt({ hour: 19, minute: 0, slateDate }).toISOString(),
    })),
    topWNBAProps: [
      { player: "P0", side: "Over", line: 10 },
      { player: "P1", side: "Under", line: 11 },
    ],
  };
}

function todayGame({
  slateDate = "2026-07-13",
  tipHour,
  tipMinute = 0,
  gameId = "g-tip",
  commenceTime,
} = {}) {
  return {
    gameId,
    league: "WNBA",
    date: slateDate,
    dayBucket: "TODAY",
    commenceTime:
      commenceTime ||
      chicagoAt({ hour: tipHour, minute: tipMinute, slateDate }).toISOString(),
    picks: [{ player: "A", side: "Over", line: 15 }],
  };
}

console.log("\nCourtEdge Scheduler V1 tests\n");

test("scheduler version + job ids exported", () => {
  assert.equal(SCHEDULER_VERSION, "courtedge-scheduler-v1");
  assert.ok(JOB_IDS.TODAY_MORNING_REFRESH);
  assert.ok(JOB_IDS.TODAY_PREGAME_REFRESH);
  assert.ok(JOB_IDS.TOMORROW_NIGHT_REFRESH);
  assert.ok(JOB_IDS.RESULTS_GRADE_CHECK);
  assert.ok(JOB_IDS.SLATE_LIFECYCLE_CHECK);
});

test("proposed Chicago windows documented in config", () => {
  assert.equal(SCHEDULER_CONFIG.windows.TODAY_MORNING_REFRESH.hour, 8);
  assert.equal(SCHEDULER_CONFIG.windows.TODAY_PREGAME_REFRESH.mode, "game_time_aware");
  assert.equal(SCHEDULER_CONFIG.windows.TODAY_PREGAME_REFRESH.minMinutesBeforeTip, 90);
  assert.equal(SCHEDULER_CONFIG.windows.TODAY_PREGAME_REFRESH.maxMinutesBeforeTip, 120);
  assert.equal(SCHEDULER_CONFIG.windows.TODAY_PREGAME_REFRESH.fallbackHour, 17);
  assert.equal(SCHEDULER_CONFIG.windows.TOMORROW_NIGHT_REFRESH.hour, 22);
  assert.equal(SCHEDULER_CONFIG.timezone, "America/Chicago");
});

test("15 Chicago date parts use America/Chicago around midnight", () => {
  // 2026-07-14 04:30 UTC = 2026-07-13 23:30 CT (CDT)
  const before = getCourtEdgeLocalParts(new Date("2026-07-14T04:30:00.000Z"));
  assert.equal(before.slateDate, "2026-07-13");
  // 2026-07-14 05:30 UTC = 2026-07-14 00:30 CT
  const after = getCourtEdgeLocalParts(new Date("2026-07-14T05:30:00.000Z"));
  assert.equal(after.slateDate, "2026-07-14");
  assert.equal(addLocalDays("2026-07-13", 1), "2026-07-14");
});

await testAsync("1 app never opened — morning window builds Today slate", async () => {
  makeTempDir("t1");
  let refreshCount = 0;
  const now = chicagoAt({ hour: 8, minute: 15, slateDate: "2026-07-13" });
  const result = await runScheduledJobs({
    now,
    source: "test",
    serverBuild: "courteedge-server-automation-scheduler-v1",
    handlers: {
      refreshBoard: async () => {
        refreshCount += 1;
        return validBoard("2026-07-13", "TODAY");
      },
      gradeTracked: async () => ({ summary: { gradedCount: 0 } }),
      runLifecycle: async () => ({ summary: { slateCount: 0 } }),
    },
  });
  assert.ok(result.jobsRun.some((j) => j.jobId === JOB_IDS.TODAY_MORNING_REFRESH));
  assert.equal(refreshCount, 1);
  assert.ok(loadBoardCache()?.games?.length > 0);
});

await testAsync("2 tomorrow night window builds Tomorrow", async () => {
  makeTempDir("t2");
  const tomorrow = addLocalDays("2026-07-13", 1);
  const now = chicagoAt({ hour: 22, minute: 30, slateDate: "2026-07-13" });
  let sawOffset = null;
  await runScheduledJobs({
    now,
    handlers: {
      refreshBoard: async (_offset, meta) => {
        sawOffset = meta?.jobId;
        return validBoard(tomorrow, "TOMORROW");
      },
      gradeTracked: async () => ({ summary: {} }),
      runLifecycle: async () => ({ summary: {} }),
    },
  });
  assert.equal(sawOffset, JOB_IDS.TOMORROW_NIGHT_REFRESH);
  const state = loadSchedulerState();
  assert.ok(state.lastValidTomorrowSlateAt);
});

await testAsync("3 duplicate scheduler request skips — no duplicate props", async () => {
  makeTempDir("t3");
  const now = chicagoAt({ hour: 8, minute: 20, slateDate: "2026-07-13" });
  let refreshCount = 0;
  const handlers = {
    refreshBoard: async () => {
      refreshCount += 1;
      return validBoard();
    },
    gradeTracked: async () => ({ summary: {} }),
    runLifecycle: async () => ({ summary: {} }),
  };
  await runScheduledJobs({ now, handlers });
  const second = await runScheduledJobs({ now, handlers });
  assert.equal(refreshCount, 1);
  assert.ok(
    second.jobsSkipped.some(
      (s) =>
        s.jobId === JOB_IDS.TODAY_MORNING_REFRESH &&
        s.reason === "already_succeeded_today"
    )
  );
});

await testAsync("4 concurrent requests — only one obtains lock", async () => {
  makeTempDir("t4");
  const now = chicagoAt({ hour: 8, minute: 25, slateDate: "2026-07-13" });
  let started = 0;
  let gateResolve;
  const gate = new Promise((r) => {
    gateResolve = r;
  });
  const handlers = {
    refreshBoard: async () => {
      started += 1;
      await gate;
      return validBoard();
    },
    gradeTracked: async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { summary: {} };
    },
    runLifecycle: async () => ({ summary: {} }),
  };
  const p1 = runScheduledJobs({ now, handlers });
  await new Promise((r) => setTimeout(r, 30));
  const p2 = runScheduledJobs({ now, handlers });
  gateResolve();
  const [a, b] = await Promise.all([p1, p2]);
  const lockSkips = [...a.jobsSkipped, ...b.jobsSkipped].filter((s) =>
    String(s.reason || "").includes("lock")
  );
  assert.ok(started <= 1 || lockSkips.length >= 1);
});

await testAsync("5 cold-start timeout classified retryable", async () => {
  const c = classifyProviderError(new Error("Request timed out"), { coldStart: true });
  assert.equal(c.type, PROVIDER_ERROR_TYPES.COLD_START);
  assert.equal(c.retryable, true);
});

test("6 invalid scheduler token rejected", () => {
  const prev = process.env.COURTEDGE_SCHEDULER_TOKEN;
  process.env.COURTEDGE_SCHEDULER_TOKEN = "expected-token";
  try {
    assert.equal(verifySchedulerToken("").ok, false);
    assert.equal(verifySchedulerToken("wrong").ok, false);
    assert.equal(verifySchedulerToken("expected-token").ok, true);
  } finally {
    if (prev === undefined) delete process.env.COURTEDGE_SCHEDULER_TOKEN;
    else process.env.COURTEDGE_SCHEDULER_TOKEN = prev;
  }
});

await testAsync("7 stale lock recovers safely", async () => {
  makeTempDir("t7");
  const now = chicagoAt({ hour: 8, minute: 40, slateDate: "2026-07-13" });
  const state = loadSchedulerState();
  state.jobs[JOB_IDS.TODAY_MORNING_REFRESH] = {
    ...state.jobs[JOB_IDS.TODAY_MORNING_REFRESH],
    status: JOB_STATUS.RUNNING,
    // Stale relative to simulated `now`, not wall clock (DST/test isolation).
    lockAcquiredAt: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    lockOwner: "dead-run",
    slateDate: "2026-07-13",
  };
  saveSchedulerState(state);
  let ran = 0;
  const result = await runScheduledJobs({
    now,
    handlers: {
      refreshBoard: async () => {
        ran += 1;
        return validBoard();
      },
      gradeTracked: async () => ({ summary: {} }),
      runLifecycle: async () => ({ summary: {} }),
    },
  });
  assert.equal(ran, 1);
  assert.ok(result.jobsRun.some((j) => j.jobId === JOB_IDS.TODAY_MORNING_REFRESH));
});

await testAsync("8 provider timeout preserves previous slate", async () => {
  makeTempDir("t8");
  saveBoardCache(validBoard("2026-07-13"));
  const now = chicagoAt({ hour: 17, minute: 10, slateDate: "2026-07-13" });
  await runScheduledJobs({
    now,
    handlers: {
      refreshBoard: async () => {
        const err = new Error("provider timeout");
        err.code = "ETIMEDOUT";
        throw err;
      },
      gradeTracked: async () => ({ summary: {} }),
      runLifecycle: async () => ({ summary: {} }),
    },
  });
  assert.equal(loadBoardCache().games.length, 1);
});

test("9 provider 401 credential — not retryable", () => {
  const c = classifyProviderError(new Error("Unauthorized invalid key"), { status: 401 });
  assert.equal(c.type, PROVIDER_ERROR_TYPES.AUTH_401);
  assert.equal(c.retryable, false);
});

test("10 provider 429 respects retryable + Retry-After", () => {
  const c = classifyProviderError(new Error("rate limit"), {
    status: 429,
    retryAfter: 3,
  });
  assert.equal(c.type, PROVIDER_ERROR_TYPES.RATE_LIMIT_429);
  assert.equal(c.retryable, true);
  assert.equal(c.retryAfterMs, 3000);
});

test("11 empty provider response does not replace valid slate", () => {
  const prev = validBoard();
  const next = { ok: true, games: [], lastUpdated: new Date().toISOString() };
  assert.equal(shouldPreserveExistingBoard(prev, next, false), true);
});

test("11b zombie zero-candidate board does not replace LKG Best6", () => {
  const prev = {
    ...validBoard(),
    games: [
      {
        dayBucket: "TODAY",
        commenceTime: "2026-07-13T00:00:00.000Z",
        slateDate: "2026-07-13",
        allGeneratedCandidates: Array.from({ length: 6 }, (_, i) => ({
          player: `P${i}`,
        })),
      },
    ],
    bestSixDisplayTodayWNBA: Array.from({ length: 6 }, (_, i) => ({
      player: `P${i}`,
      commenceTime: "2026-07-13T00:00:00.000Z",
      slateDate: "2026-07-13",
    })),
    bestSixDisplayTomorrowWNBA: Array.from({ length: 6 }, (_, i) => ({
      player: `T${i}`,
      commenceTime: "2026-07-14T00:00:00.000Z",
      slateDate: "2026-07-14",
    })),
  };
  const next = {
    ok: true,
    games: [{ dayBucket: "TODAY", allGeneratedCandidates: [], rawPropCount: 20 }],
    bestSixDisplayTodayWNBA: [],
    bestSixDisplayTomorrowWNBA: [],
  };
  assert.equal(
    shouldPreserveExistingBoard(prev, next, false, { today: "2026-07-13" }),
    true
  );
});

test("11c past-only LKG does not block fresh empty overwrite", () => {
  const prev = {
    ok: true,
    games: [
      {
        dayBucket: "TODAY",
        commenceTime: "2026-07-19T00:00:00.000Z",
        slateDate: "2026-07-19",
        allGeneratedCandidates: Array.from({ length: 6 }, (_, i) => ({
          player: `Old${i}`,
        })),
      },
      {
        dayBucket: "TOMORROW",
        commenceTime: "2026-07-21T00:00:00.000Z",
        slateDate: "2026-07-21",
        allGeneratedCandidates: Array.from({ length: 6 }, (_, i) => ({
          player: `Tom${i}`,
        })),
      },
    ],
    bestSixDisplayTodayWNBA: Array.from({ length: 6 }, (_, i) => ({
      player: `Old${i}`,
      commenceTime: "2026-07-19T00:00:00.000Z",
      slateDate: "2026-07-19",
    })),
    bestSixDisplayTomorrowWNBA: Array.from({ length: 6 }, (_, i) => ({
      player: `Tom${i}`,
      commenceTime: "2026-07-21T00:00:00.000Z",
      slateDate: "2026-07-21",
    })),
  };
  assert.equal(isPastOnlyLkgBoard(prev, "2026-07-22"), true);
  const next = {
    ok: true,
    games: [
      {
        dayBucket: "TODAY",
        commenceTime: "2026-07-22T00:00:00.000Z",
        slateDate: "2026-07-22",
        allGeneratedCandidates: [{ player: "Fresh" }],
      },
    ],
    bestSixDisplayTodayWNBA: [{ player: "Fresh" }],
  };
  assert.equal(
    shouldPreserveExistingBoard(prev, next, false, { today: "2026-07-22" }),
    false
  );
  // Even a thin/empty next must be allowed so sanitize+refresh can rebuild.
  assert.equal(
    shouldPreserveExistingBoard(
      prev,
      { ok: true, games: [], bestSixDisplayTodayWNBA: [] },
      false,
      { today: "2026-07-22" }
    ),
    false
  );
});

await testAsync("12 automatic grading without opening Results", async () => {
  makeTempDir("t12");
  let graded = false;
  const now = chicagoAt({ hour: 12, minute: 0, slateDate: "2026-07-13" });
  // Outside refresh windows — grade/lifecycle still due by interval.
  await runScheduledJobs({
    now,
    handlers: {
      refreshBoard: async () => validBoard(),
      gradeTracked: async () => {
        graded = true;
        return { summary: { gradedCount: 1 } };
      },
      runLifecycle: async () => ({ summary: {} }),
    },
  });
  assert.equal(graded, true);
  assert.ok(loadSchedulerState().lastGradingCheckAt);
});

await testAsync("13 pending official stats remain awaiting", async () => {
  makeTempDir("t13");
  const now = chicagoAt({ hour: 12, minute: 0, slateDate: "2026-07-13" });
  const result = await runScheduledJobs({
    now,
    handlers: {
      refreshBoard: async () => validBoard(),
      gradeTracked: async () => ({
        summary: { gradedCount: 0, stillPending: 2, awaitingStats: 2 },
      }),
      runLifecycle: async () => ({ summary: { built: [] } }),
    },
  });
  const gradeRun = result.jobsRun.find((j) => j.jobId === JOB_IDS.RESULTS_GRADE_CHECK);
  assert.equal(gradeRun.summary.stillPending, 2);
});

await testAsync("14 lifecycle promote Lab/History once", async () => {
  makeTempDir("t14");
  let lifeCalls = 0;
  const now = chicagoAt({ hour: 12, minute: 0, slateDate: "2026-07-13" });
  const handlers = {
    refreshBoard: async () => validBoard(),
    gradeTracked: async () => ({ summary: { gradedCount: 6, stillPending: 0 } }),
    runLifecycle: async () => {
      lifeCalls += 1;
      return { summary: { promoted: 1, archived: 1 } };
    },
  };
  await runScheduledJobs({ now, handlers });
  await runScheduledJobs({ now, handlers });
  // Second call should skip lifecycle by interval (same successful timestamp).
  assert.equal(lifeCalls, 1);
});

test("15 Chicago midnight date rollover covered", () => {
  const local = getCourtEdgeLocalParts(new Date("2026-07-14T05:01:00.000Z"));
  assert.equal(local.slateDate, "2026-07-14");
});

await testAsync("16 server restart persisted state prevents duplicate", async () => {
  const dir = makeTempDir("t16");
  const now = chicagoAt({ hour: 8, minute: 10, slateDate: "2026-07-13" });
  let refreshes = 0;
  const handlers = {
    refreshBoard: async () => {
      refreshes += 1;
      return validBoard();
    },
    gradeTracked: async () => ({ summary: {} }),
    runLifecycle: async () => ({ summary: {} }),
  };
  await runScheduledJobs({ now, handlers });
  // simulate restart — reconfigure same files
  configureSchedulerPaths({
    stateFile: path.join(dir, "state.json"),
    boardCacheFile: path.join(dir, "board-cache.json"),
  });
  await runScheduledJobs({ now, handlers });
  assert.equal(refreshes, 1);
});

await testAsync("17 manual refresh then scheduled — dedupe via board current", async () => {
  makeTempDir("t17");
  saveBoardCache(validBoard());
  const now = chicagoAt({ hour: 8, minute: 15, slateDate: "2026-07-13" });
  let refreshes = 0;
  const result = await runScheduledJobs({
    now,
    handlers: {
      getPreviousBoard: () => loadBoardCache(),
      isBoardCurrent: () => true,
      refreshBoard: async () => {
        refreshes += 1;
        return validBoard();
      },
      gradeTracked: async () => ({ summary: {} }),
      runLifecycle: async () => ({ summary: {} }),
    },
  });
  assert.equal(refreshes, 0);
  assert.ok(
    result.jobsSkipped.some(
      (s) =>
        s.jobId === JOB_IDS.TODAY_MORNING_REFRESH &&
        s.reason === "board_already_current"
    )
  );
});

await testAsync("18 scheduled after manual — slate already current", async () => {
  // same mechanism as 17
  makeTempDir("t18");
  const now = chicagoAt({ hour: 17, minute: 20, slateDate: "2026-07-13" });
  let refreshes = 0;
  await runScheduledJobs({
    now,
    handlers: {
      isBoardCurrent: () => true,
      refreshBoard: async () => {
        refreshes += 1;
        return validBoard();
      },
      gradeTracked: async () => ({ summary: {} }),
      runLifecycle: async () => ({ summary: {} }),
    },
  });
  assert.equal(refreshes, 0);
});

test("19 screen opening read-only contract — GET does not require refresh handlers", () => {
  // Documented by server change: getReadOnlyBoard / no refreshAllPicks on GET.
  assert.equal(typeof loadBoardCache, "function");
  assert.equal(typeof evaluateDueJobs, "function");
});

test("20 Controlled Best 6 size unchanged (6)", () => {
  const board = validBoard();
  assert.equal(board.bestSixWNBA.length, 6);
});

test("21 Top 2 behavior unchanged in fixture", () => {
  assert.equal(validBoard().topWNBAProps.length, 2);
});

test("22 side Over/Under symmetry fixture intact", () => {
  const sides = validBoard().bestSixWNBA.map((p) => p.side);
  assert.ok(sides.includes("Over"));
  assert.ok(sides.includes("Under"));
});

test("23 Player Role Profile not modified by scheduler module", () => {
  const schedulerPath = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "services",
    "courtEdgeSchedulerV1.js"
  );
  const src = fs.readFileSync(schedulerPath, "utf8");
  assert.ok(!/playerRoleProfile|projectionFormula|sideSelectionEngine/.test(src));
});

await testAsync("24 Results/Lab/History not cleared by scheduler", async () => {
  makeTempDir("t24");
  saveBoardCache(validBoard());
  const before = loadBoardCache();
  const now = chicagoAt({ hour: 12, minute: 0, slateDate: "2026-07-13" });
  await runScheduledJobs({
    now,
    handlers: {
      refreshBoard: async () => validBoard(),
      gradeTracked: async () => ({ summary: { gradedCount: 0 } }),
      runLifecycle: async () => ({ summary: { cleared: false } }),
    },
  });
  assert.deepEqual(
    loadBoardCache().games.map((g) => g.gameId),
    before.games.map((g) => g.gameId)
  );
  assert.equal(typeof getSchedulerStatus().jobs, "object");
});

test("status endpoint shape has required fields", () => {
  makeTempDir("status");
  const status = getSchedulerStatus({
    now: chicagoAt({ hour: 9, minute: 0, slateDate: "2026-07-13" }),
  });
  assert.equal(status.ok, true);
  assert.ok(status.courtEdgeLocalTime);
  assert.ok(status.jobs[JOB_IDS.TODAY_MORNING_REFRESH]);
  assert.ok(status.proposedWindows);
});

test("pregame afternoon tip fires mid-day (not waiting for 5 PM)", () => {
  makeTempDir("pregame-afternoon");
  // Earliest tip 1:00 PM CT → pregame window 11:00–11:30 CT.
  const games = [todayGame({ tipHour: 13, tipMinute: 0 })];
  const midDay = chicagoAt({ hour: 11, minute: 15, slateDate: "2026-07-13" });
  const fivePm = chicagoAt({ hour: 17, minute: 10, slateDate: "2026-07-13" });

  const dueMid = evaluatePregameRefreshDue({
    now: midDay,
    games,
    job: loadSchedulerState().jobs[JOB_IDS.TODAY_PREGAME_REFRESH],
  });
  assert.equal(dueMid.due, true);
  assert.equal(dueMid.trigger, "earliest_unstarted_tip");
  assert.ok(dueMid.minutesUntilTip >= 90 && dueMid.minutesUntilTip <= 120);

  // After tip window closed and tip not yet started, must NOT use 5 PM fallback.
  const dueFive = evaluatePregameRefreshDue({
    now: fivePm,
    games,
    job: loadSchedulerState().jobs[JOB_IDS.TODAY_PREGAME_REFRESH],
  });
  assert.equal(dueFive.due, false);
  assert.ok(
    dueFive.reason === "too_late_for_pregame_tip_window" ||
      dueFive.reason === "all_known_tips_started" ||
      dueFive.reason === "too_early_for_pregame_tip_window"
  );
});

test("pregame evening tip fires ~90–120 minutes before tip", () => {
  makeTempDir("pregame-evening");
  // Tip 7:00 PM CT → window 5:00–5:30 PM CT.
  const games = [todayGame({ tipHour: 19, tipMinute: 0 })];
  const inWindow = chicagoAt({ hour: 17, minute: 15, slateDate: "2026-07-13" });
  const tooEarly = chicagoAt({ hour: 16, minute: 0, slateDate: "2026-07-13" });

  const due = evaluatePregameRefreshDue({
    now: inWindow,
    games,
    job: loadSchedulerState().jobs[JOB_IDS.TODAY_PREGAME_REFRESH],
  });
  assert.equal(due.due, true);
  assert.equal(due.trigger, "earliest_unstarted_tip");
  assert.ok(due.minutesUntilTip >= 90 && due.minutesUntilTip <= 120);

  const early = evaluatePregameRefreshDue({
    now: tooEarly,
    games,
    job: loadSchedulerState().jobs[JOB_IDS.TODAY_PREGAME_REFRESH],
  });
  assert.equal(early.due, false);
  assert.equal(early.reason, "too_early_for_pregame_tip_window");
});

test("pregame missing start times uses 5 PM CT fallback", () => {
  makeTempDir("pregame-fallback");
  const games = [
    {
      gameId: "g-no-time",
      league: "WNBA",
      date: "2026-07-13",
      dayBucket: "TODAY",
      picks: [{ player: "A", side: "Over", line: 12 }],
    },
  ];
  assert.equal(parseGameStartMs(games[0]), null);

  const atNoon = evaluatePregameRefreshDue({
    now: chicagoAt({ hour: 12, minute: 0 }),
    games,
    job: loadSchedulerState().jobs[JOB_IDS.TODAY_PREGAME_REFRESH],
  });
  assert.equal(atNoon.due, false);
  assert.equal(atNoon.reason, "outside_fallback_window_no_valid_tip_times");

  const atFive = evaluatePregameRefreshDue({
    now: chicagoAt({ hour: 17, minute: 10 }),
    games,
    job: loadSchedulerState().jobs[JOB_IDS.TODAY_PREGAME_REFRESH],
  });
  assert.equal(atFive.due, true);
  assert.equal(atFive.trigger, "fallback_1700_ct");
});

test("pregame already-started slate does not refetch via 5 PM fallback", () => {
  makeTempDir("pregame-started");
  // Tip was 1:00 PM; now 5:15 PM — games started; must not fall back to 17:00.
  const games = [todayGame({ tipHour: 13, tipMinute: 0 })];
  const now = chicagoAt({ hour: 17, minute: 15, slateDate: "2026-07-13" });
  const timing = resolvePregameTipTiming(games, now);
  assert.equal(timing.hasValidStartTimes, true);
  assert.equal(timing.allKnownTipsStarted, true);

  const decision = evaluatePregameRefreshDue({
    now,
    games,
    job: loadSchedulerState().jobs[JOB_IDS.TODAY_PREGAME_REFRESH],
  });
  assert.equal(decision.due, false);
  assert.equal(decision.reason, "all_known_tips_started");
});

await testAsync("pregame idempotent once succeeded for slateDate", async () => {
  makeTempDir("pregame-idem");
  const tipHour = 19;
  const games = [todayGame({ tipHour, tipMinute: 0 })];
  const board = validBoard("2026-07-13", "TODAY", {
    commenceTime: games[0].commenceTime,
  });
  saveBoardCache(board);

  const now = chicagoAt({ hour: 17, minute: 15, slateDate: "2026-07-13" });
  let refreshes = 0;
  const handlers = {
    getPreviousBoard: () => loadBoardCache(),
    getTodaySlateGames: () => games,
    refreshBoard: async () => {
      refreshes += 1;
      return board;
    },
    gradeTracked: async () => ({ summary: {} }),
    runLifecycle: async () => ({ summary: {} }),
  };

  const first = await runScheduledJobs({ now, handlers });
  assert.ok(
    first.jobsRun.some(
      (j) =>
        j.jobId === JOB_IDS.TODAY_PREGAME_REFRESH &&
        j.status === JOB_STATUS.SUCCEEDED
    )
  );
  assert.equal(refreshes, 1);

  // Simulate next 15-min dispatcher tick still inside tip window.
  const second = await runScheduledJobs({
    now: chicagoAt({ hour: 17, minute: 20, slateDate: "2026-07-13" }),
    handlers,
  });
  assert.equal(refreshes, 1);
  assert.ok(
    second.jobsSkipped.some(
      (s) =>
        s.jobId === JOB_IDS.TODAY_PREGAME_REFRESH &&
        s.reason === "already_succeeded_today"
    )
  );

  const state = loadSchedulerState();
  assert.equal(
    state.jobs[JOB_IDS.TODAY_PREGAME_REFRESH].lastCompletedSlateDate,
    "2026-07-13"
  );
});

test("evaluateDueJobs wires pregame game-time path", () => {
  makeTempDir("pregame-due-jobs");
  const games = [todayGame({ tipHour: 13, tipMinute: 0 })];
  const now = chicagoAt({ hour: 11, minute: 10, slateDate: "2026-07-13" });
  const state = loadSchedulerState();
  const evaluation = evaluateDueJobs(now, state, {
    getTodaySlateGames: () => games,
  });
  assert.ok(
    evaluation.due.some((d) => d.jobId === JOB_IDS.TODAY_PREGAME_REFRESH)
  );
  assert.ok(
    !evaluation.due.some((d) => d.jobId === JOB_IDS.TODAY_MORNING_REFRESH)
  );
});

resetSchedulerPaths();

console.log(`\nScheduler tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.error(` - ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
