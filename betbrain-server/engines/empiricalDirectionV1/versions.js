/**
 * CourtEdge Empirical Direction Engine V1 — PRODUCTION_1 freeze.
 * Answers: OVER / UNDER / NO BET (not Official safety — that is C2).
 *
 * Freeze: EMPIRICAL_DIRECTION_V1_PRODUCTION_1
 * Selected by chronological walk-forward on n=189 study rows.
 * Do not retune on Aug 9 outcomes.
 */
export const EMPIRICAL_DIRECTION_V1_BUILD =
  "courteedge-empirical-direction-v1-production-1";

export const EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE =
  "EMPIRICAL_DIRECTION_V1_PRODUCTION_1";

export const DIRECTION_ENGINE_VERSION =
  "empirical-direction-engine-v1-production-1";

/**
 * Frozen thresholds — walk-forward winner:
 * O2.5_U4_orna_ur0.45_EDGE_OR_REL_MISSING_EDGE
 *
 * OOS: 43-4 (91.5% WR), coverage ~28%, NO BET ~72%
 * Full: 45-8; OVER 25-7; UNDER 20-1 (edge≥4 cohort — mark small-n)
 */
export const DIRECTION_THRESHOLDS_V1 = Object.freeze({
  freezeId: EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE,
  selectedCandidateId: "O2.5_U4_orna_ur0.45_EDGE_OR_REL_MISSING_EDGE",
  noBet: Object.freeze({
    mode: "EDGE_OR_REL_MISSING_EDGE",
    edgeFloor: 1.0,
    reliabilityFloor: 0.45,
  }),
  over: Object.freeze({
    minEdge: 2.5,
    strongEdge: 3.5,
    minFairEdge: 2.0,
    requireFairConfirm: false,
    minReliability: null,
    strongReliability: 0.7,
    minSafety: 65,
    marketConflict: Object.freeze({
      enabled: true,
      minEdge: 2.0,
      marketQualityFloor: 85,
      minBooks: 4,
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
