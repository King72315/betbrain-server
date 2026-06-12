import cors from "cors";
import express from "express";

import { CONFIG, checkConfig } from "./config.js";

import {
  buildConsensusPointProps,
  fetchOddsGameCards,
  fetchPointsPropsForEvent,
  findOddsEventForGame,
} from "./services/oddsService.js";

import {
  buildPlayerContextMaps,
  clean,
  fetchPlayers,
  fetchProjections,
  fetchSeasonStats,
  getOpponentForTeam,
  getProjectionPoints,
  getSeasonPoints,
  getTeamForPlayer,
} from "./services/sportsDataService.js";

import {
  fetchBallTeams,
  fetchLast3VsOpponent,
  fetchLast5,
  fetchPlayerStats,
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

  const ageMinutes = (Date.now() - lastRefreshTime) / 1000 / 60;

  return ageMinutes < CONFIG.CACHE_MINUTES;
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avgPoints(games = []) {
  const points = games
    .map((g) => Number(g.points || 0))
    .filter((p) => Number.isFinite(p));

  if (!points.length) return 0;

  return points.reduce((sum, p) => sum + p, 0) / points.length;
}

function average(values = []) {
  const nums = values.map(Number).filter(Number.isFinite);

  if (!nums.length) return 0;

  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

function buildEvidenceConfidence(riskComparison) {
  let confidence = 50;

  const signal = String(riskComparison.signalStrength || "").toUpperCase();

  confidence += Math.max(
    -18,
    Math.min(24, Number(riskComparison.netEdge || 0) * 1.2)
  );

  if (signal === "STRONG") confidence += 8;
  else if (signal === "MODERATE") confidence += 4;
  else confidence -= 6;

  if (riskComparison.chosenRisk <= 25) confidence += 8;
  else if (riskComparison.chosenRisk <= 35) confidence += 5;
  else if (riskComparison.chosenRisk <= 48) confidence += 2;
  else if (riskComparison.chosenRisk >= 60) confidence -= 8;

  if (riskComparison.riskGap >= 20) confidence += 6;
  else if (riskComparison.riskGap >= 12) confidence += 4;
  else if (riskComparison.riskGap < 6) confidence -= 10;

  if (riskComparison.totalEvidence >= 35) confidence += 4;
  else if (riskComparison.totalEvidence < 15) confidence -= 5;

  if (!riskComparison.trustable) confidence = Math.min(confidence, 54);

  if (riskComparison.resistanceScore >= riskComparison.supportScore) {
    confidence = Math.min(confidence, 58);
  }

  if (signal === "WEAK") {
    confidence = Math.min(confidence, 60);
  }

  return Math.max(40, Math.min(88, Math.round(confidence)));
}

function strengthFromConfidence(confidence) {
  if (confidence >= 75) return "Elite";
  if (confidence >= 68) return "Strong";
  return "Lean";
}

function getTier({ confidence = 0, riskLabel = "", signalStrength = "", netEdge = 0 }) {
  const signal = String(signalStrength || "").toUpperCase();

  if (
    confidence >= 75 &&
    riskLabel !== "High Risk" &&
    signal === "STRONG" &&
    Number(netEdge || 0) >= 10
  ) {
    return "PREMIUM";
  }

  if (confidence >= 60) {
    return "WATCHLIST";
  }

  return "LEAN";
}

function getOpponentFromGame(team, game) {
  if (!team) return "";

  if (clean(team) === clean(game.homeTeam)) return game.awayTeam;
  if (clean(team) === clean(game.awayTeam)) return game.homeTeam;

  return "";
}

function getCombinedDataQuality({ opportunity = {}, prop = {}, last5 = [], matchupGames = [] }) {
  const values = [];

  const opportunityQuality = num(opportunity.dataQuality);
  const marketQuality = num(prop.marketQuality);

  if (opportunityQuality > 0) values.push(opportunityQuality);
  if (marketQuality > 0) values.push(marketQuality);

  if (last5.length >= 5) values.push(85);
  else if (last5.length >= 3) values.push(65);
  else if (last5.length > 0) values.push(45);

  if (matchupGames.length > 0) values.push(70);

  if (!values.length) return 50;

  return Math.round(average(values));
}

function buildTopProps(gameCards = [], options = {}) {
  const limit = Number(options.limit || CONFIG.TOP_PROP_LIMIT || 8);
  const league = options.league || null;

  const picks = [];

  for (const game of gameCards) {
    if (league && game.league !== league) continue;

    for (const pick of game.picks || []) {
      picks.push({
        ...pick,
        gameId: game.gameId || game.id,
        game: game.game,
        date: game.date,
        dateLabel: game.dateLabel,
        time: game.time,
        commenceTime: game.commenceTime,
        minutesUntilStart: game.minutesUntilStart,
        isStarted: game.isStarted,
        league: game.league || pick.league,
      });
    }
  }

  return picks
    .filter((pick) => !pick.noPlay)
    .filter((pick) => !pick.isStarted)
    .sort((a, b) => {
      const aTier = a.tier === "PREMIUM" ? 2 : a.tier === "WATCHLIST" ? 1 : 0;
      const bTier = b.tier === "PREMIUM" ? 2 : b.tier === "WATCHLIST" ? 1 : 0;

      return (
        bTier - aTier ||
        Number(b.confidence || 0) - Number(a.confidence || 0) ||
        Number(b.netEdge || 0) - Number(a.netEdge || 0) ||
        Number(a.chosenRisk || 99) - Number(b.chosenRisk || 99) ||
        Number(b.marketQuality || 0) - Number(a.marketQuality || 0) ||
        Number(b.bookCount || 0) - Number(a.bookCount || 0)
      );
    })
    .slice(0, limit)
    .map((pick, index) => ({
      ...pick,
      rank: index + 1,
    }));
}

async function buildPicksForDay(daysAhead = 0, league = "NBA") {
  const games = await fetchOddsGameCards(league, daysAhead);

  const players = league === "NBA" ? await fetchPlayers() : [];
  const seasonStats = league === "NBA" ? await fetchSeasonStats() : [];
  const projections = league === "NBA" ? await fetchProjections(daysAhead) : [];

  const { playerMap, seasonMap, projectionMap } = buildPlayerContextMaps({
    players,
    seasonStats,
    projections,
  });

  const gameCards = [];

  for (const game of games) {
    console.log("BUILDING GAME:", {
      league,
      game: game.game,
      date: game.date,
      time: game.time,
      isStarted: game.isStarted,
    });

    const oddsEvent =
      game.oddsEventId
        ? { id: game.oddsEventId }
        : await findOddsEventForGame(game, league);

    if (!oddsEvent) {
      gameCards.push({
        ...game,
        picks: [],
        message: "No sportsbook event found yet.",
      });
      continue;
    }

    const rawProps = await fetchPointsPropsForEvent(oddsEvent.id, league);
    const props = buildConsensusPointProps(rawProps);

    const builtPicks = [];

    for (const prop of props) {
      const playerName = prop.player;

      const team =
        league === "WNBA"
          ? await getBallPlayerTeam(playerName, league)
          : getTeamForPlayer(playerName, playerMap, projectionMap, seasonMap);

      if (!team) {
        console.log("SKIP PICK - NO TEAM:", {
          league,
          playerName,
          game: game.game,
        });
        continue;
      }

      const safeTeam = team;

      const opponent =
        league === "WNBA"
          ? getOpponentFromGame(team, game)
          : getOpponentForTeam(game, team) || getOpponentFromGame(team, game);

      if (!opponent) {
        console.log("SKIP PICK - NO OPPONENT:", {
          league,
          playerName,
          team,
          homeTeam: game.homeTeam,
          awayTeam: game.awayTeam,
          game: game.game,
        });
        continue;
      }

      const projectionData = projectionMap.get(clean(playerName)) || {};

      const last5 = await fetchLast5(playerName, league);

      const bdlSeasonGames =
        league === "WNBA" ? await fetchPlayerStats(playerName, league) : [];

      const bdlSeasonAverage =
        league === "WNBA" ? avgPoints(bdlSeasonGames) : 0;

      const seasonAverage =
        league === "WNBA"
          ? bdlSeasonAverage
          : getSeasonPoints(playerName, seasonMap);

      const sportsProjection =
        league === "WNBA"
          ? 0
          : getProjectionPoints(playerName, projectionMap);

      const matchupGames = await fetchLast3VsOpponent(
        playerName,
        opponent,
        league
      );

      const last5Profile = summarizeScoringProfile(last5);

      const opponentMatchup = summarizeOpponentMatchup(
        matchupGames,
        prop.line,
        last5Profile
      );

      const baseOpportunity = buildOpportunityScore({
        last5,
        projection: projectionData,
        seasonAverage,
        isPlayoff: true,
      });

      const playerData =
        playerMap.get(clean(playerName)) || projectionData || {};

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
          ...(usage.reasons || []).map((r) => `Usage boost from missing ${r}`),
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

      const dataQuality = getCombinedDataQuality({
        opportunity,
        prop,
        last5,
        matchupGames,
      });

      console.log("PICK DATA CHECK:", {
        league,
        playerName,
        line: prop.line,
        team: safeTeam,
        opponent,
        seasonAverage,
        sportsProjection,
        adjustedSportsProjection,
        last5Points: last5.map((g) => g.points),
        matchupGames: matchupGames.length,
        opponentMatchup,
        minutes: opportunity.recentMinutes,
        fga: opportunity.recentFGA,
        fta: opportunity.recentFTA,
        opportunityScore: opportunity.opportunityScore,
        dataQuality,
        marketQuality: prop.marketQuality,
        bookCount: prop.bookCount,
      });

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
        dataQuality,
      });

      let bestPick =
        riskComparison.pickSide === "OVER"
          ? overPick
          : riskComparison.pickSide === "UNDER"
            ? underPick
            : null;

      if (!bestPick || !riskComparison.trustable) {
        console.log("NO PLAY:", {
          league,
          playerName,
          line: prop.line,
          pickSide: riskComparison.pickSide,
          noPlayReasons: riskComparison.noPlayReasons,
          supportScore: riskComparison.supportScore,
          resistanceScore: riskComparison.resistanceScore,
          netEdge: riskComparison.netEdge,
        });
        continue;
      }

      const evidenceConfidence = buildEvidenceConfidence(riskComparison);

      const tier = getTier({
        confidence: evidenceConfidence,
        riskLabel: riskComparison.riskLabel,
        signalStrength: riskComparison.signalStrength,
        netEdge: riskComparison.netEdge,
      });

      bestPick = {
        ...bestPick,

        league,

        pick: riskComparison.pickSide === "OVER" ? "Over" : "Under",
        side: riskComparison.pickSide === "OVER" ? "Over" : "Under",

        winProbability: evidenceConfidence,
        confidence: evidenceConfidence,
        strength: strengthFromConfidence(evidenceConfidence),
        tier,

        riskLabel: riskComparison.riskLabel,
        overRisk: riskComparison.overRisk,
        underRisk: riskComparison.underRisk,
        chosenRisk: riskComparison.chosenRisk,
        riskGap: riskComparison.riskGap,

        support: riskComparison.support,
        resistance: riskComparison.resistance,
        supportScore: riskComparison.supportScore,
        resistanceScore: riskComparison.resistanceScore,
        netEdge: riskComparison.netEdge,
        signalStrength: riskComparison.signalStrength,
        totalEvidence: riskComparison.totalEvidence,

        overSupportScore: riskComparison.overSupportScore,
        underSupportScore: riskComparison.underSupportScore,
        overResistanceScore: riskComparison.overResistanceScore,
        underResistanceScore: riskComparison.underResistanceScore,
        overNet: riskComparison.overNet,
        underNet: riskComparison.underNet,

        riskReasons: riskComparison.reasons,
        riskWarnings: riskComparison.warnings,
        noPlay: riskComparison.noPlay,
        noPlayReasons: riskComparison.noPlayReasons,

        sportsbookLine: prop.line,
        overOdds: prop.overOdds,
        underOdds: prop.underOdds,

        bookCount: prop.bookCount,
        consensusBookCount: prop.consensusBookCount,
        overBookCount: prop.overBookCount,
        underBookCount: prop.underBookCount,
        lineSpread: prop.lineSpread,
        hasBothSides: prop.hasBothSides,
        marketQuality: prop.marketQuality,
        marketGrade: prop.marketGrade,
        marketStrengths: prop.marketStrengths,
        marketWarnings: prop.marketWarnings,

        dataQuality,
        last5Profile,

        grading: {
          support: riskComparison.support,
          resistance: riskComparison.resistance,
          supportScore: riskComparison.supportScore,
          resistanceScore: riskComparison.resistanceScore,
          netEdge: riskComparison.netEdge,
          signalStrength: riskComparison.signalStrength,
          riskLabel: riskComparison.riskLabel,
          chosenRisk: riskComparison.chosenRisk,
          confidence: evidenceConfidence,
          tier,
          dataQuality,
          marketQuality: prop.marketQuality,
          bookCount: prop.bookCount,
        },

        reasons: [...new Set(riskComparison.support || [])].slice(0, 6),
        risks: [...new Set(riskComparison.resistance || [])].slice(0, 5),
      };

      builtPicks.push({
        ...bestPick,
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

  const games = [
    ...todayCards.map((g) => ({
      ...g,
      dateLabel: "Today",
    })),
    ...tomorrowCards.map((g) => ({
      ...g,
      dateLabel: "Tomorrow",
    })),
  ];

  const nbaGames = games.filter((g) => g.league === "NBA");
  const wnbaGames = games.filter((g) => g.league === "WNBA");

  const result = {
    ok: true,
    lastUpdated: new Date().toISOString(),
    config: checkConfig(),

    topProps: buildTopProps(games),
    topNBAProps: buildTopProps(games, { league: "NBA" }),
    topWNBAProps: buildTopProps(games, { league: "WNBA" }),

    games,
    nbaGames,
    wnbaGames,
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
  const league = req.query.league || "NBA";
  const teams = await fetchBallTeams(league);

  res.json({
    ok: true,
    league,
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
      topProps: picksCache?.topProps || [],
    });
  }
});

app.get("/top-props", async (req, res) => {
  try {
    if (!cacheFresh()) {
      await refreshAllPicks();
    }

    res.json({
      ok: true,
      lastUpdated: picksCache.lastUpdated,
      topProps: picksCache.topProps || [],
      topNBAProps: picksCache.topNBAProps || [],
      topWNBAProps: picksCache.topWNBAProps || [],
    });
  } catch (error) {
    console.log("GET TOP PROPS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Failed to load top props",
      error: error.message,
    });
  }
});

app.get("/picks/:league", async (req, res) => {
  try {
    const league = String(req.params.league || "").toUpperCase();

    if (!["NBA", "WNBA"].includes(league)) {
      return res.status(400).json({
        ok: false,
        message: "League must be NBA or WNBA",
      });
    }

    if (!cacheFresh()) {
      await refreshAllPicks();
    }

    res.json({
      ok: true,
      league,
      lastUpdated: picksCache.lastUpdated,
      games: league === "NBA" ? picksCache.nbaGames : picksCache.wnbaGames,
      topProps:
        league === "NBA" ? picksCache.topNBAProps : picksCache.topWNBAProps,
    });
  } catch (error) {
    console.log("GET LEAGUE PICKS ERROR:", error.message);

    res.status(500).json({
      ok: false,
      message: "Failed to load league picks",
      error: error.message,
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