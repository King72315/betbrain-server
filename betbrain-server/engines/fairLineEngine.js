function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O") return "OVER";
  if (raw === "UNDER" || raw === "U") return "UNDER";
  return "NONE";
}

function blend(recent = 0, season = 0, recentWeight = 0.6) {
  if (recent > 0 && season > 0) {
    return recent * recentWeight + season * (1 - recentWeight);
  }
  if (recent > 0) return recent;
  if (season > 0) return season;
  return 0;
}

function estimateFtPointsPerFTA(points = 0, fga = 0, fta = 0, fgPtsPerFGA = 0) {
  if (fta <= 0) return 0.78;
  const fgContribution = fga * fgPtsPerFGA;
  const ftPoints = Math.max(0, points - fgContribution);
  return Number((ftPoints / fta).toFixed(3));
}

function estimateFgPointsPerFGA(points = 0, fga = 0, fta = 0) {
  if (fga <= 0) return 0;
  const ftEstimate = fta * 0.78;
  const fgPoints = Math.max(0, points - ftEstimate);
  return Number((fgPoints / fga).toFixed(3));
}

export function buildFairLine({
  playerState = {},
  roleChange = {},
  prop = {},
  auditOldSide = "",
} = {}) {
  const {
    seasonMinutes = 0,
    recentMinutes = 0,
    seasonFGA = 0,
    recentFGA = 0,
    seasonFTA = 0,
    recentFTA = 0,
    seasonPoints = 0,
    recentPoints = 0,
    sportsProjection = 0,
    dataAvailability = 0,
    sourceConfidence = 0,
    dataAvailabilityFlags = {},
  } = playerState;

  const {
    expectedMinutesDelta = 0,
    expectedFGADelta = 0,
    expectedFTADelta = 0,
    roleChangeCertainty = 0,
    teammateOutBoost = null,
  } = roleChange;

  const fairLineReasons = [];
  const fairLineRiskReasons = [];

  const bookLine = num(prop.line ?? playerState.bookLine);

  let expectedMinutes = Number(
    (recentMinutes + expectedMinutesDelta * 0.5).toFixed(1)
  );
  let expectedFGA = Number((recentFGA + expectedFGADelta * 0.5).toFixed(1));
  let expectedFTA = Number((recentFTA + expectedFTADelta * 0.5).toFixed(1));

  if (teammateOutBoost?.projectionBoost > 0) {
    const boostFGA = Number((expectedFGADelta * 0.15).toFixed(1));
    if (boostFGA > 0) {
      expectedFGA = Number((expectedFGA + boostFGA).toFixed(1));
      fairLineReasons.push(
        `Teammate-out volume boost (+${boostFGA} expected FGA)`
      );
    }
  }

  const seasonFgPtsPerFGA = estimateFgPointsPerFGA(
    seasonPoints,
    seasonFGA,
    seasonFTA
  );
  const recentFgPtsPerFGA = estimateFgPointsPerFGA(
    recentPoints,
    recentFGA,
    recentFTA
  );
  const pointsPerFGA = Number(
    blend(recentFgPtsPerFGA, seasonFgPtsPerFGA, 0.65).toFixed(3)
  );

  const seasonFtPtsPerFTA = estimateFtPointsPerFTA(
    seasonPoints,
    seasonFGA,
    seasonFTA,
    seasonFgPtsPerFGA
  );
  const recentFtPtsPerFTA = estimateFtPointsPerFTA(
    recentPoints,
    recentFGA,
    recentFTA,
    recentFgPtsPerFGA
  );
  const ftPercent = Number(
    blend(recentFtPtsPerFTA, seasonFtPtsPerFTA, 0.65).toFixed(3)
  );

  const baseVolumePoints = Number(
    (expectedFGA * pointsPerFGA + expectedFTA * ftPercent).toFixed(1)
  );

  let projectionAnchor = null;
  if (sportsProjection > 0) {
    projectionAnchor = Number(sportsProjection.toFixed(1));
    fairLineReasons.push(
      `SportsData projection anchor at ${projectionAnchor}`
    );
  }

  let fairLine = baseVolumePoints;
  if (projectionAnchor !== null && baseVolumePoints > 0) {
    const anchorWeight = clamp(sourceConfidence / 100, 0.2, 0.45);
    fairLine = Number(
      (
        baseVolumePoints * (1 - anchorWeight) +
        projectionAnchor * anchorWeight
      ).toFixed(1)
    );
    fairLineReasons.push(
      `Volume-first blend: ${baseVolumePoints} base + ${projectionAnchor} anchor`
    );
  } else if (baseVolumePoints > 0) {
    fairLineReasons.push(
      `Volume-only fair line from ${expectedFGA} FGA + ${expectedFTA} FTA`
    );
  }

  if (expectedMinutes > seasonMinutes + 2) {
    fairLineReasons.push(
      `Minutes elevated vs season (${expectedMinutes} expected)`
    );
  } else if (expectedMinutes < seasonMinutes - 2 && seasonMinutes > 0) {
    fairLineRiskReasons.push(
      `Minutes below season baseline (${expectedMinutes} expected)`
    );
  }

  if (recentFGA > seasonFGA + 2) {
    fairLineReasons.push(`Recent FGA above season (${recentFGA} vs ${seasonFGA})`);
  } else if (recentFGA < seasonFGA - 2 && seasonFGA > 0) {
    fairLineRiskReasons.push(`Recent FGA below season (${recentFGA} vs ${seasonFGA})`);
  }

  if (recentPoints > seasonPoints + 3) {
    fairLineReasons.push(
      `Recent scoring above season (${recentPoints} vs ${seasonPoints})`
    );
  } else if (recentPoints < seasonPoints - 3 && seasonPoints > 0) {
    fairLineRiskReasons.push(
      `Recent scoring below season (${recentPoints} vs ${seasonPoints})`
    );
  }

  let fairLineQuality = clamp(
    Math.round(
      dataAvailability * 0.45 +
        sourceConfidence * 0.35 +
        roleChangeCertainty * 0.2
    ),
    0,
    100
  );

  if (!dataAvailabilityFlags.hasLast5) {
    fairLineQuality = clamp(fairLineQuality - 20, 0, 100);
    fairLineRiskReasons.push("Missing last-5 game sample");
  }
  if (!dataAvailabilityFlags.hasSeasonFGA) {
    fairLineQuality = clamp(fairLineQuality - 15, 0, 100);
    fairLineRiskReasons.push("Missing season FGA baseline");
  }
  if (!dataAvailabilityFlags.hasSeasonMinutes) {
    fairLineQuality = clamp(fairLineQuality - 10, 0, 100);
    fairLineRiskReasons.push("Missing season minutes baseline");
  }
  if (expectedFGA <= 0 && expectedFTA <= 0) {
    fairLineQuality = clamp(fairLineQuality - 30, 0, 100);
    fairLineRiskReasons.push("No usable volume inputs for fair line");
  }
  if (pointsPerFGA <= 0) {
    fairLineQuality = clamp(fairLineQuality - 20, 0, 100);
    fairLineRiskReasons.push("Cannot estimate scoring efficiency per FGA");
  }

  const fairLineEdge = Number((fairLine - bookLine).toFixed(1));

  let fairLineSide = "NONE";
  if (fairLine - bookLine >= 1.5) {
    fairLineSide = "OVER";
    fairLineReasons.push(
      `Fair line ${fairLine} is ${fairLineEdge} above book ${bookLine}`
    );
  } else if (bookLine - fairLine >= 1.5) {
    fairLineSide = "UNDER";
    fairLineReasons.push(
      `Fair line ${fairLine} is ${Math.abs(fairLineEdge)} below book ${bookLine}`
    );
  } else {
    fairLineRiskReasons.push(
      `Edge ${fairLineEdge} within neutral zone (±1.5)`
    );
  }

  let fairLineConfidence = clamp(
    Math.round(
      fairLineQuality * 0.4 +
        roleChangeCertainty * 0.25 +
        sourceConfidence * 0.2 +
        Math.min(Math.abs(fairLineEdge) * 8, 15)
    ),
    0,
    100
  );

  if (fairLineSide === "NONE") {
    fairLineConfidence = clamp(fairLineConfidence - 15, 0, 100);
  }
  if (fairLineQuality < 40) {
    fairLineConfidence = clamp(fairLineConfidence - 20, 0, 100);
  }

  const normalizedAudit = normalizeSide(auditOldSide);
  const normalizedFair = normalizeSide(fairLineSide);
  const auditSideMatch =
    normalizedFair !== "NONE" && normalizedAudit === normalizedFair;

  if (fairLineReasons.length === 0 && fairLineQuality >= 40) {
    fairLineReasons.push("Volume profile consistent with season baseline");
  }

  return {
    expectedMinutes,
    expectedFGA,
    expectedFTA,
    pointsPerFGA,
    ftPercent,
    baseVolumePoints,
    projectionAnchor,
    fairLine,
    bookLine,
    fairLineEdge,
    fairLineSide,
    fairLineConfidence,
    fairLineQuality,
    fairLineReasons,
    fairLineRiskReasons,
    auditOldSide: auditOldSide || "",
    auditSideMatch,
  };
}
