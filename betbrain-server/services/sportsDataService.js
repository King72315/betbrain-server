import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const SPORTS_BASE = "https://api.sportsdata.io/api/nba";
const API_KEY = CONFIG.SPORTS_KEY;

export function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function formatDate(date = new Date()) {
  const d = new Date(date);
  return d.toISOString().split("T")[0];
}

function dateForDaysAhead(daysAhead = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysAhead);
  return d;
}

async function fetchJson(url, label) {
  try {
    if (!API_KEY) {
      console.log(`${label}: SPORTS_KEY missing`);
      return [];
    }

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.log(`${label} ERROR:`, res.status, JSON.stringify(data).slice(0, 500));
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.log(`${label} FAILED:`, err.message);
    return [];
  }
}

export async function fetchGames(daysAhead = 0, league = "NBA") {
  const date = formatDate(dateForDaysAhead(daysAhead));

  const leaguePath = league === "WNBA" ? "wnba" : "nba";

const url =
  `https://api.sportsdata.io/v3/${leaguePath}/odds/json/GamesByDate/${date}` +
  `?key=${API_KEY}`;

  const games = await fetchJson(url, "FETCH GAMES");

  return games.map((g) => ({
    id: g.GameID || g.gameID || g.id,
    gameId: g.GameID || g.gameID || g.id,
    date,
    time: g.DateTime || g.GameDateTime || g.DateTimeUTC || g.Day,
    homeTeam: g.HomeTeam,
    awayTeam: g.AwayTeam,
    home: g.HomeTeam,
    away: g.AwayTeam,
    game: `${g.AwayTeam} vs ${g.HomeTeam}`,
    raw: g,
  }));
}

export async function fetchPlayers() {
  const url =
    `${SPORTS_BASE}/fantasy/json/Players` +
    `?key=${API_KEY}`;

  return await fetchJson(url, "FETCH PLAYERS");
}

export async function fetchSeasonStats() {
  const url =
    `${SPORTS_BASE}/fantasy/json/PlayerSeasonStats/2026` +
    `?key=${API_KEY}`;

  return await fetchJson(url, "FETCH SEASON STATS");
}

export async function fetchTeamSeasonStats() {
  const url =
    `https://api.sportsdata.io/v3/nba/scores/json/TeamSeasonStats/2026` +
    `?key=${API_KEY}`;

  return await fetchJson(url, "FETCH TEAM SEASON STATS");
}

export async function fetchProjections(daysAhead = 0) {
  const date = formatDate(dateForDaysAhead(daysAhead));

  const url =
    `${SPORTS_BASE}/fantasy/json/PlayerGameProjectionStatsByDate/${date}` +
    `?key=${API_KEY}`;

  return await fetchJson(url, "FETCH PROJECTIONS");
}

export function buildPlayerContextMaps({
  players = [],
  seasonStats = [],
  projections = [],
}) {
  const playerMap = new Map();
  const seasonMap = new Map();
  const projectionMap = new Map();

  for (const player of players) {
    const name =
      player.Name ||
      player.PlayerName ||
      player.FullName ||
      "";

    if (name) playerMap.set(clean(name), player);
  }

  for (const stat of seasonStats) {
    const name =
      stat.Name ||
      stat.PlayerName ||
      "";

    if (name) seasonMap.set(clean(name), stat);
  }

  for (const projection of projections) {
    const name =
      projection.Name ||
      projection.PlayerName ||
      "";

    if (name) projectionMap.set(clean(name), projection);
  }

  return {
    playerMap,
    seasonMap,
    projectionMap,
  };
}

export function getTeamForPlayer(
  playerName,
  playerMap,
  projectionMap,
  seasonMap
) {
  const key = clean(playerName);

  const projection = projectionMap.get(key) || {};
  const player = playerMap.get(key) || {};
  const season = seasonMap.get(key) || {};

  return (
    projection.Team ||
    player.Team ||
    season.Team ||
    ""
  );
}

export function getOpponentForTeam(game, team) {
  if (!game || !team) return "";

  if (clean(game.homeTeam) === clean(team)) {
    return game.awayTeam;
  }

  if (clean(game.awayTeam) === clean(team)) {
    return game.homeTeam;
  }

  return "";
}

export function getProjectionPoints(playerName, projectionMap) {
  const projection = projectionMap.get(clean(playerName)) || {};

  return Number(
    projection.Points ||
    projection.ProjectedPoints ||
    0
  );
}

export function getSeasonPoints(playerName, seasonMap) {
  const season = seasonMap.get(clean(playerName)) || {};

  const games =
    Number(season.Games || season.GamesPlayed || 1) || 1;

  const points =
    Number(
      season.Points ||
      season.PPG ||
      season.AveragePoints ||
      0
    ) || 0;

  if (points > 60) {
    return points / games;
  }

  return points;
}