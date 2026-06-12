function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avg(values = []) {
  const nums = values
    .map(num)
    .filter((v) => Number.isFinite(v) && v >= 0);

  if (!nums.length) return 0;

  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function unique(list = []) {
  return [...new Set(list.filter(Boolean))];
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

function getThresholds(league = "NBA") {
  if (league === "WNBA") {
    return {
      heavyMinutes: 32,
      strongMinutes: 29,
      playableMinutes: 23,
      lowMinutes: 20,

      strongFGA: 14,
      playableFGA: 9,
      lowFGA: 7,

      strongFTA: 5,
      weakFTA: 2,
    };
  }

  return {
    heavyMinutes: 36,
    strongMinutes: 32,
    playableMinutes: 24,
    lowMinutes: 20,

    strongFGA: 14,
    playableFGA: 10,
    lowFGA: 8,

    strongFTA: 6,
    weakFTA: 2,
  };
}

function addSupport({
  text,
  weight,
  reasons,
  support,
  score,
}) {
  if (!text) return;

  reasons.push(text);
  support.push(text);
  score.value += weight;
}

function addRisk({
  text,
  weight,
  risks,
  danger,
  score,
}) {
  if (!text) return;

  risks.push(text);
  danger.push(text);
  score.value += weight;
}

export function buildPlayoffContext({
  last5 = [],
  matchupGames = [],
  line = 0,
  opportunityScore = 50,
  league = "NBA",
  isPlayoff = true,
} = {}) {
  const thresholds = getThresholds(league);

  const points = last5.map((g) => num(g.points));
  const minutes = last5.map((g) => num(g.minutes));
  const fga = last5.map((g) => num(g.fga));
  const fta = last5.map((g) => num(g.fta));

  const recentAvgPoints = avg(points);
  const recentAvgMinutes = avg(minutes);
  const recentAvgFGA = avg(fga);
  const recentAvgFTA = avg(fta);

  const recent3 = last5.slice(0, 3);

  const recent3Points = avg(recent3.map((g) => g.points));
  const recent3Minutes = avg(recent3.map((g) => g.minutes));
  const recent3FGA = avg(recent3.map((g) => g.fga));
  const recent3FTA = avg(recent3.map((g) => g.fta));

  const matchupPoints = matchupGames.map((g) => num(g.points));
  const matchupMinutes = matchupGames.map((g) => num(g.minutes));
  const matchupFGA = matchupGames.map((g) => num(g.fga));

  const matchupAvgPoints = avg(matchupPoints);
  const matchupAvgMinutes = avg(matchupMinutes);
  const matchupAvgFGA = avg(matchupFGA);

  const pointsRange = getRange(points);
  const minutesRange = getRange(minutes);
  const fgaRange = getRange(fga);

  let playoffAdjustment = 0;
  let contextScore = 50;

  const reasons = [];
  const risks = [];
  const support = [];
  const danger = [];

  const supportScore = { value: 0 };
  const dangerScore = { value: 0 };

  const cleanLine = num(line);
  const cleanOpportunityScore = num(opportunityScore);

  // Rotation / minutes trust
  if (recentAvgMinutes >= thresholds.heavyMinutes) {
    playoffAdjustment += 4;
    contextScore += 8;
    addSupport({
      text: isPlayoff ? "Heavy playoff minutes" : "Heavy minutes",
      weight: 7,
      reasons,
      support,
      score: supportScore,
    });
  } else if (recentAvgMinutes >= thresholds.strongMinutes) {
    playoffAdjustment += 3;
    contextScore += 5;
    addSupport({
      text: isPlayoff ? "Strong playoff role" : "Strong role",
      weight: 5,
      reasons,
      support,
      score: supportScore,
    });
  } else if (recentAvgMinutes > 0 && recentAvgMinutes < thresholds.playableMinutes) {
    playoffAdjustment -= 5;
    contextScore -= 8;
    addRisk({
      text: isPlayoff ? "Limited playoff role" : "Limited role",
      weight: 8,
      risks,
      danger,
      score: dangerScore,
    });
  }

  // Recent 3 trend
  if (recent3.length >= 3 && recentAvgMinutes > 0) {
    if (recent3Minutes >= recentAvgMinutes + 3) {
      playoffAdjustment += 2;
      contextScore += 4;
      addSupport({
        text: "Minutes trending up",
        weight: 4,
        reasons,
        support,
        score: supportScore,
      });
    } else if (recent3Minutes <= recentAvgMinutes - 3) {
      playoffAdjustment -= 4;
      contextScore -= 6;
      addRisk({
        text: "Minutes trending down",
        weight: 6,
        risks,
        danger,
        score: dangerScore,
      });
    }
  }

  if (recent3.length >= 3 && recentAvgFGA > 0) {
    if (recent3FGA >= recentAvgFGA + 2) {
      playoffAdjustment += 2;
      contextScore += 4;
      addSupport({
        text: "Shot volume trending up",
        weight: 4,
        reasons,
        support,
        score: supportScore,
      });
    } else if (recent3FGA <= recentAvgFGA - 2) {
      playoffAdjustment -= 4;
      contextScore -= 6;
      addRisk({
        text: "Shot volume trending down",
        weight: 6,
        risks,
        danger,
        score: dangerScore,
      });
    }
  }

  // Do not blindly chase hot streaks
  if (cleanLine > 0 && recent3.length >= 3) {
    if (
      recent3Points >= cleanLine + 4 &&
      cleanOpportunityScore >= 70 &&
      recent3FGA >= thresholds.playableFGA
    ) {
      playoffAdjustment += 3;
      contextScore += 5;
      addSupport({
        text: "Hot scoring trend supported by opportunity",
        weight: 5,
        reasons,
        support,
        score: supportScore,
      });
    } else if (
      recent3Points >= cleanLine + 4 &&
      cleanOpportunityScore < 60
    ) {
      playoffAdjustment -= 3;
      contextScore -= 5;
      addRisk({
        text: "Hot scoring trend is not supported by opportunity",
        weight: 5,
        risks,
        danger,
        score: dangerScore,
      });
    }

    if (
      recent3Points <= cleanLine - 4 &&
      cleanOpportunityScore >= 75 &&
      recent3FGA >= thresholds.playableFGA
    ) {
      playoffAdjustment += 1;
      contextScore += 2;
      addSupport({
        text: "Cold scoring trend but opportunity remains strong",
        weight: 2,
        reasons,
        support,
        score: supportScore,
      });
    } else if (
      recent3Points <= cleanLine - 4 &&
      cleanOpportunityScore < 60
    ) {
      playoffAdjustment -= 4;
      contextScore -= 7;
      addRisk({
        text: "Cold scoring trend with weak opportunity",
        weight: 7,
        risks,
        danger,
        score: dangerScore,
      });
    }
  }

  // Direct matchup context only matters when it exists
  if (matchupGames.length >= 2 && cleanLine > 0) {
    if (
      matchupAvgPoints >= cleanLine + 4 &&
      matchupAvgMinutes >= thresholds.playableMinutes
    ) {
      playoffAdjustment += 3;
      contextScore += 5;
      addSupport({
        text: "Strong recent scoring vs opponent",
        weight: 5,
        reasons,
        support,
        score: supportScore,
      });
    } else if (matchupAvgPoints >= cleanLine + 2) {
      playoffAdjustment += 2;
      contextScore += 3;
      addSupport({
        text: "Positive scoring history vs opponent",
        weight: 3,
        reasons,
        support,
        score: supportScore,
      });
    } else if (
      matchupAvgPoints <= cleanLine - 4 &&
      matchupAvgFGA < thresholds.playableFGA
    ) {
      playoffAdjustment -= 4;
      contextScore -= 6;
      addRisk({
        text: "Poor scoring history vs opponent",
        weight: 6,
        risks,
        danger,
        score: dangerScore,
      });
    } else if (matchupAvgPoints <= cleanLine - 2) {
      playoffAdjustment -= 2;
      contextScore -= 3;
      addRisk({
        text: "Below line vs opponent",
        weight: 3,
        risks,
        danger,
        score: dangerScore,
      });
    }
  } else {
    addRisk({
      text: "Limited direct matchup history",
      weight: 2,
      risks,
      danger,
      score: dangerScore,
    });
  }

  // Possible rotation/foul proxy
  const lowMinuteGames = last5.filter(
    (g) => num(g.minutes) > 0 && num(g.minutes) < thresholds.playableMinutes
  ).length;

  if (lowMinuteGames >= 2 && recentAvgFGA < thresholds.playableFGA) {
    playoffAdjustment -= 3;
    contextScore -= 5;
    addRisk({
      text: "Possible foul or rotation risk",
      weight: 5,
      risks,
      danger,
      score: dangerScore,
    });
  }

  // Scoring floor
  if (
    recentAvgFTA >= thresholds.strongFTA &&
    recentAvgFGA >= thresholds.strongFGA
  ) {
    playoffAdjustment += 3;
    contextScore += 5;
    addSupport({
      text: "Strong scoring floor",
      weight: 5,
      reasons,
      support,
      score: supportScore,
    });
  } else if (
    recentAvgFTA > 0 &&
    recentAvgFTA < thresholds.weakFTA &&
    recentAvgFGA < thresholds.playableFGA
  ) {
    playoffAdjustment -= 4;
    contextScore -= 6;
    addRisk({
      text: "Weak scoring floor",
      weight: 6,
      risks,
      danger,
      score: dangerScore,
    });
  }

  // Volatility danger
  if (pointsRange.range >= 18) {
    playoffAdjustment -= 3;
    contextScore -= 5;
    addRisk({
      text: "High scoring volatility",
      weight: 5,
      risks,
      danger,
      score: dangerScore,
    });
  } else if (pointsRange.range >= 11) {
    playoffAdjustment -= 1;
    contextScore -= 2;
    addRisk({
      text: "Some scoring volatility",
      weight: 2,
      risks,
      danger,
      score: dangerScore,
    });
  }

  // Stable game context
  if (
    minutesRange.range > 0 &&
    minutesRange.range <= 6 &&
    recentAvgMinutes >= thresholds.playableMinutes
  ) {
    contextScore += 4;
    addSupport({
      text: "Stable minutes profile",
      weight: 4,
      reasons,
      support,
      score: supportScore,
    });
  }

  if (
    fgaRange.range > 0 &&
    fgaRange.range <= 5 &&
    recentAvgFGA >= thresholds.playableFGA
  ) {
    contextScore += 3;
    addSupport({
      text: "Stable shot volume profile",
      weight: 3,
      reasons,
      support,
      score: supportScore,
    });
  }

  playoffAdjustment = clamp(Math.round(playoffAdjustment), -10, 10);
  contextScore = clamp(Math.round(contextScore), 0, 100);

  const finalSupport = unique(support);
  const finalDanger = unique(danger);

  const finalSupportScore = supportScore.value;
  const finalDangerScore = dangerScore.value;
  const netContextEdge = Number(
    (finalSupportScore - finalDangerScore).toFixed(1)
  );

  let contextSignal = "WEAK";

  if (contextScore >= 70 && netContextEdge >= 6) {
    contextSignal = "STRONG";
  } else if (contextScore >= 58 && netContextEdge >= 2) {
    contextSignal = "MODERATE";
  }

  return {
    playoffAdjustment,
    contextAdjustment: playoffAdjustment,
    contextScore,
    contextSignal,

    support: finalSupport,
    danger: finalDanger,
    supportScore: finalSupportScore,
    dangerScore: finalDangerScore,
    netContextEdge,

    matchupGamesUsed: matchupGames.length,

    matchupAvgPoints:
      matchupGames.length
        ? Number(matchupAvgPoints.toFixed(1))
        : null,

    matchupAvgMinutes:
      matchupGames.length
        ? Number(matchupAvgMinutes.toFixed(1))
        : null,

    matchupAvgFGA:
      matchupGames.length
        ? Number(matchupAvgFGA.toFixed(1))
        : null,

    recentAvgPoints: Number(recentAvgPoints.toFixed(1)),
    recentAvgMinutes: Number(recentAvgMinutes.toFixed(1)),
    recentAvgFGA: Number(recentAvgFGA.toFixed(1)),
    recentAvgFTA: Number(recentAvgFTA.toFixed(1)),

    recent3Points: Number(recent3Points.toFixed(1)),
    recent3Minutes: Number(recent3Minutes.toFixed(1)),
    recent3FGA: Number(recent3FGA.toFixed(1)),
    recent3FTA: Number(recent3FTA.toFixed(1)),

    scoringRange: pointsRange,
    minutesRange,
    fgaRange,

    reasons: unique(reasons),
    risks: unique(risks),
  };
}