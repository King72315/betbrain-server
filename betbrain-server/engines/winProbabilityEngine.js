function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avg(values = []) {
  const nums = values
    .map(num)
    .filter((v) => Number.isFinite(v));

  if (!nums.length) return 0;

  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function calculateHitRate(values = [], line = 0, side = "Over") {
  const nums = values
    .map(num)
    .filter((v) => Number.isFinite(v));

  if (!nums.length) return 0;

  const hits = nums.filter((v) =>
    side === "Over" ? v >= line : v <= line
  ).length;

  return hits / nums.length;
}

function buildProjection({
  line = 0,
  seasonAverage = 0,
  sportsProjection = 0,
  last5Profile = {},
  matchupProfile = {},
  opportunity = {},
  playoff = {}
}) {
  const last5Avg =
    num(last5Profile.avgPoints);

  const matchupAvg =
    num(matchupProfile.avgPoints);

  const opportunityScore =
    num(opportunity.opportunityScore);

  let projection = 0;
  let weightTotal = 0;

  function addWeighted(value, weight) {
    if (!value || value <= 0) return;

    projection += value * weight;
    weightTotal += weight;
  }

  addWeighted(line, 0.20);
  addWeighted(seasonAverage, 0.15);
  addWeighted(sportsProjection, 0.20);
  addWeighted(last5Avg, 0.30);

  if (matchupAvg > 0) {
    addWeighted(matchupAvg, 0.15);
  }

  if (weightTotal > 0) {
    projection = projection / weightTotal;
  } else {
    projection = line;
  }

  if (opportunityScore >= 80) {
    projection += 1.8;
  } else if (opportunityScore >= 70) {
    projection += 1.1;
  } else if (opportunityScore <= 45) {
    projection -= 1.8;
  } else if (opportunityScore <= 55) {
    projection -= 0.9;
  }

  projection += num(playoff.playoffAdjustment) * 0.35;

  return Number(projection.toFixed(1));
}

function buildWinProbability({
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
  underOdds = null
}) {
  const last5Points =
    last5.map((g) => num(g.points));

  const matchupPoints =
    matchupGames.map((g) => num(g.points));

  const last5Avg =
    avg(last5Points);

  const matchupAvg =
    avg(matchupPoints);

  const last5HitRate =
    calculateHitRate(last5Points, line, side);

  const matchupHitRate =
    matchupPoints.length
      ? calculateHitRate(matchupPoints, line, side)
      : null;

  const last5Profile = {
    avgPoints: last5Avg
  };

  const matchupProfile = {
    avgPoints: matchupAvg
  };

  const projection = buildProjection({
    line,
    seasonAverage,
    sportsProjection,
    last5Profile,
    matchupProfile,
    opportunity,
    playoff
  });

  const edge =
    side === "Over"
      ? projection - line
      : line - projection;

  let probability = 50;

  const reasons = [];
  const risks = [];

  // Opportunity is the strongest layer
  const oppScore =
    num(opportunity.opportunityScore);

  if (oppScore >= 85) {
    probability += 16;
    reasons.push("Elite opportunity");
  } else if (oppScore >= 75) {
    probability += 12;
    reasons.push("Strong opportunity");
  } else if (oppScore >= 65) {
    probability += 7;
    reasons.push("Good opportunity");
  } else if (oppScore >= 55) {
    probability += 2;
    reasons.push("Playable opportunity");
  } else {
    probability -= 10;
    risks.push("Weak opportunity");
  }

  // Projection edge
  if (edge >= 6) {
    probability += 12;
    reasons.push("Strong projection edge");
  } else if (edge >= 4) {
    probability += 8;
    reasons.push("Good projection edge");
  } else if (edge >= 2.5) {
    probability += 5;
    reasons.push("Moderate projection edge");
  } else if (edge >= 1.2) {
    probability += 2;
    reasons.push("Small projection edge");
  } else if (edge < 0) {
    probability -= 12;
    risks.push("Projection does not support pick");
  }

  // Last 5 scoring support
  if (last5.length >= 5) {
    if (last5HitRate >= 0.8) {
      probability += 10;
      reasons.push("Hit 4/5 recent games");
    } else if (last5HitRate >= 0.6) {
      probability += 6;
      reasons.push("Hit 3/5 recent games");
    } else if (last5HitRate <= 0.2) {
      probability -= 8;
      risks.push("Missed 4/5 recent games");
    } else if (last5HitRate <= 0.4) {
      probability -= 4;
      risks.push("Weak recent hit rate");
    }
  } else {
    risks.push("Limited Last 5 data");
  }

  // Matchup support, if available
  if (matchupHitRate !== null) {
    if (matchupHitRate >= 0.67) {
      probability += 6;
      reasons.push("Positive matchup history");
    } else if (matchupHitRate <= 0.33) {
      probability -= 5;
      risks.push("Weak matchup history");
    }
  }

  // Playoff adjustment
  const playoffAdjustment =
    num(playoff.playoffAdjustment);

  if (playoffAdjustment >= 5) {
    probability += 5;
    reasons.push("Strong playoff context");
  } else if (playoffAdjustment >= 2) {
    probability += 3;
    reasons.push("Positive playoff context");
  } else if (playoffAdjustment <= -5) {
    probability -= 6;
    risks.push("Bad playoff context");
  } else if (playoffAdjustment <= -2) {
    probability -= 3;
    risks.push("Negative playoff context");
  }

  // Sportsbook odds signal
  const pickOdds =
    side === "Over" ? overOdds : underOdds;

  if (pickOdds !== null && pickOdds !== undefined) {
    const odds = num(pickOdds);

    if (odds <= -150) {
      probability += 4;
      reasons.push("Sportsbook price supports side");
    } else if (odds <= -125) {
      probability += 2;
      reasons.push("Slight sportsbook support");
    } else if (odds >= 130) {
      probability -= 4;
      risks.push("Sportsbook price is plus-money risk");
    }
  }

  // Add engine reasons/risks
  reasons.push(...(opportunity.reasons || []));
  reasons.push(...(playoff.reasons || []));
  risks.push(...(opportunity.risks || []));
  risks.push(...(playoff.risks || []));

  // Keep honest probability range without fake role caps
  const finalProbability =
    Math.max(40, Math.min(88, Math.round(probability)));

  let strength = "Lean";

  if (finalProbability >= 75) {
    strength = "Elite";
  } else if (finalProbability >= 68) {
    strength = "Strong";
  }

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
    edge: Number(Math.abs(edge).toFixed(1)),
    winProbability: finalProbability,
    confidence: finalProbability,
    strength,
    seasonAverage: Number(num(seasonAverage).toFixed(1)),
    sportsProjection: Number(num(sportsProjection).toFixed(1)),
    last5Average: Number(last5Avg.toFixed(1)),
    matchupAverage:
      matchupPoints.length
        ? Number(matchupAvg.toFixed(1))
        : null,
    last5HitRate:
      last5.length
        ? Number((last5HitRate * 100).toFixed(0))
        : null,
    matchupHitRate:
      matchupHitRate !== null
        ? Number((matchupHitRate * 100).toFixed(0))
        : null,
    opportunityScore:
      opportunity.opportunityScore || 0,
    reasons: [...new Set(reasons)].slice(0, 6),
    risks: [...new Set(risks)].slice(0, 5)
  };
}

export {
    buildWinProbability
};

