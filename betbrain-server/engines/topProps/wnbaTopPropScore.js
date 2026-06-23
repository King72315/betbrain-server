/**
 * WNBA v2 Top Prop score from wnbaDataCard + wnbaReader fields.
 */
function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O") return "OVER";
  if (raw === "UNDER" || raw === "U") return "UNDER";
  return "";
}

function scoreVolumePath(side, card = {}) {
  const line = num(card.bookLine);
  const proj = num(card.projection?.projection);
  const minutes = num(card.last5?.minutes);
  const fga = num(card.last5?.fga);
  let score = 0;
  const edge = side === "OVER" ? proj - line : line - proj;
  if (edge >= 4) score += 12;
  else if (edge >= 2.5) score += 7;
  else if (edge <= 1) score -= 8;
  if (side === "OVER") {
    if (line <= 8.5) {
      if (minutes >= 20 && fga >= 6) score += 8;
      else if (minutes > 0 && minutes < 18) score -= 10;
    } else {
      if (minutes >= 28 && fga >= 12) score += 8;
      else if (minutes > 0 && minutes < 24) score -= 8;
    }
    if (fga >= 10) score += 4;
    else if (fga > 0 && fga < 7) score -= 6;
  }
  if (side === "UNDER") {
    if (minutes > 0 && minutes < 22) score += 5;
    if (fga > 0 && fga < 8) score += 4;
  }
  return score;
}

function scoreProjection(side, card = {}) {
  const line = num(card.bookLine);
  const recent = num(card.last5?.points);
  let score = 0;
  if (side === "OVER" && recent >= line + 2) score += 6;
  if (side === "UNDER" && recent <= line - 2) score += 6;
  if (card.scoringTrend === "up" && side === "OVER") score += 3;
  if (card.scoringTrend === "down" && side === "UNDER") score += 3;
  return score;
}

function scoreFairLine(side, card = {}) {
  const fair = card.fairLine || {};
  const fairSide = normalizeSide(fair.fairLineSide);
  const edge = Math.abs(num(fair.fairLineEdge));
  const quality = num(fair.fairLineQuality);
  if (fairSide === "NONE" || edge < 1.5) return 0;
  if (fairSide === side) return clamp(Math.round(quality / 12 + edge * 2), 3, 12);
  return -clamp(Math.round(quality / 10 + edge * 2), 4, 14);
}

function scoreMarket(card = {}) {
  let score = 0;
  if (num(card.bookCount) >= 4) score += 3;
  else if (num(card.bookCount) <= 1) score -= 4;
  if (num(card.lineSpread) >= 2.5) score -= 4;
  return score;
}

function scoreRole(side, card = {}) {
  let score = 0;
  if (card.roleTrend === "up" && side === "OVER") score += 6;
  if (card.roleTrend === "down" && side === "UNDER") score += 5;
  if (card.roleTrend === "down" && side === "OVER") score -= 6;
  if (card.teammateUsageShift?.active && side === "OVER") score += 5;
  return score;
}

function scoreAvailability(card = {}) {
  const avail = card.injuryAvailability || {};
  if (avail.level === "OUT" || avail.blocksPlay) return -100;
  if (avail.level === "QUESTIONABLE") return -4;
  return 0;
}

function scoreGameContext(side, card = {}) {
  const env = card.gameEnvironment || {};
  const blowout = num(env.blowoutRisk);
  let score = 0;
  if (side === "OVER" && blowout >= 75) score -= 10;
  if (side === "UNDER" && blowout >= 70) score += 5;
  const defScore = num(card.opponentDefense?.score);
  if (side === "OVER" && defScore >= 70) score -= 5;
  if (side === "UNDER" && defScore >= 65) score += 4;
  return score;
}

export function scoreWnbaTopProp(pick = {}) {
  const dataCard = pick.wnbaDataCard || {};
  const reader = pick.wnbaReader || {};
  const side =
    normalizeSide(reader.finalSide) ||
    normalizeSide(pick.side || pick.pick);

  const chosenCase =
    side === "OVER" ? reader.overCase : side === "UNDER" ? reader.underCase : null;

  const volumePathScore = scoreVolumePath(side, dataCard);
  const roleScore = scoreRole(side, dataCard);
  const projectionScore = scoreProjection(side, dataCard);
  const fairLineScore = scoreFairLine(side, dataCard);
  const marketScore = scoreMarket(dataCard);
  const dataQualityScore = num(dataCard.dataConfidenceScore) * 0.35;
  const availabilityScore = scoreAvailability(dataCard);
  const gameContextScore = scoreGameContext(side, dataCard);

  const contradictionPenalty = clamp(
    num(reader.disagrees?.length, pick.resistance?.length) * 2.5,
    0,
    25
  );

  const volatilityPenalty = clamp(
    (dataCard.scoringTrend === "up" && side === "UNDER" ? 4 : 0) +
      (dataCard.scoringTrend === "down" && side === "OVER" ? 4 : 0) +
      (num(dataCard.lineSpread) >= 2.5 ? 3 : 0),
    0,
    15
  );

  const missingFlags = (dataCard.dataMissingFlags || []).filter((f) => f.missing);
  const missingDataPenalty = clamp(missingFlags.length * 3.5, 0, 30);

  const readerCaseBoost = chosenCase ? num(chosenCase.score) : 0;
  const readerConfidenceBoost = num(reader.readerConfidence) * 0.2;

  const componentSum =
    volumePathScore +
    roleScore +
    projectionScore +
    fairLineScore +
    marketScore +
    dataQualityScore +
    availabilityScore +
    gameContextScore;

  const rawTotal = readerCaseBoost + componentSum * 0.15 + readerConfidenceBoost;

  const finalBestPropScore = Number(
    (
      rawTotal -
      contradictionPenalty -
      volatilityPenalty -
      missingDataPenalty
    ).toFixed(2)
  );

  const whySide =
    side === "OVER"
      ? reader.whyOver || reader.supports || pick.support || []
      : reader.whyUnder || reader.supports || pick.support || [];

  return {
    bestPropScore: finalBestPropScore,
    finalBestPropScore,
    topPropScoreBreakdown: {
      volumePathScore,
      roleScore,
      projectionScore,
      fairLineScore,
      marketScore,
      dataQualityScore,
      availabilityScore,
      gameContextScore,
      contradictionPenalty,
      volatilityPenalty,
      missingDataPenalty,
      readerCaseBoost,
      readerConfidenceBoost,
      finalBestPropScore,
    },
    topPropScoreEngine: "wnba-v2-reader",
    whySide: Array.isArray(whySide) ? whySide.slice(0, 4) : [],
    missingDataWarnings: missingFlags.map((f) => f.note || f.key).slice(0, 6),
    readerDecision: reader.decision || pick.readerDecision,
    readerConfidence: reader.readerConfidence ?? pick.readerConfidence,
    dataConfidence: dataCard.dataConfidenceScore ?? pick.dataQuality,
  };
}
