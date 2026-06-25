/**
 * CourtEdge slate lifecycle state machine — explicit states per blueprint.
 */
import {
  computeSlateRotation,
  getTodayLocalDate,
  isCompletedSlate,
  isOnOrAfterCleanDataCutoff,
} from "./slateScopeService.js";
import { getHistoryArchiveProps, isSlateLocked } from "./slateLockService.js";

export const SLATE_LIFECYCLE_STATES = {
  GENERATED_BOARD: "GENERATED_BOARD",
  TRACKING_ACTIVE: "TRACKING_ACTIVE",
  PARTIALLY_GRADED: "PARTIALLY_GRADED",
  READY_FOR_LAB: "READY_FOR_LAB",
  LAB_CURRENT: "LAB_CURRENT",
  ARCHIVED_HISTORY: "ARCHIVED_HISTORY",
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
