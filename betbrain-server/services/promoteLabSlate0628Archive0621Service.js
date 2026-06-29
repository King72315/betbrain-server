import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createBackup } from "./backupService.js";
import {
  archiveSlate,
  getAllHistoryArchives,
  getHistoryArchive,
  getLockedSlatesRegistry,
  getQuarantinedSlatesFromRegistry,
} from "./slateLockService.js";
import {
  buildDailySlateReportsFromTrackedProps,
  getDailySlateReport,
  getRawDailySlateReports,
  rotateStaleLabArchives,
} from "./dailySlateReportService.js";
import {
  getTrackedProps,
  replaceTrackedPropsForSlate,
  resolveTrackedProps,
} from "./trackedPropService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
} from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LAB_ARCHIVE_DATE = "2026-06-21";
export const TARGET_LAB_DATE = "2026-06-28";
export const BUNDLED_0628_RESTORE_PATH = path.join(
  __dirname,
  "..",
  "backups",
  "courteedge-repair-0628-tracked-props-slice.json"
);

function countPropsForDate(trackedProps = [], slateDate = "") {
  return trackedProps.filter((prop) => String(prop.slateDate || "") === slateDate).length;
}

function readPropsFromRestoreFile(restorePath = "") {
  if (!restorePath || !fs.existsSync(restorePath)) {
    return [];
  }

  const source = JSON.parse(fs.readFileSync(restorePath, "utf8"));
  return Array.isArray(source) ? source : source.props || [];
}

export function resolve0628RestorePath(explicitPath = "") {
  const candidates = [
    String(explicitPath || "").trim(),
    String(process.env.RESTORE_0628_PROPS_FROM || "").trim(),
    BUNDLED_0628_RESTORE_PATH,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

export function preview0628Restore(trackedProps = getTrackedProps(), restorePath = "") {
  const resolvedPath = resolve0628RestorePath(restorePath);
  const sourceProps = readPropsFromRestoreFile(resolvedPath);
  const existingIds = new Set(
    trackedProps.map((prop) => String(prop.id || prop.trackedId || prop.trackedKey || ""))
  );
  const toAdd = sourceProps.filter((prop) => {
    if (String(prop.slateDate || "") !== TARGET_LAB_DATE) return false;
    const id = String(prop.id || prop.trackedId || prop.trackedKey || "");
    return id ? !existingIds.has(id) : true;
  });

  return {
    restorePath: resolvedPath,
    existing0628Count: countPropsForDate(trackedProps, TARGET_LAB_DATE),
    restoreSourceCount: sourceProps.filter(
      (prop) => String(prop.slateDate || "") === TARGET_LAB_DATE
    ).length,
    wouldMerge: toAdd.length,
    wouldAddIds: toAdd.map((prop) =>
      String(prop.id || prop.trackedId || prop.trackedKey || "")
    ),
  };
}

function mergeMissing0628Props(trackedProps = [], restorePath = "") {
  const resolvedPath = resolve0628RestorePath(restorePath);
  const sourceProps = readPropsFromRestoreFile(resolvedPath);
  const existingIds = new Set(
    trackedProps.map((prop) => String(prop.id || prop.trackedId || prop.trackedKey || ""))
  );
  const toAdd = sourceProps.filter((prop) => {
    if (String(prop.slateDate || "") !== TARGET_LAB_DATE) return false;
    const id = String(prop.id || prop.trackedId || prop.trackedKey || "");
    return id ? !existingIds.has(id) : true;
  });

  if (!toAdd.length) {
    return { merged: 0, trackedProps, restorePath: resolvedPath };
  }

  replaceTrackedPropsForSlate(TARGET_LAB_DATE, toAdd);
  return { merged: toAdd.length, trackedProps: getTrackedProps(), restorePath: resolvedPath };
}

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
 * Safe runtime repair: merge 06/28 Best 6 props if missing, grade, build Lab report,
 * archive 06/21 to History. Does not clear tracked props.
 */
export async function promoteLabSlate0628Archive0621(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const skipResolve = Boolean(options.skipResolve);
  const backupReason = String(
    options.backupReason || "pre-promote-lab-0628-archive-0621-v1"
  );
  const restorePath = resolve0628RestorePath(options.restorePath);

  let trackedProps = getTrackedProps();
  const before0628 = countPropsForDate(trackedProps, TARGET_LAB_DATE);
  const restorePreview = preview0628Restore(trackedProps, restorePath);

  const archive621 = getHistoryArchive(LAB_ARCHIVE_DATE);
  const registry = getLockedSlatesRegistry();
  const archiveEntry = registry.slates?.find((s) => s.slateDate === LAB_ARCHIVE_DATE);
  const archive621Phase = String(
    archiveEntry?.phase || archive621?.phase || ""
  ).toUpperCase();
  const wouldArchive621 =
    Boolean(archive621?.props?.length || archiveEntry) &&
    archive621Phase !== "ARCHIVED";

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      backupId: null,
      before0628,
      restorePreview,
      wouldArchive621,
      archive621Phase: archive621Phase || null,
      meta: buildPostRepairMetadata(),
    };
  }

  const backup = createBackup(backupReason);

  if (before0628 === 0) {
    const { merged, trackedProps: mergedProps, restorePath: usedPath } =
      mergeMissing0628Props(trackedProps, restorePath);
    trackedProps = mergedProps;
    restorePreview.usedRestorePath = usedPath;
    restorePreview.merged = merged;
    if (merged === 0) {
      restorePreview.skippedRestore = true;
      restorePreview.restoreBlockedReason =
        "No 06/28 props in store and bundled slice missing or empty — run capture0628TrackedPropsSlice.js first";
    }
  } else {
    restorePreview.skippedRestore = true;
    restorePreview.existing0628Count = before0628;
  }

  let resolveSummary = { skipped: true, reason: "resolve_disabled" };
  if (!skipResolve && countPropsForDate(getTrackedProps(), TARGET_LAB_DATE) > 0) {
    const resolved = await resolveTrackedProps({ requireLikelyFinished: true });
    resolveSummary = resolved.summary;
    trackedProps = resolved.props;
  }

  let rebuild = { skipped: true, reason: "no_0628_props" };
  if (countPropsForDate(getTrackedProps(), TARGET_LAB_DATE) > 0) {
    rebuild = buildDailySlateReportsFromTrackedProps(getTrackedProps(), {
      slateDate: TARGET_LAB_DATE,
      forceRebuild: true,
    });
  }

  let archiveResult = null;
  if (wouldArchive621) {
    const report = getDailySlateReport(LAB_ARCHIVE_DATE);
    archiveResult = archiveSlate(LAB_ARCHIVE_DATE, { report });
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
    before0628,
    after0628: countPropsForDate(getTrackedProps(), TARGET_LAB_DATE),
    restorePreview,
    resolveSummary,
    rebuildSummary: rebuild.summary?.slates || rebuild.summary || rebuild,
    archive621: archiveResult || {
      skipped: true,
      reason: wouldArchive621 ? "unknown" : "already_archived_or_missing_bundle",
      phase: archive621Phase || null,
    },
    rotation: rotationResult,
    meta: {
      currentLabSlateDate: meta.currentLabSlateDate,
      historySlateDates: meta.historySlateDates,
      activeResultsSlateDate: meta.activeResultsSlateDate,
      activeInProgressSlateDates: meta.activeInProgressSlateDates,
      inferredCompletedSlateDates: meta.inferredCompletedSlateDates,
    },
  };
}
