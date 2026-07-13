/**
 * CourtEdge Side Selection Trust v1 — canonical decision bundle, audit, and Lab learning.
 */
import { createHash } from "crypto";
import { resolveQualityGateInputs } from "../wnba/wnbaGateInputs.js";
import { resolveWnbaGapFloor, resolveWnbaGapFloors } from "../wnba/wnbaGraduatedDataModeV1.js";

export const SIDE_SELECTION_TRUST_VERSION = "side-selection-trust-v1";

const CANONICAL_DEBT_IDS = new Set([
  "UNSTABLE_MINUTES",
  "VOLATILE_MINUTES",
  "THIN_PROJECTION_GAP",
  "THIN_EDGE",
  "THIN_NET_EDGE",
  "LOW_VOLUME_OVER_TRAP",
  "SAME_TEAM_COLLISION",
  "FAIR_LINE_STRONG_DISAGREE",
  "MISSING_OPPONENT_DEFENSE",
  "MARKET_AGAINST",
  "ONE_BOOK_MARKET",
  "LOW_BOOK_COUNT",
  "LOW_FGA",
  "LOW_MINUTES_FLOOR",
  "EFFICIENCY_ONLY_SCORING",
  "UNDER_FRAGILITY",
  "ROLE_TREND_CONTRADICTS_SIDE",
  "FTA_COLLAPSE_RISK",
  "WNBA_LIMITED_DATA",
  "MISSING_AVAILABILITY",
  "DANGER_STACK",
]);

const EVIDENCE_CATEGORY_MAP = {
  PROJECTION_OVER: "projection",
  PROJECTION_UNDER: "projection",
  READER_CASE_STRONG: "projection",
  READER_CASE_MODERATE: "projection",
  EXPANDING_ROLE: "role_trend",
  CONTRACTING_ROLE: "role_trend",
  STRONG_MINUTES: "minutes_usage",
  MINUTES_SPIKE_PATH: "minutes_usage",
  STRONG_FGA: "minutes_usage",
  FTA_REBOUND: "minutes_usage",
  FAIR_LINE_OVER: "fair_line",
  FAIR_LINE_UNDER: "fair_line",
  MARKET_AGAINST: "market",
  MARKET_FAVORABLE: "market",
  OPPONENT_HISTORY: "opponent_history",
  AVAILABILITY: "availability",
  MATCHUP: "matchup",
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
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

function projectionGapForSide(side = "", line = 0, projection = 0) {
  return side === "OVER"
    ? num(projection) - num(line)
    : num(line) - num(projection);
}

export function buildSideEvidenceFromCase(sideCase = {}, side = "", metrics = {}, dataCard = {}) {
  const rawScore = num(sideCase.rawScore ?? sideCase.score);
  const adjustedScore = num(sideCase.adjustedScore ?? sideCase.score);
  const line = num(metrics.line ?? dataCard.bookLine);
  const projection = num(metrics.projection ?? dataCard.projection?.projection);
  const gap = projectionGapForSide(side, line, projection);
  const gapAudit = resolveWnbaGapFloor({
    side,
    dataMode: metrics.dataMode ?? dataCard.dataMode,
    minutesStability: metrics.volatility,
    marketQuality: metrics.marketQuality ?? dataCard.marketQuality,
    projectionGap: gap,
  });

  let eligible = sideCase.eligible;
  if (eligible === undefined) {
    eligible = !sideCase.blocked;
    if (side === "UNDER" && sideCase.underGapFloorPassed === false) eligible = false;
    if (side === "OVER" && sideCase.overGapFloorPassed === false) eligible = false;
    if (sideCase.blocked) eligible = false;
  }

  const blockReasons = [...(sideCase.blockReasons || [])];
  if (!eligible && sideCase.underGapFloorPassed === false && !blockReasons.length) {
    blockReasons.push(gapAudit.gapFloorReason || "UNDER_GAP_BELOW_FLOOR");
  }
  if (!eligible && sideCase.overGapFloorPassed === false && !blockReasons.length) {
    blockReasons.push(gapAudit.gapFloorReason || "OVER_GAP_BELOW_FLOOR");
  }
  if (sideCase.blocked && !blockReasons.length) {
    blockReasons.push("SIDE_BLOCKED");
  }

  return {
    side,
    rawScore,
    adjustedScore,
    eligible,
    blockReasons,
    notScoredReason: sideCase.notScoredReason || null,
    projectionGap: Number(gap.toFixed(2)),
    gapFloorApplied: gapAudit.gapFloorApplied,
    gapFloorReason: gapAudit.gapFloorReason,
  };
}

export function buildReaderSideEvidence(reader = {}, dataCard = {}, metrics = {}) {
  const over = buildSideEvidenceFromCase(reader.overCase || {}, "OVER", metrics, dataCard);
  const under = buildSideEvidenceFromCase(reader.underCase || {}, "UNDER", metrics, dataCard);
  return { over, under };
}

export function buildDebtLedger(debts = [], options = {}) {
  const stageRefs = options.stageReferences || [];
  const allRefs = [...debts, ...stageRefs];
  const byId = new Map();
  const duplicateDebtReferences = [];

  for (const debt of allRefs) {
    const code = String(debt.code || debt.id || "").toUpperCase();
    if (!code) continue;
    const canonical = CANONICAL_DEBT_IDS.has(code) ? code : code;
    const stage = debt.stage || debt.sourceStage || "unknown";
    if (byId.has(canonical)) {
      duplicateDebtReferences.push({ debtId: canonical, stage, reason: debt.reason || "" });
      const existing = byId.get(canonical);
      existing.stageReferences = [...(existing.stageReferences || []), stage];
      continue;
    }
    byId.set(canonical, {
      debtId: canonical,
      severity: debt.severity || "MEDIUM",
      reason: debt.reason || "",
      side: debt.side || "BOTH",
      stageReferences: [stage],
      repairable: debt.repairable !== false,
    });
  }

  const appliedDebtIds = [...byId.keys()];
  return {
    uniqueDebtCount: appliedDebtIds.length,
    duplicateDebtReferences,
    appliedDebtIds,
    debts: [...byId.values()],
  };
}

export function collectStageDebts(pick = {}) {
  const refs = [];
  const di = pick.decisionIntelligence || {};
  const sr = pick.sideRescue || {};
  const ff = pick.flipFirstDecision || pick.decisionDataIntelligence?.flipFirstDecision || {};

  for (const debt of di.riskDebts || []) {
    refs.push({ ...debt, stage: "decision_intelligence" });
  }
  for (const code of ff.flipTriggerReasons || []) {
    refs.push({ code, stage: "flip_first", severity: "MEDIUM", reason: code });
  }
  for (const debt of sr.triggerDebts || []) {
    refs.push({ ...debt, stage: "side_rescue" });
  }
  for (const code of pick.readerReasonCodes || pick.wnbaReader?.reasonCodes || []) {
    if (CANONICAL_DEBT_IDS.has(code) || code.includes("GAP") || code.includes("MINUTES")) {
      refs.push({ code, stage: "reader", severity: "MEDIUM", reason: code });
    }
  }
  return refs;
}

export function buildStageDecisionTrace(pick = {}) {
  const reader = pick.wnbaReader || {};
  const ff = pick.flipFirstDecision || pick.decisionDataIntelligence?.flipFirstDecision || {};
  const di = pick.decisionIntelligence || {};
  const sr = pick.sideRescue || {};
  const gate = pick.wnbaTrackingDecision || di.trackEligibility || "";

  const readerSide = normalizeSide(pick.readerSide || reader.finalSide);
  const flipAction = ff.action || pick.flipFirstAction || "KEPT_ORIGINAL";
  const gateDecision = String(gate || di.trackEligibility || "").toUpperCase();
  const rescueAction = sr.action || pick.sideRescueAction || "KEEP";
  const finalSide = normalizeSide(pick.finalSide || pick.side || pick.pick);

  const stages = [
    { stage: "Reader", side: readerSide, action: reader.decision || "READ" },
    { stage: "FlipFirst", side: normalizeSide(ff.finalSide || readerSide), action: flipAction },
    { stage: "Gate", side: normalizeSide(pick.currentSide || ff.finalSide || readerSide), action: gateDecision },
    { stage: "SideRescue", side: normalizeSide(sr.finalSide || pick.side), action: rescueAction },
    { stage: "Final", side: finalSide, action: finalSide },
  ];

  let sideChangedCount = 0;
  let stageDisagreementCount = 0;
  let prevSide = readerSide;
  for (let i = 1; i < stages.length; i += 1) {
    const stageSide = stages[i].side;
    if (stageSide && prevSide && stageSide !== prevSide) {
      sideChangedCount += 1;
      if (i < stages.length - 1) stageDisagreementCount += 1;
    }
    if (stageSide) prevSide = stageSide;
  }

  const traceLine = stages
    .map((s) => `${s.stage}: ${s.action}${s.side ? ` (${s.side})` : ""}`)
    .join(" → ");

  return {
    sideReviewCount: stages.length,
    stageDisagreementCount,
    sideChangedCount,
    sideReviewStages: stages.map((s) => s.stage),
    stageDecisionTrace: traceLine,
    stages,
  };
}

export function computeSideStrength(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const gate = String(di.trackEligibility || pick.wnbaTrackingDecision || "").toUpperCase();
  const trueRisk = String(di.trueRisk || "MEDIUM").toUpperCase();
  const debtCount = (di.riskDebts || []).length;
  const repairCount = (di.riskRepairs || []).length;

  let score = 70;
  if (gate === "TRACK") score += 15;
  else if (gate === "BOARD_ONLY") score -= 10;
  else if (gate === "SHADOW_ONLY") score -= 20;
  else if (gate === "NO_BET") score -= 35;

  if (trueRisk === "LOW") score += 10;
  if (trueRisk === "HIGH") score -= 15;
  score -= debtCount * 4;
  score += repairCount * 3;

  const label =
    score >= 72 ? "strong" : score >= 52 ? "moderate" : score >= 35 ? "weak" : "fragile";

  return { score: Math.max(0, Math.min(100, Math.round(score))), label };
}

export function buildProjectionDependencyAudit(pick = {}, dataCard = {}) {
  const card = dataCard || pick.wnbaDataCard || {};
  const projection = card.projection || {};
  const season = card.season || {};
  const last5 = card.last5 || {};

  const expectedMinutes = num(projection.expectedMinutes ?? last5.minutes ?? season.minutes);
  const expectedFGA = num(projection.expectedFGA ?? last5.fga ?? season.fga);
  const expectedFTA = num(projection.expectedFTA ?? last5.fta ?? season.fta);
  const expectedUsage = expectedMinutes > 0 ? Number((expectedFGA / expectedMinutes).toFixed(3)) : null;
  const expectedTouches = expectedFGA + expectedFTA * 0.44;
  const ptsPerFGA = num(last5.ptsPerFGA ?? season.ptsPerFGA, 1);
  const expectedPointsFromVolume = Number((expectedFGA * ptsPerFGA).toFixed(2));
  const projPts = num(projection.projection);
  const expectedPointsFromEfficiency =
    projPts > 0 ? Number((projPts - expectedPointsFromVolume).toFixed(2)) : null;

  const signals = [];
  if (expectedFGA >= 8) signals.push("volume_supported");
  if (expectedMinutes >= 24) signals.push("minutes_supported");
  if (expectedPointsFromEfficiency !== null && Math.abs(expectedPointsFromEfficiency) > 3) {
    signals.push("efficiency_supported");
  }
  if (card.roleChange?.trend) signals.push("role_change_supported");
  if (card.opponentDefense?.score) signals.push("matchup_supported");

  let projectionDependencyType = "unknown";
  if (signals.length >= 3) projectionDependencyType = "mixed";
  else if (signals.includes("efficiency_supported") && !signals.includes("volume_supported")) {
    projectionDependencyType = "fragile";
  } else if (signals.length === 1) projectionDependencyType = signals[0];
  else if (signals.length === 2) projectionDependencyType = "mixed";

  return {
    expectedMinutes,
    expectedFGA,
    expectedFTA,
    expectedUsage,
    expectedTouches,
    expectedPointsFromVolume,
    expectedPointsFromEfficiency,
    projectionDependencyType,
    missingSources: [
      !projection.expectedMinutes ? "expectedMinutes" : null,
      !projection.expectedFGA ? "expectedFGA" : null,
      !card.opponentDefense?.score ? "opponentDefense" : null,
    ].filter(Boolean),
  };
}

export function computeDecisionHash(bundle = {}) {
  const payload = JSON.stringify({
    readerSide: bundle.readerSide,
    finalSide: bundle.finalSide,
    naturalDecision: bundle.naturalDecision,
    flipFirstAction: bundle.flipFirstAction,
    sideRescueAction: bundle.sideRescueAction,
    gateDecision: bundle.gateDecision,
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function resolveNaturalDecision(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const sr = pick.sideRescue || {};
  const rescueAction = String(sr.action || "").toUpperCase();
  if (rescueAction === "NO_BET" || rescueAction === "BOARD_ONLY") {
    return rescueAction;
  }
  return String(
    di.originalGateEligibility ||
      di.trackEligibility ||
      pick.wnbaTrackingDecision ||
      pick.trackingEligibility ||
      "TRACK"
  ).toUpperCase();
}

export function buildCanonicalDecisionBundle(pick = {}, options = {}) {
  const reader = options.reader || pick.wnbaReader || {};
  const dataCard = options.dataCard || pick.wnbaDataCard || {};
  const metrics = resolveQualityGateInputs(pick, dataCard, reader);
  const di = pick.decisionIntelligence || {};
  const sr = pick.sideRescue || {};
  const ff = pick.flipFirstDecision || pick.decisionDataIntelligence?.flipFirstDecision || {};
  const sideEvidence = buildReaderSideEvidence(reader, dataCard, metrics);
  const stageAudit = buildStageDecisionTrace(pick);
  const debtLedger = buildDebtLedger(di.riskDebts || [], {
    stageReferences: collectStageDebts(pick),
  });
  const sideStrength = computeSideStrength(pick);
  const projectionAudit = buildProjectionDependencyAudit(pick, dataCard);

  const readerSide = normalizeSide(pick.readerSide || reader.finalSide);
  const currentSide = normalizeSide(
    pick.currentSide || ff.finalSide || pick.side || pick.pick || readerSide
  );
  const finalSide = normalizeSide(pick.finalSide || pick.side || pick.pick || currentSide);
  const naturalDecision = resolveNaturalDecision(pick);
  const gateDecision = String(
    di.originalGateEligibility || di.trackEligibility || pick.wnbaTrackingDecision || ""
  ).toUpperCase();

  const bundle = {
    version: SIDE_SELECTION_TRUST_VERSION,
    readerSide,
    readerDecision: reader.decision || pick.readerDecision || "",
    readerOverRawScore: sideEvidence.over.rawScore,
    readerUnderRawScore: sideEvidence.under.rawScore,
    readerOverAdjustedScore: sideEvidence.over.adjustedScore,
    readerUnderAdjustedScore: sideEvidence.under.adjustedScore,
    readerOverEligible: sideEvidence.over.eligible,
    readerUnderEligible: sideEvidence.under.eligible,
    readerBlockReasons: [
      ...sideEvidence.over.blockReasons,
      ...sideEvidence.under.blockReasons,
    ],
    sideEvidence,
    currentSide,
    flipFirstAction: ff.action || pick.flipFirstAction || "KEPT_ORIGINAL",
    flipFirstTriggerReasons: ff.flipTriggerReasons || [],
    flipFirstOppositeEvidence: ff.oppositeSideEvidence || [],
    flipFirstChangedSide: Boolean(ff.flipRecommended),
    gateDecision,
    gateReasons: [pick.wnbaTrackingReason, di.gateReason].filter(Boolean),
    sideGatePassed: gateDecision === "TRACK",
    riskDebtReasons: debtLedger.appliedDebtIds,
    riskRepairReasons: (di.riskRepairs || []).map((r) => r.code).filter(Boolean),
    trueRisk: String(di.trueRisk || "MEDIUM").toUpperCase(),
    sideRescueAction: sr.action || pick.sideRescueAction || "KEEP",
    sideRescueOppositeEvidence: sr.oppositeEvidence || sr.oppositeSideEvidence || [],
    sideRescueChangedSide: Boolean(sr.flipped || sr.action === "FLIP_SIDE"),
    finalSide,
    preferredSide: finalSide,
    sideStrength: sideStrength.label,
    sideStrengthScore: sideStrength.score,
    naturalDecision,
    selectedForLearning: Boolean(pick.selectedForLearning || pick.controlledBestSixDisplay),
    resultsTracked: Boolean(pick.resultsTracked || pick.resultsAdmissionEligible),
    bestSixPromoted: Boolean(di.bestSixPromoted),
    promotionReasons: di.promotionReasons || pick.bestSixQualityFlags || [],
    debtLedger,
    ...stageAudit,
    projectionDependency: projectionAudit,
    decisionHash: "",
  };

  bundle.decisionHash = computeDecisionHash(bundle);
  return bundle;
}

export function applyCanonicalDecisionBundleToPick(pick = {}, bundle = null) {
  const resolved = bundle || buildCanonicalDecisionBundle(pick);
  return {
    ...pick,
    sideSelectionBundle: resolved,
    readerSide: resolved.readerSide,
    currentSide: resolved.currentSide,
    finalSide: sideLabel(resolved.finalSide) || pick.side,
    naturalDecision: resolved.naturalDecision,
    sideStrength: resolved.sideStrength,
    sideStrengthScore: resolved.sideStrengthScore,
    sideReviewCount: resolved.sideReviewCount,
    stageDisagreementCount: resolved.stageDisagreementCount,
    sideChangedCount: resolved.sideChangedCount,
    sideReviewStages: resolved.sideReviewStages,
    stageDecisionTrace: resolved.stageDecisionTrace,
    riskDebtReasons: resolved.riskDebtReasons,
    riskRepairReasons: resolved.riskRepairReasons,
    projectionDependency: resolved.projectionDependency,
    decisionHash: resolved.decisionHash,
  };
}

export function finalizeCanonicalDecision(pick = {}, options = {}) {
  let enriched = { ...pick };
  if (!enriched.readerSide) {
    enriched.readerSide = normalizeSide(enriched.wnbaReader?.finalSide || enriched.initialSide);
  }
  if (!enriched.naturalDecision) {
    enriched.naturalDecision = resolveNaturalDecision(enriched);
  }
  enriched = applyCanonicalDecisionBundleToPick(enriched);
  if (options.selectedForLearning) {
    enriched.selectedForLearning = true;
    enriched.sideSelectionBundle.selectedForLearning = true;
  }
  if (options.resultsTracked) {
    enriched.resultsTracked = true;
    enriched.sideSelectionBundle.resultsTracked = true;
  }
  return enriched;
}

export function countIndependentEvidenceCategories(evidence = []) {
  const categories = new Set();
  for (const item of evidence) {
    const code = String(item.code || item).toUpperCase();
    const category = EVIDENCE_CATEGORY_MAP[code] || item.category;
    if (category) categories.add(category);
  }
  return categories.size;
}

export function buildCounterfactualSideLearning(prop = {}) {
  const bundle = prop.sideSelectionBundle || {};
  const selectedSide = normalizeSide(
    prop.currentEngineSide || prop.side || prop.pick || bundle.finalSide
  );
  const status = String(prop.status || "").toLowerCase();
  const actual = num(prop.actualStat);
  const line = num(prop.line);

  let selectedSideResult = null;
  let oppositeSideResult = null;
  if (status === "win" || status === "loss" || status === "push") {
    selectedSideResult = status;
  }

  if (actual > 0 && line > 0 && selectedSide) {
    const overWon = actual > line;
    const underWon = actual < line;
    const push = actual === line;
    if (selectedSide === "OVER") {
      oppositeSideResult = push ? "push" : underWon ? "win" : "loss";
    } else if (selectedSide === "UNDER") {
      oppositeSideResult = push ? "push" : overWon ? "win" : "loss";
    }
  }

  const wouldOppositeSideHaveWon = oppositeSideResult === "win";
  const flipFirstAction = bundle.flipFirstAction || prop.flipFirstAction || "";
  const sideRescueAction = bundle.sideRescueAction || prop.sideRescueAction || "";
  const readerSide = normalizeSide(bundle.readerSide || prop.readerSide);
  const finalSide = normalizeSide(bundle.finalSide || selectedSide);
  const flipMade = readerSide && finalSide && readerSide !== finalSide;

  let beneficialFlipMade = false;
  let harmfulFlipMade = false;
  let beneficialFlipMissed = false;

  if (flipMade && selectedSideResult) {
    if (selectedSideResult === "win") beneficialFlipMade = true;
    if (selectedSideResult === "loss") harmfulFlipMade = true;
  } else if (!flipMade && selectedSideResult === "loss" && wouldOppositeSideHaveWon) {
    beneficialFlipMissed = true;
  }

  return {
    selectedSide,
    selectedSideResult,
    oppositeSideResult,
    wouldOppositeSideHaveWon,
    flipFirstAction,
    sideRescueAction,
    beneficialFlipMade,
    harmfulFlipMade,
    beneficialFlipMissed,
    riskDebtReasons: bundle.riskDebtReasons || prop.riskDebtReasons || [],
    naturalDecision: bundle.naturalDecision || prop.naturalDecision || null,
    smallSample: true,
  };
}

export { CANONICAL_DEBT_IDS, EVIDENCE_CATEGORY_MAP };
