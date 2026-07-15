/**
 * Phase 3 — Confidence Engine
 * Multi-component confidence; must NOT primarily depend on projection gap.
 * Evidence-final pass runs AFTER profile/gate/side/market/team opportunity.
 */

export const CONFIDENCE_ENGINE_VERSION = "player-intel-confidence-v2-evidence-final";
export const EVIDENCE_FINAL_CONFIDENCE_VERSION = "evidence-final-confidence-v1";

/** Suggested component weights (tunable) — gap is not a primary driver */
export const CONFIDENCE_WEIGHTS = Object.freeze({
  projectionEdgeStrength: 0.14,
  profileReliability: 0.14,
  roleStability: 0.14,
  volumeUsageStability: 0.12,
  marketAgreement: 0.12,
  sameTeamOpportunity: 0.1,
  uniqueRiskDebts: 0.12,
  sideSelectionAgreement: 0.12,
});

/** Legacy weight keys kept for older callers */
export const LEGACY_CONFIDENCE_WEIGHTS = Object.freeze({
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

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

/**
 * Projection quality from data completeness + uncertainty — NOT gap size.
 */
export function scoreProjectionQuality({
  dataConfidence = null,
  projectionUncertainty = null,
  profileConfidence = null,
  missingFlags = [],
} = {}) {
  let score = num(dataConfidence, 55) ?? 55;
  const unc = num(projectionUncertainty, 0) ?? 0;
  score -= unc * 12;
  if ((missingFlags?.length || 0) >= 3) score -= 10;
  else if ((missingFlags?.length || 0) >= 1) score -= 4;
  const pc = num(profileConfidence, 50) ?? 50;
  score = score * 0.7 + pc * 0.3;
  return clamp(Math.round(score), 0, 100);
}

/**
 * Edge strength: thin gaps cut confidence even when direction stays correct.
 * Large gaps help modestly — never dominate the composite.
 */
export function scoreProjectionEdgeStrength({
  projectionGap = null,
  gapFloor = null,
  projectionQualityStatus = null,
  dataConfidence = null,
} = {}) {
  const status = String(projectionQualityStatus || "").toUpperCase();
  let score = 58;
  if (status === "STRONG") score = 72;
  else if (status === "MIXED") score = 52;
  else if (status === "WEAK") score = 34;

  const gap = num(projectionGap, null);
  const floor = num(gapFloor, 2.5) ?? 2.5;
  if (gap != null) {
    if (gap < floor - 1) score -= 28;
    else if (gap < floor) score -= 18;
    else if (gap < floor + 0.75) score -= 8;
    else if (gap >= floor + 3) score += 6;
    else if (gap >= floor + 1.5) score += 3;
  }

  const dc = num(dataConfidence, null);
  if (dc != null) score = Math.round(score * 0.82 + dc * 0.18);
  return clamp(Math.round(score), 8, 88);
}

export function scorePlayerStability(intel = {}) {
  return scoreFromEnum(
    {
      VERY_STABLE: 92,
      STABLE: 80,
      MODERATE: 55,
      VOLATILE: 32,
      VERY_VOLATILE: 18,
      UNSTABLE: 28,
    },
    intel.roleStabilityScore || intel.roleStability,
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
      UNSTABLE: 25,
      MODERATE: 55,
    },
    intel.usageProfile || intel.shotVolumeStability,
    50
  );
}

export function scoreProfileReliability(intel = {}, dataConfidence = null) {
  const pc = num(intel.profileConfidence, null);
  const dc = num(dataConfidence, 55) ?? 55;
  if (pc == null) return clamp(Math.round(dc * 0.85 + 8), 15, 90);
  return clamp(Math.round(pc * 0.7 + dc * 0.3), 12, 95);
}

export function scoreHistoricalAccuracy(hints = {}, fallback = 55) {
  const mae = num(hints.meanAbsError ?? hints.meanAbsoluteError, null);
  const bias = num(hints.meanError, null);
  const n = num(hints.gradedSample ?? hints.sampleSize, 0) ?? 0;
  if (n < 3 || mae == null) return fallback;
  let score = 85 - mae * 8;
  if (bias != null && Math.abs(bias) >= 2) score -= Math.abs(bias) * 3;
  if (n >= 12) score += 5;
  return clamp(Math.round(score), 15, 95);
}

export function scoreMarketAgreement({
  marketQuality = null,
  bookCount = null,
  lineSpread = null,
  marketWarning = false,
  marketSideImpact = null,
  side = "",
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
  if (marketWarning) score -= 16;
  const impact = String(marketSideImpact || "").toUpperCase();
  const s = normalizeSide(side);
  if (impact && impact !== "NEUTRAL" && s) {
    if (impact === s) score += 8;
    else score -= 14;
  }
  return clamp(Math.round(score), 0, 100);
}

export function scoreSameTeamOpportunity(opportunity = null) {
  if (!opportunity || (!opportunity.status && opportunity.status !== 0)) {
    if (!opportunity) return 55;
  }
  const status = String(opportunity?.status || opportunity?.opportunityStatus || "").toUpperCase();
  switch (status) {
    case "SUPPORTED":
      return 78;
    case "QUESTIONABLE":
      return 42;
    case "CONTRADICTED":
      return 18;
    default:
      if (opportunity?.detected && (opportunity.collisionScore || 0) >= 45) return 28;
      if (opportunity?.detected && (opportunity.collisionScore || 0) >= 30) return 45;
      return 55;
  }
}

export function scoreUniqueRiskDebts({
  riskDebtIds = [],
  debts = [],
  debtCount = null,
} = {}) {
  const ids = [
    ...new Set(
      [
        ...(Array.isArray(riskDebtIds) ? riskDebtIds : []),
        ...(Array.isArray(debts)
          ? debts.map((d) => (typeof d === "string" ? d : d?.code)).filter(Boolean)
          : []),
      ].map((x) => String(x).toUpperCase())
    ),
  ];
  const count = debtCount != null ? num(debtCount, 0) ?? 0 : ids.length;
  let score = 78 - count * 7;
  const heavy = ["THIN_EDGE", "BOTH_SIDES_WEAK", "VOLATILE_MINUTES", "UNSTABLE_MINUTES"];
  for (const code of ids) {
    if (heavy.includes(code)) score -= 5;
  }
  return clamp(Math.round(score), 10, 90);
}

export function scoreSideSelectionAgreement({
  flipAction = null,
  flipRecommended = false,
  sideAgreement = null,
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
  score -= (debtCount || 0) * 3;
  score += (repairCount || 0) * 2;

  const action = String(flipAction || sideAgreement || "").toUpperCase();
  if (action === "BOTH_SIDES_WEAK") score -= 28;
  else if (action === "KEPT_ORIGINAL" || action === "AGREE") score += 4;
  else if (action.startsWith("CHECK_")) score -= 4;
  if (flipRecommended) score += 3;

  const risk = String(trueRisk || "").toUpperCase();
  if (risk === "HIGH" || (num(trueRisk, null) != null && num(trueRisk) >= 70)) score -= 10;
  else if (risk === "LOW" || (num(trueRisk, null) != null && num(trueRisk) <= 35)) score += 5;

  return clamp(Math.round(score), 8, 92);
}

export function scoreDecisionIntelligence({
  evidenceScore = null,
  finalQualityScore = null,
  trueRisk = null,
  debtCount = 0,
  repairCount = 0,
  flipAction = null,
} = {}) {
  return scoreSideSelectionAgreement({
    evidenceScore,
    finalQualityScore,
    trueRisk,
    debtCount,
    repairCount,
    flipAction,
  });
}

export function scoreRecentCalibration(hints = {}) {
  const calScore = num(hints.recentCalibrationScore, null);
  if (calScore != null) return clamp(Math.round(calScore), 0, 100);
  const n = num(hints.gradedSample, 0) ?? 0;
  if (n < 3) return 50;
  return scoreHistoricalAccuracy(hints, 50);
}

/**
 * Legacy multi-component confidence (pre evidence-final weights).
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
  weights = LEGACY_CONFIDENCE_WEIGHTS,
  projectionGap = null,
  gapFloor = null,
  projectionQualityStatus = null,
  marketWarning = false,
  marketSideImpact = null,
  side = "",
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
    }),
    playerStability: scorePlayerStability(intel),
    usageStability: scoreUsageStability(intel),
    historicalProjectionAccuracy: scoreHistoricalAccuracy(hints),
    marketAgreement: scoreMarketAgreement({
      marketQuality,
      bookCount,
      lineSpread,
      marketWarning,
      marketSideImpact,
      side,
    }),
    sameTeamOpportunity: scoreSameTeamOpportunity(sameTeamOpportunity),
    decisionIntelligence: scoreDecisionIntelligence({
      evidenceScore: di.evidenceScore,
      finalQualityScore: di.finalQualityScore,
      trueRisk: di.trueRisk,
      debtCount: (di.riskDebtIds || di.debts || []).length,
      repairCount: (di.riskRepairIds || di.repairs || []).length,
      flipAction: di.flipAction,
    }),
    recentCalibration: scoreRecentCalibration(hints),
  };

  // Soft thin-gap dampening even on legacy path
  const edgeDamp = scoreProjectionEdgeStrength({
    projectionGap,
    gapFloor,
    projectionQualityStatus,
    dataConfidence,
  });
  components.projectionQuality = clamp(
    Math.round(components.projectionQuality * 0.55 + edgeDamp * 0.45),
    0,
    100
  );

  let weighted = 0;
  let weightSum = 0;
  for (const [key, w] of Object.entries(weights)) {
    if (components[key] == null) continue;
    weighted += components[key] * w;
    weightSum += w;
  }
  const composite = weightSum > 0 ? weighted / weightSum : 50;
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
 * Evidence-final confidence — run after ALL profile/gate/side/market/team evidence.
 * Thin projection gap cuts confidence even if preferred side stays correct.
 */
export function computeEvidenceFinalConfidence({
  playerIntelligence = null,
  dataConfidence = null,
  projectionGap = null,
  gapFloor = null,
  projectionQualityStatus = null,
  marketQuality = null,
  bookCount = null,
  lineSpread = null,
  marketWarning = false,
  marketSideImpact = null,
  side = "",
  sameTeamOpportunity = null,
  riskDebtIds = [],
  riskDebts = [],
  flipAction = null,
  flipRecommended = false,
  trueRisk = null,
  repairCount = 0,
  priorConfidence = null,
  weights = CONFIDENCE_WEIGHTS,
} = {}) {
  const intel = playerIntelligence || {};
  const debts = riskDebts?.length ? riskDebts : riskDebtIds;

  const components = {
    projectionEdgeStrength: scoreProjectionEdgeStrength({
      projectionGap,
      gapFloor,
      projectionQualityStatus,
      dataConfidence,
    }),
    profileReliability: scoreProfileReliability(intel, dataConfidence),
    roleStability: scorePlayerStability(intel),
    volumeUsageStability: scoreUsageStability(intel),
    marketAgreement: scoreMarketAgreement({
      marketQuality,
      bookCount,
      lineSpread,
      marketWarning,
      marketSideImpact,
      side,
    }),
    sameTeamOpportunity: scoreSameTeamOpportunity(sameTeamOpportunity),
    uniqueRiskDebts: scoreUniqueRiskDebts({
      riskDebtIds,
      debts,
    }),
    sideSelectionAgreement: scoreSideSelectionAgreement({
      flipAction,
      flipRecommended,
      trueRisk,
      debtCount: Array.isArray(debts) ? debts.length : 0,
      repairCount,
    }),
  };

  let weighted = 0;
  let weightSum = 0;
  for (const [key, w] of Object.entries(weights)) {
    if (components[key] == null) continue;
    weighted += components[key] * w;
    weightSum += w;
  }
  let composite = weightSum > 0 ? weighted / weightSum : 50;

  const prior = num(priorConfidence, null);
  if (prior != null) {
    // Soft blend — evidence state still owns the majority
    composite = composite * 0.72 + prior * 0.28;
  }

  // Hard thin-gap ceiling: weak edge strength cannot sit in the 80s
  if (components.projectionEdgeStrength <= 40) {
    composite = Math.min(composite, 62);
  } else if (components.projectionEdgeStrength <= 50) {
    composite = Math.min(composite, 72);
  }

  if (String(flipAction || "").toUpperCase() === "BOTH_SIDES_WEAK") {
    composite = Math.min(composite, 58);
  }

  const status = String(
    sameTeamOpportunity?.status || sameTeamOpportunity?.opportunityStatus || ""
  ).toUpperCase();
  if (status === "CONTRADICTED") composite = Math.min(composite, 60);
  else if (status === "QUESTIONABLE") composite = Math.min(composite, 70);

  const finalConfidence = clamp(Math.round(composite), 12, 88);

  return {
    version: EVIDENCE_FINAL_CONFIDENCE_VERSION,
    components,
    weights: { ...weights },
    compositeScore: Math.round(composite),
    finalConfidence,
    gapDependent: false,
    thinGapDampened: (num(projectionGap, 99) ?? 99) < (num(gapFloor, 2.5) ?? 2.5),
    primaryDrivers: Object.entries(components)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([k, v]) => ({ component: k, score: v })),
    weakDrivers: Object.entries(components)
      .filter(([, v]) => v <= 40)
      .map(([k, v]) => ({ component: k, score: v })),
  };
}

/**
 * Apply evidence-final confidence onto a pick (selection / ranking pass).
 */
export function applyEvidenceFinalConfidenceToPick(pick = {}, options = {}) {
  const profile =
    options.playerIntelligence ||
    pick.playerRoleProfile?.playerIntelligence ||
    pick.playerRoleProfile ||
    pick.wnbaDataCard?.playerRoleProfile ||
    {};
  const ddi = pick.decisionDataIntelligence || {};
  const reader = pick.wnbaReader || {};
  const side = normalizeSide(options.side || pick.side || pick.pick || reader.finalSide);
  const gap =
    num(options.projectionGap, null) ??
    num(pick.projectionGap, null) ??
    num(reader.projectionGap, null) ??
    (side === "OVER"
      ? num(reader.overGap ?? pick.overGap, null)
      : num(reader.underGap ?? pick.underGap, null));
  const gapFloor =
    num(options.gapFloor, null) ??
    num(pick.wnbaDataModeAudit?.gapFloorApplied, null) ??
    num(side === "UNDER" ? reader.underCase?.gapFloorUsed : reader.overCase?.gapFloorUsed, null) ??
    2.5;

  const opp =
    options.sameTeamOpportunity ||
    pick.sameTeamOpportunityAudit ||
    ddi.sameTeamOpportunity ||
    ddi.sameTeamCollision ||
    { status: pick.sameTeamOpportunityStatus };

  const flipAction =
    options.flipAction ||
    pick.flipFirstAction ||
    ddi.flipFirstDecision?.action ||
    pick.flipFirstDecision?.action;

  const debts =
    options.riskDebts ||
    pick.decisionIntelligence?.riskDebts ||
    pick.playerProfileCalibration?.riskDebtIds ||
    [];

  const result = computeEvidenceFinalConfidence({
    playerIntelligence: profile,
    dataConfidence:
      options.dataConfidence ?? pick.dataConfidence ?? pick.wnbaDataCard?.dataConfidenceScore,
    projectionGap: gap,
    gapFloor,
    projectionQualityStatus:
      options.projectionQualityStatus || ddi.projectionQuality?.status,
    marketQuality: pick.marketQuality ?? pick.wnbaDataCard?.marketQuality,
    bookCount: pick.bookCount ?? pick.wnbaDataCard?.bookCount,
    lineSpread: pick.lineSpread ?? pick.wnbaDataCard?.lineSpread,
    marketWarning: ddi.marketIntelligence?.marketWarning,
    marketSideImpact: ddi.marketIntelligence?.sideImpact,
    side,
    sameTeamOpportunity: opp,
    riskDebtIds: Array.isArray(debts)
      ? debts.map((d) => (typeof d === "string" ? d : d?.code)).filter(Boolean)
      : [],
    riskDebts: debts,
    flipAction,
    flipRecommended: Boolean(ddi.flipFirstDecision?.flipRecommended),
    trueRisk: pick.decisionIntelligence?.trueRisk || pick.trueRisk,
    repairCount: (pick.decisionIntelligence?.riskRepairs || []).length,
    priorConfidence: pick.finalConfidence ?? pick.confidence,
  });

  return {
    ...pick,
    evidenceFinalConfidence: result,
    evidenceFinalConfidenceVersion: EVIDENCE_FINAL_CONFIDENCE_VERSION,
    confidenceBeforeEvidenceFinal: pick.confidence ?? pick.finalConfidence,
    finalConfidence: result.finalConfidence,
    confidence: result.finalConfidence,
    confidenceComponents: result.components,
    multiComponentConfidence: result,
  };
}

/**
 * Soft directional influence from multi-component confidence.
 * Caps impact so Flip-First / DDI remain owning side selection.
 */
export function confidenceEngineDirectionalDelta(confidenceResult = {}, priorDirectional = 50) {
  const target = num(confidenceResult.finalConfidence, priorDirectional) ?? priorDirectional;
  const prior = num(priorDirectional, 50) ?? 50;
  const delta = clamp(Math.round((target - prior) * 0.35), -6, 6);
  return {
    delta,
    priorDirectional: prior,
    engineConfidence: target,
    after: clamp(prior + delta, 12, 92),
  };
}
