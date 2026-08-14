/**
 * Product Truth UI Cutover V1 — server helpers for Home/Results/Lab/History.
 * Legacy membership fields are forensic mirrors only.
 */
import {
  getProductTruthBoard,
  formatCopyReportFromCanonical,
  SINGLE_PRODUCT_TRUTH_BUILD,
} from "./courtEdgeSingleProductTruthApiV1.js";
import { loadCanonicalPredictionStore } from "./courtEdgeCanonicalPredictionRecordV1.js";
import { getTodayLocalDate, getYesterdayLocalDate, getTomorrowLocalDate } from "./slateScopeService.js";
import {
  scoreCandidateV2,
  DECISION_ENGINE_V2_BUILD,
} from "./courtEdgeDecisionEngineV2.js";
import {
  buildHomeProductTruthSectionsV3,
  HOME_PRODUCT_TRUTH_SECTIONS_BUILD,
  BEST_AVAILABLE_DISPLAY_MAX_DEFAULT,
} from "./courtEdgeHomeProductTruthSectionsV3.js";

export const PRODUCT_TRUTH_UI_CUTOVER_BUILD =
  "courteedge-product-truth-ui-cutover-v3";

/** Map canonical card → PropCard / Home display pick shape. */
export function cardToDisplayPick(card = {}, options = {}) {
  if (!card?.canonicalPropId && !card?.player) return null;
  const grade = String(card.grade || card.result?.grade || "PENDING").toUpperCase();
  const status = grade === "PENDING" || grade === "UNRESOLVED"
    ? String(grade).toLowerCase()
    : String(grade).toLowerCase();
  const slateDate = card.slateDateCt || options.slateDateCt || null;
  let v2 = null;
  // Prospective integrity: frozen Product Truth scores are immutable on display.
  // Prefer stored decisionScoreV2 / modelWinProbability / officialRankScore.
  // Rescore only when no frozen score exists (legacy incomplete rows).
  const storedScore =
    card.decisionScoreV2 ??
    card.modelWinProbability ??
    card.officialRankScore ??
    null;
  if (storedScore == null && card.projection != null) {
    try {
      v2 = scoreCandidateV2({
        propType: card.propType,
        selectedSide: card.side,
        side: card.side,
        line: card.line,
        projection: card.projection,
        rawWinProbability: card.predictedProbability,
        risk: card.risk,
        marketHistoryIntegrity: card.marketHistoryIntegrity,
        openingLineUsable: card.openingLineUsable,
        expectedMinutes: card.expectedMinutes,
      });
    } catch {
      v2 = null;
    }
  }
  const modelWinProbability =
    storedScore != null
      ? Number(storedScore)
      : v2?.modelWinProbability ?? null;
  const displayConfidence =
    modelWinProbability == null
      ? card.confidence
      : Math.round(Number(modelWinProbability) * 100);
  return {
    canonicalPropId: card.canonicalPropId,
    player: card.player || card.playerName,
    playerName: card.player || card.playerName,
    playerId: card.playerId || null,
    team: card.team,
    opponent: card.opponent,
    league: card.league || "WNBA",
    gameId: card.gameId,
    propType: card.propType,
    canonicalPropType: card.propType,
    stat: card.stat || card.propType,
    side: card.side,
    pick: card.side,
    line: card.line,
    sealedLine: card.sealedLine ?? card.line,
    projection: card.projection,
    correctedProjection: v2?.correctedProjection ?? null,
    fairLine: card.fairLine,
    confidence: displayConfidence,
    displayConfidence,
    predictedProbability: card.predictedProbability,
    modelWinProbability,
    decisionScoreV2:
      card.decisionScoreV2 ?? v2?.decisionScoreV2 ?? modelWinProbability,
    normalizedProjectionStrength: v2?.normalizedProjectionStrength ?? null,
    decisionAuthority: DECISION_ENGINE_V2_BUILD,
    safetyScore: card.safetyScore,
    SafetyScore: card.safetyScore,
    risk: card.risk,
    trueRisk: card.risk,
    c2Risk: card.risk,
    officialRankScore:
      card.officialRankScore ?? modelWinProbability,
    frozenScorePreserved: storedScore != null,
    membership: card.membership,
    officialSelected: card.membership === "OFFICIAL",
    immutableOfficial: card.membership === "OFFICIAL",
    trackingType: card.membership,
    finalDecision: card.membership,
    decision: card.membership,
    trackingEligibility: card.membership === "OFFICIAL" ? "OFFICIAL" : "RESEARCH",
    slateDate,
    gameDate: slateDate,
    resultsSlateDate: slateDate,
    cohortSlateDate: slateDate,
    dayBucket: options.dayBucket || null,
    dateLabel: options.dateLabel || null,
    status,
    grade,
    actual: card.actual ?? card.result?.actual ?? null,
    gameFinal: Boolean(card.gameFinal ?? card.result?.gameFinal),
    result: card.result || {
      status: grade,
      grade,
      actual: card.actual ?? null,
      gameFinal: Boolean(card.gameFinal),
    },
    engineSignals: card.engineSignals || null,
    marketHistoryIntegrity: card.marketHistoryIntegrity || null,
    openingLineUsable: card.openingLineUsable,
    productTruthAuthority: true,
    productTruthBuild: PRODUCT_TRUTH_UI_CUTOVER_BUILD,
    forensicLegacyAuthority: false,
    marketRank: card.marketRank ?? null,
    homeWeaveRank: card.homeWeaveRank ?? null,
    game:
      card.game ||
      (card.team && card.opponent ? `${card.team} vs ${card.opponent}` : null),
  };
}

export function listProductTruthSlateDates() {
  const store = loadCanonicalPredictionStore();
  const dates = [
    ...new Set(
      (store.records || [])
        .map((r) => String(r.slateDateCt || "").slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
    ),
  ].sort();
  return dates;
}

export function getHomeProductTruthBoard(options = {}) {
  const today = String(options.todayLocalDate || getTodayLocalDate());
  const yesterday = getYesterdayLocalDate(today);
  const tomorrow = getTomorrowLocalDate(today);

  const todayBoard = getProductTruthBoard({ slateDateCt: today });
  const tomorrowBoard = getProductTruthBoard({ slateDateCt: tomorrow });
  const yesterdayBoard = getProductTruthBoard({ slateDateCt: yesterday });

  const byV2 = (a, b) =>
    Number(b.decisionScoreV2 || b.modelWinProbability || 0) -
    Number(a.decisionScoreV2 || a.modelWinProbability || 0);

  const todayOfficial = (todayBoard.official || [])
    .map((c) =>
      cardToDisplayPick(c, { slateDateCt: today, dayBucket: "TODAY", dateLabel: "Today" })
    )
    .filter(Boolean);
  const todayResearch = (todayBoard.research || [])
    .map((c) =>
      cardToDisplayPick(c, {
        slateDateCt: today,
        dayBucket: "TODAY",
        dateLabel: "Today",
      })
    )
    .filter(Boolean);
  const todayFullPool = [...todayOfficial, ...todayResearch];
  const todaySections = buildHomeProductTruthSectionsV3({
    trusted: todayOfficial,
    full: todayFullPool,
    bestAvailableDisplayMax: BEST_AVAILABLE_DISPLAY_MAX_DEFAULT,
  });

  const tomorrowOfficial = (tomorrowBoard.official || [])
    .map((c) =>
      cardToDisplayPick(c, {
        slateDateCt: tomorrow,
        dayBucket: "TOMORROW",
        dateLabel: "Tomorrow",
      })
    )
    .filter(Boolean);
  const tomorrowResearch = (tomorrowBoard.research || [])
    .map((c) =>
      cardToDisplayPick(c, {
        slateDateCt: tomorrow,
        dayBucket: "TOMORROW",
        dateLabel: "Tomorrow",
      })
    )
    .filter(Boolean);
  const tomorrowFullPool = [...tomorrowOfficial, ...tomorrowResearch];
  const tomorrowSections = buildHomeProductTruthSectionsV3({
    trusted: tomorrowOfficial,
    full: tomorrowFullPool,
    bestAvailableDisplayMax: BEST_AVAILABLE_DISPLAY_MAX_DEFAULT,
  });

  const priorDayOfficial = (yesterdayBoard.official || [])
    .map((c) =>
      cardToDisplayPick(c, {
        slateDateCt: yesterday,
        dayBucket: "PRIOR_OFFICIAL",
        dateLabel: yesterday,
      })
    )
    .filter(Boolean)
    .sort(byV2);

  const hasTodayTrusted = todayOfficial.length > 0;
  const hasTodayFull = todayFullPool.length > 0;
  // Trusted/Official = true Official only. If today has a slate with 0 Trusted, show 0
  // (do not weave-fill or disguise Best Available as Official).
  const homeTrustedDisplay = hasTodayFull || hasTodayTrusted
    ? todayOfficial
    : priorDayOfficial;
  const homeTrustedIsPriorFallback =
    !hasTodayFull && !hasTodayTrusted && priorDayOfficial.length > 0;

  console.log(
    JSON.stringify({
      homeProductTruthSections: HOME_PRODUCT_TRUTH_SECTIONS_BUILD,
      slateDateCt: today,
      trusted: todaySections.trustedCount,
      bestAvailable: todaySections.bestAvailableCount,
      full: todaySections.fullCount,
      byMarketFull: todaySections.fullByMarket,
      marketBalancedWeave: false,
    })
  );

  return {
    ok: true,
    build: PRODUCT_TRUTH_UI_CUTOVER_BUILD,
    singleProductTruthBuild: SINGLE_PRODUCT_TRUTH_BUILD,
    todayLocalDate: today,
    tomorrowLocalDate: tomorrow,
    yesterdayLocalDate: yesterday,
    todayOfficial,
    todayResearch,
    todayBestAvailable: todaySections.bestAvailable,
    todayFullPredictions: todaySections.fullPredictions,
    tomorrowOfficial,
    tomorrowBestAvailable: tomorrowSections.bestAvailable,
    tomorrowFullPredictions: tomorrowSections.fullPredictions,
    priorDayOfficial,
    todayOfficialSummary: todayBoard.officialSummary,
    priorDayOfficialSummary: yesterdayBoard.officialSummary,
    // Backward-compat field: TRUE Trusted/Official only (never research weave).
    homeTodayDisplayOfficial: homeTrustedDisplay,
    homeTodayTrusted: homeTrustedDisplay,
    homeTodayBestAvailable: todaySections.bestAvailable,
    homeTodayFullPredictions: todaySections.fullPredictions,
    homeTodayDisplaySlateDate: hasTodayTrusted || hasTodayFull
      ? today
      : priorDayOfficial.length
        ? yesterday
        : today,
    homeTodayIsPriorDayFallback: homeTrustedIsPriorFallback,
    homeTodayIsFullSlate: hasTodayFull,
    homeBoardMax: null,
    homeForcedFill: false,
    homeByMarketSelected: todaySections.trustedByMarket,
    homeMarketOrder: [],
    homeCandidateCounts: todaySections.fullByMarket,
    homeWeaveBuild: null,
    homeSectionsBuild: HOME_PRODUCT_TRUTH_SECTIONS_BUILD,
    homeIdentityProblems: [],
    availableSlateDates: listProductTruthSlateDates(),
    authority: "PRODUCT_TRUTH_ONLY",
    legacyMembershipAuthority: false,
    homeRankAuthority: "global_quality_v3",
    marketBalancedWeave: false,
  };
}

export function getResultsProductTruthBoard(options = {}) {
  const today = String(options.todayLocalDate || getTodayLocalDate());
  const available = listProductTruthSlateDates();
  let slateDateCt = String(options.slateDateCt || options.slateDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slateDateCt)) {
    // Prefer today, else newest available — never an old pointer outside store.
    slateDateCt = available.includes(today)
      ? today
      : available.length
        ? available[available.length - 1]
        : today;
  }

  const board = getProductTruthBoard({ slateDateCt });
  const official = (board.official || []).map((c) =>
    cardToDisplayPick(c, { slateDateCt })
  );
  const research = (board.research || []).map((c) =>
    cardToDisplayPick(c, { slateDateCt })
  );

  return {
    ok: true,
    build: PRODUCT_TRUTH_UI_CUTOVER_BUILD,
    slateDateCt,
    todayLocalDate: today,
    availableSlateDates: available,
    official,
    research,
    officialSummary: board.officialSummary,
    researchSummary: board.researchSummary,
    props: [...official, ...research],
    copyOfficial: formatCopyReportFromCanonical(board.official, {
      title: "Official",
      slateDateCt,
    }),
    copyResearch: formatCopyReportFromCanonical(board.research, {
      title: "Research",
      slateDateCt,
    }),
    authority: "PRODUCT_TRUTH_ONLY",
    // Explicitly ignore legacy activeResultsSlateDate for display membership.
    legacyActiveSlatePointerIgnored: true,
  };
}

/**
 * Stamp /picks payload so legacy membership cannot act as product authority.
 */
export function downgradeLegacyMembershipToForensic(picksPayload = {}, homeTruth = null) {
  const home = homeTruth || getHomeProductTruthBoard();
  const forensic = {
    forensicOnly: true,
    productAuthority: false,
    note: "Legacy membership mirror — not Home/Results product truth",
    build: PRODUCT_TRUTH_UI_CUTOVER_BUILD,
  };

  return {
    ...picksPayload,
    productTruthAuthority: true,
    productTruthUiCutoverBuild: PRODUCT_TRUTH_UI_CUTOVER_BUILD,
    productTruthHome: home,
    // Product-authority display arrays (CT calendar).
    bestSixDisplayTodayWNBA: (home.homeTodayDisplayOfficial || []).filter(
      (p) => String(p.league || "WNBA").toUpperCase() === "WNBA"
    ),
    bestSixDisplayTomorrowWNBA: (home.tomorrowOfficial || []).filter(
      (p) => String(p.league || "WNBA").toUpperCase() === "WNBA"
    ),
    bestSixDisplayTodayNBA: (home.homeTodayDisplayOfficial || []).filter(
      (p) => String(p.league || "").toUpperCase() === "NBA"
    ),
    bestSixDisplayTomorrowNBA: (home.tomorrowOfficial || []).filter(
      (p) => String(p.league || "").toUpperCase() === "NBA"
    ),
    // Downgrade legacy controllers to forensic mirrors (do not delete).
    selectedPropsTodayWNBA: {
      ...forensic,
      props: Array.isArray(picksPayload.selectedPropsTodayWNBA)
        ? picksPayload.selectedPropsTodayWNBA
        : [],
    },
    controlledBestBoard: {
      ...forensic,
      props: Array.isArray(picksPayload.controlledBestBoard)
        ? picksPayload.controlledBestBoard
        : [],
    },
    officialMembership: {
      ...forensic,
      props: Array.isArray(picksPayload.officialMembership)
        ? picksPayload.officialMembership
        : [],
    },
    membershipSource: "product-truth-v1",
    boardVersion: "product-truth-v1",
  };
}
