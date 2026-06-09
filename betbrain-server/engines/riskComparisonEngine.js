const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const addReason = (list, text) => {
  if (text && !list.includes(text)) list.push(text);
};

export function compareOverUnderRisk({
  playerName = "",
  line = 0,
  projection = 0,
  seasonAvg = 0,
  last5Avg = 0,
  minutesAvg = 0,
  fgaAvg = 0,
  ftaAvg = 0,
  usageScore = 50,
  opportunityScore = 50,
  matchupScore = 50,
  defenseScore = 50,
  roleCertainty = 50,
  blowoutRisk = 50,
  dataQuality = 50,
} = {}) {
  let overRisk = 50;
  let underRisk = 50;

  const overReasons = [];
  const underReasons = [];
  const warnings = [];

  const edge = Number(projection) - Number(line);

  // Projection is now only ONE input, not the boss
  if (edge >= 5) {
    overRisk -= 6;
    underRisk += 6;
    addReason(overReasons, "Projection strongly clears the line");
  } else if (edge >= 2.5) {
    overRisk -= 4;
    underRisk += 4;
    addReason(overReasons, "Projection supports the over");
  } else if (edge <= -5) {
    underRisk -= 6;
    overRisk += 6;
    addReason(underReasons, "Projection strongly supports the under");
  } else if (edge <= -2.5) {
    underRisk -= 4;
    overRisk += 4;
    addReason(underReasons, "Projection supports the under");
  }

  // Recent scoring
  if (last5Avg >= line + 4) {
    overRisk -= 6;
    underRisk += 4;
    addReason(overReasons, "Recent scoring is above the line");
  } else if (last5Avg >= line + 2) {
    overRisk -= 4;
    underRisk += 2;
    addReason(overReasons, "Recent form leans over");
  } else if (last5Avg <= line - 4) {
    underRisk -= 6;
    overRisk += 4;
    addReason(underReasons, "Recent scoring is below the line");
  } else if (last5Avg <= line - 2) {
    underRisk -= 4;
    overRisk += 2;
    addReason(underReasons, "Recent form leans under");
  }

  // Season baseline
  if (seasonAvg >= line + 3) {
    overRisk -= 4;
    addReason(overReasons, "Season average supports the over");
  } else if (seasonAvg <= line - 3) {
    underRisk -= 4;
    addReason(underReasons, "Season average supports the under");
  }

  // Opportunity / usage
  if (opportunityScore >= 70) {
    overRisk -= 6;
    underRisk += 4;
    addReason(overReasons, "Opportunity profile is strong");
  } else if (opportunityScore <= 40) {
    overRisk += 6;
    underRisk -= 4;
    addReason(underReasons, "Opportunity profile is weak");
  }

  if (usageScore >= 70) {
    overRisk -= 6;
    underRisk += 4;
    addReason(overReasons, "Usage profile supports scoring volume");
  } else if (usageScore <= 40) {
    overRisk += 6;
    underRisk -= 4;
    addReason(underReasons, "Usage profile does not support scoring volume");
  }

  // Minutes
  if (minutesAvg >= 34) {
    overRisk -= 4;
    addReason(overReasons, "Minutes are strong");
  } else if (minutesAvg < 24) {
    overRisk += 6;
    underRisk -= 4;
    addReason(underReasons, "Minutes create over risk");
  }

  // Shot volume
  if (fgaAvg >= 16) {
    overRisk -= 6;
    underRisk += 4;
    addReason(overReasons, "Shot volume is strong");
  } else if (fgaAvg < 9) {
    overRisk += 6;
    underRisk -= 4;
    addReason(underReasons, "Shot volume is low");
  }

  if (ftaAvg >= 5) {
    overRisk -= 2;
    addReason(overReasons, "Free throw volume adds scoring support");
  }

  // Matchup / defense
  if (matchupScore >= 65 || defenseScore >= 65) {
    overRisk -= 4;
    underRisk += 2;
    addReason(overReasons, "Matchup supports scoring");
  } else if (matchupScore <= 40 || defenseScore <= 40) {
    overRisk += 4;
    underRisk -= 2;
    addReason(underReasons, "Matchup creates scoring resistance");
  }

  // Role uncertainty
  if (roleCertainty < 45) {
  overRisk += 8;
  underRisk += 2;
  warnings.push("Role uncertainty detected");
} else if (roleCertainty < 55) {
  overRisk += 4;
  underRisk += 1;
  warnings.push("Some role volatility");
}

  // Blowout risk
  if (blowoutRisk >= 70) {
    overRisk += 6;
    warnings.push("Blowout risk may reduce minutes");
  }

  // Thin data penalty
  if (dataQuality <= 40) {
    overRisk += 8;
    underRisk += 8;
    warnings.push("Thin data warning");
  }

  overRisk = clamp(Math.round(overRisk), 5, 95);
  underRisk = clamp(Math.round(underRisk), 5, 95);

  const riskGap = Math.abs(overRisk - underRisk);

  let pickSide =
  overRisk < underRisk
    ? "OVER"
    : "UNDER";
  

  const chosenRisk = pickSide === "OVER" ? overRisk : pickSide === "UNDER" ? underRisk : 90;

  let riskLabel = "High Risk";
  if (chosenRisk <= 32) riskLabel = "Low Risk";
  else if (chosenRisk <= 48) riskLabel = "Medium Risk";

  const trustable = true;
    

  return {
    playerName,
    pickSide,
    overRisk,
    underRisk,
    riskGap,
    chosenRisk,
    riskLabel,
    trustable,
    reasons: pickSide === "OVER" ? overReasons : underReasons,
    overReasons,
    underReasons,
    warnings,
  };
}