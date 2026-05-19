import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const API_KEY = CONFIG.BALLDONTLIE_KEY;
const BASE = "https://api.balldontlie.io/v1";

const playerCache = new Map();
const statsCache = new Map();

function clean(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseMinutes(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;

  const str = String(value);

  if (str.includes(":")) {
    const [m, s] = str.split(":").map(Number);
    return Number((m + s / 60).toFixed(1));
  }

  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}

async function ballFetch(url, label) {
  if (!API_KEY) return null;

  try {
    const res = await fetch(url, {
      headers: {
        Authorization: API_KEY,
      },
    });

    const data = await res.json();

    if (!res.ok) {
      console.log(`${label} ERROR:`, res.status);
      return null;
    }

    return data;
  } catch (err) {
    console.log(`${label} FAILED:`, err.message);
    return null;
  }
}

export async function findBallPlayer(playerName) {
  const key = clean(playerName);

  if (playerCache.has(key)) {
    return playerCache.get(key);
  }

  const url = `${BASE}/players?search=${encodeURIComponent(playerName)}`;
  const data = await ballFetch(url, "BALL PLAYER SEARCH");

  const players = data?.data || [];

  const exact =
    players.find((p) => clean(`${p.first_name} ${p.last_name}`) === key) ||
    players[0] ||
    null;

  playerCache.set(key, exact);

  return exact;
}

function normalizeStat(stat) {
  const playerTeam = stat.team?.abbreviation || "";

  const home =
    stat.game?.home_team?.abbreviation ||
    stat.game?.home_team_abbreviation ||
    "";

  const away =
    stat.game?.visitor_team?.abbreviation ||
    stat.game?.visitor_team_abbreviation ||
    "";

  const opponent = clean(playerTeam) === clean(home) ? away : home;

  return {
    date: stat.game?.date || "",
    team: playerTeam,
    opponent,

    points: Number(stat.pts || 0),
    minutes: parseMinutes(stat.min),
    fga: Number(stat.fga || 0),
    fta: Number(stat.fta || 0),
    fg3a: Number(stat.fg3a || 0),
    turnovers: Number(stat.turnover || 0),

    raw: stat,
  };
}

export async function fetchPlayerStats(playerName) {
  const key = clean(playerName);

  if (statsCache.has(key)) {
    return statsCache.get(key);
  }

  const player = await findBallPlayer(playerName);

  if (!player?.id) {
    statsCache.set(key, []);
    return [];
  }

  const url =
    `${BASE}/stats?player_ids[]=${player.id}` +
    `&seasons[]=2025` +
    `&per_page=100`;

  const data = await ballFetch(url, "BALL PLAYER STATS");

  const games = (data?.data || [])
    .map(normalizeStat)
    .filter((g) => g.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  statsCache.set(key, games);

  return games;
}

export async function fetchLast5(playerName) {
  const games = await fetchPlayerStats(playerName);
  return games.slice(0, 5);
}

export async function fetchLast3VsOpponent(playerName, opponent) {
  const games = await fetchPlayerStats(playerName);
  const opp = clean(opponent);

  return games.filter((g) => clean(g.opponent) === opp).slice(0, 3);
}

export function summarizeScoringProfile(games = []) {
  if (!games.length) {
    return {
      games: 0,
      avgPoints: 0,
      avgMinutes: 0,
      avgFGA: 0,
      avgFTA: 0,
      shotVolume: 0,
      consistencyScore: 0,
      hitRange: 0,
    };
  }

  const avg = (field) =>
    games.reduce((sum, g) => sum + Number(g[field] || 0), 0) / games.length;

  const points = games.map((g) => Number(g.points || 0));

  const avgPoints = avg("points");
  const avgMinutes = avg("minutes");
  const avgFGA = avg("fga");
  const avgFTA = avg("fta");

  const high = Math.max(...points);
  const low = Math.min(...points);
  const hitRange = high - low;
  const shotVolume = avgFGA + avgFTA * 0.44;

  let consistencyScore = 100;

  if (hitRange >= 25) consistencyScore -= 35;
  else if (hitRange >= 18) consistencyScore -= 25;
  else if (hitRange >= 12) consistencyScore -= 15;
  else if (hitRange >= 8) consistencyScore -= 8;

  if (avgMinutes < 22) consistencyScore -= 20;
  else if (avgMinutes < 26) consistencyScore -= 10;

  if (avgFGA < 8) consistencyScore -= 20;
  else if (avgFGA < 11) consistencyScore -= 10;

  return {
    games: games.length,
    avgPoints: Number(avgPoints.toFixed(1)),
    avgMinutes: Number(avgMinutes.toFixed(1)),
    avgFGA: Number(avgFGA.toFixed(1)),
    avgFTA: Number(avgFTA.toFixed(1)),
    shotVolume: Number(shotVolume.toFixed(1)),
    consistencyScore: Math.max(0, Math.min(100, Math.round(consistencyScore))),
    hitRange: Number(hitRange.toFixed(1)),
  };
}