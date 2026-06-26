/**
 * Probe Azura Stevens matchup vs portlandfire on 6/26 slate.
 */
import {
  findBallPlayer,
  fetchPlayerStats,
  fetchLast3VsOpponent,
  probeWnbaMatchupLookup,
} from "../services/ballService.js";
import { resolveStableWnbaPlayerId } from "../engines/wnba/wnbaPlayerIdResolver.js";
import { resolveWnbaTeamId } from "../engines/wnba/wnbaTeamAliasResolver.js";
import { buildWnbaPlayerStatsUrl } from "../engines/wnba/wnbaMatchupLookupV1.js";

const beforeTime = "2026-06-26T23:30:00Z";
const playerTeam = "chicagosky";
const opponent = "portlandfire";

async function main() {
  const name = "Azura Stevens";
  const stable = resolveStableWnbaPlayerId(name);
  const player = await findBallPlayer(name, "WNBA");
  const playerId = String(player?.id || stable || "");

  const legacySeasonUrl = buildWnbaPlayerStatsUrl({
    playerId,
    seasonYear: 2026,
  });

  const probe = await probeWnbaMatchupLookup({
    playerName: name,
    playerId,
    playerTeam,
    opponent,
    beforeTime,
  });

  const games = await fetchPlayerStats(name, "WNBA");
  const vsPor = await fetchLast3VsOpponent(name, opponent, "WNBA", {
    beforeTime,
    playerTeam,
  });

  const june24 = probe.matchedGames?.find((g) =>
    String(g.date || "").startsWith("2026-06-24")
  );

  console.log(
    JSON.stringify(
      {
        stableOverride: stable,
        ballPlayerId: playerId,
        ballPlayerName: player ? `${player.first_name} ${player.last_name}` : name,
        playerTeam: resolveWnbaTeamId(playerTeam),
        opponent: resolveWnbaTeamId(opponent),
        urls: {
          before: {
            legacySeasonStats: legacySeasonUrl,
            note: "Old path: season player_stats + local opponent filter (no games probe)",
          },
          after: {
            games: probe.gamesUrl,
            playerStats: probe.fixedPlayerStatsUrl,
            wrongOpponentTeamStats: probe.wrongOpponentTeamStatsUrl,
            note: "Fixed: games by player team, then player_stats by game_ids only",
          },
        },
        probe: {
          classification: probe.classification,
          gamesCount: probe.gamesCount,
          matchedGameIds: probe.matchedGameIds,
          matchedGames: probe.matchedGames,
          playerStatsCount: probe.playerStatsCount,
          wrongQueryStatsCount: probe.wrongQueryStatsCount,
          legacySeasonFilterCount: probe.legacySeasonFilterCount,
          june24PorChiInBall: Boolean(june24),
          june24Game: june24 || null,
        },
        seasonGames: games.length,
        vsPortlandFire: vsPor.map((g) => ({
          date: g.date,
          pts: g.points,
          opp: g.opponentTeamId || g.opponent,
        })),
      },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
