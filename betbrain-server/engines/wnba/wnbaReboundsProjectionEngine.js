/**
 * WNBA Rebounds projection — independent of Points formula.
 *
 * Core: minutes × rebound rate (± teammate competition ± missed-shot env).
 * Never fabricates rebound chances — stamps reboundOpportunitySource.
 * Missing inputs → projection null (never 0 → UNDER).
 * Actual 0 rebound rate with real minutes is a real 0 projection, not missing.
 */
export const WNBA_REBOUNDS_PROJECTION_BUILD =
  "courteedge-wnba-rebounds-projection-v1";

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
 * @returns {{ projection, expectedMinutes, reboundRate, reboundOpportunitySource, components, build, invalid, invalidReason }}
 */
export function projectWnbaRebounds(input = {}) {
  const seasonMinutes = num(input.seasonMinutes);
  const recentMinutes = num(input.recentMinutes);
  const explicitMinutes = num(input.expectedMinutes);
  const seasonReb = num(input.seasonRebounds ?? input.seasonRPG);
  const recentReb = num(input.recentRebounds ?? input.recentRPG);
  const seasonORB = num(input.seasonOffRebounds);
  const recentORB = num(input.recentOffRebounds);
  const seasonDRB = num(input.seasonDefRebounds);
  const recentDRB = num(input.recentDefRebounds);

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
    (seasonReb != null && positive(seasonMinutes)) ||
    (recentReb != null && positive(recentMinutes)) ||
    positive(seasonReb) ||
    positive(recentReb);

  const missingReturn = (reason) => ({
    build: WNBA_REBOUNDS_PROJECTION_BUILD,
    propType: "REBOUNDS",
    projection: null,
    expectedMinutes: expectedMinutes != null && expectedMinutes > 0 ? expectedMinutes : null,
    reboundRate: null,
    reboundOpportunitySource: "MISSING",
    invalid: true,
    invalidReason: reason,
    components: {
      seasonReb,
      recentReb,
      competitionAdj: 0,
      envAdj: 0,
      interiorBoost: Boolean(input.likelyInteriorMinutes),
      smallBallDamp: Boolean(input.smallBallRole),
    },
  });

  if (!hasMinutes || !hasStat) {
    return missingReturn("MISSING_PROJECTION_INPUTS");
  }

  const seasonRate =
    positive(seasonMinutes) && seasonReb != null ? seasonReb / seasonMinutes : null;
  const recentRate =
    positive(recentMinutes) && recentReb != null ? recentReb / recentMinutes : null;
  let reboundRate =
    seasonRate != null && recentRate != null
      ? recentRate * 0.6 + seasonRate * 0.4
      : recentRate ?? seasonRate ?? null;

  let reboundOpportunitySource = "MISSING";
  if (seasonORB != null || recentORB != null || seasonDRB != null || recentDRB != null) {
    reboundOpportunitySource = "DIRECT";
  } else if (reboundRate != null) {
    reboundOpportunitySource = "DERIVED";
  }

  let competitionAdj = 0;
  if (input.teammateHighReboundOut) competitionAdj += 0.08;
  if (input.teammateHighReboundReturning) competitionAdj -= 0.07;
  if (reboundRate != null) {
    reboundRate = Math.max(0, reboundRate * (1 + competitionAdj));
  }

  let envAdj = 0;
  const oppFgPct = num(input.opponentFgPct);
  const pace = num(input.pace);
  if (oppFgPct != null && oppFgPct < 0.42) envAdj += 0.03;
  if (oppFgPct != null && oppFgPct > 0.48) envAdj -= 0.03;
  if (pace != null && pace > 100) envAdj += 0.02;
  if (pace != null && pace < 94) envAdj -= 0.02;
  if (reboundRate != null) {
    reboundRate = Math.max(0, reboundRate * (1 + clamp(envAdj, -0.08, 0.08)));
  }

  let projection = null;
  if (reboundRate != null && positive(expectedMinutes)) {
    projection = expectedMinutes * reboundRate;
  } else {
    projection = blend(recentReb, seasonReb, 0.6);
  }

  if (projection == null) {
    return missingReturn("MISSING_PROJECTION_INPUTS");
  }

  // Interior/small-ball multipliers were tested on posted-line history (n=304)
  // and did not beat minutes × blended rebound rate. Do not apply.

  projection = Number(Math.max(0, projection).toFixed(1));

  return {
    build: WNBA_REBOUNDS_PROJECTION_BUILD,
    propType: "REBOUNDS",
    projection,
    expectedMinutes: expectedMinutes != null ? expectedMinutes : null,
    reboundRate: reboundRate == null ? null : Number(reboundRate.toFixed(4)),
    reboundOpportunitySource,
    invalid: false,
    invalidReason: null,
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
