/**
 * CourtEdge server automation scheduler v1.
 * One dispatcher: evaluate due jobs, run only those, persist state + locks.
 * Does not own projection/grading/lifecycle formulas — calls injected handlers.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { CONFIG } from "../config.js";
import {
  classifyHomeDayBucket,
  getTodayLocalDate,
  resolveHomeBoardSlateDate,
} from "./slateScopeService.js";
import {
  DURABLE_KEYS,
  getDurableStoreHealthSync,
  syncKeyToDurableFireAndForget,
} from "./courtEdgeDurableStoreV1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SCHEDULER_VERSION = "courtedge-scheduler-v1";
export const AUTONOMOUS_OPS_BUILD = "courteedge-fully-autonomous-operation-v1";

export const JOB_IDS = Object.freeze({
  TODAY_MORNING_REFRESH: "TODAY_MORNING_REFRESH",
  TODAY_PREGAME_REFRESH: "TODAY_PREGAME_REFRESH",
  TOMORROW_NIGHT_REFRESH: "TOMORROW_NIGHT_REFRESH",
  RESULTS_GRADE_CHECK: "RESULTS_GRADE_CHECK",
  SLATE_LIFECYCLE_CHECK: "SLATE_LIFECYCLE_CHECK",
});

export const JOB_STATUS = Object.freeze({
  IDLE: "IDLE",
  RUNNING: "RUNNING",
  SUCCEEDED: "SUCCEEDED",
  FAILED: "FAILED",
  SKIPPED: "SKIPPED",
  PARTIAL: "PARTIAL",
});

/**
 * America/Chicago windows.
 * Morning same-day + night Tomorrow remain fixed clock windows.
 * Pregame is game-time aware (90–120m before earliest unstarted tip);
 * 17:00 CT is only a documented fallback when no valid tip times exist.
 */
export const SCHEDULER_CONFIG = Object.freeze({
  timezone: process.env.COURTEDGE_TIMEZONE || CONFIG.TIMEZONE || "America/Chicago",
  enabled: process.env.COURTEDGE_SCHEDULER_ENABLED !== "false",
  staleLockMs: Number(process.env.COURTEDGE_SCHEDULER_STALE_LOCK_MS || 20 * 60 * 1000),
  gradeCheckEveryMinutes: Number(
    process.env.COURTEDGE_GRADE_CHECK_MINUTES || 15
  ),
  lifecycleCheckEveryMinutes: Number(
    process.env.COURTEDGE_LIFECYCLE_CHECK_MINUTES || 15
  ),
  windows: Object.freeze({
    TODAY_MORNING_REFRESH: Object.freeze({
      hour: 8,
      minute: 0,
      windowMinutes: 90,
      dayOffset: 0,
      label: "morning same-day refresh",
    }),
    TODAY_PREGAME_REFRESH: Object.freeze({
      mode: "game_time_aware",
      dayOffset: 0,
      minMinutesBeforeTip: 90,
      maxMinutesBeforeTip: 120,
      // Documented fallback when the Today slate has no parseable tip times.
      fallbackHour: 17,
      fallbackMinute: 0,
      fallbackWindowMinutes: 120,
      // Aliases kept for status/report readers that expect hour/minute shape.
      hour: 17,
      minute: 0,
      windowMinutes: 120,
      label:
        "pregame refresh (90–120m before earliest unstarted tip; 17:00 CT fallback)",
    }),
    TOMORROW_NIGHT_REFRESH: Object.freeze({
      hour: 22,
      minute: 0,
      windowMinutes: 120,
      dayOffset: 1,
      label: "night Tomorrow refresh",
    }),
  }),
  maxProviderRetries: 2,
  retryBackoffMs: [2000, 5000],
});

export const PROVIDER_ERROR_TYPES = Object.freeze({
  AUTH_401: "AUTH_401",
  FORBIDDEN_403: "FORBIDDEN_403",
  RATE_LIMIT_429: "RATE_LIMIT_429",
  TIMEOUT: "TIMEOUT",
  DNS_CONNECT: "DNS_CONNECT",
  EMPTY_MARKET: "EMPTY_MARKET",
  INCOMPLETE_SLATE: "INCOMPLETE_SLATE",
  INTERNAL: "INTERNAL",
  COLD_START: "COLD_START",
  UNKNOWN: "UNKNOWN",
});

const DEFAULT_STATE_FILE = path.join(
  __dirname,
  "..",
  "courtedge-scheduler-state-v1.json"
);
const DEFAULT_BOARD_CACHE_FILE = path.join(
  __dirname,
  "..",
  "board-cache.json"
);

let stateFilePath = DEFAULT_STATE_FILE;
let boardCacheFilePath = DEFAULT_BOARD_CACHE_FILE;
const processLocks = new Map();

export function configureSchedulerPaths(options = {}) {
  if (options.stateFile) stateFilePath = options.stateFile;
  if (options.boardCacheFile) boardCacheFilePath = options.boardCacheFile;
  // Always drop in-memory locks when rebinding paths (tests / process isolation).
  processLocks.clear();
}

export function resetSchedulerPaths() {
  stateFilePath = DEFAULT_STATE_FILE;
  boardCacheFilePath = DEFAULT_BOARD_CACHE_FILE;
  processLocks.clear();
}

function emptyJobState(jobId) {
  return {
    jobId,
    slateDate: null,
    lastAttemptAt: null,
    lastSuccessfulRunAt: null,
    lastCompletedSlateDate: null,
    status: JOB_STATUS.IDLE,
    runId: null,
    skipReason: null,
    errorType: null,
    errorMessage: null,
    providerStatus: null,
    serverBuild: null,
    lockAcquiredAt: null,
    lockOwner: null,
  };
}

function emptyState() {
  const jobs = {};
  for (const id of Object.values(JOB_IDS)) {
    jobs[id] = emptyJobState(id);
  }
  return {
    version: SCHEDULER_VERSION,
    enabled: SCHEDULER_CONFIG.enabled,
    updatedAt: null,
    lastDispatcherAt: null,
    lastValidTodaySlateAt: null,
    lastValidTomorrowSlateAt: null,
    lastGradingCheckAt: null,
    lastLifecycleCompletionAt: null,
    jobs,
  };
}

function readJsonSafe(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonSafe(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

export function loadSchedulerState() {
  const raw = readJsonSafe(stateFilePath, null);
  if (!raw || typeof raw !== "object") return emptyState();
  const base = emptyState();
  base.enabled = raw.enabled !== false;
  base.updatedAt = raw.updatedAt || null;
  base.lastDispatcherAt = raw.lastDispatcherAt || null;
  base.lastValidTodaySlateAt = raw.lastValidTodaySlateAt || null;
  base.lastValidTomorrowSlateAt = raw.lastValidTomorrowSlateAt || null;
  base.lastGradingCheckAt = raw.lastGradingCheckAt || null;
  base.lastLifecycleCompletionAt = raw.lastLifecycleCompletionAt || null;
  for (const id of Object.values(JOB_IDS)) {
    base.jobs[id] = { ...emptyJobState(id), ...(raw.jobs?.[id] || {}), jobId: id };
  }
  return base;
}

export function saveSchedulerState(state) {
  const next = {
    ...state,
    version: SCHEDULER_VERSION,
    updatedAt: new Date().toISOString(),
  };
  writeJsonSafe(stateFilePath, next);
  syncKeyToDurableFireAndForget(DURABLE_KEYS.SCHEDULER_STATE, next, {
    writeLocalFile: false,
  });
  return next;
}

export function loadBoardCache() {
  return readJsonSafe(boardCacheFilePath, null);
}

export function saveBoardCache(board) {
  if (!board || typeof board !== "object") return null;
  const payload = {
    ...board,
    cachedAt: new Date().toISOString(),
    cacheVersion: SCHEDULER_VERSION,
  };
  writeJsonSafe(boardCacheFilePath, payload);
  syncKeyToDurableFireAndForget(DURABLE_KEYS.BOARD_CACHE, payload, {
    writeLocalFile: false,
  });
  return payload;
}

export function getCourtEdgeLocalParts(now = new Date(), timeZone = SCHEDULER_CONFIG.timezone) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value])
  );
  const slateDate = `${parts.year}-${parts.month}-${parts.day}`;
  return {
    timeZone,
    slateDate,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: parts.weekday,
    localIso: `${slateDate}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}:${String(parts.second).padStart(2, "0")}`,
    minutesOfDay: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

export function addLocalDays(slateDate, days) {
  const [y, m, d] = String(slateDate).split("-").map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d + Number(days || 0), 12, 0, 0));
  return utc.toISOString().slice(0, 10);
}

function windowContains(minutesOfDay, windowCfg) {
  const start = windowCfg.hour * 60 + windowCfg.minute;
  const end = start + windowCfg.windowMinutes;
  return minutesOfDay >= start && minutesOfDay < end;
}

function fallbackWindowContains(minutesOfDay, windowCfg) {
  const start =
    Number(windowCfg.fallbackHour ?? windowCfg.hour) * 60 +
    Number(windowCfg.fallbackMinute ?? windowCfg.minute ?? 0);
  const end =
    start + Number(windowCfg.fallbackWindowMinutes ?? windowCfg.windowMinutes ?? 120);
  return minutesOfDay >= start && minutesOfDay < end;
}

/** Parse a scheduled tip Instant from a game or nested pick fields. */
export function parseGameStartMs(game = {}) {
  const candidates = [
    game.commenceTime,
    game.time,
    game.commence_time,
    game.startTime,
    game.scheduledTip,
  ];
  if (Array.isArray(game.picks)) {
    for (const pick of game.picks) {
      candidates.push(pick?.commenceTime, pick?.time, pick?.commence_time);
    }
  }
  for (const raw of candidates) {
    if (raw == null || raw === "") continue;
    const ms = Date.parse(raw);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

export function isTodaySlateGame(game, slateDate) {
  if (!game || typeof game !== "object") return false;
  const bucket = String(game.dayBucket || game.dateLabel || "").toUpperCase();
  if (bucket === "TODAY" || bucket === "TODAY'S" || bucket === "TODAYS") {
    return true;
  }
  const date = String(game.date || game.gameDate || game.slateDate || "").slice(
    0,
    10
  );
  return Boolean(slateDate) && date === slateDate;
}

export function collectTodaySlateGames(games, slateDate) {
  if (!Array.isArray(games)) return [];
  return games.filter((g) => isTodaySlateGame(g, slateDate));
}

/**
 * Resolve pregame tip timing from the active Today slate.
 * - earliestUnstartedTipMs: soonest scheduled tip still in the future
 * - hasValidStartTimes: at least one parseable tip on the slate
 * - allKnownTipsStarted: every parseable tip is already in the past
 */
export function resolvePregameTipTiming(games = [], now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const tips = [];
  for (const game of games) {
    const tipMs = parseGameStartMs(game);
    if (tipMs != null) tips.push(tipMs);
  }
  tips.sort((a, b) => a - b);
  const hasValidStartTimes = tips.length > 0;
  const unstarted = tips.filter((ms) => ms > nowMs);
  const earliestUnstartedTipMs = unstarted.length ? unstarted[0] : null;
  const earliestTipMs = tips.length ? tips[0] : null;
  const allKnownTipsStarted = hasValidStartTimes && unstarted.length === 0;
  return {
    hasValidStartTimes,
    allKnownTipsStarted,
    earliestTipMs,
    earliestUnstartedTipMs,
    tipCount: tips.length,
    unstartedCount: unstarted.length,
  };
}

/**
 * Decide whether TODAY_PREGAME_REFRESH is due.
 * Game-time path: once when earliest unstarted tip is ~90–120 minutes away.
 * Fallback path: fixed 17:00 CT window ONLY when no valid tip times exist.
 * Never falls back to 17:00 merely because games already started.
 */
export function evaluatePregameRefreshDue({
  now = new Date(),
  local = null,
  slateDate = null,
  games = [],
  job = null,
  force = false,
  windowCfg = SCHEDULER_CONFIG.windows.TODAY_PREGAME_REFRESH,
} = {}) {
  const parts = local || getCourtEdgeLocalParts(now);
  const targetSlate = slateDate || parts.slateDate;
  const todayGames = collectTodaySlateGames(games, targetSlate);
  const timing = resolvePregameTipTiming(todayGames, now);

  if (force) {
    return {
      due: true,
      reason: "forced",
      slateDate: targetSlate,
      timing,
      trigger: "force",
    };
  }

  if (job && alreadySucceededToday(job, targetSlate, parts)) {
    return {
      due: false,
      reason: "already_succeeded_today",
      slateDate: targetSlate,
      timing,
      trigger: null,
    };
  }

  if (timing.earliestUnstartedTipMs != null) {
    const minutesUntil =
      (timing.earliestUnstartedTipMs - now.getTime()) / (60 * 1000);
    const minBefore = Number(windowCfg.minMinutesBeforeTip ?? 90);
    const maxBefore = Number(windowCfg.maxMinutesBeforeTip ?? 120);
    if (minutesUntil >= minBefore && minutesUntil <= maxBefore) {
      return {
        due: true,
        reason: "within_pregame_tip_window",
        slateDate: targetSlate,
        timing,
        minutesUntilTip: minutesUntil,
        trigger: "earliest_unstarted_tip",
        nextEligibleLocal: null,
      };
    }
    const tipLocal = getCourtEdgeLocalParts(
      new Date(timing.earliestUnstartedTipMs)
    );
    return {
      due: false,
      reason:
        minutesUntil > maxBefore
          ? "too_early_for_pregame_tip_window"
          : "too_late_for_pregame_tip_window",
      slateDate: targetSlate,
      timing,
      minutesUntilTip: minutesUntil,
      trigger: null,
      nextEligibleLocal: `${String(tipLocal.hour).padStart(2, "0")}:${String(
        tipLocal.minute
      ).padStart(2, "0")} CT tip (−${maxBefore}..−${minBefore}m)`,
    };
  }

  // Valid tip times exist but every known tip already started — do NOT use 5 PM fallback.
  if (timing.hasValidStartTimes && timing.allKnownTipsStarted) {
    return {
      due: false,
      reason: "all_known_tips_started",
      slateDate: targetSlate,
      timing,
      trigger: null,
      nextEligibleLocal: null,
    };
  }

  // No parseable scheduled tip times → documented 17:00 CT fallback only.
  const inFallback = fallbackWindowContains(parts.minutesOfDay, windowCfg);
  if (inFallback) {
    return {
      due: true,
      reason: "fallback_1700_ct_no_valid_tip_times",
      slateDate: targetSlate,
      timing,
      trigger: "fallback_1700_ct",
    };
  }

  const fbHour = Number(windowCfg.fallbackHour ?? 17);
  const fbMinute = Number(windowCfg.fallbackMinute ?? 0);
  return {
    due: false,
    reason: "outside_fallback_window_no_valid_tip_times",
    slateDate: targetSlate,
    timing,
    trigger: null,
    nextEligibleLocal: `${String(fbHour).padStart(2, "0")}:${String(
      fbMinute
    ).padStart(2, "0")} CT fallback`,
  };
}

function resolveTodayGamesForEvaluation(slateDate, options = {}) {
  if (typeof options.getTodaySlateGames === "function") {
    return collectTodaySlateGames(
      options.getTodaySlateGames(slateDate) || [],
      slateDate
    );
  }
  const board =
    typeof options.getBoard === "function"
      ? options.getBoard()
      : loadBoardCache();
  return collectTodaySlateGames(board?.games || [], slateDate);
}

export function classifyProviderError(error, extras = {}) {
  const status = Number(
    extras.status ??
      error?.status ??
      error?.response?.status ??
      error?.statusCode ??
      0
  );
  const code = String(error?.code || extras.code || "").toUpperCase();
  const message = String(error?.message || extras.message || error || "");
  const lower = message.toLowerCase();

  if (status === 401 || /invalid key|unauthorized|api key/i.test(message)) {
    return {
      type: PROVIDER_ERROR_TYPES.AUTH_401,
      retryable: false,
      status: status || 401,
      message,
    };
  }
  if (status === 403 || /forbidden|subscription|not entitled/i.test(message)) {
    return {
      type: PROVIDER_ERROR_TYPES.FORBIDDEN_403,
      retryable: false,
      status: status || 403,
      message,
    };
  }
  if (status === 429 || /rate limit|too many requests/i.test(message)) {
    const retryAfter = Number(
      extras.retryAfter ?? error?.response?.headers?.["retry-after"] ?? 0
    );
    return {
      type: PROVIDER_ERROR_TYPES.RATE_LIMIT_429,
      retryable: true,
      status: 429,
      retryAfterMs: retryAfter > 0 ? retryAfter * 1000 : SCHEDULER_CONFIG.retryBackoffMs[0],
      message,
    };
  }
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    /timeout|timed out|aborted/i.test(message)
  ) {
    const cold =
      /cold.?start|render.*wake|service unavailable/i.test(lower) ||
      extras.coldStart === true;
    return {
      type: cold ? PROVIDER_ERROR_TYPES.COLD_START : PROVIDER_ERROR_TYPES.TIMEOUT,
      retryable: true,
      status: status || null,
      message,
    };
  }
  if (
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "ECONNRESET" ||
    code === "EAI_AGAIN" ||
    /dns|getaddrinfo|connection reset|connect econn/i.test(lower)
  ) {
    return {
      type: PROVIDER_ERROR_TYPES.DNS_CONNECT,
      retryable: true,
      status: status || null,
      message,
    };
  }
  if (status >= 500 && status < 600) {
    return {
      type: PROVIDER_ERROR_TYPES.INTERNAL,
      retryable: true,
      status,
      message,
    };
  }
  if (extras.emptyMarket || /empty market|no markets/i.test(lower)) {
    return {
      type: PROVIDER_ERROR_TYPES.EMPTY_MARKET,
      retryable: false,
      status: status || null,
      message,
    };
  }
  if (extras.incompleteSlate || /incomplete slate/i.test(lower)) {
    return {
      type: PROVIDER_ERROR_TYPES.INCOMPLETE_SLATE,
      retryable: false,
      status: status || null,
      message,
    };
  }
  return {
    type: PROVIDER_ERROR_TYPES.UNKNOWN,
    retryable: Boolean(extras.retryable),
    status: status || null,
    message,
  };
}

function countDayBucketPlayableCandidates(board, dayBucket) {
  const bucket = String(dayBucket || "").toUpperCase();
  let n = 0;
  for (const g of board?.games || []) {
    if (String(g.dayBucket || "").toUpperCase() !== bucket) continue;
    n += (g.allGeneratedCandidates || g.picks || []).length;
  }
  return n;
}

function countAllPlayableCandidates(board) {
  let n = 0;
  for (const g of board?.games || []) {
    n += (g.allGeneratedCandidates || g.picks || []).length;
  }
  return n;
}

function countBestSixDisplayTotal(board) {
  const today =
    (board?.bestSixDisplayTodayWNBA || []).length +
    (board?.bestSixDisplayTodayNBA || []).length;
  const tomorrow =
    (board?.bestSixDisplayTomorrowWNBA || []).length +
    (board?.bestSixDisplayTomorrowNBA || []).length;
  if (today + tomorrow > 0) return today + tomorrow;
  return (
    (board?.bestSixDisplayWNBA || board?.bestSixWNBA || []).length +
    (board?.bestSixDisplayNBA || board?.bestSixNBA || []).length
  );
}

/**
 * True when the board still has at least one game/prop whose CT slate date
 * is calendar TODAY or TOMORROW. Stale LKG packets (all PAST) must not block
 * fresh generation via empty-board preserve.
 */
export function boardHasCalendarLiveHomeGames(board, today = getTodayLocalDate()) {
  const t = String(today || getTodayLocalDate()).slice(0, 10);
  for (const g of board?.games || []) {
    const bucket = classifyHomeDayBucket(resolveHomeBoardSlateDate(g), t);
    if (bucket === "TODAY" || bucket === "TOMORROW") return true;
  }
  const displayLists = [
    board?.bestSixDisplayTodayWNBA,
    board?.bestSixDisplayTodayNBA,
    board?.bestSixDisplayTomorrowWNBA,
    board?.bestSixDisplayTomorrowNBA,
    board?.bestSixDisplayWNBA,
    board?.bestSixDisplayNBA,
    board?.bestSixWNBA,
    board?.bestSixNBA,
  ];
  for (const list of displayLists) {
    for (const prop of list || []) {
      const bucket = classifyHomeDayBucket(resolveHomeBoardSlateDate(prop), t);
      if (bucket === "TODAY" || bucket === "TOMORROW") return true;
    }
  }
  return false;
}

/**
 * LKG is past-only when every classifiable game/prop is PAST vs CT today.
 * Unclassifiable dates (missing commence/slateDate) do not count as stale —
 * preserve behavior stays unchanged for undated shells.
 */
export function isPastOnlyLkgBoard(board, today = getTodayLocalDate()) {
  const t = String(today || getTodayLocalDate()).slice(0, 10);
  let classified = 0;
  let live = 0;
  let past = 0;

  const consider = (entity) => {
    const bucket = classifyHomeDayBucket(resolveHomeBoardSlateDate(entity), t);
    if (!bucket) return;
    classified += 1;
    if (bucket === "TODAY" || bucket === "TOMORROW") live += 1;
    else if (bucket === "PAST") past += 1;
  };

  for (const g of board?.games || []) consider(g);
  for (const list of [
    board?.bestSixDisplayTodayWNBA,
    board?.bestSixDisplayTodayNBA,
    board?.bestSixDisplayTomorrowWNBA,
    board?.bestSixDisplayTomorrowNBA,
    board?.bestSixDisplayWNBA,
    board?.bestSixDisplayNBA,
    board?.bestSixWNBA,
    board?.bestSixNBA,
  ]) {
    for (const prop of list || []) consider(prop);
  }

  if (classified === 0) return false;
  return live === 0 && past > 0;
}

export function shouldPreserveExistingBoard(previousBoard, nextBoard, failure, options = {}) {
  const today = options.today || getTodayLocalDate();
  const prevGames = Array.isArray(previousBoard?.games)
    ? previousBoard.games.length
    : 0;
  if (prevGames <= 0) return false;
  // Stale LKG (all games PAST vs CT today) must never block a fresh slate.
  if (isPastOnlyLkgBoard(previousBoard, today)) return false;
  if (failure) return true;
  const nextGames = Array.isArray(nextBoard?.games) ? nextBoard.games.length : 0;
  if (nextGames === 0) return true;
  if (nextBoard?.ok === false) return true;
  // Progressive Today-only persist must not wipe last-known-good Tomorrow.
  // Incomplete boards are otherwise allowed only when they keep prior day pools
  // or are explicit emergency seeds.
  if (
    nextBoard?.incomplete === true &&
    nextBoard?.progressivePersist === true &&
    nextBoard?.emptyBoardGuardBypass !== true
  ) {
    const prevTom = countDayBucketPlayableCandidates(previousBoard, "TOMORROW");
    const nextTom = countDayBucketPlayableCandidates(nextBoard, "TOMORROW");
    if (prevTom > 0 && nextTom === 0) return true;
  } else if (nextBoard?.incomplete === true) {
    return true;
  }
  const prevDate = String(previousBoard?.slateDate || "").slice(0, 10);
  const nextDate = String(nextBoard?.slateDate || "").slice(0, 10);
  if (prevDate && nextDate && nextDate < prevDate) return true;

  // Never atomically swap a playable LKG board for a zombie (shells, 0 AGC /
  // 0 Best6 display) when the provider response was partial/failed.
  const prevCands = countAllPlayableCandidates(previousBoard);
  const nextCands = countAllPlayableCandidates(nextBoard);
  const prevBestSix = countBestSixDisplayTotal(previousBoard);
  const nextBestSix = countBestSixDisplayTotal(nextBoard);
  if (
    prevCands >= 6 &&
    nextCands === 0 &&
    nextBoard?.allowEmptyCandidateOverwrite !== true &&
    nextBoard?.emptyBoardGuardBypass !== true
  ) {
    return true;
  }
  if (
    prevBestSix >= 6 &&
    nextBestSix === 0 &&
    nextBoard?.allowEmptyBestSixOverwrite !== true &&
    nextBoard?.emptyBoardGuardBypass !== true
  ) {
    return true;
  }

  // Block total Today wipe (0 AGC across Today shells) when prior had a pool.
  const prevToday = countDayBucketPlayableCandidates(previousBoard, "TODAY");
  const nextToday = countDayBucketPlayableCandidates(nextBoard, "TODAY");
  const nextTodayShells = (nextBoard?.games || []).filter(
    (g) => String(g.dayBucket || "").toUpperCase() === "TODAY"
  ).length;
  if (
    prevToday >= 6 &&
    nextToday === 0 &&
    nextTodayShells > 0 &&
    nextBoard?.allowThinTodayOverwrite !== true &&
    !nextBoard?.lastKnownGoodTodayMerged
  ) {
    return true;
  }

  // Only block a total Tomorrow wipe (0 AGC across Tomorrow shells) when the
  // prior board had a real Tomorrow pool. Per-event starvation is handled by
  // mergeLastKnownGoodDayGames; honest thin boards (<6) must still publish.
  const prevTom = countDayBucketPlayableCandidates(previousBoard, "TOMORROW");
  const nextTom = countDayBucketPlayableCandidates(nextBoard, "TOMORROW");
  const nextTomShells = (nextBoard?.games || []).filter(
    (g) => String(g.dayBucket || "").toUpperCase() === "TOMORROW"
  ).length;
  if (
    prevTom >= 6 &&
    nextTom === 0 &&
    nextTomShells > 0 &&
    nextBoard?.allowThinTomorrowOverwrite !== true &&
    !nextBoard?.lastKnownGoodTomorrowMerged
  ) {
    return true;
  }
  return false;
}

function isStaleLock(job, nowMs, staleLockMs = SCHEDULER_CONFIG.staleLockMs) {
  if (job.status !== JOB_STATUS.RUNNING) return false;
  if (!job.lockAcquiredAt) return true;
  const acquired = Date.parse(job.lockAcquiredAt);
  if (!Number.isFinite(acquired)) return true;
  return nowMs - acquired > staleLockMs;
}

function tryAcquireJobLock(state, jobId, runId, nowIso, nowMs) {
  const job = state.jobs[jobId];
  const memKey = `${jobId}:${job.slateDate || "none"}`;

  if (processLocks.has(memKey)) {
    return { ok: false, reason: "process_lock_held" };
  }

  if (job.status === JOB_STATUS.RUNNING && !isStaleLock(job, nowMs)) {
    return { ok: false, reason: "persisted_lock_held" };
  }

  if (job.status === JOB_STATUS.RUNNING && isStaleLock(job, nowMs)) {
    job.skipReason = "stale_lock_recovered";
  }

  processLocks.set(memKey, runId);
  job.status = JOB_STATUS.RUNNING;
  job.runId = runId;
  job.lockAcquiredAt = nowIso;
  job.lockOwner = runId;
  job.lastAttemptAt = nowIso;
  job.errorType = null;
  job.errorMessage = null;
  job.skipReason = job.skipReason === "stale_lock_recovered" ? "stale_lock_recovered" : null;
  return { ok: true, memKey };
}

function releaseJobLock(state, jobId, memKey, status, fields = {}) {
  if (memKey) processLocks.delete(memKey);
  const job = state.jobs[jobId];
  Object.assign(job, fields, {
    status,
    lockAcquiredAt: null,
    lockOwner: null,
  });
}

function alreadySucceededToday(job, slateDate, local) {
  if (!job.lastSuccessfulRunAt) return false;
  if (job.lastCompletedSlateDate !== slateDate) return false;
  const successLocal = getCourtEdgeLocalParts(new Date(job.lastSuccessfulRunAt));
  return successLocal.slateDate === local.slateDate;
}

function gradeIntervalElapsed(job, everyMinutes, nowMs) {
  if (!job.lastSuccessfulRunAt) return true;
  const last = Date.parse(job.lastSuccessfulRunAt);
  if (!Number.isFinite(last)) return true;
  return nowMs - last >= everyMinutes * 60 * 1000;
}

export function evaluateDueJobs(now = new Date(), state = loadSchedulerState(), options = {}) {
  const local = getCourtEdgeLocalParts(now);
  const force = Boolean(options.force);
  const due = [];
  const skipped = [];

  for (const [jobId, windowCfg] of Object.entries(SCHEDULER_CONFIG.windows)) {
    const slateDate = addLocalDays(local.slateDate, windowCfg.dayOffset);
    const job = state.jobs[jobId];

    if (jobId === JOB_IDS.TODAY_PREGAME_REFRESH || windowCfg.mode === "game_time_aware") {
      const todayGames = resolveTodayGamesForEvaluation(slateDate, options);
      const pregame = evaluatePregameRefreshDue({
        now,
        local,
        slateDate,
        games: todayGames,
        job,
        force,
        windowCfg,
      });
      if (!pregame.due) {
        skipped.push({
          jobId,
          slateDate,
          reason: pregame.reason,
          nextEligibleLocal: pregame.nextEligibleLocal || undefined,
          trigger: pregame.trigger,
          minutesUntilTip: pregame.minutesUntilTip,
        });
        continue;
      }
      if (
        !force &&
        options.boardIsCurrentFor?.(jobId, slateDate, state)
      ) {
        skipped.push({
          jobId,
          slateDate,
          reason: "board_already_current",
        });
        continue;
      }
      due.push({
        jobId,
        slateDate,
        kind: "refresh",
        window: windowCfg,
        trigger: pregame.trigger,
        minutesUntilTip: pregame.minutesUntilTip,
      });
      continue;
    }

    const inWindow = windowContains(local.minutesOfDay, windowCfg);
    if (!force && !inWindow) {
      skipped.push({
        jobId,
        slateDate,
        reason: "outside_window",
        nextEligibleLocal: `${String(windowCfg.hour).padStart(2, "0")}:${String(windowCfg.minute).padStart(2, "0")} CT`,
      });
      continue;
    }
    if (!force && alreadySucceededToday(job, slateDate, local)) {
      skipped.push({
        jobId,
        slateDate,
        reason: "already_succeeded_today",
      });
      continue;
    }
    if (
      !force &&
      options.boardIsCurrentFor?.(jobId, slateDate, state)
    ) {
      skipped.push({
        jobId,
        slateDate,
        reason: "board_already_current",
      });
      continue;
    }
    due.push({ jobId, slateDate, kind: "refresh", window: windowCfg });
  }

  const gradeJob = state.jobs[JOB_IDS.RESULTS_GRADE_CHECK];
  const gradeSlate = local.slateDate;
  if (
    force ||
    gradeIntervalElapsed(
      gradeJob,
      SCHEDULER_CONFIG.gradeCheckEveryMinutes,
      now.getTime()
    )
  ) {
    due.push({
      jobId: JOB_IDS.RESULTS_GRADE_CHECK,
      slateDate: gradeSlate,
      kind: "grade",
    });
  } else {
    skipped.push({
      jobId: JOB_IDS.RESULTS_GRADE_CHECK,
      slateDate: gradeSlate,
      reason: "interval_not_elapsed",
    });
  }

  const lifeJob = state.jobs[JOB_IDS.SLATE_LIFECYCLE_CHECK];
  if (
    force ||
    gradeIntervalElapsed(
      lifeJob,
      SCHEDULER_CONFIG.lifecycleCheckEveryMinutes,
      now.getTime()
    )
  ) {
    due.push({
      jobId: JOB_IDS.SLATE_LIFECYCLE_CHECK,
      slateDate: local.slateDate,
      kind: "lifecycle",
    });
  } else {
    skipped.push({
      jobId: JOB_IDS.SLATE_LIFECYCLE_CHECK,
      slateDate: local.slateDate,
      reason: "interval_not_elapsed",
    });
  }

  return { local, due, skipped };
}

async function withBoundedRetry(fn, { classifyExtras } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt <= SCHEDULER_CONFIG.maxProviderRetries; attempt += 1) {
    try {
      return { ok: true, result: await fn(attempt), attempts: attempt + 1 };
    } catch (error) {
      lastError = error;
      const classified = classifyProviderError(error, classifyExtras);
      if (!classified.retryable || attempt >= SCHEDULER_CONFIG.maxProviderRetries) {
        return {
          ok: false,
          error,
          classified,
          attempts: attempt + 1,
        };
      }
      const wait =
        classified.retryAfterMs ||
        SCHEDULER_CONFIG.retryBackoffMs[
          Math.min(attempt, SCHEDULER_CONFIG.retryBackoffMs.length - 1)
        ];
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  return {
    ok: false,
    error: lastError,
    classified: classifyProviderError(lastError, classifyExtras),
    attempts: SCHEDULER_CONFIG.maxProviderRetries + 1,
  };
}

/**
 * @param {object} options
 * @param {Date} [options.now]
 * @param {boolean} [options.force]
 * @param {string} [options.source]
 * @param {string} [options.serverBuild]
 * @param {object} options.handlers
 *   refreshBoard(dayOffset) -> board result
 *   gradeTracked() -> { props, summary }
 *   runLifecycle(props) -> lifecycle result
 *   getPreviousBoard?.() -> board
 *   isBoardCurrent?.(jobId, slateDate) -> boolean
 */
export async function runScheduledJobs(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const force = Boolean(options.force);
  const source = String(options.source || "unknown");
  const serverBuild = options.serverBuild || null;
  const handlers = options.handlers || {};

  const state = loadSchedulerState();
  state.lastDispatcherAt = now.toISOString();

  if (!SCHEDULER_CONFIG.enabled && !force) {
    saveSchedulerState(state);
    const local = getCourtEdgeLocalParts(now);
    return {
      ok: true,
      schedulerEnabled: false,
      serverBuild,
      courtEdgeLocalTime: local.localIso,
      slateDate: local.slateDate,
      source,
      jobsChecked: [],
      jobsRun: [],
      jobsSkipped: [{ jobId: "*", reason: "scheduler_disabled" }],
      errors: [],
    };
  }

  const evaluation = evaluateDueJobs(now, state, {
    force,
    boardIsCurrentFor: (jobId, slateDate) =>
      Boolean(handlers.isBoardCurrent?.(jobId, slateDate, state)),
    getBoard: () =>
      typeof handlers.getPreviousBoard === "function"
        ? handlers.getPreviousBoard()
        : loadBoardCache(),
    getTodaySlateGames: (slateDate) => {
      if (typeof handlers.getTodaySlateGames === "function") {
        return handlers.getTodaySlateGames(slateDate);
      }
      const board =
        typeof handlers.getPreviousBoard === "function"
          ? handlers.getPreviousBoard()
          : loadBoardCache();
      return board?.games || [];
    },
  });

  const jobsChecked = [
    ...evaluation.due.map((d) => d.jobId),
    ...evaluation.skipped.map((s) => s.jobId),
  ];
  const jobsRun = [];
  const jobsSkipped = [...evaluation.skipped];
  const errors = [];

  for (const item of evaluation.due) {
    const runId = `${item.jobId}-${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`;
    const job = state.jobs[item.jobId];
    job.slateDate = item.slateDate;
    job.serverBuild = serverBuild;

    const lock = tryAcquireJobLock(
      state,
      item.jobId,
      runId,
      now.toISOString(),
      now.getTime()
    );
    saveSchedulerState(state);

    if (!lock.ok) {
      jobsSkipped.push({
        jobId: item.jobId,
        slateDate: item.slateDate,
        reason: lock.reason,
      });
      continue;
    }

    try {
      if (item.kind === "refresh") {
        if (typeof handlers.refreshBoard !== "function") {
          throw new Error("refreshBoard handler missing");
        }
        const previousBoard =
          typeof handlers.getPreviousBoard === "function"
            ? handlers.getPreviousBoard()
            : loadBoardCache();

        const retry = await withBoundedRetry(() =>
          handlers.refreshBoard(item.window?.dayOffset ?? 0, {
            jobId: item.jobId,
            slateDate: item.slateDate,
            source,
          })
        );

        if (!retry.ok) {
          const classified = retry.classified;
          releaseJobLock(state, item.jobId, lock.memKey, JOB_STATUS.FAILED, {
            errorType: classified.type,
            errorMessage: String(classified.message || "").slice(0, 500),
            providerStatus: classified.status,
          });
          errors.push({
            jobId: item.jobId,
            errorType: classified.type,
            message: classified.message,
          });
          jobsRun.push({
            jobId: item.jobId,
            status: JOB_STATUS.FAILED,
            slateDate: item.slateDate,
            attempts: retry.attempts,
          });
          saveSchedulerState(state);
          continue;
        }

        const board = retry.result;
        const incomplete =
          board?.incomplete === true ||
          board?.ok === false ||
          (Array.isArray(board?.games) &&
            board.games.length === 0 &&
            Boolean(previousBoard?.games?.length));

        if (
          shouldPreserveExistingBoard(previousBoard, board, incomplete) ||
          incomplete
        ) {
          releaseJobLock(state, item.jobId, lock.memKey, JOB_STATUS.PARTIAL, {
            errorType: PROVIDER_ERROR_TYPES.INCOMPLETE_SLATE,
            errorMessage: "Preserved last valid board; refresh incomplete/empty",
            providerStatus: "preserved",
            skipReason: "preserved_last_valid_board",
          });
          jobsRun.push({
            jobId: item.jobId,
            status: JOB_STATUS.PARTIAL,
            slateDate: item.slateDate,
            preserved: true,
          });
          saveSchedulerState(state);
          continue;
        }

        if (typeof handlers.persistBoard === "function") {
          handlers.persistBoard(board, item);
        } else {
          saveBoardCache(board);
        }

        if (item.jobId === JOB_IDS.TOMORROW_NIGHT_REFRESH) {
          state.lastValidTomorrowSlateAt = now.toISOString();
        } else {
          state.lastValidTodaySlateAt = now.toISOString();
        }

        releaseJobLock(state, item.jobId, lock.memKey, JOB_STATUS.SUCCEEDED, {
          lastSuccessfulRunAt: now.toISOString(),
          lastCompletedSlateDate: item.slateDate,
          providerStatus: "ok",
          errorType: null,
          errorMessage: null,
          skipReason: null,
        });
        jobsRun.push({
          jobId: item.jobId,
          status: JOB_STATUS.SUCCEEDED,
          slateDate: item.slateDate,
          attempts: retry.attempts,
        });
      } else if (item.kind === "grade") {
        if (typeof handlers.gradeTracked !== "function") {
          throw new Error("gradeTracked handler missing");
        }
        const gradeResult = await handlers.gradeTracked({
          jobId: item.jobId,
          slateDate: item.slateDate,
          source,
        });
        state.lastGradingCheckAt = now.toISOString();
        releaseJobLock(state, item.jobId, lock.memKey, JOB_STATUS.SUCCEEDED, {
          lastSuccessfulRunAt: now.toISOString(),
          lastCompletedSlateDate: item.slateDate,
          providerStatus: gradeResult?.providerStatus || "ok",
          errorType: null,
          errorMessage: null,
        });
        jobsRun.push({
          jobId: item.jobId,
          status: JOB_STATUS.SUCCEEDED,
          slateDate: item.slateDate,
          summary: gradeResult?.summary || null,
        });
      } else if (item.kind === "lifecycle") {
        if (typeof handlers.runLifecycle !== "function") {
          throw new Error("runLifecycle handler missing");
        }
        const lifeResult = await handlers.runLifecycle({
          jobId: item.jobId,
          slateDate: item.slateDate,
          source,
        });
        state.lastLifecycleCompletionAt = now.toISOString();
        releaseJobLock(state, item.jobId, lock.memKey, JOB_STATUS.SUCCEEDED, {
          lastSuccessfulRunAt: now.toISOString(),
          lastCompletedSlateDate: item.slateDate,
          providerStatus: "ok",
          errorType: null,
          errorMessage: null,
        });
        jobsRun.push({
          jobId: item.jobId,
          status: JOB_STATUS.SUCCEEDED,
          slateDate: item.slateDate,
          summary: lifeResult?.summary || null,
        });
      }
    } catch (error) {
      const classified = classifyProviderError(error);
      releaseJobLock(state, item.jobId, lock.memKey, JOB_STATUS.FAILED, {
        errorType: classified.type,
        errorMessage: String(classified.message || error.message || error).slice(
          0,
          500
        ),
        providerStatus: classified.status,
      });
      errors.push({
        jobId: item.jobId,
        errorType: classified.type,
        message: classified.message || String(error.message || error),
      });
      jobsRun.push({
        jobId: item.jobId,
        status: JOB_STATUS.FAILED,
        slateDate: item.slateDate,
      });
    }

    saveSchedulerState(state);
  }

  saveSchedulerState(state);

  let watchdog = null;
  if (typeof handlers.runWatchdog === "function") {
    try {
      watchdog = await handlers.runWatchdog({
        source,
        schedulerState: state,
        board:
          typeof handlers.getPreviousBoard === "function"
            ? handlers.getPreviousBoard()
            : loadBoardCache(),
      });
    } catch (error) {
      watchdog = {
        ok: false,
        error: String(error?.message || error),
      };
    }
  }

  const durable = getDurableStoreHealthSync();

  return {
    ok: errors.length === 0,
    schedulerEnabled: true,
    serverBuild,
    autonomousOpsBuild: AUTONOMOUS_OPS_BUILD,
    courtEdgeLocalTime: evaluation.local.localIso,
    slateDate: evaluation.local.slateDate,
    timezone: evaluation.local.timeZone,
    source,
    lastHeartbeatAt: state.lastDispatcherAt,
    jobsChecked: [...new Set(jobsChecked)],
    jobsRun,
    jobsSkipped,
    errors,
    watchdog,
    durableStore: durable,
  };
}

export function getSchedulerStatus(options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const state = loadSchedulerState();
  const local = getCourtEdgeLocalParts(now);
  const board = loadBoardCache();
  const jobs = {};

  for (const id of Object.values(JOB_IDS)) {
    const job = state.jobs[id];
    const windowCfg = SCHEDULER_CONFIG.windows[id];
    let nextEligible = null;
    if (id === JOB_IDS.TODAY_PREGAME_REFRESH || windowCfg?.mode === "game_time_aware") {
      const todayGames = resolveTodayGamesForEvaluation(local.slateDate, {
        getBoard: () => board,
      });
      const pregame = evaluatePregameRefreshDue({
        now,
        local,
        slateDate: local.slateDate,
        games: todayGames,
        job,
        windowCfg,
      });
      if (pregame.due) {
        nextEligible = "due_now";
      } else if (pregame.nextEligibleLocal) {
        nextEligible = pregame.nextEligibleLocal;
      } else if (pregame.reason === "all_known_tips_started") {
        nextEligible = "n/a (all known tips started)";
      } else if (pregame.reason === "already_succeeded_today") {
        nextEligible = "done_for_slate";
      } else {
        nextEligible =
          "90–120m before earliest unstarted tip (17:00 CT fallback if no tip times)";
      }
    } else if (windowCfg) {
      nextEligible = `${String(windowCfg.hour).padStart(2, "0")}:${String(
        windowCfg.minute
      ).padStart(2, "0")} CT (${windowCfg.label})`;
    } else if (id === JOB_IDS.RESULTS_GRADE_CHECK) {
      nextEligible = `every ${SCHEDULER_CONFIG.gradeCheckEveryMinutes}m`;
    } else if (id === JOB_IDS.SLATE_LIFECYCLE_CHECK) {
      nextEligible = `every ${SCHEDULER_CONFIG.lifecycleCheckEveryMinutes}m`;
    }

    jobs[id] = {
      jobId: id,
      status: job.status,
      slateDate: job.slateDate,
      lastSuccessfulRunAt: job.lastSuccessfulRunAt,
      lastAttemptAt: job.lastAttemptAt,
      lastCompletedSlateDate: job.lastCompletedSlateDate,
      nextEligible,
      lockHeld: job.status === JOB_STATUS.RUNNING && !isStaleLock(job, now.getTime()),
      lockStale:
        job.status === JOB_STATUS.RUNNING && isStaleLock(job, now.getTime()),
      lastErrorType: job.errorType,
      skipReason: job.skipReason,
    };
  }

  const durable = getDurableStoreHealthSync();
  const todayWNBA = board?.bestSixDisplayTodayWNBA || [];
  const tomorrowWNBA = board?.bestSixDisplayTomorrowWNBA || [];
  const lastJobSuccess = Object.values(state.jobs || {})
    .map((j) => j.lastSuccessfulRunAt)
    .filter(Boolean)
    .sort()
    .slice(-1)[0] || null;
  const lastJobFailure = Object.values(state.jobs || {})
    .filter((j) => j.status === JOB_STATUS.FAILED)
    .map((j) => ({
      jobId: j.jobId,
      at: j.lastAttemptAt,
      errorType: j.errorType,
      errorMessage: j.errorMessage,
    }))
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
    .slice(-1)[0] || null;

  let nextDueOperation = null;
  for (const id of Object.values(JOB_IDS)) {
    const j = jobs[id];
    if (j?.nextEligible === "due_now") {
      nextDueOperation = id;
      break;
    }
  }

  return {
    ok: true,
    schedulerVersion: SCHEDULER_VERSION,
    autonomousOpsBuild: AUTONOMOUS_OPS_BUILD,
    schedulerEnabled: SCHEDULER_CONFIG.enabled && state.enabled !== false,
    timezone: SCHEDULER_CONFIG.timezone,
    courtEdgeLocalTime: local.localIso,
    courtEdgeSlateDate: local.slateDate || getTodayLocalDate(now),
    lastHeartbeatAt: state.lastDispatcherAt,
    lastDispatcherAt: state.lastDispatcherAt,
    nextDueOperation,
    lastSuccessfulOperationAt: lastJobSuccess,
    lastFailedOperation: lastJobFailure,
    proposedWindows: SCHEDULER_CONFIG.windows,
    lastValidTodaySlateAt: state.lastValidTodaySlateAt,
    lastValidTomorrowSlateAt: state.lastValidTomorrowSlateAt,
    lastGradingCheckAt: state.lastGradingCheckAt,
    lastLifecycleCompletionAt: state.lastLifecycleCompletionAt,
    boardCachePresent: Boolean(board?.games?.length || board?.lastUpdated),
    boardCacheUpdatedAt: board?.cachedAt || board?.lastUpdated || null,
    todaySlate: {
      propCount: todayWNBA.length,
      sealedCount: todayWNBA.filter(
        (p) => p?.sealedAt || p?.immutableOfficial || p?.contentHash
      ).length,
      contentHashes: todayWNBA.map((p) => p?.contentHash || null),
    },
    tomorrowSlate: {
      propCount: tomorrowWNBA.length,
      sealedCount: tomorrowWNBA.filter(
        (p) => p?.sealedAt || p?.immutableOfficial || p?.contentHash
      ).length,
      contentHashes: tomorrowWNBA.map((p) => p?.contentHash || null),
    },
    durableStoreType: durable.type,
    durableStoreHealth: durable,
    lastDurableWriteAt: durable.lastDurableWriteAt,
    lastStartupRecovery: durable.lastStartupRecovery,
    jobs,
  };
}

export function verifySchedulerToken(provided) {
  const expected = String(process.env.COURTEDGE_SCHEDULER_TOKEN || "").trim();
  if (!expected) {
    return { ok: false, status: 503, message: "COURTEDGE_SCHEDULER_TOKEN is not configured" };
  }
  const token = String(provided || "").trim();
  if (!token || token !== expected) {
    return { ok: false, status: 401, message: "Unauthorized" };
  }
  return { ok: true };
}
