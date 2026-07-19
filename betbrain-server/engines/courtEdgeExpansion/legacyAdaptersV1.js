/**
 * CourtEdge Engine Expansion — Legacy Module Adapters V1.1
 *
 * Consolidation layer: wrap EXISTING modules into one normalized upstream
 * evidence bag so expansion engines do not invent a second unrelated calc.
 *
 * Raw legacy modules may still diagnose; only the evidence-dedup ledger may
 * authoritatively modify confidence/risk after inclusion.
 */
import {
  interpretLineMovement,
  computeLineMovementAgainstSide,
  buildMarketIntelligence,
} from "../marketIntelligenceEngine.js";
import { evaluateMarketMovementIntelligence } from "../decisionIntelligence/marketMovementIntelligenceV1.js";
import { classifyWnbaInjuryStatus } from "../../services/wnbaAvailabilityService.js";
import { evaluateAvailabilityGate } from "../availabilityGateEngine.js";
import { evaluateAvailabilityImpact } from "../decisionIntelligence/availabilityImpactV1.js";
import { buildRoleChange } from "../roleChangeEngine.js";
import { buildVolumeProfile } from "../volumeProfileEngine.js";
import { evaluateRoleStabilityIntelligence } from "../decisionIntelligence/roleStabilityIntelligenceV1.js";
import { evaluateUsageShareIntelligence } from "../decisionIntelligence/usageShareIntelligenceV1.js";

export const LEGACY_ADAPTERS_VERSION = "courtedge-legacy-adapters-v1.1";

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avgField(logs = [], ...keys) {
  const vals = [];
  for (const row of logs || []) {
    for (const key of keys) {
      const n = num(row?.[key]);
      if (n !== null) {
        vals.push(n);
        break;
      }
    }
  }
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

function mapInjuryLevelToExpansionState(level = "") {
  const L = String(level || "").toUpperCase();
  if (L === "OUT") return "OUT";
  if (L === "LIMITED") return "DOUBTFUL";
  if (L === "QUESTIONABLE") return "QUESTIONABLE";
  if (L === "ACTIVE") return "CONFIRMED_ACTIVE";
  if (L === "UNKNOWN") return "STATUS_UNAVAILABLE";
  return null;
}

/**
 * Build normalized upstream evidence from existing modules.
 * Never throws — missing modules / empty ctx → honest null sections.
 */
export function buildLegacyUpstreamEvidence(ctx = {}, pick = {}) {
  const league = String(ctx.league || pick.league || "").toUpperCase() || "WNBA";
  const gameLogs = Array.isArray(ctx.gameLogs)
    ? ctx.gameLogs
    : Array.isArray(pick.gameLogs)
      ? pick.gameLogs
      : Array.isArray(pick.last10)
        ? pick.last10
        : [];
  const recent = gameLogs.slice(0, 5);
  const seasonish = gameLogs.slice(0, 20);

  const openingLine = num(ctx.openingLine ?? pick.openingLine);
  const currentLine = num(ctx.currentLine ?? ctx.line ?? pick.line);
  const lineDelta =
    openingLine != null && currentLine != null
      ? Number((currentLine - openingLine).toFixed(1))
      : 0;
  const finalSide = String(ctx.finalSide || pick.side || pick.pick || "").toUpperCase();

  let marketInterpretation = null;
  let marketIntelligence = null;
  let marketMovementDi = null;
  try {
    marketInterpretation = interpretLineMovement(finalSide, lineDelta);
    marketIntelligence = buildMarketIntelligence({
      prop: pick,
      marketSnapshot: {
        openingLine,
        currentLine,
        bookLine: currentLine,
      },
      side: finalSide,
      volumeProfile: pick.volumeProfile || {},
    });
    marketMovementDi = evaluateMarketMovementIntelligence(pick, {
      side: finalSide,
      marketIntelligence,
      dataCard: pick.wnbaDataCard,
    });
  } catch {
    // adapters must never break the expansion path
  }

  const injuryText =
    ctx.injuryRow?.status ||
    ctx.injuryRow?.description ||
    ctx.availabilityStatus ||
    pick.availabilityStatus ||
    "";
  let injuryClassification = null;
  try {
    injuryClassification = classifyWnbaInjuryStatus(injuryText);
  } catch {
    injuryClassification = null;
  }

  let availabilityGate = null;
  let availabilityImpact = null;
  try {
    availabilityGate = evaluateAvailabilityGate({
      playerStatus: injuryClassification?.level || ctx.availabilityStatus,
      injuryStatus: injuryText,
      teammateOut: Boolean((ctx.teammateStatuses || []).some((t) => /out/i.test(String(t?.status || "")))),
      usageBoost: pick.usageBoost || null,
    });
    availabilityImpact = evaluateAvailabilityImpact(pick, {
      availability: availabilityGate,
    });
  } catch {
    // keep null
  }

  const seasonMinutes = avgField(seasonish, "minutes", "min");
  const recentMinutes = avgField(recent, "minutes", "min");
  const seasonFGA = avgField(seasonish, "fga", "FGA");
  const recentFGA = avgField(recent, "fga", "FGA");
  const seasonFTA = avgField(seasonish, "fta", "FTA");
  const recentFTA = avgField(recent, "fta", "FTA");
  const seasonPoints = avgField(seasonish, "points", "pts", "PTS");
  const recentPoints = avgField(recent, "points", "pts", "PTS");

  let roleChange = null;
  let volumeProfile = null;
  let roleStability = null;
  let usageShare = null;
  try {
    roleChange = buildRoleChange(
      {
        league,
        seasonMinutes: seasonMinutes ?? 0,
        recentMinutes: recentMinutes ?? 0,
        seasonFGA: seasonFGA ?? 0,
        recentFGA: recentFGA ?? 0,
        seasonFTA: seasonFTA ?? 0,
        recentFTA: recentFTA ?? 0,
        seasonPoints: seasonPoints ?? 0,
        recentPoints: recentPoints ?? 0,
        dataAvailability: gameLogs.length,
        dataMode: league === "WNBA" ? "WNBA_FULL_DATA" : "NBA_FULL_DATA",
      },
      pick.usageBoost || null
    );
    volumeProfile = buildVolumeProfile({
      seasonFGA: seasonFGA ?? 0,
      recentFGA: recentFGA ?? 0,
      seasonFTA: seasonFTA ?? 0,
      recentFTA: recentFTA ?? 0,
      seasonMinutes: seasonMinutes ?? 0,
      recentMinutes: recentMinutes ?? 0,
      seasonPoints: seasonPoints ?? 0,
      recentPoints: recentPoints ?? 0,
    });
    roleStability = evaluateRoleStabilityIntelligence(pick, {
      roleChange,
      volumeProfile,
    });
    usageShare = evaluateUsageShareIntelligence(pick, {
      roleChange,
      volumeProfile,
    });
  } catch {
    // keep null
  }

  return {
    version: LEGACY_ADAPTERS_VERSION,
    league,
    market: {
      lineDelta,
      movedAgainst: computeLineMovementAgainstSide(finalSide, lineDelta),
      interpretation: marketInterpretation,
      marketIntelligence,
      marketMovementDi,
      sourceModules: [
        "marketIntelligenceEngine",
        "marketMovementIntelligenceV1",
        "lineIntegrityV1(read-only)",
      ],
    },
    availability: {
      injuryClassification,
      mappedExpansionState: mapInjuryLevelToExpansionState(injuryClassification?.level),
      availabilityGate,
      availabilityImpact,
      sourceModules: [
        "wnbaAvailabilityService",
        "availabilityGateEngine",
        "availabilityImpactV1",
      ],
    },
    roleAndVolume: {
      roleChange,
      volumeProfile,
      roleStability,
      usageShare,
      averages: {
        seasonMinutes,
        recentMinutes,
        seasonFGA,
        recentFGA,
        seasonFTA,
        recentFTA,
        seasonPoints,
        recentPoints,
      },
      sourceModules: [
        "roleChangeEngine",
        "volumeProfileEngine",
        "roleStabilityIntelligenceV1",
        "usageShareIntelligenceV1",
        "playerRoleProfileV1(upstream)",
        "playerRoleIdentityV1(upstream)",
      ],
    },
    opponent: {
      opponentDefenseContext:
        ctx.opponentDefenseContext || pick.opponentDefenseContext || pick.defenseResult || null,
      sourceModules: [
        "defenseScoreEngine",
        "wnbaOpponentContextService",
        "opponentHistoryComparisonV1",
      ],
    },
    ownership: {
      lineMovementAuthority: "lineMovementClvEngine+marketIntelligence",
      availabilityAuthority: "availabilityRosterEngine+wnbaAvailabilityService",
      roleAuthority: "roleVelocityEngine+ROLE_AND_VOLUME group",
      distributionAuthority: "distributionEngine+volatilityEngine",
      paceAuthority: "pacePossessionEngine(truePace)|scoringEnvironmentProxy(store-only)",
      restAuthority: "restFatigueEngine",
      teammateAuthority: "teammateImpactEngine",
      defenseAuthority: "defensiveArchetypeEngine+OPPONENT_AND_MATCHUP group",
      projectionAuthority: "projectionSanityEngine(evaluator-only)",
      confRiskAuthority: "evidenceDeduplicationEngine",
    },
  };
}

/**
 * Enrich expansion ctx with legacy upstream evidence (non-destructive).
 */
export function enrichCtxWithLegacyAdapters(ctx = {}, pick = {}) {
  if (ctx.legacyUpstream?.version === LEGACY_ADAPTERS_VERSION) {
    return ctx;
  }
  const legacyUpstream = buildLegacyUpstreamEvidence(ctx, pick);
  const mapped = legacyUpstream.availability?.mappedExpansionState;
  return {
    ...ctx,
    legacyUpstream,
    // Prefer already-classified availability when raw status was empty.
    availabilityStatus:
      ctx.availabilityStatus ||
      legacyUpstream.availability?.injuryClassification?.label ||
      ctx.availabilityStatus,
    availabilityMappedState: mapped || ctx.availabilityMappedState || null,
    opponentDefenseContext:
      ctx.opponentDefenseContext || legacyUpstream.opponent?.opponentDefenseContext || null,
    roleChange: ctx.roleChange || legacyUpstream.roleAndVolume?.roleChange || null,
    volumeProfile: ctx.volumeProfile || legacyUpstream.roleAndVolume?.volumeProfile || null,
    marketInterpretation:
      ctx.marketInterpretation || legacyUpstream.market?.interpretation || null,
    marketMovementDi: ctx.marketMovementDi || legacyUpstream.market?.marketMovementDi || null,
    lineDelta: ctx.lineDelta ?? legacyUpstream.market?.lineDelta ?? null,
  };
}
