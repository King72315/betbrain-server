/**
 * CourtEdge integrity watchdog v1 — lightweight checks on each scheduler heartbeat.
 * Repairs only proven links / retry-safe lifecycle transitions. Never manufactures props.
 */
import {
  DURABLE_KEYS,
  durableGet,
  durablePut,
  getDurableStoreHealthSync,
} from "./courtEdgeDurableStoreV1.js";
import { getTodayLocalDate } from "./slateScopeService.js";

export const WATCHDOG_VERSION = "courtedge-integrity-watchdog-v1";
export const WATCHDOG_BUILD = "courteedge-fully-autonomous-operation-v1";

function listBestSix(board, day) {
  if (!board || typeof board !== "object") return [];
  if (day === "TODAY") {
    return [
      ...(board.bestSixDisplayTodayWNBA || []),
      ...(board.bestSixDisplayTodayNBA || []),
    ];
  }
  return [
    ...(board.bestSixDisplayTomorrowWNBA || []),
    ...(board.bestSixDisplayTomorrowNBA || []),
  ];
}

function propIdOf(p) {
  return String(
    p?.officialPropId || p?.propId || p?.trackedKey || p?.id || ""
  );
}

function isSealedProp(p) {
  return Boolean(
    p?.immutableOfficial || p?.sealedAt || p?.officialSealedAt || p?.contentHash
  );
}

function isGraded(p) {
  const r = String(p?.result || p?.grade || "").toUpperCase();
  return ["WIN", "LOSS", "PUSH", "W", "L", "P"].includes(r) || p?.actualPoints != null;
}

/**
 * @param {object} ctx
 * @param {object} [ctx.board]
 * @param {Array} [ctx.trackedProps]
 * @param {object} [ctx.lab]
 * @param {object} [ctx.schedulerState]
 * @param {object} [ctx.canonicalStore]
 * @param {Function} [ctx.admitSealedToResults] — repair missing Results admission
 * @param {Function} [ctx.promoteGradedToLab] — repair missing Lab promotion
 * @param {Function} [ctx.repairLabPointer]
 * @param {boolean} [ctx.allowRepairs=true]
 */
export async function runIntegrityWatchdog(ctx = {}) {
  const now = new Date();
  const today = ctx.today || getTodayLocalDate(now);
  const findings = [];
  const repairs = [];
  const board = ctx.board || null;
  const tracked = Array.isArray(ctx.trackedProps) ? ctx.trackedProps : [];
  const lab = ctx.lab || null;
  const schedulerState = ctx.schedulerState || null;
  const durableHealth = getDurableStoreHealthSync();

  const todaySix = listBestSix(board, "TODAY").filter(isSealedProp);
  const tomorrowSix = listBestSix(board, "TOMORROW").filter(isSealedProp);
  const todayIds = new Set(todaySix.map(propIdOf).filter(Boolean));
  const tomorrowIds = new Set(tomorrowSix.map(propIdOf).filter(Boolean));

  // Today/Tomorrow overwrite detection
  const overlap = [...todayIds].filter((id) => tomorrowIds.has(id));
  if (overlap.length) {
    findings.push({
      code: "TODAY_TOMORROW_PROP_OVERLAP",
      severity: "high",
      overlapCount: overlap.length,
    });
  }

  // Empty home despite games
  const games = board?.games || [];
  const todayGames = games.filter((g) => g.dayBucket === "TODAY");
  if (todayGames.length > 0 && todaySix.length === 0) {
    const candidates = todayGames.reduce(
      (n, g) => n + (g.allGeneratedCandidates || g.picks || []).length,
      0
    );
    if (candidates >= 6) {
      findings.push({
        code: "HOME_EMPTY_DESPITE_MARKETS",
        severity: "high",
        todayGames: todayGames.length,
        candidates,
      });
    }
  }

  // Sealed six missing Results admission
  if (todaySix.length === 6) {
    const trackedToday = tracked.filter(
      (p) =>
        String(p.slateDate || p.resultsSlateDate || "").slice(0, 10) === today &&
        (p.immutableOfficial || p.officialSealedAt || p.sealedAt || p.trackingStatus === "TRACK")
    );
    const trackedIds = new Set(trackedToday.map(propIdOf).filter(Boolean));
    const missing = [...todayIds].filter((id) => !trackedIds.has(id));
    if (missing.length || trackedToday.length < 6) {
      findings.push({
        code: "SEALED_MISSING_RESULTS_ADMISSION",
        severity: "high",
        sealedCount: todaySix.length,
        trackedCount: trackedToday.length,
        missingCount: missing.length,
      });
      if (ctx.allowRepairs !== false && typeof ctx.admitSealedToResults === "function") {
        try {
          const repair = await ctx.admitSealedToResults({
            slateDate: today,
            props: todaySix,
            reason: "watchdog_sealed_missing_results",
          });
          repairs.push({
            code: "RESULTS_ADMISSION",
            ok: repair?.ok !== false,
            detail: repair,
          });
        } catch (error) {
          repairs.push({
            code: "RESULTS_ADMISSION",
            ok: false,
            error: String(error?.message || error),
          });
        }
      }
    } else {
      // ID mismatch
      const extras = [...trackedIds].filter((id) => !todayIds.has(id));
      if (extras.length) {
        findings.push({
          code: "RESULTS_PROP_ID_MISMATCH",
          severity: "high",
          extras: extras.length,
        });
      }
    }

    // Graded but Lab missing
    const gradedToday = trackedToday.filter(isGraded);
    if (trackedToday.length === 6 && gradedToday.length === 6) {
      const labDate =
        lab?.currentLabSlateDate ||
        lab?.labV2?.slateDate ||
        lab?.labV2?.defaultSlateDate ||
        null;
      if (String(labDate || "") !== today) {
        findings.push({
          code: "GRADED_MISSING_LAB_PROMOTION",
          severity: "high",
          gradedCount: 6,
          labDate,
          today,
        });
        if (ctx.allowRepairs !== false && typeof ctx.promoteGradedToLab === "function") {
          try {
            const repair = await ctx.promoteGradedToLab({
              slateDate: today,
              reason: "watchdog_graded_missing_lab",
            });
            repairs.push({
              code: "LAB_PROMOTION",
              ok: repair?.ok !== false,
              detail: repair,
            });
          } catch (error) {
            repairs.push({
              code: "LAB_PROMOTION",
              ok: false,
              error: String(error?.message || error),
            });
          }
        }
      }
    } else if (trackedToday.length === 6 && gradedToday.length < 6) {
      const unfinished = trackedToday.filter((p) => !isGraded(p));
      findings.push({
        code: "COMPLETED_GAMES_UNGRADED",
        severity: "medium",
        graded: gradedToday.length,
        pending: unfinished.length,
      });
    }
  }

  // Scheduler heartbeat stale
  const lastHb = schedulerState?.lastDispatcherAt
    ? Date.parse(schedulerState.lastDispatcherAt)
    : 0;
  if (lastHb && Date.now() - lastHb > 45 * 60 * 1000) {
    findings.push({
      code: "SCHEDULER_HEARTBEAT_STALE",
      severity: "medium",
      lastDispatcherAt: schedulerState.lastDispatcherAt,
    });
  }

  // Durable writes failing
  if (durableHealth.lastDurableError) {
    findings.push({
      code: "DURABLE_WRITES_FAILING",
      severity: "high",
      error: durableHealth.lastDurableError,
      type: durableHealth.type,
    });
  }

  // Hydrated analysis replaced by placeholders (heuristic)
  const placeholderCount = todaySix.filter(
    (p) =>
      !p?.decisionExplanation &&
      !p?.sealedAnalysis &&
      !p?.engineEvidence &&
      (p?.projection == null || p?.projection === 0)
  ).length;
  if (todaySix.length === 6 && placeholderCount >= 4) {
    findings.push({
      code: "HYDRATED_ANALYSIS_PLACEHOLDER",
      severity: "medium",
      placeholderCount,
    });
  }

  const report = {
    ok: true,
    watchdogVersion: WATCHDOG_VERSION,
    watchdogBuild: WATCHDOG_BUILD,
    at: now.toISOString(),
    today,
    findingCount: findings.length,
    repairCount: repairs.length,
    findings,
    repairs,
    durableStore: durableHealth,
    summary: {
      todaySealedCount: todaySix.length,
      tomorrowSealedCount: tomorrowSix.length,
      trackedCount: tracked.length,
    },
  };

  try {
    await durablePut(DURABLE_KEYS.WATCHDOG, report, { recordVersion: 1 });
  } catch {
    // non-fatal
  }

  return report;
}

export async function loadLastWatchdogReport() {
  const got = await durableGet(DURABLE_KEYS.WATCHDOG);
  return got.value || null;
}
