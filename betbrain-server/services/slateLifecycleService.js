/**
 * CourtEdge slate lifecycle state machine — explicit states per blueprint.
 */
import {
  computeSlateRotation,
  getTodayLocalDate,
  isCompletedSlate,
  isFutureSlateDate,
  isOnOrAfterCleanDataCutoff,
  isPastSlateDate,
  pickActiveResultsSlateDate,
} from "./slateScopeService.js";
import { getHistoryArchiveProps, isSlateLocked } from "./slateLockService.js";
import { isOfficialResultsProp } from "./trackedPropService.js";
import { BEST_SIX_LIMIT } from "../engines/topProps/controlledBestSixSelector.js";

export const SLATE_LIFECYCLE_STATES = {
  GENERATED_BOARD: "GENERATED_BOARD",
  TRACKING_ACTIVE: "TRACKING_ACTIVE",
  PARTIALLY_GRADED: "PARTIALLY_GRADED",
  READY_FOR_LAB: "READY_FOR_LAB",
  LAB_CURRENT: "LAB_CURRENT",
  ARCHIVED_HISTORY: "ARCHIVED_HISTORY",
};

/** Per-prop lifecycle bucket for /tracked-props filtering (read-time, non-destructive). */
export const TRACKED_PROP_LIFECYCLE = {
  ACTIVE_RESULTS: "ACTIVE_RESULTS",
  LAB_CURRENT: "LAB_CURRENT",
  ARCHIVED_HISTORY: "ARCHIVED_HISTORY",
  LEGACY_COMPLETED: "LEGACY_COMPLETED",
  LEGACY_COMPLETED_NEEDS_ARCHIVE: "LEGACY_COMPLETED_NEEDS_ARCHIVE",
  STALE_UNRESOLVED: "STALE_UNRESOLVED",
  QUARANTINED_LEGACY: "QUARANTINED_LEGACY",
  HOME_STAGED: "HOME_STAGED",
};

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

export function resolveSlateLifecycleState(slateDate, context = {}) {
  const {
    trackedProps = [],
    reports = [],
    archives = [],
    lockedSlates = [],
    today = getTodayLocalDate(),
    hasGeneratedBoard = false,
  } = context;

  const date = String(slateDate || "");
  if (!date) {
    return { state: null, slateDate: date, reason: "missing_slate_date" };
  }

  if (!isOnOrAfterCleanDataCutoff(date)) {
    return { state: null, slateDate: date, reason: "pre_cutoff" };
  }

  const archiveEntry = (archives || []).find(
    (entry) => String(entry.slateDate || "") === date
  );
  if (archiveEntry?.props?.length || getHistoryArchiveProps(date).length) {
    return {
      state: SLATE_LIFECYCLE_STATES.ARCHIVED_HISTORY,
      slateDate: date,
      reason: "history_archive_exists",
    };
  }

  const rotation = computeSlateRotation(reports);
  if (rotation.currentLabSlateDate === date) {
    return {
      state: SLATE_LIFECYCLE_STATES.LAB_CURRENT,
      slateDate: date,
      reason: "current_lab_slate",
    };
  }

  const inHistoryRotation = rotation.historySlates.some(
    (report) => String(report.slateDate || "") === date
  );
  if (inHistoryRotation) {
    return {
      state: SLATE_LIFECYCLE_STATES.ARCHIVED_HISTORY,
      slateDate: date,
      reason: "lab_rotated_to_history",
    };
  }

  const report = (reports || []).find(
    (item) => String(item.slateDate || "") === date
  );
  const slateProps = trackedProps.filter(
    (prop) => String(prop.slateDate || "") === date
  );
  const graded = slateProps.filter((prop) => isResolvedStatus(prop.status));
  const pending = slateProps.length - graded.length;
  const locked =
    isSlateLocked(date) ||
    (lockedSlates || []).some((entry) => String(entry.slateDate || "") === date);

  if (report && isCompletedSlate(report)) {
    return {
      state: SLATE_LIFECYCLE_STATES.READY_FOR_LAB,
      slateDate: date,
      reason: "lab_report_completed",
      trackedCount: slateProps.length,
      gradedCount: graded.length,
    };
  }

  if (slateProps.length === 0) {
    return {
      state: SLATE_LIFECYCLE_STATES.GENERATED_BOARD,
      slateDate: date,
      reason: hasGeneratedBoard ? "board_without_tracking" : "no_tracked_props",
    };
  }

  if (pending === 0 && slateProps.length > 0) {
    return {
      state: SLATE_LIFECYCLE_STATES.READY_FOR_LAB,
      slateDate: date,
      reason: "all_graded",
      trackedCount: slateProps.length,
      gradedCount: graded.length,
    };
  }

  if (graded.length > 0 && pending > 0) {
    return {
      state: SLATE_LIFECYCLE_STATES.PARTIALLY_GRADED,
      slateDate: date,
      reason: "mixed_grades",
      trackedCount: slateProps.length,
      gradedCount: graded.length,
      pendingCount: pending,
    };
  }

  return {
    state: SLATE_LIFECYCLE_STATES.TRACKING_ACTIVE,
    slateDate: date,
    reason: locked ? "tracking_locked" : "tracking_open",
    trackedCount: slateProps.length,
    gradedCount: graded.length,
    pendingCount: pending,
    locked,
  };
}

export function buildSlateLifecycleMap(context = {}) {
  const slates = new Set();

  for (const prop of context.trackedProps || []) {
    if (prop.slateDate) slates.add(String(prop.slateDate));
  }
  for (const report of context.reports || []) {
    if (report.slateDate) slates.add(String(report.slateDate));
  }
  for (const archive of context.archives || []) {
    if (archive.slateDate) slates.add(String(archive.slateDate));
  }

  const map = {};
  for (const slateDate of [...slates].sort()) {
    map[slateDate] = resolveSlateLifecycleState(slateDate, context);
  }
  return map;
}

function collectStaleUnresolvedSlateDates(
  trackedProps = [],
  reports = [],
  today = getTodayLocalDate(),
  options = {}
) {
  const { activeResultsSlateDate = null, lockedSlates = [] } = options;
  const rotation = computeSlateRotation(reports);
  const historyDates = new Set(
    rotation.historySlates.map((report) => String(report.slateDate || ""))
  );
  const labDate = rotation.currentLabSlateDate;
  const staleDates = new Set();
  const lockedActiveDates = new Set(
    (lockedSlates || [])
      .filter(
        (entry) => String(entry.phase || "ACTIVE").toUpperCase() === "ACTIVE"
      )
      .map((entry) => String(entry.slateDate || ""))
      .filter(Boolean)
  );

  const propsBySlate = {};
  for (const prop of trackedProps) {
    const slateDate = String(prop.slateDate || "");
    if (!slateDate) continue;
    if (!propsBySlate[slateDate]) propsBySlate[slateDate] = [];
    propsBySlate[slateDate].push(prop);
  }

  for (const slateDate of Object.keys(propsBySlate)) {
    if (!isOnOrAfterCleanDataCutoff(slateDate)) continue;
    if (!isPastSlateDate(slateDate, today)) continue;
    if (activeResultsSlateDate && slateDate === activeResultsSlateDate) continue;
    if (lockedActiveDates.has(slateDate)) continue;
    if (labDate && slateDate === labDate) continue;
    if (historyDates.has(slateDate)) continue;

    const report = reports.find((item) => String(item.slateDate) === slateDate) || null;
    if (isCompletedSlate(report)) continue;

    const slateProps = propsBySlate[slateDate] || [];
    const allGraded =
      slateProps.length > 0 &&
      slateProps.every((prop) => isResolvedStatus(prop.status));
    if (allGraded) continue;

    staleDates.add(slateDate);
  }

  return staleDates;
}

function slateHasLabOrHistoryCoverage(slateDate, context = {}) {
  const { reports = [], archives = [] } = context;
  const rotation = computeSlateRotation(reports);
  const hasArchive =
    (archives || []).some(
      (entry) => String(entry.slateDate || "") === slateDate && entry.props?.length
    ) || getHistoryArchiveProps(slateDate).length > 0;
  const inLabRotation =
    rotation.currentLabSlateDate === slateDate ||
    rotation.historySlates.some((report) => String(report.slateDate || "") === slateDate);

  return hasArchive || inLabRotation;
}

function resolveTrackedPropLifecycleState(prop = {}, context = {}) {
  const {
    reports = [],
    archives = [],
    lockedSlates = [],
    today = getTodayLocalDate(),
    activeResultsSlateDate = null,
    slateLifecycleMap = {},
    staleUnresolvedSlateDates = new Set(),
    rotation = computeSlateRotation(reports),
  } = context;

  const slateDate = String(prop.slateDate || "");
  if (!slateDate) {
    return TRACKED_PROP_LIFECYCLE.QUARANTINED_LEGACY;
  }

  if (!isOnOrAfterCleanDataCutoff(slateDate)) {
    return TRACKED_PROP_LIFECYCLE.QUARANTINED_LEGACY;
  }

  if (rotation.currentLabSlateDate === slateDate) {
    return TRACKED_PROP_LIFECYCLE.LAB_CURRENT;
  }

  if (
    rotation.historySlates.some((report) => String(report.slateDate || "") === slateDate)
  ) {
    return TRACKED_PROP_LIFECYCLE.ARCHIVED_HISTORY;
  }

  if (prop.homeStaged === true && slateDate !== activeResultsSlateDate) {
    return TRACKED_PROP_LIFECYCLE.HOME_STAGED;
  }

  if (staleUnresolvedSlateDates.has(slateDate)) {
    return TRACKED_PROP_LIFECYCLE.STALE_UNRESOLVED;
  }

  const slateState = slateLifecycleMap[slateDate]?.state || null;

  if (
    slateState === SLATE_LIFECYCLE_STATES.TRACKING_ACTIVE ||
    slateState === SLATE_LIFECYCLE_STATES.PARTIALLY_GRADED
  ) {
    if (
      activeResultsSlateDate &&
      slateDate === activeResultsSlateDate &&
      isOfficialResultsProp(prop) &&
      prop.homeStaged !== true
    ) {
      return TRACKED_PROP_LIFECYCLE.ACTIVE_RESULTS;
    }
    if (isFutureSlateDate(slateDate, today) || prop.homeStaged === true) {
      return TRACKED_PROP_LIFECYCLE.HOME_STAGED;
    }
    return TRACKED_PROP_LIFECYCLE.STALE_UNRESOLVED;
  }

  if (slateState === SLATE_LIFECYCLE_STATES.LAB_CURRENT) {
    return TRACKED_PROP_LIFECYCLE.LAB_CURRENT;
  }

  if (slateState === SLATE_LIFECYCLE_STATES.ARCHIVED_HISTORY) {
    return TRACKED_PROP_LIFECYCLE.ARCHIVED_HISTORY;
  }

  if (slateState === SLATE_LIFECYCLE_STATES.READY_FOR_LAB) {
    if (slateHasLabOrHistoryCoverage(slateDate, { reports, archives })) {
      return TRACKED_PROP_LIFECYCLE.LEGACY_COMPLETED;
    }
    return TRACKED_PROP_LIFECYCLE.LEGACY_COMPLETED_NEEDS_ARCHIVE;
  }

  if (slateState === SLATE_LIFECYCLE_STATES.GENERATED_BOARD) {
    if (isPastSlateDate(slateDate, today)) {
      const report = reports.find((item) => String(item.slateDate) === slateDate) || null;
      if (isCompletedSlate(report)) {
        return slateHasLabOrHistoryCoverage(slateDate, { reports, archives })
          ? TRACKED_PROP_LIFECYCLE.LEGACY_COMPLETED
          : TRACKED_PROP_LIFECYCLE.LEGACY_COMPLETED_NEEDS_ARCHIVE;
      }
      return TRACKED_PROP_LIFECYCLE.STALE_UNRESOLVED;
    }
    if (isSlateLocked(slateDate)) {
      return TRACKED_PROP_LIFECYCLE.QUARANTINED_LEGACY;
    }
  }

  return TRACKED_PROP_LIFECYCLE.QUARANTINED_LEGACY;
}

/**
 * Classify all stored tracked props by lifecycle without mutating the store.
 * Default /tracked-props response uses activeResultsProps only.
 */
export function classifyTrackedPropsByLifecycle(trackedProps = [], context = {}) {
  const {
    reports = [],
    archives = [],
    lockedSlates = [],
    today = getTodayLocalDate(),
  } = context;

  const rotation = computeSlateRotation(reports);
  const slateLifecycleMap = buildSlateLifecycleMap({
    trackedProps,
    reports,
    archives,
    lockedSlates,
    today,
  });
  const activeResultsSlateDate = pickActiveResultsSlateDate(
    trackedProps,
    reports,
    today,
    lockedSlates
  );
  const staleUnresolvedSlateDates = collectStaleUnresolvedSlateDates(
    trackedProps,
    reports,
    today,
    { activeResultsSlateDate, lockedSlates }
  );

  const lifecycleContext = {
    reports,
    archives,
    lockedSlates,
    today,
    activeResultsSlateDate,
    slateLifecycleMap,
    staleUnresolvedSlateDates,
    rotation,
  };

  const categories = {
    activeResultsProps: [],
    labCurrentProps: [],
    archivedHistoryProps: [],
    legacyCompletedProps: [],
    staleUnresolvedProps: [],
    quarantinedLegacyProps: [],
    homeStagedProps: [],
  };
  const trackedCountsByLifecycleState = {};
  const trackedCountsBySlateDate = {};

  const bump = (map, key) => {
    map[key] = Number(map[key] || 0) + 1;
  };

  for (const prop of trackedProps) {
    const slateDate = String(prop.slateDate || "unknown");
    bump(trackedCountsBySlateDate, slateDate);

    const lifecycleState = resolveTrackedPropLifecycleState(prop, lifecycleContext);
    bump(trackedCountsByLifecycleState, lifecycleState);

    const tagged = { ...prop, trackedLifecycleState: lifecycleState };

    switch (lifecycleState) {
      case TRACKED_PROP_LIFECYCLE.ACTIVE_RESULTS:
        categories.activeResultsProps.push(tagged);
        break;
      case TRACKED_PROP_LIFECYCLE.LAB_CURRENT:
        categories.labCurrentProps.push(tagged);
        break;
      case TRACKED_PROP_LIFECYCLE.ARCHIVED_HISTORY:
        categories.archivedHistoryProps.push(tagged);
        break;
      case TRACKED_PROP_LIFECYCLE.LEGACY_COMPLETED:
      case TRACKED_PROP_LIFECYCLE.LEGACY_COMPLETED_NEEDS_ARCHIVE:
        categories.legacyCompletedProps.push(tagged);
        break;
      case TRACKED_PROP_LIFECYCLE.STALE_UNRESOLVED:
        categories.staleUnresolvedProps.push(tagged);
        break;
      case TRACKED_PROP_LIFECYCLE.HOME_STAGED:
        categories.homeStagedProps.push(tagged);
        break;
      default:
        categories.quarantinedLegacyProps.push(tagged);
        break;
    }
  }

  const activeWnba = categories.activeResultsProps.filter(
    (prop) => String(prop.league || "").toUpperCase() === "WNBA"
  ).length;
  const activeNba = categories.activeResultsProps.filter(
    (prop) => String(prop.league || "").toUpperCase() === "NBA"
  ).length;
  const activeResultsExcess =
    Math.max(0, activeWnba - BEST_SIX_LIMIT) + Math.max(0, activeNba - BEST_SIX_LIMIT);
  const storedLegacyCount =
    categories.legacyCompletedProps.length +
    categories.archivedHistoryProps.length +
    categories.labCurrentProps.length +
    categories.staleUnresolvedProps.length +
    categories.quarantinedLegacyProps.length +
    categories.homeStagedProps.length;
  const allStoredExceedCapButExcluded =
    storedLegacyCount > 0 &&
    activeResultsExcess === 0 &&
    trackedProps.length > BEST_SIX_LIMIT * 2;

  const historySlateDates = rotation.historySlates.map((report) =>
    String(report.slateDate || "")
  );

  return {
    ...categories,
    allStoredProps: trackedProps,
    trackedStoreTotalCount: trackedProps.length,
    activeResultsTrackedCount: categories.activeResultsProps.length,
    activeResultsWNBA: activeWnba,
    activeResultsNBA: activeNba,
    legacyStoredTrackedCount: categories.legacyCompletedProps.length,
    archivedHistoryTrackedCount: categories.archivedHistoryProps.length,
    labCurrentTrackedCount: categories.labCurrentProps.length,
    staleUnresolvedTrackedCount: categories.staleUnresolvedProps.length,
    quarantinedLegacyTrackedCount: categories.quarantinedLegacyProps.length,
    homeStagedTrackedCount: categories.homeStagedProps.length,
    trackedCountsBySlateDate,
    trackedCountsByLifecycleState,
    activeResultsSlateDate,
    currentLabSlateDate: rotation.currentLabSlateDate,
    historySlateDates,
    activeResultsCapStatus:
      activeResultsExcess > 0 ? "OVER_CAP" : categories.activeResultsProps.length > 0 ? "WITHIN_CAP" : "EMPTY",
    activeResultsWithinCap: activeResultsExcess === 0,
    activeResultsExcessCount: activeResultsExcess,
    allStoredPropsExceedCapButExcluded: allStoredExceedCapButExcluded,
    slateLifecycleMap,
    staleUnresolvedSlateDates: [...staleUnresolvedSlateDates],
  };
}

export function buildTrackedPropsLifecycleDiagnostics(classification = {}) {
  return {
    trackedStoreTotalCount: classification.trackedStoreTotalCount ?? 0,
    activeResultsTrackedCount: classification.activeResultsTrackedCount ?? 0,
    activeResultsWNBA: classification.activeResultsWNBA ?? 0,
    activeResultsNBA: classification.activeResultsNBA ?? 0,
    legacyStoredTrackedCount: classification.legacyStoredTrackedCount ?? 0,
    archivedHistoryTrackedCount: classification.archivedHistoryTrackedCount ?? 0,
    labCurrentTrackedCount: classification.labCurrentTrackedCount ?? 0,
    staleUnresolvedTrackedCount: classification.staleUnresolvedTrackedCount ?? 0,
    quarantinedLegacyTrackedCount: classification.quarantinedLegacyTrackedCount ?? 0,
    homeStagedTrackedCount: classification.homeStagedTrackedCount ?? 0,
    trackedCountsBySlateDate: classification.trackedCountsBySlateDate || {},
    trackedCountsByLifecycleState: classification.trackedCountsByLifecycleState || {},
    activeResultsSlateDate: classification.activeResultsSlateDate || null,
    currentLabSlateDate: classification.currentLabSlateDate || null,
    historySlateDates: classification.historySlateDates || [],
    trackedPropsReturnedMode: classification.trackedPropsReturnedMode || "active_results_only",
    activeResultsCapStatus: classification.activeResultsCapStatus || "EMPTY",
    activeResultsWithinCap: classification.activeResultsWithinCap ?? true,
    activeResultsExcessCount: classification.activeResultsExcessCount ?? 0,
    allStoredPropsExceedCapButExcluded:
      classification.allStoredPropsExceedCapButExcluded ?? false,
    staleUnresolvedSlateDates: classification.staleUnresolvedSlateDates || [],
  };
}
