/**
 * Append-only Lab learning backfill — postgame truth, diagnosis, aggregates.
 * Never mutates officialPropId, sealed pregameSnapshot, Results cohort, History archives, or slate membership.
 */
import { createBackup } from "./backupService.js";
import {
  getDailySlateReport,
  getRawDailySlateReports,
  upsertDailySlateReport,
} from "./dailySlateReportService.js";
import { isResolvedStatus } from "./gradeMonotonicityGuard.js";
import { attachOfficialLearningToReport } from "./officialLearningRecordBuilder.js";
import { buildOfficialPropId } from "./officialSlateService.js";
import { buildCompletePregameSnapshot } from "./pregameSnapshotBuilder.js";
import {
  enrichGradedPropForLab,
  LAB_LEARNING_VERSION,
} from "./labLearningEnrichmentService.js";
import {
  getAllHistoryArchives,
  getHistoryArchive,
  getLockedSnapshot,
  getLockedSlatesRegistry,
  getQuarantinedSlatesFromRegistry,
  isSlateLocked,
  mergeSnapshotPropsWithLiveGrades,
  patchLockedSnapshotLearningFields,
} from "./slateLockService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
} from "./slateScopeService.js";
import { getTrackedProps, writeTrackedProps } from "./trackedPropService.js";

export const LAB_LEARNING_BACKFILL_VERSION = "lab-learning-backfill-v1";

export const LAB_LEARNING_OVERLAY_FIELDS = [
  "postgameTruth",
  "actualMinutes",
  "actualFGA",
  "actualFTA",
  "actualFGPct",
  "actualTSPct",
  "teamFinalScore",
  "opponentFinalScore",
  "finalMargin",
  "closingLine",
  "closingLineValue",
  "lockLine",
  "missType",
  "missSubtype",
  "calibrationLesson",
  "modulesHelped",
  "modulesHurt",
  "modulesNeutral",
  "labCounterfactual",
  "labLearningVersion",
];

function pickLearningOverlay(enriched = {}) {
  const patch = {};
  for (const key of LAB_LEARNING_OVERLAY_FIELDS) {
    if (enriched[key] !== undefined) {
      patch[key] = enriched[key];
    }
  }
  return patch;
}

function appendInitialFreezeIfMissing(prop = {}, slateDate = "") {
  const next = { ...prop };
  if (!next.officialPropId) {
    next.officialPropId = buildOfficialPropId(next, slateDate);
  }
  if (!next.pregameSnapshot?.sealedAt) {
    next.pregameSnapshot = buildCompletePregameSnapshot(next, {
      slateDate,
      sealedAt:
        next.officialSealedAt ||
        next.lockedAt ||
        next.sealedAt ||
        new Date().toISOString(),
    });
  }
  return next;
}

function resolveLabReport(slateDate) {
  const filtered = getDailySlateReport(slateDate);
  if (filtered) {
    return { report: filtered, source: "filtered" };
  }

  const raw = getRawDailySlateReports().find(
    (report) => String(report.slateDate || "") === slateDate
  );
  if (raw) {
    return { report: raw, source: "raw" };
  }

  const archive = getHistoryArchive(slateDate);
  if (archive?.report) {
    return { report: archive.report, source: "history_archive" };
  }

  return { report: null, source: null };
}

function buildMinimalLabReportShell(slateDate, slateProps = []) {
  const graded = slateProps.filter((prop) => isResolvedStatus(prop.status));
  const pending = slateProps.length - graded.length;
  const now = new Date().toISOString();

  return {
    slateDate,
    status: pending === 0 && slateProps.length > 0 ? "final" : "in-progress",
    reportStatus: pending === 0 && slateProps.length > 0 ? "final" : "in-progress",
    frozen: pending === 0 && slateProps.length > 0,
    generatedAt: now,
    updatedAt: now,
    sections: {
      A: {
        title: "Slate Summary",
        slateDate,
        reportStatus: pending === 0 && slateProps.length > 0 ? "final" : "in-progress",
        totalOfficialProps: slateProps.length,
        totalTrackedProps: slateProps.length,
        pending,
        graded: graded.length,
      },
    },
    labLearningBackfillSource: "minimal_shell_v1",
  };
}

function propKey(prop = {}) {
  return String(prop.trackedKey || prop.trackedId || prop.officialPropId || "");
}

function assertFreezePreserved(before = {}, after = {}) {
  if (before.officialPropId && after.officialPropId !== before.officialPropId) {
    throw new Error(
      `officialPropId mutation blocked (${before.officialPropId} -> ${after.officialPropId})`
    );
  }
  if (before.pregameSnapshot?.sealedAt) {
    const beforeJson = JSON.stringify(before.pregameSnapshot);
    const afterJson = JSON.stringify(after.pregameSnapshot);
    if (beforeJson !== afterJson) {
      throw new Error("sealed pregameSnapshot mutation blocked");
    }
  }
}

/**
 * Re-enrich one graded prop; preserve officialPropId + sealed pregame snapshot.
 */
export function reEnrichPropPreservingFreeze(prop = {}) {
  if (!isResolvedStatus(prop.status)) {
    return { prop, skipped: true, reason: "not_graded" };
  }

  const frozenOfficialPropId = prop.officialPropId;
  const frozenPregame = prop.pregameSnapshot;
  const enriched = enrichGradedPropForLab(prop);
  const next = {
    ...prop,
    ...pickLearningOverlay(enriched),
  };

  if (frozenOfficialPropId) next.officialPropId = frozenOfficialPropId;
  if (frozenPregame) next.pregameSnapshot = frozenPregame;

  assertFreezePreserved(prop, next);
  return { prop: next, skipped: false, enriched: true };
}

export function resolveCurrentLabSlateDate(trackedProps = getTrackedProps()) {
  const rotation = buildSlateRotationMetadata(getRawDailySlateReports(), {
    trackedProps,
    archives: getAllHistoryArchives(),
    lockedSlates: getLockedSlatesRegistry().slates || [],
    quarantinedSlates: getQuarantinedSlatesFromRegistry(),
    today: getTodayLocalDate(),
  });
  return rotation.currentLabSlateDate || null;
}

function collectLabSlateProps(slateDate, trackedProps = getTrackedProps()) {
  const snapshot = getLockedSnapshot(slateDate);
  const liveSlateProps = trackedProps.filter(
    (prop) => String(prop.slateDate || "") === slateDate
  );

  if (snapshot?.props?.length) {
    return mergeSnapshotPropsWithLiveGrades(snapshot.props, liveSlateProps);
  }
  return liveSlateProps;
}

function mergeLearningIntoTrackedStore(trackedProps, slateDate, enrichedByKey, beforeByKey) {
  return trackedProps.map((prop) => {
    if (String(prop.slateDate || "") !== slateDate) return prop;
    const key = propKey(prop);
    const enriched = enrichedByKey.get(key);
    if (!enriched) return prop;

    const next = {
      ...prop,
      ...pickLearningOverlay(enriched),
    };
    if (!prop.officialPropId && enriched.officialPropId) {
      next.officialPropId = enriched.officialPropId;
    }
    if (!prop.pregameSnapshot?.sealedAt && enriched.pregameSnapshot?.sealedAt) {
      next.pregameSnapshot = enriched.pregameSnapshot;
    }
    if (prop.officialPropId) next.officialPropId = prop.officialPropId;
    if (prop.pregameSnapshot?.sealedAt) next.pregameSnapshot = prop.pregameSnapshot;
    assertFreezePreserved(beforeByKey.get(key) || prop, next);
    return next;
  });
}

function patchReportLearningLayers(existingReport, slateDate, slateProps) {
  const learning = attachOfficialLearningToReport(
    { slateDate },
    slateProps
  );

  return {
    ...existingReport,
    officialLearningRecords: learning.officialLearningRecords,
    officialLabDailySummary: learning.officialLabDailySummary,
    labAggregateBreakdown: learning.labAggregateBreakdown,
    learningPackets: learning.learningPackets,
    labLearningBackfillVersion: LAB_LEARNING_BACKFILL_VERSION,
    labLearningBackfilledAt: new Date().toISOString(),
    labLearningVersion: LAB_LEARNING_VERSION,
  };
}

/**
 * Backfill deep Lab learning layers for the current (or specified) Lab slate.
 */
export function backfillLabLearningLayers(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const trackedProps = getTrackedProps();
  const slateDate =
    options.slateDate != null
      ? String(options.slateDate)
      : resolveCurrentLabSlateDate(trackedProps);

  if (!slateDate) {
    return {
      ok: false,
      message: "No current Lab slate date found",
      dryRun,
    };
  }

  const { report: existingReport, source: reportSource } = resolveLabReport(slateDate);

  const slatePropsRaw = collectLabSlateProps(slateDate, trackedProps);
  if (!slatePropsRaw.length) {
    return {
      ok: false,
      message: `No props found for Lab slate ${slateDate}`,
      slateDate,
      dryRun,
    };
  }

  const beforeByKey = new Map(slatePropsRaw.map((prop) => [propKey(prop), { ...prop }]));
  const freezeAppended = slatePropsRaw.filter(
    (prop) => !prop.officialPropId || !prop.pregameSnapshot?.sealedAt
  ).length;
  const slateProps = slatePropsRaw.map((prop) =>
    appendInitialFreezeIfMissing(prop, slateDate)
  );

  const enrichedResults = slateProps.map((prop) => reEnrichPropPreservingFreeze(prop));
  const enrichedProps = enrichedResults.map((row) => row.prop);
  const enrichedByKey = new Map(
    enrichedProps.map((prop) => [propKey(prop), prop])
  );
  const gradedCount = enrichedResults.filter((row) => row.enriched).length;
  const skippedCount = enrichedResults.filter((row) => row.skipped).length;

  const reportBase =
    existingReport || buildMinimalLabReportShell(slateDate, slateProps);
  const mergedTracked = mergeLearningIntoTrackedStore(
    trackedProps,
    slateDate,
    enrichedByKey,
    beforeByKey
  );
  const nextReport = patchReportLearningLayers(
    reportBase,
    slateDate,
    enrichedProps
  );

  const preview = {
    slateDate,
    reportSource: reportSource || (existingReport ? "filtered" : "minimal_shell_v1"),
    propCount: slateProps.length,
    initialFreezeAppended: freezeAppended,
    gradedEnriched: gradedCount,
    skippedNotGraded: skippedCount,
    learningPacketCount: nextReport.learningPackets?.length || 0,
    hasAggregateBreakdown: Boolean(nextReport.labAggregateBreakdown),
    labLearningVersion: LAB_LEARNING_VERSION,
    lockedSnapshotPatched: isSlateLocked(slateDate),
    historyArchiveTouched: false,
    officialPropIdsPreserved: enrichedProps.every((prop, index) => {
      const before = slatePropsRaw[index];
      return !before?.officialPropId || prop.officialPropId === before.officialPropId;
    }),
    pregameSnapshotsPreserved: enrichedProps.every((prop, index) => {
      const before = slatePropsRaw[index];
      if (!before?.pregameSnapshot?.sealedAt) return true;
      return (
        JSON.stringify(prop.pregameSnapshot) ===
        JSON.stringify(before.pregameSnapshot)
      );
    }),
  };

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      backupId: null,
      preview,
      message: `Dry-run: would backfill learning layers for Lab slate ${slateDate}`,
    };
  }

  const backup = createBackup(
    String(options.backupReason || "pre-lab-learning-backfill-v1")
  );

  const nextTracked = writeTrackedProps(mergedTracked, {
    sourcePath: "backfillLabLearningLayers",
  });

  let snapshotPatch = { ok: false, skipped: true, message: "Slate not locked" };
  if (isSlateLocked(slateDate)) {
    snapshotPatch = patchLockedSnapshotLearningFields(slateDate, enrichedProps);
  }

  const reportUpsert = upsertDailySlateReport(nextReport);

  return {
    ok: true,
    dryRun: false,
    backupId: backup.backupId,
    preview,
    persistence: {
      trackedPropCount: nextTracked.length,
      slatePropsUpdated: gradedCount,
    },
    snapshotPatch,
    reportUpsert: {
      ok: reportUpsert.ok,
      slateDate: reportUpsert.report?.slateDate || slateDate,
      learningPacketCount: reportUpsert.report?.learningPackets?.length || 0,
    },
    message: `Lab learning layers backfilled for slate ${slateDate}`,
  };
}
