/**
 * CourtEdge Engine Expansion — Rest / Fatigue Engine.
 *
 * Reads the team's schedule (teamGameDates), the most recent game's OT
 * status, and recent minutes load to flag schedule-density fatigue: back to
 * backs, 3-in-4, 4-in-6, OT hangover, and minutes-load spikes.
 *
 * Travel distance is NOT resolvable from the context this engine receives
 * and is always reported as unavailable rather than guessed.
 *
 * Fatigue widens risk and may reduce confidence, but it never casts an
 * Over/Under vote on its own — normalizedSignal stays 0 by design.
 */
import {
  numOrNull,
  clamp,
  avg,
  baseEngineSignal,
  emptyEngineSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const REST_FATIGUE_ENGINE = "restFatigueEngine";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseDates(dates = []) {
  return (dates || [])
    .map((d) => {
      const t = new Date(d).getTime();
      return Number.isFinite(t) ? t : null;
    })
    .filter((t) => t !== null)
    .sort((a, b) => a - b);
}

export function evaluateRestFatigue(ctx = {}) {
  const teamGameDates = Array.isArray(ctx.teamGameDates) ? ctx.teamGameDates : [];
  const previousOt = ctx.previousOt === true;
  const gameLogs = Array.isArray(ctx.gameLogs) ? ctx.gameLogs : [];

  const sortedDates = parseDates(teamGameDates);
  const uniqueDates = [...new Set(sortedDates)];

  if (uniqueDates.length < 2) {
    return emptyEngineSignal(REST_FATIGUE_ENGINE, "insufficient_schedule_data", {
      rawValues: { teamGameDatesCount: teamGameDates.length, previousOt },
      travelAvailable: false,
      travelImpact: null,
    });
  }

  // Convention: the LAST entry is the game being evaluated; the one before
  // it is the most recent prior game. Callers must supply the schedule in
  // that shape — this engine does not guess which date is "today".
  const referenceDate = uniqueDates[uniqueDates.length - 1];
  const priorDate = uniqueDates[uniqueDates.length - 2];

  const restDays = Math.max(0, Math.round((referenceDate - priorDate) / DAY_MS) - 1);
  const isB2B = restDays === 0;

  const windowCount = (windowDays) =>
    uniqueDates.filter((d) => d <= referenceDate && referenceDate - d < windowDays * DAY_MS).length;

  const gamesInLast4Days = windowCount(4);
  const gamesInLast6Days = windowCount(6);
  const threeInFour = gamesInLast4Days >= 3;
  const fourInSix = gamesInLast6Days >= 4;

  const recentMinutes = gameLogs
    .slice(0, 5)
    .map((g) => numOrNull(g?.minutes ?? g?.min))
    .filter((v) => v !== null);
  const seasonMinutes = gameLogs
    .map((g) => numOrNull(g?.minutes ?? g?.min))
    .filter((v) => v !== null);
  const recentMinutesAvg = recentMinutes.length ? avg(recentMinutes) : null;
  const seasonMinutesAvg = seasonMinutes.length ? avg(seasonMinutes) : null;
  const minutesLoadDelta =
    recentMinutesAvg !== null && seasonMinutesAvg !== null
      ? Number((recentMinutesAvg - seasonMinutesAvg).toFixed(2))
      : null;
  const minutesLoadElevated = minutesLoadDelta !== null && minutesLoadDelta >= 3;

  // Travel is never resolvable without opponent/venue geodata in this context.
  const travelAvailable = false;
  const travelImpact = null;

  let fatigueScore = 0;
  const reasons = [];
  if (isB2B) {
    fatigueScore += 30;
    reasons.push("Back-to-back — 0 rest days.");
  } else if (restDays === 1) {
    fatigueScore += 5;
  }
  if (threeInFour) {
    fatigueScore += 20;
    reasons.push(`${gamesInLast4Days} games in last 4 days.`);
  }
  if (fourInSix) {
    fatigueScore += 15;
    reasons.push(`${gamesInLast6Days} games in last 6 days.`);
  }
  if (previousOt) {
    fatigueScore += 12;
    reasons.push("Previous game went to overtime.");
  }
  if (minutesLoadElevated) {
    fatigueScore += 10;
    reasons.push(`Recent minutes load (${recentMinutesAvg}) elevated vs season average (${seasonMinutesAvg}).`);
  }
  fatigueScore = clamp(fatigueScore, 0, 100);

  const fatigueTier = fatigueScore >= 45 ? "HIGH" : fatigueScore >= 20 ? "MODERATE" : "LOW";

  const sampleSize = uniqueDates.length;
  let quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;
  if (sampleSize >= 8) quality = ENGINE_SIGNAL_QUALITY.STRONG;
  else if (sampleSize >= 5) quality = ENGINE_SIGNAL_QUALITY.USABLE;
  else if (sampleSize >= 3) quality = ENGINE_SIGNAL_QUALITY.EARLY;

  // Fatigue never votes; it only adjusts confidence/risk.
  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  if (fatigueTier === "HIGH") {
    confidenceAdjustment = -6;
    riskAdjustment = RISK_ADJUSTMENT.ELEVATE;
  } else if (fatigueTier === "MODERATE") {
    confidenceAdjustment = -3;
    riskAdjustment = RISK_ADJUSTMENT.MONITOR;
  }
  confidenceAdjustment = clamp(confidenceAdjustment, -8, 0);

  return baseEngineSignal({
    engine: REST_FATIGUE_ENGINE,
    available: true,
    source: "team_schedule",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize,
    quality,
    stale: false,
    fallbackUsed: false,
    rawValues: {
      teamGameDates,
      referenceDate: new Date(referenceDate).toISOString(),
      priorDate: new Date(priorDate).toISOString(),
      gamesInLast4Days,
      gamesInLast6Days,
      previousOt,
      recentMinutesAvg,
      seasonMinutesAvg,
      minutesLoadDelta,
    },
    // Fatigue never casts a directional vote by itself.
    normalizedSignal: 0,
    overContribution: 0,
    underContribution: 0,
    confidenceAdjustment,
    riskAdjustment,
    reason: reasons.length ? reasons.join(" ") : "No elevated fatigue signals detected.",
    units: "days",

    restDays,
    isB2B,
    threeInFour,
    fourInSix,
    otLoad: previousOt,
    minutesLoadElevated,
    fatigueScore,
    fatigueTier,
    travelAvailable,
    travelImpact,
  });
}
