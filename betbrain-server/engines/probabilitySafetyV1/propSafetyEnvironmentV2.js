/**
 * propSafetyEnvironmentV2
 *
 * Safety = how stable / dependable the evidence environment is.
 * Safety ≠ how strongly the model believes the selected side.
 *
 * Explicitly excludes:
 *   - raw / calibrated win probability
 *   - edge magnitude
 *   - Trust / Reliability (downstream consumers of Safety)
 *   - tight distribution width as a large positive (model certainty ≠ environment)
 *
 * Autopsy (gold 50): minutes/role KEEP; market/book soft-reduce (cohort-inverted);
 * distributionResilience & low-conflict reward were loser-higher → cut heavily.
 */
export const SAFETY_ENVIRONMENT_V2_BUILD =
  "courteedge-safety-environment-v2";
export const SAFETY_ENVIRONMENT_V2_VERSION = "prop-safety-environment-v2";

/**
 * Weights sum to 1.0 — environment only.
 * Biased toward minutes/role/availability (true context), not sim certainty.
 */
export const SAFETY_ENVIRONMENT_WEIGHTS_V2 = Object.freeze({
  minutesStability: 0.32,
  roleStability: 0.26,
  availabilityCertainty: 0.18,
  marketQuality: 0.08,
  bookDepth: 0.06,
  // Small only — narrow MC width is belief-adjacent overconfidence
  distributionResilience: 0.05,
  // Small only — low conflict often = unanimous wrong lean
  gameEnvironmentStability: 0.05,
});

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function bookDepthScore(bookCount) {
  const n = num(bookCount);
  if (n == null) return null;
  if (n <= 0) return 20;
  if (n === 1) return 35;
  if (n === 2) return 55;
  if (n === 3) return 72;
  if (n === 4) return 88;
  return 100;
}

/**
 * Build environment Safety score (0–100).
 * Does not accept rawWinProbability on purpose.
 */
export function buildPropSafetyEnvironmentV2(ctx = {}) {
  const {
    minutes = {},
    role = {},
    distribution = {},
    market = {},
    conflict = {},
    failure = {},
    availability = {},
  } = ctx;

  const w = SAFETY_ENVIRONMENT_WEIGHTS_V2;

  const minutesRaw = num(minutes.minutesStabilityScore);
  const roleRaw = num(role.roleStabilityScore);
  const width = num(distribution.distributionWidth);
  // Only mild credit for non-extreme width; very tight width gets no bonus
  let distRaw = null;
  if (width != null) {
    // Prefer moderate width (environment noise acknowledged) over razor-thin certainty
    if (width < 4) distRaw = 45; // suspiciously tight
    else if (width < 8) distRaw = 62;
    else if (width < 14) distRaw = 78;
    else if (width < 22) distRaw = 70;
    else distRaw = 55; // very wide = fragile
  }
  const marketRaw = num(market.marketQualityScore);
  const booksRaw = bookDepthScore(market.bookCount);
  const availRaw = num(availability.availabilityCertaintyScore);
  const conflictIdx = num(conflict.conflictIndex);
  // Do not reward conflict=0 heavily; map so mid conflict isn't "perfect"
  let envRaw = null;
  if (conflictIdx != null) {
    if (conflictIdx <= 5) envRaw = 72; // clean but not max
    else if (conflictIdx <= 20) envRaw = 78;
    else if (conflictIdx <= 35) envRaw = 58;
    else if (conflictIdx <= 50) envRaw = 40;
    else envRaw = 22;
  }

  const parts = [];
  const push = (key, raw) => {
    if (raw == null) return;
    parts.push({ key, raw: clamp(raw, 0, 100), weight: w[key] });
  };
  push("minutesStability", minutesRaw);
  push("roleStability", roleRaw);
  push("distributionResilience", distRaw);
  push("marketQuality", marketRaw);
  push("bookDepth", booksRaw);
  push("availabilityCertainty", availRaw);
  push("gameEnvironmentStability", envRaw);

  const weightSum = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const components = {};
  let rawSafetyScore = 0;
  for (const p of parts) {
    const contrib = (p.raw * p.weight) / weightSum;
    components[p.key] = Number(contrib.toFixed(3));
    rawSafetyScore += contrib;
  }
  components.winProbabilityStrength = 0;
  components.edgeStrength = 0;
  components.independentEvidenceAgreement = 0;

  const penalties = [];
  let penaltyTotal = 0;
  const addPen = (id, pts) => {
    const p = Math.max(0, pts);
    penalties.push({ id, pts: p });
    penaltyTotal += p;
  };

  if (conflictIdx != null && conflictIdx > 25) {
    addPen("CONFLICT_INDEX", Math.min(20, (conflictIdx - 25) * 0.5));
  }
  const majorFails = num(failure.majorFailurePathCount, 0);
  // Soft penalty — autopsy showed higher fail counts among winners on tiny n
  if (majorFails >= 2) {
    addPen("MAJOR_FAILURE_PATHS", Math.min(16, (majorFails - 1) * 6));
  }
  if (minutesRaw != null && minutesRaw < 50) {
    addPen("SEVERE_VOLATILITY", 14);
  }
  if (conflict.projectionFairAgreement === false) {
    addPen("PROJ_FAIR_DISAGREE", 10);
  }
  if (role.ROLE_ENVIRONMENT_CHANGED) {
    addPen("ROLE_CHANGE", 12);
  }
  if (availRaw != null && availRaw < 60) {
    addPen("AVAILABILITY", 12);
  }
  if (booksRaw != null && booksRaw <= 35) {
    addPen("THIN_BOOK_DEPTH", 5);
  }

  const finalSafetyScore = clamp(
    Math.round(rawSafetyScore - penaltyTotal),
    0,
    100
  );

  return {
    version: SAFETY_ENVIRONMENT_V2_VERSION,
    build: SAFETY_ENVIRONMENT_V2_BUILD,
    safetyMeans: "evidence_environment_stability",
    safetyDoesNotMean: "model_belief_strength",
    safetyComponents: components,
    safetyComponentRaws: {
      minutesStability: minutesRaw,
      roleStability: roleRaw,
      distributionResilience: distRaw,
      marketQuality: marketRaw,
      bookDepth: booksRaw,
      availabilityCertainty: availRaw,
      gameEnvironmentStability: envRaw,
      conflictIndex: conflictIdx,
      majorFailurePathCount: majorFails,
      distributionWidth: width,
    },
    safetyBonuses: [],
    safetyPenalties: penalties,
    rawSafetyScore: Number(rawSafetyScore.toFixed(2)),
    finalSafetyScore,
    weights: w,
  };
}
