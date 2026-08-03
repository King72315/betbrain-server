/**
 * Controlled Best 6 selector — full pool → analyze → rank → Best 6 → Top 2 from Best 6.
 * Display pool ranks by safety score; all 6 display props are TRACK-admitted for Results learning.
 */
import { CONFIG } from "../../config.js";
import { scoreNbaTopProp } from "./nbaTopPropScore.js";
import { scoreWnbaTopProp } from "./wnbaTopPropScore.js";
import {
  isOfficialPick,
  isTestPick,
  isNoBetPick,
  summarizePickForAudit,
} from "./topPropSelectionAudit.js";
import {
  getPickTeamKey,
  buildTopPickLabel,
  collectAllGeneratedCandidates,
} from "./topPropSelector.js";
import {
  evaluateWnbaTrackingEligibility,
  isWnbaQualityGatePick,
} from "../wnba/wnbaResultsQualityGate.js";
import {
  applyDecisionIntelligenceToPick,
  DECISION_INTELLIGENCE_VERSION,
  promoteBestSixCohortPick,
} from "../decisionIntelligence/propDecisionIntelligenceV1.js";
import {
  applySideRescueToPick,
  evaluateSideRescue,
  SIDE_RESCUE_VERSION,
} from "../decisionIntelligence/sideRescueEngineV1.js";
import { syncWnbaDataModeOnPick } from "../wnba/wnbaGateInputs.js";
import { runFlipFirstDecisionPipeline } from "../decisionIntelligence/decisionDataIntelligenceV1.js";
import {
  evaluateSlateSameTeamCollisions,
  applySlateCollisionAdjustments,
  SLATE_SAME_TEAM_COLLISION_VERSION,
} from "../decisionIntelligence/slateSameTeamCollisionV1.js";
import { applyEvidenceFinalConfidenceToPick } from "../wnba/playerIntelligence/evidenceFinalConfidenceV1.js";
import { applySameTeamOpportunityV2Layer } from "../wnba/playerIntelligence/sameTeamOpportunityEngineV2.js";
import {
  finalizeCanonicalDecision,
  computeDecisionHash,
  buildCanonicalDecisionBundle,
} from "../decisionIntelligence/sideSelectionTrustV1.js";
import { applyHomeDisplayWhyToPick } from "./homeReasonTextV1.js";
import {
  BEST_SIX_SELECTION_INTEGRITY_BUILD,
  BEST_SIX_SELECTION_INTEGRITY_VERSION,
  filterCandidatesForBestSixIntegrity,
  applyConflictConfidenceRiskRecalibration,
  evaluateBestSixSelectionIntegrity,
} from "./bestSixSelectionIntegrityV1.js";
import {
  selectControlledBestBoard,
  selectControlledBestBoardCombined,
  CONTROLLED_BEST_BOARD_BUILD,
  CONTROLLED_BEST_BOARD_VERSION,
} from "./controlledBestBoardV2.js";
export const CONTROLLED_BEST_SIX_VERSION =
  "controlled-best-board-canonical-sealing-path-v3";
export const BEST_SIX_LIMIT = 6;
export const TOP_TWO_LIMIT = 2;
export const MAX_TEAM_IN_BEST_SIX = 2;
export const MAX_GAME_IN_BEST_SIX = 3;
const SIDE_BALANCE_SWAP_MARGIN = 24;
const SIDE_BALANCE_MINORITY = 3;
export const PLAYABLE_POOL_CONTRACT_VERSION = "playable-pool-contract-v1";
export {
  BEST_SIX_SELECTION_INTEGRITY_VERSION,
  BEST_SIX_SELECTION_INTEGRITY_BUILD,
  CONTROLLED_BEST_BOARD_VERSION,
  CONTROLLED_BEST_BOARD_BUILD,
  selectControlledBestBoard,
  selectControlledBestBoardCombined,
};

const BEST_SIX_GATE_DEMOTION_PENALTIES = {
  OVER_UNSTABLE_THIN_BOOK: 110,
  OVER_THIN_GAP_VOLATILE: 90,
  OVER_VOLATILE_WEAK_EDGE: 75,
  OVER_GAP_BELOW: 95,
  READER_UNCERTAIN: 70,
  DANGER_STACK_INSUFFICIENT_EDGE: 15,
};

function resolveGateReason(pick = {}) {
  const di = pick.decisionIntelligence || {};
  return String(
    pick.wnbaTrackingReason ||
      di.gateReason ||
      di.originalGateEligibility ||
      pick.naturalDecision ||
      ""
  ).toUpperCase();
}

function gateDemotionPenalty(pick = {}) {
  const reason = resolveGateReason(pick);
  let penalty = 0;
  for (const [key, weight] of Object.entries(BEST_SIX_GATE_DEMOTION_PENALTIES)) {
    if (reason.includes(key)) penalty += weight;
  }
  return penalty;
}

function isViableMinorityCandidate(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const sr = pick.sideRescue || {};
  if ((di.killReasons || []).length > 0) return false;
  // NO_DECISIVE_RESCUE is weak-but-playable — still eligible for side balance.
  if (sr.action === "NO_BET" && pick.weakButPlayable !== true) return false;

  const side = normalizeSide(pick.side || pick.pick);
  const reader = pick.wnbaReader || {};
  const caseRef = side === "UNDER" ? reader.underCase : reader.overCase;
  if (!caseRef) return false;
  if (side === "UNDER" && caseRef.underGapFloorPassed === false) return false;
  if (side === "OVER" && caseRef.overGapFloorPassed === false) return false;

  const pre = num(caseRef.preGapPenaltyScore ?? caseRef.rawScore ?? caseRef.score);
  if (pre < 4) return false;

  const reason = resolveGateReason(pick);
  if (reason.includes("OVER_GAP_BELOW") || reason.includes("READER_UNCERTAIN")) return false;
  return true;
}

function clean(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return raw;
}

function getGameKey(pick = {}) {
  return clean(pick.gameId || pick.game || "");
}

function exactDupeKey(pick = {}) {
  return [
    clean(pick.player),
    clean(pick.team),
    String(pick.line),
    normalizeSide(pick.side || pick.pick),
    String(pick.league || "").toUpperCase(),
    getGameKey(pick),
  ].join("|");
}

function playerKey(pick = {}) {
  return clean(`${pick.player}-${pick.team}`);
}

function playerLineKey(pick = {}) {
  return clean(`${pick.player}-${pick.line}-${pick.stat || "points"}`);
}

function hasCoreFields(pick = {}) {
  return Boolean(
    pick.player &&
      pick.team &&
      pick.line != null &&
      (pick.side || pick.pick) &&
      pick.league
  );
}

function scoreCandidate(pick = {}) {
  const league = String(pick.league || "").toUpperCase();
  const scored =
    league === "WNBA" ? scoreWnbaTopProp(pick) : scoreNbaTopProp(pick);
  const collisionPenalty = num(pick.slateCollisionPenalty);
  const evidencePenalty = num(pick.evidenceRankPenalty);
  const bothSidesWeakPenalty = num(pick.bothSidesWeakRankingPenalty);
  const trustMul = clamp(num(pick.projectionTrustMultiplier, 1) || 1, 0.5, 1.15);
  const trustScoreCut = Math.round((1 - trustMul) * 28);

  const rawScore = num(scored.bestPropScore);
  const penalized = Math.max(
    0,
    rawScore * trustMul - collisionPenalty - Math.max(evidencePenalty, bothSidesWeakPenalty) * 0.35 - trustScoreCut * 0.25
  );

  return {
    ...pick,
    ...scored,
    pickScore: penalized,
    bestPropScore: penalized,
    evidenceRankScoreCut: Number((rawScore - penalized).toFixed(2)),
  };
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function applySlateCollisionLayer(candidates = [], audit = {}) {
  const evaluation = evaluateSlateSameTeamCollisions(candidates);
  audit.slateSameTeamCollision = {
    version: SLATE_SAME_TEAM_COLLISION_VERSION,
    teamClusterCount: evaluation.teamClusterCount,
    warningClusters: evaluation.warningClusters,
    unrealisticClusters: evaluation.unrealisticClusters,
    teamClusters: evaluation.teamClusters,
  };
  const collisionAdjusted = applySlateCollisionAdjustments(
    candidates,
    evaluation
  ).map((pick) => {
    // Recompute evidence-final confidence after slate opportunity evidence is complete.
    if (String(pick.league || "").toUpperCase() !== "WNBA") return pick;
    const ddi = pick.decisionDataIntelligence || {};
    const teamOpp =
      pick.sameTeamOpportunityAudit ||
      pick.slateCollisionAudit ||
      ddi.sameTeamOpportunity ||
      ddi.sameTeamCollision ||
      {};
    return applyEvidenceFinalConfidenceToPick(pick, {
      sameTeamOpportunity: teamOpp,
      decisionDataIntelligence: {
        ...ddi,
        finalInfluence: {
          ...(ddi.finalInfluence || {}),
          // Influence already folded into directionalConfidence — avoid double-count.
          confidenceAdjustment: 0,
        },
      },
    });
  });

  // V2 decision engine: primary Over + secondary Under arbitration before Best 6.
  return applySameTeamOpportunityV2Layer(collisionAdjusted, audit);
}

function compareByScore(a = {}, b = {}) {
  return (
    Number(b.bestPropScore || 0) - Number(a.bestPropScore || 0) ||
    Number(b.confidence || 0) - Number(a.confidence || 0) ||
    Number(b.netEdge || 0) - Number(a.netEdge || 0)
  );
}

function trueRiskRank(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const raw = String(di.trueRisk || pick.trueRisk || "MEDIUM").toUpperCase();
  if (raw === "LOW") return 3;
  if (raw === "HIGH") return 1;
  return 2;
}

function gateQualityRank(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const el = String(
    di.trackEligibility || pick.trackingEligibility || pick.wnbaTrackingDecision || "TRACK"
  ).toUpperCase();
  if (el === "TRACK") return 4;
  if (el === "BOARD_ONLY") return 3;
  if (el === "SHADOW_ONLY") return 2;
  if (el === "NO_BET") return 1;
  return 2;
}

export function computeSafetyScore(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const score = num(pick.bestPropScore ?? pick.pickScore, 0);
  const confidence = num(pick.confidence ?? pick.winProbability, 50);
  const dangerPenalty = num(di.dangerGateCount ?? pick.dangerGateCount, 0) * 6;
  const riskBonus = trueRiskRank(pick) * 15;
  const gateBonus = gateQualityRank(pick) * 10;
  const repairBonus = num(di.repairScore, 0) * 0.1;
  const debtPenalty = (Array.isArray(di.riskDebts) ? di.riskDebts.length : 0) * 4;
  const killPenalty = (Array.isArray(di.killReasons) ? di.killReasons.length : 0) * 20;
  const stabilityBonus =
    num(
      pick.minutesStabilityScore ??
        di.minutesStabilityScore ??
        pick.volumeStabilityScore ??
        di.volumeStabilityScore,
      0
    ) * 0.15;
  const promotedPenalty =
    (pick.bestSixQualityFlags?.length || di.promotionReasons?.length || 0) * 8 +
    (di.bestSixPromoted ? 8 : 0);
  const gatePenalty = gateDemotionPenalty(pick);
  // Bounded ranking preference for reliable role profiles (no force into Top)
  const rankingAdj = clamp(
    num(pick.playerProfileCalibration?.rankingAdjustment, 0),
    -8,
    8
  );

  // P1-1 / P0-2 — material evidence ranking (BOTH_SIDES_WEAK, crowded same-team).
  // Weak-sided or crowded props must not outrank cleaner props on raw confidence alone.
  const flipAction = String(
    pick.flipFirstAction ||
      pick.decisionDataIntelligence?.flipFirstDecision?.action ||
      pick.flipFirstDecision?.action ||
      ""
  ).toUpperCase();
  const bothSidesWeakPenalty =
    flipAction === "BOTH_SIDES_WEAK"
      ? Math.max(num(pick.bothSidesWeakRankingPenalty), 32)
      : num(pick.bothSidesWeakRankingPenalty);
  const opportunityPenalty = Math.max(
    num(pick.slateCollisionPenalty),
    num(pick.sameTeamOpportunityAudit?.rankingPenalty),
    num(pick.evidenceRankPenalty)
  );
  const trustMul = clamp(num(pick.projectionTrustMultiplier, 1) || 1, 0.5, 1.15);
  const trustPenalty = Math.round((1 - trustMul) * 20);

  return (
    score +
    confidence * 0.28 +
    riskBonus +
    gateBonus +
    repairBonus +
    stabilityBonus +
    rankingAdj -
    dangerPenalty -
    debtPenalty -
    killPenalty -
    promotedPenalty -
    gatePenalty -
    bothSidesWeakPenalty -
    opportunityPenalty * 0.55 -
    trustPenalty
  );
}

export function compareSafetyScore(a = {}, b = {}) {
  return compareBySafetyScore(a, b);
}

function compareBySafetyScore(a = {}, b = {}) {
  return computeSafetyScore(b) - computeSafetyScore(a) || compareByScore(a, b);
}

function createControlledBestSixAudit(league = "") {
  return {
    version: CONTROLLED_BEST_SIX_VERSION,
    league: String(league || "").toUpperCase(),
    candidateCount: 0,
    qualityPassedCount: 0,
    afterInvalidFilter: 0,
    scoredCount: 0,
    selectedBestSixCount: 0,
    hiddenDueToBestSixCap: 0,
    hiddenDueToTeamCap: 0,
    hiddenDueToGameCap: 0,
    hiddenDueToQualityGate: 0,
    hiddenDuplicatePlayer: 0,
    hiddenOppositeSide: 0,
    hiddenStarted: 0,
    hiddenNoPlay: 0,
    hiddenNoBet: 0,
    hiddenExactDupe: 0,
    hiddenDueToSameTeam: 0,
    noDifferentTeamCandidate: false,
    selectedBestSixTeams: [],
    selectedTopTeams: [],
    hidden: [],
    rejected: [],
  };
}

function filterAndGateCandidates(candidates = [], audit = {}) {
  const exactSeen = new Map();
  const playerLineBest = new Map();
  const valid = [];
  let qualityPassed = 0;
  const wnbaSlate = (Array.isArray(candidates) ? candidates : []).filter(
    (p) => String(p.league || "").toUpperCase() === "WNBA"
  );

  for (const rawPick of candidates) {
    if (!passesBaseCandidateFilters(rawPick, audit)) continue;

    let pick = rawPick;

    if (String(pick.league || "").toUpperCase() === "WNBA") {
      const prepared = applyWnbaDecisionStack(pick, { slateCandidates: candidates });
      if (!prepared.pick) {
        audit.hiddenDueToQualityGate += 1;
        audit.rejected.push({
          reason: prepared.rejectReason || "missing_wnba_gate_inputs",
          pick: summarizePickForAudit(pick),
        });
        continue;
      }
      pick = prepared.pick;
      const pool = classifyPlayablePoolState(pick);
      pick.playablePoolState = pool.state;
      if (pool.weakButPlayable) pick.weakButPlayable = true;
      if (!passesResultsEligibility(pick)) {
        audit.hiddenDueToQualityGate += 1;
        audit.rejected.push({
          reason: pool.reason || "objectively_unplayable",
          playablePoolState: pool.state,
          eligibility: pick.decisionIntelligence?.trackEligibility,
          trueRisk: pick.decisionIntelligence?.trueRisk,
          pick: summarizePickForAudit(pick),
        });
        continue;
      }
    }

    qualityPassed += 1;

    if (!dedupeCandidate(pick, exactSeen, playerLineBest, audit)) continue;
    valid.push(pick);
  }

  audit.qualityPassedCount = qualityPassed;
  return valid;
}

function selectBestSixWithDiversity(sorted = [], options = {}, audit = {}) {
  const limit = Number(options.limit ?? BEST_SIX_LIMIT);
  const maxPerTeam = Number(options.maxPerTeam ?? MAX_TEAM_IN_BEST_SIX);
  const maxPerGame = Number(options.maxPerGame ?? MAX_GAME_IN_BEST_SIX);
  const selected = [];
  const teamCounts = new Map();
  const gameCounts = new Map();

  for (const pick of sorted) {
    if (selected.length >= limit) {
      audit.hiddenDueToBestSixCap += 1;
      audit.hidden.push({
        reason: "hidden_due_to_best_six_cap",
        limit,
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    const teamKey = getPickTeamKey(pick);
    const gameKey = getGameKey(pick);
    const teamCount = Number(teamCounts.get(teamKey) || 0);
    const gameCount = Number(gameCounts.get(gameKey) || 0);

    if (teamCount >= maxPerTeam) {
      audit.hiddenDueToTeamCap += 1;
      audit.hidden.push({
        reason: "hidden_due_to_team_cap",
        teamKey,
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    if (gameKey && gameCount >= maxPerGame) {
      audit.hiddenDueToGameCap += 1;
      audit.hidden.push({
        reason: "hidden_due_to_game_cap",
        gameKey,
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    selected.push(pick);
    teamCounts.set(teamKey, teamCount + 1);
    if (gameKey) gameCounts.set(gameKey, gameCount + 1);
  }

  return applySideBalancePreference(sorted, selected, { limit }, audit);
}

function isSameTeamSideLocked(pick = {}) {
  return (
    pick.sideLockedAfterArbitration === true ||
    pick.sameTeamArbitrationFlip === true ||
    pick.flipReasonCode === "SAME_TEAM_ARBITRATION_FLIP" ||
    pick.sameTeamArbitrationReason === "SAME_TEAM_ARBITRATION_FLIP" ||
    pick.sameTeamArbitration?.reason === "SAME_TEAM_ARBITRATION_FLIP" ||
    pick.sameTeamArbitration?.applied === true ||
    pick.sameTeamOpportunityV2Role === "SECONDARY_UNDER" ||
    pick.sameTeamOpportunityV2?.role === "SECONDARY_UNDER" ||
    pick.canonicalSealedProp?.sameTeamArbitration?.flipped === true
  );
}

function applySideBalancePreference(sorted = [], selected = [], options = {}, audit = {}) {
  const limit = Number(options.limit ?? BEST_SIX_LIMIT);
  const minMinority = Number(options.minMinority ?? SIDE_BALANCE_MINORITY);
  const margin = Number(options.swapMargin ?? SIDE_BALANCE_SWAP_MARGIN);
  audit.sideBalanceEvaluated = true;

  if (selected.length < 3 || selected.length < limit) {
    audit.sideBalanceNoSwapReason = "INSUFFICIENT_BEST_SIX_SIZE";
    return selected;
  }

  let result = [...selected];
  const swaps = [];
  let sideBalanceNoSwapReason = null;
  audit.sameTeamLockedProtected = [];

  for (let attempt = 0; attempt < limit; attempt += 1) {
    const sideCounts = { OVER: 0, UNDER: 0 };
    for (const pick of result) {
      const side = normalizeSide(pick.side || pick.pick);
      if (side === "OVER" || side === "UNDER") sideCounts[side] += 1;
    }

    const dominantSide =
      sideCounts.OVER >= limit - minMinority
        ? "OVER"
        : sideCounts.UNDER >= limit - minMinority
          ? "UNDER"
          : null;
    if (!dominantSide) {
      sideBalanceNoSwapReason = "BALANCED_OR_ACCEPTABLE";
      break;
    }

    const minoritySide = dominantSide === "OVER" ? "UNDER" : "OVER";
    audit.majoritySide = dominantSide;
    audit.minoritySide = minoritySide;
    audit.minorityCandidatesFound = sorted.filter(
      (pick) => normalizeSide(pick.side || pick.pick) === minoritySide
    ).length;

    if (sideCounts[minoritySide] >= minMinority) {
      sideBalanceNoSwapReason = "MINORITY_QUOTA_MET";
      break;
    }

    const selectedSet = new Set(result);
    let weakestIdx = -1;
    let weakestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < result.length; i += 1) {
      if (normalizeSide(result[i].side || result[i].pick) !== dominantSide) continue;
      // LOCK: same-team arbitration final side cannot be removed/replaced by side balance
      if (isSameTeamSideLocked(result[i])) {
        audit.sameTeamLockedProtected.push(summarizePickForAudit(result[i]));
        continue;
      }
      const score = computeSafetyScore(result[i]);
      if (score < weakestScore) {
        weakestScore = score;
        weakestIdx = i;
      }
    }
    if (weakestIdx < 0) {
      sideBalanceNoSwapReason =
        audit.sameTeamLockedProtected.length > 0
          ? "SAME_TEAM_ARBITRATION_SIDE_LOCKED"
          : "NO_DOMINANT_SIDE_CANDIDATE";
      break;
    }

    const eligibleMinority = sorted.filter((pick) => {
      if (selectedSet.has(pick)) return false;
      if (normalizeSide(pick.side || pick.pick) !== minoritySide) return false;
      // Never import a candidate that would require flipping a locked arbitration side
      if (isSameTeamSideLocked(pick) && normalizeSide(pick.side || pick.pick) !== minoritySide) {
        return false;
      }
      if (!isViableMinorityCandidate(pick)) return false;
      return computeSafetyScore(pick) >= weakestScore - margin;
    });
    audit.eligibleMinorityCandidates = eligibleMinority.length;

    const alternative = eligibleMinority[0];
    if (!alternative) {
      sideBalanceNoSwapReason = "NO_ELIGIBLE_MINORITY_CANDIDATE";
      break;
    }

    swaps.push({
      replaced: summarizePickForAudit(result[weakestIdx]),
      with: summarizePickForAudit(alternative),
      dominantSide,
      minoritySide,
    });
    result[weakestIdx] = alternative;
  }

  if (swaps.length) audit.sideBalanceSwaps = swaps;
  if (!audit.sideBalanceNoSwapReason) {
    audit.sideBalanceNoSwapReason = sideBalanceNoSwapReason || "NO_SWAP_NEEDED";
  }
  return result;
}

function rankBestSix(selected = [], league = "", options = {}) {
  const leagueCode = String(league || selected[0]?.league || "").toUpperCase();
  const forDisplay = options.forDisplay === true;

  return selected.map((pick, index) => {
    const rank = index + 1;
    const ranked = {
      ...pick,
      bestSixRank: rank,
      controlledBestSixRank: rank,
      leagueBestSixRank: rank,
      bestSixLabel: `Best ${leagueCode} #${rank}`,
      selectedTeamKey: getPickTeamKey(pick),
      controlledBestSixVersion: CONTROLLED_BEST_SIX_VERSION,
      controlledBestSixApplied: true,
      sourcePool: forDisplay ? "CONTROLLED_BEST_SIX_DISPLAY" : "CONTROLLED_BEST_SIX",
    };

    if (forDisplay) {
      return annotateResultsAdmission({
        ...ranked,
        bestSixDisplayRank: rank,
        controlledBestSixDisplay: true,
      });
    }

    return {
      ...ranked,
      trackingCohortSource: "CONTROLLED_BEST_SIX",
      trackingAdmissionSource: "CONTROLLED_BEST_SIX",
    };
  });
}

function applyWnbaDecisionStack(pick = {}, options = {}) {
  if (!isWnbaQualityGatePick(pick)) {
    // Soft gates must not terminal-exclude weak-but-playable candidates.
    // Missing card/reader is a soft demotion, not an objective invalidity kill.
    return {
      pick: {
        ...pick,
        weakButPlayable: true,
        playablePoolState: "WEAK_BUT_PLAYABLE",
        missingWnbaGateInputs: true,
        wnbaTrackingReason:
          pick.wnbaTrackingReason || "missing_wnba_gate_inputs",
        decisionIntelligence: {
          ...(pick.decisionIntelligence || {}),
          trackEligibility:
            pick.decisionIntelligence?.trackEligibility || "BOARD_ONLY",
          originalGateEligibility:
            pick.decisionIntelligence?.originalGateEligibility ||
            "missing_wnba_gate_inputs",
          bestSixEligibility: true,
          gateReason: "missing_wnba_gate_inputs",
        },
      },
      softGatePassThrough: true,
    };
  }

  // Same-team arbitration lock: never rerun Side Rescue / flip side via slate recompute
  if (
    pick.sideLockedAfterArbitration === true ||
    pick.sameTeamArbitrationFlip === true ||
    pick.flipReasonCode === "SAME_TEAM_ARBITRATION_FLIP"
  ) {
    return {
      pick: {
        ...pick,
        sideLockedAfterArbitration: true,
        decisionReused: true,
        sideBalanceCannotUndoArbitration: true,
      },
      reusedCanonicalBundle: true,
      sameTeamSideLocked: true,
    };
  }

  const slateLevelRecompute =
    options.forceRecompute === true ||
    options.slateCollisionAdjusted === true ||
    options.sideBalanceAdjusted === true;

  if (pick.sideSelectionBundle?.version && pick.decisionHash && !slateLevelRecompute) {
    return {
      pick: pick.sideSelectionBundle.decisionRecomputed
        ? pick
        : { ...pick, decisionReused: true },
      reusedCanonicalBundle: true,
    };
  }

  const previousHash = pick.decisionHash || pick.sideSelectionBundle?.decisionHash || null;

  let enriched = syncWnbaDataModeOnPick(pick, pick.wnbaDataCard, pick.wnbaReader);
  const initialSide = normalizeSide(
    enriched.initialSide || enriched.side || enriched.pick || enriched.wnbaReader?.finalSide
  );
  enriched.initialSide = initialSide;
  enriched = runFlipFirstDecisionPipeline(enriched, {
    dataCard: enriched.wnbaDataCard,
    reader: enriched.wnbaReader,
    originalSide: initialSide,
    teamCandidates: options.teamCandidates,
    slateCandidates: options.slateCandidates || options.teamCandidates,
    impliedTeamTotal:
      enriched.impliedTeamTotalAudit?.value ??
      enriched.wnbaGameContext?.impliedTeamTotal ??
      options.impliedTeamTotal,
  });
  enriched.flipFirstAction =
    enriched.flipFirstDecision?.action ||
    enriched.decisionDataIntelligence?.flipFirstDecision?.action ||
    enriched.flipFirstAction;

  const gate = evaluateWnbaTrackingEligibility(
    enriched,
    enriched.wnbaDataCard,
    enriched.wnbaReader
  );
  enriched = applyDecisionIntelligenceToPick(enriched, null, gate);

  if (!enriched.sideRescue) {
    const di = enriched.decisionIntelligence || {};
    const sideRescue = evaluateSideRescue(enriched, {
      decisionIntelligence: di,
      gate,
      dataCard: enriched.wnbaDataCard,
      reader: enriched.wnbaReader,
      originalSide: enriched.initialSide,
      flipFirstDecision:
        enriched.flipFirstDecision || enriched.decisionDataIntelligence?.flipFirstDecision,
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
  }

  enriched = finalizeCanonicalDecision(enriched);
  if (slateLevelRecompute) {
    const newHash = enriched.decisionHash;
    enriched.decisionRecomputed = previousHash && previousHash !== newHash;
    enriched.decisionRecomputeReason = options.decisionRecomputeReason || "slate_level_context";
    enriched.previousDecisionHash = previousHash;
    enriched.newDecisionHash = newHash;
    enriched.sideSelectionBundle = {
      ...enriched.sideSelectionBundle,
      decisionRecomputed: enriched.decisionRecomputed,
      decisionRecomputeReason: enriched.decisionRecomputeReason,
      previousDecisionHash: previousHash,
      newDecisionHash: newHash,
    };
  }

  return { pick: enriched, reusedCanonicalBundle: false };
}

function hasConfirmedOut(pick = {}) {
  const avail = String(
    pick.availabilityState ||
      pick.availabilityGate?.availabilityState ||
      pick.availabilityGate?.playerStatus ||
      pick.injuryAvailability?.status ||
      pick.wnbaDataCard?.injuryAvailability?.status ||
      ""
  ).toUpperCase();
  return (
    pick.availabilityConfirmedOut === true ||
    avail === "OUT" ||
    avail === "INACTIVE" ||
    (pick.noPlay === true &&
      (pick.noPlayReasons || []).some((r) =>
        /OUT|INACTIVE|UNAVAILABLE/i.test(String(r))
      ))
  );
}

function hasUnresolvedIdentity(pick = {}) {
  const identity = pick.providerIdentity || {};
  return (
    pick.unresolvedIdentity === true ||
    identity.attachAllowed === false ||
    Boolean(identity.unresolvedIdentityReason)
  );
}

function hasKillNoPlay(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const killReasons = Array.isArray(di.killReasons) ? di.killReasons : [];
  const sr = pick.sideRescue || {};
  if (pick.noPlay !== true && sr.action !== "NO_BET") return false;
  if (killReasons.length > 0) return true;
  const reason = String(
    pick.wnbaTrackingReason || di.gateReason || pick.trackingReason || ""
  ).toUpperCase();
  return (
    reason.includes("LOW_VOLUME_OVER_TRAP") ||
    reason.includes("DANGER_GATE_STACK_NO_TRACK") ||
    reason.includes("CONFIRMED_OUT")
  );
}

/**
 * Playable-pool contract: weak evidence ≠ objective invalidity.
 * OBJECTIVELY_UNPLAYABLE only for missing market/identity, confirmed OUT,
 * corrupt/duplicate handled elsewhere, or hard kill no-play.
 */
export function classifyPlayablePoolState(pick = {}) {
  if (!hasCoreFields(pick)) {
    return {
      state: "OBJECTIVELY_UNPLAYABLE",
      reason: "missing_data",
      playable: false,
    };
  }
  if (pick.isStarted) {
    return {
      state: "OBJECTIVELY_UNPLAYABLE",
      reason: "started",
      playable: false,
    };
  }
  if (hasConfirmedOut(pick)) {
    return {
      state: "OBJECTIVELY_UNPLAYABLE",
      reason: "confirmed_out",
      playable: false,
    };
  }
  if (hasUnresolvedIdentity(pick)) {
    return {
      state: "OBJECTIVELY_UNPLAYABLE",
      reason: "unresolved_identity",
      playable: false,
    };
  }
  if (hasKillNoPlay(pick)) {
    return {
      state: "OBJECTIVELY_UNPLAYABLE",
      reason: "kill_no_play",
      playable: false,
    };
  }

  const di = pick.decisionIntelligence || {};
  const sr = pick.sideRescue || {};
  const track = String(
    di.trackEligibility || pick.trackingEligibility || pick.wnbaTrackingDecision || ""
  ).toUpperCase();
  // NO_DECISIVE_RESCUE is board-visible but not Official Best 6 eligible.
  if (sr.action === "NO_DECISIVE_RESCUE") {
    return {
      state: "WEAK_BUT_PLAYABLE",
      reason: "NO_DECISIVE_RESCUE",
      playable: true,
      weakButPlayable: true,
      bestSixEligible: false,
      hardBestSixExclusion: "NO_DECISIVE_RESCUE",
    };
  }

  const softDemotion =
    pick.weakButPlayable === true ||
    track === "BOARD_ONLY" ||
    track === "SHADOW_ONLY" ||
    sr.action === "BOARD_ONLY" ||
    di.bestSixEligibility === false ||
    String(di.trueRisk || pick.trueRisk || "").toUpperCase() === "HIGH";

  if (softDemotion) {
    return {
      state: "WEAK_BUT_PLAYABLE",
      reason:
        di.gateReason ||
        pick.wnbaTrackingReason ||
        sr.action ||
        track ||
        "weak_evidence",
      playable: true,
      weakButPlayable: true,
    };
  }

  return {
    state: "PLAYABLE",
    reason: "eligible",
    playable: true,
    weakButPlayable: false,
  };
}

function passesBaseCandidateFilters(pick = {}, audit = {}) {
  const classification = classifyPlayablePoolState(pick);
  if (!classification.playable) {
    if (classification.reason === "started") audit.hiddenStarted += 1;
    else if (classification.reason === "kill_no_play") {
      audit.hiddenNoPlay += 1;
      audit.hiddenNoBet += 1;
    }
    audit.rejected.push({
      reason: classification.reason,
      playablePoolState: classification.state,
      pick: summarizePickForAudit(pick),
    });
    return false;
  }

  // Legacy NO_BET without hard kill was previously terminal — keep weak playable.
  if (isNoBetPick(pick) && pick.weakButPlayable !== true && hasKillNoPlay(pick)) {
    audit.hiddenNoBet += 1;
    audit.rejected.push({ reason: "no_bet", pick: summarizePickForAudit(pick) });
    return false;
  }

  return true;
}

function passesResultsEligibility(pick = {}) {
  // Soft gate demotions (BOARD_ONLY / HIGH risk / gap floors / NO_DECISIVE_RESCUE)
  // stay in the Best 6 playable pool. Only objective invalidity excludes.
  const classification = classifyPlayablePoolState(pick);
  if (!classification.playable) return false;
  if (classification.weakButPlayable) {
    pick.weakButPlayable = true;
    pick.playablePoolState = classification.state;
  }
  return true;
}

export function annotateResultsAdmission(pick = {}) {
  const naturalDecision =
    pick.naturalDecision ||
    pick.sideSelectionBundle?.naturalDecision ||
    pick.decisionIntelligence?.originalGateEligibility ||
    pick.decisionIntelligence?.trackEligibility ||
    pick.wnbaTrackingDecision ||
    "TRACK";

  // Integrity hard exclusions must never be laundered by Best 6 promotion.
  const integrity = evaluateBestSixSelectionIntegrity(pick, { allowFillCandidates: false });
  if (!integrity.eligible) {
    return {
      ...integrity.pick,
      naturalDecision,
      resultsAdmissionEligible: false,
      excludedFromOfficialBestSix: true,
      bestSixExclusionReason: integrity.primaryReason,
      controlledBestSixDisplayTracked: false,
      decisionIntelligence: {
        ...(pick.decisionIntelligence || {}),
        trackEligibility: naturalDecision || "BOARD_ONLY",
        bestSixEligibility: false,
        bestSixPromoted: false,
        integrityRejection: integrity.primaryReason,
        hardExclusions: integrity.hardExclusions,
      },
    };
  }

  const promoted = promoteBestSixCohortPick({
    ...pick,
    naturalDecision,
    sideSelectionBundle: {
      ...(pick.sideSelectionBundle || buildCanonicalDecisionBundle(pick)),
      naturalDecision,
      selectedForLearning: true,
      resultsTracked: true,
    },
  });
  const di = promoted.decisionIntelligence || {};
  const qualityNote = ""; // keep prior-gate text out of user-facing Results reasons

  // Final Controlled Best 6 / Results row: user-facing decision is always TRACK.
  // Preserve pre-selection gate labels only in audit / naturalDecision fields.
  const withWhy = applyHomeDisplayWhyToPick({
    ...promoted,
    naturalDecision,
    finalDecision: "TRACK",
    decision: "TRACK",
    trackingDecision: "TRACK",
    wnbaTrackingDecision: "TRACK",
    trackingEligibility: "TRACK",
    displayTrackEligibility: "TRACK",
    userFacingDecision: "TRACK",
    selectedForLearning: true,
    resultsTracked: true,
    resultsAdmissionEligible: true,
    resultsDecisionLabel: "TRACK",
    resultsTrackingWarning: qualityNote,
    resultsAdmissionReason: qualityNote,
    displayResultsReason: qualityNote,
    controlledBestSixDisplayTracked: true,
    decisionIntelligence: {
      ...di,
      trackEligibility: "TRACK",
      bestSixEligibility: true,
      originalGateEligibility:
        di.originalGateEligibility ||
        di.trackEligibility ||
        naturalDecision ||
        null,
      naturalDecision,
    },
  });
  return withWhy;
}

function dedupeCandidate(pick = {}, exactSeen = new Map(), playerLineBest = new Map(), audit = {}) {
  const dupeKey = exactDupeKey(pick);
  if (exactSeen.has(dupeKey)) {
    audit.hiddenExactDupe += 1;
    audit.hidden.push({
      reason: "exact_dupe",
      pick: summarizePickForAudit(pick),
      kept: summarizePickForAudit(exactSeen.get(dupeKey)),
    });
    return false;
  }

  const pKey = playerKey(pick);
  if (exactSeen.has(`player|${pKey}`)) {
    audit.hiddenDuplicatePlayer += 1;
    audit.hidden.push({
      reason: "duplicate_player",
      pick: summarizePickForAudit(pick),
    });
    return false;
  }

  const plKey = playerLineKey(pick);
  const prior = playerLineBest.get(plKey);
  if (prior) {
    const priorSide = normalizeSide(prior.side || prior.pick);
    const nextSide = normalizeSide(pick.side || pick.pick);
    if (priorSide && nextSide && priorSide !== nextSide) {
      audit.hiddenOppositeSide += 1;
      audit.hidden.push({
        reason: "opposite_side",
        pick: summarizePickForAudit(pick),
        kept: summarizePickForAudit(prior),
      });
      return false;
    }
  }

  exactSeen.set(dupeKey, pick);
  exactSeen.set(`player|${pKey}`, pick);
  playerLineBest.set(plKey, pick);
  return true;
}

function filterAndAnalyzeCandidates(candidates = [], audit = {}) {
  const exactSeen = new Map();
  const playerLineBest = new Map();
  const valid = [];
  let analyzedCount = 0;
  const wnbaSlate = (Array.isArray(candidates) ? candidates : []).filter(
    (p) => String(p.league || "").toUpperCase() === "WNBA"
  );

  for (const rawPick of candidates) {
    if (!passesBaseCandidateFilters(rawPick, audit)) continue;

    let pick = rawPick;

    if (String(pick.league || "").toUpperCase() === "WNBA") {
      const prepared = applyWnbaDecisionStack(pick, { slateCandidates: candidates });
      if (!prepared.pick) {
        audit.hiddenDueToQualityGate += 1;
        audit.rejected.push({
          reason: prepared.rejectReason || "missing_wnba_gate_inputs",
          pick: summarizePickForAudit(pick),
        });
        continue;
      }
      pick = prepared.pick;
      const pool = classifyPlayablePoolState(pick);
      pick.playablePoolState = pool.state;
      if (pool.weakButPlayable) pick.weakButPlayable = true;
      if (!pool.playable) {
        audit.hiddenDueToQualityGate += 1;
        audit.rejected.push({
          reason: pool.reason || "objectively_unplayable",
          playablePoolState: pool.state,
          pick: summarizePickForAudit(pick),
        });
        continue;
      }
    }

    analyzedCount += 1;

    if (!dedupeCandidate(pick, exactSeen, playerLineBest, audit)) continue;
    valid.push(pick);
  }

  audit.qualityPassedCount = analyzedCount;
  audit.analyzedCount = analyzedCount;
  return valid;
}

export function selectControlledBestSix(candidates = [], league = "", options = {}) {
  const leagueCode = String(league || "").toUpperCase();
  const audit = createControlledBestSixAudit(leagueCode);

  const pool = (Array.isArray(candidates) ? candidates : []).filter(
    (p) => String(p.league || "").toUpperCase() === leagueCode
  );
  audit.candidateCount = pool.length;

  const valid = filterAndGateCandidates(pool, audit);
  audit.afterInvalidFilter = valid.length;

  const collisionAdjusted =
    leagueCode === "WNBA"
      ? applySlateCollisionLayer(valid, audit).map((pick) => {
          if (!pick.decisionRecomputed && pick.sideSelectionBundle) return pick;
          return {
            ...pick,
            decisionRecomputed: true,
            decisionRecomputeReason: "same_team_collision",
            previousDecisionHash: pick.decisionHash,
          };
        })
      : valid;

  const scored = collisionAdjusted.map(scoreCandidate);
  scored.sort(compareByScore);
  audit.scoredCount = scored.length;

  const integrity = applyBestSixIntegrityGate(scored, audit, options);
  const selected = selectBestSixWithDiversity(
    integrity,
    {
      limit: options.bestSixLimit ?? BEST_SIX_LIMIT,
      maxPerTeam: options.maxPerTeam ?? MAX_TEAM_IN_BEST_SIX,
      maxPerGame: options.maxPerGame ?? MAX_GAME_IN_BEST_SIX,
      allowShortSlate: true,
    },
    audit
  );
  const ranked = rankBestSix(selected, leagueCode);

  audit.selectedBestSixCount = ranked.length;
  audit.selectedBestSixTeams = [...new Set(ranked.map(getPickTeamKey))];
  audit.shortSlate =
    ranked.length < (options.bestSixLimit ?? BEST_SIX_LIMIT) &&
    integrity.length < (options.bestSixLimit ?? BEST_SIX_LIMIT);

  return {
    bestSix: ranked,
    controlledBestSixAudit: audit,
  };
}

function applyBestSixIntegrityGate(scored = [], audit = {}, options = {}) {
  if (!scored.length) return scored;
  const leagueCode = String(scored[0]?.league || "").toUpperCase();
  if (leagueCode !== "WNBA") return scored;

  const filtered = filterCandidatesForBestSixIntegrity(scored, {
    allowFillCandidates: false,
  });
  audit.selectionIntegrity = {
    version: BEST_SIX_SELECTION_INTEGRITY_VERSION,
    build: BEST_SIX_SELECTION_INTEGRITY_BUILD,
    acceptedCount: filtered.acceptedCount,
    rejectedCount: filtered.rejectedCount,
    rejected: filtered.rejected.map((r) => ({
      player: r.player,
      reason: r.reason,
      hardExclusions: r.hardExclusions,
    })),
    debugRows: filtered.debugRows,
  };
  for (const r of filtered.rejected) {
    audit.rejected.push({
      reason: r.reason,
      integrity: true,
      pick: summarizePickForAudit(r.pick || { player: r.player }),
    });
  }
  // Prefer eligible props; if fewer than limit, do NOT promote hard-excluded.
  // Optional fill band only when explicitly requested and no hard conflicts.
  if (
    filtered.accepted.length < (options.bestSixLimit ?? BEST_SIX_LIMIT) &&
    options.allowIntegrityFill === true
  ) {
    const fill = filterCandidatesForBestSixIntegrity(scored, {
      allowFillCandidates: true,
    });
    const fillOnly = fill.accepted.filter(
      (p) => !filtered.accepted.some((a) => playerKey(a) === playerKey(p))
    );
    audit.selectionIntegrity.fillAccepted = fillOnly.length;
    return [...filtered.accepted, ...fillOnly].map(applyConflictConfidenceRiskRecalibration);
  }
  return filtered.accepted;
}

export function selectBestSixDisplay(candidates = [], league = "", options = {}) {
  const leagueCode = String(league || "").toUpperCase();

  // WNBA future boards: team-balanced variable Controlled Best Board.
  // Historical sealed memberships are not regenerated through this path.
  if (leagueCode === "WNBA" && options.useControlledBestBoard !== false) {
    const board = selectControlledBestBoard(candidates, {
      ...options,
      league: leagueCode,
      requestedSlateDate:
        options.requestedSlateDate ||
        options.slateDate ||
        candidates[0]?.canonicalSlateDate ||
        candidates[0]?.slateDate ||
        null,
      expectedDayBucket: options.expectedDayBucket || null,
    });
    return {
      bestSix: board.board,
      controlledBestSixDisplayAudit: board.controlledBestSixDisplayAudit,
      controlledBestBoardAudit: board.audit,
      topPicks: board.topPicks,
      bestSixOverall: board.bestSixOverall,
    };
  }

  const audit = createControlledBestSixAudit(leagueCode);
  audit.displayMode = true;

  const pool = (Array.isArray(candidates) ? candidates : []).filter(
    (p) => String(p.league || "").toUpperCase() === leagueCode
  );
  audit.candidateCount = pool.length;

  const valid = filterAndAnalyzeCandidates(pool, audit);
  audit.afterInvalidFilter = valid.length;

  const collisionAdjusted =
    leagueCode === "WNBA"
      ? applySlateCollisionLayer(valid, audit).map((pick) => {
          if (!pick.decisionRecomputed && pick.sideSelectionBundle) return pick;
          return {
            ...pick,
            decisionRecomputed: true,
            decisionRecomputeReason: "same_team_collision",
            previousDecisionHash: pick.decisionHash,
          };
        })
      : valid;

  const scored = collisionAdjusted.map(scoreCandidate);
  scored.sort(compareBySafetyScore);
  audit.scoredCount = scored.length;

  const integrity = applyBestSixIntegrityGate(scored, audit, options);
  const selected = selectBestSixWithDiversity(
    integrity,
    {
      limit: options.bestSixLimit ?? BEST_SIX_LIMIT,
      maxPerTeam: options.maxPerTeam ?? MAX_TEAM_IN_BEST_SIX,
      maxPerGame: options.maxPerGame ?? MAX_GAME_IN_BEST_SIX,
      allowShortSlate: true,
    },
    audit
  );
  const ranked = rankBestSix(selected, leagueCode, { forDisplay: true });
  audit.safetyScoreOrdered = true;
  audit.shortSlate =
    ranked.length < (options.bestSixLimit ?? BEST_SIX_LIMIT) &&
    integrity.length < (options.bestSixLimit ?? BEST_SIX_LIMIT);

  audit.selectedBestSixCount = ranked.length;
  audit.selectedBestSixTeams = [...new Set(ranked.map(getPickTeamKey))];
  audit.resultsAdmissionCount = ranked.filter((pick) => pick.resultsAdmissionEligible).length;

  return {
    bestSix: ranked,
    controlledBestSixDisplayAudit: audit,
  };
}

export function selectTopTwoFromBestSix(bestSix = [], league = "", options = {}) {
  const leagueCode = String(league || bestSix[0]?.league || "").toUpperCase();
  const limit = Number(options.topLimit ?? TOP_TWO_LIMIT);
  const audit = {
    league: leagueCode,
    hiddenDueToSameTeam: 0,
    hiddenDueToLeagueLimit: 0,
    noDifferentTeamCandidate: false,
    selectedTopTeams: [],
    topPickSelectionMode: "SAFETY_SCORE",
    hidden: [],
  };

  const sorted = [...bestSix].sort(compareBySafetyScore);
  const selected = [];
  const selectedTeamKeys = new Set();
  let insufficientOpportunitySelected = 0;

  for (const pick of sorted) {
    if (selected.length >= limit) {
      audit.hiddenDueToLeagueLimit += 1;
      audit.hidden.push({
        reason: "hidden_due_to_league_limit",
        limit,
        safetyScore: computeSafetyScore(pick),
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    const teamKey = getPickTeamKey(pick);
    if (teamKey && selectedTeamKeys.has(teamKey)) {
      audit.hiddenDueToSameTeam += 1;
      audit.hidden.push({
        reason: "hidden_due_to_same_team",
        teamKey,
        safetyScore: computeSafetyScore(pick),
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    if (
      pick.sameTeamOpportunityV2Demoted === true ||
      pick.topPickBlockedBySameTeamOpportunityV2 === true ||
      pick.sameTeamOpportunityV2?.role === "SECONDARY_DEMOTED"
    ) {
      audit.hiddenDueToSameTeamOpportunityV2 =
        (audit.hiddenDueToSameTeamOpportunityV2 || 0) + 1;
      audit.hidden.push({
        reason: "hidden_due_to_same_team_opportunity_v2_demotion",
        primaryPlayer: pick.sameTeamOpportunityV2?.primaryPlayer || null,
        safetyScore: computeSafetyScore(pick),
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    // Best 6 members are TRACK-admitted; legacy BOARD_ONLY/NO_BET labels must not
    // block Top ranking after playable-pool promotion.
    const userFacing = String(
      pick.userFacingDecision ||
        pick.resultsDecisionLabel ||
        pick.finalDecision ||
        pick.displayTrackEligibility ||
        ""
    ).toUpperCase();
    const pool = classifyPlayablePoolState(pick);
    if (userFacing === "NO_BET" && !pool.playable) {
      audit.hiddenDueToRejectedDecision =
        (audit.hiddenDueToRejectedDecision || 0) + 1;
      audit.hidden.push({
        reason: "hidden_due_to_rejected_final_decision",
        finalDecision: userFacing,
        safetyScore: computeSafetyScore(pick),
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    // Incomplete same-team opportunity: at most one unverified Over in Top
    // when a comparable non-blocked alternative exists.
    const topPairBlocked =
      pick.sameTeamOpportunityAudit?.topPairAllowed === false ||
      pick.slateCollisionAudit?.topPairAllowed === false ||
      pick.sameTeamOpportunityAssessment === "INSUFFICIENT_DATA";
    if (topPairBlocked && insufficientOpportunitySelected >= 1) {
      const hasCleanAlt = sorted.some((candidate) => {
        if (selected.includes(candidate) || candidate === pick) return false;
        const altTeam = getPickTeamKey(candidate);
        if (altTeam && selectedTeamKeys.has(altTeam)) return false;
        const altBlocked =
          candidate.sameTeamOpportunityAudit?.topPairAllowed === false ||
          candidate.slateCollisionAudit?.topPairAllowed === false ||
          candidate.sameTeamOpportunityAssessment === "INSUFFICIENT_DATA";
        return !altBlocked;
      });
      if (hasCleanAlt) {
        audit.hiddenDueToInsufficientOpportunityTopPair =
          (audit.hiddenDueToInsufficientOpportunityTopPair || 0) + 1;
        audit.hidden.push({
          reason: "hidden_due_to_insufficient_opportunity_top_pair",
          topPairBlockReason:
            pick.sameTeamOpportunityAudit?.topPairBlockReason ||
            pick.slateCollisionAudit?.topPairBlockReason ||
            "INSUFFICIENT_OPPORTUNITY_DATA",
          safetyScore: computeSafetyScore(pick),
          pick: summarizePickForAudit(pick),
        });
        continue;
      }
    }

    selected.push(pick);
    if (teamKey) selectedTeamKeys.add(teamKey);
    if (topPairBlocked) insufficientOpportunitySelected += 1;
  }

  if (limit >= 2 && selected.length === 1 && bestSix.length > 1) {
    const firstTeam = getPickTeamKey(selected[0]);
    const hasDifferentTeam = bestSix.some(
      (pick) => getPickTeamKey(pick) !== firstTeam
    );
    if (!hasDifferentTeam) {
      audit.noDifferentTeamCandidate = true;
    }
  }

  const roundScore = (v) =>
    v == null || !Number.isFinite(Number(v))
      ? null
      : Math.round(Number(v) * 10) / 10;
  const ranked = selected.map((pick, index) => {
    const rank = index + 1;
    const safetyScore = roundScore(computeSafetyScore(pick));
    const nextScore = roundScore(
      index + 1 < selected.length
        ? computeSafetyScore(selected[index + 1])
        : sorted
            .filter((p) => !selected.includes(p))
            .map((p) => computeSafetyScore(p))[0] ?? null
    );
    const margin =
      nextScore != null
        ? roundScore(safetyScore - nextScore)
        : null;
    return {
      ...pick,
      rank,
      topPropRank: rank,
      leagueRank: rank,
      topPickRank: rank,
      topPickSafetyScore: safetyScore,
      topPickNextScore: nextScore,
      topPickLabel: buildTopPickLabel(leagueCode, rank),
      topPickReason:
        margin != null
          ? `Selected Top #${rank} — leads next candidate by ${margin} on ranking score.`
          : `Selected Top #${rank} among Best 6 on relative safety score.`,
      selectedTeamKey: getPickTeamKey(pick),
      selectedFromBestSix: true,
      selectedFromDisplayBestSix: true,
      selectedBySafetyScore: true,
      isTopPickReference: true,
      referenceOnly: true,
    };
  });

  audit.selectedTopTeams = [...selectedTeamKeys];
  audit.selectedTopPickSafetyScores = ranked.map((pick) => ({
    player: pick.player,
    safetyScore: pick.topPickSafetyScore,
    bestSixRank: pick.bestSixRank || pick.controlledBestSixRank,
  }));

  return {
    topProps: ranked,
    audit,
  };
}

function filterPicksByDayBucket(picks = [], bucket = "TOMORROW") {
  const target = String(bucket || "TOMORROW").toUpperCase();
  return (picks || []).filter((pick) => {
    const dayBucket = String(pick.dayBucket || "").toUpperCase();
    if (dayBucket === target) return true;
    const label = String(pick.dateLabel || "").toLowerCase();
    if (target === "TOMORROW") return label === "tomorrow";
    if (target === "TODAY") return label === "today";
    return false;
  });
}

function mergeDayBucketBestSix(todaySix = [], tomorrowSix = []) {
  // Preserve per-day membership; ranks stay day-local. Cross-day list is
  // Today then Tomorrow for seal/display consumers that still read one array.
  const stampedToday = (todaySix || []).map((pick, index) => ({
    ...pick,
    dayBucket: pick.dayBucket || "TODAY",
    bestSixDayBucket: "TODAY",
    bestSixDayRank: index + 1,
  }));
  const stampedTomorrow = (tomorrowSix || []).map((pick, index) => ({
    ...pick,
    dayBucket: pick.dayBucket || "TOMORROW",
    bestSixDayBucket: "TOMORROW",
    bestSixDayRank: index + 1,
  }));
  return [...stampedToday, ...stampedTomorrow];
}

export function selectControlledBestSixCombined(gameCards = [], options = {}) {
  const candidates = collectAllGeneratedCandidates(gameCards);

  // WNBA: variable team-balanced Controlled Best Board (CT date partitions).
  if (options.useControlledBestBoard !== false) {
    const wnbaCombined = selectControlledBestBoardCombined(candidates, {
      ...options,
      league: "WNBA",
    });
    const nbaBest = selectControlledBestSix(candidates, "NBA", {
      ...options,
      useControlledBestBoard: false,
    });
    const nbaDisplayToday = selectBestSixDisplay(
      filterPicksByDayBucket(candidates, "TODAY"),
      "NBA",
      { ...options, useControlledBestBoard: false, expectedDayBucket: "TODAY" }
    );
    const nbaDisplayTomorrow = selectBestSixDisplay(
      filterPicksByDayBucket(candidates, "TOMORROW"),
      "NBA",
      { ...options, useControlledBestBoard: false, expectedDayBucket: "TOMORROW" }
    );
    const nbaDisplay = {
      bestSix: mergeDayBucketBestSix(
        nbaDisplayToday.bestSix,
        nbaDisplayTomorrow.bestSix
      ),
      controlledBestSixDisplayAudit: {
        perDaySelection: true,
        todayCount: nbaDisplayToday.bestSix.length,
        tomorrowCount: nbaDisplayTomorrow.bestSix.length,
      },
    };

    const wnbaTop = selectTopTwoFromBestSix(
      wnbaCombined.tomorrow?.board?.length
        ? wnbaCombined.tomorrow.board
        : wnbaCombined.today?.board || wnbaCombined.board,
      "WNBA",
      { topLimit: options.wnbaTopLimit ?? CONFIG.WNBA_TOP_PROP_LIMIT }
    );
    const nbaTop = selectTopTwoFromBestSix(
      nbaDisplayTomorrow.bestSix.length
        ? nbaDisplayTomorrow.bestSix
        : filterPicksByDayBucket(nbaDisplay.bestSix, "TOMORROW"),
      "NBA",
      { topLimit: options.nbaTopLimit ?? CONFIG.NBA_TOP_PROP_LIMIT }
    );

    return {
      bestSixWNBA: wnbaCombined.board,
      bestSixNBA: nbaBest.bestSix,
      bestSixDisplayWNBA: wnbaCombined.board,
      bestSixDisplayNBA: nbaDisplay.bestSix,
      bestSixDisplayTodayWNBA: wnbaCombined.today?.board || [],
      bestSixDisplayTomorrowWNBA: wnbaCombined.tomorrow?.board || [],
      bestSixOverallWNBA: wnbaCombined.bestSixOverall || [],
      selectedPropsWNBA: wnbaCombined.selectedProps || wnbaCombined.board || [],
      selectedPropsTodayWNBA:
        wnbaCombined.today?.selectedProps || wnbaCombined.today?.board || [],
      selectedPropsTomorrowWNBA:
        wnbaCombined.tomorrow?.selectedProps ||
        wnbaCombined.tomorrow?.board ||
        [],
      selectionBuildId: wnbaCombined.selectionBuildId || null,
      selectionBuildIdToday: wnbaCombined.today?.selectionBuildId || null,
      selectionBuildIdTomorrow: wnbaCombined.tomorrow?.selectionBuildId || null,
      membershipModel: wnbaCombined.membershipModel || null,
      controlledBestBoardV2: wnbaCombined.controlledBestBoardV2 || null,
      officialMembershipWNBA:
        wnbaCombined.officialMembership || wnbaCombined.board || [],
      topWNBA: wnbaTop.topProps || wnbaCombined.topPicks,
      topNBA: nbaTop.topProps || [],
      controlledBestBoardAudit: wnbaCombined.audit,
      controlledBestSixAudit: {
        wnba: wnbaCombined.audit,
        nba: nbaBest.controlledBestSixAudit,
        boardMode: "CONTROLLED_BEST_BOARD_V2",
        membershipModel: wnbaCombined.membershipModel || null,
        selectionBuildId: wnbaCombined.selectionBuildId || null,
      },
      controlledBestSixDisplayAudit: {
        wnba: wnbaCombined.audit,
        nba: nbaDisplay.controlledBestSixDisplayAudit,
        boardMode: "CONTROLLED_BEST_BOARD_V2",
        title: "Controlled Best Board",
        membershipModel: wnbaCombined.membershipModel || null,
        selectionBuildId: wnbaCombined.selectionBuildId || null,
      },
      topTwoAudit: { wnba: wnbaTop, nba: nbaTop },
    };
  }

  const todayCandidates = filterPicksByDayBucket(candidates, "TODAY");
  const tomorrowCandidates = filterPicksByDayBucket(candidates, "TOMORROW");
  // Undated / unlabeled keep a fallback lane so empty day buckets don't starve.
  const undated = (candidates || []).filter((pick) => {
    const bucket = String(pick.dayBucket || "").toUpperCase();
    const label = String(pick.dateLabel || "").toLowerCase();
    return !bucket && label !== "today" && label !== "tomorrow";
  });

  const wnbaBest = selectControlledBestSix(candidates, "WNBA", options);
  const nbaBest = selectControlledBestSix(candidates, "NBA", options);

  // Per-day Best 6: each calendar bucket independently fills to 6 when
  // ≥6 playable candidates exist. Prevents Tomorrow outsoring Today to 3/6.
  const wnbaTodayPool = todayCandidates.length
    ? todayCandidates
    : undated;
  const wnbaTomorrowPool = tomorrowCandidates.length
    ? tomorrowCandidates
    : [];
  const nbaTodayPool = todayCandidates.length ? todayCandidates : undated;
  const nbaTomorrowPool = tomorrowCandidates.length ? tomorrowCandidates : [];

  const wnbaDisplayToday = selectBestSixDisplay(wnbaTodayPool, "WNBA", options);
  const wnbaDisplayTomorrow = selectBestSixDisplay(
    wnbaTomorrowPool,
    "WNBA",
    options
  );
  const nbaDisplayToday = selectBestSixDisplay(nbaTodayPool, "NBA", options);
  const nbaDisplayTomorrow = selectBestSixDisplay(
    nbaTomorrowPool,
    "NBA",
    options
  );

  const wnbaDisplay = {
    bestSix: mergeDayBucketBestSix(
      wnbaDisplayToday.bestSix,
      wnbaDisplayTomorrow.bestSix
    ),
    controlledBestSixDisplayAudit: {
      ...(wnbaDisplayToday.controlledBestSixDisplayAudit || {}),
      perDaySelection: true,
      todayCount: wnbaDisplayToday.bestSix.length,
      tomorrowCount: wnbaDisplayTomorrow.bestSix.length,
      resultsAdmissionCount:
        (wnbaDisplayToday.controlledBestSixDisplayAudit?.resultsAdmissionCount ||
          0) +
        (wnbaDisplayTomorrow.controlledBestSixDisplayAudit
          ?.resultsAdmissionCount || 0),
      today: wnbaDisplayToday.controlledBestSixDisplayAudit,
      tomorrow: wnbaDisplayTomorrow.controlledBestSixDisplayAudit,
    },
  };
  const nbaDisplay = {
    bestSix: mergeDayBucketBestSix(
      nbaDisplayToday.bestSix,
      nbaDisplayTomorrow.bestSix
    ),
    controlledBestSixDisplayAudit: {
      ...(nbaDisplayToday.controlledBestSixDisplayAudit || {}),
      perDaySelection: true,
      todayCount: nbaDisplayToday.bestSix.length,
      tomorrowCount: nbaDisplayTomorrow.bestSix.length,
      resultsAdmissionCount:
        (nbaDisplayToday.controlledBestSixDisplayAudit?.resultsAdmissionCount ||
          0) +
        (nbaDisplayTomorrow.controlledBestSixDisplayAudit
          ?.resultsAdmissionCount || 0),
      today: nbaDisplayToday.controlledBestSixDisplayAudit,
      tomorrow: nbaDisplayTomorrow.controlledBestSixDisplayAudit,
    },
  };

  const wnbaTop = selectTopTwoFromBestSix(
    wnbaDisplayTomorrow.bestSix.length
      ? wnbaDisplayTomorrow.bestSix
      : filterPicksByDayBucket(wnbaDisplay.bestSix, "TOMORROW"),
    "WNBA",
    {
      topLimit: options.wnbaTopLimit ?? CONFIG.WNBA_TOP_PROP_LIMIT,
    }
  );
  const nbaTop = selectTopTwoFromBestSix(
    nbaDisplayTomorrow.bestSix.length
      ? nbaDisplayTomorrow.bestSix
      : filterPicksByDayBucket(nbaDisplay.bestSix, "TOMORROW"),
    "NBA",
    {
      topLimit: options.nbaTopLimit ?? CONFIG.NBA_TOP_PROP_LIMIT,
    }
  );

  const topWNBAProps = wnbaTop.topProps;
  const topNBAProps = nbaTop.topProps;
  const topProps = [...topNBAProps, ...topWNBAProps].slice(
    0,
    CONFIG.TOP_PROP_COMBINED_LIMIT
  );

  const controlledBestSixAudit = {
    version: CONTROLLED_BEST_SIX_VERSION,
    topPropsSource: "CONTROLLED_BEST_SIX_DISPLAY",
    perDaySelection: true,
    playablePoolContractVersion: PLAYABLE_POOL_CONTRACT_VERSION,
    candidateCount: candidates.length,
    candidateCountByLeague: {
      WNBA: wnbaBest.controlledBestSixAudit.candidateCount,
      NBA: nbaBest.controlledBestSixAudit.candidateCount,
    },
    qualityPassedCountByLeague: {
      WNBA: wnbaBest.controlledBestSixAudit.qualityPassedCount,
      NBA: nbaBest.controlledBestSixAudit.qualityPassedCount,
    },
    bestSixCountByLeague: {
      WNBA: wnbaBest.bestSix.length,
      NBA: nbaBest.bestSix.length,
    },
    bestSixDisplayCountByLeague: {
      WNBA: wnbaDisplay.bestSix.length,
      NBA: nbaDisplay.bestSix.length,
    },
    bestSixDisplayTodayCountByLeague: {
      WNBA: wnbaDisplayToday.bestSix.length,
      NBA: nbaDisplayToday.bestSix.length,
    },
    bestSixDisplayTomorrowCountByLeague: {
      WNBA: wnbaDisplayTomorrow.bestSix.length,
      NBA: nbaDisplayTomorrow.bestSix.length,
    },
    resultsAdmissionCountByLeague: {
      WNBA: wnbaDisplay.controlledBestSixDisplayAudit.resultsAdmissionCount ?? 0,
      NBA: nbaDisplay.controlledBestSixDisplayAudit.resultsAdmissionCount ?? 0,
    },
    hiddenDueToBestSixCap:
      wnbaBest.controlledBestSixAudit.hiddenDueToBestSixCap +
      nbaBest.controlledBestSixAudit.hiddenDueToBestSixCap,
    hiddenDueToTeamCap:
      wnbaBest.controlledBestSixAudit.hiddenDueToTeamCap +
      nbaBest.controlledBestSixAudit.hiddenDueToTeamCap,
    hiddenDueToGameCap:
      wnbaBest.controlledBestSixAudit.hiddenDueToGameCap +
      nbaBest.controlledBestSixAudit.hiddenDueToGameCap,
    hiddenDueToQualityGate:
      wnbaBest.controlledBestSixAudit.hiddenDueToQualityGate +
      nbaBest.controlledBestSixAudit.hiddenDueToQualityGate,
    selectedBestSixTeamsByLeague: {
      WNBA: wnbaBest.controlledBestSixAudit.selectedBestSixTeams,
      NBA: nbaBest.controlledBestSixAudit.selectedBestSixTeams,
    },
    selectedTopTeamsByLeague: {
      WNBA: wnbaTop.audit.selectedTopTeams,
      NBA: nbaTop.audit.selectedTopTeams,
    },
    selectedTeamsByLeague: {
      WNBA: wnbaTop.audit.selectedTopTeams,
      NBA: nbaTop.audit.selectedTopTeams,
    },
    topWNBAPropsSelectedFromBestSix: true,
    topNBAPropsSelectedFromBestSix: true,
    noDifferentTeamCandidate:
      wnbaTop.audit.noDifferentTeamCandidate ||
      nbaTop.audit.noDifferentTeamCandidate,
    hiddenDueToSameTeam:
      wnbaTop.audit.hiddenDueToSameTeam + nbaTop.audit.hiddenDueToSameTeam,
    hiddenDueToLeagueLimit:
      wnbaTop.audit.hiddenDueToLeagueLimit + nbaTop.audit.hiddenDueToLeagueLimit,
    hiddenDueToNoDifferentTeamByLeague: {
      WNBA: wnbaTop.audit.noDifferentTeamCandidate ? 1 : 0,
      NBA: nbaTop.audit.noDifferentTeamCandidate ? 1 : 0,
    },
    wnba: wnbaBest.controlledBestSixAudit,
    nba: nbaBest.controlledBestSixAudit,
    wnbaDisplay: wnbaDisplay.controlledBestSixDisplayAudit,
    nbaDisplay: nbaDisplay.controlledBestSixDisplayAudit,
    wnbaTop: wnbaTop.audit,
    nbaTop: nbaTop.audit,
    selectedCount: topProps.length,
    officialCount: topProps.filter(isOfficialPick).length,
    testCount: topProps.filter(isTestPick).length,
    hidden: [
      ...(wnbaBest.controlledBestSixAudit.hidden || []),
      ...(nbaBest.controlledBestSixAudit.hidden || []),
      ...(wnbaTop.audit.hidden || []),
      ...(nbaTop.audit.hidden || []),
    ].slice(0, 100),
    rejected: [
      ...(wnbaBest.controlledBestSixAudit.rejected || []),
      ...(nbaBest.controlledBestSixAudit.rejected || []),
    ].slice(0, 100),
  };

  return {
    bestSixWNBA: wnbaBest.bestSix,
    bestSixNBA: nbaBest.bestSix,
    bestSixDisplayWNBA: wnbaDisplay.bestSix,
    bestSixDisplayNBA: nbaDisplay.bestSix,
    bestSixDisplayTodayWNBA: wnbaDisplayToday.bestSix,
    bestSixDisplayTodayNBA: nbaDisplayToday.bestSix,
    bestSixDisplayTomorrowWNBA: wnbaDisplayTomorrow.bestSix,
    bestSixDisplayTomorrowNBA: nbaDisplayTomorrow.bestSix,
    topWNBAProps,
    topNBAProps,
    topProps,
    topOfficialProps: topProps.filter(isOfficialPick),
    topTestProps: topProps.filter(isTestPick),
    topNBAOfficialProps: topNBAProps.filter(isOfficialPick),
    topNBATestProps: topNBAProps.filter(isTestPick),
    topWNBAOfficialProps: topWNBAProps.filter(isOfficialPick),
    topWNBATestProps: topWNBAProps.filter(isTestPick),
    controlledBestSixAudit,
    topSelectionAudit: controlledBestSixAudit,
    candidateCount: candidates.length,
    selectedCount: topProps.length,
    selectedNBA: topNBAProps.length,
    selectedWNBA: topWNBAProps.length,
    noBetCount: candidates.filter((p) => isNoBetPick(p)).length,
    controlledBestSixVersion: CONTROLLED_BEST_SIX_VERSION,
    playablePoolContractVersion: PLAYABLE_POOL_CONTRACT_VERSION,
  };
}
