/**
 * Phase 4 — Same-Team Opportunity Engine
 * Opportunity budgeting for same-team scoring props.
 * Status: SUPPORTED | QUESTIONABLE | CONTRADICTED
 *
 * CONTRADICTED: never auto-flip. Identify weakest projection; full opposite-side
 * eval; flip only if Under independently wins; else reduce ranking only.
 */

export const SAME_TEAM_OPPORTUNITY_VERSION = "same-team-opportunity-v1";
export const OPPORTUNITY_STATUS = Object.freeze([
  "SUPPORTED",
  "QUESTIONABLE",
  "CONTRADICTED",
]);

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

function pickMetrics(pick = {}) {
  const card = pick.wnbaDataCard || {};
  const proj =
    num(pick.projection) ||
    num(card.projection?.projection) ||
    num(card.projection);
  return {
    player: pick.player,
    playerId: pick.playerId || card.playerId || null,
    line: num(pick.line ?? card.bookLine),
    projection: proj,
    expectedFga: num(
      pick.expectedFGA ??
        card.projection?.expectedFGA ??
        card.last5?.fga ??
        pick.recentFGA
    ),
    expectedFta: num(
      pick.expectedFTA ??
        card.projection?.expectedFTA ??
        card.last5?.fta ??
        pick.recentFTA
    ),
    recentMinutes: num(card.last5?.minutes ?? pick.recentMinutes),
    pickScore: num(pick.bestPropScore ?? pick.pickScore ?? pick.confidence),
    underGap: num(pick.underGap ?? pick.wnbaReader?.underGap),
    overGap: num(pick.overGap ?? pick.wnbaReader?.overGap),
    underCaseScore: num(pick.wnbaReader?.underCase?.score ?? pick.underCaseScore),
    overCaseScore: num(pick.wnbaReader?.overCase?.score ?? pick.overCaseScore),
    impliedTeamTotal: num(
      pick.impliedTeamTotalAudit?.value ??
        pick.wnbaGameContext?.impliedTeamTotal ??
        card.gameEnvironment?.impliedTeamTotal
    ),
  };
}

/**
 * Opportunity budget for a same-team Over cluster.
 */
export function evaluateSameTeamOpportunityCluster(overs = []) {
  const reasons = [];
  const demands = overs.map(pickMetrics);
  const projectedTeamPoints = demands
    .map((d) => d.impliedTeamTotal)
    .find((v) => v > 0) || 0;
  const combinedPlayerProjected = demands.reduce((s, d) => s + d.projection, 0);
  const combinedExpectedFga = demands.reduce((s, d) => s + d.expectedFga, 0);
  const combinedExpectedFta = demands.reduce((s, d) => s + d.expectedFta, 0);

  // Remaining team opportunity = projected team pts − combined player projections
  const remainingOpportunity =
    projectedTeamPoints > 0
      ? projectedTeamPoints - combinedPlayerProjected
      : null;

  // Usage ceiling proxy (~ team FGA share for featured scorers)
  const usagePressure =
    combinedExpectedFga > 0
      ? combinedExpectedFga / Math.max(overs.length, 1)
      : 0;

  let pressureScore = 0;
  if (overs.length >= 2) pressureScore += 15;
  if (overs.length >= 3) pressureScore += 18;

  if (projectedTeamPoints > 0) {
    const demandRatio = combinedPlayerProjected / projectedTeamPoints;
    if (demandRatio >= 1.05) {
      pressureScore += 35;
      reasons.push(
        `Combined projections ${combinedPlayerProjected.toFixed(1)} exceed team total ${projectedTeamPoints.toFixed(1)}.`
      );
    } else if (demandRatio >= 0.88) {
      pressureScore += 18;
      reasons.push("Combined projections consume most of team opportunity.");
    } else if (demandRatio <= 0.7) {
      pressureScore -= 8;
      reasons.push("Combined projections leave healthy remaining team opportunity.");
    }

    if (remainingOpportunity != null && remainingOpportunity < 8 && overs.length >= 2) {
      pressureScore += 12;
      reasons.push(
        `Remaining team opportunity thin (${remainingOpportunity.toFixed(1)} pts).`
      );
    }
  } else {
    reasons.push("Projected team points unavailable — budget check partial.");
  }

  if (combinedExpectedFga >= 52) {
    pressureScore += 10;
    reasons.push("Combined expected FGA presses team shot budget.");
  }
  if (combinedExpectedFta >= 16) {
    pressureScore += 6;
    reasons.push("Combined expected FTA elevated across teammate overs.");
  }
  if (usagePressure >= 16) {
    pressureScore += 6;
    reasons.push("Average expected FGA per Over looks heavy for shared usage.");
  }

  pressureScore = Math.max(0, Math.min(100, pressureScore));

  let status = "SUPPORTED";
  if (pressureScore >= 48) status = "CONTRADICTED";
  else if (pressureScore >= 28) status = "QUESTIONABLE";

  // Weakest projection = largest projection−line (most aggressive Over) or lowest pickScore
  const rankedWeakFirst = [...demands].sort((a, b) => {
    const aEdge = a.projection - a.line;
    const bEdge = b.projection - b.line;
    // Weakest Over: smallest edge / worst score
    return aEdge - bEdge || a.pickScore - b.pickScore;
  });
  const weakest = rankedWeakFirst[0] || null;

  const propAudits = new Map();
  for (let i = 0; i < rankedWeakFirst.length; i += 1) {
    const row = rankedWeakFirst[i];
    const strengthRank = rankedWeakFirst.length - i; // 1 = strongest
    let rankingPenalty = 0;
    let recommendation = "KEEP_OVER";
    let allowFlipEval = false;

    if (status === "QUESTIONABLE") {
      rankingPenalty = Math.max(0, 10 - i * 3);
      recommendation = i === 0 ? "MONITOR" : "REDUCE_RANKING";
    }
    if (status === "CONTRADICTED") {
      rankingPenalty = Math.max(0, 22 - i * 5);
      allowFlipEval = i === 0; // weakest only
      recommendation = allowFlipEval
        ? "EVALUATE_UNDER_INDEPENDENTLY"
        : "REDUCE_RANKING_NO_FORCE_UNDER";
      if (i === 0) {
        reasons.push(
          `Weakest projection identified: ${row.player} — full Under eval only if Under independently wins.`
        );
      }
    }

    propAudits.set(row.player, {
      player: row.player,
      status,
      pressureScore,
      rankingPenalty,
      recommendation,
      allowFlipEval,
      strengthRank,
      weaknessRank: i + 1,
      projection: row.projection,
      line: row.line,
      remainingOpportunity:
        remainingOpportunity != null ? Number(remainingOpportunity.toFixed(1)) : null,
      reasons: reasons.slice(0, 6),
      // No artificial balancing / no auto-flip flag
      autoFlip: false,
    });
  }

  return {
    version: SAME_TEAM_OPPORTUNITY_VERSION,
    status,
    pressureScore,
    projectedTeamPoints: projectedTeamPoints > 0 ? projectedTeamPoints : null,
    combinedPlayerProjected: Number(combinedPlayerProjected.toFixed(1)),
    combinedExpectedFga: Number(combinedExpectedFga.toFixed(1)),
    combinedExpectedFta: Number(combinedExpectedFta.toFixed(1)),
    remainingOpportunity:
      remainingOpportunity != null ? Number(remainingOpportunity.toFixed(1)) : null,
    weakestPlayer: weakest?.player || null,
    reasons: reasons.slice(0, 8),
    propAudits,
    players: overs.map((p) => p.player),
  };
}

/**
 * Independent Under win check — flip only when Under case clearly wins on its own.
 */
export function underIndependentlyWins(pick = {}, audit = {}) {
  if (!audit?.allowFlipEval) return false;
  const m = pickMetrics(pick);
  const underGap = m.underGap;
  const overGap = m.overGap;
  const underCase = m.underCaseScore;
  const overCase = m.overCaseScore;

  // Under must clear a meaningful gap and beat Over case — no forced flip
  const gapOk = underGap >= 1.5 && underGap > overGap;
  const caseOk =
    underCase > 0 && overCase > 0
      ? underCase >= overCase + 4
      : underGap >= 2.0;

  return Boolean(gapOk && caseOk);
}

export function evaluateSlateSameTeamOpportunity(candidates = []) {
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
    const cluster = evaluateSameTeamOpportunityCluster(overs);
    teamClusters.push({
      teamKey,
      status: cluster.status,
      pressureScore: cluster.pressureScore,
      projectedTeamPoints: cluster.projectedTeamPoints,
      combinedPlayerProjected: cluster.combinedPlayerProjected,
      remainingOpportunity: cluster.remainingOpportunity,
      weakestPlayer: cluster.weakestPlayer,
      players: cluster.players,
      reasons: cluster.reasons,
    });
    for (const [player, audit] of cluster.propAudits.entries()) {
      propAudits.set(`${teamKey}|${cleanTeam(player)}`, {
        ...audit,
        teamKey,
      });
    }
  }

  return {
    version: SAME_TEAM_OPPORTUNITY_VERSION,
    evaluatedAt: new Date().toISOString(),
    teamClusterCount: teamClusters.length,
    supportedClusters: teamClusters.filter((c) => c.status === "SUPPORTED").length,
    questionableClusters: teamClusters.filter((c) => c.status === "QUESTIONABLE").length,
    contradictedClusters: teamClusters.filter((c) => c.status === "CONTRADICTED").length,
    teamClusters,
    propAudits,
  };
}

/**
 * Apply opportunity budgeting as ranking penalty (and optional Under flip only when independent).
 * Preserves Best 6 size / lifecycle — no auto-reject.
 */
export function applySameTeamOpportunityAdjustments(candidates = [], evaluation = null) {
  const evalResult = evaluation || evaluateSlateSameTeamOpportunity(candidates);
  return candidates.map((pick) => {
    if (String(pick.league || "").toUpperCase() !== "WNBA") return pick;
    const teamKey = cleanTeam(pick.team || pick.teamKey);
    const audit = evalResult.propAudits.get(`${teamKey}|${cleanTeam(pick.player)}`);
    if (!audit) return pick;

    const rankingPenalty = num(audit.rankingPenalty);
    let next = {
      ...pick,
      sameTeamOpportunityStatus: audit.status,
      sameTeamOpportunityAudit: audit,
      // Keep slateCollisionPenalty channel so Best 6 scoring continues to subtract
      slateCollisionPenalty: Math.max(num(pick.slateCollisionPenalty), rankingPenalty),
      slateCollisionAudit: {
        ...(pick.slateCollisionAudit || {}),
        opportunityVersion: SAME_TEAM_OPPORTUNITY_VERSION,
        status: audit.status,
        pressureScore: audit.pressureScore,
        rankingPenalty,
        recommendation: audit.recommendation,
        autoFlip: false,
      },
    };

    if (audit.allowFlipEval && underIndependentlyWins(pick, audit)) {
      next = {
        ...next,
        sameTeamOpportunityFlipEligible: true,
        sameTeamOpportunityFlipReason:
          "CONTRADICTED weakest Over — Under independently wins; flip allowed (not forced).",
        // Do not mutate side here — Flip-First / decision stack owns side flips.
        decisionRecomputeReason:
          pick.decisionRecomputeReason || "same_team_opportunity_under_independent",
      };
    }

    return next;
  });
}

/** Aliases for Flip-First / DDI / barrel consumers */
export function evaluateSameTeamOpportunity(pick = {}, options = {}) {
  return evaluateSameTeamOpportunityForPick(pick, options);
}

export function evaluateSlateSameTeamOpportunities(candidates = []) {
  return evaluateSlateSameTeamOpportunity(candidates);
}

export function evaluateSameTeamUsageCollisionViaOpportunity(pick = {}, options = {}) {
  const result = evaluateSameTeamOpportunityForPick(pick, options);
  return {
    ...result,
    // Preserve collision-shaped fields for DDI consumers
    opportunityStatus: result.status,
    collisionScore: result.pressureScore ?? result.collisionScore ?? 0,
  };
}

/**
 * Per-pick opportunity eval for Flip-First / DDI (replaces simple collision).
 */
export function evaluateSameTeamOpportunityForPick(pick = {}, options = {}) {
  const side = normalizeSide(options.side || pick.side || pick.pick);
  const teamKey = cleanTeam(pick.team || pick.teamKey);
  const peers = (options.teamCandidates || options.slateCandidates || []).filter(
    (c) => {
      if (cleanTeam(c.team || c.teamKey) !== teamKey) return false;
      if (String(c.player || "").toLowerCase() === String(pick.player || "").toLowerCase()) {
        return false;
      }
      return isPointsOver(c);
    }
  );

  if (side !== "OVER" || peers.length === 0) {
    return {
      version: SAME_TEAM_OPPORTUNITY_VERSION,
      detected: false,
      status: "SUPPORTED",
      collisionScore: 0,
      pressureScore: 0,
      teammatesInConflict: [],
      sideImpact: "NEUTRAL",
      recommendation: side === "OVER" ? "KEEP_OVER" : "KEEP_UNDER",
      autoFlip: false,
      reasons:
        side !== "OVER"
          ? ["Not a same-team Over opportunity case."]
          : ["No teammate Over peers — opportunity clear."],
    };
  }

  const cluster = evaluateSameTeamOpportunityCluster([pick, ...peers]);
  const audit = cluster.propAudits.get(pick.player) || {};
  const flipOk = underIndependentlyWins(pick, audit);

  let recommendation = "KEEP_OVER";
  let sideImpact = "NEUTRAL";
  if (cluster.status === "CONTRADICTED") {
    if (audit.allowFlipEval && flipOk) {
      recommendation = "FLIP_TO_UNDER";
      sideImpact = "UNDER";
    } else {
      recommendation = "REDUCE_RANKING_NO_FORCE_UNDER";
      sideImpact = "NEUTRAL";
    }
  } else if (cluster.status === "QUESTIONABLE") {
    recommendation = "REVIEW_UNDER";
  }

  return {
    version: SAME_TEAM_OPPORTUNITY_VERSION,
    detected: true,
    status: cluster.status,
    collisionScore: cluster.pressureScore,
    pressureScore: cluster.pressureScore,
    teammatesInConflict: peers.map((p) => p.player).filter(Boolean),
    combinedPlayerProjected: cluster.combinedPlayerProjected,
    projectedTeamPoints: cluster.projectedTeamPoints,
    remainingOpportunity: cluster.remainingOpportunity,
    weakestPlayer: cluster.weakestPlayer,
    sideImpact,
    recommendation,
    autoFlip: false,
    reasons: cluster.reasons.slice(0, 6),
  };
}
