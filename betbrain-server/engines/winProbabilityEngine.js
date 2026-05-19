function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avg(values = []) {
  const nums = values.map(num).filter(Number.isFinite);
  if (!nums.length) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function hitRate(values = [], line = 0, side = "Over") {
  if (!values.length) return null;

  const hits = values.filter((v) =>
    side === "Over" ? num(v) > line : num(v) < line
  ).length;

  return hits / values.length;
}

function strengthFromProbability(probability) {
  if (probability >= 75) return "Elite";
  if (probability >= 68) return "Strong";
  return "Lean";
}

export function buildWinProbability({
  player = "",
  team = "",
  opponent = "",
  game = "",
  line = 0,
  side = "Over",
  seasonAverage = 0,
  sportsProjection = 0,
  last5 = [],
  matchupGames = [],
  opportunity = {},
  playoff = {},
  overOdds = null,
  underOdds = null,
}) {
  const last5Points = last5.map((g) => num(g.points));
  const matchupPoints = matchupGames.map((g) => num(g.points));

  const last5Average = avg(last5Points);
  const matchupAverage = avg(matchupPoints);

  const recentHitRate = hitRate(last5Points, line, side);
  const matchupHitRate = hitRate(matchupPoints, line, side);

  const opportunityScore = num(opportunity.opportunityScore);
  const playoffAdjustment = num(playoff.playoffAdjustment);

  const projectionValues = [];
  const projectionWeights = [];

  function addProjection(value, weight) {
    const v = num(value);
    if (v > 0) {
      projectionValues.push(v * weight);
      projectionWeights.push(weight);
    }
  }

  addProjection(last5Average,0.45);
addProjection(seasonAverage,0.25);
addProjection(sportsProjection,0.15);
addProjection(matchupAverage,0.15);

  if (matchupAverage > 0) {
    addProjection(matchupAverage, 0.15);
  }

  let projection =
    projectionWeights.length > 0
      ? projectionValues.reduce((a, b) => a + b, 0) /
        projectionWeights.reduce((a, b) => a + b, 0)
      : line;

  if (opportunityScore >= 85) projection += 2.2;
  else if (opportunityScore >= 75) projection += 1.5;
  else if (opportunityScore >= 65) projection += 0.8;
  else if (opportunityScore <= 45) projection -= 1.8;

  projection += playoffAdjustment * 0.3;
  projection = Number(projection.toFixed(1));

  const rawEdge =
    side === "Over" ? projection - line : line - projection;

  let probability = 50;
  const reasons = [];
  const risks = [];

  if (opportunityScore >= 85) {
    probability += 18;
    reasons.push("Elite opportunity");
  } else if (opportunityScore >= 75) {
    probability += 14;
    reasons.push("Strong opportunity");
  } else if (opportunityScore >= 65) {
    probability += 9;
    reasons.push("Good opportunity");
  } else if (opportunityScore >= 55) {
    probability += 4;
    reasons.push("Playable opportunity");
  } else {
    probability -= 9;
    risks.push("Weak opportunity");
  }

  if (rawEdge >= 6) {
    probability += 12;
    reasons.push("Strong projection edge");
  } else if (rawEdge >= 4) {
    probability += 8;
    reasons.push("Good projection edge");
  } else if (rawEdge >= 2) {
    probability += 4;
    reasons.push("Small projection edge");
  } else if (rawEdge < 0) {
    probability -= 10;
    risks.push("Projection does not support pick");
  }

  if (recentHitRate !== null) {
    if (recentHitRate >= 0.8) {
      probability += 9;
      reasons.push("Strong recent hit rate");
    } else if (recentHitRate >= 0.6) {
      probability += 5;
      reasons.push("Positive recent hit rate");
    } else if (recentHitRate <= 0.2) {
      probability -= 8;
      risks.push("Poor recent hit rate");
    } else if (recentHitRate <= 0.4) {
      probability -= 4;
      risks.push("Weak recent hit rate");
    }
  } else {
    risks.push("Limited Last 5 data");
  }

  if (matchupHitRate !== null) {
    if (matchupHitRate >= 0.67) {
      probability += 5;
      reasons.push("Positive matchup history");
    } else if (matchupHitRate <= 0.33) {
      probability -= 4;
      risks.push("Weak matchup history");
    }
  }

  if (playoffAdjustment >= 5) {
    probability += 5;
    reasons.push("Strong playoff context");
  } else if (playoffAdjustment >= 2) {
    probability += 3;
    reasons.push("Positive playoff context");
  } else if (playoffAdjustment <= -5) {
    probability -= 5;
    risks.push("Bad playoff context");
  } else if (playoffAdjustment <= -2) {
    probability -= 3;
    risks.push("Negative playoff context");
  }

  const pickOdds = side === "Over" ? overOdds : underOdds;

  if (pickOdds !== null && pickOdds !== undefined) {
    const odds = num(pickOdds);

    if (odds <= -150) {
      probability += 3;
      reasons.push("Sportsbook price supports side");
    } else if (odds <= -125) {
      probability += 2;
      reasons.push("Slight sportsbook support");
    } else if (odds >= 130) {
      probability -= 3;
      risks.push("Plus-money risk");
    }
  }

  reasons.push(...(opportunity.reasons || []));
  reasons.push(...(playoff.reasons || []));
  risks.push(...(opportunity.risks || []));
  risks.push(...(playoff.risks || []));

  const finalProbability = Math.max(35, Math.min(88, Math.round(probability)));

  return {
    player,
    team,
    opponent,
    game,
    stat: "Points",
    pick: side,
    side,
    line,
    projection,
    edge: Number(Math.abs(rawEdge).toFixed(1)),
    winProbability: finalProbability,
    confidence: finalProbability,
    strength: strengthFromProbability(finalProbability),
    seasonAverage: Number(num(seasonAverage).toFixed(1)),
    sportsProjection: Number(num(sportsProjection).toFixed(1)),
    last5Average: Number(last5Average.toFixed(1)),
    matchupAverage: matchupPoints.length ? Number(matchupAverage.toFixed(1)) : null,
    last5HitRate:
      recentHitRate !== null ? Math.round(recentHitRate * 100) : null,
    matchupHitRate:
      matchupHitRate !== null ? Math.round(matchupHitRate * 100) : null,
    opportunityScore,
    reasons: [...new Set(reasons)].slice(0, 6),
    risks: [...new Set(risks)].slice(0, 5),
  };
}