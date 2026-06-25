/**
 * WNBA Tracking Gate v2 — stricter limited-data tracking from 06/24 loss patterns.
 * Board shows all candidates; Results only tracks TRACK survivors through Best 6.
 */
import { resolveQualityGateInputs, isWnbaQualityGatePick } from "./wnbaGateInputs.js";

export const WNBA_TRACKING_GATE_VERSION = "wnba-tracking-gate-v2";
export const WNBA_LIMITED_UNDER_GAP_FLOOR = 3.5;
export const WNBA_LIMITED_OVER_GAP_FLOOR = 4.0;
export const WNBA_LIMITED_UNDER_FAIR_FLOOR = 3.5;
export const WNBA_LIMITED_OVER_FAIR_FLOOR = 3.5;
export const WNBA_LOW_LINE_THRESHOLD = 7.5;
export const WNBA_MIN_BOOK_LOW_RISK = 4;
export const WNBA_MIN_FGA_OVER = 9;
export const WNBA_MIN_MINUTES_OVER = 24;

const READER_BLOCK_DECISIONS = new Set(["NO_BET", "AVOID", "PASS"]);
const EXPANDING_ROLE = new Set(["up", "expanding", "rising"]);
const CONTRACTING_ROLE = new Set(["down", "contracting", "declining"]);

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

function riskRank(label = "") {
  const raw = String(label || "").toLowerCase();
  if (raw.includes("high")) return 3;
  if (raw.includes("medium")) return 2;
  if (raw.includes("low")) return 1;
  return 2;
}

function riskFromRank(rank) {
  if (rank >= 3) return "High Risk";
  if (rank >= 2) return "Medium Risk";
  return "Low Risk";
}

function isLowLineContext(line = 0) {
  return num(line) <= 8.5;
}

function isEliteLimitedDataProfile(metrics = {}) {
  return (
    metrics.netEdge >= 8 &&
    metrics.dataConfidence >= 65 &&
    metrics.bookCount >= 3 &&
    metrics.roleTrend !== "up" &&
    metrics.volatility !== "volatile" &&
    metrics.volatility !== "unstable"
  );
}

function isLowVolumeOverTrap(metrics = {}, side = "") {
  if (side !== "OVER") return false;
  if (metrics.fga > 0 && metrics.fga < 7 && metrics.minutes < 20) return true;
  if (isLowLineContext(metrics.line) && metrics.minutes > 0 && metrics.minutes < 18) return true;
  if (metrics.fga > 0 && metrics.fga < 7 && metrics.projectionGap < 2.5) return true;
  if (metrics.fga > 0 && metrics.fga < WNBA_MIN_FGA_OVER && metrics.projectionGap < WNBA_LIMITED_OVER_GAP_FLOOR + 1) {
    return true;
  }
  return false;
}

function isStrongFairDisagree(metrics = {}, side = "") {
  const fairSide = metrics.fairLineSide;
  if (!fairSide || fairSide === "NONE" || fairSide === side) return false;
  return Math.abs(metrics.fairLineEdge) >= 3 && metrics.fairLineQuality >= 50;
}

function isEfficiencyOnlySpike(metrics = {}, side = "") {
  if (side !== "OVER") return false;
  const hotShooting =
    metrics.ptsPerFGA > 0 &&
    metrics.seasonPtsPerFGA > 0 &&
    metrics.ptsPerFGA >= metrics.seasonPtsPerFGA + 0.15 &&
    metrics.fga < 9;
  return hotShooting && metrics.recent >= metrics.line;
}

function resolveVolumeProfile(pick = {}, metrics = {}) {
  const card = metrics.card || pick.wnbaDataCard || {};
  const vp = pick.volumeProfile || card.volumeProfile || {};
  const vol = String(
    pick.minutesVolatility ??
      card.minutesVolatility ??
      vp.minutesVolatility ??
      metrics.volatility ??
      "stable"
  ).toLowerCase();
  return {
    ...vp,
    minutesVolatility: vol,
    recentMinutes: num(vp.recentMinutes ?? metrics.minutes),
    recentFGA: num(vp.recentFGA ?? metrics.fga),
    volumeStability: String(vp.volumeStability || "MODERATE").toUpperCase(),
  };
}

function resolveDangerGateStack(pick = {}, metrics = {}, side = "") {
  const stack = [];
  const volumeProfile = resolveVolumeProfile(pick, metrics);
  const vol = volumeProfile.minutesVolatility;
  const volumeStability = volumeProfile.volumeStability;

  if (vol === "unstable" || volumeStability === "UNSTABLE") {
    stack.push("unstableMinutes");
  } else if (vol === "volatile" || volumeStability === "VOLATILE") {
    stack.push("volatileMinutes");
  }

  if (isLowVolumeOverTrap(metrics, side)) stack.push("lowVolumeOverTrap");
  if (metrics.minutes > 0 && metrics.minutes < 20) stack.push("lowMinutesFloor");
  if (metrics.bookCount === 1) stack.push("oneBookMarket");
  if (metrics.defenseProxyUsed) stack.push("missingOpponentDefense");
  if (metrics.availabilityDataMissing) stack.push("missingAvailability");

  const roleTrend = String(metrics.roleTrend || "").toLowerCase();
  if (
    (side === "UNDER" && EXPANDING_ROLE.has(roleTrend)) ||
    (side === "OVER" && CONTRACTING_ROLE.has(roleTrend))
  ) {
    stack.push("roleTrendContradiction");
  }

  if (isStrongFairDisagree(metrics, side)) stack.push("projectionFairLineDisagreement");

  if (metrics.dataMode === "WNBA_LIMITED_DATA") {
    const gapFloor =
      side === "UNDER" ? WNBA_LIMITED_UNDER_GAP_FLOOR : WNBA_LIMITED_OVER_GAP_FLOOR;
    if (metrics.projectionGap < gapFloor) stack.push("thinGap");
    if (side === "UNDER" && metrics.line <= WNBA_LOW_LINE_THRESHOLD && metrics.projectionGap < gapFloor + 0.5) {
      stack.push("underFragility");
    }
  }

  const volumeGates = pick.volumeDangerGates?.gates || pick.wnbaDataCard?.volumeDangerGates?.gates || [];
  for (const gate of volumeGates) {
    const key = String(gate).replace(/[^a-zA-Z0-9]/g, "");
    if (key === "unstableminutes" && !stack.includes("unstableMinutes")) stack.push("unstableMinutes");
    if (key === "lowfgafloor" && !stack.includes("lowVolumeOverTrap")) stack.push("lowVolumeOverTrap");
    if (key === "lowminutesfloor" && !stack.includes("lowMinutesFloor")) stack.push("lowMinutesFloor");
    if (key === "wnbalimiteddata" && metrics.dataMode === "WNBA_LIMITED_DATA") {
      if (!stack.includes("thinGap") && metrics.projectionGap < WNBA_LIMITED_OVER_GAP_FLOOR) {
        stack.push("thinGap");
      }
    }
  }

  return [...new Set(stack)];
}

function computeStabilityScores(metrics = {}, volumeProfile = {}) {
  const roleTrend = String(metrics.roleTrend || "stable").toLowerCase();
  let roleStabilityScore = 70;
  if (EXPANDING_ROLE.has(roleTrend)) roleStabilityScore = 45;
  else if (CONTRACTING_ROLE.has(roleTrend)) roleStabilityScore = 55;
  else if (roleTrend === "volatile" || roleTrend === "unstable") roleStabilityScore = 35;
  else roleStabilityScore = 75;

  const vol = volumeProfile.minutesVolatility || metrics.volatility;
  let volumeStabilityScore = 70;
  if (vol === "unstable") volumeStabilityScore = 30;
  else if (vol === "volatile") volumeStabilityScore = 45;
  else volumeStabilityScore = 72;

  let minutesStabilityScore = 70;
  if (metrics.minutes > 0 && metrics.minutes < 20) minutesStabilityScore = 40;
  else if (metrics.minutes >= 26) minutesStabilityScore = 82;
  else minutesStabilityScore = 62;

  return {
    roleStabilityScore,
    volumeStabilityScore,
    minutesStabilityScore,
  };
}

function computeReliabilityScores(metrics = {}, dangerCount = 0) {
  const projectionReliabilityScore = clamp(
    Math.round(55 + metrics.projectionGap * 4 - dangerCount * 8),
    0,
    100
  );
  const fairLineReliabilityScore =
    metrics.fairLineSide === metrics.side && metrics.fairLineQuality >= 50
      ? clamp(Math.round(60 + Math.abs(metrics.fairLineEdge) * 3), 0, 100)
      : clamp(Math.round(40 - Math.abs(metrics.fairLineEdge)), 0, 100);
  const marketConfidenceScore = clamp(
    Math.round(metrics.marketQuality * 0.5 + metrics.bookCount * 8),
    0,
    100
  );
  return { projectionReliabilityScore, fairLineReliabilityScore, marketConfidenceScore };
}

function evaluateSideGate(metrics = {}, side = "", dangerStack = []) {
  const limited = metrics.dataMode === "WNBA_LIMITED_DATA";
  const blockReasons = [];
  const warnings = [];
  let sideGatePassed = true;
  let underFragilityPenalty = 0;
  let overVolumePenalty = 0;
  let limitedDataPenalty = limited ? 12 : 0;

  if (limited && side === "UNDER") {
    if (metrics.projectionGap < WNBA_LIMITED_UNDER_GAP_FLOOR) {
      blockReasons.push("UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR");
      sideGatePassed = false;
    }
    if (
      metrics.fairLineSide === "UNDER" &&
      Math.abs(metrics.fairLineEdge) < WNBA_LIMITED_UNDER_FAIR_FLOOR &&
      metrics.fairLineQuality >= 40
    ) {
      blockReasons.push("UNDER_FAIR_LINE_TOO_THIN");
      sideGatePassed = false;
    }
    if (EXPANDING_ROLE.has(metrics.roleTrend)) {
      blockReasons.push("UNDER_ROLE_TRENDING_UP");
      sideGatePassed = false;
    }
    if (metrics.line <= WNBA_LOW_LINE_THRESHOLD && metrics.projectionGap < WNBA_LIMITED_UNDER_GAP_FLOOR + 0.5) {
      blockReasons.push("UNDER_LOW_LINE_THIN_EDGE");
      sideGatePassed = false;
      underFragilityPenalty = 18;
    }
    if (metrics.volatility === "volatile" || metrics.volatility === "unstable") {
      blockReasons.push("UNDER_UNSTABLE_VOLUME");
      sideGatePassed = false;
      underFragilityPenalty += 10;
    }
    if (metrics.bookCount < 2 && metrics.netEdge < 7) {
      blockReasons.push("UNDER_THIN_MARKET");
      sideGatePassed = false;
    }
  }

  if (limited && side === "OVER") {
    const elite = isEliteLimitedDataProfile(metrics);
    if (metrics.projectionGap < WNBA_LIMITED_OVER_GAP_FLOOR && !elite) {
      blockReasons.push("OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR");
      sideGatePassed = false;
    }
    if (
      Math.abs(metrics.fairLineEdge) < WNBA_LIMITED_OVER_FAIR_FLOOR &&
      metrics.fairLineSide === "OVER" &&
      !elite
    ) {
      warnings.push("OVER_FAIR_LINE_THIN");
      if (metrics.projectionGap < WNBA_LIMITED_OVER_GAP_FLOOR) sideGatePassed = false;
    }
    if (metrics.fga > 0 && metrics.fga < WNBA_MIN_FGA_OVER && !elite) {
      blockReasons.push("LOW_VOLUME_OVER_TRAP");
      sideGatePassed = false;
      overVolumePenalty = 20;
    }
    if (metrics.minutes > 0 && metrics.minutes < WNBA_MIN_MINUTES_OVER && metrics.projectionGap < 5 && !elite) {
      blockReasons.push("OVER_LOW_MINUTES_NO_CUSHION");
      sideGatePassed = false;
      overVolumePenalty += 8;
    }
    if (
      (metrics.volatility === "volatile" || metrics.volatility === "unstable") &&
      !EXPANDING_ROLE.has(metrics.roleTrend) &&
      metrics.projectionGap < 5
    ) {
      blockReasons.push("OVER_UNSTABLE_ROLE_NOT_EXPANDING");
      sideGatePassed = false;
    }
    if (metrics.bookCount === 1 && metrics.netEdge < 7) {
      blockReasons.push("ONE_BOOK_WEAK_EDGE");
      sideGatePassed = false;
    }
  }

  if (isLowVolumeOverTrap(metrics, side)) {
    blockReasons.push("LOW_VOLUME_OVER_TRAP");
    sideGatePassed = false;
    overVolumePenalty = Math.max(overVolumePenalty, 20);
  }

  if (isEfficiencyOnlySpike(metrics, side)) {
    blockReasons.push("EFFICIENCY_ONLY_SCORING_SPIKE");
    sideGatePassed = false;
  }

  if (isStrongFairDisagree(metrics, side)) {
    blockReasons.push("FAIR_LINE_STRONG_DISAGREE");
    sideGatePassed = false;
  }

  if (dangerStack.includes("roleTrendContradiction")) {
    warnings.push("ROLE_TREND_CONTRADICTS_SIDE");
    sideGatePassed = false;
  }

  return {
    sideGatePassed,
    blockReasons,
    warnings,
    underFragilityPenalty,
    overVolumePenalty,
    limitedDataPenalty,
    wnbaSideGate: side === "UNDER" ? "WNBA_UNDER_GATE" : "WNBA_OVER_GATE",
  };
}

function computeRiskCeiling(pick = {}, metrics = {}, dangerStack = [], side = "") {
  const riskBeforeCeiling = pick.riskLabel || "Medium Risk";
  let rank = riskRank(riskBeforeCeiling);
  let riskCeilingReason = null;

  if (metrics.dataMode === "WNBA_LIMITED_DATA" && rank < 2) {
    rank = 2;
    riskCeilingReason = "WNBA_LIMITED_DATA_MIN_MEDIUM";
  }
  if (dangerStack.length >= 1 && rank < 2) {
    rank = 2;
    riskCeilingReason = riskCeilingReason || "DANGER_GATE_BLOCKS_LOW";
  }
  if (side === "UNDER" && metrics.dataMode === "WNBA_LIMITED_DATA" && rank < 2) {
    rank = 2;
    riskCeilingReason = riskCeilingReason || "LIMITED_DATA_UNDER_MIN_MEDIUM";
  }
  if (metrics.bookCount < WNBA_MIN_BOOK_LOW_RISK && rank < 2) {
    rank = 2;
    riskCeilingReason = riskCeilingReason || "THIN_BOOK_BLOCKS_LOW";
  }
  if (dangerStack.length >= 2 && rank < 2) {
    rank = 2;
    riskCeilingReason = riskCeilingReason || "DANGER_STACK_2_NO_LOW";
  }
  if (dangerStack.length >= 3 && rank < 3) {
    rank = 3;
    riskCeilingReason = riskCeilingReason || "DANGER_STACK_3_HIGH";
  }
  if (dangerStack.includes("lowVolumeOverTrap") && rank < 3) {
    rank = 3;
    riskCeilingReason = riskCeilingReason || "LOW_VOLUME_OVER_TRAP_HIGH";
  }

  return {
    riskBeforeCeiling,
    riskAfterCeiling: riskFromRank(rank),
    riskCeilingReason,
    riskCeiling: riskFromRank(rank),
  };
}

function computeFinalTrackScore(metrics = {}, dangerCount = 0, penalties = {}) {
  let score = 68;
  score += clamp(metrics.netEdge * 2.2, 0, 16);
  score += clamp((metrics.dataConfidence - 50) / 3, -10, 12);
  score += metrics.bookCount >= 4 ? 6 : metrics.bookCount <= 1 ? -8 : 0;
  score += clamp(metrics.projectionGap * 3, 0, 14);
  score -= dangerCount * 10;
  score -= num(penalties.limitedDataPenalty) * 0.4;
  score -= num(penalties.underFragilityPenalty) * 0.3;
  score -= num(penalties.overVolumePenalty) * 0.3;
  if (metrics.fairLineSide === metrics.side && metrics.fairLineQuality >= 50) score += 6;
  return clamp(Math.round(score), 0, 100);
}

function resolveTrackingDecision({
  blockReasons = [],
  warnings = [],
  dangerStack = [],
  sideGatePassed = true,
  metrics = {},
  pick = {},
  side = "",
}) {
  const readerDecision = metrics.readerDecision;
  const dangerCount = dangerStack.length;

  if (blockReasons.length > 0) {
    return {
      wnbaTrackingDecision: "NO_BET",
      wnbaTrackingReason: blockReasons[0],
      trackingEligibility: "NO_BET",
    };
  }

  if (dangerCount >= 4) {
    return {
      wnbaTrackingDecision: "NO_BET",
      wnbaTrackingReason: "DANGER_GATE_STACK_NO_TRACK",
      trackingEligibility: "NO_BET",
    };
  }

  if (!sideGatePassed) {
    return {
      wnbaTrackingDecision: "BOARD_ONLY",
      wnbaTrackingReason: warnings[0] || "SIDE_GATE_FAILED",
      trackingEligibility: "BOARD_ONLY",
    };
  }

  if (dangerCount >= 3) {
    const elite = isEliteLimitedDataProfile(metrics);
    if (!elite) {
      return {
        wnbaTrackingDecision: "BOARD_ONLY",
        wnbaTrackingReason: "DANGER_GATE_STACK_BOARD_ONLY",
        trackingEligibility: "BOARD_ONLY",
      };
    }
    warnings.push("DANGER_STACK_ELITE_EDGE_OVERRIDE");
  }

  if (dangerCount >= 2) {
    warnings.push("DANGER_STACK_EXTRA_EDGE_REQUIRED");
    if (metrics.netEdge < 6 || metrics.projectionGap < (side === "UNDER" ? 4 : 4.5)) {
      return {
        wnbaTrackingDecision: "BOARD_ONLY",
        wnbaTrackingReason: "DANGER_STACK_INSUFFICIENT_EDGE",
        trackingEligibility: "BOARD_ONLY",
      };
    }
  }

  if (
    readerDecision === "TEST" &&
    pick.readerOfficialDemoted !== true &&
    (metrics.readerConfidence < 45 || warnings.length >= 3 || metrics.netEdge < 5)
  ) {
    warnings.push("READER_UNCERTAIN_TEST_STRICT");
    return {
      wnbaTrackingDecision: "BOARD_ONLY",
      wnbaTrackingReason: "READER_UNCERTAIN_TEST",
      trackingEligibility: "BOARD_ONLY",
    };
  }

  if (warnings.length >= 4) {
    return {
      wnbaTrackingDecision: "SHADOW_ONLY",
      wnbaTrackingReason: "MULTIPLE_WARNINGS_SHADOW",
      trackingEligibility: "SHADOW_ONLY",
    };
  }

  if (warnings.length >= 2 && metrics.netEdge < 6) {
    return {
      wnbaTrackingDecision: "BOARD_ONLY",
      wnbaTrackingReason: "WARNINGS_WITH_WEAK_EDGE",
      trackingEligibility: "BOARD_ONLY",
    };
  }

  return {
    wnbaTrackingDecision: "TRACK",
    wnbaTrackingReason: side === "OVER" ? "WNBA_OVER_PASSED_V2_GATE" : "WNBA_UNDER_PASSED_V2_GATE",
    trackingEligibility: "TRACK",
  };
}

export function evaluateWnbaTrackingGateV2(pick = {}, dataCard = null, reader = null) {
  if (!isWnbaQualityGatePick(pick)) {
    return {
      trackingEligibility: "TRACK",
      wnbaTrackingDecision: "TRACK",
      trackingBlockReasons: [],
      trackingWarnings: [],
      qualityGateScore: 100,
      qualityGateVersion: WNBA_TRACKING_GATE_VERSION,
      wnbaGateVersion: WNBA_TRACKING_GATE_VERSION,
      skipped: true,
      reason: "nba_or_non_wnba_passthrough",
    };
  }

  const metrics = resolveQualityGateInputs(pick, dataCard, reader);
  const side = metrics.side;
  const volumeProfile = resolveVolumeProfile(pick, metrics);
  const blockReasons = [];
  const warnings = [];

  const trackingDecision = String(
    pick.trackingType || pick.recordType || pick.finalDecision || ""
  ).toUpperCase();

  if (trackingDecision === "NO_BET" || pick.noPlay === true) blockReasons.push("NO_BET");
  if (pick.isStarted) blockReasons.push("STARTED_GAME");
  if (!pick.player || !pick.team || !pick.opponent || !side || metrics.line <= 0) {
    blockReasons.push("MISSING_REQUIRED_FIELDS");
  }
  if (READER_BLOCK_DECISIONS.has(metrics.readerDecision)) {
    blockReasons.push(`READER_${metrics.readerDecision}`);
  }

  const dangerGateStack = resolveDangerGateStack(pick, metrics, side);
  const sideGate = evaluateSideGate(metrics, side, dangerGateStack);
  blockReasons.push(...sideGate.blockReasons);
  warnings.push(...sideGate.warnings);

  if (
    side === "OVER" &&
    (metrics.roleTrend === "down" || metrics.volatility === "volatile") &&
    metrics.projectionGap < 3 &&
    metrics.netEdge < 6
  ) {
    blockReasons.push("ROLE_MINUTES_INSTABILITY_NO_CUSHION");
  }

  const missingStack =
    (metrics.dataMode === "WNBA_LIMITED_DATA" ? 1 : 0) +
    (metrics.availabilityDataMissing ? 1 : 0) +
    (metrics.defenseProxyUsed ? 1 : 0) +
    (metrics.missingFlags.length >= 2 ? 1 : 0) +
    (metrics.bookCount <= 1 ? 1 : 0) +
    (metrics.volatility === "volatile" || metrics.volatility === "unstable" ? 1 : 0);

  if (missingStack >= 4 && metrics.projectionGap < 3.5 && metrics.netEdge < 7) {
    blockReasons.push("MISSING_DATA_STACK_THIN_EDGE");
  }

  if (metrics.fairLineSide === side && metrics.fairLineQuality >= 50) {
    warnings.push("FAIR_LINE_AGREEMENT");
  } else if (metrics.fairLineSide && metrics.fairLineSide !== side && metrics.fairLineQuality >= 40) {
    warnings.push("FAIR_LINE_MILD_DISAGREE");
  }
  if (metrics.bookCount <= 2 && metrics.marketQuality > 0 && metrics.marketQuality < 55) {
    warnings.push("THIN_MARKET");
  }
  if (dangerGateStack.length >= 2 && dangerGateStack.length < 4) {
    warnings.push("PARTIAL_DANGER_GATE_STACK");
  }
  if (metrics.dataConfidence < 55) warnings.push("LOW_DATA_CONFIDENCE");

  const uniqueBlocks = [...new Set(blockReasons)];
  const decision = resolveTrackingDecision({
    blockReasons: uniqueBlocks,
    warnings,
    dangerStack: dangerGateStack,
    sideGatePassed: sideGate.sideGatePassed,
    metrics,
    pick,
    side,
  });

  const stability = computeStabilityScores(metrics, volumeProfile);
  const reliability = computeReliabilityScores(metrics, dangerGateStack.length);
  const risk = computeRiskCeiling(pick, metrics, dangerGateStack, side);
  const finalTrackScore = computeFinalTrackScore(metrics, dangerGateStack.length, sideGate);

  const qualityGateScore = finalTrackScore;
  if (decision.trackingEligibility === "TRACK" && qualityGateScore < 50) {
    decision.trackingEligibility = "BOARD_ONLY";
    decision.wnbaTrackingDecision = "BOARD_ONLY";
    decision.wnbaTrackingReason = "LOW_FINAL_TRACK_SCORE";
    warnings.push("LOW_FINAL_TRACK_SCORE");
  }

  return {
    ...decision,
    trackingBlockReasons: uniqueBlocks,
    trackingWarnings: warnings,
    qualityGateScore,
    qualityGateVersion: WNBA_TRACKING_GATE_VERSION,
    wnbaGateVersion: WNBA_TRACKING_GATE_VERSION,
    wnbaSideGate: sideGate.wnbaSideGate,
    sideGatePassed: sideGate.sideGatePassed,
    dangerGateStack,
    dangerGateCount: dangerGateStack.length,
    limitedDataPenalty: sideGate.limitedDataPenalty,
    underFragilityPenalty: sideGate.underFragilityPenalty,
    overVolumePenalty: sideGate.overVolumePenalty,
    ...stability,
    ...reliability,
    finalTrackScore,
    ...risk,
    keyMetrics: {
      projectionGap: Number(metrics.projectionGap.toFixed(2)),
      fairLineEdge: metrics.fairLineEdge,
      bookCount: metrics.bookCount,
      marketQuality: metrics.marketQuality,
      dataConfidence: metrics.dataConfidence,
      minutes: metrics.minutes,
      FGA: metrics.fga,
      roleTrend: metrics.roleTrend,
      volatility: metrics.volatility,
      availabilityDataMissing: metrics.availabilityDataMissing,
      defenseProxyUsed: metrics.defenseProxyUsed,
      underGap: metrics.underGap,
      netEdge: metrics.netEdge,
      readerDecision: metrics.readerDecision,
      readerConfidence: metrics.readerConfidence,
      dataMode: metrics.dataMode,
      dangerGateCount: dangerGateStack.length,
    },
  };
}

export function applyWnbaTrackingGateV2ToPick(pick = {}, gate = {}) {
  return {
    ...pick,
    trackingEligibility: gate.trackingEligibility ?? gate.wnbaTrackingDecision,
    trackingBlockReasons: gate.trackingBlockReasons || [],
    trackingWarnings: gate.trackingWarnings || [],
    qualityGateScore: gate.qualityGateScore ?? gate.finalTrackScore,
    qualityGateVersion: gate.qualityGateVersion ?? gate.wnbaGateVersion,
    qualityGateKeyMetrics: gate.keyMetrics || null,
    wnbaGateVersion: gate.wnbaGateVersion,
    wnbaTrackingDecision: gate.wnbaTrackingDecision,
    wnbaTrackingReason: gate.wnbaTrackingReason,
    wnbaSideGate: gate.wnbaSideGate,
    sideGatePassed: gate.sideGatePassed,
    dangerGateStack: gate.dangerGateStack || [],
    dangerGateCount: gate.dangerGateCount ?? (gate.dangerGateStack?.length || 0),
    limitedDataPenalty: gate.limitedDataPenalty,
    underFragilityPenalty: gate.underFragilityPenalty,
    overVolumePenalty: gate.overVolumePenalty,
    roleStabilityScore: gate.roleStabilityScore,
    volumeStabilityScore: gate.volumeStabilityScore,
    minutesStabilityScore: gate.minutesStabilityScore,
    marketConfidenceScore: gate.marketConfidenceScore,
    projectionReliabilityScore: gate.projectionReliabilityScore,
    fairLineReliabilityScore: gate.fairLineReliabilityScore,
    finalTrackScore: gate.finalTrackScore,
    riskCeilingReason: gate.riskCeilingReason,
    riskBeforeCeiling: gate.riskBeforeCeiling,
    riskAfterCeiling: gate.riskAfterCeiling,
    riskLabel: gate.riskAfterCeiling || pick.riskLabel,
  };
}

export function applyWnbaRiskCeiling(pick = {}, gate = {}) {
  if (!gate.riskAfterCeiling) return pick;
  return {
    ...pick,
    riskBeforeCeiling: gate.riskBeforeCeiling ?? pick.riskLabel,
    riskAfterCeiling: gate.riskAfterCeiling,
    riskCeilingReason: gate.riskCeilingReason,
    riskLabel: gate.riskAfterCeiling,
    chosenRisk:
      gate.riskAfterCeiling === "High Risk"
        ? Math.max(num(pick.chosenRisk, 55), 55)
        : gate.riskAfterCeiling === "Medium Risk"
          ? clamp(num(pick.chosenRisk, 40), 33, 48)
          : num(pick.chosenRisk, 30),
  };
}

function buildRetroLossReview(prop = {}, gate = {}) {
  const side = normalizeSide(prop.side || prop.pick);
  const status = String(prop.status || "").toLowerCase();
  const wouldBlock = gate.wnbaTrackingDecision !== "TRACK";
  return {
    player: prop.player,
    prop: `${side} ${prop.line}`,
    actual: prop.actualValue ?? prop.actual ?? null,
    margin: prop.margin ?? null,
    status,
    dataMode: prop.dataMode || prop.wnbaDataCard?.dataMode,
    side,
    projectionGap: gate.keyMetrics?.projectionGap,
    fairLineEdge: gate.keyMetrics?.fairLineEdge,
    dangerGateStack: gate.dangerGateStack || [],
    dangerGateCount: gate.dangerGateCount ?? 0,
    roleTrend: gate.keyMetrics?.roleTrend,
    volumeProfile: prop.volumeProfile?.volumeStability || gate.keyMetrics?.volatility,
    bookCount: gate.keyMetrics?.bookCount,
    whyAllowedIntoResults: prop.trackingAdmissionSource || prop.sourcePool || "tracked_before_v2",
    wouldBlockNow: wouldBlock,
    newGateDecision: gate.wnbaTrackingDecision,
    newGateReason: gate.wnbaTrackingReason,
    wouldBeBlockedByRetroGate: wouldBlock,
    blockReasons: gate.trackingBlockReasons || [],
  };
}

function hydrateRetroGateCandidate(prop = {}) {
  if (prop.wnbaDataCard || prop.wnbaReader) return prop;

  const side = normalizeSide(prop.currentEngineSide || prop.side || prop.pick);
  const line = num(prop.line);
  const projection = num(prop.projection);
  const recentMinutes = num(prop.recentMinutes ?? prop.minutesAverage ?? prop.playerState?.minutes);
  const recentFGA = num(prop.recentFGA ?? prop.fgaAverage ?? prop.playerState?.fga);
  const syntheticCard = {
    playerId: prop.playerId || prop.player,
    dataMode: String(prop.dataMode || "WNBA_LIMITED_DATA").toUpperCase(),
    bookLine: line,
    bookCount: num(prop.bookCount, 1),
    marketQuality: num(prop.marketQuality, 50),
    roleTrend: String(prop.roleTrend || prop.roleChange?.trend || "stable").toLowerCase(),
    minutesVolatility: String(
      prop.minutesVolatility || prop.volumeProfile?.minutesVolatility || "stable"
    ).toLowerCase(),
    last5: {
      minutes: recentMinutes,
      fga: recentFGA,
      points: num(prop.last5Average),
      ptsPerFGA:
        recentFGA > 0
          ? num(prop.last5Average) / recentFGA
          : num(prop.ptsPerFGA),
      games: 5,
    },
    season: {
      points: num(prop.seasonAverage),
      minutes: num(prop.seasonMinutes),
      fga: num(prop.seasonFGA),
      ptsPerFGA:
        num(prop.seasonFGA) > 0
          ? num(prop.seasonAverage) / num(prop.seasonFGA)
          : num(prop.seasonPtsPerFGA),
    },
    projection: { projection, expectedMinutes: recentMinutes, expectedFGA: recentFGA },
    fairLine: {
      fairLineSide: normalizeSide(prop.fairLineSide),
      fairLineEdge: num(prop.fairLineEdge),
      fairLineQuality: num(prop.fairLineQuality, 50),
    },
    injuryAvailability: prop.availabilityGate || {},
    opponentDefense: prop.defenseResult || prop.opponentDefense || {},
    volumeProfile: prop.volumeProfile || {},
    dataConfidenceScore: num(prop.dataCoverage ?? prop.dataQuality, 55),
    dataMissingFlags: prop.dataMissingFlags || [],
  };

  return {
    ...prop,
    league: "WNBA",
    side: side === "OVER" ? "Over" : side === "UNDER" ? "Under" : prop.pick,
    pick: side === "OVER" ? "Over" : side === "UNDER" ? "Under" : prop.pick,
    wnbaDataCard: syntheticCard,
    wnbaReader: {
      decision: String(prop.readerDecision || prop.trackingType || "TEST").toUpperCase(),
      readerConfidence: num(prop.readerConfidence ?? prop.confidence, 50),
      finalSide: side,
      underGap: side === "UNDER" ? line - projection : 0,
      margin: num(prop.netEdge),
    },
    netEdge: num(prop.netEdge),
    dataMode: syntheticCard.dataMode,
    recentMinutes,
    recentFGA,
    fairLineEdge: num(prop.fairLineEdge),
    fairLineSide: normalizeSide(prop.fairLineSide),
    roleTrend: syntheticCard.roleTrend,
    minutesVolatility: syntheticCard.minutesVolatility,
    volumeProfile: prop.volumeProfile,
    volumeDangerGates: prop.volumeDangerGates,
    riskLabel: prop.riskLabel,
    trackingType: prop.trackingType || prop.recordType || "TEST",
    readerDecision: prop.readerDecision || prop.trackingType || "TEST",
  };
}

export function simulateRetroactiveGateForProp(prop = {}) {
  const hydrated = hydrateRetroGateCandidate(prop);
  const gate = evaluateWnbaTrackingGateV2(
    hydrated,
    hydrated.wnbaDataCard,
    hydrated.wnbaReader
  );
  return {
    ...buildRetroLossReview(hydrated, gate),
    gate,
    hydratedFromSnapshot: !prop.wnbaDataCard && !prop.wnbaReader,
  };
}

export function buildRetroactiveGateSimulation(props = [], options = {}) {
  const slateDate = options.slateDate || "2026-06-24";
  const slateProps = props.filter(
    (p) =>
      String(p.slateDate || "") === slateDate &&
      String(p.league || "").toUpperCase() === "WNBA"
  );

  const reviews = slateProps.map(simulateRetroactiveGateForProp);
  const wins = reviews.filter((r) => r.status === "win");
  const losses = reviews.filter((r) => r.status === "loss");
  const trackedBefore = slateProps.length;
  const wouldTrack = reviews.filter((r) => r.newGateDecision === "TRACK");
  const wouldBlock = reviews.filter((r) => r.wouldBlockNow);
  const lossesBlocked = losses.filter((r) => r.wouldBlockNow);
  const winsBlocked = wins.filter((r) => r.wouldBlockNow);
  const winsKept = wins.filter((r) => !r.wouldBlockNow);

  const simWins = wouldTrack.filter((r) => r.status === "win").length;
  const simLosses = wouldTrack.filter((r) => r.status === "loss").length;
  const simPushes = wouldTrack.filter((r) => r.status === "push").length;

  return {
    title: "Retroactive WNBA v2 Gate Simulation",
    slateDate,
    reportOnly: true,
    noMutation: true,
    gateVersion: WNBA_TRACKING_GATE_VERSION,
    actualRecord: {
      tracked: trackedBefore,
      wins: wins.length,
      losses: losses.length,
      record: `${wins.length}-${losses.length}-0`,
    },
    simulatedRecord: {
      wouldTrack: wouldTrack.length,
      wins: simWins,
      losses: simLosses,
      pushes: simPushes,
      record: `${simWins}-${simLosses}-${simPushes}`,
    },
    lossesWouldBeBlocked: lossesBlocked.map((r) => ({
      player: r.player,
      prop: r.prop,
      reason: r.newGateReason,
      decision: r.newGateDecision,
    })),
    winsWouldStillTrack: winsKept.map((r) => ({
      player: r.player,
      prop: r.prop,
      decision: r.newGateDecision,
    })),
    winsWouldBeBlocked: winsBlocked.map((r) => ({
      player: r.player,
      prop: r.prop,
      reason: r.newGateReason,
    })),
    lossReviews: reviews.filter((r) => r.status === "loss"),
    allReviews: reviews,
    overRecord: {
      actual: buildSideRecord(reviews, "OVER"),
      simulated: buildSideRecord(wouldTrack, "OVER"),
    },
    underRecord: {
      actual: buildSideRecord(reviews, "UNDER"),
      simulated: buildSideRecord(
        wouldTrack.filter((r) => r.newGateDecision === "TRACK"),
        "UNDER"
      ),
    },
    improvesQuality:
      lossesBlocked.length >= winsBlocked.length &&
      wouldTrack.length < trackedBefore,
  };
}

function buildSideRecord(reviews = [], side = "") {
  const subset = reviews.filter((r) => normalizeSide(r.side) === side);
  const wins = subset.filter((r) => r.status === "win").length;
  const losses = subset.filter((r) => r.status === "loss").length;
  return { count: subset.length, wins, losses, record: `${wins}-${losses}-0` };
}

export function buildWnbaV2GateReview(slateProps = []) {
  const wnba = slateProps.filter((p) => String(p.league).toUpperCase() === "WNBA");
  const limited = wnba.filter(
    (p) => String(p.dataMode || p.wnbaDataCard?.dataMode || "").toUpperCase() === "WNBA_LIMITED_DATA"
  );
  const overs = wnba.filter((p) => normalizeSide(p.side || p.pick) === "OVER");
  const unders = wnba.filter((p) => normalizeSide(p.side || p.pick) === "UNDER");
  const tracked = wnba.filter(
    (p) => (p.wnbaTrackingDecision || p.trackingEligibility) === "TRACK" || !p.trackingEligibility
  );
  const boardOnly = wnba.filter(
    (p) => (p.wnbaTrackingDecision || p.trackingEligibility) === "BOARD_ONLY"
  );

  const gateReviews = wnba.map((p) => simulateRetroactiveGateForProp(p));

  return {
    title: "WNBA v2 Gate Review",
    gateVersion: WNBA_TRACKING_GATE_VERSION,
    wnbaCount: wnba.length,
    limitedDataCount: limited.length,
    overCount: overs.length,
    underCount: unders.length,
    trackedCount: tracked.length,
    boardOnlyCount: boardOnly.length,
    overGatePassCount: gateReviews.filter(
      (r) => normalizeSide(r.side) === "OVER" && r.newGateDecision === "TRACK"
    ).length,
    underGatePassCount: gateReviews.filter(
      (r) => normalizeSide(r.side) === "UNDER" && r.newGateDecision === "TRACK"
    ).length,
    dangerStackAvg:
      gateReviews.length > 0
        ? Number(
            (
              gateReviews.reduce((s, r) => s + (r.dangerGateCount || 0), 0) /
              gateReviews.length
            ).toFixed(2)
          )
        : null,
    lossReviews: gateReviews.filter((r) => r.status === "loss"),
    gateReviews,
  };
}
