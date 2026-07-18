/**
 * Canonical sealed CourtEdge prop record — produced after final pipeline:
 * projection → side selection → Side Rescue → same-team arbitration →
 * side-balance → Best 6 → Top → seal → Results tracking.
 *
 * Lab/History must consume this object rather than rebuilding from Board fields.
 */

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
    side,
    line: num(pick.officialLine ?? pick.line),
    finalProjection: num(
      pick.projection ?? pick.projectedPoints ?? pregame.projection
    ),
    confidence: num(pick.confidence ?? pick.winProbability),
    risk: first(di.trueRisk, pick.trueRisk, pick.riskLabel, "MEDIUM"),
    finalDecision: "TRACK",
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
      action: pick.sideRescue?.action || pick.sideRescueAction || null,
      explanation:
        pick.sideRescue?.simpleExplanation ||
        pick.sideRescueExplanation ||
        null,
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
    providerIdentity: pick.providerIdentity || null,
  };
}

export function attachCanonicalSealedProp(pick = {}, options = {}) {
  const canonical = buildCanonicalSealedProp(pick, options);
  return {
    ...pick,
    canonicalSealedProp: canonical,
    canonicalSealedPropVersion: CANONICAL_SEALED_PROP_VERSION,
    finalDecision: "TRACK",
    league: canonical.league,
  };
}
