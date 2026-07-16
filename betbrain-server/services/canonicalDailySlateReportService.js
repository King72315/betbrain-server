/**
 * Canonical Daily Slate Report schema — single API/client shape.
 */
import { createHash } from "crypto";
import { isResolvedStatus } from "./gradeMonotonicityGuard.js";

export const CANONICAL_DAILY_SLATE_REPORT_VERSION =
  "canonical-daily-slate-report-v1";

function isOfficialProp(prop = {}, officialPropIds = []) {
  if (prop.immutableOfficial === true) return true;
  if (prop.controlledBestSixDisplayTracked === true) return true;
  if (prop.controlledBestSixDisplay === true) return true;
  const explicit = String(prop.trackingType || prop.recordType || "").toUpperCase();
  if (explicit === "OFFICIAL") return true;
  if (explicit === "TEST" || explicit === "NO_BET") return false;
  if (prop.officialPropId && officialPropIds.includes(String(prop.officialPropId))) {
    return true;
  }
  if (prop.bestSixRank != null && Number(prop.bestSixRank) > 0) return true;
  return false;
}

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stableJsonHash(value) {
  try {
    return createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex")
      .slice(0, 16);
  } catch {
    return null;
  }
}

function buildRecord(props = []) {
  const graded = props.filter((prop) => isResolvedStatus(prop.status));
  const wins = graded.filter(
    (prop) => String(prop.status).toLowerCase() === "win"
  ).length;
  const losses = graded.filter(
    (prop) => String(prop.status).toLowerCase() === "loss"
  ).length;
  const pushes = graded.filter(
    (prop) => String(prop.status).toLowerCase() === "push"
  ).length;
  const decided = wins + losses;
  const margins = graded
    .map((prop) => num(prop.resultMargin ?? prop.margin))
    .filter((v) => v != null);
  const avgMargin = margins.length
    ? Number((margins.reduce((s, n) => s + n, 0) / margins.length).toFixed(2))
    : null;
  const winRate = decided > 0 ? Number(((wins / decided) * 100).toFixed(1)) : null;
  return {
    wins,
    losses,
    pushes,
    graded: graded.length,
    pending: props.length - graded.length,
    decided,
    winRate,
    averageMargin: avgMargin,
    record: `${wins}-${losses}-${pushes}`,
  };
}

export function normalizeDailySlateReport(report = {}, options = {}) {
  const sectionA = report.sections?.A || {};
  const slateDate = String(report.slateDate || sectionA.slateDate || "");
  const officialPropIds = Array.isArray(report.officialPropIds)
    ? report.officialPropIds.map(String)
    : (report.officialLearningRecords || [])
        .map((rec) => rec.officialPropId)
        .filter(Boolean);

  const learningPackets = Array.isArray(report.learningPackets)
    ? report.learningPackets
    : (report.officialLearningRecords || [])
        .map((rec) => ({
          officialPropId: rec.officialPropId,
          player: rec.player,
          ...(rec.learningPacket || {}),
        }))
        .filter((p) => p.player);

  const propsForCounts =
    options.membershipProps ||
    learningPackets.map((packet) => ({
      ...packet,
      league: packet.league || packet.pregame?.league,
      status: packet.postgame?.status || packet.postgame?.result,
      trackingType: "OFFICIAL",
      tier: packet.pregame?.tier,
      officialPropId: packet.officialPropId,
      controlledBestSixDisplayTracked: true,
    }));

  const officialProps = propsForCounts.filter((p) =>
    isOfficialProp(p, officialPropIds)
  ).length;
  const testProps = Math.max(0, propsForCounts.length - officialProps);
  const record = buildRecord(propsForCounts);

  const leagues = [
    ...new Set(
      propsForCounts
        .map((prop) => String(prop.league || prop.pregame?.league || "").toUpperCase())
        .filter(Boolean)
    ),
  ];

  const status = String(
    report.reportStatus || report.status || sectionA.reportStatus || "in-progress"
  );
  const finalReport =
    status.toLowerCase() === "final" ||
    report.frozen === true ||
    sectionA.reportStatus === "final";

  const learningAggregates =
    report.labAggregateBreakdown ||
    report.officialLabDailySummary?.aggregateBreakdown ||
    null;

  const pregameSnapshots = learningPackets
    .map((p) => p.pregame)
    .filter(Boolean);

  return {
    version: CANONICAL_DAILY_SLATE_REPORT_VERSION,
    slateDate,
    officialSlateId: report.officialSlateId || slateDate,
    status,
    final: finalReport,
    frozen: report.frozen === true,
    league: leagues,
    leagues,
    totalProps:
      num(sectionA.totalTrackedProps) ??
      num(sectionA.totalOfficialProps) ??
      propsForCounts.length,
    officialProps,
    testProps,
    graded: num(sectionA.graded, record.graded),
    pending: num(sectionA.pending, record.pending),
    wins: num(sectionA.wins, record.wins),
    losses: num(sectionA.losses, record.losses),
    pushes: num(sectionA.pushes, record.pushes),
    winRate: num(sectionA.overallWinRate, record.winRate),
    averageMargin: num(sectionA.avgMargin, record.averageMargin),
    record: record.record,
    officialPropIds,
    learningPackets,
    learningAggregates,
    signalPerformance:
      report.sections?.X || report.signalPerformance || null,
    lifecycleIntegrity: report.lifecycleIntegrity || null,
    pregameSnapshotHash: stableJsonHash(pregameSnapshots),
    reportBuild: report.reportBuild || report.serverBuild || null,
    generatedAt: report.generatedAt || null,
    updatedAt: report.updatedAt || null,
    labLearningVersion:
      report.labLearningVersion ||
      report.officialLabDailySummary?.labLearningVersion ||
      null,
    sections: report.sections || null,
    officialLabDailySummary: report.officialLabDailySummary || null,
    officialLearningRecords: report.officialLearningRecords || null,
    labAggregateBreakdown: report.labAggregateBreakdown || null,
    _canonicalSource: report._canonicalSource || "normalized",
  };
}

export function normalizeDailySlateReports(reports = [], options = {}) {
  return (Array.isArray(reports) ? reports : []).map((report) =>
    normalizeDailySlateReport(report, options)
  );
}
