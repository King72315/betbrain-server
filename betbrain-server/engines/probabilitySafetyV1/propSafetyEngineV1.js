/**
 * propSafetyEngineV1 + riskClassificationV1 (LOW / MEDIUM / HIGH)
 */
import {
  LOW_RISK_HARD_BLOCKS,
  SAFETY_MODEL_VERSION,
} from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function sideOf(pick) {
  const s = String(pick.side || pick.pick || "").toUpperCase();
  if (s.startsWith("OVER")) return "OVER";
  if (s.startsWith("UNDER")) return "UNDER";
  return null;
}

export function resolveAvailabilityCertainty(pick = {}) {
  const status = String(
    pick.availabilityStatus || pick.availability || pick.injuryStatus || ""
  ).toUpperCase();
  // Blank/unknown is NOT "mostly fine" (70). Missing raises uncertainty.
  if (!status) {
    return {
      availabilityCertaintyScore: null,
      availabilityStatus: "UNKNOWN",
      availabilitySource: pick.availabilitySource || null,
      availabilityTimestamp: pick.availabilityTimestamp || null,
      missingness: { status: true },
    };
  }
  if (status === "ACTIVE" || status === "AVAILABLE" || status === "PROBABLE") {
    return {
      availabilityCertaintyScore: 90,
      availabilityStatus: status,
      availabilitySource: pick.availabilitySource || null,
      availabilityTimestamp: pick.availabilityTimestamp || null,
      missingness: { status: false },
    };
  }
  if (/QUESTION|GTD|DOUBT/.test(status)) {
    return {
      availabilityCertaintyScore: 35,
      availabilityStatus: status,
      availabilitySource: pick.availabilitySource || null,
      availabilityTimestamp: pick.availabilityTimestamp || null,
    };
  }
  if (/OUT|INACTIVE|SUSP/.test(status)) {
    return {
      availabilityCertaintyScore: 10,
      availabilityStatus: status,
      availabilitySource: pick.availabilitySource || null,
      availabilityTimestamp: pick.availabilityTimestamp || null,
    };
  }
  return {
    availabilityCertaintyScore: 55,
    availabilityStatus: status,
    availabilitySource: pick.availabilitySource || null,
    availabilityTimestamp: pick.availabilityTimestamp || null,
  };
}

export function buildPropSafetyEngineV1(ctx = {}) {
  const {
    rawWinProbability = 0.5,
    minutes = {},
    role = {},
    distribution = {},
    market = {},
    conflict = {},
    failure = {},
    availability = {},
  } = ctx;

  const components = {
    winProbabilityStrength: clamp(rawWinProbability * 100, 0, 100) * 0.25,
    minutesStability: clamp(minutes.minutesStabilityScore ?? 50, 0, 100) * 0.15,
    roleStability: clamp(role.roleStabilityScore ?? 50, 0, 100) * 0.15,
    distributionResilience:
      clamp(100 - (distribution.distributionWidth ?? 12) * 3, 0, 100) * 0.15,
    marketQuality: clamp(market.marketQualityScore ?? 50, 0, 100) * 0.1,
    independentEvidenceAgreement:
      clamp((conflict.supportingCount ?? 0) * 18, 0, 100) * 0.1,
    availabilityCertainty:
      clamp(availability.availabilityCertaintyScore ?? 50, 0, 100) * 0.05,
    gameEnvironmentStability:
      clamp(100 - (conflict.conflictIndex ?? 30), 0, 100) * 0.05,
  };

  const rawSafetyScore = Object.values(components).reduce((a, b) => a + b, 0);

  const penalties = [];
  let penaltyTotal = 0;
  const addPen = (id, pts) => {
    penalties.push({ id, pts });
    penaltyTotal += pts;
  };

  if ((conflict.conflictIndex ?? 0) > 20) {
    addPen("CONFLICT_INDEX", Math.min(25, (conflict.conflictIndex - 20) * 0.6));
  }
  if ((failure.majorFailurePathCount ?? 0) > 0) {
    addPen("MAJOR_FAILURE_PATHS", failure.majorFailurePathCount * 8);
  }
  if ((minutes.minutesStabilityScore ?? 100) < 50) {
    addPen("SEVERE_VOLATILITY", 12);
  }
  if (conflict.projectionFairAgreement === false) {
    addPen("PROJ_FAIR_DISAGREE", 15);
  }
  if (role.ROLE_ENVIRONMENT_CHANGED) addPen("ROLE_CHANGE", 10);
  if ((availability.availabilityCertaintyScore ?? 100) < 60) {
    addPen("AVAILABILITY", 10);
  }

  const finalSafetyScore = clamp(
    Math.round(rawSafetyScore - penaltyTotal),
    0,
    100
  );

  return {
    version: SAFETY_MODEL_VERSION,
    safetyComponents: components,
    safetyBonuses: [],
    safetyPenalties: penalties,
    rawSafetyScore: Number(rawSafetyScore.toFixed(2)),
    finalSafetyScore,
  };
}

/**
 * Classify LOW / MEDIUM / HIGH — never invent LOW.
 */
export function classifyRiskV1(ctx = {}) {
  const {
    pick = {},
    rawWinProbability = 0.5,
    safety = {},
    minutes = {},
    role = {},
    market = {},
    conflict = {},
    failure = {},
    availability = {},
  } = ctx;

  const side = sideOf(pick);
  const line = num(pick.line ?? pick.selectedLine);
  const projection =
    num(pick.projection) ??
    num(pick.projectedPoints) ??
    num(pick.finalProjection);
  const fairLine = num(pick.fairLine) ?? num(pick.fair_line);
  const projectionEdge =
    side && line != null && projection != null
      ? side === "OVER"
        ? projection - line
        : line - projection
      : null;
  const fairEdge =
    side && line != null && fairLine != null
      ? side === "OVER"
        ? fairLine - line
        : line - fairLine
      : null;

  const projectionFairAgreement =
    conflict.projectionFairAgreement === true ||
    (projectionEdge != null &&
      fairEdge != null &&
      projectionEdge > 0 &&
      fairEdge > 0);

  const hardBlocks = [];
  if ((minutes.minutesStabilityScore ?? 100) < 40 || minutes.restricted) {
    hardBlocks.push(
      minutes.restricted ? "MINUTES_RESTRICTION" : "SEVERE_MINUTES_VOLATILITY"
    );
  }
  if ((role.roleStabilityScore ?? 100) < 40 || role.ROLE_ENVIRONMENT_CHANGED) {
    if ((role.roleStabilityScore ?? 100) < 40) hardBlocks.push("SEVERE_UNSTABLE_ROLE");
  }
  if ((availability.availabilityCertaintyScore ?? 100) < 50) {
    hardBlocks.push("UNCONFIRMED_AVAILABILITY");
  }
  if (conflict.projectionFairAgreement === false) {
    hardBlocks.push("MAJOR_PROJECTION_FAIR_CONFLICT");
  }
  if ((market.marketQualityScore ?? 100) < 30) {
    hardBlocks.push("SEVERE_MARKET_INTEGRITY");
  }
  if ((conflict.conflictIndex ?? 0) >= 61) {
    hardBlocks.push("SEVERE_SIDE_CONFLICT");
  }

  const safetyScore = safety.finalSafetyScore ?? 0;
  const supportN = conflict.supportingCount ?? 0;
  const opposeN = conflict.opposingCount ?? 0;
  const majorFails = failure.majorFailurePathCount ?? 99;

  // LOW — all required
  const lowChecks = {
    rawWinProbability: rawWinProbability >= 0.64,
    SafetyScore: safetyScore >= 78,
    projectionEdge: (projectionEdge ?? -99) >= 2.5,
    projectionFairAgreement: projectionFairAgreement === true,
    minutesStabilityScore: (minutes.minutesStabilityScore ?? 0) >= 75,
    roleStabilityScore: (role.roleStabilityScore ?? 0) >= 75,
    marketQualityScore: (market.marketQualityScore ?? 0) >= 65,
    availabilityCertaintyScore:
      (availability.availabilityCertaintyScore ?? 0) >= 85,
    conflictIndex: (conflict.conflictIndex ?? 99) <= 20,
    supportingEvidenceFamilies: supportN >= 4,
    opposingEvidenceFamilies: opposeN <= 1,
    majorFailurePathCount: majorFails <= 1,
    noHardBlocks: hardBlocks.length === 0,
    notSingleBookWeak: !(market.singleBook && (market.bookCount ?? 0) < 2),
  };
  // single-book: generally not LOW without strong verification — require bookCount>=3
  if ((market.bookCount ?? 0) < 3 && market.bookCount != null) {
    lowChecks.marketBooks = false;
  } else {
    lowChecks.marketBooks = true;
  }

  const wouldPassLowGate = Object.values(lowChecks).every(Boolean);
  const failedLowReasons = Object.entries(lowChecks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);

  // MEDIUM
  const fairOpposesStrongly =
    fairEdge != null && fairEdge < -1.0 && (projectionEdge ?? 0) > 0;

  const fragility = [];
  if ((role.roleStabilityScore ?? 100) < 55) fragility.push("unstable_role");
  if ((minutes.minutesStabilityScore ?? 100) < 55) {
    fragility.push("minutes_volatility");
  }
  if ((market.marketQualityScore ?? 100) < 50) fragility.push("market_conflict");
  if ((availability.availabilityCertaintyScore ?? 100) < 70) {
    fragility.push("availability_uncertainty");
  }
  if ((blowoutFragility(ctx) || false) && (volumeWeakFloor(ctx) || false)) {
    fragility.push("blowout_weak_floor");
  }

  const mediumChecks = {
    rawWinProbability: rawWinProbability >= 0.57,
    SafetyScore: safetyScore >= 65,
    projectionEdge: (projectionEdge ?? -99) >= 2.0,
    minutesStabilityScore: (minutes.minutesStabilityScore ?? 0) >= 55,
    roleStabilityScore: (role.roleStabilityScore ?? 0) >= 55,
    availabilityCertaintyScore:
      (availability.availabilityCertaintyScore ?? 0) >= 70,
    marketQualityScore: (market.marketQualityScore ?? 0) >= 50,
    conflictIndex: (conflict.conflictIndex ?? 99) <= 35,
    supportingEvidenceFamilies: supportN >= 3,
    majorFailurePathCount: majorFails <= 2,
    fairNotStronglyOpposes: !fairOpposesStrongly,
    fragilityStack: fragility.length < 2,
  };

  const wouldPassMediumGate =
    !wouldPassLowGate && Object.values(mediumChecks).every(Boolean);
  const failedMediumReasons = Object.entries(mediumChecks)
    .filter(([, ok]) => !ok)
    .map(([k]) => k);

  let risk = "HIGH";
  let officialEligible = false;
  if (wouldPassLowGate) {
    risk = "LOW";
    officialEligible = true;
  } else if (wouldPassMediumGate) {
    risk = "MEDIUM";
    officialEligible = true;
  }

  return {
    risk,
    officialEligible,
    researchEligible: true,
    wouldPassLowGate,
    wouldPassMediumGate,
    wouldBeHighRisk: risk === "HIGH",
    officialRejectionReasons:
      risk === "HIGH"
        ? [...failedMediumReasons, ...hardBlocks]
        : risk === "MEDIUM"
          ? failedLowReasons
          : [],
    failedLowReasons,
    failedMediumReasons,
    hardBlocks: hardBlocks.filter((b) => LOW_RISK_HARD_BLOCKS.includes(b) || true),
    projectionEdge,
    fairEdge,
    projectionFairAgreement,
    fragilityFamilies: fragility,
  };
}

function blowoutFragility(ctx) {
  return (ctx.blowout?.gameBlowoutProbability ?? 0) >= 0.55;
}
function volumeWeakFloor(ctx) {
  return (ctx.volume?.scoringOpportunityFloor ?? 99) < 8;
}
