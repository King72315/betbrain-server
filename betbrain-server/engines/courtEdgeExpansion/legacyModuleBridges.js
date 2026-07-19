/**
 * CourtEdge Engine Expansion — legacy module bridges (v1.1 consolidation).
 *
 * Translates EXISTING authoritative module outputs into expansion ledger
 * signals so we do not invent a second unrelated calculation. Raw modules
 * may still diagnose for Flip-First / Side Rescue; once bridged into the
 * evidence ledger they must not independently modify confidence/risk again
 * (see decisionDataIntelligenceV1 buildFinalInfluence deferral).
 *
 * Each bridge returns null when the upstream module has nothing usable —
 * the orchestrator then falls back to the expansion engine's own calc.
 */
import {
  clamp,
  num,
  numOrNull,
  normalizeSide,
  baseEngineSignal,
  contributionsFromSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";
import { evaluateMarketMovementIntelligence } from "../decisionIntelligence/marketMovementIntelligenceV1.js";
import { evaluateAvailabilityImpact } from "../decisionIntelligence/availabilityImpactV1.js";
import { evaluateRoleStabilityIntelligence } from "../decisionIntelligence/roleStabilityIntelligenceV1.js";
import { evaluateUsageShareIntelligence } from "../decisionIntelligence/usageShareIntelligenceV1.js";
import { evaluateOpponentHistoryComparison } from "../decisionIntelligence/opponentHistoryComparisonV1.js";
import { buildLineAuditFields } from "../../services/lineIntegrityV1.js";

function sideToSignal(sideImpact, magnitude = 0.35) {
  const side = normalizeSide(sideImpact);
  if (side === "OVER") return magnitude;
  if (side === "UNDER") return -magnitude;
  return 0;
}

function riskFromFlags({ elevate = false, monitor = false, reduce = false } = {}) {
  if (elevate) return RISK_ADJUSTMENT.ELEVATE;
  if (monitor) return RISK_ADJUSTMENT.MONITOR;
  if (reduce) return RISK_ADJUSTMENT.REDUCE;
  return RISK_ADJUSTMENT.NEUTRAL;
}

function qualityFromStatus(status) {
  const s = String(status || "").toUpperCase();
  if (s === "GOOD" || s === "STRONG" || s === "HIGH") return ENGINE_SIGNAL_QUALITY.STRONG;
  if (s === "PARTIAL" || s === "MIXED" || s === "MODERATE" || s === "USABLE") {
    return ENGINE_SIGNAL_QUALITY.USABLE;
  }
  if (s === "BAD" || s === "WEAK" || s === "LOW" || s === "THIN") {
    return ENGINE_SIGNAL_QUALITY.DEVELOPING;
  }
  return ENGINE_SIGNAL_QUALITY.USABLE;
}

/**
 * Line Movement / CLV — Line Integrity owns the numbers; MMI interprets.
 */
export function bridgeLineMovementClv(ctx = {}, pick = {}) {
  const lineAudit = buildLineAuditFields(pick);
  const market =
    ctx.marketIntelligence ||
    pick.decisionDataIntelligence?.marketIntelligence ||
    pick.marketMovementIntelligence ||
    evaluateMarketMovementIntelligence(pick, {
      dataCard: pick.wnbaDataCard,
      side: ctx.finalSide || pick.side || pick.pick,
      marketIntelligence: pick.marketIntelligence,
    });

  const openingLine = numOrNull(
    market.openingLine ?? ctx.openingLine ?? lineAudit.openingLine ?? pick.openingLine
  );
  const currentLine = numOrNull(
    market.currentLine ?? ctx.currentLine ?? lineAudit.selectedLine ?? pick.line
  );
  if (openingLine === null && currentLine === null) return null;

  const lineDelta =
    market.lineDelta != null
      ? num(market.lineDelta)
      : openingLine !== null && currentLine !== null
        ? Number((currentLine - openingLine).toFixed(2))
        : 0;

  const side = normalizeSide(ctx.finalSide || pick.side || pick.pick);
  let normalizedSignal = 0;
  if (market.sideImpact && market.sideImpact !== "NEUTRAL") {
    normalizedSignal = sideToSignal(market.sideImpact, market.marketWarning ? 0.55 : 0.35);
  } else if (side && Math.abs(lineDelta) >= 0.5) {
    // Line up favors Over; down favors Under
    const movedOver = lineDelta > 0;
    const agrees =
      (side === "OVER" && movedOver) || (side === "UNDER" && !movedOver);
    normalizedSignal = agrees ? 0.25 : -0.35;
  }

  const confAdj = market.marketWarning
    ? -6
    : market.staleLineSuspected
      ? -4
      : normalizedSignal > 0
        ? 3
        : normalizedSignal < 0
          ? -3
          : 0;

  return {
    ...baseEngineSignal({
      engine: "lineMovementClvEngine",
      available: true,
      source: "marketMovementIntelligenceV1+lineIntegrityV1",
      sourceIds: { bridgedFrom: "marketMovementIntelligenceV1", lineIntegrity: true },
      sampleSize: num(market.bookConsensus === "STRONG" ? 5 : market.bookConsensus === "MODERATE" ? 3 : 1),
      quality: qualityFromStatus(market.bookConsensus),
      rawValues: {
        openingLine,
        currentLine,
        lineDelta,
        selectedLine: lineAudit.selectedLine ?? currentLine,
        marketWarning: market.marketWarning === true,
        staleLineSuspected: market.staleLineSuspected === true,
        bookConsensus: market.bookConsensus || null,
        sideImpact: market.sideImpact || null,
        lineIntegrityVersion: lineAudit.lineIntegrityVersion || null,
        authoritative: true,
      },
      normalizedSignal: Number(clamp(normalizedSignal, -1, 1).toFixed(3)),
      ...contributionsFromSignal(normalizedSignal),
      confidenceAdjustment: confAdj,
      riskAdjustment: riskFromFlags({
        elevate: market.staleLineSuspected === true,
        monitor: market.marketWarning === true,
      }),
      reason: (market.reasons || []).slice(0, 2).join(" ") || "Bridged from market movement intelligence.",
    }),
    bridgedFrom: ["marketMovementIntelligenceV1", "lineIntegrityV1"],
    authoritativeSource: "marketMovementIntelligenceV1",
  };
}

/**
 * Availability — one normalized object from gate/service/impact adapters.
 */
export function bridgeAvailabilityRoster(ctx = {}, pick = {}) {
  const impact =
    ctx.availabilityImpact ||
    pick.decisionDataIntelligence?.availabilityImpact ||
    evaluateAvailabilityImpact(pick, {
      dataCard: pick.wnbaDataCard,
      availabilityGate: pick.availabilityGate || ctx.availabilityGate,
      side: ctx.finalSide || pick.side,
    });
  const gate = pick.availabilityGate || ctx.availabilityGate || {};
  const status = String(
    impact.playerStatus ||
      ctx.availabilityStatus ||
      gate.status ||
      gate.level ||
      gate.availabilityStatus ||
      ""
  ).toUpperCase();

  if (!status || status === "N/A") return null;

  let confAdj = 0;
  let risk = RISK_ADJUSTMENT.NEUTRAL;
  let normalizedSignal = 0;
  if (status === "OUT" || status === "DOUBTFUL") {
    confAdj = -10;
    risk = RISK_ADJUSTMENT.ELEVATE;
    normalizedSignal = -0.2; // availability does not cast a strong O/U vote
  } else if (status === "QUESTIONABLE" || status === "PROBABLE") {
    confAdj = -5;
    risk = RISK_ADJUSTMENT.MONITOR;
  } else if (impact.uncertaintyAdded) {
    confAdj = -3;
    risk = RISK_ADJUSTMENT.MONITOR;
  } else if (status === "ACTIVE" || status === "CONFIRMED_ACTIVE" || status === "EXPECTED_ACTIVE") {
    confAdj = 1;
  }

  // Teammate boost/reduction already represented — keep signal small to avoid
  // triple-penalize with teammateImpactEngine.
  if ((impact.teammateBoosts || []).length && !["OUT", "DOUBTFUL"].includes(status)) {
    confAdj = Math.min(confAdj + 2, 4);
  }

  return {
    ...baseEngineSignal({
      engine: "availabilityRosterEngine",
      available: true,
      source: "availabilityImpactV1+availabilityGate",
      sourceIds: { bridgedFrom: "availabilityImpactV1" },
      sampleSize: 1,
      quality: impact.uncertaintyAdded
        ? ENGINE_SIGNAL_QUALITY.DEVELOPING
        : ENGINE_SIGNAL_QUALITY.USABLE,
      rawValues: {
        playerStatus: status,
        sourceStatus: impact.sourceStatus || null,
        uncertaintyAdded: impact.uncertaintyAdded === true,
        teammateBoosts: impact.teammateBoosts || [],
        teammateReductions: impact.teammateReductions || [],
        sideImpact: impact.sideImpact || null,
        gateStatus: gate.status || gate.level || null,
        authoritative: true,
        noTriplePenalize: true,
      },
      normalizedSignal,
      overContribution: 0,
      underContribution: 0,
      confidenceAdjustment: confAdj,
      riskAdjustment: risk,
      reason: (impact.reasons || []).slice(0, 2).join(" ") || `Availability ${status}.`,
      status,
    }),
    bridgedFrom: ["availabilityImpactV1", "availabilityGateEngine", "wnbaAvailabilityService"],
    authoritativeSource: "availabilityImpactV1",
  };
}

/**
 * Role velocity — one ROLE_AND_VOLUME contribution from role/usage/volume modules.
 */
export function bridgeRoleVelocity(ctx = {}, pick = {}) {
  const role =
    ctx.roleStability ||
    pick.decisionDataIntelligence?.roleStability ||
    evaluateRoleStabilityIntelligence(pick, {
      dataCard: pick.wnbaDataCard,
      volumeProfile: pick.volumeProfile,
      opportunity: pick.opportunity,
      roleChange: pick.roleChange,
      side: ctx.finalSide || pick.side,
    });
  const usage =
    ctx.usageShare ||
    pick.decisionDataIntelligence?.usageShare ||
    evaluateUsageShareIntelligence(pick, {
      dataCard: pick.wnbaDataCard,
      roleChange: pick.roleChange,
      opportunity: pick.opportunity,
      playerState: pick.playerState,
      side: ctx.finalSide || pick.side,
    });
  const volume = pick.volumeProfile || ctx.volumeProfile || {};
  const roleChange = pick.roleChange || ctx.roleChange || {};

  if (!role && !usage && !volume.roleTrend && !roleChange.roleTrend) return null;

  const trend = String(
    volume.roleTrend || roleChange.roleTrend || pick.roleTrend || ""
  ).toLowerCase();
  let normalizedSignal = 0;
  if (["up", "expanding", "rising"].includes(trend)) normalizedSignal = 0.4;
  if (["down", "contracting", "declining"].includes(trend)) normalizedSignal = -0.4;

  const sideImpact = normalizeSide(role.sideImpact || usage.sideImpact);
  if (sideImpact && normalizedSignal === 0) {
    normalizedSignal = sideToSignal(sideImpact, 0.3);
  }

  const roleScore = num(role.score, 50);
  const usageScore = num(usage.score, 50);
  const blended = (roleScore + usageScore) / 2;
  let confAdj = 0;
  if (blended < 45 || role.status === "BAD" || usage.status === "BAD") confAdj = -5;
  else if (blended >= 70 && role.status === "GOOD") confAdj = 3;
  else if (role.hotShootingRisk) confAdj = -4;

  return {
    ...baseEngineSignal({
      engine: "roleVelocityEngine",
      available: true,
      source: "roleStability+usageShare+volumeProfile+roleChange",
      sourceIds: { bridgedFrom: "ROLE_AND_VOLUME_GROUP" },
      sampleSize: 1,
      quality: qualityFromStatus(role.status || usage.status),
      rawValues: {
        roleStabilityScore: role.score ?? null,
        roleStabilityStatus: role.status ?? null,
        usageShareScore: usage.score ?? null,
        usageShareStatus: usage.status ?? null,
        roleTrend: trend || null,
        hotShootingRisk: role.hotShootingRisk === true,
        volumeStability: volume.volumeStability || null,
        consolidatedGroup: "ROLE_AND_VOLUME",
        authoritative: true,
      },
      normalizedSignal: Number(clamp(normalizedSignal, -1, 1).toFixed(3)),
      ...contributionsFromSignal(normalizedSignal),
      confidenceAdjustment: confAdj,
      riskAdjustment: riskFromFlags({
        elevate: role.hotShootingRisk === true || role.status === "BAD",
        monitor: role.status === "PARTIAL" || usage.status === "BAD",
      }),
      reason:
        (role.reasons || usage.reasons || []).slice(0, 2).join(" ") ||
        "Consolidated ROLE_AND_VOLUME from existing role/usage modules.",
    }),
    bridgedFrom: [
      "roleStabilityIntelligenceV1",
      "usageShareIntelligenceV1",
      "volumeProfileEngine",
      "roleChangeEngine",
      "playerRoleProfileV1",
      "playerRoleIdentityV1",
    ],
    authoritativeSource: "ROLE_AND_VOLUME",
  };
}

/**
 * Defensive archetype — one capped OPPONENT_AND_MATCHUP group contribution.
 */
export function bridgeDefensiveArchetype(ctx = {}, pick = {}) {
  const ohc =
    ctx.opponentHistoryComparison ||
    pick.decisionDataIntelligence?.opponentHistoryComparison ||
    evaluateOpponentHistoryComparison(pick, {
      dataCard: pick.wnbaDataCard,
      reader: pick.wnbaReader,
      side: ctx.finalSide || pick.side,
      line: pick.line,
    });
  const defense =
    ctx.opponentDefenseContext ||
    pick.opponentDefenseContext ||
    pick.defenseResult ||
    {};
  const comparison = ohc?.comparison || {};

  const hasOhc =
    comparison.agreement &&
    comparison.agreement !== "NO_HISTORY" &&
    !ohc?.opponentHistory?.noHistory;
  const hasDefense =
    defense &&
    (defense.defenseScore != null ||
      defense.paceProxy != null ||
      defense.source === "bdl_games_proxy");

  if (!hasOhc && !hasDefense) return null;

  let normalizedSignal = 0;
  let confAdj = 0;
  let risk = RISK_ADJUSTMENT.NEUTRAL;

  if (comparison.confidenceImpact === "BOOST") {
    normalizedSignal = sideToSignal(ctx.finalSide || pick.side, 0.3);
    confAdj = 3;
    if (comparison.riskImpact === "LOWER") risk = RISK_ADJUSTMENT.REDUCE;
  } else if (comparison.confidenceImpact === "REDUCE") {
    normalizedSignal = sideToSignal(ctx.finalSide || pick.side, -0.3);
    confAdj = -4;
    if (comparison.riskImpact === "RAISE") risk = RISK_ADJUSTMENT.MONITOR;
  }

  const defScore = numOrNull(defense.defenseScore);
  if (defScore !== null && normalizedSignal === 0) {
    // Higher opponent defense score = tougher matchup for Over scoring
    if (defScore >= 65) {
      normalizedSignal = -0.2;
      confAdj = Math.min(confAdj, -2);
    } else if (defScore <= 35) {
      normalizedSignal = 0.2;
      confAdj = Math.max(confAdj, 2);
    }
  }

  return {
    ...baseEngineSignal({
      engine: "defensiveArchetypeEngine",
      available: true,
      source: "opponentHistoryComparisonV1+defenseContext",
      sourceIds: { bridgedFrom: "OPPONENT_AND_MATCHUP" },
      sampleSize: num(ohc?.opponentHistory?.sampleSize, hasDefense ? 1 : 0),
      quality: hasOhc ? ENGINE_SIGNAL_QUALITY.USABLE : ENGINE_SIGNAL_QUALITY.DEVELOPING,
      rawValues: {
        agreement: comparison.agreement || null,
        confidenceImpact: comparison.confidenceImpact || null,
        riskImpact: comparison.riskImpact || null,
        defenseScore: defScore,
        defenseSource: defense.source || null,
        paceProxy: defense.paceProxy ?? null,
        distinguishableRaw: {
          opponentHistoryComparison: ohc || null,
          defenseScoreEngine: defense.defenseScore != null ? { defenseScore: defScore } : null,
          wnbaOpponentContext: defense.source ? { source: defense.source } : null,
        },
        cappedGroup: "OPPONENT_AND_MATCHUP",
        authoritative: true,
      },
      normalizedSignal: Number(clamp(normalizedSignal, -1, 1).toFixed(3)),
      ...contributionsFromSignal(normalizedSignal),
      confidenceAdjustment: confAdj,
      riskAdjustment: risk,
      reason: "Consolidated OPPONENT_AND_MATCHUP from existing defense/opponent modules.",
    }),
    bridgedFrom: [
      "opponentHistoryComparisonV1",
      "defenseScoreEngine",
      "wnbaOpponentContextService",
    ],
    authoritativeSource: "OPPONENT_AND_MATCHUP",
  };
}

/**
 * Projection sanity — wraps DDI projectionQuality / evidence path (not a 2nd projection engine).
 */
export function bridgeProjectionSanity(ctx = {}, pick = {}) {
  const pq =
    ctx.projectionQuality ||
    pick.decisionDataIntelligence?.projectionQuality ||
    null;
  if (!pq || pq.score == null) return null;

  const status = String(pq.status || "").toUpperCase();
  let confAdj = 0;
  let risk = RISK_ADJUSTMENT.NEUTRAL;
  let normalizedSignal = 0;

  if (status === "WEAK") {
    confAdj = -6;
    risk = RISK_ADJUSTMENT.MONITOR;
    normalizedSignal = sideToSignal(pq.sideImpact, 0.25);
  } else if (status === "MIXED") {
    confAdj = -3;
    risk = RISK_ADJUSTMENT.MONITOR;
  } else if (status === "STRONG") {
    confAdj = 2;
    normalizedSignal = sideToSignal(pq.sideImpact, 0.2);
  }

  if (pq.hotGameRisk) {
    confAdj -= 4;
    risk = RISK_ADJUSTMENT.ELEVATE;
  }

  return {
    ...baseEngineSignal({
      engine: "projectionSanityEngine",
      available: true,
      source: "decisionDataIntelligence.projectionQuality",
      sourceIds: { bridgedFrom: "projectionQuality" },
      sampleSize: 1,
      quality: qualityFromStatus(status),
      rawValues: {
        projectionQualityScore: pq.score,
        projectionQualityStatus: status,
        supportedByUsage: pq.supportedByUsage === true,
        supportedByMinutes: pq.supportedByMinutes === true,
        supportedByMarket: pq.supportedByMarket === true,
        hotGameRisk: pq.hotGameRisk === true,
        evaluatorOnly: true,
        authoritative: true,
      },
      normalizedSignal: Number(clamp(normalizedSignal, -1, 1).toFixed(3)),
      ...contributionsFromSignal(normalizedSignal),
      confidenceAdjustment: confAdj,
      riskAdjustment: risk,
      reason: (pq.reasons || []).slice(0, 2).join(" ") || `Projection quality ${status}.`,
    }),
    bridgedFrom: ["decisionDataIntelligenceV1.projectionQuality", "evidenceFinalConfidenceV1"],
    authoritativeSource: "projectionQuality",
  };
}

/**
 * Teammate impact — from availabilityImpact teammate lists + usage share (not same-team arbitration).
 */
export function bridgeTeammateImpact(ctx = {}, pick = {}) {
  const impact =
    ctx.availabilityImpact ||
    pick.decisionDataIntelligence?.availabilityImpact ||
    null;
  const usage =
    ctx.usageShare ||
    pick.decisionDataIntelligence?.usageShare ||
    null;
  if (!impact && !usage) return null;

  const boosts = impact?.teammateBoosts || [];
  const reductions = impact?.teammateReductions || [];
  if (!boosts.length && !reductions.length && usage?.status !== "BAD") return null;

  let normalizedSignal = 0;
  let confAdj = 0;
  if (boosts.length) {
    normalizedSignal = 0.35;
    confAdj = 3;
  }
  if (reductions.length) {
    normalizedSignal = -0.35;
    confAdj = -4;
  }

  return {
    ...baseEngineSignal({
      engine: "teammateImpactEngine",
      available: true,
      source: "availabilityImpactV1+usageShareIntelligenceV1",
      sourceIds: { bridgedFrom: "teammateAvailability" },
      sampleSize: boosts.length + reductions.length || 1,
      quality: ENGINE_SIGNAL_QUALITY.USABLE,
      rawValues: {
        teammateBoosts: boosts,
        teammateReductions: reductions,
        usageShareStatus: usage?.status || null,
        separateFromSameTeamArbitration: true,
        authoritative: true,
      },
      normalizedSignal,
      ...contributionsFromSignal(normalizedSignal),
      confidenceAdjustment: confAdj,
      riskAdjustment: reductions.length ? RISK_ADJUSTMENT.MONITOR : RISK_ADJUSTMENT.NEUTRAL,
      reason: boosts[0] || reductions[0] || "Teammate availability impact bridged.",
    }),
    bridgedFrom: ["availabilityImpactV1", "usageShareIntelligenceV1"],
    authoritativeSource: "availabilityImpactV1.teammate",
  };
}

/**
 * Harvest all bridges that have upstream data. Returns a partial engines map.
 */
export function harvestLegacyBridges(ctx = {}, pick = {}) {
  const sourcePick = pick || ctx.pick || {};
  const out = {};

  const line = bridgeLineMovementClv(ctx, sourcePick);
  if (line) out.lineMovementClvEngine = line;

  const avail = bridgeAvailabilityRoster(ctx, sourcePick);
  if (avail) out.availabilityRosterEngine = avail;

  const role = bridgeRoleVelocity(ctx, sourcePick);
  if (role) out.roleVelocityEngine = role;

  const defense = bridgeDefensiveArchetype(ctx, sourcePick);
  if (defense) out.defensiveArchetypeEngine = defense;

  const proj = bridgeProjectionSanity(ctx, sourcePick);
  if (proj) out.projectionSanityEngine = proj;

  const teammate = bridgeTeammateImpact(ctx, sourcePick);
  if (teammate) out.teammateImpactEngine = teammate;

  return out;
}

export const BRIDGE_OWNED_DDI_GROUPS = Object.freeze([
  "MARKET",
  "AVAILABILITY_AND_TEAMMATE",
  "ROLE_AND_VOLUME",
  "OPPONENT_AND_MATCHUP",
  "PROJECTION",
]);
