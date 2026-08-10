/**
 * Empirical Direction Engine V1 — decide OVER / UNDER / NO BET.
 * Does not decide Official membership (C2).
 */
import {
  DIRECTION_ENGINE_VERSION,
  DIRECTION_THRESHOLDS_V1,
  EMPIRICAL_DIRECTION_V1_BUILD,
  EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE,
} from "./versions.js";

function num(v, f = null) {
  if (v == null || v === "") return f;
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
}

export function directionalEdgeForSide(side, projection, line) {
  const s = String(side || "").toUpperCase();
  const p = num(projection);
  const L = num(line);
  if (!s.startsWith("OVER") && !s.startsWith("UNDER")) return null;
  if (p == null || L == null) return null;
  return s.startsWith("OVER") ? p - L : L - p;
}

export function fairDirectionalEdgeForSide(side, fairLine, line) {
  const s = String(side || "").toUpperCase();
  const f = num(fairLine);
  const L = num(line);
  if (!s.startsWith("OVER") && !s.startsWith("UNDER")) return null;
  if (f == null || L == null) return null;
  return s.startsWith("OVER") ? f - L : L - f;
}

function extractSideFeatures(sidePacket = {}, base = {}) {
  const side = String(sidePacket.side || base.side || "").toUpperCase();
  const line = num(
    sidePacket.line ?? base.line ?? base.selectedLine ?? base.officialLine
  );
  const projection = num(
    sidePacket.projection ??
      sidePacket.projectedPoints ??
      base.projection ??
      base.projectedPoints
  );
  const fairLine = num(
    sidePacket.fairLine ?? sidePacket.fairValueLine ?? base.fairLine
  );
  const reliability = num(
    sidePacket.reliabilityProbability ??
      sidePacket.reliability ??
      sidePacket.risk?.reliabilityProbability
  );
  const safety = num(
    sidePacket.safety?.finalSafetyScore ??
      sidePacket.SafetyScore ??
      sidePacket.safetyScore ??
      sidePacket.safety
  );
  const roleStability = num(
    sidePacket.role?.roleStabilityScore ??
      sidePacket.roleStability ??
      sidePacket.roleModel?.roleStabilityScore
  );
  const expectedMinutes = num(
    sidePacket.minutes?.expectedMinutes ??
      sidePacket.expectedMinutes ??
      sidePacket.minutesModel?.expectedMinutes
  );
  const marketQuality = num(
    sidePacket.market?.marketQualityScore ??
      sidePacket.marketQuality ??
      base.marketQuality
  );
  const bookCount = num(
    sidePacket.market?.bookCount ?? sidePacket.bookCount ?? base.bookCount
  );
  const rawP = num(
    sidePacket.rawWinProbability ?? sidePacket.probability?.rawWinProbability
  );

  return {
    side: side.startsWith("UNDER") ? "UNDER" : side.startsWith("OVER") ? "OVER" : null,
    line,
    projection,
    fairLine,
    directionalEdge: directionalEdgeForSide(side, projection, line),
    fairDirectionalEdge: fairDirectionalEdgeForSide(side, fairLine, line),
    reliability,
    safety,
    roleStability,
    expectedMinutes,
    marketQuality,
    bookCount,
    rawP,
  };
}

function evaluateSidePass(features, thresholds) {
  const side = features.side;
  const edge = features.directionalEdge;
  const fair = features.fairDirectionalEdge;
  const rel = features.reliability;
  const safety = features.safety;
  const role = features.roleStability;
  const minutes = features.expectedMinutes;
  const mq = features.marketQuality;
  const books = features.bookCount;
  const noBet = thresholds.noBet;

  const weakEdge = edge == null || edge < noBet.edgeFloor;
  const lowRel = rel != null && rel < noBet.reliabilityFloor;

  if (noBet.mode === "EITHER" && (weakEdge || lowRel)) {
    return {
      pass: false,
      decision: "NO_BET",
      reason: weakEdge ? "WEAK_EDGE" : "LOW_RELIABILITY",
      confidence: "NONE",
    };
  }
  if (noBet.mode === "BOTH" && weakEdge && lowRel) {
    return {
      pass: false,
      decision: "NO_BET",
      reason: "WEAK_EDGE_AND_LOW_RELIABILITY",
      confidence: "NONE",
    };
  }
  if (noBet.mode === "EDGE_OR_REL_MISSING_EDGE") {
    if (weakEdge) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "WEAK_EDGE",
        confidence: "NONE",
      };
    }
    if (rel != null && lowRel) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "LOW_RELIABILITY",
        confidence: "NONE",
      };
    }
  }

  if (side === "OVER") {
    const o = thresholds.over;
    if (edge == null || edge < o.minEdge) {
      return { pass: false, decision: "NO_BET", reason: "OVER_EDGE_BELOW_MIN", confidence: "NONE" };
    }
    if (o.requireFairConfirm && fair != null && fair < o.minFairEdge) {
      return { pass: false, decision: "NO_BET", reason: "OVER_FAIR_NOT_CONFIRMED", confidence: "NONE" };
    }
    if (rel != null && o.minReliability != null && rel < o.minReliability) {
      return { pass: false, decision: "NO_BET", reason: "OVER_RELIABILITY_BELOW_MIN", confidence: "NONE" };
    }
    if (safety != null && o.minSafety != null && safety < o.minSafety) {
      return { pass: false, decision: "NO_BET", reason: "OVER_SAFETY_BELOW_MIN", confidence: "NONE" };
    }
    let confidence = "STANDARD";
    if (edge >= o.strongEdge && (rel == null || rel >= (o.strongReliability ?? 0.65))) {
      confidence = "STRONG";
    }
    let marketConflict = false;
    if (
      o.marketConflict?.enabled &&
      edge >= o.marketConflict.minEdge &&
      mq != null &&
      mq >= o.marketConflict.marketQualityFloor &&
      (books == null || books >= o.marketConflict.minBooks)
    ) {
      marketConflict = true;
      confidence = confidence === "STRONG" ? "STANDARD" : "WEAK";
    }
    return {
      pass: true,
      decision: "OVER",
      reason: marketConflict ? "OVER_PASS_MARKET_CONFLICT_SOFT" : "OVER_PASS",
      confidence,
      marketConflict,
    };
  }

  if (side === "UNDER") {
    const u = thresholds.under;
    if (edge == null || edge < u.minEdge) {
      return { pass: false, decision: "NO_BET", reason: "UNDER_EDGE_BELOW_MIN", confidence: "NONE" };
    }
    if (rel != null && u.minReliability != null && rel < u.minReliability) {
      return { pass: false, decision: "NO_BET", reason: "UNDER_RELIABILITY_BELOW_MIN", confidence: "NONE" };
    }
    if (safety != null && u.minSafety != null && safety < u.minSafety) {
      return { pass: false, decision: "NO_BET", reason: "UNDER_SAFETY_BELOW_MIN", confidence: "NONE" };
    }
    if (role != null && u.minRoleStability != null && role < u.minRoleStability) {
      return { pass: false, decision: "NO_BET", reason: "UNDER_ROLE_BELOW_MIN", confidence: "NONE" };
    }
    if (minutes != null && u.minMinutes != null && minutes < u.minMinutes) {
      return { pass: false, decision: "NO_BET", reason: "UNDER_MINUTES_BELOW_MIN", confidence: "NONE" };
    }
    let confidence = "STANDARD";
    if (edge >= u.strongEdge) confidence = "STRONG";
    return {
      pass: true,
      decision: "UNDER",
      reason: "UNDER_PASS",
      confidence,
      marketConflict: false,
    };
  }

  return { pass: false, decision: "NO_BET", reason: "UNKNOWN_SIDE", confidence: "NONE" };
}

function confidenceRank(c) {
  if (c === "STRONG") return 3;
  if (c === "STANDARD") return 2;
  if (c === "WEAK") return 1;
  return 0;
}

/**
 * Dual-side direction decision for a player market.
 * @returns {{ decision: 'OVER'|'UNDER'|'NO_BET', ... }}
 */
export function decideDirectionalSideV1({
  overPacket = {},
  underPacket = {},
  basePick = {},
  thresholds = DIRECTION_THRESHOLDS_V1,
} = {}) {
  const overFeat = extractSideFeatures(
    { ...overPacket, side: "OVER" },
    basePick
  );
  const underFeat = extractSideFeatures(
    { ...underPacket, side: "UNDER" },
    basePick
  );

  const overEval = evaluateSidePass(overFeat, thresholds);
  const underEval = evaluateSidePass(underFeat, thresholds);

  let decision = "NO_BET";
  let reason = "NO_SIDE_PASSES";
  let confidence = "NONE";
  let marketConflict = false;
  let selectedFeatures = null;

  if (overEval.pass && underEval.pass) {
    // Both pass — prefer higher directional edge, then confidence
    const oe = overFeat.directionalEdge ?? -Infinity;
    const ue = underFeat.directionalEdge ?? -Infinity;
    if (
      confidenceRank(overEval.confidence) !== confidenceRank(underEval.confidence)
    ) {
      if (confidenceRank(overEval.confidence) > confidenceRank(underEval.confidence)) {
        decision = "OVER";
        reason = "BOTH_PASS_HIGHER_CONFIDENCE";
        confidence = overEval.confidence;
        marketConflict = overEval.marketConflict;
        selectedFeatures = overFeat;
      } else {
        decision = "UNDER";
        reason = "BOTH_PASS_HIGHER_CONFIDENCE";
        confidence = underEval.confidence;
        selectedFeatures = underFeat;
      }
    } else if (oe >= ue) {
      decision = "OVER";
      reason = "BOTH_PASS_HIGHER_EDGE";
      confidence = overEval.confidence;
      marketConflict = overEval.marketConflict;
      selectedFeatures = overFeat;
    } else {
      decision = "UNDER";
      reason = "BOTH_PASS_HIGHER_EDGE";
      confidence = underEval.confidence;
      selectedFeatures = underFeat;
    }
  } else if (overEval.pass) {
    decision = "OVER";
    reason = overEval.reason;
    confidence = overEval.confidence;
    marketConflict = overEval.marketConflict;
    selectedFeatures = overFeat;
  } else if (underEval.pass) {
    decision = "UNDER";
    reason = underEval.reason;
    confidence = underEval.confidence;
    selectedFeatures = underFeat;
  } else {
    reason =
      overFeat.directionalEdge >= (underFeat.directionalEdge ?? -Infinity)
        ? overEval.reason
        : underEval.reason;
  }

  return {
    decision,
    reason,
    confidence,
    marketConflict,
    officialDirectionEligible: decision === "OVER" || decision === "UNDER",
    over: { features: overFeat, evaluation: overEval },
    under: { features: underFeat, evaluation: underEval },
    selectedFeatures,
    engineVersion: DIRECTION_ENGINE_VERSION,
    freezeId: EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE,
    build: EMPIRICAL_DIRECTION_V1_BUILD,
  };
}

/**
 * Apply frozen thresholds to a historical study row (single labeled side).
 */
export function evaluateHistoricalDirectionRowV1(row = {}, thresholds = DIRECTION_THRESHOLDS_V1) {
  const features = {
    side: row.side,
    line: num(row.line),
    projection: num(row.projection),
    fairLine: num(row.fairLine),
    directionalEdge: num(row.directionalEdge),
    fairDirectionalEdge: num(row.fairDirectionalEdge),
    reliability: num(row.reliability),
    safety: num(row.safety),
    roleStability: num(row.roleStability),
    expectedMinutes: num(row.expectedMinutes ?? row.avgMinutesL5),
    marketQuality: num(row.marketQuality),
    bookCount: num(row.bookCount),
    rawP: num(row.rawP),
  };
  const evaluation = evaluateSidePass(features, thresholds);
  return {
    ...evaluation,
    features,
    freezeId: EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE,
  };
}

export {
  DIRECTION_THRESHOLDS_V1,
  EMPIRICAL_DIRECTION_V1_BUILD,
  EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE,
  DIRECTION_ENGINE_VERSION,
};
