import fetch from "node-fetch";
import { CONFIG } from "../config.js";

console.log("🔥 FANTASY WNBA SERVICE LOADED");

const API_KEY = CONFIG.SPORTS_KEY;
const BASE = "https://api.sportsdata.io/v3/wnba/stats/json";

const playerCache = new Map();
const statsCache = new Map();

function clean(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]/g, "");
}

async function fantasyFetch(url, label) {
  if (!API_KEY) {
    console.log(`${label} ERROR: SPORTS_KEY missing`);
    return null;
  }

  try {
    console.log(`${label} URL:`, url);

    const res = await fetch(url, {
      headers: {
        "Ocp-Apim-Subscription-Key": API_KEY,
      },
    });

    const text = await res.text();

    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      console.log(`${label} NON JSON:`, text.slice(0, 300));
      return null;
    }

    console.log(`${label} STATUS:`, res.status);
    console.log(
      `${label} COUNT:`,
      Array.isArray(data) ? data.length : "not array"
    );

    if (!res.ok) {
      console.log(`${label} ERROR BODY:`, data);
      return null;
    }

    return data;
  } catch (err) {
    console.log(`${label} FAILED:`, err.message);
    return null;
  }
}

export async function fetchFantasyWnbaPlayers() {
  if (playerCache.has("all")) return playerCache.get("all");

  const url = `${BASE}/Players`;
  const data = await fantasyFetch(url, "FANTASY WNBA PLAYERS");

  const players = Array.isArray(data) ? data : [];
  playerCache.set("all", players);

  return players;
}

export async function findFantasyWnbaPlayer(playerName) {
  const key = clean(playerName);

  const players = await fetchFantasyWnbaPlayers();

  const exact = players.find((p) => clean(p.Name) === key);

  if (exact) {
    console.log("FANTASY WNBA EXACT MATCH:", playerName, "=>", exact.PlayerID, exact.Name);
    return exact;
  }

  const parts = String(playerName).split(/\s+/).filter(Boolean);
  const lastName = clean(parts[parts.length - 1] || "");

  const safe = players.find((p) => {
    return clean(p.LastName || "").includes(lastName) || clean(p.Name || "").includes(key);
  });

  if (safe) {
    console.log("FANTASY WNBA SAFE MATCH:", playerName, "=>", safe.PlayerID, safe.Name);
    return safe;
  }

  console.log("FANTASY WNBA NO MATCH:", playerName);
  return null;
}

function normalizeGameLog(row = {}) {
  return {
    date: row.Day || row.DateTime || "",
    team: row.Team || "",
    opponent: row.Opponent || "",

    points: Number(row.Points || 0),
    minutes: Number(row.Minutes || 0),
    fga: Number(row.FieldGoalsAttempted || 0),
    fta: Number(row.FreeThrowsAttempted || 0),
    fg3a: Number(row.ThreePointersAttempted || 0),
    turnovers: Number(row.Turnovers || 0),

    raw: row,
  };
}

export async function fetchFantasyWnbaPlayerStats(playerName) {
  const key = clean(playerName);

  if (statsCache.has(key)) {
    console.log("FANTASY WNBA STATS CACHE HIT:", playerName);
    return statsCache.get(key);
  }

  const player = await findFantasyWnbaPlayer(playerName);

  if (!player?.PlayerID) {
    statsCache.set(key, []);
    return [];
  }

  const season = new Date().getFullYear();

  const url = `${BASE}/PlayerGameStatsByPlayer/${season}/${player.PlayerID}`;
  const data = await fantasyFetch(url, `FANTASY WNBA PLAYER GAME LOG (${playerName})`);

  const games = (Array.isArray(data) ? data : [])
    .map(normalizeGameLog)
    .filter((g) => g.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  console.log(
    "FANTASY WNBA NORMALIZED GAMES:",
    playerName,
    games.length,
    games.slice(0, 5).map((g) => ({
      date: g.date,
      points: g.points,
      minutes: g.minutes,
      fga: g.fga,
      fta: g.fta,
    }))
  );

  statsCache.set(key, games);
  return games;
}

export async function fetchFantasyWnbaLast5(playerName) {
  const games = await fetchFantasyWnbaPlayerStats(playerName);
  const last5 = games.slice(0, 5);

  console.log(
    "🔥 FANTASY WNBA LAST5:",
    playerName,
    last5.map((g) => g.points)
  );

  return last5;
}

export async function fetchFantasyWnbaLast3VsOpponent(playerName, opponent) {
  const games = await fetchFantasyWnbaPlayerStats(playerName);
  const opp = clean(opponent);

  return games.filter((g) => clean(g.opponent) === opp).slice(0, 3);
}