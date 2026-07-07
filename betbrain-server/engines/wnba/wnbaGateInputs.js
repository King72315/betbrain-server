import {
  isWnbaFullDataMode,
  isWnbaLimitedDataMode,
  resolveWnbaGraduatedDataMode,
  resolveWnbaDataModeAudit,
  buildImpliedTeamTotalAudit,
  buildDefenseContextAudit,
} from "./wnbaGraduatedDataModeV1.js";

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
  const availability = card.injuryAvailability || pick.availabilityGate || {};
  const availabilityDataMissing =
    pick.availabilityDataMissing === true ||
    availability.availabilityDataMissing === true;
  const defenseResult = pick.defenseResult || {};
  const cardDefense = card.opponentDefense || {};
  const defenseAudit = buildDefenseContextAudit(defenseResult, cardDefense);
  const defenseProxyUsed =
    pick.defenseProxyUsed === true ||
    defenseAudit.proxyUsed === true;
  const missingFlags = (card.dataMissingFlags || pick.dataMissingFlags || []).filter(
    (f) => f?.missing
  );
  const league = String(pick.league || card.league || "").toUpperCase();
  const dataMode =
    league === "WNBA"
      ? resolveWnbaGraduatedDataMode({
          league,
          dataMissingFlags: card.dataMissingFlags || pick.dataMissingFlags || [],
          dataAvailabilityFlags: card.dataAvailabilityFlags || pick.dataAvailabilityFlags,
          playerId: card.playerId || pick.playerId || "",
          last5Count: num(card.last5?.games ?? card.last5?.pointsList?.length),
          seasonPoints: num(card.season?.points ?? pick.seasonAverage),
          recentMinutes: num(pick.recentMinutes ?? card.last5?.minutes ?? pick.minutesAverage),
          seasonMinutes: num(card.season?.minutes ?? pick.seasonMinutes),
          recentFGA: num(pick.recentFGA ?? card.last5?.fga ?? pick.fgaAverage),
          seasonFGA: num(card.season?.fga ?? pick.seasonFGA),
          bookCount: num(pick.bookCount ?? card.bookCount),
          projection: num(pick.projection ?? card.projection?.projection ?? pick.expectedPoints),
          availabilityDataMissing,
          defenseMissing: defenseProxyUsed,
          matchupMissing:
            num(card.matchupAverage ?? pick.matchupAverage) <= 0 &&
            !(card.matchupGames || pick.matchupGames || []).length,
        })
      : String(pick.dataMode || card.dataMode || "NBA_FULL_DATA").toUpperCase();
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

  return {
    side,
    line,
    projection,
    projectionGap,
    dataMode,
    minutesVolatility: volatility,
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
    defenseAudit,
    missingFlags,
    card,
    reader: rd,
  };
}

/** Propagate graduated dataMode from card/gate inputs onto pick surfaces. */
export function syncWnbaDataModeOnPick(pick = {}, dataCard = null, reader = null) {
  const card = dataCard || pick.wnbaDataCard || {};
  const rd = reader || pick.wnbaReader;
  const gateInputs = resolveQualityGateInputs(pick, card, rd);
  const dataModeAudit = resolveWnbaDataModeAudit({
    league: String(pick.league || card.league || "WNBA").toUpperCase(),
    dataMissingFlags: card.dataMissingFlags || pick.dataMissingFlags || [],
    dataAvailabilityFlags: card.dataAvailabilityFlags || pick.dataAvailabilityFlags,
    cardDataMode: card.dataMode,
    pickDataMode: pick.dataMode,
    volatility: gateInputs.volatility,
    side: gateInputs.side,
    playerId: card.playerId || pick.playerId || "",
    last5Count: num(card.last5?.games ?? card.last5?.pointsList?.length),
    seasonPoints: num(card.season?.points ?? pick.seasonAverage),
    recentMinutes: num(pick.recentMinutes ?? card.last5?.minutes ?? pick.minutesAverage),
    seasonMinutes: num(card.season?.minutes ?? pick.seasonMinutes),
    recentFGA: num(pick.recentFGA ?? card.last5?.fga ?? pick.fgaAverage),
    seasonFGA: num(card.season?.fga ?? pick.seasonFGA),
    bookCount: num(pick.bookCount ?? card.bookCount),
    projection: num(pick.projection ?? card.projection?.projection ?? pick.expectedPoints),
    availabilityDataMissing: gateInputs.availabilityDataMissing,
    defenseMissing: gateInputs.defenseProxyUsed,
    matchupMissing:
      num(card.matchupAverage ?? pick.matchupAverage) <= 0 &&
      !(card.matchupGames || pick.matchupGames || []).length,
  });

  const dataMode = dataModeAudit.resolvedDataMode;
  const limited = isWnbaLimitedDataMode(dataMode);
  const impliedTeamTotalAudit = buildImpliedTeamTotalAudit(pick, card);

  const playerState = pick.playerState
    ? {
        ...pick.playerState,
        dataMode,
        dataAvailabilityFlags:
          card.dataAvailabilityFlags || pick.playerState.dataAvailabilityFlags,
      }
    : pick.playerState;

  const volumeProfile = pick.volumeProfile
    ? { ...pick.volumeProfile, dataMode, wnbaLimitedData: limited }
    : pick.volumeProfile;

  const wnbaDataCard =
    card && Object.keys(card).length
      ? {
          ...card,
          dataMode,
          opponentDefense: {
            ...(card.opponentDefense || {}),
            score: gateInputs.defenseAudit?.resolvedDefenseScore ?? card.opponentDefense?.score,
            proxyUsed: gateInputs.defenseAudit?.proxyUsed ?? card.opponentDefense?.proxyUsed,
            defenseSource: gateInputs.defenseAudit?.defenseSource ?? card.opponentDefense?.defenseSource,
            opponentPPG: gateInputs.defenseAudit?.opponentPPG ?? card.opponentDefense?.opponentPPG,
          },
          gameEnvironment: {
            ...(card.gameEnvironment || {}),
            impliedTeamTotal:
              impliedTeamTotalAudit.value ?? card.gameEnvironment?.impliedTeamTotal ?? null,
          },
        }
      : pick.wnbaDataCard;

  return {
    ...pick,
    dataMode,
    playerState,
    volumeProfile,
    wnbaDataCard,
    wnbaDataModeAudit: dataModeAudit,
    impliedTeamTotalAudit,
    defenseAudit: gateInputs.defenseAudit,
    defenseProxyUsed: gateInputs.defenseProxyUsed,
  };
}
