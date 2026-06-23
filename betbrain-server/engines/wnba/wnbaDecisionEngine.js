/**
 * WNBA v2 decision orchestrator: data card → reader → pick output.
 * NBA path in server.js must not use this module.
 */
import { buildOpportunityScore } from "../opportunityEngine.js";
import { buildPlayerState } from "../playerStateBuilder.js";
import { buildRoleChange } from "../roleChangeEngine.js";
import { buildVolumeProfile } from "../volumeProfileEngine.js";
import { buildFairLine } from "../fairLineEngine.js";
import { buildMarketIntelligence } from "../marketIntelligenceEngine.js";
import { evaluateVolumeDangerGates } from "../volumeDangerGatesEngine.js";
import { buildWinProbability } from "../winProbabilityEngine.js";
import { compareOverUnderRisk } from "../riskComparisonEngine.js";
import { mergeIntelligenceIntoRiskComparison } from "../scoreLedgerEngine.js";
import { buildScoreLedger } from "../scoreLedgerEngine.js";
import { applyWnbaOfficialV1Rules } from "../wnbaOfficialEngine.js";
import { CONFIG } from "../../config.js";
import { buildWnbaPlayerPropDataCard } from "./wnbaPlayerPropDataCard.js";
import { readWnbaProp, mapReaderToTracking } from "./wnbaReaderEngine.js";

export const WNBA_ENGINE_HANDLED = "WNBA_V2";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getRiskLabel(chosenRisk) {
  if (chosenRisk <= 32) return "Low Risk";
  if (chosenRisk <= 48) return "Medium Risk";
  return "High Risk";
}

function getSignalStrength(netEdge, dataQuality) {
  if (dataQuality >= 75 && netEdge >= 12) return "STRONG";
  if (dataQuality >= 55 && netEdge >= 6) return "MODERATE";
  return "WEAK";
}

function getDataQuality(opportunity = {}, prop = {}, last5 = []) {
  const base = num(opportunity.dataCoverage ?? opportunity.rawQuality, 50);
  const market = num(prop.marketQuality, 50);
  const last5Boost = last5.length >= 5 ? 10 : last5.length >= 3 ? 5 : 0;
  return clamp(Math.round(base * 0.6 + market * 0.25 + last5Boost), 20, 95);
}

export async function evaluateWnbaPropDecision(context = {}) {
  const {
    playerName,
    team,
    opponent,
    game,
    prop,
    last5 = [],
    bdlSeasonGames = [],
    seasonAverage = 0,
    matchupGames = [],
    opponentMatchup = {},
    blowoutRisk = 50,
    wnbaGameContext = null,
    availabilityGate = {},
    defenseResult = {},
    marketSnapshot = {},
    playoff = {},
    applyPickFinishers = null,
  } = context;

  const baseOpportunity = buildOpportunityScore({
    last5,
    projection: { Points: seasonAverage },
    seasonAverage,
    isPlayoff: true,
    league: "WNBA",
  });

  const opportunity = {
    ...baseOpportunity,
    usageBoost: { confidenceBoost: 0, projectionBoost: 0, reasons: [] },
  };

  const playerState = buildPlayerState({
    playerName,
    league: "WNBA",
    team,
    opponent,
    gameDate: game.date,
    commenceTime: game.commenceTime || game.time,
    prop,
    last5,
    bdlSeasonGames,
    seasonAverage,
    sportsProjection: 0,
    matchupGames,
    opportunity,
  });

  const roleChange = buildRoleChange(playerState, null);
  const volumeProfile = buildVolumeProfile({
    playerState,
    opportunity,
    roleChange,
    league: "WNBA",
  });

  const dataCard = await buildWnbaPlayerPropDataCard(
    {},
    {
      playerName,
      team,
      opponent,
      prop,
      game,
      last5,
      bdlSeasonGames,
      seasonAverage,
      playerState,
      roleChange,
      volumeProfile,
      availabilityGate,
      defenseResult,
      wnbaGameContext,
      marketSnapshot,
      marketIntelligence: {},
      opportunity,
    }
  );

  const projection = dataCard.projection?.projection || 0;
  const reader = readWnbaProp(dataCard);

  if (reader.decision === "NO_BET" || !reader.finalSide) {
    return {
      accepted: false,
      engineHandled: WNBA_ENGINE_HANDLED,
      dataCard,
      reader,
      rejection: {
        player: playerName,
        line: prop.line,
        reason: "no-play",
        details: reader.disagrees.length
          ? reader.disagrees
          : reader.reasonCodes,
      },
    };
  }

  const pickSide = reader.finalSide;
  const sideLabel = pickSide === "OVER" ? "Over" : "Under";
  const dataQuality = getDataQuality(opportunity, prop, last5);

  const overPick = buildWinProbability({
    player: playerName,
    team,
    opponent,
    game: game.game,
    line: prop.line,
    side: "Over",
    seasonAverage,
    sportsProjection: projection,
    last5,
    matchupGames,
    opportunity,
    playoff,
    opponentMatchup,
    overOdds: prop.overOdds,
    underOdds: prop.underOdds,
  });

  const underPick = buildWinProbability({
    player: playerName,
    team,
    opponent,
    game: game.game,
    line: prop.line,
    side: "Under",
    seasonAverage,
    sportsProjection: projection,
    last5,
    matchupGames,
    opportunity,
    playoff,
    opponentMatchup,
    overOdds: prop.overOdds,
    underOdds: prop.underOdds,
  });

  let riskComparison = compareOverUnderRisk({
    playerName,
    line: prop.line,
    projection,
    seasonAvg: seasonAverage,
    last5Avg: overPick.last5Average,
    minutesAvg: opportunity.recentMinutes,
    fgaAvg: opportunity.recentFGA,
    ftaAvg: opportunity.recentFTA,
    usageScore: 50,
    opportunityScore: opportunity.opportunityScore,
    matchupScore: overPick.matchupHitRate || 50,
    defenseScore: defenseResult.defenseScore,
    roleCertainty: opportunity.roleCertainty || 50,
    blowoutRisk,
    dataQuality,
    rawQuality: opportunity.rawQuality,
    dataCoverage: opportunity.dataCoverage,
    marketQuality: prop.marketQuality,
  });

  riskComparison = {
    ...riskComparison,
    pickSide,
  };

  const marketIntelligence = buildMarketIntelligence({
    prop,
    marketSnapshot,
    side: pickSide,
    volumeProfile,
  });

  const volumeDangerGates = evaluateVolumeDangerGates({
    volumeProfile,
    side: pickSide,
    league: "WNBA",
    opportunity,
  });

  riskComparison = mergeIntelligenceIntoRiskComparison(riskComparison, {
    volumeDangerGates,
    marketIntelligence,
    availabilityGate,
    pickSide,
  });

  const fairLine = dataCard.fairLine ||
    buildFairLine({ playerState: { ...playerState, sportsProjection: projection }, roleChange, prop });

  let bestPick = pickSide === "OVER" ? overPick : underPick;
  const netEdge = reader.overCase && reader.underCase
    ? Math.abs(num(reader.overCase.score) - num(reader.underCase.score))
    : num(riskComparison.netEdge);

  const signalStrength = getSignalStrength(netEdge, dataQuality);
  const chosenRisk = pickSide === "OVER"
    ? num(riskComparison.overRisk, 55)
    : num(riskComparison.underRisk, 55);
  const riskLabel = getRiskLabel(chosenRisk);

  const rawConfidence = clamp(
    Math.round(reader.readerConfidence * 0.7 + num(bestPick.rawWinProbability) * 0.3),
    30,
    92
  );
  const finalConfidence = rawConfidence;

  let tier = "LEAN";
  if (finalConfidence >= 75 && reader.decision === "OFFICIAL") tier = "PREMIUM";
  else if (finalConfidence >= 60) tier = "WATCHLIST";

  const tracking = mapReaderToTracking(reader, {
    league: "WNBA",
    tier,
    line: prop.line,
    projection,
    confidence: finalConfidence,
    riskLabel,
    bookCount: prop.bookCount,
    marketQuality: prop.marketQuality,
    volumeProfile,
    dataMode: playerState.dataMode,
  });

  let pick = {
    ...bestPick,
    league: "WNBA",
    engineHandled: WNBA_ENGINE_HANDLED,
    gameId: game.gameId || game.id,
    gameDate: game.date,
    commenceTime: game.commenceTime || game.time,
    date: game.date,
    dateLabel: game.dateLabel,
    dayBucket: game.dayBucket || "",
    game: game.game,
    pick: sideLabel,
    side: sideLabel,
    projection,
    recentMinutes: opportunity.recentMinutes,
    recentFGA: opportunity.recentFGA,
    recentFTA: opportunity.recentFTA,
    minutesAverage: opportunity.recentMinutes,
    fgaAverage: opportunity.recentFGA,
    ftaAverage: opportunity.recentFTA,
    opportunityScore: opportunity.opportunityScore,
    dataCoverage: opportunity.dataCoverage,
    rawConfidenceBeforeReliability: rawConfidence,
    evidenceReliability: num(dataCard.dataConfidenceScore) / 100,
    dangerPressure: reader.disagrees.length * 0.05,
    finalConfidence,
    confidence: finalConfidence,
    winProbability: finalConfidence,
    strength: finalConfidence >= 75 ? "Strong" : finalConfidence >= 60 ? "Moderate" : "Lean",
    tier,
    tierReasons: [`WNBA v2 reader decision: ${reader.decision}`],
    riskLabel,
    overRisk: riskComparison.overRisk,
    underRisk: riskComparison.underRisk,
    chosenRisk,
    riskGap: riskComparison.riskGap,
    support: reader.supports,
    resistance: reader.disagrees,
    supportScore: pickSide === "OVER"
      ? num(reader.overCase?.score)
      : num(reader.underCase?.score),
    resistanceScore: pickSide === "OVER"
      ? num(reader.underCase?.score)
      : num(reader.overCase?.score),
    netEdge,
    signalStrength,
    totalEvidence: num(
      pickSide === "OVER" ? reader.overCase?.score : reader.underCase?.score,
      netEdge
    ),
    sportsbookLine: prop.line,
    overOdds: prop.overOdds,
    underOdds: prop.underOdds,
    bookCount: prop.bookCount,
    consensusBookCount: prop.consensusBookCount,
    overBookCount: prop.overBookCount,
    underBookCount: prop.underBookCount,
    lineSpread: prop.lineSpread,
    consensusLine: prop.consensusLine,
    hasBothSides: prop.hasBothSides,
    marketQuality: prop.marketQuality,
    marketGrade: prop.marketGrade,
    marketStrengths: prop.marketStrengths,
    marketWarnings: prop.marketWarnings,
    dataQuality,
    playerState,
    roleChange,
    volumeProfile,
    volumeDangerGates,
    marketIntelligence,
    availabilityGate,
    defenseResult,
    dataMode: playerState.dataMode,
    snapshotId: marketSnapshot.snapshotId,
    snapshotTime: marketSnapshot.snapshotTime,
    openingLine: marketSnapshot.openingLine,
    currentLine: marketSnapshot.currentLine,
    lineDelta: marketIntelligence.lineDelta,
    ...fairLine,
    wnbaDataCard: dataCard,
    wnbaReader: reader,
    reasons: reader.supports.slice(0, 6),
    risks: reader.disagrees.slice(0, 5),
    ...tracking,
    sideSelectionDecision: tracking.finalDecision,
    readerDecision: reader.decision,
    readerConfidence: reader.readerConfidence,
    readerReasonCodes: reader.reasonCodes,
  };

  pick.scoreLedger = buildScoreLedger({
    side: pick.side,
    projection,
    line: prop.line,
    seasonAverage,
    last5Average: bestPick.last5Average,
    fairLine: pick.fairLine,
    fairLineEdge: pick.fairLineEdge,
    volumeProfile,
    volumeDangerGates,
    marketIntelligence,
    availabilityGate,
    defenseResult,
    opportunity,
    riskComparison,
    dataQuality,
  });

  const pickGameContext = wnbaGameContext
    ? { ...wnbaGameContext, playerTeam: team }
  : null;

  pick = applyWnbaOfficialV1Rules(pick, {
    availabilityGate,
    defenseResult,
    wnbaGameContext: pickGameContext,
  });

  if (typeof applyPickFinishers === "function") {
    pick = applyPickFinishers(pick) || pick;
  }

  return {
    accepted: true,
    engineHandled: WNBA_ENGINE_HANDLED,
    dataCard,
    reader,
    pick,
    pickSide,
  };
}

export function isCourteEdgeWnbaV2Enabled() {
  return CONFIG.COURTEDGE_WNBA_V2 !== false;
}
