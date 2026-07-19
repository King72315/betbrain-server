/**
 * CourtEdge Engine Expansion — Teammate Impact Engine.
 *
 * Compares a player's production in games where a relevant, verified-out
 * teammate was inactive vs games where that teammate played. Only teammates
 * with a verified OUT/DOUBTFUL status AND a resolvable per-game
 * active/inactive split in gameLogs are considered — an unrelated injury
 * (no resolvable split, or a teammate not flagged relevant) never produces
 * a boost.
 *
 * Small with/without samples are shrunk toward zero rather than trusted at
 * face value.
 */
import {
  numOrNull,
  clamp,
  avg,
  sampleShrinkage,
  baseEngineSignal,
  emptyEngineSignal,
  contributionsFromSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const TEAMMATE_IMPACT_ENGINE = "teammateImpactEngine";

function normalizeStatusText(value) {
  return String(value || "").trim().toLowerCase();
}

function isOutStatus(text = "") {
  return (
    text.includes("out") ||
    text.includes("inactive") ||
    text.includes("doubtful") ||
    text.includes("suspended") ||
    text.includes("injured reserve")
  );
}

/** Resolves whether a teammate was active for a given game log entry. */
function wasTeammateActive(game, teammateKey) {
  const flag = game?.teammatesActive;
  if (flag === undefined || flag === null) return null;
  if (Array.isArray(flag)) {
    if (!flag.length) return null;
    return flag.some(
      (id) => String(id).toLowerCase() === String(teammateKey).toLowerCase()
    );
  }
  if (typeof flag === "object") {
    const val = flag[teammateKey];
    if (val === undefined) return null;
    return Boolean(val);
  }
  return null;
}

export function evaluateTeammateImpact(ctx = {}) {
  const teammateStatuses = Array.isArray(ctx.teammateStatuses) ? ctx.teammateStatuses : [];
  const gameLogs = Array.isArray(ctx.gameLogs) ? ctx.gameLogs : [];

  const missingTeammates = teammateStatuses.filter((t) => {
    const text = normalizeStatusText(t?.status);
    const verified = t?.verified !== false; // undefined => treat as verified when a status is given
    return text && isOutStatus(text) && verified;
  });

  if (!missingTeammates.length || !gameLogs.length) {
    return emptyEngineSignal(
      TEAMMATE_IMPACT_ENGINE,
      !missingTeammates.length ? "no_verified_missing_teammates" : "no_game_log_data_provided",
      { rawValues: { teammateStatusCount: teammateStatuses.length, gameLogCount: gameLogs.length } }
    );
  }

  const perTeammate = [];
  for (const teammate of missingTeammates) {
    const key = teammate.playerId || teammate.id || teammate.name;
    if (!key) continue;

    const withTeammate = [];
    const withoutTeammate = [];
    for (const game of gameLogs) {
      const active = wasTeammateActive(game, key);
      const points = numOrNull(game?.points ?? game?.pts);
      if (active === null || points === null) continue; // unresolved game — never assumed
      if (active) withTeammate.push(points);
      else withoutTeammate.push(points);
    }

    if (withoutTeammate.length < 2) {
      perTeammate.push({
        teammate: teammate.name || key,
        resolvable: false,
        reason: "fewer than 2 games with a resolvable without-teammate split",
        withSampleSize: withTeammate.length,
        withoutSampleSize: withoutTeammate.length,
      });
      continue;
    }

    const withAvg = withTeammate.length ? avg(withTeammate) : null;
    const withoutAvg = avg(withoutTeammate);
    const delta = withAvg !== null ? Number((withoutAvg - withAvg).toFixed(2)) : null;
    const shrink = sampleShrinkage(withoutTeammate.length, 6);

    perTeammate.push({
      teammate: teammate.name || key,
      resolvable: true,
      status: teammate.status,
      withSampleSize: withTeammate.length,
      withoutSampleSize: withoutTeammate.length,
      withAvg,
      withoutAvg,
      delta,
      shrink,
    });
  }

  const resolvable = perTeammate.filter((t) => t.resolvable && t.delta !== null);

  if (!resolvable.length) {
    return emptyEngineSignal(TEAMMATE_IMPACT_ENGINE, "no_resolvable_with_without_split", {
      rawValues: { perTeammate },
    });
  }

  let weightedDeltaSum = 0;
  let weightSum = 0;
  for (const t of resolvable) {
    weightedDeltaSum += t.delta * t.shrink;
    weightSum += t.shrink;
  }
  const weightedDelta = weightSum > 0 ? Number((weightedDeltaSum / weightSum).toFixed(2)) : 0;

  // Scale points delta to -1..1 — an 8-point swing is treated as a strong signal.
  const normalizedSignal = clamp(weightedDelta / 8, -1, 1);

  const totalWithoutSample = resolvable.reduce((s, t) => s + t.withoutSampleSize, 0);
  let quality = ENGINE_SIGNAL_QUALITY.EARLY;
  if (totalWithoutSample >= 8) quality = ENGINE_SIGNAL_QUALITY.STRONG;
  else if (totalWithoutSample >= 5) quality = ENGINE_SIGNAL_QUALITY.USABLE;
  else if (totalWithoutSample >= 3) quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;

  const reasons = resolvable.map(
    (t) =>
      `${t.teammate} out: ${t.delta >= 0 ? "+" : ""}${t.delta} pts avg (with n=${t.withSampleSize}, without n=${t.withoutSampleSize}).`
  );

  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  if (Math.abs(normalizedSignal) >= 0.25) {
    confidenceAdjustment = clamp(Math.round(5 * Math.abs(normalizedSignal)) * Math.sign(normalizedSignal), -5, 5);
  }
  if (totalWithoutSample < 4) {
    riskAdjustment = RISK_ADJUSTMENT.MONITOR;
  }

  const { overContribution, underContribution } = contributionsFromSignal(normalizedSignal);

  return baseEngineSignal({
    engine: TEAMMATE_IMPACT_ENGINE,
    available: true,
    source: "game_logs_and_teammate_status",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize: totalWithoutSample,
    quality,
    stale: false,
    fallbackUsed: false,
    rawValues: { perTeammate },
    normalizedSignal,
    overContribution,
    underContribution,
    confidenceAdjustment,
    riskAdjustment,
    reason: reasons.join(" "),
    units: "points",

    missingTeammates: missingTeammates.map((t) => t.name || t.playerId || t.id),
    weightedDelta,
    perTeammate,
  });
}
