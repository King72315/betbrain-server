/**
 * CourtEdge Engine Expansion — Calibration V1.
 *
 * Static, conservative weights only. No auto-tuning, no historical replay
 * feedback loop lives here — that would need its own reviewed rollout
 * (see CONFIG.COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED for the pattern).
 *
 * Every engine belongs to exactly one evidence group. Groups exist so the
 * evidence-deduplication engine can cap how much correlated evidence (e.g.
 * distribution + volatility, both describing "how spread out are results")
 * can move confidence/risk in one direction.
 */

export const ENGINE_GROUPS = Object.freeze({
  ROLE_AND_VOLUME: "ROLE_AND_VOLUME",
  DISTRIBUTION_AND_VOLATILITY: "DISTRIBUTION_AND_VOLATILITY",
  PROJECTION: "PROJECTION",
  OPPONENT_AND_MATCHUP: "OPPONENT_AND_MATCHUP",
  MARKET: "MARKET",
  AVAILABILITY_AND_TEAMMATE: "AVAILABILITY_AND_TEAMMATE",
  GAME_ENVIRONMENT: "GAME_ENVIRONMENT",
  REST_AND_FATIGUE: "REST_AND_FATIGUE",
});

function engineEntry(group, weight, confidenceCap, riskCap) {
  return { group, weight, confidenceCap, riskCap };
}

function groupCapEntry(confidenceCap, riskCap) {
  return { confidenceCap, riskCap };
}

/**
 * NBA — larger sample sizes (82-game season, deep historical box scores),
 * so caps/weights are the baseline.
 */
const NBA = Object.freeze({
  league: "NBA",
  groupCaps: Object.freeze({
    [ENGINE_GROUPS.ROLE_AND_VOLUME]: groupCapEntry(6, 8),
    [ENGINE_GROUPS.DISTRIBUTION_AND_VOLATILITY]: groupCapEntry(5, 8),
    [ENGINE_GROUPS.PROJECTION]: groupCapEntry(6, 6),
    [ENGINE_GROUPS.OPPONENT_AND_MATCHUP]: groupCapEntry(5, 6),
    [ENGINE_GROUPS.MARKET]: groupCapEntry(6, 8),
    [ENGINE_GROUPS.AVAILABILITY_AND_TEAMMATE]: groupCapEntry(8, 12),
    [ENGINE_GROUPS.GAME_ENVIRONMENT]: groupCapEntry(4, 6),
    [ENGINE_GROUPS.REST_AND_FATIGUE]: groupCapEntry(4, 6),
  }),
  engines: Object.freeze({
    availabilityRosterEngine: engineEntry(ENGINE_GROUPS.AVAILABILITY_AND_TEAMMATE, 1.0, 8, 12),
    teammateImpactEngine: engineEntry(ENGINE_GROUPS.AVAILABILITY_AND_TEAMMATE, 0.6, 5, 8),
    roleVelocityEngine: engineEntry(ENGINE_GROUPS.ROLE_AND_VOLUME, 0.85, 6, 8),
    distributionEngine: engineEntry(ENGINE_GROUPS.DISTRIBUTION_AND_VOLATILITY, 0.7, 5, 7),
    volatilityEngine: engineEntry(ENGINE_GROUPS.DISTRIBUTION_AND_VOLATILITY, 0.45, 4, 8),
    projectionSanityEngine: engineEntry(ENGINE_GROUPS.PROJECTION, 0.8, 6, 6),
    defensiveArchetypeEngine: engineEntry(ENGINE_GROUPS.OPPONENT_AND_MATCHUP, 0.6, 5, 6),
    pacePossessionEngine: engineEntry(ENGINE_GROUPS.GAME_ENVIRONMENT, 0.55, 4, 6),
    lineMovementClvEngine: engineEntry(ENGINE_GROUPS.MARKET, 0.9, 6, 8),
    restFatigueEngine: engineEntry(ENGINE_GROUPS.REST_AND_FATIGUE, 0.5, 4, 6),
  }),
  totalConfidenceCap: 18,
  totalRiskScoreCap: 6,
});

/**
 * WNBA — shorter season, thinner box-score history, and smaller per-team
 * rosters mean the same raw sample size carries more noise. Weights are
 * trimmed ~10-20% versus NBA and caps are slightly tighter.
 */
const WNBA = Object.freeze({
  league: "WNBA",
  groupCaps: Object.freeze({
    [ENGINE_GROUPS.ROLE_AND_VOLUME]: groupCapEntry(5, 7),
    [ENGINE_GROUPS.DISTRIBUTION_AND_VOLATILITY]: groupCapEntry(4, 7),
    [ENGINE_GROUPS.PROJECTION]: groupCapEntry(5, 5),
    [ENGINE_GROUPS.OPPONENT_AND_MATCHUP]: groupCapEntry(4, 5),
    [ENGINE_GROUPS.MARKET]: groupCapEntry(6, 8),
    [ENGINE_GROUPS.AVAILABILITY_AND_TEAMMATE]: groupCapEntry(8, 12),
    [ENGINE_GROUPS.GAME_ENVIRONMENT]: groupCapEntry(3, 5),
    [ENGINE_GROUPS.REST_AND_FATIGUE]: groupCapEntry(4, 6),
  }),
  engines: Object.freeze({
    availabilityRosterEngine: engineEntry(ENGINE_GROUPS.AVAILABILITY_AND_TEAMMATE, 1.0, 8, 12),
    teammateImpactEngine: engineEntry(ENGINE_GROUPS.AVAILABILITY_AND_TEAMMATE, 0.55, 5, 8),
    roleVelocityEngine: engineEntry(ENGINE_GROUPS.ROLE_AND_VOLUME, 0.75, 5, 7),
    distributionEngine: engineEntry(ENGINE_GROUPS.DISTRIBUTION_AND_VOLATILITY, 0.6, 4, 6),
    volatilityEngine: engineEntry(ENGINE_GROUPS.DISTRIBUTION_AND_VOLATILITY, 0.4, 4, 7),
    projectionSanityEngine: engineEntry(ENGINE_GROUPS.PROJECTION, 0.7, 5, 5),
    defensiveArchetypeEngine: engineEntry(ENGINE_GROUPS.OPPONENT_AND_MATCHUP, 0.5, 4, 5),
    pacePossessionEngine: engineEntry(ENGINE_GROUPS.GAME_ENVIRONMENT, 0.45, 3, 5),
    lineMovementClvEngine: engineEntry(ENGINE_GROUPS.MARKET, 0.9, 6, 8),
    restFatigueEngine: engineEntry(ENGINE_GROUPS.REST_AND_FATIGUE, 0.45, 4, 6),
  }),
  totalConfidenceCap: 16,
  totalRiskScoreCap: 6,
});

export const COURTEDGE_ENGINE_CALIBRATION_V1 = Object.freeze({
  NBA,
  WNBA,
});

/** Returns the calibration config for a league, defaulting to NBA when unknown. */
export function getCalibration(league) {
  const raw = String(league || "NBA").trim().toUpperCase();
  return raw === "WNBA" ? WNBA : NBA;
}
