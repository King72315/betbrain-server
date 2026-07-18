import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const BDL_BASE = "https://api.balldontlie.io/wnba/v1";
const CACHE_MS = 10 * 60 * 1000;
const teamDefenseCache = new Map();

const DEFENSE_V2_VERSION = "wnba-defense-v2-games-proxy";

function num(value, fallback = null) {
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

function isDefenseV2Enabled() {
  return CONFIG.COURTEDGE_WNBA_DEFENSE_V2_ENABLED !== false;
}

async function bdlFetch(path) {
  if (!CONFIG.BALLDONTLIE_KEY) return null;
  try {
    const res = await fetch(`${BDL_BASE}${path}`, {
      headers: { Authorization: CONFIG.BALLDONTLIE_KEY },
    });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    const data = await res.json();
    return { ok: true, status: res.status, data };
  } catch (err) {
    return { ok: false, status: null, data: null, error: String(err.message || err) };
  }
}

function resolveOpponentTeam(teams = [], opponentTeam = "") {
  const key = cleanTeamKey(opponentTeam);
  if (!key) return null;
  return (
    teams.find((row) => cleanTeamKey(teamLabel(row)) === key) ||
    teams.find((row) => {
      const abbrev = cleanTeamKey(row?.abbreviation || "");
      return abbrev && (abbrev === key || key.includes(abbrev) || abbrev.includes(key));
    }) ||
    teams.find((row) => {
      const name = cleanTeamKey(row?.name || "");
      const full = cleanTeamKey(row?.full_name || "");
      return (name && key.includes(name)) || (full && (full.includes(key) || key.includes(full)));
    }) ||
    null
  );
}

async function fetchRecentTeamGames(opponentTeam = "", limit = 12) {
  const teamsRes = await bdlFetch("/teams?per_page=40");
  const teams = teamsRes?.data?.data || [];
  const team = resolveOpponentTeam(teams, opponentTeam);
  if (!team?.id) {
    return {
      team: null,
      games: [],
      fetchStatus: teamsRes?.ok ? "team_unresolved" : "teams_fetch_failed",
      httpStatus: teamsRes?.status ?? null,
    };
  }

  const year = new Date().getFullYear();
  const seasons = [year, year - 1];
  let games = [];
  let httpStatus = null;

  for (const season of seasons) {
    const gamesRes = await bdlFetch(
      `/games?team_ids[]=${team.id}&seasons[]=${season}&per_page=${Math.max(limit, 25)}`
    );
    httpStatus = gamesRes?.status ?? httpStatus;
    const rows = (gamesRes?.data?.data || []).filter((g) => isFinalGame(g));
    if (rows.length) {
      games = rows;
      break;
    }
  }

  games.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));

  return {
    team,
    games: games.slice(0, limit),
    fetchStatus: games.length ? "ok" : "no_final_games",
    httpStatus,
  };
}

function isFinalGame(game = {}) {
  const status = String(game.status || "").toLowerCase();
  return (
    status.includes("final") ||
    status === "post" ||
    status === "closed" ||
    status === "completed" ||
    (Number(game.period) >= 4 &&
      (num(game.home_score ?? game.home_team_score) !== null ||
        num(game.away_score ?? game.visitor_team_score) !== null))
  );
}

function homeScore(game = {}) {
  return num(game.home_score ?? game.home_team_score);
}

function awayScore(game = {}) {
  return num(game.away_score ?? game.visitor_team_score ?? game.away_team_score);
}

function pointsAllowedFromGame(game = {}, opponentTeamId = null) {
  const home = homeScore(game);
  const away = awayScore(game);
  if (home === null || away === null) return null;

  const homeId = game.home_team?.id;
  const awayId = game.visitor_team?.id ?? game.away_team?.id;
  if (opponentTeamId && homeId === opponentTeamId) return away;
  if (opponentTeamId && awayId === opponentTeamId) return home;
  return null;
}

function gameTotal(game = {}) {
  const home = homeScore(game);
  const away = awayScore(game);
  if (home === null || away === null) return null;
  return home + away;
}

function avg(values = []) {
  if (!values.length) return null;
  return Number(
    (values.reduce((sum, v) => sum + v, 0) / values.length).toFixed(1)
  );
}

function unavailableResult(opponentTeam, reason, extras = {}) {
  return {
    defenseScore: null,
    status: "UNAVAILABLE",
    source: "unavailable",
    opponentPPG: null,
    pace: null,
    paceProxy: null,
    recentGameTotalAvg: null,
    sampleGames: 0,
    last5PointsAllowed: null,
    last10PointsAllowed: null,
    seasonPointsAllowed: null,
    reasons: [reason],
    probeDisabled: true,
    proxyUsed: false,
    available: false,
    confidenceEligible: false,
    defenseAudit: {
      resolvedDefenseScore: null,
      defenseSource: "unavailable",
      status: "UNAVAILABLE",
      proxyUsed: false,
      opponentPPG: null,
      unavailableReason: reason,
      version: DEFENSE_V2_VERSION,
    },
    quality: {
      available: false,
      provider: "balldontlie",
      fetchedAt: new Date().toISOString(),
      sampleSize: 0,
      quality: "UNAVAILABLE",
      stale: false,
      error: reason,
      fallbackUsed: false,
      confidenceEligible: false,
    },
    opponentTeam,
    ...extras,
  };
}

/**
 * WNBA opponent defense/pace from verified BDL recent final games.
 * team_season_averages is 404 (unauthorized/removed) — do not call it for live scoring.
 * SportsData WNBA team stats are 401 — do not enable as a generation source.
 */
export async function buildWnbaOpponentDefenseContext({
  opponentTeam = "",
  league = "WNBA",
} = {}) {
  if (String(league).toUpperCase() !== "WNBA" || !opponentTeam) {
    return unavailableResult(opponentTeam, "WNBA opponent team missing");
  }

  if (!isDefenseV2Enabled()) {
    // Legacy path kept only behind explicit flag disable — still no fake side vote.
    return unavailableResult(
      opponentTeam,
      "COURTEDGE_WNBA_DEFENSE_V2_ENABLED=false — defense withheld"
    );
  }

  const cacheKey = cleanTeamKey(opponentTeam);
  const cached = teamDefenseCache.get(cacheKey);
  if (cached && Date.now() - cached.loadedAt < CACHE_MS) {
    return cached.result;
  }

  if (!CONFIG.BALLDONTLIE_KEY) {
    const result = unavailableResult(opponentTeam, "BALLDONTLIE_KEY not loaded");
    teamDefenseCache.set(cacheKey, { loadedAt: Date.now(), result });
    return result;
  }

  const { team, games, fetchStatus, httpStatus } = await fetchRecentTeamGames(
    opponentTeam,
    12
  );

  if (!team?.id || !games.length) {
    const result = unavailableResult(
      opponentTeam,
      fetchStatus === "team_unresolved"
        ? `Opponent team unresolved for ${opponentTeam}`
        : `No recent BDL final games for opponent ${opponentTeam}`,
      { httpStatus, fetchStatus }
    );
    teamDefenseCache.set(cacheKey, { loadedAt: Date.now(), result });
    return result;
  }

  const allowed = games
    .map((g) => pointsAllowedFromGame(g, team.id))
    .filter((v) => v !== null && v > 0);

  if (!allowed.length) {
    const result = unavailableResult(
      opponentTeam,
      "BDL games found but points-allowed unavailable",
      { httpStatus, fetchStatus, sampleGames: games.length }
    );
    teamDefenseCache.set(cacheKey, { loadedAt: Date.now(), result });
    return result;
  }

  const last5 = allowed.slice(0, 5);
  const last10 = allowed.slice(0, 10);
  const opponentPPG = avg(allowed);
  const last5PointsAllowed = avg(last5);
  const last10PointsAllowed = avg(last10);
  const totals = games.map(gameTotal).filter((v) => v !== null && v > 0);
  const recentGameTotalAvg = avg(totals);
  // Labeled proxy only — not official possessions/pace from a season-stats feed.
  const paceProxy = recentGameTotalAvg;

  const leagueAvg = 82;
  let defenseScore = clamp(
    Math.round(50 + (opponentPPG - leagueAvg) * 2.2),
    20,
    80
  );

  if (paceProxy != null && paceProxy >= 168) {
    defenseScore = clamp(defenseScore + 3, 20, 85);
  } else if (paceProxy != null && paceProxy > 0 && paceProxy <= 152) {
    defenseScore = clamp(defenseScore - 3, 15, 80);
  }

  const status =
    defenseScore === 50 ? "CALCULATED_NEUTRAL" : "CALCULATED";

  const reasons = [
    `WNBA games proxy: opponent allows ${opponentPPG} PPG over ${allowed.length} finals`,
    opponentPPG >= leagueAvg
      ? "Above league avg scoring environment"
      : "Below league avg scoring environment",
  ];
  if (paceProxy != null) {
    reasons.push(
      `Pace proxy (avg game total) ${paceProxy} — not official possessions`
    );
  }
  if (status === "CALCULATED_NEUTRAL") {
    reasons.push("Calculated neutral defense (valid data equals 50)");
  }

  const result = {
    defenseScore,
    status,
    source: "wnba_games_proxy_v2",
    opponentPPG,
    pace: null,
    paceProxy,
    recentGameTotalAvg,
    sampleGames: allowed.length,
    last5PointsAllowed,
    last10PointsAllowed,
    seasonPointsAllowed: opponentPPG,
    reasons,
    probeDisabled: true,
    proxyUsed: true,
    available: true,
    confidenceEligible: allowed.length >= 3,
    opponentTeamId: team.id,
    opponentTeamName: teamLabel(team),
    httpStatus,
    fetchStatus,
    defenseAudit: {
      resolvedDefenseScore: defenseScore,
      defenseSource: "wnba_games_proxy_v2",
      status,
      proxyUsed: true,
      opponentPPG,
      paceProxy,
      sampleGames: allowed.length,
      unavailableReason: null,
      version: DEFENSE_V2_VERSION,
      note:
        "Derived from BDL final games; BDL team_season_averages 404; SportsData WNBA unauthorized",
    },
    quality: {
      available: true,
      provider: "balldontlie",
      fetchedAt: new Date().toISOString(),
      sampleSize: allowed.length,
      quality: allowed.length >= 5 ? "USABLE" : allowed.length >= 3 ? "DEVELOPING" : "EARLY",
      stale: false,
      error: null,
      fallbackUsed: true,
      confidenceEligible: allowed.length >= 3,
    },
  };

  teamDefenseCache.set(cacheKey, { loadedAt: Date.now(), result });
  return result;
}

export function clearWnbaOpponentDefenseCache() {
  teamDefenseCache.clear();
}

export { DEFENSE_V2_VERSION };
