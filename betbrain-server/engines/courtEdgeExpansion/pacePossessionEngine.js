/**
 * CourtEdge Engine Expansion — True Pace/Possession Engine.
 *
 * True pace is computed ONLY when FGA, FTA, OREB, and TOV are all present
 * for a game log entry: FGA + 0.44*FTA - OREB + TOV. Any game missing one of
 * those four fields is excluded from the true-pace sample — never
 * backfilled with a guess.
 *
 * scoringEnvironmentProxy (e.g. an implied-total-based proxy) is kept in
 * rawValues for reference but is NEVER treated as, or relabeled as, true
 * pace. The two concepts are always reported separately.
 */
import {
  numOrNull,
  clamp,
  avg,
  estimatedPossessions,
  leagueRegulationMinutes,
  normalizeLeague,
  sampleShrinkage,
  baseEngineSignal,
  emptyEngineSignal,
  contributionsFromSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const PACE_POSSESSION_ENGINE = "pacePossessionEngine";

function perGameTruePaceRate(game, regulationMinutes) {
  const possessions = estimatedPossessions(game?.fga, game?.fta, game?.oreb, game?.tov);
  const minutes = numOrNull(game?.minutes ?? game?.min);
  if (possessions === null || minutes === null || minutes <= 0) return null;
  // Extrapolate this game's possession involvement to a full regulation game.
  return Number(((possessions / minutes) * regulationMinutes).toFixed(3));
}

export function evaluateTruePacePossession(ctx = {}) {
  const league = normalizeLeague(ctx.league);
  const regulationMinutes = leagueRegulationMinutes(league);
  const gameLogs = Array.isArray(ctx.gameLogs) ? ctx.gameLogs : [];
  const scoringEnvironmentProxy = numOrNull(ctx.scoringEnvironmentProxy);

  const seasonRates = [];
  const recentRates = [];
  gameLogs.forEach((g, idx) => {
    const rate = perGameTruePaceRate(g, regulationMinutes);
    if (rate === null) return;
    seasonRates.push(rate);
    if (idx < 5) recentRates.push(rate); // gameLogs assumed most-recent-first
  });

  const truePaceAvailable = seasonRates.length >= 3;

  if (!truePaceAvailable) {
    return emptyEngineSignal(PACE_POSSESSION_ENGINE, "insufficient_fga_fta_oreb_tov_sample", {
      rawValues: {
        league,
        regulationMinutes,
        gamesWithCompleteBoxScore: seasonRates.length,
        totalGameLogs: gameLogs.length,
        scoringEnvironmentProxy,
      },
      truePaceAvailable: false,
      seasonTruePace: null,
      recentTruePace: null,
      scoringEnvironmentProxy,
    });
  }

  const seasonTruePace = avg(seasonRates);
  const recentTruePace = recentRates.length >= 2 ? avg(recentRates) : null;
  const shrink = sampleShrinkage(seasonRates.length, 10);

  let normalizedSignal = 0;
  const reasons = [];
  if (recentTruePace !== null && seasonTruePace !== null && seasonTruePace !== 0) {
    const relativeDelta = clamp((recentTruePace - seasonTruePace) / seasonTruePace, -1, 1);
    normalizedSignal = Number((relativeDelta * shrink).toFixed(3));
    reasons.push(
      `Recent true pace (${recentTruePace}/${regulationMinutes}min) vs season true pace (${seasonTruePace}).`
    );
  } else {
    reasons.push("Season true pace computed; recent window too thin to compare.");
  }

  if (scoringEnvironmentProxy !== null) {
    reasons.push(
      `scoringEnvironmentProxy=${scoringEnvironmentProxy} stored for reference only — NOT used as true pace.`
    );
  }

  let quality = ENGINE_SIGNAL_QUALITY.UNAVAILABLE;
  if (seasonRates.length >= 10) quality = ENGINE_SIGNAL_QUALITY.STRONG;
  else if (seasonRates.length >= 6) quality = ENGINE_SIGNAL_QUALITY.USABLE;
  else if (seasonRates.length >= 3) quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;

  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  if (recentTruePace !== null && Math.abs(normalizedSignal) >= 0.3) {
    confidenceAdjustment = clamp(Math.round(3 * shrink) * Math.sign(normalizedSignal), -4, 4);
  }
  if (seasonRates.length < gameLogs.length * 0.5) {
    riskAdjustment = RISK_ADJUSTMENT.MONITOR;
  }

  const { overContribution, underContribution } = contributionsFromSignal(normalizedSignal);

  return baseEngineSignal({
    engine: PACE_POSSESSION_ENGINE,
    available: true,
    source: "game_logs",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize: seasonRates.length,
    quality,
    stale: false,
    fallbackUsed: false,
    rawValues: {
      league,
      regulationMinutes,
      gamesWithCompleteBoxScore: seasonRates.length,
      totalGameLogs: gameLogs.length,
      seasonTruePace,
      recentTruePace,
      scoringEnvironmentProxy,
    },
    normalizedSignal,
    overContribution,
    underContribution,
    confidenceAdjustment,
    riskAdjustment,
    reason: reasons.join(" "),
    units: `possessions_per_${regulationMinutes}min`,

    truePaceAvailable: true,
    seasonTruePace,
    recentTruePace,
    scoringEnvironmentProxy,
  });
}
