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

function buildPlayoffContext({
  last5 = [],
  matchupGames = [],
  line = 0,
  opportunityScore = 50
}) {
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

  const matchupPoints =
    matchupGames.map((g) => num(g.points));

  const matchupAvgPoints =
    avg(matchupPoints);

  let playoffAdjustment = 0;
  const reasons = [];
  const risks = [];

  // Playoff rotation trust
  if (recentAvgMinutes >= 36) {
    playoffAdjustment += 5;
    reasons.push("Heavy playoff minutes");
  } else if (recentAvgMinutes >= 32) {
    playoffAdjustment += 3;
    reasons.push("Strong playoff role");
  } else if (recentAvgMinutes < 24) {
    playoffAdjustment -= 6;
    risks.push("Limited playoff role");
  }

  // Recent playoff opportunity trend
  if (recent3Minutes >= recentAvgMinutes + 3) {
    playoffAdjustment += 3;
    reasons.push("Playoff minutes trending up");
  } else if (recent3Minutes <= recentAvgMinutes - 3) {
    playoffAdjustment -= 4;
    risks.push("Playoff minutes trending down");
  }

  if (recent3FGA >= recentAvgFGA + 2) {
    playoffAdjustment += 3;
    reasons.push("Playoff shot volume trending up");
  } else if (recent3FGA <= recentAvgFGA - 2) {
    playoffAdjustment -= 4;
    risks.push("Playoff shot volume trending down");
  }

  // Do not overreact to hot streaks unless opportunity supports it
  if (
    recent3Points >= line + 4 &&
    opportunityScore >= 70
  ) {
    playoffAdjustment += 3;
    reasons.push("Hot streak supported by opportunity");
  } else if (
    recent3Points >= line + 4 &&
    opportunityScore < 60
  ) {
    playoffAdjustment -= 2;
    risks.push("Hot streak not supported by opportunity");
  }

  // Cold streak with opportunity can recover
  if (
    recent3Points <= line - 4 &&
    opportunityScore >= 75
  ) {
    playoffAdjustment += 1;
    reasons.push("Cold streak but opportunity remains strong");
  } else if (
    recent3Points <= line - 4 &&
    opportunityScore < 60
  ) {
    playoffAdjustment -= 4;
    risks.push("Cold streak with weak opportunity");
  }

  // Matchup history layer
  if (matchupGames.length >= 2) {
    if (matchupAvgPoints >= line + 4) {
      playoffAdjustment += 4;
      reasons.push("Strong recent scoring vs opponent");
    } else if (matchupAvgPoints >= line + 2) {
      playoffAdjustment += 2;
      reasons.push("Positive scoring history vs opponent");
    } else if (matchupAvgPoints <= line - 4) {
      playoffAdjustment -= 4;
      risks.push("Poor recent scoring vs opponent");
    } else if (matchupAvgPoints <= line - 2) {
      playoffAdjustment -= 2;
      risks.push("Below line vs opponent");
    }
  } else {
    risks.push("Limited direct matchup history");
  }

  // Foul risk proxy for bigs/low-minute players
  const lowMinuteGames =
    last5.filter((g) => num(g.minutes) < 24).length;

  if (lowMinuteGames >= 2 && recentAvgFGA < 12) {
    playoffAdjustment -= 3;
    risks.push("Possible foul/rotation risk");
  }

  // Scoring floor
  if (recentAvgFTA >= 6 && recentAvgFGA >= 14) {
    playoffAdjustment += 3;
    reasons.push("Strong scoring floor");
  } else if (recentAvgFTA < 2 && recentAvgFGA < 12) {
    playoffAdjustment -= 4;
    risks.push("Weak scoring floor");
  }

  return {
    playoffAdjustment,
    matchupGamesUsed: matchupGames.length,
    matchupAvgPoints:
      matchupGames.length
        ? Number(matchupAvgPoints.toFixed(1))
        : null,
    recent3Points: Number(recent3Points.toFixed(1)),
    recent3Minutes: Number(recent3Minutes.toFixed(1)),
    recent3FGA: Number(recent3FGA.toFixed(1)),
    reasons,
    risks
  };
}

export {
    buildPlayoffContext
};
