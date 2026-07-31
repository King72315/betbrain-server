/**
 * CourtEdge Same-Team Opportunity Engine V2
 *
 * Decision engine (not a warning layer): when multiple meaningful same-team
 * Points Overs compete, pick the primary Over by Opportunity Strength Score,
 * then fully re-evaluate secondary scorers as Under candidates.
 *
 * Does not invent evidence. Does not force Under. Does not touch lifecycle/UI.
 */

import { evaluateWnbaTrackingEligibility } from "../wnbaResultsQualityGate.js";
import { applyDecisionIntelligenceToPick } from "../../decisionIntelligence/propDecisionIntelligenceV1.js";
import {
  applySideRescueToPick,
  evaluateSideRescue,
} from "../../decisionIntelligence/sideRescueEngineV1.js";
import { syncWnbaDataModeOnPick } from "../wnbaGateInputs.js";
import { runFlipFirstDecisionPipeline } from "../../decisionIntelligence/decisionDataIntelligenceV1.js";
import { finalizeCanonicalDecision } from "../../decisionIntelligence/sideSelectionTrustV1.js";
import { resolveImpliedTeamTotal } from "./sameTeamOpportunityEngineV1.js";
import { finalizeSameTeamForcedUnderPresentation } from "./sameTeamForcedSidePresentationV1.js";

export const SAME_TEAM_OPPORTUNITY_V2_VERSION = "same-team-opportunity-v2";
export const SAME_TEAM_OPPORTUNITY_V2_BUILD =
  "courteedge-same-team-arbitration-integrity-v1";

const DEMOTED_RANKING_PENALTY = 42;
const PRIMARY_RANKING_BOOST = 8;
const MIN_MEANINGFUL_MINUTES = 16;
const BENCH_IDENTITIES = new Set(["BENCH_MICROWAVE"]);

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cleanTeam(team = "") {
  return String(team || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Prefer provider canonical team ID so MN–SEA aliases cluster correctly. */
function resolveTeamClusterKey(pick = {}) {
  const canonical =
    pick.providerIdentity?.canonicalTeamId ||
    pick.canonicalTeamId ||
    pick.teamCanonicalId ||
    "";
  if (canonical) return cleanTeam(canonical);
  return cleanTeam(pick.team || pick.teamKey);
}

function cleanPlayer(player = "") {
  return String(player || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function isPointsProp(pick = {}) {
  const stat = String(pick.stat || pick.propType || "points").toLowerCase();
  return stat.includes("point") || stat === "pts" || !pick.stat;
}

function isPointsOver(pick = {}) {
  return isPointsProp(pick) && normalizeSide(pick.side || pick.pick) === "OVER";
}

function gameKey(pick = {}) {
  return String(
    pick.gameId ||
      pick.gameKey ||
      pick.gameLabel ||
      pick.game ||
      `${cleanTeam(pick.team)}|${cleanTeam(pick.opponent)}`
  )
    .toLowerCase()
    .replace(/[^a-z0-9|@]/g, "");
}

function roleIdentity(pick = {}) {
  return String(
    pick.playerRoleIdentity?.identity ||
      pick.playerIntelligence?.roleIdentity ||
      pick.playerRoleProfile?.identity ||
      pick.playerIntelligenceProfile?.roleIdentity ||
      ""
  ).toUpperCase();
}

function expectedMinutes(pick = {}) {
  const card = pick.wnbaDataCard || {};
  return num(
    pick.expectedMinutes ??
      card.projection?.expectedMinutes ??
      pick.recentMinutes ??
      card.last5?.minutes ??
      pick.minutesAverage,
    0
  );
}

/**
 * Phase 1 — meaningful scoring option (not a pure bench role).
 */
export function isMeaningfulScorer(pick = {}) {
  if (!isPointsOver(pick)) return false;
  if (pick.noPlay || String(pick.trackingEligibility || "").toUpperCase() === "NO_BET") {
    // Still allow arbitration input if currently Over on board; NO_BET later demotes.
  }

  const mins = expectedMinutes(pick);
  const identity = roleIdentity(pick);
  if (BENCH_IDENTITIES.has(identity) && mins > 0 && mins < 20) return false;
  if (mins > 0 && mins < MIN_MEANINGFUL_MINUTES) return false;

  const projection = num(
    pick.projection ?? pick.wnbaDataCard?.projection?.projection,
    0
  );
  const line = num(pick.line ?? pick.officialLine, 0);
  if (projection > 0 && line > 0 && projection + 0.5 < line) return false;

  return true;
}

/**
 * Phase 2 — Opportunity Strength Score from existing evidence only.
 */
export function computeOpportunityStrengthScore(pick = {}, clusterContext = {}) {
  const card = pick.wnbaDataCard || {};
  const reader = pick.wnbaReader || {};
  const ddi = pick.decisionDataIntelligence || {};
  const line = num(pick.line ?? pick.officialLine);
  const projection = num(
    pick.projection ?? card.projection?.projection ?? card.projection
  );
  const overGap = num(
    pick.overGap ?? reader.overGap ?? (projection && line ? projection - line : 0)
  );
  const minutes = expectedMinutes(pick);
  const expectedFga = num(
    pick.expectedFGA ?? card.projection?.expectedFGA ?? card.last5?.fga ?? pick.recentFGA
  );
  const expectedFta = num(
    pick.expectedFTA ?? card.projection?.expectedFTA ?? card.last5?.fta ?? pick.recentFTA
  );
  const usage =
    num(ddi.usageShare?.share ?? ddi.usageShare) ||
    num(pick.sameTeamOpportunityAudit?.usageShare) ||
    (clusterContext.teamTotal > 0 && projection > 0
      ? projection / clusterContext.teamTotal
      : 0);
  const readerOver = num(reader.overCase?.score ?? pick.overCaseScore);
  const confidence = num(
    pick.confidence ?? pick.finalConfidence ?? pick.winProbability,
    50
  );
  const marketQuality = num(pick.marketQuality ?? ddi.marketIntelligence?.quality);
  const fairAgrees =
    String(pick.fairLineSide || "").toUpperCase() === "OVER" ||
    String(ddi.marketIntelligence?.fairLineSide || "").toUpperCase() === "OVER";
  const last5 = num(card.last5?.points ?? pick.last5Average);
  const season = num(card.season?.points ?? pick.seasonAverage);
  const recentForm = line > 0 && last5 > 0 ? last5 - line : 0;
  const seasonForm = line > 0 && season > 0 ? season - line : 0;
  const identity = roleIdentity(pick);
  const identityBoost =
    identity === "VOLUME_SCORER" || identity === "USAGE_DRIVEN"
      ? 8
      : identity === "STABLE_STARTER" || identity === "EFFICIENCY_SCORER"
        ? 5
        : identity === "EMERGING_ROLE"
          ? 2
          : identity === "BENCH_MICROWAVE" || identity === "DECLINING_ROLE"
            ? -6
            : 0;
  const scoringShare =
    clusterContext.teamTotal > 0 && projection > 0
      ? clamp((projection / clusterContext.teamTotal) * 100, 0, 40)
      : clamp(usage * 40, 0, 40);

  let score = 0;
  score += clamp(overGap * 10, -15, 35);
  score += clamp(minutes * 0.9, 0, 28);
  score += clamp(expectedFga * 1.6, 0, 24);
  score += clamp(expectedFta * 1.2, 0, 12);
  score += clamp(usage * 30, 0, 18);
  score += clamp(readerOver * 0.25, -5, 20);
  score += clamp((confidence - 50) * 0.35, -12, 18);
  score += clamp(marketQuality * 0.12, 0, 12);
  if (fairAgrees) score += 6;
  score += clamp(recentForm * 2.5, -10, 14);
  score += clamp(seasonForm * 1.5, -8, 10);
  score += identityBoost;
  score += scoringShare * 0.35;
  score += num(pick.sameTeamOpportunityAudit?.remainingOpportunity)
    ? clamp(num(pick.sameTeamOpportunityAudit.remainingOpportunity) * 0.15, -6, 8)
    : 0;

  return {
    opportunityStrengthScore: Number(clamp(score, 0, 100).toFixed(2)),
    components: {
      overGap,
      minutes,
      expectedFga,
      expectedFta,
      usage: Number(usage.toFixed(3)),
      readerOver,
      confidence,
      marketQuality,
      fairAgrees,
      recentForm,
      seasonForm,
      identity,
      scoringShare: Number(scoringShare.toFixed(2)),
      projection,
      line,
    },
  };
}

/**
 * Phase 4 — full pipeline re-run treating the prop as originally Under.
 */
export function reevaluatePropAsUnderCandidate(pick = {}, options = {}) {
  if (!pick?.player) {
    return { ok: false, pick: null, message: "missing_pick" };
  }

  let enriched = {
    ...pick,
    initialSide: "UNDER",
    side: "Under",
    pick: "Under",
    lockedSide: undefined,
    sideRescue: null,
    flipFirstDecision: null,
    flipFirstAction: null,
    decisionHash: null,
    sideSelectionBundle: null,
    sameTeamOpportunityV2UnderEval: true,
  };

  enriched = syncWnbaDataModeOnPick(
    enriched,
    enriched.wnbaDataCard,
    enriched.wnbaReader
  );

  enriched = runFlipFirstDecisionPipeline(enriched, {
    dataCard: enriched.wnbaDataCard,
    reader: enriched.wnbaReader,
    originalSide: "UNDER",
    teamCandidates: options.teamCandidates,
    slateCandidates: options.slateCandidates || options.teamCandidates,
    impliedTeamTotal:
      enriched.impliedTeamTotalAudit?.value ??
      enriched.wnbaGameContext?.impliedTeamTotal ??
      options.impliedTeamTotal,
  });

  const gate = evaluateWnbaTrackingEligibility(
    enriched,
    enriched.wnbaDataCard,
    enriched.wnbaReader
  );
  enriched = applyDecisionIntelligenceToPick(enriched, null, gate);

  const sideRescue = evaluateSideRescue(enriched, {
    decisionIntelligence: enriched.decisionIntelligence || {},
    gate,
    dataCard: enriched.wnbaDataCard,
    reader: enriched.wnbaReader,
    originalSide: "UNDER",
    flipFirstDecision:
      enriched.flipFirstDecision ||
      enriched.decisionDataIntelligence?.flipFirstDecision,
  });
  enriched = applySideRescueToPick(enriched, sideRescue, {
    dataCard: enriched.wnbaDataCard,
    reader: enriched.wnbaReader,
  });

  if (sideRescue.action === "FLIP_SIDE" && sideRescue.finalSide) {
    const flippedGate = evaluateWnbaTrackingEligibility(
      enriched,
      enriched.wnbaDataCard,
      enriched.wnbaReader
    );
    enriched = applyDecisionIntelligenceToPick(enriched, null, flippedGate);
    enriched = applySideRescueToPick(enriched, sideRescue, {
      dataCard: enriched.wnbaDataCard,
      reader: enriched.wnbaReader,
    });
  }

  enriched = finalizeCanonicalDecision(enriched);
  enriched.decisionRecomputed = true;
  enriched.decisionRecomputeReason = "same_team_opportunity_v2_under_eval";

  return {
    ok: true,
    pick: enriched,
    finalSide: normalizeSide(enriched.side || enriched.pick),
    gate,
    sideRescue,
  };
}

/**
 * Phase 5 — Under independently qualifies (no fabricated evidence).
 */
export function underCandidateQualifies(pick = {}) {
  const side = normalizeSide(pick.side || pick.pick);
  if (side !== "UNDER") return false;

  const eligibility = String(
    pick.decisionIntelligence?.trackEligibility ||
      pick.trackingEligibility ||
      pick.wnbaTrackingDecision ||
      ""
  ).toUpperCase();
  if (eligibility === "NO_BET") return false;

  const underGap = num(pick.underGap ?? pick.wnbaReader?.underGap);
  const underCase = num(pick.wnbaReader?.underCase?.score ?? pick.underCaseScore);
  const overCase = num(pick.wnbaReader?.overCase?.score ?? pick.overCaseScore);
  const rescue = String(pick.sideRescue?.action || "").toUpperCase();

  if (rescue === "NO_BET" || rescue === "NO_DECISIVE_RESCUE") return false;

  // Integrity: BOARD_ONLY alone is not enough to keep a forced Under.
  if (eligibility === "BOARD_ONLY") return false;

  if (eligibility === "TRACK") {
    // Still require a real Under edge — not a projection still above the line.
    const line = num(pick.line ?? pick.selectedLine);
    const projection = num(pick.projection ?? pick.projectedPoints);
    if (line != null && projection != null && projection > line) return false;
    return underGap >= 1.5 || underCase >= overCase + 4;
  }

  // Independent reader/gap evidence — same spirit as V1 underIndependentlyWins.
  const gapOk = underGap >= 1.5;
  const caseOk =
    underCase > 0 && overCase > 0 ? underCase >= overCase + 4 : underGap >= 2.0;
  return Boolean(gapOk && caseOk);
}

function pickKey(pick = {}) {
  return [
    resolveTeamClusterKey(pick),
    cleanPlayer(pick.player),
    gameKey(pick),
    num(pick.line ?? pick.officialLine),
  ].join("|");
}

/**
 * Phase 1–5 arbitration across a candidate slate.
 * Runs before Best 6 / Top 2 selection.
 */
export function arbitrateSameTeamOpportunityV2(candidates = [], options = {}) {
  const list = Array.isArray(candidates) ? candidates : [];
  const audit = {
    version: SAME_TEAM_OPPORTUNITY_V2_VERSION,
    build: SAME_TEAM_OPPORTUNITY_V2_BUILD,
    evaluatedAt: new Date().toISOString(),
    clusters: [],
    primaryKeptOver: 0,
    secondaryFlippedUnder: 0,
    secondaryDemoted: 0,
    singlesSkipped: 0,
  };

  // Group meaningful Points Overs by team + game.
  const clusters = new Map();
  for (const pick of list) {
    if (String(pick.league || "").toUpperCase() !== "WNBA") continue;
    if (!isMeaningfulScorer(pick)) continue;
    const team = resolveTeamClusterKey(pick);
    if (!team) continue;
    const key = `${team}::${gameKey(pick)}`;
    if (!clusters.has(key)) clusters.set(key, []);
    clusters.get(key).push(pick);
  }

  const decisions = new Map(); // pickKey → patch

  for (const [clusterKey, overs] of clusters.entries()) {
    if (overs.length < 2) {
      audit.singlesSkipped += 1;
      continue;
    }

    const teamTotal = resolveImpliedTeamTotal(overs[0]) || 0;
    const ranked = overs
      .map((pick) => {
        const strength = computeOpportunityStrengthScore(pick, { teamTotal });
        return { pick, ...strength };
      })
      .sort(
        (a, b) =>
          b.opportunityStrengthScore - a.opportunityStrengthScore ||
          num(b.components.overGap) - num(a.components.overGap) ||
          num(b.components.minutes) - num(a.components.minutes)
      );

    const primary = ranked[0];
    const secondaries = ranked.slice(1);
    const clusterAudit = {
      clusterKey,
      team: resolveTeamClusterKey(primary.pick),
      gameKey: gameKey(primary.pick),
      players: ranked.map((r) => r.pick.player),
      primaryPlayer: primary.pick.player,
      primaryScore: primary.opportunityStrengthScore,
      secondaries: [],
    };

    decisions.set(pickKey(primary.pick), {
      role: "PRIMARY_OVER",
      opportunityStrengthScore: primary.opportunityStrengthScore,
      opportunityStrengthComponents: primary.components,
      rankingBoost: PRIMARY_RANKING_BOOST,
      rankingPenalty: 0,
      primaryPlayer: primary.pick.player,
      clusterKey,
    });
    audit.primaryKeptOver += 1;

    for (const secondary of secondaries) {
      // Integrity rule: keep stronger Over; only flip weaker teammate when
      // independent organic Under evidence supports it. Otherwise DROP + replace.
      const underResult = reevaluatePropAsUnderCandidate(secondary.pick, {
        slateCandidates: list,
        teamCandidates: overs,
        impliedTeamTotal: teamTotal || options.impliedTeamTotal,
      });
      const underPickRaw = underResult.pick || {
        ...secondary.pick,
        side: "Under",
        pick: "Under",
        initialSide: "UNDER",
      };
      const independentlyQualified =
        underResult.ok && underCandidateQualifies(underPickRaw);

      // Attach temporary fields for integrity unsupported check
      const probePick = {
        ...underPickRaw,
        side: "Under",
        pick: "Under",
        originalModelSide: "OVER",
        sameTeamArbitrationFlip: true,
        independentlyQualifiedUnder: independentlyQualified,
        sameTeamOpportunityV2: {
          independentlyQualifiedUnder: independentlyQualified,
          role: "SECONDARY_UNDER",
        },
        organicUnderEvidence: independentlyQualified ? "ok" : "weak",
        organicEvidenceStrength: independentlyQualified ? "ok" : "weak",
        projection: underPickRaw.projection ?? secondary.pick.projection,
        fairLine: underPickRaw.fairLine ?? secondary.pick.fairLine,
        line: underPickRaw.line ?? secondary.pick.line,
      };

      // Drop when Under does not independently qualify (organic evidence required).
      // Full integrity vetoes also run later in Best 6 selection filter.
      const line = Number(probePick.line);
      const projection = Number(probePick.projection);
      const fair = Number(probePick.fairLine);
      const projectionAbove =
        Number.isFinite(line) && Number.isFinite(projection) && projection > line;
      const fairAbove =
        Number.isFinite(line) && Number.isFinite(fair) && fair > line;
      const unsupported =
        !independentlyQualified ||
        projectionAbove ||
        fairAbove ||
        String(probePick.organicEvidenceStrength).toLowerCase() === "weak";

      if (unsupported) {
        decisions.set(pickKey(secondary.pick), {
          role: "SECONDARY_DEMOTED",
          opportunityStrengthScore: secondary.opportunityStrengthScore,
          opportunityStrengthComponents: secondary.components,
          rankingBoost: 0,
          rankingPenalty: DEMOTED_RANKING_PENALTY,
          primaryPlayer: primary.pick.player,
          clusterKey,
          underQualified: false,
          dropReason: "UNSUPPORTED_FORCED_UNDER",
          replaceWithNextEligible: true,
        });
        audit.secondaryDemoted += 1;
        clusterAudit.secondaries.push({
          player: secondary.pick.player,
          score: secondary.opportunityStrengthScore,
          action: "DROP_UNSUPPORTED_FORCED_UNDER",
          underQualified: false,
          policyFlip: false,
          reasons: [
            !independentlyQualified ? "NO_INDEPENDENT_UNDER_EVIDENCE" : null,
            projectionAbove ? "PROJECTION_ABOVE_UNDER_LINE" : null,
            fairAbove ? "FAIR_LINE_ABOVE_UNDER_LINE" : null,
          ].filter(Boolean),
        });
        continue;
      }

      const underPick = finalizeSameTeamForcedUnderPresentation({
        originalPick: secondary.pick,
        forcedPick: {
          ...underPickRaw,
          side: "Under",
          pick: "Under",
          decisionRecomputeReason:
            underPickRaw.decisionRecomputeReason || "same_team_arbitration_flip",
          trueRisk: "HIGH",
          riskLabel: "High Risk",
          policyConflictMarker: "SAME_TEAM_POLICY_CONFLICT",
          topPickBlockedByIntegrity: true,
        },
        primaryPlayer: primary.pick.player,
        independentlyQualifiedUnder: independentlyQualified,
      });

      decisions.set(pickKey(secondary.pick), {
        role: "SECONDARY_UNDER",
        opportunityStrengthScore: secondary.opportunityStrengthScore,
        opportunityStrengthComponents: secondary.components,
        rankingBoost: 0,
        rankingPenalty: 0,
        primaryPlayer: primary.pick.player,
        clusterKey,
        underQualified: independentlyQualified,
        policyFlip: true,
        flipReasonCode: "SAME_TEAM_ARBITRATION_FLIP_ORGANIC",
        replacedPick: underPick,
      });
      audit.secondaryFlippedUnder += 1;
      clusterAudit.secondaries.push({
        player: secondary.pick.player,
        score: secondary.opportunityStrengthScore,
        action: "SAME_TEAM_ARBITRATION_FLIP_ORGANIC",
        underQualified: independentlyQualified,
        policyFlip: true,
      });
    }

    audit.clusters.push(clusterAudit);
  }

  const adjusted = list.map((pick) => {
    const decision = decisions.get(pickKey(pick));
    if (!decision) return pick;

    const base = decision.replacedPick || pick;
    const next = {
      ...base,
      sameTeamOpportunityV2: {
        version: SAME_TEAM_OPPORTUNITY_V2_VERSION,
        role: decision.role,
        opportunityStrengthScore: decision.opportunityStrengthScore,
        components: decision.opportunityStrengthComponents,
        primaryPlayer: decision.primaryPlayer,
        clusterKey: decision.clusterKey,
        underQualified: decision.underQualified ?? null,
        underEvalSide: decision.underEvalSide ?? null,
      },
      opportunityStrengthScore: decision.opportunityStrengthScore,
      sameTeamOpportunityV2Role: decision.role,
    };

    if (decision.role === "PRIMARY_OVER") {
      next.slateCollisionPenalty = Math.max(
        0,
        num(next.slateCollisionPenalty) - decision.rankingBoost
      );
      next.bestPropScore = Number(
        (num(next.bestPropScore ?? next.pickScore) + decision.rankingBoost).toFixed(2)
      );
      next.projectionTrustMultiplier = Math.min(
        1,
        num(next.projectionTrustMultiplier, 1) + 0.02
      );
    }

    if (decision.role === "SECONDARY_DEMOTED") {
      next.slateCollisionPenalty =
        num(next.slateCollisionPenalty) + decision.rankingPenalty;
      next.bestPropScore = Number(
        Math.max(
          0,
          num(next.bestPropScore ?? next.pickScore) - decision.rankingPenalty
        ).toFixed(2)
      );
      next.projectionTrustMultiplier = Math.min(
        num(next.projectionTrustMultiplier, 1),
        0.78
      );
      next.sameTeamOpportunityV2Demoted = true;
      // Do not compete equally for Top/Best 6.
      next.topPickBlockedBySameTeamOpportunityV2 = true;
    }

    if (decision.role === "SECONDARY_UNDER") {
      // Presentation already finalized on replacedPick; reinforce locked fields.
      next.side = "Under";
      next.pick = "Under";
      next.finalCourtEdgeSide = "UNDER";
      next.originalModelSide = next.originalModelSide || "OVER";
      next.sameTeamArbitrationFlip = true;
      next.sameTeamArbitrationReason = "SAME_TEAM_ARBITRATION_FLIP";
      next.flipReasonCode = "SAME_TEAM_ARBITRATION_FLIP";
      next.flipFirstAction = "SAME_TEAM_ARBITRATION_FLIP";
      next.userFacingDecision = "TRACK";
      if (decision.policyFlip) {
        next.sameTeamOpportunityV2 = {
          ...(next.sameTeamOpportunityV2 || {}),
          policyFlip: true,
          flipReasonCode: "SAME_TEAM_ARBITRATION_FLIP",
          independentlyQualifiedUnder: decision.underQualified === true,
          originalModelSide: "OVER",
          finalSide: "UNDER",
        };
      }
    }

    return next;
  });

  return { candidates: adjusted, audit };
}

export function applySameTeamOpportunityV2Layer(candidates = [], audit = {}) {
  const result = arbitrateSameTeamOpportunityV2(candidates);
  if (audit && typeof audit === "object") {
    audit.sameTeamOpportunityV2 = result.audit;
  }
  return result.candidates;
}
