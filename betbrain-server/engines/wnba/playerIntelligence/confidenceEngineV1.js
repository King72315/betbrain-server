/**
 * Phase 3 — Confidence Engine
 * Multi-component confidence; must NOT primarily depend on projection gap.
 */

export const CONFIDENCE_ENGINE_VERSION = "player-intel-confidence-v1";

/** Suggested component weights (tunable) */
export const CONFIDENCE_WEIGHTS = Object.freeze({
  projectionQuality: 0.16,
  playerStability: 0.16,
  usageStability: 0.12,
  historicalProjectionAccuracy: 0.14,
  marketAgreement: 0.12,
  sameTeamOpportunity: 0.1,
  decisionIntelligence: 0.12,
  recentCalibration: 0.08,
});

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function scoreFromEnum(map, key, fallback = 50) {
  if (key == null) return fallback;
  return map[key] ?? fallback;
}

/**
 * Projection quality from data completeness + uncertainty — NOT gap size as primary.
 * Thin gaps still dampen when provided.
 */
export function scoreProjectionQuality({
  dataConfidence = null,
  projectionUncertainty = null,
  profileConfidence = null,
  missingFlags = [],
  projectionGap = null,
  gapFloor = null,
} = {}) {
  let score = num(dataConfidence, 55) ?? 55;
  const unc = num(projectionUncertainty, 0) ?? 0;
  score -= unc * 12;
  if ((missingFlags?.length || 0) >= 3) score -= 10;
  else if ((missingFlags?.length || 0) >= 1) score -= 4;
  const pc = num(profileConfidence, 50) ?? 50;
  score = score * 0.7 + pc * 0.3;

  const gap = num(projectionGap);
  const floor = num(gapFloor, 2.5) ?? 2.5;
  if (gap != null) {
    if (gap < floor - 1) score -= 16;
    else if (gap < floor) score -= 10;
  }
  return clamp(Math.round(score), 0, 100);
}

export function scorePlayerStability(intel = {}) {
  return scoreFromEnum(
    {
      VERY_STABLE: 92,
      STABLE: 80,
      MODERATE: 55,
      VOLATILE: 32,
      VERY_VOLATILE: 18,
    },
    intel.roleStabilityScore,
    50
  );
}

export function scoreUsageStability(intel = {}) {
  return scoreFromEnum(
    {
      LOCKED: 90,
      STABLE: 78,
      VARIABLE: 48,
      ERRATIC: 22,
    },
    intel.usageProfile,
    50
  );
}

export function scoreHistoricalAccuracy(hints = {}, fallback = 55) {
  const mae = num(hints.meanAbsError, null);
  const bias = num(hints.meanError, null);
  const n = num(hints.gradedSample, 0) ?? 0;
  if (n < 3 || mae == null) return fallback;
  // Lower MAE → higher score
  let score = 85 - mae * 8;
  if (bias != null && Math.abs(bias) >= 2) score -= Math.abs(bias) * 3;
  if (n >= 12) score += 5;
  return clamp(Math.round(score), 15, 95);
}

export function scoreMarketAgreement({
  marketQuality = null,
  bookCount = null,
  lineSpread = null,
} = {}) {
  let score = num(marketQuality, 55) ?? 55;
  const books = num(bookCount, 0) ?? 0;
  if (books >= 4) score += 10;
  else if (books >= 2) score += 5;
  else if (books <= 0) score -= 8;
  const spread = num(lineSpread, null);
  if (spread != null) {
    if (spread <= 0.5) score += 6;
    else if (spread >= 2) score -= 8;
  }
  return clamp(Math.round(score), 0, 100);
}

export function scoreSameTeamOpportunity(opportunity = null) {
  if (!opportunity || !opportunity.status) return 55;
  switch (opportunity.status) {
    case "SUPPORTED":
      return 78;
    case "QUESTIONABLE":
      return 45;
    case "CONTRADICTED":
      return 22;
    default:
      return 55;
  }
}

export function scoreDecisionIntelligence({
  evidenceScore = null,
  finalQualityScore = null,
  trueRisk = null,
  debtCount = 0,
  repairCount = 0,
} = {}) {
  let score =
    num(finalQualityScore, null) ??
    num(evidenceScore, null) ??
    55;
  score = num(score, 55) ?? 55;
  score -= (debtCount || 0) * 4;
  score += (repairCount || 0) * 2;
  const risk = num(trueRisk, null);
  if (risk != null) {
    if (risk >= 70) score -= 12;
    else if (risk <= 35) score += 6;
  }
  return clamp(Math.round(score), 0, 100);
}

export function scoreRecentCalibration(hints = {}) {
  const calScore = num(hints.recentCalibrationScore, null);
  if (calScore != null) return clamp(Math.round(calScore), 0, 100);
  const n = num(hints.gradedSample, 0) ?? 0;
  if (n < 3) return 50; // neutral until history exists
  return scoreHistoricalAccuracy(hints, 50);
}

/**
 * Compute multi-component confidence. Gap is intentionally ignored as a primary driver.
 */
export function computePlayerIntelligenceConfidence({
  playerIntelligence = null,
  dataConfidence = null,
  projectionUncertainty = null,
  missingFlags = [],
  marketQuality = null,
  bookCount = null,
  lineSpread = null,
  sameTeamOpportunity = null,
  decisionIntelligence = null,
  historicalHints = null,
  projectionGap = null,
  gapFloor = null,
  weights = CONFIDENCE_WEIGHTS,
} = {}) {
  const intel = playerIntelligence || {};
  const hints = historicalHints || intel.calibrationHints || {};
  const di = decisionIntelligence || {};

  const components = {
    projectionQuality: scoreProjectionQuality({
      dataConfidence,
      projectionUncertainty,
      profileConfidence: intel.profileConfidence,
      missingFlags,
      projectionGap,
      gapFloor,
    }),
    playerStability: scorePlayerStability(intel),
    usageStability: scoreUsageStability(intel),
    historicalProjectionAccuracy: scoreHistoricalAccuracy(hints),
    marketAgreement: scoreMarketAgreement({
      marketQuality,
      bookCount,
      lineSpread,
    }),
    sameTeamOpportunity: scoreSameTeamOpportunity(sameTeamOpportunity),
    decisionIntelligence: scoreDecisionIntelligence({
      evidenceScore: di.evidenceScore,
      finalQualityScore: di.finalQualityScore,
      trueRisk: di.trueRisk,
      debtCount: (di.riskDebtIds || di.debts || []).length,
      repairCount: (di.riskRepairIds || di.repairs || []).length,
    }),
    recentCalibration: scoreRecentCalibration(hints),
  };

  let weighted = 0;
  let weightSum = 0;
  for (const [key, w] of Object.entries(weights)) {
    if (components[key] == null) continue;
    weighted += components[key] * w;
    weightSum += w;
  }
  const composite = weightSum > 0 ? weighted / weightSum : 50;

  // Soft blend toward data confidence so lifecycle tiers stay coherent
  const dataC = num(dataConfidence, 55) ?? 55;
  const finalConfidence = clamp(
    Math.round(composite * 0.78 + dataC * 0.22),
    12,
    92
  );

  return {
    version: CONFIDENCE_ENGINE_VERSION,
    components,
    weights: { ...weights },
    compositeScore: Math.round(composite),
    finalConfidence,
    gapDependent: false,
    primaryDrivers: Object.entries(components)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => ({ component: k, score: v })),
  };
}

/**
 * Soft directional influence from multi-component confidence.
 * Caps impact so Flip-First / DDI remain owning side selection.
 */
export function confidenceEngineDirectionalDelta(confidenceResult = {}, priorDirectional = 50) {
  const target = num(confidenceResult.finalConfidence, priorDirectional) ?? priorDirectional;
  const prior = num(priorDirectional, 50) ?? 50;
  // Pull directional toward engine confidence by ≤6 pts
  const delta = clamp(Math.round((target - prior) * 0.35), -6, 6);
  return {
    delta,
    priorDirectional: prior,
    engineConfidence: target,
    after: clamp(prior + delta, 12, 92),
  };
}
