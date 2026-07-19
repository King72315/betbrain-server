/**
 * CourtEdge Engine Signals V1 — service-layer wiring for the engine
 * expansion module (betbrain-server/engines/courtEdgeExpansion).
 *
 * This file never runs engines directly — it builds context, calls the
 * orchestrator, and applies ALREADY-CAPPED adjustments to a pick. It never
 * changes a pick's side or line, and never removes a pick from tracking —
 * that stays the responsibility of upstream gates.
 */
import { CONFIG } from "../config.js";
import { buildCourtEdgeEngineSignalsV1 } from "../engines/courtEdgeExpansion/orchestratorV1.js";

export { buildCourtEdgeEngineSignalsV1 };

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

/**
 * Builds the engine-expansion context object from a pick, letting an
 * explicit ctxOverrides object win on a per-field basis (caller-supplied
 * fresher data always takes priority over what is cached on the pick).
 */
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

    opponentDefenseContext: ctxOverrides.opponentDefenseContext || pick.opponentDefenseContext,
    archetypeComparables: ctxOverrides.archetypeComparables || pick.archetypeComparables || [],
    teammateStatuses: ctxOverrides.teammateStatuses || pick.teammateStatuses || [],
    teamGameDates: ctxOverrides.teamGameDates || pick.teamGameDates || [],
    previousOt: ctxOverrides.previousOt ?? pick.previousOt,

    impliedTeamTotal: first(ctxOverrides.impliedTeamTotal, pick.impliedTeamTotal),
    spread: first(ctxOverrides.spread, pick.spread),
    blowoutRisk: first(ctxOverrides.blowoutRisk, pick.blowoutRisk),
    scoringEnvironmentProxy: first(ctxOverrides.scoringEnvironmentProxy, pick.scoringEnvironmentProxy),
    vendorProjection: first(ctxOverrides.vendorProjection, pick.sportsProjection),

    organicModelSide: first(ctxOverrides.organicModelSide, pick.initialSide),
    finalSide: first(ctxOverrides.finalSide, pick.side, pick.pick),
    originalModelConfidence: first(ctxOverrides.originalModelConfidence, pick.confidence),

    fetchedAt: ctxOverrides.fetchedAt || pick.fetchedAt || new Date().toISOString(),
    sourceIds: ctxOverrides.sourceIds || pick.sourceIds || {},
    providerHealth: ctxOverrides.providerHealth || pick.providerHealth || {},
  };

  return { ...base, ...ctxOverrides };
}

/**
 * Builds CourtEdge engine signals for a pick and attaches them without
 * mutating the input. Returns the pick unchanged (plus a disabled shell)
 * when the feature flag is off, so callers can always safely read
 * pick.courtEdgeEngineSignals.
 */
export function attachCourtEdgeEngineSignals(pick = {}, ctx = {}) {
  const context = buildContextFromPick(pick, ctx);
  const signals = buildCourtEdgeEngineSignalsV1(context, { force: ctx.force });

  return {
    ...pick,
    // courtEdgeEngineSignalsV1 is the schema field name preferred by product;
    // courtEdgeEngineSignals is kept as an alias for existing consumers.
    courtEdgeEngineSignalsV1: signals,
    courtEdgeEngineSignals: signals,
    courtEdgeEngineSignalsVersion: signals.version,
  };
}

/**
 * Applies the already-capped aggregation adjustments from evidenceDeduplication
 * onto a pick's confidence/risk. Never touches side/line/pick, and never
 * removes the pick from tracking — even when risk is elevated, the caller
 * must decide what to do with that signal upstream.
 */
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
  const priorConfidence = num(pick.confidence, 50);
  // Confidence is clamped to a sane band — side and line are never touched here.
  const nextConfidence = Math.max(5, Math.min(97, Math.round(priorConfidence + confidenceAdjustment)));

  const riskLevels = ["REDUCE", "NEUTRAL", "MONITOR", "ELEVATE"];
  const priorRiskIdx = riskLevels.indexOf(String(pick.courtEdgeRiskAdjustment || "NEUTRAL").toUpperCase());
  const engineRiskIdx = riskLevels.indexOf(String(aggregation.riskAdjustment || "NEUTRAL").toUpperCase());
  const combinedRiskAdjustment =
    riskLevels[Math.max(priorRiskIdx === -1 ? 1 : priorRiskIdx, engineRiskIdx === -1 ? 1 : engineRiskIdx)];

  return {
    ...pick,
    courtEdgeEngineSignalsV1: engineSignals,
    courtEdgeEngineSignals: engineSignals,
    courtEdgeEngineSignalsVersion: engineSignals.version,
    courtEdgeConfidenceAdjustment: confidenceAdjustment,
    courtEdgeRiskAdjustment: combinedRiskAdjustment,
    confidence: nextConfidence,
    // side/pick/line intentionally untouched — this function only adjusts
    // confidence and risk labeling, never selection or the market number.
  };
}
