import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createBackup } from "./backupService.js";
import {
  getLockedSlatesRegistry,
  getHistoryArchive,
  getLockedSnapshot,
  lockSlate,
  isSlateLocked,
  syncGradedPropsToLockedSlate,
  SLATE_PHASE,
} from "./slateLockService.js";
import {
  removeDailySlateReport,
  buildDailySlateReportsFromTrackedProps,
} from "./dailySlateReportService.js";
import {
  getTrackedProps,
  writeTrackedProps,
} from "./trackedPropService.js";
import { getActiveBestSixSnapshot } from "./topPicksSnapshotService.js";
import { getTodayLocalDate } from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DEFAULT_COHORT_SLATE = "2026-07-07";
export const DEFAULT_SPLIT_SLATE = "2026-07-08";

function historyArchivePath(slateDate) {
  return path.join(__dirname, "..", "history-archive", `${slateDate}.json`);
}

function registryPath() {
  return path.join(__dirname, "..", "locked-slates.json");
}

function readRegistry() {
  if (!fs.existsSync(registryPath())) return { slates: [] };
  return JSON.parse(fs.readFileSync(registryPath(), "utf8"));
}

function writeRegistry(registry) {
  fs.writeFileSync(registryPath(), JSON.stringify(registry, null, 2));
}

function countBySlate(tracked = [], slateDate = "") {
  return tracked.filter((prop) => String(prop.slateDate || "") === slateDate).length;
}

function isSplitCohortProp(prop = {}, cohortSlate = "", splitSlate = "") {
  const slateDate = String(prop.slateDate || "");
  if (slateDate !== splitSlate) return false;
  if (prop.controlledBestSixRank || prop.controlledBestSixDisplayTracked) return true;
  const trackedKey = String(prop.trackedKey || prop.trackedId || "");
  const cohortPrefix = cohortSlate.replace(/-/g, "");
  if (trackedKey.startsWith(`${cohortPrefix}-`)) return true;
  return false;
}

export function previewSplitResultsCohortRepair(options = {}) {
  const cohortSlate = String(options.cohortSlateDate || DEFAULT_COHORT_SLATE);
  const splitSlate = String(options.splitSlateDate || DEFAULT_SPLIT_SLATE);
  const tracked = options.trackedProps || getTrackedProps();
  const registry = options.lockedSlates || getLockedSlatesRegistry().slates || [];
  const bestSix = options.bestSixSnapshot || getActiveBestSixSnapshot();

  const splitProps = tracked.filter((prop) =>
    isSplitCohortProp(prop, cohortSlate, splitSlate)
  );
  const cohortProps = tracked.filter(
    (prop) => String(prop.slateDate || "") === cohortSlate
  );
  const cohortEntry = registry.find((entry) => entry.slateDate === cohortSlate) || null;
  const splitEntry = registry.find((entry) => entry.slateDate === splitSlate) || null;
  const archive = getHistoryArchive(cohortSlate);

  return {
    cohortSlate,
    splitSlate,
    before: {
      cohortTrackedCount: cohortProps.length,
      splitTrackedCount: splitProps.length,
      cohortGraded: cohortProps.filter((p) =>
        ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
      ).length,
      splitPending: splitProps.filter((p) =>
        String(p.status || "pending").toLowerCase() === "pending"
      ).length,
      cohortLockPhase: cohortEntry?.phase || null,
      splitLockPhase: splitEntry?.phase || null,
      bestSixSnapshotSlate: bestSix?.slateDate || null,
      bestSixPickCount: bestSix?.picks?.length || bestSix?.pickCount || 0,
      hasPrematureArchive: Boolean(archive?.props?.length),
    },
    wouldRealign: splitProps.map((prop) => ({
      player: prop.player,
      trackedKey: prop.trackedKey || prop.trackedId,
      fromSlateDate: prop.slateDate,
      toSlateDate: cohortSlate,
      status: prop.status,
      controlledBestSixRank: prop.controlledBestSixRank || null,
    })),
    wouldReopenCohortLock: cohortEntry?.phase === SLATE_PHASE.LAB,
    wouldRemoveSplitLock: splitEntry?.phase === SLATE_PHASE.ACTIVE,
    wouldClearPrematureArchive:
      Boolean(archive?.props?.length) && splitProps.length > 0,
  };
}

export function repairSplitResultsCohort(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const cohortSlate = String(options.cohortSlateDate || DEFAULT_COHORT_SLATE);
  const splitSlate = String(options.splitSlateDate || DEFAULT_SPLIT_SLATE);
  const preview = previewSplitResultsCohortRepair({
    cohortSlateDate: cohortSlate,
    splitSlateDate: splitSlate,
  });

  if (dryRun) {
    return { ok: true, dryRun: true, preview };
  }

  let backupId = null;
  try {
    const backup = createBackup(
      options.backupReason || `pre-split-cohort-repair-${cohortSlate}`
    );
    backupId = backup.backupId;
  } catch (err) {
    console.log("SPLIT COHORT REPAIR BACKUP WARNING:", err.message);
  }

  const tracked = getTrackedProps();
  const nextTracked = tracked.map((prop) => {
    if (!isSplitCohortProp(prop, cohortSlate, splitSlate)) return prop;
    return {
      ...prop,
      slateDate: cohortSlate,
      resultsSlateDate: cohortSlate,
      cohortSlateDate: cohortSlate,
    };
  });
  writeTrackedProps(nextTracked);

  const cohortProps = nextTracked.filter(
    (prop) => String(prop.slateDate || "") === cohortSlate
  );

  const registry = readRegistry();
  const cohortIndex = registry.slates.findIndex((entry) => entry.slateDate === cohortSlate);
  const splitIndex = registry.slates.findIndex((entry) => entry.slateDate === splitSlate);

  if (cohortIndex >= 0) {
    registry.slates[cohortIndex] = {
      ...registry.slates[cohortIndex],
      phase: SLATE_PHASE.ACTIVE,
      propCount: cohortProps.length,
      labPromotedAt: null,
      historyArchiveFile: null,
      finalReportAt: null,
    };
  }

  if (splitIndex >= 0 && registry.slates[splitIndex].phase === SLATE_PHASE.ACTIVE) {
    registry.slates.splice(splitIndex, 1);
  }

  writeRegistry(registry);

  const archivePath = historyArchivePath(cohortSlate);
  if (fs.existsSync(archivePath) && preview.wouldClearPrematureArchive) {
    fs.unlinkSync(archivePath);
  }

  removeDailySlateReport(cohortSlate);

  if (isSlateLocked(cohortSlate)) {
    syncGradedPropsToLockedSlate(cohortSlate, cohortProps);
  } else {
    lockSlate(cohortSlate, {
      reason: "split_cohort_repair_relock",
      autoLocked: true,
      trackedProps: cohortProps,
    });
  }

  const rebuild = buildDailySlateReportsFromTrackedProps(getTrackedProps(), {
    today: getTodayLocalDate(),
  });

  return {
    ok: true,
    dryRun: false,
    backupId,
    preview,
    after: {
      cohortTrackedCount: countBySlate(getTrackedProps(), cohortSlate),
      splitTrackedCount: countBySlate(getTrackedProps(), splitSlate),
      activeResultsSlateDate: cohortSlate,
      lockedSnapshotCount: getLockedSnapshot(cohortSlate)?.propCount || 0,
      reportSummary: rebuild.summary,
    },
  };
}
