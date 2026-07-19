/**
 * CourtEdge Engine Expansion — Defensive Archetype Engine.
 *
 * Builds a lightweight player archetype from whatever volume dimensions are
 * actually available (minutes/usage-proxy/shot volume — position is NOT
 * fabricated when missing), then looks at how the opponent has performed
 * against comparable archetypes when a real box-score sample exists.
 *
 * No sample -> available:false. This engine never invents a position or a
 * comparable-opponent sample size.
 */
import {
  numOrNull,
  clamp,
  avg,
  stdev,
  sampleShrinkage,
  baseEngineSignal,
  emptyEngineSignal,
  contributionsFromSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const DEFENSIVE_ARCHETYPE_ENGINE = "defensiveArchetypeEngine";

function volumeSeries(games = [], field, aliases = []) {
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

/** Classifies a volume-only archetype tier — no position required. */
function classifyVolumeTier(avgMinutes, avgFga, avgFta) {
  const usageProxy = (avgFga ?? 0) + 0.44 * (avgFta ?? 0);
  if (avgMinutes === null && avgFga === null) return "UNKNOWN";
  if ((avgMinutes ?? 0) >= 30 && usageProxy >= 12) return "PRIMARY_SCORER";
  if ((avgMinutes ?? 0) >= 24 && usageProxy >= 7) return "SECONDARY_SCORER";
  if ((avgMinutes ?? 0) >= 15) return "ROLE_PLAYER";
  return "LIMITED_ROLE";
}

export function evaluateDefensiveArchetype(ctx = {}) {
  const gameLogs = Array.isArray(ctx.gameLogs) ? ctx.gameLogs : [];
  const archetypeComparables = Array.isArray(ctx.archetypeComparables) ? ctx.archetypeComparables : [];
  const opponentDefenseContext = ctx.opponentDefenseContext || null;
  const declaredPosition = ctx.position || ctx.playerPosition || null;

  const recentGames = gameLogs.slice(0, 10);
  const minutesSeries = volumeSeries(recentGames, "minutes", ["min"]);
  const fgaSeries = volumeSeries(recentGames, "fga", []);
  const ftaSeries = volumeSeries(recentGames, "fta", []);
  const threePaSeries = volumeSeries(recentGames, "threePA", ["threePa", "fg3a"]);

  const haveOwnSample = minutesSeries.length >= 3 || fgaSeries.length >= 3;

  if (!haveOwnSample && archetypeComparables.length === 0) {
    return emptyEngineSignal(DEFENSIVE_ARCHETYPE_ENGINE, "no_archetype_or_comparable_sample", {
      rawValues: { declaredPosition, ownSampleSize: recentGames.length, comparableSampleSize: 0 },
    });
  }

  const avgMinutes = minutesSeries.length ? avg(minutesSeries) : null;
  const avgFga = fgaSeries.length ? avg(fgaSeries) : null;
  const avgFta = ftaSeries.length ? avg(ftaSeries) : null;
  const avgThreePa = threePaSeries.length ? avg(threePaSeries) : null;
  const volumeTier = haveOwnSample ? classifyVolumeTier(avgMinutes, avgFga, avgFta) : "UNKNOWN";

  // Comparable-opponent evidence: only trust it with a real box-score sample.
  const comparablePts = archetypeComparables
    .map((c) => numOrNull(c?.points ?? c?.pts))
    .filter((v) => v !== null);
  const comparableSampleSize = comparablePts.length;
  const comparableAvailable = comparableSampleSize >= 3;
  const avgPointsAllowedToArchetype = comparableAvailable ? avg(comparablePts) : null;
  const comparableStdev = comparableAvailable ? stdev(comparablePts) : null;
  const comparableShrink = sampleShrinkage(comparableSampleSize, 8);

  // Fold in structured opponent context when the caller supplied it (kept
  // separate — never merged silently with the box-score comparable sample).
  const opponentPointsAllowedByArchetype =
    opponentDefenseContext && typeof opponentDefenseContext === "object"
      ? numOrNull(
          opponentDefenseContext.pointsAllowedToArchetype ??
            opponentDefenseContext.pointsAllowedByTier?.[volumeTier]
        )
      : null;

  const seasonAvg = numOrNull(ctx.seasonAverage);

  let normalizedSignal = 0;
  const reasons = [];
  let referenceUsed = null;
  if (comparableAvailable && seasonAvg !== null && seasonAvg !== 0) {
    const diff = avgPointsAllowedToArchetype - seasonAvg;
    normalizedSignal = clamp((diff / Math.max(seasonAvg, 4)) * comparableShrink, -1, 1);
    referenceUsed = "archetype_comparables";
    reasons.push(
      `Opponent allows ${avgPointsAllowedToArchetype} to comparable archetypes vs player's season average of ${seasonAvg}.`
    );
  } else if (opponentPointsAllowedByArchetype !== null && seasonAvg !== null && seasonAvg !== 0) {
    const diff = opponentPointsAllowedByArchetype - seasonAvg;
    normalizedSignal = clamp((diff / Math.max(seasonAvg, 4)) * 0.6, -1, 1);
    referenceUsed = "opponent_defense_context";
    reasons.push(
      `Opponent context reports ${opponentPointsAllowedByArchetype} allowed to ${volumeTier} tier vs season average of ${seasonAvg}.`
    );
  } else {
    reasons.push("No usable opponent-vs-archetype comparison — archetype built for reference only.");
  }

  const sampleSize = comparableSampleSize + recentGames.length;
  let quality = ENGINE_SIGNAL_QUALITY.UNAVAILABLE;
  if (comparableSampleSize >= 8) quality = ENGINE_SIGNAL_QUALITY.STRONG;
  else if (comparableSampleSize >= 5) quality = ENGINE_SIGNAL_QUALITY.USABLE;
  else if (comparableSampleSize >= 3) quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;
  else if (haveOwnSample) quality = ENGINE_SIGNAL_QUALITY.EARLY;

  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  if (referenceUsed && Math.abs(normalizedSignal) >= 0.35) {
    confidenceAdjustment = Math.round(3 * comparableShrink) * (normalizedSignal > 0 ? 1 : -1);
  } else if (!referenceUsed) {
    riskAdjustment = RISK_ADJUSTMENT.MONITOR;
  }
  confidenceAdjustment = clamp(confidenceAdjustment, -5, 5);

  const { overContribution, underContribution } = contributionsFromSignal(normalizedSignal);

  return baseEngineSignal({
    engine: DEFENSIVE_ARCHETYPE_ENGINE,
    available: Boolean(referenceUsed) || haveOwnSample,
    source: comparableAvailable ? "archetype_comparables" : "opponent_defense_context",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize,
    quality,
    stale: false,
    fallbackUsed: !comparableAvailable && opponentPointsAllowedByArchetype !== null,
    rawValues: {
      declaredPosition,
      positionFabricated: false,
      avgMinutes,
      avgFga,
      avgFta,
      avgThreePa,
      volumeTier,
      comparableSampleSize,
      avgPointsAllowedToArchetype,
      comparableStdev,
      opponentPointsAllowedByArchetype,
      seasonAvg,
    },
    normalizedSignal,
    overContribution,
    underContribution,
    confidenceAdjustment,
    riskAdjustment,
    reason: reasons.join(" "),
    units: "points",

    volumeTier,
    positionAvailable: Boolean(declaredPosition),
    archetypeBasis: declaredPosition ? "POSITION_AND_VOLUME" : "VOLUME_ONLY",
    comparableAvailable,
  });
}
