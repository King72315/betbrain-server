import { TRACKING, WNBA_WINNER_VERSION, clampProb } from "./constants.js";

export function buildWinnerPredictionId({ slateDateCT, eventId, homeTeam, awayTeam }) {
  return ["WNBA", "WINNER", slateDateCT || "", eventId || "", awayTeam || "", homeTeam || ""]
    .join("|")
    .replace(/\s+/g, "");
}

export function freezeWinnerPrediction(pred = {}, frozenAt = new Date().toISOString()) {
  if (pred.frozenAt && pred.courtEdgeWnbaWinnerPrediction) return pred;
  return {
    ...pred,
    frozenAt,
    selectedWinnerId: pred.selectedWinnerId,
    pHome: pred.pHome,
    pAway: pred.pAway,
    selectedProbability: pred.selectedProbability,
    winnerTrackingType: pred.winnerTrackingType,
    winningReason: pred.winningReason,
    qualityScore: pred.qualityScore,
    winnerRank: pred.winnerRank,
  };
}

export function attachLiveMarket(pred = {}, liveMarket = {}) {
  return {
    ...pred,
    liveMarket: {
      homeMoneyline: liveMarket.homeMoneyline ?? null,
      awayMoneyline: liveMarket.awayMoneyline ?? null,
      fetchedAt: liveMarket.fetchedAt ?? null,
    },
  };
}

export function gradeWinner(pred = {}, homeScore, awayScore) {
  if (pred.frozenGrade) return pred;
  if (homeScore == null || awayScore == null) {
    return { ...pred, winnerStatus: "PENDING" };
  }
  if (Number(homeScore) === Number(awayScore)) {
    return { ...pred, winnerStatus: "VOID", actualHomeScore: homeScore, actualAwayScore: awayScore };
  }
  const homeWon = Number(homeScore) > Number(awayScore);
  const pickedHome = pred.selectedWinnerId === pred.homeTeam;
  const win = pickedHome ? homeWon : !homeWon;
  return {
    ...pred,
    winnerStatus: win ? "WIN" : "LOSS",
    actualHomeScore: homeScore,
    actualAwayScore: awayScore,
    frozenGrade: true,
  };
}

export function classifyWinnerMiss(pred = {}) {
  const status = pred.winnerStatus;
  if (pred.winnerTrackingType === TRACKING.TEST) {
    return { primaryClassification: "TEST_ONLY_OBSERVATION", secondaryTags: [status || "UNGRADED"] };
  }
  if (status === "WIN") return { primaryClassification: "WINNER_MODEL_CORRECT", secondaryTags: [] };
  if (status !== "LOSS") return { primaryClassification: "TEST_ONLY_OBSERVATION", secondaryTags: [status || "PENDING"] };
  const tags = [];
  if (pred.marketSnapshot?.modelMarketDisagreement) tags.push("MARKET_DISAGREEMENT_MISS");
  if ((pred.winnerReaderAudit?.missingData || []).length) {
    return { primaryClassification: "DATA_QUALITY_MISS", secondaryTags: tags };
  }
  if ((pred.selectedProbability || 0) >= 0.7) {
    return { primaryClassification: "CALIBRATION_OVERCONFIDENCE", secondaryTags: tags };
  }
  return { primaryClassification: "VARIANCE_ACCEPTABLE_LOSS", secondaryTags: tags };
}

export function toCanonicalPacket(pred = {}) {
  return {
    version: WNBA_WINNER_VERSION,
    winnerPredictionId: pred.winnerPredictionId,
    league: "WNBA",
    season: pred.season,
    seasonPhase: pred.seasonPhase || "REGULAR_SEASON",
    slateDateCT: pred.slateDateCT,
    eventId: pred.eventId,
    homeTeam: pred.homeTeam,
    awayTeam: pred.awayTeam,
    pHome: pred.pHome,
    pAway: pred.pAway,
    selectedWinnerId: pred.selectedWinnerId,
    selectedWinnerName: pred.selectedWinnerName,
    selectedProbability: pred.selectedProbability,
    qualityScore: pred.qualityScore,
    winnerRank: pred.winnerRank,
    winnerTrackingType: pred.winnerTrackingType,
    confidence: pred.confidence,
    risk: pred.risk,
    winningReason: pred.winningReason,
    winnerReaderAudit: pred.winnerReaderAudit,
    marketSnapshot: pred.marketSnapshot,
    featureSnapshot: pred.featureSnapshot,
    provenance: pred.provenance,
    modelVersion: pred.modelVersion,
    frozenAt: pred.frozenAt || null,
  };
}

export function assertPairSumsToOne(pHome, pAway) {
  return Math.abs(clampProb(pHome) + clampProb(pAway) - 1) < 1e-6;
}
