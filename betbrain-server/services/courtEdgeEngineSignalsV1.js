/**
 * CourtEdge Engine Signals V1.1 — service-layer wiring for the engine
 * expansion module (betbrain-server/engines/courtEdgeExpansion).
 *
 * Consolidation rules:
 * - Enrich ctx from existing modules via legacyAdapters
 * - Attach versioned immutable decision packet once per evaluation
 * - applyEngineSignalAdjustments is idempotent
 * - Never changes side or line; never removes a pick from tracking
 * - Evidence dedup ledger is the only authoritative conf/risk contribution
 */
import { CONFIG } from "../config.js";
import { buildCourtEdgeEngineSignalsV1 } from "../engines/courtEdgeExpansion/orchestratorV1.js";
import { enrichCtxWithLegacyAdapters } from "../engines/courtEdgeExpansion/legacyAdaptersV1.js";
import {
  buildDecisionPacketV1,
  attachDecisionPacket,
  markDecisionPacketApplied,
  hasEngineSignalsAlreadyApplied,
  admitResultsFromDecisionPacket,
  assertDecisionPacketUnchanged,
  ENGINE_EXPANSION_BUILD,
} from "../engines/courtEdgeExpansion/decisionPacketV1.js";

export { buildCourtEdgeEngineSignalsV1 };
export { ENGINE_EXPANSION_BUILD };
export { admitResultsFromDecisionPacket, assertDecisionPacketUnchanged };
export { buildDecisionPacketV1 };

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function isEngineExpansionEnabled() {
  return CONFIG.COURTEDGE_ENGINE_EXPANSION_V1_ENABLED === true;
}

function buildContextFromPick(pick = {}, ctxOverrides = {}) {
  const card = pick.wnbaDataCard || {};
  const base = {
    league: first(ctxOverrides.league, pick.league, card.league),
    playerId: first(ctxOverrides.playerId, pick.playerId, pick.wnbaPlayerId),
    teamId: first(ctxOverrides.teamId, pick.teamId),
    opponentId: first(ctxOverrides.opponentId, pick.opponentId),
    gameId: first(ctxOverrides.gameId, pick.gameId, pick.game?.id),
    playerName: first(ctxOverrides.playerName, pick.playerName, pick.player),
    team: first(ctxOverrides.team, pick.team),
    opponent: first(ctxOverrides.opponent, pick.opponent),

    gameLogs: ctxOverrides.gameLogs || pick.gameLogs || pick.last10 || [],
    seasonAverage: first(ctxOverrides.seasonAverage, pick.seasonAverage),
    last10: ctxOverrides.last10 || pick.last10,
    roleGames: ctxOverrides.roleGames || pick.roleGames,
    projection: first(ctxOverrides.projection, pick.projection),
    line: first(ctxOverrides.line, pick.line, card.bookLine, card.currentLine),
    openingLine: first(ctxOverrides.openingLine, pick.openingLine, card.openingLine),
    selectedLine: first(ctxOverrides.selectedLine, pick.selectedLine),
    sealedLine: first(ctxOverrides.sealedLine, pick.sealedLine),
    currentLine: first(ctxOverrides.currentLine, pick.currentLine, card.currentLine),

    openingOverPrice: first(ctxOverrides.openingOverPrice, pick.openingOverPrice),
    openingUnderPrice: first(ctxOverrides.openingUnderPrice, pick.openingUnderPrice),
    currentOverPrice: first(ctxOverrides.currentOverPrice, pick.currentOverPrice),
    currentUnderPrice: first(ctxOverrides.currentUnderPrice, pick.currentUnderPrice),
    bookCount: first(ctxOverrides.bookCount, pick.bookCount, card.bookCount),
    lineDispersion: first(ctxOverrides.lineDispersion, pick.lineSpread),

    availabilityStatus: first(ctxOverrides.availabilityStatus, pick.availabilityStatus),
    injuryFeedOk: ctxOverrides.injuryFeedOk ?? pick.injuryFeedOk,
    injuryRow: ctxOverrides.injuryRow || pick.injuryRow,
    propMarketActive: ctxOverrides.propMarketActive ?? pick.propMarketActive,
    scheduleGapDays: first(ctxOverrides.scheduleGapDays, pick.scheduleGapDays),

    opponentDefenseContext:
      ctxOverrides.opponentDefenseContext || pick.opponentDefenseContext || pick.defenseResult,
    archetypeComparables: ctxOverrides.archetypeComparables || pick.archetypeComparables || [],
    teammateStatuses: ctxOverrides.teammateStatuses || pick.teammateStatuses || [],
    teamGameDates: ctxOverrides.teamGameDates || pick.teamGameDates || [],
    previousOt: ctxOverrides.previousOt ?? pick.previousOt,

    impliedTeamTotal: first(ctxOverrides.impliedTeamTotal, pick.impliedTeamTotal),
    spread: first(ctxOverrides.spread, pick.spread),
    blowoutRisk: first(ctxOverrides.blowoutRisk, pick.blowoutRisk),
    scoringEnvironmentProxy: first(
      ctxOverrides.scoringEnvironmentProxy,
      pick.scoringEnvironmentProxy
    ),
    vendorProjection: first(ctxOverrides.vendorProjection, pick.sportsProjection),

    organicModelSide: first(ctxOverrides.organicModelSide, pick.initialSide),
    finalSide: first(ctxOverrides.finalSide, pick.side, pick.pick),
    originalModelConfidence: first(ctxOverrides.originalModelConfidence, pick.confidence),

    roleChange: ctxOverrides.roleChange || pick.roleChange || null,
    volumeProfile: ctxOverrides.volumeProfile || pick.volumeProfile || null,
    marketIntelligence: ctxOverrides.marketIntelligence || pick.marketIntelligence || null,
    playerRoleProfile: ctxOverrides.playerRoleProfile || pick.playerRoleProfile || null,
    decisionDataIntelligence:
      ctxOverrides.decisionDataIntelligence || pick.decisionDataIntelligence || null,
    pick,

    fetchedAt: ctxOverrides.fetchedAt || pick.fetchedAt || new Date().toISOString(),
    sourceIds: ctxOverrides.sourceIds || pick.sourceIds || {},
    providerHealth: ctxOverrides.providerHealth || pick.providerHealth || {},
  };

  const merged = { ...base, ...ctxOverrides, pick };
  return enrichCtxWithLegacyAdapters(merged, pick);
}

export function attachCourtEdgeEngineSignals(pick = {}, ctx = {}) {
  const force = ctx.force === true;
  if (
    !force &&
    pick.courtEdgeEngineSignalsV1?.enabled === true &&
    (pick.courtEdgeDecisionPacketV1?.decisionHash ||
      pick.courtEdgeDecisionPacket?.decisionHash)
  ) {
    return pick;
  }

  const context = buildContextFromPick(pick, ctx);
  const signals = buildCourtEdgeEngineSignalsV1(context, { force: ctx.force });

  let next = {
    ...pick,
    courtEdgeEngineSignalsV1: signals,
    courtEdgeEngineSignals: signals,
    courtEdgeEngineSignalsVersion: signals.version,
    courtEdgeEngineSignalsSchemaBuild: signals.schemaBuild || ENGINE_EXPANSION_BUILD,
    legacyUpstreamEvidence: context.legacyUpstream || null,
  };

  if (signals.enabled === true) {
    const packet = buildDecisionPacketV1({
      pick: next,
      ctx: context,
      signals,
    });
    next = attachDecisionPacket(next, packet);
  }

  return next;
}

export function applyEngineSignalAdjustments(pick = {}, signals = null) {
  const engineSignals =
    signals || pick.courtEdgeEngineSignalsV1 || pick.courtEdgeEngineSignals;

  if (!engineSignals || engineSignals.enabled !== true || !engineSignals.aggregation) {
    const fallback =
      engineSignals || pick.courtEdgeEngineSignalsV1 || pick.courtEdgeEngineSignals || null;
    return {
      ...pick,
      courtEdgeEngineSignalsV1: fallback,
      courtEdgeEngineSignals: fallback,
    };
  }

  const aggregation = engineSignals.aggregation;
  const confidenceAdjustment = num(aggregation.confidenceAdjustment, 0);
  const riskAdjustment = String(aggregation.riskAdjustment || "NEUTRAL").toUpperCase();

  const packet = buildDecisionPacketV1({
    pick,
    ctx: {
      league: engineSignals.league,
      playerId: engineSignals.playerId,
      gameId: engineSignals.gameId,
      line: pick.line,
      openingLine: pick.openingLine,
      projection: pick.projection,
      finalSide: pick.side || pick.pick,
      organicModelSide: aggregation?.organicModelSide,
      gameLogs: pick.gameLogs || pick.last10 || [],
    },
    signals: engineSignals,
  });

  const already =
    (pick.courtEdgeEngineAdjustmentsApplied === true ||
      pick.courtEdgeEngineSignalsApplied === true) &&
    num(pick.courtEdgeConfidenceAdjustment, NaN) === confidenceAdjustment &&
    String(pick.courtEdgeRiskAdjustment || "").toUpperCase() === riskAdjustment;

  if (already || hasEngineSignalsAlreadyApplied(pick, packet)) {
    if (
      (pick.courtEdgeEngineAdjustmentsApplied === true ||
        pick.courtEdgeEngineSignalsApplied === true) &&
      num(pick.courtEdgeConfidenceAdjustment, NaN) === confidenceAdjustment
    ) {
      const existing =
        pick.courtEdgeDecisionPacketV1 || pick.courtEdgeDecisionPacket || packet;
      return {
        ...pick,
        courtEdgeEngineSignalsV1: engineSignals,
        courtEdgeEngineSignals: engineSignals,
        courtEdgeEngineSignalsVersion: engineSignals.version,
        courtEdgeDecisionPacketV1: existing,
        courtEdgeDecisionPacket: existing,
        decisionPacket: existing,
        courtEdgeDecisionPacketVersion: existing.version,
        courtEdgeEngineAdjustmentsApplied: true,
        courtEdgeEngineSignalsApplied: true,
        courtEdgeEngineSignalsDecisionHash:
          pick.courtEdgeEngineSignalsDecisionHash || existing.decisionHash,
      };
    }
  }

  const priorConfidence = num(
    pick.courtEdgeConfidenceBeforeEngineApply ?? pick.confidence,
    50
  );
  const nextConfidence = Math.max(
    5,
    Math.min(97, Math.round(priorConfidence + confidenceAdjustment))
  );

  const riskLevels = ["REDUCE", "NEUTRAL", "MONITOR", "ELEVATE"];
  const priorRiskIdx = riskLevels.indexOf(
    String(pick.courtEdgeRiskAdjustment || "NEUTRAL").toUpperCase()
  );
  const engineRiskIdx = riskLevels.indexOf(riskAdjustment);
  const combinedRiskAdjustment =
    riskLevels[
      Math.max(priorRiskIdx === -1 ? 1 : priorRiskIdx, engineRiskIdx === -1 ? 1 : engineRiskIdx)
    ];

  const appliedPacket = markDecisionPacketApplied(packet, {
    confidence: nextConfidence,
    finalConfidence: nextConfidence,
    riskAdjustment: combinedRiskAdjustment,
    confidenceAdjustment,
  });

  return {
    ...pick,
    courtEdgeEngineSignalsV1: engineSignals,
    courtEdgeEngineSignals: engineSignals,
    courtEdgeEngineSignalsVersion: engineSignals.version,
    courtEdgeConfidenceBeforeEngineApply: priorConfidence,
    courtEdgeConfidenceAdjustment: confidenceAdjustment,
    courtEdgeRiskAdjustment: combinedRiskAdjustment,
    confidence: nextConfidence,
    finalConfidence: nextConfidence,
    courtEdgeDecisionPacketV1: appliedPacket,
    courtEdgeDecisionPacket: appliedPacket,
    decisionPacket: appliedPacket,
    courtEdgeDecisionPacketVersion: appliedPacket.version,
    courtEdgeEngineAdjustmentsApplied: true,
    courtEdgeEngineSignalsApplied: true,
    courtEdgeEngineSignalsDecisionHash: appliedPacket.decisionHash,
  };
}
