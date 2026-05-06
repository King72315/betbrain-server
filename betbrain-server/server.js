import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import fetch from "node-fetch";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3000;
const API_KEY = process.env.SPORTS_KEY;
const ODDS_KEY = process.env.ODDS_KEY;

let picksCache = null;
let lastRefreshTime = 0;
const CACHE_MINUTES = 30;

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
  return String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatDate(date = new Date()) {
  const d = new Date(date);
  const year = d.getFullYear();
  const month = d.toLocaleString("en-US", { month: "short" }).toUpperCase();
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateForDaysAhead(daysAhead = 0) {
  return new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
}

function normalizeMarketStat(key) {
  if (key === "player_points") return "Points";
  if (key === "player_rebounds") return "Rebounds";
  if (key === "player_assists") return "Assists";
  if (key === "player_threes") return "Threes";
  return "";
}

function getProjectionValue(proj, stat) {
  if (stat === "Points") return Number(proj.Points || 0);
  if (stat === "Rebounds") return Number(proj.Rebounds || 0);
  if (stat === "Assists") return Number(proj.Assists || 0);
  if (stat === "Threes") return Number(proj.ThreePointersMade || 0);
  return 0;
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

function validLine(stat, line) {
  if (!line || line <= 0) return false;
  if (stat === "Points") return line >= 5 && line <= 45;
  if (stat === "Rebounds") return line >= 2 && line <= 20;
  if (stat === "Assists") return line >= 2 && line <= 18;
  if (stat === "Threes") return line >= 0.5 && line <= 8.5;
  return false;
}

function teamFullName(team) {
  return TEAM_NAMES[team] || team;
}

function gameMatchesEvent(game, event) {
  const home = clean(teamFullName(game.HomeTeam));
  const away = clean(teamFullName(game.AwayTeam));

  const eventHome = clean(event.home_team);
  const eventAway = clean(event.away_team);

  return (
    eventHome.includes(home) ||
    home.includes(eventHome) ||
    eventAway.includes(away) ||
    away.includes(eventAway)
  );
}

async function fetchJson(url) {
  const res = await fetch(url);
  return await res.json();
}

async function fetchGames(daysAhead = 0) {
  const date = formatDate(dateForDaysAhead(daysAhead));
  const url = `https://api.sportsdata.io/api/nba/odds/json/GamesByDate/${date}?key=${API_KEY}`;
  const data = await fetchJson(url);
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
  return Array.isArray(data) ? data : [];
}

async function fetchOddsEvents() {
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events?apiKey=${ODDS_KEY}`;
  const data = await fetchJson(url);
  return Array.isArray(data) ? data : [];
}

async function fetchPlayerProps(eventId) {
  const url = `https://api.the-odds-api.com/v4/sports/basketball_nba/events/${eventId}/odds?apiKey=${ODDS_KEY}&regions=us&markets=player_points,player_rebounds,player_assists,player_threes&oddsFormat=american`;
  const data = await fetchJson(url);
  return data.bookmakers || [];
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
      Points: Number(proj.Points || 0),
      Rebounds: Number(proj.Rebounds || 0),
      Assists: Number(proj.Assists || 0),
      Threes: Number(proj.ThreePointersMade || 0),
    });
  }

  return map;
}

function getConsensusProps(props) {
  const groups = {};

  for (const p of props) {
    const key = `${p.gameId}-${clean(p.player)}-${p.stat}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(p);
  }

  const consensus = [];

  for (const list of Object.values(groups)) {
    const lineCounts = {};

    for (const p of list) {
      const lineKey = String(p.line);
      lineCounts[lineKey] = (lineCounts[lineKey] || 0) + 1;
    }

    const mostCommonLine = Object.entries(lineCounts).sort(
      (a, b) => b[1] - a[1]
    )[0][0];

    const matchingLineProps = list.filter(
      (p) => String(p.line) === String(mostCommonLine)
    );

    const best = matchingLineProps.sort(
      (a, b) => b.confidence - a.confidence || b.edge - a.edge
    )[0];

    consensus.push({
      ...best,
      sportsbook: "Consensus",
      booksMatched: matchingLineProps.length,
    });
  }

  return consensus;
}

function dedupeProps(props) {
  const best = new Map();

  for (const p of props) {
    const key = `${p.gameId}-${clean(p.player)}-${p.stat}`;
    const existing = best.get(key);

    if (
      !existing ||
      p.confidence > existing.confidence ||
      p.edge > existing.edge
    ) {
      best.set(key, p);
    }
  }

  return [...best.values()];
}

function topThreePerGame(props) {
  const grouped = {};

  for (const p of props) {
    if (!grouped[p.gameId]) grouped[p.gameId] = [];
    grouped[p.gameId].push(p);
  }

  return Object.values(grouped).flatMap((list) =>
    list
      .sort((a, b) => b.confidence - a.confidence || b.edge - a.edge)
      .slice(0, 3)
  );
}

async function buildFreshPicks() {
  const todayGames = await fetchGames(0);
  const tomorrowGames = await fetchGames(1);

  const games = [...todayGames, ...tomorrowGames].sort(
    (a, b) => new Date(a.DateTime).getTime() - new Date(b.DateTime).getTime()
  );

  const formattedGames = games.map((g) => ({
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

  console.log("TODAY PROJECTIONS:", todayProjections.length);
  console.log("TOMORROW PROJECTIONS:", tomorrowProjections.length);

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

    if (!matchedEvent?.id) continue;

    const bookmakers = await fetchPlayerProps(matchedEvent.id);

    for (const book of bookmakers) {
      for (const market of book.markets || []) {
        const stat = normalizeMarketStat(market.key);
        if (!stat) continue;

        for (const outcome of market.outcomes || []) {
          const playerName = outcome.description;
          const line = Number(outcome.point || 0);

          if (!playerName || !validLine(stat, line)) continue;

          const projectionInfo = projectionMap.get(clean(playerName));

          let projection = 0;

          if (projectionInfo) {
            projection = getProjectionValue(projectionInfo, stat);
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

          const edgeRaw = projection - line;
          const pick = edgeRaw >= 0 ? "Over" : "Under";
          const edge = Math.abs(edgeRaw);

          const isFallbackPick = !projectionInfo;

          const minEdge = isFallbackPick
            ? stat === "Points"
              ? 0.8
              : 0.4
            : stat === "Points"
              ? 1.5
              : 0.7;

          if (edge < minEdge) continue;

          const confidence = Math.min(
            95,
            Math.max(55, Math.round(60 + edge * 6))
          );

          allProps.push({
            game: `${game.AwayTeam} vs ${game.HomeTeam}`,
            gameId: game.GameID,
            player: playerName,
            stat,
            line,
            projection: Number(projection.toFixed(1)),
            edge: Number(edge.toFixed(1)),
            pick,
            confidence,
            odds: outcome.price,
            sportsbook: book.title || "Sportsbook",
            isFallback: isFallbackPick,
          });
        }
      }
    }
  }

  const consensusProps = getConsensusProps(allProps);

  const cleanProps = dedupeProps(consensusProps).sort(
    (a, b) => b.confidence - a.confidence || b.edge - a.edge
  );

  const gamePicks = topThreePerGame(cleanProps);
  const bestBet = cleanProps[0] || null;
  const twoMan = cleanProps.slice(0, 2);

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
  const cacheAgeMinutes = (now - lastRefreshTime) / 1000 / 60;

  if (!force && picksCache && cacheAgeMinutes < CACHE_MINUTES) {
    return {
      ...picksCache,
      cached: true,
      cacheAgeMinutes: Math.round(cacheAgeMinutes),
    };
  }

  picksCache = await buildFreshPicks();
  lastRefreshTime = now;

  return {
    ...picksCache,
    cached: false,
    cacheAgeMinutes: 0,
  };
}

app.get("/picks", async (req, res) => {
  try {
    const data = await getCachedOrFresh(false);
    res.json(data);
  } catch (err) {
    console.log("PICKS ERROR:", err.message);
    res.status(500).json({ error: "Failed to load picks" });
  }
});

app.post("/refresh-picks", async (req, res) => {
  try {
    const data = await getCachedOrFresh(true);
    res.json({
      ok: true,
      message: "Picks refreshed",
      lastUpdated: data.lastUpdated,
    });
  } catch (err) {
    console.log("REFRESH ERROR:", err.message);
    res.status(500).json({
      ok: false,
      message: "Refresh failed",
    });
  }
});

app.get("/tomorrow-status", async (req, res) => {
  try {
    const tomorrowProjections = await fetchProjections(1);
    const oddsEvents = await fetchOddsEvents();

    res.json({
      tomorrowProjections: tomorrowProjections.length,
      oddsEvents: oddsEvents.length,
      updated: new Date().toISOString(),
    });
  } catch (err) {
    res.json({
      error: err.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});