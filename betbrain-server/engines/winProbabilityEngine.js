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

function hitRate(points = [], line = 0, side = "Over") {
  const cleanPoints = points.map(num).filter((v) => Number.isFinite(v));

  if (!cleanPoints.length || !Number.isFinite(Number(line))) return null;

  const hits = cleanPoints.filter((p) =>
    side === "Over" ? p > line : p < line
  ).length;

  return hits / cleanPoints.length;
}

function strengthFromProbability(probability) {
  if (probability >= 75) return "Elite";
  if (probability >= 68) return "Strong";
  return "Lean";
}

function addUnique(list, text) {
  if (text && !list.includes(text)) list.push(text);
}

function addSupport({ text, weight = 1, support, reasons, score }) {
  addUnique(support, text);
  addUnique(reasons, text);
  score.value += weight;
}

function addResistance({ text, weight = 1, resistance, risks, score }) {
  addUnique(resistance, text);
  addUnique(risks, text);
  score.value += weight;
}

function getRange(values = []) {
  const nums = values.map(num).filter((v) => Number.isFinite(v));

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

function buildProjection({
  last5Average = 0,
  seasonAverage = 0,
  sportsProjection = 0,
  matchupAverage = 0,
  opportunityScore = 50,
  playoffAdjustment = 0,
  line = 0,
}) {
  const weightedValues = [];
  const weights = [];
  const sources = [];

  function addWeighted(name, value, weight) {
    const v = num(value);

    if (v > 0) {
      weightedValues.push(v * weight);
      weights.push(weight);
      sources.push(name);
    }
  }

  const hasSportsProjection = num(sportsProjection) > 0;

  if (hasSportsProjection) {
    addWeighted("last5", last5Average, 0.35);
    addWeighted("season", seasonAverage, 0.25);
    addWeighted("sportsProjection", sportsProjection, 0.30);
    addWeighted("matchup", matchupAverage, 0.10);
  } else {
    addWeighted("last5", last5Average, 0.45);
    addWeighted("season", seasonAverage, 0.40);
    addWeighted("matchup", matchupAverage, 0.15);
  }

  let projection =
    weights.length > 0
      ? weightedValues.reduce((a, b) => a + b, 0) /
        weights.reduce((a, b) => a + b, 0)
      : num(line);

  let adjustment = 0;

  if (opportunityScore >= 80) adjustment += 1.0;
  else if (opportunityScore >= 70) adjustment += 0.6;
  else if (opportunityScore > 0 && opportunityScore <= 40) adjustment -= 0.8;
  else if (opportunityScore > 0 && opportunityScore <= 50) adjustment -= 0.4;

  adjustment += clamp(num(playoffAdjustment) * 0.15, -1.0, 1.0);

  projection = Math.max(0, projection + adjustment);

  let projectionQuality = 0;

  if (sources.includes("last5")) projectionQuality += 35;
  if (sources.includes("season")) projectionQuality += 25;
  if (sources.includes("sportsProjection")) projectionQuality += 25;
  if (sources.includes("matchup")) projectionQuality += 15;

  projectionQuality = clamp(projectionQuality, 0, 100);

  return {
    projection: Number(projection.toFixed(1)),
    projectionSources: sources,
    projectionQuality,
    projectionAdjustment: Number(adjustment.toFixed(1)),
  };
}

function getSignalStrength({ supportScore = 0, resistanceScore = 0, dataCoverage = 0 }) {
  const gap = supportScore - resistanceScore;

  if (dataCoverage >= 75 && supportScore >= 14 && gap >= 8) return "STRONG";
  if (dataCoverage >= 55 && supportScore >= 8 && gap >= 3) return "MODERATE";
  return "WEAK";
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
  opponentMatchup = {},

  overOdds = null,
  underOdds = null,
}) {
  const cleanLine = num(line);

  const last5Points = last5.map((g) => num(g.points));
  const matchupPoints = matchupGames.map((g) => num(g.points));

  const last5Average = avg(last5Points);
  const matchupAverage = avg(matchupPoints);
  const cleanSeasonAverage = num(seasonAverage);
  const cleanSportsProjection = num(sportsProjection);

  const recentHitRate = hitRate(last5Points, cleanLine, side);
  const matchupHitRate = hitRate(matchupPoints, cleanLine, side);

  const opportunityScore = num(opportunity.opportunityScore);
  const playoffAdjustment = num(playoff.playoffAdjustment);
  const resistanceImpact = num(opponentMatchup.resistanceImpact);
  const resistanceSignal = opponentMatchup.resistanceSignal || "";

  const reasons = [];
  const risks = [];
  const support = [];
  const resistance = [];

  const supportScoreObj = { value: 0 };
  const resistanceScoreObj = { value: 0 };

  const projectionProfile = buildProjection({
    last5Average,
    seasonAverage: cleanSeasonAverage,
    sportsProjection: cleanSportsProjection,
    matchupAverage,
    opportunityScore,
    playoffAdjustment,
    line: cleanLine,
  });

  const projection = projectionProfile.projection;

  const rawEdge =
    side === "Over" ? projection - cleanLine : cleanLine - projection;

  const absoluteEdge = Number(Math.abs(rawEdge).toFixed(1));

  const pointsRange = getRange(last5Points);
  const minutesRange = getRange(last5.map((g) => num(g.minutes)));
  const fgaRange = getRange(last5.map((g) => num(g.fga)));

  let rawProbability = 50;

  // Projection edge
  if (rawEdge >= 7) {
    rawProbability += 12;
    addSupport({
      text: "Strong projection edge",
      weight: 8,
      support,
      reasons,
      score: supportScoreObj,
    });
  } else if (rawEdge >= 4) {
    rawProbability += 8;
    addSupport({
      text: "Good projection edge",
      weight: 6,
      support,
      reasons,
      score: supportScoreObj,
    });
  } else if (rawEdge >= 2) {
    rawProbability += 4;
    addSupport({
      text: "Small projection edge",
      weight: 3,
      support,
      reasons,
      score: supportScoreObj,
    });
  } else if (rawEdge < 0) {
    rawProbability -= 10;
    addResistance({
      text: "Projection does not support side",
      weight: 7,
      resistance,
      risks,
      score: resistanceScoreObj,
    });
  }

  // Opportunity
  if (opportunityScore >= 80) {
    rawProbability += 8;
    addSupport({
      text: "Strong opportunity profile",
      weight: 7,
      support,
      reasons,
      score: supportScoreObj,
    });
  } else if (opportunityScore >= 65) {
    rawProbability += 4;
    addSupport({
      text: "Playable opportunity profile",
      weight: 4,
      support,
      reasons,
      score: supportScoreObj,
    });
  } else if (opportunityScore > 0 && opportunityScore < 45) {
    rawProbability -= 6;
    addResistance({
      text: "Weak opportunity profile",
      weight: 6,
      resistance,
      risks,
      score: resistanceScoreObj,
    });
  }

  // Recent hit rate
  if (recentHitRate !== null) {
    if (recentHitRate >= 0.8) {
      rawProbability += 8;
      addSupport({
        text: "Strong recent hit rate",
        weight: 7,
        support,
        reasons,
        score: supportScoreObj,
      });
    } else if (recentHitRate >= 0.6) {
      rawProbability += 4;
      addSupport({
        text: "Positive recent hit rate",
        weight: 4,
        support,
        reasons,
        score: supportScoreObj,
      });
    } else if (recentHitRate <= 0.2) {
      rawProbability -= 8;
      addResistance({
        text: "Poor recent hit rate",
        weight: 7,
        resistance,
        risks,
        score: resistanceScoreObj,
      });
    } else if (recentHitRate <= 0.4) {
      rawProbability -= 4;
      addResistance({
        text: "Weak recent hit rate",
        weight: 4,
        resistance,
        risks,
        score: resistanceScoreObj,
      });
    }
  } else {
    rawProbability -= 6;
    addResistance({
      text: "Limited recent scoring data",
      weight: 6,
      resistance,
      risks,
      score: resistanceScoreObj,
    });
  }

  // Matchup history should help, but never dominate
  if (matchupHitRate !== null && matchupGames.length >= 2) {
    if (matchupHitRate >= 0.67) {
      rawProbability += 4;
      addSupport({
        text: "Positive matchup history",
        weight: 4,
        support,
        reasons,
        score: supportScoreObj,
      });
    } else if (matchupHitRate <= 0.33) {
      rawProbability -= 4;
      addResistance({
        text: "Weak matchup history",
        weight: 4,
        resistance,
        risks,
        score: resistanceScoreObj,
      });
    }
  } else if (!matchupGames.length) {
    addResistance({
      text: "Limited direct matchup history",
      weight: 2,
      resistance,
      risks,
      score: resistanceScoreObj,
    });
  }

  // Opponent matchup impact only applies when direct history exists
  if (
    opponentMatchup?.isDirectHistory &&
    resistanceSignal &&
    resistanceSignal !== "NO_DIRECT_HISTORY"
  ) {
    rawProbability += clamp(resistanceImpact, -5, 5);

    if (resistanceImpact > 0) {
      for (const reason of opponentMatchup.reasons || []) {
        addSupport({
          text: reason,
          weight: 3,
          support,
          reasons,
          score: supportScoreObj,
        });
      }
    }

    if (resistanceImpact < 0) {
      for (const reason of opponentMatchup.reasons || []) {
        addResistance({
          text: reason,
          weight: 3,
          resistance,
          risks,
          score: resistanceScoreObj,
        });
      }
    }
  }

  // Playoff/context
  if (playoffAdjustment >= 3) {
    rawProbability += 2;
    addSupport({
      text: "Positive game context",
      weight: 2,
      support,
      reasons,
      score: supportScoreObj,
    });
  } else if (playoffAdjustment <= -3) {
    rawProbability -= 3;
    addResistance({
      text: "Negative game context",
      weight: 3,
      resistance,
      risks,
      score: resistanceScoreObj,
    });
  }

  // Sportsbook price
  const pickOdds = side === "Over" ? overOdds : underOdds;

  if (pickOdds !== null && pickOdds !== undefined) {
    const odds = num(pickOdds);

    if (odds <= -150) {
      rawProbability += 1;
      addSupport({
        text: "Sportsbook price leans toward side",
        weight: 1,
        support,
        reasons,
        score: supportScoreObj,
      });
    } else if (odds >= 130) {
      rawProbability -= 2;
      addResistance({
        text: "Plus-money pricing adds risk",
        weight: 2,
        resistance,
        risks,
        score: resistanceScoreObj,
      });
    }
  }

  // Opportunity engine reasons/risks
  for (const reason of opportunity.reasons || []) {
    addSupport({
      text: reason,
      weight: 1,
      support,
      reasons,
      score: supportScoreObj,
    });
  }

  for (const risk of opportunity.risks || []) {
    addResistance({
      text: risk,
      weight: 1,
      resistance,
      risks,
      score: resistanceScoreObj,
    });
  }

  for (const reason of playoff.reasons || []) {
    addSupport({
      text: reason,
      weight: 1,
      support,
      reasons,
      score: supportScoreObj,
    });
  }

  for (const risk of playoff.risks || []) {
    addResistance({
      text: risk,
      weight: 1,
      resistance,
      risks,
      score: resistanceScoreObj,
    });
  }

  // Volatility risk
  if (pointsRange.range >= 18) {
    rawProbability -= 4;
    addResistance({
      text: "High recent scoring volatility",
      weight: 5,
      resistance,
      risks,
      score: resistanceScoreObj,
    });
  } else if (pointsRange.range >= 11) {
    rawProbability -= 2;
    addResistance({
      text: "Some recent scoring volatility",
      weight: 3,
      resistance,
      risks,
      score: resistanceScoreObj,
    });
  }

  const cleanSupport = unique(support);
  const cleanResistance = unique(resistance);

  const supportScore = supportScoreObj.value;
  const resistanceScore = resistanceScoreObj.value;
  const netEdge = Number((supportScore - resistanceScore).toFixed(1));

  const dataCoverageItems = [
    last5.length >= 5,
    cleanSeasonAverage > 0,
    projectionProfile.projectionQuality >= 50,
    overOdds !== null || underOdds !== null,
    opportunityScore > 0,
    opportunity.dataQuality > 0,
  ];

  const dataCoverage = Math.round(
    (dataCoverageItems.filter(Boolean).length / dataCoverageItems.length) * 100
  );

  const signalStrength = getSignalStrength({
    supportScore,
    resistanceScore,
    dataCoverage,
  });

  const rawQuality = clamp(
    Math.round(
      avg([
        projectionProfile.projectionQuality,
        opportunity.rawQuality || 0,
        opportunity.dataQuality || 0,
        dataCoverage,
      ].filter((v) => Number(v) > 0))
    ),
    0,
    100
  );

  const finalRawProbability = clamp(Math.round(rawProbability), 20, 88);

  console.log("🧠 WIN PROJECTION INPUT CHECK:", {
    player,
    side,
    line: cleanLine,
    projection,
    rawEdge,
    last5Average,
    seasonAverage: cleanSeasonAverage,
    sportsProjection: cleanSportsProjection,
    matchupAverage,
    opportunityScore,
    playoffAdjustment,
    projectionSources: projectionProfile.projectionSources,
    projectionQuality: projectionProfile.projectionQuality,
    dataCoverage,
    supportScore,
    resistanceScore,
    netEdge,
  });

  return {
    player,
    team,
    opponent,
    game,

    stat: "Points",
    pick: side,
    side,
    line: cleanLine,

    projection,
    projectionSources: projectionProfile.projectionSources,
    projectionQuality: projectionProfile.projectionQuality,
    projectionAdjustment: projectionProfile.projectionAdjustment,

    edge: absoluteEdge,
    rawEdge: Number(rawEdge.toFixed(1)),

    rawWinProbability: finalRawProbability,
    winProbability: finalRawProbability,
    confidence: finalRawProbability,
    strength: strengthFromProbability(finalRawProbability),

    seasonAverage: Number(cleanSeasonAverage.toFixed(1)),
    sportsProjection: Number(cleanSportsProjection.toFixed(1)),
    last5Average: Number(last5Average.toFixed(1)),

    matchupAverage: matchupPoints.length
      ? Number(matchupAverage.toFixed(1))
      : null,

    last5HitRate:
      recentHitRate !== null ? Math.round(recentHitRate * 100) : null,

    matchupHitRate:
      matchupHitRate !== null ? Math.round(matchupHitRate * 100) : null,

    opportunityScore,
    opponentMatchup,

    minutesRange,
    fgaRange,
    scoringRange: pointsRange,

    rawQuality,
    dataCoverage,

    support: cleanSupport,
    resistance: cleanResistance,
    supportScore,
    resistanceScore,
    netEdge,
    signalStrength,

    grading: {
      support: cleanSupport,
      resistance: cleanResistance,
      supportScore,
      resistanceScore,
      netEdge,
      signalStrength,
      rawConfidence: finalRawProbability,
      rawQuality,
      dataCoverage,
      projectionQuality: projectionProfile.projectionQuality,
    },

    reasons: unique(reasons).slice(0, 6),
    risks: unique(risks).slice(0, 5),
  };
}