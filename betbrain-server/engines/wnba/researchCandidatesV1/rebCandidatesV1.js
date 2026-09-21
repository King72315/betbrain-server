/**
 * REB research candidates. Do not replace production projectWnbaRebounds.
 */
import { projectWnbaRebounds } from "../wnbaReboundsProjectionEngine.js";
import { blend, rate } from "./featuresV1.js";
import { minutesA, minutesB, minutesCurrent } from "./minutesV1.js";

export const REB_CANDIDATE_BUILD = "courteedge-reb-candidates-v1";

function pack(id, formula, projection, minutes, extras = {}) {
  return {
    id,
    formula,
    projection: projection == null ? null : Number(Math.max(0, projection).toFixed(1)),
    expectedMinutes: minutes,
    ...extras,
  };
}

export function projectRebCurrentReplay(ctx) {
  const r = projectWnbaRebounds({
    seasonMinutes: ctx.player.seasonMin,
    recentMinutes: ctx.player.recentMin,
    seasonRebounds: ctx.player.seasonReb,
    recentRebounds: ctx.player.recentReb,
    pace: ctx.pace,
  });
  return pack("REB_CURRENT_REPLAY", "production minutes×blended rate; env hooks unused unless pace present", r.projection, r.expectedMinutes, {
    reboundRate: r.reboundRate,
    role: ctx.rebRole ?? null,
  });
}

/** REB-A — current minutes × recent rebound rate. */
export function projectRebA(ctx) {
  const minutes = minutesCurrent(ctx.player);
  const recentRate = rate(ctx.player.recentReb, ctx.player.recentMin);
  const projection = minutes != null && recentRate != null ? minutes * recentRate : blend(ctx.player.recentReb, ctx.player.seasonReb, 1);
  return pack("REB-A", "minutesCurrent × recentReb/recentMin", projection, minutes, {
    reboundRate: recentRate,
    opportunity: minutes != null && recentRate != null ? Number((minutes * recentRate).toFixed(3)) : null,
  });
}

/** REB-B — exp minutes × blended rate × pace vs league. */
export function projectRebB(ctx) {
  const minutes = minutesA(ctx.player);
  const recentRate = rate(ctx.player.recentReb, ctx.player.recentMin);
  const seasonRate = rate(ctx.player.seasonReb, ctx.player.seasonMin);
  let reboundRate = blend(recentRate, seasonRate, 0.6);
  const pace = ctx.pace;
  const leaguePace = ctx.leaguePace;
  let paceAdj = 0;
  if (pace != null && leaguePace != null && leaguePace > 0) {
    paceAdj = Math.max(-0.06, Math.min(0.06, ((pace - leaguePace) / leaguePace) * 0.45));
    if (reboundRate != null) reboundRate *= 1 + paceAdj;
  }
  const projection = minutes != null && reboundRate != null ? minutes * reboundRate : blend(ctx.player.recentReb, ctx.player.seasonReb, 0.6);
  return pack("REB-B", "minutesA × blended rate × pace/league adj", projection, minutes, {
    reboundRate,
    paceAdj,
    opportunity: minutes != null && reboundRate != null ? Number((minutes * reboundRate).toFixed(3)) : null,
  });
}

/** REB-C — role minutes × blended rate × missed-shot env × lineup-share. */
export function projectRebC(ctx) {
  const minutes = minutesB(ctx.player, { daysSinceLastGame: ctx.daysSinceLastGame });
  const recentRate = rate(ctx.player.recentReb, ctx.player.recentMin);
  const seasonRate = rate(ctx.player.seasonReb, ctx.player.seasonMin);
  let reboundRate = blend(recentRate, seasonRate, 0.6);
  const miss = ctx.opponentMissRate;
  const leagueMiss = ctx.leagueMissRate;
  let envAdj = 0;
  if (miss != null && leagueMiss != null) {
    envAdj = Math.max(-0.07, Math.min(0.07, miss - leagueMiss));
    if (reboundRate != null) reboundRate *= 1 + envAdj;
  }
  let shareAdj = 0;
  if (ctx.playerRebShare != null && ctx.teamRebounders >= 2 && ctx.playerRebShare < 0.18) {
    shareAdj = -0.04;
  } else if (ctx.teammateHighReboundOut) {
    shareAdj = 0.08;
  } else if (ctx.teammateHighReboundReturning) {
    shareAdj = -0.06;
  }
  if (reboundRate != null) reboundRate *= 1 + shareAdj;
  if (ctx.rebRole?.likelyInteriorMinutes && reboundRate != null) reboundRate *= 1.03;
  if (ctx.rebRole?.smallBallRole && reboundRate != null) reboundRate *= 0.97;
  const projection = minutes != null && reboundRate != null ? minutes * reboundRate : blend(ctx.player.recentReb, ctx.player.seasonReb, 0.6);
  return pack("REB-C", "minutesB × blended rate × missed-shot env × lineup-share", projection, minutes, {
    reboundRate,
    envAdj,
    shareAdj,
    opportunity: minutes != null && reboundRate != null ? Number((minutes * reboundRate).toFixed(3)) : null,
  });
}

export const REB_CANDIDATES = {
  REB_CURRENT_REPLAY: projectRebCurrentReplay,
  "REB-A": projectRebA,
  "REB-B": projectRebB,
  "REB-C": projectRebC,
};
