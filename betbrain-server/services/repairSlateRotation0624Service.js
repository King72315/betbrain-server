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
} from "./dailySlateReportService.js";
import {
  getTrackedProps,
  replaceTrackedPropsForSlate,
} from "./trackedPropService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
} from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const LAB_ARCHIVE_DATE = "2026-06-21";
export const TARGET_LAB_DATE = "2026-06-24";
export const BUNDLED_0624_RESTORE_PATH = path.join(
  __dirname,
  "..",
  "backups",
  "courteedge-repair-0624-tracked-props-slice.json"
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

export function resolve0624RestorePath(explicitPath = "") {
  const candidates = [
    String(explicitPath || "").trim(),
    String(process.env.RESTORE_0624_PROPS_FROM || "").trim(),
    BUNDLED_0624_RESTORE_PATH,
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return "";
}

export function preview0624Restore(trackedProps = getTrackedProps(), restorePath = "") {
  const resolvedPath = resolve0624RestorePath(restorePath);
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
    existing0624Count: countPropsForDate(trackedProps, TARGET_LAB_DATE),
    restoreSourceCount: sourceProps.filter(
      (prop) => String(prop.slateDate || "") === TARGET_LAB_DATE
    ).length,
    wouldMerge: toAdd.length,
    wouldAddIds: toAdd.map((prop) =>
      String(prop.id || prop.trackedId || prop.trackedKey || "")
    ),
  };
}

function mergeMissing0624Props(trackedProps = [], restorePath = "") {
  const resolvedPath = resolve0624RestorePath(restorePath);
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
  const quarantinedSlates = getQuarantinedSlatesFromRegistry?.() || [];
  return buildSlateRotationMetadata(getRawDailySlateReports(), {
    trackedProps: getTrackedProps(),
    archives: getAllHistoryArchives(),
    lockedSlates: getLockedSlatesRegistry().slates || [],
    quarantinedSlates,
    today: getTodayLocalDate(),
  });
}

export function repairSlateRotation0624(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const allowRestore0624 =
    Boolean(options.allowRestore0624) ||
    process.env.ALLOW_0624_RESTORE === "true";
  const backupReason = String(options.backupReason || "pre-slate-rotation-v1");
  const restorePath = resolve0624RestorePath(options.restorePath);

  let trackedProps = getTrackedProps();
  const before0624 = countPropsForDate(trackedProps, TARGET_LAB_DATE);
  const restorePreview = preview0624Restore(trackedProps, restorePath);
  restorePreview.allowRestore0624 = allowRestore0624;

  const archive621 = getHistoryArchive(LAB_ARCHIVE_DATE);
  const registry = getLockedSlatesRegistry();
  const archiveEntry = registry.slates?.find((s) => s.slateDate === LAB_ARCHIVE_DATE);
  const archive621Phase = String(archiveEntry?.phase || archive621?.phase || "").toUpperCase();
  const wouldArchive621 =
    Boolean(archive621?.props?.length) && archive621Phase !== "ARCHIVED";

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      backupId: null,
      before0624,
      restorePreview,
      wouldRebuild0624Report: allowRestore0624,
      wouldArchive621,
      archive621Phase: archive621Phase || null,
      restoreBlocked: !allowRestore0624,
      meta: buildPostRepairMetadata(),
    };
  }

  const backup = createBackup(backupReason);

  if (allowRestore0624 && before0624 === 0) {
    const { merged, trackedProps: mergedProps, restorePath: usedPath } = mergeMissing0624Props(
      trackedProps,
      restorePath
    );
    trackedProps = mergedProps;
    restorePreview.usedRestorePath = usedPath;
    restorePreview.merged = merged;
  } else if (before0624 === 0) {
    restorePreview.skippedRestore = true;
    restorePreview.restoreBlocked = true;
    restorePreview.restoreBlockedReason =
      "06/24 restore disabled — set ALLOW_0624_RESTORE=true to override";
  } else {
    restorePreview.skippedRestore = true;
    restorePreview.existing0624Count = before0624;
  }

  let rebuild = { skipped: true, reason: "restore_disabled" };
  if (allowRestore0624) {
    rebuild = buildDailySlateReportsFromTrackedProps(trackedProps, {
      slateDate: TARGET_LAB_DATE,
      forceRebuild: true,
    });
  }

  let archiveResult = null;
  if (wouldArchive621) {
    const report = getDailySlateReport(LAB_ARCHIVE_DATE);
    archiveResult = archiveSlate(LAB_ARCHIVE_DATE, { report });
  }

  const meta = buildPostRepairMetadata();

  return {
    ok: true,
    dryRun: false,
    backupId: backup.backupId,
    before0624,
    restorePreview,
    rebuildSummary: rebuild.summary?.slates?.[0] || rebuild.summary || rebuild,
    archive621: archiveResult || {
      skipped: true,
      reason: wouldArchive621 ? "unknown" : "already_archived_or_missing_bundle",
      phase: archive621Phase || null,
    },
    meta: {
      currentLabSlateDate: meta.currentLabSlateDate,
      historySlateDates: meta.historySlateDates,
      activeResultsSlateDate: meta.activeResultsSlateDate,
      activeInProgressSlateDates: meta.activeInProgressSlateDates,
      inferredCompletedSlateDates: meta.inferredCompletedSlateDates,
    },
  };
}
