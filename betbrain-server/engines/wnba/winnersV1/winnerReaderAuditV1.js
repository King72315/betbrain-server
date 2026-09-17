import { WNBA_WINNER_READER_VERSION } from "./constants.js";

function scoreFromP(p) {
  return Number((clamp01(p) * 100).toFixed(1));
}

function clamp01(p) {
  const n = Number(p);
  return Number.isFinite(n) ? Math.min(0.999, Math.max(0.001, n)) : 0.5;
}

export function classifyWinnerEvidenceDependency(signals = []) {
  const text = signals.map((s) => String(s || "").toLowerCase());
  const hasNet = text.some((s) => s.includes("net") || s.includes("point diff") || s.includes("rating"));
  const hasForm = text.some((s) => s.includes("recent") || s.includes("l5") || s.includes("form"));
  const hasElo = text.some((s) => s.includes("elo"));
  const overlap = [hasNet, hasForm, hasElo].filter(Boolean).length;
  if (overlap >= 3) return "DUPLICATE";
  if (overlap === 2) return "PARTIALLY_DEPENDENT";
  return "INDEPENDENT";
}

export function buildWinnerReaderAudit({
  homeTeam,
  awayTeam,
  homeName,
  awayName,
  pHome,
  pAway,
  components = {},
  market = {},
  missingData = [],
  dataQualityWarnings = [],
  restHome = null,
  restAway = null,
} = {}) {
  const home = clamp01(pHome);
  const away = clamp01(pAway);
  const selectedHome = home >= away;
  const homeReasons = [];
  const awayReasons = [];
  if (components.pElo != null) {
    if (components.pElo >= 0.5) homeReasons.push(`Chronological Elo leans home (${(components.pElo * 100).toFixed(1)}%)`);
    else awayReasons.push(`Chronological Elo leans away (${((1 - components.pElo) * 100).toFixed(1)}%)`);
  }
  if (components.pSeason != null) {
    if (components.pSeason >= 0.5) homeReasons.push("Season point differential supports home");
    else awayReasons.push("Season point differential supports away");
  }
  if (components.pRecent != null) {
    if (components.pRecent >= 0.5) homeReasons.push("Recent point differential supports home");
    else awayReasons.push("Recent point differential supports away");
  }
  homeReasons.push("WNBA home-court intercept applied from historical fit");

  const predictive = [];
  if (components.pElo != null) predictive.push("CHRONOLOGICAL_ELO");
  if (components.pSeason != null) predictive.push("SEASON_POINT_DIFF");
  if (components.pRecent != null) predictive.push("RECENT_POINT_DIFF");
  predictive.push("WNBA_HOME_COURT");

  const confidenceRisk = [];
  if ((missingData || []).length) confidenceRisk.push("MISSING_CORE_DATA");
  if (market.moneylineSource && market.marketFailoverUsed) confidenceRisk.push("MARKET_FAILOVER");
  if (market.noVigHome != null && selectedHome !== market.noVigHome >= 0.5) {
    confidenceRisk.push("MODEL_MARKET_DISAGREEMENT");
  }
  if (restHome === 1 || restAway === 1) confidenceRisk.push("B2B_REST");

  const selectedName = selectedHome ? homeName || homeTeam : awayName || awayTeam;
  const rejectedName = selectedHome ? awayName || awayTeam : homeName || homeTeam;
  return {
    version: WNBA_WINNER_READER_VERSION,
    homeCase: {
      score: scoreFromP(home),
      reasons: homeReasons,
      predictiveSignals: predictive.filter((s) => !s.includes("AWAY")),
    },
    awayCase: {
      score: scoreFromP(away),
      reasons: awayReasons,
      predictiveSignals: predictive,
    },
    pHome: Number(home.toFixed(4)),
    pAway: Number(away.toFixed(4)),
    selectedTeamId: selectedHome ? homeTeam : awayTeam,
    selectedTeamName: selectedName,
    caseMargin: Number(Math.abs(home - away).toFixed(4)),
    winningReason: `${selectedName} leads on independent team-strength blend (Elo + season/recent differential + WNBA home court).`,
    rejectedReason: `${rejectedName} trails the same blend; market favorite was not used as a shortcut.`,
    predictiveSignals: predictive,
    confidenceRiskSignals: confidenceRisk,
    labOnlySignals: [],
    noiseSignals: market.moneylineSource ? ["SPORTSBOOK_FAVORITE_NOT_USED_AS_MODEL"] : [],
    missingData,
    dataQualityWarnings,
    evidenceDependency: classifyWinnerEvidenceDependency(predictive),
  };
}
