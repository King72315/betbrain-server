/**
 * CourtEdge Player Intelligence Engine v1
 * Mathematical profiles from game logs — no manual classification.
 *
 * Outputs (auto-computed):
 *  roleStabilityScore, usageProfile, scoringProfile, opportunityTrend,
 *  availabilityProfile, volatilityIndex, profileConfidence (adaptive).
 */

export const PLAYER_INTELLIGENCE_VERSION = "player-intelligence-v1";
export const PLAYER_INTELLIGENCE_BUILD_TAG = "courteedge-player-intel-v1";

export const ROLE_STABILITY = Object.freeze([
  "VERY_STABLE",
  "STABLE",
  "MODERATE",
  "VOLATILE",
  "VERY_VOLATILE",
]);
export const USAGE_PROFILE = Object.freeze([
  "LOCKED",
  "STABLE",
  "VARIABLE",
  "ERRATIC",
]);
export const SCORING_PROFILE = Object.freeze([
  "CONSISTENT",
  "MODERATE",
  "VOLATILE",
]);
export const OPPORTUNITY_TREND = Object.freeze(["RISING", "FLAT", "DECLINING"]);
export const AVAILABILITY_PROFILE = Object.freeze([
  "NORMAL",
  "LIMITED",
  "RETURNING",
  "UNKNOWN",
]);

const MAX_RECENT = 10;
const MINUTE_FLOOR_FACTOR = 0.85;

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

function median(values = []) {
  const nums = values
    .map((v) => num(v))
    .filter((v) => v !== null)
    .sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function cv(sd, avg) {
  if (sd === null || avg === null || Math.abs(avg) < 1e-6) return null;
  return Math.abs(sd / avg);
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

export function resolveIntelligenceGameSample({
  last5 = [],
  seasonGames = [],
  maxGames = MAX_RECENT,
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

function countMajorMinuteSwings(minutesList = [], threshold = 10) {
  if (minutesList.length < 2) return 0;
  let swings = 0;
  for (let i = 1; i < minutesList.length; i += 1) {
    if (Math.abs(minutesList[i] - minutesList[i - 1]) >= threshold) swings += 1;
  }
  return swings;
}

function floorHitRate(minutesList = [], floor = null) {
  if (!minutesList.length || floor === null || floor <= 0) return null;
  const target = Math.max(floor * MINUTE_FLOOR_FACTOR, floor - 4);
  return minutesList.filter((m) => m >= target).length / minutesList.length;
}

/**
 * Adaptive Profile Confidence:
 * - high sample → stable/reliable
 * - low sample (rookies) → low confidence → engines adapt faster
 * - grows as games accumulate
 */
export function computeAdaptiveProfileConfidence({
  sampleSize = 0,
  seasonGamesPlayed = 0,
  hasSeasonAverages = false,
  hasRecent = false,
  missingFields = [],
  priorGamesPlayed = null,
  priorConfidence = null,
} = {}) {
  const games = Math.max(sampleSize, seasonGamesPlayed, 0);
  let score = 18;

  // Primary: sample accumulation curve
  if (games >= 25) score += 48;
  else if (games >= 18) score += 42;
  else if (games >= 12) score += 36;
  else if (games >= 8) score += 28;
  else if (games >= 5) score += 20;
  else if (games >= 3) score += 12;
  else if (games >= 1) score += 5;

  if (hasSeasonAverages) score += 12;
  if (hasRecent) score += 8;
  score -= (missingFields?.length || 0) * 5;

  // Adaptive memory: once a player has accumulated games, confidence floors rise
  if (priorGamesPlayed != null && priorConfidence != null) {
    const priorG = num(priorGamesPlayed, 0) ?? 0;
    const priorC = num(priorConfidence, 0) ?? 0;
    if (priorG >= 8 && games >= priorG) {
      // Profile becomes more stable — do not regress hard without new evidence
      score = Math.max(score, Math.round(priorC * 0.85));
    } else if (games < 5 && priorG < 5) {
      // Rookie / low sample — keep low confidence so systems adapt faster
      score = Math.min(score, 45);
    }
  }

  if (games < 5) score = Math.min(score, 48);
  return clamp(Math.round(score), 0, 100);
}

export function classifyRoleStabilityScore({
  avgMinutes,
  minutesSd,
  minMinutes,
  maxMinutes,
  floorHit,
  recentVsSeasonMinutes,
  majorSwingFreq,
  sampleSize,
  profileConfidence,
} = {}) {
  if (sampleSize < 3 || (profileConfidence ?? 0) < 30) return "VERY_VOLATILE";

  const cvMin = cv(minutesSd, avgMinutes);
  const range =
    maxMinutes != null && minMinutes != null ? maxMinutes - minMinutes : null;
  let score = 50; // higher = more stable

  if (cvMin != null) {
    if (cvMin <= 0.08) score += 25;
    else if (cvMin <= 0.12) score += 18;
    else if (cvMin <= 0.18) score += 8;
    else if (cvMin <= 0.25) score -= 5;
    else if (cvMin <= 0.35) score -= 18;
    else score -= 30;
  }
  if (floorHit != null) {
    if (floorHit >= 0.9) score += 15;
    else if (floorHit >= 0.8) score += 10;
    else if (floorHit >= 0.6) score += 0;
    else if (floorHit >= 0.4) score -= 12;
    else score -= 22;
  }
  if (range != null) {
    if (range <= 6) score += 10;
    else if (range <= 10) score += 4;
    else if (range <= 16) score -= 6;
    else score -= 16;
  }
  if ((majorSwingFreq ?? 0) <= 0.1) score += 8;
  else if ((majorSwingFreq ?? 0) >= 0.4) score -= 14;
  else if ((majorSwingFreq ?? 0) >= 0.25) score -= 6;

  const recentDelta = Math.abs(num(recentVsSeasonMinutes, 0) ?? 0);
  if (recentDelta >= 8) score -= 10;
  else if (recentDelta >= 5) score -= 5;

  if (score >= 85) return "VERY_STABLE";
  if (score >= 68) return "STABLE";
  if (score >= 48) return "MODERATE";
  if (score >= 30) return "VOLATILE";
  return "VERY_VOLATILE";
}

export function classifyUsageProfile({
  fgaCv,
  ftaSd,
  fgaSd,
  usageTrend,
  sampleSize,
} = {}) {
  if (sampleSize < 3) return "ERRATIC";
  let score = 50;
  if (fgaCv != null) {
    if (fgaCv <= 0.14) score += 28;
    else if (fgaCv <= 0.22) score += 14;
    else if (fgaCv <= 0.32) score -= 4;
    else if (fgaCv <= 0.45) score -= 18;
    else score -= 30;
  }
  if (ftaSd != null) {
    if (ftaSd <= 1.2) score += 6;
    else if (ftaSd >= 3.5) score -= 10;
  }
  if (fgaSd != null) {
    if (fgaSd <= 2) score += 6;
    else if (fgaSd >= 5) score -= 10;
  }
  const trendAbs = Math.abs(num(usageTrend, 0) ?? 0);
  if (trendAbs >= 0.08) score -= 8;

  if (score >= 78) return "LOCKED";
  if (score >= 58) return "STABLE";
  if (score >= 38) return "VARIABLE";
  return "ERRATIC";
}

export function classifyScoringProfile({
  pointsSd,
  pointsMedian,
  pointsMean,
  freqAboveLine,
  freqBelowLine,
  games20Plus,
  gamesSingleDigit,
  sampleSize,
  line = null,
} = {}) {
  if (sampleSize < 3) return "VOLATILE";
  const meanPts = pointsMean ?? pointsMedian ?? 0;
  let score = 50;

  if (pointsSd != null) {
    if (meanPts >= 12) {
      if (pointsSd <= 3.5) score += 25;
      else if (pointsSd <= 5.5) score += 12;
      else if (pointsSd <= 8) score -= 4;
      else score -= 20;
    } else if (meanPts >= 7) {
      if (pointsSd <= 3) score += 20;
      else if (pointsSd <= 5) score += 8;
      else if (pointsSd <= 7) score -= 6;
      else score -= 18;
    } else {
      if (pointsSd <= 2.5) score += 15;
      else if (pointsSd >= 5) score -= 16;
    }
  }

  const singleDigitRate =
    sampleSize > 0 ? (gamesSingleDigit || 0) / sampleSize : 0;
  const twentyPlusRate = sampleSize > 0 ? (games20Plus || 0) / sampleSize : 0;
  if (singleDigitRate >= 0.35 && meanPts >= 12) score -= 12;
  if (twentyPlusRate >= 0.35 && meanPts <= 14) score -= 8;

  if (line != null && freqAboveLine != null && freqBelowLine != null) {
    const imbalance = Math.abs(freqAboveLine - freqBelowLine);
    if (imbalance <= 0.25) score += 6;
  }

  if (score >= 68) return "CONSISTENT";
  if (score >= 42) return "MODERATE";
  return "VOLATILE";
}

export function classifyOpportunityTrend({
  recentMinutes,
  seasonMinutes,
  recentFga,
  seasonFga,
  recentFta,
  seasonFta,
  recentUsage,
  seasonUsage,
} = {}) {
  let up = 0;
  let down = 0;
  const minD = (recentMinutes ?? 0) - (seasonMinutes ?? 0);
  const fgaD = (recentFga ?? 0) - (seasonFga ?? 0);
  const ftaD = (recentFta ?? 0) - (seasonFta ?? 0);
  const useD =
    recentUsage != null && seasonUsage != null
      ? recentUsage - seasonUsage
      : null;

  if (minD >= 2.5) up += 1;
  if (minD <= -2.5) down += 1;
  if (fgaD >= 1.5) up += 1;
  if (fgaD <= -1.5) down += 1;
  if (ftaD >= 1.0) up += 1;
  if (ftaD <= -1.0) down += 1;
  if (useD != null && useD >= 0.04) up += 1;
  if (useD != null && useD <= -0.04) down += 1;

  if (up >= 2 && down === 0) return "RISING";
  if (down >= 2 && up === 0) return "DECLINING";
  return "FLAT";
}

export function classifyAvailabilityProfile({
  gamesMissed = null,
  recentInjury = false,
  minuteRestriction = false,
  returningFromInjury = false,
  availabilityStatus = null,
} = {}) {
  const status = String(availabilityStatus || "").toUpperCase();
  if (returningFromInjury || status.includes("RETURN")) return "RETURNING";
  if (
    minuteRestriction ||
    status.includes("LIMIT") ||
    status.includes("QUESTION") ||
    (num(gamesMissed, 0) ?? 0) >= 3
  ) {
    return "LIMITED";
  }
  if (recentInjury && (num(gamesMissed, 0) ?? 0) >= 1) return "LIMITED";
  if (
    status &&
    status !== "OK" &&
    status !== "CLEAR" &&
    status !== "NORMAL" &&
    status !== "UNKNOWN" &&
    status !== "ACTIVE"
  ) {
    if (status.includes("OUT") || status.includes("INJUR")) return "LIMITED";
  }
  if (!status || status === "UNKNOWN") {
    if (gamesMissed == null && !recentInjury) return "UNKNOWN";
  }
  return "NORMAL";
}

export function computeVolatilityIndex({
  roleStabilityScore,
  usageProfile,
  scoringProfile,
  availabilityProfile,
} = {}) {
  const roleMap = {
    VERY_STABLE: 12,
    STABLE: 28,
    MODERATE: 50,
    VOLATILE: 72,
    VERY_VOLATILE: 90,
  };
  const usageMap = { LOCKED: 12, STABLE: 30, VARIABLE: 58, ERRATIC: 85 };
  const scoringMap = { CONSISTENT: 18, MODERATE: 48, VOLATILE: 80 };
  const availMap = { NORMAL: 15, UNKNOWN: 40, LIMITED: 65, RETURNING: 75 };

  const raw =
    (roleMap[roleStabilityScore] ?? 50) * 0.35 +
    (usageMap[usageProfile] ?? 50) * 0.25 +
    (scoringMap[scoringProfile] ?? 50) * 0.25 +
    (availMap[availabilityProfile] ?? 40) * 0.15;

  return clamp(Math.round(raw), 0, 100);
}

/** Legacy bridge for existing Role Profile consumers */
export function mapToLegacyRoleFields(intel = {}) {
  return mapIntelligenceToLegacyRoleFields(intel);
}

/** Legacy bridge for existing Role Profile consumers */
export function mapIntelligenceToLegacyRoleFields(intel = {}) {
  const rs = intel.roleStabilityScore;
  let roleStability = "MODERATE";
  if (rs === "VERY_STABLE" || rs === "STABLE") roleStability = "STABLE";
  else if (rs === "VOLATILE" || rs === "VERY_VOLATILE") roleStability = "UNSTABLE";

  const usage = intel.usageProfile;
  let shotVolumeStability = "MODERATE";
  if (usage === "LOCKED" || usage === "STABLE") shotVolumeStability = "STABLE";
  else if (usage === "ERRATIC") shotVolumeStability = "UNSTABLE";

  const scoring = intel.scoringProfile;
  let scoringVolatility = "MEDIUM";
  if (scoring === "CONSISTENT") scoringVolatility = "LOW";
  else if (scoring === "VOLATILE") scoringVolatility = "HIGH";

  const trend = intel.opportunityTrend;
  let roleDirection = "STABLE";
  if (trend === "RISING") roleDirection = "EXPANDING";
  else if (trend === "DECLINING") roleDirection = "CONTRACTING";

  return { roleStability, shotVolumeStability, scoringVolatility, roleDirection };
}

/**
 * Build full mathematical Player Intelligence profile.
 */
export function snapshotPlayerProfileForLab(profile = {}, meta = {}) {
  return {
    version: profile.version || PLAYER_INTELLIGENCE_VERSION,
    playerId: meta.playerId || profile.playerId || null,
    player: meta.player || profile.player || null,
    season: meta.season || profile.season || "current",
    snapshotAt: meta.snapshotAt || new Date().toISOString(),
    roleStabilityScore: profile.roleStabilityScore || null,
    usageProfile: profile.usageProfile || null,
    scoringProfile: profile.scoringProfile || null,
    opportunityTrend: profile.opportunityTrend || null,
    availabilityProfile: profile.availabilityProfile || null,
    volatilityIndex: profile.volatilityIndex ?? null,
    profileConfidence: profile.profileConfidence ?? null,
    adaptationRate: profile.adaptationRate ?? null,
    roleStability: profile.roleStability || null,
    shotVolumeStability: profile.shotVolumeStability || null,
    scoringVolatility: profile.scoringVolatility || null,
    roleDirection: profile.roleDirection || null,
    profileSampleSize: profile.profileSampleSize ?? null,
    gamesPlayed: profile.gamesPlayed ?? null,
  };
}

export function buildPlayerIntelligenceProfile({
  playerId = null,
  season = null,
  last5 = [],
  seasonGames = [],
  seasonMinutes = null,
  seasonFga = null,
  seasonFta = null,
  seasonPoints = null,
  bookCount = null,
  line = null,
  availabilityContext = {},
  priorProfile = null,
  priorStore = null,
  gamesPlayed = null,
} = {}) {
  const prior = priorProfile || priorStore || null;
  const games = resolveIntelligenceGameSample({ last5, seasonGames });
  const sampleSize = games.length;
  const missingFields = [];

  const minutesList = games.map((g) => g.minutes);
  const fgaList = games.map((g) => g.fga);
  const ftaList = games.map((g) => g.fta);
  const pointsList = games.map((g) => g.points);

  const recentMinutes = round(mean(minutesList), 1);
  const recentFga = round(mean(fgaList), 1);
  const recentFta = round(mean(ftaList), 1);
  const recentPoints = round(mean(pointsList), 1);

  const seasonMinutesAvg =
    round(num(seasonMinutes), 1) ??
    (seasonGames?.length
      ? round(mean(seasonGames.map((g) => normalizeGame(g).minutes)), 1)
      : null);
  const seasonFgaAvg =
    round(num(seasonFga), 1) ??
    (seasonGames?.length
      ? round(mean(seasonGames.map((g) => normalizeGame(g).fga)), 1)
      : null);
  const seasonFtaAvg =
    round(num(seasonFta), 1) ??
    (seasonGames?.length
      ? round(mean(seasonGames.map((g) => normalizeGame(g).fta)), 1)
      : null);
  const seasonPointsAvg =
    round(num(seasonPoints), 1) ??
    (seasonGames?.length
      ? round(mean(seasonGames.map((g) => normalizeGame(g).points)), 1)
      : null);

  if (seasonMinutesAvg === null) missingFields.push("seasonMinutes");
  if (seasonFgaAvg === null) missingFields.push("seasonFga");
  if (sampleSize === 0) missingFields.push("recentGames");

  const minutesSd = round(stdDev(minutesList), 2);
  const fgaSd = round(stdDev(fgaList), 2);
  const ftaSd = round(stdDev(ftaList), 2);
  const pointsSd = round(stdDev(pointsList), 2);
  const pointsMed = round(median(pointsList), 1);

  const minutesCv = round(cv(minutesSd, recentMinutes), 3);
  const fgaCv = round(cv(fgaSd, recentFga), 3);

  const minMinutes = minutesList.length ? Math.min(...minutesList) : null;
  const maxMinutes = minutesList.length ? Math.max(...minutesList) : null;
  const floorBase = seasonMinutesAvg ?? recentMinutes ?? 20;
  const floorHit = round(floorHitRate(minutesList, floorBase), 3);
  const majorSwings = countMajorMinuteSwings(minutesList);
  const majorSwingFreq = round(
    sampleSize > 1 ? majorSwings / (sampleSize - 1) : 0,
    3
  );

  const recentUsage =
    recentMinutes > 0 ? round((recentFga ?? 0) / recentMinutes, 4) : null;
  const seasonUsage =
    seasonMinutesAvg > 0
      ? round((seasonFgaAvg ?? 0) / seasonMinutesAvg, 4)
      : null;
  const usageTrend =
    recentUsage != null && seasonUsage != null
      ? round(recentUsage - seasonUsage, 4)
      : null;

  const seasonGamesPlayed =
    num(gamesPlayed) ??
    (Array.isArray(seasonGames) ? seasonGames.length : sampleSize);

  const profileConfidence = computeAdaptiveProfileConfidence({
    sampleSize,
    seasonGamesPlayed,
    hasSeasonAverages: seasonMinutesAvg != null && seasonFgaAvg != null,
    hasRecent: sampleSize >= 3,
    missingFields,
    priorGamesPlayed: prior?.gamesPlayed ?? prior?.profileSampleSize ?? prior?.gradedSampleSize,
    priorConfidence: prior?.profileConfidence,
  });

  // Soft boost when more books confirm market — does not dominate sample curve
  let conf = profileConfidence;
  if (num(bookCount, 0) >= 3) conf = clamp(conf + 4, 0, 100);
  else if (num(bookCount, 0) >= 1) conf = clamp(conf + 1, 0, 100);

  const roleStabilityScore = classifyRoleStabilityScore({
    avgMinutes: recentMinutes,
    minutesSd,
    minMinutes,
    maxMinutes,
    floorHit,
    recentVsSeasonMinutes:
      recentMinutes != null && seasonMinutesAvg != null
        ? recentMinutes - seasonMinutesAvg
        : 0,
    majorSwingFreq,
    sampleSize,
    profileConfidence: conf,
  });

  const usageProfile = classifyUsageProfile({
    fgaCv,
    ftaSd,
    fgaSd,
    usageTrend,
    sampleSize,
  });

  const lineNum = num(line);
  const games20Plus = pointsList.filter((p) => p >= 20).length;
  const gamesSingleDigit = pointsList.filter((p) => p < 10).length;
  const freqAboveLine =
    lineNum != null && pointsList.length
      ? pointsList.filter((p) => p > lineNum).length / pointsList.length
      : null;
  const freqBelowLine =
    lineNum != null && pointsList.length
      ? pointsList.filter((p) => p < lineNum).length / pointsList.length
      : null;

  const scoringProfile = classifyScoringProfile({
    pointsSd,
    pointsMedian: pointsMed,
    pointsMean: recentPoints,
    freqAboveLine,
    freqBelowLine,
    games20Plus,
    gamesSingleDigit,
    sampleSize,
    line: lineNum,
  });

  const opportunityTrend = classifyOpportunityTrend({
    recentMinutes,
    seasonMinutes: seasonMinutesAvg,
    recentFga,
    seasonFga: seasonFgaAvg,
    recentFta,
    seasonFta: seasonFtaAvg,
    recentUsage,
    seasonUsage,
  });

  const availabilityProfile = classifyAvailabilityProfile({
    gamesMissed: availabilityContext.gamesMissed,
    recentInjury: Boolean(availabilityContext.recentInjury),
    minuteRestriction: Boolean(availabilityContext.minuteRestriction),
    returningFromInjury: Boolean(availabilityContext.returningFromInjury),
    availabilityStatus:
      availabilityContext.availabilityStatus ||
      availabilityContext.status ||
      availabilityContext.level,
  });

  const volatilityIndex = computeVolatilityIndex({
    roleStabilityScore,
    usageProfile,
    scoringProfile,
    availabilityProfile,
  });

  const legacy = mapIntelligenceToLegacyRoleFields({
    roleStabilityScore,
    usageProfile,
    scoringProfile,
    opportunityTrend,
  });

  const adaptationRate = round(
    clamp(1.35 - conf / 100, 0.35, 1.25),
    3
  );

  return {
    version: PLAYER_INTELLIGENCE_VERSION,
    playerId: playerId != null ? String(playerId) : null,
    season: season || null,
    roleStabilityScore,
    usageProfile,
    scoringProfile,
    opportunityTrend,
    availabilityProfile,
    volatilityIndex,
    profileConfidence: conf,
    adaptationRate,
    // metrics
    recentMinutesAverage: recentMinutes,
    seasonMinutesAverage: seasonMinutesAvg,
    minutesStandardDeviation: minutesSd,
    minutesCoefficientOfVariation: minutesCv,
    minutesMin: minMinutes,
    minutesMax: maxMinutes,
    minutesFloorHitRate: floorHit,
    majorMinuteSwingFrequency: majorSwingFreq,
    majorBreakCount: majorSwings,
    recentFgaAverage: recentFga,
    seasonFgaAverage: seasonFgaAvg,
    fgaStandardDeviation: fgaSd,
    fgaCoefficientOfVariation: fgaCv,
    recentFtaAverage: recentFta,
    seasonFtaAverage: seasonFtaAvg,
    ftaStandardDeviation: ftaSd,
    recentPointsAverage: recentPoints,
    seasonPointsAverage: seasonPointsAvg,
    pointsStandardDeviation: pointsSd,
    pointsMedian: pointsMed,
    games20Plus,
    gamesSingleDigit,
    freqAboveLine: round(freqAboveLine, 3),
    freqBelowLine: round(freqBelowLine, 3),
    usageTrend,
    recentUsage,
    seasonUsage,
    gamesPlayed: seasonGamesPlayed,
    profileSampleSize: sampleSize,
    missingProfileFields: missingFields,
    fallbackUsed: sampleSize < 5 || missingFields.includes("recentGames"),
    // legacy bridge (Role Profile v1 consumers)
    ...legacy,
    computedAt: new Date().toISOString(),
  };
}
