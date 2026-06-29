import { createBackup } from "./backupService.js";
import { clearActiveTopPicksSnapshot } from "./topPicksSnapshotService.js";
import {
  archiveSlate,
  getAllHistoryArchives,
  getHistoryArchive,
  getLockedSlatesRegistry,
  getQuarantinedSlatesFromRegistry,
} from "./slateLockService.js";
import {
  getDailySlateReport,
  getRawDailySlateReports,
} from "./dailySlateReportService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
} from "./slateScopeService.js";
import { getTrackedProps } from "./trackedPropService.js";

export const TARGET_ARCHIVE_DATE = "2026-06-21";

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

function buildArchivePlan() {
  const meta = buildPostRepairMetadata();
  const archive621 = getHistoryArchive(TARGET_ARCHIVE_DATE);
  const registry = getLockedSlatesRegistry();
  const registryEntry = registry.slates?.find(
    (entry) => String(entry.slateDate || "") === TARGET_ARCHIVE_DATE
  );
  const archivePhase = String(
    registryEntry?.phase || archive621?.phase || ""
  ).toUpperCase();

  return {
    currentLabSlateDate: meta.currentLabSlateDate,
    historySlateDates: meta.historySlateDates,
    archive621Phase: archivePhase || null,
    archive621PropCount: archive621?.props?.length || 0,
    wouldArchive:
      Boolean(archive621?.props?.length) && archivePhase !== "ARCHIVED",
    alreadyArchived: archivePhase === "ARCHIVED",
    isCurrentLab: meta.currentLabSlateDate === TARGET_ARCHIVE_DATE,
  };
}

/**
 * Archive stuck 2026-06-21 from Lab without promoting a replacement slate.
 * Does not clear tracked props or merge a newer slate slice.
 */
export function archiveLabSlate0621(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const backupReason = String(
    options.backupReason || "pre-archive-lab-slate-0621-v1"
  );
  const plan = buildArchivePlan();

  if (!plan.isCurrentLab && !plan.wouldArchive) {
    return {
      ok: false,
      dryRun,
      message: `currentLabSlateDate is ${plan.currentLabSlateDate ?? "null"}; 06/21 is already archived or missing`,
      plan,
      meta: {
        currentLabSlateDate: plan.currentLabSlateDate,
        historySlateDates: plan.historySlateDates,
      },
    };
  }

  if (!plan.isCurrentLab) {
    return {
      ok: false,
      dryRun,
      message: `currentLabSlateDate is ${plan.currentLabSlateDate ?? "null"} (expected ${TARGET_ARCHIVE_DATE})`,
      plan,
      meta: {
        currentLabSlateDate: plan.currentLabSlateDate,
        historySlateDates: plan.historySlateDates,
      },
    };
  }

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      backupId: null,
      targetArchiveDate: TARGET_ARCHIVE_DATE,
      plan,
      meta: buildPostRepairMetadata(),
    };
  }

  const backup = createBackup(backupReason);

  let archiveResult = {
    skipped: true,
    reason: "already_archived_or_missing_bundle",
    phase: plan.archive621Phase,
  };

  if (plan.wouldArchive) {
    const report = getDailySlateReport(TARGET_ARCHIVE_DATE);
    archiveResult = archiveSlate(TARGET_ARCHIVE_DATE, { report });
    if (archiveResult.ok) {
      clearActiveTopPicksSnapshot(TARGET_ARCHIVE_DATE);
    }
  }

  const meta = buildPostRepairMetadata();

  return {
    ok: true,
    dryRun: false,
    backupId: backup.backupId,
    targetArchiveDate: TARGET_ARCHIVE_DATE,
    archive621: archiveResult,
    plan,
    meta: {
      currentLabSlateDate: meta.currentLabSlateDate,
      historySlateDates: meta.historySlateDates,
      activeResultsSlateDate: meta.activeResultsSlateDate,
      activeInProgressSlateDates: meta.activeInProgressSlateDates,
      inferredCompletedSlateDates: meta.inferredCompletedSlateDates,
    },
  };
}
