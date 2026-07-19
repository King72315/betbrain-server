/**
 * CourtEdge Engine Expansion — Orchestrator V1.
 *
 * Runs every expansion engine in a fixed order, packages the raw
 * scoringEnvironmentProxy for reference (store-only, never a vote), then
 * runs evidence deduplication across everything and builds a final
 * aggregation block (organic side, coverage, adjustments).
 *
 * Gated by CONFIG.COURTEDGE_ENGINE_EXPANSION_V1_ENABLED. Callers (e.g. the
 * service layer) may also gate independently before ever calling this —
 * this internal check is a second line of defense, not the only one.
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
import { numOrNull, normalizeLeague, baseEngineSignal } from "./shared.js";

export const ENGINE_EXPANSION_VERSION = "courtEdgeEngineSignalsV1";
export const SCHEMA_BUILD = "courteedge-engine-expansion-v1";

const SCORING_ENVIRONMENT_PROXY_ENGINE = "scoringEnvironmentProxy";

/**
 * Packages ctx.scoringEnvironmentProxy for reference only. This is NOT a
 * pace measurement and NEVER casts a vote — see pacePossessionEngine.js for
 * the honest true-pace computation and its own availability gate.
 */
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
    rawValues: { scoringEnvironmentProxy: proxy },
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

function buildAggregation(evidenceDeduplication) {
  const totals = evidenceDeduplication.totals;
  const netSignal = totals.netSignalTotal;
  const margin = Math.abs(totals.overWeight - totals.underWeight);

  // Require both a meaningful net signal AND separation between the two
  // sides before declaring an organic lean — ties stay NEUTRAL, never
  // forced to one side.
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
 * context. Returns a disabled shell (no engines run) when the feature flag
 * is off and options.force is not set.
 */
export function buildCourtEdgeEngineSignalsV1(ctx = {}, options = {}) {
  const league = normalizeLeague(ctx.league);
  const builtAt = new Date().toISOString();
  const enabled = options.force === true || CONFIG.COURTEDGE_ENGINE_EXPANSION_V1_ENABLED === true;

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

  // Fixed evaluation order — see module header.
  const availabilityRoster = evaluateAvailabilityRoster(ctx);
  const roleVelocity = evaluateRoleTrendVelocity(ctx);
  const distribution = evaluateCeilingFloorDistribution(ctx);
  const volatility = evaluatePlayerVolatility(ctx);
  const teammateImpact = evaluateTeammateImpact(ctx);
  const restFatigue = evaluateRestFatigue(ctx);
  const pacePossession = evaluateTruePacePossession(ctx);
  const scoringEnvironmentProxy = buildScoringEnvironmentProxyRecord(ctx); // store only, never a vote
  const defensiveArchetype = evaluateDefensiveArchetype(ctx);
  const lineMovementClv = evaluateLineMovementClv(ctx);
  const projectionSanity = evaluateProjectionSanity(ctx);

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

  // Product schema: top-level engine keys + nested engines bag for diagnostics.
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
      projectionConfidence: projectionSanity?.rawValues?.projectionSanityScore ?? null,
      pickConfidence: null,
      finalRisk: aggregation.riskAdjustment,
      ...aggregation,
    },
  };
}
