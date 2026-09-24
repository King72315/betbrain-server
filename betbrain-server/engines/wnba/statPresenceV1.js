/**
 * Null/missing vs actual-zero contract for REB/AST.
 * Actual 0 is a real stat and must pull averages down.
 * Null / undefined / "" is missing and is skipped.
 * A played game (minutes > 0) with the stat key omitted is treated as 0 —
 * box scores often leave true zeros off the payload.
 */
export const STAT_PRESENCE_BUILD = "courteedge-stat-presence-v1";

export function presentStatNumber(v) {
  if (v == null || v === "") return null;
  if (v === "-" || v === "--") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function firstPresentStat(row = {}, keys = []) {
  for (const k of keys) {
    const n = presentStatNumber(row?.[k]);
    if (n != null) return n;
  }
  return null;
}

function minutesPlayed(row = {}, minutesKeys = ["minutes", "min", "MIN"]) {
  const n = firstPresentStat(row, minutesKeys);
  return n != null && n > 0 ? n : null;
}

function keyExplicitlyMissing(row, keys) {
  if (!row || typeof row !== "object") return false;
  return keys.some((k) => Object.prototype.hasOwnProperty.call(row, k));
}

/**
 * One game's REB/AST (or similar counting stat).
 * Explicit 0 wins. Explicit null is missing. Omitted on a played game is 0.
 */
export function gameCountingStat(row = {}, keys = [], options = {}) {
  const explicit = firstPresentStat(row, keys);
  if (explicit != null) return explicit;
  if (keyExplicitlyMissing(row, keys)) return null;
  if (options.treatOmittedAsZeroWhenPlayed === false) return null;
  if (minutesPlayed(row, options.minutesKeys)) return 0;
  return null;
}

/**
 * Average a field across games.
 * Missing/null/blank skipped. 0 included. Omitted-on-played included as 0.
 */
export function avgPresentField(rows = [], keys = [], options = {}) {
  const nums = [];
  for (const g of rows || []) {
    const n = gameCountingStat(g, keys, options);
    if (n != null) nums.push(n);
  }
  if (!nums.length) return null;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

/**
 * Bins match the posted-line audit. Half-open except the last:
 * 1.49 → 1.0-1.49; 1.5 → 1.5-1.99. Never round 1.5 down into 1.0-1.49.
 */
export function postedLineGapBandV1(gap) {
  const x = Math.abs(Number(gap));
  if (!Number.isFinite(x)) return null;
  if (x < 0.5) return "0.0-0.49";
  if (x < 1.0) return "0.5-0.99";
  if (x < 1.5) return "1.0-1.49";
  if (x < 2.0) return "1.5-1.99";
  if (x < 3.0) return "2.0-2.99";
  return "3.0+";
}

/** Historical hit-rate support only. Does not choose side. */
export function historicallySupportedGapBandV1(market, band) {
  const m = String(market || "").toUpperCase();
  const b = String(band || "");
  if (m.includes("REB")) return b === "1.0-1.49";
  if (m.includes("ASSIST") || m === "AST") return b === "0.5-0.99" || b === "1.0-1.49";
  return false;
}

export function stampPostedLineGapV1(row = {}) {
  const gap = presentStatNumber(row.projectionGap ?? row.gap);
  const band = postedLineGapBandV1(gap);
  return {
    gapBand: band,
    historicallySupportedBand: historicallySupportedGapBandV1(row.market, band),
  };
}
