function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function rankByWinProbability(picks = []) {
  return [...picks].sort((a, b) => {
    return (
      Number(b.winProbability || 0) -
        Number(a.winProbability || 0) ||
      Number(b.opportunityScore || 0) -
        Number(a.opportunityScore || 0) ||
      Number(b.edge || 0) -
        Number(a.edge || 0)
    );
  });
}

function chooseBestPickPerPlayer(picks = []) {
  const best = new Map();

  for (const pick of rankByWinProbability(picks)) {
    const key = clean(`${pick.player}-${pick.team}`);

    if (!best.has(key)) {
      best.set(key, pick);
    }
  }

  return Array.from(best.values());
}

function buildTopPicksForGame({ game = {}, picks = [] }) {
  const homeTeam = game.homeTeam || game.home || game.HomeTeam;
  const awayTeam = game.awayTeam || game.away || game.AwayTeam;

  const cleanHome = clean(homeTeam);
  const cleanAway = clean(awayTeam);

  const uniquePicks = chooseBestPickPerPlayer(picks);
const hasTeamMatches = uniquePicks.some(
  (p) => clean(p.team) === cleanHome || clean(p.team) === cleanAway
);

const homePicks = hasTeamMatches
  ? rankByWinProbability(
      uniquePicks.filter((p) => clean(p.team) === cleanHome)
    ).slice(0, 2)
  : [];

const awayPicks = hasTeamMatches
  ? rankByWinProbability(
      uniquePicks.filter((p) => clean(p.team) === cleanAway)
    ).slice(0, 2)
  : [];

const fallbackPicks = !hasTeamMatches
  ? rankByWinProbability(uniquePicks).slice(0, 4)
  : [];

  return {
    gameId: game.id || game.gameId || game.GameID || "",
    game: game.game || `${awayTeam} vs ${homeTeam}`,
    homeTeam,
    awayTeam,
    time: game.time || game.DateTime || "",
    picks: rankByWinProbability([...awayPicks, ...homePicks, ...fallbackPicks]),
    homePicks,
    awayPicks,
  };
}

export {
  buildTopPicksForGame, chooseBestPickPerPlayer, rankByWinProbability
};

