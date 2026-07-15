/**
 * Slate-level same-team opportunity budgeting.
 * Penalty/warning only; never auto-rejects props from Best 6.
 * Delegates to Phase 4 Same-Team Opportunity Engine.
 */
import {
  evaluateSlateSameTeamOpportunity,
  applySameTeamOpportunityAdjustments,
  SAME_TEAM_OPPORTUNITY_VERSION,
} from "../wnba/playerIntelligence/sameTeamOpportunityEngineV1.js";

export const SLATE_SAME_TEAM_COLLISION_VERSION = `${SAME_TEAM_OPPORTUNITY_VERSION}-slate`;

export function evaluateSlateSameTeamCollisions(candidates = []) {
  const evaluation = evaluateSlateSameTeamOpportunity(candidates);
  return {
    ...evaluation,
    version: SLATE_SAME_TEAM_COLLISION_VERSION,
    warningClusters: evaluation.questionableClusters ?? evaluation.warningClusters ?? 0,
    unrealisticClusters:
      evaluation.contradictedClusters ?? evaluation.unrealisticClusters ?? 0,
  };
}

export function applySlateCollisionAdjustments(candidates = [], evaluation = null) {
  const evalResult = evaluation || evaluateSlateSameTeamCollisions(candidates);
  const adjusted = applySameTeamOpportunityAdjustments(candidates, evalResult);
  return adjusted.map((pick) => {
    const audit = pick.sameTeamOpportunityAudit || pick.slateCollisionAudit;
    if (!audit) return pick;
    return {
      ...pick,
      slateCollisionAudit: audit,
      slateCollisionPenalty: audit.scorePenalty ?? audit.rankingPenalty ?? 0,
    };
  });
}
