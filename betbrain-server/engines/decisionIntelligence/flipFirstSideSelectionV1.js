/**
 * Flip-First Side Selection v1 — evaluate opposite side before downgrade/block.
 */
import { resolveQualityGateInputs } from "../wnba/wnbaGateInputs.js";
import { resolveWnbaGapFloor } from "../wnba/wnbaGraduatedDataModeV1.js";
import { countIndependentEvidenceCategories } from "./sideSelectionTrustV1.js";

export const FLIP_FIRST_VERSION = "flip-first-side-selection-v1";

const FLIP_SCORE_FLOOR = 58;
const FLIP_MARGIN_DEFAULT = 8;
const MIN_OPPOSITE_EVIDENCE = 2;

const EXPANDING = new Set(["up", "expanding", "rising"]);
const CONTRACTING = new Set(["down", "contracting", "declining"]);

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

function sideLabel(side = "") {
  return side === "OVER" ? "Over" : side === "UNDER" ? "Under" : "";
}

function impactAgainstSide(impact = "", side = "") {
  if (!impact || impact === "NEUTRAL" || !side) return false;
  return impact !== side;
}

function impactSupportsSide(impact = "", side = "") {
  return impact === side;
}

function collectOriginalProblems(ddi = {}, originalSide = "") {
  const problems = [];
  const modules = [
    ddi.roleStability,
    ddi.usageShare,
    ddi.sameTeamCollision,
    ddi.marketIntelligence,
    ddi.availabilityImpact,
    ddi.opponentHistoryComparison,
    ddi.projectionQuality,
  ];
  for (const mod of modules) {
    if (!mod) continue;
    if (mod.status === "BAD" || mod.status === "WEAK") {
      problems.push({ code: "MODULE_BAD", reason: mod.reasons?.[0] || "Weak signal profile." });
    }
    if (impactAgainstSide(mod.sideImpact, originalSide)) {
      problems.push({ code: "SIDE_IMPACT", reason: mod.reasons?.[0] || `${mod.sideImpact} impact vs ${originalSide}.` });
    }
    if (mod.marketWarning && originalSide) {
      problems.push({ code: "MARKET_WARNING", reason: mod.reasons?.[0] || "Market warning." });
    }
    if (mod.hotGameRisk && originalSide === "OVER") {
      problems.push({ code: "HOT_GAME", reason: "Hot-game inflation risk on Over." });
    }
    if (mod.detected && mod.recommendation === "FLIP_TO_UNDER" && originalSide === "OVER") {
      problems.push({ code: "SAME_TEAM_COLLISION", reason: mod.reasons?.[0] || "Same-team collision." });
    } else if (mod.detected && mod.collisionScore >= 30 && originalSide === "OVER") {
      problems.push({
        code: "SAME_TEAM_COLLISION_WARNING",
        reason: mod.reasons?.[0] || "Same-team usage collision warning.",
      });
    }
  }

  const ohc = ddi.opponentHistoryComparison?.comparison || {};
  const oppHist = ddi.opponentHistoryComparison?.opponentHistory || {};
  if (
    !oppHist.noHistory &&
    ohc.agreement === "CONTRADICTS_RECENT" &&
    (ohc.weight || 0) >= 0.55 &&
    ohc.flipSignal &&
    ohc.flipSignal !== "NONE"
  ) {
    problems.push({
      code: "OPPONENT_HISTORY_CONTRADICTS",
      reason: ohc.reasons?.[0] || "Opponent history contradicts recent form.",
    });
  }

  return problems;
}

function collectMetricsGateProblems(pick = {}, metrics = {}, originalSide = "", ddi = {}) {
  const problems = [];
  const { gapFloorApplied: gapFloor } = resolveWnbaGapFloor({ ...metrics, side: originalSide });
  if (metrics.projectionGap > 0 && metrics.projectionGap < gapFloor) {
    problems.push({
      code: "THIN_GAP",
      reason: `Projection gap ${metrics.projectionGap.toFixed(1)} below ${gapFloor} floor — opposite-side review.`,
    });
  }

  const market = ddi.marketIntelligence || pick.decisionDataIntelligence?.marketIntelligence || {};
  if (market.marketWarning && market.sideImpact && market.sideImpact !== originalSide && market.sideImpact !== "NEUTRAL") {
    problems.push({
      code: "MARKET_AGAINST",
      reason: market.reasons?.[0] || "Market movement against original side.",
    });
  }

  const dangerGates = pick.volumeDangerGates?.gates || [];
  if (originalSide === "OVER" && dangerGates.includes("efficiency_only_scoring")) {
    problems.push({
      code: "EFFICIENCY_ONLY",
      reason: "Efficiency-only scoring risk on Over.",
    });
  }
  if (
    originalSide === "OVER" &&
    (dangerGates.includes("unstable_minutes") ||
      metrics.volatility === "unstable" ||
      metrics.volatility === "volatile")
  ) {
    problems.push({
      code: "UNSTABLE_MINUTES",
      reason: "Unstable or volatile minutes profile.",
    });
  }
  if (
    originalSide === "OVER" &&
    metrics.fga > 0 &&
    metrics.fga < 7 &&
    metrics.minutes < 20
  ) {
    problems.push({
      code: "LOW_VOLUME_OVER_TRAP",
      reason: "Low volume over trap — review Under.",
    });
  }
  if (pick.wnbaTrackingReason === "DANGER_STACK_INSUFFICIENT_EDGE") {
    problems.push({
      code: "DANGER_STACK_INSUFFICIENT_EDGE",
      reason: "Danger stack with insufficient edge.",
    });
  }
  return problems;
}

function scoreSideFromModules(side = "", ddi = {}, reader = {}, metrics = {}) {
  const readerCase = side === "OVER" ? reader.overCase : reader.underCase;
  const rawReaderScore = num(
    readerCase?.preGapPenaltyScore ?? readerCase?.rawScore ?? readerCase?.score
  );
  let score = clamp(Math.round(Math.max(0, rawReaderScore) * 4.5), 0, 100);
  const reasons = [];

  const edge = side === "OVER" ? metrics.projection - metrics.line : metrics.line - metrics.projection;
  if (edge >= 4) {
    score += 10;
    reasons.push(`Projection gap ${edge.toFixed(1)} supports ${side}.`);
  } else if (edge >= 2.5) {
    score += 5;
    reasons.push(`Projection gap ${edge.toFixed(1)} supports ${side}.`);
  } else if (edge >= 1.5 && rawReaderScore < 6) {
    score += 6;
    reasons.push(`Moderate ${side} edge despite weak reader case.`);
  } else if (edge <= 1) {
    score -= 12;
    reasons.push(`Thin ${side} gap.`);
  }

  const modules = [
    ["roleStability", ddi.roleStability],
    ["usageShare", ddi.usageShare],
    ["marketIntelligence", ddi.marketIntelligence],
    ["availabilityImpact", ddi.availabilityImpact],
    ["opponentHistoryComparison", ddi.opponentHistoryComparison],
    ["projectionQuality", ddi.projectionQuality],
  ];
  for (const [key, mod] of modules) {
    if (!mod) continue;
    const weight =
      key === "opponentHistoryComparison"
        ? mod.comparison?.weight || (mod.opponentHistory?.noHistory ? 0 : 0.55)
        : 1;
    if (weight <= 0) continue;
    if (impactSupportsSide(mod.sideImpact, side)) score += Math.round(8 * weight);
    if (impactAgainstSide(mod.sideImpact, side)) score -= Math.round(10 * weight);
    if (mod.score != null) score += Math.round((num(mod.score) - 50) * 0.15 * weight);
  }

  if (side === "OVER") {
    if (EXPANDING.has(metrics.roleTrend)) score += 8;
    if (CONTRACTING.has(metrics.roleTrend)) score -= 12;
    if (metrics.fga > 0 && metrics.fga < 7 && metrics.minutes < 20) score -= 20;
  }
  if (side === "UNDER") {
    if (CONTRACTING.has(metrics.roleTrend)) score += 8;
    if (EXPANDING.has(metrics.roleTrend)) score -= 12;
    if (metrics.volatility === "unstable" || metrics.volatility === "volatile") score -= 8;
  }

  if (metrics.fairLineSide === side && Math.abs(metrics.fairLineEdge) >= 3.5) score += 8;

  if (readerCase?.score >= 8) {
    reasons.push(`Reader ${side} case strong.`);
  }

  return { score: clamp(Math.round(score), 0, 100), reasons };
}

function oppositeKillDebts(side = "", metrics = {}) {
  const kills = [];
  if (side === "OVER") {
    if (metrics.fga > 0 && metrics.fga < 7 && metrics.minutes < 20) kills.push("LOW_VOLUME_OVER_TRAP");
    if (CONTRACTING.has(metrics.roleTrend)) kills.push("ROLE_CONTRADICTS_OVER");
  }
  if (side === "UNDER") {
    if (EXPANDING.has(metrics.roleTrend)) kills.push("ROLE_CONTRADICTS_UNDER");
    if ((metrics.volatility === "unstable" || metrics.volatility === "volatile") && metrics.projectionGap < 3.5) {
      kills.push("UNDER_FRAGILITY");
    }
  }
  return kills;
}

export function evaluateFlipFirstSideSelection(pick = {}, options = {}) {
  const ddi = options.decisionDataIntelligence || pick.decisionDataIntelligence || {};
  const reader = options.reader || pick.wnbaReader || {};
  const dataCard = options.dataCard || pick.wnbaDataCard || {};
  const metrics = resolveQualityGateInputs(pick, dataCard, reader);
  const originalSide = normalizeSide(
    options.originalSide || pick.initialSide || pick.readerSide || reader.finalSide || metrics.side
  );
  const oppositeSide = originalSide === "OVER" ? "UNDER" : "OVER";

  const originalProblems = [
    ...collectOriginalProblems(ddi, originalSide),
    ...collectMetricsGateProblems(pick, metrics, originalSide, ddi),
  ];
  const originalScored = scoreSideFromModules(originalSide, ddi, reader, metrics);
  const oppositeScored = scoreSideFromModules(oppositeSide, ddi, reader, metrics);

  const flipTriggered = originalProblems.length > 0;
  const flipTriggerReasons = originalProblems.map((p) => p.code);
  const oppositeSideEvidence = oppositeScored.reasons.filter(Boolean);

  const thinEdge = metrics.projectionGap > 0 && metrics.projectionGap < 3;
  const flipMargin = FLIP_MARGIN_DEFAULT;
  const oppositeKills = oppositeKillDebts(oppositeSide, metrics);
  const independentEvidence = oppositeScored.reasons.filter(Boolean);
  const independentCategoryCount = countIndependentEvidenceCategories(
  oppositeSideEvidence.map((reason) => ({ code: reason, category: null }))
  );

  let flipRecommended = false;
  let finalSide = originalSide;
  const flipReasons = [];
  const noFlipReasons = [];
  const reasons = [];

  if (originalProblems.length === 0) {
    noFlipReasons.push("Original side has no meaningful problems — flip-first not triggered.");
    reasons.push(...noFlipReasons);
    return {
      version: FLIP_FIRST_VERSION,
      originalSide,
      oppositeSideChecked: false,
      originalSideScore: originalScored.score,
      oppositeSideScore: oppositeScored.score,
      flipRecommended: false,
      finalSide: originalSide,
      flipReason: "",
      noFlipReason: noFlipReasons[0],
      action: "KEPT_ORIGINAL",
      flipTriggered: false,
      flipTriggerReasons: [],
      oppositeSideEvidence: [],
      whyRetainedFlippedOrPass: noFlipReasons[0],
      flipFirstAudit: {
        flipTriggered: false,
        flipTriggerReasons: [],
        oppositeSideEvidence: [],
        whyRetainedFlippedOrPass: noFlipReasons[0],
      },
      reasons,
    };
  }

  reasons.push(`Original problems: ${originalProblems.map((p) => p.code).join(", ")}.`);

  if (oppositeKills.length > 0) {
    noFlipReasons.push(`Opposite blocked: ${oppositeKills.join(", ")}.`);
  } else if (oppositeScored.score < FLIP_SCORE_FLOOR) {
    noFlipReasons.push(`Opposite score ${oppositeScored.score} below floor ${FLIP_SCORE_FLOOR}.`);
  } else if (oppositeScored.score - originalScored.score < flipMargin) {
    noFlipReasons.push(
      `Opposite margin ${oppositeScored.score - originalScored.score} below ${flipMargin}.`
    );
  } else if (
    independentCategoryCount < MIN_OPPOSITE_EVIDENCE &&
    independentEvidence.length < MIN_OPPOSITE_EVIDENCE &&
    oppositeScored.score < 70
  ) {
    noFlipReasons.push("Opposite lacks independent evidence.");
  } else {
    flipRecommended = true;
    finalSide = oppositeSide;
    flipReasons.push(
      `Opposite ${oppositeSide} scored ${oppositeScored.score} vs original ${originalScored.score}.`
    );
    flipReasons.push(originalProblems[0]?.reason || "Original side problems triggered review.");
    reasons.push(...flipReasons);
  }

  const underGapFloor = resolveWnbaGapFloor({ ...metrics, side: "UNDER" }).gapFloorApplied;
  const underGapFloorFail =
    originalSide === "UNDER" &&
    metrics.projectionGap > 0 &&
    metrics.projectionGap < underGapFloor;

  let action = "KEPT_ORIGINAL";
  if (flipRecommended) action = finalSide === "OVER" ? "FLIPPED_TO_OVER" : "FLIPPED_TO_UNDER";
  else if (underGapFloorFail && !flipRecommended) {
    action = "BOTH_SIDES_WEAK";
    noFlipReasons.push(
      `Under gap ${metrics.projectionGap.toFixed(1)} below ${underGapFloor} floor — both sides weak.`
    );
  } else if (originalScored.score < 42 && oppositeScored.score < 42) action = "BOTH_SIDES_WEAK";
  else if (originalProblems.length > 0)
    action = originalSide === "OVER" ? "CHECK_UNDER" : "CHECK_OVER";
  else action = "KEPT_ORIGINAL";

  if (!flipRecommended) reasons.push(...noFlipReasons);

  const whyRetainedFlippedOrPass = flipRecommended
    ? flipReasons[0] || `Flipped to ${finalSide}.`
    : noFlipReasons[0] || "Original retained after opposite review.";

  const flipFirstAudit = {
    flipTriggered,
    flipTriggerReasons,
    oppositeSideEvidence,
    whyRetainedFlippedOrPass,
    oppositeSideChecked: true,
    originalSideScore: originalScored.score,
    oppositeSideScore: oppositeScored.score,
    flipRecommended,
    thinGapTriggeredReview: thinEdge,
    flipMarginUsed: flipMargin,
    independentEvidenceCategoryCount: independentCategoryCount,
  };

  return {
    version: FLIP_FIRST_VERSION,
    originalSide,
    oppositeSideChecked: true,
    originalSideScore: originalScored.score,
    oppositeSideScore: oppositeScored.score,
    flipRecommended,
    finalSide: flipRecommended ? finalSide : originalSide,
    flipReason: flipReasons[0] || "",
    noFlipReason: noFlipReasons[0] || "",
    action,
    flipTriggered,
    flipTriggerReasons,
    oppositeSideEvidence,
    whyRetainedFlippedOrPass,
    flipFirstAudit,
    thinGapTriggeredReview: thinEdge,
    flipMarginUsed: flipMargin,
    independentEvidenceCategoryCount: independentCategoryCount,
    originalProblems,
    reasons: reasons.slice(0, 8),
  };
}

export function applyFlipFirstSideSelectionToPick(pick = {}, flipDecision = null, options = {}) {
  const fd =
    flipDecision ||
    evaluateFlipFirstSideSelection(pick, {
      decisionDataIntelligence: pick.decisionDataIntelligence,
      reader: options.reader || pick.wnbaReader,
      dataCard: options.dataCard || pick.wnbaDataCard,
      originalSide: pick.initialSide,
    });

  let enriched = {
    ...pick,
    flipFirstDecision: fd,
    flipFirstVersion: FLIP_FIRST_VERSION,
    flipFirstAction: fd.action,
    flipFirstExplanation: fd.flipReason || fd.noFlipReason || "",
    flipFirstAudit: fd.flipFirstAudit || {
      flipTriggered: fd.flipTriggered,
      flipTriggerReasons: fd.flipTriggerReasons || [],
      oppositeSideEvidence: fd.oppositeSideEvidence || [],
      whyRetainedFlippedOrPass: fd.whyRetainedFlippedOrPass || "",
    },
  };

  if (fd.flipRecommended && fd.finalSide) {
    const label = sideLabel(fd.finalSide);
    enriched = {
      ...enriched,
      side: label,
      pick: label,
      flippedFromSide: fd.originalSide,
      flippedFromSideLabel: sideLabel(fd.originalSide),
      flipFirstFlipped: true,
      readerSide: fd.originalSide,
    };
  } else {
    enriched.readerSide = fd.originalSide;
  }

  return enriched;
}
