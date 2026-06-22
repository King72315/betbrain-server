/** First slate date included in clean collectible Lab/History/report era. */
export const CLEAN_DATA_CUTOFF = "2026-06-19";

export const CT_TIMEZONE = "America/Chicago";

export function getTodayLocalDate(now: Date = new Date()): string {
  return now.toLocaleDateString("en-CA", { timeZone: CT_TIMEZONE });
}

export function isOnOrAfterCleanDataCutoff(slateDate: string | null | undefined): boolean {
  const value = String(slateDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value >= CLEAN_DATA_CUTOFF;
}

export function isFutureSlateDate(
  slateDate: string | null | undefined,
  today: string = getTodayLocalDate()
): boolean {
  const value = String(slateDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value > today;
}

export function isPastSlateDate(
  slateDate: string | null | undefined,
  today: string = getTodayLocalDate()
): boolean {
  const value = String(slateDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value < today;
}

export function filterReportsOnOrAfterCutoff(reports: any[] = []): any[] {
  return reports.filter((report) => isOnOrAfterCleanDataCutoff(report?.slateDate));
}

/** Valid completed daily reports — excludes future, pre-cutoff, phantom/incomplete finals. */
export function isValidDailyReport(
  report: any,
  today: string = getTodayLocalDate()
): boolean {
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

  if (isFinal && !isCompletedSlate(report)) return false;
  if (!isFinal && isPastSlateDate(report.slateDate, today)) return false;

  return true;
}

export function filterValidDailyReports(
  reports: any[] = [],
  today: string = getTodayLocalDate()
): any[] {
  return filterReportsOnOrAfterCutoff(reports).filter((report) =>
    isValidDailyReport(report, today)
  );
}

export function filterCompletedDailyReports(
  reports: any[] = [],
  today: string = getTodayLocalDate()
): any[] {
  return filterValidDailyReports(reports, today).filter(isCompletedSlate);
}

export type SlateRotation = {
  currentLabSlate: any | null;
  currentLabSlateDate: string | null;
  historySlates: any[];
  activeResults: any[];
  allReports: any[];
  lockedSlates: any[];
};

export function getReportSectionA(report: any) {
  return report?.sections?.A || report;
}

export function getReportStatus(report: any): string {
  const sectionA = getReportSectionA(report);
  return String(
    report?.status || report?.reportStatus || sectionA?.reportStatus || ""
  ).toLowerCase();
}

export function getReportPending(report: any): number {
  const sectionA = getReportSectionA(report);
  return Number(sectionA?.pending ?? report?.pending ?? 0);
}

export function getReportGraded(report: any): number {
  const sectionA = getReportSectionA(report);
  return Number(sectionA?.graded ?? report?.graded ?? 0);
}

export function getReportTotalOfficial(report: any): number {
  const sectionA = getReportSectionA(report);
  return Number(sectionA?.totalOfficialProps ?? report?.totalOfficialProps ?? 0);
}

/** Completed performance slate: final status, zero pending, graded official props. */
export function isCompletedSlate(report: any): boolean {
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
  const awaitingStats = Number(
    report?.sections?.A?.awaitingStats ??
      report?.awaitingStats ??
      report?.sections?.A?.failed ??
      0
  );

  return (
    isFinal &&
    pending === 0 &&
    awaitingStats === 0 &&
    graded > 0 &&
    total > 0
  );
}

export function isPropUnresolvedForGrading(prop: any): boolean {
  const status = String(prop?.status || "").toLowerCase();

  if (status === "win" || status === "loss" || status === "push") {
    return prop.actualStat == null || prop.result == null;
  }

  return true;
}

export function slateHasUnresolvedProps(props: any[] = []): boolean {
  return props.some(isPropUnresolvedForGrading);
}

export function isLockedSlateEntry(entry: any): boolean {
  if (!entry?.slateDate) return false;
  const phase = String(entry.phase || "").toUpperCase();
  return phase === "ACTIVE" || phase === "LAB" || entry.lockedAt;
}

export function getLockedSlatePhase(entry: any): string {
  return String(entry?.phase || "ACTIVE").toUpperCase();
}

export function sortReportsByDateDesc(reports: any[]) {
  return [...reports].sort((a, b) =>
    String(b.slateDate || "").localeCompare(String(a.slateDate || ""))
  );
}

export const PRIOR_SLATE_STILL_ACTIVE_LABEL =
  "Still resolving prior slate. Newer slate remains on board until this slate closes.";

/** True when the active Results slate is before today (prior slate still open). */
export function isPriorSlateStillActive(
  activeSlateDate: string | null | undefined,
  today: string = getTodayLocalDate()
): boolean {
  const value = String(activeSlateDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value < today;
}

function isResolvedPropStatus(status = ""): boolean {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

/** True when any prop is pending, awaiting stats, or graded before game final. */
export function hasUnresolvedGradingProps(props: any[] = []): boolean {
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

/** Locked ACTIVE slates that still need grading (oldest first). */
export function getActiveLockedUnresolvedSlateDates(
  trackedProps: any[] = [],
  lockedSlates: any[] = [],
  reports: any[] = [],
  today: string = getTodayLocalDate()
): string[] {
  const propsBySlate: Record<string, any[]> = {};

  for (const prop of trackedProps) {
    const slateDate = String(prop.slateDate || "");
    if (!isOnOrAfterCleanDataCutoff(slateDate)) continue;
    if (isFutureSlateDate(slateDate, today)) continue;
    if (!propsBySlate[slateDate]) propsBySlate[slateDate] = [];
    propsBySlate[slateDate].push(prop);
  }

  const lockedActiveDates = (lockedSlates || [])
    .filter((entry) => {
      const phase = getLockedSlatePhase(entry);
      return phase === "ACTIVE" && isOnOrAfterCleanDataCutoff(entry.slateDate);
    })
    .map((entry) => String(entry.slateDate || ""))
    .filter(Boolean)
    .sort();

  return lockedActiveDates.filter((slateDate) => {
    const report = reports.find((item) => String(item.slateDate) === slateDate) || null;
    if (isCompletedSlate(report)) return false;

    const props = propsBySlate[slateDate] || [];
    if (!props.length) return true;
    return hasUnresolvedGradingProps(props);
  });
}

export function getBlockingActiveResultsSlateDate(
  trackedProps: any[] = [],
  lockedSlates: any[] = [],
  reports: any[] = [],
  today: string = getTodayLocalDate()
): string | null {
  const unresolved = getActiveLockedUnresolvedSlateDates(
    trackedProps,
    lockedSlates,
    reports,
    today
  );
  return unresolved[0] || null;
}

export function computeSlateRotation(
  reports: any[] = [],
  lockedSlates: any[] = []
): SlateRotation {
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
    lockedSlates: lockedSlates || [],
  };
}
