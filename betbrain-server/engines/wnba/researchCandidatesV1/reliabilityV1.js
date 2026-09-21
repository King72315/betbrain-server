/**
 * Market-specific reliability diagnostics. No probability input.
 */
import { minutesCertainty } from "./minutesV1.js";

export const RESEARCH_RELIABILITY_BUILD = "courteedge-research-reliability-v1";

export function astReliability(player, role) {
  const n = player?.n || 0;
  const depth = Math.max(0, Math.min(1, n / 16));
  const minutes = minutesCertainty(player || {});
  const roleCert =
    role?.role === "PRIMARY_CREATOR" || role?.role === "LOW_CREATION_ROLE"
      ? 0.8
      : role?.ballHandlingUnstable
        ? 0.25
        : 0.5;
  const residualProxy = player?.last5MinCv == null ? 0.45 : Math.max(0, 1 - player.last5MinCv / 0.5);
  return Number((0.35 * depth + 0.3 * minutes + 0.2 * roleCert + 0.15 * residualProxy).toFixed(3));
}

export function rebReliability(player, rebRole) {
  const n = player?.n || 0;
  const depth = Math.max(0, Math.min(1, n / 16));
  const minutes = minutesCertainty(player || {});
  const roleCert = rebRole?.likelyInteriorMinutes ? 0.75 : rebRole?.smallBallRole ? 0.45 : 0.55;
  const residualProxy = player?.last5MinCv == null ? 0.45 : Math.max(0, 1 - player.last5MinCv / 0.5);
  return Number((0.4 * depth + 0.3 * minutes + 0.15 * roleCert + 0.15 * residualProxy).toFixed(3));
}
