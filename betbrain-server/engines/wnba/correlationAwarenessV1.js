/**
 * Correlation awareness V1 — identify/store/display only.
 * Does NOT alter Official membership in V1.
 */
import { normalizePropTypeV1 } from "./propTypeV1.js";

export const CORRELATION_AWARENESS_V1_BUILD =
  "courteedge-correlation-awareness-v1";

function clean(v = "") {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Stamp correlationGroup + reasons on candidates (same player or opposing thesis).
 */
export function stampCorrelationGroupsV1(candidates = []) {
  const out = candidates.map((c) => ({ ...c }));
  const byPlayer = new Map();
  const byGame = new Map();

  for (let i = 0; i < out.length; i += 1) {
    const c = out[i];
    const player = clean(c.playerName || c.player || c.players);
    const eventId = String(c.eventId || c.gameId || "");
    const pt = normalizePropTypeV1(c.propType || c.stat) || "POINTS";
    const side = String(c.selectedSide || c.side || "").toUpperCase();
    if (player) {
      if (!byPlayer.has(player)) byPlayer.set(player, []);
      byPlayer.get(player).push(i);
    }
    if (eventId) {
      if (!byGame.has(eventId)) byGame.set(eventId, []);
      byGame.get(eventId).push(i);
    }
    out[i].propType = pt;
    out[i]._sideNorm = side;
  }

  for (const [player, idxs] of byPlayer.entries()) {
    if (idxs.length < 2) continue;
    const group = `player:${player}`;
    for (const i of idxs) {
      const reasons = [];
      const self = out[i];
      for (const j of idxs) {
        if (i === j) continue;
        const other = out[j];
        if (self._sideNorm && self._sideNorm === other._sideNorm) {
          reasons.push(
            `SAME_PLAYER_SAME_SIDE_${self.propType}_${other.propType}`
          );
        } else {
          reasons.push(
            `SAME_PLAYER_MULTI_STAT_${self.propType}_${other.propType}`
          );
        }
      }
      out[i].correlationGroup = group;
      out[i].correlationReasons = [...new Set(reasons)];
    }
  }

  // Light game-level opposing rebound pair stamp (research only)
  for (const [, idxs] of byGame.entries()) {
    const reb = idxs.filter((i) => out[i].propType === "REBOUNDS");
    if (reb.length < 2) continue;
    for (const i of reb) {
      const reasons = out[i].correlationReasons || [];
      reasons.push("SAME_GAME_REBOUND_MARKETS");
      out[i].correlationGroup =
        out[i].correlationGroup || `game-reb:${out[i].eventId || ""}`;
      out[i].correlationReasons = [...new Set(reasons)];
    }
  }

  return out.map(({ _sideNorm, ...rest }) => rest);
}
