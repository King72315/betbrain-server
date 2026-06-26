import { createBackup } from "./backupService.js";
import {
  getDailySlateReport,
  getRawDailySlateReports,
  removeDailySlateReport,
} from "./dailySlateReportService.js";
import {
  archiveSlate,
  getAllHistoryArchives,
  getHistoryArchive,
  getLockedSlatesRegistry,
  getQuarantinedSlatesFromRegistry,
  quarantineSlate,
} from "./slateLockService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
  QUARANTINE_REASONS,
} from "./slateScopeService.js";
import { getTrackedProps } from "./trackedPropService.js";

export const QUARANTINE_TARGET_DATE = "2026-06-24";
export const ARCHIVE_TARGET_DATE = "2026-06-21";
export const QUARANTINE_REASON = QUARANTINE_REASONS.INCOMPLETE_PROD_DATA;

function buildPostRepairMetadata() {
  const quarantinedSlates = getQuarantinedSlatesFromRegistry();
  return buildSlateRotationMetadata(getRawDailySlateReports(), {
    trackedProps: getTrackedProps(),
    archives: getAllHistoryArchives(),
    lockedSlates: getLockedSlatesRegistry().slates || [],
    quarantinedSlates,
    today: getTodayLocalDate(),
  });
}

export function repairQuarantine0624AndArchive0621(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const backupReason = String(
    options.backupReason || "pre-quarantine-0624-archive-0621-v1"
  );

  const trackedProps = getTrackedProps();
  const props0624 = trackedProps.filter(
    (prop) => String(prop.slateDate || "") === QUARANTINE_TARGET_DATE
  ).length;

  const archive621 = getHistoryArchive(ARCHIVE_TARGET_DATE);
  const registry = getLockedSlatesRegistry();
  const archiveEntry = registry.slates?.find(
    (entry) => entry.slateDate === ARCHIVE_TARGET_DATE
  );
  const archive621Phase = String(
    archiveEntry?.phase || archive621?.phase || ""
  ).toUpperCase();
  const wouldArchive621 =
    Boolean(archive621?.props?.length || archiveEntry) &&
    archive621Phase !== "ARCHIVED";

  const quarantinedBefore = getQuarantinedSlatesFromRegistry();
  const alreadyQuarantined = quarantinedBefore.some(
    (entry) => entry.slateDate === QUARANTINE_TARGET_DATE
  );

  const rawReports = getRawDailySlateReports();
  const report0624 = rawReports.find(
    (report) => String(report.slateDate || "") === QUARANTINE_TARGET_DATE
  );
  const wouldRemove0624Report = Boolean(report0624);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      repairId: "quarantine-0624-archive-0621-v1",
      backupId: null,
      props0624Untouched: props0624,
      wouldArchive621,
      archive621Phase: archive621Phase || null,
      wouldQuarantine0624: !alreadyQuarantined,
      alreadyQuarantined0624: alreadyQuarantined,
      wouldRemove0624Report,
      meta: buildPostRepairMetadata(),
    };
  }

  const backup = createBackup(backupReason);

  let archiveResult = null;
  if (wouldArchive621) {
    const report = getDailySlateReport(ARCHIVE_TARGET_DATE);
    archiveResult = archiveSlate(ARCHIVE_TARGET_DATE, { report });
  } else {
    archiveResult = {
      skipped: true,
      reason: "already_archived_or_missing_bundle",
      phase: archive621Phase || null,
    };
  }

  const quarantineResult = quarantineSlate(QUARANTINE_TARGET_DATE, QUARANTINE_REASON);

  let removeReportResult = null;
  if (wouldRemove0624Report) {
    removeReportResult = removeDailySlateReport(QUARANTINE_TARGET_DATE);
  } else {
    removeReportResult = {
      skipped: true,
      reason: "no_active_report",
      slateDate: QUARANTINE_TARGET_DATE,
    };
  }

  const meta = buildPostRepairMetadata();

  return {
    ok: true,
    dryRun: false,
    repairId: "quarantine-0624-archive-0621-v1",
    backupId: backup.backupId,
    props0624Untouched: props0624,
    archive621: archiveResult,
    quarantine0624: quarantineResult,
    remove0624Report: removeReportResult,
    meta: {
      currentLabSlateDate: meta.currentLabSlateDate,
      historySlateDates: meta.historySlateDates,
      quarantinedSlateDates: meta.quarantinedSlateDates,
      activeResultsSlateDate: meta.activeResultsSlateDate,
      activeInProgressSlateDates: meta.activeInProgressSlateDates,
      inferredCompletedSlateDates: meta.inferredCompletedSlateDates,
    },
  };
}
