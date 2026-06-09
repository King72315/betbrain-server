import fetch from "node-fetch";
import { CONFIG } from "../config.js";

console.log("🔥 BALL SERVICE LOADED");

const API_KEY = CONFIG.BALLDONTLIE_KEY;

const NBA_BASE = "https://api.balldontlie.io/v1";
const WNBA_BASE = "https://api.balldontlie.io/wnba/v1";

const playerCache = new Map();
const statsCache = new Map();

function getBallBase(league = "NBA") {
  return league === "WNBA" ? WNBA_BASE : NBA_BASE;
}

function getSeasonYear(league = "NBA") {
  const now = new Date();

  if (league === "WNBA") {
    return now.getFullYear();
  }

  return now.getMonth() >= 9
    ? now.getFullYear()
    : now.getFullYear() - 1;
}

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

async function ballFetch(url, label) {
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

async function searchBallPlayers(searchTerm, league = "NBA") {
  if (!searchTerm) return [];

  const base = getBallBase(league);

  const url = `${base}/players?search=${encodeURIComponent(searchTerm)}`;
  const data = await ballFetch(
    url,
    `BALL PLAYER SEARCH (${league} ${searchTerm})`
  );

  return data?.data || [];
}

export async function findBallPlayer(playerName, league = "NBA") {
  console.log("🔎 FIND BALL PLAYER:", league, playerName);

  const key = `${league}-${clean(playerName)}`;

  if (playerCache.has(key)) {
    console.log("BALL PLAYER CACHE HIT:", league, playerName);
    return playerCache.get(key);
  }

  const { firstName, lastName, fullName } = splitName(playerName);

  const searchTerms = [fullName, lastName, firstName].filter(Boolean);

  const allCandidates = [];

  for (const term of searchTerms) {
    const players = await searchBallPlayers(term, league);

    for (const player of players) {
      const candidateKey = clean(fullPlayerName(player));

      if (!allCandidates.some((p) => p.id === player.id)) {
        allCandidates.push(player);
      }

      if (candidateKey === clean(playerName)) {
        console.log(
          "BALL PLAYER EXACT MATCH:",
          league,
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
      "BALL PLAYER SAFE MATCH:",
      league,
      playerName,
      "=>",
      safeLastNameMatch.id,
      fullPlayerName(safeLastNameMatch)
    );

    playerCache.set(key, safeLastNameMatch);
    return safeLastNameMatch;
  }

  console.log(
    "BALL PLAYER NO SAFE MATCH:",
    league,
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

export async function fetchPlayerStats(playerName, league = "NBA") {
  console.log("🔥 FETCH PLAYER STATS FIRED:", league, playerName);

  const key = `${league}-${clean(playerName)}`;

  if (statsCache.has(key)) {
    console.log("BALL STATS CACHE HIT:", league, playerName);
    return statsCache.get(key);
  }

  const player = await findBallPlayer(playerName, league);

  if (!player?.id) {
    console.log("BALL STATS NO PLAYER ID:", league, playerName);
    statsCache.set(key, []);
    return [];
  }

  const base = getBallBase(league);
  const seasonYear = getSeasonYear(league);

  const url =
    `${base}/player_stats?player_ids[]=${player.id}` +
    `&seasons[]=${seasonYear}` +
    `&per_page=100`;

  const data = await ballFetch(url, `BALL PLAYER STATS (${league})`);

  const games = (data?.data || [])
    .map(normalizeStat)
    .filter((g) => g.date)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  console.log(
    "BALL NORMALIZED GAMES:",
    league,
    playerName,
    games.length,
    games.slice(0, 5).map((g) => ({
      date: g.date,
      points: g.points,
      minutes: g.minutes,
      fga: g.fga,
      fta: g.fta,
      opponent: g.opponent,
    }))
  );

  statsCache.set(key, games);

  return games;
}

export async function fetchLast5(playerName, league = "NBA") {
  console.log("🔥 FETCH LAST5 FIRED:", league, playerName);

  const games = await fetchPlayerStats(playerName, league);
  const last5 = games.slice(0, 5);

  console.log(
    "🔥 LAST5 RESULT:",
    league,
    playerName,
    last5.map((g) => g.points)
  );

  return last5;
}

export async function fetchLast3VsOpponent(
  playerName,
  opponent,
  league = "NBA"
) {
  console.log("🔥 FETCH LAST3 VS OPP FIRED:", league, playerName, opponent);

  const games = await fetchPlayerStats(playerName, league);
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

export function summarizeOpponentMatchup(
  games = [],
  line = 0,
  recentProfile = {}
) {
  if (!games.length) {
    const avgPoints = Number(recentProfile.avgPoints || 0);
    const avgMinutes = Number(recentProfile.avgMinutes || 0);
    const avgFGA = Number(recentProfile.avgFGA || 0);
    const avgFTA = Number(recentProfile.avgFTA || 0);

    let resistanceSignal = "NO_DIRECT_HISTORY";
    let resistanceImpact = 0;
    const reasons = ["no direct opponent history found; using recent form instead"];

    if (
      avgPoints >= Number(line) - 1 &&
      (avgFGA >= 15 || avgFTA >= 6)
    ) {
      resistanceSignal = "WEAPON_ADVANTAGE";
      resistanceImpact = 4;
      reasons.push("player weapon profile supports scoring expectation");
    } else if (
      avgPoints <= Number(line) - 3 ||
      avgMinutes < 22 ||
      avgFGA < 8
    ) {
      resistanceSignal = "LOW_USAGE_RISK";
      resistanceImpact = -4;
      reasons.push("recent role or shot volume creates scoring risk");
    }

    if (avgFTA >= 5) {
      resistanceImpact += 1;
      reasons.push("free throw volume supports scoring floor");
    }

    return {
      games: 0,
      avgPointsVsOpponent: Number(avgPoints.toFixed(1)),
      avgMinutesVsOpponent: Number(avgMinutes.toFixed(1)),
      avgFGAVsOpponent: Number(avgFGA.toFixed(1)),
      avgFTAVsOpponent: Number(avgFTA.toFixed(1)),
      hitRateVsOpponent: 0,
      resistanceSignal,
      resistanceImpact,
      reasons,
    };
  }

  const avg = (field) =>
    games.reduce((sum, g) => sum + Number(g[field] || 0), 0) / games.length;

  const avgPoints = avg("points");
  const avgMinutes = avg("minutes");
  const avgFGA = avg("fga");
  const avgFTA = avg("fta");

  const hits = games.filter((g) => Number(g.points || 0) > Number(line || 0)).length;
  const hitRate = games.length ? hits / games.length : 0;

  let resistanceSignal = "NEUTRAL";
  let resistanceImpact = 0;
  const reasons = [];

  if (avgPoints >= Number(line) + 4 && hitRate >= 0.67) {
    resistanceSignal = "WEAK_RESISTANCE";
    resistanceImpact = 5;
    reasons.push("player has cleared this line well against opponent");
  } else if (avgPoints >= Number(line) + 2) {
    resistanceSignal = "SLIGHT_WEAK_RESISTANCE";
    resistanceImpact = 3;
    reasons.push("player has positive scoring history against opponent");
  } else if (avgPoints <= Number(line) - 4 && hitRate <= 0.33) {
    resistanceSignal = "STRONG_RESISTANCE";
    resistanceImpact = -5;
    reasons.push("opponent has strongly held player below this line");
  } else if (avgPoints <= Number(line) - 2) {
    resistanceSignal = "SLIGHT_STRONG_RESISTANCE";
    resistanceImpact = -3;
    reasons.push("opponent has limited player below this line");
  } else {
    reasons.push("direct opponent history is neutral");
  }

  if (avgMinutes < 24) {
    resistanceImpact -= 2;
    reasons.push("limited minutes in opponent history");
  }

  if (avgFGA < 9) {
    resistanceImpact -= 2;
    reasons.push("low shot volume in opponent history");
  }

  return {
    games: games.length,
    avgPointsVsOpponent: Number(avgPoints.toFixed(1)),
    avgMinutesVsOpponent: Number(avgMinutes.toFixed(1)),
    avgFGAVsOpponent: Number(avgFGA.toFixed(1)),
    avgFTAVsOpponent: Number(avgFTA.toFixed(1)),
    hitRateVsOpponent: Number((hitRate * 100).toFixed(0)),
    resistanceSignal,
    resistanceImpact,
    reasons,
  };
}

export async function getBallPlayerTeam(playerName, league = "NBA") {
  const player = await findBallPlayer(playerName, league);

  if (!player?.team) return "";

  return clean(
    `${player.team.city || ""}${player.team.name || ""}`
  );
}

export async function fetchBallTeams(league = "NBA") {
  const base = getBallBase(league);
  const url = `${base}/teams`;
  const data = await ballFetch(url, `BALL TEAMS (${league})`);

  return data?.data || [];
}