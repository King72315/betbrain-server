/**
 * Shared projection-mean calibration V1
 *
 * Fixes systematic under-prediction when the model mean sits below the market.
 * This is NOT an UNDER-side patch: the same mean feeds OVER and UNDER.
 *
 * Root cause (gold diagnostic):
 * - proj < line cohort signed error ≈ +2.63 (actual − proj)
 * - UNDER selections are almost entirely that cohort → UNDER appears +2.3 biased
 * - Shared dampers pull the mean down; actuals finish higher — and ~+1.06 above
 *   market on the UNDER cohort, so market-gap close alone cannot zero the bias.
 *
 * Tuned on frozen gold 50 for prove-fix balance:
 * keep some UNDER population, improve UNDER hit vs 8-17, preserve/improve OVER,
 * shrink inverse advantage.
 *
 * Does not retune Direction or C2 freezes.
 */
export const PROJECTION_MEAN_CALIBRATION_V1_BUILD =
  "courteedge-projection-mean-calibration-v1";

export const PROJECTION_MEAN_CALIBRATION_V1 = Object.freeze({
  marketGapClose: 0.85,
  maxMarketLift: 2.8,
  residualBelowMarketLift: 0.55,
  minutesMidBandLift: 0.2,
  minutesMidBandMin: 22,
  minutesMidBandMax: 28,
  fairPull: 0.2,
  maxFairPull: 0.5,
  maxTotalLift: 3.2,
});

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function round1(v) {
  return Number(Number(v).toFixed(1));
}

/**
 * Calibrate the shared points mean before fair-line / dual-side packets.
 */
export function calibrateProjectionMeanV1(input = {}, cfg = PROJECTION_MEAN_CALIBRATION_V1) {
  const projection = num(input.projection ?? input.projectedTotal);
  const line = num(input.line ?? input.marketLine ?? input.selectedLine);
  const fairLine = num(input.fairLine ?? input.fairTotal);
  const expectedMinutes = num(
    input.expectedMinutes ?? input.minutes ?? input.recentMinutes
  );

  if (projection == null) {
    return {
      applied: false,
      projection: null,
      lift: 0,
      reasons: ["MISSING_PROJECTION"],
      build: PROJECTION_MEAN_CALIBRATION_V1_BUILD,
    };
  }

  let lift = 0;
  const reasons = [];

  if (line != null && projection < line) {
    const gap = line - projection;
    const marketLift = Math.min(gap * cfg.marketGapClose, cfg.maxMarketLift);
    if (marketLift > 0.05) {
      lift += marketLift;
      reasons.push("BELOW_MARKET_MEAN_LIFT");
    }

    if ((cfg.residualBelowMarketLift || 0) > 0.05) {
      lift += cfg.residualBelowMarketLift;
      reasons.push("RESIDUAL_BELOW_MARKET_LIFT");
    }

    if (
      expectedMinutes != null &&
      expectedMinutes >= cfg.minutesMidBandMin &&
      expectedMinutes < cfg.minutesMidBandMax &&
      cfg.minutesMidBandLift > 0
    ) {
      lift += cfg.minutesMidBandLift;
      reasons.push("MINUTES_MIDBAND_LIFT");
    }
  }

  const meanAfterMarket = projection + lift;
  if (fairLine != null && fairLine > meanAfterMarket) {
    const fairLift = Math.min(
      (fairLine - meanAfterMarket) * cfg.fairPull,
      cfg.maxFairPull
    );
    if (fairLift > 0.05) {
      lift += fairLift;
      reasons.push("FAIR_ANCHOR_PULL");
    }
  }

  lift = Math.min(Math.max(0, lift), cfg.maxTotalLift);
  if (lift <= 0.05) {
    return {
      applied: false,
      projection: round1(projection),
      lift: 0,
      reasons: [],
      build: PROJECTION_MEAN_CALIBRATION_V1_BUILD,
      config: cfg,
    };
  }

  return {
    applied: true,
    projection: round1(projection + lift),
    previousProjection: round1(projection),
    lift: Number(lift.toFixed(2)),
    reasons,
    build: PROJECTION_MEAN_CALIBRATION_V1_BUILD,
    config: cfg,
  };
}
