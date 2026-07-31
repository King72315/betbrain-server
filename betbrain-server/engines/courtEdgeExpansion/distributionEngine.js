/**
 * CourtEdge Engine Expansion — Ceiling/Floor Distribution Engine.
 *
 * Builds season / L10 / current-role point distributions from game logs:
 * percentiles, hit rates against the current line, and margins. Applies
 * sample-size shrinkage so a 3-game role window never carries full weight.
 * Season and role distributions are always reported separately — never
 * blended into one number that hides which window is actually driving it.
 */
import {
  numOrNull,
  clamp,
  avg,
  median,
  percentile,
  sampleShrinkage,
  baseEngineSignal,
  emptyEngineSignal,
  contributionsFromSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const DISTRIBUTION_ENGINE = "distributionEngine";

function pointsOf(games = []) {
  return (games || [])
    .map((g) => numOrNull(g?.points ?? g?.pts))
    .filter((v) => v !== null);
}

function buildDistribution(values = [], line) {
  const n = values.length;
  if (!n) {
    return {
      sampleSize: 0,
      average: null,
      median: null,
      stdevProxy: null,
      p10: null,
      p25: null,
      p50: null,
      p75: null,
      p90: null,
      floor: null,
      ceiling: null,
      hitRate: null,
      missRate: null,
      averageMargin: null,
    };
  }
  const L = numOrNull(line);
  const hits = L !== null ? values.filter((v) => v > L).length : null;
  const margins = L !== null ? values.map((v) => Number((v - L).toFixed(2))) : [];
  return {
    sampleSize: n,
    average: avg(values),
    median: median(values),
    p10: percentile(values, 10),
    p25: percentile(values, 25),
    p50: percentile(values, 50),
    p75: percentile(values, 75),
    p90: percentile(values, 90),
    floor: percentile(values, 10),
    ceiling: percentile(values, 90),
    hitRate: hits !== null ? Number((hits / n).toFixed(3)) : null,
    missRate: hits !== null ? Number(((n - hits) / n).toFixed(3)) : null,
    averageMargin: margins.length ? avg(margins) : null,
  };
}

export function evaluateCeilingFloorDistribution(ctx = {}) {
  const gameLogs = Array.isArray(ctx.gameLogs) ? ctx.gameLogs : [];
  const roleGames = Array.isArray(ctx.roleGames) ? ctx.roleGames : [];
  const last10Input = ctx.last10;
  const line = numOrNull(ctx.line);

  const seasonPts = pointsOf(gameLogs);
  const l10Pts = Array.isArray(last10Input) ? pointsOf(last10Input) : seasonPts.slice(0, 10);
  const rolePts = pointsOf(roleGames);

  if (!seasonPts.length && !l10Pts.length && !rolePts.length) {
    return emptyEngineSignal(DISTRIBUTION_ENGINE, "no_game_log_data_provided", {
      rawValues: { line },
    });
  }

  const season = buildDistribution(seasonPts, line);
  const l10 = buildDistribution(l10Pts, line);
  const role = buildDistribution(rolePts, line);

  const seasonShrink = sampleShrinkage(season.sampleSize, 20);
  const l10Shrink = sampleShrinkage(l10.sampleSize, 10);
  const roleShrink = sampleShrinkage(role.sampleSize, 8);

  // Role window is the most relevant if it exists with enough games; else L10; else season.
  const windows = [];
  if (role.sampleSize > 0) windows.push({ key: "role", dist: role, shrink: roleShrink, priority: 3 });
  if (l10.sampleSize > 0) windows.push({ key: "last10", dist: l10, shrink: l10Shrink, priority: 2 });
  if (season.sampleSize > 0) windows.push({ key: "season", dist: season, shrink: seasonShrink, priority: 1 });

  let normalizedSignal = 0;
  let blendedHitRate = null;
  if (line !== null) {
    let weightSum = 0;
    let weighted = 0;
    for (const w of windows) {
      if (w.dist.hitRate === null) continue;
      const weight = w.priority * Math.max(w.shrink, 0.15);
      weighted += w.dist.hitRate * weight;
      weightSum += weight;
    }
    if (weightSum > 0) {
      blendedHitRate = Number((weighted / weightSum).toFixed(3));
      normalizedSignal = clamp((blendedHitRate - 0.5) * 2, -1, 1);
    }
  }

  const totalSample = season.sampleSize + l10.sampleSize + role.sampleSize;
  const overallShrink = sampleShrinkage(Math.max(season.sampleSize, l10.sampleSize, role.sampleSize), 10);
  normalizedSignal = Number((normalizedSignal * (0.4 + 0.6 * overallShrink)).toFixed(3));

  let quality = ENGINE_SIGNAL_QUALITY.UNAVAILABLE;
  const primarySample = role.sampleSize || l10.sampleSize || season.sampleSize;
  if (primarySample >= 10) quality = ENGINE_SIGNAL_QUALITY.STRONG;
  else if (primarySample >= 6) quality = ENGINE_SIGNAL_QUALITY.USABLE;
  else if (primarySample >= 3) quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;
  else if (primarySample > 0) quality = ENGINE_SIGNAL_QUALITY.EARLY;

  const reasons = [];
  if (blendedHitRate !== null) {
    const overHitPct = Number((blendedHitRate * 100).toFixed(1));
    const underHitPct = Number(((1 - blendedHitRate) * 100).toFixed(1));
    // hitRate is P(points > line) = Over hit rate. Always label both sides.
    reasons.push(
      `Over hit rate: ${overHitPct}%. Under hit rate: ${underHitPct}%.`
    );
  }
  if (role.sampleSize > 0 && season.sampleSize > 0 && role.average !== null && season.average !== null) {
    const diff = Number((role.average - season.average).toFixed(1));
    if (Math.abs(diff) >= 1.5) {
      reasons.push(`Role window average (${role.average}) diverges from season average (${season.average}) by ${diff}.`);
    }
  }
  if (!windows.some((w) => w.dist.sampleSize >= 5)) {
    reasons.push("All available windows are small samples — shrinkage applied.");
  }

  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  if (blendedHitRate !== null) {
    if (blendedHitRate >= 0.7 || blendedHitRate <= 0.3) {
      confidenceAdjustment = Math.round(4 * overallShrink) * (blendedHitRate >= 0.5 ? 1 : -1);
    } else if (blendedHitRate >= 0.6 || blendedHitRate <= 0.4) {
      confidenceAdjustment = Math.round(2 * overallShrink) * (blendedHitRate >= 0.5 ? 1 : -1);
    }
  }
  if (primarySample < 5) {
    riskAdjustment = RISK_ADJUSTMENT.MONITOR;
  }
  confidenceAdjustment = clamp(confidenceAdjustment, -6, 6);

  const { overContribution, underContribution } = contributionsFromSignal(normalizedSignal);

  return baseEngineSignal({
    engine: DISTRIBUTION_ENGINE,
    available: true,
    source: "game_logs",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize: totalSample,
    quality,
    stale: false,
    fallbackUsed: !Array.isArray(last10Input) && l10.sampleSize > 0,
    rawValues: {
      line,
      season,
      last10: l10,
      role,
      blendedHitRate,
    },
    normalizedSignal,
    overContribution,
    underContribution,
    confidenceAdjustment,
    riskAdjustment,
    reason: reasons.length ? reasons.join(" ") : "Distribution evaluated with limited signal.",
    units: "points",

    season,
    last10: l10,
    role,
    blendedHitRate,
  });
}
