import cors from "cors";
import express from "express";

import { CONFIG, checkConfig } from "./config.js";

import {
  buildConsensusPointProps,
  fetchPointsPropsForEvent,
  findOddsEventForGame,
} from "./services/oddsService.js";

import {
  buildPlayerContextMaps,
  clean,
  fetchGames,
  fetchPlayers,
  fetchProjections,
  fetchSeasonStats,
  getOpponentForTeam,
  getProjectionPoints,
  getSeasonPoints,
  getTeamForPlayer,
} from "./services/sportsDataService.js";

import {
  fetchLast3VsOpponent,
  fetchLast5,
  summarizeScoringProfile,
} from "./services/ballService.js";

import {
  fetchFinalPlayerStats,
  findPlayerResult,
  gradePointsPick,
} from "./services/resultService.js";

import { buildOpportunityScore } from "./engines/opportunityEngine.js";
import { buildTopPicksForGame } from "./engines/pickRanker.js";
import { buildPlayoffContext } from "./engines/playoffEngine.js";
import { buildWinProbability } from "./engines/winProbabilityEngine.js";

import {
  getSavedPicks,
  savePick,
  savePickHistory,
  updatePlayerAccuracy,
} from "./storage.js";

const app = express();

app.use(cors());
app.use(express.json());

let picksCache = null;
let lastRefreshTime = 0;

function cacheFresh() {
  if (!picksCache) return false;

  const ageMinutes =
    (Date.now() - lastRefreshTime) / 1000 / 60;

  return ageMinutes < CONFIG.CACHE_MINUTES;
}

async function buildPicksForDay(daysAhead = 0) {
  const games = await fetchGames(daysAhead);
  const players = await fetchPlayers();
  const seasonStats = await fetchSeasonStats();
  const projections = await fetchProjections(daysAhead);

  const {
    playerMap,
    seasonMap,
    projectionMap,
  } = buildPlayerContextMaps({
    players,
    seasonStats,
    projections,
  });

  const gameCards = [];

  for (const game of games) {
    console.log("BUILDING GAME:", game.game);

    const oddsEvent = await findOddsEventForGame(game);

    if (!oddsEvent) {
      gameCards.push({
        ...game,
        picks: [],
        message: "No sportsbook event found yet.",
      });
      continue;
    }

    const rawProps = await fetchPointsPropsForEvent(oddsEvent.id);
    const props = buildConsensusPointProps(rawProps);

    const builtPicks = [];

    for (const prop of props) {
      const playerName = prop.player;

      const team = getTeamForPlayer(
        playerName,
        playerMap,
        projectionMap,
        seasonMap
      );

      if (!team) continue;

      const opponent = getOpponentForTeam(game, team);
      if (!opponent) continue;

      const projectionData =
        projectionMap.get(clean(playerName)) || {};

      const seasonAverage = getSeasonPoints(playerName, seasonMap);
      const sportsProjection = getProjectionPoints(playerName, projectionMap);

      const last5 = await fetchLast5(playerName);
      const matchupGames = await fetchLast3VsOpponent(playerName, opponent);
      const last5Profile = summarizeScoringProfile(last5);

      const opportunity = buildOpportunityScore({
        last5,
        projection: projectionData,
        seasonAverage,
        isPlayoff: true,
      });

      const playoff = buildPlayoffContext({
        last5,
        matchupGames,
        line: prop.line,
        opportunityScore: opportunity.opportunityScore,
      });

      const overPick = buildWinProbability({
        player: playerName,
        team,
        opponent,
        game: game.game,
        line: prop.line,
        side: "Over",
        seasonAverage,
        sportsProjection,
        last5,
        matchupGames,
        opportunity,
        playoff,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
      });

      const underPick = buildWinProbability({
        player: playerName,
        team,
        opponent,
        game: game.game,
        line: prop.line,
        side: "Under",
        seasonAverage,
        sportsProjection,
        last5,
        matchupGames,
        opportunity,
        playoff,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
      });

      const bestPick =
        overPick.winProbability >= underPick.winProbability
          ? overPick
          : underPick;

      builtPicks.push({
        ...bestPick,
        sportsbookLine: prop.line,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
        bookCount: prop.bookCount,
        last5Profile,
        label: `${playerName} — ${team} ${bestPick.pick} ${prop.line} Points`,
      });
    }

    const rankedGame = buildTopPicksForGame({
      game,
      picks: builtPicks,
    });

    gameCards.push(rankedGame);
  }

  return gameCards;
}

async function refreshAllPicks() {
  const todayCards = await buildPicksForDay(0);
  const tomorrowCards = await buildPicksForDay(1);

  const result = {
    ok: true,
    lastUpdated: new Date().toISOString(),
    config: checkConfig(),
    games: [
      ...todayCards.map((g) => ({
        ...g,
        dateLabel: "Today",
      })),
      ...tomorrowCards.map((g) => ({
        ...g,
        dateLabel: "Tomorrow",
      })),
    ],
  };

  picksCache = result;
  lastRefreshTime = Date.now();

  return result;
}

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    message: "BetBrain V2 backend running",
    config: checkConfig(),
    time: new Date().toISOString(),
  });
});

app.get("/picks", async (req, res) => {
  try {
    if (cacheFresh()) {
      return res.json(picksCache);
    }

    const result = await refreshAllPicks();
    res.json(result);
  } catch (error) {
    console.log("GET PICKS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Failed to load picks",
      error: error.message,
      config: checkConfig(),
      games: picksCache?.games || [],
    });
  }
});

app.post("/refresh-picks", async (req, res) => {
  try {
    const result = await refreshAllPicks();
    res.json(result);
  } catch (error) {
    console.log("REFRESH PICKS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Refresh failed",
      error: error.message,
      config: checkConfig(),
    });
  }
});

app.get("/saved-picks", (req, res) => {
  res.json({
    ok: true,
    picks: getSavedPicks(),
  });
});

app.post("/save-pick", (req, res) => {
  const pick = req.body;

  savePick(pick);

  res.json({
    ok: true,
    message: "Pick saved",
    pick,
  });
});

app.post("/resolve-picks", async (req, res) => {
  try {
    const savedPicks = getSavedPicks();
    const playerStats = await fetchFinalPlayerStats();

    const updatedPicks = savedPicks.map((pick) => {
      if (pick.status && pick.status !== "pending") {
        return pick;
      }

      const result = findPlayerResult(pick, playerStats);
      const graded = gradePointsPick(pick, result);

      if (!graded) return pick;

      if (graded.status === "win") {
        updatePlayerAccuracy(graded.player, true);
      }

      if (graded.status === "loss") {
        updatePlayerAccuracy(graded.player, false);
      }

      return graded;
    });

    savePickHistory(updatedPicks);

    res.json({
      ok: true,
      message: "Picks resolved",
      picks: updatedPicks,
    });
  } catch (error) {
    console.log("RESOLVE PICKS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Resolve failed",
      error: error.message,
    });
  }
});

app.listen(CONFIG.PORT, () => {
  console.log(`BetBrain V2 server running on port ${CONFIG.PORT}`);
  console.log("CONFIG:", checkConfig());
});