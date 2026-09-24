/**
 * Pre-match REB/AST shadow board. Never Official.
 * Candidates use the same frozen line and pre-match inputs.
 */
import { projectAstA, projectAstB, projectAstC } from "../researchCandidatesV1/astCandidatesV1.js";
import { projectRebA, projectRebB, projectRebC } from "../researchCandidatesV1/rebCandidatesV1.js";
import { classifyAstRole, classifyRebRole, rate } from "../researchCandidatesV1/featuresV1.js";
import {
  COURTEDGE_AST_SHADOW_V1,
  COURTEDGE_REB_SHADOW_V1,
  isShadowPropMarket,
  normalizePropMarket,
} from "../../courtEdgeEraV1.js";
import {
  avgPresentField,
  presentStatNumber,
} from "../statPresenceV1.js";

function num(v) {
  return presentStatNumber(v);
}

function playerFromPacket(p = {}) {
  const last5 = p.last5 || p.dataCard?.last5 || [];
  const seasonMin = num(p.seasonMinutes ?? p.dataCard?.seasonMinutes);
  const recentMin =
    avgPresentField(last5, ["minutes", "min", "MIN"], {
      treatOmittedAsZeroWhenPlayed: false,
    }) ?? num(p.recentMinutes);
  const seasonAst = num(p.seasonAssists ?? p.dataCard?.seasonAssists);
  const recentAst =
    avgPresentField(last5, ["assists", "AST"]) ?? num(p.recentAssists);
  const seasonReb = num(p.seasonRebounds ?? p.dataCard?.seasonRebounds);
  const recentReb =
    avgPresentField(last5, ["rebounds", "REB"]) ?? num(p.recentRebounds);
  const starterShare = last5.length
    ? last5.filter((g) => String(g.starterStatus || g.starter || "").toUpperCase().includes("START")).length / last5.length
    : null;
  return {
    n: last5.length,
    seasonMin,
    recentMin,
    seasonAst,
    recentAst,
    seasonReb,
    recentReb,
    starterShare,
    recentStarterShare: starterShare,
    last5MinCv: null,
    games: last5.map((g) => ({
      MIN: num(g.minutes ?? g.min ?? g.MIN),
      AST: presentStatNumber(g.assists ?? g.AST),
      REB: presentStatNumber(g.rebounds ?? g.REB),
    })),
  };
}

function sideFrom(proj, line) {
  if (proj == null || line == null) return null;
  if (!Number.isFinite(Number(proj)) || !Number.isFinite(Number(line))) return null;
  if (proj === line) return null;
  return proj > line ? "OVER" : "UNDER";
}

function astOverHypothesis(ctx, edge, side) {
  if (side !== "OVER") return null;
  if (ctx.role?.primaryCreator && !ctx.role.ballHandlingUnstable) return "stable_creator_role";
  if (ctx.highVolumeScorerOut) return "teammate_absence";
  if (ctx.role?.ballHandlingUnstable) return "temporary_role_increase";
  if (Math.abs(edge || 0) >= 1.5 && (ctx.player.recentAst || 0) > (ctx.player.seasonAst || 0) + 0.8) {
    return "recent_form_spike";
  }
  if ((ctx.player.recentMin || 0) > (ctx.player.seasonMin || 0) + 3) return "minutes_driven_edge";
  if (ctx.pace != null && ctx.pace > 100) return "pace_driven_edge";
  return "unknown";
}

export function buildShadowRow(packet = {}) {
  const market = normalizePropMarket(packet.propType || packet.stat || packet.market);
  if (!isShadowPropMarket(market)) return null;
  const line = num(packet.sealedLine ?? packet.line ?? packet.officialLine);
  const player = playerFromPacket(packet);
  const packetProj = presentStatNumber(packet.projection);
  const hollowPacket =
    packetProj == null || (packetProj === 0 && player.n === 0);
  let currentProj = hollowPacket ? null : packetProj;
  const role = classifyAstRole(player);
  const rebRole = classifyRebRole(player);
  const ctx = {
    player,
    role,
    rebRole,
    pace: num(packet.pace ?? packet.gameContext?.pace),
    leaguePace: null,
    teammateFgPct: null,
    highVolumeScorerOut: false,
    highVolumeScorerReturning: false,
    opponentMissRate: null,
    leagueMissRate: null,
    playerRebShare: null,
    teamRebounders: 0,
    teammateHighReboundOut: false,
    daysSinceLastGame: null,
  };
  const candidates = {};
  if (market === "ASSISTS") {
    candidates["AST-A"] = projectAstA(ctx);
    candidates["AST-B"] = projectAstB(ctx);
    candidates["AST-C"] = projectAstC(ctx);
    candidates.AST_CURRENT_REPLAY = {
      projection: num(candidates["AST-B"]?.projection),
      version: "AST_CURRENT_REPLAY",
      formula: "minutes × blended rate (warehouse-style replay on live L5)",
    };
    if (currentProj == null) currentProj = num(candidates["AST-B"]?.projection);
  } else {
    candidates["REB-A"] = projectRebA(ctx);
    candidates["REB-B"] = projectRebB(ctx);
    candidates["REB-C"] = projectRebC(ctx);
    candidates.REB_CURRENT_REPLAY = {
      projection: num(candidates["REB-B"]?.projection),
      version: "REB_CURRENT_REPLAY",
    };
    if (currentProj == null) currentProj = num(candidates["REB-B"]?.projection);
  }
  if (hollowPacket && player.n === 0) currentProj = null;
  const currentSide = sideFrom(currentProj, line);
  candidates.CURRENT = {
    projection: currentProj,
    side: currentSide,
    version: "CURRENT",
    hydratedFromPacket: !hollowPacket,
  };
  for (const [k, v] of Object.entries(candidates)) {
    if (!v) continue;
    v.side = sideFrom(v.projection, line);
    v.edge = v.projection != null && line != null ? Number((v.projection - line).toFixed(3)) : null;
  }
  const edge = currentProj != null && line != null ? currentProj - line : null;
  return {
    shadow: true,
    official: false,
    notOfficial: true,
    label: "NOT OFFICIAL / RESEARCH ONLY",
    era: market === "ASSISTS" ? COURTEDGE_AST_SHADOW_V1 : COURTEDGE_REB_SHADOW_V1,
    market,
    player: packet.playerName || packet.player,
    team: packet.team,
    opponent: packet.opponent,
    line,
    side: currentSide,
    projection: currentProj,
    invalid: currentProj == null || currentSide == null,
    invalidReason: currentProj == null ? "MISSING_PROJECTION" : currentSide == null ? "NO_SIDE" : null,
    projectionEdge: edge,
    predictedProbability: num(packet.predictedProbability ?? packet.rawWinProbability),
    rankScore: num(packet.officialRankScore ?? packet.c2RankScore ?? packet.rankScore),
    safetyScore: num(packet.safetyScore ?? packet.SafetyScore),
    risk: packet.risk?.risk || packet.c2Risk || packet.trueRisk || null,
    expectedMinutes: num(packet.expectedMinutes ?? packet.pregameFeatureSnapshot?.expectedMinutes),
    projectedMinutes: num(packet.expectedMinutes ?? packet.pregameFeatureSnapshot?.expectedMinutes),
    recentRate: market === "ASSISTS" ? rate(player.recentAst, player.recentMin) : rate(player.recentReb, player.recentMin),
    seasonRate: market === "ASSISTS" ? rate(player.seasonAst, player.seasonMin) : rate(player.seasonReb, player.seasonMin),
    rateUsed: market === "ASSISTS" ? candidates["AST-B"]?.assistRate : candidates["REB-B"]?.reboundRate,
    assistRateUsed: market === "ASSISTS" ? candidates["AST-B"]?.assistRate ?? null : null,
    reboundRateUsed: market === "REBOUNDS" ? candidates["REB-B"]?.reboundRate ?? null : null,
    recentAssistRate: market === "ASSISTS" ? rate(player.recentAst, player.recentMin) : null,
    seasonAssistRate: market === "ASSISTS" ? rate(player.seasonAst, player.seasonMin) : null,
    recentReboundRate: market === "REBOUNDS" ? rate(player.recentReb, player.recentMin) : null,
    seasonReboundRate: market === "REBOUNDS" ? rate(player.seasonReb, player.seasonMin) : null,
    starterShare: player.starterShare,
    starterBench: player.starterShare == null ? null : player.starterShare >= 0.6 ? "STARTER" : "BENCH",
    position: packet.position || packet.pos || null,
    role: market === "ASSISTS" ? role.role : rebRole,
    creatorRole: market === "ASSISTS" ? role : null,
    teammateAvailability: packet.teammateAvailability || packet.lineupContext || null,
    lineupContext: packet.lineupContext || packet.gameContext || null,
    pace: ctx.pace,
    opponentReboundEnvironment: packet.opponentReboundEnvironment ?? packet.gameContext?.opponentReboundEnvironment ?? null,
    expectedMissedShotOpportunity: packet.expectedMissedShots ?? ctx.opponentMissRate,
    potentialAssists: num(packet.potentialAssists),
    touches: num(packet.touches),
    passes: num(packet.passes),
    teammateConversionProxy: num(packet.teammateConversionProxy ?? packet.teammateFgPct),
    astOverHypothesis: market === "ASSISTS" ? astOverHypothesis(ctx, edge, currentSide) : null,
    rebOverContext: market === "REBOUNDS" ? {
      projectedMinutes: num(packet.expectedMinutes ?? packet.pregameFeatureSnapshot?.expectedMinutes),
      reboundRate: candidates["REB-B"]?.reboundRate ?? null,
      expectedMissedShotEnvironment: packet.expectedMissedShots ?? ctx.opponentMissRate,
      lineupCompetition: ctx.teamRebounders,
      pace: ctx.pace,
      gameReboundPool: packet.gameReboundPool ?? null,
      playerProjectedShare: ctx.playerRebShare,
    } : null,
    candidates,
    candidateVersion: market === "ASSISTS" ? COURTEDGE_AST_SHADOW_V1 : COURTEDGE_REB_SHADOW_V1,
    lineUsed: line,
    playerStatus: packet.availability || packet.playerStatus || null,
    sourceTimestamps: packet.sourceTimestamps || packet.fetchedAt || null,
    modelInputs: { player, role: market === "ASSISTS" ? role : rebRole, pace: ctx.pace, line },
    modelVersion: market === "ASSISTS" ? COURTEDGE_AST_SHADOW_V1 : COURTEDGE_REB_SHADOW_V1,
    preMatch: true,
    postgame: null,
  };
}

export function buildShadowBoards(packets = []) {
  const rows = (packets || []).map(buildShadowRow).filter(Boolean);
  const reb = rows.filter((r) => r.market === "REBOUNDS");
  const ast = rows.filter((r) => r.market === "ASSISTS");
  const rank = (xs) =>
    [...xs]
      .sort((a, b) => (b.rankScore ?? -1) - (a.rankScore ?? -1) || Math.abs(b.projectionEdge || 0) - Math.abs(a.projectionEdge || 0))
      .map((r, i) => ({ ...r, hypotheticalFeaturedRank: i + 1 }));
  const rebR = rank(reb);
  const astR = rank(ast);
  return {
    reb: {
      era: COURTEDGE_REB_SHADOW_V1,
      analyzed: rebR.length,
      hypotheticalTop6: rebR.slice(0, 6),
      rows: rebR,
    },
    ast: {
      era: COURTEDGE_AST_SHADOW_V1,
      analyzed: astR.length,
      hypotheticalTop6: astR.slice(0, 6),
      rows: astR,
    },
  };
}
