/**
 * CourtEdge Lab V2 — versioned constants and engine scoreboard identity.
 * Analysis-only: never writes live weights or Calibration Feedback.
 */

export const LAB_V2_VERSION = "courtEdgeLabV2";
export const LAB_V2_BUILD = "courteedge-lab-stability-audit-v1";
export const HISTORY_THREE_SLATE_GROUPS_V2_VERSION = "history-three-slate-groups-v2";
/** Alias expected by server.js imports */
export const HISTORY_THREE_SLATE_GROUPS_V2 = HISTORY_THREE_SLATE_GROUPS_V2_VERSION;

/** Official slate size required for the instrumented three-slate learning track. */
export const INSTRUMENTED_LEARNING_MIN_PROPS = 6;

/**
 * Evidence / decision-packet schema era used to segregate all-time engine metrics.
 * Mixed eras must never blend into one scoreboard.
 */
export const LAB_EVIDENCE_SCHEMA_V1 = "courtEdgeEngineSignalsV1";
export const LAB_DECISION_PACKET_V1 = "courtEdgeDecisionPacketV1";

/** Eleven Engine Expansion scoreboard engines (always visible). */
export const LAB_V2_SCOREBOARD_ENGINES = Object.freeze([
  { key: "lineMovementClv", label: "Line Movement and CLV", kind: "directional" },
  { key: "projectionSanity", label: "Projection Sanity", kind: "calibration" },
  { key: "availabilityRoster", label: "Availability and Roster Integrity", kind: "directional" },
  { key: "distribution", label: "Ceiling/Floor Distribution", kind: "directional" },
  { key: "volatility", label: "Player Volatility", kind: "calibration" },
  { key: "defensiveArchetype", label: "Defensive Archetype", kind: "directional" },
  { key: "roleVelocity", label: "Role Trend Velocity", kind: "directional" },
  { key: "pacePossession", label: "Pace and Possession", kind: "directional" },
  { key: "evidenceDeduplication", label: "Evidence Deduplication", kind: "calibration" },
  { key: "restFatigue", label: "Rest and Fatigue", kind: "calibration" },
  { key: "teammateImpact", label: "Teammate Impact", kind: "directional" },
]);

export const LAB_V2_ENGINE_KEYS = Object.freeze(
  LAB_V2_SCOREBOARD_ENGINES.map((e) => e.key)
);

export const LAB_V2_ENGINE_LABELS = Object.freeze(
  Object.fromEntries(LAB_V2_SCOREBOARD_ENGINES.map((e) => [e.key, e.label]))
);

export const LAB_V2_ENGINE_KINDS = Object.freeze(
  Object.fromEntries(LAB_V2_SCOREBOARD_ENGINES.map((e) => [e.key, e.kind]))
);

export const CONFIDENCE_BUCKETS = Object.freeze([
  { key: "0-39", min: 0, max: 39 },
  { key: "40-49", min: 40, max: 49 },
  { key: "50-59", min: 50, max: 59 },
  { key: "60-69", min: 60, max: 69 },
  { key: "70-79", min: 70, max: 79 },
  { key: "80+", min: 80, max: 1000 },
]);

export const RISK_BUCKETS = Object.freeze(["LOW", "MEDIUM", "HIGH"]);

export const BANNED_LAB_LABELS = Object.freeze([
  "BOARD_ONLY",
  "NATURAL_TRACK",
  "NO_BET",
  "PREMIUM",
  "PLAYABLE",
  "WATCHLIST",
  "WARNING",
  "SOFT",
  "HARD_BLOCK",
  "Reader Demoted",
  "Reader Uncertain TEST",
  "prior gate",
  "clean eligible",
  "blocked",
]);

export const ADJUSTMENT_TYPES = Object.freeze([
  "increase weight",
  "decrease weight",
  "reduce confidence effect",
  "increase confidence penalty",
  "increase risk effect",
  "reduce risk effect",
  "widen projection range",
  "tighten projection sanity",
  "change sample-size shrinkage",
  "investigate provider quality",
  "no change",
]);
