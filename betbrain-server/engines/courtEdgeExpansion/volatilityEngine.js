/**
 * CourtEdge Engine Expansion — Player Volatility Engine.
 *
 * Measures consistency, not direction: stdev, coefficient of variation,
 * MAD, IQR, boom/bust rates, and recent-vs-season volatility. League
 * scoring/rotation patterns differ, so the CV baseline used to judge
 * "high volatility" is league-specific.
 *
 * IMPORTANT: volatility widens the plausible range of outcomes and may
 * reduce confidence, but it never casts an Over/Under vote by itself.
 * normalizedSignal stays 0 for this engine by design.
 */
import {
  numOrNull,
  clamp,
  avg,
  stdev,
  mad,
  iqr,
  normalizeLeague,
  baseEngineSignal,
  emptyEngineSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const VOLATILITY_ENGINE = "volatilityEngine";

// Rough CV baselines observed for scoring props; used only to bucket
// volatility as LOW/MODERATE/HIGH, never to fabricate a directional lean.
const CV_BASELINE = Object.freeze({
  NBA: { moderate: 0.35, high: 0.55 },
  WNBA: { moderate: 0.4, high: 0.6 },
});

function pointsOf(games = []) {
  return (games || [])
    .map((g) => numOrNull(g?.points ?? g?.pts))
    .filter((v) => v !== null);
}

function boomBustRates(values = []) {
  const mean = avg(values);
  const sd = stdev(values);
  if (mean === null || sd === null || sd === 0) {
    return { boomRate: null, bustRate: null, boomThreshold: null, bustThreshold: null };
  }
  const boomThreshold = Number((mean + sd).toFixed(2));
  const bustThreshold = Number((mean - sd).toFixed(2));
  const boomCount = values.filter((v) => v >= boomThreshold).length;
  const bustCount = values.filter((v) => v <= bustThreshold).length;
  return {
    boomRate: Number((boomCount / values.length).toFixed(3)),
    bustRate: Number((bustCount / values.length).toFixed(3)),
    boomThreshold,
    bustThreshold,
  };
}

export function evaluatePlayerVolatility(ctx = {}) {
  const league = normalizeLeague(ctx.league);
  const gameLogs = Array.isArray(ctx.gameLogs) ? ctx.gameLogs : [];
  const seasonPts = pointsOf(gameLogs);
  const recentPts = seasonPts.slice(0, 5); // gameLogs assumed most-recent-first

  if (seasonPts.length < 3) {
    return emptyEngineSignal(VOLATILITY_ENGINE, "insufficient_game_log_sample", {
      rawValues: { league, sampleSize: seasonPts.length },
    });
  }

  const mean = avg(seasonPts);
  const sd = stdev(seasonPts);
  const cv = mean && sd !== null && mean !== 0 ? Number((sd / mean).toFixed(3)) : null;
  const madValue = mad(seasonPts);
  const { q1, q3, iqr: iqrValue } = iqr(seasonPts);
  const { boomRate, bustRate, boomThreshold, bustThreshold } = boomBustRates(seasonPts);

  const recentSd = recentPts.length >= 3 ? stdev(recentPts) : null;
  const recentMean = recentPts.length >= 3 ? avg(recentPts) : null;
  const recentCv =
    recentMean && recentSd !== null && recentMean !== 0 ? Number((recentSd / recentMean).toFixed(3)) : null;

  let volatilityTrend = "STABLE";
  if (cv !== null && recentCv !== null) {
    if (recentCv > cv * 1.25) volatilityTrend = "INCREASING";
    else if (recentCv < cv * 0.75) volatilityTrend = "DECREASING";
  } else {
    volatilityTrend = "UNKNOWN";
  }

  const baseline = CV_BASELINE[league] || CV_BASELINE.NBA;
  let volatilityTier = "LOW";
  if (cv !== null) {
    if (cv >= baseline.high) volatilityTier = "HIGH";
    else if (cv >= baseline.moderate) volatilityTier = "MODERATE";
  } else {
    volatilityTier = "UNKNOWN";
  }

  const sampleSize = seasonPts.length;
  let quality = ENGINE_SIGNAL_QUALITY.EARLY;
  if (sampleSize >= 15) quality = ENGINE_SIGNAL_QUALITY.STRONG;
  else if (sampleSize >= 8) quality = ENGINE_SIGNAL_QUALITY.USABLE;
  else if (sampleSize >= 5) quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;

  const reasons = [];
  if (volatilityTier === "HIGH") {
    reasons.push(`High volatility (CV ${cv}) vs ${league} baseline — range widened, no directional vote.`);
  } else if (volatilityTier === "MODERATE") {
    reasons.push(`Moderate volatility (CV ${cv}) vs ${league} baseline.`);
  } else if (volatilityTier === "LOW") {
    reasons.push(`Low volatility (CV ${cv}) — consistent recent production.`);
  }
  if (volatilityTrend === "INCREASING") reasons.push("Recent volatility trending up vs season.");
  if (volatilityTrend === "DECREASING") reasons.push("Recent volatility trending down vs season.");

  // Confidence is reduced (never increased) by volatility, and risk is
  // elevated — but no side is favored.
  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  if (volatilityTier === "HIGH") {
    confidenceAdjustment = -5;
    riskAdjustment = RISK_ADJUSTMENT.ELEVATE;
  } else if (volatilityTier === "MODERATE") {
    confidenceAdjustment = -2;
    riskAdjustment = RISK_ADJUSTMENT.MONITOR;
  }
  if (volatilityTrend === "INCREASING" && volatilityTier !== "LOW") {
    confidenceAdjustment -= 1;
  }
  confidenceAdjustment = clamp(confidenceAdjustment, -8, 0);

  return baseEngineSignal({
    engine: VOLATILITY_ENGINE,
    available: true,
    source: "game_logs",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize,
    quality,
    stale: false,
    fallbackUsed: false,
    rawValues: {
      league,
      seasonMean: mean,
      seasonStdev: sd,
      coefficientOfVariation: cv,
      mad: madValue,
      q1,
      q3,
      iqr: iqrValue,
      boomRate,
      bustRate,
      boomThreshold,
      bustThreshold,
      recentMean,
      recentStdev: recentSd,
      recentCoefficientOfVariation: recentCv,
      cvBaseline: baseline,
    },
    // Volatility never votes — widened range/confidence effects only.
    normalizedSignal: 0,
    overContribution: 0,
    underContribution: 0,
    confidenceAdjustment,
    riskAdjustment,
    reason: reasons.length ? reasons.join(" ") : "Volatility within normal range.",
    units: "points",

    volatilityTier,
    volatilityTrend,
    coefficientOfVariation: cv,
    boomRate,
    bustRate,
  });
}
