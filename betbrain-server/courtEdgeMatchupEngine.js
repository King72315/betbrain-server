function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function buildPlayerWeaponScore(player = {}, propType = "points") {
  const minutes = getNumber(player.minutes);
  const usage = getNumber(player.usageRate);
  const recentAvg = getNumber(player.recentAvg);
  const seasonAvg = getNumber(player.seasonAvg);
  const hitRate = getNumber(player.recentHitRate);
  const attempts = getNumber(player.attempts);

  let score = 50;

  if (minutes >= 34) score += 12;
  else if (minutes >= 30) score += 8;
  else if (minutes >= 26) score += 4;
  else score -= 8;

  if (usage >= 28) score += 12;
  else if (usage >= 24) score += 8;
  else if (usage >= 20) score += 4;
  else score -= 5;

  if (recentAvg > seasonAvg + 3) score += 8;
  else if (recentAvg > seasonAvg + 1) score += 4;
  else if (recentAvg < seasonAvg - 3) score -= 8;

  if (hitRate >= 0.8) score += 10;
  else if (hitRate >= 0.6) score += 5;
  else if (hitRate <= 0.3) score -= 10;

  if (attempts >= 18 && propType === "points") score += 8;
  if (attempts <= 8 && propType === "points") score -= 8;

  return clamp(score, 0, 100);
}

function buildTeamResistanceScore(team = {}, propType = "points") {
  let score = 50;

  const pointsAllowed = getNumber(team.pointsAllowedRank);
  const paceRank = getNumber(team.paceRank);
  const defensiveRank = getNumber(team.defensiveRank);
  const positionAllowedRank = getNumber(team.positionAllowedRank);

  // Higher score = weaker resistance / better matchup for over
  if (positionAllowedRank >= 22) score += 15;
  else if (positionAllowedRank >= 16) score += 8;
  else if (positionAllowedRank <= 8) score -= 12;

  if (pointsAllowed >= 22) score += 10;
  else if (pointsAllowed <= 8) score -= 10;

  if (paceRank >= 20) score += 8;
  else if (paceRank <= 8) score -= 8;

  if (defensiveRank >= 22) score += 10;
  else if (defensiveRank <= 8) score -= 10;

  return clamp(score, 0, 100);
}

function buildCourtEdgeMatchup({
  player = {},
  opponent = {},
  propType = "points",
  side = "over",
}) {
  const weaponScore = buildPlayerWeaponScore(player, propType);
  const resistanceScore = buildTeamResistanceScore(opponent, propType);

  const matchupAdvantage = weaponScore - (100 - resistanceScore);

  let signal = "NEUTRAL";
  let confidenceImpact = 0;
  const reasons = [];

  if (matchupAdvantage >= 25) {
    signal = side === "over" ? "OVER" : "DANGER";
    confidenceImpact = side === "over" ? 6 : -6;
    reasons.push("strong player weapon vs weak team resistance");
  } else if (matchupAdvantage >= 12) {
    signal = side === "over" ? "OVER" : "DANGER";
    confidenceImpact = side === "over" ? 3 : -3;
    reasons.push("positive player weapon matchup");
  } else if (matchupAdvantage <= -25) {
    signal = side === "over" ? "DANGER" : "UNDER";
    confidenceImpact = side === "over" ? -6 : 6;
    reasons.push("team resistance strongly limits player weapon");
  } else if (matchupAdvantage <= -12) {
    signal = side === "over" ? "DANGER" : "UNDER";
    confidenceImpact = side === "over" ? -3 : 3;
    reasons.push("negative player weapon matchup");
  } else {
    reasons.push("neutral player weapon vs team resistance");
  }

  return {
    weaponScore,
    resistanceScore,
    matchupAdvantage,
    signal,
    confidenceImpact,
    reasons,
    evidenceGroup: "MATCHUP_WEAPON_RESISTANCE",
  };
}

export {
    buildCourtEdgeMatchup,
    buildPlayerWeaponScore,
    buildTeamResistanceScore
};
