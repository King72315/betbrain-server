import fetch from "node-fetch";
import { CONFIG } from "../config.js";
import {
  resolveWnbaTeamId,
  teamsMatch,
} from "../engines/wnba/wnbaTeamAliasResolver.js";
import { resolveStableWnbaPlayerId } from "../engines/wnba/wnbaPlayerIdResolver.js";

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

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function normalizeTeamName(team = {}) {
  return clean(`${team?.city || ""}${team?.name || ""}`);
}

function normalizeGameTeam(gameTeam = {}) {
  return clean(`${gameTeam?.city || ""}${gameTeam?.name || ""}`);
}

function getStatPoints(stat = {}) {
  return num(stat.pts ?? stat.points ?? 0);
}

function getStatFGA(stat = {}) {
  return num(stat.fga ?? stat.field_goal_attempts ?? 0);
}

function getStatFTA(stat = {}) {
  return num(stat.fta ?? stat.free_throw_attempts ?? 0);
}

function getStatFG3A(stat = {}) {
  return num(stat.fg3a ?? stat.three_point_attempts ?? 0);
}

function getStatTurnovers(stat = {}) {
  return num(stat.turnover ?? stat.turnovers ?? 0);
}

function parseGameDateTime(gameDate = "") {
  const raw = String(gameDate || "").trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);

  if (!direct) return null;

  const parsed = new Date(`${direct[1]}T23:59:59.999Z`);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Exclude games on/after the prop's scheduled start (or end of slate day). */
export function filterGamesBeforeCutoff(games = [], cutoffTime = null) {
  if (!cutoffTime || !Array.isArray(games) || !games.length) {
    return games;
  }

  let cutoffMs = null;

  if (cutoffTime instanceof Date) {
    cutoffMs = cutoffTime.getTime();
  } else {
    const parsed = new Date(cutoffTime);

    if (!Number.isNaN(parsed.getTime())) {
      cutoffMs = parsed.getTime();
    } else {
      const dayEnd = parseGameDateTime(cutoffTime);
      cutoffMs = dayEnd ? dayEnd.getTime() : null;
    }
  }

  if (!Number.isFinite(cutoffMs)) return games;

  const filtered = games.filter((game) => {
    const gameDate = game?.date || game?.game?.date || "";

    if (!gameDate) return true;

    const gameDayEnd = parseGameDateTime(gameDate);

    if (!gameDayEnd) return true;

    return gameDayEnd.getTime() < cutoffMs;
  });

  if (filtered.length !== games.length) {
    console.log("BALL GAMES FILTERED BEFORE CUTOFF:", {
      cutoffTime: String(cutoffTime),
      before: games.length,
      after: filtered.length,
      removed: games.length - filtered.length,
    });
  }

  return filtered;
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

  const searchTerms = [...new Set([fullName, lastName, firstName].filter(Boolean))];

  const allCandidates = [];

  for (const term of searchTerms) {
    const players = await searchBallPlayers(term, league);

    for (const player of players) {
      if (!allCandidates.some((p) => p.id === player.id)) {
        allCandidates.push(player);
      }

      const candidateName = fullPlayerName(player);
      const candidateKey = clean(candidateName);

      if (candidateKey === clean(playerName)) {
        console.log(
          "BALL PLAYER EXACT MATCH:",
          league,
          playerName,
          "=>",
          player.id,
          candidateName,
          normalizeTeamName(player.team)
        );

        playerCache.set(key, player);
        return player;
      }
    }
  }

  const safeNameMatch = allCandidates.find((player) => {
    const playerLast = clean(player?.last_name || "");
    const playerFirst = clean(player?.first_name || "");

    return (
      playerLast === clean(lastName) &&
      playerFirst === clean(firstName)
    );
  });

  if (safeNameMatch) {
    console.log(
      "BALL PLAYER SAFE FULL MATCH:",
      league,
      playerName,
      "=>",
      safeNameMatch.id,
      fullPlayerName(safeNameMatch),
      normalizeTeamName(safeNameMatch.team)
    );

    playerCache.set(key, safeNameMatch);
    return safeNameMatch;
  }

  const safePrefixMatch = allCandidates.find((player) => {
    const playerLast = clean(player?.last_name || "");
    const playerFirst = clean(player?.first_name || "");
    const firstPrefix = clean(firstName).slice(0, 3);

    return (
      playerLast === clean(lastName) &&
      firstPrefix &&
      playerFirst.startsWith(firstPrefix)
    );
  });

  if (safePrefixMatch) {
    console.log(
      "BALL PLAYER SAFE PREFIX MATCH:",
      league,
      playerName,
      "=>",
      safePrefixMatch.id,
      fullPlayerName(safePrefixMatch),
      normalizeTeamName(safePrefixMatch.team)
    );

    playerCache.set(key, safePrefixMatch);
    return safePrefixMatch;
  }

  console.log(
    "BALL PLAYER NO SAFE MATCH:",
    league,
    playerName,
    "CANDIDATES:",
    allCandidates.map((p) => ({
      id: p.id,
      name: fullPlayerName(p),
      team: normalizeTeamName(p.team),
      abbreviation: p.team?.abbreviation,
    }))
  );

  if (league === "WNBA") {
    const stableId = resolveStableWnbaPlayerId(playerName);
    if (stableId) {
      const stablePlayer = {
        id: Number(stableId) || stableId,
        first_name: firstName,
        last_name: lastName,
        team: null,
        _stableOverride: true,
      };
      console.log(
        "BALL PLAYER STABLE OVERRIDE:",
        league,
        playerName,
        "=>",
        stableId
      );
      playerCache.set(key, stablePlayer);
      return stablePlayer;
    }
  }

  playerCache.set(key, null);
  return null;
}

function resolveOpponentFromStat(stat = {}, league = "NBA") {
  const homeObj = stat.game?.home_team;
  const awayObj = stat.game?.visitor_team || stat.game?.away_team;

  if (league === "WNBA") {
    const homeId = resolveWnbaTeamId(homeObj);
    const awayId = resolveWnbaTeamId(awayObj);
    const playerTeamId = resolveWnbaTeamId(stat.team);

    if (teamsMatch(playerTeamId, homeId)) return awayId;
    if (teamsMatch(playerTeamId, awayId)) return homeId;

    const playerApiTeamId = stat.team?.id;
    if (playerApiTeamId && homeObj?.id && playerApiTeamId === homeObj.id) {
      return awayId;
    }
    if (playerApiTeamId && awayObj?.id && playerApiTeamId === awayObj.id) {
      return homeId;
    }

    return awayId || homeId || "";
  }

  const playerTeam = normalizeTeamName(stat.team);
  const home = normalizeGameTeam(homeObj);
  const away = normalizeGameTeam(awayObj);

  if (playerTeam && home && playerTeam === home) return away;
  if (playerTeam && away && playerTeam === away) return home;
  return home || away || "";
}

function normalizeStat(stat, league = "NBA") {
  const playerTeam =
    league === "WNBA"
      ? resolveWnbaTeamId(stat.team)
      : normalizeTeamName(stat.team);

  const opponentTeamId = resolveOpponentFromStat(stat, league);
  const opponent =
    league === "WNBA"
      ? opponentTeamId || ""
      : clean(opponentTeamId);

  const points = getStatPoints(stat);
  const minutes = parseMinutes(stat.min ?? stat.minutes);

  return {
    date: stat.game?.date || "",
    team: playerTeam,
    opponent,
    opponentTeamId: league === "WNBA" ? opponentTeamId : clean(opponent),

    points,
    minutes,
    fga: getStatFGA(stat),
    fta: getStatFTA(stat),
    fg3a: getStatFG3A(stat),
    turnovers: getStatTurnovers(stat),

    played: minutes > 0,
    raw: stat,
  };
}

export async function fetchPlayerStats(playerName, league = "NBA") {
  console.log("🔥 FETCH PLAYER STATS FIRED:", league, playerName);

  const seasonYear = getSeasonYear(league);
  const key = `${league}-${seasonYear}-${clean(playerName)}`;

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

  const url =
    `${base}/player_stats?player_ids[]=${player.id}` +
    `&seasons[]=${seasonYear}` +
    `&per_page=100`;

  const data = await ballFetch(url, `BALL PLAYER STATS (${league} ${playerName})`);

  if (!data) {
    console.log("BALL STATS FETCH FAILED - NOT CACHING EMPTY RESULT:", {
      league,
      playerName,
      playerId: player.id,
    });

    return [];
  }

  const games = (data?.data || [])
    .map((stat) => normalizeStat(stat, league))
    .filter((g) => g.date)
    .filter((g) => g.played)
    .sort((a, b) => new Date(b.date) - new Date(a.date));

  console.log(
    "BALL NORMALIZED GAMES:",
    league,
    playerName,
    games.length,
    games.slice(0, 5).map((g) => ({
      date: g.date,
      team: g.team,
      opponent: g.opponent,
      points: g.points,
      minutes: g.minutes,
      fga: g.fga,
      fta: g.fta,
    }))
  );

  statsCache.set(key, games);

  return games;
}

export async function fetchLast5(playerName, league = "NBA", options = {}) {
  console.log("🔥 FETCH LAST5 FIRED:", league, playerName);

  const games = await fetchPlayerStats(playerName, league);
  const eligible = filterGamesBeforeCutoff(games, options.beforeTime);
  const last5 = eligible.slice(0, 5);

  console.log(
    "🔥 LAST5 RESULT:",
    league,
    playerName,
    last5.map((g) => ({
      date: g.date,
      points: g.points,
      minutes: g.minutes,
      fga: g.fga,
      fta: g.fta,
      opponent: g.opponent,
    }))
  );

  return last5;
}

export async function fetchLast3VsOpponent(
  playerName,
  opponent,
  league = "NBA",
  options = {}
) {
  console.log("🔥 FETCH LAST3 VS OPP FIRED:", league, playerName, opponent);

  const games = await fetchPlayerStats(playerName, league);
  const eligible = filterGamesBeforeCutoff(games, options.beforeTime);

  const targetOpponentId =
    league === "WNBA" ? resolveWnbaTeamId(opponent) : clean(opponent);

  const matches = eligible
    .filter((g) => {
      if (league === "WNBA") {
        return teamsMatch(g.opponentTeamId || g.opponent, targetOpponentId);
      }
      return clean(g.opponent) === targetOpponentId;
    })
    .slice(0, 3);

  console.log(
    "🔥 LAST3 VS OPP RESULT:",
    league,
    playerName,
    opponent,
    matches.map((g) => ({
      date: g.date,
      points: g.points,
      opponent: g.opponent,
    }))
  );

  return matches;
}

export function summarizeScoringProfile(games = []) {
  if (!games.length) {
    return {
      games: 0,
      avgPoints: 0,
      avgMinutes: 0,
      avgFGA: 0,
      avgFTA: 0,
      avg3PA: 0,
      shotVolume: 0,
      consistencyScore: 0,
      hitRange: 0,
      volatilityLabel: "NO_DATA",
      dataQuality: 0,
    };
  }

  const avg = (field) =>
    games.reduce((sum, g) => sum + Number(g[field] || 0), 0) / games.length;

  const points = games.map((g) => Number(g.points || 0));

  const avgPoints = avg("points");
  const avgMinutes = avg("minutes");
  const avgFGA = avg("fga");
  const avgFTA = avg("fta");
  const avg3PA = avg("fg3a");

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

  const cleanConsistency = Math.max(0, Math.min(100, Math.round(consistencyScore)));

  let volatilityLabel = "LOW";
  if (hitRange >= 18) volatilityLabel = "HIGH";
  else if (hitRange >= 10) volatilityLabel = "MEDIUM";

  let dataQuality = 40;

  if (games.length >= 5) dataQuality += 25;
  else if (games.length >= 3) dataQuality += 15;

  if (avgMinutes >= 28) dataQuality += 15;
  else if (avgMinutes >= 24) dataQuality += 8;

  if (avgFGA >= 12) dataQuality += 10;
  else if (avgFGA >= 8) dataQuality += 5;

  if (cleanConsistency >= 75) dataQuality += 10;
  else if (cleanConsistency < 50) dataQuality -= 10;

  dataQuality = Math.max(0, Math.min(100, Math.round(dataQuality)));

  return {
    games: games.length,
    avgPoints: Number(avgPoints.toFixed(1)),
    avgMinutes: Number(avgMinutes.toFixed(1)),
    avgFGA: Number(avgFGA.toFixed(1)),
    avgFTA: Number(avgFTA.toFixed(1)),
    avg3PA: Number(avg3PA.toFixed(1)),
    shotVolume: Number(shotVolume.toFixed(1)),
    consistencyScore: cleanConsistency,
    hitRange: Number(hitRange.toFixed(1)),
    volatilityLabel,
    dataQuality,
  };
}

export function summarizeOpponentMatchup(
  games = [],
  line = 0,
  recentProfile = {}
) {
  if (!games.length) {
    return {
      games: 0,

      avgPointsVsOpponent: null,
      avgMinutesVsOpponent: null,
      avgFGAVsOpponent: null,
      avgFTAVsOpponent: null,
      hitRateVsOpponent: null,

      resistanceSignal: "NO_DIRECT_HISTORY",
      resistanceImpact: 0,

      coverageScore: 0,
      isDirectHistory: false,

      reasons: ["No direct opponent history found"],
      warnings: ["Opponent history coverage is missing"],
    };
  }

  const avg = (field) =>
    games.reduce((sum, g) => sum + Number(g[field] || 0), 0) / games.length;

  const avgPoints = avg("points");
  const avgMinutes = avg("minutes");
  const avgFGA = avg("fga");
  const avgFTA = avg("fta");

  const hits = games.filter(
    (g) => Number(g.points || 0) > Number(line || 0)
  ).length;

  const hitRate = games.length ? hits / games.length : 0;

  let resistanceSignal = "NEUTRAL";
  let resistanceImpact = 0;
  const reasons = [];
  const warnings = [];

  if (avgPoints >= Number(line) + 4 && hitRate >= 0.67) {
    resistanceSignal = "WEAK_RESISTANCE";
    resistanceImpact = 5;
    reasons.push("Player has cleared this line well against opponent");
  } else if (avgPoints >= Number(line) + 2) {
    resistanceSignal = "SLIGHT_WEAK_RESISTANCE";
    resistanceImpact = 3;
    reasons.push("Player has positive scoring history against opponent");
  } else if (avgPoints <= Number(line) - 4 && hitRate <= 0.33) {
    resistanceSignal = "STRONG_RESISTANCE";
    resistanceImpact = -5;
    reasons.push("Opponent has strongly held player below this line");
  } else if (avgPoints <= Number(line) - 2) {
    resistanceSignal = "SLIGHT_STRONG_RESISTANCE";
    resistanceImpact = -3;
    reasons.push("Opponent has limited player below this line");
  } else {
    reasons.push("Direct opponent history is neutral");
  }

  if (avgMinutes < 24) {
    resistanceImpact -= 2;
    warnings.push("Limited minutes in opponent history");
  }

  if (avgFGA < 9) {
    resistanceImpact -= 2;
    warnings.push("Low shot volume in opponent history");
  }

  const coverageScore = Math.min(100, games.length * 30);

  return {
    games: games.length,

    avgPointsVsOpponent: Number(avgPoints.toFixed(1)),
    avgMinutesVsOpponent: Number(avgMinutes.toFixed(1)),
    avgFGAVsOpponent: Number(avgFGA.toFixed(1)),
    avgFTAVsOpponent: Number(avgFTA.toFixed(1)),
    hitRateVsOpponent: Number((hitRate * 100).toFixed(0)),

    resistanceSignal,
    resistanceImpact,

    coverageScore,
    isDirectHistory: true,

    reasons,
    warnings,
  };
}

export async function getBallPlayerTeam(playerName, league = "NBA") {
  const player = await findBallPlayer(playerName, league);

  if (!player?.team) {
    if (league === "WNBA") return "";
    return "";
  }

  if (league === "WNBA") {
    return resolveWnbaTeamId(player.team) || normalizeTeamName(player.team);
  }

  return normalizeTeamName(player.team);
}

export async function fetchBallTeams(league = "NBA") {
  const base = getBallBase(league);
  const url = `${base}/teams`;
  const data = await ballFetch(url, `BALL TEAMS (${league})`);

  return data?.data || [];
}