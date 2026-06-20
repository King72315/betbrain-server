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

  return isFinal && pending === 0 && graded > 0 && total > 0;
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

export function computeSlateRotation(
  reports: any[] = [],
  lockedSlates: any[] = []
): SlateRotation {
  const allReports = sortReportsByDateDesc(reports);
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
