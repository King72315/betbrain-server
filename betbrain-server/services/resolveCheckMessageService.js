import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
  isCompletedSlate,
  getReportPending,
} from "./slateScopeService.js";

export function formatSlateMessageDate(slateDate) {
  const value = String(slateDate || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return value || "unknown slate";
}

export function formatSlateMovedToLabMessage(slateDate) {
  return `${formatSlateMessageDate(slateDate)} slate has already been moved to Lab.`;
}

export function formatSlateArchivedMessage(slateDate) {
  return `${formatSlateMessageDate(slateDate)} slate archived to History.`;
}

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function getResultsPropSlateDate(prop = {}) {
  const direct = String(prop.slateDate || prop.gameDate || prop.date || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;
  return "unknown";
}

export function countNewlyGradedPropsOnSlate(afterProps = [], beforeProps = [], slateDate) {
  if (!slateDate) return 0;

  const beforeStatusByKey = new Map();
  for (const prop of beforeProps) {
    if (getResultsPropSlateDate(prop) !== slateDate) continue;
    const key = String(prop.id || prop.trackedId || prop.trackedKey || prop.player || "");
    beforeStatusByKey.set(key, String(prop.status || "pending").toLowerCase());
  }

  let count = 0;
  for (const prop of afterProps) {
    if (getResultsPropSlateDate(prop) !== slateDate) continue;
    const key = String(prop.id || prop.trackedId || prop.trackedKey || prop.player || "");
    const beforeStatus = beforeStatusByKey.get(key) || "pending";
    const afterStatus = String(prop.status || "pending").toLowerCase();
    const wasOpen = beforeStatus === "pending" || beforeStatus.includes("awaiting");
    if (wasOpen && isResolvedStatus(afterStatus)) count += 1;
  }

  return count;
}

function summarizeActiveSlateProps(props = [], slateDate) {
  const scoped = props.filter((prop) => getResultsPropSlateDate(prop) === slateDate);
  const pending = scoped.filter(
    (prop) => String(prop.status || "pending").toLowerCase() === "pending"
  ).length;
  const awaitingStats = scoped.filter((prop) => {
    const reason = String(prop.pendingReason || "").toLowerCase();
    return reason.includes("awaiting official player stat") || reason.includes("awaiting stats");
  }).length;
  const graded = scoped.filter((prop) => isResolvedStatus(prop.status)).length;

  return {
    total: scoped.length,
    pending,
    awaitingStats,
    graded,
  };
}

function isSlatePromotedToLab(slateDate, rotation, reports = []) {
  if (!slateDate || rotation?.currentLabSlateDate !== slateDate) return false;
  const reportList = reports || rotation?.allReports || [];
  const report = reportList.find((item) => String(item.slateDate) === slateDate) || null;
  return Boolean(report && isCompletedSlate(report) && getReportPending(report) === 0);
}

export function buildResolveCheckMessage({
  activeResultsSlateDate,
  beforeProps = [],
  afterProps = [],
  rotation = {},
  gradedCountForActiveSlate = 0,
  reports = [],
}) {
  const activeDate = activeResultsSlateDate || rotation.activeResultsSlateDate || null;
  const dateLabel = formatSlateMessageDate(activeDate);

  if (!activeDate) {
    return { message: "No active Results slate to check.", type: "info" };
  }

  const afterStats = summarizeActiveSlateProps(afterProps, activeDate);
  const beforeStats = summarizeActiveSlateProps(beforeProps, activeDate);
  const labDate = rotation.currentLabSlateDate;
  const hadActiveBefore = beforeStats.total > 0;
  const hasActiveAfter = afterStats.total > 0;

  if (
    labDate === activeDate &&
    hadActiveBefore &&
    !hasActiveAfter &&
    isSlatePromotedToLab(labDate, rotation, reports)
  ) {
    return { message: formatSlateMovedToLabMessage(labDate), type: "warning" };
  }

  if (gradedCountForActiveSlate > 0) {
    const openCount = afterStats.pending + afterStats.awaitingStats;
    const pendingSuffix = openCount > 0 ? `, ${openCount} still pending` : "";
    return {
      message: `${dateLabel} slate checked: ${gradedCountForActiveSlate} graded${pendingSuffix}.`,
      type: "success",
    };
  }

  const openCount = afterStats.pending + afterStats.awaitingStats;
  if (openCount > 0) {
    return {
      message: `${dateLabel} slate checked: 0 graded, ${openCount} still pending.`,
      type: "info",
    };
  }

  if (afterStats.total > 0 && openCount === 0) {
    return {
      message: `${dateLabel} slate checked: all ${afterStats.graded} props already graded.`,
      type: "info",
    };
  }

  return {
    message: `${dateLabel} slate: no new final scores yet.`,
    type: "info",
  };
}

export function buildScopedResolveSummary({
  beforeProps = [],
  afterProps = [],
  summary = {},
  reports = [],
  lockedSlates = [],
  archives = [],
  today = getTodayLocalDate(),
}) {
  const rotation = buildSlateRotationMetadata(reports, {
    trackedProps: afterProps,
    lockedSlates,
    archives,
    today,
  });
  const activeDate = rotation.activeResultsSlateDate;
  const activeSlateGradedCount = countNewlyGradedPropsOnSlate(
    afterProps,
    beforeProps,
    activeDate
  );
  const activeStats = summarizeActiveSlateProps(afterProps, activeDate);
  const checkStatus = buildResolveCheckMessage({
    activeResultsSlateDate: activeDate,
    beforeProps,
    afterProps,
    rotation,
    gradedCountForActiveSlate: activeSlateGradedCount,
    reports,
  });

  return {
    ...summary,
    activeResultsSlateDate: activeDate,
    activeSlateGradedCount,
    activeSlateChecked: activeStats.total,
    activeSlateStillPending: activeStats.pending + activeStats.awaitingStats,
    checkMessage: checkStatus.message,
    checkStatusType: checkStatus.type,
  };
}
