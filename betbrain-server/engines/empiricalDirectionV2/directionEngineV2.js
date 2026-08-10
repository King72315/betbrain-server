/**
 * Empirical Direction Engine V2 — STUDY / SHADOW.
 *
 * Flow:
 *   features → PRIMARY clear-pass?
 *     YES → OVER/UNDER admission=PRIMARY
 *     NO  → near-miss or market-conflict demand?
 *            YES → RESCUE ENGINE (corroboration; missing evidence fails)
 *            NO  → NO BET
 *
 * Does not decide Official (C2). Does not replace V1 production.
 */
import {
  DIRECTION_ENGINE_V2_VERSION,
  DIRECTION_NEAR_MISS_V2,
  DIRECTION_RESCUE_V2,
  DIRECTION_THRESHOLDS_V2_PRIMARY,
  EMPIRICAL_DIRECTION_V2_BUILD,
  EMPIRICAL_DIRECTION_V2_STUDY_ID,
} from "./versions.js";
import {
  directionalEdgeForSide,
  fairDirectionalEdgeForSide,
} from "../empiricalDirectionV1/directionEngineV1.js";

function num(v, f = null) {
  if (v == null || v === "") return f;
  const n = Number(v);
  return Number.isFinite(n) ? n : f;
}

export function isDirectionRescueEnabled(options = {}) {
  if (options.directionRescueEnabled === false) return false;
  if (options.directionRescueEnabled === true) return true;
  const env = process.env[DIRECTION_RESCUE_V2.killSwitchEnv];
  if (env != null && String(env).trim() !== "") {
    return String(env).toLowerCase() !== "false";
  }
  return DIRECTION_RESCUE_V2.enabledDefault === true;
}

export function extractSideFeaturesV2(sidePacket = {}, base = {}) {
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
  const minutesStability = num(
    sidePacket.minutes?.minutesStabilityScore ??
      sidePacket.minutesStability ??
      sidePacket.minutesModel?.minutesStabilityScore
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
  const conflictIndex = num(
    sidePacket.conflict?.conflictIndex ??
      sidePacket.conflictIndex ??
      sidePacket.uncertainty?.conflictIndex
  );
  const majorFailurePathCount = num(
    sidePacket.failure?.majorFailurePathCount ??
      sidePacket.majorFailurePathCount,
    null
  );

  return {
    side: side.startsWith("UNDER")
      ? "UNDER"
      : side.startsWith("OVER")
        ? "OVER"
        : null,
    line,
    projection,
    fairLine,
    directionalEdge: directionalEdgeForSide(side, projection, line),
    fairDirectionalEdge: fairDirectionalEdgeForSide(side, fairLine, line),
    reliability,
    safety,
    roleStability,
    expectedMinutes,
    minutesStability,
    marketQuality,
    bookCount,
    rawP,
    conflictIndex,
    majorFailurePathCount,
  };
}

function detectMarketConflict(features, overCfg) {
  const mc = overCfg.marketConflict;
  if (!mc?.enabled) return false;
  const edge = features.directionalEdge;
  const mq = features.marketQuality;
  const books = features.bookCount;
  return (
    edge != null &&
    edge >= mc.minEdge &&
    mq != null &&
    mq >= mc.marketQualityFloor &&
    (books == null || books >= mc.minBooks)
  );
}

/**
 * Primary clear-pass.
 * Configured floors require present values — missing ≠ automatically safe.
 */
export function evaluatePrimarySideV2(
  features,
  thresholds = DIRECTION_THRESHOLDS_V2_PRIMARY
) {
  const side = features.side;
  const edge = features.directionalEdge;
  const fair = features.fairDirectionalEdge;
  const rel = features.reliability;
  const safety = features.safety;
  const role = features.roleStability;
  const minutes = features.expectedMinutes;
  const noBet = thresholds.noBet;

  const weakEdge = edge == null || edge < noBet.edgeFloor;
  const lowRel = rel != null && rel < noBet.reliabilityFloor;

  if (noBet.mode === "EDGE_OR_REL_MISSING_EDGE") {
    if (weakEdge) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "WEAK_EDGE",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (rel != null && lowRel) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "LOW_RELIABILITY",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
  }

  if (side === "OVER") {
    const o = thresholds.over;
    if (edge == null || edge < o.minEdge) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "OVER_EDGE_BELOW_MIN",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (o.minSafety != null && safety == null) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "OVER_SAFETY_MISSING",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (o.minSafety != null && safety < o.minSafety) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "OVER_SAFETY_BELOW_MIN",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (o.minReliability != null && rel == null) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "OVER_RELIABILITY_MISSING",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (o.minReliability != null && rel < o.minReliability) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "OVER_RELIABILITY_BELOW_MIN",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (o.requireFairConfirm) {
      if (fair == null) {
        return {
          pass: false,
          decision: "NO_BET",
          reason: "OVER_FAIR_MISSING",
          confidence: "NONE",
          admission: null,
          marketConflict: false,
        };
      }
      if (fair < o.minFairEdge) {
        return {
          pass: false,
          decision: "NO_BET",
          reason: "OVER_FAIR_NOT_CONFIRMED",
          confidence: "NONE",
          admission: null,
          marketConflict: false,
        };
      }
    }

    const marketConflict = detectMarketConflict(features, o);
    if (marketConflict && o.marketConflict?.requireRescueCorroboration) {
      // Edge clears primary floor, but market disagreement demands rescue evidence.
      return {
        pass: false,
        decision: "NO_BET",
        reason: "OVER_MARKET_CONFLICT_NEEDS_CORROBORATION",
        confidence: "NONE",
        admission: null,
        marketConflict: true,
        nearMissEligible: true,
        nearMissKind: "MARKET_CONFLICT",
      };
    }

    let confidence = "STANDARD";
    if (
      edge >= o.strongEdge &&
      (rel == null || rel >= (o.strongReliability ?? 0.65))
    ) {
      confidence = "STRONG";
    }
    return {
      pass: true,
      decision: "OVER",
      reason: "OVER_PASS",
      confidence,
      admission: "PRIMARY",
      rescuePathway: null,
      marketConflict: false,
    };
  }

  if (side === "UNDER") {
    const u = thresholds.under;
    if (edge == null || edge < u.minEdge) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "UNDER_EDGE_BELOW_MIN",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    // missing ≠ automatically safe
    if (u.minReliability != null && rel == null) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "UNDER_RELIABILITY_MISSING",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (u.minReliability != null && rel < u.minReliability) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "UNDER_RELIABILITY_BELOW_MIN",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (u.minSafety != null && safety == null) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "UNDER_SAFETY_MISSING",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (u.minSafety != null && safety < u.minSafety) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "UNDER_SAFETY_BELOW_MIN",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (u.minRoleStability != null && role == null) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "UNDER_ROLE_MISSING",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (u.minRoleStability != null && role < u.minRoleStability) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "UNDER_ROLE_BELOW_MIN",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (u.minMinutes != null && minutes == null) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "UNDER_MINUTES_MISSING",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }
    if (u.minMinutes != null && minutes < u.minMinutes) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: "UNDER_MINUTES_BELOW_MIN",
        confidence: "NONE",
        admission: null,
        marketConflict: false,
      };
    }

    let confidence = "STANDARD";
    if (edge >= u.strongEdge) confidence = "STRONG";
    return {
      pass: true,
      decision: "UNDER",
      reason: "UNDER_PASS",
      confidence,
      admission: "PRIMARY",
      rescuePathway: null,
      marketConflict: false,
    };
  }

  return {
    pass: false,
    decision: "NO_BET",
    reason: "UNKNOWN_SIDE",
    confidence: "NONE",
    admission: null,
    marketConflict: false,
  };
}

export function isNearMissV2(features, primaryEval) {
  const side = features.side;
  const edge = features.directionalEdge;
  if (edge == null || !side) return { nearMiss: false };

  if (primaryEval?.nearMissKind === "MARKET_CONFLICT" && side === "OVER") {
    return {
      nearMiss: true,
      kind: "MARKET_CONFLICT",
      reason: primaryEval.reason,
    };
  }

  if (side === "OVER") {
    const band = DIRECTION_NEAR_MISS_V2.over;
    if (
      edge >= band.minEdge &&
      edge < band.maxEdgeExclusive &&
      primaryEval?.reason === "OVER_EDGE_BELOW_MIN"
    ) {
      return { nearMiss: true, kind: "EDGE_BAND", reason: "OVER_NEAR_MISS_EDGE" };
    }
  }

  if (side === "UNDER") {
    const band = DIRECTION_NEAR_MISS_V2.under;
    if (
      edge >= band.minEdge &&
      edge < band.maxEdgeExclusive &&
      (primaryEval?.reason === "UNDER_EDGE_BELOW_MIN" ||
        // Primary edge cleared but structural missing/low — still not a near-miss edge rescue
        false)
    ) {
      return {
        nearMiss: true,
        kind: "EDGE_BAND",
        reason: "UNDER_NEAR_MISS_EDGE",
      };
    }
  }

  return { nearMiss: false };
}

function requirePresent(value, code, failures) {
  if (value == null) {
    failures.push(code);
    return false;
  }
  return true;
}

/**
 * Rescue engine — only for near-miss / market-conflict demand.
 * All key corroboration fields must exist; missing fails rescue.
 */
export function evaluateRescueSideV2(features, primaryEval, options = {}) {
  if (!isDirectionRescueEnabled(options)) {
    return {
      pass: false,
      decision: "NO_BET",
      reason: "RESCUE_DISABLED",
      confidence: "NONE",
      admission: null,
      rescuePathway: null,
    };
  }

  const near = isNearMissV2(features, primaryEval);
  if (!near.nearMiss) {
    return {
      pass: false,
      decision: "NO_BET",
      reason: primaryEval?.reason || "NOT_NEAR_MISS",
      confidence: "NONE",
      admission: null,
      rescuePathway: null,
      nearMiss: false,
    };
  }

  const side = features.side;
  const failures = [];
  // Sensitivity only: some historical rows lack failure-path inventory.
  // Default remains strict (null = missing ≠ zero).
  const failurePathCount =
    features.majorFailurePathCount == null &&
    options.rescueNullFailurePathsAsZero === true
      ? 0
      : features.majorFailurePathCount;
  const featuresForRescue = {
    ...features,
    majorFailurePathCount: failurePathCount,
  };

  if (side === "OVER") {
    const r = DIRECTION_RESCUE_V2.over;
    const pathwayId =
      near.kind === "MARKET_CONFLICT"
        ? r.marketConflictPathwayId
        : r.pathwayId;
    const f = featuresForRescue;

    requirePresent(f.reliability, "RESCUE_RELIABILITY_MISSING", failures);
    requirePresent(f.safety, "RESCUE_SAFETY_MISSING", failures);
    requirePresent(f.fairDirectionalEdge, "RESCUE_FAIR_EDGE_MISSING", failures);
    requirePresent(f.conflictIndex, "RESCUE_CONFLICT_MISSING", failures);
    requirePresent(
      f.majorFailurePathCount,
      "RESCUE_FAILURE_PATHS_MISSING",
      failures
    );
    requirePresent(f.expectedMinutes, "RESCUE_MINUTES_MISSING", failures);
    requirePresent(f.rawP, "RESCUE_RAWP_MISSING", failures);

    if (f.reliability != null && f.reliability < r.minReliability) {
      failures.push("RESCUE_RELIABILITY_BELOW_MIN");
    }
    if (f.safety != null && f.safety < r.minSafety) {
      failures.push("RESCUE_SAFETY_BELOW_MIN");
    }
    if (
      f.fairDirectionalEdge != null &&
      f.fairDirectionalEdge < r.minFairDirectionalEdge
    ) {
      failures.push("RESCUE_FAIR_NOT_CONFIRMING");
    }
    if (f.conflictIndex != null && f.conflictIndex > r.maxConflictIndex) {
      failures.push("RESCUE_CONFLICT_TOO_HIGH");
    }
    if (
      f.majorFailurePathCount != null &&
      f.majorFailurePathCount > r.maxMajorFailurePathCount
    ) {
      failures.push("RESCUE_MAJOR_FAILURE_PATHS");
    }
    if (
      f.expectedMinutes != null &&
      f.expectedMinutes < r.minExpectedMinutes
    ) {
      failures.push("RESCUE_MINUTES_TOO_LOW");
    }
    if (f.rawP != null && f.rawP < r.minRawP) {
      failures.push("RESCUE_RAWP_TOO_LOW");
    }

    if (failures.length) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: failures[0],
        confidence: "NONE",
        admission: null,
        rescuePathway: pathwayId,
        rescueFailures: failures,
        nearMiss: true,
        nearMissKind: near.kind,
      };
    }

    return {
      pass: true,
      decision: "OVER",
      reason: `${pathwayId}_PASS`,
      confidence: "STANDARD",
      admission: "RESCUE",
      rescuePathway: pathwayId,
      rescueFailures: [],
      nearMiss: true,
      nearMissKind: near.kind,
      marketConflict: near.kind === "MARKET_CONFLICT",
    };
  }

  if (side === "UNDER") {
    const r = DIRECTION_RESCUE_V2.under;
    const pathwayId = r.pathwayId;
    const f = featuresForRescue;

    // UNDER rescue is intentionally extreme — every structural signal must exist.
    requirePresent(f.reliability, "RESCUE_RELIABILITY_MISSING", failures);
    requirePresent(f.safety, "RESCUE_SAFETY_MISSING", failures);
    requirePresent(f.roleStability, "RESCUE_ROLE_MISSING", failures);
    requirePresent(f.expectedMinutes, "RESCUE_MINUTES_MISSING", failures);
    requirePresent(f.fairDirectionalEdge, "RESCUE_FAIR_EDGE_MISSING", failures);
    requirePresent(f.conflictIndex, "RESCUE_CONFLICT_MISSING", failures);
    requirePresent(
      f.majorFailurePathCount,
      "RESCUE_FAILURE_PATHS_MISSING",
      failures
    );
    requirePresent(f.rawP, "RESCUE_RAWP_MISSING", failures);

    if (f.reliability != null && f.reliability < r.minReliability) {
      failures.push("RESCUE_RELIABILITY_BELOW_MIN");
    }
    if (f.safety != null && f.safety < r.minSafety) {
      failures.push("RESCUE_SAFETY_BELOW_MIN");
    }
    if (f.roleStability != null && f.roleStability < r.minRoleStability) {
      failures.push("RESCUE_ROLE_BELOW_MIN");
    }
    if (
      f.expectedMinutes != null &&
      f.expectedMinutes < r.minExpectedMinutes
    ) {
      failures.push("RESCUE_MINUTES_TOO_LOW");
    }
    if (
      f.fairDirectionalEdge != null &&
      f.fairDirectionalEdge < r.minFairDirectionalEdge
    ) {
      failures.push("RESCUE_FAIR_NOT_CONFIRMING");
    }
    if (f.conflictIndex != null && f.conflictIndex > r.maxConflictIndex) {
      failures.push("RESCUE_CONFLICT_TOO_HIGH");
    }
    if (
      f.majorFailurePathCount != null &&
      f.majorFailurePathCount > r.maxMajorFailurePathCount
    ) {
      failures.push("RESCUE_MAJOR_FAILURE_PATHS");
    }
    if (f.rawP != null && f.rawP < r.minRawP) {
      failures.push("RESCUE_RAWP_TOO_LOW");
    }

    if (failures.length) {
      return {
        pass: false,
        decision: "NO_BET",
        reason: failures[0],
        confidence: "NONE",
        admission: null,
        rescuePathway: pathwayId,
        rescueFailures: failures,
        nearMiss: true,
        nearMissKind: near.kind,
      };
    }

    return {
      pass: true,
      decision: "UNDER",
      reason: `${pathwayId}_PASS`,
      confidence: "STANDARD",
      admission: "RESCUE",
      rescuePathway: pathwayId,
      rescueFailures: [],
      nearMiss: true,
      nearMissKind: near.kind,
      marketConflict: false,
    };
  }

  return {
    pass: false,
    decision: "NO_BET",
    reason: "UNKNOWN_SIDE",
    confidence: "NONE",
    admission: null,
    rescuePathway: null,
  };
}

/**
 * Full side decision: primary → (near-miss → rescue) → NO BET.
 */
export function evaluateSideDecisionV2(
  features,
  options = {},
  thresholds = DIRECTION_THRESHOLDS_V2_PRIMARY
) {
  const primary = evaluatePrimarySideV2(features, thresholds);
  if (primary.pass) {
    return {
      ...primary,
      stage: "PRIMARY",
      primary,
      rescue: null,
    };
  }

  const rescue = evaluateRescueSideV2(features, primary, options);
  if (rescue.pass) {
    return {
      ...rescue,
      stage: "RESCUE",
      primary,
      rescue,
    };
  }

  return {
    pass: false,
    decision: "NO_BET",
    reason: rescue.nearMiss ? rescue.reason : primary.reason,
    confidence: "NONE",
    admission: null,
    rescuePathway: rescue.rescuePathway || null,
    rescueFailures: rescue.rescueFailures || null,
    nearMiss: Boolean(rescue.nearMiss),
    nearMissKind: rescue.nearMissKind || null,
    marketConflict: Boolean(primary.marketConflict),
    stage: rescue.nearMiss ? "RESCUE_FAIL" : "PRIMARY_FAIL",
    primary,
    rescue,
  };
}

function confidenceRank(c) {
  if (c === "STRONG") return 3;
  if (c === "STANDARD") return 2;
  if (c === "WEAK") return 1;
  return 0;
}

/**
 * Dual-side Direction V2 decision (shadow / study).
 */
export function decideDirectionalSideV2({
  overPacket = {},
  underPacket = {},
  basePick = {},
  options = {},
  thresholds = DIRECTION_THRESHOLDS_V2_PRIMARY,
} = {}) {
  const overFeat = extractSideFeaturesV2(
    { ...overPacket, side: "OVER" },
    basePick
  );
  const underFeat = extractSideFeaturesV2(
    { ...underPacket, side: "UNDER" },
    basePick
  );

  const overEval = evaluateSideDecisionV2(overFeat, options, thresholds);
  const underEval = evaluateSideDecisionV2(underFeat, options, thresholds);

  let decision = "NO_BET";
  let reason = "NO_SIDE_PASSES";
  let confidence = "NONE";
  let admission = null;
  let rescuePathway = null;
  let marketConflict = false;
  let selectedFeatures = null;
  let stage = "NO_BET";

  if (overEval.pass && underEval.pass) {
    if (
      confidenceRank(overEval.confidence) !==
      confidenceRank(underEval.confidence)
    ) {
      if (
        confidenceRank(overEval.confidence) >
        confidenceRank(underEval.confidence)
      ) {
        ({
          decision,
          reason,
          confidence,
          admission,
          rescuePathway,
          marketConflict,
        } = {
          decision: "OVER",
          reason: "BOTH_PASS_HIGHER_CONFIDENCE",
          confidence: overEval.confidence,
          admission: overEval.admission,
          rescuePathway: overEval.rescuePathway,
          marketConflict: overEval.marketConflict,
        });
        selectedFeatures = overFeat;
        stage = overEval.stage;
      } else {
        decision = "UNDER";
        reason = "BOTH_PASS_HIGHER_CONFIDENCE";
        confidence = underEval.confidence;
        admission = underEval.admission;
        rescuePathway = underEval.rescuePathway;
        selectedFeatures = underFeat;
        stage = underEval.stage;
      }
    } else if (
      (overFeat.directionalEdge ?? -Infinity) >=
      (underFeat.directionalEdge ?? -Infinity)
    ) {
      decision = "OVER";
      reason = "BOTH_PASS_HIGHER_EDGE";
      confidence = overEval.confidence;
      admission = overEval.admission;
      rescuePathway = overEval.rescuePathway;
      marketConflict = overEval.marketConflict;
      selectedFeatures = overFeat;
      stage = overEval.stage;
    } else {
      decision = "UNDER";
      reason = "BOTH_PASS_HIGHER_EDGE";
      confidence = underEval.confidence;
      admission = underEval.admission;
      rescuePathway = underEval.rescuePathway;
      selectedFeatures = underFeat;
      stage = underEval.stage;
    }
  } else if (overEval.pass) {
    decision = "OVER";
    reason = overEval.reason;
    confidence = overEval.confidence;
    admission = overEval.admission;
    rescuePathway = overEval.rescuePathway;
    marketConflict = overEval.marketConflict;
    selectedFeatures = overFeat;
    stage = overEval.stage;
  } else if (underEval.pass) {
    decision = "UNDER";
    reason = underEval.reason;
    confidence = underEval.confidence;
    admission = underEval.admission;
    rescuePathway = underEval.rescuePathway;
    selectedFeatures = underFeat;
    stage = underEval.stage;
  } else {
    reason =
      (overFeat.directionalEdge ?? -Infinity) >=
      (underFeat.directionalEdge ?? -Infinity)
        ? overEval.reason
        : underEval.reason;
    stage = "NO_BET";
  }

  return {
    decision,
    reason,
    confidence,
    admission,
    directionAdmission: admission,
    rescuePathway: rescuePathway || null,
    directionRescuePathway: rescuePathway || null,
    marketConflict: Boolean(marketConflict),
    officialDirectionEligible: decision === "OVER" || decision === "UNDER",
    stage,
    over: { features: overFeat, evaluation: overEval },
    under: { features: underFeat, evaluation: underEval },
    selectedFeatures,
    engineVersion: DIRECTION_ENGINE_V2_VERSION,
    studyId: EMPIRICAL_DIRECTION_V2_STUDY_ID,
    build: EMPIRICAL_DIRECTION_V2_BUILD,
    productionAuthority: false,
    note: "STUDY/SHADOW only — V1 remains Official Direction authority",
  };
}

/**
 * Historical labeled-side evaluation (study rows).
 */
export function evaluateHistoricalDirectionRowV2(row = {}, options = {}) {
  const features = {
    side: String(row.side || "").toUpperCase(),
    line: num(row.line),
    projection: num(row.projection),
    fairLine: num(row.fairLine),
    directionalEdge: num(row.directionalEdge ?? row.edge),
    fairDirectionalEdge: num(row.fairDirectionalEdge),
    reliability: num(row.reliability),
    safety: num(row.safety),
    roleStability: num(row.roleStability),
    expectedMinutes: num(row.expectedMinutes ?? row.avgMinutesL5),
    minutesStability: num(row.minutesStability),
    marketQuality: num(row.marketQuality),
    bookCount: num(row.bookCount),
    rawP: num(row.rawP),
    conflictIndex: num(row.conflictIndex),
    majorFailurePathCount: num(row.majorFailurePathCount, null),
  };
  const evaluation = evaluateSideDecisionV2(features, options);
  return {
    ...evaluation,
    features,
    studyId: EMPIRICAL_DIRECTION_V2_STUDY_ID,
    build: EMPIRICAL_DIRECTION_V2_BUILD,
    productionAuthority: false,
  };
}
