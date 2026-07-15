/**
 * Phase 4 — Same-Team Opportunity Engine
 * Opportunity budgeting for same-team scoring props.
 * Status: SUPPORTED | QUESTIONABLE | CONTRADICTED
 *
 * CONTRADICTED: never auto-flip. Identify weakest projection; full opposite-side
 * eval; flip only if Under independently wins; else reduce ranking + projection trust.
 */

export const SAME_TEAM_OPPORTUNITY_VERSION = "same-team-opportunity-v2-rank";
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

/**
 * Resolve implied team total from pick / game context (home vs away).
 */
export function resolveImpliedTeamTotal(pick = {}) {
  const card = pick.wnbaDataCard || {};
  const ctx = pick.wnbaGameContext || {};
  const env = card.gameEnvironment || {};
  const direct =
    num(pick.impliedTeamTotal) ||
    num(pick.impliedTeamTotalAudit?.value) ||
    num(ctx.impliedTeamTotal) ||
    num(env.impliedTeamTotal);
  if (direct > 0) return direct;

  const team = cleanTeam(pick.team || pick.teamKey || ctx.playerTeam);
  const home = cleanTeam(ctx.homeTeam || pick.homeTeam || card.homeTeam);
  const away = cleanTeam(ctx.awayTeam || pick.awayTeam || card.awayTeam);
  const homeTotal = num(ctx.impliedHomeTotal ?? env.impliedHomeTotal);
  const awayTotal = num(ctx.impliedAwayTotal ?? env.impliedAwayTotal);

  if (team && home && team === home && homeTotal > 0) return homeTotal;
  if (team && away && team === away && awayTotal > 0) return awayTotal;

  // Fallback: if only one side known and team matches neither label
  if (homeTotal > 0 && awayTotal <= 0) return homeTotal;
  if (awayTotal > 0 && homeTotal <= 0) return awayTotal;
  return 0;
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
    impliedTeamTotal: resolveImpliedTeamTotal(pick),
  };
}

/**
 * Opportunity budget for a same-team Over cluster.
 */
export function evaluateSameTeamOpportunityCluster(overs = []) {
  const reasons = [];
  const demands = overs.map(pickMetrics);
  const projectedTeamPoints =
    demands.map((d) => d.impliedTeamTotal).find((v) => v > 0) || 0;
  const combinedPlayerProjected = demands.reduce((s, d) => s + d.projection, 0);
  const combinedExpectedFga = demands.reduce((s, d) => s + d.expectedFga, 0);
  const combinedExpectedFta = demands.reduce((s, d) => s + d.expectedFta, 0);

  const remainingOpportunity =
    projectedTeamPoints > 0
      ? projectedTeamPoints - combinedPlayerProjected
      : null;

  const usageShare =
    projectedTeamPoints > 0
      ? combinedPlayerProjected / projectedTeamPoints
      : null;

  const usagePressure =
    combinedExpectedFga > 0
      ? combinedExpectedFga / Math.max(overs.length, 1)
      : 0;

  let pressureScore = 0;
  if (overs.length >= 2) pressureScore += 12;
  if (overs.length >= 3) pressureScore += 18;
  if (overs.length >= 4) pressureScore += 10;

  if (projectedTeamPoints > 0) {
    const demandRatio = combinedPlayerProjected / projectedTeamPoints;
    if (demandRatio >= 1.0) {
      pressureScore += 40;
      reasons.push(
        `Combined projections ${combinedPlayerProjected.toFixed(1)} exceed team total ${projectedTeamPoints.toFixed(1)}.`
      );
    } else if (demandRatio >= 0.85) {
      pressureScore += 28;
      reasons.push("Combined projections consume most of team opportunity.");
    } else if (demandRatio >= 0.72) {
      pressureScore += 16;
      reasons.push("Combined projections press team scoring budget.");
    } else if (demandRatio <= 0.55) {
      pressureScore -= 6;
      reasons.push("Combined projections leave healthy remaining team opportunity.");
    }

    if (remainingOpportunity != null && remainingOpportunity < 12 && overs.length >= 2) {
      pressureScore += 14;
      reasons.push(
        `Remaining teammate scoring thin (${remainingOpportunity.toFixed(1)} pts).`
      );
    } else if (remainingOpportunity != null && remainingOpportunity < 20 && overs.length >= 2) {
      pressureScore += 6;
      reasons.push(
        `Remaining teammate scoring tight (${remainingOpportunity.toFixed(1)} pts).`
      );
    }
  } else {
    reasons.push("Projected team points unavailable — budget check partial.");
    // Without team totals, still pressure from combined volume across multiple overs
    if (overs.length >= 2 && combinedPlayerProjected >= 38) {
      pressureScore += 14;
      reasons.push("High combined player projections without team total validation.");
    }
  }

  if (combinedExpectedFga >= 48) {
    pressureScore += 14;
    reasons.push("Combined expected FGA presses team shot budget.");
  } else if (combinedExpectedFga >= 36) {
    pressureScore += 8;
    reasons.push("Combined expected FGA elevated across teammate overs.");
  }
  if (combinedExpectedFta >= 14) {
    pressureScore += 6;
    reasons.push("Combined expected FTA elevated across teammate overs.");
  }
  if (usagePressure >= 15) {
    pressureScore += 8;
    reasons.push("Average expected FGA per Over looks heavy for shared usage.");
  }

  // Weak-edge overs amplify cluster pressure (crowded thin Overs)
  const thinOvers = demands.filter((d) => d.projection - d.line < 2.0).length;
  if (thinOvers >= 2 && overs.length >= 2) {
    pressureScore += 10;
    reasons.push(`${thinOvers} clustered Overs carry thin projection edges.`);
  }

  pressureScore = Math.max(0, Math.min(100, pressureScore));

  let status = "SUPPORTED";
  if (pressureScore >= 42) status = "CONTRADICTED";
  else if (pressureScore >= 24) status = "QUESTIONABLE";

  // Weakest Over = smallest projection−line edge, then lowest pickScore
  const rankedWeakFirst = [...demands].sort((a, b) => {
    const aEdge = a.projection - a.line;
    const bEdge = b.projection - b.line;
    return aEdge - bEdge || a.pickScore - b.pickScore;
  });
  const weakest = rankedWeakFirst[0] || null;

  const propAudits = new Map();
  for (let i = 0; i < rankedWeakFirst.length; i += 1) {
    const row = rankedWeakFirst[i];
    const strengthRank = rankedWeakFirst.length - i;
    let rankingPenalty = 0;
    let projectionTrustMultiplier = 1;
    let recommendation = "KEEP_OVER";
    let allowFlipEval = false;

    if (status === "QUESTIONABLE") {
      // Meaningful demotion for weaker cluster members
      rankingPenalty = Math.max(0, 18 - i * 5);
      projectionTrustMultiplier = i === 0 ? 0.86 : Math.max(0.9, 0.96 - i * 0.02);
      recommendation = i === 0 ? "MONITOR" : "REDUCE_RANKING";
    }
    if (status === "CONTRADICTED") {
      rankingPenalty = Math.max(0, 36 - i * 8);
      projectionTrustMultiplier = i === 0 ? 0.72 : Math.max(0.8, 0.9 - i * 0.04);
      allowFlipEval = i === 0;
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
      projectionTrustMultiplier,
      recommendation,
      allowFlipEval,
      strengthRank,
      weaknessRank: i + 1,
      projection: row.projection,
      line: row.line,
      expectedFga: row.expectedFga,
      expectedFta: row.expectedFta,
      usageShare: usageShare != null ? Number(usageShare.toFixed(3)) : null,
      remainingOpportunity:
        remainingOpportunity != null ? Number(remainingOpportunity.toFixed(1)) : null,
      reasons: reasons.slice(0, 6),
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
    usageShare: usageShare != null ? Number(usageShare.toFixed(3)) : null,
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
      usageShare: cluster.usageShare,
      combinedExpectedFga: cluster.combinedExpectedFga,
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
 * Apply opportunity budgeting as ranking + projection-trust penalties.
 * Preserves Best 6 size / lifecycle — no auto-reject / no forced flip.
 */
export function applySameTeamOpportunityAdjustments(candidates = [], evaluation = null) {
  const evalResult = evaluation || evaluateSlateSameTeamOpportunity(candidates);
  return candidates.map((pick) => {
    if (String(pick.league || "").toUpperCase() !== "WNBA") return pick;
    const teamKey = cleanTeam(pick.team || pick.teamKey);
    const audit = evalResult.propAudits.get(`${teamKey}|${cleanTeam(pick.player)}`);
    if (!audit) return pick;

    const rankingPenalty = num(audit.rankingPenalty);
    const trustMult = num(audit.projectionTrustMultiplier, 1) || 1;
    const priorTrust = num(pick.projectionTrustMultiplier, 1) || 1;

    let next = {
      ...pick,
      sameTeamOpportunityStatus: audit.status,
      sameTeamOpportunityAudit: audit,
      projectionTrustMultiplier: Math.min(priorTrust, trustMult),
      sameTeamOpportunityTrustMult: trustMult,
      // Keep slateCollisionPenalty channel so Best 6 scoring continues to subtract
      slateCollisionPenalty: Math.max(num(pick.slateCollisionPenalty), rankingPenalty),
      slateCollisionAudit: {
        ...(pick.slateCollisionAudit || {}),
        opportunityVersion: SAME_TEAM_OPPORTUNITY_VERSION,
        status: audit.status,
        pressureScore: audit.pressureScore,
        rankingPenalty,
        projectionTrustMultiplier: trustMult,
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
    usageShare: cluster.usageShare,
    weakestPlayer: cluster.weakestPlayer,
    rankingPenalty: audit.rankingPenalty || 0,
    projectionTrustMultiplier: audit.projectionTrustMultiplier ?? 1,
    sideImpact,
    recommendation,
    autoFlip: false,
    reasons: cluster.reasons.slice(0, 6),
  };
}
