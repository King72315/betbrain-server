
const BASE_URL = "http://localhost:3000";

export const fetchSavedPicks = async () => {
  try {
    const res = await fetch(`${BASE_URL}/picks`);
    const data = await res.json();

    return {
      lastUpdated: new Date().toISOString(),
      games: data.games || [],
      gamePicks: data.gamePicks || [],
      top3: data.top3 || [],
      twoMan: data.twoMan || [],
      realProps: data.realProps || [],
    };
  } catch (err) {
    console.log("FETCH SAVED PICKS ERROR:", err);

    return {
      lastUpdated: null,
      games: [],
      gamePicks: [],
      top3: [],
      twoMan: [],
      realProps: [],
    };
  }
};


export const refreshSavedPicks = async () => {
  try {
    const res = await fetch(`${BASE_URL}/refresh-picks`, {
      method: "POST",
    });

    return await res.json();
  } catch (err) {
    console.log("REFRESH SAVED PICKS ERROR:", err);
    return {
      ok: false,
      message: "Refresh failed",
    };
  }
};

const num = (v: any) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const clean = (v: any) =>
  String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const getGamesPlayed = (p: any) =>
  num(p.Games) || num(p.GamesPlayed) || num(p.Played) || 82;

const normalizeStat = (v: any) => {
  const s = String(v || "").toLowerCase();

  if (s.includes("rebound")) return "Rebounds";
  if (s.includes("assist")) return "Assists";
  if (s.includes("three") || s.includes("3pt") || s.includes("3-point")) return "Threes";
  if (s.includes("point")) return "Points";

  return "";
};

const normalizePlayer = (p: any) => {
  const games = Math.max(1, getGamesPlayed(p));

  const pointsRaw = num(p.points ?? p.Points ?? p.PPG);
  const reboundsRaw = num(p.rebounds ?? p.Rebounds ?? p.RPG);
  const assistsRaw = num(p.assists ?? p.Assists ?? p.APG);
  const threesRaw = num(p.threes ?? p.ThreePointersMade ?? p.ThreePointers ?? p.TPM);

  return {
    ...p,
    name: p.name || p.Name || p.PlayerName || p.FullName,
    Team: p.Team || p.team,
    team: p.team || p.Team,
    playerID: p.PlayerID || p.playerID || p.PlayerId || p.playerId,

    points: pointsRaw > 60 ? pointsRaw / games : pointsRaw,
    rebounds: reboundsRaw > 25 ? reboundsRaw / games : reboundsRaw,
    assists: assistsRaw > 25 ? assistsRaw / games : assistsRaw,
    threes: threesRaw > 10 ? threesRaw / games : threesRaw,
  };
};

const statValue = (player: any, stat: string) => {
  if (stat === "Points") return num(player.points);
  if (stat === "Rebounds") return num(player.rebounds);
  if (stat === "Assists") return num(player.assists);
  if (stat === "Threes") return num(player.threes);
  return 0;
};

const recentValue = (last5: any, stat: string) => {
  if (!last5) return 0;

  if (stat === "Points") return num(last5.points);
  if (stat === "Rebounds") return num(last5.rebounds);
  if (stat === "Assists") return num(last5.assists);
  if (stat === "Threes") return num(last5.threes);

  return 0;
};

const statWeight = (stat: string) => {
  if (stat === "Rebounds") return 1.35;
  if (stat === "Assists") return 1.3;
  if (stat === "Threes") return 1.2;
  return 1;
};

export const fetchGames = async () => {
  try {
    const res = await fetch(`${BASE_URL}/games`);
    const data = await res.json();

    return Array.isArray(data)
      ? data.map((g: any) => ({
          ...g,
          HomeTeam: g.HomeTeam || g.homeTeam || g.Home || g.home,
          AwayTeam: g.AwayTeam || g.awayTeam || g.Away || g.away,
          oddsEventID: g.oddsEventID || g.OddsEventID || null,
          dateLabel: g.dateLabel || g.DateLabel || g.dayLabel || g.DayLabel,
        }))
      : [];
  } catch (err) {
    console.log("FETCH GAMES ERROR:", err);
    return [];
  }
};

export const fetchPlayersForGame = async (game: any) => {
  try {
    const res = await fetch(`${BASE_URL}/players`);
    const data = await res.json();

    if (!Array.isArray(data)) return [];

    return data
      .map(normalizePlayer)
      .filter(
        (p: any) =>
          p.Team === game.HomeTeam ||
          p.Team === game.AwayTeam
      );
  } catch (err) {
    console.log("FETCH PLAYERS ERROR:", err);
    return [];
  }
};

export const fetchOddsForGame = async (game: any) => {
  try {
    const eventID = game.oddsEventID;
    if (!eventID) return [];

    const res = await fetch(`${BASE_URL}/props/${eventID}`);
    const data = await res.json();

    if (!Array.isArray(data)) return [];

    return data
      .map((o: any) => ({
        ...o,
        player: o.player || o.Player || o.description,
        type: normalizeStat(o.type || o.market || o.stat),
        line: num(o.line ?? o.point),
        sportsbook: o.sportsbook || o.book || "Consensus",
        overOdds: num(o.overOdds ?? o.over_odds ?? o.over),
        underOdds: num(o.underOdds ?? o.under_odds ?? o.under),
      }))
      .filter((o: any) => o.player && o.type && o.line);
  } catch (err) {
    console.log("FETCH ODDS ERROR:", err);
    return [];
  }
};

export const fetchLast5ForPlayer = async (playerID: any) => {
  if (!playerID) return null;

  try {
    const res = await fetch(`${BASE_URL}/player-log/${playerID}`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) return null;

    const last5 = data.slice(-5);

    return {
      points: last5.reduce((sum: number, g: any) => sum + num(g.Points), 0) / last5.length,
      rebounds: last5.reduce((sum: number, g: any) => sum + num(g.Rebounds), 0) / last5.length,
      assists: last5.reduce((sum: number, g: any) => sum + num(g.Assists), 0) / last5.length,
      threes: last5.reduce((sum: number, g: any) => sum + num(g.ThreePointersMade), 0) / last5.length,
    };
  } catch (err) {
    console.log("LAST5 ERROR:", err);
    return null;
  }
};

const buildPick = async (game: any, player: any, odd: any) => {
  const stat = odd.type;
  const line = num(odd.line);

  const seasonAvg = statValue(player, stat);

let last5Avg = 0;

if (player.playerID) {
  const last5 = await fetchLast5ForPlayer(player.playerID);
  last5Avg = recentValue(last5, stat);
}

  const baseProjection = last5Avg
    ? seasonAvg * 0.55 + last5Avg * 0.45
    : seasonAvg;

  if (!baseProjection || !line) return null;

  const anchor =
    stat === "Points" ? 0.55 :
    stat === "Rebounds" ? 0.65 :
    stat === "Assists" ? 0.65 :
    stat === "Threes" ? 0.7 :
    0.6;

  const marketProjection = baseProjection * anchor + line * (1 - anchor);

  const overOdds = num(odd.overOdds);
  const underOdds = num(odd.underOdds);

  const oddsLean =
    overOdds && underOdds
      ? (underOdds - overOdds) * 0.01
      : 0;

  const adjustedProjection = marketProjection + oddsLean;

  const maxDiff = stat === "Points" ? 5 : 3;

  const safeProjection = Math.max(
    line - maxDiff,
    Math.min(line + maxDiff, adjustedProjection)
  );

console.log("PICK DEBUG:", player.name, stat, {
  seasonAvg,
  last5Avg,
  baseProjection,
  line,
  adjustedProjection,
  safeProjection,
});

  const diff = safeProjection - line;
  const side = diff >= 0 ? "Over" : "Under";
  const edge = Math.abs(diff);

  if (edge < (stat === "Points" ? 1.2 : 0.6)) return null;

  const score = edge * statWeight(stat);

  const winProb = Math.min(
    75,
    Math.max(58, Math.round(58 + score * 4))
  );

  return {
    label: `${player.name} ${side} ${line} ${stat}`,
    player: player.name,
    stat,
    line,
    pick: side,
    side,
    projection: Number(safeProjection.toFixed(1)),
    edge: Number(edge.toFixed(1)),
    score: Number(score.toFixed(2)),
    winProb,
    confidence: winProb,
    team: player.Team,
    gameKey: String(game.oddsEventID || game.GameID || game.gameID),
    sportsbook: odd.sportsbook || "Consensus",
    isFallback: false,
    seasonAvg: Number(seasonAvg.toFixed(1)),
    last5Avg: last5Avg ? Number(last5Avg.toFixed(1)) : null,
    reasoning: last5Avg
      ? `Season ${seasonAvg.toFixed(1)}, Last 5 ${last5Avg.toFixed(1)}, line ${line}, edge ${edge.toFixed(1)}`
      : `Season ${seasonAvg.toFixed(1)}, line ${line}, edge ${edge.toFixed(1)}`,
  };
};

const balanceGamePicks = (picks: any[]) => {
  const sorted = [...picks].sort(
    (a, b) =>
      b.score - a.score ||
      b.winProb - a.winProb ||
      b.edge - a.edge
  );

  const chosen: any[] = [];
  const usedPlayers = new Set<string>();
  const usedStats = new Set<string>();

  const bestOver = sorted.find((p) => p.side === "Over");
  const bestUnder = sorted.find((p) => p.side === "Under");

  if (bestOver) {
    chosen.push(bestOver);
    usedPlayers.add(bestOver.player);
    usedStats.add(bestOver.stat);
  }

  if (bestUnder && !usedPlayers.has(bestUnder.player)) {
    chosen.push(bestUnder);
    usedPlayers.add(bestUnder.player);
    usedStats.add(bestUnder.stat);
  }

  for (const p of sorted) {
    if (chosen.length >= 3) break;
    if (usedPlayers.has(p.player)) continue;
    if (usedStats.has(p.stat)) continue;

    chosen.push(p);
    usedPlayers.add(p.player);
    usedStats.add(p.stat);
  }

  for (const p of sorted) {
    if (chosen.length >= 3) break;
    if (usedPlayers.has(p.player)) continue;

    chosen.push(p);
    usedPlayers.add(p.player);
  }

  return chosen;
};

export const buildPlayerPicks = async (games: any[]) => {
  const allPicks: any[] = [];

  for (const game of games || []) {
    const players = await fetchPlayersForGame(game);
    const odds = await fetchOddsForGame(game);

    if (!players.length || !odds.length) continue;

    const gamePicks: any[] = [];

    for (const odd of odds) {
      const player = players.find(
        (p: any) => clean(p.name) === clean(odd.player)
      );

      if (!player) continue;

      const pick = await buildPick(game, player, odd);
      if (pick) gamePicks.push(pick);
    }

    allPicks.push(...balanceGamePicks(gamePicks));
  }

  return allPicks;
};

export const buildAllPlayerPicksForGame = async (game: any) => {
  const players = await fetchPlayersForGame(game);
  const odds = await fetchOddsForGame(game);

  if (!players.length || !odds.length) return [];

  const gamePicks: any[] = [];

  for (const odd of odds) {
    const player = players.find(
      (p: any) => clean(p.name) === clean(odd.player)
    );

    if (!player) continue;

    const pick = await buildPick(game, player, odd);
    if (pick) gamePicks.push(pick);
  }

  return gamePicks.sort(
    (a, b) =>
      b.score - a.score ||
      b.winProb - a.winProb ||
      b.edge - a.edge
  );
};

export const buildTwoManPick = (picks: any[] = []) => {
  const sorted = [...picks].sort(
    (a, b) =>
      b.score - a.score ||
      b.winProb - a.winProb ||
      b.edge - a.edge
  );

  const chosen: any[] = [];
  const usedPlayers = new Set<string>();

  const bestOver = sorted.find((p) => p.side === "Over");
  const bestUnder = sorted.find((p) => p.side === "Under");

  if (bestOver) {
    chosen.push(bestOver);
    usedPlayers.add(bestOver.player);
  }

  if (bestUnder && !usedPlayers.has(bestUnder.player)) {
    chosen.push(bestUnder);
    usedPlayers.add(bestUnder.player);
  }

  for (const p of sorted) {
    if (chosen.length >= 2) break;
    if (usedPlayers.has(p.player)) continue;

    chosen.push(p);
    usedPlayers.add(p.player);
  }

  return chosen.slice(0, 2);
};