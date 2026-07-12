/**
 * CourtEdge Decision Intelligence v1 — one parent brain for prop trust.
 * Risk Debt + Risk Repair → true risk → track eligibility → Best 6 → Top Picks.
 * WNBA: wraps Tracking Gate v2. NBA: shared structures, passthrough for now.
 */
import {
  evaluateWnbaTrackingGateV2,
  applyWnbaTrackingGateV2ToPick,
  applyWnbaRiskCeiling,
  buildRetroactiveGateSimulation,
} from "../wnba/wnbaTrackingGateV2.js";
import {
  isWnbaQualityGatePick,
  resolveQualityGateInputs,
} from "../wnba/wnbaGateInputs.js";
import {
  collectWnbaDataCoverageDebts,
  hasMaterialDataCoverageGaps,
  pickPrimaryDebtExplanation,
  sortRiskDebtsForDisplay,
  resolveWnbaGapFloors,
} from "../wnba/wnbaGraduatedDataModeV1.js";
import { syncWnbaDataModeOnPick } from "../wnba/wnbaGateInputs.js";
import { buildDebtLedger } from "./sideSelectionTrustV1.js";

export const DECISION_INTELLIGENCE_VERSION = "courtedge-decision-intelligence-v1";

const EXPANDING_ROLE = new Set(["up", "expanding", "rising"]);
const CONTRACTING_ROLE = new Set(["down", "contracting", "declining"]);
const KILL_CODES = new Set([
  "LOW_VOLUME_OVER_TRAP",
  "EFFICIENCY_ONLY_SCORING",
  "READER_NO_BET",
  "MISSING_REQUIRED_FIELDS",
  "STARTED_GAME",
]);

const DANGER_DEBT_MAP = {
  unstableMinutes: { code: "UNSTABLE_MINUTES", severity: "HIGH", repairable: true },
  volatileMinutes: { code: "VOLATILE_MINUTES", severity: "MEDIUM", repairable: true },
  lowVolumeOverTrap: { code: "LOW_VOLUME_OVER_TRAP", severity: "KILL", repairable: false },
  lowMinutesFloor: { code: "LOW_MINUTES_FLOOR", severity: "MEDIUM", repairable: true },
  ftaCollapse: { code: "FTA_COLLAPSE_RISK", severity: "MEDIUM", repairable: true },
  efficiencyOnlyScoring: { code: "EFFICIENCY_ONLY_SCORING", severity: "KILL", repairable: false },
  oneBookMarket: { code: "LOW_BOOK_COUNT", severity: "MEDIUM", repairable: true },
  missingOpponentDefense: { code: "MISSING_OPPONENT_DEFENSE", severity: "LOW", repairable: false },
  missingAvailability: { code: "MISSING_AVAILABILITY", severity: "LOW", repairable: false },
  roleTrendContradiction: { code: "ROLE_TREND_CONTRADICTS_SIDE", severity: "HIGH", repairable: false },
  projectionFairLineDisagreement: { code: "PROJECTION_FAIR_LINE_DISAGREE", severity: "HIGH", repairable: false },
  thinGap: { code: "THIN_EDGE", severity: "HIGH", repairable: false },
  underFragility: { code: "UNDER_FRAGILITY", severity: "HIGH", repairable: false },
};

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

function severityWeight(severity = "") {
  const raw = String(severity).toUpperCase();
  if (raw === "KILL") return 40;
  if (raw === "HIGH") return 22;
  if (raw === "MEDIUM") return 12;
  return 5;
}

function repairWeight(code = "") {
  const weights = {
    ELITE_PROJECTION_GAP: 18,
    ELITE_FAIR_LINE_EDGE: 16,
    PROJECTION_FAIR_LINE_AGREE: 14,
    STRONG_FGA: 12,
    STRONG_MINUTES: 12,
    STABLE_ROLE: 10,
    EXPANDING_ROLE_FOR_OVER: 10,
    CONTRACTING_ROLE_FOR_UNDER: 10,
    MULTI_BOOK_COVERAGE: 8,
    CLEAN_DANGER_STACK: 10,
    STRONG_RECENT_SCORING: 8,
    STRONG_OPPORTUNITY_SCORE: 6,
    ELITE_NET_EDGE: 14,
  };
  return weights[code] || 6;
}

function debtItem({ code, severity, reason, side = "BOTH", repairable = true }) {
  return { code, severity, reason, side, repairable };
}

function repairItem({ code, reason, strength = "MODERATE" }) {
  return { code, reason, strength };
}

function riskLabelFromTrueRisk(trueRisk = "") {
  if (trueRisk === "LOW") return "Low Risk";
  if (trueRisk === "HIGH") return "High Risk";
  return "Medium Risk";
}

function collectWnbaRiskDebts(candidate = {}, metrics = {}, gate = {}) {
  const debts = [...collectWnbaDataCoverageDebts(candidate, metrics)];
  const side = metrics.side;
  const dangerStack = gate.dangerGateStack || [];

  for (const key of dangerStack) {
    const mapped = DANGER_DEBT_MAP[key];
    if (mapped) {
      debts.push(
        debtItem({
          ...mapped,
          reason: `${mapped.code.replace(/_/g, " ").toLowerCase()} flagged by danger gate.`,
          side: key === "lowVolumeOverTrap" ? "OVER" : "BOTH",
        })
      );
    }
  }

  if (metrics.volatility === "unstable" && !dangerStack.includes("unstableMinutes")) {
    debts.push(
      debtItem({
        code: "UNSTABLE_MINUTES",
        severity: "HIGH",
        reason: "Minutes profile is unstable.",
        side: "BOTH",
        repairable: true,
      })
    );
  } else if (metrics.volatility === "volatile" && !dangerStack.includes("volatileMinutes")) {
    debts.push(
      debtItem({
        code: "VOLATILE_MINUTES",
        severity: "MEDIUM",
        reason: "Minutes profile is volatile.",
        side: "BOTH",
        repairable: true,
      })
    );
  }

  if (metrics.minutes > 0 && metrics.minutes < 20) {
    const exists = debts.some((d) => d.code === "LOW_MINUTES_FLOOR");
    if (!exists) {
      debts.push(
        debtItem({
          code: "LOW_MINUTES_FLOOR",
          severity: "MEDIUM",
          reason: "Recent minutes floor is below 20.",
          side: "BOTH",
          repairable: true,
        })
      );
    }
  }

  if (side === "OVER" && metrics.fga > 0 && metrics.fga < 9) {
    const exists = debts.some((d) => d.code === "LOW_FGA");
    if (!exists) {
      debts.push(
        debtItem({
          code: "LOW_FGA",
          severity: metrics.fga < 7 ? "HIGH" : "MEDIUM",
          reason: "Shot volume is weak for an Over.",
          side: "OVER",
          repairable: metrics.fga >= 7,
        })
      );
    }
  }

  const gapFloor = resolveWnbaGapFloors({ ...metrics, side }).gapFloor;
  if (metrics.projectionGap > 0 && metrics.projectionGap < gapFloor) {
    const exists = debts.some((d) => d.code === "THIN_EDGE");
    if (!exists) {
      debts.push(
        debtItem({
          code: "THIN_EDGE",
          severity: metrics.projectionGap < gapFloor - 1 ? "HIGH" : "MEDIUM",
          reason: `Projection edge (${metrics.projectionGap.toFixed(1)}) is thin for WNBA ${side}.`,
          side,
          repairable: false,
        })
      );
    }
  }

  if (metrics.netEdge < 3) {
    debts.push(
      debtItem({
        code: "THIN_NET_EDGE",
        severity: "MEDIUM",
        reason: "Net edge between sides is thin.",
        side: "BOTH",
        repairable: false,
      })
    );
  }

  if (metrics.bookCount <= 1) {
    debts.push(
      debtItem({
        code: "LOW_BOOK_COUNT",
        severity: "MEDIUM",
        reason: "Only one sportsbook line available.",
        side: "BOTH",
        repairable: true,
      })
    );
  }

  if (metrics.marketQuality > 0 && metrics.marketQuality < 50) {
    debts.push(
      debtItem({
        code: "WEAK_MARKET_QUALITY",
        severity: "LOW",
        reason: "Market quality score is weak.",
        side: "BOTH",
        repairable: true,
      })
    );
  }

  if (metrics.availabilityDataMissing) {
    debts.push(
      debtItem({
        code: "MISSING_AVAILABILITY",
        severity: "LOW",
        reason: "Injury/availability feed is missing.",
        side: "BOTH",
        repairable: false,
      })
    );
  }

  if (metrics.defenseProxyUsed) {
    debts.push(
      debtItem({
        code: "MISSING_OPPONENT_DEFENSE",
        severity: "LOW",
        reason: "Opponent defense uses neutral proxy.",
        side: "BOTH",
        repairable: false,
      })
    );
  }

  if (side === "UNDER" && EXPANDING_ROLE.has(metrics.roleTrend)) {
    debts.push(
      debtItem({
        code: "ROLE_TREND_CONTRADICTS_SIDE",
        severity: "HIGH",
        reason: "Role is expanding against an Under.",
        side: "UNDER",
        repairable: false,
      })
    );
  }

  if (side === "OVER" && CONTRACTING_ROLE.has(metrics.roleTrend)) {
    debts.push(
      debtItem({
        code: "ROLE_TREND_CONTRADICTS_SIDE",
        severity: "HIGH",
        reason: "Role is contracting against an Over.",
        side: "OVER",
        repairable: false,
      })
    );
  }

  for (const block of gate.trackingBlockReasons || []) {
    if (block === "LOW_VOLUME_OVER_TRAP") {
      const exists = debts.some((d) => d.code === "LOW_VOLUME_OVER_TRAP");
      if (!exists) {
        debts.push(
          debtItem({
            code: "LOW_VOLUME_OVER_TRAP",
            severity: "KILL",
            reason: "Low-volume Over trap — not enough shots for this line.",
            side: "OVER",
            repairable: false,
          })
        );
      }
    }
    if (block === "EFFICIENCY_ONLY_SCORING_SPIKE") {
      debts.push(
        debtItem({
          code: "EFFICIENCY_ONLY_SCORING",
          severity: "KILL",
          reason: "Recent scoring spike is efficiency-only, not volume-backed.",
          side: "OVER",
          repairable: false,
        })
      );
    }
    if (block.startsWith("READER_")) {
      debts.push(
        debtItem({
          code: `READER_${block.replace("READER_", "")}`,
          severity: "KILL",
          reason: `Reader blocked this prop (${block}).`,
          side: "BOTH",
          repairable: false,
        })
      );
    }
  }

  const ohc = candidate.opponentHistoryComparison || {};
  const cmp = ohc.comparison || {};
  const oppHist = ohc.opponentHistory || {};
  if (
    !oppHist.noHistory &&
    cmp.agreement === "CONTRADICTS_RECENT" &&
    (cmp.weight || 0) >= 0.55
  ) {
    debts.push(
      debtItem({
        code: "OPPONENT_HISTORY_CONTRADICTS",
        severity: cmp.weight >= 1 ? "MEDIUM" : "LOW",
        reason: "Opponent history contradicts recent form.",
        side: metrics.side,
        repairable: true,
      })
    );
  }

  const unique = [];
  const seen = new Set();
  for (const item of debts) {
    const key = `${item.code}|${item.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function collectWnbaRiskRepairs(candidate = {}, metrics = {}, gate = {}) {
  const repairs = [];
  const side = metrics.side;
  const dangerCount = gate.dangerGateCount ?? (gate.dangerGateStack?.length || 0);

  if (metrics.projectionGap >= 5) {
    repairs.push(
      repairItem({
        code: "ELITE_PROJECTION_GAP",
        reason: `Projection gap ${metrics.projectionGap.toFixed(1)} is elite.`,
        strength: "STRONG",
      })
    );
  } else if (metrics.projectionGap >= gapFloorForSide(side)) {
    repairs.push(
      repairItem({
        code: "STRONG_PROJECTION_GAP",
        reason: `Projection gap ${metrics.projectionGap.toFixed(1)} clears WNBA floor.`,
        strength: "MODERATE",
      })
    );
  }

  if (metrics.netEdge >= 8) {
    repairs.push(
      repairItem({
        code: "ELITE_NET_EDGE",
        reason: `Net edge ${metrics.netEdge.toFixed(1)} is elite.`,
        strength: "STRONG",
      })
    );
  }

  if (
    metrics.fairLineSide === side &&
    Math.abs(metrics.fairLineEdge) >= 3.5 &&
    metrics.fairLineQuality >= 50
  ) {
    repairs.push(
      repairItem({
        code: metrics.fairLineEdge >= 5 ? "ELITE_FAIR_LINE_EDGE" : "STRONG_FAIR_LINE_EDGE",
        reason: "Fair line supports the chosen side with meaningful edge.",
        strength: metrics.fairLineEdge >= 5 ? "STRONG" : "MODERATE",
      })
    );
  }

  if (metrics.fairLineSide === side && metrics.fairLineQuality >= 50) {
    repairs.push(
      repairItem({
        code: "PROJECTION_FAIR_LINE_AGREE",
        reason: "Projection and fair line agree on side.",
        strength: "MODERATE",
      })
    );
  }

  if (metrics.fga >= 9) {
    repairs.push(
      repairItem({
        code: "STRONG_FGA",
        reason: `Recent FGA ${metrics.fga.toFixed(1)} supports volume.`,
        strength: "STRONG",
      })
    );
  }

  if (metrics.minutes >= 24) {
    repairs.push(
      repairItem({
        code: "STRONG_MINUTES",
        reason: `Recent minutes ${metrics.minutes.toFixed(1)} are strong.`,
        strength: "STRONG",
      })
    );
  }

  if (metrics.roleTrend === "stable" || !metrics.roleTrend) {
    repairs.push(
      repairItem({
        code: "STABLE_ROLE",
        reason: "Role trend is stable.",
        strength: "MODERATE",
      })
    );
  }

  if (side === "OVER" && EXPANDING_ROLE.has(metrics.roleTrend)) {
    repairs.push(
      repairItem({
        code: "EXPANDING_ROLE_FOR_OVER",
        reason: "Role is expanding in support of Over.",
        strength: "MODERATE",
      })
    );
  }

  if (side === "UNDER" && CONTRACTING_ROLE.has(metrics.roleTrend)) {
    repairs.push(
      repairItem({
        code: "CONTRACTING_ROLE_FOR_UNDER",
        reason: "Role is contracting in support of Under.",
        strength: "MODERATE",
      })
    );
  }

  if (metrics.bookCount >= 3) {
    repairs.push(
      repairItem({
        code: "MULTI_BOOK_COVERAGE",
        reason: `${metrics.bookCount} books cover this market.`,
        strength: metrics.bookCount >= 4 ? "STRONG" : "MODERATE",
      })
    );
  }

  if (dangerCount <= 1) {
    repairs.push(
      repairItem({
        code: "CLEAN_DANGER_STACK",
        reason: "Danger gate stack is clean or minor.",
        strength: "MODERATE",
      })
    );
  }

  const recent = num(metrics.recent);
  if (recent > 0 && side === "OVER" && recent >= metrics.line + 1) {
    repairs.push(
      repairItem({
        code: "STRONG_RECENT_SCORING",
        reason: "Recent scoring supports Over.",
        strength: "MODERATE",
      })
    );
  }
  if (recent > 0 && side === "UNDER" && recent <= metrics.line - 1) {
    repairs.push(
      repairItem({
        code: "STRONG_RECENT_SCORING",
        reason: "Recent scoring supports Under.",
        strength: "MODERATE",
      })
    );
  }

  if (metrics.opportunityScore >= 60) {
    repairs.push(
      repairItem({
        code: "STRONG_OPPORTUNITY_SCORE",
        reason: "Opportunity score is strong.",
        strength: "MODERATE",
      })
    );
  }

  const ohc = candidate.opponentHistoryComparison || {};
  const cmp = ohc.comparison || {};
  const oppHist = ohc.opponentHistory || {};
  if (!oppHist.noHistory && cmp.agreement === "AGREES_WITH_RECENT" && (cmp.weight || 0) >= 0.55) {
    repairs.push(
      repairItem({
        code: "OPPONENT_HISTORY_AGREES",
        reason: "Opponent history agrees with recent form.",
        strength: cmp.weight >= 1 ? "STRONG" : "MODERATE",
      })
    );
  }

  const unique = [];
  const seen = new Set();
  for (const item of repairs) {
    if (seen.has(item.code)) continue;
    seen.add(item.code);
    unique.push(item);
  }
  return unique;
}

function gapFloorForSide(side = "", metrics = {}) {
  return resolveWnbaGapFloors({ side: side || metrics.side, ...metrics }).gapFloor;
}

function computeScores(riskDebts = [], riskRepairs = [], gate = {}) {
  const riskDebtScore = clamp(
    riskDebts.reduce((sum, d) => sum + severityWeight(d.severity), 0),
    0,
    100
  );
  const repairScore = clamp(
    riskRepairs.reduce((sum, r) => sum + repairWeight(r.code), 0),
    0,
    100
  );
  const evidenceScore = clamp(
    Math.round(
      num(gate.qualityGateScore ?? gate.finalTrackScore, 50) * 0.45 +
        repairScore * 0.35 -
        riskDebtScore * 0.2
    ),
    0,
    100
  );
  const finalQualityScore = clamp(
    Math.round(evidenceScore + repairScore * 0.15 - riskDebtScore * 0.25),
    0,
    100
  );
  return { evidenceScore, riskDebtScore, repairScore, finalQualityScore };
}

function hasKillDebt(riskDebts = []) {
  return riskDebts.some(
    (d) => d.severity === "KILL" || KILL_CODES.has(d.code)
  );
}

function countHighDebts(riskDebts = []) {
  return riskDebts.filter((d) => d.severity === "HIGH" || d.severity === "KILL").length;
}

function isRepairableProfile(riskDebts = [], riskRepairs = []) {
  if (hasKillDebt(riskDebts)) return false;
  if (riskDebts.length >= 3) {
    const highCount = countHighDebts(riskDebts);
    const strongRepairs = riskRepairs.filter((r) => r.strength === "STRONG").length;
    return highCount <= 1 && strongRepairs >= 2;
  }
  return true;
}

function isCleanLowRiskProfile(metrics = {}, riskDebts = [], gate = {}) {
  if (hasMaterialDataCoverageGaps(riskDebts)) return false;
  if (metrics.volatility === "unstable" || metrics.volatility === "volatile") return false;
  if (hasKillDebt(riskDebts)) return false;
  if (countHighDebts(riskDebts) > 0) return false;
  if ((gate.dangerGateCount ?? 0) > 1) return false;
  if (metrics.projectionGap < gapFloorForSide(metrics.side, metrics) + 1) return false;
  if (
    metrics.fairLineSide !== metrics.side ||
    Math.abs(metrics.fairLineEdge) < 3.5 ||
    metrics.fairLineQuality < 50
  ) {
    return false;
  }
  if (metrics.side === "OVER" && metrics.fga < 9) return false;
  if (metrics.minutes > 0 && metrics.minutes < 24) return false;
  if (metrics.bookCount < 3) return false;
  return riskDebts.length <= 1;
}

function assignTrueRisk(candidate = {}, metrics = {}, riskDebts = [], riskRepairs = [], gate = {}) {
  const riskBefore = candidate.riskLabel || gate.riskBeforeCeiling || "Medium Risk";
  let trueRisk = "MEDIUM";

  if (hasKillDebt(riskDebts) || gate.trackingEligibility === "NO_BET") {
    trueRisk = "HIGH";
  } else if (countHighDebts(riskDebts) >= 3 || riskDebts.length >= 5) {
    trueRisk = "HIGH";
  } else if (
    gate.trackingEligibility === "BOARD_ONLY" ||
    gate.trackingEligibility === "SHADOW_ONLY"
  ) {
    trueRisk = countHighDebts(riskDebts) >= 2 ? "HIGH" : "MEDIUM";
  } else if (isCleanLowRiskProfile(metrics, riskDebts, gate)) {
    trueRisk = "LOW";
  } else if (gate.trackingEligibility === "TRACK") {
    if (
      metrics.volatility === "unstable" ||
      metrics.volatility === "volatile" ||
      countHighDebts(riskDebts) >= 1
    ) {
      trueRisk = "MEDIUM";
    } else if (isRepairableProfile(riskDebts, riskRepairs) && riskRepairs.length >= 3) {
      trueRisk = "MEDIUM";
    } else {
      trueRisk = "HIGH";
    }
  }

  const riskAfter = riskLabelFromTrueRisk(trueRisk);
  return { trueRisk, riskBeforeDecision: riskBefore, riskAfterDecision: riskAfter };
}

function resolveEligibility(trueRisk = "", gate = {}, riskDebts = [], riskRepairs = []) {
  const trackEligibility =
    gate.trackingEligibility ||
    gate.wnbaTrackingDecision ||
    "BOARD_ONLY";

  const eliteOverride =
    trackEligibility === "TRACK" &&
    trueRisk === "HIGH" &&
    riskRepairs.some((r) => r.code === "ELITE_PROJECTION_GAP" || r.code === "ELITE_NET_EDGE");

  const bestSixEligibility =
    trackEligibility === "TRACK" && (trueRisk !== "HIGH" || eliteOverride);

  const topPickEligibility =
    bestSixEligibility && trueRisk !== "HIGH" && trackEligibility === "TRACK";

  const killReasons = riskDebts
    .filter((d) => d.severity === "KILL" || KILL_CODES.has(d.code))
    .map((d) => d.code);

  const demotionReasons = [];
  const upgradeReasons = [];

  if (trackEligibility !== "TRACK") {
    demotionReasons.push(gate.wnbaTrackingReason || `${trackEligibility}_BY_GATE`);
  }
  if (trueRisk === "HIGH" && trackEligibility === "TRACK") {
    demotionReasons.push("HIGH_TRUE_RISK");
  }
  if (!bestSixEligibility && trackEligibility === "TRACK") {
    demotionReasons.push("BEST_SIX_BLOCKED");
  }
  if (!topPickEligibility && bestSixEligibility) {
    demotionReasons.push("TOP_PICK_BLOCKED");
  }
  if (trackEligibility === "TRACK" && trueRisk === "MEDIUM") {
    upgradeReasons.push("TRACK_WITH_REPAIRED_RISK");
  }
  if (eliteOverride) {
    upgradeReasons.push("ELITE_EDGE_OVERRIDE");
  }

  return {
    trackEligibility,
    bestSixEligibility,
    topPickEligibility,
    killReasons,
    demotionReasons,
    upgradeReasons,
    eliteOverride,
  };
}

function buildWhatWouldMakeItBetter(riskDebts = [], metrics = {}, gate = {}) {
  const tips = [];
  for (const debt of riskDebts) {
    if (String(debt.code || "").startsWith("MISSING_")) {
      tips.push(`Need ${debt.reason || debt.code.replace(/_/g, " ").toLowerCase()}.`);
    }
    if (debt.code === "UNSTABLE_MINUTES" || debt.code === "VOLATILE_MINUTES") {
      tips.push("Need stable minutes trend over last 5 games.");
    }
    if (debt.code === "THIN_EDGE" || debt.code === "THIN_NET_EDGE") {
      tips.push("Need a larger projection gap and fair-line agreement.");
    }
    if (debt.code === "LOW_FGA" || debt.code === "LOW_VOLUME_OVER_TRAP") {
      tips.push("Need higher FGA and minutes floor for this Over.");
    }
    if (debt.code === "LOW_MINUTES_FLOOR") {
      tips.push("Need 24+ stable minutes.");
    }
    if (debt.code === "UNDER_FRAGILITY") {
      tips.push("Under needs stronger gap with stable/down role.");
    }
  }
  if (gate.dangerGateCount >= 2) {
    tips.push("Reduce danger gate stack below 2 before tracking.");
  }
  if (!tips.length) {
    tips.push("Profile is clean; maintain edge and monitor line movement.");
  }
  return [...new Set(tips)].slice(0, 5);
}

function buildSimpleExplanation({
  trackEligibility = "",
  trueRisk = "",
  side = "",
  riskDebts = [],
  riskRepairs = [],
  gate = {},
  resultsLearningPool = false,
}) {
  const sideLabel = side === "OVER" ? "Over" : side === "UNDER" ? "Under" : "prop";
  const mainDebt = pickPrimaryDebtExplanation(riskDebts, {
    side,
    gateReason: gate.wnbaTrackingReason || gate.gateReason,
  });
  const mainRepair = riskRepairs[0]?.code?.replace(/_/g, " ").toLowerCase() || "supporting evidence";

  if (trackEligibility === "NO_BET") {
    const reason =
      mainDebt !== "minor concerns" ? mainDebt : gate.wnbaTrackingReason || mainDebt;
    const tail = resultsLearningPool
      ? "Tracked in Results learning pool with NO_BET label (not a Top Pick)."
      : "Not eligible for Top Picks.";
    return `NO_BET — ${reason}. ${tail}`;
  }
  if (trackEligibility === "BOARD_ONLY") {
    return `BOARD_ONLY — ${sideLabel} has ${mainDebt}. ${gate.wnbaTrackingReason || "Not enough evidence to track."}`;
  }
  if (trackEligibility === "SHADOW_ONLY") {
    return `SHADOW_ONLY — Multiple warnings; learning only. Main concern: ${mainDebt}.`;
  }
  if (trueRisk === "LOW") {
    return `TRACK — Clean ${sideLabel} profile with ${mainRepair}. True Low Risk earned.`;
  }
  return `TRACK — Strong ${sideLabel} profile with ${mainRepair}. True risk stays ${trueRisk} because ${mainDebt}.`;
}

export function promoteBestSixCohortPick(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const sr = pick.sideRescue || {};
  const originalEligibility = String(
    pick.naturalDecision ||
      di.originalGateEligibility ||
      di.trackEligibility ||
      pick.trackingEligibility ||
      pick.wnbaTrackingDecision ||
      "TRACK"
  ).toUpperCase();
  const sideRescueAction = String(sr.action || pick.sideRescueAction || "").toUpperCase();

  const qualityFlags = [];
  if (originalEligibility !== "TRACK") qualityFlags.push(originalEligibility);

  let trueRisk = String(di.trueRisk || "MEDIUM").toUpperCase();
  if (
    originalEligibility === "NO_BET" ||
    sideRescueAction === "NO_BET" ||
    originalEligibility === "SHADOW_ONLY"
  ) {
    trueRisk = "HIGH";
  } else if (
    (originalEligibility === "BOARD_ONLY" || sideRescueAction === "BOARD_ONLY") &&
    trueRisk === "LOW"
  ) {
    trueRisk = "MEDIUM";
  }

  const gateReason = di.gateReason || pick.wnbaTrackingReason || "";
  const simpleExplanation =
    qualityFlags.length > 0
      ? `TRACK — Safest available pick; prior gate: ${qualityFlags.join(", ")}.${gateReason ? ` ${gateReason}.` : ""} True risk ${trueRisk}.`
      : di.simpleExplanation || `TRACK — True risk ${trueRisk}.`;

  const updatedDi = {
    ...di,
    trackEligibility: "TRACK",
    bestSixEligibility: true,
    trueRisk,
    originalGateEligibility: originalEligibility,
    naturalDecision: originalEligibility,
    bestSixPromoted: qualityFlags.length > 0,
    promotionReasons: qualityFlags,
    simpleExplanation,
    riskAfterDecision: riskLabelFromTrueRisk(trueRisk),
  };

  return {
    ...pick,
    naturalDecision: originalEligibility,
    decisionIntelligence: updatedDi,
    trackingEligibility: "TRACK",
    wnbaTrackingDecision: "TRACK",
    riskLabel: riskLabelFromTrueRisk(trueRisk),
    resultsDecisionLabel: "TRACK",
    resultsAdmissionEligible: true,
    controlledBestSixDisplayTracked: true,
    displayTrackEligibility: "TRACK",
    bestSixQualityFlags: qualityFlags,
  };
}

function evaluateWnbaDecisionIntelligence(candidate = {}, options = {}) {
  const dataCard = options.dataCard || candidate.wnbaDataCard;
  const reader = options.reader || candidate.wnbaReader;
  const gate =
    options.gate ||
    evaluateWnbaTrackingGateV2(candidate, dataCard, reader);
  const metrics = resolveQualityGateInputs(candidate, dataCard, reader);

  const riskDebts = collectWnbaRiskDebts(candidate, metrics, gate);
  const riskRepairs = collectWnbaRiskRepairs(candidate, metrics, gate);
  const scores = computeScores(riskDebts, riskRepairs, gate);
  const { trueRisk, riskBeforeDecision, riskAfterDecision } = assignTrueRisk(
    candidate,
    metrics,
    riskDebts,
    riskRepairs,
    gate
  );
  const eligibility = resolveEligibility(trueRisk, gate, riskDebts, riskRepairs);
  const simpleExplanation = buildSimpleExplanation({
    trackEligibility: eligibility.trackEligibility,
    trueRisk,
    side: metrics.side,
    riskDebts,
    riskRepairs,
    gate,
    resultsLearningPool: candidate.resultsAdmissionEligible === true ||
      candidate.controlledBestSixDisplay === true,
  });
  const whatWouldMakeItBetter = buildWhatWouldMakeItBetter(riskDebts, metrics, gate);
  const debtLedger = buildDebtLedger(riskDebts);

  return {
    version: DECISION_INTELLIGENCE_VERSION,
    league: "WNBA",
    ...scores,
    trueRisk,
    riskBeforeDecision,
    riskAfterDecision,
    ...eligibility,
    riskDebts,
    riskRepairs,
    riskDebtReasons: debtLedger.appliedDebtIds,
    riskRepairReasons: riskRepairs.map((r) => r.code),
    debtLedger,
    simpleExplanation,
    whatWouldMakeItBetter,
    gateVersion: gate.wnbaGateVersion || gate.qualityGateVersion,
    gateDecision: gate.wnbaTrackingDecision,
    gateReason: gate.wnbaTrackingReason,
    dangerGateCount: gate.dangerGateCount ?? 0,
    repairable: isRepairableProfile(riskDebts, riskRepairs),
    keyMetrics: gate.keyMetrics || null,
    gate,
  };
}

function buildNbaPassthroughDecision(candidate = {}, options = {}) {
  const riskLabel = candidate.riskLabel || "Medium Risk";
  let trueRisk = "MEDIUM";
  if (riskLabel.includes("Low")) trueRisk = "LOW";
  if (riskLabel.includes("High")) trueRisk = "HIGH";

  return {
    version: DECISION_INTELLIGENCE_VERSION,
    league: "NBA",
    evidenceScore: num(candidate.confidence, 50),
    riskDebtScore: 0,
    repairScore: 0,
    finalQualityScore: num(candidate.confidence, 50),
    trueRisk,
    riskBeforeDecision: riskLabel,
    riskAfterDecision: riskLabel,
    trackEligibility: "TRACK",
    bestSixEligibility: true,
    topPickEligibility: trueRisk !== "HIGH",
    riskDebts: [],
    riskRepairs: [],
    killReasons: [],
    demotionReasons: [],
    upgradeReasons: ["NBA_PASSTHROUGH_V1"],
    simpleExplanation: `NBA passthrough — ${riskLabel}. Full Decision Intelligence v1 pending for NBA.`,
    whatWouldMakeItBetter: ["NBA tracking gate not yet active."],
    gateVersion: null,
    repairable: true,
    passthrough: true,
  };
}

export function evaluatePropDecisionIntelligenceV1(candidate = {}, options = {}) {
  const league = String(candidate.league || options.league || "").toUpperCase();

  if (league === "WNBA" && isWnbaQualityGatePick(candidate)) {
    return evaluateWnbaDecisionIntelligence(candidate, options);
  }

  if (league === "NBA") {
    return buildNbaPassthroughDecision(candidate, options);
  }

  return {
    version: DECISION_INTELLIGENCE_VERSION,
    league: league || "UNKNOWN",
    evidenceScore: 50,
    riskDebtScore: 0,
    repairScore: 0,
    finalQualityScore: 50,
    trueRisk: "MEDIUM",
    riskBeforeDecision: candidate.riskLabel || "Medium Risk",
    riskAfterDecision: candidate.riskLabel || "Medium Risk",
    trackEligibility: "BOARD_ONLY",
    bestSixEligibility: false,
    topPickEligibility: false,
    riskDebts: [],
    riskRepairs: [],
    killReasons: [],
    demotionReasons: [],
    upgradeReasons: [],
    simpleExplanation: "Unknown league — not evaluated.",
    whatWouldMakeItBetter: [],
    repairable: false,
  };
}

export function applyDecisionIntelligenceToPick(pick = {}, decision = null, gate = null) {
  const dataCard = pick.wnbaDataCard;
  const reader = pick.wnbaReader;
  let synced = syncWnbaDataModeOnPick(pick, dataCard, reader);

  const di =
    decision ||
    evaluatePropDecisionIntelligenceV1(synced, {
      gate: gate || synced.decisionIntelligence?.gate,
    });

  let enriched = synced;
  if (gate) {
    enriched = applyWnbaTrackingGateV2ToPick(enriched, gate);
    enriched = applyWnbaRiskCeiling(enriched, {
      ...gate,
      riskAfterCeiling: di.riskAfterDecision,
      riskCeilingReason: `DECISION_INTELLIGENCE_${di.trueRisk}`,
    });
  } else if (di.gate) {
    enriched = applyWnbaTrackingGateV2ToPick(enriched, di.gate);
    enriched = applyWnbaRiskCeiling(enriched, {
      ...di.gate,
      riskAfterCeiling: di.riskAfterDecision,
      riskCeilingReason: `DECISION_INTELLIGENCE_${di.trueRisk}`,
    });
  } else {
    enriched = {
      ...enriched,
      riskLabel: di.riskAfterDecision,
      riskAfterCeiling: di.riskAfterDecision,
    };
  }

  return {
    ...enriched,
    decisionIntelligence: {
      version: di.version,
      evidenceScore: di.evidenceScore,
      riskDebtScore: di.riskDebtScore,
      repairScore: di.repairScore,
      finalQualityScore: di.finalQualityScore,
      trueRisk: di.trueRisk,
      riskBeforeDecision: di.riskBeforeDecision,
      riskAfterDecision: di.riskAfterDecision,
      trackEligibility: di.trackEligibility,
      topPickEligibility: di.topPickEligibility,
      bestSixEligibility: di.bestSixEligibility,
      riskDebts: di.riskDebts,
      riskRepairs: di.riskRepairs,
      riskDebtReasons: (di.riskDebts || []).map((d) => d.code),
      riskRepairReasons: (di.riskRepairs || []).map((r) => r.code),
      debtLedger: di.debtLedger || buildDebtLedger(di.riskDebts || []),
      killReasons: di.killReasons,
      demotionReasons: di.demotionReasons,
      upgradeReasons: di.upgradeReasons,
      simpleExplanation: di.simpleExplanation,
      whatWouldMakeItBetter: di.whatWouldMakeItBetter,
      gateVersion: di.gateVersion,
      gateReason: di.gateReason,
      repairable: di.repairable,
    },
    trackingEligibility: di.trackEligibility,
    wnbaTrackingDecision: di.trackEligibility || di.gateDecision || enriched.wnbaTrackingDecision,
    wnbaTrackingReason: di.gateReason || enriched.wnbaTrackingReason,
    trueRisk: di.trueRisk,
    riskLabel: di.riskAfterDecision,
    riskAfterCeiling: di.riskAfterDecision,
    bestSixEligibility: di.bestSixEligibility,
    topPickEligibility: di.topPickEligibility,
    decisionIntelligenceVersion: DECISION_INTELLIGENCE_VERSION,
    wnbaDataModeAudit: synced.wnbaDataModeAudit || pick.wnbaDataModeAudit || null,
    defenseAudit: synced.defenseAudit || pick.defenseAudit || null,
    impliedTeamTotalAudit: synced.impliedTeamTotalAudit || pick.impliedTeamTotalAudit || null,
    flipFirstAudit: synced.flipFirstAudit || pick.flipFirstAudit || null,
    slateCollisionAudit: synced.slateCollisionAudit || pick.slateCollisionAudit || null,
  };
}

export function buildDecisionIntelligenceReview(slateProps = []) {
  const withDi = slateProps.filter((p) => p.decisionIntelligence || p.trueRisk);
  const byTrueRisk = { LOW: [], MEDIUM: [], HIGH: [] };
  const byTrack = { TRACK: [], BOARD_ONLY: [], SHADOW_ONLY: [], NO_BET: [] };

  for (const prop of slateProps) {
    const di = prop.decisionIntelligence || {};
    const trueRisk = String(prop.trueRisk || di.trueRisk || "MEDIUM").toUpperCase();
    const track = String(
      prop.trackingEligibility || di.trackEligibility || prop.wnbaTrackingDecision || "TRACK"
    ).toUpperCase();

    if (byTrueRisk[trueRisk]) byTrueRisk[trueRisk].push(prop);
    if (byTrack[track]) byTrack[track].push(prop);
  }

  const recordFor = (props = []) => {
    const wins = props.filter((p) => String(p.status).toLowerCase() === "win").length;
    const losses = props.filter((p) => String(p.status).toLowerCase() === "loss").length;
    const pushes = props.filter((p) => String(p.status).toLowerCase() === "push").length;
    const graded = wins + losses + pushes;
    return {
      count: props.length,
      wins,
      losses,
      pushes,
      graded,
      record: `${wins}-${losses}-${pushes}`,
      winRate: graded > 0 ? Number(((wins / graded) * 100).toFixed(1)) : null,
    };
  };

  const debtPerformance = {};
  for (const prop of slateProps) {
    const debts = prop.decisionIntelligence?.riskDebts || [];
    for (const debt of debts) {
      if (!debtPerformance[debt.code]) {
        debtPerformance[debt.code] = { count: 0, wins: 0, losses: 0 };
      }
      debtPerformance[debt.code].count += 1;
      const status = String(prop.status || "").toLowerCase();
      if (status === "win") debtPerformance[debt.code].wins += 1;
      if (status === "loss") debtPerformance[debt.code].losses += 1;
    }
  }

  const repairPerformance = {};
  for (const prop of slateProps) {
    const repairs = prop.decisionIntelligence?.riskRepairs || [];
    for (const repair of repairs) {
      if (!repairPerformance[repair.code]) {
        repairPerformance[repair.code] = { count: 0, wins: 0, losses: 0 };
      }
      repairPerformance[repair.code].count += 1;
      const status = String(prop.status || "").toLowerCase();
      if (status === "win") repairPerformance[repair.code].wins += 1;
      if (status === "loss") repairPerformance[repair.code].losses += 1;
    }
  }

  return {
    title: "Decision Intelligence Review",
    version: DECISION_INTELLIGENCE_VERSION,
    evaluatedCount: withDi.length,
    totalProps: slateProps.length,
    trueRiskRecords: {
      LOW: recordFor(byTrueRisk.LOW),
      MEDIUM: recordFor(byTrueRisk.MEDIUM),
      HIGH: recordFor(byTrueRisk.HIGH),
    },
    trackEligibilityRecords: {
      TRACK: recordFor(byTrack.TRACK),
      BOARD_ONLY: recordFor(byTrack.BOARD_ONLY),
      SHADOW_ONLY: recordFor(byTrack.SHADOW_ONLY),
      NO_BET: recordFor(byTrack.NO_BET),
    },
    riskDebtPerformance: debtPerformance,
    riskRepairPerformance: repairPerformance,
  };
}

export function buildRiskHonestyReview(slateProps = []) {
  const lowRisk = slateProps.filter(
    (p) => String(p.trueRisk || p.decisionIntelligence?.trueRisk).toUpperCase() === "LOW"
  );
  const mediumRisk = slateProps.filter(
    (p) => String(p.trueRisk || p.decisionIntelligence?.trueRisk).toUpperCase() === "MEDIUM"
  );
  const highRisk = slateProps.filter(
    (p) => String(p.trueRisk || p.decisionIntelligence?.trueRisk).toUpperCase() === "HIGH"
  );
  const highInResults = highRisk.filter(
    (p) =>
      (p.trackingEligibility || p.decisionIntelligence?.trackEligibility) === "TRACK" ||
      p.trackingAdmissionSource === "CONTROLLED_BEST_SIX"
  );

  const lossesByDebt = {};
  for (const prop of slateProps.filter((p) => String(p.status).toLowerCase() === "loss")) {
    for (const debt of prop.decisionIntelligence?.riskDebts || []) {
      lossesByDebt[debt.code] = Number(lossesByDebt[debt.code] || 0) + 1;
    }
  }

  return {
    title: "Risk Honesty Review",
    version: DECISION_INTELLIGENCE_VERSION,
    lowRiskCount: lowRisk.length,
    mediumRiskCount: mediumRisk.length,
    highRiskCount: highRisk.length,
    highRiskInResults: highInResults.length,
    highRiskCorrectlyExcluded: highRisk.length - highInResults.length,
    lowRiskActedLow: lowRisk.filter((p) => String(p.status).toLowerCase() === "win").length,
    lowRiskFailed: lowRisk.filter((p) => String(p.status).toLowerCase() === "loss").length,
    mostPredictiveDebts: Object.entries(lossesByDebt)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([code, count]) => ({ code, lossCount: count })),
    question: "Was Low Risk actually low risk?",
  };
}

export function buildUpgradeDemotionReview(slateProps = []) {
  const upgraded = [];
  const demoted = [];
  const blocked = [];

  for (const prop of slateProps) {
    const di = prop.decisionIntelligence;
    if (!di) continue;
    const entry = {
      player: prop.player,
      side: prop.side || prop.pick,
      line: prop.line,
      trueRisk: di.trueRisk,
      trackEligibility: di.trackEligibility,
      reasons: di.upgradeReasons?.length ? di.upgradeReasons : di.demotionReasons,
      status: prop.status,
    };
    if (di.upgradeReasons?.length && di.trackEligibility === "TRACK") {
      upgraded.push(entry);
    }
    if (di.demotionReasons?.length && di.trackEligibility === "BOARD_ONLY") {
      demoted.push(entry);
    }
    if (di.trackEligibility === "NO_BET" || di.killReasons?.length) {
      blocked.push(entry);
    }
  }

  return {
    title: "Upgrade/Demotion Review",
    version: DECISION_INTELLIGENCE_VERSION,
    upgradedToTrack: upgraded,
    demotedToBoardOnly: demoted,
    blockedNoBet: blocked,
    blockedWouldHaveWon: blocked.filter((p) => String(p.status).toLowerCase() === "win"),
    allowedLost: upgraded.filter((p) => String(p.status).toLowerCase() === "loss"),
  };
}

export function buildDecisionIntelligenceRetroSimulation(props = [], options = {}) {
  const slateDate = options.slateDate || "";
  const sim = buildRetroactiveGateSimulation(props, { slateDate });
  return {
    ...sim,
    title: "Decision Intelligence Retro Simulation",
    gateVersion: DECISION_INTELLIGENCE_VERSION,
    underlyingGateVersion: sim.gateVersion,
    reportOnly: true,
    noMutation: true,
    slateDate,
  };
}
