/**
 * propFailurePathEngineV1 + playerBlowoutSensitivityEngineV1
 */
import { BLOWOUT_MODEL_VERSION, FAILURE_PATH_VERSION } from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export function buildPlayerBlowoutSensitivityEngineV1(pick = {}, minutes = {}) {
  const gameBlowoutProbability = clamp01(
    (num(pick.blowoutRisk, 0) || 0) / 100
  );
  const expectedMinutesIfClose = num(minutes.expectedMinutes, 24);
  const sensitivity =
    expectedMinutesIfClose >= 30
      ? 0.55
      : expectedMinutesIfClose >= 22
        ? 0.4
        : 0.25;
  const expectedMinutesIfBlowout = Math.max(
    8,
    expectedMinutesIfClose * (1 - sensitivity * 0.45)
  );

  return {
    version: BLOWOUT_MODEL_VERSION,
    gameBlowoutProbability,
    playerBlowoutMinutesSensitivity: sensitivity,
    expectedMinutesIfClose,
    expectedMinutesIfBlowout: Number(expectedMinutesIfBlowout.toFixed(2)),
    scoringBeforeFourthQuarterRate: num(pick.scoringBeforeQ4Rate),
    benchGarbageTimeOpportunity: expectedMinutesIfClose < 18,
  };
}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

export function buildPropFailurePathEngineV1(ctx = {}) {
  const {
    pick = {},
    minutes = {},
    role = {},
    volume = {},
    market = {},
    blowout = {},
    conflict = {},
  } = ctx;
  const side = String(pick.side || pick.pick || "").toUpperCase();
  const isOver = side.startsWith("OVER");
  const paths = [];

  const push = (id, severity, label) => {
    paths.push({ id, severity, label });
  };

  if ((minutes.minutesStabilityScore ?? 100) < 60) {
    push("MINUTES_REDUCTION", "major", "Minutes reduction / volatility");
  } else if ((minutes.minutesStabilityScore ?? 100) < 75) {
    push("MINUTES_REDUCTION", "moderate", "Minutes volatility");
  }

  if (minutes.restricted) {
    push("MINUTES_RESTRICTION", "major", "Minutes restriction");
  }

  if (role.recentRoleChange || role.ROLE_ENVIRONMENT_CHANGED) {
    push("ROLE_CHANGE", "major", "Role / environment change");
  }

  if (isOver && (blowout.gameBlowoutProbability ?? 0) >= 0.55) {
    push("BLOWOUT_MINUTES", "major", "Blowout minutes risk for Over");
  }
  if (!isOver && (blowout.benchGarbageTimeOpportunity || false)) {
    push("GARBAGE_TIME", "moderate", "Garbage-time scoring opportunity");
  }

  if (isOver && volume.hotThreeDependency) {
    push("THREE_POINT_DEPENDENCY", "major", "Hot 3PT dependency");
  }
  if (isOver && (volume.FGA ?? 99) <= 6) {
    push("LOW_FGA", "major", "Low FGA / limited volume");
  }
  if (!isOver && role.teammateAvailabilityImpact) {
    push("USAGE_SPIKE", "major", "Teammate absence / usage spike risk");
  }

  if (market.movementAgainstModel) {
    push("MARKET_AGAINST", "moderate", "Line movement against model");
  }
  if ((market.marketQualityScore ?? 100) < 45) {
    push("WEAK_MARKET", "moderate", "Weak market integrity");
  }

  if ((conflict.conflictIndex ?? 0) >= 40) {
    push("EVIDENCE_CONFLICT", "major", "Severe evidence conflict");
  }

  const majorFailurePathCount = paths.filter((p) => p.severity === "major").length;
  const moderateFailurePathCount = paths.filter(
    (p) => p.severity === "moderate"
  ).length;
  const failurePathSeverityScore = Math.min(
    100,
    majorFailurePathCount * 28 + moderateFailurePathCount * 12
  );

  return {
    version: FAILURE_PATH_VERSION,
    failurePaths: paths,
    majorFailurePathCount,
    moderateFailurePathCount,
    failurePathSeverityScore,
  };
}
