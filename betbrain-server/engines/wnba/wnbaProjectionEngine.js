/**
 * WNBA volume-first points projection.
 * expectedMinutes × shotVolume × efficiency, blended season/recent anchors.
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
} = {}) {
  const {
    expectedMinutesDelta = 0,
    expectedFGADelta = 0,
    expectedFTADelta = 0,
    teammateOutBoost = null,
  } = roleChange;

  let expectedMinutes = blend(recentMinutes, seasonMinutes, 0.6);
  let expectedFGA = blend(recentFGA, seasonFGA, 0.6);
  let expectedFTA = blend(recentFTA, seasonFTA, 0.6);

  expectedMinutes = Number(
    (expectedMinutes + expectedMinutesDelta * 0.45).toFixed(1)
  );
  expectedFGA = Number((expectedFGA + expectedFGADelta * 0.45).toFixed(1));
  expectedFTA = Number((expectedFTA + expectedFTADelta * 0.45).toFixed(1));

  if (teammateOutBoost?.projectionBoost > 0 || teammateUsageShift?.fgaBoost > 0) {
    const fgaBoost = num(teammateUsageShift?.fgaBoost ?? expectedFGADelta * 0.12);
    expectedFGA = Number((expectedFGA + fgaBoost).toFixed(1));
  }

  const fgPtsPerFGA = blend(
    estimateFgPtsPerFGA(recentPoints, recentFGA, recentFTA),
    estimateFgPtsPerFGA(seasonPoints, seasonFGA, seasonFTA),
    0.55
  );
  const ftPtsPerFTA = blend(
    estimateFtPtsPerFTA(recentPoints, recentFGA, recentFTA),
    estimateFtPtsPerFTA(seasonPoints, seasonFGA, seasonFTA),
    0.55
  );

  const minutesFactor =
    seasonMinutes > 0 ? clamp(expectedMinutes / seasonMinutes, 0.75, 1.25) : 1;

  const volumeProjection = expectedFGA * fgPtsPerFGA + expectedFTA * ftPtsPerFTA;
  const anchorProjection = blend(recentPoints, seasonPoints, 0.55);
  const blended = volumeProjection * 0.62 + anchorProjection * 0.38;

  const projection = Number(
    (blended * minutesFactor).toFixed(1)
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
    method: "volume-first-v2",
  };
}
