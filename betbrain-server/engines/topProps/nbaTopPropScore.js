/**
 * NBA Top Prop score adapter — delegates to existing pickRanker logic.
 * Does not alter NBA pick generation path.
 */
import { getPickScore } from "../pickRanker.js";

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

export function scoreNbaTopProp(pick = {}) {
  const finalBestPropScore = getPickScore(pick);

  return {
    bestPropScore: finalBestPropScore,
    finalBestPropScore,
    topPropScoreBreakdown: {
      tierComponent: tierValue(pick.tier) * 25,
      confidence: num(pick.confidence ?? pick.winProbability) * 1.5,
      netEdge: num(pick.netEdge ?? pick.gap) * 2.5,
      supportScore: num(pick.supportScore) * 1.4,
      dangerPenalty: num(pick.dangerScore ?? pick.resistanceScore) * 1.2,
      chosenRiskPenalty: num(pick.chosenRisk, 70) * 0.8,
      dataQuality: num(pick.dataQuality) * 0.35,
      marketQuality: num(pick.marketQuality) * 0.25,
      bookCount: Math.min(num(pick.bookCount), 12) * 1.5,
      edge: num(pick.edge) * 1.2,
      finalBestPropScore,
    },
    topPropScoreEngine: "nba-pick-ranker",
  };
}
