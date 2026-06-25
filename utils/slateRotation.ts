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
  const official = Number(
    sectionA?.totalOfficialProps ?? report?.totalOfficialProps ?? 0
  );
  const tracked = Number(
    sectionA?.totalTrackedProps ?? report?.totalTrackedProps ?? 0
  );
  return official > 0 ? official : tracked;
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
  historySlateDates: string[];
  activeResults: any[];
  activeResultsSlateDate: string | null;
  activeInProgressSlateDates: string[];
  allReports: any[];
  lockedSlates: any[];
  viewedSlateDate: string | null;
  viewingHistorical: boolean;
  quarantinedLegacySlateDates: string[];
  inferredCompletedSlateDates: string[];
};

export type SlateRotationOptions = {
  lockedSlates?: any[];
  archives?: any[];
  trackedProps?: any[];
  today?: string;
  viewedSlateDate?: string | null;
};

function normalizeRotationOptions(
  optionsOrLockedSlates: SlateRotationOptions | any[] = {}
): SlateRotationOptions {
  if (Array.isArray(optionsOrLockedSlates)) {
    return { lockedSlates: optionsOrLockedSlates };
  }
  return optionsOrLockedSlates || {};
}

function isResolvedPropStatus(status = ""): boolean {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function getArchivedHistoryDates(archives: any[] = []) {
  return new Set(
    archives
      .filter(
        (entry) =>
          String(entry.phase || "").toUpperCase() === "ARCHIVED" &&
          entry.slateDate &&
          (entry.props?.length || entry.report)
      )
      .map((entry) => String(entry.slateDate))
  );
}

function getQuarantinedLegacySlateDates(reports: any[] = [], trackedProps: any[] = []) {
  const dates = new Set<string>();
  for (const report of reports) {
    const slateDate = String(report?.slateDate || "");
    if (slateDate && !isOnOrAfterCleanDataCutoff(slateDate)) dates.add(slateDate);
  }
  for (const prop of trackedProps) {
    const slateDate = String(prop?.slateDate || "");
    if (slateDate && !isOnOrAfterCleanDataCutoff(slateDate)) dates.add(slateDate);
  }
  return [...dates].sort();
}

function isOfficialTrackingProp(prop: any = {}) {
  const trackingType = String(prop.trackingType || prop.recordType || "").toUpperCase();
  if (trackingType === "TEST") return false;
  if (prop.excludedFromOfficialRecord === true) return false;
  return true;
}

function isAwaitingStatsPendingReason(pendingReason = "") {
  const reason = String(pendingReason || "").toLowerCase();
  return (
    reason.includes("awaiting official player stat") ||
    reason.includes("final player stats unavailable from source") ||
    reason.includes("game final, awaiting official player stat")
  );
}

function isPropBlockingLabInference(prop: any = {}) {
  const status = String(prop.status || "").toLowerCase();
  if (isResolvedPropStatus(status)) return false;

  const pendingReason = String(prop.pendingReason || "");
  const resolveDebug = prop.resolveDebug || {};

  if (isAwaitingStatsPendingReason(pendingReason)) {
    return false;
  }

  if (resolveDebug.gameFinal === true) {
    return false;
  }

  return true;
}

function inferCompletedReportsFromTrackedProps(
  trackedProps: any[] = [],
  reports: any[] = [],
  today: string = getTodayLocalDate()
) {
  const propsBySlate: Record<string, any[]> = {};

  for (const prop of trackedProps) {
    const slateDate = String(prop.slateDate || "");
    if (!slateDate) continue;
    if (!isOnOrAfterCleanDataCutoff(slateDate)) continue;
    if (isFutureSlateDate(slateDate, today)) continue;
    if (!propsBySlate[slateDate]) propsBySlate[slateDate] = [];
    propsBySlate[slateDate].push(prop);
  }

  const inferred: any[] = [];

  for (const slateDate of Object.keys(propsBySlate).sort()) {
    const existing = reports.find((item) => String(item.slateDate || "") === slateDate);
    if (isCompletedSlate(existing)) continue;

    const slateProps = propsBySlate[slateDate] || [];
    if (!slateProps.length) continue;

    const blockingProps = slateProps.filter(isPropBlockingLabInference);
    if (blockingProps.length > 0) continue;

    const graded = slateProps.filter((prop) =>
      isResolvedPropStatus(String(prop.status || ""))
    );
    if (!graded.length) continue;

    inferred.push({
      slateDate,
      status: "final",
      reportStatus: "final",
      frozen: true,
      inferredFromTrackedProps: true,
      sections: {
        A: {
          slateDate,
          reportStatus: "final",
          pending: 0,
          awaitingStats: 0,
          graded: graded.length,
          totalOfficialProps: slateProps.length,
          wins: graded.filter((p) => String(p.status).toLowerCase() === "win").length,
          losses: graded.filter((p) => String(p.status).toLowerCase() === "loss").length,
          pushes: graded.filter((p) => String(p.status).toLowerCase() === "push").length,
        },
      },
    });
  }

  return inferred;
}

function mergeCompletedReports(reports: any[] = [], inferredReports: any[] = []) {
  const byDate = new Map<string, any>();

  for (const report of reports) {
    if (!isCompletedSlate(report)) continue;
    byDate.set(String(report.slateDate || ""), report);
  }

  for (const report of inferredReports) {
    const slateDate = String(report.slateDate || "");
    if (!slateDate || byDate.has(slateDate)) continue;
    byDate.set(slateDate, report);
  }

  return sortReportsByDateDesc([...byDate.values()]);
}

export function computeSlateRotation(
  reports: any[] = [],
  optionsOrLockedSlates: SlateRotationOptions | any[] = {}
): SlateRotation {
  const options = normalizeRotationOptions(optionsOrLockedSlates);
  const {
    lockedSlates = [],
    archives = [],
    trackedProps = [],
    today = getTodayLocalDate(),
    viewedSlateDate = null,
  } = options;

  const archivedHistoryDates = getArchivedHistoryDates(archives);
  const activeResultsSlateDate = pickActiveResultsSlateDate(
    trackedProps,
    reports,
    today,
    lockedSlates
  );

  const validReports = sortReportsByDateDesc(filterValidDailyReports(reports, today));
  const inferredCompleted = inferCompletedReportsFromTrackedProps(
    trackedProps,
    reports,
    today
  );
  const completed = mergeCompletedReports(validReports, inferredCompleted);

  const labCandidates = completed.filter((report) => {
    const slateDate = String(report.slateDate || "");
    if (!slateDate) return false;
    if (archivedHistoryDates.has(slateDate)) return false;
    if (activeResultsSlateDate && slateDate === activeResultsSlateDate) return false;
    return true;
  });

  const currentLabSlate = labCandidates[0] || null;
  const currentLabSlateDate = currentLabSlate?.slateDate
    ? String(currentLabSlate.slateDate)
    : null;

  const historyFromCompleted = labCandidates.filter(
    (report) => String(report.slateDate) !== currentLabSlateDate
  );
  const historyFromArchives = archives
    .filter(
      (entry) =>
        archivedHistoryDates.has(String(entry.slateDate || "")) &&
        String(entry.slateDate || "") !== currentLabSlateDate
    )
    .map((entry) => {
      const report = entry.report || {};
      return {
        ...report,
        slateDate: String(entry.slateDate || report.slateDate || ""),
        archivedPhase: "ARCHIVED",
      };
    });

  const historyByDate = new Map<string, any>();
  for (const report of [...historyFromCompleted, ...historyFromArchives]) {
    const slateDate = String(report.slateDate || "");
    if (!slateDate || slateDate === currentLabSlateDate) continue;
    if (!historyByDate.has(slateDate)) historyByDate.set(slateDate, report);
  }
  const historySlates = sortReportsByDateDesc([...historyByDate.values()]);

  const activeResults = validReports.filter((report) => {
    const slateDate = String(report.slateDate || "");
    if (activeResultsSlateDate && slateDate === activeResultsSlateDate) return true;
    return !isCompletedSlate(report);
  });

  const activeInProgressSlateDates = [
    ...new Set(
      activeResults.map((report) => String(report.slateDate || "")).filter(Boolean)
    ),
  ];
  if (
    activeResultsSlateDate &&
    !activeInProgressSlateDates.includes(activeResultsSlateDate)
  ) {
    activeInProgressSlateDates.push(activeResultsSlateDate);
  }
  activeInProgressSlateDates.sort();

  const historySlateDates = [
    ...new Set([
      ...archivedHistoryDates,
      ...historySlates.map((report) => String(report.slateDate || "")),
    ]),
  ]
    .filter((slateDate) => slateDate && slateDate !== currentLabSlateDate)
    .sort()
    .reverse();

  const viewed = viewedSlateDate ? String(viewedSlateDate) : currentLabSlateDate;

  return {
    currentLabSlate,
    currentLabSlateDate,
    historySlates,
    historySlateDates,
    activeResults,
    activeResultsSlateDate,
    activeInProgressSlateDates,
    allReports: validReports,
    lockedSlates,
    viewedSlateDate: viewed,
    viewingHistorical: Boolean(
      viewed && currentLabSlateDate && viewed !== currentLabSlateDate
    ),
    quarantinedLegacySlateDates: getQuarantinedLegacySlateDates(reports, trackedProps),
    inferredCompletedSlateDates: inferredCompleted.map((report) =>
      String(report.slateDate || "")
    ),
  };
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

export function pickActiveResultsSlateDate(
  trackedProps: any[] = [],
  reports: any[] = [],
  today: string = getTodayLocalDate(),
  lockedSlates: any[] = []
): string | null {
  const blockingSlate = getBlockingActiveResultsSlateDate(
    trackedProps,
    lockedSlates,
    reports,
    today
  );
  if (blockingSlate) return blockingSlate;

  const hasTodayProps = trackedProps.some((prop) => {
    const slateDate = String(prop.slateDate || "");
    return (
      slateDate === today &&
      isOnOrAfterCleanDataCutoff(slateDate) &&
      prop.homeStaged !== true &&
      isOfficialTrackingProp(prop)
    );
  });

  return hasTodayProps ? today : null;
}
