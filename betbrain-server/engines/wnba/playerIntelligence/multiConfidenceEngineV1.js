/**
 * Phase 3 — Multi-component Confidence Engine
 * Confidence must NOT primarily depend on projection gap.
 * Each component contributes independently.
 */

import { num, clamp, round, normalizeSide } from "./playerIntelligenceUtils.js";

export const MULTI_CONFIDENCE_VERSION = "multi-confidence-v1";

/** Suggested weights (tunable). Gap is deliberately small. */
export const CONFIDENCE_WEIGHTS = Object.freeze({
  projectionQuality: 0.16,
  playerStability: 0.16,
  usageStability: 0.12,
  historicalProjectionAccuracy: 0.14,
  marketAgreement: 0.14,
  sameTeamOpportunity: 0.08,
  decisionIntelligence: 0.12,
  recentCalibration: 0.08,
});

function scoreProjectionQuality({ projectionGap, projectionQualityStatus, dataConfidence } = {}) {
  let score = 55;
  const status = String(projectionQualityStatus || "").toUpperCase();
  if (status === "STRONG") score = 78;
  else if (status === "MIXED") score = 55;
  else if (status === "WEAK") score = 32;

  // Gap may contribute lightly — never dominate
  const gap = num(projectionGap);
  if (gap != null) {
    if (gap >= 4) score += 6;
    else if (gap >= 2.5) score += 3;
    else if (gap <= 1) score -= 4;
  }
  const dc = num(dataConfidence);
  if (dc != null) score = score * 0.7 + dc * 0.3;
  return clamp(Math.round(score), 0, 100);
}

function scorePlayerStability(profile = {}) {
  const rs = profile.roleStabilityScore || profile.roleStability;
  const map = {
    VERY_STABLE: 92,
    STABLE: 80,
    MODERATE: 55,
    VOLATILE: 32,
    VERY_VOLATILE: 18,
    UNSTABLE: 28,
  };
  let score = map[rs] ?? 50;
  const conf = num(profile.profileConfidence);
  if (conf != null) score = Math.round(score * 0.75 + conf * 0.25);
  return clamp(score, 0, 100);
}

function scoreUsageStability(profile = {}) {
  const u = profile.usageProfile || profile.shotVolumeStability;
  const map = {
    LOCKED: 90,
    STABLE: 78,
    VARIABLE: 48,
    ERRATIC: 22,
    UNSTABLE: 25,
    MODERATE: 55,
  };
  return map[u] ?? 50;
}

function scoreHistoricalAccuracy(hist = {}) {
  const mae = num(hist.meanAbsoluteError ?? hist.avgAbsError);
  const n = num(hist.sampleSize, 0) ?? 0;
  if (n < 3 || mae == null) return 50; // neutral when unknown
  // MAE 2 → ~85, MAE 5 → ~55, MAE 8 → ~30
  let score = 95 - mae * 10;
  if (n < 5) score = 50 + (score - 50) * 0.5;
  return clamp(Math.round(score), 0, 100);
}

function scoreMarketAgreement({ marketQuality, marketWarning, marketSideImpact, side } = {}) {
  let score = num(marketQuality, 55) ?? 55;
  if (marketWarning) score -= 18;
  const impact = String(marketSideImpact || "").toUpperCase();
  const s = normalizeSide(side);
  if (impact && impact !== "NEUTRAL" && s) {
    if (impact === s) score += 8;
    else score -= 14;
  }
  return clamp(Math.round(score), 0, 100);
}

function scoreSameTeamOpportunity(opp = {}) {
  const status = String(opp.status || opp.opportunityStatus || "").toUpperCase();
  if (status === "SUPPORTED") return 82;
  if (status === "QUESTIONABLE") return 48;
  if (status === "CONTRADICTED") return 22;
  if (opp.detected && (opp.collisionScore || 0) >= 45) return 28;
  if (opp.detected && (opp.collisionScore || 0) >= 30) return 45;
  return 65;
}

function scoreDecisionIntelligence(ddi = {}) {
  let score = 60;
  const weak = [
    ddi.roleStability?.status === "BAD",
    ddi.usageShare?.status === "BAD",
    ddi.projectionQuality?.status === "WEAK",
    ddi.marketIntelligence?.marketWarning,
    ddi.availabilityImpact?.uncertaintyAdded,
  ].filter(Boolean).length;
  score -= weak * 10;
  if (ddi.flipFirstDecision?.flipRecommended) score += 4;
  if (ddi.flipFirstDecision?.action === "BOTH_SIDES_WEAK") score -= 25;
  const infl = num(ddi.finalInfluence?.confidenceAdjustment);
  if (infl != null) score += clamp(infl, -20, 10);
  return clamp(Math.round(score), 0, 100);
}

function scoreRecentCalibration(calib = {}) {
  const bias = num(calib.projectionBias ?? calib.avgProjectionError);
  const confCal = num(calib.confidenceCalibrationScore);
  if (confCal != null) return clamp(Math.round(confCal), 0, 100);
  if (bias == null) return 55;
  // Near-zero bias is good; large systematic over-projection is bad
  return clamp(Math.round(90 - Math.abs(bias) * 12), 0, 100);
}

/**
 * Compute multi-component confidence. Returns final + component breakdown.
 */
export function computeMultiComponentConfidence({
  profile = {},
  projectionGap = null,
  projectionQualityStatus = null,
  dataConfidence = null,
  historicalAccuracy = {},
  market = {},
  sameTeamOpportunity = {},
  decisionDataIntelligence = {},
  recentCalibration = {},
  side = "",
  priorRawConfidence = null,
} = {}) {
  const components = {
    projectionQuality: scoreProjectionQuality({
      projectionGap,
      projectionQualityStatus,
      dataConfidence,
    }),
    playerStability: scorePlayerStability(profile),
    usageStability: scoreUsageStability(profile),
    historicalProjectionAccuracy: scoreHistoricalAccuracy(historicalAccuracy),
    marketAgreement: scoreMarketAgreement({ ...market, side }),
    sameTeamOpportunity: scoreSameTeamOpportunity(sameTeamOpportunity),
    decisionIntelligence: scoreDecisionIntelligence(decisionDataIntelligence),
    recentCalibration: scoreRecentCalibration(recentCalibration),
  };

  let weighted = 0;
  let weightSum = 0;
  const breakdown = [];
  for (const [key, weight] of Object.entries(CONFIDENCE_WEIGHTS)) {
    const value = components[key] ?? 50;
    weighted += value * weight;
    weightSum += weight;
    breakdown.push({ component: key, weight, score: value });
  }

  let blended = weightSum > 0 ? weighted / weightSum : 50;

  // Soft blend with prior raw signal if present (does not re-center on gap)
  const prior = num(priorRawConfidence);
  if (prior != null) {
    blended = blended * 0.75 + prior * 0.25;
  }

  const finalConfidence = clamp(Math.round(blended), 20, 95);

  return {
    version: MULTI_CONFIDENCE_VERSION,
    finalConfidence,
    components,
    breakdown,
    weights: { ...CONFIDENCE_WEIGHTS },
    gapWasPrimaryDriver: false,
    reasons: breakdown
      .filter((b) => b.score <= 40 || b.score >= 80)
      .map((b) =>
        b.score <= 40
          ? `Weak ${b.component} (${b.score})`
          : `Strong ${b.component} (${b.score})`
      )
      .slice(0, 8),
  };
}

/**
 * Apply multi-confidence as a refinement on an existing pick confidence path.
 * Does not replace lifecycle — only adjusts the numeric confidence with audit.
 */
export function applyMultiConfidenceToPick(pick = {}, options = {}) {
  const profile =
    options.profile ||
    pick.playerRoleProfile ||
    pick.wnbaDataCard?.playerRoleProfile ||
    {};
  const ddi = options.decisionDataIntelligence || pick.decisionDataIntelligence || {};
  const result = computeMultiComponentConfidence({
    profile,
    projectionGap: options.projectionGap ?? pick.projectionGap,
    projectionQualityStatus: ddi.projectionQuality?.status,
    dataConfidence:
      options.dataConfidence ?? pick.dataConfidence ?? pick.wnbaDataCard?.dataConfidenceScore,
    historicalAccuracy: options.historicalAccuracy || pick.historicalAccuracy || {},
    market: {
      marketQuality: pick.marketQuality ?? pick.wnbaDataCard?.marketQuality,
      marketWarning: ddi.marketIntelligence?.marketWarning,
      marketSideImpact: ddi.marketIntelligence?.sideImpact,
    },
    sameTeamOpportunity:
      options.sameTeamOpportunity ||
      ddi.sameTeamOpportunity ||
      ddi.sameTeamCollision ||
      {},
    decisionDataIntelligence: ddi,
    recentCalibration: options.recentCalibration || {},
    side: options.side || pick.side || pick.pick,
    priorRawConfidence: options.priorRawConfidence ?? pick.rawWinProbability ?? pick.confidence,
  });

  return {
    ...pick,
    multiComponentConfidence: result,
    multiConfidenceVersion: MULTI_CONFIDENCE_VERSION,
    // Preserve prior confidence fields; expose refined value under audit-friendly keys.
    // Callers that opt-in can overwrite confidence = finalConfidence.
    refinedConfidence: result.finalConfidence,
    confidenceComponents: result.components,
  };
}
