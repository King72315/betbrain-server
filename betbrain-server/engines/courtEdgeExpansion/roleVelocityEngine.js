/**
 * CourtEdge Engine Expansion — Role Trend Velocity Engine.
 *
 * Computes L3/L5/L10 slopes for minutes, FGA, FTA, points, and an estimated
 * usage proxy, then classifies the trend as a one-game blip vs a sustained
 * role change. Emits ONE combined ROLE_AND_VOLUME vote — never separate
 * minutes/FGA/usage votes — so downstream calibration only has to cap a
 * single number per group.
 */
import {
  numOrNull,
  clamp,
  avg,
  stdev,
  slopeLinear,
  sampleShrinkage,
  baseEngineSignal,
  emptyEngineSignal,
  contributionsFromSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const ROLE_VELOCITY_ENGINE = "roleVelocityEngine";

function seriesOf(games = [], field, aliases = []) {
  return (games || [])
    .map((g) => {
      for (const key of [field, ...aliases]) {
        const v = numOrNull(g?.[key]);
        if (v !== null) return v;
      }
      return null;
    })
    .filter((v) => v !== null);
}

/** gameLogs are most-recent-first; slopeLinear expects oldest -> newest. */
function chronoWindow(series, n) {
  return series.slice(0, n).reverse();
}

function estimatedUsageProxySeries(games = []) {
  return (games || [])
    .map((g) => {
      const fga = numOrNull(g?.fga);
      const fta = numOrNull(g?.fta);
      if (fga === null && fta === null) return null;
      return Number(((fga ?? 0) + 0.44 * (fta ?? 0)).toFixed(2));
    })
    .filter((v) => v !== null);
}

function slopesForWindow(gameLogs, n) {
  const minutes = chronoWindow(seriesOf(gameLogs, "minutes", ["min"]), n);
  const fga = chronoWindow(seriesOf(gameLogs, "fga", []), n);
  const fta = chronoWindow(seriesOf(gameLogs, "fta", []), n);
  const points = chronoWindow(seriesOf(gameLogs, "points", ["pts"]), n);
  const usageProxy = chronoWindow(estimatedUsageProxySeries(gameLogs), n);
  return {
    n,
    sampleSize: minutes.length,
    minutesSlope: slopeLinear(minutes),
    fgaSlope: slopeLinear(fga),
    ftaSlope: slopeLinear(fta),
    pointsSlope: slopeLinear(points),
    usageProxySlope: slopeLinear(usageProxy),
  };
}

export function evaluateRoleTrendVelocity(ctx = {}) {
  const gameLogs = Array.isArray(ctx.gameLogs) ? ctx.gameLogs : [];

  if (gameLogs.length < 3) {
    return emptyEngineSignal(ROLE_VELOCITY_ENGINE, "insufficient_game_log_sample", {
      rawValues: { sampleSize: gameLogs.length },
    });
  }

  const l3 = slopesForWindow(gameLogs, 3);
  const l5 = slopesForWindow(gameLogs, 5);
  const l10 = slopesForWindow(gameLogs, 10);

  const minutesSeries = seriesOf(gameLogs, "minutes", ["min"]);
  const lastGameMinutes = minutesSeries[0] ?? null;
  const priorAvgMinutes = minutesSeries.length > 1 ? avg(minutesSeries.slice(1, 6)) : null;
  const minutesStdevRecent = minutesSeries.length >= 3 ? stdev(minutesSeries.slice(0, 6)) : null;

  const oneGameBlip =
    lastGameMinutes !== null &&
    priorAvgMinutes !== null &&
    minutesStdevRecent !== null &&
    minutesStdevRecent > 0 &&
    Math.abs(lastGameMinutes - priorAvgMinutes) > 1.5 * minutesStdevRecent &&
    !(l10.minutesSlope !== null && Math.abs(l10.minutesSlope) > 0.8);

  const sustainedRoleChange =
    l5.minutesSlope !== null &&
    l10.minutesSlope !== null &&
    Math.sign(l5.minutesSlope) === Math.sign(l10.minutesSlope) &&
    Math.abs(l5.minutesSlope) >= 0.8 &&
    Math.abs(l10.minutesSlope) >= 0.4 &&
    l5.sampleSize >= 4 &&
    l10.sampleSize >= 6;

  // Combine minutes/FGA/points/usage slopes into ONE ROLE_AND_VOLUME signal.
  // Weight recent windows more (L3 most reactive, L10 most stable) and scale
  // each metric by a rough "typical magnitude" so no single stat dominates.
  const windowWeights = [
    { w: l3, weight: sustainedRoleChange ? 0.2 : 0.35 },
    { w: l5, weight: 0.35 },
    { w: l10, weight: sustainedRoleChange ? 0.45 : 0.3 },
  ];

  function windowLean(w) {
    const parts = [
      w.minutesSlope !== null ? clamp(w.minutesSlope / 3, -1, 1) * 0.35 : null,
      w.fgaSlope !== null ? clamp(w.fgaSlope / 2, -1, 1) * 0.25 : null,
      w.usageProxySlope !== null ? clamp(w.usageProxySlope / 2.5, -1, 1) * 0.2 : null,
      w.pointsSlope !== null ? clamp(w.pointsSlope / 3, -1, 1) * 0.2 : null,
    ].filter((v) => v !== null);
    if (!parts.length) return null;
    return parts.reduce((s, v) => s + v, 0);
  }

  let weightedSum = 0;
  let weightTotal = 0;
  for (const { w, weight } of windowWeights) {
    const lean = windowLean(w);
    if (lean === null || w.sampleSize < 2) continue;
    weightedSum += lean * weight;
    weightTotal += weight;
  }

  const shrink = sampleShrinkage(l10.sampleSize, 8);
  let normalizedSignal = weightTotal > 0 ? clamp((weightedSum / weightTotal) * shrink, -1, 1) : 0;

  // A pure one-game blip shouldn't drive a confident directional vote.
  if (oneGameBlip && !sustainedRoleChange) {
    normalizedSignal = Number((normalizedSignal * 0.3).toFixed(3));
  }
  normalizedSignal = Number(normalizedSignal.toFixed(3));

  const sampleSize = l10.sampleSize;
  let quality = ENGINE_SIGNAL_QUALITY.UNAVAILABLE;
  if (sampleSize >= 8) quality = ENGINE_SIGNAL_QUALITY.STRONG;
  else if (sampleSize >= 5) quality = ENGINE_SIGNAL_QUALITY.USABLE;
  else if (sampleSize >= 3) quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;
  else quality = ENGINE_SIGNAL_QUALITY.EARLY;

  const reasons = [];
  if (sustainedRoleChange) {
    reasons.push(
      `Sustained role change detected: L5 minutes slope ${l5.minutesSlope}, L10 minutes slope ${l10.minutesSlope}.`
    );
  } else if (oneGameBlip) {
    reasons.push("Last game deviates sharply from recent baseline — treated as a one-game blip, not a trend.");
  } else {
    reasons.push("No strong sustained role trend detected.");
  }

  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  if (sustainedRoleChange) {
    confidenceAdjustment = clamp(Math.round(5 * shrink) * Math.sign(normalizedSignal || 1), -6, 6);
  } else if (oneGameBlip) {
    riskAdjustment = RISK_ADJUSTMENT.MONITOR;
    confidenceAdjustment = 0;
  }

  const { overContribution, underContribution } = contributionsFromSignal(normalizedSignal);

  return baseEngineSignal({
    engine: ROLE_VELOCITY_ENGINE,
    available: true,
    source: "game_logs",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize,
    quality,
    stale: false,
    fallbackUsed: false,
    rawValues: { l3, l5, l10, lastGameMinutes, priorAvgMinutes, minutesStdevRecent },
    normalizedSignal,
    overContribution,
    underContribution,
    confidenceAdjustment,
    riskAdjustment,
    reason: reasons.join(" "),
    units: "slope_per_game",

    oneGameBlip,
    sustainedRoleChange,
    l3,
    l5,
    l10,
  });
}
