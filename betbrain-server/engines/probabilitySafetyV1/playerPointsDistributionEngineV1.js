/**
 * playerPointsDistributionEngineV1 — Monte Carlo points distribution
 */
import {
  DEFAULT_SIMULATION_COUNT,
  DISTRIBUTION_MODEL_VERSION,
} from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

/** Deterministic PRNG for tests */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randn(rng) {
  // Box-Muller
  let u = 0;
  let v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

/**
 * Simulate player points given minutes + volume + efficiency noise.
 */
export function buildPlayerPointsDistributionEngineV1(
  pick = {},
  minutes = {},
  volume = {},
  options = {}
) {
  const nSims = Number(options.simulationCount) || DEFAULT_SIMULATION_COUNT;
  const seed = Number(options.seed);
  const rng =
    Number.isFinite(seed) ? mulberry32(seed) : mulberry32(0xc0ffee ^ nSims);

  const line = num(pick.line ?? pick.selectedLine ?? pick.officialLine);
  const meanPts =
    num(pick.projection) ??
    num(pick.projectedPoints) ??
    num(pick.finalProjection) ??
    (line != null ? line : 15);

  const minMean = num(minutes.expectedMinutes, 24);
  const minSd = Math.max(1.5, num(minutes.minutesStdDev, minMean * 0.12));
  const ppm =
    num(volume.pointsPerMinute) ??
    (minMean > 0 ? meanPts / minMean : meanPts / 24);
  const efficiencySd = Math.max(0.04, ppm * 0.18);

  const samples = new Array(nSims);
  for (let i = 0; i < nSims; i += 1) {
    const m = Math.max(0, minMean + randn(rng) * minSd);
    const eff = Math.max(0.05, ppm + randn(rng) * efficiencySd);
    // mild volume shock
    const shock = 1 + randn(rng) * 0.08;
    samples[i] = Math.max(0, m * eff * shock);
  }

  samples.sort((a, b) => a - b);
  const mean = samples.reduce((s, x) => s + x, 0) / samples.length;
  const variance =
    samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length;
  const sd = Math.sqrt(variance);

  const p10 = percentile(samples, 10);
  const p20 = percentile(samples, 20);
  const p25 = percentile(samples, 25);
  const p35 = percentile(samples, 35);
  const p50 = percentile(samples, 50);
  const p65 = percentile(samples, 65);
  const p75 = percentile(samples, 75);
  const p80 = percentile(samples, 80);
  const p90 = percentile(samples, 90);

  let pOver = null;
  let pUnder = null;
  if (line != null) {
    let over = 0;
    let under = 0;
    let push = 0;
    const isInt = Number.isInteger(line);
    for (const x of samples) {
      if (isInt && Math.abs(x - line) < 1e-9) push += 1;
      else if (x > line) over += 1;
      else under += 1;
    }
    const decided = over + under;
    pOver = decided > 0 ? over / decided : 0.5;
    pUnder = decided > 0 ? under / decided : 0.5;
  }

  return {
    version: DISTRIBUTION_MODEL_VERSION,
    simulationCount: nSims,
    seed: Number.isFinite(seed) ? seed : null,
    mean: Number(mean.toFixed(3)),
    median: Number(p50.toFixed(3)),
    p10: Number(p10.toFixed(3)),
    p20: Number(p20.toFixed(3)),
    p25: Number(p25.toFixed(3)),
    p35: Number(p35.toFixed(3)),
    p50: Number(p50.toFixed(3)),
    p65: Number(p65.toFixed(3)),
    p75: Number(p75.toFixed(3)),
    p80: Number(p80.toFixed(3)),
    p90: Number(p90.toFixed(3)),
    standardDeviation: Number(sd.toFixed(3)),
    distributionWidth: Number((p90 - p10).toFixed(3)),
    POver: pOver,
    PUnder: pUnder,
    probabilitySum: pOver != null && pUnder != null ? pOver + pUnder : null,
  };
}
