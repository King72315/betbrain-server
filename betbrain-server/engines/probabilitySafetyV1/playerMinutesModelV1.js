/**
 * playerMinutesModelV1 — minutes before points.
 */
import { MINUTES_MODEL_VERSION } from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * @param {object} pick — candidate / player packet
 * @returns {object} minutes model
 */
export function buildPlayerMinutesModelV1(pick = {}) {
  const recent =
    num(pick.avgMinutesL5) ??
    num(pick.minutesL5) ??
    num(pick.recentMinutes) ??
    num(pick.L5?.minutes) ??
    num(pick.homeDetailedAnalysisV1?.minutes?.l5);
  const season =
    num(pick.avgMinutes) ??
    num(pick.seasonMinutes) ??
    num(pick.minutesAvg) ??
    num(pick.homeDetailedAnalysisV1?.minutes?.season);
  const projected =
    num(pick.projectedMinutes) ??
    num(pick.expectedMinutes) ??
    num(pick.minutesProjection);

  const expectedMinutes =
    projected ??
    (recent != null && season != null
      ? 0.6 * recent + 0.4 * season
      : recent ?? season ?? 24);

  const samples = [recent, season, projected].filter((x) => x != null);
  const mean =
    samples.length > 0
      ? samples.reduce((a, b) => a + b, 0) / samples.length
      : expectedMinutes;
  const variance =
    samples.length > 1
      ? samples.reduce((s, x) => s + (x - mean) ** 2, 0) / samples.length
      : Math.max(4, (expectedMinutes * 0.12) ** 2);
  const minutesStdDev = Math.sqrt(variance);
  const minutesCv =
    expectedMinutes > 0 ? minutesStdDev / expectedMinutes : 1;

  // Stability: lower CV + higher minutes → higher score
  let minutesStabilityScore = 100 - clamp(minutesCv * 180, 0, 70);
  if (expectedMinutes < 18) minutesStabilityScore -= 15;
  if (expectedMinutes < 12) minutesStabilityScore -= 20;

  const avail = String(
    pick.availabilityStatus ||
      pick.availability ||
      pick.injuryStatus ||
      pick.status ||
      ""
  ).toUpperCase();
  const restricted =
    /QUESTION|DOUBT|GTD|OUT|INACTIVE|REST|RESTRICT|LIMIT/.test(avail);
  const returning =
    Boolean(pick.returningFromAbsence) ||
    Boolean(pick.minutesRestriction) ||
    /RETURN|REST/.test(avail);

  if (restricted) minutesStabilityScore -= 35;
  if (returning) minutesStabilityScore -= 20;
  if (pick.minutesRestriction) minutesStabilityScore -= 40;

  minutesStabilityScore = clamp(Math.round(minutesStabilityScore), 0, 100);

  const minutesFloor = Math.max(0, expectedMinutes - 1.5 * minutesStdDev);
  const minutesCeiling = expectedMinutes + 1.5 * minutesStdDev;
  const minutesMedian = expectedMinutes;

  return {
    version: MINUTES_MODEL_VERSION,
    expectedMinutes: Number(expectedMinutes.toFixed(2)),
    minutesMedian: Number(minutesMedian.toFixed(2)),
    minutesFloor: Number(minutesFloor.toFixed(2)),
    minutesCeiling: Number(minutesCeiling.toFixed(2)),
    minutesStdDev: Number(minutesStdDev.toFixed(3)),
    minutesCoefficientOfVariation: Number(minutesCv.toFixed(4)),
    probabilityBelowExpectedRole: clamp(0.5 * minutesCv, 0, 0.5),
    minutesStabilityScore,
    restricted: Boolean(restricted || pick.minutesRestriction),
    returning: Boolean(returning),
    missingness: {
      recent: recent == null,
      season: season == null,
      projected: projected == null,
    },
  };
}
