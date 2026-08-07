/**
 * playerScoringOpportunityModelV1 — volume / ways to score
 */
import { VOLUME_MODEL_VERSION } from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export function buildPlayerScoringOpportunityModelV1(pick = {}, minutes = {}) {
  const expectedMinutes = num(minutes.expectedMinutes, 24);
  const fga = num(pick.expectedFGA) ?? num(pick.avgFGA) ?? num(pick.FGA) ?? 10;
  const fta = num(pick.expectedFTA) ?? num(pick.avgFTA) ?? num(pick.FTA) ?? 2;
  const threePa =
    num(pick.expected3PA) ?? num(pick.avg3PA) ?? num(pick["3PA"]) ?? 3;
  const usage = num(pick.usageRate) ?? num(pick.usage) ?? 0.2;
  const projection =
    num(pick.projection) ??
    num(pick.projectedPoints) ??
    num(pick.finalProjection);

  const pointsPerMinute =
    projection != null && expectedMinutes > 0
      ? projection / expectedMinutes
      : null;
  const shotVolumePerMinute =
    expectedMinutes > 0 ? (fga + 0.44 * fta) / expectedMinutes : null;
  const freeThrowRate = fga > 0 ? fta / fga : null;
  const threePointDependency = fga > 0 ? threePa / fga : null;

  const scoringOpportunityFloor = Math.max(0, fga * 0.7 + fta * 0.5);
  const scoringOpportunityCeiling = fga * 1.25 + fta * 1.1 + threePa * 0.3;

  const multiWayScorer =
    fga >= 8 && fta >= 2 && (threePointDependency == null || threePointDependency < 0.55);
  const structurallyLimited =
    fga <= 5 && usage <= 0.16 && fta <= 2;

  return {
    version: VOLUME_MODEL_VERSION,
    FGA: fga,
    FTA: fta,
    threePA: threePa,
    usage,
    minutes: expectedMinutes,
    pointsPerMinute,
    shotVolumePerMinute,
    freeThrowRate,
    threePointDependency,
    scoringOpportunityFloor,
    scoringOpportunityCeiling,
    multiWayScorer,
    structurallyLimitedUnder: structurallyLimited,
    hotThreeDependency: (threePointDependency ?? 0) >= 0.55,
    missingness: {
      projection: projection == null,
    },
  };
}
