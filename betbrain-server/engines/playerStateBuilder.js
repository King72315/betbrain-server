import {
  clean,
  getSeasonFGA,
  getSeasonMinutes,
  getSeasonPoints,
} from "../services/sportsDataService.js";
import { resolveWnbaGraduatedDataMode } from "./wnba/wnbaGraduatedDataModeV1.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avg(values = []) {
  const nums = values.map(num).filter((v) => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getSeasonFTA(playerName, seasonMap) {
  const season = seasonMap?.get?.(clean(playerName)) || {};

  const games = num(season.Games || season.GamesPlayed || 0);

  const ftaPerGame = num(
    season.FTAPerGame ||
      season.FreeThrowsAttemptedPerGame ||
      season.AverageFTA ||
      0
  );

  if (ftaPerGame > 0) return Number(ftaPerGame.toFixed(1));

  const fta = num(season.FreeThrowsAttempted || season.FTA || 0);

  if (fta > 0 && games > 0) {
    return Number((fta / games).toFixed(1));
  }

  return 0;
}

function computeEfficiency(points = 0, fga = 0, fta = 0) {
  const attempts = fga + fta * 0.44;
  if (attempts <= 0) return 0;
  return Number((points / attempts).toFixed(3));
}

function getHitRate(points = [], line = 0, side = "Over") {
  if (!line || !points.length) return null;
  const hits = points.filter((p) =>
    side === "Over" ? p > line : p < line
  ).length;
  return Math.round((hits / points.length) * 100);
}

function getVolatilityLabel(points = []) {
  if (!points.length) return "UNKNOWN";
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min;
  if (range >= 18) return "HIGH";
  if (range >= 11) return "MEDIUM";
  return "LOW";
}

function resolveSeasonFTA(playerName, seasonMap, bdlSeasonGames = []) {
  const fromMap = getSeasonFTA(playerName, seasonMap);
  if (fromMap > 0) return fromMap;
  return Number(avg(bdlSeasonGames.map((g) => g.fta)).toFixed(1));
}

function resolveSeasonMinutes(playerName, seasonMap, bdlSeasonGames = []) {
  const fromMap = getSeasonMinutes(playerName, seasonMap);
  if (fromMap > 0) return fromMap;
  return Number(avg(bdlSeasonGames.map((g) => g.minutes)).toFixed(1));
}

function resolveSeasonFGA(playerName, seasonMap, bdlSeasonGames = []) {
  const fromMap = getSeasonFGA(playerName, seasonMap);
  if (fromMap > 0) return fromMap;
  return Number(avg(bdlSeasonGames.map((g) => g.fga)).toFixed(1));
}

function buildDataAvailabilityFlags({
  league,
  last5 = [],
  seasonPoints = 0,
  seasonMinutes = 0,
  seasonFGA = 0,
  matchupGames = [],
  sportsProjection = 0,
  bookCount = 0,
}) {
  return {
    hasLast5: last5.length >= 3,
    hasSeasonStats: seasonPoints > 0,
    hasSeasonMinutes: seasonMinutes > 0,
    hasSeasonFGA: seasonFGA > 0,
    hasMatchupHistory: matchupGames.length > 0,
    hasSportsProjection: sportsProjection > 0,
    hasMarketData: bookCount > 0,
    league,
  };
}

function computeDataAvailability(flags = {}) {
  const checks = [
    flags.hasLast5,
    flags.hasSeasonStats,
    flags.hasSeasonMinutes,
    flags.hasSeasonFGA,
    flags.hasMarketData,
  ];
  const covered = checks.filter(Boolean).length;
  return Math.round((covered / checks.length) * 100);
}

function computeSourceConfidence(flags = {}, league = "NBA") {
  let score = 40;
  if (flags.hasLast5) score += 20;
  if (flags.hasSeasonStats) score += 15;
  if (flags.hasSeasonMinutes) score += 10;
  if (flags.hasSeasonFGA) score += 5;
  if (flags.hasMatchupHistory) score += 5;
  if (flags.hasSportsProjection) score += 10;
  if (flags.hasMarketData) score += 5;
  if (league === "NBA") score += 10;
  return clamp(Math.round(score), 0, 100);
}

export function buildPlayerState({
  playerName,
  playerId = "",
  league = "NBA",
  team = "",
  opponent = "",
  gameDate = "",
  commenceTime = "",
  prop = {},
  last5 = [],
  bdlSeasonGames = [],
  seasonMap = null,
  seasonAverage = 0,
  sportsProjection = 0,
  matchupGames = [],
  opportunity = {},
  stat = "Points",
} = {}) {
  const seasonKey =
    typeof seasonMap?.get === "function"
      ? seasonMap
      : new Map();

  const seasonPoints =
    seasonAverage > 0
      ? seasonAverage
      : league === "NBA"
        ? getSeasonPoints(playerName, seasonKey)
        : Number(avg(bdlSeasonGames.map((g) => g.points)).toFixed(1));

  const seasonMinutes = resolveSeasonMinutes(
    playerName,
    seasonKey,
    bdlSeasonGames
  );
  const seasonFGA = resolveSeasonFGA(playerName, seasonKey, bdlSeasonGames);
  const seasonFTA = resolveSeasonFTA(playerName, seasonKey, bdlSeasonGames);

  const recentPoints = Number(
    (opportunity.recentPoints ?? avg(last5.map((g) => g.points))).toFixed(1)
  );
  const recentMinutes = Number(
    (opportunity.recentMinutes ?? avg(last5.map((g) => g.minutes))).toFixed(1)
  );
  const recentFGA = Number(
    (opportunity.recentFGA ?? avg(last5.map((g) => g.fga))).toFixed(1)
  );
  const recentFTA = Number(
    (opportunity.recentFTA ?? avg(last5.map((g) => g.fta))).toFixed(1)
  );

  const seasonEfficiency = computeEfficiency(
    seasonPoints,
    seasonFGA,
    seasonFTA
  );
  const recentEfficiency = computeEfficiency(
    recentPoints,
    recentFGA,
    recentFTA
  );

  const pointsList = last5.map((g) => num(g.points));
  const line = num(prop.line);
  const last5HitRate = getHitRate(pointsList, line, "Over");
  const volatility =
    opportunity.scoringVolatility?.label ||
    getVolatilityLabel(pointsList);

  const matchupAverage = matchupGames.length
    ? Number(avg(matchupGames.map((g) => g.points)).toFixed(1))
    : null;

  const dataAvailabilityFlags = buildDataAvailabilityFlags({
    league,
    last5,
    seasonPoints,
    seasonMinutes,
    seasonFGA,
    matchupGames,
    sportsProjection,
    bookCount: num(prop.bookCount),
  });

  const dataMode =
    league === "WNBA"
      ? resolveWnbaGraduatedDataMode({
          league,
          dataAvailabilityFlags,
          playerId,
          last5Count: last5.length,
          seasonPoints,
          recentMinutes,
          seasonMinutes,
          recentFGA,
          seasonFGA,
          bookCount: num(prop.bookCount),
          projection: num(sportsProjection),
        })
      : "NBA_FULL_DATA";

  const dataAvailability = computeDataAvailability(dataAvailabilityFlags);
  const sourceConfidence = computeSourceConfidence(
    dataAvailabilityFlags,
    league
  );

  return {
    player: playerName,
    playerId: playerId || "",
    league,
    team,
    opponent,
    gameDate,
    commenceTime,
    bookLine: num(prop.line),
    bookCount: num(prop.bookCount),
    marketQuality: num(prop.marketQuality),
    lineSpread: num(prop.lineSpread),
    overOdds: prop.overOdds ?? null,
    underOdds: prop.underOdds ?? null,
    seasonPoints,
    recentPoints,
    seasonMinutes,
    recentMinutes,
    seasonFGA,
    recentFGA,
    seasonFTA,
    recentFTA,
    recentEfficiency,
    seasonEfficiency,
    last5HitRate,
    volatility,
    sportsProjection: num(sportsProjection),
    matchupAverage,
    dataAvailability,
    sourceConfidence,
    dataMode,
    dataAvailabilityFlags,
    stat,
    builtAt: new Date().toISOString(),
  };
}
