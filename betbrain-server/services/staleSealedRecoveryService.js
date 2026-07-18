/**
 * CourtEdge stale sealed-slate recovery + lifecycle helpers.
 *
 * Finds sealed Official slates that remain unresolved after the Results
 * calendar advances, grades them without trusting frozen isStarted, then
 * builds daily reports and Lab promotion when complete.
 *
 * Never mutates sealed membership (players/sides/lines/ids/timestamps).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  getTrackedProps,
  writeTrackedProps,
  resolveTrackedProps,
  isResolvedStatus,
} from "./trackedPropService.js";
import {
  getLockedSlatesRegistry,
  getLockedSnapshot,
  isSlateLocked,
} from "./slateLockService.js";
import {
  isOfficialSlateSealed,
  getOfficialSlate,
} from "./officialSlateService.js";
import { attemptDailySlateReportBuild } from "./dailySlateReportService.js";
import {
  getTodayLocalDate,
  getResultsPropSlateDate,
  isOnOrAfterCleanDataCutoff,
  isPastSlateDate,
  hasUnresolvedGradingProps,
  isCompletedSlate,
} from "./slateScopeService.js";
import {
  getPickStartTime,
  isPickLikelyFinished,
  isPickGameStarted,
} from "./resultService.js";
import { createBackup } from "./backupService.js";

export const STALE_SEALED_RECOVERY_VERSION = "stale-sealed-recovery-v1";
export const STALE_SEALED_RECOVERY_BUILD = "courteedge-lifecycle-stale-sealed-v1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function slateDateOf(prop = {}) {
  return String(getResultsPropSlateDate(prop) || prop.slateDate || "").slice(0, 10);
}

export function isSealedUnresolvedProp(prop = {}) {
  if (!prop?.player) return false;
  if (isResolvedStatus(prop.status)) return false;
  const sealed =
    prop.immutableOfficial === true ||
    Boolean(prop.officialPropId) ||
    prop.slateLocked === true;
  return sealed;
}

/**
 * Discover sealed ACTIVE dates that still have unresolved Official props.
 * Includes dates older than "yesterday" (Jul 17 orphan class).
 */
export function listStaleSealedUnresolvedSlateDates(options = {}) {
  const today = options.todayLocalDate || getTodayLocalDate();
  const tracked = options.trackedProps || getTrackedProps();
  const lockedSlates =
    options.lockedSlates || getLockedSlatesRegistry().slates || [];
  const reports = options.reports || [];
  const onlyDate = options.slateDate ? String(options.slateDate).slice(0, 10) : null;

  const byDate = new Map();
  for (const prop of tracked) {
    const date = slateDateOf(prop);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!isOnOrAfterCleanDataCutoff(date)) continue;
    if (onlyDate && date !== onlyDate) continue;
    if (!isPastSlateDate(date, today) && date !== today) continue;
    if (!isSealedUnresolvedProp(prop) && !isResolvedStatus(prop.status)) {
      // still count sealed resolved for completeness checks below
    }
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(prop);
  }

  const lockedActive = new Set(
    (lockedSlates || [])
      .filter((e) => String(e.phase || "ACTIVE").toUpperCase() === "ACTIVE")
      .map((e) => String(e.slateDate || "").slice(0, 10))
      .filter(Boolean)
  );

  const dates = [...byDate.keys()].sort();
  const results = [];

  for (const date of dates) {
    if (onlyDate && date !== onlyDate) continue;
    const props = byDate.get(date) || [];
    const sealedProps = props.filter(
      (p) =>
        p.immutableOfficial === true ||
        Boolean(p.officialPropId) ||
        p.slateLocked === true ||
        isOfficialSlateSealed(date) ||
        lockedActive.has(date)
    );
    if (!sealedProps.length && !isOfficialSlateSealed(date) && !lockedActive.has(date)) {
      continue;
    }

    const report = (reports || []).find((r) => String(r.slateDate) === date) || null;
    if (isCompletedSlate(report)) continue;

    const unresolved = sealedProps.filter((p) => !isResolvedStatus(p.status));
    if (!unresolved.length && sealedProps.length) continue;
    if (!unresolved.length && !hasUnresolvedGradingProps(props)) continue;

    const snapshot = getLockedSnapshot(date);
    const official = getOfficialSlate(date);
    results.push({
      slateDate: date,
      sealed: isOfficialSlateSealed(date) || Boolean(snapshot?.immutableOfficial),
      locked: isSlateLocked(date) || lockedActive.has(date),
      propCount: sealedProps.length || official?.propCount || unresolved.length,
      pendingCount: unresolved.length,
      gradedCount: sealedProps.filter((p) => isResolvedStatus(p.status)).length,
      officialPropIds: (
        official?.officialPropIds ||
        sealedProps.map((p) => p.officialPropId).filter(Boolean)
      ),
      players: unresolved.map((p) => p.player),
      dailyReportExists: Boolean(report),
      dailyReportCompleted: isCompletedSlate(report),
      sample: unresolved.slice(0, 6).map((p) => ({
        player: p.player,
        side: p.lockedSide || p.side || p.pick,
        line: p.officialLine ?? p.line,
        commenceTime: p.commenceTime || p.time || null,
        isStartedFrozen: p.isStarted,
        status: p.status || null,
        lastResolveAttempt: p.lastResolveAttempt || null,
        gameLikelyFinished: isPickLikelyFinished(p),
        gameStarted: isPickGameStarted(p),
        startMs: getPickStartTime(p),
      })),
    });
  }

  return results;
}

/**
 * Stamp lastResolveAttempt / explicit error without changing sealed identity.
 */
export function stampResolveAttempt(prop = {}, attempt = {}) {
  const at = attempt.at || new Date().toISOString();
  return {
    ...prop,
    lastResolveAttempt: at,
    lastResolveAttemptAt: at,
    lastResolveError: attempt.error || null,
    lastResolveProvider: attempt.provider || null,
    lastResolveNextAction: attempt.nextAction || null,
    resolveAttemptCount: num(prop.resolveAttemptCount) + 1,
    resolveDebug: {
      ...(prop.resolveDebug || {}),
      ...(attempt.resolveDebug || {}),
      lastAttemptAt: at,
      recoveryPass: true,
      ignoredFrozenIsStarted: true,
      error: attempt.error || null,
      provider: attempt.provider || null,
      nextAction: attempt.nextAction || null,
    },
  };
}

/**
 * Dry-run or apply recovery for one or more sealed unresolved dates.
 */
export async function recoverStaleSealedSlates(options = {}) {
  const dryRun = options.dryRun !== false && options.apply !== true;
  const apply = options.apply === true && options.dryRun !== true;
  const today = options.todayLocalDate || getTodayLocalDate();
  const slateDate = options.slateDate ? String(options.slateDate).slice(0, 10) : null;
  const now = options.now || new Date();

  const discovered = listStaleSealedUnresolvedSlateDates({
    todayLocalDate: today,
    slateDate,
    trackedProps: options.trackedProps,
    lockedSlates: options.lockedSlates,
    reports: options.reports,
  });

  const plan = {
    version: STALE_SEALED_RECOVERY_VERSION,
    build: STALE_SEALED_RECOVERY_BUILD,
    dryRun: !apply,
    apply,
    todayLocalDate: today,
    evaluatedAt: now.toISOString(),
    discoveredCount: discovered.length,
    slates: discovered,
    actions: [],
    membershipPreserved: true,
    warnings: [],
  };

  if (!discovered.length) {
    plan.actions.push({
      type: "NOOP",
      reason: slateDate
        ? `No sealed unresolved props for ${slateDate}`
        : "No stale sealed unresolved slates found",
    });
    return plan;
  }

  for (const slate of discovered) {
    const likelyReady = slate.sample.filter((s) => s.gameLikelyFinished).length;
    const startedReady = slate.sample.filter((s) => s.gameStarted).length;
    plan.actions.push({
      type: "GRADE_SEALED_UNRESOLVED",
      slateDate: slate.slateDate,
      pendingCount: slate.pendingCount,
      likelyFinishedCount: likelyReady,
      gameStartedCount: startedReady,
      note:
        "Will grade using commenceTime readiness; ignore frozen isStarted=false",
    });
    if (!slate.dailyReportExists || !slate.dailyReportCompleted) {
      plan.actions.push({
        type: "BUILD_DAILY_REPORT_IF_COMPLETE",
        slateDate: slate.slateDate,
        note: "After grading finishes (0 pending), build report + Lab promote",
      });
    }
  }

  if (!apply) {
    plan.actions.push({
      type: "DRY_RUN_STOP",
      reason: "No writes performed. Re-run with --apply to mutate local stores.",
    });
    return plan;
  }

  // APPLY — backup first
  try {
    const backup = createBackup(
      options.backupReason || `pre-stale-sealed-recovery-${slateDate || "all"}`
    );
    plan.backup = backup?.backupId || backup?.id || backup || null;
  } catch (err) {
    plan.warnings.push(`backup_failed: ${err?.message || err}`);
  }

  // Grade all pending sealed props (commenceTime based — existing resolveTrackedProps)
  const resolveResult = await resolveTrackedProps({
    requireLikelyFinished: options.requireLikelyFinished !== false,
    staleSealedRecovery: true,
    slateDateFilter: slateDate || null,
  });

  plan.resolve = {
    gradedCount: resolveResult?.gradedCount ?? null,
    stillPending: resolveResult?.stillPending ?? null,
    skippedNotReady: resolveResult?.skippedNotReady ?? null,
    ok: resolveResult?.ok !== false,
  };

  // Stamp attempts on still-null rows for targeted dates
  let tracked = getTrackedProps();
  let stamped = 0;
  tracked = tracked.map((prop) => {
    const date = slateDateOf(prop);
    if (slateDate && date !== slateDate) return prop;
    if (!discovered.some((d) => d.slateDate === date)) return prop;
    if (isResolvedStatus(prop.status)) return prop;
    if (prop.lastResolveAttempt) return prop;
    stamped += 1;
    return stampResolveAttempt(prop, {
      at: now.toISOString(),
      error: prop.resolveDebug?.error || prop.pendingReason || "resolve_pass_completed_still_pending",
      provider: prop.matchedSource || prop.resolveDebug?.provider || null,
      nextAction: "retry_when_stats_final",
      resolveDebug: prop.resolveDebug || {},
    });
  });
  if (stamped > 0) {
    writeTrackedProps(tracked, {
      sourcePath: "recoverStaleSealedSlates.stampAttempts",
      allowMerge: true,
    });
  }
  plan.stampedResolveAttempts = stamped;

  // Report / Lab when complete
  tracked = getTrackedProps();
  const reportResult = attemptDailySlateReportBuild(tracked, {
    todayLocalDate: today,
    forceSlateDate: slateDate || undefined,
    recoveryPass: true,
  });
  plan.reportBuild = {
    ok: reportResult?.ok !== false,
    built: reportResult?.built ?? reportResult?.reports?.length ?? null,
    promoted: reportResult?.promoted ?? null,
    message: reportResult?.message || null,
  };

  const after = listStaleSealedUnresolvedSlateDates({
    todayLocalDate: today,
    slateDate,
  });
  plan.after = after;
  plan.membershipPreserved = true;
  plan.actions.push({ type: "APPLY_COMPLETE", stamped, afterCount: after.length });

  return plan;
}

/**
 * Diagnostics block for sealed lifecycle health.
 */
export function buildStaleSealedLifecycleDiagnostics(options = {}) {
  const today = options.todayLocalDate || getTodayLocalDate();
  const tracked = options.trackedProps || getTrackedProps();
  const reports = options.reports || [];
  const stale = listStaleSealedUnresolvedSlateDates({
    todayLocalDate: today,
    trackedProps: tracked,
    lockedSlates: options.lockedSlates,
    reports,
  });

  const sealedPendingCountByDate = {};
  const lastResolveAttemptByDate = {};
  const dailyReportExists = {};
  const labPromotionStatus = {};
  const historyArchiveStatus = {};
  const lifecycleClassification = {};
  const lifecycleBlockedReason = {};

  for (const row of stale) {
    sealedPendingCountByDate[row.slateDate] = row.pendingCount;
    dailyReportExists[row.slateDate] = row.dailyReportExists;
    lifecycleClassification[row.slateDate] = "STALE_SEALED_UNRESOLVED";
    lifecycleBlockedReason[row.slateDate] =
      row.pendingCount > 0
        ? "SEALED_PENDING_GRADES"
        : "MISSING_OR_INCOMPLETE_DAILY_REPORT";

    const attempts = (tracked || [])
      .filter((p) => slateDateOf(p) === row.slateDate && p.lastResolveAttempt)
      .map((p) => p.lastResolveAttempt);
    lastResolveAttemptByDate[row.slateDate] = attempts.sort().slice(-1)[0] || null;

    labPromotionStatus[row.slateDate] = "BLOCKED_UNTIL_GRADED";
    historyArchiveStatus[row.slateDate] = "NOT_ARCHIVED";
  }

  const zeroAttemptSealed = stale.filter((row) => {
    const props = (tracked || []).filter(
      (p) => slateDateOf(p) === row.slateDate && isSealedUnresolvedProp(p)
    );
    return props.length > 0 && props.every((p) => !p.lastResolveAttempt);
  });

  return {
    version: STALE_SEALED_RECOVERY_VERSION,
    build: STALE_SEALED_RECOVERY_BUILD,
    todayLocalDate: today,
    staleUnresolvedSlateDates: stale.map((s) => s.slateDate),
    sealedPendingCountByDate,
    lastResolveAttemptByDate,
    dailyReportExists,
    labPromotionStatus,
    historyArchiveStatus,
    lifecycleClassification,
    lifecycleBlockedReason,
    zeroResolveAttemptSealedDates: zeroAttemptSealed.map((s) => s.slateDate),
    warning:
      zeroAttemptSealed.length > 0
        ? "SEALED_SLATE_ZERO_RESOLVE_ATTEMPTS"
        : stale.length > 0
          ? "SEALED_SLATE_STALE_UNRESOLVED"
          : null,
    gradingProviderStatus: {
      note: "See /health engines + last resolveDebug.provider on props",
    },
  };
}

/** Write dry-run JSON under betbrain-server for offline review. */
export function writeRecoveryPlanArtifact(plan, filename = null) {
  const name =
    filename ||
    `.tmp-recover-stale-${plan.slates?.[0]?.slateDate || "all"}-${
      plan.dryRun ? "dry-run" : "apply"
    }.json`;
  const outPath = path.join(SERVER_ROOT, name);
  fs.writeFileSync(outPath, JSON.stringify(plan, null, 2), "utf8");
  return outPath;
}
