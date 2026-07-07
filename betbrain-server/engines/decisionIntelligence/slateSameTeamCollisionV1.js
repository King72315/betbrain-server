/**
 * Slate-level same-team Over collision — scoring demand vs implied team total.
 * Penalty/warning only; never auto-rejects props from Best 6.
 */
import { resolveQualityGateInputs } from "../wnba/wnbaGateInputs.js";

export const SLATE_SAME_TEAM_COLLISION_VERSION = "slate-same-team-collision-v1";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function cleanTeam(team = "") {
  return String(team || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function isPointsOver(pick = {}) {
  const side = normalizeSide(pick.side || pick.pick || pick.currentEngineSide);
  const stat = String(pick.stat || pick.propType || "points").toLowerCase();
  return side === "OVER" && (stat.includes("point") || stat === "pts" || !pick.stat);
}

function pickDemandMetrics(pick = {}) {
  const card = pick.wnbaDataCard || {};
  const metrics = resolveQualityGateInputs(pick, card, pick.wnbaReader);
  return {
    player: pick.player,
    line: num(pick.line ?? card.bookLine),
    projection: num(pick.projection ?? card.projection?.projection),
    recentPoints: num(card.last5?.points ?? pick.last5Average),
    recentMinutes: num(card.last5?.minutes ?? pick.recentMinutes),
    recentFga: num(card.last5?.fga ?? pick.recentFGA),
    recentFta: num(card.last5?.fta ?? pick.recentFTA),
    usageScore: num(pick.opportunityScore ?? card.opportunityScore),
    impliedTeamTotal: num(
      pick.impliedTeamTotalAudit?.value ??
        pick.wnbaGameContext?.impliedTeamTotal ??
        card.gameEnvironment?.impliedTeamTotal
    ),
    pickScore: num(pick.bestPropScore ?? pick.pickScore ?? pick.confidence),
    metrics,
  };
}

function evaluateTeamCluster(teamKey = "", overs = []) {
  const reasons = [];
  let collisionScore = 0;
  const demands = overs.map(pickDemandMetrics);
  const combinedLineDemand = demands.reduce((sum, d) => sum + d.line, 0);
  const combinedRecentAvg = demands.reduce((sum, d) => sum + d.recentPoints, 0);
  const combinedFga = demands.reduce((sum, d) => sum + d.recentFga, 0);
  const combinedFta = demands.reduce((sum, d) => sum + d.recentFta, 0);
  const impliedTeamTotal = demands.find((d) => d.impliedTeamTotal > 0)?.impliedTeamTotal || 0;
  const highMinuteScorers = demands.filter((d) => d.recentMinutes >= 24).length;

  if (overs.length >= 2) collisionScore += 20;
  if (overs.length >= 3) collisionScore += 15;

  if (impliedTeamTotal > 0 && combinedLineDemand > impliedTeamTotal * 1.12) {
    collisionScore += 28;
    reasons.push(
      `Combined Over lines ${combinedLineDemand.toFixed(1)} exceed implied team total ${impliedTeamTotal.toFixed(1)}.`
    );
  } else if (impliedTeamTotal <= 0) {
    reasons.push("Implied team total unavailable — line-demand check skipped.");
  }

  if (impliedTeamTotal > 0 && combinedRecentAvg > impliedTeamTotal * 1.05) {
    collisionScore += 12;
    reasons.push("Recent combined scoring near team ceiling.");
  }

  if (highMinuteScorers >= 2) {
    collisionScore += 10;
    reasons.push("Multiple high-minute scorers share usage.");
  }

  if (combinedFga > 0 && combinedFga > 55) {
    collisionScore += 8;
    reasons.push("Combined FGA demand looks heavy for one team.");
  }

  if (combinedFta > 0 && combinedFta > 18) {
    collisionScore += 6;
    reasons.push("Combined FTA demand elevated across teammate overs.");
  }

  collisionScore = Math.min(100, collisionScore);
  const unrealistic = collisionScore >= 45;

  const ranked = [...demands].sort(
    (a, b) => b.pickScore - a.pickScore || b.projection - a.projection || b.line - a.line
  );

  const propAudits = new Map();
  for (let i = 0; i < ranked.length; i += 1) {
    const row = ranked[i];
    const weakerRank = i + 1;
    let scorePenalty = 0;
    if (collisionScore >= 30) scorePenalty += Math.max(0, 16 - i * 4);
    if (unrealistic && weakerRank > 1) scorePenalty += 6;
    propAudits.set(row.player, {
      player: row.player,
      teamKey,
      collisionScore,
      unrealistic,
      rankInCluster: weakerRank,
      scorePenalty,
      combinedLineDemand: Number(combinedLineDemand.toFixed(1)),
      combinedRecentAvg: Number(combinedRecentAvg.toFixed(1)),
      impliedTeamTotal: impliedTeamTotal > 0 ? impliedTeamTotal : null,
      teammates: ranked.filter((r) => r.player !== row.player).map((r) => r.player),
      reasons: reasons.slice(0, 6),
      recommendation: unrealistic
        ? weakerRank === 1
          ? "MONITOR_STRONGEST"
          : "REVIEW_WEAKER_OVER"
        : collisionScore >= 30
          ? "WARNING"
          : "CLEAR",
    });
  }

  return {
    teamKey,
    overCount: overs.length,
    players: overs.map((p) => p.player),
    collisionScore,
    unrealistic,
    combinedLineDemand: Number(combinedLineDemand.toFixed(1)),
    combinedRecentAvg: Number(combinedRecentAvg.toFixed(1)),
    impliedTeamTotal: impliedTeamTotal > 0 ? impliedTeamTotal : null,
    reasons,
    propAudits,
  };
}

export function evaluateSlateSameTeamCollisions(candidates = []) {
  const byTeam = new Map();
  for (const pick of candidates) {
    if (String(pick.league || "").toUpperCase() !== "WNBA") continue;
    if (!isPointsOver(pick)) continue;
    const teamKey = cleanTeam(pick.team || pick.teamKey);
    if (!teamKey) continue;
    if (!byTeam.has(teamKey)) byTeam.set(teamKey, []);
    byTeam.get(teamKey).push(pick);
  }

  const teamClusters = [];
  const propAudits = new Map();

  for (const [teamKey, overs] of byTeam.entries()) {
    if (overs.length < 2) continue;
    const cluster = evaluateTeamCluster(teamKey, overs);
    teamClusters.push({
      teamKey,
      overCount: cluster.overCount,
      players: cluster.players,
      collisionScore: cluster.collisionScore,
      unrealistic: cluster.unrealistic,
      combinedLineDemand: cluster.combinedLineDemand,
      combinedRecentAvg: cluster.combinedRecentAvg,
      impliedTeamTotal: cluster.impliedTeamTotal,
      reasons: cluster.reasons,
    });
    for (const [player, audit] of cluster.propAudits.entries()) {
      propAudits.set(`${teamKey}|${cleanTeam(player)}`, audit);
    }
  }

  return {
    version: SLATE_SAME_TEAM_COLLISION_VERSION,
    evaluatedAt: new Date().toISOString(),
    teamClusterCount: teamClusters.length,
    warningClusters: teamClusters.filter((c) => c.collisionScore >= 30).length,
    unrealisticClusters: teamClusters.filter((c) => c.unrealistic).length,
    teamClusters,
    propAudits,
  };
}

export function applySlateCollisionAdjustments(candidates = [], evaluation = null) {
  const evalResult = evaluation || evaluateSlateSameTeamCollisions(candidates);
  return candidates.map((pick) => {
    if (String(pick.league || "").toUpperCase() !== "WNBA") return pick;
    const teamKey = cleanTeam(pick.team || pick.teamKey);
    const audit = evalResult.propAudits.get(`${teamKey}|${cleanTeam(pick.player)}`);
    if (!audit) return pick;
    return {
      ...pick,
      slateCollisionAudit: audit,
      slateCollisionPenalty: audit.scorePenalty,
    };
  });
}
