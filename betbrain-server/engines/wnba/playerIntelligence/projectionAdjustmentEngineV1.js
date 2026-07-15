/**
 * Phase 2 — Projection Engine adjustments:
 * Raw → Player Profile → Volatility → Opportunity → Final
 *
 * Behavior:
 *  Stable → barely change
 *  Volatile → regress toward season average
 *  Returning → more conservative
 *  Rising / low Profile Confidence → adapt faster
 */

export const PROJECTION_ADJUSTMENT_VERSION = "projection-adjustment-v1";
export const PROJECTION_CAPS = Object.freeze({
  maxTotalMovement: 1.5,
  maxStageMovement: 0.9,
});

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const n = num(value, null);
  if (n === null || !Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function stabilityScale(roleStabilityScore) {
  switch (roleStabilityScore) {
    case "VERY_STABLE":
      return 0.08;
    case "STABLE":
      return 0.15;
    case "MODERATE":
      return 0.35;
    case "VOLATILE":
      return 0.55;
    case "VERY_VOLATILE":
      return 0.75;
    default:
      return 0.35;
  }
}

/**
 * Apply staged adjustments to a raw projection number.
 * Optional historicalHints can amplify/dampen regression from calibration.
 */
export function buildProjectionAdjustments(input = {}) {
  return applyPlayerIntelligenceProjectionAdjustments(input);
}

export function applyProjectionAdjustmentPipeline({
  rawProjection,
  seasonPointsAverage = null,
  recentPointsAverage = null,
  playerIntelligence = null,
  profile = null,
  historicalHints = null,
  learnedCalibration = null,
  maxTotalMovement = PROJECTION_CAPS.maxTotalMovement,
} = {}) {
  return applyPlayerIntelligenceProjectionAdjustments({
    rawProjection,
    seasonPointsAverage,
    recentPointsAverage,
    playerIntelligence: playerIntelligence || profile,
    historicalHints: historicalHints || learnedCalibration,
    maxTotalMovement,
  });
}

export function applyPlayerIntelligenceProjectionAdjustments({
  rawProjection,
  seasonPointsAverage = null,
  recentPointsAverage = null,
  playerIntelligence = null,
  historicalHints = null,
  maxTotalMovement = 1.5,
} = {}) {
  const raw = num(rawProjection);
  const seasonAvg = num(seasonPointsAverage, null);
  const recentAvg = num(recentPointsAverage, null);
  const intel = playerIntelligence || {};
  const hints = historicalHints || intel.calibrationHints || {};

  const conf = num(intel.profileConfidence, 50);
  const adaptationRate = num(intel.adaptationRate, clamp(1.35 - conf / 100, 0.35, 1.25));
  const volIdx = num(intel.volatilityIndex, 50);
  const role = intel.roleStabilityScore || "MODERATE";
  const trend = intel.opportunityTrend || "FLAT";
  const avail = intel.availabilityProfile || "UNKNOWN";

  let current = raw;
  const stages = [];

  // --- Stage 1: Player Profile Adjustment ---
  let profileAdj = 0;
  const regressStrength =
    stabilityScale(role) *
    (1 + num(hints.volatilityPenaltyBoost, 0)) *
    (conf < 45 ? adaptationRate : 1);

  if (seasonAvg != null && Number.isFinite(seasonAvg) && regressStrength > 0.1) {
    // Volatile → pull toward season; Stable → tiny pull
    profileAdj = (seasonAvg - raw) * regressStrength * 0.35;
  }
  // Low profile confidence: lean a bit toward recent observed (adapt faster)
  if (conf < 45 && recentAvg != null && Number.isFinite(recentAvg)) {
    profileAdj += (recentAvg - raw) * adaptationRate * 0.12;
  }
  profileAdj = clamp(profileAdj, -0.9, 0.9);
  if (num(hints.stableRegressionEase, 0) > 0 && (role === "STABLE" || role === "VERY_STABLE")) {
    profileAdj *= 1 - clamp(num(hints.stableRegressionEase), 0, 0.5);
  }
  current = round(current + profileAdj, 2);
  stages.push({ stage: "PROFILE", adjustment: round(profileAdj, 2), projection: current });

  // --- Stage 2: Volatility Adjustment ---
  let volAdj = 0;
  if (volIdx >= 70) {
    if (seasonAvg != null) {
      volAdj = (seasonAvg - current) * 0.22 * (1 + num(hints.volatilityPenaltyBoost, 0));
    }
  } else if (volIdx >= 55) {
    if (seasonAvg != null) {
      volAdj = (seasonAvg - current) * 0.1;
    }
  } else if (volIdx <= 30 && conf >= 55) {
    // Stable: barely change — slight trust of raw
    volAdj = 0;
  }
  if (intel.scoringProfile === "VOLATILE") {
    volAdj += seasonAvg != null ? (seasonAvg - current) * 0.06 : 0;
  }
  volAdj = clamp(volAdj, -0.85, 0.85);
  current = round(current + volAdj, 2);
  stages.push({ stage: "VOLATILITY", adjustment: round(volAdj, 2), projection: current });

  // --- Stage 3: Opportunity Adjustment ---
  let oppAdj = 0;
  if (trend === "RISING") {
    oppAdj += 0.25 * adaptationRate * (1 + num(hints.risingBoost, 0));
  } else if (trend === "DECLINING") {
    oppAdj -= 0.3 * (1 + num(hints.decliningPenalty, 0));
  }
  if (avail === "RETURNING") {
    oppAdj -= 0.45; // more conservative
  } else if (avail === "LIMITED") {
    oppAdj -= 0.25;
  }
  if (conf < 40 && trend === "RISING") {
    // emerging / low confidence: adapt faster toward opportunity
    oppAdj += 0.12;
  }
  oppAdj = clamp(oppAdj, -0.9, 0.7);
  current = round(current + oppAdj, 2);
  stages.push({ stage: "OPPORTUNITY", adjustment: round(oppAdj, 2), projection: current });

  // Hard safety vs raw
  let finalProjection = clamp(current, raw - maxTotalMovement, raw + maxTotalMovement);
  finalProjection = round(finalProjection, 1);

  return {
    version: PROJECTION_ADJUSTMENT_VERSION,
    rawProjection: round(raw, 1),
    finalProjection,
    totalAdjustment: round(finalProjection - raw, 2),
    stages,
    adaptationRate: round(adaptationRate, 3),
    volatilityIndex: volIdx,
    roleStabilityScore: role,
    opportunityTrend: trend,
    availabilityProfile: avail,
    profileConfidence: conf,
    applied: Math.abs(finalProjection - raw) > 0.01,
  };
}

/**
 * Translate intelligence + historical hints into calibration knobs
 * consumed by projectWnbaPoints (weight / expected volume / projectionAdjustment).
 */
export function buildIntelligenceProjectionCalibration(intel = {}, hints = {}) {
  const role = intel.roleStabilityScore || "MODERATE";
  const usage = intel.usageProfile || "VARIABLE";
  const scoring = intel.scoringProfile || "MODERATE";
  // Prefer opportunityTrend; allow legacy roleDirection to promote FLAT→RISING/DECLINING
  let trend = intel.opportunityTrend || "FLAT";
  if (trend === "FLAT") {
    if (intel.roleDirection === "EXPANDING") trend = "RISING";
    else if (intel.roleDirection === "CONTRACTING") trend = "DECLINING";
  }
  const avail = intel.availabilityProfile || "UNKNOWN";
  const conf = num(intel.profileConfidence, 50);
  const adaptationRate = num(intel.adaptationRate, 0.8);
  const volIdx = num(intel.volatilityIndex, 50);

  let recentWeightAdjustment = 0;
  let minutesTrustMultiplier = 1;
  let expectedMinutesAdjustment = 0;
  let expectedFgaAdjustment = 0;
  let expectedFtaAdjustment = 0;
  let projectionAdjustment = 0;
  let projectionUncertaintyAdjustment = 0;
  let overRequiredEdgeAdjustment = 0;
  let underRequiredEdgeAdjustment = 0;
  let confidenceAdjustment = 0;
  let rankingAdjustment = 0;
  const riskDebtIds = [];
  const riskRepairIds = [];
  const reasons = [];

  if (role === "VERY_STABLE" || role === "STABLE") {
    if (conf >= 50) {
      recentWeightAdjustment -= 0.02;
      minutesTrustMultiplier = 1.0; // never inflate projection via trust
      projectionUncertaintyAdjustment -= 0.2;
      confidenceAdjustment += 2;
      rankingAdjustment += 2;
      riskRepairIds.push("STABLE_ROLE_PROFILE");
      reasons.push("Stable role intelligence — trust season blend");
    }
  } else if (role === "VOLATILE" || role === "VERY_VOLATILE") {
    recentWeightAdjustment -= 0.05 * (1 + num(hints.volatilityPenaltyBoost, 0));
    minutesTrustMultiplier = role === "VERY_VOLATILE" ? 0.88 : 0.92;
    projectionUncertaintyAdjustment += 0.35 + num(hints.volatilityPenaltyBoost, 0) * 0.15;
    overRequiredEdgeAdjustment += 0.25;
    underRequiredEdgeAdjustment += 0.18;
    confidenceAdjustment -= 3;
    rankingAdjustment -= 3;
    riskDebtIds.push("UNSTABLE_ROLE");
    reasons.push("Volatile role intelligence — regress / raise evidence bar");
  } else {
    projectionUncertaintyAdjustment += 0.12;
    overRequiredEdgeAdjustment += 0.06;
    confidenceAdjustment -= 1;
    reasons.push("Moderate role intelligence");
  }

  if (usage === "ERRATIC") {
    projectionUncertaintyAdjustment += 0.15;
    overRequiredEdgeAdjustment += 0.1;
    reasons.push("Erratic usage profile");
  } else if (usage === "LOCKED" && conf >= 50) {
    projectionUncertaintyAdjustment -= 0.1;
    riskRepairIds.push("STABLE_SHOT_VOLUME");
  }

  // Legacy scoringVolume LOW — Overs need volume proof
  if (intel.scoringVolume === "LOW") {
    overRequiredEdgeAdjustment += 0.18;
    reasons.push("LOW volume — Overs need volume proof");
  }

  if (scoring === "VOLATILE") {
    projectionUncertaintyAdjustment += 0.2 * (1 + num(hints.volatilityPenaltyBoost, 0));
    confidenceAdjustment -= 2;
    rankingAdjustment -= 2;
    reasons.push("Volatile scoring profile");
  } else if (scoring === "CONSISTENT" && conf >= 50) {
    confidenceAdjustment += 1;
    projectionUncertaintyAdjustment -= 0.12;
    riskRepairIds.push("LOW_SCORING_VOLATILITY");
  }

  if (trend === "RISING") {
    const shift = 0.35 * adaptationRate * (1 + num(hints.risingBoost, 0));
    expectedMinutesAdjustment += round(shift * 0.55, 2);
    expectedFgaAdjustment += round(shift * 0.4, 2);
    projectionAdjustment += clamp(shift * 0.4, 0, 0.85);
    reasons.push("Rising opportunity trend — bounded growth");
    reasons.push(`EXPANDING role — bounded opp shift +${shift}`);
    if (intel.scoringVolume === "LOW") {
      underRequiredEdgeAdjustment += 0.1;
      confidenceAdjustment -= 1;
      reasons.push("EXPANDING + LOW volume weakens Under confidence");
    }
  } else if (trend === "DECLINING") {
    const shift = -0.45 * (1 + num(hints.decliningPenalty, 0));
    expectedMinutesAdjustment += round(shift * 0.55, 2);
    expectedFgaAdjustment += round(shift * 0.4, 2);
    projectionAdjustment += clamp(shift * 0.4, -0.85, 0);
    reasons.push("Declining opportunity trend — bounded pullback");
    reasons.push("CONTRACTING role — bounded negative opp shift");
  }

  if (avail === "RETURNING") {
    projectionAdjustment -= 0.4;
    minutesTrustMultiplier = Math.min(minutesTrustMultiplier, 0.9);
    overRequiredEdgeAdjustment += 0.15;
    confidenceAdjustment -= 2;
    reasons.push("Returning availability — conservative projection");
  } else if (avail === "LIMITED") {
    projectionAdjustment -= 0.2;
    overRequiredEdgeAdjustment += 0.1;
    reasons.push("Limited availability profile");
  }

  if (conf < 40 || intel.fallbackUsed) {
    // Adapt faster: more recent weight, no favorable certainty
    recentWeightAdjustment += 0.04 * adaptationRate;
    if (confidenceAdjustment > 0) confidenceAdjustment = 0;
    if (rankingAdjustment > 0) rankingAdjustment = 0;
    if (projectionAdjustment > 0) projectionAdjustment = 0;
    overRequiredEdgeAdjustment = Math.max(overRequiredEdgeAdjustment, 0.05);
    riskDebtIds.push("LOW_PROFILE_CONFIDENCE");
    reasons.push("Low profile confidence — faster adaptation, no favorable lock-in");
    reasons.push("Weak/missing profile — no favorable adjustments");
  }

  projectionAdjustment = clamp(round(projectionAdjustment, 2), -1.0, 1.0);
  confidenceAdjustment = clamp(Math.round(confidenceAdjustment), -6, 6);
  overRequiredEdgeAdjustment = clamp(round(overRequiredEdgeAdjustment, 2), -0.15, 0.45);
  underRequiredEdgeAdjustment = clamp(round(underRequiredEdgeAdjustment, 2), -0.15, 0.45);
  rankingAdjustment = clamp(Math.round(rankingAdjustment), -6, 6);
  minutesTrustMultiplier = clamp(round(minutesTrustMultiplier, 3), 0.75, 1.0);
  recentWeightAdjustment = clamp(round(recentWeightAdjustment, 3), -0.12, 0.12);

  return {
    version: "player-intelligence-calibration-v1",
    recentWeightAdjustment,
    seasonWeightAdjustment: -recentWeightAdjustment * 0.5,
    minutesTrustMultiplier,
    expectedMinutesAdjustment: round(expectedMinutesAdjustment, 2),
    expectedFgaAdjustment: round(expectedFgaAdjustment, 2),
    expectedFtaAdjustment: round(expectedFtaAdjustment, 2),
    projectionAdjustment,
    projectionUncertaintyAdjustment: round(projectionUncertaintyAdjustment, 2),
    overRequiredEdgeAdjustment,
    underRequiredEdgeAdjustment,
    confidenceAdjustment,
    rankingAdjustment,
    riskDebtIds: [...new Set(riskDebtIds)],
    riskRepairIds: [...new Set(riskRepairIds)],
    calibrationReasons: reasons.slice(0, 12),
    profileCalibrationApplied: true,
    cannotForceSideFlip: true,
    cannotCreateTrack: true,
    cannotOverrideHardKill: true,
    intelligenceVersion: intel.version || null,
    volatilityIndex: volIdx,
    adaptationRate,
  };
}
