/**
 * Player Role Profile v1 — data-driven role classification + bounded calibration.
 * Classifies prop-listed players by measurable behavior (not reputation).
 * Profile alone must not force side flip, TRACK, or hard-kill override.
 */

export const PLAYER_ROLE_PROFILE_VERSION = "player-role-profile-v1";
export const PLAYER_PROFILE_CALIBRATION_VERSION = "player-profile-calibration-v1";

const MIN_FAVORABLE_SAMPLE = 5;
const MAX_RECENT_GAMES = 10;
const PREFERRED_RECENT_GAMES = 5;

/** Safety caps (Phase 4) */
export const CALIBRATION_CAPS = Object.freeze({
  maxProjectionMovement: 1.5,
  maxExpandingShift: 1.25,
  maxContractingShift: -1.25,
  maxConfidenceAdj: 8,
  maxRequiredEdgeUp: 1.0,
  maxRequiredEdgeDown: -0.25,
  maxRankingAdj: 8,
});

/** Starting classification thresholds (Phase 3) — WNBA-tuned */
export const ROLE_THRESHOLDS = Object.freeze({
  stableCv: 0.12,
  moderateCvMax: 0.22,
  stableFloorHit: 0.8,
  moderateFloorHit: 0.6,
  stableTrimmedRange: 8,
  minutesHigh: 30,
  minutesMedium: 20,
  fgaHigh: 12,
  fgaMedium: 7,
  majorMinutesBreak: 10,
  expandMinutesDelta: 2.5,
  expandFgaDelta: 1.5,
  expandFtaDelta: 1.0,
  expandUsageDelta: 0.04,
});

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, digits = 2) {
  const n = num(value);
  if (n === null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

function mean(values = []) {
  const nums = values.map((v) => num(v)).filter((v) => v !== null);
  if (!nums.length) return null;
  return nums.reduce((s, v) => s + v, 0) / nums.length;
}

function stdDev(values = []) {
  const nums = values.map((v) => num(v)).filter((v) => v !== null);
  if (nums.length < 2) return null;
  const m = mean(nums);
  const variance =
    nums.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, nums.length - 1);
  return Math.sqrt(variance);
}

function coefficientOfVariation(sd, avg) {
  if (sd === null || avg === null || avg === 0) return null;
  if (Math.abs(avg) < 1e-6) return null;
  return Math.abs(sd / avg);
}

function trimmedRange(values = [], trimCount = 1) {
  const nums = values
    .map((v) => num(v))
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length <= trimCount * 2 + 1) {
    return nums[nums.length - 1] - nums[0];
  }
  const sliced = nums.slice(trimCount, nums.length - trimCount);
  return sliced[sliced.length - 1] - sliced[0];
}

function robustRange(values = []) {
  const nums = values
    .map((v) => num(v))
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  if (nums.length < 4) return nums[nums.length - 1] - nums[0];
  const q1 = nums[Math.floor((nums.length - 1) * 0.25)];
  const q3 = nums[Math.floor((nums.length - 1) * 0.75)];
  return q3 - q1;
}

function normalizeGame(game = {}) {
  return {
    date: game.date || null,
    minutes: num(game.minutes, 0) ?? 0,
    points: num(game.points, 0) ?? 0,
    fga: num(game.fga, 0) ?? 0,
    fta: num(game.fta, 0) ?? 0,
    fg3a: num(game.fg3a ?? game.threePa ?? game.three_pa, 0) ?? 0,
    opponent: game.opponent || "",
  };
}

/**
 * Prefer ≥5 recent games, up to 10. Pads from season logs when last5 is short.
 */
export function resolveProfileGameSample({
  last5 = [],
  seasonGames = [],
  maxGames = MAX_RECENT_GAMES,
} = {}) {
  const recent = (Array.isArray(last5) ? last5 : [])
    .map(normalizeGame)
    .filter((g) => g.minutes > 0 || g.points > 0 || g.fga > 0);
  const season = (Array.isArray(seasonGames) ? seasonGames : [])
    .map(normalizeGame)
    .filter((g) => g.minutes > 0 || g.points > 0 || g.fga > 0);

  const seen = new Set();
  const combined = [];
  for (const g of [...recent, ...season]) {
    const key = `${g.date || ""}|${g.opponent || ""}|${g.points}|${g.minutes}|${g.fga}`;
    if (seen.has(key)) continue;
    seen.add(key);
    combined.push(g);
    if (combined.length >= maxGames) break;
  }
  return combined;
}

function classifyMinutesLevel(avgMinutes) {
  if (avgMinutes === null) return "LOW";
  if (avgMinutes >= ROLE_THRESHOLDS.minutesHigh) return "HIGH";
  if (avgMinutes >= ROLE_THRESHOLDS.minutesMedium) return "MEDIUM";
  return "LOW";
}

function classifyScoringVolume({ expectedFga, expectedFta, recentFga, seasonFga }) {
  const fga =
    num(expectedFga) ??
    num(recentFga) ??
    num(seasonFga);
  if (fga === null) return "LOW";
  const fta = num(expectedFta, 0) ?? 0;
  const usageProxy = fga + fta * 0.44;
  if (usageProxy >= ROLE_THRESHOLDS.fgaHigh || fga >= ROLE_THRESHOLDS.fgaHigh) {
    return "HIGH";
  }
  if (usageProxy >= ROLE_THRESHOLDS.fgaMedium || fga >= ROLE_THRESHOLDS.fgaMedium) {
    return "MEDIUM";
  }
  return "LOW";
}

function classifyRoleStability({
  minutesCv,
  floorHitRate,
  trimmedMinutesRange,
  majorBreakCount,
  sampleSize,
  profileConfidence,
}) {
  if (sampleSize < 3 || profileConfidence < 35) return "UNSTABLE";

  const cv = minutesCv;
  const floor = floorHitRate;
  const range = trimmedMinutesRange;

  const stableCv = cv !== null && cv <= ROLE_THRESHOLDS.stableCv;
  const stableFloor = floor !== null && floor >= ROLE_THRESHOLDS.stableFloorHit;
  const stableRange =
    range !== null && range <= ROLE_THRESHOLDS.stableTrimmedRange;
  const noMajorBreaks = (majorBreakCount || 0) <= 1;

  if (stableCv && stableFloor && stableRange && noMajorBreaks) return "STABLE";

  const unstableCv = cv !== null && cv > ROLE_THRESHOLDS.moderateCvMax;
  const lowFloor =
    floor !== null && floor < ROLE_THRESHOLDS.moderateFloorHit;
  const largeRange =
    range !== null && range > ROLE_THRESHOLDS.stableTrimmedRange * 1.75;
  if (unstableCv || lowFloor || largeRange || majorBreakCount >= 3) {
    return "UNSTABLE";
  }
  return "MODERATE";
}

function classifyShotVolumeStability({ fgaCv, ftaSd, fgaTrimmedRange, sampleSize }) {
  if (sampleSize < 3) return "UNSTABLE";
  const cv = fgaCv;
  const range = fgaTrimmedRange;
  if (cv !== null && cv <= 0.18 && (range === null || range <= 5)) return "STABLE";
  if (cv !== null && cv > 0.35) return "UNSTABLE";
  if (range !== null && range >= 8) return "UNSTABLE";
  if (ftaSd !== null && ftaSd >= 3.5 && (cv === null || cv > 0.25)) return "UNSTABLE";
  if (cv !== null && cv <= 0.28) return "MODERATE";
  return "MODERATE";
}

/**
 * Scoring volatility: prefer SD + robust range; avoid CV alone on low means.
 */
function classifyScoringVolatility({
  pointsSd,
  pointsCv,
  pointsRobustRange,
  pointsMean,
  sampleSize,
}) {
  if (sampleSize < 3) return "HIGH";
  const meanPts = pointsMean ?? 0;
  const sd = pointsSd;
  const iqr = pointsRobustRange;

  let score = 0;
  if (sd !== null) {
    if (meanPts >= 12) {
      if (sd >= 8) score += 2;
      else if (sd >= 5) score += 1;
    } else if (meanPts >= 7) {
      if (sd >= 6.5) score += 2;
      else if (sd >= 4) score += 1;
    } else {
      // low mean — CV exaggerates; rely on absolute SD / range
      if (sd >= 5.5) score += 2;
      else if (sd >= 3.5) score += 1;
    }
  }
  if (iqr !== null) {
    if (iqr >= 10) score += 2;
    else if (iqr >= 6) score += 1;
  }
  // CV only as tie-break when mean is meaningful
  if (meanPts >= 10 && pointsCv !== null) {
    if (pointsCv >= 0.45) score += 1;
    else if (pointsCv <= 0.22) score -= 1;
  }

  if (score >= 3) return "HIGH";
  if (score <= 0) return "LOW";
  return "MEDIUM";
}

/**
 * EXPANDING/CONTRACTING require ≥2 opportunity signals.
 * Points-only rise does not expand. Distinguish hot shooting / spikes / missing data.
 */
function classifyRoleDirection({
  recentMinutes,
  seasonMinutes,
  recentFga,
  seasonFga,
  recentFta,
  seasonFta,
  recentPoints,
  seasonPoints,
  sampleSize,
  availabilityContext = {},
  roleChange = {},
}) {
  if (sampleSize < 3) return "STABLE";

  const signals = { up: [], down: [] };
  const minDelta = (recentMinutes ?? 0) - (seasonMinutes ?? 0);
  const fgaDelta = (recentFga ?? 0) - (seasonFga ?? 0);
  const ftaDelta = (recentFta ?? 0) - (seasonFta ?? 0);
  const recentUsage =
    (recentMinutes ?? 0) > 0
      ? (recentFga ?? 0) / recentMinutes
      : null;
  const seasonUsage =
    (seasonMinutes ?? 0) > 0 ? (seasonFga ?? 0) / seasonMinutes : null;
  const usageDelta =
    recentUsage !== null && seasonUsage !== null
      ? recentUsage - seasonUsage
      : null;

  if (minDelta >= ROLE_THRESHOLDS.expandMinutesDelta) signals.up.push("minutes");
  if (minDelta <= -ROLE_THRESHOLDS.expandMinutesDelta) signals.down.push("minutes");
  if (fgaDelta >= ROLE_THRESHOLDS.expandFgaDelta) signals.up.push("fga");
  if (fgaDelta <= -ROLE_THRESHOLDS.expandFgaDelta) signals.down.push("fga");
  if (ftaDelta >= ROLE_THRESHOLDS.expandFtaDelta) signals.up.push("fta");
  if (ftaDelta <= -ROLE_THRESHOLDS.expandFtaDelta) signals.down.push("fta");
  if (usageDelta !== null && usageDelta >= ROLE_THRESHOLDS.expandUsageDelta) {
    signals.up.push("usage");
  }
  if (usageDelta !== null && usageDelta <= -ROLE_THRESHOLDS.expandUsageDelta) {
    signals.down.push("usage");
  }

  // Teammate / injury replacement can count as an opportunity signal when present
  if (availabilityContext?.teammateOut || roleChange?.teammateOutBoost) {
    if (signals.up.length >= 1) signals.up.push("teammate_opportunity");
  }

  const ptsDelta = (recentPoints ?? 0) - (seasonPoints ?? 0);
  const efficiencyOnly =
    ptsDelta >= 4 &&
    fgaDelta < ROLE_THRESHOLDS.expandFgaDelta * 0.5 &&
    minDelta < ROLE_THRESHOLDS.expandMinutesDelta * 0.5;

  if (efficiencyOnly) {
    return "STABLE"; // hot shooting — not role expansion
  }

  // One-game spike guard: if only 1 strong signal and deltas barely clear, stay STABLE
  if (signals.up.length >= 2 && signals.down.length === 0) return "EXPANDING";
  if (signals.down.length >= 2 && signals.up.length === 0) return "CONTRACTING";
  return "STABLE";
}

function computeMinutesFloorHitRate(minutesList = [], floor = null) {
  if (!minutesList.length || floor === null || floor <= 0) return null;
  const target = Math.max(floor * 0.85, floor - 4);
  const hits = minutesList.filter((m) => m >= target).length;
  return hits / minutesList.length;
}

function countMajorRoleBreaks(minutesList = []) {
  if (minutesList.length < 2) return 0;
  let breaks = 0;
  for (let i = 1; i < minutesList.length; i += 1) {
    if (
      Math.abs(minutesList[i] - minutesList[i - 1]) >=
      ROLE_THRESHOLDS.majorMinutesBreak
    ) {
      breaks += 1;
    }
  }
  return breaks;
}

function computeProfileConfidence({
  sampleSize,
  missingFields = [],
  hasSeason,
  hasRecent,
  bookCount,
}) {
  let score = 20;
  if (sampleSize >= 10) score += 35;
  else if (sampleSize >= 7) score += 28;
  else if (sampleSize >= 5) score += 22;
  else if (sampleSize >= 3) score += 12;
  else if (sampleSize >= 1) score += 4;

  if (hasSeason) score += 15;
  if (hasRecent) score += 10;
  if (num(bookCount, 0) >= 3) score += 8;
  else if (num(bookCount, 0) >= 1) score += 3;

  score -= missingFields.length * 6;
  if (sampleSize < MIN_FAVORABLE_SAMPLE) score -= 12;
  return clamp(Math.round(score), 0, 100);
}

/**
 * Build playerRoleProfile for a prop-listed player.
 */
export function buildPlayerRoleProfile({
  last5 = [],
  seasonGames = [],
  seasonMinutes = null,
  seasonFga = null,
  seasonFta = null,
  seasonPoints = null,
  expectedMinutes = null,
  expectedFga = null,
  expectedFta = null,
  bookCount = null,
  roleChange = {},
  availabilityContext = {},
  gamesPlayed = null,
} = {}) {
  const missingProfileFields = [];
  const profileDataSources = [];
  let fallbackUsed = false;

  const games = resolveProfileGameSample({ last5, seasonGames });
  if (last5?.length) profileDataSources.push("last5");
  if (seasonGames?.length) profileDataSources.push("seasonGames");
  if (seasonMinutes || seasonFga || seasonPoints) profileDataSources.push("seasonAverages");
  if (expectedMinutes || expectedFga) profileDataSources.push("expectedVolume");

  const sampleSize = games.length;
  if (sampleSize < PREFERRED_RECENT_GAMES) {
    missingProfileFields.push("preferredRecentSample");
    fallbackUsed = true;
  }

  const minutesList = games.map((g) => g.minutes);
  const fgaList = games.map((g) => g.fga);
  const ftaList = games.map((g) => g.fta);
  const pointsList = games.map((g) => g.points);

  const recentMinutesAverage = round(mean(minutesList), 1);
  const recentFgaAverage = round(mean(fgaList), 1);
  const recentFtaAverage = round(mean(ftaList), 1);
  const recentPointsAverage = round(mean(pointsList), 1);

  const seasonMinutesAverage =
    round(num(seasonMinutes), 1) ??
    (seasonGames?.length
      ? round(mean(seasonGames.map((g) => normalizeGame(g).minutes)), 1)
      : null);
  const seasonFgaAverage =
    round(num(seasonFga), 1) ??
    (seasonGames?.length
      ? round(mean(seasonGames.map((g) => normalizeGame(g).fga)), 1)
      : null);
  const seasonFtaAverage =
    round(num(seasonFta), 1) ??
    (seasonGames?.length
      ? round(mean(seasonGames.map((g) => normalizeGame(g).fta)), 1)
      : null);
  const seasonPointsAverage =
    round(num(seasonPoints), 1) ??
    (seasonGames?.length
      ? round(mean(seasonGames.map((g) => normalizeGame(g).points)), 1)
      : null);

  if (seasonMinutesAverage === null) missingProfileFields.push("seasonMinutes");
  if (seasonFgaAverage === null) missingProfileFields.push("seasonFga");
  if (seasonFtaAverage === null) missingProfileFields.push("seasonFta");
  if (seasonPointsAverage === null) missingProfileFields.push("seasonPoints");
  if (sampleSize === 0) {
    missingProfileFields.push("recentGames");
    fallbackUsed = true;
  }

  const minutesStandardDeviation = round(stdDev(minutesList), 2);
  const fgaStandardDeviation = round(stdDev(fgaList), 2);
  const ftaStandardDeviation = round(stdDev(ftaList), 2);
  const pointsStandardDeviation = round(stdDev(pointsList), 2);

  const minutesCoefficientOfVariation = round(
    coefficientOfVariation(minutesStandardDeviation, recentMinutesAverage),
    3
  );
  const fgaCoefficientOfVariation = round(
    coefficientOfVariation(fgaStandardDeviation, recentFgaAverage),
    3
  );
  const pointsCoefficientOfVariation = round(
    coefficientOfVariation(pointsStandardDeviation, recentPointsAverage),
    3
  );

  const minutesRangeRaw =
    minutesList.length > 0
      ? Math.max(...minutesList) - Math.min(...minutesList)
      : null;
  const minutesRange = round(minutesRangeRaw, 1);
  const minutesTrimmedRange = round(trimmedRange(minutesList), 1);
  const fgaTrimmedRange = round(trimmedRange(fgaList), 1);
  const pointsRobustRange = round(robustRange(pointsList), 1);

  const floorBase =
    seasonMinutesAverage ??
    recentMinutesAverage ??
    (ROLE_THRESHOLDS.minutesMedium);
  const minutesFloorHitRate = round(
    computeMinutesFloorHitRate(minutesList, floorBase),
    3
  );
  const majorBreakCount = countMajorRoleBreaks(minutesList);
  const roleChangeFrequency = round(
    sampleSize > 1 ? majorBreakCount / (sampleSize - 1) : 0,
    3
  );

  const profileConfidence = computeProfileConfidence({
    sampleSize,
    missingFields: missingProfileFields,
    hasSeason: seasonMinutesAverage !== null && seasonFgaAverage !== null,
    hasRecent: sampleSize >= 3,
    bookCount,
  });

  const roleStability = classifyRoleStability({
    minutesCv: minutesCoefficientOfVariation,
    floorHitRate: minutesFloorHitRate,
    trimmedMinutesRange: minutesTrimmedRange ?? minutesRange,
    majorBreakCount,
    sampleSize,
    profileConfidence,
  });

  const minutesLevel = classifyMinutesLevel(recentMinutesAverage ?? seasonMinutesAverage);

  const scoringVolume = classifyScoringVolume({
    expectedFga: expectedFga ?? recentFgaAverage,
    expectedFta: expectedFta ?? recentFtaAverage,
    recentFga: recentFgaAverage,
    seasonFga: seasonFgaAverage,
  });

  const shotVolumeStability = classifyShotVolumeStability({
    fgaCv: fgaCoefficientOfVariation,
    ftaSd: ftaStandardDeviation,
    fgaTrimmedRange,
    sampleSize,
  });

  const scoringVolatility = classifyScoringVolatility({
    pointsSd: pointsStandardDeviation,
    pointsCv: pointsCoefficientOfVariation,
    pointsRobustRange,
    pointsMean: recentPointsAverage,
    sampleSize,
  });

  const roleDirection = classifyRoleDirection({
    recentMinutes: recentMinutesAverage,
    seasonMinutes: seasonMinutesAverage,
    recentFga: recentFgaAverage,
    seasonFga: seasonFgaAverage,
    recentFta: recentFtaAverage,
    seasonFta: seasonFtaAverage,
    recentPoints: recentPointsAverage,
    seasonPoints: seasonPointsAverage,
    sampleSize,
    availabilityContext,
    roleChange,
  });

  return {
    version: PLAYER_ROLE_PROFILE_VERSION,
    roleStability,
    minutesLevel,
    scoringVolume,
    shotVolumeStability,
    scoringVolatility,
    roleDirection,
    recentMinutesAverage,
    seasonMinutesAverage,
    minutesStandardDeviation,
    minutesCoefficientOfVariation,
    minutesRange,
    minutesTrimmedRange,
    minutesFloorHitRate,
    recentFgaAverage,
    seasonFgaAverage,
    fgaStandardDeviation,
    fgaCoefficientOfVariation,
    recentFtaAverage,
    seasonFtaAverage,
    ftaStandardDeviation,
    recentPointsAverage,
    seasonPointsAverage,
    pointsStandardDeviation,
    pointsCoefficientOfVariation,
    pointsRobustRange,
    roleChangeFrequency,
    majorBreakCount,
    gamesPlayed: num(gamesPlayed) ?? sampleSize,
    profileConfidence,
    profileSampleSize: sampleSize,
    profileDataSources,
    missingProfileFields,
    fallbackUsed,
  };
}

function allowFavorableAdjustments(profile = {}) {
  return (
    (profile.profileSampleSize || 0) >= MIN_FAVORABLE_SAMPLE &&
    (profile.profileConfidence || 0) >= 50 &&
    !profile.fallbackUsed
  );
}

/**
 * Bounded calibration from profile (Phases 4–6).
 * Profile alone cannot flip side / create TRACK / override hard kill.
 */
export function buildPlayerProfileCalibration(profile = {}, options = {}) {
  const reasons = [];
  const riskDebtIds = [];
  const riskRepairIds = [];
  const favorable = allowFavorableAdjustments(profile);

  let recentWeightAdjustment = 0;
  let seasonWeightAdjustment = 0;
  let minutesTrustMultiplier = 1;
  let expectedMinutesAdjustment = 0;
  let expectedFgaAdjustment = 0;
  let expectedFtaAdjustment = 0;
  let projectionAdjustment = 0;
  let projectionUncertaintyAdjustment = 0;
  let overRequiredEdgeAdjustment = 0;
  let underRequiredEdgeAdjustment = 0;
  let confidenceAdjustment = 0;
  let rankingAdjustment = 0;

  const rs = profile.roleStability;
  const sv = profile.scoringVolume;
  const vol = profile.scoringVolatility;
  const dir = profile.roleDirection;
  const shotStab = profile.shotVolumeStability;

  // --- Role stability matrix ---
  if (rs === "STABLE") {
    if (favorable) {
      seasonWeightAdjustment += 0.04;
      recentWeightAdjustment -= 0.02;
      minutesTrustMultiplier = 1.06;
      projectionUncertaintyAdjustment -= 0.35;
      confidenceAdjustment += 3;
      rankingAdjustment += 4;
      riskRepairIds.push("STABLE_ROLE_PROFILE");
      reasons.push("STABLE role — trust season blend and minutes");
    } else {
      reasons.push("STABLE indicated but sample/confidence blocks favorable adj");
    }
  } else if (rs === "MODERATE") {
    projectionUncertaintyAdjustment += 0.25;
    overRequiredEdgeAdjustment += 0.15;
    underRequiredEdgeAdjustment += 0.1;
    confidenceAdjustment -= 1;
    reasons.push("MODERATE role — slight uncertainty uplift");
  } else if (rs === "UNSTABLE") {
    recentWeightAdjustment -= 0.06;
    seasonWeightAdjustment += 0.03;
    minutesTrustMultiplier = 0.88;
    projectionUncertaintyAdjustment += 0.75;
    overRequiredEdgeAdjustment += 0.55;
    underRequiredEdgeAdjustment += 0.4;
    confidenceAdjustment -= 5;
    rankingAdjustment -= 5;
    riskDebtIds.push("UNSTABLE_ROLE");
    reasons.push("UNSTABLE role — higher evidence bar, canonical UNSTABLE_ROLE debt");
  }

  // --- Scoring volume (not book line) ---
  if (sv === "HIGH") {
    if (favorable && rs === "STABLE" && vol === "LOW") {
      confidenceAdjustment += 2;
      rankingAdjustment += 2;
      reasons.push("HIGH volume + STABLE + LOW vol — reliable scorer profile");
    } else if (rs === "UNSTABLE") {
      overRequiredEdgeAdjustment += 0.25;
      underRequiredEdgeAdjustment += 0.15;
      reasons.push("HIGH volume + UNSTABLE — stronger edge required");
    } else {
      reasons.push("HIGH volume — descriptive only, not auto Over");
    }
  } else if (sv === "LOW") {
    overRequiredEdgeAdjustment += 0.35;
    reasons.push("LOW volume — Overs need volume proof");
    if (dir === "EXPANDING") {
      underRequiredEdgeAdjustment += 0.2;
      confidenceAdjustment -= 2;
      reasons.push("EXPANDING + LOW volume weakens Under confidence");
    }
  }

  // --- Shot-volume stability ---
  if (shotStab === "UNSTABLE") {
    projectionUncertaintyAdjustment += 0.3;
    overRequiredEdgeAdjustment += 0.2;
    reasons.push("Unstable shot volume");
  } else if (shotStab === "STABLE" && favorable) {
    riskRepairIds.push("STABLE_SHOT_VOLUME");
    projectionUncertaintyAdjustment -= 0.15;
  }

  // --- Scoring volatility ---
  if (vol === "HIGH") {
    projectionUncertaintyAdjustment += 0.45;
    confidenceAdjustment -= 3;
    rankingAdjustment -= 3;
    overRequiredEdgeAdjustment += 0.2;
    underRequiredEdgeAdjustment += 0.15;
    reasons.push("HIGH scoring volatility");
  } else if (vol === "LOW" && favorable) {
    confidenceAdjustment += 2;
    projectionUncertaintyAdjustment -= 0.2;
    riskRepairIds.push("LOW_SCORING_VOLATILITY");
    reasons.push("LOW scoring volatility supports confidence");
  }

  // --- Role direction (capped shifts; require opportunity already validated in profile) ---
  if (dir === "EXPANDING") {
    const shift = clamp(
      0.55 + (sv === "LOW" ? 0.35 : 0.2),
      0,
      CALIBRATION_CAPS.maxExpandingShift
    );
    expectedMinutesAdjustment += round(shift * 0.6, 2);
    expectedFgaAdjustment += round(shift * 0.45, 2);
    expectedFtaAdjustment += round(shift * 0.15, 2);
    projectionAdjustment += clamp(shift * 0.7, 0, CALIBRATION_CAPS.maxExpandingShift);
    if (options.side === "OVER" && favorable) {
      confidenceAdjustment += 1;
      riskRepairIds.push("EXPANDING_ROLE_PROFILE");
    }
    if (options.side === "UNDER") {
      confidenceAdjustment -= 2;
      underRequiredEdgeAdjustment += 0.2;
    }
    reasons.push(`EXPANDING role — bounded opp shift +${shift}`);
  } else if (dir === "CONTRACTING") {
    const shift = CALIBRATION_CAPS.maxContractingShift;
    expectedMinutesAdjustment += round(shift * 0.6, 2);
    expectedFgaAdjustment += round(shift * 0.45, 2);
    projectionAdjustment += clamp(shift * 0.7, CALIBRATION_CAPS.maxContractingShift, 0);
    if (options.side === "UNDER" && favorable) {
      confidenceAdjustment += 1;
      riskRepairIds.push("CONTRACTING_ROLE_PROFILE");
    }
    if (options.side === "OVER") {
      confidenceAdjustment -= 2;
      overRequiredEdgeAdjustment += 0.25;
    }
    reasons.push("CONTRACTING role — bounded negative opp shift");
  }

  // Gold combination: STABLE + MED/HIGH volume + LOW volatility
  if (
    favorable &&
    rs === "STABLE" &&
    vol === "LOW" &&
    (sv === "MEDIUM" || sv === "HIGH")
  ) {
    rankingAdjustment += 2;
    confidenceAdjustment += 1;
    reasons.push("STABLE+LOW_VOL reliable combination");
  }

  // STABLE + LOW_VOL + HIGH volume — do not over-trust
  if (favorable && rs === "STABLE" && vol === "LOW" && sv === "HIGH") {
    confidenceAdjustment = Math.min(confidenceAdjustment, 6);
    rankingAdjustment = Math.min(rankingAdjustment, 6);
    reasons.push("STABLE+HIGH_VOL+LOW_VOL capped to avoid over-trust");
  }

  // Missing / weak profile — strip favorable adjustments
  if (!favorable) {
    if (confidenceAdjustment > 0) confidenceAdjustment = 0;
    if (rankingAdjustment > 0) rankingAdjustment = 0;
    if (projectionAdjustment > 0) projectionAdjustment = 0;
    if (projectionUncertaintyAdjustment < 0) projectionUncertaintyAdjustment = 0;
    if (minutesTrustMultiplier > 1) minutesTrustMultiplier = 1;
    overRequiredEdgeAdjustment = Math.max(overRequiredEdgeAdjustment, 0.1);
    reasons.push("Weak/missing profile — no favorable adjustments");
    if ((profile.profileConfidence || 0) < 40) {
      riskDebtIds.push("LOW_PROFILE_CONFIDENCE");
    }
  }

  // Deduplicate debt/repair ids and enforce UNSTABLE_ROLE over UNSTABLE_MINUTES
  const uniqueDebts = [...new Set(riskDebtIds)];
  const uniqueRepairs = [...new Set(riskRepairIds)];

  projectionAdjustment = clamp(
    round(projectionAdjustment, 2),
    -CALIBRATION_CAPS.maxProjectionMovement,
    CALIBRATION_CAPS.maxProjectionMovement
  );
  if (dir === "EXPANDING") {
    projectionAdjustment = clamp(
      projectionAdjustment,
      0,
      CALIBRATION_CAPS.maxExpandingShift
    );
  }
  if (dir === "CONTRACTING") {
    projectionAdjustment = clamp(
      projectionAdjustment,
      CALIBRATION_CAPS.maxContractingShift,
      0
    );
  }

  confidenceAdjustment = clamp(
    Math.round(confidenceAdjustment),
    -CALIBRATION_CAPS.maxConfidenceAdj,
    CALIBRATION_CAPS.maxConfidenceAdj
  );
  overRequiredEdgeAdjustment = clamp(
    round(overRequiredEdgeAdjustment, 2),
    CALIBRATION_CAPS.maxRequiredEdgeDown,
    CALIBRATION_CAPS.maxRequiredEdgeUp
  );
  underRequiredEdgeAdjustment = clamp(
    round(underRequiredEdgeAdjustment, 2),
    CALIBRATION_CAPS.maxRequiredEdgeDown,
    CALIBRATION_CAPS.maxRequiredEdgeUp
  );
  rankingAdjustment = clamp(
    Math.round(rankingAdjustment),
    -CALIBRATION_CAPS.maxRankingAdj,
    CALIBRATION_CAPS.maxRankingAdj
  );
  minutesTrustMultiplier = clamp(round(minutesTrustMultiplier, 3), 0.75, 1.15);
  recentWeightAdjustment = clamp(round(recentWeightAdjustment, 3), -0.12, 0.12);
  seasonWeightAdjustment = clamp(round(seasonWeightAdjustment, 3), -0.12, 0.12);

  return {
    version: PLAYER_PROFILE_CALIBRATION_VERSION,
    recentWeightAdjustment,
    seasonWeightAdjustment,
    minutesTrustMultiplier,
    expectedMinutesAdjustment: round(expectedMinutesAdjustment, 2),
    expectedFgaAdjustment: round(expectedFgaAdjustment, 2),
    expectedFtaAdjustment: round(expectedFtaAdjustment, 2),
    projectionAdjustment,
    projectionUncertaintyAdjustment: round(projectionUncertaintyAdjustment, 2),
    overRequiredEdgeAdjustment,
    underRequiredEdgeAdjustment,
    confidenceAdjustment,
    riskDebtIds: uniqueDebts,
    riskRepairIds: uniqueRepairs,
    rankingAdjustment,
    calibrationReasons: reasons.slice(0, 12),
    profileCalibrationApplied: true,
    // Safety flags — consumers must honor
    cannotForceSideFlip: true,
    cannotCreateTrack: true,
    cannotOverrideHardKill: true,
  };
}

/**
 * Apply calibration to a volume-first projection result (bounded).
 */
export function applyProfileCalibrationToProjection(
  baseProjection = {},
  calibration = {},
  options = {}
) {
  const before = num(baseProjection.projection, 0) ?? 0;
  const adj = num(calibration.projectionAdjustment, 0) ?? 0;
  const minutesTrust = num(calibration.minutesTrustMultiplier, 1) ?? 1;
  const minAdj = num(calibration.expectedMinutesAdjustment, 0) ?? 0;
  const fgaAdj = num(calibration.expectedFgaAdjustment, 0) ?? 0;
  const ftaAdj = num(calibration.expectedFtaAdjustment, 0) ?? 0;

  let expectedMinutes = num(baseProjection.expectedMinutes, 0) ?? 0;
  let expectedFGA = num(baseProjection.expectedFGA, 0) ?? 0;
  let expectedFTA = num(baseProjection.expectedFTA, 0) ?? 0;

  expectedMinutes = round((expectedMinutes + minAdj) * minutesTrust, 1);
  expectedFGA = round(expectedFGA + fgaAdj, 1);
  expectedFTA = round(expectedFTA + ftaAdj, 1);

  const afterRaw = before + adj;
  const after = round(
    clamp(
      afterRaw,
      before - CALIBRATION_CAPS.maxProjectionMovement,
      before + CALIBRATION_CAPS.maxProjectionMovement
    ),
    1
  );

  const confidenceBefore = num(options.confidenceBefore);
  const confidenceAfter =
    confidenceBefore === null
      ? null
      : clamp(
          Math.round(confidenceBefore + (calibration.confidenceAdjustment || 0)),
          30,
          95
        );

  return {
    ...baseProjection,
    projection: after,
    expectedMinutes,
    expectedFGA,
    expectedFTA,
    projectionBeforeProfileCalibration: before,
    projectionAfterProfileCalibration: after,
    profileProjectionDelta: round(after - before, 2),
    confidenceBeforeProfileCalibration: confidenceBefore,
    confidenceAfterProfileCalibration: confidenceAfter,
    profileCalibrationApplied: Boolean(calibration.profileCalibrationApplied),
    profileCalibrationReasons: calibration.calibrationReasons || [],
  };
}

/**
 * Soft reader evidence from profile — never an auto side vote alone.
 */
export function buildReaderProfileSignals(profile = {}, calibration = {}, side = "") {
  const supports = [];
  const disagrees = [];
  let scoreDelta = 0;
  const rawSide = String(side || "").toUpperCase();

  if (profile.scoringVolume === "LOW" && rawSide === "OVER") {
    scoreDelta -= 3;
    disagrees.push("Low scoring volume — Over needs volume proof");
  }
  if (profile.roleDirection === "EXPANDING" && rawSide === "OVER") {
    scoreDelta += 2;
    supports.push("Expanding role opportunity supports Over case");
  }
  if (profile.roleDirection === "EXPANDING" && rawSide === "UNDER") {
    scoreDelta -= 2;
    disagrees.push("Expanding role weakens Under case");
  }
  if (profile.roleDirection === "CONTRACTING" && rawSide === "UNDER") {
    scoreDelta += 2;
    supports.push("Contracting role supports Under case");
  }
  if (profile.roleDirection === "CONTRACTING" && rawSide === "OVER") {
    scoreDelta -= 2;
    disagrees.push("Contracting role conflicts with Over");
  }
  if (profile.roleStability === "UNSTABLE") {
    scoreDelta -= 2;
    disagrees.push("Unstable role profile raises evidence bar");
  }
  if (
    profile.roleStability === "STABLE" &&
    profile.scoringVolatility === "LOW" &&
    (profile.profileConfidence || 0) >= 50
  ) {
    scoreDelta += 1;
    supports.push("Stable low-volatility role profile");
  }

  return {
    scoreDelta: clamp(scoreDelta, -6, 4),
    supports,
    disagrees,
    isAutoSideVote: false,
  };
}

/**
 * Tracking-gate evidence requirement adjustments from profile.
 */
export function resolveProfileGateEdgeAdjustments(profile = {}, calibration = {}) {
  return {
    overRequiredEdgeAdjustment: num(calibration.overRequiredEdgeAdjustment, 0) ?? 0,
    underRequiredEdgeAdjustment: num(calibration.underRequiredEdgeAdjustment, 0) ?? 0,
    projectionUncertaintyAdjustment:
      num(calibration.projectionUncertaintyAdjustment, 0) ?? 0,
    riskDebtIds: calibration.riskDebtIds || [],
    riskRepairIds: calibration.riskRepairIds || [],
    suppressUnstableMinutesDebt: (calibration.riskDebtIds || []).includes(
      "UNSTABLE_ROLE"
    ),
  };
}

/**
 * Combine profile + calibration into audit payload for picks.
 */
export function buildPlayerRoleProfileAudit({
  profile,
  calibration,
  projectionBefore,
  projectionAfter,
  confidenceBefore = null,
  confidenceAfter = null,
  requiredEdgeBefore = null,
  requiredEdgeAfter = null,
} = {}) {
  return {
    playerRoleProfile: profile || null,
    playerProfileCalibration: calibration || null,
    projectionBeforeProfileCalibration: projectionBefore ?? null,
    projectionAfterProfileCalibration: projectionAfter ?? null,
    profileProjectionDelta:
      projectionBefore != null && projectionAfter != null
        ? round(projectionAfter - projectionBefore, 2)
        : null,
    confidenceBeforeProfileCalibration: confidenceBefore,
    confidenceAfterProfileCalibration: confidenceAfter,
    requiredEdgeBeforeProfileCalibration: requiredEdgeBefore,
    requiredEdgeAfterProfileCalibration: requiredEdgeAfter,
    profileDebtIds: calibration?.riskDebtIds || [],
    profileRepairIds: calibration?.riskRepairIds || [],
    profileCalibrationApplied: Boolean(calibration?.profileCalibrationApplied),
    profileCalibrationReasons: calibration?.calibrationReasons || [],
  };
}

export function profileConfidenceBucket(confidence = 0) {
  const c = num(confidence, 0) ?? 0;
  if (c >= 70) return "70+";
  if (c >= 50) return "50-69";
  if (c >= 35) return "35-49";
  return "<35";
}
