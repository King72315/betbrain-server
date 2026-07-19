/**
 * League context adapters — shared raw schemas → NBA / WNBA entry points.
 * Does NOT force WNBA Reader onto NBA. Baselines/weights stay league-specific
 * via calibrationV1.js.
 */
import { first, normalizeLeague } from "../shared.js";

/**
 * Normalize a pick into the shared expansion ctx shape.
 * League-specific fields stay namespaced under `leagueAdapter`.
 */
export function buildSharedEngineContext(pick = {}, overrides = {}) {
  const league = normalizeLeague(overrides.league || pick.league || pick.wnbaDataCard?.league);
  const card = pick.wnbaDataCard || {};
  const ddi = pick.decisionDataIntelligence || pick.decisionDataIntelligenceV1 || {};

  const base = {
    league,
    playerId: first(overrides.playerId, pick.playerId, pick.wnbaPlayerId),
    teamId: first(overrides.teamId, pick.teamId),
    opponentId: first(overrides.opponentId, pick.opponentId),
    gameId: first(overrides.gameId, pick.gameId, pick.game?.id),
    playerName: first(overrides.playerName, pick.playerName, pick.player),
    team: first(overrides.team, pick.team),
    opponent: first(overrides.opponent, pick.opponent),

    gameLogs: overrides.gameLogs || pick.gameLogs || pick.last10 || [],
    seasonAverage: first(overrides.seasonAverage, pick.seasonAverage),
    last10: overrides.last10 || pick.last10,
    roleGames: overrides.roleGames || pick.roleGames,
    projection: first(overrides.projection, pick.projection),
    line: first(overrides.line, pick.line, card.bookLine, card.currentLine),
    openingLine: first(overrides.openingLine, pick.openingLine, card.openingLine),
    selectedLine: first(overrides.selectedLine, pick.selectedLine),
    sealedLine: first(overrides.sealedLine, pick.sealedLine),
    currentLine: first(overrides.currentLine, pick.currentLine, card.currentLine),

    openingOverPrice: first(overrides.openingOverPrice, pick.openingOverPrice),
    openingUnderPrice: first(overrides.openingUnderPrice, pick.openingUnderPrice),
    currentOverPrice: first(overrides.currentOverPrice, pick.currentOverPrice),
    currentUnderPrice: first(overrides.currentUnderPrice, pick.currentUnderPrice),
    bookCount: first(overrides.bookCount, pick.bookCount, card.bookCount),
    lineDispersion: first(overrides.lineDispersion, pick.lineSpread),

    availabilityStatus: first(overrides.availabilityStatus, pick.availabilityStatus),
    injuryFeedOk: overrides.injuryFeedOk ?? pick.injuryFeedOk,
    injuryRow: overrides.injuryRow || pick.injuryRow,
    propMarketActive: overrides.propMarketActive ?? pick.propMarketActive,
    scheduleGapDays: first(overrides.scheduleGapDays, pick.scheduleGapDays),
    availabilityGate: overrides.availabilityGate || pick.availabilityGate,

    opponentDefenseContext:
      overrides.opponentDefenseContext || pick.opponentDefenseContext || pick.defenseResult,
    archetypeComparables: overrides.archetypeComparables || pick.archetypeComparables || [],
    teammateStatuses: overrides.teammateStatuses || pick.teammateStatuses || [],
    teamGameDates: overrides.teamGameDates || pick.teamGameDates || [],
    previousOt: overrides.previousOt ?? pick.previousOt,

    impliedTeamTotal: first(overrides.impliedTeamTotal, pick.impliedTeamTotal),
    spread: first(overrides.spread, pick.spread),
    blowoutRisk: first(overrides.blowoutRisk, pick.blowoutRisk),
    scoringEnvironmentProxy: first(
      overrides.scoringEnvironmentProxy,
      pick.scoringEnvironmentProxy
    ),
    vendorProjection: first(overrides.vendorProjection, pick.sportsProjection),

    organicModelSide: first(overrides.organicModelSide, pick.initialSide, pick.originalModelSide),
    finalSide: first(overrides.finalSide, pick.side, pick.pick),
    originalModelConfidence: first(overrides.originalModelConfidence, pick.confidence),

    // Pre-evaluated DDI diagnostics (authoritative when present)
    marketIntelligence: ddi.marketIntelligence || pick.marketIntelligence,
    availabilityImpact: ddi.availabilityImpact,
    roleStability: ddi.roleStability,
    usageShare: ddi.usageShare,
    opponentHistoryComparison: ddi.opponentHistoryComparison,
    projectionQuality: ddi.projectionQuality,
    volumeProfile: pick.volumeProfile,
    roleChange: pick.roleChange,
    pick,

    fetchedAt: overrides.fetchedAt || pick.fetchedAt || new Date().toISOString(),
    sourceIds: overrides.sourceIds || pick.sourceIds || {},
    providerHealth: overrides.providerHealth || pick.providerHealth || {},

    leagueAdapter:
      league === "WNBA"
        ? buildWnbaAdapterMeta(pick, overrides)
        : buildNbaAdapterMeta(pick, overrides),
  };

  return { ...base, ...overrides, league, pick: base.pick };
}

function buildWnbaAdapterMeta(pick = {}, overrides = {}) {
  return {
    league: "WNBA",
    regulationMinutes: 40,
    entry: "wnbaDecisionEngine → attachCourtEdgeEngineSignals",
    readerAttached: Boolean(pick.wnbaReader || overrides.reader),
    dataCardAttached: Boolean(pick.wnbaDataCard || overrides.dataCard),
    // Never force WNBA Reader onto NBA paths
    usesWnbaReader: true,
  };
}

function buildNbaAdapterMeta(pick = {}, overrides = {}) {
  return {
    league: "NBA",
    regulationMinutes: 48,
    entry: "server.js NBA prop builder → attachCourtEdgeEngineSignals",
    readerAttached: false,
    usesWnbaReader: false,
    fairLineAttached: Boolean(pick.fairLine || overrides.fairLine),
    // NBA verification via fixtures/replay only (offseason)
    verificationMode: "fixtures_replay_only",
  };
}

export function adaptNbaPickContext(pick = {}, overrides = {}) {
  return buildSharedEngineContext({ ...pick, league: "NBA" }, { ...overrides, league: "NBA" });
}

export function adaptWnbaPickContext(pick = {}, overrides = {}) {
  return buildSharedEngineContext({ ...pick, league: "WNBA" }, { ...overrides, league: "WNBA" });
}
