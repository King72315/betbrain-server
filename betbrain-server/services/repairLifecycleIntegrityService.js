/**
 * Safe lifecycle integrity repair — append/enrich only, never wipe.
 */
import { createBackup } from "./backupService.js";
import { backfillLabLearningLayers } from "./backfillLabLearningLayersService.js";
import {
  buildDailySlateReportsFromTrackedProps,
  getDailySlateReport,
  getRawDailySlateReports,
} from "./dailySlateReportService.js";
import { applyMonotonicLabPointer } from "./lifecyclePointerStateService.js";
import {
  mergeMembershipWithLiveGrades,
  resolveOfficialSlateMembership,
} from "./officialSlateMembershipService.js";
import {
  archiveSlate,
  getAllHistoryArchives,
  getHistoryArchive,
  promoteSlateToLab,
  writeSlateHistoryArchive,
} from "./slateLockService.js";
import {
  buildSlateRotationMetadata,
  getTodayLocalDate,
  isCompletedSlate,
  hasUnresolvedGradingProps,
} from "./slateScopeService.js";
import { getTrackedProps } from "./trackedPropService.js";
import { isResolvedStatus } from "./gradeMonotonicityGuard.js";

export const LIFECYCLE_INTEGRITY_REPAIR_VERSION = "lifecycle-integrity-repair-v1";

function isFullyGradedOfficialSlate(slateDate, trackedProps = []) {
  const membership = resolveOfficialSlateMembership(slateDate, trackedProps);
  if (!membership.props.length) return false;
  return membership.props.every((prop) => isResolvedStatus(prop.status));
}

function pickNewestFullyGradedLabCandidate(trackedProps = [], reports = []) {
  const slateDates = [
    ...new Set(
      trackedProps
        .map((p) => String(p.slateDate || ""))
        .filter(Boolean)
    ),
  ].sort((a, b) => b.localeCompare(a));

  for (const slateDate of slateDates) {
    if (!isFullyGradedOfficialSlate(slateDate, trackedProps)) continue;
    const report =
      getDailySlateReport(slateDate) ||
      getRawDailySlateReports().find((r) => r.slateDate === slateDate);
    if (report && !isCompletedSlate(report)) continue;
    return slateDate;
  }
  return null;
}

export function auditLifecycleIntegrity(options = {}) {
  const trackedProps = getTrackedProps();
  const reports = getRawDailySlateReports();
  const archives = getAllHistoryArchives();
  const today = getTodayLocalDate();
  const rotation = buildSlateRotationMetadata(reports, {
    trackedProps,
    archives,
    lockedSlates: [],
    quarantinedSlates: [],
    today,
    allowRepairForward: true,
  });

  const focus = ["2026-07-14", "2026-07-15", "2026-07-16"];
  const slates = focus.map((slateDate) => {
    const membership = resolveOfficialSlateMembership(slateDate, trackedProps);
    const report = getDailySlateReport(slateDate);
    const archive = getHistoryArchive(slateDate);
    return {
      slateDate,
      membershipSource: membership.source,
      officialPropCount: membership.propCount,
      officialPropIds: membership.officialPropIds,
      graded: membership.props.filter((p) => isResolvedStatus(p.status)).length,
      pending: membership.props.filter((p) => !isResolvedStatus(p.status)).length,
      reportExists: Boolean(report),
      reportPropCount: report?.totalProps ?? report?.sections?.A?.totalTrackedProps ?? null,
      learningPacketCount: report?.learningPackets?.length ?? 0,
      archivePhase: archive?.phase || null,
      fullyGraded: isFullyGradedOfficialSlate(slateDate, trackedProps),
    };
  });

  return {
    ok: true,
    version: LIFECYCLE_INTEGRITY_REPAIR_VERSION,
    currentLabSlateDate: rotation.currentLabSlateDate,
    historySlateDates: rotation.historySlateDates,
    recommendedLabSlateDate: pickNewestFullyGradedLabCandidate(trackedProps, reports),
    slates,
    rotationDecisionDebug: rotation.rotationDecisionDebug,
  };
}

export function repairLifecycleIntegrity(options = {}) {
  const dryRun = Boolean(options.dryRun);
  const trackedProps = getTrackedProps();
  const reports = getRawDailySlateReports();
  const archives = getAllHistoryArchives();
  const today = getTodayLocalDate();

  const targetLab =
    options.targetLabSlateDate ||
    pickNewestFullyGradedLabCandidate(trackedProps, reports);

  if (!targetLab) {
    return {
      ok: false,
      message: "No fully graded official slate found for Lab repair",
      dryRun,
    };
  }

  if (
    options.targetLabSlateDate &&
    !isFullyGradedOfficialSlate(targetLab, trackedProps)
  ) {
    return {
      ok: false,
      message: `Target Lab slate ${targetLab} is not fully graded — cannot promote to Lab`,
      dryRun,
      targetLabSlateDate: targetLab,
    };
  }

  const before = auditLifecycleIntegrity();

  const preview = {
    targetLabSlateDate: targetLab,
    priorLabSlateDate: before.currentLabSlateDate,
    historyAfter: [
      ...new Set([
        ...(before.historySlateDates || []),
        before.currentLabSlateDate,
      ]),
    ]
      .filter((d) => d && d !== targetLab)
      .sort((a, b) => b.localeCompare(a)),
    slatesToRebuild: [targetLab, before.currentLabSlateDate].filter(Boolean),
  };

  if (dryRun) {
    return { ok: true, dryRun: true, before, preview };
  }

  const backup = createBackup(
    String(options.backupReason || "pre-lifecycle-integrity-repair-v1")
  );

  const rebuild = buildDailySlateReportsFromTrackedProps(trackedProps, {
    slateDate: targetLab,
    forceRebuild: true,
  });

  for (const slateDate of preview.historyAfter) {
    if (slateDate === targetLab) continue;
    const membership = mergeMembershipWithLiveGrades(
      resolveOfficialSlateMembership(slateDate, getTrackedProps()),
      getTrackedProps().filter((p) => p.slateDate === slateDate)
    );
    const report = getDailySlateReport(slateDate);
    if (membership.props.length && report) {
      writeSlateHistoryArchive(slateDate, {
        props: membership.props,
        report,
      });
      archiveSlate(slateDate, {
        props: membership.props,
        report,
        phase: "ARCHIVED",
      });
    }
    backfillLabLearningLayers({ slateDate, dryRun: false });
  }

  backfillLabLearningLayers({ slateDate: targetLab, dryRun: false });

  const report = getDailySlateReport(targetLab);
  const membership = resolveOfficialSlateMembership(targetLab, getTrackedProps());
  if (report && membership.props.length) {
    promoteSlateToLab(targetLab, { report, props: membership.props });
  }

  const rotation = buildSlateRotationMetadata(getRawDailySlateReports(), {
    trackedProps: getTrackedProps(),
    archives: getAllHistoryArchives(),
    lockedSlates: [],
    quarantinedSlates: [],
    today,
    allowRepairForward: true,
  });

  applyMonotonicLabPointer(
    {
      currentLabSlateDate: targetLab,
      historySlateDates: preview.historyAfter,
    },
    { allowRepairForward: true }
  );

  const after = auditLifecycleIntegrity();

  return {
    ok: true,
    dryRun: false,
    backupId: backup.backupId,
    before,
    after,
    preview,
    rebuildSummary: rebuild.summary,
    message: `Lifecycle integrity repair applied — Lab=${targetLab}`,
  };
}
