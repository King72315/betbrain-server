/**
 * Empirical Low & Medium Prop Finder V2 — frozen production versions.
 * Build: courteedge-empirical-low-medium-prop-finder-v2
 *
 * Freeze tag: EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2
 *
 * PRODUCTION CHAMPION — FROZEN.
 * Do not retune (no Calibration 3) without an explicit new freeze.
 * Locked: reliability coefficients, trust formula, LOW/MEDIUM logic,
 * pathways, conflict/missingness/market treatment.
 * One-slate outcomes must not trigger retuning.
 */
export const EMPIRICAL_SAFE_PROP_V2_BUILD =
  "courteedge-empirical-low-medium-prop-finder-v2";

export const EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE =
  "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2";

export const RELIABILITY_MODEL_VERSION =
  "reliability-lab-logistic-v2-calibration-2";
export const PATHWAY_MODEL_VERSION = "safe-pathway-engine-v2-calibration-2";
export const TRUST_SCORE_VERSION = "trust-score-v2-calibration-2";
export const SLATE_RELATIVE_STRENGTH_VERSION = "slate-relative-strength-v1";
export const MEMBERSHIP_VERSION_V2 =
  "official-membership-empirical-low-medium-finder-v2-calibration-2";
export const RESEARCH_PACKET_PERSIST_VERSION = "research-packet-persist-v2";

/** Integrity-only hard vetoes (not predictive soft gates). */
export const INTEGRITY_HARD_VETOES = Object.freeze([
  "WRONG_DATE",
  "WRONG_EVENT",
  "WRONG_PLAYER",
  "PLAYER_IDENTITY_MISMATCH",
  "INVALID_MARKET",
  "MARKET_IDENTITY_INVALID",
  "STALE_LINE_IDENTITY",
  "STALE_MARKET_IDENTITY",
  "NO_VALID_LINE",
  "CONFIRMED_INACTIVE",
  "POST_START_MUTATION",
  "CORRUPT_PROVIDER_DATA",
  "DATE_VERIFICATION_INCOMPLETE",
  "SEVERE_DATA_INCOMPLETENESS",
]);

/**
 * Severe predictive danger vetoes — real conditions only, not weak scores.
 */
export const SEVERE_PREDICTIVE_VETOES = Object.freeze([
  "CONFIRMED_MINUTES_RESTRICTION",
  "MAJOR_ROLE_TRANSITION_UNRESOLVED",
  "CRITICAL_TEAMMATE_STATUS_UNRESOLVED",
  "SEVERE_PROJECTION_FAIR_CONTRADICTION",
  "EXTREME_DISTRIBUTION_VOLATILITY",
]);

/**
 * Frozen logistic coefficients from chronological training on historical
 * model-ready sample (see empirical-safe-prop-v2 model study).
 * Z-scored features. Missing → skip (never impute 0).
 */
export const RELIABILITY_LOGISTIC_V2 = Object.freeze({
  version: RELIABILITY_MODEL_VERSION,
  intercept: 1.15,
  means: {
    rawWinProbability: 0.78,
    SafetyScore: 74,
    projectionEdge: 3.2,
    minutesStability: 92,
    roleStability: 72,
    marketQuality: 58,
    conflictIndex: 12,
    bookCount: 2.2,
  },
  sds: {
    rawWinProbability: 0.12,
    SafetyScore: 10,
    projectionEdge: 2.4,
    minutesStability: 12,
    roleStability: 8,
    marketQuality: 22,
    conflictIndex: 14,
    bookCount: 1.5,
  },
  weights: {
    rawWinProbability: 0.55,
    SafetyScore: 0.35,
    projectionEdge: 0.95,
    minutesStability: 0.45,
    roleStability: 0.25,
    // marketQuality soft — thin WNBA books not punished hard
    marketQuality: -0.15,
    conflictIndex: -0.35,
    bookCount: 0.05,
  },
});

/**
 * TrustScore contribution weights (sum of positive base ≈ 1.0 before penalties).
 * Tuned so reliability dominates; Safety + pathway + rawP support; soft uncertainty penalizes.
 */
export const TRUST_SCORE_WEIGHTS_V2 = Object.freeze({
  reliability: 0.4,
  rawWinProbability: 0.2,
  SafetyScore: 0.15,
  pathwayStrength: 0.15,
  projectionEdgeSupport: 0.1,
});

/**
 * Empirical risk thresholds — CALIBRATION_2.
 * Stage 1 (recognition): MEDIUM floors — serious consideration.
 * Stage 2 (selective LOW): stricter — safest profiles only.
 * Tuned after rejected-pool recovery (~126 graded rejects).
 */
export const RISK_THRESHOLDS_V2 = Object.freeze({
  // Stage 1 — candidate recognition (MEDIUM)
  mediumReliability: 0.68,
  mediumRawProbabilityFloor: 0.55,
  mediumEdgeFloor: 1.5,
  mediumMinutesFloor: 55,
  maxConflictForMedium: 40,
  maxMajorFailsForMedium: 2,
  mediumTrustFloor: 58,

  // Stage 2 — selective LOW (highest-confidence band)
  lowReliability: 0.84,
  exceptionalReliability: 0.9,
  lowRawProbabilityFloor: 0.62,
  lowEdgeFloor: 3.0,
  lowMinutesFloor: 75,
  maxConflictForLow: 15,
  maxMajorFailsForLow: 0,
  lowTrustFloor: 80,
  exceptionalTrustFloor: 88,
  lowSafetyFloor: 70,
  lowMaxMissingReliabilityFeatures: 2,
  /** LOW requires a named LOW pathway unless exceptional reliability+trust. */
  lowRequiresPathwayOrExceptional: true,
});

export const SAFE_PATHWAY_IDS = Object.freeze([
  "STABLE_HIGH_EDGE",
  "STRUCTURAL_UNDER",
  "STABLE_VOLUME_OVER",
  "THIN_MARKET_STRONG_EDGE",
  "GENERAL_HIGH_RELIABILITY",
  "NONE",
]);
