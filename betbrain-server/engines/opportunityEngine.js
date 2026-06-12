function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avg(values = []) {
  const nums = values.map(num).filter((v) => Number.isFinite(v) && v >= 0);
  if (!nums.length) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unique(list = []) {
  return [...new Set(list.filter(Boolean))];
}

function getThresholds(league = "NBA") {
  if (league === "WNBA") {
    return {
      eliteMinutes: 32,
      strongMinutes: 30,
      solidMinutes: 27,
      playableMinutes: 23,
      lowMinutes: 20,

      eliteFGA: 16,
      strongFGA: 14,
      goodFGA: 11,
      playableFGA: 8,
      lowFGA: 6,

      eliteFTA: 6,
      strongFTA: 4,
      usefulFTA: 3,

      stableRange: 6,
      volatileRange: 11,
      unstableRange: 15,
    };
  }

  return {
    eliteMinutes: 36,
    strongMinutes: 32,
    solidMinutes: 28,
    playableMinutes: 24,
    lowMinutes: 20,

    eliteFGA: 20,
    strongFGA: 16,
    goodFGA: 13,
    playableFGA: 10,
    lowFGA: 8,

    eliteFTA: 8,
    strongFTA: 6,
    usefulFTA: 4,

    stableRange: 6,
    volatileRange: 10,
    unstableRange: 14,
  };
}

function readProjectionValue(projection = {}, keys = []) {
  for (const key of keys) {
    const value = num(projection[key]);
    if (value > 0) return value;
  }

  return 0;
}

function getRange(values = []) {
  const nums = values.map(num).filter((v) => v > 0);

  if (!nums.length) {
    return {
      min: 0,
      max: 0,
      range: 0,
    };
  }

  const min = Math.min(...nums);
  const max = Math.max(...nums);

  return {
    min,
    max,
    range: Number((max - min).toFixed(1)),
  };
}

function getHitRate(points = [], line = 0, side = "Over") {
  if (!line || !points.length) return null;

  const hits = points.filter((p) =>
    side === "Over" ? p > line : p < line
  ).length;

  return hits / points.length;
}

function addSupport(list, text, scoreObj, weight = 1) {
  if (!text) return;
  list.push(text);
  scoreObj.value += weight;
}

function addDanger(list, text, scoreObj, weight = 1) {
  if (!text) return;
  list.push(text);
  scoreObj.value += weight;
}

export function buildOpportunityScore({
  last5 = [],
  projection = {},
  seasonAverage = 0,
  line = 0,
  side = "Over",
  league = "NBA",
  isPlayoff = true,
} = {}) {
  const thresholds = getThresholds(league);

  const recentMinutes = avg(last5.map((g) => g.minutes));
  const recentFGA = avg(last5.map((g) => g.fga));
  const recentFTA = avg(last5.map((g) => g.fta));
  const recent3PA = avg(last5.map((g) => g.fg3a));
  const recentPoints = avg(last5.map((g) => g.points));

  const projectedMinutes = readProjectionValue(projection, [
    "Minutes",
    "ProjectedMinutes",
    "MinutesPlayed",
    "MIN",
  ]);

  const projectedFGA = readProjectionValue(projection, [
    "FieldGoalsAttempted",
    "FGA",
    "ProjectedFGA",
  ]);

  const projectedFTA = readProjectionValue(projection, [
    "FreeThrowsAttempted",
    "FTA",
    "ProjectedFTA",
  ]);

  const projected3PA = readProjectionValue(projection, [
    "ThreePointersAttempted",
    "ThreePointAttempts",
    "FG3A",
    "Projected3PA",
  ]);

  const minutes = recentMinutes || projectedMinutes;
  const fga = recentFGA || projectedFGA;
  const fta = recentFTA || projectedFTA;
  const fg3a = recent3PA || projected3PA;

  const shotVolume = fga + fta * 0.44;

  const minutesList = last5.map((g) => num(g.minutes)).filter((v) => v > 0);
  const fgaList = last5.map((g) => num(g.fga)).filter((v) => v > 0);
  const pointsList = last5.map((g) => num(g.points)).filter((v) => v >= 0);

  const minutesRange = getRange(minutesList);
  const fgaRange = getRange(fgaList);
  const pointsRange = getRange(pointsList);

  let score = 50;
  let roleCertainty = minutes >= thresholds.solidMinutes ? 62 : 50;

  const reasons = [];
  const risks = [];

  const support = [];
  const danger = [];
  const supportScore = { value: 0 };
  const dangerScore = { value: 0 };

  if (!minutes) {
    score -= 8;
    addDanger(danger, "Missing minutes data", dangerScore, 8);
    risks.push("Missing minutes data");
  }

  if (!fga) {
    score -= 8;
    addDanger(danger, "Missing shot volume data", dangerScore, 8);
    risks.push("Missing shot volume data");
  }

  // Minutes profile
  if (minutes >= thresholds.eliteMinutes) {
    score += 9;
    addSupport(support, "Elite minutes", supportScore, 9);
    reasons.push("Elite minutes");
  } else if (minutes >= thresholds.strongMinutes) {
    score += 7;
    addSupport(support, "Strong minutes", supportScore, 7);
    reasons.push("Strong minutes");
  } else if (minutes >= thresholds.solidMinutes) {
    score += 5;
    addSupport(support, "Solid minutes", supportScore, 5);
    reasons.push("Solid minutes");
  } else if (minutes >= thresholds.playableMinutes) {
    score += 2;
    addSupport(support, "Playable minutes", supportScore, 2);
    reasons.push("Playable minutes");
  } else if (minutes > 0) {
    score -= 9;
    addDanger(danger, "Low minutes", dangerScore, 9);
    risks.push("Low minutes");
  }

  // Playoff / tight rotation boost
  if (isPlayoff && minutes >= thresholds.strongMinutes) {
    score += 4;
    addSupport(support, "Trusted high-minute rotation", supportScore, 4);
    reasons.push("Trusted high-minute rotation");
  }

  // Shot volume profile
  if (fga >= thresholds.eliteFGA) {
    score += 9;
    addSupport(support, "Elite shot volume", supportScore, 9);
    reasons.push("Elite shot volume");
  } else if (fga >= thresholds.strongFGA) {
    score += 7;
    addSupport(support, "Strong shot volume", supportScore, 7);
    reasons.push("Strong shot volume");
  } else if (fga >= thresholds.goodFGA) {
    score += 5;
    addSupport(support, "Good shot volume", supportScore, 5);
    reasons.push("Good shot volume");
  } else if (fga >= thresholds.playableFGA) {
    score += 2;
    addSupport(support, "Playable shot volume", supportScore, 2);
    reasons.push("Playable shot volume");
  } else if (fga > 0) {
    score -= 9;
    addDanger(danger, "Low shot volume", dangerScore, 9);
    risks.push("Low shot volume");
  }

  // Free throw floor
  if (fta >= thresholds.eliteFTA) {
    score += 6;
    addSupport(support, "Elite free throw floor", supportScore, 6);
    reasons.push("Elite free throw floor");
  } else if (fta >= thresholds.strongFTA) {
    score += 4;
    addSupport(support, "Strong free throw floor", supportScore, 4);
    reasons.push("Strong free throw floor");
  } else if (fta >= thresholds.usefulFTA) {
    score += 2;
    addSupport(support, "Useful free throw floor", supportScore, 2);
    reasons.push("Useful free throw floor");
  } else if (fta > 0 && fta < 2) {
    score -= 3;
    addDanger(danger, "Weak free throw floor", dangerScore, 3);
    risks.push("Weak free throw floor");
  }

  // Three-point volume support
  if (fg3a >= 7) {
    score += 3;
    addSupport(support, "Strong three-point attempt volume", supportScore, 3);
    reasons.push("Strong three-point attempt volume");
  } else if (fg3a >= 4) {
    score += 1;
    addSupport(support, "Useful three-point attempt volume", supportScore, 1);
    reasons.push("Useful three-point attempt volume");
  }

  // Role stability
  if (minutesList.length >= 3) {
    if (minutesRange.range <= thresholds.stableRange && minutes >= thresholds.playableMinutes) {
      score += 7;
      roleCertainty = 82;
      addSupport(support, "Stable role", supportScore, 7);
      reasons.push("Stable role");
    } else if (minutesRange.range >= thresholds.unstableRange) {
      score -= 10;
      roleCertainty = 32;
      addDanger(danger, "Unstable minutes", dangerScore, 10);
      risks.push("Unstable minutes");
    } else if (minutesRange.range >= thresholds.volatileRange) {
      score -= 5;
      roleCertainty = 45;
      addDanger(danger, "Some role volatility", dangerScore, 5);
      risks.push("Some role volatility");
    } else {
      roleCertainty = 65;
    }
  } else if (last5.length > 0) {
    roleCertainty = 45;
    score -= 3;
    addDanger(danger, "Limited role sample", dangerScore, 3);
    risks.push("Limited role sample");
  }

  // Recent scoring context
  if (seasonAverage && recentPoints) {
    if (recentPoints >= seasonAverage + 4) {
      score += 4;
      addSupport(support, "Recent scoring above season level", supportScore, 4);
      reasons.push("Recent scoring above season level");
    } else if (recentPoints <= seasonAverage - 5) {
      score -= 5;
      addDanger(danger, "Recent scoring below season level", dangerScore, 5);
      risks.push("Recent scoring below season level");
    }
  }

  // Line-relative context when available
  const recentHitRateOver = getHitRate(pointsList, line, "Over");
  const recentHitRateUnder = getHitRate(pointsList, line, "Under");

  if (line > 0 && pointsList.length >= 3) {
    if (side === "Over" && recentHitRateOver >= 0.8) {
      score += 5;
      addSupport(support, "Strong recent hit rate over the line", supportScore, 5);
      reasons.push("Strong recent hit rate over the line");
    }

    if (side === "Over" && recentHitRateOver <= 0.2) {
      score -= 5;
      addDanger(danger, "Poor recent hit rate over the line", dangerScore, 5);
      risks.push("Poor recent hit rate over the line");
    }

    if (side === "Under" && recentHitRateUnder >= 0.8) {
      score += 5;
      addSupport(support, "Strong recent hit rate under the line", supportScore, 5);
      reasons.push("Strong recent hit rate under the line");
    }

    if (side === "Under" && recentHitRateUnder <= 0.2) {
      score -= 5;
      addDanger(danger, "Poor recent hit rate under the line", dangerScore, 5);
      risks.push("Poor recent hit rate under the line");
    }
  }

  // Volatility
  let volatilityLabel = "LOW";

  if (pointsRange.range >= 18) {
    volatilityLabel = "HIGH";
    score -= 6;
    addDanger(danger, "High scoring volatility", dangerScore, 6);
    risks.push("High scoring volatility");
  } else if (pointsRange.range >= 11) {
    volatilityLabel = "MEDIUM";
    score -= 3;
    addDanger(danger, "Medium scoring volatility", dangerScore, 3);
    risks.push("Medium scoring volatility");
  }

  // Raw quality / coverage
  let rawQuality = 40;

  if (last5.length >= 5) rawQuality += 25;
  else if (last5.length >= 3) rawQuality += 15;
  else if (last5.length >= 1) rawQuality += 5;

  if (minutes > 0) rawQuality += 10;
  if (fga > 0) rawQuality += 10;
  if (recentPoints > 0) rawQuality += 10;
  if (seasonAverage > 0) rawQuality += 5;

  rawQuality = clamp(Math.round(rawQuality), 0, 100);

  let dataQuality = rawQuality;

  if (roleCertainty >= 75) dataQuality += 8;
  else if (roleCertainty < 45) dataQuality -= 10;

  if (volatilityLabel === "HIGH") dataQuality -= 10;
  if (volatilityLabel === "LOW") dataQuality += 5;

  dataQuality = clamp(Math.round(dataQuality), 0, 100);

  const coverageItems = [
    last5.length >= 5,
    minutes > 0,
    fga > 0,
    fta > 0,
    recentPoints > 0,
    seasonAverage > 0,
  ];

  const covered = coverageItems.filter(Boolean).length;
  const evidenceCoverage = Number((covered / coverageItems.length).toFixed(2));
  const dataCoverage = Math.round(evidenceCoverage * 100);

  const opportunityScore = clamp(Math.round(score), 0, 100);

  const finalSupport = unique([...support, ...reasons]);
  const finalDanger = unique([...danger, ...risks]);

  const finalSupportScore = supportScore.value;
  const finalDangerScore = dangerScore.value;
  const gap = Number((finalSupportScore - finalDangerScore).toFixed(1));

  return {
    opportunityScore,

    recentMinutes: Number(num(minutes).toFixed(1)),
    recentFGA: Number(num(fga).toFixed(1)),
    recentFTA: Number(num(fta).toFixed(1)),
    recent3PA: Number(num(fg3a).toFixed(1)),
    recentPoints: Number(num(recentPoints).toFixed(1)),

    shotVolume: Number(num(shotVolume).toFixed(1)),

    roleCertainty,
    minutesStability: {
      games: minutesList.length,
      min: minutesRange.min,
      max: minutesRange.max,
      range: minutesRange.range,
    },

    shotVolumeStability: {
      games: fgaList.length,
      min: fgaRange.min,
      max: fgaRange.max,
      range: fgaRange.range,
    },

    scoringVolatility: {
      label: volatilityLabel,
      min: pointsRange.min,
      max: pointsRange.max,
      range: pointsRange.range,
    },

    recentHitRateOver:
      recentHitRateOver !== null ? Math.round(recentHitRateOver * 100) : null,

    recentHitRateUnder:
      recentHitRateUnder !== null ? Math.round(recentHitRateUnder * 100) : null,

    rawQuality,
    dataQuality,
    dataCoverage,
    evidenceCoverage,

    support: finalSupport,
    danger: finalDanger,
    supportScore: finalSupportScore,
    dangerScore: finalDangerScore,
    gap,

    reasons: unique(reasons),
    risks: unique(risks),
  };
}