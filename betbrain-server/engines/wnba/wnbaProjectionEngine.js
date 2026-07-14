/**
 * WNBA volume-first points projection.
 * expectedMinutes × shotVolume × efficiency, blended season/recent anchors.
 * Optional playerRoleProfileV1 calibration is applied with a hard ±1.5 pt cap
 * vs the uncalibrated baseline.
 */

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function blend(recent = 0, season = 0, recentWeight = 0.55) {
  if (recent > 0 && season > 0) {
    return recent * recentWeight + season * (1 - recentWeight);
  }
  if (recent > 0) return recent;
  if (season > 0) return season;
  return 0;
}

function estimateFgPtsPerFGA(points = 0, fga = 0, fta = 0) {
  if (fga <= 0) return 1.05;
  const ftEstimate = fta * 0.78;
  const fgPoints = Math.max(0, points - ftEstimate);
  return fgPoints / fga;
}

function estimateFtPtsPerFTA(points = 0, fga = 0, fta = 0) {
  if (fta <= 0) return 0.78;
  const fgPtsPerFGA = estimateFgPtsPerFGA(points, fga, fta);
  const fgContribution = fga * fgPtsPerFGA;
  const ftPoints = Math.max(0, points - fgContribution);
  return ftPoints / fta;
}

function computeCoreProjection({
  seasonMinutes = 0,
  recentMinutes = 0,
  seasonFGA = 0,
  recentFGA = 0,
  seasonFTA = 0,
  recentFTA = 0,
  seasonPoints = 0,
  recentPoints = 0,
  roleChange = {},
  teammateUsageShift = null,
  recentWeight = 0.6,
  anchorRecentWeight = 0.55,
  expectedMinutesAdjustment = 0,
  expectedFgaAdjustment = 0,
  expectedFtaAdjustment = 0,
  minutesTrustMultiplier = 1,
} = {}) {
  const {
    expectedMinutesDelta = 0,
    expectedFGADelta = 0,
    expectedFTADelta = 0,
    teammateOutBoost = null,
  } = roleChange;

  let expectedMinutes = blend(recentMinutes, seasonMinutes, recentWeight);
  let expectedFGA = blend(recentFGA, seasonFGA, recentWeight);
  let expectedFTA = blend(recentFTA, seasonFTA, recentWeight);

  expectedMinutes = Number(
    (expectedMinutes + expectedMinutesDelta * 0.45).toFixed(1)
  );
  expectedFGA = Number((expectedFGA + expectedFGADelta * 0.45).toFixed(1));
  expectedFTA = Number((expectedFTA + expectedFTADelta * 0.45).toFixed(1));

  if (teammateOutBoost?.projectionBoost > 0 || teammateUsageShift?.fgaBoost > 0) {
    const fgaBoost = num(teammateUsageShift?.fgaBoost ?? expectedFGADelta * 0.12);
    expectedFGA = Number((expectedFGA + fgaBoost).toFixed(1));
  }

  expectedMinutes = Number((expectedMinutes + expectedMinutesAdjustment).toFixed(1));
  expectedFGA = Number((expectedFGA + expectedFgaAdjustment).toFixed(1));
  expectedFTA = Number((expectedFTA + expectedFtaAdjustment).toFixed(1));
  expectedMinutes = Number(
    (expectedMinutes * clamp(minutesTrustMultiplier, 0.75, 1.15)).toFixed(1)
  );

  const fgPtsPerFGA = blend(
    estimateFgPtsPerFGA(recentPoints, recentFGA, recentFTA),
    estimateFgPtsPerFGA(seasonPoints, seasonFGA, seasonFTA),
    anchorRecentWeight
  );
  const ftPtsPerFTA = blend(
    estimateFtPtsPerFTA(recentPoints, recentFGA, recentFTA),
    estimateFtPtsPerFTA(seasonPoints, seasonFGA, seasonFTA),
    anchorRecentWeight
  );

  const minutesFactor =
    seasonMinutes > 0 ? clamp(expectedMinutes / seasonMinutes, 0.75, 1.25) : 1;

  const volumeProjection = expectedFGA * fgPtsPerFGA + expectedFTA * ftPtsPerFTA;
  const anchorProjection = blend(recentPoints, seasonPoints, anchorRecentWeight);
  const blended = volumeProjection * 0.62 + anchorProjection * 0.38;
  const projection = Number((blended * minutesFactor).toFixed(1));

  return {
    projection,
    expectedMinutes,
    expectedFGA,
    expectedFTA,
    fgPtsPerFGA: Number(fgPtsPerFGA.toFixed(3)),
    ftPtsPerFTA: Number(ftPtsPerFTA.toFixed(3)),
    volumeProjection: Number(volumeProjection.toFixed(1)),
    anchorProjection: Number(anchorProjection.toFixed(1)),
  };
}

export function projectWnbaPoints({
  seasonMinutes = 0,
  recentMinutes = 0,
  seasonFGA = 0,
  recentFGA = 0,
  seasonFTA = 0,
  recentFTA = 0,
  seasonPoints = 0,
  recentPoints = 0,
  roleChange = {},
  teammateUsageShift = null,
  profileCalibration = null,
} = {}) {
  const baseline = computeCoreProjection({
    seasonMinutes,
    recentMinutes,
    seasonFGA,
    recentFGA,
    seasonFTA,
    recentFTA,
    seasonPoints,
    recentPoints,
    roleChange,
    teammateUsageShift,
    recentWeight: 0.6,
    anchorRecentWeight: 0.55,
  });

  if (!profileCalibration) {
    return {
      ...baseline,
      method: "volume-first-v2",
      projectionBeforeProfileCalibration: baseline.projection,
      projectionAfterProfileCalibration: baseline.projection,
      profileProjectionDelta: 0,
      profileCalibrationApplied: false,
    };
  }

  const calib = profileCalibration || {};
  const recentWeightAdj = num(calib.recentWeightAdjustment, 0);
  const recentWeight = clamp(0.6 + recentWeightAdj, 0.45, 0.72);
  const anchorRecentWeight = clamp(0.55 + recentWeightAdj * 0.5, 0.4, 0.7);

  const calibrated = computeCoreProjection({
    seasonMinutes,
    recentMinutes,
    seasonFGA,
    recentFGA,
    seasonFTA,
    recentFTA,
    seasonPoints,
    recentPoints,
    roleChange,
    teammateUsageShift,
    recentWeight,
    anchorRecentWeight,
    expectedMinutesAdjustment: num(calib.expectedMinutesAdjustment, 0),
    expectedFgaAdjustment: num(calib.expectedFgaAdjustment, 0),
    expectedFtaAdjustment: num(calib.expectedFtaAdjustment, 0),
    minutesTrustMultiplier: num(calib.minutesTrustMultiplier, 1) || 1,
  });

  let projection = Number(
    (calibrated.projection + num(calib.projectionAdjustment, 0)).toFixed(1)
  );

  // Hard safety: total movement vs uncalibrated baseline ≤ ±1.5 pts
  projection = Number(
    clamp(projection, baseline.projection - 1.5, baseline.projection + 1.5).toFixed(1)
  );

  return {
    ...calibrated,
    projection,
    method: "volume-first-v2",
    projectionBeforeProfileCalibration: baseline.projection,
    projectionAfterProfileCalibration: projection,
    profileProjectionDelta: Number((projection - baseline.projection).toFixed(2)),
    profileCalibrationApplied: true,
  };
}
