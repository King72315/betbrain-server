/**
 * Shared player/game context V1 — computed once, reused across POINTS/REB/AST.
 */
export const SHARED_PLAYER_CONTEXT_V1_BUILD =
  "courteedge-shared-player-context-v1";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function mean(arr = []) {
  const xs = arr.map(Number).filter(Number.isFinite);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function variance(arr = []) {
  const xs = arr.map(Number).filter(Number.isFinite);
  if (xs.length < 2) return null;
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length;
}

/**
 * Build one shared context packet from already-fetched player/game evidence.
 * Does not fetch — callers supply season/recent logs + game context.
 */
export function buildSharedPlayerGameContextV1(input = {}) {
  const last5 = Array.isArray(input.last5) ? input.last5 : [];
  const last10 = Array.isArray(input.last10) ? input.last10 : last5;
  const minutesL5 = last5.map((g) => num(g.minutes)).filter((n) => n != null);
  const pointsL5 = last5.map((g) => num(g.points)).filter((n) => n != null);
  const rebL5 = last5.map((g) => num(g.rebounds)).filter((n) => n != null);
  const astL5 = last5.map((g) => num(g.assists)).filter((n) => n != null);

  return {
    version: SHARED_PLAYER_CONTEXT_V1_BUILD,
    player: input.playerName || input.player || null,
    playerId: input.playerId || null,
    team: input.team || null,
    opponent: input.opponent || null,
    eventId: input.eventId || null,
    slateDateCT: input.slateDateCT || input.gameDate || null,
    homeAway: input.homeAway || null,
    starterBench: input.starterBench || input.starterStatus || null,
    availability: {
      status: input.availabilityStatus || null,
      certainty: num(input.availabilityCertaintyScore),
      teammateOut: Boolean(input.teammateOut),
      teammateReturning: Boolean(input.teammateReturning),
    },
    minutes: {
      expected: num(input.expectedMinutes),
      season: num(input.seasonMinutes),
      recentL5: mean(minutesL5),
      recentL10: mean(last10.map((g) => num(g.minutes)).filter((n) => n != null)),
      variance: variance(minutesL5),
      trend:
        minutesL5.length >= 3
          ? minutesL5[0] - minutesL5[minutesL5.length - 1]
          : null,
    },
    baselines: {
      seasonPoints: num(input.seasonPoints),
      seasonRebounds: num(input.seasonRebounds),
      seasonAssists: num(input.seasonAssists),
      recentPointsL5: mean(pointsL5),
      recentReboundsL5: mean(rebL5),
      recentAssistsL5: mean(astL5),
    },
    volume: {
      seasonFGA: num(input.seasonFGA),
      recentFGA: num(input.recentFGA),
      seasonFTA: num(input.seasonFTA),
      recentFTA: num(input.recentFTA),
    },
    gameContext: {
      pace: num(input.pace),
      spread: num(input.spread),
      gameTotal: num(input.gameTotal),
      impliedTeamTotal: num(input.impliedTeamTotal),
      restDays: num(input.restDays),
      blowoutRisk: num(input.blowoutRisk),
    },
    roleStability: num(input.roleStabilityScore),
    marketTimestamp: input.marketTimestamp || null,
    last5,
    last10,
  };
}
