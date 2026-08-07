/**
 * playerRoleStabilityEngineV1
 */
import { ROLE_MODEL_VERSION } from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function buildPlayerRoleStabilityEngineV1(pick = {}) {
  const starter =
    pick.isStarter === true ||
    String(pick.starterStatus || "").toUpperCase() === "STARTER" ||
    num(pick.startsL5, 0) >= 3;

  const usage =
    num(pick.usageRate) ??
    num(pick.usage) ??
    num(pick.expectedUsage) ??
    num(pick.homeDetailedAnalysisV1?.usage?.rate);

  const usageL5 =
    num(pick.usageL5) ?? num(pick.recentUsage) ?? usage;
  const usageSeason = num(pick.usageSeason) ?? usage;

  const fga = num(pick.expectedFGA) ?? num(pick.avgFGA) ?? num(pick.FGA);
  const fgaL5 = num(pick.FGA_L5) ?? num(pick.avgFGAL5) ?? fga;
  const fta = num(pick.expectedFTA) ?? num(pick.avgFTA) ?? num(pick.FTA);
  const threePa =
    num(pick.expected3PA) ?? num(pick.avg3PA) ?? num(pick["3PA"]);

  const recentRoleChange =
    Boolean(pick.recentRoleChange) ||
    Boolean(pick.roleChange) ||
    Math.abs((usageL5 ?? 0) - (usageSeason ?? 0)) > 0.06;

  const teammateImpact =
    Boolean(pick.teammateAvailabilityImpact) ||
    Boolean(pick.keyTeammateReturning) ||
    Boolean(pick.keyTeammateOut);

  let roleStabilityScore = starter ? 82 : 68;
  if (usage != null && usageL5 != null && usageSeason != null) {
    const drift = Math.abs(usageL5 - usageSeason);
    roleStabilityScore -= clamp(drift * 250, 0, 30);
  }
  if (recentRoleChange) roleStabilityScore -= 18;
  if (teammateImpact) roleStabilityScore -= 12;
  if (fga != null && fgaL5 != null && Math.abs(fga - fgaL5) > 3) {
    roleStabilityScore -= 8;
  }
  if (pick.ROLE_ENVIRONMENT_CHANGED || pick.roleEnvironmentChanged) {
    roleStabilityScore -= 20;
  }

  roleStabilityScore = clamp(Math.round(roleStabilityScore), 0, 100);

  const roleTrend =
    usageL5 != null && usageSeason != null
      ? usageL5 > usageSeason + 0.02
        ? "UP"
        : usageL5 < usageSeason - 0.02
          ? "DOWN"
          : "STABLE"
      : "UNKNOWN";

  return {
    version: ROLE_MODEL_VERSION,
    roleStabilityScore,
    roleTrend,
    starterStatus: starter ? "STARTER" : "BENCH_OR_UNKNOWN",
    expectedUsage: usage,
    usageStability:
      usageL5 != null && usageSeason != null
        ? clamp(100 - Math.abs(usageL5 - usageSeason) * 400, 0, 100)
        : null,
    FGAStability:
      fga != null && fgaL5 != null
        ? clamp(100 - Math.abs(fga - fgaL5) * 8, 0, 100)
        : null,
    FTAStability: fta != null ? 70 : null,
    threePointVolumeStability: threePa != null ? 65 : null,
    recentRoleChange,
    teammateAvailabilityImpact: teammateImpact,
    ROLE_ENVIRONMENT_CHANGED: Boolean(
      pick.ROLE_ENVIRONMENT_CHANGED ||
        pick.roleEnvironmentChanged ||
        (recentRoleChange && teammateImpact)
    ),
    missingness: {
      usage: usage == null,
      fga: fga == null,
    },
  };
}
