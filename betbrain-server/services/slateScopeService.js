import { CONFIG } from "../config.js";

/** First slate date included in clean collectible Lab/History/report era. */
export const CLEAN_DATA_CUTOFF = "2026-06-19";

export function getTodayLocalDate(now = new Date()) {
  return now.toLocaleDateString("en-CA", {
    timeZone: CONFIG.TIMEZONE || "America/Chicago",
  });
}

export function isOnOrAfterCleanDataCutoff(slateDate) {
  const value = String(slateDate || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= CLEAN_DATA_CUTOFF;
}

export function isFutureSlateDate(slateDate, today = getTodayLocalDate()) {
  const value = String(slateDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value > today;
}

export function isPastSlateDate(slateDate, today = getTodayLocalDate()) {
  const value = String(slateDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value < today;
}

export function filterReportsOnOrAfterCutoff(reports = []) {
  return reports.filter((report) => isOnOrAfterCleanDataCutoff(report?.slateDate));
}

export function getReportSectionA(report) {
  return report?.sections?.A || report;
}

export function getReportStatus(report) {
  const sectionA = getReportSectionA(report);
  return String(
    report?.status || report?.reportStatus || sectionA?.reportStatus || ""
  ).toLowerCase();
}

export function getReportPending(report) {
  const sectionA = getReportSectionA(report);
  return Number(sectionA?.pending ?? report?.pending ?? 0);
}

export function getReportGraded(report) {
  const sectionA = getReportSectionA(report);
  return Number(sectionA?.graded ?? report?.graded ?? 0);
}

export function getReportTotalOfficial(report) {
  const sectionA = getReportSectionA(report);
  return Number(sectionA?.totalOfficialProps ?? report?.totalOfficialProps ?? 0);
}

export function getReportAwaitingStats(report) {
  const sectionA = getReportSectionA(report);
  return Number(
    sectionA?.awaitingStats ??
      report?.awaitingStats ??
      sectionA?.failed ??
      report?.failed ??
      0
  );
}

/** Completed performance slate: final status, zero pending, graded official props. */
export function isCompletedSlate(report) {
  if (!report?.slateDate) return false;

  const status = getReportStatus(report);
  const isFinal =
    status === "final" ||
    status === "completed" ||
    status === "complete" ||
    report?.frozen === true ||
    report?.locked === true;
  const pending = getReportPending(report);
  const graded = getReportGraded(report);
  const total = getReportTotalOfficial(report);
  const awaitingStats = getReportAwaitingStats(report);

  return (
    isFinal &&
    pending === 0 &&
    awaitingStats === 0 &&
    graded > 0 &&
    total > 0
  );
}

/** Exclude future, pre-cutoff, and phantom in-progress reports on read. */
export function isValidDailyReport(report, today = getTodayLocalDate()) {
  if (!report?.slateDate) return false;
  if (!isOnOrAfterCleanDataCutoff(report.slateDate)) return false;
  if (isFutureSlateDate(report.slateDate, today)) return false;

  const status = getReportStatus(report);
  const isFinal =
    status === "final" ||
    status === "completed" ||
    status === "complete" ||
    report?.frozen === true ||
    report?.locked === true;

  if (isFinal && !isCompletedSlate(report)) {
    return false;
  }

  if (!isFinal && isPastSlateDate(report.slateDate, today)) {
    return false;
  }

  return true;
}

export function filterValidDailyReports(reports = [], today = getTodayLocalDate()) {
  return filterReportsOnOrAfterCutoff(reports).filter((report) =>
    isValidDailyReport(report, today)
  );
}

export function filterCompletedDailyReports(reports = [], today = getTodayLocalDate()) {
  return filterValidDailyReports(reports, today).filter(isCompletedSlate);
}

function isResolvedPropStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

/** True when any prop is pending, awaiting stats, or graded before game final. */
export function hasUnresolvedGradingProps(props = []) {
  return props.some((prop) => {
    const status = String(prop.status || "").toLowerCase();
    const pendingReason = String(prop.pendingReason || "").toLowerCase();
    const resolveDebug = prop.resolveDebug || {};

    if (resolveDebug.blockedByGameNotFinal || resolveDebug.blockedByLiveGame) {
      return true;
    }

    if (pendingReason.includes("game not final yet")) {
      return true;
    }

    if (pendingReason.includes("awaiting official player stat")) {
      return true;
    }

    if (status === "pending") {
      return true;
    }

    if (isResolvedPropStatus(status)) {
      if (prop.actualStat == null || prop.result == null) {
        return true;
      }

      if (resolveDebug.gameFinal === false) {
        return true;
      }

      return false;
    }

    return true;
  });
}

function sortReportsByDateDesc(reports = []) {
  return [...reports].sort((a, b) =>
    String(b.slateDate || "").localeCompare(String(a.slateDate || ""))
  );
}

export function computeSlateRotation(reports = []) {
  const allReports = sortReportsByDateDesc(filterValidDailyReports(reports));
  const completed = allReports.filter(isCompletedSlate);
  const currentLabSlate = completed[0] || null;
  const currentLabSlateDate = currentLabSlate?.slateDate
    ? String(currentLabSlate.slateDate)
    : null;

  const historySlates = completed.filter(
    (report) => String(report.slateDate) !== currentLabSlateDate
  );

  const activeResults = allReports.filter((report) => !isCompletedSlate(report));

  return {
    currentLabSlate,
    currentLabSlateDate,
    historySlates,
    activeResults,
    allReports,
  };
}

/** Today's slate date when tracked props exist for today (America/Chicago). */
export function pickActiveResultsSlateDate(
  trackedProps = [],
  _reports = [],
  today = getTodayLocalDate()
) {
  const hasTodayProps = trackedProps.some((prop) => {
    const slateDate = String(prop.slateDate || "");
    return slateDate === today && isOnOrAfterCleanDataCutoff(slateDate);
  });

  return hasTodayProps ? today : null;
}

function isDirtyLegacyGrade(prop = {}) {
  const status = String(prop.status || "").toLowerCase();
  const resolveDebug = prop.resolveDebug || {};
  return isResolvedPropStatus(status) && resolveDebug.gameFinal !== true;
}

function collectStaleUnresolvedBySlate(trackedProps = [], reports = [], today = getTodayLocalDate()) {
  const rotation = computeSlateRotation(reports);
  const historyDates = new Set(
    rotation.historySlates.map((report) => String(report.slateDate || ""))
  );
  const labDate = rotation.currentLabSlateDate;
  const staleBySlate = {};

  for (const prop of trackedProps) {
    const slateDate = String(prop.slateDate || "");
    if (!isOnOrAfterCleanDataCutoff(slateDate)) continue;
    if (!isPastSlateDate(slateDate, today)) continue;
    if (labDate && slateDate === labDate) continue;
    if (historyDates.has(slateDate)) continue;

    const report = reports.find((item) => String(item.slateDate) === slateDate) || null;
    if (isCompletedSlate(report)) continue;

    if (!staleBySlate[slateDate]) staleBySlate[slateDate] = [];
    staleBySlate[slateDate].push(prop);
  }

  return staleBySlate;
}

export function countIgnoredPreCutoffReports(reports = []) {
  return (reports || []).filter(
    (report) => report?.slateDate && !isOnOrAfterCleanDataCutoff(report.slateDate)
  ).length;
}

export function buildCourtEdgeFlowDiagnostics(
  trackedProps = [],
  rawReports = [],
  archives = [],
  today = getTodayLocalDate()
) {
  const ignoredPreCutoffReportCount = countIgnoredPreCutoffReports(rawReports);
  const validCleanReports = filterValidDailyReports(rawReports, today);
  const completedCleanReports = filterCompletedDailyReports(rawReports, today);
  const rotation = computeSlateRotation(rawReports);
  const activeResultsSlateDate = pickActiveResultsSlateDate(
    trackedProps,
    rawReports,
    today
  );

  const staleBySlate = collectStaleUnresolvedBySlate(trackedProps, rawReports, today);
  const staleUnresolvedSlates = Object.keys(staleBySlate).sort();
  const staleProps = staleUnresolvedSlates.flatMap((slateDate) => staleBySlate[slateDate]);
  const staleUnresolvedCount = staleProps.length;
  const staleDirtyGradeCount = staleProps.filter(isDirtyLegacyGrade).length;
  const stalePendingCount = staleProps.filter(
    (prop) => String(prop.status || "pending").toLowerCase() === "pending"
  ).length;

  let dirtyLegacyGradeCount = 0;
  let legacyResolvedWithoutGameFinalCount = 0;
  let officialLineNullCount = 0;
  let legacyOfficialLineNullCount = 0;
  let todaysTrackedCount = 0;
  let todaysOfficialLineNullCount = 0;
  let todaysMissingLineCount = 0;
  let todaysMissingGameIdCount = 0;
  let todaysMissingCommenceTimeCount = 0;
  let todaysPendingCount = 0;
  let todaysGradedCount = 0;
  let todaysAwaitingStatsCount = 0;

  for (const prop of trackedProps) {
    const slateDate = String(prop.slateDate || "");
    const officialLineMissing =
      prop.officialLine === undefined || prop.officialLine === null;

    if (officialLineMissing) {
      officialLineNullCount += 1;
      if (slateDate !== today) {
        legacyOfficialLineNullCount += 1;
      }
    }

    if (slateDate === today) {
      todaysTrackedCount += 1;
      if (officialLineMissing) todaysOfficialLineNullCount += 1;

      const line = prop.line ?? prop.currentLine ?? prop.latestLine ?? prop.pickLine;
      if (line === undefined || line === null || line === "") {
        todaysMissingLineCount += 1;
      }
      if (!String(prop.gameId || "").trim()) {
        todaysMissingGameIdCount += 1;
      }
      if (!String(prop.commenceTime || "").trim()) {
        todaysMissingCommenceTimeCount += 1;
      }

      const status = String(prop.status || "pending").toLowerCase();
      if (["win", "loss", "push"].includes(status)) {
        todaysGradedCount += 1;
      } else {
        todaysPendingCount += 1;
      }

      const resolveDebug = prop.resolveDebug || {};
      const pendingReason = String(prop.pendingReason || "").toLowerCase();
      if (
        resolveDebug.gameFinal === true ||
        pendingReason.includes("awaiting official player stat")
      ) {
        todaysAwaitingStatsCount += 1;
      }
    }

    if (isDirtyLegacyGrade(prop)) {
      dirtyLegacyGradeCount += 1;
      legacyResolvedWithoutGameFinalCount += 1;
    }
  }

  const pendingBySlate = {};
  const awaitingStatsBySlate = {};
  let futureTrackedCount = 0;
  let liveGameGrades = 0;

  for (const prop of trackedProps) {
    const slateDate = String(prop.slateDate || "");
    if (!slateDate) continue;

    if (isFutureSlateDate(slateDate, today)) {
      futureTrackedCount += 1;
      continue;
    }

    const status = String(prop.status || "pending").toLowerCase();
    const resolveDebug = prop.resolveDebug || {};
    const pendingReason = String(prop.pendingReason || "").toLowerCase();

    if (["win", "loss", "push"].includes(status) && resolveDebug.gameFinal === false) {
      liveGameGrades += 1;
    }

    if (status === "pending" || (status !== "win" && status !== "loss" && status !== "push")) {
      pendingBySlate[slateDate] = (pendingBySlate[slateDate] || 0) + 1;
    }

    const awaitingStats =
      resolveDebug.gameFinal === true ||
      pendingReason.includes("awaiting official player stat");

    if (awaitingStats) {
      awaitingStatsBySlate[slateDate] =
        (awaitingStatsBySlate[slateDate] || 0) + 1;
    }
  }

  return {
    todayLocalDate: today,
    cleanDataCutoff: CLEAN_DATA_CUTOFF,
    resultsRule: "today_only",
    rawReportCount: (rawReports || []).length,
    validCleanReportCount: validCleanReports.length,
    completedCleanReportCount: completedCleanReports.length,
    ignoredPreCutoffReportCount,
    activeResultsSlateDate,
    priorSlateStillActive: false,
    staleUnresolvedSlates,
    staleUnresolvedCount,
    staleDirtyGradeCount,
    stalePendingCount,
    staleCleanupNeeded: staleUnresolvedCount > 0,
    dirtyLegacyGradeCount,
    legacyResolvedWithoutGameFinalCount,
    officialLineNullCount,
    totalOfficialLineNullCount: officialLineNullCount,
    legacyOfficialLineNullCount,
    todaysTrackedCount,
    todaysOfficialLineNullCount,
    todaysMissingLineCount,
    todaysMissingGameIdCount,
    todaysMissingCommenceTimeCount,
    todaysPendingCount,
    todaysGradedCount,
    todaysAwaitingStatsCount,
    currentLabSlateDate: rotation.currentLabSlateDate,
    historySlateCount: rotation.historySlates.length,
    futureTrackedCount,
    pendingBySlate,
    awaitingStatsBySlate,
    liveGameGrades,
    analyticsScopeCount: null,
    completedReportCount: completedCleanReports.length,
    inProgressReportCount: rotation.activeResults.length,
  };
}
