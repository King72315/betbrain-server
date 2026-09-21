/**
 * Shared minutes candidates. Research-only.
 * Does not infer minutes from sportsbook lines.
 */
import { blend, expRecency, num } from "./featuresV1.js";

export const RESEARCH_MINUTES_BUILD = "courteedge-research-minutes-v1";

export function minutesCurrent(player) {
  const m = blend(player.recentMin, player.seasonMin, 0.6);
  return m == null ? null : Number(m.toFixed(1));
}

/** Exponential recency of last 15 played games. */
export function minutesA(player) {
  const xs = (player.games || []).slice(-15).map((g) => num(g.MIN));
  const m = expRecency(xs, 0.85);
  return m == null ? minutesCurrent(player) : Number(m.toFixed(1));
}

/** Role-aware: starters keep more season, benches more recency. Return-from-absence damps. */
export function minutesB(player, extras = {}) {
  const start = player.recentStarterShare ?? player.starterShare ?? 0.5;
  const w = start >= 0.6 ? 0.5 : start <= 0.3 ? 0.8 : 0.65;
  let m = blend(player.recentMin, player.seasonMin, w);
  if (m == null) m = minutesA(player);
  const gap = extras.daysSinceLastGame;
  if (gap != null && gap >= 8 && m != null) m *= 0.92;
  return m == null ? null : Number(m.toFixed(1));
}

export function minutesCertainty(player) {
  const n = player.n || 0;
  const depth = Math.max(0, Math.min(1, n / 16));
  const cv = player.last5MinCv ?? player.minCv ?? 0.4;
  const stable = Math.max(0, Math.min(1, 1 - cv / 0.45));
  const role = player.starterShare == null ? 0.4 : player.starterShare >= 0.7 || player.starterShare <= 0.25 ? 0.85 : 0.45;
  return Number((0.4 * depth + 0.35 * stable + 0.25 * role).toFixed(3));
}
