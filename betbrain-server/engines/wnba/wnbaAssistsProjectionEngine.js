/**
 * WNBA Assists projection — independent of Points/Rebounds formulas.
 *
 * Core: minutes × assist rate (± playmaking role ± teammate finishing).
 * Never fabricates potential assists — stamps playmakingOpportunitySource.
 * Missing inputs → projection null (never 0 → UNDER).
 * Actual 0 assist rate with real minutes is a real 0 projection, not missing.
 */
export const WNBA_ASSISTS_PROJECTION_BUILD =
  "courteedge-wnba-assists-projection-v1";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function blend(recent, season, w = 0.6) {
  const r = num(recent);
  const s = num(season);
  if (r != null && s != null) return r * w + s * (1 - w);
  if (r != null) return r;
  if (s != null) return s;
  return null;
}

function positive(v) {
  const n = num(v);
  return n != null && n > 0;
}

/**
 * @returns {{ projection, expectedMinutes, assistRate, playmakingOpportunitySource, components, build, invalid, invalidReason }}
 */
export function projectWnbaAssists(input = {}) {
  const seasonMinutes = num(input.seasonMinutes);
  const recentMinutes = num(input.recentMinutes);
  const explicitMinutes = num(input.expectedMinutes);
  const seasonAst = num(input.seasonAssists ?? input.seasonAPG);
  const recentAst = num(input.recentAssists ?? input.recentAPG);
  const potentialAssists = num(input.potentialAssists);
  const touches = num(input.touches);

  let expectedMinutes =
    explicitMinutes != null
      ? explicitMinutes
      : blend(recentMinutes, seasonMinutes, 0.6);
  const adj = num(input.expectedMinutesAdjustment, 0) || 0;
  if (expectedMinutes != null) {
    expectedMinutes = Number((expectedMinutes + adj).toFixed(1));
  }

  const hasMinutes =
    positive(expectedMinutes) ||
    positive(seasonMinutes) ||
    positive(recentMinutes);
  const hasStat =
    (seasonAst != null && positive(seasonMinutes)) ||
    (recentAst != null && positive(recentMinutes)) ||
    positive(seasonAst) ||
    positive(recentAst);

  const missingReturn = (reason) => ({
    build: WNBA_ASSISTS_PROJECTION_BUILD,
    propType: "ASSISTS",
    projection: null,
    expectedMinutes: expectedMinutes != null && expectedMinutes > 0 ? expectedMinutes : null,
    assistRate: null,
    playmakingOpportunitySource: "MISSING",
    invalid: true,
    invalidReason: reason,
    components: {
      seasonAst,
      recentAst,
      roleAdj: 0,
      finishingAdj: 0,
      envAdj: 0,
      potentialAssists,
    },
  });

  if (!hasMinutes || !hasStat) {
    return missingReturn("MISSING_PROJECTION_INPUTS");
  }

  const seasonRate =
    positive(seasonMinutes) && seasonAst != null ? seasonAst / seasonMinutes : null;
  const recentRate =
    positive(recentMinutes) && recentAst != null ? recentAst / recentMinutes : null;
  // Posted-line audit: season rate × expected minutes beat recency blend / creator hooks.
  let assistRate = seasonRate ?? recentRate ?? null;

  let playmakingOpportunitySource = "MISSING";
  if (potentialAssists != null || touches != null) {
    playmakingOpportunitySource = "DIRECT";
  } else if (assistRate != null) {
    playmakingOpportunitySource = "DERIVED_PROXY";
  }

  // Creator heuristics (seasonAst>=5 → +6%) raised MAE and collapsed holdout hit rate.
  let roleAdj = 0;
  if (input.ballHandlingUnstable === true) roleAdj -= 0.05;
  if (assistRate != null && roleAdj !== 0) {
    assistRate = Math.max(0, assistRate * (1 + roleAdj));
  }

  let finishingAdj = 0;
  const teammateFg = num(input.teammateFgPct);
  if (teammateFg != null && teammateFg >= 0.46) finishingAdj += 0.04;
  if (teammateFg != null && teammateFg <= 0.4) finishingAdj -= 0.04;
  if (input.highVolumeScorerOut === true) finishingAdj -= 0.05;
  if (input.highVolumeScorerReturning === true) finishingAdj += 0.03;
  if (assistRate != null) {
    assistRate = Math.max(
      0,
      assistRate * (1 + clamp(finishingAdj, -0.1, 0.08))
    );
  }

  let envAdj = 0;
  const pace = num(input.pace);
  if (pace != null && pace > 100) envAdj += 0.02;
  if (pace != null && pace < 94) envAdj -= 0.02;
  if (assistRate != null) {
    assistRate = Math.max(0, assistRate * (1 + clamp(envAdj, -0.05, 0.05)));
  }

  let projection = null;
  if (assistRate != null && positive(expectedMinutes)) {
    projection = expectedMinutes * assistRate;
  } else {
    projection = blend(recentAst, seasonAst, 0.6);
  }

  if (potentialAssists != null && potentialAssists > 0 && projection != null) {
    projection = projection * 0.7 + potentialAssists * 0.3;
  }

  if (projection == null) {
    return missingReturn("MISSING_PROJECTION_INPUTS");
  }

  projection = Number(Math.max(0, projection).toFixed(1));

  return {
    build: WNBA_ASSISTS_PROJECTION_BUILD,
    propType: "ASSISTS",
    projection,
    expectedMinutes: expectedMinutes != null ? expectedMinutes : null,
    assistRate: assistRate == null ? null : Number(assistRate.toFixed(4)),
    playmakingOpportunitySource,
    invalid: false,
    invalidReason: null,
    components: {
      seasonAst,
      recentAst,
      roleAdj,
      finishingAdj,
      envAdj,
      potentialAssists,
    },
  };
}
