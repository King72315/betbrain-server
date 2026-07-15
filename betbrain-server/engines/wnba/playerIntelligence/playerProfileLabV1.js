/**
 * Phase 6 — Player Profile Lab
 * Internal Lab surface: every graded prop snapshot + profile performance answers.
 * Does not change consumer Lab/History UI behavior — provides data/API for admin/internal.
 */

import {
  getCalibrationRecords,
  getCalibrationStoreSummary,
  HISTORICAL_CALIBRATION_VERSION,
} from "./historicalCalibrationEngineV1.js";
import { num, round } from "./playerIntelligenceUtils.js";

export const PLAYER_PROFILE_LAB_VERSION = "player-profile-lab-v1";

function bucketize(rows, keyFn) {
  const map = new Map();
  for (const row of rows) {
    const key = keyFn(row) || "UNKNOWN";
    if (!map.has(key)) {
      map.set(key, {
        key,
        n: 0,
        wins: 0,
        losses: 0,
        pushes: 0,
        sumError: 0,
        sumAbsError: 0,
        overProjected: 0,
        underProjected: 0,
      });
    }
    const b = map.get(key);
    b.n += 1;
    const st = String(row.status || "").toLowerCase();
    if (st === "win") b.wins += 1;
    else if (st === "loss") b.losses += 1;
    else if (st === "push") b.pushes += 1;
    b.sumError += num(row.projectionError, 0) ?? 0;
    b.sumAbsError += num(row.absError, 0) ?? 0;
    if ((row.projectionError || 0) > 0.5) b.overProjected += 1;
    if ((row.projectionError || 0) < -0.5) b.underProjected += 1;
  }
  return [...map.values()].map((b) => {
    const decided = b.wins + b.losses;
    return {
      ...b,
      winRate: decided > 0 ? round(b.wins / decided, 3) : null,
      avgProjectionError: b.n ? round(b.sumError / b.n, 3) : null,
      meanAbsoluteError: b.n ? round(b.sumAbsError / b.n, 3) : null,
      overProjectedRate: b.n ? round(b.overProjected / b.n, 3) : null,
      underProjectedRate: b.n ? round(b.underProjected / b.n, 3) : null,
      recommendation:
        b.n >= 5 && (b.sumError / b.n) > 2
          ? "INCREASE_VOLATILITY_PENALTY"
          : b.n >= 5 && (b.sumAbsError / b.n) < 2.5 && (b.wins / Math.max(1, decided)) >= 0.55
            ? "ALLOW_FASTER_GROWTH_OR_LESS_REGRESSION"
            : "MONITOR",
    };
  });
}

/**
 * Build Lab report answering:
 * which profiles win/lose/over-projected; which need larger penalties vs faster growth.
 */
export function buildPlayerProfileLabReport({ limit = 2000, slateDate = null } = {}) {
  let records = getCalibrationRecords({ limit: Math.max(limit, 5000) });
  if (slateDate) {
    records = records.filter((r) => String(r.slateDate || "") === String(slateDate));
  }
  records = records.slice(-limit);
  const summary = getCalibrationStoreSummary();

  const byRoleStability = bucketize(
    records,
    (r) => r.playerProfileSnapshot?.roleStabilityScore || r.playerProfileSnapshot?.roleStability
  );
  const byScoringProfile = bucketize(
    records,
    (r) => r.playerProfileSnapshot?.scoringProfile || r.playerProfileSnapshot?.scoringVolatility
  );
  const byUsageProfile = bucketize(
    records,
    (r) => r.playerProfileSnapshot?.usageProfile
  );
  const byOpportunityTrend = bucketize(
    records,
    (r) => r.playerProfileSnapshot?.opportunityTrend || r.playerProfileSnapshot?.roleDirection
  );
  const byAvailability = bucketize(
    records,
    (r) => r.playerProfileSnapshot?.availabilityProfile
  );
  const byConfidenceBucket = bucketize(records, (r) => {
    const c = num(r.playerProfileSnapshot?.profileConfidence, 0) ?? 0;
    if (c >= 70) return "CONF_70+";
    if (c >= 50) return "CONF_50-69";
    if (c >= 35) return "CONF_35-49";
    return "CONF_<35";
  });

  const needLargerPenalties = [...byRoleStability, ...byScoringProfile]
    .filter((b) => b.recommendation === "INCREASE_VOLATILITY_PENALTY")
    .sort((a, b) => (b.avgProjectionError || 0) - (a.avgProjectionError || 0));

  const needFasterGrowth = [...byRoleStability, ...byScoringProfile]
    .filter((b) => b.recommendation === "ALLOW_FASTER_GROWTH_OR_LESS_REGRESSION")
    .sort((a, b) => (a.meanAbsoluteError || 99) - (b.meanAbsoluteError || 99));

  return {
    version: PLAYER_PROFILE_LAB_VERSION,
    calibrationVersion: HISTORICAL_CALIBRATION_VERSION,
    generatedAt: new Date().toISOString(),
    recordCount: records.length,
    aggregates: summary.aggregates,
    learnedByProfileBucket: summary.learnedByProfileBucket,
    profiles: {
      byRoleStability,
      byScoringProfile,
      byUsageProfile,
      byOpportunityTrend,
      byAvailability,
      byConfidenceBucket,
    },
    insights: {
      needLargerPenalties: needLargerPenalties.slice(0, 12),
      needFasterGrowth: needFasterGrowth.slice(0, 12),
    },
    recentSnapshots: records.slice(-25).map((r) => ({
      player: r.player,
      projection: r.projection,
      actual: r.actual,
      projectionError: r.projectionError,
      status: r.status,
      confidence: r.confidence,
      risk: r.risk,
      sameTeamStatus: r.sameTeamStatus,
      profile: r.playerProfileSnapshot,
      decisionPath: r.decisionPath,
    })),
  };
}

/**
 * Attach lab snapshot fields onto a tracked prop at grade time (in-memory enrichment).
 */
export function attachProfileLabFieldsToTracked(tracked = {}, calibrationRecord = null) {
  const profile =
    tracked.playerRoleProfile ||
    tracked.wnbaDataCard?.playerRoleProfile ||
    calibrationRecord?.playerProfileSnapshot ||
    null;

  return {
    ...tracked,
    playerProfileLabSnapshot:
      calibrationRecord?.playerProfileSnapshot ||
      tracked.playerProfileLabSnapshot ||
      profile,
    projectionErrorAtGrade:
      calibrationRecord?.projectionError ?? tracked.projectionErrorAtGrade ?? null,
    historicalCalibrationVersion: HISTORICAL_CALIBRATION_VERSION,
    playerProfileLabVersion: PLAYER_PROFILE_LAB_VERSION,
  };
}
