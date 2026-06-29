import { createBackup } from "./backupService.js";
import {
  buildDailySlateReportsFromTrackedProps,
  getRawDailySlateReports,
  rotateStaleLabArchives,
} from "./dailySlateReportService.js";
import {
  getAllHistoryArchives,
  getLockedSlatesRegistry,
  getQuarantinedSlatesFromRegistry,
} from "./slateLockService.js";
import { buildSlateRotationMetadata, getTodayLocalDate } from "./slateScopeService.js";
import { getTrackedProps } from "./trackedPropService.js";

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

/**
 * Safe runtime repair: archive stale LAB bundles, keep current Lab slate only.
 * Does not clear tracked props or mutate locked snapshots.
 */
export function repairLabSlateRotation(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const rebuildReports = options.rebuildReports !== false;
  const backupReason = String(options.backupReason || "pre-lab-slate-rotation-repair-v1");

  const trackedProps = getTrackedProps();
  const reports = getRawDailySlateReports();
  const archives = getAllHistoryArchives();
  const lockedSlates = getLockedSlatesRegistry().slates || [];
  const quarantinedSlates = getQuarantinedSlatesFromRegistry();
  const today = getTodayLocalDate();

  const rotationPreview = rotateStaleLabArchives({
    trackedProps,
    reports,
    archives,
    lockedSlates,
    quarantinedSlates,
    today,
  });

  const staleLabArchives = archives.filter((archive) => {
    const slateDate = String(archive?.slateDate || "");
    if (!slateDate || slateDate === rotationPreview.currentLabSlateDate) return false;
    if (!archive?.props?.length) return false;
    return String(archive.phase || "").toUpperCase() !== "ARCHIVED";
  });

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      backupId: null,
      currentLabSlateDate: rotationPreview.currentLabSlateDate,
      historySlateDates: rotationPreview.historySlateDates,
      wouldArchive: staleLabArchives.map((archive) => ({
        slateDate: archive.slateDate,
        phase: archive.phase,
        propCount: archive.props?.length || 0,
      })),
      wouldRebuildReports: rebuildReports,
      meta: buildPostRepairMetadata(),
    };
  }

  const backup = createBackup(backupReason);

  let rebuildSummary = { skipped: true, reason: "rebuild_disabled" };
  if (rebuildReports) {
    rebuildSummary = buildDailySlateReportsFromTrackedProps(trackedProps).summary;
  }

  const rotationResult = rotateStaleLabArchives({
    trackedProps: getTrackedProps(),
    reports: getRawDailySlateReports(),
    archives: getAllHistoryArchives(),
    lockedSlates: getLockedSlatesRegistry().slates || [],
    quarantinedSlates: getQuarantinedSlatesFromRegistry(),
    today: getTodayLocalDate(),
  });

  const meta = buildPostRepairMetadata();

  return {
    ok: true,
    dryRun: false,
    backupId: backup.backupId,
    currentLabSlateDate: rotationResult.currentLabSlateDate,
    historySlateDates: rotationResult.historySlateDates,
    archived: rotationResult.archived,
    skipped: rotationResult.skipped,
    rebuildSummary,
    meta: {
      currentLabSlateDate: meta.currentLabSlateDate,
      historySlateDates: meta.historySlateDates,
      activeResultsSlateDate: meta.activeResultsSlateDate,
      activeInProgressSlateDates: meta.activeInProgressSlateDates,
      inferredCompletedSlateDates: meta.inferredCompletedSlateDates,
    },
  };
}
