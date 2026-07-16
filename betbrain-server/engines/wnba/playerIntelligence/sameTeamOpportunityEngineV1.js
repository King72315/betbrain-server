/**
 * Phase 4 — Same-Team Opportunity Engine
 * Opportunity budgeting for same-team scoring props.
 *
 * Evidence assessment (internal): SUPPORTED | CONTRADICTED | INSUFFICIENT_DATA
 * Pressure severity may still use QUESTIONABLE banding for graduated penalties.
 *
 * CONTRADICTED: never auto-flip. Identify weakest projection; full opposite-side
 * eval; flip only if Under independently wins; else reduce ranking + projection trust.
 * INSUFFICIENT_DATA: never treat as clean coexistence; bounded uncertainty only.
 */

export const SAME_TEAM_OPPORTUNITY_VERSION = "same-team-opportunity-v3-incomplete";
export const OPPORTUNITY_ASSESSMENT = Object.freeze([
  "SUPPORTED",
  "CONTRADICTED",
  "INSUFFICIENT_DATA",
]);
/** @deprecated Prefer opportunityAssessment; kept for graduated penalty banding. */
export const OPPORTUNITY_STATUS = Object.freeze([
  "SUPPORTED",
  "QUESTIONABLE",
  "CONTRADICTED",
  "INSUFFICIENT_DATA",
]);

/** Bounded uncertainty penalty — does not force flip/Under/reject. */
export const INSUFFICIENT_OPPORTUNITY_RANKING_PENALTY = 14;
export const INSUFFICIENT_OPPORTUNITY_TRUST_MULT = 0.94;

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

function readFiniteCandidate(...candidates) {
  for (const raw of candidates) {
    if (raw == null || raw === "") continue;
    const n = Number(raw);
    if (Number.isFinite(n)) return { value: n, present: true };
  }
  return { value: 0, present: false };
}

/**
 * Resolve implied team total from pick / game context (home vs away).
 */
export function resolveImpliedTeamTotal(pick = {}) {
  return resolveImpliedTeamTotalWithSource(pick).value;
}

export function resolveImpliedTeamTotalWithSource(pick = {}) {
  const card = pick.wnbaDataCard || {};
  const ctx = pick.wnbaGameContext || {};
  const env = card.gameEnvironment || {};

  const direct = readFiniteCandidate(
    pick.impliedTeamTotal,
    pick.impliedTeamTotalAudit?.value,
    ctx.impliedTeamTotal,
    env.impliedTeamTotal
  );
  if (direct.present && direct.value > 0) {
    return { value: direct.value, source: "direct_implied_team_total" };
  }

  const team = cleanTeam(pick.team || pick.teamKey || ctx.playerTeam);
  const home = cleanTeam(ctx.homeTeam || pick.homeTeam || card.homeTeam);
  const away = cleanTeam(ctx.awayTeam || pick.awayTeam || card.awayTeam);
  const homeTotal = readFiniteCandidate(ctx.impliedHomeTotal, env.impliedHomeTotal);
  const awayTotal = readFiniteCandidate(ctx.impliedAwayTotal, env.impliedAwayTotal);

  if (team && home && team === home && homeTotal.present && homeTotal.value > 0) {
    return { value: homeTotal.value, source: "implied_home_total" };
  }
  if (team && away && team === away && awayTotal.present && awayTotal.value > 0) {
    return { value: awayTotal.value, source: "implied_away_total" };
  }

  if (homeTotal.present && homeTotal.value > 0 && !(awayTotal.present && awayTotal.value > 0)) {
    return { value: homeTotal.value, source: "implied_home_total_fallback" };
  }
  if (awayTotal.present && awayTotal.value > 0 && !(homeTotal.present && homeTotal.value > 0)) {
    return { value: awayTotal.value, source: "implied_away_total_fallback" };
  }
  return { value: 0, source: null };
}

function pickMetrics(pick = {}) {
  const card = pick.wnbaDataCard || {};
  const proj = readFiniteCandidate(
    pick.projection,
    card.projection?.projection,
    card.projection
  );
  const fga = readFiniteCandidate(
    pick.expectedFGA,
    card.projection?.expectedFGA,
    card.last5?.fga,
    pick.recentFGA
  );
  const fta = readFiniteCandidate(
    pick.expectedFTA,
    card.projection?.expectedFTA,
    card.last5?.fta,
    pick.recentFTA
  );
  const teamTotal = resolveImpliedTeamTotalWithSource(pick);

  return {
    player: pick.player,
    playerId: pick.playerId || card.playerId || null,
    teamKey: cleanTeam(pick.team || pick.teamKey),
    line: num(pick.line ?? card.bookLine),
    projection: proj.value,
    projectionPresent: proj.present && proj.value > 0,
    expectedFga: fga.value,
    expectedFgaPresent: fga.present && fga.value > 0,
    expectedFta: fta.value,
    expectedFtaPresent: fta.present,
    recentMinutes: num(card.last5?.minutes ?? pick.recentMinutes),
    pickScore: num(pick.bestPropScore ?? pick.pickScore ?? pick.confidence),
    underGap: num(pick.underGap ?? pick.wnbaReader?.underGap),
    overGap: num(pick.overGap ?? pick.wnbaReader?.overGap),
    underCaseScore: num(pick.wnbaReader?.underCase?.score ?? pick.underCaseScore),
    overCaseScore: num(pick.wnbaReader?.overCase?.score ?? pick.overCaseScore),
    impliedTeamTotal: teamTotal.value,
    impliedTeamTotalSource: teamTotal.source,
  };
}

/**
 * Completeness gate — SUPPORTED requires honest budget + usage inputs.
 */
export function assessOpportunityDataCompleteness(overs = [], demands = null) {
  const rows = demands || overs.map(pickMetrics);
  const missingOpportunityInputs = [];
  const peerCountExpected = Math.max(overs.length, rows.length);
  const peerCountEvaluated = rows.filter((d) => d.teamKey && d.projectionPresent).length;

  const teamKeys = [...new Set(rows.map((d) => d.teamKey).filter(Boolean))];
  if (teamKeys.length !== 1) {
    missingOpportunityInputs.push("team_identity");
  }

  const budgetRow = rows.find((d) => d.impliedTeamTotal > 0);
  const teamBudgetAvailable = budgetRow ? budgetRow.impliedTeamTotal : 0;
  const impliedTeamTotalSource = budgetRow?.impliedTeamTotalSource || null;
  if (!(teamBudgetAvailable > 0)) {
    missingOpportunityInputs.push("implied_team_total");
  }

  if (peerCountExpected < 2) {
    missingOpportunityInputs.push("peer_membership");
  }

  for (const row of rows) {
    if (!row.projectionPresent) {
      missingOpportunityInputs.push(`projection:${row.player || "unknown"}`);
    }
    if (!row.expectedFgaPresent) {
      missingOpportunityInputs.push(`expected_fga:${row.player || "unknown"}`);
    }
    if (!row.expectedFtaPresent) {
      missingOpportunityInputs.push(`expected_fta:${row.player || "unknown"}`);
    }
  }

  if (peerCountEvaluated < peerCountExpected) {
    missingOpportunityInputs.push("peer_props_incomplete");
  }

  const uniqueMissing = [...new Set(missingOpportunityInputs)];
  return {
    opportunityDataComplete: uniqueMissing.length === 0,
    missingOpportunityInputs: uniqueMissing,
    impliedTeamTotalSource,
    peerCountExpected,
    peerCountEvaluated,
    teamBudgetAvailable: teamBudgetAvailable > 0 ? teamBudgetAvailable : null,
  };
}

function buildSharedAuditFields(completeness, combined, opportunityAssessment) {
  return {
    opportunityAssessment,
    opportunityDataComplete: completeness.opportunityDataComplete,
    missingOpportunityInputs: completeness.missingOpportunityInputs,
    impliedTeamTotalSource: completeness.impliedTeamTotalSource,
    peerCountExpected: completeness.peerCountExpected,
    peerCountEvaluated: completeness.peerCountEvaluated,
    combinedProjectedPoints: combined.combinedPlayerProjected,
    combinedExpectedFGA: combined.combinedExpectedFga,
    combinedExpectedFTA: combined.combinedExpectedFta,
    teamBudgetAvailable: completeness.teamBudgetAvailable,
  };
}

/**
 * Opportunity budget for a same-team Over cluster.
 */
export function evaluateSameTeamOpportunityCluster(overs = []) {
  const reasons = [];
  const demands = overs.map(pickMetrics);
  const completeness = assessOpportunityDataCompleteness(overs, demands);

  const projectedTeamPoints = completeness.teamBudgetAvailable || 0;
  const combinedPlayerProjected = demands.reduce((s, d) => s + d.projection, 0);
  const combinedExpectedFga = demands.reduce((s, d) => s + d.expectedFga, 0);
  const combinedExpectedFta = demands.reduce((s, d) => s + d.expectedFta, 0);
  const combined = {
    combinedPlayerProjected: Number(combinedPlayerProjected.toFixed(1)),
    combinedExpectedFga: Number(combinedExpectedFga.toFixed(1)),
    combinedExpectedFta: Number(combinedExpectedFta.toFixed(1)),
  };

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

  // Incomplete inputs never claim SUPPORTED / clean coexistence.
  if (!completeness.opportunityDataComplete) {
    reasons.push(
      `Opportunity data incomplete: ${completeness.missingOpportunityInputs.join(", ")}.`
    );
    reasons.push("Incomplete inputs cannot prove same-team Overs coexist safely.");

    const propAudits = new Map();
    for (let i = 0; i < demands.length; i += 1) {
      const row = demands[i];
      propAudits.set(row.player, {
        player: row.player,
        status: "INSUFFICIENT_DATA",
        ...buildSharedAuditFields(completeness, combined, "INSUFFICIENT_DATA"),
        pressureScore: 0,
        rankingPenalty: INSUFFICIENT_OPPORTUNITY_RANKING_PENALTY,
        projectionTrustMultiplier: INSUFFICIENT_OPPORTUNITY_TRUST_MULT,
        opportunityPenaltyApplied: INSUFFICIENT_OPPORTUNITY_RANKING_PENALTY,
        topPairAllowed: false,
        topPairBlockReason: "INSUFFICIENT_OPPORTUNITY_DATA",
        recommendation: "HOLD_UNCERTAIN_NO_FORCE",
        allowFlipEval: false,
        strengthRank: demands.length - i,
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
      status: "INSUFFICIENT_DATA",
      opportunityAssessment: "INSUFFICIENT_DATA",
      ...buildSharedAuditFields(completeness, combined, "INSUFFICIENT_DATA"),
      pressureScore: 0,
      projectedTeamPoints: projectedTeamPoints > 0 ? projectedTeamPoints : null,
      combinedPlayerProjected: combined.combinedPlayerProjected,
      combinedExpectedFga: combined.combinedExpectedFga,
      combinedExpectedFta: combined.combinedExpectedFta,
      usageShare: usageShare != null ? Number(usageShare.toFixed(3)) : null,
      remainingOpportunity:
        remainingOpportunity != null ? Number(remainingOpportunity.toFixed(1)) : null,
      weakestPlayer: null,
      opportunityPenaltyApplied: INSUFFICIENT_OPPORTUNITY_RANKING_PENALTY,
      topPairAllowed: false,
      topPairBlockReason: "INSUFFICIENT_OPPORTUNITY_DATA",
      reasons: reasons.slice(0, 8),
      propAudits,
      players: overs.map((p) => p.player),
    };
  }

  let pressureScore = 0;
  if (overs.length >= 2) pressureScore += 12;
  if (overs.length >= 3) pressureScore += 18;
  if (overs.length >= 4) pressureScore += 10;

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

  const thinOvers = demands.filter((d) => d.projection - d.line < 2.0).length;
  if (thinOvers >= 2 && overs.length >= 2) {
    pressureScore += 10;
    reasons.push(`${thinOvers} clustered Overs carry thin projection edges.`);
  }

  pressureScore = Math.max(0, Math.min(100, pressureScore));

  // Complete data only: SUPPORTED when math positively supports coexistence.
  let status = "SUPPORTED";
  let opportunityAssessment = "SUPPORTED";
  if (pressureScore >= 42) {
    status = "CONTRADICTED";
    opportunityAssessment = "CONTRADICTED";
  } else if (pressureScore >= 24) {
    // Graduated conflict band — still CONTRADICTED for assessment (not clean).
    status = "QUESTIONABLE";
    opportunityAssessment = "CONTRADICTED";
  }

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
    let opportunityPenaltyApplied = 0;
    let topPairAllowed = true;
    let topPairBlockReason = null;

    if (status === "QUESTIONABLE") {
      rankingPenalty = Math.max(0, 18 - i * 5);
      projectionTrustMultiplier = i === 0 ? 0.86 : Math.max(0.9, 0.96 - i * 0.02);
      recommendation = i === 0 ? "MONITOR" : "REDUCE_RANKING";
      opportunityPenaltyApplied = rankingPenalty;
      topPairAllowed = true;
    }
    if (status === "CONTRADICTED") {
      rankingPenalty = Math.max(0, 36 - i * 8);
      projectionTrustMultiplier = i === 0 ? 0.72 : Math.max(0.8, 0.9 - i * 0.04);
      allowFlipEval = i === 0;
      recommendation = allowFlipEval
        ? "EVALUATE_UNDER_INDEPENDENTLY"
        : "REDUCE_RANKING_NO_FORCE_UNDER";
      opportunityPenaltyApplied = rankingPenalty;
      if (i === 0) {
        reasons.push(
          `Weakest projection identified: ${row.player} — full Under eval only if Under independently wins.`
        );
      }
    }

    propAudits.set(row.player, {
      player: row.player,
      status,
      ...buildSharedAuditFields(completeness, combined, opportunityAssessment),
      pressureScore,
      rankingPenalty,
      projectionTrustMultiplier,
      opportunityPenaltyApplied,
      topPairAllowed,
      topPairBlockReason,
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
    opportunityAssessment,
    ...buildSharedAuditFields(completeness, combined, opportunityAssessment),
    pressureScore,
    projectedTeamPoints: projectedTeamPoints > 0 ? projectedTeamPoints : null,
    combinedPlayerProjected: combined.combinedPlayerProjected,
    combinedExpectedFga: combined.combinedExpectedFga,
    combinedExpectedFta: combined.combinedExpectedFta,
    usageShare: usageShare != null ? Number(usageShare.toFixed(3)) : null,
    remainingOpportunity:
      remainingOpportunity != null ? Number(remainingOpportunity.toFixed(1)) : null,
    weakestPlayer: weakest?.player || null,
    opportunityPenaltyApplied:
      opportunityAssessment === "SUPPORTED"
        ? 0
        : Math.max(
            ...[...propAudits.values()].map((a) => num(a.opportunityPenaltyApplied)),
            0
          ),
    topPairAllowed: true,
    topPairBlockReason: null,
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
      opportunityAssessment: cluster.opportunityAssessment,
      opportunityDataComplete: cluster.opportunityDataComplete,
      missingOpportunityInputs: cluster.missingOpportunityInputs,
      pressureScore: cluster.pressureScore,
      projectedTeamPoints: cluster.projectedTeamPoints,
      combinedPlayerProjected: cluster.combinedPlayerProjected,
      remainingOpportunity: cluster.remainingOpportunity,
      usageShare: cluster.usageShare,
      combinedExpectedFga: cluster.combinedExpectedFga,
      weakestPlayer: cluster.weakestPlayer,
      players: cluster.players,
      reasons: cluster.reasons,
      topPairAllowed: cluster.topPairAllowed,
      topPairBlockReason: cluster.topPairBlockReason,
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
    supportedClusters: teamClusters.filter(
      (c) => c.opportunityAssessment === "SUPPORTED"
    ).length,
    questionableClusters: teamClusters.filter((c) => c.status === "QUESTIONABLE").length,
    contradictedClusters: teamClusters.filter(
      (c) => c.opportunityAssessment === "CONTRADICTED"
    ).length,
    insufficientClusters: teamClusters.filter(
      (c) => c.opportunityAssessment === "INSUFFICIENT_DATA"
    ).length,
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
      sameTeamOpportunityAssessment: audit.opportunityAssessment,
      sameTeamOpportunityAudit: audit,
      projectionTrustMultiplier: Math.min(priorTrust, trustMult),
      sameTeamOpportunityTrustMult: trustMult,
      // Keep slateCollisionPenalty channel so Best 6 scoring continues to subtract
      slateCollisionPenalty: Math.max(num(pick.slateCollisionPenalty), rankingPenalty),
      slateCollisionAudit: {
        ...(pick.slateCollisionAudit || {}),
        opportunityVersion: SAME_TEAM_OPPORTUNITY_VERSION,
        status: audit.status,
        opportunityAssessment: audit.opportunityAssessment,
        opportunityDataComplete: audit.opportunityDataComplete,
        missingOpportunityInputs: audit.missingOpportunityInputs,
        pressureScore: audit.pressureScore,
        rankingPenalty,
        opportunityPenaltyApplied: audit.opportunityPenaltyApplied,
        projectionTrustMultiplier: trustMult,
        recommendation: audit.recommendation,
        topPairAllowed: audit.topPairAllowed,
        topPairBlockReason: audit.topPairBlockReason,
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

function buildNoPeerResult(pick = {}, side = "") {
  return {
    version: SAME_TEAM_OPPORTUNITY_VERSION,
    detected: false,
    status: null,
    opportunityAssessment: null,
    opportunityDataComplete: true,
    missingOpportunityInputs: [],
    impliedTeamTotalSource: resolveImpliedTeamTotalWithSource(pick).source,
    peerCountExpected: 0,
    peerCountEvaluated: 0,
    combinedProjectedPoints: null,
    combinedExpectedFGA: null,
    combinedExpectedFTA: null,
    teamBudgetAvailable: null,
    opportunityPenaltyApplied: 0,
    topPairAllowed: true,
    topPairBlockReason: null,
    collisionScore: 0,
    pressureScore: 0,
    teammatesInConflict: [],
    sideImpact: "NEUTRAL",
    recommendation: side === "OVER" ? "KEEP_OVER" : "KEEP_UNDER",
    autoFlip: false,
    rankingPenalty: 0,
    projectionTrustMultiplier: 1,
    reasons:
      side !== "OVER"
        ? ["Not a same-team Over opportunity case."]
        : ["No teammate Over peers — not a same-team collision case."],
  };
}

function buildInsufficientPeerDataResult(pick = {}) {
  const teamTotal = resolveImpliedTeamTotalWithSource(pick);
  const metrics = pickMetrics(pick);
  const missing = ["peer_roster"];
  if (!(teamTotal.value > 0)) missing.push("implied_team_total");
  if (!metrics.projectionPresent) missing.push("projection");
  if (!metrics.expectedFgaPresent) missing.push("expected_fga");
  if (!metrics.expectedFtaPresent) missing.push("expected_fta");
  if (!metrics.teamKey) missing.push("team_identity");

  return {
    version: SAME_TEAM_OPPORTUNITY_VERSION,
    detected: true,
    status: "INSUFFICIENT_DATA",
    opportunityAssessment: "INSUFFICIENT_DATA",
    opportunityDataComplete: false,
    missingOpportunityInputs: missing,
    impliedTeamTotalSource: teamTotal.source,
    peerCountExpected: 1,
    peerCountEvaluated: 0,
    combinedProjectedPoints: metrics.projectionPresent ? metrics.projection : null,
    combinedExpectedFGA: metrics.expectedFgaPresent ? metrics.expectedFga : null,
    combinedExpectedFTA: metrics.expectedFtaPresent ? metrics.expectedFta : null,
    teamBudgetAvailable: teamTotal.value > 0 ? teamTotal.value : null,
    opportunityPenaltyApplied: INSUFFICIENT_OPPORTUNITY_RANKING_PENALTY,
    topPairAllowed: false,
    topPairBlockReason: "INSUFFICIENT_PEER_DATA",
    collisionScore: 0,
    pressureScore: 0,
    teammatesInConflict: [],
    sideImpact: "NEUTRAL",
    recommendation: "HOLD_UNCERTAIN_NO_FORCE",
    autoFlip: false,
    rankingPenalty: INSUFFICIENT_OPPORTUNITY_RANKING_PENALTY,
    projectionTrustMultiplier: INSUFFICIENT_OPPORTUNITY_TRUST_MULT,
    reasons: [
      "Peer roster unavailable — same-team opportunity cannot be evaluated.",
      "Incomplete peer data is not proof that coexistence is safe.",
    ],
  };
}

/**
 * Per-pick opportunity eval for Flip-First / DDI (replaces simple collision).
 */
export function evaluateSameTeamOpportunityForPick(pick = {}, options = {}) {
  const side = normalizeSide(options.side || pick.side || pick.pick);
  const teamKey = cleanTeam(pick.team || pick.teamKey);

  if (side !== "OVER") {
    return buildNoPeerResult(pick, side);
  }

  if (!teamKey) {
    return {
      ...buildInsufficientPeerDataResult(pick),
      missingOpportunityInputs: ["team_identity", "peer_roster"],
      reasons: [
        "Team identity missing — same-team opportunity cannot be evaluated.",
      ],
    };
  }

  const rawCandidates = options.teamCandidates ?? options.slateCandidates;
  if (rawCandidates == null) {
    // Case D — peer list was never supplied (cannot claim clear).
    return buildInsufficientPeerDataResult(pick);
  }

  const peers = (Array.isArray(rawCandidates) ? rawCandidates : []).filter((c) => {
    if (cleanTeam(c.team || c.teamKey) !== teamKey) return false;
    if (String(c.player || "").toLowerCase() === String(pick.player || "").toLowerCase()) {
      return false;
    }
    return isPointsOver(c);
  });

  if (peers.length === 0) {
    // Case F — candidates provided; no same-team Over peer exists.
    return buildNoPeerResult(pick, side);
  }

  const cluster = evaluateSameTeamOpportunityCluster([pick, ...peers]);
  const audit = cluster.propAudits.get(pick.player) || {};
  const flipOk = underIndependentlyWins(pick, audit);

  let recommendation = "KEEP_OVER";
  let sideImpact = "NEUTRAL";
  if (cluster.opportunityAssessment === "INSUFFICIENT_DATA") {
    recommendation = "HOLD_UNCERTAIN_NO_FORCE";
  } else if (cluster.opportunityAssessment === "CONTRADICTED") {
    if (audit.allowFlipEval && flipOk) {
      recommendation = "FLIP_TO_UNDER";
      sideImpact = "UNDER";
    } else {
      recommendation =
        audit.recommendation || "REDUCE_RANKING_NO_FORCE_UNDER";
      sideImpact = "NEUTRAL";
    }
  }

  return {
    version: SAME_TEAM_OPPORTUNITY_VERSION,
    detected: true,
    status: cluster.status,
    opportunityAssessment: cluster.opportunityAssessment,
    opportunityDataComplete: cluster.opportunityDataComplete,
    missingOpportunityInputs: cluster.missingOpportunityInputs,
    impliedTeamTotalSource: cluster.impliedTeamTotalSource,
    peerCountExpected: cluster.peerCountExpected,
    peerCountEvaluated: cluster.peerCountEvaluated,
    combinedProjectedPoints: cluster.combinedPlayerProjected,
    combinedExpectedFGA: cluster.combinedExpectedFga,
    combinedExpectedFTA: cluster.combinedExpectedFta,
    teamBudgetAvailable: cluster.teamBudgetAvailable,
    opportunityPenaltyApplied:
      audit.opportunityPenaltyApplied ?? cluster.opportunityPenaltyApplied ?? 0,
    topPairAllowed: audit.topPairAllowed !== false,
    topPairBlockReason: audit.topPairBlockReason || null,
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
