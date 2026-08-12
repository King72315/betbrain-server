/**
 * Cross-stat officialRankScore V1
 *
 * Purpose: make historically calibrated prediction quality comparable across
 * POINTS / REBOUNDS / ASSISTS for the single Official selector.
 *
 * V1 uses predictedProbability after prop-type calibration when available,
 * else raw selected probability. No stat bonus/penalty.
 *
 * Component-level calibration stamps live in calibrationStatusByComponentV1.
 * No "new market" penalty — quality differences come from empirical uncertainty.
 */
import { normalizePropTypeV1 } from "./propTypeV1.js";
import {
  collapseOfficialRankScoreStatusV1,
  getCalibrationStatusForPropTypeV1,
} from "./calibrationStatusByComponentV1.js";

export const OFFICIAL_RANK_SCORE_V1_BUILD =
  "courteedge-official-rank-score-v1";

/** @deprecated Prefer getCalibrationStatusForPropTypeV1 — kept for callers. */
export const PROP_TYPE_CALIBRATION_STATUS_V1 = Object.freeze({
  POINTS: "CALIBRATED",
  REBOUNDS: "INITIAL_CALIBRATED",
  ASSISTS: "INITIAL_CALIBRATED",
});

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Compute officialRankScore ∈ (0,1] — expected empirical success proxy.
 */
export function computeOfficialRankScoreV1({
  propType = "POINTS",
  predictedProbability = null,
  calibratedProbability = null,
  Safety = null,
  riskV2 = null,
} = {}) {
  const pt = normalizePropTypeV1(propType) || "POINTS";
  const componentStatus = getCalibrationStatusForPropTypeV1(pt);
  const status =
    collapseOfficialRankScoreStatusV1(pt) ||
    PROP_TYPE_CALIBRATION_STATUS_V1[pt] ||
    "CALIBRATION_DEVELOPING";
  const p = clamp01(
    num(calibratedProbability ?? predictedProbability, 0.5)
  );

  // Soft environment support — does NOT reintroduce belief; tiny tilt only
  // so equal-P candidates with much stabler environments can edge ranking.
  // No propType label penalty (Step 19).
  const safety = num(Safety);
  const safetyTilt =
    safety == null ? 0 : ((clamp01(safety / 100) - 0.5) * 0.04);

  let riskTilt = 0;
  const risk = String(riskV2 || "").toUpperCase();
  if (risk === "LOW") riskTilt = 0.02;
  else if (risk === "MEDIUM") riskTilt = 0.005;
  else if (risk === "HIGH") riskTilt = -0.01;

  const officialRankScore = Number(
    clamp01(p + safetyTilt + riskTilt).toFixed(4)
  );

  return {
    build: OFFICIAL_RANK_SCORE_V1_BUILD,
    propType: pt,
    officialRankScore,
    calibrationStatus: status,
    officialRankScoreStatus: status,
    calibration: componentStatus.calibration,
    inputs: {
      predictedProbability: num(predictedProbability),
      calibratedProbability: num(calibratedProbability),
      Safety: safety,
      riskV2: risk || null,
      safetyTilt,
      riskTilt,
    },
    note:
      status === "CALIBRATION_DEVELOPING"
        ? "Provisional rank — collect prospective REB/AST rows before treating as equal-certainty to POINTS"
        : status === "INITIAL_CALIBRATED"
          ? "Initial historical-stat calibration — marketEdge still DEVELOPING"
          : "Active prop-type calibration",
  };
}

/**
 * Anti-bias audit aggregates for a slate of ranked candidates.
 */
export function auditPropTypeRankingBiasV1(candidates = []) {
  const by = { POINTS: [], REBOUNDS: [], ASSISTS: [] };
  for (const c of candidates) {
    const pt = normalizePropTypeV1(c.propType || c.stat) || "POINTS";
    if (!by[pt]) by[pt] = [];
    by[pt].push(c);
  }
  const summarize = (rows) => {
    const n = rows.length;
    if (!n) {
      return {
        n: 0,
        avgRawP: null,
        avgCalP: null,
        avgSafety: null,
        avgRank: null,
        officialSelected: 0,
      };
    }
    const mean = (fn) => {
      const xs = rows.map(fn).filter((v) => Number.isFinite(v));
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    };
    return {
      n,
      avgRawP: mean((r) => num(r.predictedProbability ?? r.rawWinProbability)),
      avgCalP: mean((r) =>
        num(r.calibratedProbability ?? r.predictedProbability)
      ),
      avgSafety: mean((r) => num(r.Safety ?? r.SafetyScore)),
      avgRank: mean((r) => num(r.officialRankScore)),
      officialSelected: rows.filter(
        (r) => r.officialSelected === true || r.trackingType === "OFFICIAL"
      ).length,
      riskDist: rows.reduce((acc, r) => {
        const k = String(r.riskV2 || r.c2Risk || r.risk || "NA").toUpperCase();
        acc[k] = (acc[k] || 0) + 1;
        return acc;
      }, {}),
    };
  };
  return {
    build: OFFICIAL_RANK_SCORE_V1_BUILD,
    byPropType: {
      POINTS: summarize(by.POINTS),
      REBOUNDS: summarize(by.REBOUNDS),
      ASSISTS: summarize(by.ASSISTS),
    },
    flag:
      // Soft flag only — investigate, do not auto-rebalance
      by.POINTS.length > 0 &&
      by.REBOUNDS.length + by.ASSISTS.length > 0 &&
      summarize(by.POINTS).avgRank != null &&
      summarize([...by.REBOUNDS, ...by.ASSISTS]).avgRank != null &&
      Math.abs(
        (summarize(by.POINTS).avgRank || 0) -
          (summarize([...by.REBOUNDS, ...by.ASSISTS]).avgRank || 0)
      ) > 0.12
        ? "INVESTIGATE_SCORE_SCALE_BIAS"
        : "OK",
  };
}
