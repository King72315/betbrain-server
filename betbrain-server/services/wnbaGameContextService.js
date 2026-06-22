import {
  computeBlowoutRiskFromSpread,
  fetchConsensusGameSpread,
  fetchConsensusGameTotal,
} from "./oddsService.js";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function enrichWnbaGameContextForTeam(context = {}, playerTeam = "") {
  if (!context || playerTeam === "") return context;

  const team = String(playerTeam || "").toLowerCase();
  const home = String(context.homeTeam || "").toLowerCase();
  const away = String(context.awayTeam || "").toLowerCase();

  let impliedTeamTotal = context.impliedTeamTotal;
  if (context.impliedHomeTotal !== null && team && home && team.includes(home.slice(0, 4))) {
    impliedTeamTotal = context.impliedHomeTotal;
  } else if (
    context.impliedAwayTotal !== null &&
    team &&
    away &&
    team.includes(away.slice(0, 4))
  ) {
    impliedTeamTotal = context.impliedAwayTotal;
  }

  return {
    ...context,
    playerTeam,
    impliedTeamTotal,
    reasons: [
      ...(context.reasons || []).filter((r) => !r.startsWith("Implied team total")),
      impliedTeamTotal !== null && impliedTeamTotal !== undefined
        ? `Implied team total ${impliedTeamTotal}`
        : "Implied team total unavailable",
    ],
  };
}

export async function buildWnbaGameContext({
  oddsEventId = "",
  league = "WNBA",
  homeTeam = "",
  awayTeam = "",
  playerTeam = "",
} = {}) {
  const spread = await fetchConsensusGameSpread(oddsEventId, league);
  const total = await fetchConsensusGameTotal(oddsEventId, league);
  const blowoutRisk = computeBlowoutRiskFromSpread(spread);

  let impliedHomeTotal = null;
  let impliedAwayTotal = null;
  let impliedTeamTotal = null;

  if (spread !== null && total !== null) {
    impliedHomeTotal = Number(((total + spread) / 2).toFixed(1));
    impliedAwayTotal = Number(((total - spread) / 2).toFixed(1));

    const team = String(playerTeam || "").toLowerCase();
    const home = String(homeTeam || "").toLowerCase();
    const away = String(awayTeam || "").toLowerCase();

    if (team && home && team.includes(home.slice(0, 4))) {
      impliedTeamTotal = impliedHomeTotal;
    } else if (team && away && team.includes(away.slice(0, 4))) {
      impliedTeamTotal = impliedAwayTotal;
    }
  }

  return {
    version: "wnba-game-context-v1",
    homeTeam,
    awayTeam,
    spread,
    total,
    impliedHomeTotal,
    impliedAwayTotal,
    impliedTeamTotal,
    blowoutRisk,
    highBlowoutRisk: num(blowoutRisk) >= 70,
    reasons: [
      spread !== null ? `Consensus spread ${spread}` : "Spread unavailable",
      total !== null ? `Consensus total ${total}` : "Total unavailable",
      impliedTeamTotal !== null
        ? `Implied team total ${impliedTeamTotal}`
        : "Implied team total unavailable",
      `Blowout risk ${blowoutRisk}`,
    ],
  };
}
