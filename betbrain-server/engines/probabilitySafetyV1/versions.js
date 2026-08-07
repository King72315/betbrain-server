/**
 * CourtEdge Probability / Safety / True Low-Risk Architecture V1
 * Build: courteedge-probability-safety-true-low-risk-architecture-v1
 */
export const ARCHITECTURE_BUILD =
  "courteedge-probability-safety-true-low-risk-architecture-v1";

export const FORECAST_MODEL_VERSION = "forecast-v1";
export const MINUTES_MODEL_VERSION = "minutes-v1";
export const ROLE_MODEL_VERSION = "role-stability-v1";
export const VOLUME_MODEL_VERSION = "scoring-opportunity-v1";
export const DISTRIBUTION_MODEL_VERSION = "points-distribution-v1";
export const MARKET_MODEL_VERSION = "prop-market-v1";
export const CONFLICT_MODEL_VERSION = "conflict-index-v1";
export const FAILURE_PATH_VERSION = "failure-path-v1";
export const BLOWOUT_MODEL_VERSION = "blowout-sensitivity-v1";
export const SAFETY_MODEL_VERSION = "prop-safety-v1";
export const MEMBERSHIP_VERSION = "official-membership-low-medium-v1";
export const RESEARCH_UNIVERSE_VERSION = "research-universe-v1";

/** Default Monte Carlo draws — override via options.simulationCount */
export const DEFAULT_SIMULATION_COUNT = 5000;

export const EVIDENCE_FAMILIES = Object.freeze([
  "PROJECTION",
  "MINUTES_ROLE",
  "SCORING_VOLUME",
  "RECENT_SCORING",
  "SEASON_BASELINE",
  "MARKET",
  "MATCHUP_GAME_ENVIRONMENT",
  "AVAILABILITY",
]);

export const LOW_RISK_HARD_BLOCKS = Object.freeze([
  "SEVERE_UNSTABLE_ROLE",
  "SEVERE_MINUTES_VOLATILITY",
  "UNCONFIRMED_AVAILABILITY",
  "MINUTES_RESTRICTION",
  "MAJOR_PROJECTION_FAIR_CONFLICT",
  "SEVERE_MARKET_INTEGRITY",
  "SEVERE_SIDE_CONFLICT",
  "SEVERE_DATA_INCOMPLETENESS",
]);
