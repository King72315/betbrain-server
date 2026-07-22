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
import { evaluateWnbaTrackingEligibility } from "./wnbaResultsQualityGate.js";
import {
  applyDecisionIntelligenceToPick,
  evaluatePropDecisionIntelligenceV1,
} from "../decisionIntelligence/propDecisionIntelligenceV1.js";
import {
  applySideRescueToPick,
  evaluateSideRescue,
  SIDE_RESCUE_VERSION,
} from "../decisionIntelligence/sideRescueEngineV1.js";
import { runFlipFirstDecisionPipeline } from "../decisionIntelligence/decisionDataIntelligenceV1.js";
import { finalizeCanonicalDecision } from "../decisionIntelligence/sideSelectionTrustV1.js";
import { syncWnbaDataModeOnPick } from "../wnba/wnbaGateInputs.js";
import { CONFIG } from "../../config.js";
import { buildWnbaPlayerPropDataCard } from "./wnbaPlayerPropDataCard.js";
import { readWnbaProp, mapReaderToTracking } from "./wnbaReaderEngine.js";
import {
  computeMultiComponentConfidence,
  confidenceEngineDirectionalDelta,
  getHistoricalAccuracyForPlayer,
  getLearnedCalibrationForProfile,
} from "./playerIntelligence/index.js";
import { buildCourtEdgePlayerEvidenceV1 } from "../../services/courtEdgePlayerEvidenceV1.js";
import { attachHomeDetailedAnalysisV1 } from "../../services/courtEdgeHomeDetailedAnalysisV1.js";
import { buildProviderIdentity } from "../../services/providerIdentityLayer.js";
import {
  attachCourtEdgeEngineSignals,
  applyEngineSignalAdjustments,
  isEngineExpansionEnabled,
} from "../../services/courtEdgeEngineSignalsV1.js";
import { AVAILABILITY_STATE } from "../courtEdgeExpansion/availabilityRosterEngine.js";
import { PROVIDER_FALLBACK_POLICY } from "../../services/providerFallbackPolicy.js";

export const WNBA_ENGINE_HANDLED = "WNBA_V2";
const CONFIDENCE_BLEND_VERSION = "v2-data-directional-side-symmetry";
const CONFIDENCE_BLEND_FORMULA =
  "final=0.35*dataConfidence+0.65*directional; directional starts 0.7*reader+0.3*winProb then DDI";

function finalizeWnbaPickTracking(pick = {}, reader = {}) {
  const readerWantsOfficial = reader.decision === "OFFICIAL";
  const v1BlocksOfficial = pick.officialEligible === false;
  const readerOfficialDemoted =
    readerWantsOfficial &&
    (pick.trackingType === "TEST" || v1BlocksOfficial || !pick.v1OfficialGatePassed);

  if (!readerOfficialDemoted) {
    return pick;
  }

  const demotionReason =
    pick.officialDemotionReason ||
    pick.wnbaOfficialEligibility?.reasons?.join("; ") ||
    pick.trackingReason ||
    "WNBA v1 official gate failed";

  return {
    ...pick,
    trackingType: "TEST",
    recordType: "TEST",
    finalDecision: "TEST",
    sideSelectionDecision: "TEST",
    officialEligible: false,
    excludedFromOfficialRecord: true,
    readerOfficialDemoted: true,
    officialDemotionReason: demotionReason,
    officialEligibilityFailReason: demotionReason,
    readerOutcome: reader.decision,
    readerDecision: reader.decision,
    trackingReason: demotionReason,
    testReasons: pick.wnbaOfficialEligibility?.reasons || pick.testReasons || [],
    testReason: demotionReason,
    v1OfficialGatePassed: false,
  };
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return raw;
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
      matchupGames,
    }
  );

  const identity = buildProviderIdentity({
    playerName,
    team,
    opponent,
    league: "WNBA",
    oddsEventId: game.gameId || game.id || null,
    bdlPlayerId: playerState?.playerId || dataCard?.playerId || null,
  });

  const playerEvidence =
    CONFIG.COURTEDGE_EVIDENCE_V1_ENABLED !== false
      ? buildCourtEdgePlayerEvidenceV1({
          league: "WNBA",
          playerName,
          team,
          opponent,
          playerId: identity.bdlPlayerId,
          wnbaPlayerId: identity.bdlPlayerId,
          game,
          gameId: game.gameId || game.id,
          slateDate: game.date,
          commenceTime: game.commenceTime || game.time,
          prop,
          line: prop.line,
          last5,
          bdlSeasonGames,
          seasonAverage,
          matchupGames,
          opportunity,
          availabilityGate,
          defenseResult,
          wnbaGameContext,
          marketSnapshot,
          playerState,
          dataCard,
          identity,
          projection: dataCard.projection?.projection,
          projectionResult: dataCard.projection,
          fairLine: dataCard.fairLine,
          sportsProjection: null,
          roleTrend: dataCard.roleTrend,
          volumeProfile,
          playerRoleProfile: dataCard.playerRoleProfile,
          teammateUsageShift: dataCard.teammateUsageShift,
          bookCount: prop.bookCount,
          blowoutRisk,
        })
      : null;

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

  const readerConfidence = reader.readerConfidence;
  const winProbability = num(
    bestPick.rawWinProbability ?? bestPick.winProbability
  );
  const dataConfidence = clamp(num(dataCard.dataConfidenceScore, 55), 0, 100);
  // Directional starts from reader/win blend; final recalculated after Flip-First/DDI.
  const directionalConfidenceBeforeDdi = clamp(
    Math.round(readerConfidence * 0.7 + winProbability * 0.3),
    12,
    92
  );
  const profileConfAdj = num(
    dataCard.playerProfileCalibration?.confidenceAdjustment,
    0
  );
  const confidenceBeforeProfile = clamp(
    Math.round(directionalConfidenceBeforeDdi + profileConfAdj),
    12,
    92
  );

  // Phase 3 — multi-component confidence (not gap-primary). Soft influence only.
  const intelProfile =
    dataCard.playerIntelligenceProfile ||
    dataCard.playerRoleProfile?.playerIntelligence ||
    dataCard.playerRoleProfile ||
    {};
  const multiConfidence = computeMultiComponentConfidence({
    profile: intelProfile,
    projectionGap: null, // deliberately unused as primary driver
    dataConfidence,
    historicalAccuracy:
      getHistoricalAccuracyForPlayer(dataCard.playerId) ||
      getLearnedCalibrationForProfile(intelProfile) ||
      {},
    market: {
      marketQuality: prop.marketQuality ?? dataCard.marketQuality,
    },
    sameTeamOpportunity: {},
    decisionDataIntelligence: {},
    recentCalibration: getLearnedCalibrationForProfile(intelProfile) || {},
    side: pickSide,
    priorRawConfidence: confidenceBeforeProfile,
  });
  const confPull = confidenceEngineDirectionalDelta(
    { finalConfidence: multiConfidence.finalConfidence },
    confidenceBeforeProfile
  );
  let directionalConfidence = confPull.after;
  let finalConfidence = clamp(
    Math.round(dataConfidence * 0.35 + directionalConfidence * 0.65),
    12,
    92
  );

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
    rawConfidenceBeforeReliability: finalConfidence,
    evidenceReliability: num(dataCard.dataConfidenceScore) / 100,
    dangerPressure: reader.disagrees.length * 0.05,
    readerConfidence,
    winProbability,
    dataConfidence,
    directionalConfidence,
    finalConfidence,
    confidenceBlendVersion: "v3-multi-component-player-intel",
    confidenceBlendFormula:
      "final=0.35*data+0.65*directional; directional=reader/win + profileAdj + multiComponent soft pull (gap not primary); then DDI",
    multiComponentConfidence: multiConfidence,
    confidenceComponents: multiConfidence.components,
    confidence: finalConfidence,
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
    providerIdentity: identity,
    courtEdgePlayerEvidence: playerEvidence,
    courtEdgePlayerEvidenceVersion: playerEvidence?.schemaVersion || null,
    providerFallbackPolicyVersion: PROVIDER_FALLBACK_POLICY.version,
    dataMode: playerState.dataMode,
    snapshotId: marketSnapshot.snapshotId,
    snapshotTime: marketSnapshot.snapshotTime,
    openingLine: marketSnapshot.openingLine,
    currentLine: marketSnapshot.currentLine,
    lineDelta: marketIntelligence.lineDelta,
    ...fairLine,
    wnbaDataCard: dataCard,
    dataIntegrity: dataCard.dataIntegrity,
    dataIntegrityVersion: dataCard.dataIntegrityVersion,
    dataIntegrityOverall: dataCard.dataIntegrityOverall,
    dataIntegrityCompact: dataCard.dataIntegrityCompact,
    playerRoleProfile: dataCard.playerRoleProfile || null,
    playerProfileCalibration: dataCard.playerProfileCalibration || null,
    playerRoleProfileAudit: dataCard.playerRoleProfileAudit || null,
    projectionBeforeProfileCalibration:
      dataCard.playerRoleProfileAudit?.projectionBeforeProfileCalibration ??
      dataCard.projection?.projectionBeforeProfileCalibration ??
      null,
    projectionAfterProfileCalibration:
      dataCard.playerRoleProfileAudit?.projectionAfterProfileCalibration ??
      dataCard.projection?.projectionAfterProfileCalibration ??
      projection,
    profileProjectionDelta:
      dataCard.playerRoleProfileAudit?.profileProjectionDelta ??
      dataCard.projection?.profileProjectionDelta ??
      null,
    profileDebtIds: dataCard.playerProfileCalibration?.riskDebtIds || [],
    profileRepairIds: dataCard.playerProfileCalibration?.riskRepairIds || [],
    profileCalibrationApplied: Boolean(
      dataCard.playerProfileCalibration?.profileCalibrationApplied
    ),
    profileCalibrationReasons:
      dataCard.playerProfileCalibration?.calibrationReasons || [],
    confidenceBeforeProfileCalibration: confidenceBeforeProfile,
    confidenceAfterProfileCalibration: finalConfidence,
    wnbaReader: reader,
    underGap: reader.underGap,
    underGapFloorUsed: reader.underGapFloorUsed,
    underGapFloorPassed: reader.underGapFloorPassed,
    limitedDataUnderPenaltyApplied: reader.limitedDataUnderPenaltyApplied,
    lineToRecentAvgRatio: dataCard.lineToRecentAvgRatio,
    lineToSeasonAvgRatio: dataCard.lineToSeasonAvgRatio,
    absoluteLineBucket: dataCard.absoluteLineBucket,
    playerContextLineBucket: dataCard.playerContextLineBucket,
    reasons: reader.supports.slice(0, 6),
    risks: reader.disagrees.slice(0, 5),
    ...tracking,
    sideSelectionDecision: tracking.finalDecision,
    readerDecision: reader.decision,
    readerConfidence: reader.readerConfidence,
    readerReasonCodes: reader.reasonCodes,
  };

  const softBoardCodes = (reader.reasonCodes || []).some((c) =>
    /GAP_FLOOR_BOARD_SOFT_PICK|BOTH_SIDES_GAP_FLOOR_FAIL_SOFT|INSUFFICIENT_EDGE_SOFT|READER_TEST_PLAY|THIN_OVER_GAP|THIN_UNDER_GAP/.test(
      String(c || "")
    )
  );
  if (softBoardCodes || reader.decision === "TEST") {
    pick.weakButPlayable = true;
  }

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

  pick = finalizeWnbaPickTracking(pick, reader);

  pick.initialSide = pickSide;
  pick.defenseResult = defenseResult;
  pick.wnbaGameContext = pickGameContext;
  pick = syncWnbaDataModeOnPick(pick, dataCard, reader);
  pick = runFlipFirstDecisionPipeline(pick, {
    dataCard,
    reader,
    originalSide: pickSide,
    teamCandidates: context.teamCandidates,
    slateCandidates: context.slateCandidates,
    impliedTeamTotal: pickGameContext?.impliedTeamTotal,
    last5,
    matchupGames,
  });
  // Flip-First / DDI now owns confidence blend (data vs directional).
  if (pick.finalConfidence != null) {
    finalConfidence = num(pick.finalConfidence, finalConfidence);
    directionalConfidence = num(pick.directionalConfidence, directionalConfidence);
    pick.confidence = finalConfidence;
    pick.finalConfidence = finalConfidence;
    pick.directionalConfidence = directionalConfidence;
    pick.dataConfidence = num(pick.dataConfidence, dataConfidence);
  }
  pick.last5 = last5;
  pick.matchupGames = matchupGames;
  // Persist season logs so sanitize/hydrate rebuilds can recover L10 without re-fetch.
  pick.bdlSeasonGames = bdlSeasonGames;
  pick.seasonGames = bdlSeasonGames;

  const qualityGate = evaluateWnbaTrackingEligibility(pick, dataCard, reader);
  const decisionIntelligence = evaluatePropDecisionIntelligenceV1(pick, {
    dataCard,
    reader,
    gate: qualityGate,
  });
  pick = applyDecisionIntelligenceToPick(pick, decisionIntelligence, qualityGate);

  const sideRescue = evaluateSideRescue(pick, {
    decisionIntelligence,
    gate: qualityGate,
    dataCard,
    reader,
    originalSide: pickSide,
  });
  pick = applySideRescueToPick(pick, sideRescue, { dataCard, reader });

  if (sideRescue.action === "FLIP_SIDE" && sideRescue.finalSide) {
    const flippedGate = evaluateWnbaTrackingEligibility(pick, dataCard, reader);
    const flippedDi = evaluatePropDecisionIntelligenceV1(pick, {
      dataCard,
      reader,
      gate: flippedGate,
    });
    pick = applyDecisionIntelligenceToPick(pick, flippedDi, flippedGate);
    pick = applySideRescueToPick(
      pick,
      { ...sideRescue, postFlipGate: flippedGate },
      { dataCard, reader }
    );
  }

  if (typeof applyPickFinishers === "function") {
    pick = applyPickFinishers(pick) || pick;
  }

  pick.readerSide = normalizeSide(reader.finalSide || pickSide);
  pick.currentSide = normalizeSide(pick.side || pick.pick);
  pick.finalSide = pick.currentSide;
  pick.originalModelSide =
    pick.originalModelSide || normalizeSide(pick.side || pickSide);

  if (isEngineExpansionEnabled()) {
    pick = attachCourtEdgeEngineSignals(pick, {
      league: "WNBA",
      playerId: identity.bdlPlayerId || dataCard?.playerId,
      teamId: identity.teamId || null,
      opponentId: identity.opponentId || null,
      gameId: game.gameId || game.id,
      organicModelSide: pick.originalModelSide,
      finalSide: pick.finalSide,
      projection,
      line: prop.line,
      openingLine: marketSnapshot.openingLine ?? pick.openingLine,
      selectedLine: prop.line,
      sealedLine: prop.line,
      currentLine: marketSnapshot.currentLine ?? prop.line,
      gameLogs: bdlSeasonGames,
      seasonAverage,
      last10: bdlSeasonGames.slice(0, 10),
      availabilityStatus:
        availabilityGate?.status ||
        availabilityGate?.level ||
        availabilityGate?.availabilityStatus ||
        null,
      injuryFeedOk: availabilityGate?.feedFetchOk !== false,
      injuryRow: availabilityGate?.injuryRow || null,
      propMarketActive: (prop.bookCount || 0) >= 1,
      bookCount: prop.bookCount,
      overOdds: prop.overOdds,
      underOdds: prop.underOdds,
      scoringEnvironmentProxy:
        defenseResult?.paceProxy ??
        defenseResult?.scoringEnvironmentProxy ??
        null,
      opponentDefenseContext: defenseResult,
      impliedTeamTotal: pickGameContext?.impliedTeamTotal,
      originalModelConfidence: pick.confidence,
      force: true,
    });
    pick = applyEngineSignalAdjustments(pick);

    const availState =
      pick.courtEdgeEngineSignalsV1?.availabilityRoster?.status ||
      pick.courtEdgeEngineSignalsV1?.engines?.availabilityRoster?.status;
    if (availState === AVAILABILITY_STATE.OUT) {
      return {
        accepted: false,
        engineHandled: WNBA_ENGINE_HANDLED,
        dataCard,
        reader,
        rejection: {
          player: playerName,
          line: prop.line,
          reason: "confirmed-out",
          details: ["AVAILABILITY_CONFIRMED_OUT_PRE_SEAL"],
        },
      };
    }
  }

  pick = finalizeCanonicalDecision(pick);
  // Defer Home Detailed Analysis to board sanitize / Best 6 stamp paths so
  // full-slate refresh does not OOM or exceed Render life during rebuild.
  // Analysis is still attached for selected cards via sanitizeHomeBoardForLifecycle.

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
