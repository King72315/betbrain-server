/**
 * CourtEdge feature flags — pre–full-roster checkpoint baseline.
 * Build: courteedge-pre-full-roster-experiment-v1
 *
 * FULL_ROSTER_COLLECTION_MODE must remain false until the experiment is
 * explicitly activated on a future unsealed slate.
 */
export const FEATURE_FLAGS_BUILD =
  "courteedge-aug5-membership-quarantine-final-v3-checkpoint-v1";

/** Credit-safe full-roster floodgate. Default OFF. */
export const FULL_ROSTER_COLLECTION_MODE =
  String(process.env.FULL_ROSTER_COLLECTION_MODE || "false").toLowerCase() ===
  "true";

export const FEATURE_FLAG_DEFAULTS = Object.freeze({
  FULL_ROSTER_COLLECTION_MODE: false,
  TEAM_PAIR_MODE: true,
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
});

export function getCourtEdgeFeatureFlagSnapshot() {
  return {
    build: FEATURE_FLAGS_BUILD,
    FULL_ROSTER_COLLECTION_MODE,
    defaults: { ...FEATURE_FLAG_DEFAULTS },
    runtime: {
      FULL_ROSTER_COLLECTION_MODE,
      TEAM_PAIR_MODE: FEATURE_FLAG_DEFAULTS.TEAM_PAIR_MODE,
      SELECTION_INTEGRITY: FEATURE_FLAG_DEFAULTS.SELECTION_INTEGRITY,
      DIRECTIONAL_CALIBRATION: FEATURE_FLAG_DEFAULTS.DIRECTIONAL_CALIBRATION,
      DATE_VERIFICATION: FEATURE_FLAG_DEFAULTS.DATE_VERIFICATION,
      MEMBERSHIP_LOCKING: FEATURE_FLAG_DEFAULTS.MEMBERSHIP_LOCKING,
      RESULTS_LIFECYCLE: FEATURE_FLAG_DEFAULTS.RESULTS_LIFECYCLE,
      HISTORY_LIFECYCLE: FEATURE_FLAG_DEFAULTS.HISTORY_LIFECYCLE,
      PROVIDER_CACHING: FEATURE_FLAG_DEFAULTS.PROVIDER_CACHING,
      SCHEDULER_REFRESH:
        String(process.env.COURTEDGE_SCHEDULER_ENABLED || "true").toLowerCase() !==
        "false",
    },
  };
}
