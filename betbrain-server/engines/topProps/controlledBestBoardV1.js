/**
 * CourtEdge Controlled Best Board V1
 * Team-balanced variable board: max 1 Over + 1 Under per team (≤4/game).
 * No forced sides. No fixed six. Strict CT date verification.
 * Preserves Pre-Next-Slate Selection Integrity V1. Does not reinstall Directional V1.
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
  evaluateBestSixSelectionIntegrity,
  applyConflictConfidenceRiskRecalibration,
  resolveFinalSide,
  resolveProjectionEdgeForFinalSide,
  resolveBestPropScore,
} from "./bestSixSelectionIntegrityV1.js";

export const CONTROLLED_BEST_BOARD_VERSION = "controlled-best-board-v1";
export const CONTROLLED_BEST_BOARD_BUILD =
  "courteedge-team-balanced-variable-board-date-verification-v1";

export const MAX_PROPS_PER_TEAM = 2;
export const MAX_OVERS_PER_TEAM = 1;
export const MAX_UNDERS_PER_TEAM = 1;
export const MAX_PROPS_PER_GAME = 4;
export const TOP_PICKS_LIMIT = 2;
export const BEST_SIX_OVERALL_LIMIT = 6;

export const EMPTY_SLOT_REASONS = {
  NO_QUALIFIED_TEAM_OVER: "NO_QUALIFIED_TEAM_OVER",
  NO_QUALIFIED_TEAM_UNDER: "NO_QUALIFIED_TEAM_UNDER",
  BEST_PLAYER_ALREADY_USED_FOR_OPPOSITE_SLOT:
    "BEST_PLAYER_ALREADY_USED_FOR_OPPOSITE_SLOT",
  DATE_VERIFICATION_FAILED: "DATE_VERIFICATION_FAILED",
  INTEGRITY_GATE_REJECTED_ALL: "INTEGRITY_GATE_REJECTED_ALL",
  MARKET_COVERAGE_INSUFFICIENT: "MARKET_COVERAGE_INSUFFICIENT",
  NO_DECISIVE_RESCUE: "NO_DECISIVE_RESCUE",
  NO_VALID_DIFFERENT_PLAYER: "NO_VALID_DIFFERENT_PLAYER",
};

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function computeBoardSafetyScore(pick = {}) {
  // Local score to avoid circular import with controlledBestSixSelector.
  const conf = num(pick.confidence ?? pick.decisionIntelligence?.finalConfidence, 50) || 50;
  const score = num(resolveBestPropScore(pick), 0) || 0;
  const edge = Math.abs(num(resolveProjectionEdgeForFinalSide(pick), 0) || 0);
  const risk = String(pick.trueRisk || pick.decisionIntelligence?.trueRisk || "MEDIUM").toUpperCase();
  const riskPenalty = risk === "HIGH" ? 12 : risk === "LOW" ? 0 : 4;
  return conf + score * 0.25 + edge * 3 - riskPenalty;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return null;
}

function playerKey(pick = {}) {
  return String(pick.player || "")
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

function sideStrength(pick = {}) {
  const edge = Math.abs(num(resolveProjectionEdgeForFinalSide(pick), 0) || 0);
  const score = num(resolveBestPropScore(pick), 0) || 0;
  const safety = num(computeBoardSafetyScore(pick), 0) || 0;
  const conf = num(pick.confidence ?? pick.decisionIntelligence?.finalConfidence, 0) || 0;
  return safety * 1000 + score * 10 + edge * 100 + conf;
}

function compareCandidates(a, b) {
  return sideStrength(b) - sideStrength(a);
}

function isFillOnlyNatural(pick = {}) {
  const natural = String(
    pick.naturalDecision ||
      pick.decisionIntelligence?.originalGateEligibility ||
      pick.wnbaTrackingDecision ||
      pick.trackingEligibility ||
      ""
  ).toUpperCase();
  const rescue = String(
    pick.sideRescue?.action || pick.sideRescueAction || ""
  ).toUpperCase();
  // BOARD_ONLY / WATCHLIST / NO_BET cannot be promoted merely to fill.
  if (natural === "NO_BET" || natural === "SHADOW_ONLY") return true;
  if (rescue === "NO_DECISIVE_RESCUE") return true;
  if (pick.excludedFromOfficialBestSix === true) return true;
  return false;
}

/**
 * Evaluate a candidate for board membership: date + integrity.
 * Never flips side.
 */
export function evaluateBoardCandidate(pick = {}, options = {}) {
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

  const dateResult = dated.slateDateVerification ||
    verifyCandidateSlateDate(dated, {
      requestedSlateDate,
      verifiedGame: options.verifiedGame,
      expectedDayBucket: options.expectedDayBucket,
      bundleDate: options.bundleDate || requestedSlateDate,
    });

  if (!dateResult.ok) {
    return {
      eligible: false,
      primaryReason: `REJECTED_BOARD — ${dateResult.dateVerificationReasons.join(" + ")}`,
      hardExclusions: dateResult.dateVerificationReasons,
      sideChanged: false,
      autoFlip: false,
      pick: {
        ...dated,
        controlledBoardEligible: false,
        controlledBoardReason: dateResult.dateVerificationReasons.join(" + "),
      },
      dateVerification: dateResult,
      integrity: null,
    };
  }

  if (isFillOnlyNatural(dated) && options.allowBoardOnlyFill !== true) {
    // Still allow TRACK; block NO_BET / NO_DECISIVE_RESCUE / BOARD_ONLY fill.
    const natural = String(
      dated.naturalDecision ||
        dated.decisionIntelligence?.originalGateEligibility ||
        dated.wnbaTrackingDecision ||
        dated.trackingEligibility ||
        ""
    ).toUpperCase();
    const rescue = String(
      dated.sideRescue?.action || dated.sideRescueAction || ""
    ).toUpperCase();
    const watchlist =
      String(dated.trackingType || dated.sourcePool || "").toUpperCase().includes(
        "WATCHLIST"
      ) || String(dated.userFacingDecision || "").toUpperCase() === "WATCHLIST";
    if (natural === "NO_BET" || rescue === "NO_DECISIVE_RESCUE") {
      return {
        eligible: false,
        primaryReason:
          rescue === "NO_DECISIVE_RESCUE"
            ? `REJECTED_BOARD — ${EMPTY_SLOT_REASONS.NO_DECISIVE_RESCUE}`
            : "REJECTED_BOARD — NATURAL_NO_BET",
        hardExclusions: [rescue || natural],
        sideChanged: false,
        autoFlip: false,
        pick: { ...dated, controlledBoardEligible: false },
        dateVerification: dateResult,
        integrity: null,
      };
    }
    if (natural === "BOARD_ONLY" || natural === "SHADOW_ONLY" || watchlist) {
      return {
        eligible: false,
        primaryReason: "REJECTED_BOARD — BOARD_ONLY_OR_WATCHLIST_NO_FILL",
        hardExclusions: ["BOARD_ONLY_OR_WATCHLIST_NO_FILL"],
        sideChanged: false,
        autoFlip: false,
        pick: { ...dated, controlledBoardEligible: false },
        dateVerification: dateResult,
        integrity: null,
      };
    }
  }

  // Same-team forced flips are not allowed on the new board.
  if (
    dated.sameTeamArbitrationFlip === true ||
    dated.sameTeamForcedUnder === true
  ) {
    return {
      eligible: false,
      primaryReason: "REJECTED_BOARD — FORCED_SIDE_NOT_ALLOWED",
      hardExclusions: ["FORCED_SIDE_NOT_ALLOWED"],
      sideChanged: false,
      autoFlip: false,
      pick: { ...dated, controlledBoardEligible: false },
      dateVerification: dateResult,
      integrity: null,
    };
  }

  const integrity = evaluateBestSixSelectionIntegrity(dated, options);
  if (!integrity.eligible) {
    return {
      eligible: false,
      primaryReason: integrity.primaryReason,
      hardExclusions: integrity.hardExclusions,
      sideChanged: false,
      autoFlip: false,
      pick: {
        ...integrity.pick,
        controlledBoardEligible: false,
        controlledBoardReason: integrity.primaryReason,
      },
      dateVerification: dateResult,
      integrity,
    };
  }

  const calibrated = applyConflictConfidenceRiskRecalibration(integrity.pick);
  return {
    eligible: true,
    primaryReason: "ELIGIBLE",
    hardExclusions: [],
    sideChanged: false,
    autoFlip: false,
    pick: {
      ...calibrated,
      controlledBoardEligible: true,
      organicSide: resolveFinalSide(calibrated),
      finalSide: resolveFinalSide(calibrated),
      sideChanged: false,
      forcedSide: false,
    },
    dateVerification: dateResult,
    integrity,
  };
}

function partitionTeamCandidates(teamPicks = []) {
  const overs = [];
  const unders = [];
  for (const pick of teamPicks) {
    const side = resolveFinalSide(pick);
    if (side === "OVER") overs.push(pick);
    else if (side === "UNDER") unders.push(pick);
  }
  overs.sort(compareCandidates);
  unders.sort(compareCandidates);
  return { overs, unders };
}

/**
 * Select best Over + best Under for one team (different players). Never flips.
 */
export function selectTeamSideSlots(teamPicks = [], options = {}) {
  const team = teamKey(teamPicks[0] || {}) || options.teamKey || "unknown";
  const evaluated = [];
  const rejectedOver = [];
  const rejectedUnder = [];
  const qualifiedOver = [];
  const qualifiedUnder = [];

  for (const raw of teamPicks) {
    const result = evaluateBoardCandidate(raw, options);
    evaluated.push(result);
    if (!result.eligible) {
      const side = resolveFinalSide(raw);
      if (side === "OVER") rejectedOver.push(result);
      else if (side === "UNDER") rejectedUnder.push(result);
      continue;
    }
    const side = resolveFinalSide(result.pick);
    if (side === "OVER") qualifiedOver.push(result.pick);
    else if (side === "UNDER") qualifiedUnder.push(result.pick);
  }

  qualifiedOver.sort(compareCandidates);
  qualifiedUnder.sort(compareCandidates);

  let selectedOver = null;
  let selectedUnder = null;
  let emptyOverReason = null;
  let emptyUnderReason = null;
  let sideChangeAttempted = false;

  if (!qualifiedOver.length) {
    emptyOverReason = rejectedOver.length
      ? EMPTY_SLOT_REASONS.INTEGRITY_GATE_REJECTED_ALL
      : EMPTY_SLOT_REASONS.NO_QUALIFIED_TEAM_OVER;
  }
  if (!qualifiedUnder.length) {
    emptyUnderReason = rejectedUnder.length
      ? EMPTY_SLOT_REASONS.INTEGRITY_GATE_REJECTED_ALL
      : EMPTY_SLOT_REASONS.NO_QUALIFIED_TEAM_UNDER;
  }

  // Same player leads both sides → keep stronger side only.
  if (qualifiedOver.length && qualifiedUnder.length) {
    const bestO = qualifiedOver[0];
    const bestU = qualifiedUnder[0];
    if (playerKey(bestO) && playerKey(bestO) === playerKey(bestU)) {
      sideChangeAttempted = false; // we do NOT change side
      const preferOver = sideStrength(bestO) >= sideStrength(bestU);
      if (preferOver) {
        selectedOver = bestO;
        selectedUnder =
          qualifiedUnder.find((p) => playerKey(p) !== playerKey(bestO)) || null;
        if (!selectedUnder) {
          emptyUnderReason =
            EMPTY_SLOT_REASONS.BEST_PLAYER_ALREADY_USED_FOR_OPPOSITE_SLOT;
        }
      } else {
        selectedUnder = bestU;
        selectedOver =
          qualifiedOver.find((p) => playerKey(p) !== playerKey(bestU)) || null;
        if (!selectedOver) {
          emptyOverReason =
            EMPTY_SLOT_REASONS.BEST_PLAYER_ALREADY_USED_FOR_OPPOSITE_SLOT;
        }
      }
    } else {
      selectedOver = bestO;
      selectedUnder =
        qualifiedUnder.find((p) => playerKey(p) !== playerKey(bestO)) || null;
      if (!selectedUnder) {
        emptyUnderReason = EMPTY_SLOT_REASONS.NO_VALID_DIFFERENT_PLAYER;
      }
    }
  } else if (qualifiedOver.length) {
    selectedOver = qualifiedOver[0];
  } else if (qualifiedUnder.length) {
    selectedUnder = qualifiedUnder[0];
  }

  // Drop remaining same-side teammates — do not flip them.
  const droppedOvers = qualifiedOver.filter(
    (p) => !selectedOver || playerKey(p) !== playerKey(selectedOver)
  );
  const droppedUnders = qualifiedUnder.filter(
    (p) => !selectedUnder || playerKey(p) !== playerKey(selectedUnder)
  );

  const stamp = (pick, slot, rank) => {
    if (!pick) return null;
    const nowIso = new Date().toISOString();
    return {
      ...pick,
      teamSlot: slot,
      teamSideRank: rank,
      controlledBestBoard: true,
      sourcePool: "CONTROLLED_BEST_BOARD",
      trackingAdmissionSource: "CONTROLLED_BEST_BOARD",
      forcedSide: false,
      sideChanged: false,
      sameTeamArbitrationFlip: false,
      selectionBuiltAt: nowIso,
      controlledBestBoardMeta: {
        version: CONTROLLED_BEST_BOARD_VERSION,
        build: CONTROLLED_BEST_BOARD_BUILD,
        team,
        slot,
        teamSideRank: rank,
      },
    };
  };

  const selected = [];
  if (selectedOver) selected.push(stamp(selectedOver, "TEAM_BEST_OVER", 1));
  if (selectedUnder) selected.push(stamp(selectedUnder, "TEAM_BEST_UNDER", 1));

  return {
    team,
    selected,
    selectedOver: selectedOver ? stamp(selectedOver, "TEAM_BEST_OVER", 1) : null,
    selectedUnder: selectedUnder
      ? stamp(selectedUnder, "TEAM_BEST_UNDER", 1)
      : null,
    qualifiedOverCandidates: qualifiedOver,
    qualifiedUnderCandidates: qualifiedUnder,
    rejectedOver,
    rejectedUnder,
    droppedOvers,
    droppedUnders,
    emptyOverReason,
    emptyUnderReason,
    sideChangeAttempted,
    forcedSide: false,
    debug: {
      team,
      qualifiedOverCount: qualifiedOver.length,
      qualifiedUnderCount: qualifiedUnder.length,
      selectedOverPlayer: selectedOver?.player || null,
      selectedUnderPlayer: selectedUnder?.player || null,
      emptyOverReason,
      emptyUnderReason,
      sideChangeAttempted: false,
      forcedSide: false,
      droppedOverPlayers: droppedOvers.map((p) => p.player),
      droppedUnderPlayers: droppedUnders.map((p) => p.player),
    },
  };
}

/**
 * Select Controlled Best Board for one slate date partition.
 */
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

  const expectedDayBucket = options.expectedDayBucket || null;
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
  const quarantine = [];

  for (const [gKey, gamePicks] of gamesMap.entries()) {
    const sample = gamePicks[0] || {};
    const verifiedGame = options.verifiedGamesByEventId?.[gKey] || {
      eventId: gKey,
      providerEventId: resolveEventId(sample),
      homeTeam: sample.homeTeam || sample.opponent,
      awayTeam: sample.awayTeam || sample.team,
      commenceTime: sample.commenceTime || sample.commenceTimeUtc,
      canonicalSlateDate: requestedSlateDate,
    };

    // Pre-quarantine date failures at game level
    const teamsMap = new Map();
    for (const pick of gamePicks) {
      const tKey = teamKey(pick) || "unknown";
      if (!teamsMap.has(tKey)) teamsMap.set(tKey, []);
      teamsMap.get(tKey).push(pick);
    }

    const teamAudits = [];
    for (const [tKey, teamPicks] of teamsMap.entries()) {
      const teamResult = selectTeamSideSlots(teamPicks, {
        ...options,
        requestedSlateDate,
        expectedDayBucket,
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
      }
      if (teamResult.selectedUnder) {
        board.push(teamResult.selectedUnder);
        qualifiedUnderSlots += 1;
      } else {
        emptySlots += 1;
      }

      for (const r of [...teamResult.rejectedOver, ...teamResult.rejectedUnder]) {
        if (
          (r.hardExclusions || []).some((x) =>
            /DATE_|EVENT_ID|STALE_|BUNDLE_|TODAY_TOMORROW|WRONG_EVENT|SCHEDULE_/.test(
              String(x)
            )
          )
        ) {
          quarantine.push({
            player: r.pick?.player,
            reason: r.primaryReason,
            hardExclusions: r.hardExclusions,
          });
        }
      }
    }

    gameAudits.push({
      gameKey: gKey,
      requestedSlateDate,
      canonicalSlateDate: requestedSlateDate,
      commenceTimeUtc: sample.commenceTime || sample.commenceTimeUtc || null,
      commenceTimeCt: sample.commenceTimeCt || null,
      providerEventId: resolveEventId(sample),
      teams: teamAudits,
      selectedCount: teamAudits.reduce(
        (n, t) =>
          n + (t.selectedOverPlayer ? 1 : 0) + (t.selectedUnderPlayer ? 1 : 0),
        0
      ),
    });
  }

  // Final seal-prep verification pass
  const verifiedBoard = [];
  for (const pick of board) {
    const check = verifyCandidateSlateDate(pick, {
      requestedSlateDate,
      expectedDayBucket,
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

  // Rank for Top 2 and optional Best 6 Overall (ranking view only)
  const ranked = [...verifiedBoard].sort(
    (a, b) => (computeBoardSafetyScore(b) || 0) - (computeBoardSafetyScore(a) || 0)
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

  // Stamp board ranks (all remain tracked)
  const stampedBoard = ranked.map((p, i) => ({
    ...p,
    controlledBestBoardRank: i + 1,
    controlledBestBoardSize: ranked.length,
    isTopPick: topPicks.some((t) => playerKey(t) === playerKey(p)),
    bestSixOverallRank:
      bestSixOverall.find((b) => playerKey(b) === playerKey(p))
        ?.bestSixOverallRank || null,
    // Compatibility fields for existing Results/Lab consumers
    controlledBestSixDisplay: true,
    controlledBestSixRank: i + 1,
    resultsAdmissionEligible: true,
  }));

  const teamsEvaluated = new Set(stampedBoard.map((p) => teamKey(p))).size;
  const gamesEvaluated = gameAudits.length;

  const audit = {
    version: CONTROLLED_BEST_BOARD_VERSION,
    build: CONTROLLED_BEST_BOARD_BUILD,
    dateVerificationVersion: SLATE_DATE_VERIFICATION_VERSION,
    dateVerificationBuild: SLATE_DATE_VERIFICATION_BUILD,
    requestedSlateDate,
    timezone: "America/Chicago",
    dateVerificationStatus: quarantine.length ? "PARTIAL" : "PASS",
    gamesEvaluated,
    teamsEvaluated,
    selectedCount: stampedBoard.length,
    qualifiedOverSlots,
    qualifiedUnderSlots,
    emptySlots,
    topPicksCount: Math.min(TOP_PICKS_LIMIT, stampedBoard.length),
    bestSixOverallCount: Math.min(BEST_SIX_OVERALL_LIMIT, stampedBoard.length),
    maxPropsPerTeam: MAX_PROPS_PER_TEAM,
    maxOversPerTeam: MAX_OVERS_PER_TEAM,
    maxUndersPerTeam: MAX_UNDERS_PER_TEAM,
    maxPropsPerGame: MAX_PROPS_PER_GAME,
    forcedSides: 0,
    sameTeamFlips: 0,
    gameAudits,
    quarantine,
    title: `CourtEdge Controlled Best Board — ${requestedSlateDate} CT`,
  };

  return {
    board: stampedBoard,
    // Backward-compatible alias used by combined selector / Home
    bestSix: stampedBoard,
    topPicks,
    bestSixOverall,
    audit,
    controlledBestBoardAudit: audit,
    controlledBestSixDisplayAudit: {
      ...audit,
      displayMode: true,
      boardMode: "CONTROLLED_BEST_BOARD_V1",
      selectedBestSixCount: stampedBoard.length,
      resultsAdmissionCount: stampedBoard.length,
    },
  };
}

function resolveEventId(pick = {}) {
  return String(
    pick.providerEventId ||
      pick.oddsEventId ||
      pick.eventId ||
      pick.gameId ||
      pick.game?.id ||
      ""
  );
}

/**
 * Build Today / Tomorrow boards from candidates using CT canonical dates.
 */
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

  return {
    board: merged,
    bestSix: merged,
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
    },
  };
}
