/**
 * Empirical residual distributions for POINTS / REBOUNDS / ASSISTS.
 *
 * residual = actual - projection
 * Probability from historical residual CDF (not Points MC variance reuse).
 *
 * probabilityCalibrationSource: HISTORICAL_STAT_RESIDUAL_V1
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizePropTypeV1 } from "./propTypeV1.js";

export const STAT_RESIDUAL_DISTRIBUTION_V1_BUILD =
  "courteedge-stat-residual-distribution-v1";
export const PROBABILITY_CALIBRATION_SOURCE_HISTORICAL_V1 =
  "HISTORICAL_STAT_RESIDUAL_V1";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ARTIFACT = path.resolve(
  __dirname,
  "../../research/courteedge-gold-learning-v1/reb-ast-historical-calibration-v1/residual-distributions.json"
);

let _cached = null;

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function quantile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function summarizeResidualsV1(residuals = []) {
  const xs = residuals.map((r) => num(r)).filter((n) => n != null);
  xs.sort((a, b) => a - b);
  const n = xs.length;
  if (!n) {
    return {
      n: 0,
      mean: null,
      median: null,
      std: null,
      mae: null,
      rmse: null,
      P10: null,
      P25: null,
      P50: null,
      P75: null,
      P90: null,
      sorted: [],
    };
  }
  const mean = xs.reduce((s, x) => s + x, 0) / n;
  const mae = xs.reduce((s, x) => s + Math.abs(x), 0) / n;
  const rmse = Math.sqrt(xs.reduce((s, x) => s + x * x, 0) / n);
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / n;
  return {
    n,
    mean: Number(mean.toFixed(4)),
    median: Number(quantile(xs, 50).toFixed(4)),
    std: Number(Math.sqrt(variance).toFixed(4)),
    mae: Number(mae.toFixed(4)),
    rmse: Number(rmse.toFixed(4)),
    P10: Number(quantile(xs, 10).toFixed(4)),
    P25: Number(quantile(xs, 25).toFixed(4)),
    P50: Number(quantile(xs, 50).toFixed(4)),
    P75: Number(quantile(xs, 75).toFixed(4)),
    P90: Number(quantile(xs, 90).toFixed(4)),
    sorted: xs,
  };
}

/**
 * P(actual > line) given projection and empirical residual distribution.
 * actual ≈ projection + residual → P(projection + r > line) = P(r > line - projection)
 */
export function probabilityFromResidualCdfV1({
  projection,
  line,
  residualsSorted = [],
} = {}) {
  const proj = num(projection);
  const ln = num(line);
  if (proj == null || ln == null || !residualsSorted.length) {
    return {
      pOver: null,
      pUnder: null,
      predictedProbability: null,
      method: "INSUFFICIENT_DATA",
      probabilityCalibrationSource: PROBABILITY_CALIBRATION_SOURCE_HISTORICAL_V1,
      sampleN: residualsSorted.length,
    };
  }
  const threshold = ln - proj; // need residual > threshold for OVER
  let over = 0;
  let under = 0;
  let push = 0;
  const isHalf = Math.abs(ln % 1 - 0.5) < 1e-9;
  for (const r of residualsSorted) {
    const actual = proj + r;
    if (!isHalf && Math.abs(actual - ln) < 1e-9) push += 1;
    else if (actual > ln) over += 1;
    else under += 1;
  }
  const decided = over + under;
  const pOver = decided > 0 ? over / decided : 0.5;
  const pUnder = decided > 0 ? under / decided : 0.5;
  return {
    pOver: Number(pOver.toFixed(6)),
    pUnder: Number(pUnder.toFixed(6)),
    predictedProbability: null, // filled by caller after side selection
    method: "EMPIRICAL_RESIDUAL_CDF",
    probabilityCalibrationSource: PROBABILITY_CALIBRATION_SOURCE_HISTORICAL_V1,
    sampleN: residualsSorted.length,
    thresholdResidual: Number(threshold.toFixed(4)),
  };
}

export function loadResidualDistributionsArtifactV1(filePath = DEFAULT_ARTIFACT) {
  if (_cached && !filePath) return _cached;
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
    _cached = raw;
    return raw;
  } catch {
    return null;
  }
}

export function getResidualSummaryForPropTypeV1(
  propType = "REBOUNDS",
  artifact = null
) {
  const pt = normalizePropTypeV1(propType) || "REBOUNDS";
  const art = artifact || loadResidualDistributionsArtifactV1();
  const block = art?.byPropType?.[pt] || art?.[pt] || null;
  if (!block) return null;
  return block;
}

/**
 * Build projectionUncertainty packet from residual summary + projection.
 */
export function buildProjectionUncertaintyV1({
  propType = "REBOUNDS",
  expectedValue,
  residualSummary = null,
  cohortSource = "GOLD",
} = {}) {
  const ev = num(expectedValue);
  const s = residualSummary || getResidualSummaryForPropTypeV1(propType);
  if (ev == null || !s || !s.n) {
    return {
      expectedValue: ev,
      mae: null,
      residualStd: null,
      lowerBand: null,
      upperBand: null,
      sampleN: s?.n || 0,
      cohortSource,
      status: "INSUFFICIENT_DATA",
    };
  }
  const mae = num(s.mae, null);
  const std = num(s.std, null);
  const p10 = num(s.P10, null);
  const p90 = num(s.P90, null);
  return {
    expectedValue: ev,
    mae,
    residualStd: std,
    lowerBand:
      p10 != null ? Number((ev + p10).toFixed(2)) : Number((ev - (mae || 0)).toFixed(2)),
    upperBand:
      p90 != null ? Number((ev + p90).toFixed(2)) : Number((ev + (mae || 0)).toFixed(2)),
    sampleN: s.n,
    cohortSource,
    status: s.n >= 80 ? "ACTIVE" : s.n >= 30 ? "INITIAL_CALIBRATED" : "DEVELOPING",
  };
}

/**
 * Prefer residual-CDF probability for REB/AST when artifact present.
 * POINTS keeps existing MC distribution authority.
 */
export function resolveStatProbabilityV1({
  propType = "POINTS",
  projection,
  line,
  fallbackPOver = null,
  fallbackPUnder = null,
  artifact = null,
} = {}) {
  const pt = normalizePropTypeV1(propType) || "POINTS";
  if (pt === "POINTS") {
    return {
      pOver: fallbackPOver,
      pUnder: fallbackPUnder,
      method: "POINTS_DISTRIBUTION_ENGINE",
      probabilityCalibrationSource: "POINTS_GOLD_V1",
      usedResidualCdf: false,
    };
  }
  const summary = getResidualSummaryForPropTypeV1(pt, artifact);
  const sorted = summary?.sortedResiduals || summary?.sorted || [];
  if (!sorted.length) {
    return {
      pOver: fallbackPOver,
      pUnder: fallbackPUnder,
      method: "FALLBACK_MC_UNTIL_RESIDUALS",
      probabilityCalibrationSource: "PENDING_HISTORICAL_RESIDUAL",
      usedResidualCdf: false,
      sampleN: 0,
    };
  }
  const fromCdf = probabilityFromResidualCdfV1({
    projection,
    line,
    residualsSorted: sorted,
  });
  return {
    ...fromCdf,
    usedResidualCdf: true,
  };
}
