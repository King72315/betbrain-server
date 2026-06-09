function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avg(values = []) {
  const nums = values.map(num).filter(Number.isFinite);
  if (!nums.length) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function buildOpportunityScore({
  last5 = [],
  projection = {},
  seasonAverage = 0,
  isPlayoff = true,
}) {
  const recentMinutes = avg(last5.map((g) => g.minutes));
  const recentFGA = avg(last5.map((g) => g.fga));
  const recentFTA = avg(last5.map((g) => g.fta));
  const recentPoints = avg(last5.map((g) => g.points));

  const projectedMinutes = num(
    projection.Minutes ||
      projection.ProjectedMinutes ||
      projection.MinutesPlayed ||
      0
  );

  const projectedFGA = num(
    projection.FieldGoalsAttempted ||
      projection.FGA ||
      projection.ProjectedFGA ||
      0
  );

  const projectedFTA = num(
    projection.FreeThrowsAttempted ||
      projection.FTA ||
      projection.ProjectedFTA ||
      0
  );

  const minutes = recentMinutes || projectedMinutes;
  const fga = recentFGA || projectedFGA;
  const fta = recentFTA || projectedFTA;

  const shotVolume = fga + fta * 0.44;

  let score = 50;
  const reasons = [];
  const risks = [];

  if (!minutes || !fga) {
    score -= 6;
    risks.push("Incomplete opportunity data");
  }

  // Minutes calibration
  if (minutes >= 36) {
    score += 8;
    reasons.push("Elite minutes");
  } else if (minutes >= 32) {
    score += 6;
    reasons.push("Strong minutes");
  } else if (minutes >= 28) {
    score += 4;
    reasons.push("Solid minutes");
  } else if (minutes >= 24) {
    score += 2;
    reasons.push("Playable minutes");
  } else if (minutes > 0) {
    score -= 8;
    risks.push("Low minutes");
  }

  // Playoff rotation boost
  if (isPlayoff && minutes >= 34) {
    score += 4;
    reasons.push("Trusted playoff rotation");
  }

  // Shot volume calibration
  if (fga >= 20) {
    score += 8;
    reasons.push("Elite shot volume");
  } else if (fga >= 16) {
    score += 6;
    reasons.push("Strong shot volume");
  } else if (fga >= 13) {
    score += 4;
    reasons.push("Good shot volume");
  } else if (fga >= 10) {
    score += 2;
    reasons.push("Playable shot volume");
  } else if (fga > 0) {
    score -= 8;
    risks.push("Low shot volume");
  }

  // Free throw floor
  if (fta >= 8) {
    score += 6;
    reasons.push("Elite free throw floor");
  } else if (fta >= 6) {
    score += 4;
    reasons.push("Strong free throw floor");
  } else if (fta >= 4) {
    score += 2;
    reasons.push("Useful free throw floor");
  } else if (fta > 0 && fta < 2) {
    score -= 2;
    risks.push("Weak free throw floor");
  }

  // Role stability
  const minutesList = last5
    .map((g) => num(g.minutes))
    .filter((v) => v > 0);

  let roleCertainty = minutes >= 28 ? 62 : 50;

  if (minutesList.length >= 3) {
    const max = Math.max(...minutesList);
    const min = Math.min(...minutesList);
    const range = max - min;

    if (range <= 6 && minutes >= 26) {
      score += 6;
      roleCertainty = 78;
      reasons.push("Stable role");
    } else if (range >= 14) {
      score -= 8;
      roleCertainty = 35;
      risks.push("Unstable minutes");
    } else if (range >= 10) {
      score -= 4;
      roleCertainty = 45;
      risks.push("Some role volatility");
    } else {
      roleCertainty = 62;
    }
  }

  // Recent scoring context
  if (seasonAverage && recentPoints && recentPoints >= seasonAverage + 3) {
    score += 2;
    reasons.push("Recent scoring above season level");
  }

  if (seasonAverage && recentPoints && recentPoints <= seasonAverage - 4) {
    score -= 2;
    risks.push("Recent scoring below season level");
  }

  const dataQuality =
    last5.length >= 5 ? 85 :
    last5.length >= 3 ? 65 :
    last5.length >= 1 ? 40 :
    25;

  const opportunityScore = clamp(Math.round(score), 0, 100);

  return {
    opportunityScore,
    recentMinutes: Number(num(minutes).toFixed(1)),
    recentFGA: Number(num(fga).toFixed(1)),
    recentFTA: Number(num(fta).toFixed(1)),
    recentPoints: Number(num(recentPoints).toFixed(1)),
    shotVolume: Number(num(shotVolume).toFixed(1)),
    roleCertainty,
    dataQuality,
    reasons: [...new Set(reasons)],
    risks: [...new Set(risks)],
  };
}