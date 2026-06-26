/**
 * WNBA matchup lookup v1 — games-first Ball API flow and probe classifications.
 */
import { resolveWnbaTeamId, teamsMatch } from "./wnbaTeamAliasResolver.js";

export const MATCHUP_LOOKUP_VERSION = "wnba-matchup-lookup-v1";

export const MATCHUP_LOOKUP_CLASS = {
  MATCHUP_GAMES_EXIST: "MATCHUP_GAMES_EXIST",
  PLAYER_H2H_EXISTS: "PLAYER_H2H_EXISTS",
  PLAYER_DID_NOT_PLAY_IN_MATCHUP: "PLAYER_DID_NOT_PLAY_IN_MATCHUP",
  BALL_GAME_LOOKUP_EMPTY: "BALL_GAME_LOOKUP_EMPTY",
  BALL_PLAYER_STATS_EMPTY: "BALL_PLAYER_STATS_EMPTY",
  WRONG_QUERY_KEY_SUSPECTED: "WRONG_QUERY_KEY_SUSPECTED",
  FALLBACK_WNBA_MATCHUP_REQUIRED: "FALLBACK_WNBA_MATCHUP_REQUIRED",
  TRUE_NO_PLAYER_H2H: "TRUE_NO_PLAYER_H2H",
};

const WNBA_BASE = "https://api.balldontlie.io/wnba/v1";

function formatBallDate(value) {
  if (!value) return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  const direct = String(value).match(/^(\d{4}-\d{2}-\d{2})/);
  return direct ? direct[1] : "";
}

export function buildWnbaGamesMatchupUrl(ballPlayerTeamId, seasonYear, options = {}) {
  const params = new URLSearchParams();
  params.append("team_ids[]", String(ballPlayerTeamId));
  params.append("seasons[]", String(seasonYear));
  params.append("per_page", String(options.perPage || 100));

  const startDate =
    options.startDate || formatBallDate(options.beforeTime) || `${seasonYear}-01-01`;
  const endDate =
    options.endDate ||
    formatBallDate(options.beforeTime) ||
    `${seasonYear}-12-31`;

  if (startDate) params.append("start_date", startDate);
  if (endDate) params.append("end_date", endDate);
  if (options.seasonType != null) {
    params.append("season_type", String(options.seasonType));
  }

  return `${WNBA_BASE}/games?${params.toString()}`;
}

/**
 * Build player_stats URL. For matchup history use game_ids[] only — never opponent team_ids[].
 */
export function buildWnbaPlayerStatsUrl({
  playerId,
  gameIds = [],
  teamIds = [],
  seasonYear = null,
  perPage = 100,
} = {}) {
  const params = new URLSearchParams();
  params.append("player_ids[]", String(playerId));
  params.append("per_page", String(perPage));

  for (const gameId of gameIds) {
    params.append("game_ids[]", String(gameId));
  }
  for (const teamId of teamIds) {
    params.append("team_ids[]", String(teamId));
  }
  if (seasonYear != null) {
    params.append("seasons[]", String(seasonYear));
  }

  return `${WNBA_BASE}/player_stats?${params.toString()}`;
}

/** Documented anti-pattern: opponent team_id on player_stats (rows are on player's team). */
export function buildWrongOpponentTeamStatsUrl(playerId, opponentBallTeamId, seasonYear) {
  return buildWnbaPlayerStatsUrl({
    playerId,
    teamIds: [opponentBallTeamId],
    seasonYear,
  });
}

export function gameInvolvesBallTeams(game = {}, teamAId, teamBId) {
  const homeId = game?.home_team?.id;
  const awayId = game?.visitor_team?.id ?? game?.away_team?.id;
  if (!homeId || !awayId || !teamAId || !teamBId) return false;
  return (
    (homeId === teamAId && awayId === teamBId) ||
    (homeId === teamBId && awayId === teamAId)
  );
}

export function filterWnbaGamesVsOpponent(
  games = [],
  playerBallTeamId,
  opponentBallTeamId
) {
  return games.filter((game) =>
    gameInvolvesBallTeams(game, playerBallTeamId, opponentBallTeamId)
  );
}

export function classifyWnbaMatchupProbe(probe = {}) {
  const {
    gamesCount = 0,
    matchedGameIds = [],
    playerStatsCount = 0,
    wrongQueryStatsCount = 0,
    legacySeasonFilterCount = 0,
  } = probe;

  if (playerStatsCount > 0) {
    if (legacySeasonFilterCount === 0 && wrongQueryStatsCount === 0) {
      return MATCHUP_LOOKUP_CLASS.WRONG_QUERY_KEY_SUSPECTED;
    }
    return MATCHUP_LOOKUP_CLASS.PLAYER_H2H_EXISTS;
  }

  if (matchedGameIds.length > 0) {
    return MATCHUP_LOOKUP_CLASS.PLAYER_DID_NOT_PLAY_IN_MATCHUP;
  }

  if (gamesCount > 0) {
    return MATCHUP_LOOKUP_CLASS.MATCHUP_GAMES_EXIST;
  }

  if (legacySeasonFilterCount > 0) {
    return MATCHUP_LOOKUP_CLASS.FALLBACK_WNBA_MATCHUP_REQUIRED;
  }

  if (wrongQueryStatsCount === 0 && legacySeasonFilterCount === 0) {
    return MATCHUP_LOOKUP_CLASS.BALL_GAME_LOOKUP_EMPTY;
  }

  return MATCHUP_LOOKUP_CLASS.TRUE_NO_PLAYER_H2H;
}

export function mapProbeToRecoveryClass(matchupLookupClass = "") {
  switch (matchupLookupClass) {
    case MATCHUP_LOOKUP_CLASS.PLAYER_H2H_EXISTS:
    case MATCHUP_LOOKUP_CLASS.MATCHUP_GAMES_EXIST:
      return "FIXABLE_LOOKUP_FAILURE";
    case MATCHUP_LOOKUP_CLASS.WRONG_QUERY_KEY_SUSPECTED:
    case MATCHUP_LOOKUP_CLASS.BALL_PLAYER_STATS_EMPTY:
    case MATCHUP_LOOKUP_CLASS.FALLBACK_WNBA_MATCHUP_REQUIRED:
      return "FIXABLE_LOOKUP_FAILURE";
    case MATCHUP_LOOKUP_CLASS.PLAYER_DID_NOT_PLAY_IN_MATCHUP:
      return "TRUE_NO_PLAYER_H2H";
    case MATCHUP_LOOKUP_CLASS.BALL_GAME_LOOKUP_EMPTY:
      return "NEEDS_FALLBACK_SOURCE";
    case MATCHUP_LOOKUP_CLASS.TRUE_NO_PLAYER_H2H:
      return "TRUE_NO_PLAYER_H2H";
    default:
      return "FIXABLE_LOOKUP_FAILURE";
  }
}

export function summarizeMatchupUrls({
  playerId,
  playerBallTeamId,
  opponentBallTeamId,
  matchedGameIds = [],
  seasonYear,
  beforeTime = null,
}) {
  const gamesUrl = buildWnbaGamesMatchupUrl(playerBallTeamId, seasonYear, {
    beforeTime,
    startDate: `${seasonYear}-01-01`,
    endDate: formatBallDate(beforeTime) || `${seasonYear}-12-31`,
  });
  const fixedStatsUrl = buildWnbaPlayerStatsUrl({
    playerId,
    gameIds: matchedGameIds,
  });
  const wrongStatsUrl = opponentBallTeamId
    ? buildWrongOpponentTeamStatsUrl(playerId, opponentBallTeamId, seasonYear)
    : null;
  const legacySeasonUrl = buildWnbaPlayerStatsUrl({
    playerId,
    seasonYear,
  });

  return {
    lookupMethod: "games-then-player_stats",
    gamesUrl,
    fixedPlayerStatsUrl: fixedStatsUrl,
    wrongOpponentTeamStatsUrl: wrongStatsUrl,
    legacySeasonStatsUrl: legacySeasonUrl,
    usesOpponentTeamIdOnPlayerStats: false,
    playerTeamCanonical: resolveWnbaTeamId(playerBallTeamId) || "",
    opponentTeamCanonical: resolveWnbaTeamId(opponentBallTeamId) || "",
  };
}

export function teamsMatchCanonical(teamA, teamB) {
  return teamsMatch(teamA, teamB);
}
