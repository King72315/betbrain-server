/**
 * Input-integrity gate for Official PTS.
 * Does not change the PTS projection formula.
 * Blocks publication when the current engine has no real player history.
 */
export const BLOCKED_MISSING_PLAYER_HISTORY = "BLOCKED_MISSING_PLAYER_HISTORY";

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function last5Points(last5 = []) {
  return (last5 || [])
    .map((g) => num(g?.points ?? g?.PTS ?? g?.pts))
    .filter((n) => n > 0);
}

export function inspectPtsHistoryInputs({
  last5 = [],
  seasonAverage = 0,
  playerState = {},
} = {}) {
  const games = Array.isArray(last5) ? last5 : [];
  const scored = last5Points(games);
  const seasonPts = num(
    playerState.seasonPoints ?? playerState.seasonAverage ?? seasonAverage
  );
  const recentPts =
    scored.length > 0
      ? scored.reduce((s, n) => s + n, 0) / scored.length
      : num(playerState.recentPoints);
  const hydrated = scored.length >= 1 || seasonPts > 0;
  return {
    last5Count: games.length,
    last5ScoredCount: scored.length,
    seasonPts,
    recentPts,
    hydrated,
    blockReason: hydrated ? null : BLOCKED_MISSING_PLAYER_HISTORY,
  };
}

export function isPtsHistoryMissing(input = {}) {
  return inspectPtsHistoryInputs(input).hydrated !== true;
}

export function shouldBlockOfficialPtsPublication(packet = {}) {
  const market = String(packet.propType || packet.stat || packet.market || "").toUpperCase();
  if (market && !market.includes("PT") && market !== "POINTS") return false;
  const hasHistoryFields =
    Array.isArray(packet.last5) ||
    packet.seasonAverage != null ||
    packet.playerState != null ||
    packet.last5Average != null ||
    packet.integrityBlock === BLOCKED_MISSING_PLAYER_HISTORY;
  if (!hasHistoryFields) return false;
  if (packet.integrityBlock === BLOCKED_MISSING_PLAYER_HISTORY) return true;
  return isPtsHistoryMissing({
    last5: packet.last5 || packet.bdlLast5 || packet.dataCard?.last5 || [],
    seasonAverage: packet.seasonAverage ?? packet.last5Average ?? packet.seasonPts,
    playerState: packet.playerState || {
      seasonPoints: packet.seasonAverage ?? packet.season,
      recentPoints: packet.last5Average ?? packet.recentPoints,
    },
  });
}
