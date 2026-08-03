/**
 * CourtEdge Controlled Best Board V2
 * Mandatory Best Over + Best Under per team via distinct-player pair optimization.
 * Model-quality weaknesses → ranking/risk penalties, not empty slots.
 * Hard exclusions: date/event/market validity (+ MARKET_SANITY_HOLD) only.
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
  resolveFinalSide,
  resolveBestPropScore,
  resolveRoleStability,
  resolveVolatility,
  resolveMatchupShadowDirection,
  resolveProjectionSanity,
  resolveNaturalDecision,
  resolveSideRescueAction,
} from "./bestSixSelectionIntegrityV1.js";
import {
  buildCanonicalControlledBoardPacket,
  CANONICAL_BOARD_MEMBERSHIP_MODEL,
  CANONICAL_BOARD_SEAL_BUILD,
} from "./controlledBestBoardCanonicalV3.js";

export const CONTROLLED_BEST_BOARD_VERSION = "controlled-best-board-v2";
export const CONTROLLED_BEST_BOARD_BUILD =
  "courteedge-mandatory-team-over-under-pair-selection-v2";

export const MAX_PROPS_PER_TEAM = 2;
export const MAX_OVERS_PER_TEAM = 1;
export const MAX_UNDERS_PER_TEAM = 1;
export const MAX_PROPS_PER_GAME = 4;
export const TOP_PICKS_LIMIT = 2;
export const BEST_SIX_OVERALL_LIMIT = 6;

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
  return [
    gameKey(pick),
    playerKey(pick),
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
 * Soft model-quality penalties — never hard-empty a slot alone.
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

  const score = resolveBestPropScore(pick);
  if (score != null && score < 50) {
    penalties.push("LOW_BEST_PROP_SCORE");
    penaltyScore += 20;
    riskBump += 1;
  } else if (score != null && score < 60) {
    penalties.push("SUB_60_BEST_PROP_SCORE");
    penaltyScore += 10;
    riskBump += 0.5;
  }

  const natural = resolveNaturalDecision(pick);
  if (natural === "BOARD_ONLY" || natural === "SHADOW_ONLY") {
    penalties.push("BOARD_ONLY_OR_SHADOW");
    penaltyScore += 12;
    riskBump += 0.5;
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

  const sanity = resolveProjectionSanity(pick);
  if (sanity.questionsUsage) {
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

  return { penalties, penaltyScore, riskBump, edge };
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
  const sideScore = Math.max(1, raw - soft.penaltyScore);
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
  };
}

/**
 * Build Over + Under side candidates from a market row (no side flip of organic winner —
 * both sides are independently scored evaluations of the same line).
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
  const overScore = scoreSideCandidate(base, "OVER");
  const underScore = scoreSideCandidate(base, "UNDER");

  const mk = (side, scored) => ({
    ...base,
    side,
    pick: side === "OVER" ? "Over" : "Under",
    organicSide: side,
    evaluatedSide: side,
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
    earlySameTeamDemotion: false,
  });

  return {
    valid: true,
    hardReasons: [],
    over: mk("OVER", overScore),
    under: mk("UNDER", underScore),
    datedPick: base,
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
 * Distinct-player pair optimization for one team.
 */
export function selectTeamSidePair(teamPicks = [], options = {}) {
  const team = teamKey(teamPicks[0] || {}) || options.teamKey || "unknown";
  const debug = {
    team,
    playersWithPointMarkets: 0,
    validOverCandidates: [],
    validUnderCandidates: [],
    hardRejected: [],
    pairs: [],
    selectedPair: null,
    earlySameTeamDemotionCount: 0,
    forcedSideCount: 0,
    autoFlipCount: 0,
    emptyOver: null,
    emptyUnder: null,
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
  }));
  debug.validUnderCandidates = unders.map((p) => ({
    player: p.player,
    sideScore: p.teamSideScore,
    edge: p.sideEdge,
    tier: p.teamSideTier,
    risk: p.trueRisk,
    softPenalties: p.softPenalties,
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

  const distinctPlayers = new Set([
    ...overs.map(playerKey),
    ...unders.map(playerKey),
  ]);

  // Pair search
  let bestPair = null;
  for (const overCand of overs) {
    for (const underCand of unders) {
      if (playerKey(overCand) === playerKey(underCand)) continue;
      const conflict = pairConflictPenalties(overCand, underCand);
      const teamPairScore =
        (overCand.teamSideScore || 0) + (underCand.teamSideScore || 0) - conflict;
      const pair = {
        over: overCand,
        under: underCand,
        teamPairScore,
        conflictPenalties: conflict,
        overScore: overCand.teamSideScore,
        underScore: underCand.teamSideScore,
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

  let selectedOver = null;
  let selectedUnder = null;

  if (bestPair) {
    selectedOver = bestPair.over;
    selectedUnder = bestPair.under;
    debug.selectedPair = {
      overPlayer: selectedOver.player,
      underPlayer: selectedUnder.player,
      teamPairScore: bestPair.teamPairScore,
    };
  } else if (distinctPlayers.size < 2) {
    // Only one distinct player — keep stronger side only
    const onlyPlayer = [...distinctPlayers][0];
    const overCand = overs.find((p) => playerKey(p) === onlyPlayer);
    const underCand = unders.find((p) => playerKey(p) === onlyPlayer);
    if (overCand && underCand) {
      if ((overCand.teamSideScore || 0) >= (underCand.teamSideScore || 0)) {
        selectedOver = overCand;
        debug.emptyUnder = {
          reason: EMPTY_SLOT_REASONS.NO_VALID_DIFFERENT_PLAYER,
          ...emptyMeta,
        };
      } else {
        selectedUnder = underCand;
        debug.emptyOver = {
          reason: EMPTY_SLOT_REASONS.NO_VALID_DIFFERENT_PLAYER,
          ...emptyMeta,
        };
      }
    } else if (overCand) {
      selectedOver = overCand;
      debug.emptyUnder = {
        reason: EMPTY_SLOT_REASONS.FEWER_THAN_TWO_DISTINCT_PLAYERS,
        ...emptyMeta,
      };
    } else if (underCand) {
      selectedUnder = underCand;
      debug.emptyOver = {
        reason: EMPTY_SLOT_REASONS.FEWER_THAN_TWO_DISTINCT_PLAYERS,
        ...emptyMeta,
      };
    }
  } else {
    // Fallback: best sides even if pair empty (shouldn't happen if 2+ players)
    overs.sort((a, b) => (b.teamSideScore || 0) - (a.teamSideScore || 0));
    unders.sort((a, b) => (b.teamSideScore || 0) - (a.teamSideScore || 0));
    selectedOver = overs[0] || null;
    selectedUnder =
      unders.find((u) => playerKey(u) !== playerKey(selectedOver)) || null;
    if (!selectedUnder) {
      debug.emptyUnder = {
        reason: EMPTY_SLOT_REASONS.NO_VALID_DIFFERENT_PLAYER,
        ...emptyMeta,
      };
    }
  }

  if (!selectedOver && !debug.emptyOver) {
    debug.emptyOver = {
      reason: EMPTY_SLOT_REASONS.NO_VALID_SIDE_CANDIDATES,
      ...emptyMeta,
    };
  }
  if (!selectedUnder && !debug.emptyUnder) {
    debug.emptyUnder = {
      reason: EMPTY_SLOT_REASONS.NO_VALID_SIDE_CANDIDATES,
      ...emptyMeta,
    };
  }

  const stamp = (pick, slot) => {
    if (!pick) return null;
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
        team,
        slot,
        tier: pick.teamSideTier,
        sideScore: pick.teamSideScore,
      },
      decisionIntelligence: {
        ...(pick.decisionIntelligence || {}),
        trueRisk: pick.trueRisk,
        finalConfidence: pick.confidence,
        riskAfterDecision: pick.riskLabel,
      },
    };
  };

  const selected = [];
  const overStamped = stamp(selectedOver, "TEAM_BEST_OVER");
  const underStamped = stamp(selectedUnder, "TEAM_BEST_UNDER");
  if (overStamped) selected.push(overStamped);
  if (underStamped) selected.push(underStamped);

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

  const ranked = [...verifiedBoard].sort(
    (a, b) => (b.teamSideScore || 0) - (a.teamSideScore || 0)
  );
  const topPicks = ranked.slice(0, TOP_PICKS_LIMIT).map((p, i) => ({
    ...p,
    topPickRank: i + 1,
    isTopPick: true,
  }));
  const bestSixOverall = ranked.slice(0, BEST_SIX_OVERALL_LIMIT).map((p, i) => ({
    ...p,
    bestSixOverallRank: i + 1,
    bestSixOverallView: true,
  }));

  const stampedBoard = ranked.map((p, i) => ({
    ...p,
    controlledBestBoardRank: i + 1,
    controlledBestBoardSize: ranked.length,
    isTopPick: topPicks.some((t) => playerKey(t) === playerKey(p) && t.side === p.side),
    bestSixOverallRank:
      bestSixOverall.find(
        (b) => playerKey(b) === playerKey(p) && b.side === p.side
      )?.bestSixOverallRank || null,
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
    topPicks,
    bestSixOverall,
    audit: {
      version: CONTROLLED_BEST_BOARD_VERSION,
      build: CONTROLLED_BEST_BOARD_BUILD,
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
      topPicksCount: Math.min(TOP_PICKS_LIMIT, stampedBoard.length),
      bestSixOverallCount: Math.min(BEST_SIX_OVERALL_LIMIT, stampedBoard.length),
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

  // Prefer tomorrow's build id when tomorrow has membership (seal target), else today.
  const primaryPacket =
    tomorrowBoard.controlledBestBoardV2?.selectedProps?.length
      ? tomorrowBoard.controlledBestBoardV2
      : todayBoard.controlledBestBoardV2;

  return {
    board: merged,
    bestSix: merged,
    selectedProps: merged,
    officialMembership: merged,
    selectionBuildId: primaryPacket?.selectionBuildId || null,
    membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
    controlledBestBoardV2: {
      membershipModel: CANONICAL_BOARD_MEMBERSHIP_MODEL,
      selectionBuildId: primaryPacket?.selectionBuildId || null,
      selectedProps: merged,
      officialMembership: merged,
      today: todayBoard.controlledBestBoardV2 || null,
      tomorrow: tomorrowBoard.controlledBestBoardV2 || null,
      variableBoardSize: true,
      boardVersion: CONTROLLED_BEST_BOARD_VERSION,
    },
    today: todayBoard,
    tomorrow: tomorrowBoard,
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
