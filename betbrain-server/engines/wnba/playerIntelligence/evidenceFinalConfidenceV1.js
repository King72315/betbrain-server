/**
 * Evidence-final confidence — recalculated AFTER profile, gate, side, market,
 * and same-team opportunity evidence is complete.
 *
 * Confidence must not be driven mainly by raw projection gap alone.
 * Thin projection gap dampens confidence even when preferred side stays correct.
 */

import { num, clamp, normalizeSide } from "./playerIntelligenceUtils.js";

export const EVIDENCE_FINAL_CONFIDENCE_VERSION = "evidence-final-confidence-v1";

/** Component weights — gap/edge is a minority share. */
export const EVIDENCE_FINAL_WEIGHTS = Object.freeze({
  projectionEdgeStrength: 0.14,
  profileReliability: 0.14,
  roleStability: 0.14,
  volumeUsageStability: 0.12,
  marketAgreement: 0.12,
  sameTeamOpportunity: 0.1,
  uniqueRiskDebts: 0.12,
  sideSelectionAgreement: 0.12,
});

function scoreProjectionEdgeStrength({
  projectionGap = null,
  gapFloor = null,
  projectionQualityStatus = null,
} = {}) {
  const gap = num(projectionGap);
  const floor = num(gapFloor, 2.5) ?? 2.5;
  let score = 55;
  const status = String(projectionQualityStatus || "").toUpperCase();
  if (status === "STRONG") score = 72;
  else if (status === "MIXED") score = 52;
  else if (status === "WEAK") score = 28;

  if (gap == null) return clamp(Math.round(score), 0, 100);

  // Edge strength contributes — but thin gaps cut hard even if side is correct.
  if (gap >= floor + 2) score += 10;
  else if (gap >= floor + 0.75) score += 4;
  else if (gap >= floor) score += 0;
  else if (gap >= floor - 0.75) score -= 14;
  else if (gap >= floor - 1.5) score -= 22;
  else score -= 30;

  return clamp(Math.round(score), 0, 100);
}

function scoreProfileReliability(profile = {}, dataConfidence = null) {
  const pc = num(profile.profileConfidence ?? profile.confidence);
  const dc = num(dataConfidence);
  let score = pc != null ? pc : dc != null ? dc : 55;
  if (pc != null && dc != null) score = pc * 0.65 + dc * 0.35;
  return clamp(Math.round(score), 0, 100);
}

function scoreRoleStability(profile = {}, roleIntel = {}) {
  const key =
    profile.roleStabilityScore ||
    profile.roleStability ||
    roleIntel.status ||
    roleIntel.roleStabilityScore;
  const map = {
    VERY_STABLE: 92,
    STABLE: 80,
    MODERATE: 55,
    VOLATILE: 32,
    VERY_VOLATILE: 18,
    UNSTABLE: 28,
    GOOD: 78,
    BAD: 28,
    PARTIAL: 48,
  };
  let score = map[key] ?? num(roleIntel.score, 50) ?? 50;
  if (roleIntel.hotShootingRisk) score -= 12;
  return clamp(Math.round(score), 0, 100);
}

function scoreVolumeUsageStability(profile = {}, usageIntel = {}) {
  const key =
    profile.usageProfile ||
    profile.shotVolumeStability ||
    usageIntel.status;
  const map = {
    LOCKED: 90,
    STABLE: 78,
    VARIABLE: 48,
    ERRATIC: 22,
    UNSTABLE: 25,
    MODERATE: 55,
    GOOD: 78,
    BAD: 28,
    PARTIAL: 48,
  };
  let score = map[key] ?? num(usageIntel.score, 50) ?? 50;
  return clamp(Math.round(score), 0, 100);
}

function scoreMarketAgreement(market = {}, side = "") {
  let score = num(market.marketQuality, 55) ?? 55;
  if (market.marketWarning) score -= 18;
  const impact = String(market.sideImpact || "").toUpperCase();
  const s = normalizeSide(side);
  if (impact && impact !== "NEUTRAL" && s) {
    if (impact === s) score += 8;
    else score -= 16;
  }
  if (market.movement === "against") score -= 10;
  return clamp(Math.round(score), 0, 100);
}

function scoreSameTeamOpportunity(opp = {}) {
  const assessment = String(
    opp.opportunityAssessment || opp.status || opp.opportunityStatus || ""
  ).toUpperCase();
  if (assessment === "SUPPORTED") return 82;
  if (assessment === "INSUFFICIENT_DATA") return 48;
  if (assessment === "QUESTIONABLE") return 42;
  if (assessment === "CONTRADICTED") return 18;
  if (opp.detected && (opp.collisionScore || opp.pressureScore || 0) >= 45) return 25;
  if (opp.detected && (opp.collisionScore || opp.pressureScore || 0) >= 28) return 44;
  // No peer / not evaluated — neutral, not a clean SUPPORTED boost.
  return 55;
}

function scoreUniqueRiskDebts({ riskDebtIds = [], debtCount = null, dangerGateCount = 0 } = {}) {
  const debts = Array.isArray(riskDebtIds) ? riskDebtIds : [];
  const unique = [...new Set(debts.filter(Boolean))];
  const count = debtCount != null ? num(debtCount, 0) : unique.length;
  let score = 78 - count * 9 - (dangerGateCount || 0) * 5;
  return clamp(Math.round(score), 8, 95);
}

function scoreSideSelectionAgreement({
  flipAction = "",
  flipRecommended = false,
  sideRescueAction = "",
  initialSide = "",
  finalSide = "",
} = {}) {
  const action = String(flipAction || "").toUpperCase();
  if (action === "BOTH_SIDES_WEAK") return 18;
  if (action === "CHECK_UNDER" || action === "CHECK_OVER") return 42;
  if (flipRecommended) return 72;
  const init = normalizeSide(initialSide);
  const fin = normalizeSide(finalSide);
  if (init && fin && init !== fin) return 68;
  const rescue = String(sideRescueAction || "").toUpperCase();
  if (rescue === "FLIP_SIDE") return 70;
  if (rescue && rescue !== "KEEP" && rescue !== "NONE") return 50;
  return 74;
}

/**
 * Compute evidence-final multi-component confidence.
 */
export function computeEvidenceFinalConfidence({
  projectionGap = null,
  gapFloor = null,
  projectionQualityStatus = null,
  profile = {},
  dataConfidence = null,
  roleIntelligence = {},
  usageIntelligence = {},
  market = {},
  sameTeamOpportunity = {},
  riskDebtIds = [],
  dangerGateCount = 0,
  flipAction = "",
  flipRecommended = false,
  sideRescueAction = "",
  initialSide = "",
  finalSide = "",
  side = "",
  priorDirectional = null,
  influenceAdjustment = 0,
  weights = EVIDENCE_FINAL_WEIGHTS,
} = {}) {
  const components = {
    projectionEdgeStrength: scoreProjectionEdgeStrength({
      projectionGap,
      gapFloor,
      projectionQualityStatus,
    }),
    profileReliability: scoreProfileReliability(profile, dataConfidence),
    roleStability: scoreRoleStability(profile, roleIntelligence),
    volumeUsageStability: scoreVolumeUsageStability(profile, usageIntelligence),
    marketAgreement: scoreMarketAgreement(market, side || finalSide),
    sameTeamOpportunity: scoreSameTeamOpportunity(sameTeamOpportunity),
    uniqueRiskDebts: scoreUniqueRiskDebts({
      riskDebtIds,
      dangerGateCount,
    }),
    sideSelectionAgreement: scoreSideSelectionAgreement({
      flipAction,
      flipRecommended,
      sideRescueAction,
      initialSide,
      finalSide: finalSide || side,
    }),
  };

  let weighted = 0;
  let weightSum = 0;
  const breakdown = [];
  for (const [key, weight] of Object.entries(weights)) {
    const value = components[key] ?? 50;
    weighted += value * weight;
    weightSum += weight;
    breakdown.push({ component: key, weight, score: value });
  }

  let composite = weightSum > 0 ? weighted / weightSum : 50;

  // Soft blend with prior directional — does not re-center on gap.
  // Caller should pass prior AFTER influence, with influenceAdjustment=0, OR
  // prior BEFORE influence with the adjustment value — never both.
  const prior = num(priorDirectional);
  if (prior != null) {
    composite = composite * 0.82 + prior * 0.18;
  }

  const infl = clamp(num(influenceAdjustment, 0) ?? 0, -28, 12);
  composite += infl * 0.85;

  // Explicit thin-gap dampener (extra cut beyond component score) when below floor.
  const gap = num(projectionGap);
  const floor = num(gapFloor, 2.5) ?? 2.5;
  let thinGapDampener = 0;
  if (gap != null && gap < floor) {
    thinGapDampener = gap < floor - 1 ? -12 : -7;
    composite += thinGapDampener;
  }

  // BOTH_SIDES_WEAK hard ceiling so raw gap/confidence can't stay 80%+
  const action = String(flipAction || "").toUpperCase();
  let bothSidesWeakCap = null;
  if (action === "BOTH_SIDES_WEAK") {
    bothSidesWeakCap = 58;
    composite = Math.min(composite, bothSidesWeakCap);
  }

  const finalConfidence = clamp(Math.round(composite), 12, 88);

  return {
    version: EVIDENCE_FINAL_CONFIDENCE_VERSION,
    finalConfidence,
    components,
    breakdown,
    weights: { ...weights },
    thinGapDampener,
    bothSidesWeakCap,
    gapWasPrimaryDriver: false,
    reasons: breakdown
      .filter((b) => b.score <= 40 || b.score >= 80)
      .map((b) =>
        b.score <= 40
          ? `Weak ${b.component} (${b.score})`
          : `Strong ${b.component} (${b.score})`
      )
      .concat(thinGapDampener < 0 ? [`Thin gap dampener ${thinGapDampener}`] : [])
      .concat(bothSidesWeakCap != null ? [`BOTH_SIDES_WEAK confidence cap ${bothSidesWeakCap}`] : [])
      .slice(0, 10),
  };
}

/**
 * Apply evidence-final confidence onto a fully enriched pick.
 */
export function applyEvidenceFinalConfidenceToPick(pick = {}, options = {}) {
  const ddi = options.decisionDataIntelligence || pick.decisionDataIntelligence || {};
  const profile =
    options.profile ||
    pick.playerRoleProfile ||
    pick.wnbaDataCard?.playerRoleProfile ||
    pick.playerIntelligenceProfile ||
    {};
  const intel = profile.playerIntelligence || profile;
  const side = normalizeSide(options.side || pick.side || pick.pick);
  const flip = ddi.flipFirstDecision || pick.flipFirstDecision || {};
  const gapFloor =
    options.gapFloor ??
    pick.underGapFloorUsed ??
    pick.wnbaDataModeAudit?.gapFloorApplied ??
    pick.wnbaReader?.underGapFloorUsed ??
    2.5;
  const projectionGap =
    options.projectionGap ??
    pick.projectionGap ??
    (() => {
      const proj = num(pick.projection);
      const line = num(pick.line ?? pick.wnbaDataCard?.bookLine);
      if (proj == null || line == null) return null;
      return side === "UNDER" ? line - proj : proj - line;
    })();

  const teamOpp =
    options.sameTeamOpportunity ||
    pick.sameTeamOpportunityAudit ||
    ddi.sameTeamOpportunity ||
    ddi.sameTeamCollision ||
    {};

  const result = computeEvidenceFinalConfidence({
    projectionGap,
    gapFloor,
    projectionQualityStatus: ddi.projectionQuality?.status,
    profile: intel,
    dataConfidence:
      options.dataConfidence ?? pick.dataConfidence ?? pick.wnbaDataCard?.dataConfidenceScore,
    roleIntelligence: ddi.roleStability || {},
    usageIntelligence: ddi.usageShare || {},
    market: {
      marketQuality: pick.marketQuality ?? pick.wnbaDataCard?.marketQuality,
      marketWarning: ddi.marketIntelligence?.marketWarning,
      sideImpact: ddi.marketIntelligence?.sideImpact,
      movement: ddi.marketIntelligence?.movement,
    },
    sameTeamOpportunity: teamOpp,
    riskDebtIds:
      pick.playerProfileCalibration?.riskDebtIds ||
      pick.profileDebtIds ||
      pick.decisionIntelligence?.riskDebts?.map((d) => d.code) ||
      [],
    dangerGateCount:
      pick.dangerGateCount ??
      pick.decisionIntelligence?.dangerGateCount ??
      (pick.dangerGateStack || []).length,
    flipAction: flip.action || pick.flipFirstAction,
    flipRecommended: Boolean(flip.flipRecommended),
    sideRescueAction: pick.sideRescue?.action,
    initialSide: pick.initialSide || flip.originalSide,
    finalSide: side || flip.finalSide,
    side,
    priorDirectional: pick.directionalConfidence ?? pick.confidence,
    influenceAdjustment: ddi.finalInfluence?.confidenceAdjustment || 0,
  });

  return {
    ...pick,
    evidenceFinalConfidence: result,
    evidenceFinalConfidenceVersion: EVIDENCE_FINAL_CONFIDENCE_VERSION,
    confidenceBeforeEvidenceFinal: pick.finalConfidence ?? pick.confidence ?? null,
    finalConfidence: result.finalConfidence,
    confidence: result.finalConfidence,
    confidenceComponents: {
      ...(pick.confidenceComponents || {}),
      ...result.components,
      evidenceFinal: true,
    },
    multiComponentConfidence: {
      ...(pick.multiComponentConfidence || {}),
      evidenceFinal: result,
      finalConfidence: result.finalConfidence,
    },
  };
}
