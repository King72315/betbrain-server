/**
 * WNBA Rebounds projection — independent of Points formula.
 *
 * Core: minutes × rebound rate (± teammate competition ± missed-shot env).
 * Never fabricates rebound chances — stamps reboundOpportunitySource.
 */
export const WNBA_REBOUNDS_PROJECTION_BUILD =
  "courteedge-wnba-rebounds-projection-v1";

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
 * @returns {{ projection, expectedMinutes, reboundRate, reboundOpportunitySource, components, build }}
 */
export function projectWnbaRebounds(input = {}) {
  const seasonMinutes = num(input.seasonMinutes);
  const recentMinutes = num(input.recentMinutes);
  const seasonReb = num(input.seasonRebounds ?? input.seasonRPG);
  const recentReb = num(input.recentRebounds ?? input.recentRPG);
  const seasonORB = num(input.seasonOffRebounds);
  const recentORB = num(input.recentOffRebounds);
  const seasonDRB = num(input.seasonDefRebounds);
  const recentDRB = num(input.recentDefRebounds);

  let expectedMinutes = blend(recentMinutes, seasonMinutes, 0.6);
  expectedMinutes = Number(
    (expectedMinutes + num(input.expectedMinutesAdjustment)).toFixed(1)
  );

  const seasonRate =
    seasonMinutes > 0 ? seasonReb / seasonMinutes : null;
  const recentRate =
    recentMinutes > 0 ? recentReb / recentMinutes : null;
  let reboundRate =
    seasonRate != null && recentRate != null
      ? recentRate * 0.6 + seasonRate * 0.4
      : recentRate ?? seasonRate ?? null;

  let reboundOpportunitySource = "MISSING";
  if (seasonORB > 0 || recentORB > 0 || seasonDRB > 0 || recentDRB > 0) {
    reboundOpportunitySource = "DIRECT";
  } else if (reboundRate != null) {
    reboundOpportunitySource = "DERIVED";
  }

  // Teammate competition: high-rebound teammate OUT → boost share; returning → suppress
  let competitionAdj = 0;
  if (input.teammateHighReboundOut) competitionAdj += 0.08;
  if (input.teammateHighReboundReturning) competitionAdj -= 0.07;
  if (reboundRate != null) {
    reboundRate = Math.max(0, reboundRate * (1 + competitionAdj));
  }

  // Missed-shot / pace environment — contextual only, never automatic Over
  let envAdj = 0;
  const oppFgPct = num(input.opponentFgPct, null);
  const pace = num(input.pace, null);
  if (oppFgPct != null && oppFgPct < 0.42) envAdj += 0.03;
  if (oppFgPct != null && oppFgPct > 0.48) envAdj -= 0.03;
  if (pace != null && pace > 100) envAdj += 0.02;
  if (pace != null && pace < 94) envAdj -= 0.02;
  if (reboundRate != null) {
    reboundRate = Math.max(0, reboundRate * (1 + clamp(envAdj, -0.08, 0.08)));
  }

  let projection = 0;
  if (reboundRate != null && expectedMinutes > 0) {
    projection = expectedMinutes * reboundRate;
  } else {
    projection = blend(recentReb, seasonReb, 0.6);
  }

  // Small-ball / interior role soft prior (documented proxy — not position hard rule)
  if (input.likelyInteriorMinutes === true) {
    projection *= 1.04;
  } else if (input.smallBallRole === true) {
    projection *= 0.96;
  }

  projection = Number(Math.max(0, projection).toFixed(1));

  return {
    build: WNBA_REBOUNDS_PROJECTION_BUILD,
    propType: "REBOUNDS",
    projection,
    expectedMinutes,
    reboundRate:
      reboundRate == null ? null : Number(reboundRate.toFixed(4)),
    reboundOpportunitySource,
    components: {
      seasonReb,
      recentReb,
      competitionAdj,
      envAdj,
      interiorBoost: Boolean(input.likelyInteriorMinutes),
      smallBallDamp: Boolean(input.smallBallRole),
    },
  };
}
