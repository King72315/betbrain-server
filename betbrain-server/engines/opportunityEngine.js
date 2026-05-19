function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avg(values = []) {
  const nums = values
    .map(num)
    .filter((v) => Number.isFinite(v));

  if (!nums.length) return 0;

  return (
    nums.reduce((sum, value) => sum + value, 0) /
    nums.length
  );
}

function buildOpportunityScore({
  last5 = [],
  projection = {},
  seasonAverage = 0,
  isPlayoff = true
}) {
  const recentMinutes =
    avg(last5.map((g) => g.minutes));

  const recentFGA =
    avg(last5.map((g) => g.fga));

  const recentFTA =
    avg(last5.map((g) => g.fta));

  const recentPoints =
    avg(last5.map((g) => g.points));

  const recent3 =
    last5.slice(0, 3);

  const recent3Minutes =
    avg(recent3.map((g) => g.minutes));

  const recent3FGA =
    avg(recent3.map((g) => g.fga));

  const projectedMinutes =
    num(
      projection.Minutes ||
      projection.ProjectedMinutes ||
      projection.Min ||
      0
    );

  const projectedFGA =
    num(
      projection.FieldGoalsAttempted ||
      projection.FGA ||
      projection.ProjectedFGA ||
      0
    );

  const projectedFTA =
    num(
      projection.FreeThrowsAttempted ||
      projection.FTA ||
      projection.ProjectedFTA ||
      0
    );

  const shotVolume =
    recentFGA + recentFTA * 0.44;

  const projectedShotVolume =
    projectedFGA + projectedFTA * 0.44;

  let score = 50;
  const reasons = [];
  const risks = [];

  // Minutes = opportunity foundation
  if (recentMinutes >= 36) {
    score += 18;
    reasons.push("Elite recent minutes");
  } else if (recentMinutes >= 32) {
    score += 14;
    reasons.push("Strong recent minutes");
  } else if (recentMinutes >= 28) {
    score += 8;
    reasons.push("Solid recent minutes");
  } else if (recentMinutes >= 24) {
    score += 3;
    reasons.push("Playable minutes");
  } else {
    score -= 12;
    risks.push("Low recent minutes");
  }

  // Playoff minutes matter more
  if (isPlayoff && recentMinutes >= 34) {
    score += 6;
    reasons.push("Trusted playoff rotation");
  }

  // Recent 3 trend
  if (recent3Minutes >= recentMinutes + 3) {
    score += 5;
    reasons.push("Minutes trending up");
  } else if (recent3Minutes <= recentMinutes - 3) {
    score -= 6;
    risks.push("Minutes trending down");
  }

  // Shot attempts = scoring opportunity
  if (recentFGA >= 20) {
    score += 18;
    reasons.push("Elite shot volume");
  } else if (recentFGA >= 16) {
    score += 14;
    reasons.push("Strong shot volume");
  } else if (recentFGA >= 13) {
    score += 8;
    reasons.push("Good shot volume");
  } else if (recentFGA >= 10) {
    score += 3;
    reasons.push("Acceptable shot volume");
  } else {
    score -= 12;
    risks.push("Low shot attempts");
  }

  // Recent 3 FGA trend
  if (recent3FGA >= recentFGA + 2) {
    score += 5;
    reasons.push("Shot attempts trending up");
  } else if (recent3FGA <= recentFGA - 2) {
    score -= 6;
    risks.push("Shot attempts trending down");
  }

  // Free throws create safer scoring floors
  if (recentFTA >= 8) {
    score += 10;
    reasons.push("Elite free throw floor");
  } else if (recentFTA >= 6) {
    score += 7;
    reasons.push("Strong free throw floor");
  } else if (recentFTA >= 4) {
    score += 4;
    reasons.push("Useful free throw floor");
  } else if (recentFTA < 2) {
    score -= 8;
    risks.push("Weak free throw floor");
  }

  // Projection support
  if (projectedMinutes >= 34) {
    score += 6;
    reasons.push("Projection supports heavy minutes");
  } else if (projectedMinutes > 0 && projectedMinutes < 26) {
    score -= 8;
    risks.push("Projection shows limited minutes");
  }

  if (projectedShotVolume >= 18) {
    score += 6;
    reasons.push("Projection supports shot volume");
  } else if (
    projectedShotVolume > 0 &&
    projectedShotVolume < 10
  ) {
    score -= 7;
    risks.push("Projection shows low shot volume");
  }

  // Role stability
  const minutesList =
    last5.map((g) => num(g.minutes));

  const maxMinutes =
    minutesList.length ? Math.max(...minutesList) : 0;

  const minMinutes =
    minutesList.length ? Math.min(...minutesList) : 0;

  const minutesRange =
    maxMinutes - minMinutes;

  if (minutesRange <= 6 && recentMinutes >= 26) {
    score += 8;
    reasons.push("Stable role");
  } else if (minutesRange >= 14) {
    score -= 12;
    risks.push("Unstable role/minutes");
  } else if (minutesRange >= 10) {
    score -= 6;
    risks.push("Some role volatility");
  }

  // Scoring involvement compared to season
  if (seasonAverage && recentPoints >= seasonAverage + 3) {
    score += 5;
    reasons.push("Recent scoring above season level");
  }

  if (seasonAverage && recentPoints <= seasonAverage - 4) {
    score -= 5;
    risks.push("Recent scoring below season level");
  }

  const finalScore =
    Math.max(0, Math.min(100, Math.round(score)));

  return {
    opportunityScore: finalScore,
    recentMinutes: Number(recentMinutes.toFixed(1)),
    recentFGA: Number(recentFGA.toFixed(1)),
    recentFTA: Number(recentFTA.toFixed(1)),
    shotVolume: Number(shotVolume.toFixed(1)),
    recentPoints: Number(recentPoints.toFixed(1)),
    reasons,
    risks
  };
}

export {
    buildOpportunityScore
};

