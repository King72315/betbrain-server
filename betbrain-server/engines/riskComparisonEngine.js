const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const addUnique = (list, text) => {
  if (text && !list.includes(text)) list.push(text);
};

const num = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};

const isRealNumber = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
};

const getSignalStrength = ({ totalEvidence, netEdge, dataQuality }) => {
  if (dataQuality >= 75 && totalEvidence >= 35 && netEdge >= 12) {
    return "STRONG";
  }

  if (dataQuality >= 55 && totalEvidence >= 22 && netEdge >= 6) {
    return "MODERATE";
  }

  return "WEAK";
};

const addSideSupport = ({
  side,
  text,
  weight,
  overReasons,
  underReasons,
  overSupport,
  underSupport,
  overResistance,
  underResistance,
}) => {
  if (side === "OVER") {
    addUnique(overReasons, text);
    overSupport.value += weight;
    underResistance.value += Math.max(1, Math.round(weight * 0.35));
  }

  if (side === "UNDER") {
    addUnique(underReasons, text);
    underSupport.value += weight;
    overResistance.value += Math.max(1, Math.round(weight * 0.35));
  }
};

const addSideResistance = ({
  side,
  text,
  weight,
  warnings,
  overResistance,
  underResistance,
}) => {
  addUnique(warnings, text);

  if (side === "OVER") {
    overResistance.value += weight;
  }

  if (side === "UNDER") {
    underResistance.value += weight;
  }
};

const addGeneralResistance = ({
  text,
  weight,
  warnings,
  overResistance,
  underResistance,
}) => {
  addUnique(warnings, text);
  overResistance.value += weight;
  underResistance.value += weight;
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
  rawQuality = null,
  dataCoverage = null,
  marketQuality = null,
} = {}) {
  let overRisk = 50;
  let underRisk = 50;

  const overReasons = [];
  const underReasons = [];
  const warnings = [];
  const noPlayReasons = [];

  const overSupport = { value: 0 };
  const underSupport = { value: 0 };
  const overResistance = { value: 0 };
  const underResistance = { value: 0 };

  const cleanLine = num(line);
  const cleanProjection = num(projection);
  const cleanSeasonAvg = num(seasonAvg);
  const cleanLast5Avg = num(last5Avg);
  const cleanMinutesAvg = num(minutesAvg);
  const cleanFgaAvg = num(fgaAvg);
  const cleanFtaAvg = num(ftaAvg);
  const cleanUsageScore = num(usageScore);
  const cleanOpportunityScore = num(opportunityScore);
  const cleanMatchupScore = num(matchupScore);
  const cleanDefenseScore = num(defenseScore);
  const cleanRoleCertainty = num(roleCertainty);
  const cleanBlowoutRisk = num(blowoutRisk);
  const cleanDataQuality = num(dataQuality);
  const cleanRawQuality = rawQuality === null ? null : num(rawQuality);
  const cleanDataCoverage = dataCoverage === null ? null : num(dataCoverage);
  const cleanMarketQuality = marketQuality === null ? null : num(marketQuality);

  const hasLine = isRealNumber(cleanLine);
  const hasProjection = isRealNumber(cleanProjection);
  const hasSeasonAvg = isRealNumber(cleanSeasonAvg);
  const hasLast5Avg = isRealNumber(cleanLast5Avg);
  const hasMinutesData = isRealNumber(cleanMinutesAvg);
  const hasFgaData = isRealNumber(cleanFgaAvg);
  const hasFtaData = isRealNumber(cleanFtaAvg);
  const hasVolumeData = hasMinutesData || hasFgaData;

  const edge = hasProjection && hasLine ? cleanProjection - cleanLine : 0;

  // Projection edge: true Over/Under support only if projection is real.
  if (hasProjection && hasLine) {
    if (edge >= 5) {
      overRisk -= 7;
      underRisk += 4;
      addSideSupport({
        side: "OVER",
        text: "Projection strongly clears the line",
        weight: 12,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    } else if (edge >= 2.5) {
      overRisk -= 5;
      underRisk += 2;
      addSideSupport({
        side: "OVER",
        text: "Projection supports the over",
        weight: 8,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    } else if (edge <= -5) {
      underRisk -= 7;
      overRisk += 4;
      addSideSupport({
        side: "UNDER",
        text: "Projection strongly supports the under",
        weight: 12,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    } else if (edge <= -2.5) {
      underRisk -= 5;
      overRisk += 2;
      addSideSupport({
        side: "UNDER",
        text: "Projection supports the under",
        weight: 8,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    }
  } else {
    overRisk += 5;
    underRisk += 5;
    addGeneralResistance({
      text: "Projection data unavailable",
      weight: 6,
      warnings,
      overResistance,
      underResistance,
    });
  }

  // Recent scoring: real scoring evidence.
  if (hasLast5Avg && hasLine) {
    if (cleanLast5Avg >= cleanLine + 4) {
      overRisk -= 7;
      underRisk += 3;
      addSideSupport({
        side: "OVER",
        text: "Recent scoring is above the line",
        weight: 10,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    } else if (cleanLast5Avg >= cleanLine + 2) {
      overRisk -= 4;
      underRisk += 2;
      addSideSupport({
        side: "OVER",
        text: "Recent form leans over",
        weight: 6,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    } else if (cleanLast5Avg <= cleanLine - 4) {
      underRisk -= 7;
      overRisk += 3;
      addSideSupport({
        side: "UNDER",
        text: "Recent scoring is below the line",
        weight: 10,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    } else if (cleanLast5Avg <= cleanLine - 2) {
      underRisk -= 4;
      overRisk += 2;
      addSideSupport({
        side: "UNDER",
        text: "Recent form leans under",
        weight: 6,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    }
  } else {
    overRisk += 5;
    underRisk += 5;
    addGeneralResistance({
      text: "Recent scoring data unavailable",
      weight: 6,
      warnings,
      overResistance,
      underResistance,
    });
  }

  // Season baseline: true side support, but weaker than recent form.
  if (hasSeasonAvg && hasLine) {
    if (cleanSeasonAvg >= cleanLine + 3) {
      overRisk -= 4;
      underRisk += 1;
      addSideSupport({
        side: "OVER",
        text: "Season average supports the over",
        weight: 6,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    } else if (cleanSeasonAvg <= cleanLine - 3) {
      underRisk -= 4;
      overRisk += 1;
      addSideSupport({
        side: "UNDER",
        text: "Season average supports the under",
        weight: 6,
        overReasons,
        underReasons,
        overSupport,
        underSupport,
        overResistance,
        underResistance,
      });
    }
  }

  // Opportunity: strong opportunity supports Over only when volume data exists.
  // Weak opportunity is Over danger and supports Under.
  if (hasVolumeData && cleanOpportunityScore >= 75) {
    overRisk -= 7;
    underRisk += 3;
    addSideSupport({
      side: "OVER",
      text: "Opportunity profile is strong",
      weight: 9,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  } else if (hasVolumeData && cleanOpportunityScore >= 65) {
    overRisk -= 4;
    underRisk += 1;
    addSideSupport({
      side: "OVER",
      text: "Opportunity profile is playable",
      weight: 5,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  } else if (cleanOpportunityScore > 0 && cleanOpportunityScore <= 40) {
    overRisk += 7;
    underRisk -= 3;
    addSideResistance({
      side: "OVER",
      text: "Opportunity profile is weak",
      weight: 9,
      warnings,
      overResistance,
      underResistance,
    });
    addSideSupport({
      side: "UNDER",
      text: "Weak opportunity profile supports the under",
      weight: 7,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  }

  // Usage: strong usage supports Over when volume data exists. Weak usage supports Under.
  if (hasVolumeData && cleanUsageScore >= 75) {
    overRisk -= 7;
    underRisk += 3;
    addSideSupport({
      side: "OVER",
      text: "Usage profile supports scoring volume",
      weight: 9,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  } else if (cleanUsageScore > 0 && cleanUsageScore <= 40) {
    overRisk += 7;
    underRisk -= 3;
    addSideResistance({
      side: "OVER",
      text: "Usage profile does not support scoring volume",
      weight: 9,
      warnings,
      overResistance,
      underResistance,
    });
    addSideSupport({
      side: "UNDER",
      text: "Weak usage profile supports the under",
      weight: 7,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  }

  // Minutes: strong minutes support Over. Low minutes create Over danger and Under support.
  if (hasMinutesData && cleanMinutesAvg >= 32) {
    overRisk -= 5;
    underRisk += 2;
    addSideSupport({
      side: "OVER",
      text: "Minutes are strong",
      weight: 7,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  } else if (hasMinutesData && cleanMinutesAvg >= 28) {
    overRisk -= 3;
    addSideSupport({
      side: "OVER",
      text: "Minutes are playable",
      weight: 4,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  } else if (hasMinutesData && cleanMinutesAvg < 24) {
    overRisk += 7;
    underRisk -= 4;
    addSideResistance({
      side: "OVER",
      text: "Minutes create over risk",
      weight: 10,
      warnings,
      overResistance,
      underResistance,
    });
    addSideSupport({
      side: "UNDER",
      text: "Low minutes support the under",
      weight: 8,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  }

  // Shot volume: strong attempts support Over. Low attempts create Over danger and Under support.
  if (hasFgaData && cleanFgaAvg >= 16) {
    overRisk -= 7;
    underRisk += 3;
    addSideSupport({
      side: "OVER",
      text: "Shot volume is strong",
      weight: 10,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  } else if (hasFgaData && cleanFgaAvg >= 12) {
    overRisk -= 4;
    underRisk += 1;
    addSideSupport({
      side: "OVER",
      text: "Shot volume is playable",
      weight: 5,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  } else if (hasFgaData && cleanFgaAvg < 8) {
    overRisk += 7;
    underRisk -= 4;
    addSideResistance({
      side: "OVER",
      text: "Shot volume is low",
      weight: 10,
      warnings,
      overResistance,
      underResistance,
    });
    addSideSupport({
      side: "UNDER",
      text: "Low shot volume supports the under",
      weight: 8,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  }

  // Free throw floor.
  if (hasFtaData && cleanFtaAvg >= 5) {
    overRisk -= 3;
    underRisk += 1;
    addSideSupport({
      side: "OVER",
      text: "Free throw volume adds scoring support",
      weight: 4,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  } else if (hasFtaData && cleanFtaAvg < 2) {
    overRisk += 3;
    underRisk -= 2;
    addSideResistance({
      side: "OVER",
      text: "Weak free throw floor",
      weight: 3,
      warnings,
      overResistance,
      underResistance,
    });
    addSideSupport({
      side: "UNDER",
      text: "Weak free throw floor supports the under",
      weight: 3,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  }

  // Matchup / defense.
  if (cleanMatchupScore >= 65 || cleanDefenseScore >= 65) {
    overRisk -= 4;
    underRisk += 2;
    addSideSupport({
      side: "OVER",
      text: "Matchup supports scoring",
      weight: 6,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  } else if (cleanMatchupScore > 0 && cleanMatchupScore <= 40) {
    overRisk += 4;
    addSideResistance({
      side: "OVER",
      text: "Matchup creates scoring resistance",
      weight: 6,
      warnings,
      overResistance,
      underResistance,
    });
  } else if (cleanDefenseScore > 0 && cleanDefenseScore <= 40) {
    overRisk += 4;
    addSideResistance({
      side: "OVER",
      text: "Defense profile creates scoring resistance",
      weight: 6,
      warnings,
      overResistance,
      underResistance,
    });
  }

  // Role uncertainty hits both sides, but Over more.
  if (cleanRoleCertainty > 0 && cleanRoleCertainty < 45) {
    overRisk += 9;
    underRisk += 3;
    addGeneralResistance({
      text: "Role uncertainty detected",
      weight: 9,
      warnings,
      overResistance,
      underResistance,
    });
    overResistance.value += 4;
  } else if (cleanRoleCertainty > 0 && cleanRoleCertainty < 55) {
    overRisk += 5;
    underRisk += 1;
    addGeneralResistance({
      text: "Some role volatility",
      weight: 5,
      warnings,
      overResistance,
      underResistance,
    });
    overResistance.value += 2;
  }

  // Blowout risk mostly hurts Overs and supports Unders.
  if (cleanBlowoutRisk >= 70) {
    overRisk += 7;
    underRisk -= 4;
    addSideResistance({
      side: "OVER",
      text: "Blowout risk may reduce minutes",
      weight: 7,
      warnings,
      overResistance,
      underResistance,
    });
    addSideSupport({
      side: "UNDER",
      text: "Blowout risk supports the under",
      weight: 5,
      overReasons,
      underReasons,
      overSupport,
      underSupport,
      overResistance,
      underResistance,
    });
  }

  // Data and market danger.
  if (cleanDataQuality <= 40) {
    overRisk += 8;
    underRisk += 8;
    addGeneralResistance({
      text: "Thin data warning",
      weight: 8,
      warnings,
      overResistance,
      underResistance,
    });
  }

  if (cleanRawQuality !== null && cleanRawQuality <= 40) {
    overRisk += 5;
    underRisk += 5;
    addGeneralResistance({
      text: "Raw quality warning",
      weight: 5,
      warnings,
      overResistance,
      underResistance,
    });
  }

  if (cleanDataCoverage !== null && cleanDataCoverage <= 45) {
    overRisk += 5;
    underRisk += 5;
    addGeneralResistance({
      text: "Evidence coverage is weak",
      weight: 5,
      warnings,
      overResistance,
      underResistance,
    });
  }

  if (cleanMarketQuality !== null && cleanMarketQuality <= 40) {
    overRisk += 4;
    underRisk += 4;
    addGeneralResistance({
      text: "Market quality is weak",
      weight: 4,
      warnings,
      overResistance,
      underResistance,
    });
  }

  overRisk = clamp(Math.round(overRisk), 5, 95);
  underRisk = clamp(Math.round(underRisk), 5, 95);

  const overNet = overSupport.value - overResistance.value;
  const underNet = underSupport.value - underResistance.value;

  let pickSide = null;

  if (overNet > underNet) {
    pickSide = "OVER";
  } else if (underNet > overNet) {
    pickSide = "UNDER";
  } else if (overRisk < underRisk) {
    pickSide = "OVER";
  } else if (underRisk < overRisk) {
    pickSide = "UNDER";
  } else {
    pickSide = null;
    noPlayReasons.push("Over/Under evidence is tied");
  }

  const chosenRisk = pickSide === "OVER" ? overRisk : underRisk;
  const riskGap = Math.abs(overRisk - underRisk);

  const support =
    pickSide === "OVER" ? [...overReasons] : [...underReasons];

  const resistance =
    pickSide === "OVER"
      ? [...underReasons, ...warnings]
      : [...overReasons, ...warnings];

  const supportScore =
    pickSide === "OVER" ? overSupport.value : underSupport.value;

  const resistanceScore =
    pickSide === "OVER" ? overResistance.value : underResistance.value;

  const netEdge = Number((supportScore - resistanceScore).toFixed(1));
  const totalEvidence = Number((supportScore + resistanceScore).toFixed(1));

  const signalStrength = getSignalStrength({
    totalEvidence,
    netEdge,
    dataQuality: cleanDataQuality,
  });

  let riskLabel = "High Risk";
  if (chosenRisk <= 32) riskLabel = "Low Risk";
  else if (chosenRisk <= 48) riskLabel = "Medium Risk";

  const missingProjectionAndRecent = !hasProjection && !hasLast5Avg;

  if (missingProjectionAndRecent) {
    noPlayReasons.push("Missing both projection and recent scoring data");
  }

  if (cleanDataQuality <= 35) {
    noPlayReasons.push("Data quality is too thin");
  }

  if (supportScore < 8) {
    noPlayReasons.push("Not enough side support");
  }

  if (totalEvidence < 14) {
    noPlayReasons.push("Not enough total evidence");
  }

  if (riskGap < 5) {
    noPlayReasons.push("Over/Under gap is too close");
  }

  if (chosenRisk >= 65) {
    noPlayReasons.push("Chosen side risk is too high");
  }

  if (netEdge < 4) {
    noPlayReasons.push("Support does not clearly beat resistance");
  }

  if (cleanMarketQuality !== null && cleanMarketQuality <= 25) {
    noPlayReasons.push("Market quality is too weak");
  }

  const trustable = noPlayReasons.length === 0;

  return {
    playerName,

    pickSide,

    overRisk,
    underRisk,
    riskGap,
    chosenRisk,
    riskLabel,

    overSupportScore: overSupport.value,
    underSupportScore: underSupport.value,
    overResistanceScore: overResistance.value,
    underResistanceScore: underResistance.value,
    overNet,
    underNet,

    support,
    resistance,
    danger: resistance,

    supportScore,
    resistanceScore,
    dangerScore: resistanceScore,

    netEdge,
    gap: netEdge,

    signalStrength,
    totalEvidence,

    trustable,
    noPlay: !trustable,
    noPlayReasons,

    reasons: support,
    overReasons,
    underReasons,
    warnings,
  };
}