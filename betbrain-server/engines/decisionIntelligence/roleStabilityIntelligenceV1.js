/**
 * Role Stability Intelligence v1 — minutes/FGA/usage stability and hot-shooting risk.
 */
export const ROLE_STABILITY_VERSION = "role-stability-intelligence-v1";

const EXPANDING = new Set(["up", "expanding", "rising"]);
const CONTRACTING = new Set(["down", "contracting", "declining"]);

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function statusFromScore(score) {
  if (score >= 70) return "GOOD";
  if (score >= 45) return "PARTIAL";
  return "BAD";
}

export function evaluateRoleStabilityIntelligence(pick = {}, options = {}) {
  const card = options.dataCard || pick.wnbaDataCard || {};
  const side = normalizeSide(options.side || pick.side || pick.pick || pick.wnbaReader?.finalSide);
  const volumeProfile = pick.volumeProfile || options.volumeProfile || {};
  const opportunity = pick.opportunity || options.opportunity || {};
  const roleChange = pick.roleChange || options.roleChange || {};
  const reasons = [];

  const volatility = String(
    card.minutesVolatility ??
      volumeProfile.minutesVolatility ??
      volumeProfile.volumeStability ??
      "stable"
  ).toLowerCase();
  const roleTrend = String(card.roleTrend ?? volumeProfile.roleTrend ?? roleChange.roleTrend ?? "stable").toLowerCase();
  const minutes = num(card.last5?.minutes ?? pick.recentMinutes);
  const fga = num(card.last5?.fga ?? pick.recentFGA);
  const seasonFga = num(card.season?.fga);
  const recentPts = num(card.last5?.points);
  const seasonPts = num(card.season?.points);
  const ptsPerFga = num(card.last5?.ptsPerFGA);
  const seasonPtsPerFga = num(card.season?.ptsPerFGA);
  const efficiencyWarning = volumeProfile.efficiencyWarning || pick.efficiencyWarning || "";

  let score = 72;
  let sideImpact = "NEUTRAL";

  if (volatility === "unstable") {
    score -= 22;
    reasons.push("Minutes profile unstable.");
  } else if (volatility === "volatile") {
    score -= 14;
    reasons.push("Minutes profile volatile.");
  }

  if (minutes > 0 && minutes < 20) {
    score -= 8;
    reasons.push("Low recent minutes.");
  } else if (minutes >= 26) {
    score += 6;
    reasons.push("Strong recent minutes.");
  }

  if (fga > 0 && seasonFga > 0 && fga < seasonFga * 0.75) {
    score -= 10;
    reasons.push("FGA below season baseline.");
  } else if (fga >= 10) {
    score += 5;
    reasons.push("Stable FGA floor.");
  }

  const hotShooting =
    efficiencyWarning ||
    (ptsPerFga > 0 && seasonPtsPerFga > 0 && ptsPerFga >= seasonPtsPerFga * 1.1 && fga < 9);
  if (hotShooting) {
    score -= 12;
    reasons.push("Recent scoring driven by efficiency spike, not stable volume.");
  }

  if (side === "OVER") {
    if (CONTRACTING.has(roleTrend)) {
      score -= 16;
      sideImpact = "UNDER";
      reasons.push("Contracting role hurts Over.");
    } else if (EXPANDING.has(roleTrend)) {
      score += 10;
      sideImpact = "OVER";
      reasons.push("Expanding role supports Over.");
    }
    if (hotShooting) sideImpact = "UNDER";
  }

  if (side === "UNDER") {
    if (EXPANDING.has(roleTrend)) {
      score -= 16;
      sideImpact = "OVER";
      reasons.push("Expanding role hurts Under.");
    } else if (CONTRACTING.has(roleTrend)) {
      score += 10;
      sideImpact = "UNDER";
      reasons.push("Contracting role supports Under.");
    }
    if (volatility === "unstable" || volatility === "volatile") {
      sideImpact = "OVER";
      reasons.push("Volatile minutes create Over spike path.");
    }
  }

  if (recentPts > 0 && seasonPts > 0 && recentPts >= seasonPts + 5 && fga < seasonFga) {
    reasons.push("Hot recent game without FGA support.");
    if (side === "OVER") sideImpact = "UNDER";
  }

  score = clamp(Math.round(score), 0, 100);
  if (sideImpact === "NEUTRAL" && score >= 65) sideImpact = side || "NEUTRAL";
  if (sideImpact === "NEUTRAL" && score < 45 && side) {
    sideImpact = side === "OVER" ? "UNDER" : "OVER";
  }

  return {
    version: ROLE_STABILITY_VERSION,
    score,
    status: statusFromScore(score),
    sideImpact,
    roleTrend,
    minutesVolatility: volatility,
    hotShootingRisk: Boolean(hotShooting),
    reasons: reasons.slice(0, 6),
  };
}
