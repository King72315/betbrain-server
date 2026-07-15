/**
 * Phase 7 — Projection Bias Monitoring
 * Per-slate internal metrics so bias is measurable before it poisons accuracy.
 */

import { num, round, normalizeSide } from "./playerIntelligenceUtils.js";
import { getCalibrationRecords } from "./historicalCalibrationEngineV1.js";

export const PROJECTION_BIAS_MONITOR_VERSION = "projection-bias-monitor-v1";

function isResolved(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

/**
 * Compute bias metrics for a set of props (live slate or graded cohort).
 */
export function computeProjectionBiasMetrics(props = [], options = {}) {
  const rows = (props || []).map((p) => {
    const projection =
      num(p.projection) ??
      num(p.wnbaDataCard?.projection?.projection) ??
      num(p.projectionAfterProfileCalibration);
    const actual = num(p.actualStat ?? p.actualPoints ?? p.result);
    const side = normalizeSide(p.side || p.currentEngineSide || p.pick);
    const error =
      projection != null && actual != null ? projection - actual : null;
    return {
      player: p.player,
      side,
      projection,
      actual,
      error,
      absError: error != null ? Math.abs(error) : null,
      status: String(p.status || "").toLowerCase(),
      confidence: num(p.confidence ?? p.finalConfidence),
      flipped: Boolean(
        p.flipFirstAudit?.flipTriggered ||
          p.decisionDataIntelligence?.flipFirstDecision?.flipTriggered
      ),
      sameTeamConflict: Boolean(
        p.decisionDataIntelligence?.sameTeamOpportunity?.detected ||
          p.decisionDataIntelligence?.sameTeamCollision?.detected ||
          p.slateCollisionAudit
      ),
      sameTeamContradicted:
        p.decisionDataIntelligence?.sameTeamOpportunity?.status === "CONTRADICTED" ||
        (p.decisionDataIntelligence?.sameTeamCollision?.collisionScore || 0) >= 55,
    };
  });

  const withProjection = rows.filter((r) => r.projection != null);
  const graded = rows.filter((r) => isResolved(r.status) && r.actual != null);
  const withError = graded.filter((r) => r.error != null);

  const avg = (vals) =>
    vals.length
      ? round(vals.reduce((s, v) => s + v, 0) / vals.length, 3)
      : null;

  const avgProjection = avg(withProjection.map((r) => r.projection));
  const avgActual = avg(graded.map((r) => r.actual).filter((v) => v != null));
  const avgProjectionError = avg(withError.map((r) => r.error));
  const projectionBias = avgProjectionError; // signed: + over-projection

  const overProjectedPct = withError.length
    ? round(
        withError.filter((r) => r.error > 0.5).length / withError.length,
        3
      )
    : null;
  const underProjectedPct = withError.length
    ? round(
        withError.filter((r) => r.error < -0.5).length / withError.length,
        3
      )
    : null;

  const overs = rows.filter((r) => r.side === "OVER");
  const unders = rows.filter((r) => r.side === "UNDER");
  const readerOverPct = rows.length
    ? round(overs.length / rows.length, 3)
    : null;
  const readerUnderPct = rows.length
    ? round(unders.length / rows.length, 3)
    : null;

  const flipRate = rows.length
    ? round(rows.filter((r) => r.flipped).length / rows.length, 3)
    : null;
  const sameTeamConflictRate = rows.length
    ? round(rows.filter((r) => r.sameTeamConflict).length / rows.length, 3)
    : null;

  // Confidence calibration: among high-confidence props, does win rate match?
  const highConf = graded.filter((r) => (r.confidence || 0) >= 70);
  const midConf = graded.filter(
    (r) => (r.confidence || 0) >= 55 && (r.confidence || 0) < 70
  );
  const confBucket = (bucket) => {
    const decided = bucket.filter((r) => r.status === "win" || r.status === "loss");
    const wins = decided.filter((r) => r.status === "win").length;
    return {
      n: bucket.length,
      decided: decided.length,
      winRate: decided.length ? round(wins / decided.length, 3) : null,
      avgConfidence: avg(bucket.map((r) => r.confidence).filter((v) => v != null)),
    };
  };

  const confidenceCalibration = {
    high: confBucket(highConf),
    mid: confBucket(midConf),
    // Expected: high conf winRate should exceed mid; delta tracks miscalibration
    calibrationGap:
      highConf.length >= 3 && midConf.length >= 3
        ? round(
            (confBucket(highConf).winRate || 0) - (confBucket(midConf).winRate || 0),
            3
          )
        : null,
  };

  return {
    version: PROJECTION_BIAS_MONITOR_VERSION,
    slateDate: options.slateDate || null,
    generatedAt: new Date().toISOString(),
    sampleSize: rows.length,
    gradedSampleSize: graded.length,
    projectionBias,
    avgProjection,
    avgActual,
    avgProjectionError,
    overProjectionPct: overProjectedPct,
    underProjectionPct: underProjectedPct,
    readerOverPct,
    readerUnderPct,
    flipRate,
    sameTeamConflictRate,
    confidenceCalibration,
    alerts: buildBiasAlerts({
      projectionBias,
      overProjectedPct,
      readerOverPct,
      flipRate,
      confidenceCalibration,
      gradedSampleSize: graded.length,
    }),
  };
}

function buildBiasAlerts({
  projectionBias,
  overProjectedPct,
  readerOverPct,
  flipRate,
  confidenceCalibration,
  gradedSampleSize,
} = {}) {
  const alerts = [];
  if (gradedSampleSize >= 5 && projectionBias != null && Math.abs(projectionBias) >= 1.5) {
    alerts.push({
      code: "SYSTEMATIC_PROJECTION_BIAS",
      severity: Math.abs(projectionBias) >= 2.5 ? "HIGH" : "MEDIUM",
      message: `Projection bias ${projectionBias > 0 ? "+" : ""}${projectionBias} pts`,
    });
  }
  if (overProjectedPct != null && overProjectedPct >= 0.65) {
    alerts.push({
      code: "OVER_PROJECTION_RATE",
      severity: "MEDIUM",
      message: `${Math.round(overProjectedPct * 100)}% of props over-projected`,
    });
  }
  if (readerOverPct != null && readerOverPct >= 0.75) {
    alerts.push({
      code: "READER_OVER_SKEW",
      severity: "MEDIUM",
      message: `Reader Over share ${Math.round(readerOverPct * 100)}%`,
    });
  }
  if (flipRate != null && flipRate >= 0.4) {
    alerts.push({
      code: "HIGH_FLIP_RATE",
      severity: "LOW",
      message: `Flip rate ${Math.round(flipRate * 100)}%`,
    });
  }
  if (
    confidenceCalibration?.calibrationGap != null &&
    confidenceCalibration.calibrationGap < 0
  ) {
    alerts.push({
      code: "CONFIDENCE_MISCALIBRATION",
      severity: "HIGH",
      message: "High-confidence cohort underperforms mid-confidence cohort",
    });
  }
  return alerts;
}

/**
 * Build bias report for a slate date from calibration store and/or live props.
 */
export function buildProjectionBiasReport({
  slateDate = null,
  props = null,
  limit = 500,
} = {}) {
  let cohort = props;
  if (!cohort) {
    const records = getCalibrationRecords({ limit });
    cohort = slateDate
      ? records.filter((r) => String(r.slateDate) === String(slateDate))
      : records;
  }
  const metrics = computeProjectionBiasMetrics(cohort, { slateDate });
  return {
    ...metrics,
    source: props ? "props" : "calibration_store",
  };
}
