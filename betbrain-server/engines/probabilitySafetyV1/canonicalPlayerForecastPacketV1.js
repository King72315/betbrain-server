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
import { buildPropSafetyEnvironmentV2 } from "./propSafetyEnvironmentV2.js";
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
} from "../empiricalDirectionV1/featureFlag.js";
import { decideDirectionalSideV2 } from "../empiricalDirectionV2/index.js";
import {
  CONTROL_PLANE_BUILD,
  selectOfficialMembershipV1,
  resolveC2RankScore,
  getOfficialBoardSizePolicy,
  stableMarketId,
} from "../courtEdgeControlPlaneV1/index.js";
import {
  applyPredictedProbabilityCalibrationV1,
  rebuildSafetyWithCalibratedProbabilityV1,
  PREDICTED_PROBABILITY_CALIBRATION_V1_BUILD,
} from "./predictedProbabilityCalibrationV1.js";
import {
  normalizePropTypeV1,
  propTypeStatLabel,
} from "../wnba/propTypeV1.js";
import { computeOfficialRankScoreV1 } from "../wnba/officialRankScoreV1.js";
import {
  resolveStatProbabilityV1,
  buildProjectionUncertaintyV1,
  getResidualSummaryForPropTypeV1,
  PROBABILITY_CALIBRATION_SOURCE_HISTORICAL_V1,
} from "../wnba/statResidualDistributionV1.js";
import { getCalibrationStatusForPropTypeV1 } from "../wnba/calibrationStatusByComponentV1.js";

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

/** Lower = safer C2 tier. */
function c2RiskTierRank(riskCode = "") {
  const r = String(riskCode || "").toUpperCase();
  if (r === "LOW") return 0;
  if (r === "MEDIUM") return 1;
  if (r === "HIGH") return 2;
  return 3;
}

/**
 * On Direction NO_BET: both sides already have C2 applied.
 * Keep the safer C2 side (tier, then reliability, then winP+safety score).
 * Does not retune Direction thresholds or C2 calibration.
 */
export function chooseSaferC2SideV1({
  overPacket = {},
  underPacket = {},
  overScore = 0,
  underScore = 0,
} = {}) {
  const overTier = c2RiskTierRank(overPacket.risk?.risk);
  const underTier = c2RiskTierRank(underPacket.risk?.risk);
  if (overTier !== underTier) {
    return {
      selectedSide: overTier < underTier ? "OVER" : "UNDER",
      reason: "BEST_GUESS_DUAL_C2_SAFER_TIER",
      overTier,
      underTier,
    };
  }

  const overRank = resolveC2RankScore({
    reliabilityProbability:
      overPacket.reliabilityProbability ?? overPacket.risk?.reliabilityProbability,
    trustScore: overPacket.risk?.trustScore,
    safety: overPacket.safety,
    risk: overPacket.risk,
  });
  const underRank = resolveC2RankScore({
    reliabilityProbability:
      underPacket.reliabilityProbability ??
      underPacket.risk?.reliabilityProbability,
    trustScore: underPacket.risk?.trustScore,
    safety: underPacket.safety,
    risk: underPacket.risk,
  });
  if (overRank !== underRank) {
    return {
      selectedSide: overRank >= underRank ? "OVER" : "UNDER",
      reason: "BEST_GUESS_DUAL_C2_SAFER_RANK",
      overRank,
      underRank,
    };
  }

  return {
    selectedSide: overScore >= underScore ? "OVER" : "UNDER",
    reason: "BEST_GUESS_DUAL_C2_SCORE_TIEBREAK",
    overScore,
    underScore,
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
  let distribution = buildPlayerPointsDistributionEngineV1(
    stamped,
    minutes,
    volume,
    {
      simulationCount: options.simulationCount,
      seed: options.seed ?? hashSeed(playerKey(stamped) + side),
    }
  );
  const sidePropType =
    normalizePropTypeV1(
      stamped.propType || stamped.canonicalPropType || stamped.stat
    ) || "POINTS";
  // REB/AST: replace Points MC variance with historical residual CDF when available.
  if (sidePropType === "REBOUNDS" || sidePropType === "ASSISTS") {
    const line = num(stamped.line ?? stamped.selectedLine ?? stamped.officialLine);
    const projection =
      num(stamped.projection) ??
      num(stamped.projectedPoints) ??
      num(stamped.finalProjection);
    const residualProb = resolveStatProbabilityV1({
      propType: sidePropType,
      projection,
      line,
      fallbackPOver: distribution.POver,
      fallbackPUnder: distribution.PUnder,
    });
    if (residualProb.usedResidualCdf) {
      distribution = {
        ...distribution,
        POver: residualProb.pOver,
        PUnder: residualProb.pUnder,
        probabilitySum:
          residualProb.pOver != null && residualProb.pUnder != null
            ? residualProb.pOver + residualProb.pUnder
            : distribution.probabilitySum,
        residualProbability: residualProb,
        probabilityCalibrationSource:
          residualProb.probabilityCalibrationSource ||
          PROBABILITY_CALIBRATION_SOURCE_HISTORICAL_V1,
        distributionAuthority: "HISTORICAL_STAT_RESIDUAL_V1",
      };
    } else {
      distribution = {
        ...distribution,
        residualProbability: residualProb,
        probabilityCalibrationSource:
          residualProb.probabilityCalibrationSource ||
          "PENDING_HISTORICAL_RESIDUAL",
        distributionAuthority: "FALLBACK_MC_UNTIL_RESIDUALS",
      };
    }
    const residualSummary = getResidualSummaryForPropTypeV1(sidePropType);
    distribution.projectionUncertainty = buildProjectionUncertaintyV1({
      propType: sidePropType,
      expectedValue: projection,
      residualSummary,
      cohortSource: "GOLD",
    });
  }
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

  // Safety = evidence-environment stability (not model belief strength).
  // Legacy winP-weighted Safety kept only when explicitly requested.
  const useEnvSafety = options.useSafetyEnvironmentV2 !== false;
  const safety = useEnvSafety
    ? buildPropSafetyEnvironmentV2({
        minutes,
        role,
        distribution,
        market,
        conflict,
        failure,
        availability,
      })
    : buildPropSafetyEngineV1({
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

  let directionAdmission = null;
  let directionResearchDecision = null;

  let bestGuessSideReason = null;
  let c2MembershipAppliedTo = null;

  if (directionOn) {
    direction = decideDirectionalSideV1({
      overPacket,
      underPacket,
      basePick,
    });
    directionResearchDecision = direction.decision || null;
    const postDirOpts = { ...options, membershipStage: "POST_DIRECTION" };

    if (direction.decision === "OVER" || direction.decision === "UNDER") {
      // PRIMARY: Direction owns the side; C2 ranks that side only.
      selectedSide = direction.decision;
      directionAdmission = "PRIMARY";
      c2MembershipAppliedTo = selectedSide;
      if (selectedSide === "OVER") {
        overPacket = applyMembershipRiskToSidePacketV1(overPacket, postDirOpts);
        underPacket = markOppositeSideNotSelected(underPacket);
      } else {
        underPacket = applyMembershipRiskToSidePacketV1(underPacket, postDirOpts);
        overPacket = markOppositeSideNotSelected(overPacket);
      }
    } else {
      // NO_BET → BEST_GUESS: run frozen C2 on BOTH sides, keep the safer one.
      // Prevents Aug-10-style boards that guessed a side before checking risk.
      forcedNoBet = true;
      directionAdmission = "BEST_GUESS";
      overPacket = applyMembershipRiskToSidePacketV1(overPacket, postDirOpts);
      underPacket = applyMembershipRiskToSidePacketV1(underPacket, postDirOpts);
      const safer = chooseSaferC2SideV1({
        overPacket,
        underPacket,
        overScore,
        underScore,
      });
      selectedSide = safer.selectedSide;
      bestGuessSideReason = safer.reason;
      c2MembershipAppliedTo = "BOTH_THEN_SAFER_SIDE";
      if (selectedSide === "OVER") {
        underPacket = markOppositeSideNotSelected(underPacket);
      } else {
        overPacket = markOppositeSideNotSelected(overPacket);
      }
    }
  } else {
    selectedSide = overScore >= underScore ? "OVER" : "UNDER";
    directionAdmission = "BEST_GUESS";
    directionResearchDecision = null;
    c2MembershipAppliedTo = "BOTH";
  }

  const selected =
    selectedSide === "OVER" ? overPacket : underPacket;
  const opposite =
    selectedSide === "OVER" ? underPacket : overPacket;

  const integrityBlocked = hasHardIntegrityBlock(selected.risk || {});
  const analysisEligible = !integrityBlocked;
  const boardCandidate =
    analysisEligible &&
    (selectedSide === "OVER" || selectedSide === "UNDER") &&
    (directionAdmission === "PRIMARY" || directionAdmission === "BEST_GUESS") &&
    Boolean(selected.risk?.risk);
  // Only the final selector may set officialSelected=true.
  const officialSelected = false;
  const officialEligible = false;

  // Probability transform under existing authority (shadow unless opted in).
  // Side selection already completed on raw distribution probs + frozen gates.
  // Environment Safety V2 must NOT be rebuilt from calibrated probability —
  // that would reintroduce belief into the stability score.
  const probabilityCalibration = applyPredictedProbabilityCalibrationV1(
    selected.rawWinProbability
  );
  const applyProbCalibLive = options.applyProbabilityCalibration === true;
  const predictedProbability = applyProbCalibLive
    ? probabilityCalibration.predictedProbability
    : selected.rawWinProbability;
  const envSafetyActive = options.useSafetyEnvironmentV2 !== false;
  const safetyOut = envSafetyActive
    ? selected.safety
    : (() => {
        const safetyWithCalibratedProbability =
          rebuildSafetyWithCalibratedProbabilityV1({
            safety: selected.safety,
            calibratedProbability: probabilityCalibration.predictedProbability,
            rawWinProbability: selected.rawWinProbability,
          });
        return applyProbCalibLive
          ? safetyWithCalibratedProbability
          : {
              ...selected.safety,
              shadowSafetyWithCalibratedProbability:
                safetyWithCalibratedProbability,
            };
      })();

  const propType =
    normalizePropTypeV1(
      basePick.propType || basePick.canonicalPropType || basePick.stat
    ) || "POINTS";
  const rankPacket = computeOfficialRankScoreV1({
    propType,
    predictedProbability,
    calibratedProbability: probabilityCalibration.predictedProbability,
    Safety: safetyOut?.finalSafetyScore,
    riskV2: selected.risk?.risk,
  });
  const componentCalibration = getCalibrationStatusForPropTypeV1(propType);

  return {
    playerId: basePick.playerId || basePick.player_id || null,
    playerName: basePick.playerName || basePick.player || null,
    propType,
    stat: propTypeStatLabel(propType),
    marketType:
      basePick.marketType ||
      basePick.marketKey ||
      (propType === "REBOUNDS"
        ? "player_rebounds"
        : propType === "ASSISTS"
          ? "player_assists"
          : "player_points"),
    officialRankScore: rankPacket.officialRankScore,
    officialRank: rankPacket,
    calibrationStatus: rankPacket.calibrationStatus,
    officialRankScoreStatus: rankPacket.officialRankScoreStatus,
    calibration: componentCalibration.calibration,
    probabilityCalibrationSource:
      selected.distribution?.probabilityCalibrationSource ||
      (propType === "POINTS"
        ? "POINTS_GOLD_V1"
        : "PENDING_HISTORICAL_RESIDUAL"),
    projectionUncertainty: selected.distribution?.projectionUncertainty || null,
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
    c2MembershipAppliedTo:
      c2MembershipAppliedTo ||
      (directionOn ? selectedSide : "BOTH"),
    direction: {
      // Production side authority is selectedSide + directionAdmission only.
      decision: selectedSide,
      researchDecision: directionResearchDecision,
      reason: forcedNoBet
        ? bestGuessSideReason || "BEST_GUESS_DUAL_C2_SAFER_SIDE"
        : direction?.reason || null,
      // Raw Direction veto reason kept for research (NO_BET gates, etc.).
      researchReason: direction?.reason || null,
      confidence: direction?.confidence || (forcedNoBet ? "NONE" : null),
      marketConflict: direction?.marketConflict ?? null,
      // Deprecated name — always true once a side is chosen; has zero membership veto.
      officialDirectionEligible: true,
      admission: directionAdmission,
      directionAdmission,
      boardSide: selectedSide,
      educatedGuess: directionAdmission === "BEST_GUESS",
      bestGuessSideReason: bestGuessSideReason || null,
      dualC2SaferSide: Boolean(forcedNoBet),
      rescuePathway: null,
      freezeId: direction?.freezeId || null,
      engineVersion: direction?.engineVersion || null,
      over: direction?.over || null,
      under: direction?.under || null,
    },
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
      calibratedWinProbability: probabilityCalibration.predictedProbability,
      predictedProbability,
      probabilityCalibrationStatus: applyProbCalibLive
        ? "EMPIRICAL_BAND_V1_APPLIED"
        : "SHADOW_EMPIRICAL_BAND_V1",
      probabilityCalibration,
      probabilityCalibrationBuild: PREDICTED_PROBABILITY_CALIBRATION_V1_BUILD,
    },
    uncertainty: {
      distributionWidth: selected.distribution.distributionWidth,
      conflictIndex: selected.conflict.conflictIndex,
    },
    safety: safetyOut,
    risk: {
      ...selected.risk,
      // C2 risk label only — never final Official membership.
      officialEligible: false,
      c2Risk: selected.risk?.risk || null,
      c2RankScore: resolveC2RankScore({
        reliabilityProbability:
          selected.reliabilityProbability ?? selected.risk?.reliabilityProbability,
        trustScore: selected.risk?.trustScore,
        safety: selected.safety,
        risk: selected.risk,
      }),
      directionDecision: selectedSide,
      directionResearchDecision,
      directionAdmission,
      boardSide: selectedSide,
      blockedByDirectionNoBet: false,
      educatedGuess: directionAdmission === "BEST_GUESS",
    },
    riskV1Legacy: selected.riskV1Legacy,
    reliabilityProbability:
      selected.reliabilityProbability ?? selected.risk?.reliabilityProbability,
    trustScore: selected.risk?.trustScore ?? null,
    trustComponents: selected.risk?.trustComponents ?? null,
    c2Risk: selected.risk?.risk || null,
    c2RankScore: resolveC2RankScore({
      reliabilityProbability:
        selected.reliabilityProbability ?? selected.risk?.reliabilityProbability,
      trustScore: selected.risk?.trustScore,
      safety: selected.safety,
      risk: selected.risk,
    }),
    safePathway: selected.safePathway ?? selected.risk?.safePathway,
    pathwayMatched: selected.risk?.pathwayMatched ?? false,
    pathwayScore: selected.risk?.pathwayScore ?? 0,
    pathwayEvidence: selected.risk?.pathwayEvidence ?? [],
    membership: {
      analysisEligible,
      boardCandidate,
      officialSelected,
      officialEligible: false,
      risk: selected.risk?.risk,
      c2Risk: selected.risk?.risk || null,
      c2RankScore: resolveC2RankScore({
        reliabilityProbability:
          selected.reliabilityProbability ?? selected.risk?.reliabilityProbability,
        trustScore: selected.risk?.trustScore,
        safety: selected.safety,
        risk: selected.risk,
      }),
      wouldPassLowGate: selected.risk?.wouldPassLowGate,
      wouldPassMediumGate: selected.risk?.wouldPassMediumGate,
      safePathway: selected.risk?.safePathway ?? null,
      reliabilityProbability: selected.risk?.reliabilityProbability ?? null,
      trustScore: selected.risk?.trustScore ?? null,
      directionDecision: selectedSide,
      directionResearchDecision,
      directionAdmission,
      boardSide: selectedSide,
      blockedByDirectionNoBet: false,
      educatedGuess: directionAdmission === "BEST_GUESS",
      requiresDirectionApproval: false,
      pipelineOrder: "INTEGRITY_DIRECTION_C2_SAFEST_2_TO_6",
      boardPolicy: "SAFEST_2_TO_6",
      controlPlaneBuild: CONTROL_PLANE_BUILD,
      highPolicy: "MINIMUM_2_FILL_ONLY",
    },
    analysisEligible,
    boardCandidate,
    officialSelected: false,
    officialEligible: false,
    forecastModelVersion: FORECAST_MODEL_VERSION,
    architectureBuild: isEmpiricalSafePropV2Enabled(options)
      ? EMPIRICAL_SAFE_PROP_V2_BUILD
      : ARCHITECTURE_BUILD,
    controlPlaneBuild: CONTROL_PLANE_BUILD,
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
    (p) =>
      p.direction?.researchDecision === "NO_BET" ||
      p.membership?.directionResearchDecision === "NO_BET"
  );
  const directed = packets.filter(
    (p) =>
      p.selectedSide === "OVER" ||
      p.selectedSide === "UNDER" ||
      p.direction?.decision === "OVER" ||
      p.direction?.decision === "UNDER"
  );
  const boardCandidates = packets.filter(
    (p) => p.membership?.boardCandidate === true
  );
  const officialEligible = packets.filter(
    (p) => p.membership?.officialSelected === true
  );

  return {
    version: RESEARCH_UNIVERSE_VERSION,
    architectureBuild: ARCHITECTURE_BUILD,
    controlPlaneBuild: CONTROL_PLANE_BUILD,
    totalValidPlayerMarkets: packets.length,
    researchUniverseSize: packets.length,
    dualSidePacketCount: packets.length * 2,
    LOW: low.length,
    MEDIUM: medium.length,
    HIGH: high.length,
    boardCandidates: boardCandidates.length,
    packets,
    counts: {
      LOW: low.length,
      MEDIUM: medium.length,
      HIGH: high.length,
      boardCandidates: boardCandidates.length,
      Official: officialEligible.length,
      researchOnly: packets.length - officialEligible.length,
      DIRECTION_OVER: directed.filter((p) => p.selectedSide === "OVER").length,
      DIRECTION_UNDER: directed.filter((p) => p.selectedSide === "UNDER").length,
      DIRECTION_PRIMARY: packets.filter(
        (p) => p.membership?.directionAdmission === "PRIMARY"
      ).length,
      DIRECTION_BEST_GUESS: packets.filter(
        (p) => p.membership?.directionAdmission === "BEST_GUESS"
      ).length,
      NO_BET_RESEARCH: noBet.length,
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
 * Official membership — single control-plane selector.
 * HIGH fills only when LOW+MEDIUM < 2 (MINIMUM_2_FILL_ONLY).
 */
export function selectOfficialBoardFromProbabilitySafetyV1(
  candidates = [],
  options = {}
) {
  const research = buildResearchUniverseV1(candidates, options);
  const sizePolicy = getOfficialBoardSizePolicy();

  const v2On = isEmpiricalSafePropV2Enabled(options);
  let calibrationHash = null;
  if (v2On) {
    try {
      calibrationHash = computeCalibrationHashV2();
    } catch {
      calibrationHash = null;
    }
  }

  const rankedResearch = annotateSlateRelativeStrengthV1(
    (research.packets || []).map((p) => ({
      ...p,
      reliabilityProbability:
        p.reliabilityProbability ?? p.risk?.reliabilityProbability,
      trustScore: p.trustScore ?? p.risk?.trustScore,
      SafetyScore: p.safety?.finalSafetyScore,
      rawWinProbability:
        p.probability?.rawWinProbability ?? p.selectedSideProbability,
      c2RankScore: resolveC2RankScore(p),
    }))
  );
  const rankByKey = new Map(
    rankedResearch.map((p) => [
      p.playerKey || p.marketKey || `${p.playerName}|${p.selectedSide}|${p.line}`,
      p.slateRelativeStrength,
    ])
  );

  const membership = selectOfficialMembershipV1(rankedResearch, options);

  const selectedProps = membership.selectedPackets.map((packet, index) => {
    const src =
      packet.selectedSide === "OVER"
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
    // Research-only DI snapshot — must not outrank Official display fields.
    const decisionIntelligenceResearch = {
      ...(src?.decisionIntelligence || {}),
      researchOnly: true,
      controlPlaneAuthority: false,
    };
    return {
      ...src,
      ...decorated,
      decisionIntelligence: {
        trueRisk: decorated.c2Risk,
        riskAfterDecision: decorated.riskLabel,
        finalConfidence: decorated.displayConfidence,
        confidenceOwner: decorated.confidenceOwner,
        riskOwner: decorated.riskOwner,
        directionDecision: decorated.selectedSide,
        directionConfidence: decorated.directionConfidence,
        directionAdmission: decorated.directionAdmission,
        research: decisionIntelligenceResearch,
      },
      analysisEligible: true,
      boardCandidate: true,
      officialSelected: true,
      officialEligible: true,
      trackingType: "OFFICIAL",
      finalDecision: "OFFICIAL",
      recordType: "OFFICIAL",
      confidence: decorated.displayConfidence,
      finalConfidence: decorated.displayConfidence,
      displayConfidence: decorated.displayConfidence,
      winProbability: decorated.displayConfidence,
      trueRisk: decorated.c2Risk,
      displayTrueRisk: decorated.c2Risk,
      c2Risk: decorated.c2Risk,
      riskLabel: decorated.riskLabel,
      riskAfterCeiling: decorated.riskLabel,
      c2RankScore: decorated.c2RankScore,
    };
  });

  // Mark research packets with post-selection officialSelected.
  const selectedIds = new Set(
    membership.selectedPackets.map((p) => stableMarketId(p))
  );
  const researchPackets = rankedResearch.map((p) => {
    const id = stableMarketId(p);
    const officialSelected = selectedIds.has(id);
    return {
      ...p,
      officialSelected,
      officialEligible: officialSelected,
      trackingType: officialSelected ? "OFFICIAL" : "RESEARCH",
      membership: {
        ...(p.membership || {}),
        officialSelected,
        officialEligible: officialSelected,
        boardCandidate: p.membership?.boardCandidate === true,
      },
    };
  });

  const highCandidates = researchPackets
    .filter((p) => p.risk?.risk === "HIGH" && !p.officialSelected)
    .sort((a, b) => resolveC2RankScore(b) - resolveC2RankScore(a))
    .slice(0, 10);

  // Freeze all boardCandidates after Official selection stamps officialSelected.
  try {
    const slateDateCT =
      options.requestedSlateDate ||
      candidates[0]?.slateDate ||
      candidates[0]?.canonicalSlateDateCT ||
      null;
    if (slateDateCT && researchPackets.length) {
      persistResearchUniversePacketsV2({
        slateDateCT,
        packets: researchPackets,
        researchUniverse: {
          ...research.counts,
          Official: selectedProps.length,
          boardCandidates: membership.boardCandidateCount,
        },
        officialProps: selectedProps,
        meta: {
          source: "selectOfficialBoardFromProbabilitySafetyV1",
          controlPlaneBuild: CONTROL_PLANE_BUILD,
          highPolicy: membership.highPolicy,
          thinSlate: membership.thinSlate,
        },
      });
    }
  } catch {
    // persistence must never break Official selection
  }

  return {
    version: v2On ? MEMBERSHIP_VERSION_V2 : MEMBERSHIP_VERSION,
    architectureBuild: v2On ? EMPIRICAL_SAFE_PROP_V2_BUILD : ARCHITECTURE_BUILD,
    controlPlaneBuild: CONTROL_PLANE_BUILD,
    membershipModel: "courteedge-single-machine-control-plane-v1",
    productionFreeze: v2On ? EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE : null,
    calibrationHash,
    selectedProps,
    officialCount: selectedProps.length,
    lowCount: membership.lowCount,
    mediumCount: membership.mediumCount,
    highFillCount: membership.highFillCount,
    thinSlate: membership.thinSlate,
    thinSlateReason: membership.thinSlateReason,
    highBlocked: 0,
    topHighCandidates: highCandidates,
    research: {
      ...research,
      packets: researchPackets,
      counts: {
        ...research.counts,
        Official: selectedProps.length,
        boardCandidates: membership.boardCandidateCount,
        researchOnly: Math.max(
          0,
          membership.boardCandidateCount - selectedProps.length
        ),
      },
    },
    boardCandidates: membership.boardCandidates,
    boardSizePolicy: sizePolicy.policy,
    highPolicy: membership.highPolicy,
    officialBoardMin: sizePolicy.min,
    officialBoardMax: sizePolicy.max,
    officialPoolSize: membership.boardCandidateCount,
    forcedSide: false,
    noFixedSix: true,
    noMinimumCount: false,
    noSideQuota: true,
    noTeamQuota: true,
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
  directionAdmission = null,
  directionConfidence = null,
  c2Risk = null,
  reliabilityProbability = null,
  trustScore = null,
  rawWinProbability = null,
} = {}) {
  const dir = String(directionDecision || "").toUpperCase();
  const admission = String(directionAdmission || "").toUpperCase();
  const directed =
    (dir === "OVER" || dir === "UNDER") &&
    (admission === "PRIMARY" ||
      admission === "BEST_GUESS" ||
      admission === "" ||
      admission === "NULL");
  const riskCode = String(c2Risk || "HIGH").toUpperCase();
  const dirConf = String(directionConfidence || "NONE").toUpperCase();
  const rel = num(reliabilityProbability);
  const trust = num(trustScore);
  const rawP = num(rawWinProbability);
  const isPrimary = admission === "PRIMARY";

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
  if (!isPrimary || riskCode === "HIGH") {
    confidence = Math.min(confidence, 52);
  }

  return {
    c2Risk: riskCode,
    trueRisk: riskCode,
    riskLabel: riskCodeToLabel(riskCode) || riskCode,
    riskAfterCeiling: riskCodeToLabel(riskCode) || riskCode,
    displayTrueRisk: riskCode,
    // signalStrength is research/debug only — not Official display authority.
    signalStrength: null,
    signalLevel: null,
    confidence,
    finalConfidence: confidence,
    displayConfidence: confidence,
    directionAdmission: isPrimary
      ? "PRIMARY"
      : admission === "BEST_GUESS"
        ? "BEST_GUESS"
        : directed
          ? "PRIMARY"
          : "BEST_GUESS",
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
  const selectedSide = packet.selectedSide || packet.membership?.boardSide;
  const directionAdmission =
    packet.direction?.directionAdmission ||
    packet.membership?.directionAdmission ||
    "BEST_GUESS";
  const directionConfidence = packet.direction?.confidence ?? null;
  const display = resolveOfficialDisplayMetaV1({
    directionDecision: selectedSide,
    directionAdmission,
    directionConfidence,
    c2Risk: riskCode,
    reliabilityProbability:
      risk.reliabilityProbability ?? packet.reliabilityProbability ?? null,
    trustScore: risk.trustScore ?? packet.trustScore ?? null,
    rawWinProbability: packet.probability?.rawWinProbability ?? null,
  });
  const c2RankScore =
    packet.c2RankScore ??
    resolveC2RankScore(packet);

  return {
    side: selectedSide,
    pick: selectedSide,
    selectedSide,
    c2Risk: display.c2Risk,
    trueRisk: display.c2Risk,
    riskLabel: display.riskLabel,
    riskAfterCeiling: display.riskLabel,
    displayTrueRisk: display.c2Risk,
    c2RankScore,
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
    analysisEligible: true,
    boardCandidate: true,
    officialSelected: true,
    officialEligible: true,
    trackingType: "OFFICIAL",
    finalDecision: "OFFICIAL",
    recordType: "OFFICIAL",
    // Single owners: Direction×C2 confidence, C2 risk.
    displayConfidence: display.displayConfidence,
    confidence: display.displayConfidence,
    finalConfidence: display.displayConfidence,
    winProbability: display.displayConfidence,
    signalStrength: null,
    signalLevel: null,
    directionDecision: selectedSide,
    directionResearchDecision:
      packet.direction?.researchDecision ??
      packet.membership?.directionResearchDecision ??
      null,
    directionReason: packet.direction?.reason ?? null,
    directionConfidence,
    directionAdmission,
    admission: directionAdmission,
    educatedGuess: directionAdmission === "BEST_GUESS",
    rescuePathway: null,
    blockedByDirectionNoBet: false,
    pipelineOrder: "INTEGRITY_DIRECTION_C2_SAFEST_2_TO_6",
    controlPlaneBuild: CONTROL_PLANE_BUILD,
    confidenceOwner: "probabilitySafetyV1.direction_x_c2",
    riskOwner: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
    signalOwner: null,
    forcedSide: false,
    noFixedSix: true,
    noMinimumBoard: false,
    noTeamQuota: true,
    whyNotLow: risk.whyNotLow || [],
    riskExplanation: risk.explanation || null,
    membershipQualificationStatus:
      riskCode === "LOW"
        ? "QUALIFIED_LOW_RISK"
        : riskCode === "MEDIUM"
          ? "QUALIFIED_MEDIUM_RISK"
          : "HIGH_MINIMUM_FILL",
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
