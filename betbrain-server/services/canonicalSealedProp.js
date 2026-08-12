/**
 * Canonical sealed CourtEdge prop record — produced after final pipeline:
 * projection → side selection → Side Rescue → same-team arbitration →
 * side-balance → Best 6 → Top → seal → Results tracking.
 *
 * Lab/History must consume this object rather than rebuilding from Board fields.
 */

import { attachHomeDetailedAnalysisV1 } from "./courtEdgeHomeDetailedAnalysisV1.js";
import { COURT_EDGE_SIDE_CALIBRATION_VERSION } from "./courtEdgeSideCalibrationV1.js";

export const CANONICAL_SEALED_PROP_VERSION = "canonical-sealed-prop-v1";

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

/**
 * Build the canonical object from a fully finalized Best 6 / sealed prop.
 */
export function buildCanonicalSealedProp(pick = {}, options = {}) {
  const slateDate = String(
    options.slateDate || pick.slateDate || pick.resultsSlateDate || ""
  ).slice(0, 10);
  const side = String(pick.lockedSide || pick.side || pick.pick || "")
    .toUpperCase()
    .startsWith("U")
    ? "UNDER"
    : "OVER";
  const pregame = pick.pregameSnapshot || {};
  const di = pick.decisionIntelligence || {};
  const signals = pick.signalSnapshot || pregame.signalSnapshot || {};
  const sameTeam =
    pick.sameTeamOpportunityV2 ||
    pick.sameTeamOpportunityAudit ||
    pregame.sameTeamOpportunity ||
    {};

  const propTypeRaw = String(
    pick.propType || pick.canonicalPropType || pick.stat || "POINTS"
  ).toUpperCase();
  const propType = /REBOUND/.test(propTypeRaw)
    ? "REBOUNDS"
    : /ASSIST/.test(propTypeRaw)
      ? "ASSISTS"
      : "POINTS";
  const statLabel =
    propType === "REBOUNDS"
      ? "Rebounds"
      : propType === "ASSISTS"
        ? "Assists"
        : "Points";

  return {
    schemaVersion: CANONICAL_SEALED_PROP_VERSION,
    officialPropId: pick.officialPropId || null,
    officialSlateId: pick.officialSlateId || slateDate || null,
    slateDate,
    player: pick.player || null,
    team: pick.team || pick.teamKey || null,
    opponent: pick.opponent || null,
    game: pick.game || pick.gameLabel || null,
    gameId: pick.gameId || null,
    league: String(pick.league || "WNBA").toUpperCase() === "NBA" ? "NBA" : "WNBA",
    propType,
    canonicalPropType: propType,
    stat: pick.stat || statLabel,
    marketType: pick.marketType || pick.marketKey || null,
    side,
    line: num(pick.officialLine ?? pick.sealedLine ?? pick.selectedLine ?? pick.line),
    openingLine: num(
      pick.openingLine ?? pregame.marketBookData?.openingLine ?? pick.line
    ),
    selectedLine: num(pick.selectedLine ?? pick.officialLine ?? pick.line),
    sealedLine: num(
      pick.sealedLine ??
        pick.officialLine ??
        (pick.immutableOfficial ? pick.line : null)
    ),
    currentLine: num(pick.currentLine ?? pick.latestLine ?? pick.line),
    lineSource: pick.lineSource || "odds-consensus",
    lineCapturedAt: pick.lineCapturedAt || pick.snapshotTime || null,
    sealedAt: pick.sealedAt || pick.officialSealedAt || null,
    lineMovement: num(pick.lineMovement),
    finalProjection: num(
      pick.projection ?? pick.projectedPoints ?? pregame.projection
    ),
    originalProjection: num(pick.originalProjection ?? pick.projection),
    confidence: num(pick.confidence ?? pick.winProbability),
    originalModelConfidence: num(
      pick.originalModelConfidence ??
        pick.sameTeamArbitration?.originalModelConfidence
    ),
    risk: first(pick.c2Risk, pick.trueRisk, pick.riskLabel, di.trueRisk, "MEDIUM"),
    finalDecision:
      pick.officialSelected === true || pick.trackingType === "OFFICIAL"
        ? "OFFICIAL"
        : "RESEARCH",
    naturalDecision: first(
      pick.naturalDecision,
      di.naturalDecision,
      di.originalGateEligibility
    ),
    bestSixRank: num(pick.controlledBestSixRank ?? pick.bestSixRank),
    topPickRank: num(pick.topPickRank),
    isTopPick: Boolean(pick.isTopPick || pick.topPickRank),
    sameTeamArbitration: {
      flipped: Boolean(
        pick.sameTeamArbitrationFlip ||
          sameTeam.role === "SECONDARY_UNDER" ||
          pick.flipReasonCode === "SAME_TEAM_ARBITRATION_FLIP"
      ),
      reason:
        pick.sameTeamArbitrationReason ||
        pick.flipReasonCode ||
        (sameTeam.role === "SECONDARY_UNDER"
          ? "SAME_TEAM_ARBITRATION_FLIP"
          : null),
      role: sameTeam.role || null,
      primaryPlayer: sameTeam.primaryPlayer || null,
      independentlyQualifiedUnder: sameTeam.independentlyQualifiedUnder ?? null,
      originalModelSide:
        pick.originalModelSide ||
        pick.sameTeamArbitration?.originalModelSide ||
        null,
      finalSide: side,
      organicUnderEvidence:
        pick.sameTeamArbitration?.organicUnderEvidence || null,
      conflictScore: pick.sameTeamArbitration?.conflictScore ?? null,
    },
    originalModelSide:
      pick.originalModelSide ||
      pick.sameTeamArbitration?.originalModelSide ||
      null,
    finalCourtEdgeSide: side,
    originalModelConfidence: num(
      pick.originalModelConfidence ??
        pick.sameTeamArbitration?.originalModelConfidence
    ),
    sideRescue: {
      action: null,
      productionAuthority: false,
      skippedReason:
        pick.sideRescue?.skippedReason || "NO_PRODUCTION_RESCUE_AUTHORITY",
      explanation: null,
    },
    signals: {
      usage: signals.usage || pick.usageSignal || null,
      market: signals.market || pick.marketSignal || null,
      availability: signals.availability || pick.availabilitySignal || null,
      opponentDefense:
        signals.opponentDefense || pick.opponentDefenseSignal || null,
      matchupHistory: signals.matchupHistory || pick.matchupHistorySignal || null,
    },
    volume: {
      expectedMinutes: num(pick.expectedMinutes ?? pregame.expectedMinutes),
      expectedFGA: num(pick.expectedFGA ?? pregame.expectedFGA),
      expectedFTA: num(pick.expectedFTA ?? pregame.expectedFTA),
    },
    dataMode: pick.dataMode || pick.wnbaDataMode || null,
    providerHealth: pick.providerHealth || pick.sourceHealth || null,
    reasons: pick.whySide || pick.support || [],
    contradictions: pick.resistance || pick.contradictions || [],
    trackingTimestamp:
      pick.officialSealedAt || pick.trackedAt || options.sealedAt || null,
    commenceTime: pick.commenceTime || pick.time || null,
    grading: {
      status: pick.status || null,
      result: pick.result || null,
      actualPoints: pick.actualStat ?? pick.actualPoints ?? null,
      gradedAt: pick.gradedAt || null,
      lastResolveAttempt: pick.lastResolveAttempt || null,
      lastResolveError: pick.lastResolveError || null,
    },
    lifecycle: {
      immutableOfficial: pick.immutableOfficial === true,
      slateLocked: pick.slateLocked === true,
      resultsTracked: pick.resultsTracked !== false,
      phase: pick.lifecyclePhase || null,
    },
    pregameSnapshot: pick.pregameSnapshot || null,
    courtEdgePlayerEvidence:
      pick.courtEdgePlayerEvidence ||
      pick.canonicalSealedProp?.courtEdgePlayerEvidence ||
      null,
    courtEdgePlayerEvidenceVersion:
      pick.courtEdgePlayerEvidenceVersion ||
      pick.courtEdgePlayerEvidence?.schemaVersion ||
      null,
    courtEdgeEngineSignalsV1:
      pick.courtEdgeEngineSignalsV1 ||
      pick.courtEdgeEngineSignals ||
      pick.canonicalSealedProp?.courtEdgeEngineSignalsV1 ||
      null,
    courtEdgeEngineSignalsVersion:
      pick.courtEdgeEngineSignalsVersion ||
      pick.courtEdgeEngineSignalsV1?.version ||
      pick.courtEdgeEngineSignals?.version ||
      null,
    courtEdgeDecisionPacketV1:
      pick.courtEdgeDecisionPacketV1 ||
      pick.decisionPacket ||
      pick.canonicalSealedProp?.courtEdgeDecisionPacketV1 ||
      null,
    // Nested engineSignals alias for product schema consumers
    engineSignals:
      pick.courtEdgeEngineSignalsV1 ||
      pick.courtEdgeEngineSignals ||
      pick.canonicalSealedProp?.engineSignals ||
      null,
    providerIdentity: pick.providerIdentity || null,
    homeDetailedAnalysisV1:
      pick.homeDetailedAnalysisV1 ||
      pick.canonicalSealedProp?.homeDetailedAnalysisV1 ||
      null,
    homeDetailedAnalysisVersion:
      pick.homeDetailedAnalysisVersion ||
      pick.homeDetailedAnalysisV1?.schemaVersion ||
      null,
    courtEdgeSideCalibrationVersion:
      pick.courtEdgeSideCalibrationVersion ||
      COURT_EDGE_SIDE_CALIBRATION_VERSION,
  };
}

export function attachCanonicalSealedProp(pick = {}, options = {}) {
  const withAnalysis = attachHomeDetailedAnalysisV1(pick, {
    ...options,
    sealed: true,
    rebuildSealed: options.forceAnalysis === true,
  });
  const canonical = buildCanonicalSealedProp(withAnalysis, options);
  return {
    ...withAnalysis,
    canonicalSealedProp: canonical,
    canonicalSealedPropVersion: CANONICAL_SEALED_PROP_VERSION,
    finalDecision:
      withAnalysis.officialSelected === true ||
      withAnalysis.trackingType === "OFFICIAL"
        ? "OFFICIAL"
        : "RESEARCH",
    league: canonical.league,
  };
}
