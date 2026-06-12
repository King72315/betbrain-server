function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function tierValue(tier = "") {
  const t = String(tier).toUpperCase();

  if (t === "PREMIUM") return 3;
  if (t === "WATCHLIST") return 2;
  if (t === "LEAN") return 1;

  return 0;
}

function riskValue(riskLabel = "") {
  const r = String(riskLabel).toLowerCase();

  if (r.includes("low")) return 3;
  if (r.includes("medium")) return 2;
  if (r.includes("high")) return 1;

  return 0;
}

function signalValue(signalStrength = "") {
  const s = String(signalStrength).toUpperCase();

  if (s === "STRONG") return 3;
  if (s === "MODERATE") return 2;
  if (s === "WEAK") return 1;

  return 0;
}

function getPickScore(pick = {}) {
  const confidence = num(pick.confidence ?? pick.winProbability);
  const netEdge = num(pick.netEdge ?? pick.gap);
  const supportScore = num(pick.supportScore);
  const dangerScore = num(pick.dangerScore ?? pick.resistanceScore);
  const chosenRisk = num(pick.chosenRisk, 70);
  const dataQuality = num(pick.dataQuality);
  const marketQuality = num(pick.marketQuality);
  const bookCount = num(pick.bookCount);
  const edge = num(pick.edge);

  let score = 0;

  score += tierValue(pick.tier) * 25;
  score += signalValue(pick.signalStrength) * 12;
  score += riskValue(pick.riskLabel) * 10;

  score += confidence * 1.5;
  score += netEdge * 2.5;
  score += supportScore * 1.4;

  score -= dangerScore * 1.2;
  score -= chosenRisk * 0.8;

  score += dataQuality * 0.35;
  score += marketQuality * 0.25;
  score += Math.min(bookCount, 12) * 1.5;
  score += edge * 1.2;

  if (pick.noPlay) score -= 1000;
  if (pick.isStarted) score -= 1000;

  return Number(score.toFixed(2));
}

function isPlayablePick(pick = {}) {
  if (!pick) return false;
  if (pick.noPlay) return false;
  if (pick.trustable === false) return false;

  const confidence = num(pick.confidence ?? pick.winProbability);
  const supportScore = num(pick.supportScore);
  const netEdge = num(pick.netEdge ?? pick.gap);
  const chosenRisk = num(pick.chosenRisk, 70);

  if (confidence < 55) return false;
  if (supportScore < 6) return false;
  if (netEdge < 2) return false;
  if (chosenRisk >= 70) return false;

  return true;
}

function rankTopProps(picks = []) {
  return [...picks]
    .filter(isPlayablePick)
    .sort((a, b) => {
      return (
        getPickScore(b) - getPickScore(a) ||
        tierValue(b.tier) - tierValue(a.tier) ||
        num(b.confidence ?? b.winProbability) -
          num(a.confidence ?? a.winProbability) ||
        num(b.netEdge ?? b.gap) - num(a.netEdge ?? a.gap) ||
        num(a.chosenRisk, 99) - num(b.chosenRisk, 99) ||
        num(b.dataQuality) - num(a.dataQuality) ||
        num(b.marketQuality) - num(a.marketQuality) ||
        num(b.bookCount) - num(a.bookCount)
      );
    });
}

function chooseBestPickPerPlayer(picks = []) {
  const best = new Map();

  for (const pick of rankTopProps(picks)) {
    const key = clean(`${pick.player}-${pick.team}`);

    if (!best.has(key)) {
      best.set(key, pick);
    }
  }

  return Array.from(best.values());
}

function splitPicksByTeam({ picks = [], homeTeam = "", awayTeam = "" }) {
  const cleanHome = clean(homeTeam);
  const cleanAway = clean(awayTeam);

  const homePicks = [];
  const awayPicks = [];
  const unmatchedPicks = [];

  for (const pick of picks) {
    const pickTeam = clean(pick.team);

    if (pickTeam === cleanHome) {
      homePicks.push(pick);
    } else if (pickTeam === cleanAway) {
      awayPicks.push(pick);
    } else {
      unmatchedPicks.push(pick);
    }
  }

  return {
    homePicks: rankTopProps(homePicks),
    awayPicks: rankTopProps(awayPicks),
    unmatchedPicks: rankTopProps(unmatchedPicks),
  };
}

function buildTopPicksForGame({ game = {}, picks = [] }) {
  const homeTeam = game.homeTeam || game.home || game.HomeTeam || "";
  const awayTeam = game.awayTeam || game.away || game.AwayTeam || "";

  const uniquePicks = chooseBestPickPerPlayer(picks);

  const rankedAll = rankTopProps(uniquePicks);

  const { homePicks, awayPicks, unmatchedPicks } = splitPicksByTeam({
    picks: rankedAll,
    homeTeam,
    awayTeam,
  });

  const hasTeamMatches = homePicks.length > 0 || awayPicks.length > 0;

  const topHomePicks = homePicks.slice(0, 2);
  const topAwayPicks = awayPicks.slice(0, 2);

  const topGamePicks = hasTeamMatches
    ? rankTopProps([...topAwayPicks, ...topHomePicks]).slice(0, 4)
    : rankedAll.slice(0, 4);

  const allTopPicks = rankTopProps([
    ...topGamePicks,
    ...unmatchedPicks.slice(0, 2),
  ]).slice(0, 4);

  return {
    ...game,

    gameId: game.id || game.gameId || game.GameID || "",
    id: game.id || game.gameId || game.GameID || "",

    game: game.game || `${awayTeam} vs ${homeTeam}`,
    league: game.league || "",

    homeTeam,
    awayTeam,
    home: game.home || homeTeam,
    away: game.away || awayTeam,

    date: game.date || "",
    dateLabel: game.dateLabel || "",
    time: game.time || game.DateTime || "",
    commenceTime: game.commenceTime || game.time || "",
    minutesUntilStart: game.minutesUntilStart,
    isStarted: Boolean(game.isStarted),

    picks: allTopPicks.map((pick, index) => ({
      ...pick,
      rank: index + 1,
      pickScore: getPickScore(pick),
    })),

    homePicks: topHomePicks.map((pick, index) => ({
      ...pick,
      teamRank: index + 1,
      pickScore: getPickScore(pick),
    })),

    awayPicks: topAwayPicks.map((pick, index) => ({
      ...pick,
      teamRank: index + 1,
      pickScore: getPickScore(pick),
    })),

    allCandidateCount: picks.length,
    playableCandidateCount: rankedAll.length,
  };
}

export {
  buildTopPicksForGame,
  chooseBestPickPerPlayer,
  getPickScore,
  isPlayablePick,
  rankTopProps
};

