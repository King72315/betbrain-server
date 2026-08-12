/**
 * predictedProbabilityCalibrationV1
 *
 * Authority-preserving transform:
 *   raw model probability → empirical band calibration → predictedProbability
 *
 * No confidenceV3. Certified rules untouched.
 * Default status SHADOW until prospective rows confirm; prove-fix / options
 * can apply the transform under the existing predictedProbability owner.
 */
export const PREDICTED_PROBABILITY_CALIBRATION_V1_BUILD =
  "courteedge-predicted-probability-calibration-v1";

/**
 * Full-sample Laplace-smoothed band table refit AFTER shared mean calibration
 * + side re-run on frozen gold 50 (under-projection-recalibration-v1).
 * Still SHADOW — promote only after prospective confirmation.
 * Prior table (pre-mean-fix) had 75+ → 35% hit; post-fix 75+ → 67%.
 */
export const PREDICTED_PROBABILITY_CALIBRATION_TABLE_V1 = Object.freeze([
  Object.freeze({ lo: 0, hi: 0.55, n: 16, empiricalHit: 0.6875, calibrated: 0.625 }),
  Object.freeze({ lo: 0.55, hi: 0.6, n: 12, empiricalHit: 0.6667, calibrated: 0.6 }),
  Object.freeze({ lo: 0.6, hi: 0.65, n: 9, empiricalHit: 0.4444, calibrated: 0.470588 }),
  Object.freeze({ lo: 0.65, hi: 0.7, n: 4, empiricalHit: 1.0, calibrated: 0.666667 }),
  Object.freeze({ lo: 0.7, hi: 0.75, n: 3, empiricalHit: 0.3333, calibrated: 0.454545 }),
  Object.freeze({ lo: 0.75, hi: 1.01, n: 6, empiricalHit: 0.6667, calibrated: 0.571429 }),
]);

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

/**
 * Map raw win probability through the empirical band table.
 */
export function applyPredictedProbabilityCalibrationV1(
  rawProbability,
  table = PREDICTED_PROBABILITY_CALIBRATION_TABLE_V1
) {
  const raw = num(rawProbability);
  if (raw == null) {
    return {
      applied: false,
      rawWinProbability: null,
      predictedProbability: null,
      band: null,
      build: PREDICTED_PROBABILITY_CALIBRATION_V1_BUILD,
      status: "MISSING_RAW",
    };
  }

  const p = clamp01(raw);
  const band =
    table.find((b) => p >= b.lo && p < b.hi) || table[table.length - 1];
  const calibrated = clamp01(num(band.calibrated, p));

  return {
    applied: true,
    rawWinProbability: Number(p.toFixed(6)),
    predictedProbability: Number(calibrated.toFixed(6)),
    band: { lo: band.lo, hi: band.hi, n: band.n, empiricalHit: band.empiricalHit },
    build: PREDICTED_PROBABILITY_CALIBRATION_V1_BUILD,
    status: "SHADOW_TABLE_V1",
  };
}

/**
 * Fit a Laplace-smoothed band table from labeled rows (chronological / full sample).
 * rows: [{ predictedProbability|rawWinProbability, result: 'WIN'|'LOSS' }]
 */
export function fitPredictedProbabilityCalibrationTableV1(
  rows = [],
  bands = [
    [0, 0.55],
    [0.55, 0.6],
    [0.6, 0.65],
    [0.65, 0.7],
    [0.7, 0.75],
    [0.75, 1.01],
  ],
  priorStrength = 8
) {
  return bands.map(([lo, hi]) => {
    const rs = rows.filter((r) => {
      const p = num(r.predictedProbability ?? r.rawWinProbability);
      return p != null && p >= lo && p < hi;
    });
    let w = 0;
    let l = 0;
    for (const r of rs) {
      if (r.result === "WIN") w += 1;
      else if (r.result === "LOSS") l += 1;
    }
    const d = w + l;
    const hit = d ? w / d : null;
    const calibrated =
      hit == null
        ? (lo + hi) / 2
        : (hit * d + 0.5 * priorStrength) / (d + priorStrength);
    return {
      lo,
      hi,
      n: d,
      empiricalHit: hit,
      calibrated: Number(calibrated.toFixed(6)),
      overconfidence: hit == null ? null : (lo + hi) / 2 - hit,
    };
  });
}

/**
 * Rebuild Safety winProbabilityStrength contribution from calibrated probability
 * while preserving other component magnitudes from an existing safety object.
 */
export function rebuildSafetyWithCalibratedProbabilityV1({
  safety = null,
  calibratedProbability = null,
  rawWinProbability = null,
} = {}) {
  const p = num(calibratedProbability ?? rawWinProbability, 0.5);
  const prev = safety?.safetyComponents || {};
  const winProbabilityStrength = Math.max(0, Math.min(100, p * 100)) * 0.25;

  const components = {
    winProbabilityStrength,
    minutesStability: prev.minutesStability ?? 0,
    roleStability: prev.roleStability ?? 0,
    distributionResilience: prev.distributionResilience ?? 0,
    marketQuality: prev.marketQuality ?? 0,
    independentEvidenceAgreement: prev.independentEvidenceAgreement ?? 0,
    availabilityCertainty: prev.availabilityCertainty ?? 0,
    gameEnvironmentStability: prev.gameEnvironmentStability ?? 0,
  };

  const rawSafetyScore = Object.values(components).reduce((a, b) => a + b, 0);
  const penaltyTotal = (safety?.safetyPenalties || []).reduce(
    (s, pen) => s + (Number(pen.pts) || 0),
    0
  );
  const finalSafetyScore = Math.max(
    0,
    Math.min(100, Math.round(rawSafetyScore - penaltyTotal))
  );

  return {
    ...(safety || {}),
    version: safety?.version || "prop-safety-v1",
    safetyComponents: components,
    rawSafetyScore: Number(rawSafetyScore.toFixed(2)),
    finalSafetyScore,
    calibratedProbabilityUsed: num(calibratedProbability),
    rebuild: PREDICTED_PROBABILITY_CALIBRATION_V1_BUILD,
  };
}
