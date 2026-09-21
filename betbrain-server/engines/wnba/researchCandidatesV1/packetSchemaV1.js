/**
 * Research-only candidate packet fields. Not deployed to production persistence.
 */
export const RESEARCH_CANDIDATE_PACKET_BUILD = "courteedge-research-candidate-packet-v1";

export const PROP_PACKET_FIELDS = Object.freeze([
  "projectedMinutes",
  "role",
  "opportunity",
  "rate",
  "projection",
  "line",
  "edge",
  "probability",
  "reliability",
  "reliabilityInputs",
]);

export const WINNER_PACKET_FIELDS = Object.freeze([
  "pointDifferential",
  "netRatingProxy",
  "elo",
  "pythag",
  "market",
  "injuryLineupContext",
  "pWinner",
]);
