/**
 * AST research candidates. Do not replace production projectWnbaAssists.
 */
import { projectWnbaAssists } from "../wnbaAssistsProjectionEngine.js";
import { blend, rate } from "./featuresV1.js";
import { minutesA, minutesB, minutesCurrent } from "./minutesV1.js";

export const AST_CANDIDATE_BUILD = "courteedge-ast-candidates-v1";

function pack(id, formula, projection, minutes, extras = {}) {
  return {
    id,
    formula,
    projection: projection == null ? null : Number(Math.max(0, projection).toFixed(1)),
    expectedMinutes: minutes,
    ...extras,
  };
}

export function projectAstCurrentReplay(ctx) {
  const r = projectWnbaAssists({
    seasonMinutes: ctx.player.seasonMin,
    recentMinutes: ctx.player.recentMin,
    seasonAssists: ctx.player.seasonAst,
    recentAssists: ctx.player.recentAst,
    pace: ctx.pace,
  });
  return pack("AST_CURRENT_REPLAY", "production minutes×blended rate; role hooks unused", r.projection, r.expectedMinutes, {
    assistRate: r.assistRate,
    playmakingOpportunitySource: r.playmakingOpportunitySource,
    role: ctx.role?.role ?? null,
  });
}

/** AST-A — current minutes × recent assist rate only. */
export function projectAstA(ctx) {
  const minutes = minutesCurrent(ctx.player);
  const recentRate = rate(ctx.player.recentAst, ctx.player.recentMin);
  const projection = minutes != null && recentRate != null ? minutes * recentRate : blend(ctx.player.recentAst, ctx.player.seasonAst, 1);
  return pack("AST-A", "minutesCurrent × recentAst/recentMin", projection, minutes, {
    assistRate: recentRate,
    opportunity: minutes != null && recentRate != null ? Number((minutes * recentRate).toFixed(3)) : null,
    role: ctx.role?.role ?? null,
  });
}

/** AST-B — exp-recency minutes × blended assist rate. */
export function projectAstB(ctx) {
  const minutes = minutesA(ctx.player);
  const recentRate = rate(ctx.player.recentAst, ctx.player.recentMin);
  const seasonRate = rate(ctx.player.seasonAst, ctx.player.seasonMin);
  const assistRate = blend(recentRate, seasonRate, 0.6);
  const projection = minutes != null && assistRate != null ? minutes * assistRate : blend(ctx.player.recentAst, ctx.player.seasonAst, 0.6);
  return pack("AST-B", "minutesA(exp) × (0.6 recent + 0.4 season) rate", projection, minutes, {
    assistRate,
    opportunity: minutes != null && assistRate != null ? Number((minutes * assistRate).toFixed(3)) : null,
    role: ctx.role?.role ?? null,
  });
}

/** AST-C — role-aware minutes × blended rate, production role hooks wired from derived state. */
export function projectAstC(ctx) {
  const minutes = minutesB(ctx.player, { daysSinceLastGame: ctx.daysSinceLastGame });
  const r = projectWnbaAssists({
    seasonMinutes: ctx.player.seasonMin,
    recentMinutes: ctx.player.recentMin,
    seasonAssists: ctx.player.seasonAst,
    recentAssists: ctx.player.recentAst,
    expectedMinutesAdjustment: minutes != null ? minutes - (minutesCurrent(ctx.player) ?? minutes) : 0,
    primaryCreator: ctx.role?.primaryCreator === true,
    secondaryCreator: ctx.role?.secondaryCreator === true,
    ballHandlingUnstable: ctx.role?.ballHandlingUnstable === true,
    teammateFgPct: ctx.teammateFgPct,
    highVolumeScorerOut: ctx.highVolumeScorerOut === true,
    highVolumeScorerReturning: ctx.highVolumeScorerReturning === true,
    pace: ctx.pace,
  });
  return pack("AST-C", "minutesB × blended rate × derived role/finishing/pace hooks", r.projection, r.expectedMinutes, {
    assistRate: r.assistRate,
    role: ctx.role?.role ?? null,
    components: r.components,
  });
}

export const AST_CANDIDATES = {
  AST_CURRENT_REPLAY: projectAstCurrentReplay,
  "AST-A": projectAstA,
  "AST-B": projectAstB,
  "AST-C": projectAstC,
};

export function logisticPOver(projection, line, sigma) {
  if (projection == null || line == null || !sigma) return 0.5;
  const z = (projection - line) / sigma;
  return 1 / (1 + Math.exp(-1.2 * z));
}

export function empiricalPOver(projection, line, residuals = []) {
  if (projection == null || line == null || residuals.length < 20) return null;
  const threshold = line - projection;
  let over = 0;
  for (const e of residuals) {
    if (e > threshold) over += 1;
  }
  return over / residuals.length;
}
