function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avg(values = []) {
  const nums = values.map(num).filter((v) => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function hitRate(points = [], line = 0, side = "Over") {
  if (!points.length) return null;

  const hits = points.filter((p) =>
    side === "Over" ? p > line : p < line
  ).length;

  return hits / points.length;
}

function strengthFromProbability(probability) {
  if (probability >= 75) return "Elite";
  if (probability >= 68) return "Strong";
  return "Lean";
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unique(list = []) {
  return [...new Set(list.filter(Boolean))];
}

function getSignalStrength({ supportScore, resistanceScore, dataSignals }) {
  const total = supportScore + resistanceScore + dataSignals;

  if (total >= 7) return "STRONG";
  if (total >= 4) return "MODERATE";
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
  const last5Points = last5.map((g) => num(g.points));
  const matchupPoints = matchupGames.map((g) => num(g.points));

  const last5Average = avg(last5Points);
  const matchupAverage = avg(matchupPoints);

  const recentHitRate = hitRate(last5Points, line, side);
  const matchupHitRate = hitRate(matchupPoints, line, side);

  const opportunityScore = num(opportunity.opportunityScore);
  const playoffAdjustment = num(playoff.playoffAdjustment);
  const resistanceImpact = num(opponentMatchup.resistanceImpact);
  const resistanceSignal = opponentMatchup.resistanceSignal || "";

  const reasons = [];
  const risks = [];

  const support = [];
  const resistance = [];

  function addSupport(text) {
    if (text) {
      reasons.push(text);
      support.push(text);
    }
  }

  function addResistance(text) {
    if (text) {
      risks.push(text);
      resistance.push(text);
    }
  }

  const weightedValues = [];
  const weights = [];

  function addWeighted(value, weight) {
    const v = num(value);

    if (v > 0) {
      weightedValues.push(v * weight);
      weights.push(weight);
    }
  }

  addWeighted(last5Average, 0.45);
  addWeighted(Math.max(0, seasonAverage), 0.25);
  addWeighted(Math.max(0, sportsProjection), 0.20);

  if (matchupAverage > 0) {
    addWeighted(matchupAverage, 0.10);
  }

  console.log("🧠 WIN PROJECTION INPUT CHECK:", {
    player,
    line,
    side,
    last5Average,
    seasonAverage,
    sportsProjection,
    matchupAverage,
    opportunityScore,
    playoffAdjustment,
    last5Points,
    opponentMatchup,
    matchupPoints,
  });

  let projection =
    weights.length > 0
      ? weightedValues.reduce((a, b) => a + b, 0) /
        weights.reduce((a, b) => a + b, 0)
      : line;

  if (opportunityScore >= 80) projection += 1.5;
  else if (opportunityScore >= 70) projection += 0.8;
  else if (opportunityScore <= 45) projection -= 1.2;

  projection += playoffAdjustment * 0.25;
  projection = Math.max(0, projection);
  projection = Number(projection.toFixed(1));

  const rawEdge =
    side === "Over"
      ? projection - line
      : line - projection;

  let probability = 50;

  if (rawEdge >= 7) {
    probability += 12;
    addSupport("Strong projection edge");
  } else if (rawEdge >= 4) {
    probability += 8;
    addSupport("Good projection edge");
  } else if (rawEdge >= 2) {
    probability += 4;
    addSupport("Small projection edge");
  } else if (rawEdge < 0) {
    probability -= 12;
    addResistance("Projection does not support side");
  }

  if (opportunityScore >= 80) {
    probability += 10;
    addSupport("Strong opportunity");
  } else if (opportunityScore >= 65) {
    probability += 5;
    addSupport("Playable opportunity");
  } else if (opportunityScore > 0 && opportunityScore < 50) {
    probability -= 8;
    addResistance("Weak opportunity");
  }

  if (recentHitRate !== null) {
    if (recentHitRate >= 0.8) {
      probability += 9;
      addSupport("Strong recent hit rate");
    } else if (recentHitRate >= 0.6) {
      probability += 5;
      addSupport("Positive recent hit rate");
    } else if (recentHitRate <= 0.2) {
      probability -= 9;
      addResistance("Poor recent hit rate");
    } else if (recentHitRate <= 0.4) {
      probability -= 5;
      addResistance("Weak recent hit rate");
    }
  } else {
    probability -= 10;
    addResistance("Limited Last 5 data");
  }

  if (matchupHitRate !== null) {
    if (matchupHitRate >= 0.67) {
      probability += 5;
      addSupport("Positive matchup history");
    } else if (matchupHitRate <= 0.33) {
      probability -= 4;
      addResistance("Weak matchup history");
    }
  }

  if (resistanceSignal && resistanceSignal !== "NO_DIRECT_HISTORY") {
    probability += resistanceImpact;

    if (resistanceImpact > 0) {
      for (const reason of opponentMatchup.reasons || []) {
        addSupport(reason);
      }
    }

    if (resistanceImpact < 0) {
      for (const reason of opponentMatchup.reasons || []) {
        addResistance(reason);
      }
    }
  }

  if (playoffAdjustment >= 3) {
    probability += 3;
    addSupport("Positive playoff context");
  } else if (playoffAdjustment <= -3) {
    probability -= 3;
    addResistance("Negative playoff context");
  }

  const pickOdds = side === "Over" ? overOdds : underOdds;

  if (pickOdds !== null && pickOdds !== undefined) {
    const odds = num(pickOdds);

    if (odds <= -150) {
      probability += 2;
      addSupport("Sportsbook price supports side");
    } else if (odds >= 130) {
      probability -= 3;
      addResistance("Plus-money risk");
    }
  }

  for (const reason of opportunity.reasons || []) {
    addSupport(reason);
  }

  for (const reason of playoff.reasons || []) {
    addSupport(reason);
  }

  for (const risk of opportunity.risks || []) {
    addResistance(risk);
  }

  for (const risk of playoff.risks || []) {
    addResistance(risk);
  }

  const cleanSupport = unique(support);
  const cleanResistance = unique(resistance);

  const supportScore = cleanSupport.length;
  const resistanceScore = cleanResistance.length;
  const netEdge = supportScore - resistanceScore;

  const dataSignals =
    (last5.length >= 5 ? 1 : 0) +
    (matchupGames.length > 0 ? 1 : 0) +
    (overOdds !== null || underOdds !== null ? 1 : 0) +
    (opportunityScore > 0 ? 1 : 0);

  const signalStrength = getSignalStrength({
    supportScore,
    resistanceScore,
    dataSignals,
  });

  const finalProbability = clamp(Math.round(probability), 20, 88);

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
    matchupAverage: matchupPoints.length
      ? Number(matchupAverage.toFixed(1))
      : null,

    last5HitRate:
      recentHitRate !== null ? Math.round(recentHitRate * 100) : null,

    matchupHitRate:
      matchupHitRate !== null ? Math.round(matchupHitRate * 100) : null,

    opportunityScore,
    opponentMatchup,

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
      confidence: finalProbability,
    },

    reasons: unique(reasons).slice(0, 6),
    risks: unique(risks).slice(0, 5),
  };
}