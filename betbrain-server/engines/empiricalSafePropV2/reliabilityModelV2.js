/**
 * courtEdgeEmpiricalReliabilityEngineV2 + risk classification.
 * Build: courteedge-empirical-low-medium-prop-finder-v2
 *
 * Reliability logistic + empirical OR pathways + TrustScore.
 * Giant AND-gate is not membership authority.
 */
import {
  EMPIRICAL_SAFE_PROP_V2_BUILD,
  EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
  INTEGRITY_HARD_VETOES,
  MEMBERSHIP_VERSION_V2,
  RELIABILITY_LOGISTIC_V2,
  RELIABILITY_MODEL_VERSION,
  RISK_THRESHOLDS_V2,
  SEVERE_PREDICTIVE_VETOES,
} from "./versions.js";
import { evaluateSafePropPathwaysV2 } from "./safePathwayEngineV2.js";
import { computeTrustScoreV2 } from "./trustScoreV2.js";
import { buildEmpiricalRiskExplanationV2 } from "./explanationsV2.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function sigmoid(z) {
  const x = clamp(z, -20, 20);
  return 1 / (1 + Math.exp(-x));
}

/**
 * Compute reliabilityProbability ∈ (0,1):
 * P(CourtEdge selected side historically correct | pregame evidence).
 */
export function computeReliabilityProbabilityV2(features = {}) {
  const cfg = RELIABILITY_LOGISTIC_V2;
  const keys = Object.keys(cfg.weights);
  let z = cfg.intercept;
  const used = {};
  const missing = [];
  const positive = [];
  const negative = [];
  for (const k of keys) {
    const raw = num(features[k]);
    if (raw == null) {
      missing.push(k);
      continue; // missing → skip feature (do NOT impute 0)
    }
    const mean = cfg.means[k] ?? 0;
    const sd = cfg.sds[k] || 1;
    const zed = (raw - mean) / sd;
    const contrib = zed * cfg.weights[k];
    z += contrib;
    used[k] = { raw, zed, weight: cfg.weights[k], contribution: contrib };
    if (contrib > 0.05) positive.push({ feature: k, contribution: contrib, raw });
    if (contrib < -0.05) negative.push({ feature: k, contribution: contrib, raw });
  }
  const reliabilityProbability = sigmoid(z);
  let reliabilityBand = "WEAK";
  if (reliabilityProbability >= RISK_THRESHOLDS_V2.exceptionalReliability) {
    reliabilityBand = "EXCEPTIONAL";
  } else if (reliabilityProbability >= RISK_THRESHOLDS_V2.lowReliability) {
    reliabilityBand = "STRONG";
  } else if (reliabilityProbability >= RISK_THRESHOLDS_V2.mediumReliability) {
    reliabilityBand = "MODERATE";
  }

  return {
    version: RELIABILITY_MODEL_VERSION,
    reliabilityProbability: Number(reliabilityProbability.toFixed(4)),
    reliabilityBand,
    logit: Number(z.toFixed(4)),
    reliabilityInputs: used,
    featuresUsed: used,
    featuresMissing: missing,
    missingReliabilityInputs: missing,
    missingFeatureCount: missing.length,
    positiveReliabilityDrivers: positive.sort(
      (a, b) => b.contribution - a.contribution
    ),
    negativeReliabilityDrivers: negative.sort(
      (a, b) => a.contribution - b.contribution
    ),
  };
}

/** Back-compat. */
export function classifySafePathwaysV2(ctx = {}) {
  return evaluateSafePropPathwaysV2(ctx);
}

export function collectIntegrityVetoesV2(pick = {}, ctx = {}) {
  const vetoes = [];
  if (pick.integrityWrongDate || pick.wrongDate) vetoes.push("WRONG_DATE");
  if (pick.integrityWrongEvent || pick.wrongEvent) vetoes.push("WRONG_EVENT");
  if (pick.integrityWrongPlayer || pick.wrongPlayer || pick.playerIdentityMismatch) {
    vetoes.push("PLAYER_IDENTITY_MISMATCH");
  }
  if (pick.invalidMarket || pick.corruptMarket || pick.marketIdentityInvalid) {
    vetoes.push("MARKET_IDENTITY_INVALID");
  }
  if (pick.staleLineIdentity || pick.staleMarketIdentity) {
    vetoes.push("STALE_MARKET_IDENTITY");
  }
  if (pick.postStartMutation) vetoes.push("POST_START_MUTATION");
  if (pick.corruptProviderData) vetoes.push("CORRUPT_PROVIDER_DATA");
  if (pick.dateVerificationIncomplete || pick.dateVerificationStatus === "FAIL") {
    vetoes.push("DATE_VERIFICATION_INCOMPLETE");
  }

  const avail = String(
    pick.availabilityStatus || pick.availability || pick.injuryStatus || ""
  ).toUpperCase();
  if (/OUT|INACTIVE|SUSP/.test(avail)) vetoes.push("CONFIRMED_INACTIVE");

  if (num(pick.line ?? pick.selectedLine) == null) vetoes.push("NO_VALID_LINE");
  if (
    num(pick.projection ?? pick.projectedPoints ?? pick.finalProjection) == null
  ) {
    vetoes.push("SEVERE_DATA_INCOMPLETENESS");
  }

  if (
    (ctx.majorFailurePathCount ?? 0) >= 4 &&
    (ctx.conflictIndex ?? 0) >= 80
  ) {
    vetoes.push("SEVERE_DATA_INCOMPLETENESS");
  }

  return [...new Set(vetoes)].filter((v) => INTEGRITY_HARD_VETOES.includes(v));
}

export function collectSeverePredictiveVetoesV2(pick = {}, ctx = {}) {
  const vetoes = [];
  if (pick.confirmedMinutesRestriction || pick.minutesRestriction === true) {
    vetoes.push("CONFIRMED_MINUTES_RESTRICTION");
  }
  if (pick.majorRoleTransitionUnresolved || pick.roleTransitionUnresolved) {
    vetoes.push("MAJOR_ROLE_TRANSITION_UNRESOLVED");
  }
  if (pick.criticalTeammateStatusUnresolved) {
    vetoes.push("CRITICAL_TEAMMATE_STATUS_UNRESOLVED");
  }
  const edge = num(ctx.projectionEdge);
  const fairEdge = num(ctx.fairEdge);
  if (
    edge != null &&
    fairEdge != null &&
    Math.sign(edge) !== 0 &&
    Math.sign(fairEdge) !== 0 &&
    Math.sign(edge) !== Math.sign(fairEdge) &&
    Math.abs(edge) >= 3 &&
    Math.abs(fairEdge) >= 2.5
  ) {
    vetoes.push("SEVERE_PROJECTION_FAIR_CONTRADICTION");
  }
  const vol = num(ctx.distributionVolatility ?? pick.distributionVolatility);
  if (vol != null && vol >= 90) {
    vetoes.push("EXTREME_DISTRIBUTION_VOLATILITY");
  }
  // Extreme conflict + many major failure paths = predictive danger
  if ((ctx.conflictIndex ?? 0) >= 70 && (ctx.majorFailurePathCount ?? 0) >= 3) {
    vetoes.push("EXTREME_DISTRIBUTION_VOLATILITY");
  }
  return vetoes.filter((v) => SEVERE_PREDICTIVE_VETOES.includes(v));
}

function reliabilityBandLabel(rel) {
  if (rel == null) return "UNKNOWN";
  if (rel >= RISK_THRESHOLDS_V2.exceptionalReliability) return "EXCEPTIONAL";
  if (rel >= RISK_THRESHOLDS_V2.lowReliability) return "STRONG";
  if (rel >= RISK_THRESHOLDS_V2.mediumReliability) return "MODERATE";
  return "WEAK";
}

/**
 * V2 risk classification — reliability + pathways + trust.
 * Market quality / book count / role alone cannot force HIGH.
 */
export function classifyRiskEmpiricalV2(ctx = {}) {
  const {
    pick = {},
    rawWinProbability = null,
    safety = {},
    minutes = {},
    role = {},
    market = {},
    conflict = {},
    failure = {},
    availability = {},
    volume = {},
    distribution = {},
  } = ctx;

  const side = String(pick.side || pick.pick || "").toUpperCase();
  const line = num(pick.line ?? pick.selectedLine);
  const projection =
    num(pick.projection) ??
    num(pick.projectedPoints) ??
    num(pick.finalProjection);
  const fairLine = num(pick.fairLine) ?? num(pick.fair_line);
  const projectionEdge =
    side.startsWith("OVER") && line != null && projection != null
      ? projection - line
      : side.startsWith("UNDER") && line != null && projection != null
        ? line - projection
        : null;
  const fairEdge =
    side.startsWith("OVER") && line != null && fairLine != null
      ? fairLine - line
      : side.startsWith("UNDER") && line != null && fairLine != null
        ? line - fairLine
        : null;

  const SafetyScore = num(safety.finalSafetyScore ?? safety.SafetyScore);
  const minutesStability = num(minutes.minutesStabilityScore);
  const expectedMinutes = num(minutes.expectedMinutes);
  const roleStability =
    role.missingness?.starterStatus === true && role.roleStabilityScore == null
      ? null
      : num(role.roleStabilityScore);
  const marketQuality = num(market.marketQualityScore);
  const bookCount = num(market.bookCount);
  const conflictIndex = num(conflict.conflictIndex);
  const majorFailurePathCount = num(failure.majorFailurePathCount, 0);
  const availScore = num(availability.availabilityCertaintyScore);
  const volumeStability = num(
    volume.volumeStabilityScore ?? volume.fgaStabilityScore
  );

  const reliability = computeReliabilityProbabilityV2({
    rawWinProbability: num(rawWinProbability),
    SafetyScore,
    projectionEdge,
    minutesStability,
    roleStability,
    marketQuality,
    conflictIndex,
    bookCount,
  });

  const pathway = evaluateSafePropPathwaysV2({
    rawWinProbability: num(rawWinProbability),
    SafetyScore,
    projectionEdge,
    minutesStability,
    roleStability,
    marketQuality,
    bookCount,
    conflictIndex,
    side,
    reliabilityProbability: reliability.reliabilityProbability,
    majorFailurePathCount,
    volumeStability,
    usageStability: num(volume.usageStabilityScore),
  });

  const integrityVetoes = collectIntegrityVetoesV2(pick, {
    majorFailurePathCount,
    conflictIndex,
  });
  const severePredictiveVetoes = collectSeverePredictiveVetoesV2(pick, {
    projectionEdge,
    fairEdge,
    conflictIndex,
    majorFailurePathCount,
    distributionVolatility: num(distribution.volatilityScore),
  });

  const thr = RISK_THRESHOLDS_V2;
  const p = num(rawWinProbability);
  const rel = reliability.reliabilityProbability;

  const primaryPw = pathway.primaryPathway;
  const trust = computeTrustScoreV2({
    reliabilityProbability: rel,
    rawWinProbability: p,
    SafetyScore,
    projectionEdge,
    conflictIndex,
    majorFailurePathCount,
    bookCount,
    marketQuality,
    minutesStability,
    roleStability,
    safePathway: primaryPw?.safePathway || "NONE",
    pathwayScore: primaryPw?.pathwayScore || 0,
  });

  let risk = "HIGH";
  let officialEligible = false;
  let safePathway = "NONE";
  let pathwayScore = 0;
  let pathwayEvidence = [];
  let pathwayWarnings = [];
  const reasons = [];
  const whyNotLow = [];

  if (integrityVetoes.length) {
    risk = "HIGH";
    officialEligible = false;
    reasons.push(...integrityVetoes.map((v) => `integrity:${v}`));
  } else if (severePredictiveVetoes.length) {
    risk = "HIGH";
    officialEligible = false;
    reasons.push(...severePredictiveVetoes.map((v) => `severe:${v}`));
  } else {
    const lowPathway = pathway.lowPathwayHits[0] || null;
    const medPathway = pathway.mediumPathwayHits[0] || null;

    // Missing minutes ≠ unstable minutes (unknown is not a hard fail).
    const minutesOkLow =
      minutesStability == null || minutesStability >= thr.lowMinutesFloor;
    const minutesOkMed =
      minutesStability == null || minutesStability >= thr.mediumMinutesFloor;
    const conflictOkLow =
      conflictIndex == null || conflictIndex <= thr.maxConflictForLow;
    const conflictOkMed =
      conflictIndex == null || conflictIndex <= thr.maxConflictForMedium;
    const failsOkLow = majorFailurePathCount <= thr.maxMajorFailsForLow;
    const failsOkMed = majorFailurePathCount <= thr.maxMajorFailsForMedium;
    const trustOkLow = trust.trustScore >= thr.lowTrustFloor;
    const trustOkMed = trust.trustScore >= thr.mediumTrustFloor;

    // ── Stage 1: recognition (MEDIUM+) ─────────────────────────────────
    // "This deserves serious consideration" — not yet LOW.
    const medByReliability =
      rel >= thr.mediumReliability &&
      p != null &&
      p >= thr.mediumRawProbabilityFloor &&
      minutesOkMed &&
      conflictOkMed &&
      failsOkMed &&
      trustOkMed;

    const medByPathway =
      (medPathway || lowPathway) &&
      p != null &&
      p >= thr.mediumRawProbabilityFloor &&
      minutesOkMed &&
      conflictOkMed &&
      failsOkMed &&
      trustOkMed &&
      rel >= thr.mediumReliability * 0.95 &&
      (projectionEdge == null || projectionEdge >= thr.mediumEdgeFloor);

    const recognized = medByReliability || medByPathway;

    // ── Stage 2: selective LOW (among recognized only) ─────────────────
    // Highest-confidence band — not the same as "rescued from V1 HIGH".
    const missingOk =
      (reliability.missingFeatureCount ?? 0) <=
      (thr.lowMaxMissingReliabilityFeatures ?? 2);
    const safetyOkLow =
      SafetyScore == null || SafetyScore >= (thr.lowSafetyFloor ?? 70);
    const edgeOkLow =
      projectionEdge == null || projectionEdge >= thr.lowEdgeFloor * 0.85;

    const lowCore =
      recognized &&
      p != null &&
      p >= thr.lowRawProbabilityFloor &&
      minutesOkLow &&
      conflictOkLow &&
      failsOkLow &&
      trustOkLow &&
      missingOk &&
      safetyOkLow &&
      edgeOkLow;

    const lowByPathway =
      lowCore &&
      !!lowPathway &&
      rel >= thr.mediumReliability &&
      (projectionEdge == null || projectionEdge >= 2.5);

    const lowByReliability =
      lowCore &&
      rel >= thr.lowReliability &&
      (!thr.lowRequiresPathwayOrExceptional || !!lowPathway) &&
      SafetyScore != null &&
      SafetyScore >= (thr.lowSafetyFloor ?? 70);

    const lowByExceptional =
      lowCore &&
      rel >= thr.exceptionalReliability &&
      trust.trustScore >= thr.exceptionalTrustFloor &&
      (SafetyScore == null || SafetyScore >= (thr.lowSafetyFloor ?? 70) * 0.9);

    // Edge alone / Safety alone / rawP alone cannot create LOW
    const notEdgeOnly =
      SafetyScore != null ||
      minutesStability != null ||
      rel >= thr.mediumReliability;
    const notSafetyOnly = projectionEdge != null || p != null;
    const notRawPOnly =
      (SafetyScore != null || minutesStability != null) && rel != null;

    const selectiveLow =
      (lowByReliability || lowByPathway || lowByExceptional) &&
      notEdgeOnly &&
      notSafetyOnly &&
      notRawPOnly;

    if (selectiveLow) {
      risk = "LOW";
      officialEligible = true;
      const pw = lowPathway || primaryPw;
      safePathway = pw?.id || pw?.safePathway || "GENERAL_HIGH_RELIABILITY";
      pathwayScore = pw?.pathwayScore || Math.round(rel * 100);
      pathwayEvidence = pw?.pathwayEvidence || [];
      pathwayWarnings = pw?.pathwayWarnings || [];
    } else if (recognized) {
      risk = "MEDIUM";
      officialEligible = true;
      const pw = medPathway || lowPathway || primaryPw;
      safePathway = pw?.id || pw?.safePathway || "GENERAL_HIGH_RELIABILITY";
      pathwayScore = pw?.pathwayScore || Math.round(rel * 100);
      pathwayEvidence = pw?.pathwayEvidence || [];
      pathwayWarnings = pw?.pathwayWarnings || [];
      if (rel < thr.lowReliability) {
        whyNotLow.push(
          `Reliability ${(rel * 100).toFixed(0)}% below selective LOW (${Math.round(thr.lowReliability * 100)}%)`
        );
      }
      if (!trustOkLow) {
        whyNotLow.push(
          `TrustScore ${trust.trustScore} below LOW floor ${thr.lowTrustFloor}`
        );
      }
      if (!minutesOkLow && minutesStability != null) {
        whyNotLow.push(`Minutes stability ${minutesStability} below LOW floor`);
      }
      if (!conflictOkLow) {
        whyNotLow.push(`Conflict ${conflictIndex} above LOW cap`);
      }
      if (!failsOkLow) whyNotLow.push("Failure paths disqualify selective LOW");
      if (!missingOk) {
        whyNotLow.push("Too many missing reliability inputs for LOW");
      }
      if (!safetyOkLow && SafetyScore != null) {
        whyNotLow.push(
          `SafetyScore ${SafetyScore} below LOW floor ${thr.lowSafetyFloor}`
        );
      }
      if (!edgeOkLow && projectionEdge != null) {
        whyNotLow.push(`Edge ${projectionEdge.toFixed?.(1) ?? projectionEdge} below LOW floor`);
      }
      if (thr.lowRequiresPathwayOrExceptional && !lowPathway && !lowByExceptional) {
        whyNotLow.push("No LOW-tier pathway (recognition ≠ LOW)");
      }
    } else {
      risk = "HIGH";
      officialEligible = false;
      if (rel != null && rel < thr.mediumReliability) {
        reasons.push("reliability_below_medium");
      }
      if (p != null && p < thr.mediumRawProbabilityFloor) {
        reasons.push("raw_probability_below_medium_floor");
      }
      if (!minutesOkMed) reasons.push("minutes_stability_below_medium");
      if (!conflictOkMed) reasons.push("conflict_above_medium");
      if (!failsOkMed) reasons.push("failure_paths_above_medium");
      if (!trustOkMed) reasons.push("trust_below_medium");
      if (!medPathway && !lowPathway) reasons.push("no_safe_pathway");
    }
  }

  // Soft diagnostics (never sole HIGH force)
  const softFlags = [];
  if (market.missingness?.bookCount) softFlags.push("market_books_unknown");
  else if (bookCount != null && bookCount < 2) softFlags.push("thin_book_soft");
  if (role.missingness?.starterStatus) softFlags.push("role_starter_unknown");
  if (availScore != null && availScore < 50) softFlags.push("availability_uncertain_soft");

  const result = {
    risk,
    officialEligible,
    researchEligible: true,
    wouldPassLowGate: risk === "LOW",
    wouldPassMediumGate: risk === "MEDIUM",
    wouldBeHighRisk: risk === "HIGH",
    safePathway,
    pathwayMatched: safePathway !== "NONE",
    pathwayScore,
    pathwayEvidence,
    pathwayWarnings,
    pathways: pathway.pathways,
    primaryPathway: pathway.primaryPathway,
    reliability,
    reliabilityProbability: reliability.reliabilityProbability,
    reliabilityBand: reliability.reliabilityBand || reliabilityBandLabel(rel),
    reliabilityInputs: reliability.reliabilityInputs,
    positiveReliabilityDrivers: reliability.positiveReliabilityDrivers,
    negativeReliabilityDrivers: reliability.negativeReliabilityDrivers,
    missingReliabilityInputs: reliability.missingReliabilityInputs,
    trust,
    trustScore: trust.trustScore,
    trustComponents: trust.trustComponents,
    trustBonuses: trust.trustBonuses,
    trustPenalties: trust.trustPenalties,
    projectionEdge,
    fairEdge,
    SafetyScore,
    minutesStability,
    expectedMinutes,
    roleStability,
    marketQuality,
    bookCount,
    conflictIndex,
    majorFailurePathCount,
    integrityVetoes,
    severePredictiveVetoes,
    softFlags,
    whyNotLow,
    officialRejectionReasons: risk === "HIGH" ? reasons : [],
    failedLowReasons: risk !== "LOW" ? [...reasons, ...whyNotLow] : [],
    failedMediumReasons: risk === "HIGH" ? reasons : [],
    hardBlocks: integrityVetoes,
    marketQualityAloneCannotForceHigh: true,
    bookCountAloneCannotForceHigh: true,
    roleBelow75AloneCannotForceHigh: true,
    architectureBuild: EMPIRICAL_SAFE_PROP_V2_BUILD,
    productionFreeze: EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
    membershipVersion: MEMBERSHIP_VERSION_V2,
  };

  result.explanation = buildEmpiricalRiskExplanationV2(
    {
      trueRisk: risk,
      reliabilityProbability: rel,
      trustScore: trust.trustScore,
      safetyScore: SafetyScore,
      projectionEdge,
      minutesStabilityScore: minutesStability,
      expectedMinutes,
      roleStabilityScore: roleStability,
      conflictIndex,
      safePathway,
      bookCount,
      failurePaths: failure.failurePaths,
      softFlags,
      whyNotLow,
    },
    result
  );

  return result;
}
