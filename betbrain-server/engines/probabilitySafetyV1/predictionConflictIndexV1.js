/**
 * predictionConflictIndexV1 + evidence family de-duplication
 */
import { CONFLICT_MODEL_VERSION, EVIDENCE_FAMILIES } from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function sideOf(pick) {
  const s = String(pick.side || pick.pick || "").toUpperCase();
  if (s.startsWith("OVER")) return "OVER";
  if (s.startsWith("UNDER")) return "UNDER";
  return null;
}

/**
 * Build evidence family agreement + conflict index 0–100.
 */
export function buildPredictionConflictIndexV1(ctx = {}) {
  const {
    pick = {},
    minutes = {},
    role = {},
    volume = {},
    distribution = {},
    market = {},
    availabilityCertaintyScore = 50,
  } = ctx;

  const side = sideOf(pick);
  const line = num(pick.line ?? pick.selectedLine);
  const projection =
    num(pick.projection) ??
    num(pick.projectedPoints) ??
    num(pick.finalProjection);
  const fairLine =
    num(pick.fairLine) ??
    num(pick.fair_line) ??
    num(pick.modelFairLine);

  const supporting = new Set();
  const opposing = new Set();
  const neutral = new Set();

  // PROJECTION
  if (side && line != null && projection != null) {
    const edge = side === "OVER" ? projection - line : line - projection;
    if (edge >= 1.5) supporting.add("PROJECTION");
    else if (edge <= -0.5) opposing.add("PROJECTION");
    else neutral.add("PROJECTION");
  } else neutral.add("PROJECTION");

  // FAIR / MARKET family split: fair → PROJECTION-ish; market separate
  let projectionFairAgreement = null;
  if (side && line != null && projection != null && fairLine != null) {
    const projEdge = side === "OVER" ? projection - line : line - projection;
    const fairEdge = side === "OVER" ? fairLine - line : line - fairLine;
    projectionFairAgreement = projEdge > 0 && fairEdge > 0;
    if (fairEdge >= 1.0) supporting.add("PROJECTION");
    if (fairEdge <= -1.0) opposing.add("PROJECTION");
    if (projEdge > 0 && fairEdge < -1.0) opposing.add("PROJECTION");
  }

  // MINUTES_ROLE
  if ((minutes.minutesStabilityScore ?? 0) >= 75 && (role.roleStabilityScore ?? 0) >= 70) {
    supporting.add("MINUTES_ROLE");
  } else if (
    (minutes.minutesStabilityScore ?? 100) < 50 ||
    (role.roleStabilityScore ?? 100) < 50
  ) {
    opposing.add("MINUTES_ROLE");
  } else neutral.add("MINUTES_ROLE");

  // SCORING_VOLUME
  if (side === "OVER" && volume.multiWayScorer) supporting.add("SCORING_VOLUME");
  else if (side === "UNDER" && volume.structurallyLimitedUnder) {
    supporting.add("SCORING_VOLUME");
  } else if (side === "OVER" && volume.hotThreeDependency) {
    opposing.add("SCORING_VOLUME");
  } else neutral.add("SCORING_VOLUME");

  // RECENT_SCORING — single family (L5/L10 collapsed)
  const l5 =
    num(pick.avgPointsL5) ?? num(pick.pointsL5) ?? num(pick.L5Points);
  if (side && line != null && l5 != null) {
    const recentEdge = side === "OVER" ? l5 - line : line - l5;
    if (recentEdge >= 1.5) supporting.add("RECENT_SCORING");
    else if (recentEdge <= -1.5) opposing.add("RECENT_SCORING");
    else neutral.add("RECENT_SCORING");
  } else neutral.add("RECENT_SCORING");

  // SEASON_BASELINE
  const season =
    num(pick.avgPoints) ?? num(pick.seasonAvg) ?? num(pick.pointsAvg);
  if (side && line != null && season != null) {
    const seasonEdge = side === "OVER" ? season - line : line - season;
    if (seasonEdge >= 1.0) supporting.add("SEASON_BASELINE");
    else if (seasonEdge <= -1.5) opposing.add("SEASON_BASELINE");
    else neutral.add("SEASON_BASELINE");
  } else neutral.add("SEASON_BASELINE");

  // MARKET
  if ((market.marketQualityScore ?? 0) >= 65) supporting.add("MARKET");
  else if ((market.marketQualityScore ?? 100) < 40) opposing.add("MARKET");
  else neutral.add("MARKET");
  if (market.movementAgainstModel === true) opposing.add("MARKET");
  if (market.movementTowardModel === true) supporting.add("MARKET");

  // MATCHUP_GAME_ENVIRONMENT
  const blowout = num(pick.blowoutRisk, 0);
  if (blowout >= 75 && side === "OVER") opposing.add("MATCHUP_GAME_ENVIRONMENT");
  else if (blowout < 40) supporting.add("MATCHUP_GAME_ENVIRONMENT");
  else neutral.add("MATCHUP_GAME_ENVIRONMENT");

  // AVAILABILITY
  if (availabilityCertaintyScore >= 85) supporting.add("AVAILABILITY");
  else if (availabilityCertaintyScore < 60) opposing.add("AVAILABILITY");
  else neutral.add("AVAILABILITY");

  // Conflict from disagreements
  let conflict = 0;
  if (projectionFairAgreement === false) conflict += 25;
  if (opposing.has("PROJECTION") && supporting.has("PROJECTION")) conflict += 15;
  conflict += opposing.size * 8;
  conflict += Math.max(0, 4 - supporting.size) * 5;
  if ((distribution.distributionWidth ?? 0) > 18) conflict += 10;
  if (role.ROLE_ENVIRONMENT_CHANGED) conflict += 12;
  if ((minutes.minutesStabilityScore ?? 100) < 50) conflict += 10;

  const conflictIndex = clamp(Math.round(conflict), 0, 100);

  return {
    version: CONFLICT_MODEL_VERSION,
    conflictIndex,
    supportingEvidenceFamilies: [...supporting],
    opposingEvidenceFamilies: [...opposing],
    neutralEvidenceFamilies: [...neutral].filter(
      (f) => !supporting.has(f) && !opposing.has(f)
    ),
    supportingCount: supporting.size,
    opposingCount: opposing.size,
    projectionFairAgreement,
    evidenceFamiliesCatalog: EVIDENCE_FAMILIES,
  };
}
