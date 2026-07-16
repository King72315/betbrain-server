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
import {
  enrichGradedPropForLab,
  LAB_LEARNING_VERSION,
} from "./labLearningEnrichmentService.js";
import {
  getAllHistoryArchives,
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

function mergeLearningIntoTrackedStore(trackedProps, slateDate, enrichedByKey) {
  return trackedProps.map((prop) => {
    if (String(prop.slateDate || "") !== slateDate) return prop;
    const key = propKey(prop);
    const enriched = enrichedByKey.get(key);
    if (!enriched) return prop;

    const next = {
      ...prop,
      ...pickLearningOverlay(enriched),
    };
    if (prop.officialPropId) next.officialPropId = prop.officialPropId;
    if (prop.pregameSnapshot) next.pregameSnapshot = prop.pregameSnapshot;
    assertFreezePreserved(prop, next);
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

  const existingReport = getDailySlateReport(slateDate);
  if (!existingReport) {
    return {
      ok: false,
      message: `No daily slate report found for Lab slate ${slateDate}`,
      slateDate,
      dryRun,
    };
  }

  const slateProps = collectLabSlateProps(slateDate, trackedProps);
  if (!slateProps.length) {
    return {
      ok: false,
      message: `No props found for Lab slate ${slateDate}`,
      slateDate,
      dryRun,
    };
  }

  const enrichedResults = slateProps.map((prop) => reEnrichPropPreservingFreeze(prop));
  const enrichedProps = enrichedResults.map((row) => row.prop);
  const enrichedByKey = new Map(
    enrichedProps.map((prop) => [propKey(prop), prop])
  );
  const gradedCount = enrichedResults.filter((row) => row.enriched).length;
  const skippedCount = enrichedResults.filter((row) => row.skipped).length;

  const mergedTracked = mergeLearningIntoTrackedStore(
    trackedProps,
    slateDate,
    enrichedByKey
  );
  const nextReport = patchReportLearningLayers(
    existingReport,
    slateDate,
    enrichedProps
  );

  const preview = {
    slateDate,
    propCount: slateProps.length,
    gradedEnriched: gradedCount,
    skippedNotGraded: skippedCount,
    learningPacketCount: nextReport.learningPackets?.length || 0,
    hasAggregateBreakdown: Boolean(nextReport.labAggregateBreakdown),
    labLearningVersion: LAB_LEARNING_VERSION,
    lockedSnapshotPatched: isSlateLocked(slateDate),
    historyArchiveTouched: false,
    officialPropIdsPreserved: enrichedProps.every(
      (prop, index) =>
        !slateProps[index]?.officialPropId ||
        prop.officialPropId === slateProps[index].officialPropId
    ),
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
