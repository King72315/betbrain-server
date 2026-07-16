/**
 * Complete immutable pregame packet for Official Lab learning.
 * Frozen at seal — never regenerated after games start.
 */
import { buildOfficialPropId } from "./officialSlateService.js";
import { CONTROLLED_BEST_SIX_VERSION } from "../engines/topProps/controlledBestSixSelector.js";

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER") || raw === "O") return "OVER";
  if (raw.startsWith("UNDER") || raw === "U") return "UNDER";
  return raw || null;
}

/**
 * Build the full pregame learning packet from a pick at seal time.
 */
export function buildCompletePregameSnapshot(pick = {}, options = {}) {
  const slateDate = String(options.slateDate || pick.slateDate || "");
  const line = num(pick.officialLine ?? pick.line ?? pick.currentLine ?? pick.sportsbookLine, 0);
  const side = normalizeSide(pick.side || pick.pick || pick.lockedSide || pick.currentEngineSide);
  const officialPropId =
    pick.officialPropId || buildOfficialPropId({ ...pick, line, side }, slateDate);
  const sealedAt = options.sealedAt || new Date().toISOString();

  const di = pick.decisionIntelligence || pick.sealedDecisionIntelligence || {};
  const sr = pick.sideRescue || pick.sealedSideRescue || {};
  const reader = pick.wnbaReader || pick.sealedWnbaReader || {};
  const ddi = pick.decisionDataIntelligence || {};
  const flip =
    pick.flipFirstDecision ||
    pick.sealedFlipFirst ||
    ddi.flipFirstDecision ||
    null;
  const profile =
    pick.playerRoleProfile ||
    pick.playerIntelligence ||
    pick.sealedPlayerProfile ||
    pick.playerProfileCalibration ||
    null;

  const rawProjection = num(
    pick.rawProjection ??
      pick.wnbaReader?.rawProjection ??
      pick.projectionBeforeProfileCalibration ??
      pick.projectedPoints ??
      pick.projection
  );
  const profileAdjustedProjection = num(
    pick.profileAdjustedProjection ??
      pick.projectionAfterProfileCalibration ??
      pick.projectedPoints ??
      pick.projection
  );
  const projection = profileAdjustedProjection ?? rawProjection;
  const fairLine = num(pick.fairLine);
  const projectionGap = num(
    pick.projectionEdge ?? pick.edge ?? pick.projectionGap ?? reader.overGap ?? reader.underGap
  );

  const confidenceTrail = {
    initial: num(pick.confidence ?? pick.winProbability),
    afterProfile: num(pick.confidenceAfterProfileCalibration),
    afterGate: num(pick.confidenceAfterGate ?? di.confidenceAfterGate),
    afterFlipFirst: num(pick.confidenceAfterFlipFirst ?? ddi.confidenceAfterFlipFirst),
    afterSideRescue: num(pick.confidenceAfterSideRescue),
    afterEvidenceFinal: num(
      pick.confidenceAfterEvidenceFinal ?? di.evidenceFinalConfidence ?? pick.confidence
    ),
    final: num(pick.confidence ?? pick.winProbability),
  };

  const profileObj =
    profile && typeof profile === "object"
      ? profile
      : profile
        ? { profileType: profile }
        : {};

  return {
    officialPropId,
    player: pick.player || null,
    team: pick.team || pick.teamKey || null,
    opponent: pick.opponent || null,
    league: pick.league || null,
    line,
    side,
    rank: pick.bestSixRank ?? pick.controlledBestSixRank ?? null,
    topPickRank: pick.topPickRank ?? null,
    isTopPick: Boolean(pick.topPickRank || pick.isTopPickReference),
    rawProjection,
    profileAdjustedProjection,
    projection,
    fairLine,
    projectionGap,
    expectedMinutes: num(pick.expectedMinutes ?? pick.playerState?.expectedMinutes),
    expectedFGA: num(pick.expectedFGA ?? pick.playerState?.expectedFGA),
    expectedFTA: num(pick.expectedFTA ?? pick.playerState?.expectedFTA),
    expectedUsage: num(pick.expectedUsage ?? pick.usageShare ?? profileObj.usageShare),
    playerIntelligenceProfile: profileObj,
    profileType: profileObj.profileType || profileObj.type || null,
    profileConfidence: num(profileObj.profileConfidence ?? profileObj.confidence),
    roleStability: num(
      profileObj.roleStability ??
        profileObj.roleStabilityScore ??
        pick.roleStabilityScore
    ),
    volumeStability: num(
      profileObj.volumeStability ??
        profileObj.volumeStabilityScore ??
        pick.volumeStabilityScore
    ),
    minutesStability: num(
      profileObj.minutesStability ??
        profileObj.minutesStabilityScore ??
        pick.minutesStabilityScore
    ),
    scoringVolatility: num(
      profileObj.scoringVariance ?? profileObj.volatility ?? profileObj.playerVolatility
    ),
    roleTrend: profileObj.roleTrend || null,
    readerEvidence: {
      finalSide: reader.finalSide || null,
      score: reader.score ?? reader.finalScore ?? null,
      overGap: reader.overGap ?? null,
      underGap: reader.underGap ?? null,
      thinGap: reader.thinGap ?? null,
      overCase: reader.overCase || null,
      underCase: reader.underCase || null,
      contradictions: reader.contradictions || pick.contradictions || [],
      confidence: num(reader.confidence ?? reader.readerConfidence),
    },
    flipFirst: {
      action: flip?.action || pick.flipFirstAction || null,
      reason: flip?.reason || flip?.primaryReason || null,
      score: num(flip?.score ?? flip?.flipScore),
      margin: num(flip?.margin ?? flip?.flipMargin),
      triggered: Boolean(
        pick.flipFirstFlipped ||
          String(flip?.action || pick.flipFirstAction || "").toUpperCase().includes("FLIP")
      ),
      blockedReason: flip?.blockedReason || flip?.blockReason || null,
      labels: pick.flipFirstLabels || ddi.compactLabels || null,
      raw: flip,
    },
    gate: {
      trackEligibility: di.trackEligibility || pick.trackingEligibility || null,
      gateReason: di.gateReason || pick.wnbaTrackingReason || null,
      gateVersion: pick.wnbaGateVersion || di.gateVersion || null,
      bestSixPromoted: Boolean(di.bestSixPromoted),
      promotionReasons: di.promotionReasons || [],
      dangerGateCount: num(di.dangerGateCount ?? pick.dangerGateCount),
      warnings: di.warnings || pick.trackingWarnings || [],
    },
    decisionIntelligence: {
      trueRisk: di.trueRisk || pick.trueRisk || pick.riskLabel || null,
      naturalDecision: di.naturalDecision || di.originalGateEligibility || null,
      riskDebts: di.riskDebts || [],
      riskRepairs: di.riskRepairs || [],
      demotionReasons: di.demotionReasons || [],
      killReasons: di.killReasons || [],
      simpleExplanation: di.simpleExplanation || null,
      dataMode: di.dataMode || pick.dataMode || null,
      version: di.version || pick.decisionIntelligenceVersion || null,
    },
    sideRescue: {
      action: sr.action || pick.sideRescueAction || null,
      explanation: sr.explanation || pick.sideRescueExplanation || null,
      finalSide: sr.finalSide || sr.side || null,
      version: sr.version || pick.sideRescueVersion || null,
      initialSide: pick.initialSide || sr.initialSide || null,
      flipped: Boolean(pick.sideRescueFlipped),
      raw: sr,
    },
    sameTeamOpportunity:
      pick.sameTeamOpportunity ||
      pick.sameTeamOpportunityAudit ||
      pick.slateCollisionAudit ||
      pick.slateCollision ||
      null,
    marketBookData: {
      bookCount: num(pick.bookCount ?? pick.marketBookCount),
      marketQuality: num(pick.marketQuality),
      openingLine: num(pick.openingLine ?? pick.lineHistory?.[0]?.line),
      lockLine: line,
      consensus: pick.consensus ?? null,
    },
    confidenceTrail,
    confidence: confidenceTrail.final,
    risk: di.trueRisk || pick.trueRisk || pick.riskLabel || null,
    naturalDecision:
      di.naturalDecision || di.originalGateEligibility || di.trackEligibility || null,
    safetyScore: num(pick.safetyScore ?? pick.topPickSafetyScore),
    bestPropScore: num(pick.bestPropScore ?? pick.pickScore),
    dataMode: di.dataMode || pick.dataMode || null,
    signalSnapshot: pick.signalSnapshot || pick.lockedSignalSnapshot || null,
    buildVersion: options.serverBuild || pick.serverBuild || null,
    engineVersions: {
      controlledBestSixVersion:
        pick.controlledBestSixVersion || CONTROLLED_BEST_SIX_VERSION,
      decisionIntelligenceVersion:
        di.version || pick.decisionIntelligenceVersion || null,
      sideRescueVersion: sr.version || pick.sideRescueVersion || null,
      decisionDataIntelligenceVersion:
        ddi.version || pick.decisionDataIntelligenceVersion || null,
      calibrationVersion:
        pick.calibrationVersion || profileObj.calibrationVersion || null,
      wnbaGateVersion: pick.wnbaGateVersion || null,
      labLearningVersion: null,
    },
    sealedAt,
  };
}
