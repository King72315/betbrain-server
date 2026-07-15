/**
 * Phase 5 — Historical Calibration Engine
 * On every graded prop, store projection/actual/error + profile snapshot + decision path.
 * Use to recalibrate: volatile over-projected → increase penalties; stable outperform → reduce regression.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { num, clamp, round, normalizeSide } from "./playerIntelligenceUtils.js";
import { snapshotPlayerProfileForLab } from "./playerIntelligenceEngineV1.js";
import { updateAdaptiveProfileFromGrade } from "./playerProfileStoreV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CALIB_FILE = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "player-intelligence-calibration-v1.json"
);

export const HISTORICAL_CALIBRATION_VERSION = "historical-calibration-v1";

function readCalib() {
  try {
    if (!fs.existsSync(CALIB_FILE)) {
      return {
        version: HISTORICAL_CALIBRATION_VERSION,
        records: [],
        aggregates: {},
        learnedByProfileBucket: {},
      };
    }
    return JSON.parse(fs.readFileSync(CALIB_FILE, "utf8"));
  } catch {
    return {
      version: HISTORICAL_CALIBRATION_VERSION,
      records: [],
      aggregates: {},
      learnedByProfileBucket: {},
    };
  }
}

function writeCalib(data) {
  const payload = {
    ...data,
    version: HISTORICAL_CALIBRATION_VERSION,
    updatedAt: new Date().toISOString(),
  };
  const tmp = `${CALIB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, CALIB_FILE);
  return payload;
}

function profileBucketKey(snapshot = {}) {
  const rs = snapshot.roleStabilityScore || snapshot.roleStability || "UNKNOWN";
  const sc = snapshot.scoringProfile || snapshot.scoringVolatility || "UNKNOWN";
  const ot = snapshot.opportunityTrend || snapshot.roleDirection || "UNKNOWN";
  return `${rs}|${sc}|${ot}`;
}

/**
 * Record one graded prop into historical calibration store + adaptive profile update.
 */
export function recordGradedPropCalibration(tracked = {}, options = {}) {
  const status = String(tracked.status || "").toLowerCase();
  if (!["win", "loss", "push"].includes(status)) {
    return { recorded: false, reason: "not_resolved" };
  }

  const projection =
    num(tracked.projection) ??
    num(tracked.wnbaDataCard?.projection?.projection) ??
    num(tracked.projectionAfterProfileCalibration);
  const actual = num(tracked.actualStat ?? tracked.actualPoints ?? tracked.result);
  if (projection == null || actual == null) {
    return { recorded: false, reason: "missing_projection_or_actual" };
  }

  const projectionError = round(projection - actual, 2);
  const profile =
    tracked.playerRoleProfile ||
    tracked.wnbaDataCard?.playerRoleProfile ||
    options.profile ||
    {};
  const profileSnapshot = snapshotPlayerProfileForLab(profile, {
    playerId: tracked.playerId || profile.playerId,
    player: tracked.player,
    season: options.season || "current",
    snapshotAt: tracked.gradedAt || new Date().toISOString(),
  });

  const record = {
    id:
      tracked.id ||
      tracked.propId ||
      `${tracked.player}|${tracked.gameDate || ""}|${tracked.line}|${tracked.side}`,
    gradedAt: tracked.gradedAt || new Date().toISOString(),
    slateDate: tracked.slateDate || tracked.gameDate || null,
    player: tracked.player,
    playerId: tracked.playerId || profile.playerId || null,
    team: tracked.team || null,
    side: normalizeSide(tracked.side || tracked.currentEngineSide || tracked.pick),
    line: num(tracked.line),
    projection,
    actual,
    projectionError,
    absError: round(Math.abs(projectionError), 2),
    status,
    confidence: num(tracked.confidence ?? tracked.finalConfidence),
    risk: tracked.trueRisk || tracked.riskLabel || tracked.risk || null,
    marketQuality: num(tracked.marketQuality),
    sameTeamStatus:
      tracked.decisionDataIntelligence?.sameTeamOpportunity?.status ||
      tracked.decisionDataIntelligence?.sameTeamCollision?.opportunityStatus ||
      tracked.sameTeamOpportunity?.status ||
      null,
    decisionPath: {
      flipFirst: tracked.flipFirstAudit || tracked.decisionDataIntelligence?.flipFirstDecision || null,
      trackingGate: tracked.trackingGateResult || tracked.wnbaTrackingGate || null,
      bestSix: tracked.bestSixTier || tracked.boardRole || null,
    },
    playerProfileSnapshot: profileSnapshot,
    version: HISTORICAL_CALIBRATION_VERSION,
  };

  const store = readCalib();
  // De-dupe by id
  store.records = (store.records || []).filter((r) => r.id !== record.id);
  store.records.push(record);
  // Cap store size
  if (store.records.length > 5000) {
    store.records = store.records.slice(-5000);
  }

  recomputeAggregates(store);
  writeCalib(store);

  // Adaptive profile confidence learning
  if (record.playerId) {
    updateAdaptiveProfileFromGrade({
      playerId: record.playerId,
      season: options.season || "current",
      projectionError,
      profileSnapshot,
    });
  }

  return { recorded: true, record, aggregates: store.aggregates };
}

function recomputeAggregates(store) {
  const records = store.records || [];
  const byBucket = {};

  for (const r of records) {
    const key = profileBucketKey(r.playerProfileSnapshot || {});
    if (!byBucket[key]) {
      byBucket[key] = {
        n: 0,
        sumError: 0,
        sumAbsError: 0,
        overProjected: 0,
        underProjected: 0,
        wins: 0,
        losses: 0,
      };
    }
    const b = byBucket[key];
    b.n += 1;
    b.sumError += num(r.projectionError, 0) ?? 0;
    b.sumAbsError += num(r.absError, 0) ?? 0;
    if ((r.projectionError || 0) > 0.5) b.overProjected += 1;
    if ((r.projectionError || 0) < -0.5) b.underProjected += 1;
    if (r.status === "win") b.wins += 1;
    if (r.status === "loss") b.losses += 1;
  }

  const learned = {};
  for (const [key, b] of Object.entries(byBucket)) {
    const avgError = b.n ? b.sumError / b.n : 0;
    const mae = b.n ? b.sumAbsError / b.n : 0;
    const isVolatile = key.includes("VOLATILE") || key.includes("UNSTABLE") || key.includes("VERY_VOLATILE");
    const isStable = key.includes("VERY_STABLE") || key.startsWith("STABLE|") || key.includes("|CONSISTENT|");

    let volatilityPenaltyBoost = 0;
    let regressionDampening = 0;
    let projectionBiasOffset = 0;

    // Volatile & systematically over-projected → increase volatility penalties
    if (isVolatile && avgError > 1.5 && b.n >= 5) {
      volatilityPenaltyBoost = clamp(avgError / 8, 0.05, 0.4);
    }
    // Stable outperforming (low MAE) → reduce regression
    if (isStable && mae < 3 && b.n >= 5) {
      regressionDampening = clamp((3 - mae) / 10, 0.05, 0.3);
    }
    // Correct systematic bias (positive avgError = over-project → negative offset)
    if (b.n >= 8 && Math.abs(avgError) >= 1) {
      projectionBiasOffset = clamp(-avgError * 0.15, -0.5, 0.5);
    }

    learned[key] = {
      sampleSize: b.n,
      avgProjectionError: round(avgError, 3),
      meanAbsoluteError: round(mae, 3),
      overProjectedRate: round(b.overProjected / b.n, 3),
      underProjectedRate: round(b.underProjected / b.n, 3),
      winRate: b.wins + b.losses > 0 ? round(b.wins / (b.wins + b.losses), 3) : null,
      volatilityPenaltyBoost: round(volatilityPenaltyBoost, 3),
      regressionDampening: round(regressionDampening, 3),
      projectionBiasOffset: round(projectionBiasOffset, 3),
    };
  }

  store.aggregates = {
    totalRecords: records.length,
    globalAvgError: records.length
      ? round(
          records.reduce((s, r) => s + (num(r.projectionError, 0) ?? 0), 0) / records.length,
          3
        )
      : null,
    globalMae: records.length
      ? round(
          records.reduce((s, r) => s + (num(r.absError, 0) ?? 0), 0) / records.length,
          3
        )
      : null,
  };
  store.learnedByProfileBucket = learned;
  return store;
}

/**
 * Lookup learned calibration knobs for a live profile.
 */
export function getLearnedCalibrationForProfile(profile = {}) {
  const store = readCalib();
  const key = profileBucketKey(snapshotPlayerProfileForLab(profile));
  const learned = store.learnedByProfileBucket?.[key] || null;
  // Also try legacy-mapped key variants
  if (learned) return { ...learned, bucketKey: key };

  // Soft fallback: average of related buckets
  const partial = Object.entries(store.learnedByProfileBucket || {}).filter(([k]) =>
    k.startsWith(String(profile.roleStabilityScore || profile.roleStability || ""))
  );
  if (!partial.length) {
    return {
      bucketKey: key,
      sampleSize: 0,
      volatilityPenaltyBoost: 0,
      regressionDampening: 0,
      projectionBiasOffset: 0,
      meanAbsoluteError: null,
    };
  }
  const n = partial.reduce((s, [, v]) => s + (v.sampleSize || 0), 0);
  return {
    bucketKey: key,
    sampleSize: n,
    volatilityPenaltyBoost: round(
      partial.reduce((s, [, v]) => s + (v.volatilityPenaltyBoost || 0), 0) / partial.length,
      3
    ),
    regressionDampening: round(
      partial.reduce((s, [, v]) => s + (v.regressionDampening || 0), 0) / partial.length,
      3
    ),
    projectionBiasOffset: round(
      partial.reduce((s, [, v]) => s + (v.projectionBiasOffset || 0), 0) / partial.length,
      3
    ),
    meanAbsoluteError: round(
      partial.reduce((s, [, v]) => s + (v.meanAbsoluteError || 0), 0) / partial.length,
      3
    ),
  };
}

export function getHistoricalAccuracyForPlayer(playerId) {
  if (!playerId) return { sampleSize: 0, meanAbsoluteError: null, avgError: null };
  const store = readCalib();
  const rows = (store.records || []).filter(
    (r) => String(r.playerId) === String(playerId)
  );
  if (!rows.length) return { sampleSize: 0, meanAbsoluteError: null, avgError: null };
  const mae =
    rows.reduce((s, r) => s + (num(r.absError, 0) ?? 0), 0) / rows.length;
  const avg =
    rows.reduce((s, r) => s + (num(r.projectionError, 0) ?? 0), 0) / rows.length;
  return {
    sampleSize: rows.length,
    meanAbsoluteError: round(mae, 3),
    avgError: round(avg, 3),
  };
}

export function getCalibrationStoreSummary() {
  const store = readCalib();
  return {
    version: HISTORICAL_CALIBRATION_VERSION,
    totalRecords: store.records?.length || 0,
    aggregates: store.aggregates || {},
    learnedBucketCount: Object.keys(store.learnedByProfileBucket || {}).length,
    learnedByProfileBucket: store.learnedByProfileBucket || {},
    updatedAt: store.updatedAt || null,
    storePath: CALIB_FILE,
  };
}

export function getCalibrationRecords({ limit = 100, playerId = null } = {}) {
  const store = readCalib();
  let rows = store.records || [];
  if (playerId) rows = rows.filter((r) => String(r.playerId) === String(playerId));
  return rows.slice(-limit);
}

export function getCalibrationFilePath() {
  return CALIB_FILE;
}

/**
 * Hints for live projection/confidence — by playerId or by profile bucket.
 * Shape includes volatilityPenaltyBoost / meanAbsError for intelligence calibration.
 */
export function getCalibrationHintsForPlayer(playerIdOrProfile = null, playerName = "") {
  if (playerIdOrProfile && typeof playerIdOrProfile === "object") {
    const learned = getLearnedCalibrationForProfile(playerIdOrProfile);
    if (learned?.sampleSize) return learned;
  }
  const playerId =
    playerIdOrProfile && typeof playerIdOrProfile !== "object"
      ? playerIdOrProfile
      : playerIdOrProfile?.playerId || null;
  const hist = getHistoricalAccuracyForPlayer(playerId);
  if (!hist.sampleSize) {
    const nameKey = String(playerName || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
    if (nameKey) {
      const store = readCalib();
      const rows = (store.records || []).filter(
        (r) =>
          String(r.player || "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "") === nameKey
      );
      if (rows.length >= 3) {
        const mae =
          rows.reduce((s, r) => s + (num(r.absError, 0) ?? 0), 0) / rows.length;
        const avg =
          rows.reduce((s, r) => s + (num(r.projectionError, 0) ?? 0), 0) /
          rows.length;
        return {
          gradedSample: rows.length,
          sampleSize: rows.length,
          meanAbsError: round(mae, 3),
          meanAbsoluteError: round(mae, 3),
          meanError: round(avg, 3),
          avgProjectionError: round(avg, 3),
          volatilityPenaltyBoost: avg > 1.5 ? clamp(avg / 8, 0.05, 0.4) : 0,
          risingBoost: 0,
          decliningPenalty: 0,
          stableRegressionEase: mae < 2.5 ? 0.15 : 0,
          projectionBiasOffset: clamp(-avg * 0.15, -0.5, 0.5),
        };
      }
    }
    return null;
  }
  return {
    gradedSample: hist.sampleSize,
    sampleSize: hist.sampleSize,
    meanAbsError: hist.meanAbsoluteError,
    meanAbsoluteError: hist.meanAbsoluteError,
    meanError: hist.avgError,
    avgProjectionError: hist.avgError,
    volatilityPenaltyBoost:
      hist.avgError != null && hist.avgError > 1.5 ? 0.15 : 0,
    stableRegressionEase:
      hist.avgError != null && hist.avgError < -1 ? 0.1 : 0,
    risingBoost: 0,
    decliningPenalty: 0,
    projectionBiasOffset: 0,
  };
}
