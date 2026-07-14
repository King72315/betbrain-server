/**
 * CourtEdge server automation scheduler v1.
 * One dispatcher: evaluate due jobs, run only those, persist state + locks.
 * Does not own projection/grading/lifecycle formulas — calls injected handlers.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { CONFIG } from "../config.js";
import { getTodayLocalDate } from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SCHEDULER_VERSION = "courtedge-scheduler-v1";

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
 * Proposed America/Chicago windows — no prior locked env times existed.
 * Morning same-day, evening pregame, night Tomorrow (preserved cadence intent).
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
      hour: 17,
      minute: 0,
      windowMinutes: 120,
      dayOffset: 0,
      label: "evening pregame refresh",
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

export function shouldPreserveExistingBoard(previousBoard, nextBoard, failure) {
  const prevGames = Array.isArray(previousBoard?.games)
    ? previousBoard.games.length
    : 0;
  if (prevGames <= 0) return false;
  if (failure) return true;
  const nextGames = Array.isArray(nextBoard?.games) ? nextBoard.games.length : 0;
  if (nextGames === 0) return true;
  if (nextBoard?.ok === false) return true;
  if (nextBoard?.incomplete === true) return true;
  const prevDate = String(previousBoard?.slateDate || "").slice(0, 10);
  const nextDate = String(nextBoard?.slateDate || "").slice(0, 10);
  if (prevDate && nextDate && nextDate < prevDate) return true;
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
          state.lastValidTomorrowSlateAt = new Date().toISOString();
        } else {
          state.lastValidTodaySlateAt = new Date().toISOString();
        }

        releaseJobLock(state, item.jobId, lock.memKey, JOB_STATUS.SUCCEEDED, {
          lastSuccessfulRunAt: new Date().toISOString(),
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
        state.lastGradingCheckAt = new Date().toISOString();
        releaseJobLock(state, item.jobId, lock.memKey, JOB_STATUS.SUCCEEDED, {
          lastSuccessfulRunAt: new Date().toISOString(),
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
        state.lastLifecycleCompletionAt = new Date().toISOString();
        releaseJobLock(state, item.jobId, lock.memKey, JOB_STATUS.SUCCEEDED, {
          lastSuccessfulRunAt: new Date().toISOString(),
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

  return {
    ok: errors.length === 0,
    schedulerEnabled: true,
    serverBuild,
    courtEdgeLocalTime: evaluation.local.localIso,
    slateDate: evaluation.local.slateDate,
    timezone: evaluation.local.timeZone,
    source,
    jobsChecked: [...new Set(jobsChecked)],
    jobsRun,
    jobsSkipped,
    errors,
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
    if (windowCfg) {
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

  return {
    ok: true,
    schedulerVersion: SCHEDULER_VERSION,
    schedulerEnabled: SCHEDULER_CONFIG.enabled && state.enabled !== false,
    timezone: SCHEDULER_CONFIG.timezone,
    courtEdgeLocalTime: local.localIso,
    courtEdgeSlateDate: local.slateDate || getTodayLocalDate(now),
    proposedWindows: SCHEDULER_CONFIG.windows,
    lastValidTodaySlateAt: state.lastValidTodaySlateAt,
    lastValidTomorrowSlateAt: state.lastValidTomorrowSlateAt,
    lastGradingCheckAt: state.lastGradingCheckAt,
    lastLifecycleCompletionAt: state.lastLifecycleCompletionAt,
    boardCachePresent: Boolean(board?.games?.length || board?.lastUpdated),
    boardCacheUpdatedAt: board?.cachedAt || board?.lastUpdated || null,
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
