/**
 * Usage Share Intelligence v1 — FGA/minutes/FTA share trends for side support.
 */
export const USAGE_SHARE_VERSION = "usage-share-intelligence-v1";

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

function trendLabel(value = "") {
  const raw = String(value || "").toUpperCase();
  if (raw.includes("UP") || raw.includes("EXPAND")) return "UP";
  if (raw.includes("DOWN") || raw.includes("CONTRACT")) return "DOWN";
  if (raw.includes("STABLE")) return "STABLE";
  return "UNKNOWN";
}

function statusFromScore(score) {
  if (score >= 70) return "GOOD";
  if (score >= 45) return "PARTIAL";
  return "BAD";
}

export function evaluateUsageShareIntelligence(pick = {}, options = {}) {
  const card = options.dataCard || pick.wnbaDataCard || {};
  const side = normalizeSide(options.side || pick.side || pick.pick);
  const roleChange = pick.roleChange || options.roleChange || {};
  const opportunity = pick.opportunity || options.opportunity || {};
  const playerState = pick.playerState || options.playerState || {};
  const reasons = [];

  const minutesTrend = trendLabel(
    roleChange.recentMinutesTrend ?? opportunity.minutesStability?.trend
  );
  const fgaTrend = trendLabel(roleChange.recentFGATrend ?? opportunity.shotVolumeStability?.trend);
  const ftaTrend = trendLabel(roleChange.recentFTATrend);
  const threeTrend = trendLabel(roleChange.recentThreeTrend ?? playerState.threeTrend);

  const minutes = num(card.last5?.minutes ?? playerState.recentMinutes);
  const fga = num(card.last5?.fga ?? playerState.recentFGA);
  const fta = num(card.last5?.fta ?? playerState.recentFTA);
  const roleCertainty = num(opportunity.roleCertainty, 55);

  let score = 60;
  let sideImpact = "NEUTRAL";

  if (minutesTrend === "UP") {
    score += 8;
    reasons.push("Minutes trend up.");
  } else if (minutesTrend === "DOWN") {
    score -= 10;
    reasons.push("Minutes trend down.");
  }

  if (fgaTrend === "UP") {
    score += 10;
    reasons.push("FGA share trend up.");
  } else if (fgaTrend === "DOWN") {
    score -= 12;
    reasons.push("FGA share trend down.");
  }

  if (ftaTrend === "UP") {
    score += 4;
    reasons.push("FTA trend up — paint pressure.");
  } else if (ftaTrend === "DOWN") {
    score -= 6;
    reasons.push("FTA trend down.");
  }

  if (roleCertainty >= 70) {
    score += 6;
    reasons.push("High role certainty.");
  } else if (roleCertainty < 45) {
    score -= 10;
    reasons.push("Low role certainty.");
  }

  if (side === "OVER") {
    if (minutesTrend === "UP" && fgaTrend === "UP") {
      sideImpact = "OVER";
      score += 8;
      reasons.push("Usage + FGA rising supports Over.");
    }
    if (minutes < 22 || fga < 8) {
      sideImpact = "UNDER";
      score -= 10;
      reasons.push("Usage floor too low for Over.");
    }
  }

  if (side === "UNDER") {
    if (minutesTrend === "DOWN" && fgaTrend === "DOWN") {
      sideImpact = "UNDER";
      score += 8;
      reasons.push("Usage + FGA falling supports Under.");
    }
    if (minutes >= 28 && fga >= 12) {
      sideImpact = "OVER";
      score -= 12;
      reasons.push("High usage path weakens Under.");
    }
  }

  score = clamp(Math.round(score), 0, 100);

  return {
    version: USAGE_SHARE_VERSION,
    score,
    status: statusFromScore(score),
    usageTrend: minutesTrend,
    fgaShareTrend: fgaTrend,
    threePointShareTrend: threeTrend,
    ftaShareTrend: ftaTrend,
    sideImpact,
    reasons: reasons.slice(0, 6),
  };
}
