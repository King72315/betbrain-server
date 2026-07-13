/**
 * CourtEdge Side Rescue v1 — second direction review when risk debt challenges initial side.
 */
import { evaluateWnbaTrackingEligibility } from "../wnba/wnbaResultsQualityGate.js";
import {
  applyDecisionIntelligenceToPick,
  evaluatePropDecisionIntelligenceV1,
} from "./propDecisionIntelligenceV1.js";
import { resolveQualityGateInputs } from "../wnba/wnbaGateInputs.js";

export const SIDE_RESCUE_VERSION = "side-rescue-v1.3";

const EXPANDING_ROLE = new Set(["up", "expanding", "rising"]);
const CONTRACTING_ROLE = new Set(["down", "contracting", "declining"]);
const FLIP_SCORE_FLOOR = 60;
const FLIP_MARGIN_DEFAULT = 10;
const FLIP_MARGIN_THIN_EDGE = 7;
const MIN_OPPOSITE_EVIDENCE = 2;

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

function normalizeReaderScore(score = 0) {
  return clamp(Math.round(Math.max(0, num(score)) * 4.5), 0, 100);
}

function projectionEdgeForSide(side = "", metrics = {}) {
  return side === "OVER"
    ? num(metrics.projection) - num(metrics.line)
    : num(metrics.line) - num(metrics.projection);
}

function flipFirstCheckOppositeAction(flipFirst = {}, originalSide = "") {
  const action = String(flipFirst?.action || "").toUpperCase();
  if (originalSide === "OVER" && action === "CHECK_UNDER") return true;
  if (originalSide === "UNDER" && action === "CHECK_OVER") return true;
  return false;
}

function hasFtaCollapse(metrics = {}, card = {}) {
  const recentFta = num(card.last5?.fta ?? metrics.fta);
  const seasonFta = num(card.season?.fta);
  if (recentFta <= 0 || seasonFta <= 0) return false;
  return recentFta <= seasonFta * 0.55;
}

function isMeaningfulDebt(debt = {}) {
  if (debt.severity === "KILL" || debt.severity === "HIGH") return true;
  if (debt.severity === "MEDIUM") return true;
  return false;
}

function debtChallengesOriginalSide(debt = {}, originalSide = "") {
  const side = debt.side || "BOTH";
  if (side === "BOTH") return true;
  return side === originalSide;
}

function collectTriggerDebts(riskDebts = [], originalSide = "", metrics = {}, gate = {}) {
  const triggered = [];
  for (const debt of riskDebts) {
    if (!debtChallengesOriginalSide(debt, originalSide)) continue;
    if (!isMeaningfulDebt(debt)) continue;
    triggered.push(debt);
  }

  const dangerStack = gate.dangerGateStack || [];
  if (originalSide === "UNDER") {
    if (
      (dangerStack.includes("ftaCollapse") || hasFtaCollapse(metrics, metrics.card)) &&
      !triggered.some((d) => d.code === "FTA_COLLAPSE_RISK")
    ) {
      triggered.push({
        code: "FTA_COLLAPSE_RISK",
        severity: "MEDIUM",
        reason: "Recent FTA collapsed vs season.",
        side: "UNDER",
      });
    }
    if (
      (metrics.volatility === "volatile" || metrics.volatility === "unstable") &&
      !triggered.some((d) => ["VOLATILE_MINUTES", "UNSTABLE_MINUTES"].includes(d.code))
    ) {
      triggered.push({
        code: metrics.volatility === "unstable" ? "UNSTABLE_MINUTES" : "VOLATILE_MINUTES",
        severity: metrics.volatility === "unstable" ? "HIGH" : "MEDIUM",
        reason: "Minutes volatility weakens Under.",
        side: "UNDER",
      });
    }
    if (EXPANDING_ROLE.has(metrics.roleTrend) && !triggered.some((d) => d.code === "ROLE_TREND_CONTRADICTS_SIDE")) {
      triggered.push({
        code: "ROLE_TREND_CONTRADICTS_SIDE",
        severity: "HIGH",
        reason: "Role expanding against Under.",
        side: "UNDER",
      });
    }
  }

  if (originalSide === "OVER") {
    if (dangerStack.includes("lowVolumeOverTrap") && !triggered.some((d) => d.code === "LOW_VOLUME_OVER_TRAP")) {
      triggered.push({ code: "LOW_VOLUME_OVER_TRAP", severity: "KILL", reason: "Low-volume Over trap.", side: "OVER" });
    }
    if (dangerStack.includes("efficiencyOnlyScoring") && !triggered.some((d) => d.code === "EFFICIENCY_ONLY_SCORING")) {
      triggered.push({ code: "EFFICIENCY_ONLY_SCORING", severity: "KILL", reason: "Efficiency-only Over.", side: "OVER" });
    }
    if (CONTRACTING_ROLE.has(metrics.roleTrend) && !triggered.some((d) => d.code === "ROLE_TREND_CONTRADICTS_SIDE")) {
      triggered.push({ code: "ROLE_TREND_CONTRADICTS_SIDE", severity: "HIGH", reason: "Role contracting against Over.", side: "OVER" });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of triggered) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    unique.push(item);
  }
  return unique;
}

function detectUnderFragility(metrics = {}, gate = {}, triggerDebts = []) {
  let count = 0;
  const factors = [];
  if (metrics.dataMode === "WNBA_LIMITED_DATA") { count += 1; factors.push("WNBA_LIMITED_DATA"); }
  if (metrics.volatility === "volatile" || metrics.volatility === "unstable") { count += 1; factors.push("VOLATILE_MINUTES"); }
  if (hasFtaCollapse(metrics, metrics.card) || triggerDebts.some((d) => d.code === "FTA_COLLAPSE_RISK")) {
    count += 1; factors.push("FTA_REBOUND_RISK");
  }
  if (!CONTRACTING_ROLE.has(metrics.roleTrend)) { count += 1; factors.push("ROLE_NOT_DOWN"); }
  if (metrics.defenseProxyUsed) { count += 1; factors.push("NEUTRAL_DEFENSE"); }
  if (metrics.availabilityDataMissing) { count += 1; factors.push("UNKNOWN_AVAILABILITY"); }
  if (metrics.projectionGap > 0 && metrics.projectionGap < 5) { count += 1; factors.push("THIN_PROJECTION_GAP"); }
  if ((gate.dangerGateCount ?? 0) >= 2) { count += 1; factors.push("DANGER_STACK"); }
  return { fragile: count >= 3, count, factors };
}

function originalSideWeaknessPenalty(debt = {}) {
  const weights = {
    FTA_COLLAPSE_RISK: 16, UNSTABLE_MINUTES: 18, VOLATILE_MINUTES: 14,
    ROLE_TREND_CONTRADICTS_SIDE: 20, LOW_VOLUME_OVER_TRAP: 28, EFFICIENCY_ONLY_SCORING: 24,
    THIN_EDGE: 12, THIN_NET_EDGE: 10, UNDER_FRAGILITY: 16, LOW_FGA: 14, LOW_MINUTES_FLOOR: 10,
    WNBA_LIMITED_DATA: 8, MISSING_AVAILABILITY: 8, MISSING_OPPONENT_DEFENSE: 5,
  };
  if (debt.severity === "KILL") return weights[debt.code] || 30;
  return weights[debt.code] || (debt.severity === "HIGH" ? 14 : 8);
}

function buildOppositeEvidence(oppositeSide = "", metrics = {}, reader = {}, card = {}) {
  const evidence = [];
  const line = metrics.line;
  const projection = metrics.projection;
  const recent = metrics.recent;
  const seasonPts = num(card.season?.points);
  const minutes = metrics.minutes;
  const fga = metrics.fga;
  const recentFta = num(card.last5?.fta);
  const seasonFta = num(card.season?.fta);
  const oppositeCase = oppositeSide === "OVER" ? reader.overCase : reader.underCase;

  if (oppositeCase?.score >= 8) {
    evidence.push({ code: "READER_CASE_STRONG", reason: `Reader ${oppositeSide} case ${num(oppositeCase.score).toFixed(1)}.` });
  } else if (oppositeCase?.score >= 4) {
    evidence.push({ code: "READER_CASE_MODERATE", reason: `Reader ${oppositeSide} case ${num(oppositeCase.score).toFixed(1)}.` });
  }

  if (oppositeSide === "OVER") {
    if (EXPANDING_ROLE.has(metrics.roleTrend)) evidence.push({ code: "EXPANDING_ROLE", reason: "Expanding role supports Over." });
    if (minutes >= 24) evidence.push({ code: "STRONG_MINUTES", reason: "Strong minutes for Over." });
    if (metrics.volatility === "volatile" || metrics.volatility === "unstable") {
      evidence.push({ code: "MINUTES_SPIKE_PATH", reason: "Volatile minutes create Over spike path." });
    }
    if (hasFtaCollapse(metrics, card) && seasonFta > recentFta) {
      evidence.push({ code: "FTA_REBOUND", reason: `FTA rebound risk (${recentFta.toFixed(1)} vs ${seasonFta.toFixed(1)}).` });
    }
    if (fga >= 9) evidence.push({ code: "STRONG_FGA", reason: "Strong FGA for Over." });
    if (recent > 0 && recent >= line - 1) evidence.push({ code: "RECENT_NEAR_LINE", reason: "Recent near line." });
    if (seasonPts > 0 && seasonPts >= line - 1) evidence.push({ code: "SEASON_NEAR_LINE", reason: "Season near line." });
    if (projection - line >= 2.5) evidence.push({ code: "PROJECTION_OVER", reason: "Projection supports Over." });
    if (metrics.fairLineSide === "OVER" && Math.abs(metrics.fairLineEdge) >= 3) {
      evidence.push({ code: "FAIR_LINE_OVER", reason: "Fair line supports Over." });
    }
    if (metrics.opportunityScore >= 55) evidence.push({ code: "OPPORTUNITY", reason: "Opportunity supports Over." });
  }

  if (oppositeSide === "UNDER") {
    if (CONTRACTING_ROLE.has(metrics.roleTrend)) evidence.push({ code: "CONTRACTING_ROLE", reason: "Contracting role supports Under." });
    if (minutes > 0 && minutes < 22) evidence.push({ code: "LOW_MINUTES", reason: "Low minutes support Under." });
    if (fga > 0 && fga < 8) evidence.push({ code: "LOW_FGA", reason: "Low FGA supports Under." });
    if (recentFta > 0 && recentFta < 2) evidence.push({ code: "LOW_FTA", reason: "Low FTA supports Under." });
    if (recent > 0 && recent <= line - 1.5) evidence.push({ code: "RECENT_BELOW_LINE", reason: "Recent below line." });
    if (seasonPts > 0 && seasonPts <= line - 1) evidence.push({ code: "SEASON_BELOW_LINE", reason: "Season below line." });
    if (line - projection >= 3) evidence.push({ code: "PROJECTION_UNDER", reason: "Projection supports Under." });
    if (metrics.fairLineSide === "UNDER" && Math.abs(metrics.fairLineEdge) >= 3) {
      evidence.push({ code: "FAIR_LINE_UNDER", reason: "Fair line supports Under." });
    }
    if (metrics.ptsPerFGA > 0 && metrics.seasonPtsPerFGA > 0 && metrics.ptsPerFGA >= metrics.seasonPtsPerFGA * 1.08) {
      evidence.push({ code: "EFFICIENCY_REGRESSION", reason: "Efficiency regression risk." });
    }
  }

  const unique = [];
  const seen = new Set();
  for (const item of evidence) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    unique.push(item);
  }
  return unique;
}

function oppositeKillDebts(oppositeSide = "", metrics = {}, gate = {}) {
  const kills = [];
  if (oppositeSide === "OVER") {
    if (metrics.fga > 0 && metrics.fga < 7 && metrics.minutes < 20) kills.push("LOW_VOLUME_OVER_TRAP");
    if (gate.trackingBlockReasons?.includes("LOW_VOLUME_OVER_TRAP")) kills.push("LOW_VOLUME_OVER_TRAP");
    if (gate.trackingBlockReasons?.includes("EFFICIENCY_ONLY_SCORING_SPIKE")) kills.push("EFFICIENCY_ONLY_SCORING");
  }
  if (oppositeSide === "UNDER") {
    if (EXPANDING_ROLE.has(metrics.roleTrend)) kills.push("ROLE_TREND_CONTRADICTS_SIDE");
    if (metrics.volatility === "unstable" && metrics.projectionGap < 3.5) kills.push("UNDER_FRAGILITY");
  }
  return [...new Set(kills)];
}

function hasMajorContradiction(oppositeSide = "", metrics = {}) {
  if (metrics.fairLineSide && metrics.fairLineSide !== "NONE" && metrics.fairLineSide !== oppositeSide &&
      Math.abs(metrics.fairLineEdge) >= 4 && metrics.fairLineQuality >= 55) return true;
  if (oppositeSide === "OVER" && metrics.projection <= metrics.line - 2) return true;
  if (oppositeSide === "UNDER" && metrics.projection >= metrics.line + 2) return true;
  return false;
}

function oppositeGapFloorFailed(side = "", reader = {}) {
  const caseRef = side === "OVER" ? reader.overCase : reader.underCase;
  if (!caseRef) return false;
  if (side === "UNDER") {
    if (caseRef.underGapFloorPassed === false) return true;
    if (
      caseRef.underGap != null &&
      caseRef.underGapFloorUsed != null &&
      num(caseRef.underGap) < num(caseRef.underGapFloorUsed)
    ) {
      return true;
    }
    return false;
  }
  if (side === "OVER") {
    if (caseRef.overGapFloorPassed === false) return true;
    if (
      caseRef.overGap != null &&
      caseRef.overGapFloorUsed != null &&
      num(caseRef.overGap) < num(caseRef.overGapFloorUsed)
    ) {
      return true;
    }
    return false;
  }
  return false;
}

function scoreSide(side = "", reader = {}, metrics = {}, evidence = [], options = {}) {
  const readerCase = side === "OVER" ? reader.overCase : reader.underCase;
  const rawReaderScore = num(
    readerCase?.preGapPenaltyScore ?? readerCase?.rawScore ?? readerCase?.score
  );
  let score = normalizeReaderScore(Math.max(0, rawReaderScore));
  const gapFailed = options.gapFloorFailed === true || oppositeGapFloorFailed(side, reader);
  const edge = projectionEdgeForSide(side, metrics);
  if (!gapFailed) {
    if (edge >= 4) score += 8;
    else if (edge >= 2.5) score += 4;
    else if (edge >= 1.5 && rawReaderScore < 6) score += 6;
    else if (edge <= 1) score -= 10;
  }

  const boosts = {
    READER_CASE_STRONG: 12, READER_CASE_MODERATE: 6, EXPANDING_ROLE: 10, CONTRACTING_ROLE: 10,
    STRONG_MINUTES: 8, MINUTES_SPIKE_PATH: 8, FTA_REBOUND: 14, STRONG_FGA: 8,
    RECENT_NEAR_LINE: 6, SEASON_NEAR_LINE: 5, PROJECTION_OVER: 10, PROJECTION_UNDER: 10,
    FAIR_LINE_OVER: 8, FAIR_LINE_UNDER: 8, OPPORTUNITY: 5, LOW_MINUTES: 6, LOW_FGA: 6,
    LOW_FTA: 5, RECENT_BELOW_LINE: 7, SEASON_BELOW_LINE: 5, EFFICIENCY_REGRESSION: 10,
  };
  if (!gapFailed) {
    for (const ev of evidence) score += boosts[ev.code] || 4;
    if (metrics.fairLineSide === side && Math.abs(metrics.fairLineEdge) >= 3.5) score += 6;
  }
  return clamp(Math.round(score), 0, 100);
}

function auditOppositeDisplayScore(
  oppositeSideScore = 0,
  oppositeRiskAdjusted = 0,
  oppositeEvidence = [],
  options = {}
) {
  const independent = oppositeEvidence.filter((e) => !String(e.code || "").startsWith("READER_CASE"));
  const gapFloorFailed = options.gapFloorFailed === true;
  const preGapPenaltyScore = num(options.preGapPenaltyScore);
  const preGapDisplay =
    preGapPenaltyScore > 0 ? normalizeReaderScore(preGapPenaltyScore) : 0;
  const evidenceFloor =
    !gapFloorFailed && preGapPenaltyScore > 0 && independent.length
      ? Math.min(36, independent.length * 8 + (independent.length >= 2 ? 6 : 0))
      : 0;
  return clamp(
    Math.round(
      Math.max(oppositeRiskAdjusted, oppositeSideScore, evidenceFloor, preGapDisplay)
    ),
    0,
    100
  );
}

function formatKeepOriginalReason({
  originalSide = "",
  originalRiskAdjusted = 0,
  oppositeRiskAdjusted = 0,
  oppositeSideScore = 0,
  oppositeEvidence = [],
  metrics = {},
  auditOptions = {},
}) {
  const oppositeAudit = auditOppositeDisplayScore(
    oppositeSideScore,
    oppositeRiskAdjusted,
    oppositeEvidence,
    auditOptions
  );
  const edge = projectionEdgeForSide(
    originalSide === "OVER" ? "UNDER" : "OVER",
    metrics
  );
  const evidenceCodes = oppositeEvidence
    .filter((e) => !String(e.code || "").startsWith("READER_CASE"))
    .slice(0, 2)
    .map((e) => e.code)
    .join(", ");
  let reason = `Original ${originalSide} stronger after adjustment (${originalRiskAdjusted} vs ${oppositeAudit}).`;
  if (oppositeAudit <= 8 && edge < 1.5) {
    reason += ` Opposite lacks projection support (gap ${edge.toFixed(1)}).`;
  } else if (evidenceCodes) {
    reason += ` Opposite signals: ${evidenceCodes}.`;
  }
  return reason;
}

function buildSimpleExplanation({ action = "", originalSide = "", finalSide = "", keepReasons = [], flipReasons = [], boardOnlyReasons = [], noBetReasons = [] }) {
  const orig = sideLabel(originalSide);
  const fin = sideLabel(finalSide);
  if (action === "KEEP_ORIGINAL") return `Side Rescue: KEEP ORIGINAL — ${keepReasons[0] || "Opposite did not earn support."}`;
  if (action === "FLIP_SIDE") return `Side Rescue: FLIPPED from ${orig} to ${fin} — ${flipReasons[0] || "Opposite earned rescue."}`;
  if (action === "BOARD_ONLY") return `Side Rescue: BOARD ONLY — ${boardOnlyReasons[0] || "Original fragile; opposite did not earn flip."}`;
  if (action === "NO_BET") return `Side Rescue: NO BET — ${noBetReasons[0] || "Both sides unreliable."}`;
  return "Side Rescue: not triggered.";
}

function evaluateWnbaSideRescue(candidate = {}, options = {}) {
  const di = options.decisionIntelligence || candidate.decisionIntelligence || {};
  const gate = options.gate || di.gate || {};
  const dataCard = options.dataCard || candidate.wnbaDataCard || {};
  const reader = options.reader || candidate.wnbaReader || {};
  const metrics = resolveQualityGateInputs(candidate, dataCard, reader);
  metrics.card = dataCard;
  metrics.fta = num(dataCard.last5?.fta ?? candidate.recentFTA);
  const flipFirst =
    options.flipFirstDecision ||
    candidate.flipFirstDecision ||
    candidate.decisionDataIntelligence?.flipFirstDecision ||
    {};

  const originalSide = normalizeSide(options.originalSide || candidate.initialSide || metrics.side || reader.finalSide);
  const oppositeSide = originalSide === "OVER" ? "UNDER" : "OVER";
  const triggerDebts = collectTriggerDebts(di.riskDebts || [], originalSide, metrics, gate);
  const underFragility = originalSide === "UNDER" ? detectUnderFragility(metrics, gate, triggerDebts) : { fragile: false, count: 0, factors: [] };
  const flipCheckOpposite = flipFirstCheckOppositeAction(flipFirst, originalSide);
  const triggerReasons = triggerDebts.map((d) => d.code);
  if (underFragility.fragile) triggerReasons.push("UNDER_FRAGILITY_STACK");
  if (flipCheckOpposite) triggerReasons.push("FLIP_FIRST_CHECK_OPPOSITE");
  let triggered = triggerDebts.length > 0 || underFragility.fragile || flipCheckOpposite;

  const oppositeEvidencePreview = buildOppositeEvidence(oppositeSide, metrics, reader, dataCard);
  const baselineOriginalScore = scoreSide(originalSide, reader, metrics, []);
  const baselineOppositeScore = scoreSide(
    oppositeSide,
    reader,
    metrics,
    oppositeEvidencePreview
  );

  if (!triggered) {
    return {
      version: SIDE_RESCUE_VERSION, league: "WNBA", triggered: false, originalSide, finalSide: originalSide,
      action: "KEEP_ORIGINAL", originalSideScore: baselineOriginalScore,
      oppositeSideScore: baselineOppositeScore,
      originalRiskAdjustedScore: baselineOriginalScore, oppositeRiskAdjustedScore: baselineOppositeScore,
      rescueScore: 0, flipConfidence: 0, triggerReasons: [], originalSideWeaknesses: [],
      oppositeSideEvidence: oppositeEvidencePreview, keepReasons: ["No meaningful risk debt challenging original side."],
      flipReasons: [], boardOnlyReasons: [], noBetReasons: [], riskDebtThatTriggeredReview: [],
      underFragility, simpleExplanation: buildSimpleExplanation({ action: "KEEP_ORIGINAL", originalSide, finalSide: originalSide }),
    };
  }

  const originalSideWeaknesses = triggerDebts.map((d) => ({ code: d.code, reason: d.reason || d.code, penalty: originalSideWeaknessPenalty(d) }));
  if (underFragility.fragile) {
    originalSideWeaknesses.push({ code: "UNDER_FRAGILITY_STACK", reason: `Under fragility (${underFragility.count} factors).`, penalty: 14 });
  }

  const oppositeEvidence = buildOppositeEvidence(oppositeSide, metrics, reader, dataCard);
  const oppositeCase = oppositeSide === "OVER" ? reader.overCase : reader.underCase;
  const oppositeAuditOptions = {
    gapFloorFailed: oppositeGapFloorFailed(oppositeSide, reader),
    preGapPenaltyScore: num(
      oppositeCase?.preGapPenaltyScore ?? oppositeCase?.rawScore ?? oppositeCase?.score
    ),
  };
  const originalSideScore = scoreSide(originalSide, reader, metrics, []);
  const oppositeSideScore = scoreSide(oppositeSide, reader, metrics, oppositeEvidence, {
    gapFloorFailed: oppositeAuditOptions.gapFloorFailed,
  });
  let originalRiskAdjusted = originalSideScore;
  for (const w of originalSideWeaknesses) originalRiskAdjusted -= w.penalty;
  if (metrics.dataMode === "WNBA_LIMITED_DATA") originalRiskAdjusted -= 6;
  if (metrics.availabilityDataMissing) originalRiskAdjusted -= 6;
  if (metrics.defenseProxyUsed) originalRiskAdjusted -= 4;
  originalRiskAdjusted = clamp(Math.round(originalRiskAdjusted), 0, 100);

  const oppositeKills = oppositeKillDebts(oppositeSide, metrics, gate);
  let oppositeRiskAdjusted = oppositeSideScore;
  for (const kill of oppositeKills) oppositeRiskAdjusted -= kill === "LOW_VOLUME_OVER_TRAP" ? 30 : 20;
  oppositeRiskAdjusted = clamp(Math.round(oppositeRiskAdjusted), 0, 100);

  const thinEdge = triggerDebts.some((d) => d.code === "THIN_EDGE");
  const flipMargin = thinEdge
    ? FLIP_MARGIN_THIN_EDGE
    : flipCheckOpposite
      ? Math.max(5, FLIP_MARGIN_DEFAULT - 3)
      : FLIP_MARGIN_DEFAULT;
  const flipScoreFloor = flipCheckOpposite ? Math.max(50, FLIP_SCORE_FLOOR - 8) : FLIP_SCORE_FLOOR;
  const minOppositeEvidence = flipCheckOpposite ? 1 : MIN_OPPOSITE_EVIDENCE;
  const independentEvidence = oppositeEvidence.filter((e) => !e.code.startsWith("READER_CASE"));
  const flipEligible = oppositeRiskAdjusted >= flipScoreFloor &&
    oppositeRiskAdjusted - originalRiskAdjusted >= flipMargin &&
    oppositeKills.length === 0 && independentEvidence.length >= minOppositeEvidence &&
    !hasMajorContradiction(oppositeSide, metrics);
  const bothChaotic = originalRiskAdjusted < 35 && oppositeRiskAdjusted < 45 &&
    (metrics.dataConfidence < 45 || metrics.availabilityDataMissing);

  let action = "KEEP_ORIGINAL";
  let finalSide = originalSide;
  const flipReasons = [];
  const keepReasons = [];
  const boardOnlyReasons = [];
  const noBetReasons = [];

  if (gate.trackingEligibility === "NO_BET" || triggerDebts.some((d) => d.severity === "KILL" || d.code === "LOW_VOLUME_OVER_TRAP")) {
    action = "NO_BET";
    finalSide = null;
    noBetReasons.push(
      gate.wnbaTrackingReason ||
        triggerDebts.find((d) => d.severity === "KILL" || d.code === "LOW_VOLUME_OVER_TRAP")?.reason ||
        "Kill-level risk debt blocks play."
    );
  } else if (bothChaotic && originalRiskAdjusted < 30) {
    action = "NO_BET"; finalSide = null;
    noBetReasons.push("Both sides unreliable with low confidence data.");
  } else if (flipEligible) {
    action = "FLIP_SIDE"; finalSide = oppositeSide;
    flipReasons.push(`Opposite ${oppositeSide} ${oppositeRiskAdjusted} vs original adjusted ${originalRiskAdjusted}.`);
    flipReasons.push(`${independentEvidence.length} independent evidence: ${independentEvidence.slice(0, 2).map((e) => e.code).join(", ")}.`);
    if (flipCheckOpposite) flipReasons.push("Flip-first CHECK_OPPOSITE review supported rescue.");
  } else if (originalRiskAdjusted >= 55 && originalRiskAdjusted > oppositeRiskAdjusted + 5) {
    keepReasons.push(
      formatKeepOriginalReason({
        originalSide,
        originalRiskAdjusted,
        oppositeRiskAdjusted,
        oppositeSideScore,
        oppositeEvidence,
        metrics,
        auditOptions: oppositeAuditOptions,
      })
    );
  } else if (
    gate.trackingEligibility === "BOARD_ONLY" ||
    originalRiskAdjusted < 50 ||
    underFragility.fragile ||
    triggerDebts.some((d) => d.severity === "KILL" || d.severity === "HIGH")
  ) {
    action = "BOARD_ONLY"; finalSide = originalSide;
    if (gate.trackingEligibility === "BOARD_ONLY") {
      boardOnlyReasons.push(gate.wnbaTrackingReason || "Gate demoted to board only.");
    }
    if (oppositeKills.length) boardOnlyReasons.push(`Opposite blocked: ${oppositeKills.join(", ")}.`);
    else if (independentEvidence.length < minOppositeEvidence) boardOnlyReasons.push("Opposite lacks independent evidence.");
    else if (oppositeRiskAdjusted < flipScoreFloor) boardOnlyReasons.push(`Opposite score ${oppositeRiskAdjusted} below floor ${flipScoreFloor}.`);
    else if (oppositeRiskAdjusted - originalRiskAdjusted < flipMargin) boardOnlyReasons.push(`Margin ${oppositeRiskAdjusted - originalRiskAdjusted} below ${flipMargin}.`);
    else if (hasMajorContradiction(oppositeSide, metrics)) boardOnlyReasons.push("Projection/fair-line contradict opposite.");
    else boardOnlyReasons.push("Original fragile; opposite did not earn flip.");
  } else {
    keepReasons.push("Original survives risk adjustment.");
  }

  return {
    version: SIDE_RESCUE_VERSION, league: "WNBA", triggered: true, originalSide, finalSide, action,
    originalSideScore, oppositeSideScore, originalRiskAdjustedScore: originalRiskAdjusted,
    oppositeRiskAdjustedScore: auditOppositeDisplayScore(
      oppositeSideScore,
      oppositeRiskAdjusted,
      oppositeEvidence,
      oppositeAuditOptions
    ),
    rescueScore: clamp(Math.round(oppositeRiskAdjusted - originalRiskAdjusted + independentEvidence.length * 5), 0, 100),
    flipConfidence: action === "FLIP_SIDE" ? clamp(Math.round((oppositeRiskAdjusted - originalRiskAdjusted) * 2 + independentEvidence.length * 8), 0, 100) : 0,
    flipMarginRequired: flipMargin, flipScoreFloor,
    triggerReasons: [...new Set(triggerReasons)], originalSideWeaknesses, oppositeSideEvidence: oppositeEvidence,
    oppositeKillDebts: oppositeKills, keepReasons, flipReasons, boardOnlyReasons, noBetReasons,
    riskDebtThatTriggeredReview: triggerDebts, underFragility,
    simpleExplanation: buildSimpleExplanation({ action, originalSide, finalSide: finalSide || originalSide, flipReasons, keepReasons, boardOnlyReasons, noBetReasons }),
  };
}

export function evaluateSideRescue(candidate = {}, options = {}) {
  const league = String(candidate.league || options.league || "").toUpperCase();
  if (league === "WNBA") return evaluateWnbaSideRescue(candidate, options);
  const side = normalizeSide(candidate.side || candidate.pick);
  return {
    version: SIDE_RESCUE_VERSION, league: league || "UNKNOWN", triggered: false, originalSide: side, finalSide: side,
    action: "KEEP_ORIGINAL", originalSideScore: 50, oppositeSideScore: 50, originalRiskAdjustedScore: 50,
    oppositeRiskAdjustedScore: 50, rescueScore: 0, flipConfidence: 0, triggerReasons: [], originalSideWeaknesses: [],
    oppositeSideEvidence: [], keepReasons: ["Side Rescue passthrough."], flipReasons: [], boardOnlyReasons: [],
    noBetReasons: [], riskDebtThatTriggeredReview: [], simpleExplanation: "Side Rescue passthrough.", passthrough: true,
  };
}

export function applySideRescueEligibilityOverlay(pick = {}, sideRescue = null) {
  const sr = sideRescue || pick.sideRescue;
  if (!sr) return pick;

  const gateDecision = String(
    pick.wnbaTrackingDecision || pick.trackingEligibility || ""
  ).toUpperCase();
  const diEligibility = String(
    pick.decisionIntelligence?.trackEligibility || ""
  ).toUpperCase();
  const hasKillDebt = (pick.decisionIntelligence?.riskDebts || []).some(
    (d) => d.severity === "KILL" || d.code === "LOW_VOLUME_OVER_TRAP"
  );

  if (gateDecision === "NO_BET" || diEligibility === "NO_BET" || hasKillDebt) {
    return {
      ...pick,
      trackingEligibility: "NO_BET",
      wnbaTrackingDecision: "NO_BET",
      wnbaTrackingReason:
        pick.wnbaTrackingReason ||
        sr.noBetReasons?.[0] ||
        pick.decisionIntelligence?.gateReason ||
        "GATE_NO_BET_PRESERVED",
      bestSixEligibility: false,
      topPickEligibility: false,
      noPlay: true,
    };
  }

  if (sr.action === "BOARD_ONLY") {
    return { ...pick, trackingEligibility: "BOARD_ONLY", wnbaTrackingDecision: "BOARD_ONLY",
      wnbaTrackingReason: sr.boardOnlyReasons?.[0] || "SIDE_RESCUE_BOARD_ONLY", bestSixEligibility: false, topPickEligibility: false };
  }
  if (sr.action === "NO_BET") {
    return { ...pick, trackingEligibility: "NO_BET", wnbaTrackingDecision: "NO_BET",
      wnbaTrackingReason: sr.noBetReasons?.[0] || "SIDE_RESCUE_NO_BET", bestSixEligibility: false, topPickEligibility: false, noPlay: true };
  }
  return pick;
}

export function applySideRescueToPick(pick = {}, sideRescue = null, options = {}) {
  const sr = sideRescue || evaluateSideRescue(pick, {
    decisionIntelligence: pick.decisionIntelligence, gate: pick.decisionIntelligence?.gate,
    dataCard: options.dataCard || pick.wnbaDataCard, reader: options.reader || pick.wnbaReader,
    originalSide: pick.initialSide || normalizeSide(pick.side || pick.pick),
  });
  let enriched = { ...pick, initialSide: sr.originalSide, sideRescue: sr, sideRescueVersion: SIDE_RESCUE_VERSION,
    sideRescueAction: sr.action, sideRescueExplanation: sr.simpleExplanation };
  if (sr.action === "FLIP_SIDE" && sr.finalSide) {
    const newLabel = sideLabel(sr.finalSide);
    enriched = { ...enriched, side: newLabel, pick: newLabel, flippedFromSide: sr.originalSide,
      flippedFromSideLabel: sideLabel(sr.originalSide), sideRescueFlipped: true };
  } else if (sr.finalSide) {
    const finalLabel = sideLabel(sr.finalSide);
    enriched = { ...enriched, side: finalLabel, pick: finalLabel };
  }
  return applySideRescueEligibilityOverlay(enriched, sr);
}

export function runSideRescuePipeline(pick = {}, options = {}) {
  const dataCard = options.dataCard || pick.wnbaDataCard;
  const reader = options.reader || pick.wnbaReader;
  const gate = options.gate;
  const decisionIntelligence = options.decisionIntelligence || pick.decisionIntelligence ||
    evaluatePropDecisionIntelligenceV1(pick, { dataCard, reader, gate });
  let enriched = applyDecisionIntelligenceToPick(pick, decisionIntelligence, gate);
  enriched.initialSide = enriched.initialSide || normalizeSide(pick.side || pick.pick || reader?.finalSide);
  const sideRescue = evaluateSideRescue(enriched, { decisionIntelligence: enriched.decisionIntelligence,
    gate: gate || enriched.decisionIntelligence?.gate, dataCard, reader, originalSide: enriched.initialSide });
  enriched = applySideRescueToPick(enriched, sideRescue, { dataCard, reader });
  if (sideRescue.action === "FLIP_SIDE" && sideRescue.finalSide) {
    const flippedGate = evaluateWnbaTrackingEligibility(enriched, dataCard, reader);
    const flippedDi = evaluatePropDecisionIntelligenceV1(enriched, { dataCard, reader, gate: flippedGate });
    enriched = applyDecisionIntelligenceToPick(enriched, flippedDi, flippedGate);
    enriched = applySideRescueToPick(enriched, { ...sideRescue, postFlipGate: flippedGate }, { dataCard, reader });
  }
  return enriched;
}

function recordFor(props = []) {
  const wins = props.filter((p) => String(p.status).toLowerCase() === "win").length;
  const losses = props.filter((p) => String(p.status).toLowerCase() === "loss").length;
  const pushes = props.filter((p) => String(p.status).toLowerCase() === "push").length;
  const graded = wins + losses + pushes;
  return { count: props.length, wins, losses, pushes, graded, record: `${wins}-${losses}-${pushes}`,
    winRate: graded > 0 ? Number(((wins / graded) * 100).toFixed(1)) : null };
}

export function buildSideRescueReview(slateProps = []) {
  const withRescue = slateProps.filter((p) => p.sideRescue);
  const byAction = { KEEP_ORIGINAL: [], FLIP_SIDE: [], BOARD_ONLY: [], NO_BET: [] };
  for (const prop of withRescue) {
    const sr = prop.sideRescue;
    const bucket = byAction[sr.action] || byAction.KEEP_ORIGINAL;
    bucket.push({ player: prop.player, line: prop.line, originalSide: sr.originalSide, finalSide: sr.finalSide,
      action: sr.action, status: prop.status, triggerReasons: sr.triggerReasons, explanation: sr.simpleExplanation });
  }
  return {
    title: "Side Rescue Review", version: SIDE_RESCUE_VERSION, evaluatedCount: withRescue.length, totalProps: slateProps.length,
    actionRecords: { KEEP_ORIGINAL: recordFor(byAction.KEEP_ORIGINAL), FLIP_SIDE: recordFor(byAction.FLIP_SIDE),
      BOARD_ONLY: recordFor(byAction.BOARD_ONLY), NO_BET: recordFor(byAction.NO_BET) },
    wnbaUnderRescueRecord: recordFor(withRescue.filter((p) => p.sideRescue?.originalSide === "UNDER" && p.sideRescue?.triggered)),
    wnbaOverRescueRecord: recordFor(withRescue.filter((p) => p.sideRescue?.originalSide === "OVER" && p.sideRescue?.triggered)),
    ftaReboundRiskRecord: recordFor(withRescue.filter((p) => (p.sideRescue?.triggerReasons || []).some((r) => String(r).includes("FTA")))),
    volatileMinutesRescueRecord: recordFor(withRescue.filter((p) => (p.sideRescue?.triggerReasons || []).some((r) => String(r).includes("VOLATILE") || String(r).includes("UNSTABLE")))),
    lowVolumeOverTrapRescueRecord: recordFor(withRescue.filter((p) => (p.sideRescue?.triggerReasons || []).some((r) => String(r).includes("LOW_VOLUME")))),
    entries: [...byAction.FLIP_SIDE, ...byAction.BOARD_ONLY, ...byAction.KEEP_ORIGINAL].slice(0, 30),
    question: "Did Side Rescue improve direction without over-flipping?",
  };
}

export function buildSideRescueRetroSimulation(props = [], options = {}) {
  const slateDate = options.slateDate || "";
  const actualTracked = props.filter((p) => String(p.league).toUpperCase() === "WNBA" &&
    (p.trackingEligibility === "TRACK" || p.trackingAdmissionSource === "CONTROLLED_BEST_SIX" || p.wnbaTrackingDecision === "TRACK"));
  const simulated = [];
  for (const prop of props.filter((p) => String(p.league).toUpperCase() === "WNBA")) {
    if (!prop.wnbaDataCard && !prop.wnbaReader) continue;
    const originalSide = normalizeSide(prop.initialSide || prop.sideRescue?.originalSide || prop.wnbaReader?.finalSide);
    const replayPick = { ...prop, side: sideLabel(originalSide), pick: sideLabel(originalSide), initialSide: originalSide };
    const sideRescue = prop.sideRescue || evaluateSideRescue(replayPick, {
      decisionIntelligence: prop.decisionIntelligence, gate: prop.decisionIntelligence?.gate,
      dataCard: prop.wnbaDataCard, reader: prop.wnbaReader, originalSide,
    });
    simulated.push({ player: prop.player, line: prop.line, originalSide: sideRescue.originalSide, finalSide: sideRescue.finalSide,
      action: sideRescue.action, triggered: sideRescue.triggered, triggerReasons: sideRescue.triggerReasons,
      explanation: sideRescue.simpleExplanation, actualStatus: prop.status,
      actualSide: normalizeSide(prop.side || prop.pick), wouldTrack: sideRescue.action === "KEEP_ORIGINAL" || sideRescue.action === "FLIP_SIDE" });
  }
  const actualRecord = recordFor(actualTracked);
  const simTracked = simulated.filter((s) => s.wouldTrack);
  const simRecord = recordFor(simTracked.map((s) => {
    const prop = props.find((p) => p.player === s.player && p.line === s.line);
    return { status: prop?.status };
  }));
  return {
    title: "Side Rescue Retro Simulation", version: SIDE_RESCUE_VERSION, slateDate, reportOnly: true, noMutation: true,
    actualTrackedRecord: actualRecord, simulatedSideRescueRecord: simRecord,
    lossesWouldStayOriginal: simulated.filter((s) => s.action === "KEEP_ORIGINAL" && String(s.actualStatus).toLowerCase() === "loss").length,
    lossesWouldFlip: simulated.filter((s) => s.action === "FLIP_SIDE" && String(s.actualStatus).toLowerCase() === "loss").length,
    lossesWouldBoardOnly: simulated.filter((s) => (s.action === "BOARD_ONLY" || s.action === "NO_BET") && String(s.actualStatus).toLowerCase() === "loss").length,
    winsLostByRuleChange: simulated.filter((s) => s.action !== "KEEP_ORIGINAL" && String(s.actualStatus).toLowerCase() === "win").length,
    netTrackedChange: simTracked.length - actualTracked.length, simulated,
    dearicaStyleCases: simulated.filter((s) => s.triggered && s.originalSide === "UNDER" &&
      (s.triggerReasons || []).some((r) => String(r).includes("FTA") || String(r).includes("VOLATILE") || String(r).includes("FRAGILITY"))),
    assessment: simRecord.winRate != null && actualRecord.winRate != null
      ? (simRecord.winRate >= actualRecord.winRate ? "Side Rescue may help or neutral on this slate." : "Side Rescue may be too aggressive on this slate.")
      : "Insufficient graded data for net assessment.",
  };
}
