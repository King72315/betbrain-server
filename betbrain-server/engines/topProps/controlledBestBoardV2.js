/**
 * CourtEdge Controlled Best Board V2
 * Best organic Over + Under per team when membership quality passes.
 * Build: courteedge-clear-side-strong-edge-membership-path-v1
 * Evidence-based membership; LAST_VALID / soft score / soft sanity are ranking only.
 * Hard exclusions: date/event/market validity (+ membership quality gates).
 * Prediction/calibration weights are untouched.
 */

import {
  annotatePickWithDateFields,
  getCurrentCtDate,
  getNextCtDate,
  toCanonicalSlateDate,
  verifyCandidateSlateDate,
  SLATE_DATE_VERIFICATION_BUILD,
  SLATE_DATE_VERIFICATION_VERSION,
} from "../../services/slateDateVerificationV1.js";
import {
  resolveBestPropScore,
  auditBestPropScore,
  resolveRoleStability,
  resolveVolatility,
  resolveMatchupShadowDirection,
  resolveProjectionSanityLevel,
  resolveNaturalDecision,
  resolveSideRescueAction,
} from "./bestSixSelectionIntegrityV1.js";
import {
  buildCanonicalControlledBoardPacket,
  CANONICAL_BOARD_MEMBERSHIP_MODEL,
  CANONICAL_BOARD_SEAL_BUILD,
} from "./controlledBestBoardCanonicalV3.js";
import {
  DIRECTIONAL_CALIBRATION_BUILD,
  stampCalibratedSideCandidate,
} from "./directionalCalibrationV1.js";
import {
  MEMBERSHIP_QUALITY_BUILD,
  MEMBERSHIP_EDGE_FLOOR,
  PREFERRED_GAP_FLOOR,
  MEMBERSHIP_REJECT,
  evaluateOfficialMembershipQuality,
  preferredGapRankingBonus,
  resolveOfficialTrackLabel,
  emptySlotReasonForSide,
  resolveOriginalModelSide,
  resolveDirectionalEdge,
} from "./controlledBoardMembershipQualityV1.js";
import {
  isProbabilitySafetyArchitectureEnabled,
  selectControlledBestBoardViaProbabilitySafetyV1,
  PROBABILITY_SAFETY_BOARD_BUILD,
} from "./probabilitySafetyBoardAdapterV1.js";

export const CONTROLLED_BEST_BOARD_VERSION = "controlled-best-board-v2";
export const CONTROLLED_BEST_BOARD_BUILD = MEMBERSHIP_QUALITY_BUILD;
/** Active scoring calibration for future unsealed WNBA boards. */
export const CONTROLLED_BEST_BOARD_CALIBRATION = DIRECTIONAL_CALIBRATION_BUILD;

export const MAX_PROPS_PER_TEAM = 2;
export const MAX_OVERS_PER_TEAM = 1;
export const MAX_UNDERS_PER_TEAM = 1;
export const MAX_PROPS_PER_GAME = 4;
/** @deprecated Removed from product — kept as 0 so accidental slices yield empty. */
export const TOP_PICKS_LIMIT = 0;
/** @deprecated Removed from product — kept as 0. */
export const BEST_SIX_OVERALL_LIMIT = 0;

/** Extreme single-book gap (Paige-type) → MARKET_SANITY_HOLD */
export const MARKET_SANITY_GAP_POINTS = 8;

export const EMPTY_SLOT_REASONS = {
  NO_VALID_POINTS_MARKETS: "NO_VALID_POINTS_MARKETS",
  FEWER_THAN_TWO_DISTINCT_PLAYERS: "FEWER_THAN_TWO_DISTINCT_PLAYERS",
  NO_VALID_DIFFERENT_PLAYER: "NO_VALID_DIFFERENT_PLAYER",
  ALL_MARKETS_DATE_FAILED: "ALL_MARKETS_DATE_FAILED",
  ALL_MARKETS_EVENT_MISMATCH: "ALL_MARKETS_EVENT_MISMATCH",
  ALL_PLAYERS_INACTIVE: "ALL_PLAYERS_INACTIVE",
  ALL_MARKETS_SANITY_HOLD: "ALL_MARKETS_SANITY_HOLD",
  MARKET_COVERAGE_INSUFFICIENT: "MARKET_COVERAGE_INSUFFICIENT",
  NO_VALID_SIDE_CANDIDATES: "NO_VALID_SIDE_CANDIDATES",
  NO_QUALIFIED_TEAM_OVER: MEMBERSHIP_REJECT.NO_QUALIFIED_TEAM_OVER,
  NO_QUALIFIED_TEAM_UNDER: MEMBERSHIP_REJECT.NO_QUALIFIED_TEAM_UNDER,
  EDGE_BELOW_MEMBERSHIP_FLOOR: MEMBERSHIP_REJECT.EDGE_BELOW_MEMBERSHIP_FLOOR,
  NATURAL_NO_BET: MEMBERSHIP_REJECT.NATURAL_NO_BET,
  BOTH_SIDES_WEAK: MEMBERSHIP_REJECT.BOTH_SIDES_WEAK,
  UNCERTAINTY: MEMBERSHIP_REJECT.UNCERTAINTY,
  BLOWOUT_OVER_HARD_BLOCK: MEMBERSHIP_REJECT.BLOWOUT_OVER_HARD_BLOCK,
  UNCONFIRMED_AVAILABILITY_OVER_BLOCK:
    MEMBERSHIP_REJECT.UNCONFIRMED_AVAILABILITY_OVER_BLOCK,
  SEALED_SIDE_PACKET_MISMATCH: MEMBERSHIP_REJECT.SEALED_SIDE_PACKET_MISMATCH,
  LOW_VOLUME_WITHOUT_UNDER_EDGE: MEMBERSHIP_REJECT.LOW_VOLUME_WITHOUT_UNDER_EDGE,
  TEAM_SIDE_LAST_VALID: MEMBERSHIP_REJECT.TEAM_SIDE_LAST_VALID,
  ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP:
    MEMBERSHIP_REJECT.ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP,
};

export {
  MEMBERSHIP_QUALITY_BUILD,
  MEMBERSHIP_EDGE_FLOOR,
  PREFERRED_GAP_FLOOR,
  MEMBERSHIP_REJECT,
  evaluateOfficialMembershipQuality,
  resolveOfficialTrackLabel,
};

export const HARD_EXCLUDE_REASONS = {
  DATE_VERIFICATION_FAILED: "DATE_VERIFICATION_FAILED",
  MARKET_SANITY_HOLD: "MARKET_SANITY_HOLD",
  NON_POINTS_MARKET: "NON_POINTS_MARKET",
  MISSING_LINE: "MISSING_LINE",
  INVALID_PLAYER_IDENTITY: "INVALID_PLAYER_IDENTITY",
  PLAYER_INACTIVE: "PLAYER_INACTIVE",
  MALFORMED_MARKET: "MALFORMED_MARKET",
};

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return null;
}

function playerKey(pick = {}) {
  return String(pick.player || pick.playerId || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function teamKey(pick = {}) {
  return String(pick.teamKey || pick.team || pick.teamName || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function gameKey(pick = {}) {
  return String(
    pick.gameKey ||
      pick.providerEventId ||
      pick.oddsEventId ||
      pick.eventId ||
      pick.gameId ||
      pick.game?.id ||
      `${teamKey(pick)}|${String(pick.opponent || "").toLowerCase()}`
  );
}

function marketKey(pick = {}) {
  const propType = String(
    pick.propType || pick.canonicalPropType || pick.stat || "POINTS"
  )
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
  const propCanon = /REBOUND/.test(propType)
    ? "REBOUNDS"
    : /ASSIST/.test(propType)
      ? "ASSISTS"
      : "POINTS";
  return [
    gameKey(pick),
    playerKey(pick),
    propCanon,
    num(pick.line ?? pick.selectedLine, ""),
  ].join("|");
}

function isPointsMarket(pick = {}) {
  const stat = String(pick.stat || pick.propType || "points").toLowerCase();
  return !stat || stat.includes("point") || stat === "pts";
}

function bookCount(pick = {}) {
  return (
    num(pick.bookCount ?? pick.books ?? pick.marketIntelligence?.bookCount, 1) ||
    1
  );
}

function isInactive(pick = {}) {
  if (pick.inactive === true || pick.playerInactive === true) return true;
  const status = String(
    pick.availability || pick.playerStatus || pick.injuryStatus || ""
  ).toUpperCase();
  return /OUT|INACTIVE|SUSPENDED|DNP|DID NOT PLAY|INACTIVE/.test(status);
}

function hasVerifiedMinutesExplanation(pick = {}) {
  const why = String(
    pick.displayWhy ||
      pick.decisionIntelligence?.simpleExplanation ||
      pick.roleMinutesNote ||
      ""
  ).toLowerCase();
  return /minutes|injury|rest|load management|role change|confirmed starter|bench/.test(
    why
  );
}

/**
 * Hard market/date validity only — not model quality.
 */
export function evaluateHardMarketValidity(pick = {}, options = {}) {
  const reasons = [];
  const requestedSlateDate =
    options.requestedSlateDate ||
    pick.requestedSlateDate ||
    pick.canonicalSlateDate ||
    toCanonicalSlateDate(pick.commenceTime || pick.commenceTimeUtc) ||
    "";

  const dated = annotatePickWithDateFields(pick, {
    requestedSlateDate,
    verifiedGame: options.verifiedGame || null,
    expectedDayBucket: options.expectedDayBucket || null,
    bundleDate: options.bundleDate || requestedSlateDate,
  });

  const dateResult =
    dated.slateDateVerification ||
    verifyCandidateSlateDate(dated, {
      requestedSlateDate,
      verifiedGame: options.verifiedGame,
      expectedDayBucket: options.expectedDayBucket,
      bundleDate: options.bundleDate || requestedSlateDate,
    });

  if (!dateResult.ok) {
    reasons.push(HARD_EXCLUDE_REASONS.DATE_VERIFICATION_FAILED);
    reasons.push(...(dateResult.dateVerificationReasons || []));
  }

  if (!isPointsMarket(dated)) reasons.push(HARD_EXCLUDE_REASONS.NON_POINTS_MARKET);

  const line = num(dated.line ?? dated.selectedLine);
  if (line == null) reasons.push(HARD_EXCLUDE_REASONS.MISSING_LINE);

  if (!playerKey(dated)) reasons.push(HARD_EXCLUDE_REASONS.INVALID_PLAYER_IDENTITY);

  if (isInactive(dated)) reasons.push(HARD_EXCLUDE_REASONS.PLAYER_INACTIVE);

  const projection = num(
    dated.projection ?? dated.projectedPoints ?? dated.modelProjection
  );
  const fair = num(dated.fairLine ?? dated.fairValueLine);
  const gap = Math.max(
    projection != null && line != null ? Math.abs(projection - line) : 0,
    fair != null && line != null ? Math.abs(fair - line) : 0
  );
  if (
    bookCount(dated) <= 1 &&
    gap >= MARKET_SANITY_GAP_POINTS &&
    !hasVerifiedMinutesExplanation(dated)
  ) {
    reasons.push(HARD_EXCLUDE_REASONS.MARKET_SANITY_HOLD);
  }

  const unique = [...new Set(reasons)];
  return {
    ok: unique.length === 0,
    reasons: unique,
    datedPick: dated,
    dateResult,
    gap,
    bookCount: bookCount(dated),
  };
}

/**
 * Soft model-quality penalties — ranking/confidence packaging only.
 * Never hard-empty a slot alone. Missing bestPropScore ≠ low score.
 * Projection sanity WEAK only when genuinely inconsistent (not MIXED usage advisory).
 */
export function collectSoftPenalties(pick = {}, side = "OVER") {
  const penalties = [];
  let penaltyScore = 0;
  let riskBump = 0;

  const line = num(pick.line ?? pick.selectedLine);
  const projection = num(pick.projection ?? pick.projectedPoints);
  const edge =
    line != null && projection != null
      ? side === "OVER"
        ? projection - line
        : line - projection
      : null;

  if (edge != null && edge < 1.5) {
    penalties.push("THIN_EDGE");
    penaltyScore += 18;
    riskBump += 1;
  } else if (edge != null && edge < 3.5) {
    penalties.push("MODERATE_EDGE");
    penaltyScore += 8;
  }

  const scoreAudit = auditBestPropScore(pick);
  // Until score packaging is fully normalized: use for ranking only.
  // Do not treat MISSING (resolved as 0) as LOW_BEST_PROP_SCORE.
  if (scoreAudit.belowFiftyFloor) {
    penalties.push("LOW_BEST_PROP_SCORE");
    penaltyScore += 20;
    riskBump += 1;
  } else if (
    scoreAudit.present &&
    scoreAudit.scale === "ZERO_TO_HUNDRED" &&
    scoreAudit.raw < 60
  ) {
    penalties.push("SUB_60_BEST_PROP_SCORE");
    penaltyScore += 10;
    riskBump += 0.5;
  }

  const natural = resolveNaturalDecision(pick);
  // BOARD_ONLY is soft ranking pressure, not membership hard reject.
  if (natural === "BOARD_ONLY" || natural === "SHADOW_ONLY") {
    penalties.push("BOARD_ONLY_OR_SHADOW");
    penaltyScore += 8;
    riskBump += 0.25;
  }
  if (natural === "NO_BET") {
    penalties.push("NATURAL_NO_BET");
    penaltyScore += 15;
    riskBump += 1;
  }

  const rescue = resolveSideRescueAction(pick);
  if (rescue === "NO_DECISIVE_RESCUE") {
    penalties.push("NO_DECISIVE_RESCUE");
    penaltyScore += 14;
    riskBump += 1;
  }

  if (resolveRoleStability(pick) === "UNSTABLE") {
    penalties.push("UNSTABLE_ROLE");
    penaltyScore += 12;
    riskBump += 1;
  }

  const vol = resolveVolatility(pick);
  if (vol.classification === "HIGH" || vol.classification === "ELEVATED") {
    penalties.push("ELEVATED_VOLATILITY");
    penaltyScore += 10;
    riskBump += 0.5;
  }

  const shadow = resolveMatchupShadowDirection(pick);
  if (shadow.direction && shadow.direction !== side) {
    penalties.push("MATCHUP_SHADOW_OPPOSES");
    penaltyScore += 8;
    riskBump += 0.5;
  }

  // Side-isolated sanity: Over/Under packets must not share a false universal WEAK.
  const sanityLevel = resolveProjectionSanityLevel(pick, side);
  if (sanityLevel.level === "WEAK") {
    penalties.push("PROJECTION_SANITY_WEAK");
    penaltyScore += 8;
    riskBump += 0.5;
  }

  const conf = num(pick.confidence ?? pick.decisionIntelligence?.finalConfidence, 55);
  if (conf != null && conf < 50) {
    penalties.push("LOW_CONFIDENCE");
    penaltyScore += 6;
  }

  if (bookCount(pick) <= 1) {
    penalties.push("SINGLE_BOOK");
    penaltyScore += 6;
    riskBump += 0.5;
  }

  return {
    penalties,
    penaltyScore,
    riskBump,
    edge,
    scoreAudit,
    projectionSanityLevel: sanityLevel.level,
  };
}

function baseSideScore(pick = {}, side = "OVER") {
  const line = num(pick.line ?? pick.selectedLine);
  const projection = num(pick.projection ?? pick.projectedPoints);
  const fair = num(pick.fairLine ?? pick.fairValueLine);
  const edge =
    line != null && projection != null
      ? side === "OVER"
        ? projection - line
        : line - projection
      : 0;
  const fairAgree =
    fair != null && line != null
      ? side === "OVER"
        ? fair > line
          ? 8
          : fair < line
            ? -6
            : 0
        : fair < line
          ? 8
          : fair > line
            ? -6
            : 0
      : 0;
  const conf = num(pick.confidence ?? pick.decisionIntelligence?.finalConfidence, 50) || 50;
  const propScore = num(resolveBestPropScore(pick), 40) || 40;
  // Positive edge is rewarded; negative edge is still a candidate but weak.
  return 40 + edge * 6 + fairAgree + conf * 0.35 + propScore * 0.2;
}

export function scoreSideCandidate(pick = {}, side = "OVER") {
  const soft = collectSoftPenalties(pick, side);
  const raw = baseSideScore(pick, side);
  // Preferred gap (≥3.0) is a ranking/safety advantage — not equal to bare 1.5 floor.
  const gapBonus = preferredGapRankingBonus(soft.edge);
  const sideScore = Math.max(1, raw - soft.penaltyScore + gapBonus);
  let tier = "TEAM_SIDE_PRIMARY";
  if (soft.penaltyScore >= 28 || soft.riskBump >= 2) tier = "TEAM_SIDE_LAST_VALID";
  else if (soft.penaltyScore >= 12 || soft.riskBump >= 1) tier = "TEAM_SIDE_FALLBACK";

  let trueRisk = String(
    pick.trueRisk || pick.decisionIntelligence?.trueRisk || "MEDIUM"
  ).toUpperCase();
  if (soft.riskBump >= 2) trueRisk = "HIGH";
  else if (soft.riskBump >= 1 && trueRisk === "LOW") trueRisk = "MEDIUM";
  else if (tier === "TEAM_SIDE_LAST_VALID") trueRisk = "HIGH";
  else if (tier === "TEAM_SIDE_FALLBACK" && trueRisk === "LOW") trueRisk = "MEDIUM";

  const confBase = num(pick.confidence ?? pick.decisionIntelligence?.finalConfidence, 55) || 55;
  const confidence = Math.max(
    30,
    Math.round(confBase - soft.penaltyScore * 0.35)
  );

  return {
    sideScore,
    tier,
    trueRisk,
    confidence,
    softPenalties: soft.penalties,
    penaltyScore: soft.penaltyScore,
    edge: soft.edge,
    preferredGapAdvantage: soft.edge != null && soft.edge >= PREFERRED_GAP_FLOOR,
    projectionSanityLevel: soft.projectionSanityLevel || null,
    scoreAudit: soft.scoreAudit || null,
  };
}

/**
 * Build Over + Under side candidates from a market row (no side flip of organic winner —
 * both sides are independently scored evaluations of the same line).
 * Preserves originalModelSide for Gabby-type integrity checks.
 */
export function buildDualSideCandidates(pick = {}, options = {}) {
  const hard = evaluateHardMarketValidity(pick, options);
  if (!hard.ok) {
    return {
      valid: false,
      hardReasons: hard.reasons,
      over: null,
      under: null,
      datedPick: hard.datedPick,
    };
  }

  const base = hard.datedPick;
  const originalModelSide =
    resolveOriginalModelSide(base) ||
    normalizeSide(base.side || base.pick) ||
    null;
  const overScore = scoreSideCandidate(base, "OVER");
  const underScore = scoreSideCandidate(base, "UNDER");

  const mk = (side, scored) => {
    const raw = {
      ...base,
      side,
      pick: side === "OVER" ? "Over" : "Under",
      // Evaluated slot side — do not pretend organic == evaluated when model differs.
      organicSide: side,
      evaluatedSide: side,
      originalModelSide: originalModelSide || side,
      sideChanged: false,
      forcedSide: false,
      autoFlip: false,
      teamSideScore: scored.sideScore,
      teamSideTier: scored.tier,
      confidence: scored.confidence,
      trueRisk: scored.trueRisk,
      riskLabel:
        scored.trueRisk === "LOW"
          ? "Low Risk"
          : scored.trueRisk === "HIGH"
            ? "High Risk"
            : "Medium Risk",
      softPenalties: scored.softPenalties,
      sideEdge: scored.edge,
      preferredGapAdvantage: scored.preferredGapAdvantage === true,
      earlySameTeamDemotion: false,
      // Side-isolated packaging diagnostics (not user-facing membership labels).
      projectionSanityLevel: scored.projectionSanityLevel || null,
      bestPropScoreAudit: scored.scoreAudit || null,
      membershipQualificationStatus: null,
    };
    return stampCalibratedSideCandidate(raw, scored);
  };

  const overCand = mk("OVER", overScore);
  const underCand = mk("UNDER", underScore);

  // Membership quality (Official) — debug candidates keep soft scores even when rejected.
  const overMembership = evaluateOfficialMembershipQuality(overCand, "OVER", {
    tier: overCand.teamSideTier,
    underEdge: underCand.sideEdge,
  });
  const underMembership = evaluateOfficialMembershipQuality(underCand, "UNDER", {
    tier: underCand.teamSideTier,
    underEdge: underCand.sideEdge,
  });

  return {
    valid: true,
    hardReasons: [],
    over: {
      ...overCand,
      membershipQuality: overMembership,
      officialMembershipEligible: overMembership.ok,
      membershipRejectReasons: overMembership.reasons,
      membershipQualificationStatus: overMembership.ok
        ? "QUALIFIED_TEAM_SIDE"
        : "NOT_QUALIFIED",
      validIndependentSideFlip: overMembership.validIndependentSideFlip === true,
    },
    under: {
      ...underCand,
      membershipQuality: underMembership,
      officialMembershipEligible: underMembership.ok,
      membershipRejectReasons: underMembership.reasons,
      membershipQualificationStatus: underMembership.ok
        ? "QUALIFIED_TEAM_SIDE"
        : "NOT_QUALIFIED",
    },
    datedPick: base,
    originalModelSide,
  };
}

function pairConflictPenalties(overCand, underCand) {
  let penalty = 0;
  // Prefer pairs where each side has non-negative edge when possible
  if ((overCand.sideEdge ?? 0) < 0) penalty += 10;
  if ((underCand.sideEdge ?? 0) < 0) penalty += 10;
  if (overCand.teamSideTier === "TEAM_SIDE_LAST_VALID") penalty += 6;
  if (underCand.teamSideTier === "TEAM_SIDE_LAST_VALID") penalty += 6;
  if (overCand.trueRisk === "HIGH" && underCand.trueRisk === "HIGH") penalty += 4;
  return penalty;
}

/**
 * Distinct-player team Over/Under selection with Official membership quality.
 * Empty slots when no candidate meets membership floor — never LAST_VALID force-fill.
 */
export function selectTeamSidePair(teamPicks = [], options = {}) {
  const team = teamKey(teamPicks[0] || {}) || options.teamKey || "unknown";
  const debug = {
    team,
    playersWithPointMarkets: 0,
    validOverCandidates: [],
    validUnderCandidates: [],
    qualifiedOverCandidates: [],
    qualifiedUnderCandidates: [],
    membershipRejected: [],
    hardRejected: [],
    pairs: [],
    selectedPair: null,
    earlySameTeamDemotionCount: 0,
    forcedSideCount: 0,
    autoFlipCount: 0,
    emptyOver: null,
    emptyUnder: null,
    membershipBuild: MEMBERSHIP_QUALITY_BUILD,
  };

  // Deduplicate by player market (keep richest row)
  const byMarket = new Map();
  for (const pick of teamPicks) {
    const key = marketKey(pick) || `${playerKey(pick)}|${pick.line}`;
    const prev = byMarket.get(key);
    if (!prev || (resolveBestPropScore(pick) || 0) >= (resolveBestPropScore(prev) || 0)) {
      byMarket.set(key, pick);
    }
  }

  const overs = [];
  const unders = [];
  let dateFails = 0;
  let eventFails = 0;
  let sanityFails = 0;
  let inactiveFails = 0;
  let inspected = 0;

  for (const pick of byMarket.values()) {
    inspected += 1;
    const dual = buildDualSideCandidates(pick, options);
    if (!dual.valid) {
      debug.hardRejected.push({
        player: pick.player,
        reasons: dual.hardReasons,
      });
      for (const r of dual.hardReasons) {
        if (/DATE_|STALE_|BUNDLE_|TODAY_TOMORROW|SCHEDULE_/.test(String(r))) {
          dateFails += 1;
        }
        if (/EVENT_ID|WRONG_EVENT|TEAM_MATCHUP/.test(String(r))) eventFails += 1;
        if (r === HARD_EXCLUDE_REASONS.MARKET_SANITY_HOLD) sanityFails += 1;
        if (r === HARD_EXCLUDE_REASONS.PLAYER_INACTIVE) inactiveFails += 1;
      }
      continue;
    }
    overs.push(dual.over);
    unders.push(dual.under);
  }

  debug.playersWithPointMarkets = byMarket.size;
  debug.validOverCandidates = overs.map((p) => ({
    player: p.player,
    sideScore: p.teamSideScore,
    edge: p.sideEdge,
    tier: p.teamSideTier,
    risk: p.trueRisk,
    softPenalties: p.softPenalties,
    officialMembershipEligible: p.officialMembershipEligible === true,
    membershipRejectReasons: p.membershipRejectReasons || [],
  }));
  debug.validUnderCandidates = unders.map((p) => ({
    player: p.player,
    sideScore: p.teamSideScore,
    edge: p.sideEdge,
    tier: p.teamSideTier,
    risk: p.trueRisk,
    softPenalties: p.softPenalties,
    officialMembershipEligible: p.officialMembershipEligible === true,
    membershipRejectReasons: p.membershipRejectReasons || [],
  }));

  const emptyMeta = {
    marketsInspected: inspected,
    rejectedDate: dateFails,
    rejectedEventMismatch: eventFails,
    rejectedMarketSanity: sanityFails,
    rejectedInactive: inactiveFails,
  };

  if (!overs.length && !unders.length) {
    let reason = EMPTY_SLOT_REASONS.NO_VALID_POINTS_MARKETS;
    if (inspected === 0) reason = EMPTY_SLOT_REASONS.NO_VALID_POINTS_MARKETS;
    else if (dateFails === inspected) reason = EMPTY_SLOT_REASONS.ALL_MARKETS_DATE_FAILED;
    else if (eventFails > 0 && eventFails + dateFails >= inspected) {
      reason = EMPTY_SLOT_REASONS.ALL_MARKETS_EVENT_MISMATCH;
    } else if (inactiveFails === inspected) reason = EMPTY_SLOT_REASONS.ALL_PLAYERS_INACTIVE;
    else if (sanityFails === inspected) reason = EMPTY_SLOT_REASONS.ALL_MARKETS_SANITY_HOLD;
    debug.emptyOver = { reason, ...emptyMeta };
    debug.emptyUnder = { reason, ...emptyMeta };
    return {
      team,
      selectedOver: null,
      selectedUnder: null,
      selected: [],
      forcedSide: false,
      debug,
    };
  }

  // Official membership filter — LAST_VALID / NO_BET / thin edge cannot seal.
  const qualifiedOvers = [];
  const qualifiedUnders = [];
  for (const cand of overs) {
    if (cand.officialMembershipEligible === true) {
      qualifiedOvers.push(cand);
    } else {
      debug.membershipRejected.push({
        player: cand.player,
        side: "OVER",
        reasons: cand.membershipRejectReasons || [],
        edge: cand.sideEdge,
        tier: cand.teamSideTier,
      });
    }
  }
  for (const cand of unders) {
    if (cand.officialMembershipEligible === true) {
      qualifiedUnders.push(cand);
    } else {
      debug.membershipRejected.push({
        player: cand.player,
        side: "UNDER",
        reasons: cand.membershipRejectReasons || [],
        edge: cand.sideEdge,
        tier: cand.teamSideTier,
      });
    }
  }

  debug.qualifiedOverCandidates = qualifiedOvers.map((p) => ({
    player: p.player,
    sideScore: p.teamSideScore,
    edge: p.sideEdge,
    tier: p.teamSideTier,
  }));
  debug.qualifiedUnderCandidates = qualifiedUnders.map((p) => ({
    player: p.player,
    sideScore: p.teamSideScore,
    edge: p.sideEdge,
    tier: p.teamSideTier,
  }));

  // Rank qualified candidates (preferred gap already baked into sideScore)
  qualifiedOvers.sort((a, b) => (b.teamSideScore || 0) - (a.teamSideScore || 0));
  qualifiedUnders.sort((a, b) => (b.teamSideScore || 0) - (a.teamSideScore || 0));

  let selectedOver = qualifiedOvers[0] || null;
  let selectedUnder = selectedOver
    ? qualifiedUnders.find((u) => playerKey(u) !== playerKey(selectedOver)) || null
    : qualifiedUnders[0] || null;

  // If under won first and over collides, try next over
  if (selectedOver && selectedUnder && playerKey(selectedOver) === playerKey(selectedUnder)) {
    selectedUnder =
      qualifiedUnders.find((u) => playerKey(u) !== playerKey(selectedOver)) || null;
  }
  if (!selectedOver && qualifiedOvers.length) selectedOver = qualifiedOvers[0];
  if (!selectedUnder && qualifiedUnders.length) {
    selectedUnder = selectedOver
      ? qualifiedUnders.find((u) => playerKey(u) !== playerKey(selectedOver)) || null
      : qualifiedUnders[0] || null;
  }

  // Prefer distinct-player pair among qualified when both sides exist
  if (qualifiedOvers.length && qualifiedUnders.length) {
    let bestPair = null;
    for (const overCand of qualifiedOvers) {
      for (const underCand of qualifiedUnders) {
        if (playerKey(overCand) === playerKey(underCand)) continue;
        const conflict = pairConflictPenalties(overCand, underCand);
        const teamPairScore =
          (overCand.teamSideScore || 0) + (underCand.teamSideScore || 0) - conflict;
        const pair = {
          over: overCand,
          under: underCand,
          teamPairScore,
          conflictPenalties: conflict,
        };
        debug.pairs.push({
          overPlayer: overCand.player,
          underPlayer: underCand.player,
          teamPairScore,
          conflict,
          overScore: overCand.teamSideScore,
          underScore: underCand.teamSideScore,
        });
        if (!bestPair || teamPairScore > bestPair.teamPairScore) bestPair = pair;
      }
    }
    debug.pairs.sort((a, b) => b.teamPairScore - a.teamPairScore);
    if (bestPair) {
      selectedOver = bestPair.over;
      selectedUnder = bestPair.under;
      debug.selectedPair = {
        overPlayer: selectedOver.player,
        underPlayer: selectedUnder.player,
        teamPairScore: bestPair.teamPairScore,
        membershipQualified: true,
      };
    } else {
      // No distinct-player pair — keep best single side(s), leave the other empty if collision-only
      selectedOver = qualifiedOvers[0] || null;
      selectedUnder =
        qualifiedUnders.find((u) => playerKey(u) !== playerKey(selectedOver)) ||
        null;
      if (!selectedUnder && qualifiedUnders[0] && !selectedOver) {
        selectedUnder = qualifiedUnders[0];
      }
    }
  }

  if (!selectedOver) {
    const rejectPool = debug.membershipRejected.filter((r) => r.side === "OVER");
    const topReasons = rejectPool[0]?.reasons || [];
    debug.emptyOver = {
      reason: emptySlotReasonForSide("OVER", topReasons),
      membershipRejectSample: rejectPool.slice(0, 5),
      ...emptyMeta,
    };
  }
  if (!selectedUnder) {
    const rejectPool = debug.membershipRejected.filter((r) => r.side === "UNDER");
    const topReasons = rejectPool[0]?.reasons || [];
    debug.emptyUnder = {
      reason: emptySlotReasonForSide("UNDER", topReasons),
      membershipRejectSample: rejectPool.slice(0, 5),
      ...emptyMeta,
    };
  }

  const stamp = (pick, slot) => {
    if (!pick) return null;
    const side = normalizeSide(pick.side || pick.pick) || (slot.includes("OVER") ? "OVER" : "UNDER");
    const trackLabel = resolveOfficialTrackLabel(pick);
    const membership = evaluateOfficialMembershipQuality(pick, side, {
      tier: pick.teamSideTier,
    });
    // Final seal gate — never stamp a failing membership prop
    if (!membership.ok) {
      return null;
    }
    return {
      ...pick,
      teamSlot: slot,
      selectedTeamSlot: slot,
      controlledBestBoard: true,
      sourcePool: "CONTROLLED_BEST_BOARD",
      trackingAdmissionSource: "CONTROLLED_BEST_BOARD",
      sideChanged: false,
      forcedSide: false,
      autoFlip: false,
      selectionBuiltAt: new Date().toISOString(),
      controlledBestBoardMeta: {
        version: CONTROLLED_BEST_BOARD_VERSION,
        build: CONTROLLED_BEST_BOARD_BUILD,
        membershipBuild: MEMBERSHIP_QUALITY_BUILD,
        calibration: CONTROLLED_BEST_BOARD_CALIBRATION,
        team,
        slot,
        tier: pick.teamSideTier,
        sideScore: pick.teamSideScore,
        baselineSideScore: pick.baselineTeamSideScore ?? null,
        calibratedSideScore: pick.calibratedTeamSideScore ?? pick.teamSideScore,
        membershipEdgeFloor: MEMBERSHIP_EDGE_FLOOR,
        preferredGapFloor: PREFERRED_GAP_FLOOR,
        preferredGapAdvantage: pick.preferredGapAdvantage === true,
      },
      // TRACK inherited — never invented by team-slot selection
      naturalDecision: resolveNaturalDecision(pick) || trackLabel,
      resultsDecisionLabel: trackLabel,
      wnbaTrackingDecision: trackLabel,
      trackingEligibility: trackLabel,
      decisionIntelligence: {
        ...(pick.decisionIntelligence || {}),
        trueRisk: pick.trueRisk,
        finalConfidence: pick.confidence,
        riskAfterDecision: pick.riskLabel,
        calibrationVersion: pick.calibrationVersion || CONTROLLED_BEST_BOARD_CALIBRATION,
        naturalDecision: resolveNaturalDecision(pick) || trackLabel,
        trackEligibility: trackLabel,
      },
      calibrationVersion: pick.calibrationVersion || CONTROLLED_BEST_BOARD_CALIBRATION,
      baselineSelectedSide: pick.organicSide || pick.side,
      calibratedSelectedSide: pick.organicSide || pick.side,
      organicSide: pick.organicSide || side,
      evaluatedSide: pick.evaluatedSide || side,
      originalModelSide: pick.originalModelSide || resolveOriginalModelSide(pick) || side,
      validIndependentSideFlip: pick.validIndependentSideFlip === true,
      sideEdge: pick.sideEdge ?? resolveDirectionalEdge(pick, side),
      membershipQualityBuild: MEMBERSHIP_QUALITY_BUILD,
    };
  };

  const selected = [];
  const overStamped = stamp(selectedOver, "TEAM_BEST_OVER");
  const underStamped = stamp(selectedUnder, "TEAM_BEST_UNDER");
  if (overStamped) selected.push(overStamped);
  else if (selectedOver && !debug.emptyOver) {
    debug.emptyOver = {
      reason: emptySlotReasonForSide(
        "OVER",
        selectedOver.membershipRejectReasons || [MEMBERSHIP_REJECT.NO_QUALIFIED_TEAM_OVER]
      ),
      ...emptyMeta,
    };
  }
  if (underStamped) selected.push(underStamped);
  else if (selectedUnder && !debug.emptyUnder) {
    debug.emptyUnder = {
      reason: emptySlotReasonForSide(
        "UNDER",
        selectedUnder.membershipRejectReasons || [MEMBERSHIP_REJECT.NO_QUALIFIED_TEAM_UNDER]
      ),
      ...emptyMeta,
    };
  }

  return {
    team,
    selectedOver: overStamped,
    selectedUnder: underStamped,
    selected,
    forcedSide: false,
    debug,
  };
}

// Back-compat alias
export const selectTeamSideSlots = selectTeamSidePair;

export function selectControlledBestBoard(candidates = [], options = {}) {
  const league = String(options.league || "WNBA").toUpperCase();
  const list = (Array.isArray(candidates) ? candidates : []).filter(
    (p) => String(p.league || "WNBA").toUpperCase() === league
  );

  const requestedSlateDate =
    options.requestedSlateDate ||
    list[0]?.canonicalSlateDate ||
    list[0]?.slateDate ||
    toCanonicalSlateDate(list[0]?.commenceTime) ||
    getCurrentCtDate();

  // Probability / Safety / True Low-Risk Architecture V1 (default ON).
  // Forecast+membership: LOW then MEDIUM only; no team-pair quotas; no fixed six.
  if (isProbabilitySafetyArchitectureEnabled(options)) {
    return selectControlledBestBoardViaProbabilitySafetyV1(
      list,
      { ...options, requestedSlateDate },
      requestedSlateDate
    );
  }

  const gamesMap = new Map();
  for (const pick of list) {
    const gKey = gameKey(pick);
    if (!gamesMap.has(gKey)) gamesMap.set(gKey, []);
    gamesMap.get(gKey).push(pick);
  }

  const gameAudits = [];
  const board = [];
  let emptySlots = 0;
  let qualifiedOverSlots = 0;
  let qualifiedUnderSlots = 0;
  let validMarketButEmptySlotCount = 0;
  const quarantine = [];

  for (const [gKey, gamePicks] of gamesMap.entries()) {
    const sample = gamePicks[0] || {};
    const verifiedGame = options.verifiedGamesByEventId?.[gKey] || {
      eventId: gKey,
      providerEventId: gKey,
      homeTeam: sample.homeTeam || sample.opponent,
      awayTeam: sample.awayTeam || sample.team,
      commenceTime: sample.commenceTime || sample.commenceTimeUtc,
      canonicalSlateDate: requestedSlateDate,
    };

    const teamsMap = new Map();
    for (const pick of gamePicks) {
      const tKey = teamKey(pick) || "unknown";
      if (!teamsMap.has(tKey)) teamsMap.set(tKey, []);
      teamsMap.get(tKey).push(pick);
    }

    const teamAudits = [];
    for (const [tKey, teamPicks] of teamsMap.entries()) {
      const teamResult = selectTeamSidePair(teamPicks, {
        ...options,
        requestedSlateDate,
        expectedDayBucket: options.expectedDayBucket || null,
        verifiedGame,
        bundleDate: options.bundleDate || requestedSlateDate,
        teamKey: tKey,
      });
      teamAudits.push(teamResult.debug);

      if (teamResult.selectedOver) {
        board.push(teamResult.selectedOver);
        qualifiedOverSlots += 1;
      } else {
        emptySlots += 1;
        if ((teamResult.debug.playersWithPointMarkets || 0) > 0) {
          // Had markets but still empty — only OK for genuine data reasons
          const r = teamResult.debug.emptyOver?.reason || "";
          if (
            !/NO_VALID_DIFFERENT_PLAYER|FEWER_THAN_TWO|ALL_PLAYERS_INACTIVE|ALL_MARKETS_/.test(
              r
            )
          ) {
            validMarketButEmptySlotCount += 1;
          }
        }
      }
      if (teamResult.selectedUnder) {
        board.push(teamResult.selectedUnder);
        qualifiedUnderSlots += 1;
      } else {
        emptySlots += 1;
        if ((teamResult.debug.playersWithPointMarkets || 0) > 0) {
          const r = teamResult.debug.emptyUnder?.reason || "";
          if (
            !/NO_VALID_DIFFERENT_PLAYER|FEWER_THAN_TWO|ALL_PLAYERS_INACTIVE|ALL_MARKETS_/.test(
              r
            )
          ) {
            validMarketButEmptySlotCount += 1;
          }
        }
      }

      for (const rej of teamResult.debug.hardRejected || []) {
        quarantine.push({
          player: rej.player,
          reason: (rej.reasons || []).join(" + "),
          hardExclusions: rej.reasons,
        });
      }
    }

    gameAudits.push({
      gameKey: gKey,
      requestedSlateDate,
      canonicalSlateDate: requestedSlateDate,
      commenceTimeUtc: sample.commenceTime || sample.commenceTimeUtc || null,
      providerEventId: gKey,
      teams: teamAudits,
      selectedCount: teamAudits.reduce(
        (n, t) =>
          n +
          (t.selectedPair?.overPlayer || t.emptyOver ? 0 : 0) +
          (t.selectedOver ? 1 : 0) +
          (t.selectedUnder ? 1 : 0),
        0
      ),
    });
  }

  // Recount selected from board for audit accuracy
  for (const g of gameAudits) {
    g.selectedCount = g.teams.reduce(
      (n, t) =>
        n +
        (t.selectedPair ? 2 : (t.emptyOver ? 0 : 0) + (t.emptyUnder ? 0 : 0)),
      0
    );
    // Fix: use selectedPair presence
    g.selectedCount = g.teams.reduce((n, t) => {
      let c = 0;
      if (t.selectedPair?.overPlayer || (t.validOverCandidates?.length && !t.emptyOver && t.selectedPair))
        c += t.selectedPair ? 1 : 0;
      if (t.selectedPair) return n + 2;
      // fallback from empty flags
      const hasOver = !t.emptyOver && (t.validOverCandidates || []).length;
      const hasUnder = !t.emptyUnder && (t.validUnderCandidates || []).length;
      // Actually team debug stores selectedPair when both; else check empty flags
      if (t.selectedPair) return n + 2;
      let add = 0;
      if (!t.emptyOver && (t.validOverCandidates || []).length) add += 1;
      if (!t.emptyUnder && (t.validUnderCandidates || []).length) add += 1;
      // Prefer selectedPair
      return n + (t.selectedPair ? 2 : add);
    }, 0);
  }

  const verifiedBoard = [];
  for (const pick of board) {
    const check = verifyCandidateSlateDate(pick, {
      requestedSlateDate,
      expectedDayBucket: options.expectedDayBucket,
      bundleDate: options.bundleDate || requestedSlateDate,
    });
    if (!check.ok) {
      emptySlots += 1;
      quarantine.push({
        player: pick.player,
        reason: check.dateVerificationReasons.join(" + "),
        hardExclusions: check.dateVerificationReasons,
      });
      continue;
    }
    verifiedBoard.push({
      ...pick,
      dateVerificationStatus: "PASS",
      dateVerificationReasons: [],
    });
  }

  // Full board ranked by safety later in canonical packet (safest → riskiest).
  // Do not emit Top / Best 6 Overall membership surfaces.
  const stampedBoard = verifiedBoard.map((p, i) => ({
    ...p,
    controlledBestBoardRank: i + 1,
    controlledBestBoardSize: verifiedBoard.length,
    isTopPick: false,
    bestSixOverallRank: null,
    controlledBestSixDisplay: true,
    controlledBestSixRank: i + 1,
    resultsAdmissionEligible: true,
  }));

  const earlySameTeamDemotionCount = gameAudits.reduce(
    (n, g) =>
      n +
      g.teams.reduce((m, t) => m + (t.earlySameTeamDemotionCount || 0), 0),
    0
  );

  const preliminary = {
    board: stampedBoard,
    bestSix: stampedBoard,
    topPicks: [],
    bestSixOverall: [],
    audit: {
      version: CONTROLLED_BEST_BOARD_VERSION,
      build: CONTROLLED_BEST_BOARD_BUILD,
      membershipBuild: MEMBERSHIP_QUALITY_BUILD,
      membershipEdgeFloor: MEMBERSHIP_EDGE_FLOOR,
      preferredGapFloor: PREFERRED_GAP_FLOOR,
      lastValidOfficialFillDisabled: true,
      allowEmptyOfficialBoard: true,
      noFixedMinimumBoardCount: true,
      calibration: CONTROLLED_BEST_BOARD_CALIBRATION,
      calibrationActive: true,
      calibrationMode: "ACTIVE_FOR_FUTURE_UNSEALED_WNBA_POINTS_BOARDS",
      calibrationWeightsUnchanged: true,
      dateVerificationVersion: SLATE_DATE_VERIFICATION_VERSION,
      dateVerificationBuild: SLATE_DATE_VERIFICATION_BUILD,
      requestedSlateDate,
      timezone: "America/Chicago",
      dateVerificationStatus: quarantine.some((q) =>
        /DATE_|STALE_|EVENT_/.test(q.reason || "")
      )
        ? "PARTIAL"
        : "PASS",
      gamesEvaluated: gameAudits.length,
      teamsEvaluated: new Set(stampedBoard.map((p) => teamKey(p))).size,
      selectedCount: stampedBoard.length,
      qualifiedOverSlots,
      qualifiedUnderSlots,
      emptySlots,
      topPicksCount: 0,
      bestSixOverallCount: 0,
      topPicksRemoved: true,
      bestSixRemoved: true,
      labLifecycleRemoved: true,
      maxPropsPerTeam: MAX_PROPS_PER_TEAM,
      maxPropsPerGame: MAX_PROPS_PER_GAME,
      forcedSides: 0,
      sameTeamFlips: 0,
      earlySameTeamDemotionCount,
      validMarketButEmptySlotCount,
      gameAudits,
      quarantine,
      title: `CourtEdge Controlled Best Board — ${requestedSlateDate} CT`,
      sixRowCapApplied: false,
      noGlobalCap: true,
    },
  };

  const canonical = buildCanonicalControlledBoardPacket(preliminary, {
    requestedSlateDate,
    selectionBuildId: options.selectionBuildId || null,
  });

  return {
    ...preliminary,
    selectedProps: canonical.selectedProps,
    officialMembership: canonical.officialMembership,
    controlledBestBoardV2: canonical,
    selectionBuildId: canonical.selectionBuildId,
    membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
    board: canonical.selectedProps,
    bestSix: canonical.selectedProps,
    bestSixOverall: canonical.bestSixOverall,
    topPicks: canonical.topPicks,
    audit: {
      ...preliminary.audit,
      selectionBuildId: canonical.selectionBuildId,
      membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
      sealBuild: CANONICAL_BOARD_SEAL_BUILD,
      membershipValid: canonical.membershipValid,
      invariants: canonical.invariants,
    },
    controlledBestBoardAudit: {
      ...preliminary.audit,
      selectionBuildId: canonical.selectionBuildId,
      membershipValid: canonical.membershipValid,
    },
    controlledBestSixDisplayAudit: {
      ...preliminary.audit,
      displayMode: true,
      boardMode: "CONTROLLED_BEST_BOARD_V2",
      membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
      selectionBuildId: canonical.selectionBuildId,
      selectedBestSixCount: canonical.selectedProps.length,
      resultsAdmissionCount: canonical.selectedProps.length,
    },
  };
}

export function selectControlledBestBoardCombined(candidates = [], options = {}) {
  const now = options.now || new Date();
  const todayCt = options.todayCt || getCurrentCtDate(now);
  const tomorrowCt = options.tomorrowCt || getNextCtDate(now);

  const list = Array.isArray(candidates) ? candidates : [];
  const todayPool = [];
  const tomorrowPool = [];
  const other = [];

  for (const pick of list) {
    const commence = pick.commenceTime || pick.commenceTimeUtc || pick.time;
    const canonical =
      pick.canonicalSlateDate ||
      toCanonicalSlateDate(commence) ||
      pick.slateDate ||
      "";
    const annotated = {
      ...pick,
      canonicalSlateDate: canonical,
      requestedSlateDate: canonical,
      commenceTimeUtc: commence || pick.commenceTimeUtc || null,
    };
    if (canonical === todayCt) todayPool.push(annotated);
    else if (canonical === tomorrowCt) tomorrowPool.push(annotated);
    else other.push(annotated);
  }

  const todayBoard = selectControlledBestBoard(todayPool, {
    ...options,
    requestedSlateDate: todayCt,
    expectedDayBucket: "TODAY",
    league: options.league || "WNBA",
  });
  const tomorrowBoard = selectControlledBestBoard(tomorrowPool, {
    ...options,
    requestedSlateDate: tomorrowCt,
    expectedDayBucket: "TOMORROW",
    league: options.league || "WNBA",
  });

  const merged = [
    ...todayBoard.board.map((p) => ({
      ...p,
      bestSixDayBucket: "TODAY",
      dayBucket: "TODAY",
    })),
    ...tomorrowBoard.board.map((p) => ({
      ...p,
      bestSixDayBucket: "TOMORROW",
      dayBucket: "TOMORROW",
    })),
  ];

  // Official membership: only control-plane officialSelected rows.
  const officialOnly = (board = {}) =>
    (board.board || board.selectedProps || []).filter(
      (p) => p?.officialSelected === true || p?.officialEligible === true
    );
  const todayOfficial = officialOnly(todayBoard);
  const tomorrowOfficial = officialOnly(tomorrowBoard);
  const officialMembership = [
    ...todayOfficial.map((p) => ({
      ...p,
      bestSixDayBucket: "TODAY",
      dayBucket: "TODAY",
    })),
    ...tomorrowOfficial.map((p) => ({
      ...p,
      bestSixDayBucket: "TOMORROW",
      dayBucket: "TOMORROW",
    })),
  ];

  const boardCandidatesToday =
    todayBoard.probabilitySafety?.boardCandidates ||
    todayBoard.boardCandidates ||
    [];
  const boardCandidatesTomorrow =
    tomorrowBoard.probabilitySafety?.boardCandidates ||
    tomorrowBoard.boardCandidates ||
    [];

  // Prefer tomorrow's build id when tomorrow has membership (seal target), else today.
  const primaryPacket =
    tomorrowBoard.controlledBestBoardV2?.selectedProps?.length
      ? tomorrowBoard.controlledBestBoardV2
      : todayBoard.controlledBestBoardV2;

  return {
    board: officialMembership,
    boardCandidatesToday,
    boardCandidatesTomorrow,
    boardCandidates: [...boardCandidatesToday, ...boardCandidatesTomorrow],
    probabilitySafetyToday: todayBoard.probabilitySafety || null,
    probabilitySafetyTomorrow: tomorrowBoard.probabilitySafety || null,
    bestSix: officialMembership,
    selectedProps: officialMembership,
    officialMembership,
    selectionBuildId: primaryPacket?.selectionBuildId || null,
    membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
    controlledBestBoardV2: {
      membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
      selectionBuildId: primaryPacket?.selectionBuildId || null,
      selectedProps: officialMembership,
      officialMembership,
      today: todayBoard.controlledBestBoardV2 || null,
      tomorrow: tomorrowBoard.controlledBestBoardV2 || null,
      variableBoardSize: true,
      boardVersion: CONTROLLED_BEST_BOARD_VERSION,
    },
    today: {
      ...todayBoard,
      board: todayOfficial,
      bestSix: todayOfficial,
      selectedProps: todayOfficial,
    },
    tomorrow: {
      ...tomorrowBoard,
      board: tomorrowOfficial,
      bestSix: tomorrowOfficial,
      selectedProps: tomorrowOfficial,
    },
    topPicks: tomorrowBoard.topPicks.length
      ? tomorrowBoard.topPicks
      : todayBoard.topPicks,
    bestSixOverall: [
      ...todayBoard.bestSixOverall,
      ...tomorrowBoard.bestSixOverall,
    ].slice(0, BEST_SIX_OVERALL_LIMIT),
    audit: {
      version: CONTROLLED_BEST_BOARD_VERSION,
      build: CONTROLLED_BEST_BOARD_BUILD,
      todayCt,
      tomorrowCt,
      todayCount: todayBoard.board.length,
      tomorrowCount: tomorrowBoard.board.length,
      otherPartitionCount: other.length,
      today: todayBoard.audit,
      tomorrow: tomorrowBoard.audit,
      selectionBuildId: primaryPacket?.selectionBuildId || null,
      membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
      earlySameTeamDemotionCount:
        (todayBoard.audit.earlySameTeamDemotionCount || 0) +
        (tomorrowBoard.audit.earlySameTeamDemotionCount || 0),
      validMarketButEmptySlotCount:
        (todayBoard.audit.validMarketButEmptySlotCount || 0) +
        (tomorrowBoard.audit.validMarketButEmptySlotCount || 0),
    },
  };
}
