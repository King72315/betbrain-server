/**
 * Shared helpers for CourtEdge Player Intelligence (Phases 1–7).
 */

export function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function round(value, digits = 2) {
  const n = num(value);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function mean(values = []) {
  const nums = values.map((v) => num(v)).filter((v) => v !== null);
  if (!nums.length) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

export function stdDev(values = []) {
  const nums = values.map((v) => num(v)).filter((v) => v !== null);
  if (nums.length < 2) return null;
  const m = mean(nums);
  const variance =
    nums.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, nums.length - 1);
  return Math.sqrt(variance);
}

export function median(values = []) {
  const nums = values
    .map((v) => num(v))
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  if (nums.length % 2 === 0) return (nums[mid - 1] + nums[mid]) / 2;
  return nums[mid];
}

export function coefficientOfVariation(sd, avg) {
  if (sd === null || avg === null || avg === 0) return null;
  if (Math.abs(avg) < 1e-6) return null;
  return Math.abs(sd / avg);
}

export function cleanTeam(team = "") {
  return String(team || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

export function normalizeGame(game = {}) {
  return {
    date: game.date || null,
    minutes: num(game.minutes, 0) ?? 0,
    points: num(game.points, 0) ?? 0,
    fga: num(game.fga, 0) ?? 0,
    fta: num(game.fta, 0) ?? 0,
    fg3a: num(game.fg3a ?? game.threePa ?? game.three_pa, 0) ?? 0,
    opponent: game.opponent || "",
  };
}
