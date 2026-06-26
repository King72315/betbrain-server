function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

export function isWnbaQualityGatePick(pick = {}) {
  if (String(pick.league || "").toUpperCase() !== "WNBA") return false;
  return Boolean(pick.wnbaDataCard || pick.wnbaReader);
}

export function resolveQualityGateInputs(pick = {}, dataCard = null, reader = null) {
  const card = dataCard || pick.wnbaDataCard || {};
  const rd = reader || pick.wnbaReader || {};
  const side = normalizeSide(pick.side || pick.pick || rd.finalSide);
  const line = num(pick.line ?? pick.sportsbookLine ?? card.bookLine ?? card.currentLine);
  const projection = num(
    pick.projection ?? card.projection?.projection ?? pick.expectedPoints
  );
  const projectionGap = side === "OVER" ? projection - line : line - projection;
  const dataMode = String(pick.dataMode || card.dataMode || "").toUpperCase();
  const minutes = num(
    pick.recentMinutes ?? card.last5?.minutes ?? pick.minutesAverage
  );
  const fga = num(pick.recentFGA ?? card.last5?.fga ?? pick.fgaAverage);
  const bookCount = num(pick.bookCount ?? card.bookCount);
  const marketQuality = num(pick.marketQuality ?? card.marketQuality);
  const dataConfidence = num(
    pick.evidenceReliability != null
      ? pick.evidenceReliability * 100
      : pick.dataCoverage ?? card.dataConfidenceScore
  );
  const fairLine = pick.fairLine ?? card.fairLine ?? {};
  const fairLineEdge = num(pick.fairLineEdge ?? fairLine.fairLineEdge);
  const fairLineQuality = num(pick.fairLineQuality ?? fairLine.fairLineQuality);
  const fairLineSide = normalizeSide(pick.fairLineSide ?? fairLine.fairLineSide);
  const underGap = num(
    rd.underGap ?? pick.underGap ?? (side === "UNDER" ? projectionGap : 0)
  );
  const roleTrend = String(
    pick.roleTrend ?? card.roleTrend ?? pick.roleChange?.trend ?? "stable"
  ).toLowerCase();
  const volatility = String(
    pick.minutesVolatility ??
      card.minutesVolatility ??
      pick.volumeProfile?.minutesVolatility ??
      "stable"
  ).toLowerCase();
  const opportunityScore = num(pick.opportunityScore ?? card.opportunityScore);
  const readerDecision = String(
    pick.readerDecision ?? rd.decision ?? pick.trackingType ?? ""
  ).toUpperCase();
  const readerConfidence = num(pick.readerConfidence ?? rd.readerConfidence);
  const netEdge = num(
    pick.netEdge ??
      (rd.margin != null
        ? rd.margin
        : Math.abs(num(rd.overCase?.score) - num(rd.underCase?.score)))
  );
  const recent = num(card.last5?.points ?? pick.last5Average);
  const ptsPerFGA = num(card.last5?.ptsPerFGA);
  const seasonPtsPerFGA = num(card.season?.ptsPerFGA);
  const availability = card.injuryAvailability || pick.availabilityGate || {};
  const availabilityDataMissing =
    pick.availabilityDataMissing === true ||
    availability.availabilityDataMissing === true ||
    (availability.level === "UNKNOWN" && availability.availabilityDataMissing !== false);
  const defenseProxyUsed =
    pick.defenseProxyUsed === true ||
    card.opponentDefense?.proxyUsed === true ||
    String(card.opponentDefense?.label || "").toLowerCase() === "neutral";
  const missingFlags = (card.dataMissingFlags || pick.dataMissingFlags || []).filter(
    (f) => f?.missing
  );

  return {
    side,
    line,
    projection,
    projectionGap,
    dataMode,
    minutes,
    fga,
    bookCount,
    marketQuality,
    dataConfidence,
    fairLineEdge,
    fairLineQuality,
    fairLineSide,
    underGap,
    roleTrend,
    volatility,
    opportunityScore,
    readerDecision,
    readerConfidence,
    netEdge,
    recent,
    ptsPerFGA,
    seasonPtsPerFGA,
    availabilityDataMissing,
    defenseProxyUsed,
    missingFlags,
    card,
    reader: rd,
  };
}
