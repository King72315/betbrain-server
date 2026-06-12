import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const SPORTS_BASE = "https://api.sportsdata.io/api/nba";
const SPORTS_V3_BASE = "https://api.sportsdata.io/v3/nba";
const API_KEY = CONFIG.SPORTS_KEY;

const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();

export function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function formatDate(date = new Date()) {
  const d = new Date(date);

  if (Number.isNaN(d.getTime())) {
    return new Date().toISOString().split("T")[0];
  }

  return d.toISOString().split("T")[0];
}

function dateForDaysAhead(daysAhead = 0) {
  const d = new Date();
  d.setDate(d.getDate() + Number(daysAhead || 0));
  return d;
}

function getNBASeasonYear(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.getMonth();

  // SportsData NBA season is usually the ending year.
  // Example: 2025-26 season => 2026.
  return month >= 9 ? year + 1 : year;
}

function normalizeLeague(league = "NBA") {
  return String(league || "NBA").toUpperCase() === "WNBA" ? "WNBA" : "NBA";
}

function normalizeTeam(value = "") {
  const raw = String(value || "").trim();
  const v = raw.toLowerCase();
  const c = clean(raw);

  const map = {
    "atlanta hawks": "atl",
    "boston celtics": "bos",
    "brooklyn nets": "bkn",
    "charlotte hornets": "cha",
    "chicago bulls": "chi",
    "cleveland cavaliers": "cle",
    "dallas mavericks": "dal",
    "denver nuggets": "den",
    "detroit pistons": "det",
    "golden state warriors": "gs",
    "houston rockets": "hou",
    "indiana pacers": "ind",
    "los angeles clippers": "lac",
    "los angeles lakers": "lal",
    "memphis grizzlies": "mem",
    "miami heat": "mia",
    "milwaukee bucks": "mil",
    "minnesota timberwolves": "min",
    "new orleans pelicans": "no",
    "new york knicks": "ny",
    "oklahoma city thunder": "okc",
    "orlando magic": "orl",
    "philadelphia 76ers": "phi",
    "phoenix suns": "phx",
    "portland trail blazers": "por",
    "sacramento kings": "sac",
    "san antonio spurs": "sa",
    "toronto raptors": "tor",
    "utah jazz": "uta",
    "washington wizards": "was",

    atl: "atl",
    bos: "bos",
    bkn: "bkn",
    brk: "bkn",
    cha: "cha",
    chi: "chi",
    cle: "cle",
    dal: "dal",
    den: "den",
    det: "det",
    gsw: "gs",
    gs: "gs",
    hou: "hou",
    ind: "ind",
    lac: "lac",
    lal: "lal",
    mem: "mem",
    mia: "mia",
    mil: "mil",
    min: "min",
    nop: "no",
    no: "no",
    nyk: "ny",
    ny: "ny",
    okc: "okc",
    orl: "orl",
    phi: "phi",
    phx: "phx",
    por: "por",
    sac: "sac",
    sas: "sa",
    sa: "sa",
    tor: "tor",
    uta: "uta",
    was: "was",
  };

  return map[v] || map[c] || c;
}

function getCache(key) {
  const item = cache.get(key);

  if (!item) return null;

  if (Date.now() - item.time > CACHE_MS) {
    cache.delete(key);
    return null;
  }

  return item.data;
}

function setCache(key, data) {
  cache.set(key, {
    time: Date.now(),
    data,
  });
}

async function fetchJson(url, label, options = {}) {
  const cacheKey = `${label}:${url}`;
  const cached = getCache(cacheKey);

  if (!options.force && cached) {
    console.log(`${label}: CACHE HIT`);
    return cached;
  }

  try {
    if (!API_KEY) {
      console.log(`${label}: SPORTS_KEY missing`);
      return [];
    }

    console.log(`${label} URL:`, url);

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.log(
        `${label} ERROR:`,
        res.status,
        JSON.stringify(data).slice(0, 500)
      );
      return [];
    }

    const result = Array.isArray(data) ? data : [];

    console.log(`${label} COUNT:`, result.length);

    setCache(cacheKey, result);

    return result;
  } catch (err) {
    console.log(`${label} FAILED:`, err.message);
    return [];
  }
}

function getPlayerName(record = {}) {
  return (
    record.Name ||
    record.PlayerName ||
    record.FullName ||
    record.Player ||
    `${record.FirstName || ""} ${record.LastName || ""}`.trim() ||
    ""
  );
}

function normalizePlayerRecord(record = {}) {
  const name = getPlayerName(record);

  return {
    ...record,
    Name: name,
    PlayerName: record.PlayerName || name,
    cleanName: clean(name),
    Team: normalizeTeam(
      record.Team ||
        record.TeamAbbreviation ||
        record.CurrentTeam ||
        record.CurrentTeamAbbreviation ||
        ""
    ),
    rawTeam:
      record.Team ||
      record.TeamAbbreviation ||
      record.CurrentTeam ||
      record.CurrentTeamAbbreviation ||
      "",
  };
}

function normalizeGameRecord(g = {}, date = "") {
  const homeTeam = normalizeTeam(g.HomeTeam || g.Home || "");
  const awayTeam = normalizeTeam(g.AwayTeam || g.Away || "");

  const time =
    g.DateTime ||
    g.GameDateTime ||
    g.DateTimeUTC ||
    g.Day ||
    g.StatusDateTime ||
    "";

  return {
    id: g.GameID || g.gameID || g.id || "",
    gameId: g.GameID || g.gameID || g.id || "",

    date,
    time,
    commenceTime: time,

    homeTeam,
    awayTeam,
    home: homeTeam,
    away: awayTeam,

    rawHomeTeam: g.HomeTeam || g.Home || "",
    rawAwayTeam: g.AwayTeam || g.Away || "",

    game: `${awayTeam.toUpperCase()} vs ${homeTeam.toUpperCase()}`,
    league: "NBA",

    raw: g,
  };
}

function normalizeSeasonStat(record = {}) {
  const name = getPlayerName(record);

  return {
    ...record,
    Name: name,
    PlayerName: record.PlayerName || name,
    cleanName: clean(name),
    Team: normalizeTeam(record.Team || record.TeamAbbreviation || ""),
    rawTeam: record.Team || record.TeamAbbreviation || "",
  };
}

function normalizeProjection(record = {}) {
  const name = getPlayerName(record);

  return {
    ...record,
    Name: name,
    PlayerName: record.PlayerName || name,
    cleanName: clean(name),
    Team: normalizeTeam(record.Team || record.TeamAbbreviation || ""),
    Opponent: normalizeTeam(
      record.Opponent ||
        record.OpponentTeam ||
        record.OpponentAbbreviation ||
        ""
    ),
    rawTeam: record.Team || record.TeamAbbreviation || "",
    rawOpponent:
      record.Opponent ||
      record.OpponentTeam ||
      record.OpponentAbbreviation ||
      "",
  };
}

export async function fetchGames(daysAhead = 0, league = "NBA") {
  const cleanLeague = normalizeLeague(league);

  if (cleanLeague !== "NBA") {
    console.log("SPORTSDATA fetchGames skipped for non-NBA league:", league);
    return [];
  }

  const date = formatDate(dateForDaysAhead(daysAhead));

  const url =
    `${SPORTS_V3_BASE}/odds/json/GamesByDate/${date}` +
    `?key=${API_KEY}`;

  const games = await fetchJson(url, `FETCH NBA GAMES ${date}`);

  return games.map((g) => normalizeGameRecord(g, date));
}

export async function fetchPlayers() {
  const url = `${SPORTS_BASE}/fantasy/json/Players?key=${API_KEY}`;

  const players = await fetchJson(url, "FETCH NBA PLAYERS");

  return players.map(normalizePlayerRecord);
}

export async function fetchSeasonStats(seasonYear = getNBASeasonYear()) {
  const url =
    `${SPORTS_BASE}/fantasy/json/PlayerSeasonStats/${seasonYear}` +
    `?key=${API_KEY}`;

  const stats = await fetchJson(
    url,
    `FETCH NBA SEASON STATS ${seasonYear}`
  );

  return stats.map(normalizeSeasonStat);
}

export async function fetchTeamSeasonStats(seasonYear = getNBASeasonYear()) {
  const url =
    `${SPORTS_V3_BASE}/scores/json/TeamSeasonStats/${seasonYear}` +
    `?key=${API_KEY}`;

  const stats = await fetchJson(
    url,
    `FETCH NBA TEAM SEASON STATS ${seasonYear}`
  );

  return stats.map((team) => ({
    ...team,
    Team: normalizeTeam(team.Team || team.Key || team.Name || ""),
    rawTeam: team.Team || team.Key || team.Name || "",
  }));
}

export async function fetchProjections(daysAhead = 0) {
  const date = formatDate(dateForDaysAhead(daysAhead));

  const url =
    `${SPORTS_BASE}/fantasy/json/PlayerGameProjectionStatsByDate/${date}` +
    `?key=${API_KEY}`;

  const projections = await fetchJson(
    url,
    `FETCH NBA PROJECTIONS ${date}`
  );

  return projections.map(normalizeProjection);
}

function addToMap(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, value);
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
    const normalized = normalizePlayerRecord(player);
    const name = normalized.Name;

    addToMap(playerMap, clean(name), normalized);

    if (normalized.PlayerID) {
      addToMap(playerMap, String(normalized.PlayerID), normalized);
    }
  }

  for (const stat of seasonStats) {
    const normalized = normalizeSeasonStat(stat);
    const name = normalized.Name;

    addToMap(seasonMap, clean(name), normalized);

    if (normalized.PlayerID) {
      addToMap(seasonMap, String(normalized.PlayerID), normalized);
    }
  }

  for (const projection of projections) {
    const normalized = normalizeProjection(projection);
    const name = normalized.Name;

    addToMap(projectionMap, clean(name), normalized);

    if (normalized.PlayerID) {
      addToMap(projectionMap, String(normalized.PlayerID), normalized);
    }
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

  return normalizeTeam(
    projection.Team ||
      player.Team ||
      season.Team ||
      projection.rawTeam ||
      player.rawTeam ||
      season.rawTeam ||
      ""
  );
}

export function getOpponentForTeam(game, team) {
  if (!game || !team) return "";

  const cleanTeam = normalizeTeam(team);
  const homeTeam = normalizeTeam(game.homeTeam || game.home || "");
  const awayTeam = normalizeTeam(game.awayTeam || game.away || "");

  if (homeTeam && cleanTeam === homeTeam) {
    return awayTeam;
  }

  if (awayTeam && cleanTeam === awayTeam) {
    return homeTeam;
  }

  return "";
}

export function getProjectionPoints(playerName, projectionMap) {
  const projection = projectionMap.get(clean(playerName)) || {};

  return num(
    projection.Points ??
      projection.ProjectedPoints ??
      projection.FantasyDataProjectedPoints ??
      projection.PlayerGameProjectionStat?.Points ??
      0
  );
}

export function getProjectionMinutes(playerName, projectionMap) {
  const projection = projectionMap.get(clean(playerName)) || {};

  return num(
    projection.Minutes ??
      projection.ProjectedMinutes ??
      projection.MinutesPlayed ??
      0
  );
}

export function getSeasonPoints(playerName, seasonMap) {
  const season = seasonMap.get(clean(playerName)) || {};

  const games = num(season.Games || season.GamesPlayed || 0);

  const ppg = num(
    season.PPG ||
      season.AveragePoints ||
      season.PointsPerGame ||
      0
  );

  if (ppg > 0 && ppg < 60) {
    return Number(ppg.toFixed(1));
  }

  const points = num(season.Points || 0);

  if (points > 0 && games > 0) {
    return Number((points / games).toFixed(1));
  }

  return 0;
}

export function getSeasonMinutes(playerName, seasonMap) {
  const season = seasonMap.get(clean(playerName)) || {};

  const games = num(season.Games || season.GamesPlayed || 0);

  const mpg = num(
    season.MPG ||
      season.MinutesPerGame ||
      season.AverageMinutes ||
      0
  );

  if (mpg > 0) return Number(mpg.toFixed(1));

  const minutes = num(season.Minutes || 0);

  if (minutes > 0 && games > 0) {
    return Number((minutes / games).toFixed(1));
  }

  return 0;
}

export function getSeasonFGA(playerName, seasonMap) {
  const season = seasonMap.get(clean(playerName)) || {};

  const games = num(season.Games || season.GamesPlayed || 0);

  const fgaPerGame = num(
    season.FGAPerGame ||
      season.FieldGoalsAttemptedPerGame ||
      season.AverageFGA ||
      0
  );

  if (fgaPerGame > 0) return Number(fgaPerGame.toFixed(1));

  const fga = num(season.FieldGoalsAttempted || season.FGA || 0);

  if (fga > 0 && games > 0) {
    return Number((fga / games).toFixed(1));
  }

  return 0;
}

export function getSportsDataHealth({
  players = [],
  seasonStats = [],
  projections = [],
} = {}) {
  return {
    players: players.length,
    seasonStats: seasonStats.length,
    projections: projections.length,
    hasPlayers: players.length > 0,
    hasSeasonStats: seasonStats.length > 0,
    hasProjections: projections.length > 0,
  };
}