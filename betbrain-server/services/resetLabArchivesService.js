import { createBackup } from "./backupService.js";
import {
  getRawDailySlateReports,
  removeDailySlateReport,
} from "./dailySlateReportService.js";
import {
  clearLabPhaseArchiveFiles,
  clearLabPhaseRegistryEntries,
  getAllHistoryArchives,
  getLockedSlatesRegistry,
  getQuarantinedSlatesFromRegistry,
  quarantineSlate,
  SLATE_PHASE,
} from "./slateLockService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
  QUARANTINE_REASONS,
} from "./slateScopeService.js";
import { getTrackedProps } from "./trackedPropService.js";

/** Known stuck Lab dates wiped without restore (accepted data loss). */
export const DEFAULT_WIPE_LAB_REPORT_DATES = ["2026-06-21"];

function buildPostWipeMetadata() {
  const quarantinedSlates = getQuarantinedSlatesFromRegistry();
  return buildSlateRotationMetadata(getRawDailySlateReports(), {
    trackedProps: getTrackedProps(),
    archives: getAllHistoryArchives(),
    lockedSlates: getLockedSlatesRegistry().slates || [],
    quarantinedSlates,
    today: getTodayLocalDate(),
  });
}

function countTrackedPropsByDate(slateDate) {
  return getTrackedProps().filter(
    (prop) => String(prop.slateDate || "") === String(slateDate || "")
  ).length;
}

function captureWipeState() {
  const meta = buildPostWipeMetadata();
  const archives = getAllHistoryArchives();
  const registry = getLockedSlatesRegistry();

  return {
    meta,
    archivePhases: archives.map((archive) => ({
      slateDate: archive.slateDate,
      phase: String(archive.phase || "").toUpperCase() || null,
      propCount: archive.props?.length || 0,
    })),
    registrySlates: (registry.slates || []).map((entry) => ({
      slateDate: entry.slateDate,
      phase: entry.phase,
    })),
    activeResultsSlateDate: meta.activeResultsSlateDate,
    currentLabSlateDate: meta.currentLabSlateDate,
    historySlateDates: [...(meta.historySlateDates || [])],
    tracked0707: countTrackedPropsByDate("2026-07-07"),
    tracked0708: countTrackedPropsByDate("2026-07-08"),
    trackedStoreTotal: getTrackedProps().length,
  };
}

/**
 * Aggressively clear stuck LAB archives/registry with NO snapshot restore.
 * Preserves ACTIVE Results cohort + tracked props. Quarantines wiped report
 * dates so graded legacy props cannot re-infer as Lab candidates.
 */
export function resetLabNoRestore(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const backupReason = String(options.backupReason || "pre-lab-wipe-v1");
  const wipeReportDates = Array.isArray(options.wipeReportDates)
    ? options.wipeReportDates.map(String)
    : [...DEFAULT_WIPE_LAB_REPORT_DATES];
  const quarantineWiped = options.quarantineWiped !== false;

  const before = captureWipeState();
  const preserveDates = new Set(
    [before.activeResultsSlateDate].filter(Boolean).map(String)
  );

  const labArchives = before.archivePhases.filter(
    (entry) =>
      entry.phase === SLATE_PHASE.LAB && !preserveDates.has(entry.slateDate)
  );
  const labRegistry = before.registrySlates.filter(
    (entry) =>
      String(entry.phase || "").toUpperCase() === SLATE_PHASE.LAB &&
      !preserveDates.has(entry.slateDate)
  );

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      backupId: null,
      before,
      wouldDeleteLabArchives: labArchives,
      wouldRemoveLabRegistry: labRegistry,
      wouldRemoveReports: wipeReportDates,
      wouldQuarantine: quarantineWiped ? wipeReportDates : [],
      preserveDates: [...preserveDates],
      meta: before.meta,
    };
  }

  const backup = createBackup(backupReason);

  const clearedArchives = clearLabPhaseArchiveFiles({
    preserveDates: [...preserveDates],
  });
  const clearedRegistry = clearLabPhaseRegistryEntries({
    preserveDates: [...preserveDates],
  });

  const removedReports = [];
  for (const slateDate of wipeReportDates) {
    if (preserveDates.has(slateDate)) {
      removedReports.push({
        slateDate,
        skipped: true,
        reason: "active_results_preserved",
      });
      continue;
    }
    removedReports.push(removeDailySlateReport(slateDate));
  }

  const quarantined = [];
  if (quarantineWiped) {
    for (const slateDate of wipeReportDates) {
      if (preserveDates.has(slateDate)) continue;
      quarantined.push(
        quarantineSlate(slateDate, QUARANTINE_REASONS.LAB_WIPED_NO_RESTORE)
      );
    }
  }

  const after = captureWipeState();

  return {
    ok: true,
    dryRun: false,
    backupId: backup.backupId,
    before: {
      archivePhases: before.archivePhases,
      historySlateDates: before.historySlateDates,
      currentLabSlateDate: before.currentLabSlateDate,
      activeResultsSlateDate: before.activeResultsSlateDate,
      tracked0707: before.tracked0707,
      tracked0708: before.tracked0708,
      trackedStoreTotal: before.trackedStoreTotal,
    },
    clearedArchives,
    clearedRegistry,
    removedReports,
    quarantined,
    after: {
      archivePhases: after.archivePhases,
      historySlateDates: after.historySlateDates,
      currentLabSlateDate: after.currentLabSlateDate,
      activeResultsSlateDate: after.activeResultsSlateDate,
      tracked0707: after.tracked0707,
      tracked0708: after.tracked0708,
      trackedStoreTotal: after.trackedStoreTotal,
      trackedPreserved:
        after.trackedStoreTotal === before.trackedStoreTotal &&
        after.tracked0707 === before.tracked0707 &&
        after.tracked0708 === before.tracked0708,
      labEmpty: after.currentLabSlateDate == null,
    },
    meta: {
      currentLabSlateDate: after.currentLabSlateDate,
      historySlateDates: after.historySlateDates,
      activeResultsSlateDate: after.activeResultsSlateDate,
      activeInProgressSlateDates: after.meta.activeInProgressSlateDates,
    },
  };
}
