import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const BDL_BASE = "https://api.balldontlie.io/wnba/v1";
const CACHE_MS = 10 * 60 * 1000;
const teamDefenseCache = new Map();

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cleanTeamKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamLabel(team = {}) {
  return (
    team?.full_name ||
    `${team?.city || ""} ${team?.name || ""}`.trim() ||
    team?.abbreviation ||
    ""
  );
}

async function bdlFetch(path, label) {
  if (!CONFIG.BALLDONTLIE_KEY) return null;
  try {
    const res = await fetch(`${BDL_BASE}${path}`, {
      headers: { Authorization: CONFIG.BALLDONTLIE_KEY },
    });
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

async function fetchRecentTeamGames(opponentTeam = "", limit = 8) {
  const key = cleanTeamKey(opponentTeam);
  if (!key) return [];

  const teamsPayload = await bdlFetch("/teams?per_page=40", "teams");
  const teams = teamsPayload?.data || [];
  const team =
    teams.find((row) => cleanTeamKey(teamLabel(row)) === key) ||
    teams.find((row) => {
      const abbrev = cleanTeamKey(row?.abbreviation || "");
      return abbrev && (abbrev === key || key.includes(abbrev));
    });

  if (!team?.id) return [];

  const season = new Date().getFullYear();
  const gamesPayload = await bdlFetch(
    `/games?team_ids[]=${team.id}&seasons[]=${season}&per_page=${limit}`,
    "games"
  );
  const games = (gamesPayload?.data || []).filter(
    (g) => String(g.status || "").toLowerCase().includes("final")
  );
  return games.slice(0, limit);
}

function pointsAllowedFromGame(game = {}, opponentTeamId = null) {
  const home = num(game.home_team_score);
  const away = num(game.visitor_team_score);
  if (!home && !away) return null;

  const homeId = game.home_team?.id;
  const awayId = game.visitor_team?.id;
  if (opponentTeamId && homeId === opponentTeamId) return away;
  if (opponentTeamId && awayId === opponentTeamId) return home;
  return Math.max(home, away);
}

export async function buildWnbaOpponentDefenseContext({
  opponentTeam = "",
  league = "WNBA",
} = {}) {
  const defaultResult = {
    defenseScore: 50,
    source: "default",
    opponentPPG: null,
    pace: null,
    reasons: ["WNBA opponent proxy defaulted"],
    probeDisabled: true,
    proxyUsed: true,
    defenseAudit: {
      resolvedDefenseScore: 50,
      defenseSource: "default",
      proxyUsed: true,
      opponentPPG: null,
      unavailableReason: "WNBA opponent proxy defaulted",
    },
  };

  if (String(league).toUpperCase() !== "WNBA" || !opponentTeam) {
    return defaultResult;
  }

  const cacheKey = cleanTeamKey(opponentTeam);
  const cached = teamDefenseCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) {
    return cached.result;
  }

  const games = await fetchRecentTeamGames(opponentTeam, 10);
  if (!games.length) {
    const result = {
      ...defaultResult,
      reasons: [`No recent BDL games for opponent ${opponentTeam}`],
    };
    teamDefenseCache.set(cacheKey, { loadedAt: Date.now(), result });
    return result;
  }

  const teamId = games[0]?.home_team?.id || games[0]?.visitor_team?.id || null;
  const allowed = games
    .map((g) => pointsAllowedFromGame(g, teamId))
    .filter((v) => v !== null && v > 0);

  if (!allowed.length) {
    const result = {
      ...defaultResult,
      reasons: ["BDL games found but points-allowed unavailable"],
    };
    teamDefenseCache.set(cacheKey, { loadedAt: Date.now(), result });
    return result;
  }

  const opponentPPG = Number(
    (allowed.reduce((sum, v) => sum + v, 0) / allowed.length).toFixed(1)
  );
  const leagueAvg = 82;
  let defenseScore = clamp(
    Math.round(50 + (opponentPPG - leagueAvg) * 2.2),
    20,
    80
  );

  const reasons = [
    `WNBA proxy: opponent allows ${opponentPPG} PPG over ${allowed.length} games`,
    opponentPPG >= leagueAvg ? "Above league avg scoring environment" : "Below league avg scoring environment",
  ];

  const result = {
    defenseScore,
    source: "wnba_games_proxy",
    opponentPPG,
    pace: null,
    sampleGames: allowed.length,
    reasons,
    probeDisabled: true,
    proxyUsed: false,
    defenseAudit: {
      resolvedDefenseScore: defenseScore,
      defenseSource: "wnba_games_proxy",
      proxyUsed: false,
      opponentPPG,
      unavailableReason: null,
    },
  };

  teamDefenseCache.set(cacheKey, { loadedAt: Date.now(), result });
  return result;
}
