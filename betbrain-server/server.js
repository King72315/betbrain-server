import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fetch from "node-fetch";

const matchup = await import("./matchupEngine.js");

const calcMatchupAdjustment = matchup.calcMatchupAdjustment;

dotenv.config();

const usage = await import("./usageEngine.js");

const calcUsageBoost = usage.calcUsageBoost;
const getMissingPlayers = usage.getMissingPlayers;

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.SPORTS_KEY;
const ODDS_KEY = process.env.ODDS_KEY;

console.log(
  "SPORTS KEY LOADED:",
  API_KEY ? "YES" : "NO"
);

let picksCache = null;
let lastRefreshTime = 0;
const CACHE_MINUTES = 30;

const fs = await import("fs");
const path = await import("path");

const HISTORY_FILE = path.default.join(process.cwd(), "pick-history.json");
const ACTIVE_PICKS_FILE = path.default.join(process.cwd(), "active-picks.json");
const FILTERED_PROPS_FILE = path.default.join(process.cwd(), "filtered-props.json");

const BLOCKED_PLAYERS = [
  "lukadoncic",
];

const TEAM_NAMES = {
  ATL: "Atlanta Hawks",
  BOS: "Boston Celtics",
  BKN: "Brooklyn Nets",
  CHA: "Charlotte Hornets",
  CHI: "Chicago Bulls",
  CLE: "Cleveland Cavaliers",
  DAL: "Dallas Mavericks",
  DEN: "Denver Nuggets",
  DET: "Detroit Pistons",
  GSW: "Golden State Warriors",
  HOU: "Houston Rockets",
  IND: "Indiana Pacers",
  LAC: "Los Angeles Clippers",
  LAL: "Los Angeles Lakers",
  MEM: "Memphis Grizzlies",
  MIA: "Miami Heat",
  MIL: "Milwaukee Bucks",
  MIN: "Minnesota Timberwolves",
  NOP: "New Orleans Pelicans",
  NYK: "New York Knicks",
  OKC: "Oklahoma City Thunder",
  ORL: "Orlando Magic",
  PHI: "Philadelphia 76ers",
  PHX: "Phoenix Suns",
  POR: "Portland Trail Blazers",
  SAC: "Sacramento Kings",
  SAS: "San Antonio Spurs",
  TOR: "Toronto Raptors",
  UTA: "Utah Jazz",
  WAS: "Washington Wizards",
};

function clean(v) {
  return String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

async function fetchLast5Games(playerId) {
  try {
    if (!playerId) return [];

    const cacheKey = String(playerId);
    if (ballLast5Cache.has(cacheKey)) {
      return ballLast5Cache.get(cacheKey);
    }

    const response = await fetch(
     `https://api.balldontlie.io/v1/stats?player_ids[]=${playerId}&seasons[]=2025&postseason=true&per_page=25`,
      {
        headers: {
          Authorization: process.env.BALLDONTLIE_KEY,
        },
      }
    );

    const data = await response.json();
     console.log("LAST5 RAW:", playerId, data);
    if (!data?.data) return [];

const games = (data.data || [])
  .filter((g) => g?.game?.date)
  .sort(
    (a, b) =>
      new Date(b.game.date) - new Date(a.game.date)
  )
  .slice(0, 5);

console.log(
  "LAST5 SORTED:",
  playerId,
  games.map((g) => ({
    date: g.game?.date,
    pts: g.pts,
    min: g.min,
  }))
);

 const normalizedGames = games.map((g) => ({
  date: g.game?.date,

  points: Number(g.pts || 0),
  rebounds: Number(g.reb || 0),
  assists: Number(g.ast || 0),
  threes: Number(g.fg3m || 0),

  minutes: Number(g.min || 0),

  fga:
    Number(g.fga || 0) ||
    Number(g.fgm || 0) +
      Number(g.fg3m || 0) * 0.5,

  fta: Number(g.fta || 0),

  starter:
    Number(g.min || 0) >= 24,
}));

ballLast5Cache.set(cacheKey, normalizedGames);
return normalizedGames;

  } catch (err) {
    console.log("FETCH LAST5 ERROR:", err.message);
    return [];
  }
}

async function fetchPlayerVsOpponentGames(playerId, playerTeam, opponentTeam) {
  try {
    if (!playerId || !playerTeam || !opponentTeam) return [];

    const response = await fetch(
      `https://api.balldontlie.io/v1/stats?player_ids[]=${playerId}&seasons[]=2025&postseason=true&per_page=100`,
      {
        headers: {
          Authorization: process.env.BALLDONTLIE_KEY,
        },
      }
    );

    const data = await response.json();

    const games = data?.data || [];

    const matchedGames = games
      .filter((g) => {
        const gameText = JSON.stringify(g).toLowerCase();

        return gameText.includes(String(opponentTeam).toLowerCase());
      })
      .sort(
        (a, b) =>
          new Date(b.game?.date || 0) - new Date(a.game?.date || 0)
      )
      .slice(0, 5)
      .map((g) => ({
        date: g.game?.date,
        points: Number(g.pts || 0),
        rebounds: Number(g.reb || 0),
        assists: Number(g.ast || 0),
        threes: Number(g.fg3m || 0),
        minutes: Number(g.min || 0),
        fga: Number(g.fga || 0),
        fta: Number(g.fta || 0),
      }));

    console.log("VS OPPONENT GAMES:", {
      playerId,
      playerTeam,
      opponentTeam,
      found: matchedGames.length,
      games: matchedGames,
    });

    return matchedGames;
  } catch (err) {
    console.log("FETCH VS OPPONENT ERROR:", err.message);
    return [];
  }
}

const ballPlayerIdCache = new Map();
const ballLast5Cache = new Map();

const ballTeamIdCache = new Map();

async function findBallTeamId(teamAbbr) {
  try {
    if (!teamAbbr) return null;

    const key = String(teamAbbr).toUpperCase();

    if (ballTeamIdCache.has(key)) {
      return ballTeamIdCache.get(key);
    }

    const response = await fetch(
      "https://api.balldontlie.io/nba/v1/teams",
      {
        headers: {
          Authorization: process.env.BALLDONTLIE_KEY,
        },
      }
    );

    const data = await response.json();

    const team = (data?.data || []).find(
      (t) => String(t.abbreviation).toUpperCase() === key
    );

    const id = team?.id || null;

    ballTeamIdCache.set(key, id);

    console.log("BALL TEAM MATCH:", key, id);

    return id;
  } catch (err) {
    console.log("BALL TEAM MATCH ERROR:", teamAbbr, err.message);
    return null;
  }
}

async function fetchOpponentDefenseProfile(teamAbbr) {
  try {
    if (!teamAbbr) return null;

    const teamId = await findBallTeamId(teamAbbr);
    if (!teamId) return null;

    const url =
      `https://api.balldontlie.io/nba/v1/team_season_averages/general` +
      `?season=2025` +
      `&season_type=playoffs` +
      `&type=defense` +
      `&team_ids[]=${teamId}`;

    const response = await fetch(url, {
      headers: {
        Authorization: process.env.BALLDONTLIE_KEY,
      },
    });

    const data = await response.json();
    const profile = data?.data?.[0] || null;

    console.log("OPPONENT DEFENSE PROFILE:", teamAbbr, profile);

    return profile;
  } catch (err) {
    console.log("OPPONENT DEFENSE PROFILE ERROR:", teamAbbr, err.message);
    return null;
  }
}

async function findBallPlayerId(playerName) {
  try {
    if (!playerName) return null;

    const cacheKey = clean(playerName);

    if (ballPlayerIdCache.has(cacheKey)) {
      return ballPlayerIdCache.get(cacheKey);
    }

    const parts = String(playerName).split(" ");
    const firstName = parts[0] || "";
    const lastName = parts.slice(1).join(" ") || "";

    const response = await fetch(
      `https://api.balldontlie.io/v1/players?first_name=${encodeURIComponent(firstName)}&last_name=${encodeURIComponent(lastName)}`,
      {
        headers: {
          Authorization: process.env.BALLDONTLIE_KEY,
        },
      }
    );

    const data = await response.json();
    const player = data?.data?.[0];

    const id = player?.id || null;

    ballPlayerIdCache.set(cacheKey, id);

    console.log("BALL ID MATCH:", playerName, id);

    return id;
  } catch (err) {
    console.log("BALL ID MATCH ERROR:", playerName, err.message);
    return null;
  }
}


function readJsonFile(file, fallback = []) {
  try {
    if (!fs.default.existsSync(file)) return fallback;
    return JSON.parse(fs.default.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonFile(file, data) {
  try {
    fs.default.writeFileSync(file, JSON.stringify(data, null, 2));
  } catch (err) {
    console.log("WRITE FILE ERROR:", err.message);
  }
}

function readActivePicks() {
  return readJsonFile(ACTIVE_PICKS_FILE, []);
}

function saveActivePicks(picks) {
  writeJsonFile(ACTIVE_PICKS_FILE, picks);
}

function readPickHistory() {
  return readJsonFile(HISTORY_FILE, []);
}

function savePickHistory(history) {
  writeJsonFile(HISTORY_FILE, history);
}

function readFilteredProps() {
  return readJsonFile(FILTERED_PROPS_FILE, []);
}

function saveFilteredProp(prop, reason, filterScore = 0) {
  const filtered = readFilteredProps();

  filtered.push({
    date: new Date().toISOString(),
    reason,
    filterScore,
    game: prop.game || "",
    gameId: prop.gameId || "",
    player: prop.player || prop.playerName || "",
    stat: prop.stat || "",
    line: prop.line || 0,
    pick: prop.pick || "",
    projection: prop.projection || 0,
    edge: prop.edge || 0,
    confidence: prop.confidence || 0,
  });

  writeJsonFile(FILTERED_PROPS_FILE, filtered.slice(-500));
}

function formatDate(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateForDaysAhead(daysAhead = 0) {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
}

function teamFullName(team) {
  return TEAM_NAMES[team] || team;
}

function gameMatchesEvent(game, event) {
  const gameHome = clean(teamFullName(game.HomeTeam));
  const gameAway = clean(teamFullName(game.AwayTeam));

  const eventHome = clean(event.home_team);
  const eventAway = clean(event.away_team);

  const normalMatch =
    (eventHome.includes(gameHome) || gameHome.includes(eventHome)) &&
    (eventAway.includes(gameAway) || gameAway.includes(eventAway));

  const flippedMatch =
    (eventHome.includes(gameAway) || gameAway.includes(eventHome)) &&
    (eventAway.includes(gameHome) || gameHome.includes(eventAway));

  return normalMatch || flippedMatch;
}

function normalizeMarketStat(key) {
  if (key === "player_points") return "Points";
  if (key === "player_rebounds") return "Rebounds";
  if (key === "player_assists") return "Assists";
  if (key === "player_threes") return "Threes";
  return "";
}

function getProjectionValue(proj, stat) {
  if (!proj) return 0;
  if (stat === "Points") return Number(proj.Points || 0);
  if (stat === "Rebounds") return Number(proj.Rebounds || 0);
  if (stat === "Assists") return Number(proj.Assists || 0);
  if (stat === "Threes") return Number(proj.Threes || proj.ThreePointersMade || 0);
  return 0;
}

function validLine(stat, line) {
  if (!line || line <= 0) return false;
  if (stat === "Points") return line >= 5 && line <= 45;
  if (stat === "Rebounds") return line >= 2 && line <= 20;
  if (stat === "Assists") return line >= 2 && line <= 18;
  if (stat === "Threes") return line >= 0.5 && line <= 8.5;
  return false;
}

function getConsistencyScore(values = [], line = 0, pick = "Over") {
  if (!Array.isArray(values) || values.length < 3) return 55;

  const nums = values.map(Number).filter((v) => !Number.isNaN(v));
  if (nums.length < 3) return 50;
  if (nums.length < 5) return 54;

  const isHit = (v) => (pick === "Over" ? v >= line : v <= line);
  const isStrong = (v) => (pick === "Over" ? v > line + 6 : v < line - 6);
  const isBadMiss = (v) => (pick === "Over" ? v < line - 6 : v > line + 6);

  const hits = nums.filter(isHit).length;
  const hitRate = hits / nums.length;

  const recent = nums.slice(-5);

const recentHits = recent.filter(isHit).length;

const crushHits = recent.filter(v =>
  pick === "Over"
    ? v >= line + 3
    : v <= line - 3
).length;

const recentHitRate =
  (recentHits + (crushHits * 0.5))
  / Math.min(5, nums.length);

  const avg = nums.reduce((sum, v) => sum + v, 0) / nums.length;
  const variance =
    nums.reduce((sum, v) => sum + Math.abs(v - avg), 0) / nums.length;

  const range = Math.max(...nums) - Math.min(...nums);

  let score = Math.round(hitRate * 55 + recentHitRate * 25 + 20);

  if (variance > 12) score -= 30;
  else if (variance > 9) score -= 20;
  else if (variance > 6) score -= 10;

  if (variance < 3) score += 12;
  else if (variance < 5) score += 6;

  if (range <= 6) score += 10;
  else if (range <= 10) score += 5;

  if (range >= 20) score -= 10;
  if (range >= 30) score -= 15;

  const badMissGames = nums.filter(isBadMiss).length;
  const strongGames = nums.filter(isStrong).length;

  if (badMissGames >= 3) score -= 12;
  else if (badMissGames >= 2) score -= 6;

  if (strongGames >= 3) score += 6;

  if (recent.length >= 3) {
    const recentAvg =
      recent.reduce((sum, v) => sum + v, 0) / recent.length;

    if (pick === "Over") {
      if (recentAvg > line + 4) score += 8;
      else if (recentAvg > line + 2) score += 5;

      if (recentAvg < line - 4) score -= 10;
      else if (recentAvg < line - 2) score -= 6;
    } else {
      if (recentAvg < line - 4) score += 8;
      else if (recentAvg < line - 2) score += 5;

      if (recentAvg > line + 4) score -= 10;
      else if (recentAvg > line + 2) score -= 6;
    }
  }

  return Math.max(0, Math.min(100, score));
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.log("FETCH ERROR:", res.status, JSON.stringify(data).slice(0, 500));
  }

  return data;
}

async function fetchGames(daysAhead = 0) {
  const date = formatDate(dateForDaysAhead(daysAhead));
  const url = `https://api.sportsdata.io/api/nba/odds/json/GamesByDate/${date}?key=${API_KEY}`;
  const data = await fetchJson(url);

  console.log("GAMES URL:", url);
  console.log("GAMES RESPONSE:", JSON.stringify(data).slice(0, 500));

  return Array.isArray(data) ? data : [];
}

async function fetchPlayers() {
  const url = `https://api.sportsdata.io/api/nba/fantasy/json/Players?key=${API_KEY}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? data : [];
}

async function fetchSeasonStats() {
  const url = `https://api.sportsdata.io/api/nba/fantasy/json/PlayerSeasonStats/2026?key=${API_KEY}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? data : [];
}

async function fetchProjections(daysAhead = 0) {
  const date = formatDate(dateForDaysAhead(daysAhead));
  const url = `https://api.sportsdata.io/api/nba/fantasy/json/PlayerGameProjectionStatsByDate/${date}?key=${API_KEY}`;
  const data = await fetchJson(url);

  console.log("PROJECTION URL:", url);
  console.log("PROJECTION RESPONSE:", JSON.stringify(data).slice(0, 1000));

  return Array.isArray(data) ? data : [];
}

async function fetchOddsEvents() {
  try {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${ODDS_KEY}`;
    const data = await fetchJson(url);

    console.log("ODDS EVENTS FOUND:", Array.isArray(data) ? data.length : 0);

    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.log("ODDS EVENTS ERROR:", err.message);
    return [];
  }
}

async function fetchPlayerProps(eventId) {
  try {
    const markets = [
      "player_points",
      "player_rebounds",
      "player_assists",
      "player_threes",
    ].join(",");

    const url =
      `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/odds` +
      `?apiKey=${ODDS_KEY}` +
      `&regions=us` +
      `&markets=${markets}` +
      `&oddsFormat=american`;

    const data = await fetchJson(url);

    console.log("PROPS URL:", url);
    console.log("PROPS RAW:", JSON.stringify(data).slice(0, 700));

    return Array.isArray(data.bookmakers) ? data.bookmakers : [];
  } catch (err) {
    console.log("PLAYER PROPS ERROR:", err.message);
    return [];
  }
}

function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function getPlayerTeam(playerName, projectionInfo, players) {
  if (projectionInfo?.Team) return projectionInfo.Team;

  const player = players.find(
    (p) => clean(p.Name || p.name) === clean(playerName)
  );

  return player?.Team || player?.team || "";
}

function getOpponentTeam(game, playerTeam) {
  if (!playerTeam) return "";

  if (clean(playerTeam) === clean(game.HomeTeam)) {
    return game.AwayTeam;
  }

  if (clean(playerTeam) === clean(game.AwayTeam)) {
    return game.HomeTeam;
  }

  return "";
}

function getSpreadValue(game) {
  return (
    safeNum(game.PointSpread) ||
    safeNum(game.Spread) ||
    safeNum(game.HomePointSpread) ||
    safeNum(game.AwayPointSpread) ||
    safeNum(game.HomeSpread) ||
    safeNum(game.AwaySpread) ||
    0
  );
}

function getGameTotal(game) {
  return (
    safeNum(game.OverUnder) ||
    safeNum(game.Total) ||
    safeNum(game.GameTotal) ||
    safeNum(game.OddsmakersTotal) ||
    0
  );
}

function isHomePlayer(game, playerTeam) {
  if (!game || !playerTeam) return false;
  return clean(game.HomeTeam) === clean(playerTeam);
}

function isAwayPlayer(game, playerTeam) {
  if (!game || !playerTeam) return false;
  return clean(game.AwayTeam) === clean(playerTeam);
}

function playedYesterday(team, currentGame, scheduleGames = []) {
  if (!team || !currentGame?.DateTime) return false;

  const currentDate = new Date(currentGame.DateTime);

  return scheduleGames.some((g) => {
    if (!g.DateTime || g.GameID === currentGame.GameID) return false;

    const gameDate = new Date(g.DateTime);
    const diffHours =
      Math.abs(currentDate - gameDate) / 1000 / 60 / 60;

    const sameTeam =
      clean(g.HomeTeam) === clean(team) ||
      clean(g.AwayTeam) === clean(team);

    return sameTeam && diffHours >= 18 && diffHours <= 32;
  });
}

function getRestRisk(team, currentGame, scheduleGames = []) {
  if (!team || !currentGame?.DateTime) {
    return {
      penalty: 0,
      label: "",
    };
  }

  const currentDate = new Date(currentGame.DateTime);

  const recentGames = scheduleGames.filter((g) => {
    if (!g.DateTime || g.GameID === currentGame.GameID) return false;

    const gameDate = new Date(g.DateTime);
    const diffHours =
      (currentDate - gameDate) / 1000 / 60 / 60;

    const sameTeam =
      clean(g.HomeTeam) === clean(team) ||
      clean(g.AwayTeam) === clean(team);

    return sameTeam && diffHours > 0 && diffHours <= 72;
  });

  if (recentGames.length >= 3) {
    return {
      penalty: -6,
      label: "Heavy recent schedule",
    };
  }

  if (recentGames.length >= 2) {
    return {
      penalty: -4,
      label: "Short-rest schedule",
    };
  }

  if (playedYesterday(team, currentGame, scheduleGames)) {
    return {
      penalty: -3,
      label: "Back-to-back fatigue",
    };
  }

  return {
    penalty: 0,
    label: "",
  };
}

function getPaceAdjustment(total, stat, pick) {
  if (!total) {
    return {
      adjustment: 0,
      label: "",
    };
  }

  let adjustment = 0;
  let label = "";

  if (total >= 240) {
    adjustment = pick === "Over" ? 6 : -5;
    label = "Very fast/high-total game";
  } else if (total >= 232) {
    adjustment = pick === "Over" ? 4 : -3;
    label = "Fast/high-total game";
  } else if (total <= 210) {
    adjustment = pick === "Under" ? 5 : -5;
    label = "Very slow/low-total game";
  } else if (total <= 218) {
    adjustment = pick === "Under" ? 3 : -3;
    label = "Slow/low-total game";
  }

  if (stat === "Threes" && total >= 232 && pick === "Over") {
    adjustment += 1;
  }

  if (stat === "Assists" && total >= 232 && pick === "Over") {
    adjustment += 1;
  }

  return {
    adjustment,
    label,
  };
}

function getBlowoutAdjustment(spread, stat, pick) {
  let adjustment = 0;
  let label = "";

  if (spread >= 16) {
    adjustment -= stat === "Points" || stat === "Threes" ? 10 : 7;
    label = "Extreme blowout risk";
  } else if (spread >= 12) {
    adjustment -= stat === "Points" || stat === "Threes" ? 7 : 5;
    label = "High blowout risk";
  } else if (spread >= 9) {
    adjustment -= 4;
    label = "Moderate blowout risk";
  } else if (spread >= 7) {
    adjustment -= 2;
    label = "Small blowout risk";
  }

  if (pick === "Under" && spread >= 12) {
    adjustment += 2;
  }

  return {
    adjustment,
    label,
  };
}

function getHomeAwayAdjustment(game, playerTeam, stat, pick) {
  let adjustment = 0;
  const reasons = [];

  if (isHomePlayer(game, playerTeam)) {
    if (pick === "Over") {
      adjustment += 2;
      reasons.push("Home-court boost");
    }

    if (stat === "Points" || stat === "Threes") {
      adjustment += 1;
      reasons.push("Home shooting comfort");
    }
  }

  if (isAwayPlayer(game, playerTeam)) {
    if (pick === "Over") {
      adjustment -= 2;
      reasons.push("Road-game risk");
    }

    if (stat === "Threes") {
      adjustment -= 1;
      reasons.push("Road shooting risk");
    }

    if (pick === "Under") {
      adjustment += 1;
      reasons.push("Road under lean");
    }
  }

  return {
    adjustment,
    reasons,
  };
}

function getOpponentDefenseProxy(opponentTeam, stat, total) {
  if (!opponentTeam) {
    return {
      adjustment: 0,
      label: "",
    };
  }

  const strongDefenses = [
    "BOS",
    "MIN",
    "OKC",
    "ORL",
    "NYK",
    "MIA",
  ];

  const weakDefenses = [
    "WAS",
    "CHA",
    "DET",
    "POR",
    "ATL",
    "UTA",
  ];

  let adjustment = 0;
  let label = "";

  if (strongDefenses.includes(opponentTeam)) {
    adjustment -= stat === "Points" || stat === "Threes" ? 4 : 2;
    label = "Strong opponent defense proxy";
  }

  if (weakDefenses.includes(opponentTeam)) {
    adjustment += stat === "Points" || stat === "Assists" ? 3 : 2;
    label = "Weak opponent defense proxy";
  }

  if (total >= 235 && adjustment < 0) {
    adjustment += 1;
  }

  if (total <= 215 && adjustment > 0) {
    adjustment -= 1;
  }

  return {
    adjustment,
    label,
  };
}

function getPlayerHealthRisk(playerData = {}, projectionInfo = {}) {
  const status = String(
    playerData.Status ||
    playerData.InjuryStatus ||
    projectionInfo.Status ||
    projectionInfo.InjuryStatus ||
    ""
  ).toLowerCase();

  if (!status) {
    return {
      blocked: false,
      penalty: 0,
      label: "No injury flag",
    };
  }

  if (
    status.includes("out") ||
    status.includes("inactive") ||
    status.includes("suspended")
  ) {
    return {
      blocked: true,
      penalty: 100,
      label: status,
    };
  }

  if (
    status.includes("doubtful")
  ) {
    return {
      blocked: false,
      penalty: 20,
      label: status,
    };
  }

  if (
    status.includes("questionable")
  ) {
    return {
      blocked: false,
      penalty: 10,
      label: status,
    };
  }

  return {
    blocked: false,
    penalty: 0,
    label: status,
  };
}

function getTeamInjuryUsageBoost(playerTeam, playerName, players = []) {
  if (!playerTeam) return 0;

  const injuredTeammates = players.filter((p) => {
    const sameTeam =
      clean(p.Team || p.team) === clean(playerTeam);

    const notSamePlayer =
      clean(p.Name || p.name) !== clean(playerName);

    const status = String(
      p.Status || p.InjuryStatus || ""
    ).toLowerCase();

    const hurt =
      status.includes("out") ||
      status.includes("doubtful") ||
      status.includes("injured") ||
      status.includes("inactive");

    return sameTeam && notSamePlayer && hurt;
  });

  if (injuredTeammates.length >= 3) return 5;
  if (injuredTeammates.length === 2) return 3;
  if (injuredTeammates.length === 1) return 1;

  return 0;
}


function getContextAdjustment({
  game,
  stat,
  pick,
  playerTeam,
  scheduleGames,
}) {
  let adjustment = 0;
  const reasons = [];

  const spread = Math.abs(getSpreadValue(game));
  const total = getGameTotal(game);
  const opponentTeam = getOpponentTeam(game, playerTeam);

  const blowout = getBlowoutAdjustment(spread, stat, pick);
  adjustment += blowout.adjustment;
  if (blowout.label) reasons.push(blowout.label);

  const pace = getPaceAdjustment(total, stat, pick);
  adjustment += pace.adjustment;
  if (pace.label) reasons.push(pace.label);

  const homeAway = getHomeAwayAdjustment(game, playerTeam, stat, pick);
  adjustment += homeAway.adjustment;
  reasons.push(...homeAway.reasons);

  const restRisk = getRestRisk(playerTeam, game, scheduleGames);
  adjustment += restRisk.penalty;
  if (restRisk.label) reasons.push(restRisk.label);

  const opponentDefense = getOpponentDefenseProxy(
    opponentTeam,
    stat,
    total
  );

  adjustment += opponentDefense.adjustment;
  if (opponentDefense.label) reasons.push(opponentDefense.label);

  return {
    adjustment,
    reasons,
    spread,
    total,
    opponentTeam,
  };
}
  
  

function getMarketAgreement(bookProps = []) {
  const prices = bookProps
    .map((p) => safeNum(p.odds))
    .filter((v) => v !== 0);

  if (prices.length < 2) {
    return {
      boost: 0,
      label: "Single book",
    };
  }

  const avg =
    prices.reduce((sum, v) => sum + v, 0) / prices.length;

  const variance =
    prices.reduce((sum, v) => sum + Math.abs(v - avg), 0) /
    prices.length;

  if (variance <= 20) {
    return {
      boost: 4,
      label: "Strong sportsbook agreement",
    };
  }

  if (variance <= 40) {
    return {
      boost: 2,
      label: "Decent sportsbook agreement",
    };
  }

  return {
    boost: -3,
    label: "Books disagree",
  };
}

function getOddsPriceSignal(odds, pick) {
  const price = Number(odds || 0);

  if (!price) return 0;

  if (pick === "Over") {
    if (price <= -150) return 5;
    if (price <= -130) return 3;
    if (price <= -115) return 1;

    if (price >= 130) return -4;
    if (price >= 115) return -2;
  }

  if (pick === "Under") {
    if (price <= -150) return 5;
    if (price <= -130) return 3;
    if (price <= -115) return 1;

    if (price >= 130) return -4;
    if (price >= 115) return -2;
  }

  return 0;
}

async function addRealSportsbookProps({
  game,
  bookmakers,
  projectionMap,
  players,
  seasonStats,
  allProps,
  scheduleGames = [],
}) {
  const rawProps = [];

  for (const book of bookmakers) {
    for (const market of book.markets || []) {
      const stat = normalizeMarketStat(market.key);
      if (stat !== "Points") continue;

      for (const outcome of market.outcomes || []) {
        const playerName = outcome.description;
        const line = Number(outcome.point || 0);

        if (!playerName || !validLine(stat, line)) continue;
        if (BLOCKED_PLAYERS.includes(clean(playerName))) continue;

        rawProps.push({
          book,
          market,
          outcome,
          playerName,
          stat,
          line,
          odds: outcome.price,
        });
      }
    }
  }

  for (const prop of rawProps) {
    const {
      book,
      outcome,
      playerName,
      stat,
      line,
    } = prop;

    const projectionInfo = projectionMap.get(clean(playerName));

    let projection = 0;
    let last5Average = 0;
    let matchupConfidenceAdjustment = 0;


    if (projectionInfo) {
  const seasonProjection = getProjectionValue(projectionInfo, stat);

  const last5Games = await fetchLast5Games(
    projectionInfo.PlayerID || projectionInfo.playerID
  );

 const last5Points = last5Games
  .map((g) => Number(g.points || 0))
  .filter((n) => n > 0);

    last5Average =
    last5Points.length > 0
      ? last5Points.reduce((a, b) => a + b, 0) / last5Points.length
      : seasonProjection;
let consistencyBonus = 0;

const recentHits = last5Points.filter(
  (p) => p >= line
).length;

if (recentHits >= 4) {
  consistencyBonus = 1.5;
} else if (recentHits >= 3) {
  consistencyBonus = 0.7;
}

  projection =
  seasonProjection * 0.65 +
  last5Average * 0.35 +
  consistencyBonus;

  const earlyPlayerTeam = getPlayerTeam(
  playerName,
  projectionInfo,
  players
);

const earlyOpponentTeam = getOpponentTeam(
  game,
  earlyPlayerTeam
);

const playerVsOpponent = await fetchPlayerVsOpponentGames(
  projectionInfo.PlayerID || projectionInfo.playerID,
  earlyPlayerTeam,
  earlyOpponentTeam
);

const matchupData = calcMatchupAdjustment({
  last5Overall: last5Games,
  opponentGames: playerVsOpponent,
  stat,
});

if (matchupData.projectionAdjustment !== null) {
  projection += matchupData.projectionAdjustment;
}

if (matchupData.confidenceAdjustment !== null) {
  matchupConfidenceAdjustment =
    matchupData.confidenceAdjustment;
}

const opponentProfile =
  await fetchOpponentDefenseProfile(
    earlyOpponentTeam
  );

if (opponentProfile) {

  const defensiveRating =
    Number(
      opponentProfile.defensive_rating ||
      opponentProfile.estimated_defensive_rating ||
      110
    );

  const pace =
    Number(
      opponentProfile.pace ||
      opponentProfile.estimated_pace ||
      100
    );

  let defenseAdjustment = 0;

const defRank =
  Number(opponentProfile.def_rating_rank ?? 0);

const paintRank =
  Number(opponentProfile.opp_pts_paint_rank ?? 0);

const fastBreakRank =
  Number(opponentProfile.opp_pts_fb_rank ?? 0);

const blockRank =
  Number(opponentProfile.blk_rank ?? 0);

console.log("DEFENSE VALUES:", {
  defRank,
  paintRank,
  fastBreakRank,
  blockRank,
});

// Overall defensive strength
if (defRank > 0 && defRank <= 5) {
  defenseAdjustment -= 2;
} else if (defRank > 0 && defRank <= 10) {
  defenseAdjustment -= 1;
} else if (defRank >= 25) {
  defenseAdjustment += 2;
} else if (defRank >= 20) {
  defenseAdjustment += 1;
}

// Paint defense matters for points
if (stat === "Points" && paintRank > 0 && paintRank <= 5) {
  defenseAdjustment -= 1;
}

// Fast break defense matters for points
if (stat === "Points" && fastBreakRank > 0 && fastBreakRank <= 5) {
  defenseAdjustment -= 1;
}

// Shot blocking hurts scorers around the rim
if (stat === "Points" && blockRank > 0 && blockRank <= 8) {
  defenseAdjustment -= 1;
}

// Pace still matters
if (pace > 101) {
  defenseAdjustment += 1;
}

if (pace < 97) {
  defenseAdjustment -= 1;
}

  projection += defenseAdjustment;
console.log("AFTER DEFENSE ADJUSTMENT:", {
  playerName,
  earlyOpponentTeam,
  projection,
  defenseAdjustment,
});


  matchupConfidenceAdjustment +=
    defenseAdjustment;

  console.log(
  "FULL DEFENSE PROFILE:",
  JSON.stringify(opponentProfile, null, 2)
);
}

console.log(
  "MATCHUP CHECK:",
  playerName,
  earlyPlayerTeam,
  "vs",
  earlyOpponentTeam,
  matchupData
);

const recent3 = last5Points.slice(0,3);

const recent3Average =
  recent3.length > 0
    ? recent3.reduce((a,b)=>a+b,0)/recent3.length
    : last5Average;

if (recent3Average >= line + 4) {
  projection += 2;
}
else if (recent3Average >= line + 2) {
  projection += 1;
}

if (recent3Average <= line - 4) {
  projection -= 2;
}
else if (recent3Average <= line - 2) {
  projection -= 1;
}

const recentMinutes =
  last5Games
    .slice(0,3)
    .map(g => Number(g.min || 0));

const olderMinutes =
  last5Games
    .slice(3,5)
    .map(g => Number(g.min || 0));

const recentMinutesAvg =
  recentMinutes.length
    ? recentMinutes.reduce((a,b)=>a+b,0)/recentMinutes.length
    : 0;

const olderMinutesAvg =
  olderMinutes.length
    ? olderMinutes.reduce((a,b)=>a+b,0)/olderMinutes.length
    : recentMinutesAvg;

if (recentMinutesAvg >= olderMinutesAvg + 4) {
  projection += 1.5;
}
else if (recentMinutesAvg >= olderMinutesAvg + 2) {
  projection += 0.8;
}

if (recentMinutesAvg <= olderMinutesAvg - 4) {
  projection -= 1.5;
}
else if (recentMinutesAvg <= olderMinutesAvg - 2) {
  projection -= 0.8;
}

  if (projectionInfo.Minutes >= 34) {
    projection += 1.2;
  } else if (projectionInfo.Minutes >= 30) {
    projection += 0.6;
  }


  const fga =
    Number(projectionInfo.FieldGoalsAttempted || 0);

  if (fga >= 18) {
    projection += 1.5;
  } else if (fga >= 15) {
    projection += 0.8;
  }

  const fta =
    Number(projectionInfo.FreeThrowsAttempted || 0);

  if (fta >= 6) {
    projection += 0.8;
  }

if (last5Average <= line - 5) {
  projection -= 2.5;
} else if (last5Average <= line - 3) {
  projection -= 1.5;
}

if (projectionInfo.Minutes < 30) {
  projection -= 1.2;
}

if (projectionInfo.Minutes < 26) {
  projection -= 2;
}

if (fga <= 10) {
  projection -= 2;
} else if (fga <= 13) {
  projection -= 1;
}

if (fta <= 2) {
  projection -= 1;
}
    }

    if (!projection) {
      projection = getFallbackProjection(
        playerName,
        players,
        seasonStats,
        stat
      );
    }

   if (!projection) continue;



const initialPick =
  projection - line >= 0
    ? "Over"
    : "Under";

const lineGap =
  Math.abs(last5Average - line);

if (initialPick === "Over") {
  if (lineGap >= 6) projection += 1.5;
  else if (lineGap >= 4) projection += 0.8;
} else {
  if (lineGap >= 6) projection -= 1.5;
  else if (lineGap >= 4) projection -= 0.8;
}

const projectionGap =
  Math.abs(projection - last5Average);

if (projectionGap >= 10) {
 projection =
 ((projection * 0.6) + (last5Average * 0.4));
}
else if (projectionGap >= 6) {
 projection =
 ((projection * 0.75) + (last5Average * 0.25));
}

const lineValue =
  ((last5Average + projection) / 2) - line;

const edgeRaw =
  projection - line;

let pick =
  edgeRaw >= 0
    ? "Over"
    : "Under";


const edge =
  Math.abs(edgeRaw);

if (edge < 1.5) continue;

    const playerData =
      players.find(
        (p) => clean(p.Name || p.name) === clean(playerName)
      ) || {};

    const playerTeam = getPlayerTeam(
      playerName,
      projectionInfo,
      players
    );

    const opponentTeam = getOpponentTeam(game, playerTeam);

    const healthRisk = getPlayerHealthRisk(
      playerData,
      projectionInfo
    );

    if (healthRisk.blocked) continue;

    const missingPlayers = getMissingPlayers(playerTeam, players);

const usageResult = calcUsageBoost(
  projectionInfo || playerData,
  stat,
  missingPlayers
);

if (usageResult.reasons.length > 0) {
  console.log(usageResult.log);
}

projection += usageResult.projectionBoost;

    const context = getContextAdjustment({
      game,
      stat,
      pick,
      playerTeam,
      scheduleGames,
    });

    const matchingBookProps = rawProps.filter(
      (p) =>
        clean(p.playerName) === clean(playerName) &&
        p.stat === stat &&
        Number(p.line) === Number(line)
    );

    const marketAgreement =
      getMarketAgreement(matchingBookProps);

const oddsSignal =
  getOddsPriceSignal(
    outcome.price,
    pick
  );

    const ballPlayerId = await findBallPlayerId(playerName);

    const ballLast5 = ballPlayerId
      ? await fetchLast5Games(ballPlayerId)
      : [];

    let rawLast5 = ballLast5.length
      ? ballLast5
      : playerData.gameLog ||
        playerData.GameLog ||
        playerData.last5 ||
        playerData.Last5Games ||
        playerData.recentGames ||
        projectionInfo?.gameLog ||
        projectionInfo?.last5 ||
        projectionInfo?.Last5 ||
        [];

    const last5Games = rawLast5
      .map((g) => ({
        points: Number(g.points ?? g.Points ?? g.pts ?? g.PTS ?? 0),
        rebounds: Number(g.rebounds ?? g.Rebounds ?? g.reb ?? g.REB ?? 0),
        assists: Number(g.assists ?? g.Assists ?? g.ast ?? g.AST ?? 0),
        threes: Number(g.threes ?? g.Threes ?? g.fg3m ?? g.FG3M ?? 0),

        minutes: Number(g.minutes ?? g.Minutes ?? g.min ?? 0),
        fga: Number(g.fga ?? g.FGA ?? 0),
        fta: Number(g.fta ?? g.FTA ?? 0),

        starter:
          Boolean(g.starter) ||
          Number(g.minutes ?? g.Minutes ?? g.min ?? 0) >= 24,
      }))
      .filter((g) => {
        if (stat === "Points") return g.points > 0;
        if (stat === "Rebounds") return g.rebounds > 0;
        if (stat === "Assists") return g.assists > 0;
        if (stat === "Threes") return g.threes >= 0;
        return false;
      });

    const last5 = last5Games
      .map((g) => {
        if (stat === "Points") return g.points;
        if (stat === "Rebounds") return g.rebounds;
        if (stat === "Assists") return g.assists;
        if (stat === "Threes") return g.threes;
        return 0;
      })
      .filter((v) => Number.isFinite(v));

    if (last5.length < 5) continue;

    const recentAvg =
      last5.reduce((sum, v) => sum + Number(v || 0), 0) /
      Math.max(1, last5.length);

    const volatilityAvg =
      last5.reduce(
        (sum, v) => sum + Math.abs(Number(v || 0) - recentAvg),
        0
      ) / Math.max(1, last5.length);

    const volatilityRange =
      last5.length ? Math.max(...last5) - Math.min(...last5) : 0;

    const recentHits =
      last5.filter((v) =>
        pick === "Over"
          ? Number(v || 0) >= line
          : Number(v || 0) <= line
      ).length;

const overHits =
  last5.filter((v) => Number(v || 0) >= line).length;

const underHits =
  last5.filter((v) => Number(v || 0) <= line).length;

let overScore = 0;
let underScore = 0;

if (projection >= line + 3) overScore += 8;
else if (projection >= line + 1.5) overScore += 4;

if (projection <= line - 3) underScore += 8;
else if (projection <= line - 1.5) underScore += 4;

if (overHits >= 4) overScore += 8;
else if (overHits === 3) overScore += 3;
else if (overHits <= 2) overScore -= 6;

if (underHits >= 4) underScore += 8;
else if (underHits === 3) underScore += 3;
else if (underHits <= 2) underScore -= 6;

if (recentAvg >= line + 3) overScore += 5;
if (recentAvg <= line - 3) underScore += 5;

const sideGap =
  Math.abs(overScore - underScore);

if (sideGap < 4) continue;

const smartPick =
  overScore > underScore ? "Over" : "Under";

  pick = smartPick;



    const hitRate =
      recentHits / Math.max(1, last5.length);

    const trendStrength =
      recentHits / Math.max(1, last5.length);

    const avgMinutes =
      last5Games.reduce((sum, g) => sum + (g.minutes || 0), 0) /
      Math.max(1, last5Games.length);

    const starterCount =
      last5Games.filter((g) => g.starter).length;

    const minutesList =
      last5Games.map((g) => g.minutes || 0);

const opponentGames = last5Games.filter(
 (g) =>
   clean(g.opponent || g.teamAgainst || "") ===
   clean(opponentTeam)
);

const opponentLast5 =
opponentGames.map((g) => {
   if (stat === "Points") return g.points;
   if (stat === "Rebounds") return g.rebounds;
   if (stat === "Assists") return g.assists;
   if (stat === "Threes") return g.threes;
   return 0;
});

const opponentHitRate =
opponentLast5.length >= 2
? opponentLast5.filter((v)=>
pick === "Over"
? v >= line
: v <= line
).length / opponentLast5.length
: .5;

    const minutesVariance =
      minutesList.length
        ? Math.max(...minutesList) - Math.min(...minutesList)
        : 0;

    const avgFGA =
      last5Games.reduce((sum, g) => sum + (g.fga || 0), 0) /
      Math.max(1, last5Games.length);

    const avgFTA =
      last5Games.reduce((sum, g) => sum + (g.fta || 0), 0) /
      Math.max(1, last5Games.length);

const shotVolume =
  avgFGA + (avgFTA * 0.44);

const lowShotGames =
  last5Games.filter(
    (g) => ((g.fga || 0) + ((g.fta || 0) * 0.44)) < 10
  ).length;

const shotVolumeRisk =
  shotVolume < 12 || lowShotGames >= 2;

const minPts = Math.min(...last5);
const maxPts = Math.max(...last5);

const lowGames =
  last5.filter((p) => p <= line * 0.6).length;

const highGames =
  last5.filter((p) => p >= line * 1.25).length;

  const coldStreak =
  last5.slice(0, 3).filter((p) => p < line).length;

const hotStreak =
  last5.slice(0, 3).filter((p) => p > line).length;

const badMinuteGames =
  minutesList.filter((m) => m < 20).length;

const unstableMinutes =
  minutesVariance >= 12;

const benchRisk =
  avgMinutes < 24 ||
  badMinuteGames >= 2;

const volatilityScore =
  maxPts - minPts;

    
let confidenceBase = 58;

if (pick === "Over") {
  if (lineValue >= 7) confidenceBase += 8;
  else if (lineValue >= 5) confidenceBase += 5;
  else if (lineValue >= 3) confidenceBase += 2;
}

if (pick === "Under") {
  if (lineValue <= -7) confidenceBase += 8;
  else if (lineValue <= -5) confidenceBase += 5;
  else if (lineValue <= -3) confidenceBase += 2;
}

const consistency = getConsistencyScore(last5, line, pick);

// SCORING STABILITY ENGINE
const freeThrowSafety =
  stat === "Points"
    ? avgFTA >= 8
      ? 10
      : avgFTA >= 6
      ? 7
      : avgFTA >= 4
      ? 4
      : avgFTA >= 2
      ? 1
      : -8
    : 0;

const shotVolumeSafety =
  stat === "Points"
    ? avgFGA >= 20
      ? 10
      : avgFGA >= 16
      ? 7
      : avgFGA >= 13
      ? 4
      : avgFGA >= 10
      ? 1
      : -10
    : 0;

const scoringFloorRisk =
  stat === "Points" &&
  avgFTA < 3 &&
  avgFGA < 15;

const alphaScorerProfile =
  stat === "Points" &&
  avgMinutes >= 34 &&
  avgFGA >= 16 &&
  avgFTA >= 5;

const fragileOver =
  pick === "Over" &&
  stat === "Points" &&
  (
    avgFTA < 3 ||
    shotVolumeRisk ||
    volatilityRange >= 20 ||
    recentHits <= 3
  );

const lowAggressionOver =
  pick === "Over" &&
  stat === "Points" &&
  avgFTA < 2 &&
  avgFGA < 14;

// EDGE SCORE
if (edge >= 8) confidenceBase += 18;
else if (edge >= 6) confidenceBase += 14;
else if (edge >= 5) confidenceBase += 11;
else if (edge >= 4) confidenceBase += 8;
else if (edge >= 3) confidenceBase += 5;
else if (edge >= 2.5) confidenceBase += 3;

// RECENT HIT RATE SCORE
if (recentHits === 5) confidenceBase += 13;
else if (recentHits === 4) confidenceBase += 9;
else if (recentHits === 3) confidenceBase += 2;
else if (recentHits === 2) confidenceBase -= 10;
else if (recentHits <= 1) confidenceBase -= 10;

// CONSISTENCY SCORE
if (consistency >= 88) confidenceBase += 10;
else if (consistency >= 80) confidenceBase += 7;
else if (consistency >= 72) confidenceBase += 4;
else if (consistency < 58) confidenceBase -= 8;

// MINUTES STABILITY
if (avgMinutes >= 38 && minutesVariance <= 8) confidenceBase += 9;
else if (avgMinutes >= 34 && minutesVariance <= 10) confidenceBase += 7;
else if (avgMinutes >= 30 && minutesVariance <= 12) confidenceBase += 5;
else if (avgMinutes >= 26) confidenceBase += 2;
else confidenceBase -= 8;

if (minutesVariance >= 18) confidenceBase -= 8;
else if (minutesVariance >= 14) confidenceBase -= 9;
else if (minutesVariance >= 10) confidenceBase -= 4;

// SCORING FLOOR / AGGRESSION
confidenceBase += freeThrowSafety;
confidenceBase += shotVolumeSafety;

if (alphaScorerProfile) confidenceBase += 6;
if (scoringFloorRisk) confidenceBase -= 10;
if (fragileOver) confidenceBase -= 5;
if (lowAggressionOver) confidenceBase -= 4;

// VOLATILITY
if (volatilityAvg <= 4 && volatilityRange <= 12) {
  confidenceBase += 7;
} else if (volatilityAvg <= 6 && volatilityRange <= 16) {
  confidenceBase += 4;
} else if (volatilityAvg >= 10 || volatilityRange >= 24) {
  confidenceBase -= 10;
} else if (volatilityAvg >= 8 || volatilityRange >= 20) {
  confidenceBase -= 6;
} else if (volatilityAvg >= 6 || volatilityRange >= 16) {
  confidenceBase -= 3;
}

// ENVIRONMENT + MARKET
confidenceBase += context.adjustment;
confidenceBase += marketAgreement.boost;
confidenceBase += oddsSignal;
confidenceBase += usageResult.confidenceBoost;
confidenceBase += matchupConfidenceAdjustment;
confidenceBase -= healthRisk.penalty;
confidenceBase += (opponentHitRate * 10 - 5);

const confidenceDebug = {
  player: playerName,
  edge,
  recentHits,
  consistency,
  opponentHitRate,
  avgMinutes,
  minutesVariance,
  avgFGA,
  avgFTA,
  volatilityAvg,
  volatilityRange,
  oddsSignal,
  odds: outcome.price,
  confidenceBeforeClamp: confidenceBase,
};

console.log(
  "CONFIDENCE DEBUG:",
  JSON.stringify(confidenceDebug)
);

console.log("PROJECTION DEBUG", {
 player: playerName,
 last5Average,
 projection,
 usageBoost: usageResult.projectionBoost,
 contextBoost: context.adjustment,
 healthPenalty: healthRisk.penalty,
 recentHits,
 avgMinutes,
});

// PICK-SIDE PROTECTION
if (pick === "Over" && recentAvg < line) confidenceBase -= 8;
if (pick === "Under" && recentAvg > line) confidenceBase -= 8;

if (pick === "Over" && lowGames >= 2) confidenceBase -= 7;
if (pick === "Over" && highGames >= 3) confidenceBase += 4;

if (coldStreak >= 2 && pick === "Over") confidenceBase -= 8;
if (hotStreak >= 2 && pick === "Under") confidenceBase -= 8;

// DYNAMIC CONFIDENCE CAP
let confidenceCap = 82;

if (
  edge >= 5 &&
  recentHits >= 4 &&
  avgMinutes >= 30 &&
  minutesVariance <= 12 &&
  volatilityRange <= 18 &&
  !shotVolumeRisk &&
  healthRisk.penalty === 0
) {
  confidenceCap = 86;
}

if (
  edge >= 6.5 &&
  recentHits >= 4 &&
  avgMinutes >= 34 &&
  minutesVariance <= 10 &&
  volatilityRange <= 16 &&
  alphaScorerProfile &&
  healthRisk.penalty === 0 &&
  context.spread < 10
) {
  confidenceCap = 90;
}

if (
  edge >= 8 &&
  recentHits === 5 &&
  avgMinutes >= 36 &&
  minutesVariance <= 8 &&
  volatilityRange <= 14 &&
  alphaScorerProfile &&
  healthRisk.penalty === 0 &&
  context.spread < 8
) {
  confidenceCap = 93;
}

// RISK CAPS
if (recentHits <= 2) confidenceCap = Math.min(confidenceCap, 70);
if (avgMinutes < 24) confidenceCap = Math.min(confidenceCap, 72);
if (benchRisk) confidenceCap = Math.min(confidenceCap, 74);
if (unstableMinutes) confidenceCap = Math.min(confidenceCap, 76);
if (volatilityScore >= 20) confidenceCap = Math.min(confidenceCap, 74);
if (shotVolumeRisk) confidenceCap = Math.min(confidenceCap, 72);
if (scoringFloorRisk) confidenceCap = Math.min(confidenceCap, 76);
if (fragileOver) confidenceCap = Math.min(confidenceCap, 76);
if (lowAggressionOver) confidenceCap = Math.min(confidenceCap, 72);
if (context.spread >= 12) confidenceCap = Math.min(confidenceCap, 78);
if (healthRisk.penalty > 0) confidenceCap = Math.min(confidenceCap, 76);

const playerHistory =
  readJsonFile(
    "./player_accuracy.json",
    {}
  );

const playerKey =
`${pick.player}_${pick.stat}`;

const historicalAccuracy =
playerHistory[playerKey]
?.accuracy || 0;

if (historicalAccuracy >= 70)
confidenceBase += 4;

else if (historicalAccuracy >= 60)
confidenceBase += 2;

else if (
historicalAccuracy > 0 &&
historicalAccuracy < 45
)
confidenceBase -= 5;

const confidence = Math.min(
  confidenceCap,
  Math.max(55, Math.round(confidenceBase))
);

let filterScore = 0;
let filterReasons = [];

if (confidence < 55) {
  filterScore += 40;
  filterReasons.push("Confidence below minimum");
}

if (avgMinutes < 24) {
  filterScore += 15;
  filterReasons.push("Low average minutes");
}

if (avgMinutes < 20) {
  filterScore += 20;
  filterReasons.push("Very low average minutes");
}

if (minutesVariance >= 18) {
  filterScore += 14;
  filterReasons.push("Extreme minutes volatility");
} else if (minutesVariance >= 14) {
  filterScore += 10;
  filterReasons.push("High minutes volatility");
}

if (recentHits <= 1) {
  filterScore += 20;
  filterReasons.push("Poor recent hit rate");
} else if (recentHits <= 2) {
  filterScore += 10;
  filterReasons.push("Weak recent hit rate");
}

if (pick === "Over" && lowGames >= 3) {
  filterScore += 12;
  filterReasons.push("Too many low scoring games");
}

if (benchRisk) {
  filterScore += 10;
  filterReasons.push("Bench or role risk");
}

if (volatilityScore >= 20) {
  filterScore += 8;
  filterReasons.push("High scoring volatility");
}

if (starterCount < 3 && edge < 4.5) {
  filterScore += 8;
  filterReasons.push("Starter consistency risk");
}

if (pick === "Over" && edge < 4 && recentAvg < line + 1) {
  filterScore += 8;
  filterReasons.push("Weak over value");
}

if (pick === "Under" && edge < 4 && recentAvg > line - 1) {
  filterScore += 8;
  filterReasons.push("Weak under value");
}

if (filterScore >= 40 || (filterScore >= 25 && confidence < 70)) {
  saveFilteredProp(
    {
      game: `${game.AwayTeam} vs ${game.HomeTeam}`,
      gameId: game.GameID,
      player: playerName,
      stat,
      line,
      pick,
      projection: Number(projection.toFixed(1)),
      edge: Number(edge.toFixed(1)),
      confidence,
    },
    filterReasons.join(", "),
    filterScore
  );

  continue;
}

// TRUST SCORE ENGINE

let trustScore = 50;

// reward
trustScore += edge * 2;
trustScore += recentHits * 2;
trustScore += Math.floor(avgFGA / 2);
trustScore += Math.floor(avgMinutes / 5);
trustScore += Math.floor(confidence / 10);

// reward stable players
if (volatilityRange <= 10) trustScore += 8;
else if (volatilityRange <= 15) trustScore += 4;

// reward shot creators
if (avgFTA >= 6) trustScore += 6;
else if (avgFTA >= 4) trustScore += 3;

// penalties
if (volatilityRange >= 24) trustScore -= 12;
if (minutesVariance >= 14) trustScore -= 8;
if (benchRisk) trustScore -= 10;
if (healthRisk.penalty > 0)
trustScore -= healthRisk.penalty;

// debug
console.log(
"TRUST:",
playerName,
trustScore
);

const valueScore =
  Math.round(
    edge * 8 +
    Math.abs(lineValue) * 5 +
    trustScore * 0.35 +
    recentHits * 4 -
    volatilityRange * 0.4
  );

console.log("PRE-FILTER:", playerName, {
  pick,
  line,
  avgMinutes,
  recentHits,
  volatilityRange,
  avgFGA,
  avgFTA,
  edge,
  trustScore: Number(trustScore.toFixed(1)),
  spread: context.spread,
});

// FINAL TRUST FILTER — GRADE A MODE

if (stat !== "Points") continue;

// Hard blocks only
if (edge < 3) continue;
if (trustScore < 75) continue;
if (avgMinutes < 24) continue;
if (pick === "Over" && context.spread >= 12 && trustScore < 92) continue;

// TrustScore can save strong profiles with one weak area
if (avgMinutes < 30 && trustScore < 88) continue;
if (recentHits < 4 && trustScore < 90) continue;
if (volatilityRange > 20 && trustScore < 88) continue;
if (avgFGA < 10 && trustScore < 90) continue;
if (pick === "Over" && avgFTA < 2.5 && trustScore < 88) continue;

allProps.push({
  lineValue: Number(lineValue.toFixed(1)),
  game: `${game.AwayTeam} vs ${game.HomeTeam}`,
  gameId: game.GameID,
  player: playerName,
  playerId: projectionInfo?.PlayerID || ballPlayerId || "",
  team: playerTeam || "",
  opponent: opponentTeam,
  stat,
  line,
  gameDate: game.DateTime,
  projection: Number(projection.toFixed(1)),
  edge: Number(edge.toFixed(1)),
  pick,
  result: "Pending",
  confidence,
  trustScore: Number(trustScore.toFixed(1)),
  lineEdge: Number(lineValue.toFixed(1)),
  safeLine: Number((line - 2).toFixed(1)),
  aggressiveLine: Number((line + 2).toFixed(1)),
  valueScore,
  actualResult: null,
  didHit: null,
  recentHits,
  recentGames: last5.length,
  hitRateLabel: `${recentHits}/${last5.length}`,
  avgMinutes: Number(avgMinutes.toFixed(1)),
  avgFGA: Number(avgFGA.toFixed(1)),
  avgFTA: Number(avgFTA.toFixed(1)),
  volatilityAvg: Number(volatilityAvg.toFixed(1)),
  volatilityRange,
  spread: context.spread,
  gameTotal: context.total,
  usageBoost: usageResult.confidenceBoost,
  usageReasons: usageResult.reasons,
  projectionBoost: usageResult.projectionBoost,
  contextReasons: context.reasons,
  marketAgreement: marketAgreement.label,
  healthRisk: healthRisk.label,
  odds: outcome.price,
  sportsbook: book.title || "Sportsbook",
});
  }
}

function buildProjectionMap(players, projections) {
  const map = new Map();

  for (const proj of projections) {
    const player = players.find(
      (p) => String(p.PlayerID) === String(proj.PlayerID)
    );

    const name = player?.Name || proj.Name;

    if (!name) continue;

    map.set(clean(name), {
      name,
      PlayerID: player?.PlayerID || proj.PlayerID || "",
      gameId: proj.GameID,
      Points: Number(proj.Points || 0),
      Rebounds: Number(proj.Rebounds || 0),
      Assists: Number(proj.Assists || 0),
      Threes: Number(proj.ThreePointersMade || 0),
      Minutes: Number(proj.Minutes || 0),
      Team: player?.Team || "",
      Position: player?.Position || "",
      Status: player?.Status || "",
      InjuryStatus: player?.InjuryStatus || "",
    });
  }

  return map;
}

function getFallbackProjection(playerName, players, seasonStats, stat) {
  const player =
    seasonStats.find((p) => clean(p.Name || p.name) === clean(playerName)) ||
    players.find((p) => clean(p.Name || p.name) === clean(playerName));

  if (!player) return 0;

  const games =
    Number(player.Games || player.GamesPlayed || player.Played || 82) || 82;

  if (stat === "Points") {
    const total = Number(player.Points || player.PPG || 0);
    return total > 60 ? total / games : total;
  }

  if (stat === "Rebounds") {
    const total = Number(player.Rebounds || player.RPG || 0);
    return total > 25 ? total / games : total;
  }

  if (stat === "Assists") {
    const total = Number(player.Assists || player.APG || 0);
    return total > 25 ? total / games : total;
  }

  if (stat === "Threes") {
    const total = Number(player.ThreePointersMade || player.ThreePointers || 0);
    return total > 10 ? total / games : total;
  }

  return 0;
}

function getConsensusProps(props) {

  const groups = {};

  for (const p of props) {

    const key =
      `${p.gameId}-${clean(p.player)}-${p.stat}`;

    if (!groups[key]) {
      groups[key] = [];
    }

    groups[key].push(p);
  }

  const consensus = [];

  for (const list of Object.values(groups)) {

    const lineCounts = {};

    for (const p of list) {

      const lineKey = String(p.line);

      lineCounts[lineKey] =
        (lineCounts[lineKey] || 0) + 1;
    }

    const mostCommonLine =
      Object.entries(lineCounts)
        .sort((a, b) => b[1] - a[1])[0][0];

    const matching =
      list.filter(
        (p) =>
          String(p.line) ===
          String(mostCommonLine)
      );

    const best =
      matching.sort((a, b) => {
        return (
          b.confidence - a.confidence ||
          b.edge - a.edge
        );
      })[0];

    consensus.push({
      ...best,
      sportsbook: "Consensus",
      booksMatched: matching.length,
    });
  }

  return consensus;
}

function dedupeProps(props = []) {

  const seen = new Set();

  return props.filter((p) => {

    const key =
      `${p.gameId}-${clean(p.player)}-${p.stat}`;

    if (seen.has(key)) {
      return false;
    }

    seen.add(key);

    return true;
  });
}

function topThreePerGame(props = []) {

  const grouped = {};

  for (const prop of props) {

    if (!grouped[prop.gameId]) {
      grouped[prop.gameId] = [];
    }

    grouped[prop.gameId].push(prop);
  }

  const finalPicks = [];

  for (const gameId of Object.keys(grouped)) {

    const top =
      grouped[gameId]
        .sort((a, b) => {
  return (
    (b.trustScore || 0) - (a.trustScore || 0) ||
    b.confidence - a.confidence ||
    b.edge - a.edge
  );
})
        .slice(0, 3);

    finalPicks.push(...top);
  }

  return finalPicks;
}

async function buildFreshPicks() {

const yesterdayGames = await fetchGames(-1);
const todayGames = await fetchGames(0);
const tomorrowGames = await fetchGames(1);

const scheduleGames = [
  ...yesterdayGames,
  ...todayGames,
  ...tomorrowGames,
];

const games = [...todayGames, ...tomorrowGames].sort(
    (a, b) =>
      new Date(a.DateTime).getTime() -
      new Date(b.DateTime).getTime()
  );

  const now = new Date();

  const formattedGames = games
    .filter((g) => {
      if (!g.DateTime) return false;

      const gameDate = new Date(g.DateTime);

      return gameDate > now;
    })
    .map((g) => ({
      id: g.GameID,
      game: `${g.AwayTeam} vs ${g.HomeTeam}`,
      home: g.HomeTeam,
      away: g.AwayTeam,
      time: g.DateTime,
    }));

  const players = await fetchPlayers();

  const seasonStats = await fetchSeasonStats();

  const todayProjections = await fetchProjections(0);
  const tomorrowProjections = await fetchProjections(1);

  const projectionMap = buildProjectionMap(players, [
    ...todayProjections,
    ...tomorrowProjections,
  ]);

  const oddsEvents = await fetchOddsEvents();

  const allProps = [];

  for (const game of games) {

    const matchedEvent = oddsEvents.find((event) =>
      gameMatchesEvent(game, event)
    );

    // NO FALLBACK GARBAGE PROPS
    if (!matchedEvent?.id) {
      console.log(
        "NO ODDS EVENT FOUND:",
        game.AwayTeam,
        "vs",
        game.HomeTeam
      );

      continue;
    }

    const bookmakers =
      await fetchPlayerProps(matchedEvent.id);

    console.log(
      "BOOKMAKERS FOUND:",
      bookmakers.length,
      game.AwayTeam,
      "vs",
      game.HomeTeam
    );

    await addRealSportsbookProps({
      game,
      bookmakers,
      projectionMap,
      players,
      seasonStats,
      allProps,
      scheduleGames,
    });
  }

  const consensusProps =
    getConsensusProps(allProps);

  console.log(
    "ALL PROPS BUILT:",
    allProps.length
  );

  console.log(
    "CONSENSUS PROPS:",
    consensusProps.length
  );

  // SMART CONSENSUS FALLBACK
  const propPool =
    consensusProps.length >= 8
      ? consensusProps
      : allProps;

  const cleanProps = dedupeProps(propPool).sort((a, b) => {
    return (
      b.confidence - a.confidence ||
      b.edge - a.edge ||
      b.projection - a.projection
    );
  });

console.log(
  "CLEAN PROPS:",
  cleanProps.length
);

console.log(
  cleanProps.map((p) => ({
    player: p.player,
    pick: p.pick,
    line: p.line,
    confidence: p.confidence,
    trustScore: p.trustScore,
    edge: p.edge,
  }))
);

  const gamePicks =
    topThreePerGame(cleanProps);

  const bestBet =
    cleanProps[0] || null;

  const activeGameIds = new Set(
    gamePicks.map((g) => String(g.gameId))
  );

  const twoManPool =
    cleanProps.filter((p) =>
      activeGameIds.has(String(p.gameId))
    );

 const groupedByDay = {};

for (const pick of twoManPool) {
  const dayKey = new Date(pick.gameDate).toDateString();

  if (!groupedByDay[dayKey]) {
    groupedByDay[dayKey] = [];
  }

  groupedByDay[dayKey].push(pick);
}

let twoMan = [];

for (const dayPicks of Object.values(groupedByDay)) {
  const usedTeams = new Set();

  const bestForDay = [...dayPicks]
    .filter(
      (p) =>
        p.stat === "Points" &&
        p.confidence >= 68 &&
        p.edge >= 3 &&
        p.recentGames >= 5 &&
        p.recentHits >= 4 &&
        p.avgMinutes >= 24 &&
        p.volatilityRange < 18
    )
    .sort((a, b) => {
      return (
        b.confidence - a.confidence ||
        b.edge - a.edge ||
        b.projection - a.projection
      );
    })
    .filter((p) => {
      const team = p.team || p.playerTeam || "";

      if (usedTeams.has(team)) {
        return false;
      }

      usedTeams.add(team);
      return true;
    })
    .slice(0, 2);

  if (bestForDay.length === 2) {
    twoMan = bestForDay;
    break;
  }
}

  const history = readPickHistory();

  const newHistoryEntries =
    gamePicks.map((pick) => ({
      date: new Date().toISOString(),
      game: pick.game,
      gameId: pick.gameId,
      gameDate: pick.gameDate || "",
      player: pick.player,
      playerId: pick.playerId || "",
      team: pick.team || "",
      stat: pick.stat,
      line: pick.line,
      projection: pick.projection,
      edge: pick.edge,
      confidence: pick.confidence,
      pick: pick.pick,
      sportsbook: pick.sportsbook || "BetBrain",
      result: "pending",
    }));

  const uniqueHistory = [
    ...history,
    ...newHistoryEntries,
  ].filter(
    (item, index, self) =>
      index ===
      self.findIndex(
        (p) =>
          p.gameId === item.gameId &&
          p.player === item.player &&
          p.stat === item.stat &&
          p.line === item.line
      )
  );

  savePickHistory(uniqueHistory);

  updatePlayerAccuracy(uniqueHistory);

  console.log(
    "PICK HISTORY SAVED:",
    uniqueHistory.length
  );

  return {
    lastUpdated: new Date().toISOString(),
    games: formattedGames,
    gamePicks,
    top3: cleanProps.slice(0, 3),
    twoMan,
    bestBet,
    realProps: cleanProps,
  };

}
async function getCachedOrFresh(force = false) {

  const now = Date.now();

  const cacheAgeMinutes =
    (now - lastRefreshTime) /
    1000 /
    60;

  if (
    !force &&
    picksCache &&
    cacheAgeMinutes < CACHE_MINUTES
  ) {
    return {
      ...picksCache,
      cached: true,
      cacheAgeMinutes: Math.round(cacheAgeMinutes),
    };
  }

  picksCache =
    await buildFreshPicks();

  lastRefreshTime = now;

  return {
    ...picksCache,
    cached: false,
    cacheAgeMinutes: 0,
  };
}

app.get("/picks", async (req, res) => {
  try {
    const data =
      await getCachedOrFresh(false);

    res.json(data);

  } catch (err) {

    console.log(
      "PICKS ERROR:",
      err.message
    );

    res.status(500).json({
      error: "Failed to load picks"
    });
  }
});

app.post("/refresh-picks", async (req, res) => {

  try {

    const data =
      await getCachedOrFresh(true);

    res.json({
      ok: true,
      message: "Picks refreshed",
      lastUpdated: data.lastUpdated,
    });

  } catch (err) {

    console.log(
      "REFRESH ERROR:",
      err.message
    );

    res.status(500).json({
      ok: false,
      message: "Refresh failed",
    });
  }
});

app.post("/resolve-picks", async (req, res) => {
  try {
    const history = readPickHistory();

    let resolvedCount = 0;

    for (const pick of history) {

      if (pick.result !== "pending") continue;
      if (!pick.playerId && !pick.player) continue;

      const ballId =
        pick.playerId ||
        await findBallPlayerId(pick.player);

      if (!ballId) continue;

      const last5 =
        await fetchLast5Games(ballId);

      if (!last5?.length) continue;

      const pickDate =
        pick.gameDate
          ? new Date(
              pick.gameDate
            ).toDateString()
          : null;

      const matchedGame =
        last5.find((g) => {

          if (!g.date || !pickDate)
            return false;

          return (
            new Date(
              g.date
            ).toDateString() ===
            pickDate
          );

        });

      if (!matchedGame) continue;

      const statMap = {
        Points: matchedGame.points,
        Rebounds: matchedGame.rebounds,
        Assists: matchedGame.assists,
        Threes: matchedGame.threes,
      };

      const actual =
        statMap[pick.stat];

      if (
        actual === undefined ||
        actual === null
      ) continue;

      let result;

      if (pick.pick === "Over") {

        result =
          actual > pick.line
            ? "win"
            : "loss";

      } else if (
        pick.pick === "Under"
      ) {

        result =
          actual < pick.line
            ? "win"
            : "loss";

      } else {

        continue;

      }

      pick.result = result;

      pick.actualStat =
        actual;

      pick.resolvedAt =
        new Date().toISOString();

      resolvedCount++;

      console.log(
        `RESOLVED:
${pick.player}
${pick.stat}
${pick.pick}
${pick.line}
→ actual:
${actual}
→ ${result}`
      );

    }

    savePickHistory(history);

    updatePlayerAccuracy(
      history
    );

    res.json({
      ok: true,
      resolved: resolvedCount,
      total: history.length,
    });

  } catch (err) {

    console.error(
      "RESOLVE ERROR:",
      err.message
    );

    res.status(500).json({
      ok:false,
      error: err.message
    });

  }
});

function updatePlayerAccuracy(history) {
  const completedPicks = history.filter(
    p => p.result === "win" || p.result === "loss"
  );
  const playerStats = {};


  for (const pick of completedPicks) {

    const key =
      `${pick.player}_${pick.stat}`;

    if (!playerStats[key]) {

    playerStats[key] = {
  player: pick.player,
  stat: pick.stat,

  total: 0,
  wins: 0,
  losses: 0,
  accuracy: 0,

  totalMargin: 0,
  avgMargin: 0,
  crushWins: 0,
  badMisses: 0,

  elite: { total:0, wins:0 },
  strong:{ total:0, wins:0 },
  risky:{ total:0, wins:0 },
};
    }
   
    playerStats[key].total += 1;

const margin =
  pick.pick === "Over"
    ? pick.actualStat - pick.line
    : pick.line - pick.actualStat;

playerStats[key].totalMargin += margin;

if (margin >= 5) {
  playerStats[key].crushWins += 1;
}

if (margin <= -5) {
  playerStats[key].badMisses += 1;
}

    if (pick.confidence >= 85) {
      playerStats[key].elite.total += 1;
    }

    else if (pick.confidence >= 70) {
      playerStats[key].strong.total += 1;
    }

    else {
      playerStats[key].risky.total += 1;
    }

 if (pick.result === "win") {
  playerStats[key].wins += 1;

  if (pick.confidence >= 85) {
    playerStats[key].elite.wins += 1;
  } 
  else if (pick.confidence >= 70) {
    playerStats[key].strong.wins += 1;
  } 
  else {
    playerStats[key].risky.wins += 1;
  }
}

    if (pick.result === "loss") {
      playerStats[key].losses += 1;
    }

      playerStats[key].accuracy =
    playerStats[key].total > 0
      ? Number(
          (
            (playerStats[key].wins /
              playerStats[key].total) *
            100
          ).toFixed(1)
        )
      : 0;

playerStats[key].avgMargin =
  playerStats[key].total > 0
    ? Number(
        (
          playerStats[key].totalMargin /
          playerStats[key].total
        ).toFixed(1)
      )
    : 0;

  }

  writeJsonFile(
    "./player_accuracy.json",
    playerStats
  );

  console.log(
    "PLAYER ACCURACY UPDATED:",
    Object.keys(playerStats).length
  );
}

app.listen(PORT, () => {
  console.log(
    `Server running on port ${PORT}`
  );
});