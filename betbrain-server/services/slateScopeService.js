import { CONFIG } from "../config.js";
import { getSlateLockEntry, isSlateLocked } from "./slateLockService.js";
import { applyMonotonicLabPointer } from "./lifecyclePointerStateService.js";
import {
  isBestSixDisplayResultsProp,
  isOfficialResultsProp,
} from "./trackedPropService.js";
import { ensureHomeDetailedAnalysisOnPicks } from "./courtEdgeHomeDetailedAnalysisV1.js";
import { applyHomeDisplayWhyToPick } from "../engines/topProps/homeReasonTextV1.js";
/** First slate date included in clean collectible Lab/History/report era. */
export const CLEAN_DATA_CUTOFF = "2026-06-19";

export const QUARANTINE_REASONS = {
  INCOMPLETE_PROD_DATA: "INCOMPLETE_PROD_DATA",
  LAB_WIPED_NO_RESTORE: "LAB_WIPED_NO_RESTORE",
};

/** Legacy Lab dates blocked from mode=lab restore after wipe (prevents re-stick). */
export const BLOCKED_LAB_RESTORE_DATES = ["2026-06-21"];

/** Slates excluded from Lab, History, and win-rate rollups (bad/incomplete prod data). */
export const DEFAULT_QUARANTINED_SLATE_DATES = ["2026-06-24"];

export const DEFAULT_QUARANTINE_REASON_BY_DATE = {
  "2026-06-24": QUARANTINE_REASONS.INCOMPLETE_PROD_DATA,
};

export function normalizeQuarantinedSlates(quarantinedSlates = []) {
  const dates = new Set(DEFAULT_QUARANTINED_SLATE_DATES);
  const reasons = { ...DEFAULT_QUARANTINE_REASON_BY_DATE };

  for (const entry of quarantinedSlates || []) {
    if (typeof entry === "string") {
      dates.add(entry);
      continue;
    }
    const slateDate = String(entry?.slateDate || "");
    if (!slateDate) continue;
    dates.add(slateDate);
    if (entry.reason) {
      reasons[slateDate] = String(entry.reason);
    }
  }

  return {
    dates: [...dates].sort(),
    reasons,
  };
}

export function getQuarantinedSlateDatesSet(quarantinedSlates = []) {
  return new Set(normalizeQuarantinedSlates(quarantinedSlates).dates);
}

export function isQuarantinedSlateDate(slateDate, quarantinedSlates = []) {
  const value = String(slateDate || "");
  if (!value) return false;
  return getQuarantinedSlateDatesSet(quarantinedSlates).has(value);
}

export function filterOutQuarantinedReports(reports = [], quarantinedSlates = []) {
  const excluded = getQuarantinedSlateDatesSet(quarantinedSlates);
  return (reports || []).filter(
    (report) => !excluded.has(String(report?.slateDate || ""))
  );
}

export function getTodayLocalDate(now = new Date()) {
  return now.toLocaleDateString("en-CA", {
    timeZone: CONFIG.TIMEZONE || "America/Chicago",
  });
}

const CT_TIMEZONE = CONFIG.TIMEZONE || "America/Chicago";

function getSlateDateFromCommence(commenceTime = "") {
  const source = commenceTime || "";
  if (!source) return "";

  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    return String(source).slice(0, 10);
  }

  return parsed.toLocaleDateString("en-CA", { timeZone: CT_TIMEZONE });
}

/** Canonical Results cohort date for a tracked prop (matches client resultsQueue). */
export function getResultsPropSlateDate(prop = {}) {
  const cohortSlate = prop.resultsSlateDate || prop.cohortSlateDate;
  if (cohortSlate) {
    const value = String(cohortSlate).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  }

  const direct = String(prop.slateDate || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;

  return getSlateDateFromCommence(prop.commenceTime || prop.time);
}

/** Best 6 display + official Results cohort membership (shared server/client filter). */
export function isResultsCohortProp(prop = {}) {
  if (isOfficialResultsProp(prop)) return true;
  return isBestSixDisplayResultsProp(prop);
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

/** Calendar yesterday in America/Chicago (noon UTC avoids DST edge cases). */
export function getYesterdayLocalDate(today = getTodayLocalDate()) {
  const value = String(today || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}

/** Calendar tomorrow in America/Chicago (noon UTC avoids DST edge cases). */
export function getTomorrowLocalDate(today = getTodayLocalDate()) {
  const value = String(today || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  const anchor = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  anchor.setUTCDate(anchor.getUTCDate() + 1);
  return anchor.toISOString().slice(0, 10);
}

/**
 * Effective Home/board slate date for day-bucket classification.
 * Prefer explicit slateDate / officialPropId date prefix; else commenceTime in CT.
 * Does not invent dates — returns "" when unknown.
 */
export function resolveHomeBoardSlateDate(entity = {}) {
  const direct = String(
    entity.slateDate || entity.cohortSlateDate || entity.resultsSlateDate || ""
  ).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct;

  const officialId = String(entity.officialPropId || "");
  const idDate = officialId.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(idDate) && officialId.charAt(10) === "|") {
    return idDate;
  }

  const fromCommence = getSlateDateFromCommence(
    entity.commenceTime || entity.time || entity.gameDateTime || ""
  );
  if (/^\d{4}-\d{2}-\d{2}$/.test(fromCommence)) return fromCommence;

  const gameDate = String(entity.date || entity.gameDate || "").slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(gameDate)) return gameDate;

  return "";
}

/** Classify TODAY / TOMORROW / PAST from a CT slate date vs calendar today. */
export function classifyHomeDayBucket(slateDate, today = getTodayLocalDate()) {
  const d = String(slateDate || "").slice(0, 10);
  const t = String(today || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return "";
  }
  if (d === t) return "TODAY";
  if (d === getTomorrowLocalDate(t)) return "TOMORROW";
  if (d < t) return "PAST";
  return "LATER";
}

/** Only today/yesterday locked ACTIVE slates block Results rollover. */
export function isRolloverBlockingResultsSlate(
  slateDate,
  today = getTodayLocalDate()
) {
  const blocking = String(slateDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(blocking)) return false;
  if (blocking > today) return false;
  if (blocking === today) return true;
  return blocking === getYesterdayLocalDate(today);
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
  const official = Number(
    sectionA?.totalOfficialProps ?? report?.totalOfficialProps ?? 0
  );
  const tracked = Number(
    sectionA?.totalTrackedProps ?? report?.totalTrackedProps ?? 0
  );
  return official > 0 ? official : tracked;
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

    // Once W/L/P is stored, the prop is resolved for lifecycle — do not keep
    // blocking Lab/report completion on stale pre-grade finalization flags.
    if (isResolvedPropStatus(status)) {
      if (prop.actualStat == null && prop.actualPoints == null && prop.result == null) {
        return true;
      }
      return false;
    }

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

    return !isResolvedPropStatus(status);
  });
}

function sortReportsByDateDesc(reports = []) {
  return [...reports].sort((a, b) =>
    String(b.slateDate || "").localeCompare(String(a.slateDate || ""))
  );
}

/** Locked ACTIVE slates that still need grading (oldest first). */
export function getActiveLockedUnresolvedSlateDates(
  trackedProps = [],
  lockedSlates = [],
  reports = [],
  today = getTodayLocalDate()
) {
  const propsBySlate = {};

  for (const prop of trackedProps) {
    const slateDate = getResultsPropSlateDate(prop);
    if (!isOnOrAfterCleanDataCutoff(slateDate)) continue;
    if (isFutureSlateDate(slateDate, today)) continue;
    if (!isResultsCohortProp(prop)) continue;
    if (!propsBySlate[slateDate]) propsBySlate[slateDate] = [];
    propsBySlate[slateDate].push(prop);
  }

  const lockedActiveDates = (lockedSlates || [])
    .filter((entry) => {
      const phase = String(entry.phase || "ACTIVE").toUpperCase();
      return phase === "ACTIVE" && isOnOrAfterCleanDataCutoff(entry.slateDate);
    })
    .map((entry) => String(entry.slateDate || ""))
    .filter(Boolean)
    .sort();

  return lockedActiveDates.filter((slateDate) => {
    const report =
      reports.find((item) => String(item.slateDate) === slateDate) || null;
    if (isCompletedSlate(report)) return false;

    const props = propsBySlate[slateDate] || [];
    if (!props.length) return true;
    return hasUnresolvedGradingProps(props);
  });
}

/** Prior slates with unresolved Best 6 / official props — safety net when auto-lock missed. */
export function getUnresolvedPriorCohortSlateDates(
  trackedProps = [],
  reports = [],
  lockedSlates = [],
  today = getTodayLocalDate()
) {
  const lockedDates = new Set(
    (lockedSlates || []).map((entry) => String(entry.slateDate || "")).filter(Boolean)
  );
  const propsBySlate = {};

  for (const prop of trackedProps) {
    if (prop.homeStaged === true) continue;
    const slateDate = getResultsPropSlateDate(prop);
    if (!isOnOrAfterCleanDataCutoff(slateDate)) continue;
    if (!isPastSlateDate(slateDate, today)) continue;
    if (!isResultsCohortProp(prop)) continue;
    if (!propsBySlate[slateDate]) propsBySlate[slateDate] = [];
    propsBySlate[slateDate].push(prop);
  }

  return Object.keys(propsBySlate)
    .sort()
    .filter((slateDate) => {
      if (lockedDates.has(slateDate)) return false;
      const report =
        reports.find((item) => String(item.slateDate) === slateDate) || null;
      if (isCompletedSlate(report)) return false;
      const props = propsBySlate[slateDate] || [];
      return props.length > 0 && hasUnresolvedGradingProps(props);
    });
}

export function getBlockingActiveResultsSlateDate(
  trackedProps = [],
  lockedSlates = [],
  reports = [],
  today = getTodayLocalDate()
) {
  const unresolved = getActiveLockedUnresolvedSlateDates(
    trackedProps,
    lockedSlates,
    reports,
    today
  );
  // Prefer yesterday/today rollover block first (primary Results hold).
  const rolloverBlock = unresolved.find((date) =>
    isRolloverBlockingResultsSlate(date, today)
  );
  if (rolloverBlock) return rolloverBlock;

  // Permanent protection: any older sealed Official slate with pending grades
  // still blocks advancing the "active" Results pointer until resolved.
  const sealedPending = unresolved.find((date) => {
    if (!isPastSlateDate(date, today)) return false;
    const props = (trackedProps || []).filter(
      (p) => getResultsPropSlateDate(p) === date
    );
    return props.some(
      (p) =>
        (p.immutableOfficial === true || Boolean(p.officialPropId)) &&
        !["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
    );
  });
  return sealedPending || null;
}

function getTodayOfficialResultsCohortProps(trackedProps = [], today = getTodayLocalDate()) {
  return (trackedProps || []).filter((prop) => {
    const slateDate = getResultsPropSlateDate(prop);
    return (
      slateDate === today &&
      isOnOrAfterCleanDataCutoff(slateDate) &&
      prop.homeStaged !== true &&
      isResultsCohortProp(prop)
    );
  });
}

export function isTodayResultsCohortOpen(trackedProps = [], today = getTodayLocalDate()) {
  const todayCohort = getTodayOfficialResultsCohortProps(trackedProps, today);
  if (!todayCohort.length) return false;
  return hasUnresolvedGradingProps(todayCohort);
}

export function countStagedHomeProps(trackedProps = [], today = getTodayLocalDate()) {
  const staged = trackedProps.filter((prop) => prop.homeStaged === true);
  if (!staged.length) return { slateDate: null, count: 0 };

  const dates = [
    ...new Set(
      staged
        .map((prop) => String(prop.slateDate || ""))
        .filter((date) => date && isOnOrAfterCleanDataCutoff(date))
    ),
  ].sort();

  const latest = dates[dates.length - 1] || null;
  const count = latest
    ? staged.filter((prop) => String(prop.slateDate || "") === latest).length
    : staged.length;

  return { slateDate: latest, count };
}

function normalizeRotationOptions(optionsOrLockedSlates = {}) {
  if (Array.isArray(optionsOrLockedSlates)) {
    return { lockedSlates: optionsOrLockedSlates };
  }
  return optionsOrLockedSlates || {};
}

function getArchivedHistoryDates(archives = []) {
  return new Set(
    (archives || [])
      .filter(
        (entry) =>
          String(entry.phase || "").toUpperCase() === "ARCHIVED" &&
          entry.slateDate &&
          (entry.props?.length || entry.report)
      )
      .map((entry) => String(entry.slateDate))
  );
}

function getQuarantinedLegacySlateDates(reports = [], trackedProps = []) {
  const dates = new Set();
  for (const report of reports || []) {
    const slateDate = String(report?.slateDate || "");
    if (slateDate && !isOnOrAfterCleanDataCutoff(slateDate)) {
      dates.add(slateDate);
    }
  }
  for (const prop of trackedProps || []) {
    const slateDate = String(prop?.slateDate || "");
    if (slateDate && !isOnOrAfterCleanDataCutoff(slateDate)) {
      dates.add(slateDate);
    }
  }
  return [...dates].sort();
}

function getExplicitQuarantinedSlateDates(quarantinedSlates = []) {
  return normalizeQuarantinedSlates(quarantinedSlates).dates;
}

function isAwaitingStatsPendingReason(pendingReason = "") {
  const reason = String(pendingReason || "").toLowerCase();
  return (
    reason.includes("awaiting official player stat") ||
    reason.includes("final player stats unavailable from source") ||
    reason.includes("game final, awaiting official player stat")
  );
}

function isPropBlockingLabInference(prop = {}) {
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

export function inferCompletedReportsFromTrackedProps(
  trackedProps = [],
  reports = [],
  today = getTodayLocalDate(),
  quarantinedSlates = []
) {
  const propsBySlate = {};
  const quarantined = getQuarantinedSlateDatesSet(quarantinedSlates);

  for (const prop of trackedProps || []) {
    const slateDate = String(prop.slateDate || "");
    if (!slateDate) continue;
    if (!isOnOrAfterCleanDataCutoff(slateDate)) continue;
    if (isFutureSlateDate(slateDate, today)) continue;
    if (quarantined.has(slateDate)) continue;
    if (!propsBySlate[slateDate]) propsBySlate[slateDate] = [];
    propsBySlate[slateDate].push(prop);
  }

  const inferred = [];

  for (const slateDate of Object.keys(propsBySlate).sort()) {
    const existing = (reports || []).find(
      (item) => String(item.slateDate || "") === slateDate
    );
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
          wins: graded.filter((p) => String(p.status).toLowerCase() === "win")
            .length,
          losses: graded.filter((p) => String(p.status).toLowerCase() === "loss")
            .length,
          pushes: graded.filter((p) => String(p.status).toLowerCase() === "push")
            .length,
        },
      },
    });
  }

  return inferred;
}

function mergeCompletedReports(reports = [], inferredReports = []) {
  const byDate = new Map();

  for (const report of reports || []) {
    if (!isCompletedSlate(report)) continue;
    byDate.set(String(report.slateDate || ""), report);
  }

  for (const report of inferredReports || []) {
    const slateDate = String(report.slateDate || "");
    if (!slateDate || byDate.has(slateDate)) continue;
    byDate.set(slateDate, report);
  }

  return sortReportsByDateDesc([...byDate.values()]);
}

export function computeSlateRotation(reports = [], optionsOrLockedSlates = {}) {
  const options = normalizeRotationOptions(optionsOrLockedSlates);
  const {
    lockedSlates = [],
    archives = [],
    trackedProps = [],
    quarantinedSlates = [],
    today = getTodayLocalDate(),
    viewedSlateDate = null,
  } = options;

  const quarantinedSlateDates = getExplicitQuarantinedSlateDates(quarantinedSlates);
  const quarantinedSet = getQuarantinedSlateDatesSet(quarantinedSlates);
  const archivedHistoryDates = getArchivedHistoryDates(archives);
  const activeResultsSlateDate = pickActiveResultsSlateDate(
    trackedProps,
    reports,
    today,
    lockedSlates
  );

  const validReports = sortReportsByDateDesc(
    filterOutQuarantinedReports(filterValidDailyReports(reports, today), quarantinedSlates)
  );
  const inferredCompleted = inferCompletedReportsFromTrackedProps(
    trackedProps,
    reports,
    today,
    quarantinedSlates
  );
  const completed = mergeCompletedReports(validReports, inferredCompleted);

  const labCandidates = completed.filter((report) => {
    const slateDate = String(report.slateDate || "");
    if (!slateDate) return false;
    if (quarantinedSet.has(slateDate)) return false;
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
  const historyFromArchives = (archives || [])
    .filter(
      (entry) =>
        archivedHistoryDates.has(String(entry.slateDate || "")) &&
        String(entry.slateDate || "") !== currentLabSlateDate &&
        !quarantinedSet.has(String(entry.slateDate || ""))
    )
    .map((entry) => {
      const report = entry.report || {};
      return {
        ...report,
        slateDate: String(entry.slateDate || report.slateDate || ""),
        archivedPhase: "ARCHIVED",
      };
    });

  const historyByDate = new Map();
  for (const report of [...historyFromCompleted, ...historyFromArchives]) {
    const slateDate = String(report.slateDate || "");
    if (!slateDate || slateDate === currentLabSlateDate) continue;
    if (quarantinedSet.has(slateDate)) continue;
    if (!historyByDate.has(slateDate)) {
      historyByDate.set(slateDate, report);
    }
  }
  const historySlates = sortReportsByDateDesc([...historyByDate.values()]);

  // Results bucket: only the admitted active slate (locked unresolved or today with official props).
  const activeResults = activeResultsSlateDate
    ? validReports.filter(
        (report) => String(report.slateDate || "") === activeResultsSlateDate
      )
    : [];

  const activeInProgressSlateDates = activeResultsSlateDate
    ? [activeResultsSlateDate]
    : [];

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
    lockedSlates: lockedSlates || [],
    viewedSlateDate: viewed,
    viewingHistorical: Boolean(
      viewed && currentLabSlateDate && viewed !== currentLabSlateDate
    ),
    quarantinedLegacySlateDates: getQuarantinedLegacySlateDates(
      reports,
      trackedProps
    ),
    quarantinedSlateDates,
    quarantinedSlateReasons: normalizeQuarantinedSlates(quarantinedSlates).reasons,
    inferredCompletedSlateDates: inferredCompleted.map((report) =>
      String(report.slateDate || "")
    ),
  };
}

export function buildSlateRotationMetadata(
  reports = [],
  context = {},
  viewedSlateDate = null
) {
  const {
    trackedProps = [],
    archives = [],
    lockedSlates = [],
    quarantinedSlates = [],
    today = getTodayLocalDate(),
  } = context;

  const rotation = computeSlateRotation(reports, {
    lockedSlates,
    archives,
    trackedProps,
    quarantinedSlates,
    today,
    viewedSlateDate,
  });

  const monotonicRotation = applyMonotonicLabPointer(rotation, {
    allowRepairForward: Boolean(context.allowRepairForward),
  });

  const staleUnresolvedSlateDates = collectStaleUnresolvedForRotation(
    trackedProps,
    reports,
    monotonicRotation,
    today,
    lockedSlates
  );

  const lifecycleByDate = {};
  const slateDates = new Set([
    ...reports.map((report) => String(report.slateDate || "")),
    ...trackedProps.map((prop) => String(prop.slateDate || "")),
    ...archives.map((entry) => String(entry.slateDate || "")),
  ]);

  for (const slateDate of [...slateDates].filter(Boolean).sort()) {
    lifecycleByDate[slateDate] = classifySlateRotationBucket(
      slateDate,
      monotonicRotation,
      archives,
      today,
      quarantinedSlates
    );
  }

  const rotationDecisionDebug = {
    today,
    validReportDates: monotonicRotation.allReports.map((report) => report.slateDate),
    completedReportDates: mergeCompletedReports(
      monotonicRotation.allReports,
      monotonicRotation.inferredCompletedSlateDates.map((slateDate) => ({
        slateDate,
        inferredFromTrackedProps: true,
      }))
    ).map((report) => report.slateDate),
    archivedHistoryDates: [...monotonicRotation.historySlateDates],
    labCandidateDates: mergeCompletedReports(
      monotonicRotation.allReports,
      []
    )
      .filter((report) => {
        const slateDate = String(report.slateDate || "");
        return (
          slateDate &&
          !monotonicRotation.historySlateDates.includes(slateDate) &&
          slateDate !== monotonicRotation.activeResultsSlateDate
        );
      })
      .map((report) => report.slateDate),
    inferredCompletedSlateDates: monotonicRotation.inferredCompletedSlateDates,
    activeResultsSlateDate: monotonicRotation.activeResultsSlateDate,
    currentLabSlateDate: monotonicRotation.currentLabSlateDate,
    viewedSlateDate: monotonicRotation.viewedSlateDate,
    viewingHistorical: monotonicRotation.viewingHistorical,
    labPointerSource: monotonicRotation.labPointerSource || null,
    lifecycleIntegrityBlocked: monotonicRotation.lifecycleIntegrityBlocked || false,
  };

  return {
    ...monotonicRotation,
    staleUnresolvedSlateDates,
    lifecycleByDate,
    rotationDecisionDebug,
  };
}

function collectStaleUnresolvedForRotation(
  trackedProps = [],
  reports = [],
  rotation = {},
  today = getTodayLocalDate(),
  lockedSlates = []
) {
  const historyDates = new Set(rotation.historySlateDates || []);
  const labDate = rotation.currentLabSlateDate;
  const activeResultsSlateDate = rotation.activeResultsSlateDate;
  const staleDates = new Set();

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
    if (labDate && slateDate === labDate) continue;
    if (historyDates.has(slateDate)) continue;

    const report =
      reports.find((item) => String(item.slateDate) === slateDate) || null;
    if (isCompletedSlate(report)) continue;

    const slateProps = propsBySlate[slateDate] || [];
    const allGraded =
      slateProps.length > 0 &&
      slateProps.every((prop) => isResolvedPropStatus(String(prop.status || "")));
    if (allGraded && !hasUnresolvedGradingProps(slateProps)) continue;

    const lockedActive = (lockedSlates || []).some(
      (entry) =>
        String(entry.slateDate || "") === slateDate &&
        String(entry.phase || "ACTIVE").toUpperCase() === "ACTIVE"
    );
    if (!lockedActive && slateProps.length === 0) continue;

    staleDates.add(slateDate);
  }

  return [...staleDates].sort();
}

function classifySlateRotationBucket(
  slateDate,
  rotation,
  archives = [],
  today,
  quarantinedSlates = []
) {
  if (!isOnOrAfterCleanDataCutoff(slateDate)) {
    return "QUARANTINED_LEGACY";
  }
  if (isQuarantinedSlateDate(slateDate, quarantinedSlates)) {
    return "QUARANTINED_EXCLUDED";
  }
  if (rotation.currentLabSlateDate === slateDate) {
    return "LAB_CURRENT";
  }
  if ((rotation.historySlateDates || []).includes(slateDate)) {
    return "ARCHIVED_HISTORY";
  }
  if (rotation.activeResultsSlateDate === slateDate) {
    return "ACTIVE_RESULTS";
  }
  if (isFutureSlateDate(slateDate, today)) {
    return "FUTURE";
  }
  if ((rotation.staleUnresolvedSlateDates || []).includes(slateDate)) {
    return "STALE_UNRESOLVED";
  }
  const archive = (archives || []).find(
    (entry) => String(entry.slateDate || "") === slateDate
  );
  if (archive?.props?.length && String(archive.phase || "").toUpperCase() === "LAB") {
    return "LEGACY_LAB_ARCHIVE";
  }
  return "IN_PROGRESS_OR_UNASSIGNED";
}

/** Active Results slate: locked ACTIVE unresolved first, then today when unblocked. */
export function pickActiveResultsSlateDate(
  trackedProps = [],
  reports = [],
  today = getTodayLocalDate(),
  lockedSlates = []
) {
  const blockingSlate = getBlockingActiveResultsSlateDate(
    trackedProps,
    lockedSlates,
    reports,
    today
  );
  if (blockingSlate) return blockingSlate;

  return isTodayResultsCohortOpen(trackedProps, today) ? today : null;
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
  today = getTodayLocalDate(),
  lockedSlates = []
) {
  const ignoredPreCutoffReportCount = countIgnoredPreCutoffReports(rawReports);
  const validCleanReports = filterValidDailyReports(rawReports, today);
  const completedCleanReports = filterCompletedDailyReports(rawReports, today);
  const rotation = computeSlateRotation(rawReports, {
    lockedSlates,
    archives,
    trackedProps,
    today,
  });
  const activeResultsSlateDate = pickActiveResultsSlateDate(
    trackedProps,
    rawReports,
    today,
    lockedSlates
  );
  const blockingSlate = getBlockingActiveResultsSlateDate(
    trackedProps,
    lockedSlates,
    rawReports,
    today
  );
  const activeResultsProps = activeResultsSlateDate
    ? trackedProps.filter(
        (prop) =>
          getResultsPropSlateDate(prop) === activeResultsSlateDate &&
          isResultsCohortProp(prop)
      )
    : [];
  const activeLockEntry = (lockedSlates || []).find(
    (entry) => String(entry.slateDate) === activeResultsSlateDate
  );
  const stagedHome = countStagedHomeProps(trackedProps, today);
  const activeResultsPendingCount = activeResultsProps.filter(
    (prop) => String(prop.status || "pending").toLowerCase() === "pending"
  ).length;
  const activeResultsGradedCount = activeResultsProps.filter((prop) =>
    ["win", "loss", "push"].includes(String(prop.status || "").toLowerCase())
  ).length;
  const activeResultsAwaitingStatsCount = activeResultsProps.filter((prop) => {
    const resolveDebug = prop.resolveDebug || {};
    const pendingReason = String(prop.pendingReason || "").toLowerCase();
    return (
      resolveDebug.gameFinal === true ||
      pendingReason.includes("awaiting official player stat")
    );
  }).length;

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

  const slateFrozen = isSlateLocked(today);
  const lockEntry = getSlateLockEntry(today);
  const slateFrozenAt = lockEntry?.lockedAt || null;
  const autoLocked = Boolean(lockEntry?.autoLocked);
  const todaysProps = trackedProps.filter(
    (prop) => String(prop.slateDate || "") === today
  );
  const generatedAtTimes = todaysProps
    .map((prop) => prop.generatedAt)
    .filter(Boolean)
    .sort();
  const lastPropAddedAt = generatedAtTimes.length
    ? generatedAtTimes[generatedAtTimes.length - 1]
    : null;
  const propsAddedAfterFreezeCount = slateFrozenAt
    ? todaysProps.filter(
        (prop) => prop.generatedAt && prop.generatedAt > slateFrozenAt
      ).length
    : 0;

  return {
    todayLocalDate: today,
    cleanDataCutoff: CLEAN_DATA_CUTOFF,
    resultsRule: "active_locked_unresolved",
    slateFrozen: isSlateLocked(activeResultsSlateDate || today),
    slateFrozenAt: activeLockEntry?.lockedAt || lockEntry?.lockedAt || null,
    autoLocked: Boolean(activeLockEntry?.autoLocked ?? lockEntry?.autoLocked),
    lastPropAddedAt,
    propsAddedAfterFreezeCount,
    rawReportCount: (rawReports || []).length,
    validCleanReportCount: validCleanReports.length,
    completedCleanReportCount: completedCleanReports.length,
    ignoredPreCutoffReportCount,
    activeResultsSlateDate,
    activeResultsPhase: activeLockEntry?.phase || null,
    activeResultsLocked: Boolean(activeLockEntry),
    activeResultsPropCount: activeResultsProps.length,
    activeResultsPendingCount,
    activeResultsGradedCount,
    activeResultsAwaitingStatsCount,
    stagedHomeSlateDate: stagedHome.slateDate,
    stagedHomePropCount: stagedHome.count,
    nextSlateWaitingOnHome: Boolean(blockingSlate && stagedHome.count > 0),
    resultsSlateBlockedByActiveSlate: blockingSlate,
    blockedResultsPromotionReason: blockingSlate
      ? `Active locked slate ${blockingSlate} still unresolved`
      : null,
    pendingActiveResultsCount: activeResultsPendingCount + activeResultsAwaitingStatsCount,
    activeResultsCanPromoteToLab:
      activeResultsProps.length > 0 &&
      !hasUnresolvedGradingProps(activeResultsProps),
    priorSlateStillActive: Boolean(
      activeResultsSlateDate && activeResultsSlateDate < today
    ),
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

/**
 * Home must never show a Lab/History/past Results cohort as "Today".
 * Reclassify stale dayBucket stamps from cached boards using CT slate dates
 * (slateDate / officialPropId / commenceTime). Read-path only — does not
 * delete tracked props, Lab, History, or sealed packets.
 */
export function sanitizeHomeBoardForLifecycle(board = {}, options = {}) {
  if (!board || typeof board !== "object") return board;

  const today = options.todayLocalDate || getTodayLocalDate();
  const tomorrow = getTomorrowLocalDate(today);
  const trackedProps = options.trackedProps || [];
  const reports = options.reports || [];
  const archives = options.archives || [];
  const lockedSlates = options.lockedSlates || [];

  const rotation = computeSlateRotation(reports, {
    lockedSlates,
    archives,
    trackedProps,
    today,
  });
  const labDate = rotation.currentLabSlateDate || null;
  const activeResultsSlateDate = pickActiveResultsSlateDate(
    trackedProps,
    reports,
    today,
    lockedSlates
  );

  const stampPropDay = (prop = {}) => {
    const slateDate = resolveHomeBoardSlateDate(prop);
    const bucket = classifyHomeDayBucket(slateDate, today);
    if (!bucket || bucket === "PAST" || bucket === "LATER") {
      return {
        ...prop,
        slateDate: slateDate || prop.slateDate || null,
        dayBucket: bucket || prop.dayBucket || "",
        dateLabel:
          bucket === "PAST"
            ? "Past"
            : bucket === "LATER"
              ? "Later"
              : prop.dateLabel || "",
        _homeSlateDate: slateDate || "",
        _homeDayBucket: bucket || "",
      };
    }
    return {
      ...prop,
      slateDate: slateDate || prop.slateDate || null,
      dayBucket: bucket,
      dateLabel: bucket === "TODAY" ? "Today" : "Tomorrow",
      _homeSlateDate: slateDate,
      _homeDayBucket: bucket,
    };
  };

  const isHomeTodayProp = (prop = {}) => {
    const stamped = stampPropDay(prop);
    const d = stamped._homeSlateDate || resolveHomeBoardSlateDate(stamped);
    if (!d) return false;
    if (labDate && d === labDate) return false;
    return d === today && stamped._homeDayBucket === "TODAY";
  };

  const isHomeTomorrowProp = (prop = {}) => {
    const stamped = stampPropDay(prop);
    const d = stamped._homeSlateDate || resolveHomeBoardSlateDate(stamped);
    if (!d) return false;
    if (labDate && d === labDate) return false;
    return d === tomorrow && stamped._homeDayBucket === "TOMORROW";
  };

  const collect = (...lists) => {
    const out = [];
    const seen = new Set();
    for (const list of lists) {
      for (const prop of Array.isArray(list) ? list : []) {
        if (!prop || typeof prop !== "object") continue;
        const key =
          prop.officialPropId ||
          `${prop.player || prop.playerName}|${prop.side}|${prop.line}|${prop.commenceTime || ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(prop);
      }
    }
    return out;
  };

  const allDisplayWNBA = collect(
    board.bestSixDisplayTodayWNBA,
    board.bestSixDisplayTomorrowWNBA,
    board.bestSixDisplayWNBA,
    board.bestSixWNBA
  );
  const allDisplayNBA = collect(
    board.bestSixDisplayTodayNBA,
    board.bestSixDisplayTomorrowNBA,
    board.bestSixDisplayNBA,
    board.bestSixNBA
  );

  let bestSixDisplayTodayWNBA = allDisplayWNBA
    .filter(isHomeTodayProp)
    .map(stampPropDay);
  let bestSixDisplayTodayNBA = allDisplayNBA
    .filter(isHomeTodayProp)
    .map(stampPropDay);
  let bestSixDisplayTomorrowWNBA = allDisplayWNBA
    .filter(isHomeTomorrowProp)
    .map(stampPropDay);
  let bestSixDisplayTomorrowNBA = allDisplayNBA
    .filter(isHomeTomorrowProp)
    .map(stampPropDay);

  let bestSixWNBA = bestSixDisplayTodayWNBA.slice();
  let bestSixNBA = bestSixDisplayTodayNBA.slice();
  const bestSixDisplayWNBA = [
    ...bestSixDisplayTodayWNBA,
    ...bestSixDisplayTomorrowWNBA,
  ];
  const bestSixDisplayNBA = [
    ...bestSixDisplayTodayNBA,
    ...bestSixDisplayTomorrowNBA,
  ];

  const rebucketGame = (game = {}) => {
    const slateDate = resolveHomeBoardSlateDate(game);
    const bucket = classifyHomeDayBucket(slateDate, today);
    if (bucket !== "TODAY" && bucket !== "TOMORROW") return null;
    const picks = (game.picks || [])
      .map(stampPropDay)
      .filter((p) =>
        bucket === "TODAY" ? isHomeTodayProp(p) : isHomeTomorrowProp(p)
      );
    const allGeneratedCandidates = (game.allGeneratedCandidates || [])
      .map(stampPropDay)
      .filter((p) => {
        const d = resolveHomeBoardSlateDate(p);
        return d === today || d === tomorrow;
      });
    return {
      ...game,
      date: slateDate || game.date || null,
      slateDate: slateDate || game.slateDate || null,
      dayBucket: bucket,
      dateLabel: bucket === "TODAY" ? "Today" : "Tomorrow",
      picks,
      allGeneratedCandidates,
    };
  };

  const games = (Array.isArray(board.games) ? board.games : [])
    .map(rebucketGame)
    .filter(Boolean);
  const wnbaGames = games.filter(
    (g) => String(g.league || "").toUpperCase() === "WNBA"
  );
  const nbaGames = games.filter(
    (g) => String(g.league || "").toUpperCase() === "NBA"
  );

  // Top picks: calendar today / tomorrow only (never Lab/past).
  const scrubTop = (list = []) =>
    (Array.isArray(list) ? list : [])
      .map(stampPropDay)
      .filter((p) => isHomeTodayProp(p) || isHomeTomorrowProp(p));

  const withAnalysis = (list) =>
    ensureHomeDetailedAnalysisOnPicks(
      (Array.isArray(list) ? list : []).map((p) => applyHomeDisplayWhyToPick(p))
    );

  const priorAudit =
    board.controlledBestSixAudit && typeof board.controlledBestSixAudit === "object"
      ? board.controlledBestSixAudit
      : {};

  return {
    ...board,
    games,
    wnbaGames,
    nbaGames,
    bestSixWNBA: withAnalysis(bestSixWNBA),
    bestSixNBA: withAnalysis(bestSixNBA),
    bestSixDisplayWNBA: withAnalysis(bestSixDisplayWNBA),
    bestSixDisplayNBA: withAnalysis(bestSixDisplayNBA),
    bestSixDisplayTodayWNBA: withAnalysis(bestSixDisplayTodayWNBA),
    bestSixDisplayTodayNBA: withAnalysis(bestSixDisplayTodayNBA),
    bestSixDisplayTomorrowWNBA: withAnalysis(bestSixDisplayTomorrowWNBA),
    bestSixDisplayTomorrowNBA: withAnalysis(bestSixDisplayTomorrowNBA),
    topProps: withAnalysis(scrubTop(board.topProps)),
    topWNBAProps: withAnalysis(scrubTop(board.topWNBAProps)),
    topNBAProps: withAnalysis(scrubTop(board.topNBAProps)),
    topOfficialProps: withAnalysis(scrubTop(board.topOfficialProps)),
    topWNBAOfficialProps: withAnalysis(scrubTop(board.topWNBAOfficialProps)),
    topNBAOfficialProps: withAnalysis(scrubTop(board.topNBAOfficialProps)),
    todayCandidateCount: games.filter((g) => g.dayBucket === "TODAY").length,
    tomorrowCandidateCount: games.filter((g) => g.dayBucket === "TOMORROW")
      .length,
    controlledBestSixAudit: {
      ...priorAudit,
      perDaySelection: true,
      bestSixDisplayTodayCountByLeague: {
        WNBA: bestSixDisplayTodayWNBA.length,
        NBA: bestSixDisplayTodayNBA.length,
      },
      bestSixDisplayTomorrowCountByLeague: {
        WNBA: bestSixDisplayTomorrowWNBA.length,
        NBA: bestSixDisplayTomorrowNBA.length,
      },
    },
    lifecycleHomeSanitize: {
      today,
      tomorrow,
      labDate,
      activeResultsSlateDate,
      scrubbedLabOrPastCohort: true,
      homeDetailedAnalysisAttached: true,
      slateDateReclassified: true,
      build: "courteedge-slate-date-today-repair-v1",
    },
  };
}
