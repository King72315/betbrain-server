import fetch from "node-fetch";
import { CONFIG } from "../config.js";

console.log("🔥 WNBA BALL SERVICE LOADED");

const API_KEY = CONFIG.BALLDONTLIE_KEY;
const BASE = "https://api.balldontlie.io/wnba/v1";

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

function splitName(playerName = "") {
  const parts = String(playerName).trim().split(/\s+/).filter(Boolean);

  return {
    firstName: parts[0] || "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : parts[0] || "",
    fullName: parts.join(" "),
  };
}

function fullPlayerName(player) {
  return `${player?.first_name || ""} ${player?.last_name || ""}`.trim();
}

async function wnbaFetch(url, label) {
  if (!API_KEY) {
    console.log(`${label} ERROR: missing BallDontLie key`);
    return null;
  }

  try {
    console.log(`${label} URL:`, url);

    const res = await fetch(url, {
      headers: {
        Authorization: API_KEY,
      },
    });

    const data = await res.json();

    console.log(`${label} STATUS:`, res.status);
    console.log(`${label} RAW COUNT:`, data?.data?.length ?? "null");

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

async function searchWnbaPlayers(searchTerm) {
  if (!searchTerm) return [];

  const url = `${BASE}/players?search=${encodeURIComponent(searchTerm)}`;
  const data = await wnbaFetch(url, `WNBA PLAYER SEARCH (${searchTerm})`);

  return data?.data || [];
}

export async function findWnbaPlayer(playerName) {
  console.log("🔎 FIND WNBA PLAYER:", playerName);

  const key = clean(playerName);

  if (playerCache.has(key)) {
    console.log("WNBA PLAYER CACHE HIT:", playerName);
    return playerCache.get(key);
  }

  const { firstName, lastName, fullName } = splitName(playerName);

  const searchTerms = [fullName, lastName, firstName].filter(Boolean);

  const allCandidates = [];

  for (const term of searchTerms) {
    const players = await searchWnbaPlayers(term);

    for (const player of players) {
      const candidateKey = clean(fullPlayerName(player));

      if (!allCandidates.some((p) => p.id === player.id)) {
        allCandidates.push(player);
      }

      if (candidateKey === key) {
        console.log(
          "WNBA PLAYER EXACT MATCH:",
          playerName,
          "=>",
          player.id,
          fullPlayerName(player)
        );

        playerCache.set(key, player);
        return player;
      }
    }
  }

  const safeLastNameMatch = allCandidates.find((player) => {
    const playerLast = clean(player?.last_name || "");
    const playerFirst = clean(player?.first_name || "");

    return (
      playerLast === clean(lastName) &&
      (!firstName || playerFirst.startsWith(clean(firstName).slice(0, 3)))
    );
  });

  if (safeLastNameMatch) {
    console.log(
      "WNBA PLAYER SAFE MATCH:",
      playerName,
      "=>",
      safeLastNameMatch.id,
      fullPlayerName(safeLastNameMatch)
    );

    playerCache.set(key, safeLastNameMatch);
    return safeLastNameMatch;
  }

  console.log(
    "WNBA PLAYER NO SAFE MATCH:",
    playerName,
    "CANDIDATES:",
    allCandidates.map((p) => ({
      id: p.id,
      name: fullPlayerName(p),
      team: p.team?.abbreviation,
    }))
  );

  playerCache.set(key, null);
  return null;
}

function normalizeStat(stat) {
  const playerTeam = stat.team?.abbreviation || "";

  const home = clean(
  `${stat.game?.home_team?.city || ""}
   ${stat.game?.home_team?.name || ""}`
);

const away = clean(
  `${stat.game?.visitor_team?.city || ""}
   ${stat.game?.visitor_team?.name || ""}`
);

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

export async function fetchWnbaPlayerStats(playerName) {
  console.log("🔥 FETCH WNBA PLAYER STATS FIRED:", playerName);

  const key = clean(playerName);

  if (statsCache.has(key)) {
    console.log("WNBA STATS CACHE HIT:", playerName);
    return statsCache.get(key);
  }

  const player = await findWnbaPlayer(playerName);

  if (!player?.id) {
    console.log("WNBA STATS NO PLAYER ID:", playerName);
    statsCache.set(key, []);
    return [];
  }

  const now = new Date();
const seasonYear = getSeasonYear(league);
  now.getMonth() >= 9
    ? now.getFullYear()
    : now.getFullYear() - 1;

  const url =
  `${BASE}/player_stats?player_ids[]=${player.id}` +
  `&season=${seasonYear}` +
  `&per_page=100`;

  const data = await wnbaFetch(url, "WNBA PLAYER STATS");

  const games = (data?.data || [])
    .map(normalizeStat)
    .filter((g) => g.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  console.log(
    "WNBA NORMALIZED GAMES:",
    playerName,
    games.length,
    games.slice(0, 3).map((g) => ({
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

export async function fetchWnbaLast5(playerName) {
  console.log("🔥 FETCH WNBA LAST5 FIRED:", playerName);

  const games = await fetchWnbaPlayerStats(playerName);
  const last5 = games.slice(0, 5);

  console.log(
    "🔥 WNBA LAST5 RESULT:",
    playerName,
    last5.map((g) => g.points)
  );

  return last5;
}

export async function fetchWnbaLast3VsOpponent(playerName, opponent) {
  console.log("🔥 FETCH WNBA LAST3 VS OPP FIRED:", playerName, opponent);

  const games = await fetchWnbaPlayerStats(playerName);
  const opp = clean(opponent);

  return games.filter((g) => clean(g.opponent) === opp).slice(0, 3);
}