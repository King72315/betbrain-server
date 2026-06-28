/**
 * Decision Data Intelligence v1 — orchestrates data-use modules for flip-first decisions.
 */
import { evaluateRoleStabilityIntelligence } from "./roleStabilityIntelligenceV1.js";
import { evaluateUsageShareIntelligence } from "./usageShareIntelligenceV1.js";
import { evaluateSameTeamUsageCollision } from "./sameTeamUsageCollisionV1.js";
import { evaluateMarketMovementIntelligence } from "./marketMovementIntelligenceV1.js";
import { evaluateAvailabilityImpact } from "./availabilityImpactV1.js";
import {
  evaluateOpponentHistoryComparison,
  buildOpponentHistoryCompactLabel,
} from "./opponentHistoryComparisonV1.js";
import { evaluateFlipFirstSideSelection } from "./flipFirstSideSelectionV1.js";
import { resolveQualityGateInputs } from "../wnba/wnbaGateInputs.js";

export const DECISION_DATA_INTELLIGENCE_VERSION =
  "flip-first-decision-data-intelligence-v1";

function num(value, fallback = 0) {
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

function evaluateProjectionQuality(pick = {}, options = {}) {
  const card = options.dataCard || pick.wnbaDataCard || {};
  const side = normalizeSide(options.side || pick.side || pick.pick);
  const metrics = resolveQualityGateInputs(pick, card, options.reader || pick.wnbaReader);
  const usage = options.usageShare || {};
  const role = options.roleStability || {};
  const market = options.marketIntelligence || {};
  const reasons = [];
  let score = 65;

  const supportedByUsage = usage.status === "GOOD" || usage.score >= 65;
  const supportedByMinutes = role.score >= 60 && !role.hotShootingRisk;
  const supportedByMarket = !market.marketWarning;
  const hotGameRisk = role.hotShootingRisk === true;

  if (metrics.projectionGap >= 4) {
    score += 12;
    reasons.push("Strong projection gap.");
  } else if (metrics.projectionGap >= 2.5) {
    score += 6;
  } else if (metrics.projectionGap <= 1.5) {
    score -= 14;
    reasons.push("Thin projection gap.");
  }

  if (!supportedByUsage) {
    score -= 10;
    reasons.push("Projection not supported by usage share.");
  }
  if (!supportedByMinutes) {
    score -= 8;
    reasons.push("Projection not supported by stable minutes.");
  }
  if (!supportedByMarket) {
    score -= 8;
    reasons.push("Projection contradicted by market movement.");
  }
  if (hotGameRisk) {
    score -= 12;
    reasons.push("Hot-game outlier may inflate line.");
  }

  let sideImpact = "NEUTRAL";
  if (side === "OVER") {
    if (hotGameRisk || !supportedByUsage) sideImpact = "UNDER";
    else if (score >= 70) sideImpact = "OVER";
  }
  if (side === "UNDER") {
    if (score >= 70 && supportedByUsage && supportedByMinutes) sideImpact = "UNDER";
    if (hotGameRisk && side === "OVER") sideImpact = "UNDER";
  }

  score = clamp(Math.round(score), 0, 100);
  const status = score >= 70 ? "STRONG" : score >= 45 ? "MIXED" : "WEAK";

  return {
    score,
    status,
    supportedByUsage,
    supportedByMinutes,
    supportedByMarket,
    hotGameRisk,
    sideImpact,
    reasons: reasons.slice(0, 6),
  };
}

function buildFinalInfluence(ddi = {}, flipDecision = {}) {
  const reasons = [];
  let confidenceAdjustment = 0;
  let riskAdjustment = "NEUTRAL";
  let decisionAdjustment = "KEEP";
  let bestSixImpact = "NEUTRAL";
  let resultsAdmissionImpact = "NEUTRAL";

  if (flipDecision.flipRecommended) {
    confidenceAdjustment += 4;
    decisionAdjustment = "FLIP";
    reasons.push("Flip-first improved side selection.");
  }

  const weakModules = [
    ddi.roleStability?.status === "BAD",
    ddi.usageShare?.status === "BAD",
    ddi.projectionQuality?.status === "WEAK",
    ddi.marketIntelligence?.marketWarning,
    ddi.availabilityImpact?.uncertaintyAdded,
  ].filter(Boolean).length;

  if (weakModules >= 3) {
    confidenceAdjustment -= 10;
    riskAdjustment = "ELEVATE";
    bestSixImpact = "BOARD_ONLY_BIAS";
    resultsAdmissionImpact = "STRICT";
    reasons.push("Multiple weak data signals — risk elevated.");
  } else if (weakModules >= 1) {
    confidenceAdjustment -= 4;
    riskAdjustment = "MONITOR";
    reasons.push("Some data weakness — monitor risk.");
  }

  if (ddi.sameTeamCollision?.detected && ddi.sameTeamCollision.collisionScore >= 45) {
    confidenceAdjustment -= 6;
    reasons.push("Same-team collision pressure.");
  }

  const ohc = ddi.opponentHistoryComparison?.comparison || {};
  if (ohc.agreement === "NO_HISTORY" || ddi.opponentHistoryComparison?.opponentHistory?.noHistory) {
    // Neutral — no penalty for missing opponent history.
  } else if (ohc.confidenceImpact === "BOOST") {
    confidenceAdjustment += Math.round(4 * (ohc.weight || 1));
    reasons.push("Opponent history agrees with recent form.");
  } else if (ohc.confidenceImpact === "REDUCE") {
    confidenceAdjustment -= Math.round(4 * (ohc.weight || 0.55));
    reasons.push("Opponent history contradicts recent form.");
  }
  if (ohc.riskImpact === "RAISE") {
    riskAdjustment = riskAdjustment === "ELEVATE" ? "ELEVATE" : "MONITOR";
    reasons.push("Opponent history raises risk.");
  } else if (ohc.riskImpact === "LOWER") {
    reasons.push("Opponent history lowers risk.");
  }

  if (flipDecision.action === "BOTH_SIDES_WEAK") {
    decisionAdjustment = "PASS";
    bestSixImpact = "BOARD_OR_NO_BET";
    resultsAdmissionImpact = "BLOCK";
    reasons.push("Both sides weak after flip-first review.");
  }

  return {
    confidenceAdjustment,
    riskAdjustment,
    decisionAdjustment,
    bestSixImpact,
    resultsAdmissionImpact,
    reasons: reasons.slice(0, 6),
  };
}

export function evaluateDecisionDataIntelligence(pick = {}, options = {}) {
  const dataCard = options.dataCard || pick.wnbaDataCard || {};
  const reader = options.reader || pick.wnbaReader || {};
  const evalSide = normalizeSide(options.evalSide || pick.side || pick.pick || reader.finalSide);

  const roleStability = evaluateRoleStabilityIntelligence(
    { ...pick, side: evalSide },
    { dataCard, volumeProfile: pick.volumeProfile, opportunity: pick.opportunity, roleChange: pick.roleChange, side: evalSide }
  );
  const usageShare = evaluateUsageShareIntelligence(pick, {
    dataCard,
    roleChange: pick.roleChange,
    opportunity: pick.opportunity,
    playerState: pick.playerState,
    side: evalSide,
  });
  const sameTeamCollision = evaluateSameTeamUsageCollision(pick, {
    teamCandidates: options.teamCandidates,
    slateCandidates: options.slateCandidates,
    impliedTeamTotal: options.impliedTeamTotal,
    side: evalSide,
  });
  const marketIntelligence = evaluateMarketMovementIntelligence(pick, {
    dataCard,
    marketIntelligence: pick.marketIntelligence,
    side: evalSide,
  });
  const availabilityImpact = evaluateAvailabilityImpact(pick, {
    dataCard,
    availabilityGate: pick.availabilityGate,
    side: evalSide,
  });

  const opponentHistoryComparison = evaluateOpponentHistoryComparison(pick, {
    dataCard,
    reader,
    side: evalSide,
    line: pick.line,
    last5: options.last5 || pick.last5,
    matchupGames: options.matchupGames || pick.matchupGames,
  });

  const projectionQuality = evaluateProjectionQuality(pick, {
    dataCard,
    reader,
    usageShare,
    roleStability,
    marketIntelligence,
    side: evalSide,
  });

  const partial = {
    version: DECISION_DATA_INTELLIGENCE_VERSION,
    roleStability,
    usageShare,
    sameTeamCollision,
    marketIntelligence,
    availabilityImpact,
    opponentHistoryComparison,
    projectionQuality,
  };

  const flipFirstDecision = evaluateFlipFirstSideSelection(pick, {
    decisionDataIntelligence: partial,
    reader,
    dataCard,
    originalSide: options.originalSide || pick.initialSide || reader.finalSide || evalSide,
  });

  const finalInfluence = buildFinalInfluence(partial, flipFirstDecision);

  return {
    ...partial,
    flipFirstDecision,
    finalInfluence,
  };
}

export function applyDecisionDataIntelligenceToPick(pick = {}, options = {}) {
  const ddi =
    options.decisionDataIntelligence ||
    evaluateDecisionDataIntelligence(pick, options);

  const labels = buildFlipFirstCompactLabels(ddi);
  return {
    ...pick,
    decisionDataIntelligence: ddi,
    decisionDataIntelligenceVersion: DECISION_DATA_INTELLIGENCE_VERSION,
    flipFirstLabels: labels,
    opponentHistoryComparison: ddi.opponentHistoryComparison,
    opponentHistoryComparisonVersion: ddi.opponentHistoryComparison?.version,
    opponentHistoryLabel: labels.opponentHistory,
  };
}

export function buildFlipFirstCompactLabels(ddi = {}) {
  const usageStatus = ddi.usageShare?.status || "PARTIAL";
  const collisionStatus = ddi.sameTeamCollision?.detected
    ? ddi.sameTeamCollision.collisionScore >= 45
      ? "FLIP_WARNING"
      : "WARNING"
    : "CLEAR";
  const marketStatus = ddi.marketIntelligence?.marketWarning
    ? ddi.marketIntelligence?.sideImpact && ddi.marketIntelligence.sideImpact !== "NEUTRAL"
      ? "FLIP_SIGNAL"
      : "AGAINST"
    : ddi.marketIntelligence?.movement === "flat"
      ? "NEUTRAL"
      : "FAVORABLE";
  const availabilityStatus = ddi.availabilityImpact?.uncertaintyAdded
    ? "UNCERTAIN"
    : ["OUT", "DOUBTFUL"].includes(ddi.availabilityImpact?.playerStatus)
      ? "OUT"
      : "CONFIRMED";
  const projectionStatus = ddi.projectionQuality?.status || "MIXED";
  const flipCheck = ddi.flipFirstDecision?.action || "KEPT_ORIGINAL";
  const opponentHistory = buildOpponentHistoryCompactLabel(
    ddi.opponentHistoryComparison || {}
  );

  return {
    usage: usageStatus,
    collision: collisionStatus,
    market: marketStatus,
    availability: availabilityStatus,
    projectionQuality: projectionStatus,
    opponentHistory,
    flipCheck,
  };
}

export function runFlipFirstDecisionPipeline(pick = {}, options = {}) {
  const dataCard = options.dataCard || pick.wnbaDataCard;
  const reader = options.reader || pick.wnbaReader;
  const originalSide = normalizeSide(
    options.originalSide || pick.initialSide || reader?.finalSide || pick.side
  );

  let enriched = {
    ...pick,
    initialSide: originalSide || pick.initialSide,
  };

  enriched = applyDecisionDataIntelligenceToPick(enriched, {
    dataCard,
    reader,
    originalSide,
    teamCandidates: options.teamCandidates,
    slateCandidates: options.slateCandidates,
    impliedTeamTotal: options.impliedTeamTotal,
    last5: options.last5,
    matchupGames: options.matchupGames,
  });

  const fd = enriched.decisionDataIntelligence?.flipFirstDecision;
  if (fd?.flipRecommended && fd.finalSide) {
    const sideLabel = fd.finalSide === "OVER" ? "Over" : "Under";
    enriched = {
      ...enriched,
      side: sideLabel,
      pick: sideLabel,
      flippedFromSide: fd.originalSide,
      flipFirstFlipped: true,
    };
  }

  return enriched;
}
