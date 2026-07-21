/**
 * CourtEdge Full-App Tab Flow Repair V1
 *
 * Closes Home → Results → Lab → History admission gaps without regenerating
 * sealed membership, rewriting sealed fields, or inventing missing evidence.
 *
 * Hypotheses A–I (Results empty while Home Selected/Tracked 6/6) are classified
 * at scan time; repairs only admit exact sealed cohorts already on disk.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  STATE_INTEGRITY_BUILD,
  LIFECYCLE,
  buildCanonicalSlateId,
  buildCanonicalSlateRecord,
  upsertCanonicalSlate,
  transitionLifecycle,
  withSlateLock,
  getCanonicalSlateDate,
  syncBoardToCanonicalStore,
  attachContentHash,
} from "./courtEdgeStateIntegrityV1.js";
import {
  isOfficialSlateSealed,
  getOfficialSlate,
  promoteSealedSlateToResults,
  freezeOfficialProp,
  sealOfficialSlate,
  OFFICIAL_LIFECYCLE_STAGE,
  appendLifecycleAudit,
} from "./officialSlateService.js";
import {
  applySlateLockFreeze,
  getTrackedProps,
  mergeLockedSlateFreezeIntoTracked,
  writeTrackedProps,
  getStableTrackedPropKey,
  getSlateDateCT,
} from "./trackedPropService.js";
import {
  getLockedSlatesRegistry,
  getLockedSnapshot,
  isSlateLocked,
} from "./slateLockService.js";
import {
  getTodayLocalDate,
  getYesterdayLocalDate,
  getResultsPropSlateDate,
  pickActiveResultsSlateDate,
  resolveHomeBoardSlateDate,
} from "./slateScopeService.js";
import { classifyTrackedPropsByLifecycle } from "./slateLifecycleService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const SNAPSHOTS_DIR = path.join(SERVER_ROOT, "slate-snapshots");
const ACTIVE_BUNDLES_DIR = path.join(SERVER_ROOT, "active-bundles");

export const TAB_FLOW_REPAIR_BUILD = "courteedge-slate-date-today-repair-v2";
export const TAB_FLOW_REPAIR_SCHEMA = "courtEdgeTabFlowRepairV1";

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function normalizeSealedAdmissionProps(props = [], slateDate = "") {
  const date = String(slateDate || "").trim();
  const sealedAt = new Date().toISOString();
  return (Array.isArray(props) ? props : [])
    .filter((p) => p?.player)
    .map((pick, index) => {
      const frozen = freezeOfficialProp(
        {
          ...pick,
          homeStaged: false,
          bestSixRank:
            pick.bestSixRank || pick.controlledBestSixRank || index + 1,
          slateDate: date || pick.slateDate,
        },
        { slateDate: date || pick.slateDate, sealedAt }
      );
      return {
        ...frozen,
        homeStaged: false,
        slateLocked: true,
        immutableOfficial: true,
        resultsSlateDate: date || frozen.slateDate,
        cohortSlateDate: date || frozen.slateDate,
        trackingEligibility: "TRACK",
        finalDecision: "TRACK",
        resultsDecisionLabel: "TRACK",
        controlledBestSixDisplay: true,
        controlledBestSixDisplayTracked: true,
        trackingAdmissionSource: "CONTROLLED_BEST_SIX_DISPLAY",
        sourcePool: "CONTROLLED_BEST_SIX_DISPLAY",
        tabFlowAdmissionBuild: TAB_FLOW_REPAIR_BUILD,
      };
    });
}

/**
 * Atomic seal → Results admission.
 * Inserts/merges exact sealed props into tracked-props, clears homeStaged,
 * promotes official lifecycle to RESULTS, syncs canonical store.
 * Never regenerates membership from live markets.
 */
export function admitSealedPropsToResults(slateDate = "", props = [], options = {}) {
  return admitSealedPropsToResultsSync(slateDate, props, options);
}

/**
 * Sync-safe admission via freeze merge only (no full-store replace).
 */
export function admitSealedPropsToResultsSync(slateDate = "", props = [], options = {}) {
  const date = String(slateDate || "").trim();
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, admitted: false, message: "Missing or invalid slateDate" };
  }

  const incoming = normalizeSealedAdmissionProps(props, date);
  if (!incoming.length) {
    return {
      ok: false,
      admitted: false,
      slateDate: date,
      message: `No sealed props to admit for ${date}`,
    };
  }

  return withSlateLock(`tab-flow-admit:${date}`, () => {
    const before = getTrackedProps();
    const beforeCount = before.filter(
      (p) => getResultsPropSlateDate(p) === date && p.homeStaged !== true
    ).length;

    const merged = mergeLockedSlateFreezeIntoTracked(
      before.map((p) =>
        getResultsPropSlateDate(p) === date ? { ...p, homeStaged: false } : p
      ),
      date,
      incoming
    );

    // Persist via applySlateLockFreeze (atomic write of merged sealed rows).
    applySlateLockFreeze(date, incoming);

    // Ensure homeStaged cleared on all date-matched official rows.
    const live = getTrackedProps();
    const needsClear = live.some(
      (p) => getResultsPropSlateDate(p) === date && p.homeStaged === true
    );
    if (needsClear) {
      applySlateLockFreeze(
        date,
        live
          .filter((p) => getResultsPropSlateDate(p) === date)
          .map((p) => ({ ...p, homeStaged: false, immutableOfficial: true }))
      );
    }

    if (options.promoteToResults !== false) {
      promoteSealedSlateToResults(date, {
        promotedAt: options.promotedAt || new Date().toISOString(),
        serverBuild: options.serverBuild || TAB_FLOW_REPAIR_BUILD,
      });
    }

    try {
      const canonical = buildCanonicalSlateRecord({
        league: options.league || incoming[0]?.league || "WNBA",
        slateDate: date,
        cohort: "officialbest6",
        marketType: "playerpoints",
        dayBucket:
          options.dayBucket ||
          (date === getTodayLocalDate() ? "TODAY" : "TOMORROW"),
        props: incoming,
        lifecycle: LIFECYCLE.SEALED,
        sealedAt: incoming[0]?.officialSealedAt || new Date().toISOString(),
        buildVersion: TAB_FLOW_REPAIR_BUILD,
      });
      upsertCanonicalSlate(canonical);
      if (options.promoteToResults !== false) {
        transitionLifecycle(canonical.slateId, LIFECYCLE.IN_RESULTS, {
          reason: options.reason || "TAB_FLOW_SEAL_ADMISSION",
          source: TAB_FLOW_REPAIR_BUILD,
          idempotencyKey: `admit-results:${date}:${canonical.slateContentHash}`,
        });
      }
    } catch (err) {
      appendLifecycleAudit({
        type: "TAB_FLOW_CANONICAL_SYNC_WARNING",
        slateDate: date,
        message: err.message,
      });
    }

    const after = getTrackedProps();
    const afterCount = after.filter(
      (p) =>
        getResultsPropSlateDate(p) === date &&
        p.homeStaged !== true &&
        (p.immutableOfficial === true || p.officialPropId)
    ).length;

    appendLifecycleAudit({
      type: "TAB_FLOW_SEAL_ADMISSION",
      slateDate: date,
      propCount: incoming.length,
      beforeResultsVisibleCount: beforeCount,
      afterResultsVisibleCount: afterCount,
      reason: options.reason || "ATOMIC_SEAL_ADMISSION",
      build: TAB_FLOW_REPAIR_BUILD,
      mergedPreviewCount: merged.length,
    });

    return {
      ok: true,
      admitted: true,
      slateDate: date,
      propCount: incoming.length,
      beforeResultsVisibleCount: beforeCount,
      afterResultsVisibleCount: afterCount,
      officialPropIds: incoming.map((p) => p.officialPropId),
      message: `Admitted ${incoming.length} sealed props for ${date} into Results`,
    };
  }).result || {
    ok: false,
    admitted: false,
    slateDate: date,
    message: "Failed to acquire slate lock for admission",
  };
}

/**
 * Normalize a sealOfficialSlate / sealTomorrow result into Results admission.
 * Handles alreadySealed (loads snapshot props) and first-time sealed.
 */
export function admitSealResult(sealResult = {}, options = {}) {
  if (!sealResult || sealResult.ok === false) {
    return {
      ok: false,
      admitted: false,
      message: sealResult?.message || "Seal result not ok",
      sealResult,
    };
  }

  const date = String(
    sealResult.slateDate || options.slateDate || ""
  ).trim();
  if (!date) {
    return { ok: false, admitted: false, message: "Seal result missing slateDate" };
  }

  let props = Array.isArray(sealResult.props) ? sealResult.props : [];
  if (!props.length) {
    const existing = getOfficialSlate(date);
    props = existing?.props || [];
  }
  if (!props.length) {
    const snap = getLockedSnapshot(date);
    props = snap?.props || [];
  }

  if (!props.length) {
    return {
      ok: false,
      admitted: false,
      slateDate: date,
      alreadySealed: Boolean(sealResult.alreadySealed || sealResult.sealed),
      message: `Sealed slate ${date} has no props to admit (orphan without membership)`,
      hypothesis: "H_SEALED_ORPHAN_EMPTY_SNAPSHOT",
    };
  }

  // Only admit when sealed / already sealed / caller forces recovery.
  if (
    !(
      sealResult.sealed ||
      sealResult.alreadySealed ||
      options.forceAdmit === true ||
      isOfficialSlateSealed(date) ||
      isSlateLocked(date)
    )
  ) {
    return {
      ok: true,
      admitted: false,
      slateDate: date,
      status: "DRAFT",
      message: `Draft slate ${date} not admitted to Results`,
      hypothesis: "A_HOME_DRAFT_NOT_SEALED",
    };
  }

  return admitSealedPropsToResultsSync(date, props, {
    ...options,
    reason:
      options.reason ||
      sealResult.sealReason ||
      (sealResult.alreadySealed
        ? "ALREADY_SEALED_STARTUP_OR_REFRESH_ADMISSION"
        : "FRESH_SEAL_ADMISSION"),
    promoteToResults:
      options.promoteToResults ??
      date <= getTodayLocalDate(),
  });
}

function listSnapshotDates() {
  if (!fs.existsSync(SNAPSHOTS_DIR)) return [];
  return fs
    .readdirSync(SNAPSHOTS_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => name.replace(/\.json$/, ""))
    .sort();
}

function listActiveBundleDates() {
  if (!fs.existsSync(ACTIVE_BUNDLES_DIR)) return [];
  return fs
    .readdirSync(ACTIVE_BUNDLES_DIR)
    .filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name))
    .sort();
}

/**
 * Startup recovery: sealed snapshots/bundles missing from Results-visible tracked.
 * Idempotent — re-running does not invent props or rewrite sealed fields.
 */
export function recoverSealedOrphansAtStartup(options = {}) {
  const today = String(options.todayLocalDate || getTodayLocalDate());
  const tracked = getTrackedProps();
  const repairs = [];
  const skipped = [];

  const candidateDates = new Set([
    ...listSnapshotDates(),
    ...listActiveBundleDates(),
    ...((getLockedSlatesRegistry().slates || []).map((s) =>
      String(s.slateDate || "")
    )),
  ]);

  for (const date of [...candidateDates].sort()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!(isOfficialSlateSealed(date) || isSlateLocked(date))) {
      skipped.push({ slateDate: date, reason: "NOT_SEALED" });
      continue;
    }

    const official = getOfficialSlate(date);
    const props = official?.props || getLockedSnapshot(date)?.props || [];
    if (!props.length) {
      skipped.push({
        slateDate: date,
        reason: "SEALED_WITHOUT_PROPS",
        hypothesis: "H_SEALED_ORPHAN_EMPTY_SNAPSHOT",
      });
      continue;
    }

    const visible = tracked.filter(
      (p) =>
        getResultsPropSlateDate(p) === date &&
        p.homeStaged !== true &&
        (p.immutableOfficial === true || Boolean(p.officialPropId))
    );

    const stagedOnly = tracked.filter(
      (p) => getResultsPropSlateDate(p) === date && p.homeStaged === true
    );

    if (visible.length >= Math.min(6, props.length) && stagedOnly.length === 0) {
      skipped.push({
        slateDate: date,
        reason: "ALREADY_ADMITTED",
        visibleCount: visible.length,
      });
      continue;
    }

    // Only auto-admit today/yesterday/tomorrow window or any sealed with staged-only.
    const dayDiff =
      (Date.parse(`${date}T12:00:00`) - Date.parse(`${today}T12:00:00`)) /
      86400000;
    if (Math.abs(dayDiff) > 2 && stagedOnly.length === 0 && visible.length > 0) {
      skipped.push({
        slateDate: date,
        reason: "OUTSIDE_RECOVERY_WINDOW_ALREADY_HAS_VISIBLE",
        visibleCount: visible.length,
      });
      continue;
    }

    const result = admitSealedPropsToResultsSync(date, props, {
      reason: "STARTUP_SEALED_ORPHAN_RECOVERY",
      serverBuild: options.serverBuild || TAB_FLOW_REPAIR_BUILD,
      promoteToResults: date <= today,
      dayBucket: date === today ? "TODAY" : date > today ? "TOMORROW" : "PAST",
    });
    repairs.push(result);
  }

  appendLifecycleAudit({
    type: "TAB_FLOW_STARTUP_ORPHAN_RECOVERY",
    repairs: repairs.length,
    skipped: skipped.length,
    build: TAB_FLOW_REPAIR_BUILD,
  });

  return {
    ok: true,
    build: TAB_FLOW_REPAIR_BUILD,
    today,
    repairs,
    skipped,
    repairedCount: repairs.filter((r) => r.admitted).length,
  };
}

/**
 * Classify why Results can show 0 while Home Selected/Tracked shows 6/6.
 * Does not mutate state.
 */
export function classifyHomeResultsGap(context = {}) {
  const today = String(context.todayLocalDate || getTodayLocalDate());
  const board = context.board || {};
  const tracked = context.trackedProps || getTrackedProps();
  const todayBoard = [
    ...(board.bestSixDisplayTodayWNBA || []),
    ...(board.bestSixDisplayTodayNBA || []),
  ];
  const tomorrowBoard = [
    ...(board.bestSixDisplayTomorrowWNBA || []),
    ...(board.bestSixDisplayTomorrowNBA || []),
  ];

  const classification = classifyTrackedPropsByLifecycle(tracked, {
    todayLocalDate: today,
  });
  const todayTracked = tracked.filter(
    (p) => getResultsPropSlateDate(p) === today
  );
  const todayOfficialVisible = todayTracked.filter(
    (p) => p.homeStaged !== true && (p.immutableOfficial || p.officialPropId)
  );
  const todayStaged = todayTracked.filter((p) => p.homeStaged === true);
  const todaySealed = isOfficialSlateSealed(today) || isSlateLocked(today);
  const boardTrackFlags = todayBoard.filter(
    (p) =>
      p.controlledBestSixDisplayTracked === true ||
      p.controlledBestSixDisplay === true ||
      p.trackingEligibility === "TRACK" ||
      p.finalDecision === "TRACK"
  ).length;

  const hypotheses = {
    A_HOME_DRAFT_NOT_SEALED:
      todayBoard.length >= 6 && !todaySealed && todayOfficialVisible.length === 0,
    B_HOMESTAGED_BLOCKS_RESULTS:
      todayStaged.length > 0 && todayOfficialVisible.length === 0,
    C_DATE_MISMATCH_TOMORROW_VS_TODAY:
      tomorrowBoard.length >= 6 &&
      todayOfficialVisible.length === 0 &&
      boardTrackFlags >= 6,
    D_ACTIVE_COHORT_DATE_NULL:
      !classification.activeResultsSlateDate &&
      classification.trackedStoreTotalCount > 0,
    E_BOARD_TRACK_FLAGS_NOT_STORE:
      boardTrackFlags >= 6 && todayOfficialVisible.length === 0,
    F_SEALED_ORPHAN_SNAPSHOT:
      todaySealed && todayOfficialVisible.length === 0,
    G_ALREADY_SEALED_SKIPPED_ADMISSION:
      todaySealed &&
      (getOfficialSlate(today)?.propCount || 0) > 0 &&
      todayOfficialVisible.length === 0,
    H_FILTER_EXCLUDES_COHORT:
      todayTracked.length > 0 &&
      todayOfficialVisible.length === 0 &&
      todayStaged.length === 0,
    I_EPHEMERAL_DISK_OR_CACHE_ONLY:
      todayBoard.length >= 6 &&
      todayTracked.length === 0 &&
      !todaySealed,
  };

  const confirmed = Object.entries(hypotheses)
    .filter(([, v]) => v)
    .map(([k]) => k);

  return {
    ok: true,
    build: TAB_FLOW_REPAIR_BUILD,
    today,
    homeTodayCount: todayBoard.length,
    homeTomorrowCount: tomorrowBoard.length,
    homeTodayTrackFlagCount: boardTrackFlags,
    todaySealed,
    todayTrackedCount: todayTracked.length,
    todayOfficialVisibleCount: todayOfficialVisible.length,
    todayStagedCount: todayStaged.length,
    activeResultsSlateDate: classification.activeResultsSlateDate || null,
    activeResultsTrackedCount: classification.activeResultsTrackedCount || 0,
    trackedStoreTotalCount:
      classification.trackedStoreTotalCount ?? tracked.length,
    hypotheses,
    confirmedHypotheses: confirmed,
    primaryHypothesis: confirmed[0] || "NONE_MATCHED",
    explanation:
      confirmed[0] === "E_BOARD_TRACK_FLAGS_NOT_STORE" ||
      confirmed[0] === "A_HOME_DRAFT_NOT_SEALED" ||
      confirmed[0] === "I_EPHEMERAL_DISK_OR_CACHE_ONLY"
        ? "Home Selected/Tracked 6/6 counts Best Six display TRACK flags on the board cache; Results requires sealed admission into tracked-props with an active cohort date. Display flags are not Results membership."
        : confirmed[0] === "F_SEALED_ORPHAN_SNAPSHOT" ||
            confirmed[0] === "G_ALREADY_SEALED_SKIPPED_ADMISSION"
          ? "Official slate is sealed on disk but Results-visible tracked rows are missing or still homeStaged — admission was skipped on alreadySealed refresh paths."
          : confirmed[0] === "B_HOMESTAGED_BLOCKS_RESULTS"
            ? "Tracked rows exist for today but homeStaged=true excludes them from the active Results cohort."
            : confirmed[0] === "D_ACTIVE_COHORT_DATE_NULL"
              ? "Tracked store has rows but pickActiveResultsSlateDate returned null (no blocking unresolved slate and today cohort not open)."
              : "No single primary hypothesis matched; see confirmedHypotheses.",
  };
}

/**
 * Honest Results empty copy — never instructs regeneration.
 */
export function buildHonestResultsEmptyCopy({
  todayLocalDate = getTodayLocalDate(),
  activeResultsSlateDate = null,
  gap = null,
} = {}) {
  if (activeResultsSlateDate) {
    return `Active slate ${activeResultsSlateDate} has no Results-visible official props yet. Home display TRACK counts are not Results membership.`;
  }
  const primary = gap?.primaryHypothesis || null;
  if (
    primary === "A_HOME_DRAFT_NOT_SEALED" ||
    primary === "E_BOARD_TRACK_FLAGS_NOT_STORE" ||
    primary === "I_EPHEMERAL_DISK_OR_CACHE_ONLY"
  ) {
    return `No active Results cohort for ${todayLocalDate}. Home may show Selected/Tracked from the Best 6 board draft; Results only shows sealed official admission. Prop Lab holds completed slates.`;
  }
  if (
    primary === "F_SEALED_ORPHAN_SNAPSHOT" ||
    primary === "G_ALREADY_SEALED_SKIPPED_ADMISSION"
  ) {
    return `No active Results cohort for ${todayLocalDate}. A sealed official slate exists but was not yet admitted into Results-visible tracked props — recovery runs on startup/refresh without regenerating membership.`;
  }
  return `No active Results cohort for ${todayLocalDate}. Today's slate is fully graded or not yet sealed into Results — see Home for the board and Prop Lab for completed slates.`;
}

/**
 * Idempotent History archival transition for graded+Lab-complete slates.
 * Restart-safe: repeated calls are no-ops when already IN_HISTORY.
 */
export function archiveCompletedSlateIdempotent(slateDate = "", options = {}) {
  const date = String(slateDate || "").trim();
  if (!date) return { ok: false, archived: false, message: "Missing slateDate" };

  const slateId =
    options.slateId ||
    buildCanonicalSlateId({
      league: options.league || "WNBA",
      slateDate: date,
      cohort: "officialbest6",
      marketType: "playerpoints",
    });

  const result = transitionLifecycle(slateId, LIFECYCLE.IN_HISTORY, {
    reason: options.reason || "TAB_FLOW_HISTORY_ARCHIVE",
    source: TAB_FLOW_REPAIR_BUILD,
    idempotencyKey: options.idempotencyKey || `history-archive:${date}`,
  });

  appendLifecycleAudit({
    type: "TAB_FLOW_HISTORY_ARCHIVE",
    slateDate: date,
    slateId,
    result,
    build: TAB_FLOW_REPAIR_BUILD,
  });

  return {
    ok: result?.ok !== false,
    archived:
      result?.toState === LIFECYCLE.IN_HISTORY ||
      result?.slate?.lifecycle === LIFECYCLE.IN_HISTORY,
    idempotent: result?.idempotent === true,
    slateDate: date,
    slateId,
    lifecycle: result?.toState || result?.slate?.lifecycle || null,
  };
}

export function buildTabFlowDiagnostics(context = {}) {
  const gap = classifyHomeResultsGap(context);
  const today = gap.today;
  const tracked = context.trackedProps || getTrackedProps();
  const classification = classifyTrackedPropsByLifecycle(tracked, {
    todayLocalDate: today,
  });
  return {
    ok: true,
    build: TAB_FLOW_REPAIR_BUILD,
    schema: TAB_FLOW_REPAIR_SCHEMA,
    stateIntegrityBuild: STATE_INTEGRITY_BUILD,
    capturedAt: new Date().toISOString(),
    gap,
    honestEmptyCopy: buildHonestResultsEmptyCopy({
      todayLocalDate: today,
      activeResultsSlateDate: classification.activeResultsSlateDate,
      gap,
    }),
    activeResultsSlateDate: classification.activeResultsSlateDate || null,
    activeResultsTrackedCount: classification.activeResultsTrackedCount || 0,
    trackedStoreTotalCount:
      classification.trackedStoreTotalCount ?? tracked.length,
  };
}

/**
 * After board seed/hydrate: seal+admit calendar-today Best 6 when full and
 * eligible, without calling providers. Never invents membership — uses board
 * display six only. Tomorrow seals for next-day Results (promoteToResults false).
 */
export function recoverHomeBoardAdmissionFromCache(board = null, options = {}) {
  const today = String(options.todayLocalDate || getTodayLocalDate());
  if (!board || typeof board !== "object") {
    return {
      ok: true,
      recovered: false,
      message: "No board cache",
      build: TAB_FLOW_REPAIR_BUILD,
    };
  }

  const actions = [];
  const todaySix = [
    ...(board.bestSixDisplayTodayWNBA || []),
    ...(board.bestSixDisplayTodayNBA || []),
  ]
    .filter((p) => p?.player)
    // Never admit prior-day props just because dayBucket still says TODAY.
    .filter((p) => resolveHomeBoardSlateDate(p) === today)
    .map((p) => ({
      ...p,
      slateDate: today,
      dayBucket: "TODAY",
      dateLabel: p.dateLabel || "Today",
      trackingAdmissionSource:
        p.trackingAdmissionSource || "CONTROLLED_BEST_SIX_DISPLAY",
      sourcePool: p.sourcePool || "CONTROLLED_BEST_SIX_DISPLAY",
      controlledBestSixDisplay: true,
      controlledBestSixDisplayTracked: true,
      homeStaged: false,
    }));

  if (todaySix.length >= 6) {
    const visible = getTrackedProps().filter(
      (p) =>
        getResultsPropSlateDate(p) === today &&
        p.homeStaged !== true &&
        (p.immutableOfficial === true ||
          p.controlledBestSixDisplayTracked === true ||
          p.trackingEligibility === "TRACK")
    );
    if (visible.length < 6) {
      // Prefer existing sealed membership; else seal board six when eligible.
      let sealPayload = {
        sealed: isOfficialSlateSealed(today) || isSlateLocked(today),
        alreadySealed: isOfficialSlateSealed(today) || isSlateLocked(today),
        slateDate: today,
        props:
          getOfficialSlate(today)?.props ||
          getLockedSnapshot(today)?.props ||
          todaySix,
      };
      if (!sealPayload.alreadySealed) {
        const sealed = sealOfficialSlate(todaySix, {
          slateDate: today,
          todayLocalDate: today,
          serverBuild: options.serverBuild || TAB_FLOW_REPAIR_BUILD,
          reason: "TAB_FLOW_BOARD_CACHE_TODAY_SEAL",
        });
        sealPayload = { ...sealed, slateDate: today };
      }
      const admit = admitSealResult(sealPayload, {
        serverBuild: options.serverBuild || TAB_FLOW_REPAIR_BUILD,
        reason: "TAB_FLOW_BOARD_CACHE_TODAY_ADMISSION",
        promoteToResults: true,
        dayBucket: "TODAY",
        forceAdmit: Boolean(sealPayload.sealed || sealPayload.alreadySealed),
      });
      actions.push({ type: "today", admit, sealPayloadStatus: sealPayload.status });
    }
  }

  const tomorrowSix = [
    ...(board.bestSixDisplayTomorrowWNBA || []),
    ...(board.bestSixDisplayTomorrowNBA || []),
  ]
    .filter((p) => p?.player)
    .filter((p) => {
      const resolved = resolveHomeBoardSlateDate(p);
      // Stale prior-day props must never seal as Tomorrow.
      if (resolved && resolved < today) return false;
      return true;
    });

  if (tomorrowSix.length >= 6) {
    const tomDate =
      String(
        tomorrowSix.map((p) => resolveHomeBoardSlateDate(p)).find((d) => d > today) ||
          tomorrowSix[0]?.slateDate ||
          ""
      ).slice(0, 10) ||
      (() => {
        const [y, m, d] = today.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
        dt.setUTCDate(dt.getUTCDate() + 1);
        return dt.toISOString().slice(0, 10);
      })();
    if (tomDate <= today) {
      actions.push({
        type: "tomorrow",
        skipped: true,
        reason: "TOMORROW_DATE_NOT_FUTURE",
        tomDate,
      });
    } else {
    const stampedTom = tomorrowSix.map((p) => ({
      ...p,
      slateDate: tomDate,
      dayBucket: "TOMORROW",
      dateLabel: p.dateLabel || "Tomorrow",
      controlledBestSixDisplay: true,
      controlledBestSixDisplayTracked: true,
      homeStaged: false,
    }));
    if (isOfficialSlateSealed(tomDate) || isSlateLocked(tomDate)) {
      const admit = admitSealResult(
        {
          sealed: true,
          alreadySealed: true,
          slateDate: tomDate,
          props:
            getOfficialSlate(tomDate)?.props ||
            getLockedSnapshot(tomDate)?.props ||
            stampedTom,
        },
        {
          serverBuild: options.serverBuild || TAB_FLOW_REPAIR_BUILD,
          reason: "TAB_FLOW_BOARD_CACHE_TOMORROW_ADMISSION",
          promoteToResults: false,
          dayBucket: "TOMORROW",
        }
      );
      actions.push({ type: "tomorrow", admit });
    }
    }
  }

  appendLifecycleAudit({
    type: "TAB_FLOW_BOARD_CACHE_ADMISSION",
    actions: actions.length,
    build: TAB_FLOW_REPAIR_BUILD,
  });

  return {
    ok: true,
    recovered: actions.some((a) => a.admit?.admitted),
    actions,
    build: TAB_FLOW_REPAIR_BUILD,
  };
}

/**
 * Restore props that board-cache admission incorrectly stamped as calendar today
 * despite past commenceTimes (overnight rollover). Moves them back to yesterday
 * without deleting membership. Idempotent.
 */
export function repairBoardCacheTodayDateStampCorruption(options = {}) {
  const today = String(options.todayLocalDate || getTodayLocalDate());
  const prior = String(options.priorSlateDate || getYesterdayLocalDate(today));
  const tracked = getTrackedProps();

  const corrupted = (tracked || []).filter((p) => {
    if (String(p.slateDate || "").slice(0, 10) !== today) return false;
    const commenceDate = getSlateDateCT(p.commenceTime || p.time || "");
    if (!commenceDate || commenceDate >= today) return false;
    return (
      p.immutableOfficial === true ||
      p.controlledBestSixDisplayTracked === true ||
      p.trackingAdmissionSource === "CONTROLLED_BEST_SIX_DISPLAY" ||
      String(p.officialPropId || "").startsWith(`${today}|`)
    );
  });

  if (!corrupted.length) {
    return {
      ok: true,
      repaired: false,
      reason: "NO_CORRUPTED_TODAY_STAMPS",
      today,
      prior,
      build: TAB_FLOW_REPAIR_BUILD,
    };
  }
  if (corrupted.length > 6) {
    return {
      ok: false,
      repaired: false,
      reason: "CORRUPTED_COHORT_TOO_LARGE",
      count: corrupted.length,
      today,
      prior,
      build: TAB_FLOW_REPAIR_BUILD,
    };
  }

  const dropKeys = new Set(
    corrupted.map((p) =>
      String(p.trackedKey || p.trackedId || getStableTrackedPropKey(p) || "")
    )
  );

  const restored = corrupted.map((p, index) => {
    const frozen = freezeOfficialProp(
      {
        ...p,
        slateDate: prior,
        dayBucket: "PAST",
        dateLabel: prior,
        homeStaged: false,
        immutableOfficial: true,
        bestSixRank: p.bestSixRank || p.controlledBestSixRank || index + 1,
        trackingAdmissionSource:
          p.trackingAdmissionSource || "ROLLOVER_DATE_STAMP_REPAIR",
      },
      { slateDate: prior }
    );
    const key = getStableTrackedPropKey({ ...frozen, slateDate: prior });
    return {
      ...frozen,
      slateDate: prior,
      homeStaged: false,
      immutableOfficial: true,
      trackedKey: key,
      trackedId: key,
    };
  });

  const restoredKeys = new Set(
    restored.map((p) => String(p.trackedKey || p.trackedId || ""))
  );

  const next = [];
  for (const p of tracked) {
    const key = String(
      p.trackedKey || p.trackedId || getStableTrackedPropKey(p) || ""
    );
    if (dropKeys.has(key)) continue;
    next.push(p);
  }
  for (const r of restored) {
    const key = String(r.trackedKey || r.trackedId || "");
    if (restoredKeys.has(key) && next.some((p) => String(p.trackedKey || p.trackedId || "") === key)) {
      continue;
    }
    next.push(r);
  }

  writeTrackedProps(next, {
    allowFullReplace: true,
    sourcePath: "repairBoardCacheTodayDateStampCorruption",
  });

  const admit = admitSealedPropsToResultsSync(prior, restored, {
    reason: "ROLLOVER_DATE_STAMP_REPAIR_READMIT",
    serverBuild: options.serverBuild || TAB_FLOW_REPAIR_BUILD,
    promoteToResults: true,
    dayBucket: "PAST",
  });

  appendLifecycleAudit({
    type: "TAB_FLOW_ROLLOVER_DATE_STAMP_REPAIR",
    today,
    prior,
    restoredCount: restored.length,
    droppedKeys: [...dropKeys],
    build: TAB_FLOW_REPAIR_BUILD,
  });

  return {
    ok: true,
    repaired: true,
    today,
    prior,
    restoredCount: restored.length,
    restoredPlayers: restored.map((p) => p.player || p.playerName),
    admit,
    build: TAB_FLOW_REPAIR_BUILD,
  };
}

export function attachBoardReadOnlyHashes(board) {
  if (!board || typeof board !== "object") return board;
  try {
    syncBoardToCanonicalStore(board, { readOnly: true });
  } catch {
    // read-only hash attach must never fail the GET
  }
  const keys = [
    "bestSixDisplayTodayWNBA",
    "bestSixDisplayTodayNBA",
    "bestSixDisplayTomorrowWNBA",
    "bestSixDisplayTomorrowNBA",
  ];
  const out = { ...board };
  for (const key of keys) {
    if (!Array.isArray(out[key])) continue;
    out[key] = out[key].map((p) =>
      p?.contentHash ? p : attachContentHash(p, { slateDate: p?.slateDate })
    );
  }
  return out;
}

export {
  getCanonicalSlateDate,
  pickActiveResultsSlateDate,
  OFFICIAL_LIFECYCLE_STAGE,
};
