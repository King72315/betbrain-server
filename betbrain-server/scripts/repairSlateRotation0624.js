/**
 * Runtime repair: rebuild 06/24 Lab report, archive 06/21 to History.
 * Usage: node betbrain-server/scripts/repairSlateRotation0624.js
 *
 * Optional env:
 *   RESTORE_0624_PROPS_FROM=/path/to/tracked-props.json — merge missing 06/24 props before rebuild
 */
import fs from "fs";

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
import {
  getTrackedProps,
  replaceTrackedPropsForSlate,
} from "../services/trackedPropService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
} from "../services/slateScopeService.js";
import { getAllHistoryArchives } from "../services/slateLockService.js";

const LAB_ARCHIVE_DATE = "2026-06-21";
const TARGET_LAB_DATE = "2026-06-24";

function countPropsForDate(trackedProps = [], slateDate = "") {
  return trackedProps.filter((prop) => String(prop.slateDate || "") === slateDate).length;
}

function mergeMissing0624Props(trackedProps = [], restorePath = "") {
  if (!restorePath || !fs.existsSync(restorePath)) {
    return { merged: 0, trackedProps };
  }

  const source = JSON.parse(fs.readFileSync(restorePath, "utf8"));
  const sourceProps = Array.isArray(source) ? source : source.props || [];
  const existingIds = new Set(
    trackedProps.map((prop) => String(prop.id || prop.trackedId || prop.trackedKey || ""))
  );
  const toAdd = sourceProps.filter((prop) => {
    if (String(prop.slateDate || "") !== TARGET_LAB_DATE) return false;
    const id = String(prop.id || prop.trackedId || prop.trackedKey || "");
    return id ? !existingIds.has(id) : true;
  });

  if (!toAdd.length) {
    return { merged: 0, trackedProps };
  }

  const next = [...trackedProps, ...toAdd];
  replaceTrackedPropsForSlate(TARGET_LAB_DATE, toAdd);
  return { merged: toAdd.length, trackedProps: getTrackedProps() };
}

async function main() {
  const backup = createBackup("pre-slate-rotation-v1");
  console.log("Backup created:", backup.backupId);

  let trackedProps = getTrackedProps();
  const before0624 = countPropsForDate(trackedProps, TARGET_LAB_DATE);
  if (before0624 === 0) {
    const restorePath = process.env.RESTORE_0624_PROPS_FROM || "";
    const { merged, trackedProps: mergedProps } = mergeMissing0624Props(
      trackedProps,
      restorePath
    );
    trackedProps = mergedProps;
    if (merged > 0) {
      console.log(`Restored ${merged} missing 06/24 props from ${restorePath}`);
    } else {
      console.warn(
        `WARNING: no tracked props for ${TARGET_LAB_DATE}. Rebuild will be empty unless props are restored.`
      );
      if (restorePath) {
        console.warn(`RESTORE_0624_PROPS_FROM not found or had no 06/24 rows: ${restorePath}`);
      } else {
        console.warn(
          "Set RESTORE_0624_PROPS_FROM to a backup tracked-props.json that contains 06/24 props."
        );
      }
    }
  } else {
    console.log(`06/24 props present: ${before0624}`);
  }

  const rebuild = buildDailySlateReportsFromTrackedProps(trackedProps, {
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
