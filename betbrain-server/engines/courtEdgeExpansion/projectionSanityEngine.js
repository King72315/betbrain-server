/**
 * CourtEdge Engine Expansion — Projection Sanity Engine.
 *
 * Sanity-checks a projection against season/L10/role history, minutes/FGA/FTA
 * trend, pace/environment context, and implied totals. This engine never
 * removes a prop — it only flags when a projection requires an unsupported
 * ceiling outcome to hit, and adjusts confidence/risk accordingly.
 *
 * Missing context (no gameLogs, no season average, no projection) means no
 * vote — never a fabricated neutral score.
 */
import {
  num,
  numOrNull,
  clamp,
  avg,
  median,
  percentile,
  percentileRank,
  stdev,
  slopeLinear,
  sampleShrinkage,
  baseEngineSignal,
  emptyEngineSignal,
  contributionsFromSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const PROJECTION_SANITY_ENGINE = "projectionSanityEngine";

function extractSeries(games = [], field, aliases = []) {
  return (games || [])
    .map((g) => {
      const value = first(g, field, aliases);
      return numOrNull(value);
    })
    .filter((v) => v !== null);
}

function first(game, field, aliases) {
  if (game && game[field] !== undefined && game[field] !== null) return game[field];
  for (const alias of aliases) {
    if (game && game[alias] !== undefined && game[alias] !== null) return game[alias];
  }
  return null;
}

function pointsOf(games = []) {
  return extractSeries(games, "points", ["pts"]);
}

/** gameLogs are assumed most-recent-first; chronological (oldest->newest) is needed for slopes. */
function chronological(values = []) {
  return [...values].reverse();
}

export function evaluateProjectionSanity(ctx = {}) {
  const projection = numOrNull(ctx.projection);
  const vendorProjection = numOrNull(ctx.vendorProjection);
  const gameLogs = Array.isArray(ctx.gameLogs) ? ctx.gameLogs : [];
  const roleGames = Array.isArray(ctx.roleGames) ? ctx.roleGames : [];
  const last10Input = ctx.last10;
  const line = numOrNull(ctx.line);
  const impliedTeamTotal = numOrNull(ctx.impliedTeamTotal);
  const spread = numOrNull(ctx.spread);
  const blowoutRisk = numOrNull(ctx.blowoutRisk);
  const scoringEnvironmentProxy = numOrNull(ctx.scoringEnvironmentProxy);

  const seasonPts = pointsOf(gameLogs);
  const last10Pts = Array.isArray(last10Input) ? pointsOf(last10Input) : seasonPts.slice(0, 10);
  const rolePts = pointsOf(roleGames);

  const seasonAvg = numOrNull(ctx.seasonAverage) ?? avg(seasonPts);
  const seasonMedian = median(seasonPts);
  const l10Avg = avg(last10Pts);
  const roleAvg = rolePts.length ? avg(rolePts) : null;

  const rawValues = {
    projection,
    vendorProjection,
    line,
    seasonAverage: seasonAvg,
    seasonMedian,
    seasonSampleSize: seasonPts.length,
    last10Average: l10Avg,
    last10SampleSize: last10Pts.length,
    roleAverage: roleAvg,
    roleSampleSize: rolePts.length,
    impliedTeamTotal,
    spread,
    blowoutRisk,
    scoringEnvironmentProxy,
  };

  if (projection === null || (seasonAvg === null && l10Avg === null && roleAvg === null)) {
    return emptyEngineSignal(
      PROJECTION_SANITY_ENGINE,
      projection === null ? "no_projection_provided" : "no_comparison_basis_available",
      { rawValues }
    );
  }

  const seasonP25 = percentile(seasonPts, 25);
  const seasonP50 = percentile(seasonPts, 50);
  const seasonP75 = percentile(seasonPts, 75);
  const seasonP90 = percentile(seasonPts, 90);
  const seasonStdev = stdev(seasonPts);
  const projectionPercentileRank = percentileRank(seasonPts, projection);

  const gapVsSeason = seasonAvg !== null ? Number((projection - seasonAvg).toFixed(2)) : null;
  const gapVsL10 = l10Avg !== null ? Number((projection - l10Avg).toFixed(2)) : null;
  const gapVsRole = roleAvg !== null ? Number((projection - roleAvg).toFixed(2)) : null;
  const gapVsVendor =
    vendorProjection !== null ? Number((projection - vendorProjection).toFixed(2)) : null;

  // Chronological trend of minutes/FGA/FTA supports (or fails to support) an elevated projection.
  const minutesSeries = chronological(extractSeries(gameLogs.slice(0, 10), "minutes", ["min"]));
  const fgaSeries = chronological(extractSeries(gameLogs.slice(0, 10), "fga", []));
  const ftaSeries = chronological(extractSeries(gameLogs.slice(0, 10), "fta", []));
  const minutesTrend = slopeLinear(minutesSeries);
  const fgaTrend = slopeLinear(fgaSeries);
  const ftaTrend = slopeLinear(ftaSeries);
  const volumeTrendSupportsCeiling =
    (minutesTrend !== null && minutesTrend > 0.3) ||
    (fgaTrend !== null && fgaTrend > 0.2) ||
    (ftaTrend !== null && ftaTrend > 0.15);

  // Does role-window data (post role-change) actually support a higher number than season?
  const roleSupportsCeiling = roleAvg !== null && seasonAvg !== null && roleAvg > seasonAvg + 1;

  const paceEnvAvailable = impliedTeamTotal !== null || scoringEnvironmentProxy !== null;
  const favorableEnv =
    (impliedTeamTotal !== null && impliedTeamTotal > 0 && (blowoutRisk === null || blowoutRisk < 55)) ||
    (scoringEnvironmentProxy !== null && scoringEnvironmentProxy > 0);

  // Requires an unsupported ceiling outcome: projection sits well above the
  // usable history's high end AND nothing (role shift, volume trend, game
  // environment) explains the gap.
  const historyHigh = roleAvg ?? l10Avg ?? seasonAvg;
  const referenceStdev = seasonStdev ?? 0;
  const ceilingThreshold = historyHigh !== null ? historyHigh + Math.max(referenceStdev, 2) : null;
  const projectionRequiresCeilingOutcome =
    ceilingThreshold !== null &&
    projection > ceilingThreshold &&
    !roleSupportsCeiling &&
    !volumeTrendSupportsCeiling &&
    !favorableEnv;

  const sampleSize = Math.max(seasonPts.length, last10Pts.length, rolePts.length);
  const shrink = sampleShrinkage(sampleSize, 10);

  let quality = ENGINE_SIGNAL_QUALITY.UNAVAILABLE;
  if (sampleSize >= 10) quality = ENGINE_SIGNAL_QUALITY.STRONG;
  else if (sampleSize >= 6) quality = ENGINE_SIGNAL_QUALITY.USABLE;
  else if (sampleSize >= 3) quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;
  else if (sampleSize > 0) quality = ENGINE_SIGNAL_QUALITY.EARLY;

  // projectionSanityScore: 0-100, centered on how well-supported the gap is.
  let score = 60;
  const primaryGap = gapVsRole ?? gapVsL10 ?? gapVsSeason ?? 0;
  const gapMagnitude = Math.abs(primaryGap);
  if (gapMagnitude <= 1.5) score += 10;
  else if (gapMagnitude <= 3) score += 2;
  else if (gapMagnitude <= 5) score -= 8;
  else score -= 18;

  if (roleSupportsCeiling) score += 8;
  if (volumeTrendSupportsCeiling) score += 6;
  if (favorableEnv) score += 4;
  if (projectionRequiresCeilingOutcome) score -= 20;
  if (gapVsVendor !== null && Math.abs(gapVsVendor) > 4) score -= 6;

  score = clamp(Math.round(score * (0.5 + 0.5 * shrink)), 0, 100);
  const projectionSanityScore = score;

  // Directional lean: projection above the blended reference supports Over,
  // below supports Under — scaled by how well-supported that gap is.
  const referenceAvg = roleAvg ?? l10Avg ?? seasonAvg;
  let normalizedSignal = 0;
  if (referenceAvg !== null && referenceAvg !== 0) {
    const relativeGap = clamp((projection - referenceAvg) / Math.max(referenceAvg, 4), -1, 1);
    const supportMultiplier = projectionRequiresCeilingOutcome ? 0.3 : 1;
    normalizedSignal = Number((relativeGap * shrink * supportMultiplier).toFixed(3));
  }

  const reasons = [];
  if (projectionRequiresCeilingOutcome) {
    reasons.push(
      `Projection (${projection}) exceeds recent ceiling (${ceilingThreshold?.toFixed(1)}) without role/volume/environment support.`
    );
  }
  if (gapVsRole !== null) reasons.push(`Gap vs role window: ${gapVsRole}.`);
  else if (gapVsL10 !== null) reasons.push(`Gap vs last-10: ${gapVsL10}.`);
  else if (gapVsSeason !== null) reasons.push(`Gap vs season average: ${gapVsSeason}.`);
  if (roleSupportsCeiling) reasons.push("Role window average supports a higher number.");
  if (volumeTrendSupportsCeiling) reasons.push("Minutes/FGA/FTA trend supports elevated projection.");

  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  if (projectionRequiresCeilingOutcome) {
    confidenceAdjustment = -Math.round(6 * shrink) || -2;
    riskAdjustment = RISK_ADJUSTMENT.ELEVATE;
  } else if (projectionSanityScore >= 72) {
    confidenceAdjustment = Math.round(4 * shrink);
  } else if (projectionSanityScore <= 40) {
    confidenceAdjustment = -Math.round(4 * shrink) || -1;
    riskAdjustment = RISK_ADJUSTMENT.MONITOR;
  }
  confidenceAdjustment = clamp(confidenceAdjustment, -8, 6);

  const { overContribution, underContribution } = contributionsFromSignal(normalizedSignal);

  return baseEngineSignal({
    engine: PROJECTION_SANITY_ENGINE,
    available: true,
    source: "internal_projection_pipeline",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize,
    quality,
    stale: false,
    fallbackUsed: roleAvg === null && l10Avg !== null,
    rawValues: {
      ...rawValues,
      seasonP25,
      seasonP50,
      seasonP75,
      seasonP90,
      seasonStdev,
      projectionPercentileRank,
      gapVsSeason,
      gapVsL10,
      gapVsRole,
      gapVsVendor,
      minutesTrend,
      fgaTrend,
      ftaTrend,
    },
    normalizedSignal,
    overContribution,
    underContribution,
    confidenceAdjustment,
    riskAdjustment,
    reason: reasons.length ? reasons.join(" ") : "Projection is consistent with recent history.",
    units: "points",

    projectionSanityScore,
    projectionRequiresCeilingOutcome,
    roleSupportsCeiling,
    volumeTrendSupportsCeiling,
    favorableEnv: paceEnvAvailable ? favorableEnv : null,
    paceEnvAvailable,
  });
}
