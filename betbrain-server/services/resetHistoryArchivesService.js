import { createBackup } from "./backupService.js";
import {
  buildDailySlateReportsFromTrackedProps,
  getDailySlateReport,
  getRawDailySlateReports,
} from "./dailySlateReportService.js";
import { archiveLabSlate0621, TARGET_ARCHIVE_DATE } from "./archiveLabSlate0621Service.js";
import { repairLabSlateRotation } from "./repairLabSlateRotationService.js";
import {
  archiveSlate,
  clearHistoryArchiveFiles,
  getAllHistoryArchives,
  getHistoryArchive,
  getLockedSlatesRegistry,
  getLockedSnapshot,
  getQuarantinedSlatesFromRegistry,
  listHistoryArchiveSlateDates,
  resetHistoryRegistryEntries,
} from "./slateLockService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
} from "./slateScopeService.js";
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

function countTrackedPropsByDate(slateDate) {
  return getTrackedProps().filter(
    (prop) => String(prop.slateDate || "") === String(slateDate || "")
  ).length;
}

function capturePreResetState() {
  const meta = buildPostRepairMetadata();
  const archiveDates = listHistoryArchiveSlateDates();
  const registry = getLockedSlatesRegistry();

  return {
    meta,
    archiveDates,
    registrySlates: (registry.slates || []).map((entry) => ({
      slateDate: entry.slateDate,
      phase: entry.phase,
    })),
    tracked0707: countTrackedPropsByDate("2026-07-07"),
    activeResultsSlateDate: meta.activeResultsSlateDate,
    currentLabSlateDate: meta.currentLabSlateDate,
    historySlateDates: [...(meta.historySlateDates || [])],
  };
}

function rebuildArchivedSlateFromSnapshot(slateDate) {
  const date = String(slateDate || "");
  if (!date) {
    return { ok: false, message: "Missing slateDate" };
  }

  const snapshot = getLockedSnapshot(date);
  const report = getDailySlateReport(date);
  const props = snapshot?.props?.length ? snapshot.props : [];

  if (!props.length) {
    const existing = getHistoryArchive(date);
    if (existing?.props?.length) {
      return archiveSlate(date, { report: report || existing.report || null });
    }
    return {
      ok: false,
      skipped: true,
      slateDate: date,
      reason: "no_snapshot_or_archive_props",
    };
  }

  return archiveSlate(date, {
    props,
    report: report || null,
  });
}

/**
 * Erase History archives + registry rows, then rebuild ARCHIVED slates from snapshots.
 * Preserves tracked props and ACTIVE Results cohort (e.g. 07/07).
 */
export function resetHistoryArchives(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const rebuildReports = options.rebuildReports !== false;
  const archiveStuck0621 = options.archiveStuck0621 !== false;
  const rebuildArchiveDates = Array.isArray(options.rebuildArchiveDates)
    ? options.rebuildArchiveDates.map(String)
    : [TARGET_ARCHIVE_DATE];
  const backupReason = String(
    options.backupReason || "pre-history-archives-reset-v1"
  );

  const before = capturePreResetState();
  const preserveDates = new Set(
    [before.activeResultsSlateDate].filter(Boolean).map(String)
  );

  if (dryRun) {
    const wouldDeleteArchives = before.archiveDates.filter(
      (slateDate) => !preserveDates.has(slateDate)
    );
    const wouldRemoveRegistry = before.registrySlates.filter((entry) => {
      const phase = String(entry.phase || "").toUpperCase();
      if (preserveDates.has(entry.slateDate)) return false;
      return phase === "ARCHIVED" || phase === "LAB";
    });

    return {
      ok: true,
      dryRun: true,
      backupId: null,
      before,
      wouldDeleteArchives,
      wouldRemoveRegistry,
      wouldRebuildArchiveDates: rebuildArchiveDates,
      wouldArchiveStuck0621: archiveStuck0621,
      wouldRebuildReports: rebuildReports,
      meta: before.meta,
    };
  }

  const backup = createBackup(backupReason);

  const clearedFiles = clearHistoryArchiveFiles({
    preserveDates: [...preserveDates],
  });
  const clearedRegistry = resetHistoryRegistryEntries({
    preserveDates: [...preserveDates],
  });

  const rebuilt = [];
  for (const slateDate of rebuildArchiveDates) {
    if (preserveDates.has(slateDate)) {
      rebuilt.push({
        slateDate,
        skipped: true,
        reason: "active_results_preserved",
      });
      continue;
    }
    rebuilt.push({
      slateDate,
      ...rebuildArchivedSlateFromSnapshot(slateDate),
    });
  }

  let archive0621Result = { skipped: true, reason: "archive_stuck_disabled" };
  if (archiveStuck0621) {
    archive0621Result = archiveLabSlate0621({
      backupReason: "nested-archive-lab-0621-after-history-reset",
    });
    if (!archive0621Result.ok && archive0621Result.plan?.alreadyArchived) {
      archive0621Result = {
        ok: true,
        skipped: true,
        reason: "already_archived",
        plan: archive0621Result.plan,
      };
    }
  }

  let rotationRepair = { skipped: true, reason: "not_run" };
  rotationRepair = repairLabSlateRotation({
    rebuildReports: false,
    backupReason: "nested-lab-rotation-after-history-reset",
  });

  let rebuildSummary = { skipped: true, reason: "rebuild_disabled" };
  if (rebuildReports) {
    rebuildSummary = buildDailySlateReportsFromTrackedProps(getTrackedProps()).summary;
  }

  const after = capturePreResetState();

  return {
    ok: true,
    dryRun: false,
    backupId: backup.backupId,
    before: {
      archiveDates: before.archiveDates,
      historySlateDates: before.historySlateDates,
      currentLabSlateDate: before.currentLabSlateDate,
      activeResultsSlateDate: before.activeResultsSlateDate,
      tracked0707: before.tracked0707,
    },
    clearedFiles,
    clearedRegistry,
    rebuilt,
    archive0621: archive0621Result,
    rotationRepair: {
      currentLabSlateDate: rotationRepair.currentLabSlateDate,
      historySlateDates: rotationRepair.historySlateDates,
      archived: rotationRepair.archived,
      skipped: rotationRepair.skipped,
    },
    rebuildSummary,
    after: {
      archiveDates: after.archiveDates,
      historySlateDates: after.historySlateDates,
      currentLabSlateDate: after.currentLabSlateDate,
      activeResultsSlateDate: after.activeResultsSlateDate,
      tracked0707: after.tracked0707,
      tracked0707Preserved: after.tracked0707 === before.tracked0707,
    },
    meta: {
      currentLabSlateDate: after.currentLabSlateDate,
      historySlateDates: after.historySlateDates,
      activeResultsSlateDate: after.activeResultsSlateDate,
      activeInProgressSlateDates: after.meta.activeInProgressSlateDates,
      inferredCompletedSlateDates: after.meta.inferredCompletedSlateDates,
    },
  };
}
