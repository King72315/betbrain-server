/**
 * Canonical player forecast packet + research universe + Official membership
 * Forecast layer never sees board size / side quotas.
 */
import { ARCHITECTURE_BUILD, FORECAST_MODEL_VERSION, MEMBERSHIP_VERSION, RESEARCH_UNIVERSE_VERSION } from "./versions.js";
import { buildPlayerMinutesModelV1 } from "./playerMinutesModelV1.js";
import { buildPlayerRoleStabilityEngineV1 } from "./playerRoleStabilityEngineV1.js";
import { buildPlayerScoringOpportunityModelV1 } from "./playerScoringOpportunityModelV1.js";
import { buildPlayerPointsDistributionEngineV1 } from "./playerPointsDistributionEngineV1.js";
import { buildPlayerPropMarketModelV1 } from "./playerPropMarketModelV1.js";
import { buildPredictionConflictIndexV1 } from "./predictionConflictIndexV1.js";
import {
  buildPlayerBlowoutSensitivityEngineV1,
  buildPropFailurePathEngineV1,
} from "./propFailurePathEngineV1.js";
import {
  buildPropSafetyEngineV1,
  classifyRiskV1,
  resolveAvailabilityCertainty,
} from "./propSafetyEngineV1.js";
import {
  classifyRiskEmpiricalV2,
  computeReliabilityProbabilityV2,
} from "../empiricalSafePropV2/reliabilityModelV2.js";
import {
  EMPIRICAL_SAFE_PROP_V2_BUILD,
  EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
  MEMBERSHIP_VERSION_V2,
} from "../empiricalSafePropV2/versions.js";
import { persistResearchUniversePacketsV2 } from "../empiricalSafePropV2/researchPacketPersistenceV2.js";
import { annotateSlateRelativeStrengthV1 } from "../empiricalSafePropV2/slateRelativeStrengthV1.js";
import { buildEmpiricalRiskExplanationV2 } from "../empiricalSafePropV2/explanationsV2.js";
import { computeCalibrationHashV2 } from "../empiricalSafePropV2/prospectiveSlateFreezeV2.js";
import { isEmpiricalSafePropV2Enabled } from "../topProps/courtEdgeFeatureFlagsV1.js";
import {
  decideDirectionalSideV1,
  EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE,
  EMPIRICAL_DIRECTION_V1_BUILD,
} from "../empiricalDirectionV1/index.js";
import {
  isEmpiricalDirectionV1Enabled,
  isDirectionNoBetBlockingOfficial,
  getOfficialBoardSizePolicy,
} from "../empiricalDirectionV1/featureFlag.js";
import { decideDirectionalSideV2 } from "../empiricalDirectionV2/index.js";

function hasHardIntegrityBlock(risk = {}) {
  const reasons = [
    ...(risk.reasons || []),
    ...(risk.officialRejectionReasons || []),
    ...(risk.integrityVetoes || []),
  ].map((r) => String(r || ""));
  return reasons.some(
    (r) =>
      r.startsWith("integrity:") ||
      r.includes("CONFIRMED_INACTIVE") ||
      r.includes("WRONG_DATE") ||
      r.includes("WRONG_EVENT") ||
      r.includes("PLAYER_IDENTITY") ||
      r.includes("POST_START_MUTATION")
  );
}

function isDirectionV2ShadowEnabled(options = {}) {
  if (options.directionV2Shadow === false) return false;
  if (options.directionV2Shadow === true) return true;
  return (
    String(process.env.DIRECTION_V2_SHADOW || "").toLowerCase() === "true"
  );
}

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function normalizeSide(side = "") {
  const s = String(side || "").toUpperCase();
  if (s.startsWith("OVER")) return "OVER";
  if (s.startsWith("UNDER")) return "UNDER";
  return null;
}

function playerKey(pick = {}) {
  return [
    pick.playerId || pick.player_id || "",
    String(pick.playerName || pick.player || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
    pick.eventId || pick.gameId || "",
    pick.line ?? pick.selectedLine ?? "",
  ].join("|");
}

function computeSideEdges(side, line, projection, fairLine) {
  const projectionEdge =
    side === "OVER" && line != null && projection != null
      ? projection - line
      : side === "UNDER" && line != null && projection != null
        ? line - projection
        : null;
  const fairLineEdge =
    side === "OVER" && line != null && fairLine != null
      ? fairLine - line
      : side === "UNDER" && line != null && fairLine != null
        ? line - fairLine
        : null;
  let projectionFairAgreement = null;
  if (projectionEdge != null && fairLineEdge != null) {
    projectionFairAgreement =
      Math.sign(projectionEdge) === Math.sign(fairLineEdge) ||
      Math.abs(projectionEdge) < 0.5 ||
      Math.abs(fairLineEdge) < 0.5;
  }
  return { projectionEdge, fairLineEdge, projectionFairAgreement };
}

function buildReliabilityFeatureV2(sidePacket) {
  return computeReliabilityProbabilityV2({
    rawWinProbability: num(sidePacket.rawWinProbability),
    SafetyScore: num(sidePacket.safety?.finalSafetyScore),
    projectionEdge: num(sidePacket.projectionEdge),
    minutesStability: num(sidePacket.minutes?.minutesStabilityScore),
    roleStability: num(sidePacket.role?.roleStabilityScore),
    marketQuality: num(sidePacket.market?.marketQualityScore),
    conflictIndex: num(sidePacket.conflict?.conflictIndex),
    bookCount: num(sidePacket.market?.bookCount),
  });
}

/**
 * Apply C2 (or V1) membership risk classification to one already-built side packet.
 * Used after Direction selects the canonical side.
 */
export function applyMembershipRiskToSidePacketV1(sidePacket = {}, options = {}) {
  const stamped = sidePacket.sourcePick || {
    side: sidePacket.side,
    pick: sidePacket.side,
    line: sidePacket.line,
    projection: sidePacket.projection,
    fairLine: sidePacket.fairLine,
  };
  const riskCtx = {
    pick: stamped,
    rawWinProbability: sidePacket.rawWinProbability ?? 0.5,
    safety: sidePacket.safety,
    minutes: sidePacket.minutes,
    role: sidePacket.role,
    market: sidePacket.market,
    conflict: sidePacket.conflict,
    failure: sidePacket.failure,
    availability: sidePacket.availability,
    blowout: sidePacket.blowout,
    volume: sidePacket.volume,
    distribution: sidePacket.distribution,
  };
  const riskV1 = classifyRiskV1(riskCtx);
  const risk = isEmpiricalSafePropV2Enabled(options)
    ? classifyRiskEmpiricalV2(riskCtx)
    : riskV1;

  return {
    ...sidePacket,
    projectionEdge: risk.projectionEdge ?? sidePacket.projectionEdge,
    fairLineEdge: risk.fairEdge ?? sidePacket.fairLineEdge,
    projectionFairAgreement:
      risk.projectionFairAgreement ?? sidePacket.projectionFairAgreement,
    risk: {
      ...risk,
      membershipStageApplied: true,
      membershipStage: options.membershipStage || "STANDALONE",
    },
    riskV1Legacy: riskV1,
    reliabilityProbability:
      risk.reliabilityProbability ?? sidePacket.reliabilityProbability ?? null,
    safePathway: risk.safePathway ?? null,
    architectureBuild: isEmpiricalSafePropV2Enabled(options)
      ? EMPIRICAL_SAFE_PROP_V2_BUILD
      : ARCHITECTURE_BUILD,
  };
}

function markOppositeSideNotSelected(sidePacket = {}) {
  return {
    ...sidePacket,
    risk: {
      risk: "NOT_SELECTED",
      officialEligible: false,
      deferred: false,
      membershipStageApplied: false,
      membershipStage: "SKIPPED_OPPOSITE_SIDE",
      reliabilityProbability: sidePacket.reliabilityProbability ?? null,
      projectionEdge: sidePacket.projectionEdge ?? null,
      fairEdge: sidePacket.fairLineEdge ?? null,
      projectionFairAgreement: sidePacket.projectionFairAgreement ?? null,
      reasons: ["OPPOSITE_SIDE_NOT_SELECTED_AFTER_DIRECTION"],
    },
    safePathway: null,
  };
}

/**
 * Evaluate one side packet (Over or Under) without board context.
 *
 * options.applyRiskClassification:
 *   true (default)  — full C2/V1 risk (standalone / legacy dual-side path)
 *   false           — forecast features + reliability feature only (Direction prep)
 */
export function evaluateSideForecastPacketV1(pick = {}, options = {}) {
  const side = normalizeSide(pick.side || pick.pick);
  const stamped = { ...pick, side };
  const minutes = buildPlayerMinutesModelV1(stamped);
  const role = buildPlayerRoleStabilityEngineV1(stamped);
  const volume = buildPlayerScoringOpportunityModelV1(stamped, minutes);
  const distribution = buildPlayerPointsDistributionEngineV1(
    stamped,
    minutes,
    volume,
    {
      simulationCount: options.simulationCount,
      seed: options.seed ?? hashSeed(playerKey(stamped) + side),
    }
  );
  const market = buildPlayerPropMarketModelV1(stamped);
  const availability = resolveAvailabilityCertainty(stamped);
  const blowout = buildPlayerBlowoutSensitivityEngineV1(stamped, minutes);
  const conflict = buildPredictionConflictIndexV1({
    pick: stamped,
    minutes,
    role,
    volume,
    distribution,
    market,
    availabilityCertaintyScore: availability.availabilityCertaintyScore,
  });
  const failure = buildPropFailurePathEngineV1({
    pick: stamped,
    minutes,
    role,
    volume,
    market,
    blowout,
    conflict,
  });

  const rawWinProbability =
    side === "OVER"
      ? distribution.POver
      : side === "UNDER"
        ? distribution.PUnder
        : null;

  const safety = buildPropSafetyEngineV1({
    rawWinProbability: rawWinProbability ?? 0.5,
    minutes,
    role,
    distribution,
    market,
    conflict,
    failure,
    availability,
  });

  const line = num(stamped.line ?? stamped.selectedLine);
  const projection =
    num(stamped.projection) ??
    num(stamped.projectedPoints) ??
    num(stamped.finalProjection);
  const fairLine = num(stamped.fairLine) ?? num(stamped.fair_line);
  const edges = computeSideEdges(side, line, projection, fairLine);

  const v2On = isEmpiricalSafePropV2Enabled(options);
  let reliabilityProbability = null;
  let reliabilityBand = null;
  if (v2On) {
    const rel = buildReliabilityFeatureV2({
      rawWinProbability,
      safety,
      projectionEdge: edges.projectionEdge,
      minutes,
      role,
      market,
      conflict,
    });
    reliabilityProbability = rel.reliabilityProbability;
    reliabilityBand = rel.reliabilityBand;
  }

  const applyRisk = options.applyRiskClassification !== false;
  let risk;
  let riskV1 = null;
  let safePathway = null;

  if (applyRisk) {
    const applied = applyMembershipRiskToSidePacketV1(
      {
        side,
        line,
        projection,
        fairLine,
        projectionEdge: edges.projectionEdge,
        fairLineEdge: edges.fairLineEdge,
        projectionFairAgreement: edges.projectionFairAgreement,
        minutes,
        role,
        volume,
        distribution,
        market,
        blowout,
        conflict,
        failure,
        availability,
        safety,
        rawWinProbability,
        reliabilityProbability,
        sourcePick: stamped,
      },
      options
    );
    risk = applied.risk;
    riskV1 = applied.riskV1Legacy;
    safePathway = applied.safePathway;
    reliabilityProbability =
      applied.reliabilityProbability ?? reliabilityProbability;
  } else {
    // Direction-prep only: reliability is an evidence feature, not membership.
    risk = {
      risk: null,
      officialEligible: false,
      deferred: true,
      membershipStageApplied: false,
      membershipStage: "AWAITING_DIRECTION",
      reliabilityProbability,
      reliabilityBand,
      projectionEdge: edges.projectionEdge,
      fairEdge: edges.fairLineEdge,
      projectionFairAgreement: edges.projectionFairAgreement,
      reasons: ["RISK_DEFERRED_UNTIL_DIRECTION"],
    };
  }

  return {
    forecastModelVersion: FORECAST_MODEL_VERSION,
    architectureBuild: v2On ? EMPIRICAL_SAFE_PROP_V2_BUILD : ARCHITECTURE_BUILD,
    side,
    line,
    projection,
    fairLine,
    projectionEdge: edges.projectionEdge,
    fairLineEdge: edges.fairLineEdge,
    projectionFairAgreement: edges.projectionFairAgreement,
    minutes,
    role,
    volume,
    distribution,
    market,
    blowout,
    conflict,
    failure,
    availability,
    safety,
    risk,
    riskV1Legacy: riskV1,
    reliabilityProbability,
    safePathway,
    rawWinProbability,
    calibratedWinProbability: null,
    probabilityCalibrationStatus: "INSUFFICIENT_SAMPLE",
    forcedSide: false,
    sourcePick: stamped,
  };
}

function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Build dual-side research packet for one player-market.
 * Does not know board size.
 *
 * Production order when EMPIRICAL_DIRECTION_V1 is on:
 *   features (+ reliability feature) → Direction → selected side → C2 membership
 *
 * C2 LOW/MEDIUM/HIGH is never assigned to a side before Direction selects it.
 */
export function buildCanonicalPlayerForecastPacketV1(basePick = {}, options = {}) {
  const line = num(basePick.line ?? basePick.selectedLine ?? basePick.officialLine);
  const overBase = {
    ...basePick,
    side: "OVER",
    pick: "OVER",
    line,
  };
  const underBase = {
    ...basePick,
    side: "UNDER",
    pick: "UNDER",
    line,
  };

  const directionOn = isEmpiricalDirectionV1Enabled(options);
  // Direction-first: defer membership risk until a side is chosen.
  // Reliability logistic still runs as a Direction evidence feature.
  const sideEvalOpts = directionOn
    ? { ...options, applyRiskClassification: false }
    : { ...options, applyRiskClassification: true };

  let overPacket = evaluateSideForecastPacketV1(overBase, sideEvalOpts);
  let underPacket = evaluateSideForecastPacketV1(underBase, sideEvalOpts);

  const overScore =
    (overPacket.rawWinProbability ?? 0) * 0.55 +
    (overPacket.safety.finalSafetyScore ?? 0) / 100 * 0.45;
  const underScore =
    (underPacket.rawWinProbability ?? 0) * 0.55 +
    (underPacket.safety.finalSafetyScore ?? 0) / 100 * 0.45;

  let direction = null;
  let selectedSide;
  let forcedNoBet = false;

  const noBetBlocksOfficial = isDirectionNoBetBlockingOfficial(options);
  let directionAdmission = null;

  if (directionOn) {
    direction = decideDirectionalSideV1({
      overPacket,
      underPacket,
      basePick,
    });
    if (direction.decision === "OVER" || direction.decision === "UNDER") {
      selectedSide = direction.decision;
      directionAdmission = "PRIMARY";
    } else {
      // Educated guess: always pick a side from evidence scores.
      // Closed-gate (optional) can still block Official via env flag.
      forcedNoBet = true;
      selectedSide = overScore >= underScore ? "OVER" : "UNDER";
      directionAdmission = "BEST_GUESS";
    }

    // C2 (or V1) membership only on the chosen side.
    const postDirOpts = { ...options, membershipStage: "POST_DIRECTION" };
    if (selectedSide === "OVER") {
      overPacket = applyMembershipRiskToSidePacketV1(overPacket, postDirOpts);
      underPacket = markOppositeSideNotSelected(underPacket);
    } else {
      underPacket = applyMembershipRiskToSidePacketV1(underPacket, postDirOpts);
      overPacket = markOppositeSideNotSelected(overPacket);
    }
  } else {
    selectedSide = overScore >= underScore ? "OVER" : "UNDER";
    directionAdmission = "SCORE_SIDE";
  }

  const selected =
    selectedSide === "OVER" ? overPacket : underPacket;
  const opposite =
    selectedSide === "OVER" ? underPacket : overPacket;

  const integrityBlocked = hasHardIntegrityBlock(selected.risk || {});
  // Product policy: every valid market is a candidate; board size is enforced later.
  // Optional closed-gate restores Direction NO BET → not Official.
  const closedGateBlocked =
    noBetBlocksOfficial &&
    (forcedNoBet ||
      direction?.decision === "NO_BET" ||
      direction?.officialDirectionEligible === false);

  const officialEligible = !integrityBlocked && !closedGateBlocked;

  return {
    playerId: basePick.playerId || basePick.player_id || null,
    playerName: basePick.playerName || basePick.player || null,
    teamId: basePick.teamId || null,
    team: basePick.team || basePick.teamKey || null,
    opponent: basePick.opponent || null,
    eventId: basePick.eventId || basePick.gameId || null,
    canonicalSlateDateCT:
      basePick.slateDate ||
      basePick.canonicalSlateDateCT ||
      basePick.gameDateCT ||
      null,
    market: selected.market,
    availability: selected.availability,
    minutesModel: selected.minutes,
    roleModel: selected.role,
    volumeModel: selected.volume,
    scoringModel: selected.volume,
    distribution: selected.distribution,
    overPacket,
    underPacket,
    selectedSide,
    selectedSideProbability: selected.rawWinProbability,
    oppositeSideProbability: opposite.rawWinProbability,
    selectedSideScore: selectedSide === "OVER" ? overScore : underScore,
    oppositeSideScore: selectedSide === "OVER" ? underScore : overScore,
    pipelineOrder: directionOn ? "DIRECTION_THEN_C2" : "LEGACY_DUAL_C2_THEN_SCORE",
    c2MembershipAppliedTo: directionOn ? selectedSide : "BOTH",
    direction: direction
      ? {
          decision: direction.decision,
          reason: direction.reason,
          confidence: direction.confidence,
          marketConflict: direction.marketConflict,
          officialDirectionEligible: direction.officialDirectionEligible,
          admission: directionAdmission,
          directionAdmission,
          boardSide: selectedSide,
          educatedGuess: directionAdmission === "BEST_GUESS",
          rescuePathway: null,
          freezeId: direction.freezeId,
          engineVersion: direction.engineVersion,
          over: direction.over,
          under: direction.under,
        }
      : null,
    // STUDY/SHADOW only — never Official authority.
    directionV2Shadow: (() => {
      if (!directionOn || !isDirectionV2ShadowEnabled(options)) return null;
      try {
        const shadow = decideDirectionalSideV2({
          overPacket,
          underPacket,
          basePick,
          options,
        });
        return {
          decision: shadow.decision,
          reason: shadow.reason,
          confidence: shadow.confidence,
          admission: shadow.admission,
          directionAdmission: shadow.directionAdmission,
          rescuePathway: shadow.directionRescuePathway,
          marketConflict: shadow.marketConflict,
          stage: shadow.stage,
          studyId: shadow.studyId,
          build: shadow.build,
          productionAuthority: false,
        };
      } catch {
        return null;
      }
    })(),
    probability: {
      rawWinProbability: selected.rawWinProbability,
      calibratedWinProbability: null,
      probabilityCalibrationStatus: "INSUFFICIENT_SAMPLE",
    },
    uncertainty: {
      distributionWidth: selected.distribution.distributionWidth,
      conflictIndex: selected.conflict.conflictIndex,
    },
    safety: selected.safety,
    risk: {
      ...selected.risk,
      officialEligible,
      directionDecision: direction?.decision || null,
      directionAdmission,
      boardSide: selectedSide,
      blockedByDirectionNoBet: noBetBlocksOfficial && forcedNoBet,
      educatedGuess: directionAdmission === "BEST_GUESS",
    },
    riskV1Legacy: selected.riskV1Legacy,
    reliabilityProbability:
      selected.reliabilityProbability ?? selected.risk?.reliabilityProbability,
    trustScore: selected.risk?.trustScore ?? null,
    trustComponents: selected.risk?.trustComponents ?? null,
    safePathway: selected.safePathway ?? selected.risk?.safePathway,
    pathwayMatched: selected.risk?.pathwayMatched ?? false,
    pathwayScore: selected.risk?.pathwayScore ?? 0,
    pathwayEvidence: selected.risk?.pathwayEvidence ?? [],
    membership: {
      officialEligible,
      risk: selected.risk?.risk,
      wouldPassLowGate: selected.risk?.wouldPassLowGate,
      wouldPassMediumGate: selected.risk?.wouldPassMediumGate,
      safePathway: selected.risk?.safePathway ?? null,
      reliabilityProbability: selected.risk?.reliabilityProbability ?? null,
      trustScore: selected.risk?.trustScore ?? null,
      directionDecision: direction?.decision || null,
      directionAdmission,
      boardSide: selectedSide,
      blockedByDirectionNoBet: noBetBlocksOfficial && forcedNoBet,
      educatedGuess: directionAdmission === "BEST_GUESS",
      requiresDirectionApproval: noBetBlocksOfficial && directionOn,
      pipelineOrder: directionOn ? "DIRECTION_THEN_C2" : "LEGACY_DUAL_C2_THEN_SCORE",
      boardPolicy: "SAFEST_TOP_N_EDUCATED_GUESS",
    },
    forecastModelVersion: FORECAST_MODEL_VERSION,
    architectureBuild: isEmpiricalSafePropV2Enabled(options)
      ? EMPIRICAL_SAFE_PROP_V2_BUILD
      : ARCHITECTURE_BUILD,
    directionBuild: directionOn ? EMPIRICAL_DIRECTION_V1_BUILD : null,
    directionFreeze: directionOn ? EMPIRICAL_DIRECTION_V1_PRODUCTION_FREEZE : null,
    predictionCreatedAt: new Date().toISOString(),
    forcedSide: false,
  };
}

/**
 * Research universe: evaluate all candidates, preserve HIGH.
 */
export function buildResearchUniverseV1(candidates = [], options = {}) {
  const packets = [];
  for (const c of candidates) {
    try {
      packets.push(buildCanonicalPlayerForecastPacketV1(c, options));
    } catch (err) {
      packets.push({
        error: String(err.message || err),
        playerName: c.playerName || c.player,
        researchEligible: true,
        officialEligible: false,
        risk: { risk: "HIGH", officialEligible: false },
      });
    }
  }

  const low = packets.filter((p) => p.risk?.risk === "LOW");
  const medium = packets.filter((p) => p.risk?.risk === "MEDIUM");
  const high = packets.filter(
    (p) => p.risk?.risk === "HIGH" || !p.risk?.risk
  );
  const noBet = packets.filter(
    (p) => p.direction?.decision === "NO_BET" || p.membership?.blockedByDirectionNoBet
  );
  const directed = packets.filter(
    (p) =>
      p.direction?.decision === "OVER" || p.direction?.decision === "UNDER"
  );
  const officialEligible = packets.filter(
    (p) => p.membership?.officialEligible === true
  );

  return {
    version: RESEARCH_UNIVERSE_VERSION,
    architectureBuild: ARCHITECTURE_BUILD,
    totalValidPlayerMarkets: packets.length,
    researchUniverseSize: packets.length,
    dualSidePacketCount: packets.length * 2,
    LOW: low.length,
    MEDIUM: medium.length,
    HIGH: high.length,
    packets,
    counts: {
      LOW: low.length,
      MEDIUM: medium.length,
      HIGH: high.length,
      Official: officialEligible.length,
      researchOnly: packets.length - officialEligible.length,
      DIRECTION_OVER: directed.filter((p) => p.direction?.decision === "OVER").length,
      DIRECTION_UNDER: directed.filter((p) => p.direction?.decision === "UNDER").length,
      NO_BET: noBet.length,
    },
  };
}

function safetyRankKey(packet) {
  // Prefer reliability, then TrustScore, then SafetyScore, then rawP
  const rel =
    packet.reliabilityProbability ?? packet.risk?.reliabilityProbability ?? 0;
  const trust = packet.trustScore ?? packet.risk?.trustScore ?? 0;
  const s = packet.safety?.finalSafetyScore ?? 0;
  const p =
    packet.probability?.rawWinProbability ?? packet.selectedSideProbability ?? 0;
  if (packet.reliabilityProbability != null || packet.risk?.reliabilityProbability != null) {
    return rel * 1e6 + trust * 1e3 + p * 100 + s;
  }
  return s * 1000 + p * 100;
}

/**
 * Official membership: every valid market gets an educated side guess, then
 * keep only the safest 2–6 (LOW → MEDIUM → HIGH by trust/safety rank).
 */
export function selectOfficialBoardFromProbabilitySafetyV1(
  candidates = [],
  options = {}
) {
  const research = buildResearchUniverseV1(candidates, options);
  const sizePolicy = getOfficialBoardSizePolicy(options);

  // Persist every research packet (including HIGH) — never counts-only
  try {
    const slateDateCT =
      options.requestedSlateDate ||
      candidates[0]?.slateDate ||
      candidates[0]?.canonicalSlateDateCT ||
      null;
    if (slateDateCT && research.packets?.length) {
      persistResearchUniversePacketsV2({
        slateDateCT,
        packets: research.packets,
        researchUniverse: research.counts,
        meta: { source: "selectOfficialBoardFromProbabilitySafetyV1" },
      });
    }
  } catch {
    // persistence must never break Official selection
  }

  const v2On = isEmpiricalSafePropV2Enabled(options);
  let calibrationHash = null;
  if (v2On) {
    try {
      calibrationHash = computeCalibrationHashV2();
    } catch {
      calibrationHash = null;
    }
  }

  // Annotate full research universe with slate-relative ranks (not just Official)
  const rankedResearch = annotateSlateRelativeStrengthV1(
    (research.packets || []).map((p) => ({
      ...p,
      reliabilityProbability:
        p.reliabilityProbability ?? p.risk?.reliabilityProbability,
      trustScore: p.trustScore ?? p.risk?.trustScore,
      SafetyScore: p.safety?.finalSafetyScore,
      rawWinProbability:
        p.probability?.rawWinProbability ?? p.selectedSideProbability,
    }))
  );
  const rankByKey = new Map(
    rankedResearch.map((p) => [
      p.playerKey || p.marketKey || `${p.playerName}|${p.selectedSide}|${p.line}`,
      p.slateRelativeStrength,
    ])
  );

  const rankedPool = rankedResearch
    .filter((p) => {
      if (p.membership?.officialEligible !== true) return false;
      // Optional closed-gate only.
      if (p.membership?.requiresDirectionApproval === true) {
        const d = p.direction?.decision || p.membership?.directionDecision;
        if (d !== "OVER" && d !== "UNDER") return false;
        if (p.membership?.blockedByDirectionNoBet === true) return false;
      }
      if (hasHardIntegrityBlock(p.risk || {})) return false;
      return true;
    })
    .sort((a, b) => {
      const riskOrder = { LOW: 0, MEDIUM: 1, HIGH: 2 };
      const ra = riskOrder[a.risk?.risk] ?? 9;
      const rb = riskOrder[b.risk?.risk] ?? 9;
      if (ra !== rb) return ra - rb;
      return safetyRankKey(b) - safetyRankKey(a);
    });

  // Keep only the safest 2–6. If fewer than min exist, take all available.
  const takeN = Math.min(sizePolicy.max, rankedPool.length);
  const officialPackets = rankedPool.slice(0, takeN);

  const selectedProps = officialPackets.map((packet, index) => {
    const src = packet.selectedSide === "OVER"
      ? packet.overPacket?.sourcePick
      : packet.underPacket?.sourcePick;
    const sidePacket =
      packet.selectedSide === "OVER" ? packet.overPacket : packet.underPacket;
    const slateRel =
      packet.slateRelativeStrength ||
      rankByKey.get(
        packet.playerKey ||
          packet.marketKey ||
          `${packet.playerName}|${packet.selectedSide}|${packet.line}`
      );
    const decorated = decorateOfficialProp(packet, sidePacket, index, {
      v2On,
      slateRelativeStrength: slateRel,
      calibrationHash,
    });
    // Sync DI so Home/PropCard cannot prefer stale flood-gate trueRisk/confidence.
    const decisionIntelligence = {
      ...(src?.decisionIntelligence || {}),
      trueRisk: decorated.trueRisk,
      riskAfterDecision: decorated.riskLabel,
      finalConfidence: decorated.finalConfidence,
      signalStrength: decorated.signalStrength,
      confidenceOwner: decorated.confidenceOwner,
      riskOwner: decorated.riskOwner,
      signalOwner: decorated.signalOwner,
      directionDecision: decorated.directionDecision,
      directionConfidence: decorated.directionConfidence,
      directionAdmission: decorated.directionAdmission,
    };
    return {
      ...src,
      ...decorated,
      decisionIntelligence,
      confidence: decorated.confidence,
      finalConfidence: decorated.finalConfidence,
      winProbability: decorated.finalConfidence,
      signalStrength: decorated.signalStrength,
      signalLevel: decorated.signalLevel,
      trueRisk: decorated.trueRisk,
      displayTrueRisk: decorated.displayTrueRisk,
      riskLabel: decorated.riskLabel,
      riskAfterCeiling: decorated.riskAfterCeiling,
    };
  });

  const highCandidates = rankedResearch
    .filter((p) => p.risk?.risk === "HIGH" || p.membership?.officialEligible !== true)
    .sort((a, b) => safetyRankKey(b) - safetyRankKey(a))
    .slice(0, 10);

  return {
    version: v2On ? MEMBERSHIP_VERSION_V2 : MEMBERSHIP_VERSION,
    architectureBuild: v2On ? EMPIRICAL_SAFE_PROP_V2_BUILD : ARCHITECTURE_BUILD,
    membershipModel: v2On ? MEMBERSHIP_VERSION_V2 : MEMBERSHIP_VERSION,
    productionFreeze: v2On ? EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE : null,
    calibrationHash,
    selectedProps,
    officialCount: selectedProps.length,
    lowCount: selectedProps.filter((p) => p.trueRisk === "LOW").length,
    mediumCount: selectedProps.filter((p) => p.trueRisk === "MEDIUM").length,
    highBlocked: research.HIGH,
    topHighCandidates: highCandidates,
    research: { ...research, packets: rankedResearch },
    boardSizePolicy: sizePolicy.policy,
    officialBoardMin: sizePolicy.min,
    officialBoardMax: sizePolicy.max,
    officialPoolSize: rankedPool.length,
    forcedSide: false,
    noFixedSix: true,
    // Soft min: take up to max; if pool < min, board may be smaller (no fake fills).
    noMinimumCount: true,
    noSideQuota: true,
    v1ShadowEnabled: true,
  };
}

function riskCodeToLabel(code) {
  const c = String(code || "").toUpperCase();
  if (c === "LOW") return "Low Risk";
  if (c === "MEDIUM") return "Medium Risk";
  if (c === "HIGH") return "High Risk";
  return null;
}

/**
 * Official display meta owned by Direction × C2 — replaces legacy DDI/netEdge
 * confidence % and signalStrength for Probability Safety Official props.
 */
export function resolveOfficialDisplayMetaV1({
  directionDecision = null,
  directionConfidence = null,
  c2Risk = null,
  reliabilityProbability = null,
  trustScore = null,
  rawWinProbability = null,
} = {}) {
  const dir = String(directionDecision || "").toUpperCase();
  const directed = dir === "OVER" || dir === "UNDER";
  const riskCode = String(c2Risk || "HIGH").toUpperCase();
  const dirConf = String(directionConfidence || "NONE").toUpperCase();
  const rel = num(reliabilityProbability);
  const trust = num(trustScore);
  const rawP = num(rawWinProbability);

  let signalStrength = "WEAK";
  if (directed && riskCode === "LOW" && (dirConf === "STRONG" || dirConf === "STANDARD")) {
    signalStrength = "STRONG";
  } else if (directed && riskCode === "LOW") {
    signalStrength = "MODERATE";
  } else if (directed && riskCode === "MEDIUM" && dirConf === "STRONG") {
    signalStrength = "MODERATE";
  } else if (directed && riskCode === "MEDIUM" && dirConf === "STANDARD") {
    signalStrength = "MODERATE";
  } else if (directed && riskCode === "MEDIUM") {
    signalStrength = "WEAK";
  }

  // Direction categorical → base %, then soft C2/reliability lifts. Not legacy netEdge.
  let confidence =
    dirConf === "STRONG" ? 74 : dirConf === "STANDARD" ? 64 : dirConf === "WEAK" ? 54 : 50;
  if (riskCode === "LOW") confidence += 4;
  if (rel != null && rel >= 0.9) confidence += 4;
  else if (rel != null && rel >= 0.84) confidence += 2;
  if (trust != null && trust >= 80) confidence += 2;
  if (rawP != null) {
    confidence = Math.round(confidence * 0.65 + rawP * 100 * 0.35);
  }
  confidence = Math.max(48, Math.min(86, Math.round(confidence)));
  if (!directed || riskCode === "HIGH") {
    confidence = Math.min(confidence, 52);
    signalStrength = "WEAK";
  }

  return {
    trueRisk: riskCode,
    riskLabel: riskCodeToLabel(riskCode) || riskCode,
    riskAfterCeiling: riskCodeToLabel(riskCode) || riskCode,
    displayTrueRisk: riskCode,
    signalStrength,
    signalLevel: signalStrength,
    confidence,
    finalConfidence: confidence,
    directionAdmission: directed ? "PRIMARY" : null,
  };
}

function decorateOfficialProp(packet, sidePacket, index, opts = {}) {
  const v2On = opts.v2On === true;
  const risk = packet.risk || {};
  const riskV1 = packet.riskV1Legacy || sidePacket?.riskV1Legacy || null;
  const slateRel = opts.slateRelativeStrength || packet.slateRelativeStrength || null;
  const v2Risk = risk.risk;
  const v1Risk = riskV1?.risk ?? null;
  const riskCode = String((v2On ? v2Risk : v1Risk || v2Risk) || "HIGH").toUpperCase();
  const directionDecision = packet.direction?.decision ?? null;
  const directionConfidence = packet.direction?.confidence ?? null;
  const display = resolveOfficialDisplayMetaV1({
    directionDecision,
    directionConfidence,
    c2Risk: riskCode,
    reliabilityProbability:
      risk.reliabilityProbability ?? packet.reliabilityProbability ?? null,
    trustScore: risk.trustScore ?? packet.trustScore ?? null,
    rawWinProbability: packet.probability?.rawWinProbability ?? null,
  });
  const directionAdmission =
    packet.direction?.directionAdmission ||
    packet.membership?.directionAdmission ||
    (directionDecision === "OVER" || directionDecision === "UNDER"
      ? "PRIMARY"
      : packet.membership?.educatedGuess
        ? "BEST_GUESS"
        : null);
  const directed =
    Boolean(packet.selectedSide) &&
    (directionAdmission === "PRIMARY" ||
      directionAdmission === "BEST_GUESS" ||
      directionAdmission === "SCORE_SIDE" ||
      directionDecision === "OVER" ||
      directionDecision === "UNDER");

  return {
    side: packet.selectedSide,
    pick: packet.selectedSide,
    trueRisk: display.trueRisk,
    riskLabel: display.riskLabel,
    riskAfterCeiling: display.riskAfterCeiling,
    displayTrueRisk: display.displayTrueRisk,
    /** Production risk under Calibration 2 (champion). */
    v2Risk: v2On ? v2Risk : null,
    /** Shadow V1 giant-AND classification — comparison only, not Official authority. */
    v1Risk,
    riskV1Legacy: riskV1,
    safetyScore: packet.safety?.finalSafetyScore,
    SafetyScore: packet.safety?.finalSafetyScore,
    rawWinProbability: packet.probability?.rawWinProbability,
    reliabilityProbability:
      risk.reliabilityProbability ?? packet.reliabilityProbability ?? null,
    reliabilityBand: risk.reliabilityBand ?? null,
    trustScore: risk.trustScore ?? null,
    trustComponents: risk.trustComponents ?? null,
    trustBonuses: risk.trustBonuses ?? null,
    trustPenalties: risk.trustPenalties ?? null,
    safePathway: risk.safePathway ?? null,
    pathwayMatched: risk.pathwayMatched ?? false,
    pathwayScore: risk.pathwayScore ?? 0,
    pathwayEvidence: risk.pathwayEvidence ?? [],
    pathwayWarnings: risk.pathwayWarnings ?? [],
    calibratedWinProbability: null,
    probabilityCalibrationStatus: "INSUFFICIENT_SAMPLE",
    conflictIndex: packet.uncertainty?.conflictIndex,
    minutesStabilityScore: packet.minutesModel?.minutesStabilityScore,
    roleStabilityScore: packet.roleModel?.roleStabilityScore,
    marketQualityScore: packet.market?.marketQualityScore,
    bookCount: packet.market?.bookCount,
    expectedMinutes: packet.minutesModel?.expectedMinutes,
    projection: sidePacket?.projection ?? packet.projection,
    projectionEdge: sidePacket?.projectionEdge,
    fairLineEdge: sidePacket?.fairLineEdge,
    fairLine: sidePacket?.fairLine ?? packet.fairLine,
    edge: sidePacket?.projectionEdge,
    projectionFairAgreement: sidePacket?.projectionFairAgreement,
    supportingEvidenceFamilies:
      sidePacket?.conflict?.supportingEvidenceFamilies || [],
    opposingEvidenceFamilies:
      sidePacket?.conflict?.opposingEvidenceFamilies || [],
    failurePaths: sidePacket?.failure?.failurePaths || [],
    majorFailurePathCount: sidePacket?.failure?.majorFailurePathCount,
    safetyComponents: packet.safety?.safetyComponents,
    forecastPacket: packet,
    forecastModelVersion: packet.forecastModelVersion,
    minutesModelVersion: packet.minutesModel?.version,
    roleModelVersion: packet.roleModel?.version,
    distributionModelVersion: packet.distribution?.version,
    marketModelVersion: packet.market?.version,
    conflictModelVersion: sidePacket?.conflict?.version,
    safetyModelVersion: packet.safety?.version,
    membershipVersion: v2On ? MEMBERSHIP_VERSION_V2 : MEMBERSHIP_VERSION,
    architectureBuild: v2On ? EMPIRICAL_SAFE_PROP_V2_BUILD : ARCHITECTURE_BUILD,
    productionFreeze: v2On ? EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE : null,
    modelVersion: v2On
      ? EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE
      : MEMBERSHIP_VERSION,
    calibrationHash: opts.calibrationHash || null,
    pregameTimestamp: packet.predictionCreatedAt || new Date().toISOString(),
    safetyRank: index + 1,
    slateReliabilityRank: slateRel?.slateReliabilityRank ?? null,
    slateTrustRank: slateRel?.slateTrustRank ?? null,
    slatePercentile: slateRel?.slatePercentile ?? null,
    slateRelativeStrength: slateRel,
    officialEligible: true,
    // Direction × C2 owned display fields (override legacy src spread).
    confidence: display.confidence,
    finalConfidence: display.finalConfidence,
    winProbability: display.finalConfidence,
    signalStrength: display.signalStrength,
    signalLevel: display.signalLevel,
    directionDecision,
    directionReason: packet.direction?.reason ?? null,
    directionConfidence,
    directionAdmission: directed ? directionAdmission : null,
    admission: directed ? directionAdmission : null,
    educatedGuess: directionAdmission === "BEST_GUESS",
    rescuePathway: null,
    blockedByDirectionNoBet: Boolean(packet.membership?.blockedByDirectionNoBet),
    pipelineOrder: packet.pipelineOrder || packet.membership?.pipelineOrder || null,
    confidenceOwner: "probabilitySafetyV1.direction_x_c2",
    signalOwner: "probabilitySafetyV1.direction_x_c2",
    riskOwner: v2On
      ? "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2"
      : "probabilitySafetyV1",
    forcedSide: false,
    noFixedSix: true,
    noMinimumBoard: true,
    noTeamQuota: true,
    whyNotLow: risk.whyNotLow || [],
    riskExplanation: risk.explanation || null,
    membershipQualificationStatus:
      riskCode === "LOW" ? "QUALIFIED_LOW_RISK" : "QUALIFIED_MEDIUM_RISK",
  };
}

/**
 * Correlation audit — diagnostic only, no forced flips.
 */
export function buildPropCorrelationAuditV1(officialProps = []) {
  const byTeam = new Map();
  for (const p of officialProps) {
    const team = String(p.team || p.teamKey || "").toLowerCase();
    if (!byTeam.has(team)) byTeam.set(team, []);
    byTeam.get(team).push(p);
  }
  const audits = [];
  for (const [team, props] of byTeam) {
    if (props.length < 2) continue;
    audits.push({
      correlationFamily: `TEAM:${team}`,
      propCount: props.length,
      sharedUsageDependency: true,
      sharedBlowoutDependency: true,
      sharedInjuryDependency: true,
      sharedGameScriptDependency: true,
      correlationRisk: props.length >= 3 ? "ELEVATED" : "MODERATE",
      note: "Diagnostic only — no automatic deletion or side flip",
    });
  }
  return { version: "prop-correlation-audit-v1", audits };
}

export function buildRiskExplanationV1(prop = {}) {
  // Prefer V2 empirical explanation when reliability/trust/pathway present
  if (
    prop.reliabilityProbability != null ||
    prop.trustScore != null ||
    (prop.safePathway && prop.safePathway !== "NONE") ||
    prop.riskExplanation?.whyCourtEdgeTrustsIt
  ) {
    if (prop.riskExplanation?.plainLanguage) return prop.riskExplanation;
    return buildEmpiricalRiskExplanationV2(prop, prop.risk || null);
  }

  const risk = prop.trueRisk || prop.riskLabel || "HIGH";
  const whyLike = [];
  const whyNotLow = [];
  if ((prop.rawWinProbability ?? 0) >= 0.57) {
    whyLike.push(
      `${Math.round((prop.rawWinProbability || 0) * 100)}% modeled clear probability`
    );
  }
  if ((prop.minutesStabilityScore ?? 0) >= 75) {
    whyLike.push(
      `Stable ~${prop.expectedMinutes ?? "?"} minute role (stability ${prop.minutesStabilityScore})`
    );
  }
  if (prop.projectionFairAgreement) {
    whyLike.push("Projection and fair line agree");
  }
  const fams = prop.supportingEvidenceFamilies || [];
  if (fams.length) {
    whyLike.push(
      `${fams.length} independent evidence families support ${prop.side || prop.pick}`
    );
  }
  if ((prop.marketQualityScore ?? 0) >= 65) {
    whyLike.push("Strong market agreement / quality");
  }
  const fails = prop.failurePaths || [];
  const mainLose =
    fails[0]?.label ||
    (fails.length ? fails.map((f) => f.label).join("; ") : "Unexpected variance");

  if (risk === "MEDIUM" || risk === "HIGH") {
    if ((prop.minutesStabilityScore ?? 100) < 75) {
      whyNotLow.push(`Minutes stability ${prop.minutesStabilityScore}`);
    }
    // Role missing/unknown is not treated as "below threshold"
    if (prop.roleStabilityScore != null && prop.roleStabilityScore < 55) {
      whyNotLow.push(`Severe role instability ${prop.roleStabilityScore}`);
    }
    if ((prop.conflictIndex ?? 0) > 20) {
      whyNotLow.push(`Conflict index ${prop.conflictIndex}`);
    }
    if ((prop.majorFailurePathCount ?? 0) > 1) {
      whyNotLow.push(`${prop.majorFailurePathCount} meaningful failure paths`);
    }
    // Do not treat thin market quality as a LOW veto badge
  }

  return {
    risk,
    title: `${risk} RISK`,
    whyCourtEdgeLikesIt: whyLike,
    whyCourtEdgeTrustsIt: whyLike,
    whyItIsNotLow: whyNotLow,
    mainWayItLoses: mainLose,
    plainLanguage:
      risk === "LOW"
        ? `LOW RISK\n\nWhy CourtEdge trusts it:\n${whyLike.map((x) => `• ${x}`).join("\n")}\n\nMain way it loses:\n• ${mainLose}`
        : risk === "MEDIUM"
          ? `MEDIUM RISK\n\nWhy it qualifies:\n${whyLike.map((x) => `• ${x}`).join("\n")}\n\nWhy it isn't LOW:\n${whyNotLow.map((x) => `• ${x}`).join("\n")}`
          : `HIGH RISK — research only`,
  };
}
