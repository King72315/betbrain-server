/**
 * Same-team forced-side presentation + confidence/risk recalibration.
 *
 * LOCKED: weaker teammate Over → Under via SAME_TEAM_ARBITRATION_FLIP.
 * This module does not invent Under support. It separates organic model
 * analysis from the final CourtEdge selection for honest cards.
 */

export const SAME_TEAM_FORCED_SIDE_PRESENTATION_VERSION =
  "same-team-forced-side-presentation-v1";

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function riskLabel(trueRisk = "MEDIUM") {
  const r = String(trueRisk || "MEDIUM").toUpperCase();
  if (r === "LOW") return "Low Risk";
  if (r === "HIGH") return "High Risk";
  return "Medium Risk";
}

/**
 * Grade how well organic evidence supports the forced Under.
 * Does not fabricate support — weak when model preferred Over.
 */
export function gradeOrganicUnderEvidence(pick = {}, independentlyQualified = false) {
  if (independentlyQualified) {
    const underGap = num(pick.underGap ?? pick.wnbaReader?.underGap, 0) || 0;
    if (underGap >= 3) return "strong";
    if (underGap >= 1.5) return "partial";
    return "partial";
  }

  const underCase = num(pick.wnbaReader?.underCase?.score, 0) || 0;
  const overCase = num(pick.wnbaReader?.overCase?.score, 0) || 0;
  if (underCase > 0 && overCase > 0 && underCase >= overCase) return "partial";
  return "weak";
}

/**
 * Measure conflict between organic Over lean and forced Under.
 * Higher = stronger policy/evidence conflict.
 */
export function measurePolicyEvidenceConflict(originalPick = {}, forcedPick = {}) {
  const line = num(forcedPick.line ?? originalPick.line, 0) || 0;
  const projection =
    num(
      forcedPick.projection ??
        originalPick.projection ??
        forcedPick.wnbaDataCard?.projection?.projection,
      line
    ) ?? line;
  const overGap = projection - line; // >0 favors Over

  let conflict = 0;
  const factors = [];

  if (overGap > 0.5) {
    const projConflict = clamp(overGap * 10, 0, 40);
    conflict += projConflict;
    factors.push({
      code: "PROJECTION_FAVORS_OVER",
      weight: projConflict,
      detail: `Projection ${projection.toFixed(1)} vs line ${line} favors Over by ${overGap.toFixed(1)}`,
    });
  }

  const fairSide = normalizeSide(
    forcedPick.fairLineSide ?? originalPick.fairLineSide
  );
  if (fairSide === "OVER") {
    conflict += 12;
    factors.push({ code: "FAIR_LINE_OVER", weight: 12 });
  }

  const market =
    forcedPick.marketIntelligence?.marketDirection ||
    forcedPick.flipFirstLabels?.market ||
    forcedPick.decisionDataIntelligence?.flipFirstLabels?.market ||
    "";
  if (/against/i.test(String(market)) === false && /with|over/i.test(String(market))) {
    conflict += 8;
    factors.push({ code: "MARKET_LEAN_OVER", weight: 8 });
  }

  const roleTrend = String(
    forcedPick.roleTrend ||
      forcedPick.wnbaDataCard?.roleTrend ||
      originalPick.roleTrend ||
      ""
  ).toLowerCase();
  if (roleTrend === "up" || roleTrend === "expanding") {
    conflict += 10;
    factors.push({ code: "ROLE_EXPANDING_VS_UNDER", weight: 10 });
  }

  const overCase = num(originalPick.wnbaReader?.overCase?.score, 0) || 0;
  const underCase = num(originalPick.wnbaReader?.underCase?.score, 0) || 0;
  if (overCase > underCase + 4) {
    conflict += 14;
    factors.push({
      code: "READER_OVER_DOMINANT",
      weight: 14,
      detail: `Organic reader Over ${overCase} vs Under ${underCase}`,
    });
  }

  return {
    conflictScore: Number(clamp(conflict, 0, 100).toFixed(1)),
    factors,
    projectionGapFavoringOver: Number(overGap.toFixed(2)),
  };
}

export function recalibrateForcedUnderConfidenceRisk({
  originalConfidence = 50,
  conflictScore = 0,
  organicUnderEvidence = "weak",
} = {}) {
  const base = num(originalConfidence, 50) ?? 50;
  let penalty = 12 + conflictScore * 0.45;
  if (organicUnderEvidence === "weak") penalty += 8;
  else if (organicUnderEvidence === "partial") penalty += 3;

  const confidence = Math.round(clamp(base - penalty, 22, 72));

  let trueRisk = "MEDIUM";
  if (conflictScore >= 28 || organicUnderEvidence === "weak") trueRisk = "HIGH";
  else if (conflictScore <= 12 && organicUnderEvidence === "strong") trueRisk = "MEDIUM";

  return {
    confidence,
    trueRisk,
    riskLabel: riskLabel(trueRisk),
    policyOverridePenalty: Number(penalty.toFixed(1)),
    originalConfidence: base,
  };
}

/**
 * Finalize a same-team forced Under for display + Results.
 * Preserves organic Over analysis; sets Final Side Under without claiming
 * Flip-First/Side Rescue organically chose Under.
 */
export function finalizeSameTeamForcedUnderPresentation({
  originalPick = {},
  forcedPick = {},
  primaryPlayer = "",
  independentlyQualifiedUnder = false,
} = {}) {
  const player = forcedPick.player || originalPick.player || "";
  const organicUnderEvidence = gradeOrganicUnderEvidence(
    forcedPick,
    independentlyQualifiedUnder
  );
  const conflict = measurePolicyEvidenceConflict(originalPick, forcedPick);
  const originalConfidence = num(
    originalPick.confidence ??
      originalPick.finalConfidence ??
      originalPick.winProbability,
    50
  );
  const calib = recalibrateForcedUnderConfidenceRisk({
    originalConfidence,
    conflictScore: conflict.conflictScore,
    organicUnderEvidence,
  });

  const originalModelSide = "OVER";
  const finalSide = "UNDER";
  const organicSideRescue =
    originalPick.sideRescue || originalPick.sideRescueAction
      ? {
          action: originalPick.sideRescue?.action || originalPick.sideRescueAction,
          explanation:
            originalPick.sideRescue?.simpleExplanation ||
            originalPick.sideRescueExplanation ||
            null,
        }
      : null;

  const reasonLines = [
    `Same-team arbitration: ${primaryPlayer || "stronger teammate"} retained as stronger Over; ${player} forced to Under`,
    `Original model lean: Over`,
    `Organic Under evidence: ${organicUnderEvidence}`,
    conflict.conflictScore >= 20
      ? `Policy/evidence conflict score ${conflict.conflictScore} — confidence/risk recalibrated for forced Under`
      : `Forced Under tracked by deterministic teammate-side rule`,
  ];

  const displayWhy = reasonLines.join(". ") + ".";

  // Strip misleading Flip-First / Side Rescue final actions from the printed card.
  const sanitizedFlipLabels = {
    ...(forcedPick.flipFirstLabels ||
      forcedPick.decisionDataIntelligence?.flipFirstLabels ||
      {}),
    flipCheck: "SAME_TEAM_ARBITRATION",
  };

  const di = forcedPick.decisionIntelligence || {};

  return {
    ...forcedPick,
    side: "Under",
    pick: "Under",
    lockedSide: "Under",
    finalCourtEdgeSide: finalSide,
    originalModelSide,
    originalModelConfidence: calib.originalConfidence,
    organicSideRescue,
    sameTeamArbitration: {
      applied: true,
      reason: "SAME_TEAM_ARBITRATION_FLIP",
      primaryPlayer: primaryPlayer || null,
      originalModelSide,
      finalSide,
      organicUnderEvidence,
      independentlyQualifiedUnder: independentlyQualifiedUnder === true,
      conflictScore: conflict.conflictScore,
      conflictFactors: conflict.factors,
      policyOverridePenalty: calib.policyOverridePenalty,
    },
    sameTeamArbitrationFlip: true,
    sameTeamArbitrationReason: "SAME_TEAM_ARBITRATION_FLIP",
    flipReasonCode: "SAME_TEAM_ARBITRATION_FLIP",
    // Do not leave Flip-First claiming FLIPPED_TO_OVER as the final action.
    flipFirstAction: "SAME_TEAM_ARBITRATION_FLIP",
    flipFirstDecision: {
      ...(forcedPick.flipFirstDecision || {}),
      action: "SAME_TEAM_ARBITRATION_FLIP",
      finalSide: "UNDER",
      originalSide: originalModelSide,
      note: "Final side set by same-team policy; Flip-First organic result preserved under organicModelFlip",
      organicModelFlip:
        originalPick.flipFirstAction ||
        originalPick.flipFirstDecision?.action ||
        null,
    },
    sideRescueAction: "SAME_TEAM_ARBITRATION",
    sideRescue: {
      ...(forcedPick.sideRescue || {}),
      action: "SAME_TEAM_ARBITRATION",
      finalSide: "UNDER",
      simpleExplanation: displayWhy,
      organicAction: organicSideRescue?.action || null,
    },
    sideRescueExplanation: displayWhy,
    displaySideRescueAction: "SAME_TEAM_ARBITRATION",
    displaySideRescueExplanation: displayWhy,
    confidence: calib.confidence,
    finalConfidence: calib.confidence,
    winProbability: calib.confidence,
    trueRisk: calib.trueRisk,
    riskLabel: calib.riskLabel,
    displayTrueRisk: calib.trueRisk,
    whySide: reasonLines,
    support: reasonLines,
    reasons: reasonLines.slice(0, 4),
    displayWhy,
    flipFirstLabels: sanitizedFlipLabels,
    displayFlipFirstLabels: sanitizedFlipLabels,
    userFacingDecision: "TRACK",
    decisionIntelligence: {
      ...di,
      trueRisk: calib.trueRisk,
      riskAfterDecision: calib.riskLabel,
      simpleExplanation: displayWhy,
      sameTeamForcedUnder: true,
      originalModelSide,
      originalModelConfidence: calib.originalConfidence,
      organicUnderEvidence,
      policyEvidenceConflict: conflict.conflictScore,
    },
    presentationVersion: SAME_TEAM_FORCED_SIDE_PRESENTATION_VERSION,
  };
}

/**
 * Build the compact final card schema for Best 6 rows.
 */
export function buildFinalBestSixCardSchema(pick = {}) {
  const finalSide = normalizeSide(
    pick.finalCourtEdgeSide || pick.side || pick.pick
  );
  const originalModelSide = normalizeSide(
    pick.originalModelSide ||
      pick.sameTeamArbitration?.originalModelSide ||
      (pick.sameTeamArbitrationFlip ? "OVER" : finalSide)
  );
  const evidence = pick.courtEdgePlayerEvidence || {};
  const defense = pick.defenseResult || evidence.opponentContext || {};

  return {
    player: pick.player || null,
    finalProp: `${finalSide === "UNDER" ? "Under" : "Over"} ${pick.line} Points`,
    confidence: num(pick.confidence ?? pick.finalConfidence),
    risk: String(pick.trueRisk || pick.displayTrueRisk || "MEDIUM").toUpperCase(),
    decision: "TRACK",
    topStatus: Boolean(pick.isTopPick || pick.topPickRank || pick.topPickLabel),
    originalModelSide: originalModelSide || null,
    finalCourtEdgeSide: finalSide || null,
    sameTeamArbitration: pick.sameTeamArbitrationFlip
      ? {
          applied: true,
          primaryPlayer:
            pick.sameTeamArbitration?.primaryPlayer ||
            pick.sameTeamOpportunityV2?.primaryPlayer ||
            null,
          organicUnderEvidence:
            pick.sameTeamArbitration?.organicUnderEvidence || null,
        }
      : { applied: false },
    projectionQuality:
      pick.flipFirstLabels?.projectionQuality ||
      evidence.projections?.quality?.quality ||
      null,
    marketDirection:
      pick.flipFirstLabels?.market ||
      pick.marketIntelligence?.marketDirection ||
      null,
    availability:
      pick.flipFirstLabels?.availability ||
      evidence.availability?.playerInjuryStatus ||
      null,
    opponentData: {
      defenseScore: defense.defenseScore ?? evidence.opponentContext?.defenseScore ?? null,
      defenseStatus:
        defense.status ||
        evidence.opponentContext?.defenseStatus ||
        null,
      paceProxy:
        defense.paceProxy ?? evidence.opponentContext?.paceProxy ?? null,
      opponentPPG:
        defense.opponentPPG ?? evidence.opponentContext?.seasonPointsAllowed ?? null,
    },
    conciseReason: pick.displayWhy || pick.decisionIntelligence?.simpleExplanation || null,
  };
}
