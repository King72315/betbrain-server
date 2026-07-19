/**
 * CourtEdge Engine Expansion — shared helpers.
 *
 * Honesty rules for every engine in this module:
 * - Never fabricate zeros/50/neutral/confirmed values when data is missing.
 * - When a signal cannot be computed, set available:false, normalizedSignal:0,
 *   and cast no vote (overContribution:0, underContribution:0).
 * - Always report what data WAS used (rawValues, sampleSize, sourceIds) so
 *   downstream consumers can audit every adjustment.
 */

export const ENGINE_SIGNAL_QUALITY = Object.freeze({
  UNAVAILABLE: "UNAVAILABLE",
  EARLY: "EARLY",
  DEVELOPING: "DEVELOPING",
  USABLE: "USABLE",
  STRONG: "STRONG",
});

export const RISK_ADJUSTMENT = Object.freeze({
  REDUCE: "REDUCE",
  NEUTRAL: "NEUTRAL",
  MONITOR: "MONITOR",
  ELEVATE: "ELEVATE",
});

export function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/** Like num(), but returns null (never a fabricated 0) when value is missing/invalid. */
export function numOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

export function avg(values = []) {
  const list = (values || []).filter((v) => Number.isFinite(v));
  if (!list.length) return null;
  return Number((list.reduce((s, v) => s + v, 0) / list.length).toFixed(3));
}

export function median(values = []) {
  const list = (values || []).filter((v) => Number.isFinite(v));
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Number(((sorted[mid - 1] + sorted[mid]) / 2).toFixed(3));
  }
  return Number(sorted[mid].toFixed(3));
}

/** Linear-interpolation percentile. p is 0-100. Returns null when values is empty. */
export function percentile(values = [], p = 50) {
  const list = (values || []).filter((v) => Number.isFinite(v));
  if (!list.length) return null;
  const sorted = [...list].sort((a, b) => a - b);
  if (sorted.length === 1) return Number(sorted[0].toFixed(3));
  const rank = clamp(p, 0, 100) / 100 * (sorted.length - 1);
  const lowIdx = Math.floor(rank);
  const highIdx = Math.ceil(rank);
  if (lowIdx === highIdx) return Number(sorted[lowIdx].toFixed(3));
  const weight = rank - lowIdx;
  const interpolated = sorted[lowIdx] + (sorted[highIdx] - sorted[lowIdx]) * weight;
  return Number(interpolated.toFixed(3));
}

/** Where a value ranks (0-100) inside a distribution. Returns null when unresolvable. */
export function percentileRank(values = [], x) {
  const list = (values || []).filter((v) => Number.isFinite(v));
  const target = numOrNull(x);
  if (!list.length || target === null) return null;
  const sorted = [...list].sort((a, b) => a - b);
  const below = sorted.filter((v) => v < target).length;
  const equal = sorted.filter((v) => v === target).length;
  return Number((((below + equal * 0.5) / sorted.length) * 100).toFixed(1));
}

/** Sample standard deviation (n-1). Returns null when fewer than 2 usable points. */
export function stdev(values = []) {
  const list = (values || []).filter((v) => Number.isFinite(v));
  if (list.length < 2) return null;
  const mean = list.reduce((s, v) => s + v, 0) / list.length;
  const variance = list.reduce((s, v) => s + (v - mean) ** 2, 0) / (list.length - 1);
  return Number(Math.sqrt(variance).toFixed(3));
}

/** Median absolute deviation — robust dispersion measure, resistant to outliers. */
export function mad(values = []) {
  const list = (values || []).filter((v) => Number.isFinite(v));
  if (!list.length) return null;
  const med = median(list);
  const deviations = list.map((v) => Math.abs(v - med));
  return median(deviations);
}

/** Interquartile range. Returns {q1, q3, iqr} or nulls when unresolvable. */
export function iqr(values = []) {
  const list = (values || []).filter((v) => Number.isFinite(v));
  if (list.length < 4) return { q1: null, q3: null, iqr: null };
  const q1 = percentile(list, 25);
  const q3 = percentile(list, 75);
  if (q1 === null || q3 === null) return { q1: null, q3: null, iqr: null };
  return { q1, q3, iqr: Number((q3 - q1).toFixed(3)) };
}

/**
 * Ordinary-least-squares slope of values against their index (0..n-1).
 * Interpret values as chronologically ordered OLDEST -> NEWEST before calling.
 * Returns null when fewer than 2 usable points.
 */
export function slopeLinear(values = []) {
  const list = (values || []).filter((v) => Number.isFinite(v));
  if (list.length < 2) return null;
  const n = list.length;
  const xs = Array.from({ length: n }, (_, i) => i);
  const xMean = xs.reduce((s, v) => s + v, 0) / n;
  const yMean = list.reduce((s, v) => s + v, 0) / n;
  let numerator = 0;
  let denominator = 0;
  for (let i = 0; i < n; i += 1) {
    numerator += (xs[i] - xMean) * (list[i] - yMean);
    denominator += (xs[i] - xMean) ** 2;
  }
  if (denominator === 0) return 0;
  return Number((numerator / denominator).toFixed(4));
}

/**
 * Confidence-shrinkage weight for a sample size. 0 at n=0, approaches 1 as
 * n approaches fullAt. Never exceeds 1. Used to scale contributions so a
 * 2-game sample never carries the same weight as a 20-game sample.
 */
export function sampleShrinkage(n, fullAt = 12) {
  const size = Math.max(0, num(n, 0));
  const denom = Math.max(1, num(fullAt, 12));
  return Number(clamp(size / denom, 0, 1).toFixed(3));
}

/** Maps a quality tier to a 0-1 multiplier used to scale engine contributions. */
export function qualityMultiplier(quality) {
  switch (String(quality || "").toUpperCase()) {
    case ENGINE_SIGNAL_QUALITY.STRONG:
      return 1;
    case ENGINE_SIGNAL_QUALITY.USABLE:
      return 0.8;
    case ENGINE_SIGNAL_QUALITY.DEVELOPING:
      return 0.5;
    case ENGINE_SIGNAL_QUALITY.EARLY:
      return 0.25;
    default:
      return 0;
  }
}

/** Derives a quality tier from a raw sample size using shared thresholds. */
export function qualityFromSampleSize(n, { early = 3, developing = 6, usable = 12 } = {}) {
  const size = Math.max(0, num(n, 0));
  if (size <= 0) return ENGINE_SIGNAL_QUALITY.UNAVAILABLE;
  if (size < early) return ENGINE_SIGNAL_QUALITY.EARLY;
  if (size < developing) return ENGINE_SIGNAL_QUALITY.DEVELOPING;
  if (size < usable) return ENGINE_SIGNAL_QUALITY.USABLE;
  return ENGINE_SIGNAL_QUALITY.STRONG;
}

export function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

export function normalizeLeague(league = "") {
  const raw = String(league || "").trim().toUpperCase();
  return raw === "WNBA" ? "WNBA" : "NBA";
}

/** Regulation minutes per league — used to normalize pace/volume across leagues. */
export function leagueRegulationMinutes(league) {
  return normalizeLeague(league) === "WNBA" ? 40 : 48;
}

/**
 * True per-game estimated possessions (Basketball-Reference style):
 * FGA + 0.44*FTA - OREB + TOV.
 * Requires all four inputs to be present and finite — returns null otherwise.
 * Callers must NOT substitute 0 for a missing input; that would fabricate pace.
 */
export function estimatedPossessions(fga, fta, oreb, tov) {
  const f = numOrNull(fga);
  const t = numOrNull(fta);
  const o = numOrNull(oreb);
  const v = numOrNull(tov);
  if (f === null || t === null || o === null || v === null) return null;
  return Number((f + 0.44 * t - o + v).toFixed(3));
}

/**
 * Base template every CourtEdge engine signal must extend. Defaults are the
 * honest "no data" state — engines override only fields they can support
 * with real evidence.
 */
export function baseEngineSignal(overrides = {}) {
  const fetchedAt = overrides.fetchedAt || new Date().toISOString();
  return {
    engine: overrides.engine || "unknown",
    available: false,
    source: null,
    sourceIds: {},
    fetchedAt,
    sampleSize: 0,
    quality: ENGINE_SIGNAL_QUALITY.UNAVAILABLE,
    stale: false,
    error: null,
    fallbackUsed: false,
    rawValues: {},
    normalizedSignal: 0,
    overContribution: 0,
    underContribution: 0,
    confidenceAdjustment: 0,
    riskAdjustment: RISK_ADJUSTMENT.NEUTRAL,
    reason: null,
    units: null,
    ...overrides,
  };
}

/** Convenience wrapper for the "no usable data" case — never fabricates a vote. */
export function emptyEngineSignal(name, error = null, extra = {}) {
  return baseEngineSignal({
    engine: name,
    available: false,
    quality: ENGINE_SIGNAL_QUALITY.UNAVAILABLE,
    error: error || "insufficient_data",
    reason: error
      ? `${name}: ${error}`
      : `${name}: insufficient data — no vote cast`,
    ...extra,
  });
}

/** Splits normalizedSignal (-1..1) into separate over/under contribution magnitudes. */
export function contributionsFromSignal(normalizedSignal) {
  const s = clamp(num(normalizedSignal, 0), -1, 1);
  return {
    overContribution: s > 0 ? Number(s.toFixed(3)) : 0,
    underContribution: s < 0 ? Number(Math.abs(s).toFixed(3)) : 0,
  };
}
