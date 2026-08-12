/**
 * WNBA Assists projection — independent of Points/Rebounds formulas.
 *
 * Core: minutes × assist rate (± playmaking role ± teammate finishing).
 * Never fabricates potential assists — stamps playmakingOpportunitySource.
 */
export const WNBA_ASSISTS_PROJECTION_BUILD =
  "courteedge-wnba-assists-projection-v1";

function num(v, fb = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function blend(recent = 0, season = 0, w = 0.6) {
  if (recent > 0 && season > 0) return recent * w + season * (1 - w);
  if (recent > 0) return recent;
  if (season > 0) return season;
  return 0;
}

/**
 * @returns {{ projection, expectedMinutes, assistRate, playmakingOpportunitySource, components, build }}
 */
export function projectWnbaAssists(input = {}) {
  const seasonMinutes = num(input.seasonMinutes);
  const recentMinutes = num(input.recentMinutes);
  const seasonAst = num(input.seasonAssists ?? input.seasonAPG);
  const recentAst = num(input.recentAssists ?? input.recentAPG);
  const potentialAssists = num(input.potentialAssists, null);
  const touches = num(input.touches, null);

  let expectedMinutes = blend(recentMinutes, seasonMinutes, 0.6);
  expectedMinutes = Number(
    (expectedMinutes + num(input.expectedMinutesAdjustment)).toFixed(1)
  );

  const seasonRate =
    seasonMinutes > 0 ? seasonAst / seasonMinutes : null;
  const recentRate =
    recentMinutes > 0 ? recentAst / recentMinutes : null;
  let assistRate =
    seasonRate != null && recentRate != null
      ? recentRate * 0.6 + seasonRate * 0.4
      : recentRate ?? seasonRate ?? null;

  let playmakingOpportunitySource = "MISSING";
  if (potentialAssists != null || touches != null) {
    playmakingOpportunitySource = "DIRECT";
  } else if (assistRate != null) {
    playmakingOpportunitySource = "DERIVED_PROXY";
  }

  // Playmaking role priors (documented; not scoring-usage substitute)
  let roleAdj = 0;
  if (input.primaryCreator === true) roleAdj += 0.06;
  else if (input.secondaryCreator === true) roleAdj += 0.03;
  if (input.ballHandlingUnstable === true) roleAdj -= 0.05;
  if (assistRate != null) {
    assistRate = Math.max(0, assistRate * (1 + roleAdj));
  }

  // Teammate finishing environment
  let finishingAdj = 0;
  const teammateFg = num(input.teammateFgPct, null);
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

  // Pace / competitiveness — contextual
  let envAdj = 0;
  const pace = num(input.pace, null);
  if (pace != null && pace > 100) envAdj += 0.02;
  if (pace != null && pace < 94) envAdj -= 0.02;
  if (assistRate != null) {
    assistRate = Math.max(0, assistRate * (1 + clamp(envAdj, -0.05, 0.05)));
  }

  let projection = 0;
  if (assistRate != null && expectedMinutes > 0) {
    projection = expectedMinutes * assistRate;
  } else {
    projection = blend(recentAst, seasonAst, 0.6);
  }

  // Direct potential assists: blend lightly when available
  if (potentialAssists != null && potentialAssists > 0) {
    projection = projection * 0.7 + potentialAssists * 0.3;
  }

  projection = Number(Math.max(0, projection).toFixed(1));

  return {
    build: WNBA_ASSISTS_PROJECTION_BUILD,
    propType: "ASSISTS",
    projection,
    expectedMinutes,
    assistRate: assistRate == null ? null : Number(assistRate.toFixed(4)),
    playmakingOpportunitySource,
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
