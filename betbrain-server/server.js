import cors from "cors";
import express from "express";

import { CONFIG, checkConfig } from "./config.js";

import {
  buildConsensusPointProps,
  fetchPointsPropsForEvent,
  findOddsEventForGame,
} from "./services/oddsService.js";

import {
  fetchOddsGameCards
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
  getTeamForPlayer
} from "./services/sportsDataService.js";

import {
  fetchBallTeams,
  fetchLast3VsOpponent,
  fetchLast5,
  getBallPlayerTeam,
  summarizeOpponentMatchup,
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
import { compareOverUnderRisk } from "./engines/riskComparisonEngine.js";
import {
  calcUsageBoost,
  getMissingPlayers,
} from "./engines/usageEngine.js";
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



function getOpponentFromGame(team, game) {
  if (!team) return "";

  if (clean(team) === clean(game.homeTeam)) return game.awayTeam;
  if (clean(team) === clean(game.awayTeam)) return game.homeTeam;

  return "";
}

async function buildPicksForDay(daysAhead = 0, league = "NBA") {
  const games =
  league === "WNBA"
    ? await fetchOddsGameCards("WNBA")
    : await fetchGames(daysAhead, league);
    
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

   const oddsEvent = await findOddsEventForGame(game, league);

    if (!oddsEvent) {
      gameCards.push({
        ...game,
        picks: [],
        message: "No sportsbook event found yet.",
      });
      continue;
    }

    const rawProps = await fetchPointsPropsForEvent(
  oddsEvent.id,
  league
);
    const props = buildConsensusPointProps(rawProps);

    const builtPicks = [];

    for (const prop of props) {
      const playerName = prop.player;

     const team =
  league === "WNBA"
    ? await getBallPlayerTeam(playerName, league)
    : getTeamForPlayer(
        playerName,
        playerMap,
        projectionMap,
        seasonMap
      );

if (!team) continue;

const safeTeam = team;

const opponent =
  league === "WNBA"
    ? getOpponentFromGame(team, game)
    : getOpponentForTeam(game, team);

if (!opponent) continue;

      const projectionData =
        projectionMap.get(clean(playerName)) || {};

      const bdlLast5 = await fetchLast5(playerName, league);

const bdlRecentAverage =
  bdlLast5.length
    ? bdlLast5.reduce((sum, g) => sum + Number(g.points || 0), 0) / bdlLast5.length
    : 0;

const seasonAverage =
  league === "WNBA"
    ? bdlRecentAverage
    : getSeasonPoints(playerName, seasonMap);

const sportsProjection =
  league === "WNBA"
    ? 0
    : getProjectionPoints(playerName, projectionMap);

const last5 = bdlLast5;

console.log("WNBA PROJECTION DEBUG", {
  player: playerName,
  projection: sportsProjection,
  seasonAverage,
  team,
});
     

const matchupGames = await fetchLast3VsOpponent(
  playerName,
  opponent,
  league
);
      
      const opponentMatchup = summarizeOpponentMatchup(
  matchupGames,
  prop.line,
  summarizeScoringProfile(last5)
);
      const last5Profile = summarizeScoringProfile(last5);

      const baseOpportunity = buildOpportunityScore({
        last5,
        projection: projectionData,
        seasonAverage,
        isPlayoff: true,
      });

      const playerData =
        playerMap.get(clean(playerName)) ||
        projectionData ||
        {};

      const missingPlayers =
  league === "WNBA" ? [] : getMissingPlayers(safeTeam, players);

const usage =
  league === "WNBA"
    ? {
        confidenceBoost: 0,
        projectionBoost: 0,
        reasons: [],
        log: `WNBA usage boost skipped for ${playerName}`,
      }
    : calcUsageBoost(
        {
          ...playerData,
          ...projectionData,
          Name: playerName,
        },
        "Points",
        missingPlayers
      );

      console.log(usage.log);

      const baseSportsProjection = Number(sportsProjection || 0);
const usageProjectionBoost = Number(usage.projectionBoost || 0);

const adjustedSportsProjection =
  baseSportsProjection > 0
    ? Math.max(0, baseSportsProjection + usageProjectionBoost)
    : 0;

      const opportunity = {
        ...baseOpportunity,
        opportunityScore: Math.min(
          100,
          Number(baseOpportunity.opportunityScore || 0) +
            Number(usage.confidenceBoost || 0)
        ),
        reasons: [
          ...(baseOpportunity.reasons || []),
          ...usage.reasons.map((r) => `Usage boost from missing ${r}`),
        ],
        risks: baseOpportunity.risks || [],
        usageBoost: usage,
      };

      const playoff = buildPlayoffContext({
        last5,
        matchupGames,
        line: prop.line,
        opportunityScore: opportunity.opportunityScore,
      });



console.log(
  "PICK DATA CHECK:",
  playerName,
  "LINE:",
  prop.line,
  "SEASON:",
  seasonAverage,
  "SPORTS PROJECTION:",
  sportsProjection,
  "ADJUSTED PROJECTION:",
  adjustedSportsProjection,
  "LAST5 POINTS:",
  last5.map((g) => g.points),
  "OPP:",
opportunity.opportunityScore,

"OPP MATCHUP:",
opponentMatchup,
  "MIN:",
  opportunity.recentMinutes,
  "FGA:",
  opportunity.recentFGA,
  "FTA:",
  opportunity.recentFTA,
  "OPP:",
  opportunity.opportunityScore
);

      const overPick = buildWinProbability({
        player: playerName,
        team: safeTeam,
        opponent,
        game: game.game,
        line: prop.line,
        side: "Over",
        seasonAverage,
        sportsProjection: adjustedSportsProjection,
        last5,
        matchupGames,
        opportunity,
        playoff,
        opponentMatchup,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
      });

      const underPick = buildWinProbability({
        player: playerName,
        team: safeTeam,
        opponent,
        game: game.game,
        line: prop.line,
        side: "Under",
        seasonAverage,
        sportsProjection: adjustedSportsProjection,
        last5,
        matchupGames,
        opportunity,
        playoff,
        opponentMatchup,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
      });

      const riskComparison = compareOverUnderRisk({
        playerName,
        line: prop.line,
        projection: adjustedSportsProjection || overPick.projection,
        seasonAvg: seasonAverage,
        last5Avg: overPick.last5Average,
        minutesAvg: opportunity.recentMinutes,
        fgaAvg: opportunity.recentFGA,
        ftaAvg: opportunity.recentFTA,
        usageScore: opportunity.usageBoost?.confidenceBoost
          ? 50 + Number(opportunity.usageBoost.confidenceBoost)
          : 50,
        opportunityScore: opportunity.opportunityScore,
        matchupScore: overPick.matchupHitRate || 50,
        defenseScore: 50,
        roleCertainty: opportunity.roleCertainty || 50,
        blowoutRisk: 50,
        dataQuality: opportunity.dataQuality || 50,
      });

      let bestPick =
        riskComparison.pickSide === "OVER"
          ? overPick
          : riskComparison.pickSide === "UNDER"
            ? underPick
            : null;

      if (!bestPick || !riskComparison.trustable) {
        continue;
      }

      bestPick = {
        ...bestPick,
        pick: riskComparison.pickSide === "OVER" ? "Over" : "Under",
        side: riskComparison.pickSide === "OVER" ? "Over" : "Under",
        riskLabel: riskComparison.riskLabel,
        overRisk: riskComparison.overRisk,
        underRisk: riskComparison.underRisk,
        chosenRisk: riskComparison.chosenRisk,
        riskGap: riskComparison.riskGap,
        riskReasons: riskComparison.reasons,
        riskWarnings: riskComparison.warnings,
        reasons: [
          ...new Set([
            ...(riskComparison.reasons || []),
            ...(bestPick.reasons || []),
          ]),
        ].slice(0, 6),
        risks: [
          ...new Set([
            ...(riskComparison.warnings || []),
            ...(bestPick.risks || []),
          ]),
        ].slice(0, 5),
      };

      builtPicks.push({
        ...bestPick,
        sportsbookLine: prop.line,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,
        bookCount: prop.bookCount,
        last5Profile,
        label: `${playerName} — ${safeTeam} ${bestPick.pick} ${prop.line} Points`,
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
  const todayCards = [
  ...(await buildPicksForDay(0, "NBA")),
  ...(await buildPicksForDay(0, "WNBA")),
];

const tomorrowCards = [
  ...(await buildPicksForDay(1, "NBA")),
  ...(await buildPicksForDay(1, "WNBA")),
];

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
    message: "CourtEdge backend running",
    config: checkConfig(),
    time: new Date().toISOString(),
  });
});

app.get("/test-ball-teams", async (req, res) => {
  const teams = await fetchBallTeams();

  res.json({
    ok: true,
    count: teams.length,
    sample: teams.slice(0, 3),
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
  console.log(`CourtEdge server running on port ${CONFIG.PORT}`);
  console.log("CONFIG:", checkConfig());
});