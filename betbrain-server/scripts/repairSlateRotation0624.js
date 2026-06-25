/**
 * Runtime repair: rebuild 06/24 Lab report, archive 06/21 to History.
 * Usage: node betbrain-server/scripts/repairSlateRotation0624.js
 */
import { createBackup } from "../services/backupService.js";
import {
  archiveSlate,
  getHistoryArchive,
  getLockedSlatesRegistry,
} from "../services/slateLockService.js";
import {
  buildDailySlateReportsFromTrackedProps,
  getDailySlateReport,
  getRawDailySlateReports,
} from "../services/dailySlateReportService.js";
import { getTrackedProps } from "../services/trackedPropService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
} from "../services/slateScopeService.js";
import { getAllHistoryArchives } from "../services/slateLockService.js";

const LAB_ARCHIVE_DATE = "2026-06-21";
const TARGET_LAB_DATE = "2026-06-24";

async function main() {
  const backup = createBackup("pre-slate-rotation-v1");
  console.log("Backup created:", backup.backupId);

  const rebuild = buildDailySlateReportsFromTrackedProps(getTrackedProps(), {
    slateDate: TARGET_LAB_DATE,
    forceRebuild: true,
  });
  console.log("Rebuild 06/24:", rebuild.summary?.slates?.[0] || rebuild.summary);

  const archive621 = getHistoryArchive(LAB_ARCHIVE_DATE);
  if (archive621?.props?.length) {
    const registry = getLockedSlatesRegistry();
    const entry = registry.slates?.find((s) => s.slateDate === LAB_ARCHIVE_DATE);
    if (entry && String(entry.phase || "").toUpperCase() !== "ARCHIVED") {
      const report = getDailySlateReport(LAB_ARCHIVE_DATE);
      const archived = archiveSlate(LAB_ARCHIVE_DATE, { report });
      console.log("Archive 06/21:", archived.message);
    } else {
      console.log("06/21 already ARCHIVED — skipped");
    }
  } else {
    console.log("06/21 archive bundle missing — skipped archiveSlate");
  }

  const meta = buildSlateRotationMetadata(getRawDailySlateReports(), {
    trackedProps: getTrackedProps(),
    archives: getAllHistoryArchives(),
    lockedSlates: getLockedSlatesRegistry().slates || [],
    today: getTodayLocalDate(),
  });

  console.log("\nPost-repair rotation:");
  console.log({
    currentLabSlateDate: meta.currentLabSlateDate,
    historySlateDates: meta.historySlateDates,
    activeResultsSlateDate: meta.activeResultsSlateDate,
    activeInProgressSlateDates: meta.activeInProgressSlateDates,
    inferredCompletedSlateDates: meta.inferredCompletedSlateDates,
  });

  return { backupId: backup.backupId, meta };
}

main().catch((error) => {
  console.error("Repair failed:", error);
  process.exit(1);
});
