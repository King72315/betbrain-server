/**
 * Independent REB/AST shadow universe.
 * Does not depend on Official PTS membership or reader NO_BET.
 */
import { normalizePropMarket, isShadowPropMarket } from "../engines/courtEdgeEraV1.js";

function countByMarket(rows = []) {
  const out = { POINTS: 0, REBOUNDS: 0, ASSISTS: 0, OTHER: 0 };
  for (const r of rows || []) {
    const m = normalizePropMarket(r.propType || r.stat || r.market || r.marketKey);
    if (out[m] != null) out[m] += 1;
    else out.OTHER += 1;
  }
  return out;
}

export function toShadowPacketsFromLines(rows = [], extras = {}) {
  return (rows || [])
    .filter((r) => isShadowPropMarket(r.propType || r.stat || r.market || r.marketKey))
    .map((r) => ({
      playerName: r.player || r.playerName,
      player: r.player || r.playerName,
      team: r.team || extras.team || null,
      opponent: r.opponent || extras.opponent || null,
      propType: normalizePropMarket(r.propType || r.stat || r.market || r.marketKey),
      line: r.line ?? r.officialLine,
      side: r.side || r.selectedSide || r.pick || null,
      projection: r.projection ?? null,
      last5: r.last5 || [],
      seasonAssists: r.seasonAssists,
      seasonRebounds: r.seasonRebounds,
      seasonMinutes: r.seasonMinutes,
      officialSelected: false,
      trackingType: "SHADOW_RESEARCH",
      shadowMarket: true,
      source: extras.source || "CONSENSUS_LINE",
    }));
}

export function collectShadowUniverseFromGames(games = []) {
  const packets = [];
  const coverage = {
    gamesQueried: 0,
    rawCounts: { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 },
    consensusCounts: { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 },
    generatedCounts: { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 },
    rejectedCounts: { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 },
    provider: "ODDS_API",
    dropReasons: {},
  };
  for (const game of games || []) {
    if (String(game.league || "").toUpperCase() !== "WNBA") continue;
    coverage.gamesQueried += 1;
    const raw = game.shadowMarketAudit?.rawCounts || countByMarket(game.rawPlayerProps || []);
    const consensus = countByMarket(game.consensusPlayerProps || game.shadowLinePackets || []);
    const generated = countByMarket(game.allGeneratedCandidates || []);
    const rejected = countByMarket(game.rejectedPicks || []);
    for (const k of ["POINTS", "REBOUNDS", "ASSISTS"]) {
      coverage.rawCounts[k] += raw[k] || 0;
      coverage.consensusCounts[k] += consensus[k] || 0;
      coverage.generatedCounts[k] += generated[k] || 0;
      coverage.rejectedCounts[k] += rejected[k] || 0;
    }
    if (game.shadowMarketAudit?.dropReason) {
      const d = game.shadowMarketAudit.dropReason;
      coverage.dropReasons[d] = (coverage.dropReasons[d] || 0) + 1;
    }
    packets.push(
      ...toShadowPacketsFromLines(game.shadowLinePackets || game.consensusPlayerProps || [], {
        team: game.homeTeam,
        opponent: game.awayTeam,
        source: "GAME_CONSENSUS",
      }),
      ...toShadowPacketsFromLines(game.allGeneratedCandidates || [], { source: "GENERATED" }),
      ...toShadowPacketsFromLines(game.rejectedPicks || [], { source: "REJECTED" })
    );
  }
  const seen = new Set();
  const unique = [];
  for (const p of packets) {
    const id = `${p.player}|${p.propType}|${p.line}`;
    if (seen.has(id)) continue;
    seen.add(id);
    unique.push(p);
  }
  coverage.resolvedPlayerCount = new Set(unique.map((p) => p.player)).size;
  coverage.analyzedReb = unique.filter((p) => p.propType === "REBOUNDS").length;
  coverage.analyzedAst = unique.filter((p) => p.propType === "ASSISTS").length;
  if (coverage.gamesQueried === 0) coverage.zeroReason = "NO_WNBA_GAMES";
  else if (coverage.rawCounts.REBOUNDS + coverage.rawCounts.ASSISTS === 0) {
    coverage.zeroReason = "PROVIDER_RETURNED_ZERO_REB_AST";
  } else if (coverage.consensusCounts.REBOUNDS + coverage.consensusCounts.ASSISTS === 0) {
    coverage.zeroReason = "PARSER_DROPPED_REB_AST";
  } else if (unique.length === 0) {
    coverage.zeroReason = "RESOLVER_OR_FILTER_EXCLUDED";
  } else coverage.zeroReason = null;
  return { packets: unique, coverage };
}
