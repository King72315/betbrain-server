/**
 * Same-Team Usage Collision v1 — now delegates to Same-Team Opportunity Engine.
 * Keeps export name for Flip-First / DDI compatibility.
 * Opportunity budgeting replaces simple collision; NEVER auto-forces Under.
 */
import { evaluateSameTeamOpportunityForPick } from "../wnba/playerIntelligence/sameTeamOpportunityEngineV1.js";

export const SAME_TEAM_COLLISION_VERSION = "same-team-usage-collision-v1.1-opportunity";

export function evaluateSameTeamUsageCollision(pick = {}, options = {}) {
  const opp = evaluateSameTeamOpportunityForPick(pick, options);
  return {
    ...opp,
    version: SAME_TEAM_COLLISION_VERSION,
    opportunityVersion: opp.version,
    // Legacy keys
    combinedLineDemand: opp.combinedPlayerProjected ?? opp.combinedLineDemand ?? null,
    impliedTeamTotal: opp.projectedTeamPoints ?? opp.impliedTeamTotal ?? null,
    combinedRecentAvg: opp.combinedPlayerProjected ?? null,
    opportunityStatus: opp.status,
    sameTeamOpportunity: opp,
  };
}
