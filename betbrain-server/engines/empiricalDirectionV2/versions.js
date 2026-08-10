/**
 * Empirical Direction V2 — STUDY / SHADOW only.
 * Does not replace EMPIRICAL_DIRECTION_V1_PRODUCTION_1.
 *
 * Primary gates stay O2.5 / U4.
 * Rescue is a separate admission class with its own kill-switch.
 */
export const EMPIRICAL_DIRECTION_V2_BUILD =
  "courteedge-empirical-direction-v2-rescue-study-1";

export const EMPIRICAL_DIRECTION_V2_STUDY_ID =
  "EMPIRICAL_DIRECTION_V2_RESCUE_STUDY_1";

export const DIRECTION_ENGINE_V2_VERSION =
  "empirical-direction-engine-v2-rescue-study-1";

/** Kill-switch: study/shadow may enable; production Official must not use V2 yet. */
export const DIRECTION_V2_RESCUE_ENABLED_DEFAULT = true;

/**
 * Primary thresholds — identical edge floors to V1 PRODUCTION_1.
 * Difference: configured floors require present evidence (missing ≠ clear-pass).
 */
export const DIRECTION_THRESHOLDS_V2_PRIMARY = Object.freeze({
  freezeId: EMPIRICAL_DIRECTION_V2_STUDY_ID,
  inheritsPrimaryFrom: "EMPIRICAL_DIRECTION_V1_PRODUCTION_1",
  noBet: Object.freeze({
    mode: "EDGE_OR_REL_MISSING_EDGE",
    edgeFloor: 1.0,
    reliabilityFloor: 0.45,
  }),
  over: Object.freeze({
    minEdge: 2.5,
    strongEdge: 3.5,
    minFairEdge: 2.0,
    // Primary clear-pass still does not hard-require fair confirm.
    // Market conflict demotes clear-pass into corroboration demand (see rescue).
    requireFairConfirm: false,
    minReliability: null,
    strongReliability: 0.7,
    minSafety: 65,
    // missingSafetyBlocksClearPass: true (engine default when minSafety set)
    marketConflict: Object.freeze({
      enabled: true,
      minEdge: 2.0,
      marketQualityFloor: 85,
      minBooks: 4,
      // V2: conflict does NOT soft-pass; it routes to rescue demand.
      softPass: false,
      requireRescueCorroboration: true,
    }),
  }),
  under: Object.freeze({
    minEdge: 4.0,
    strongEdge: 4.0,
    minReliability: 0.45,
    minSafety: 65,
    minRoleStability: 60,
    minMinutes: 20,
  }),
});

/**
 * Near-miss bands — only these failed-primary edges may enter rescue.
 * Deep failures (e.g. edge 0.3) never reach rescue.
 */
export const DIRECTION_NEAR_MISS_V2 = Object.freeze({
  over: Object.freeze({
    // Primary min 2.5; near-miss floor keeps floodgates closed.
    minEdge: 1.75,
    maxEdgeExclusive: 2.5,
  }),
  under: Object.freeze({
    // Primary min 4.0; 2.5–4.0 is the dangerous band (~30.8% historically).
    minEdge: 2.5,
    maxEdgeExclusive: 4.0,
  }),
});

/**
 * Rescue corroboration — evidence must EXIST (null fails rescue).
 * Stricter than primary; designed to ask:
 * "Does this near-miss profile look materially different from losing near-misses?"
 */
export const DIRECTION_RESCUE_V2 = Object.freeze({
  enabledDefault: DIRECTION_V2_RESCUE_ENABLED_DEFAULT,
  killSwitchEnv: "DIRECTION_V2_RESCUE_ENABLED",
  over: Object.freeze({
    pathwayId: "OVER_EDGE_RESCUE",
    marketConflictPathwayId: "OVER_MARKET_CONFLICT_RESCUE",
    minReliability: 0.7,
    minSafety: 70,
    minFairDirectionalEdge: 1.5,
    maxConflictIndex: 20,
    maxMajorFailurePathCount: 0,
    minExpectedMinutes: 22,
    minRawP: 0.62,
  }),
  under: Object.freeze({
    pathwayId: "UNDER_STRUCTURAL_RESCUE",
    minReliability: 0.7,
    minSafety: 70,
    minRoleStability: 70,
    minExpectedMinutes: 24,
    minFairDirectionalEdge: 1.5,
    maxConflictIndex: 15,
    maxMajorFailurePathCount: 0,
    minRawP: 0.6,
  }),
});
