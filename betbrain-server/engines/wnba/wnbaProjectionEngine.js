/**
 * WNBA volume-first points projection.
 * expectedMinutes × shotVolume × efficiency, blended season/recent anchors.
 *
 * Side-symmetry rule: recent-vs-season opportunity is counted ONCE via the
 * blend weights. roleChange expected*Delta (recent−season) is descriptive for
 * other engines and must NOT re-inflate volume. minutesFactor remultiply is
 * removed for the same reason. Player Role Profile V1 calibration stays
 * capped ±1.5 vs uncalibrated baseline; minutesTrustMultiplier may dampen
 * only (never inflate projection — STABLE is reliability, not Over bias).
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
  applyRoleChangeDeltas = false,
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

  // Optional legacy path only — default OFF. Recent−season deltas are already
  // encoded in blend(recent, season); re-adding them double-counts opportunity.
  if (applyRoleChangeDeltas) {
    expectedMinutes = Number(
      (expectedMinutes + expectedMinutesDelta * 0.45).toFixed(1)
    );
    expectedFGA = Number((expectedFGA + expectedFGADelta * 0.45).toFixed(1));
    expectedFTA = Number((expectedFTA + expectedFTADelta * 0.45).toFixed(1));
  }

  // True incremental opportunity (teammate out) — not recent/season echo.
  if (teammateOutBoost?.projectionBoost > 0 || teammateUsageShift?.fgaBoost > 0) {
    const fgaBoost = num(teammateUsageShift?.fgaBoost);
    if (fgaBoost > 0) {
      expectedFGA = Number((expectedFGA + fgaBoost).toFixed(1));
    }
  }

  // Profile EXPANDING/CONTRACTING calibrated adjustments (canonical once).
  expectedMinutes = Number((expectedMinutes + expectedMinutesAdjustment).toFixed(1));
  expectedFGA = Number((expectedFGA + expectedFgaAdjustment).toFixed(1));
  expectedFTA = Number((expectedFTA + expectedFtaAdjustment).toFixed(1));

  // Trust may dampen minutes estimate for audit — never inflate above blend.
  const trustDamp = clamp(num(minutesTrustMultiplier, 1) || 1, 0.75, 1);
  expectedMinutes = Number((expectedMinutes * trustDamp).toFixed(1));

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

  // Informative only — NOT applied to final projection (would remultiply minutes).
  const minutesFactorObserved =
    seasonMinutes > 0 ? clamp(expectedMinutes / seasonMinutes, 0.75, 1.25) : 1;

  const volumeProjection = expectedFGA * fgPtsPerFGA + expectedFTA * ftPtsPerFTA;
  const anchorProjection = blend(recentPoints, seasonPoints, anchorRecentWeight);
  const blended = volumeProjection * 0.62 + anchorProjection * 0.38;
  // Apply trust dampen once on the blended projection when < 1 (reliability).
  const projection = Number((blended * trustDamp).toFixed(1));

  const components = {
    volumeProjection: Number(volumeProjection.toFixed(3)),
    anchorProjection: Number(anchorProjection.toFixed(3)),
    volumeWeight: 0.62,
    anchorWeight: 0.38,
    blendedBeforeTrust: Number(blended.toFixed(3)),
    minutesTrustDamp: trustDamp,
    minutesFactorObserved: Number(minutesFactorObserved.toFixed(3)),
    minutesFactorApplied: 1,
    roleChangeDeltasApplied: Boolean(applyRoleChangeDeltas),
    expectedMinutesAdjustment: num(expectedMinutesAdjustment),
    expectedFgaAdjustment: num(expectedFgaAdjustment),
    expectedFtaAdjustment: num(expectedFtaAdjustment),
    profileProjectionAdjustment: 0,
  };

  const componentSum = Number(
    (
      components.volumeProjection * components.volumeWeight +
      components.anchorProjection * components.anchorWeight
    ).toFixed(3)
  );

  return {
    projection,
    expectedMinutes,
    expectedFGA,
    expectedFTA,
    fgPtsPerFGA: Number(fgPtsPerFGA.toFixed(3)),
    ftPtsPerFTA: Number(ftPtsPerFTA.toFixed(3)),
    volumeProjection: Number(volumeProjection.toFixed(1)),
    anchorProjection: Number(anchorProjection.toFixed(1)),
    minutesFactorObserved: Number(minutesFactorObserved.toFixed(3)),
    projectionComponents: {
      ...components,
      blendedReconcile: componentSum,
      finalBeforeProfileAdj: projection,
    },
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
  applyRoleChangeDeltas = false,
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
    applyRoleChangeDeltas,
  });

  if (!profileCalibration) {
    return {
      ...baseline,
      method: "volume-first-v3-side-symmetry",
      projectionBeforeProfileCalibration: baseline.projection,
      projectionAfterProfileCalibration: baseline.projection,
      profileProjectionDelta: 0,
      profileCalibrationApplied: false,
      projectionComponents: {
        ...baseline.projectionComponents,
        profileProjectionAdjustment: 0,
        finalProjection: baseline.projection,
        remainder: 0,
      },
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
    // Cap trust at 1.0 for projection — STABLE reliability must not inflate pts
    minutesTrustMultiplier: Math.min(1, num(calib.minutesTrustMultiplier, 1) || 1),
    applyRoleChangeDeltas,
  });

  const profileAdj = num(calib.projectionAdjustment, 0);
  let projection = Number((calibrated.projection + profileAdj).toFixed(1));

  // Hard safety: total movement vs uncalibrated baseline ≤ ±1.5 pts
  projection = Number(
    clamp(projection, baseline.projection - 1.5, baseline.projection + 1.5).toFixed(1)
  );

  const components = {
    ...calibrated.projectionComponents,
    profileProjectionAdjustment: profileAdj,
    finalProjection: projection,
    remainder: Number(
      (
        projection -
        (calibrated.projectionComponents.blendedBeforeTrust *
          calibrated.projectionComponents.minutesTrustDamp +
          profileAdj)
      ).toFixed(3)
    ),
  };

  return {
    ...calibrated,
    projection,
    method: "volume-first-v3-side-symmetry",
    projectionBeforeProfileCalibration: baseline.projection,
    projectionAfterProfileCalibration: projection,
    profileProjectionDelta: Number((projection - baseline.projection).toFixed(2)),
    profileCalibrationApplied: true,
    projectionComponents: components,
  };
}
