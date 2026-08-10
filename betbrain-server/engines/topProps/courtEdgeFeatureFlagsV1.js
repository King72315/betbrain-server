/**
 * CourtEdge feature flags — Empirical Low & Medium Prop Finder V2.
 * Build: courteedge-empirical-low-medium-prop-finder-v2
 *
 * FULL_ROSTER_COLLECTION_MODE stays false unless credit-guard-verified env enables it.
 * EMPIRICAL_SAFE_PROP_V2 defaults ON — production champion EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2.
 * Frozen: no Calibration 3 / no post-activation tuning.
 */
export const FEATURE_FLAGS_BUILD =
  "courteedge-empirical-low-medium-prop-finder-v2";

/** Credit-safe full-roster floodgate. Default OFF until credit path verified. */
export const FULL_ROSTER_COLLECTION_MODE =
  String(process.env.FULL_ROSTER_COLLECTION_MODE || "false").toLowerCase() ===
  "true";

/** Credit guard always on when collection expands. */
export const FULL_ROSTER_CREDIT_GUARD =
  String(process.env.FULL_ROSTER_CREDIT_GUARD || "true").toLowerCase() !==
  "false";

/** Probability/Safety architecture — Official = LOW + qualified MEDIUM only. */
export const PROBABILITY_SAFETY_ARCHITECTURE_V1 =
  String(process.env.PROBABILITY_SAFETY_ARCHITECTURE_V1 || "true").toLowerCase() !==
  "false";

/**
 * Empirical Low/Medium Finder V2 — production champion CALIBRATION_2.
 * Default ON. Set EMPIRICAL_SAFE_PROP_V2=false only for emergency rollback to V1 gates.
 */
export const EMPIRICAL_SAFE_PROP_V2 =
  String(process.env.EMPIRICAL_SAFE_PROP_V2 || "true").toLowerCase() !==
  "false";

export function isEmpiricalSafePropV2Enabled(options = {}) {
  if (options.empiricalSafePropV2 === false) return false;
  if (options.empiricalSafePropV2 === true) return true;
  return EMPIRICAL_SAFE_PROP_V2;
}

export const FEATURE_FLAG_DEFAULTS = Object.freeze({
  FULL_ROSTER_COLLECTION_MODE: false,
  FULL_ROSTER_CREDIT_GUARD: true,
  PROBABILITY_SAFETY_ARCHITECTURE_V1: true,
  EMPIRICAL_SAFE_PROP_V2: true,
  TEAM_PAIR_MODE: false,
  SELECTION_INTEGRITY: true,
  DIRECTIONAL_CALIBRATION: true,
  DATE_VERIFICATION: true,
  MEMBERSHIP_LOCKING: true,
  RESULTS_LIFECYCLE: true,
  HISTORY_LIFECYCLE: true,
  PROVIDER_CACHING: true,
  SCHEDULER_REFRESH: true,
  NO_TOP_TAB: true,
  NO_BEST_SIX: true,
  NO_LAB_TAB: true,
  NO_LAST_VALID_HARD_BLOCK: true,
  CLEAR_SIDE_STRONG_EDGE_MEMBERSHIP: true,
  HIGH_RISK_OFFICIAL_BLOCKED: false,
  HIGH_POLICY: "MINIMUM_2_FILL_ONLY",
  LOW_RISK_FIRST: true,
  NO_FIXED_SIX: true,
  NO_MINIMUM_BOARD_COUNT: false,
  OFFICIAL_BOARD_MIN: 2,
  OFFICIAL_BOARD_MAX: 6,
  NO_SIDE_QUOTA: true,
  NO_TEAM_QUOTA: true,
  LEGACY_BEST_SIX_AUTHORITY: false,
  CLIENT_OFFICIAL_REBUILD: false,
  RESEARCH_PACKET_PERSIST: true,
});

export function getCourtEdgeFeatureFlagSnapshot() {
  return {
    build: FEATURE_FLAGS_BUILD,
    FULL_ROSTER_COLLECTION_MODE,
    FULL_ROSTER_CREDIT_GUARD,
    PROBABILITY_SAFETY_ARCHITECTURE_V1,
    EMPIRICAL_SAFE_PROP_V2,
    defaults: { ...FEATURE_FLAG_DEFAULTS },
    runtime: {
      FULL_ROSTER_COLLECTION_MODE,
      FULL_ROSTER_CREDIT_GUARD,
      PROBABILITY_SAFETY_ARCHITECTURE_V1,
      EMPIRICAL_SAFE_PROP_V2,
      TEAM_PAIR_MODE: FEATURE_FLAG_DEFAULTS.TEAM_PAIR_MODE,
      SELECTION_INTEGRITY: FEATURE_FLAG_DEFAULTS.SELECTION_INTEGRITY,
      DIRECTIONAL_CALIBRATION: FEATURE_FLAG_DEFAULTS.DIRECTIONAL_CALIBRATION,
      DATE_VERIFICATION: FEATURE_FLAG_DEFAULTS.DATE_VERIFICATION,
      MEMBERSHIP_LOCKING: FEATURE_FLAG_DEFAULTS.MEMBERSHIP_LOCKING,
      RESULTS_LIFECYCLE: FEATURE_FLAG_DEFAULTS.RESULTS_LIFECYCLE,
      HISTORY_LIFECYCLE: FEATURE_FLAG_DEFAULTS.HISTORY_LIFECYCLE,
      PROVIDER_CACHING: FEATURE_FLAG_DEFAULTS.PROVIDER_CACHING,
      RESEARCH_PACKET_PERSIST: FEATURE_FLAG_DEFAULTS.RESEARCH_PACKET_PERSIST,
      SCHEDULER_REFRESH:
        String(process.env.COURTEDGE_SCHEDULER_ENABLED || "true").toLowerCase() !==
        "false",
    },
  };
}
