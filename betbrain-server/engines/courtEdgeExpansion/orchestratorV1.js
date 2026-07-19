/**
 * CourtEdge Engine Expansion — Orchestrator V1.1 (consolidation).
 *
 * Prefer legacy-module bridges (DDI / line integrity / availability / role /
 * opponent) when upstream already produced authoritative diagnostics. Fall
 * back to expansion engines only when a bridge has nothing usable. Evidence
 * deduplication remains the sole confidence/risk contribution ledger.
 *
 * scoringEnvironmentProxy is store-only (never a vote). truePace is only
 * computed when FGA/FTA/OREB/TOV are complete.
 */
import { CONFIG } from "../../config.js";
import { evaluateAvailabilityRoster } from "./availabilityRosterEngine.js";
import { evaluateRoleTrendVelocity } from "./roleVelocityEngine.js";
import { evaluateCeilingFloorDistribution } from "./distributionEngine.js";
import { evaluatePlayerVolatility } from "./volatilityEngine.js";
import { evaluateTeammateImpact } from "./teammateImpactEngine.js";
import { evaluateRestFatigue } from "./restFatigueEngine.js";
import { evaluateTruePacePossession } from "./pacePossessionEngine.js";
import { evaluateDefensiveArchetype } from "./defensiveArchetypeEngine.js";
import { evaluateLineMovementClv } from "./lineMovementClvEngine.js";
import { evaluateProjectionSanity } from "./projectionSanityEngine.js";
import { evaluateEvidenceDeduplication } from "./evidenceDeduplicationEngine.js";
import { harvestLegacyBridges } from "./legacyModuleBridges.js";
import { numOrNull, normalizeLeague, baseEngineSignal } from "./shared.js";
import {
  ENGINE_EXPANSION_VERSION,
  SCHEMA_BUILD,
  CONFIDENCE_OWNER,
  RISK_OWNER,
} from "./versionConstants.js";

export { ENGINE_EXPANSION_VERSION, SCHEMA_BUILD, CONFIDENCE_OWNER, RISK_OWNER };

const SCORING_ENVIRONMENT_PROXY_ENGINE = "scoringEnvironmentProxy";

function buildScoringEnvironmentProxyRecord(ctx = {}) {
  const proxy = numOrNull(ctx.scoringEnvironmentProxy);
  return baseEngineSignal({
    engine: SCORING_ENVIRONMENT_PROXY_ENGINE,
    available: proxy !== null,
    source: proxy !== null ? "context_supplied" : null,
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize: 0,
    quality: proxy !== null ? "USABLE" : "UNAVAILABLE",
    rawValues: {
      scoringEnvironmentProxy: proxy,
      separateFromTruePace: true,
    },
    normalizedSignal: 0,
    overContribution: 0,
    underContribution: 0,
    confidenceAdjustment: 0,
    riskAdjustment: "NEUTRAL",
    reason:
      proxy !== null
        ? "Stored for reference only — not a vote, not true pace."
        : "No scoringEnvironmentProxy supplied.",
    units: null,
    storeOnly: true,
  });
}

function preferBridge(bridged, computed) {
  if (bridged && bridged.available === true) {
    return {
      ...bridged,
      fallbackUsed: false,
      consolidation: "legacy_bridge_preferred",
    };
  }
  return {
    ...computed,
    consolidation: bridged ? "bridge_unavailable_fallback_engine" : "engine_primary",
  };
}

function buildAggregation(evidenceDeduplication) {
  const totals = evidenceDeduplication.totals;
  const netSignal = totals.netSignalTotal;
  const margin = Math.abs(totals.overWeight - totals.underWeight);

  let organicSide = "NEUTRAL";
  if (margin >= 0.12) {
    if (netSignal > 0.05) organicSide = "OVER";
    else if (netSignal < -0.05) organicSide = "UNDER";
  }

  return {
    organicSide,
    netSignal,
    overWeight: totals.overWeight,
    underWeight: totals.underWeight,
    confidenceAdjustment: totals.confidenceAdjustment,
    riskAdjustment: totals.riskAdjustment,
    coverage: {
      availableEngineCount: totals.availableEngineCount,
      votingEngineCount: totals.votingEngineCount,
      totalEngineCount: totals.totalEngineCount,
      coveragePct: totals.coveragePct,
    },
  };
}

/**
 * Runs the full CourtEdge engine expansion pipeline for one player/prop
 * context. Returns a disabled shell when the feature flag is off.
 */
export function buildCourtEdgeEngineSignalsV1(ctx = {}, options = {}) {
  const league = normalizeLeague(ctx.league);
  const builtAt = new Date().toISOString();
  const enabled =
    options.force === true || CONFIG.COURTEDGE_ENGINE_EXPANSION_V1_ENABLED === true;

  if (!enabled) {
    return {
      version: ENGINE_EXPANSION_VERSION,
      schemaBuild: SCHEMA_BUILD,
      enabled: false,
      league,
      generatedAt: builtAt,
      engines: {},
      evidenceDeduplication: null,
      aggregation: null,
      reason: "COURTEDGE_ENGINE_EXPANSION_V1_ENABLED is false",
    };
  }

  const bridges = harvestLegacyBridges(ctx, ctx.pick || {});

  // Prefer bridged authoritative modules; fall back to expansion calc.
  const availabilityRoster = preferBridge(
    bridges.availabilityRosterEngine,
    evaluateAvailabilityRoster(ctx)
  );
  const roleVelocity = preferBridge(
    bridges.roleVelocityEngine,
    evaluateRoleTrendVelocity(ctx)
  );
  const distribution = evaluateCeilingFloorDistribution(ctx);
  const volatility = evaluatePlayerVolatility(ctx);
  // Attach shared profile handles for volume/reliability consumers
  distribution.distributionProfile = distribution.rawValues || distribution;
  volatility.volatilityProfile = volatility.rawValues || volatility;

  const teammateImpact = preferBridge(
    bridges.teammateImpactEngine,
    evaluateTeammateImpact(ctx)
  );
  const restFatigue = evaluateRestFatigue(ctx);
  const pacePossession = evaluateTruePacePossession(ctx);
  const scoringEnvironmentProxy = buildScoringEnvironmentProxyRecord(ctx);
  const defensiveArchetype = preferBridge(
    bridges.defensiveArchetypeEngine,
    evaluateDefensiveArchetype(ctx)
  );
  const lineMovementClv = preferBridge(
    bridges.lineMovementClvEngine,
    evaluateLineMovementClv(ctx)
  );
  const projectionSanity = preferBridge(
    bridges.projectionSanityEngine,
    evaluateProjectionSanity(ctx)
  );

  const engineSignals = {
    availabilityRosterEngine: availabilityRoster,
    roleVelocityEngine: roleVelocity,
    distributionEngine: distribution,
    volatilityEngine: volatility,
    teammateImpactEngine: teammateImpact,
    restFatigueEngine: restFatigue,
    pacePossessionEngine: pacePossession,
    defensiveArchetypeEngine: defensiveArchetype,
    lineMovementClvEngine: lineMovementClv,
    projectionSanityEngine: projectionSanity,
  };

  const evidenceDeduplication = evaluateEvidenceDeduplication(ctx, engineSignals);
  const aggregation = buildAggregation(evidenceDeduplication);

  const bridgedEngines = Object.keys(bridges);
  const ownership = {
    confidenceOwner: CONFIDENCE_OWNER,
    riskOwner: RISK_OWNER,
    bridgedEngines,
    fallbackEngines: Object.keys(engineSignals).filter(
      (k) => !bridgedEngines.includes(k)
    ),
    consolidationBuild: SCHEMA_BUILD,
  };

  return {
    version: ENGINE_EXPANSION_VERSION,
    schemaBuild: SCHEMA_BUILD,
    enabled: true,
    league,
    playerId: ctx.playerId || null,
    teamId: ctx.teamId || null,
    opponentId: ctx.opponentId || null,
    gameId: ctx.gameId || null,
    generatedAt: builtAt,
    dataCapturedAt: ctx.fetchedAt || ctx.dataCapturedAt || builtAt,
    ownership,
    lineMovement: lineMovementClv,
    projectionSanity,
    availabilityRoster,
    distributionProfile: distribution,
    volatilityProfile: volatility,
    defensiveArchetype,
    roleVelocity,
    pacePossession,
    restFatigue,
    teammateImpact,
    evidenceDeduplication,
    engines: {
      availabilityRoster,
      roleVelocity,
      distribution,
      volatility,
      teammateImpact,
      restFatigue,
      pacePossession,
      scoringEnvironmentProxy,
      defensiveArchetype,
      lineMovementClv,
      projectionSanity,
    },
    aggregation: {
      originalOverSupport: aggregation.overWeight,
      originalUnderSupport: aggregation.underWeight,
      organicModelSide: aggregation.organicSide,
      organicModelConfidence: ctx.originalModelConfidence ?? null,
      independentEvidenceGroups:
        evidenceDeduplication?.groups || evidenceDeduplication?.groupTotals || null,
      usedSignalContributions: evidenceDeduplication?.used || null,
      suppressedDuplicateContributions: evidenceDeduplication?.suppressed || null,
      contradictionCount: evidenceDeduplication?.contradictionCount ?? 0,
      evidenceCoverage: aggregation.coverage,
      projectionConfidence:
        projectionSanity?.rawValues?.projectionSanityScore ??
        projectionSanity?.rawValues?.projectionQualityScore ??
        null,
      pickConfidence: null,
      finalRisk: aggregation.riskAdjustment,
      confidenceOwner: CONFIDENCE_OWNER,
      riskOwner: RISK_OWNER,
      ...aggregation,
    },
  };
}
