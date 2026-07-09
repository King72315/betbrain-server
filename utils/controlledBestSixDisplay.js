/**
 * CourtEdge Controlled Best 6 display helpers — NBA + WNBA (shared UI + node tests).
 */

export const BEST_SIX_LIMIT = 6;
export const WNBA_TOP_PICK_LIMIT = 2;
export const NBA_TOP_PICK_LIMIT = 2;
export const SUPPORTED_LEAGUES = ["NBA", "WNBA"];
export const DISPLAY_SIDE_BALANCE_MINORITY = 3;
export const DISPLAY_SIDE_BALANCE_SWAP_MARGIN = 24;

export const DATE_VIEWS = ["today", "tomorrow", "full_board"];
/** Home tab prefers tomorrow slate; see resolveHomeControlledDateView for midnight fallback. */
export const HOME_DATE_VIEW = "tomorrow";

function hasUnstartedGamesInBucket(games = [], bucket = "TODAY") {
  return (games || []).some(
    (game) => resolveDayBucket(game) === bucket && !game.isStarted
  );
}

function bucketHasDisplayOrCandidates({
  displayPool = [],
  games = [],
  league = "WNBA",
  dateView = "tomorrow",
} = {}) {
  const inBucket = filterBestSixByDateView(displayPool, dateView);
  const candidates = scopeCandidatesByDateView(
    collectLeagueCandidatesFromGames(games, league),
    dateView
  );
  return inBucket.length > 0 || candidates.length > 0;
}

/**
 * Home targets the next actionable slate. After CT midnight, tonight's games flip to
 * TODAY while tomorrow's lines may not exist yet — fall back so Best 6 isn't empty.
 */
export function resolveHomeControlledDateView({
  bestSix = [],
  bestSixDisplay = [],
  games = [],
  league = "WNBA",
} = {}) {
  const leagueCode = normalizeLeagueCode(league);
  const displayPool = resolveBestSixDisplayPool(bestSixDisplay, bestSix);

  if (
    bucketHasDisplayOrCandidates({
      displayPool,
      games,
      league: leagueCode,
      dateView: "tomorrow",
    })
  ) {
    return "tomorrow";
  }

  if (
    bucketHasDisplayOrCandidates({
      displayPool,
      games,
      league: leagueCode,
      dateView: "today",
    }) &&
    hasUnstartedGamesInBucket(games, "TODAY")
  ) {
    return "today";
  }

  return HOME_DATE_VIEW;
}

export function resolveTrackEligibility(pick = {}) {
  return String(
    pick.decisionIntelligence?.trackEligibility ||
      pick.trackingEligibility ||
      pick.wnbaTrackingDecision ||
      ""
  ).toUpperCase();
}

export function countCandidatesByEligibility(candidates = []) {
  const counts = {
    track: 0,
    boardOnly: 0,
    shadowOnly: 0,
    highRisk: 0,
    noBet: 0,
    other: 0,
  };

  for (const pick of candidates) {
    const eligibility = resolveTrackEligibility(pick);
    if (eligibility === "TRACK") counts.track += 1;
    else if (eligibility === "NO_BET") counts.noBet += 1;
    else if (eligibility === "BOARD_ONLY") {
      counts.boardOnly += 1;
      counts.highRisk += 1;
    } else if (eligibility === "SHADOW_ONLY") {
      counts.shadowOnly += 1;
      counts.highRisk += 1;
    } else counts.other += 1;
  }

  return counts;
}

function normalizePickSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

export function stablePickKey(pick = {}) {
  return [
    String(pick.player || "").toLowerCase(),
    String(pick.team || "").toLowerCase(),
    String(pick.line ?? ""),
    String(pick.side || pick.pick || "").toLowerCase(),
  ].join("|");
}

export function displayPickRankScore(pick = {}) {
  return Number(
    pick.topPickSafetyScore ??
      pick.pickScore ??
      pick.bestPropScore ??
      pick.confidence ??
      pick.winProbability ??
      0
  );
}

export function applyDisplaySideBalance(selected = [], candidatePool = [], options = {}) {
  const limit = Number(options.limit ?? BEST_SIX_LIMIT);
  const minMinority = Number(options.minMinority ?? DISPLAY_SIDE_BALANCE_MINORITY);
  const margin = Number(options.swapMargin ?? DISPLAY_SIDE_BALANCE_SWAP_MARGIN);
  if (!Array.isArray(selected) || selected.length < 3) return selected;

  const sortedPool = [...(candidatePool || [])].sort(
    (a, b) => displayPickRankScore(b) - displayPickRankScore(a)
  );
  let result = [...selected];
  const swaps = [];

  for (let attempt = 0; attempt < limit; attempt += 1) {
    const sideCounts = { OVER: 0, UNDER: 0 };
    for (const pick of result) {
      const side = normalizePickSide(pick.side || pick.pick);
      if (side) sideCounts[side] += 1;
    }

    const dominantSide =
      sideCounts.OVER >= limit - minMinority
        ? "OVER"
        : sideCounts.UNDER >= limit - minMinority
          ? "UNDER"
          : null;
    if (!dominantSide) break;

    const minoritySide = dominantSide === "OVER" ? "UNDER" : "OVER";
    if (sideCounts[minoritySide] >= minMinority) break;

    const selectedKeys = new Set(result.map((pick) => stablePickKey(pick)));
    let weakestIdx = 0;
    let weakestScore = displayPickRankScore(result[0]);
    for (let i = 1; i < result.length; i += 1) {
      const score = displayPickRankScore(result[i]);
      if (normalizePickSide(result[i].side || result[i].pick) === dominantSide && score <= weakestScore) {
        weakestScore = score;
        weakestIdx = i;
      }
    }

    const alternative = sortedPool.find((pick) => {
      if (selectedKeys.has(stablePickKey(pick))) return false;
      if (normalizePickSide(pick.side || pick.pick) !== minoritySide) return false;
      return displayPickRankScore(pick) >= weakestScore - margin;
    });
    if (!alternative) break;

    swaps.push({
      replaced: result[weakestIdx]?.player,
      with: alternative.player,
      dominantSide,
      minoritySide,
    });
    result[weakestIdx] = alternative;
  }

  return swaps.length ? result : selected;
}

export function resolveBestSixDisplayPool(
  bestSixDisplayWNBA = [],
  bestSixWNBA = []
) {
  return bestSixDisplayWNBA?.length ? bestSixDisplayWNBA : bestSixWNBA;
}

export function resolveTrueRisk(pick = {}) {
  return String(pick.decisionIntelligence?.trueRisk || pick.trueRisk || "—").toUpperCase();
}

export function resolveDayBucket(item = {}) {
  const bucket = String(item.dayBucket || "").toUpperCase();
  if (bucket === "TODAY" || bucket === "TOMORROW" || bucket === "LATER") {
    return bucket;
  }
  const label = String(item.dateLabel || "").toLowerCase();
  if (label === "today") return "TODAY";
  if (label === "tomorrow") return "TOMORROW";
  return "LATER";
}

export function normalizeLeagueCode(league = "WNBA") {
  const value = String(league || "WNBA").toUpperCase();
  return value === "NBA" ? "NBA" : "WNBA";
}

export function getTopPickLimitForLeague(league = "WNBA") {
  return normalizeLeagueCode(league) === "NBA" ? NBA_TOP_PICK_LIMIT : WNBA_TOP_PICK_LIMIT;
}

function getPickTeamKey(pick = {}) {
  const team = pick.teamKey || pick.team || pick.teamName || "";
  return String(team).trim().toLowerCase();
}

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function trueRiskRank(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const raw = String(di.trueRisk || pick.trueRisk || "MEDIUM").toUpperCase();
  if (raw === "LOW") return 3;
  if (raw === "HIGH") return 1;
  return 2;
}

function gateQualityRank(pick = {}) {
  const eligibility = resolveTrackEligibility(pick);
  if (eligibility === "TRACK") return 4;
  if (eligibility === "BOARD_ONLY") return 3;
  if (eligibility === "SHADOW_ONLY") return 2;
  if (eligibility === "NO_BET") return 1;
  return 2;
}

/** Keep in sync with controlledBestSixSelector.computeSafetyScore */
export function computeSafetyScore(pick = {}) {
  const di = pick.decisionIntelligence || {};
  const score = num(pick.bestPropScore ?? pick.pickScore ?? pick.controlledBestSixScore, 0);
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
  return (
    score +
    confidence * 0.4 +
    riskBonus +
    gateBonus +
    repairBonus +
    stabilityBonus -
    dangerPenalty -
    debtPenalty -
    killPenalty -
    promotedPenalty
  );
}

function compareBySafetyScore(a = {}, b = {}) {
  return (
    computeSafetyScore(b) - computeSafetyScore(a) ||
    num(b.confidence ?? b.winProbability) - num(a.confidence ?? a.winProbability) ||
    num(b.bestPropScore ?? b.pickScore) - num(a.bestPropScore ?? a.pickScore)
  );
}

/** Top 2 safest from display Best 6 — team diversity on slot 2+. */
export function selectTopTwoFromDisplayBestSix(
  displayBestSix = [],
  league = "WNBA",
  limit = null
) {
  const leagueCode = normalizeLeagueCode(league);
  const resolvedLimit = Math.min(
    Number(limit) || getTopPickLimitForLeague(leagueCode),
    getTopPickLimitForLeague(leagueCode)
  );
  const sorted = [...displayBestSix].sort(compareBySafetyScore);
  const selected = [];
  const selectedTeamKeys = new Set();

  for (const pick of sorted) {
    if (selected.length >= resolvedLimit) break;

    const teamKey = getPickTeamKey(pick);
    if (teamKey && selectedTeamKeys.has(teamKey)) continue;

    selected.push(pick);
    if (teamKey) selectedTeamKeys.add(teamKey);
  }

  return selected.map((pick, index) => {
    const rank = index + 1;
    return {
      ...pick,
      topPickRank: rank,
      topPickSafetyScore: computeSafetyScore(pick),
      topPickLabel: `Top ${leagueCode} #${rank}`,
      selectedBySafetyScore: true,
    };
  });
}

export function buildTopPickBadgeMap(topProps = [], league = "WNBA") {
  const leagueCode = normalizeLeagueCode(league);
  const map = new Map();
  for (const pick of topProps) {
    const key = stablePickKey(pick);
    const rank = pick.topPickRank || pick.leagueRank || pick.topPropRank;
    if (!key || !rank) continue;
    map.set(key, {
      topPickRank: rank,
      topPickLabel: pick.topPickLabel || `Top ${leagueCode} #${rank}`,
    });
  }
  return map;
}

export function enrichBestSixForDisplay(
  pick = {},
  topPickBadgeMap = new Map(),
  index = 0,
  league = "WNBA"
) {
  const leagueCode = normalizeLeagueCode(pick.league || league);
  const key = stablePickKey(pick);
  const topMeta = topPickBadgeMap.get(key);
  const serverRank = pick.bestSixRank || pick.controlledBestSixRank || index + 1;
  const rank = index + 1;
  const di = pick.decisionIntelligence || {};
  const qualityNote =
    pick.displayResultsReason ||
    pick.resultsAdmissionReason ||
    di.simpleExplanation ||
    pick.wnbaTrackingReason ||
    "";

  return {
    ...pick,
    bestSixRank: rank,
    controlledBestSixRank: rank,
    serverBestSixRank: serverRank,
    bestSixLabel: `Best ${leagueCode} #${rank}`,
    topPickRank: topMeta?.topPickRank ?? pick.topPickRank ?? null,
    topPickLabel: topMeta?.topPickLabel ?? pick.topPickLabel ?? null,
    league: leagueCode,
    displayTrackEligibility: "TRACK",
    displayTrueRisk: resolveTrueRisk(pick),
    displayWhy: qualityNote,
    displayResultsReason: qualityNote,
    resultsAdmissionEligible:
      pick.resultsAdmissionEligible ??
      isResultsPoolTrackProp(pick),
    resultsDecisionLabel: "TRACK",
    displayRiskDebts: (di.riskDebts || []).map(formatRiskDebt),
    displayRiskRepairs: (di.riskRepairs || []).map(formatRiskRepair),
    displaySideRescueAction:
      pick.sideRescueAction ?? pick.sideRescue?.action ?? null,
    displaySideRescueExplanation:
      pick.sideRescueExplanation ?? pick.sideRescue?.simpleExplanation ?? null,
    displayInitialSide: pick.initialSide ?? pick.sideRescue?.originalSide ?? null,
    displayFlippedFromSide: pick.flippedFromSide ?? null,
    displaySideRescueFlipped: Boolean(
      pick.sideRescueFlipped || pick.flippedFromSide || pick.sideRescue?.action === "FLIP_SIDE"
    ),
    displayFlipFirstLabels:
      pick.flipFirstLabels ??
      pick.decisionDataIntelligence?.flipFirstLabels ??
      null,
    displayFlipFirstAction:
      pick.flipFirstAction ?? pick.decisionDataIntelligence?.flipFirstDecision?.action ?? null,
  };
}

export function formatRiskDebt(debt = {}) {
  if (typeof debt === "string") return debt;
  const label = debt.label || debt.code || debt.type || "Risk";
  const detail = debt.detail || debt.reason || debt.note || "";
  return detail ? `${label}: ${detail}` : String(label);
}

export function formatRiskRepair(repair = {}) {
  if (typeof repair === "string") return repair;
  const label = repair.label || repair.code || repair.type || "Repair";
  const detail = repair.detail || repair.reason || repair.note || "";
  return detail ? `${label}: ${detail}` : String(label);
}

export function filterBestSixByDateView(bestSix = [], dateView = "today") {
  if (dateView === "full_board") return bestSix;
  const target = dateView === "tomorrow" ? "TOMORROW" : "TODAY";
  return bestSix.filter((pick) => resolveDayBucket(pick) === target);
}

function scoreCandidateForDisplay(pick = {}) {
  return Number(
    pick.confidence ??
      pick.winProbability ??
      pick.controlledBestSixScore ??
      pick.score ??
      0
  );
}

function compareCandidatesForDisplay(a = {}, b = {}) {
  const rankA = Number(
    a.bestSixDisplayRank ?? a.controlledBestSixRank ?? a.bestSixRank ?? 999
  );
  const rankB = Number(
    b.bestSixDisplayRank ?? b.controlledBestSixRank ?? b.bestSixRank ?? 999
  );
  if (rankA !== rankB) return rankA - rankB;
  return scoreCandidateForDisplay(b) - scoreCandidateForDisplay(a);
}

/** True when prop is in the Results tracked cohort (all Controlled Best 6 display members). */
export function isResultsPoolTrackProp(pick = {}) {
  if (pick.resultsAdmissionEligible === true) return true;
  if (pick.controlledBestSixDisplayTracked === true) return true;
  if (pick.controlledBestSixDisplay === true) return true;
  if (pick.resultsAdmissionEligible === false) return false;
  const di = pick.decisionIntelligence || {};
  return resolveTrackEligibility(pick) === "TRACK" || di.bestSixEligibility === true;
}

/**
 * Date-scoped Best 6 display: keep in-bucket slate picks, then fill to limit from
 * analyzed board candidates for that day (fixes 4/6 when slate Best 6 spans Today+Tomorrow).
 */
export function resolveDateScopedDisplayPool(
  displayPool = [],
  games = [],
  league = "WNBA",
  dateView = "today",
  bestSixLimit = BEST_SIX_LIMIT
) {
  if (dateView === "full_board") {
    return applyDisplaySideBalance(
      displayPool.slice(0, bestSixLimit),
      collectLeagueCandidatesFromGames(games, league),
      { limit: bestSixLimit }
    );
  }

  const inBucket = filterBestSixByDateView(displayPool, dateView);
  const candidates = scopeCandidatesByDateView(
    collectLeagueCandidatesFromGames(games, league),
    dateView
  );

  if (!games?.length) {
    return applyDisplaySideBalance(inBucket.slice(0, bestSixLimit), candidates, {
      limit: bestSixLimit,
    });
  }

  const displayByKey = new Map(displayPool.map((pick) => [stablePickKey(pick), pick]));
  const merged = [...inBucket];
  const usedKeys = new Set(merged.map((pick) => stablePickKey(pick)));

  if (merged.length < bestSixLimit) {
    const rankedCandidates = candidates
      .map((pick) => displayByKey.get(stablePickKey(pick)) || pick)
      .sort(compareCandidatesForDisplay);

    for (const pick of rankedCandidates) {
      if (merged.length >= bestSixLimit) break;
      const key = stablePickKey(pick);
      if (usedKeys.has(key)) continue;
      merged.push(pick);
      usedKeys.add(key);
    }
  }

  const rankedCandidates = candidates
    .map((pick) => displayByKey.get(stablePickKey(pick)) || pick)
    .sort(compareCandidatesForDisplay);

  return applyDisplaySideBalance(merged.slice(0, bestSixLimit), rankedCandidates, {
    limit: bestSixLimit,
  });
}

/**
 * Controlled Best 6 is slate-level (not date-tab scoped). Renders full server pool
 * with contiguous display ranks so UI/report never show Best #2/#4 gaps.
 */
export function prepareBestSixDisplayCards(
  displayPool = [],
  topPickBadgeMap = new Map(),
  league = "WNBA"
) {
  return displayPool.map((pick, index) =>
    enrichBestSixForDisplay(pick, topPickBadgeMap, index, league)
  );
}

export function assertContiguousBestSixRanks(cards = []) {
  for (let index = 0; index < cards.length; index += 1) {
    const expected = index + 1;
    const rank = cards[index].bestSixRank || cards[index].controlledBestSixRank;
    if (rank !== expected) {
      return {
        ok: false,
        index,
        expected,
        actual: rank,
      };
    }
  }
  return { ok: true, count: cards.length };
}

export function collectLeagueCandidatesFromGames(games = [], league = "WNBA") {
  const leagueCode = normalizeLeagueCode(league);
  const candidates = [];
  for (const game of games) {
    const pool = game.allGeneratedCandidates?.length
      ? game.allGeneratedCandidates
      : game.picks || [];
    for (const pick of pool) {
      candidates.push({
        ...pick,
        league: pick.league || game.league || leagueCode,
        game: pick.game || game.game,
        gameId: pick.gameId || game.gameId,
        dateLabel: pick.dateLabel || game.dateLabel,
        dayBucket: pick.dayBucket || game.dayBucket,
      });
    }
  }
  return candidates;
}

/** @deprecated use collectLeagueCandidatesFromGames */
export function collectWnbaCandidatesFromGames(games = []) {
  return collectLeagueCandidatesFromGames(games, "WNBA");
}

export function resolveLeaguePicksPayload(data = {}, league = "WNBA") {
  const leagueCode = normalizeLeagueCode(league);
  const isWNBA = leagueCode === "WNBA";
  const games = isWNBA
    ? data.wnbaGames?.length
      ? data.wnbaGames
      : (data.games || []).filter((game) => String(game.league || "").toUpperCase() === "WNBA")
    : data.nbaGames?.length
      ? data.nbaGames
      : (data.games || []).filter((game) => String(game.league || "").toUpperCase() === "NBA");

  return {
    league: leagueCode,
    games,
    bestSix: isWNBA ? data.bestSixWNBA || [] : data.bestSixNBA || [],
    bestSixDisplay: isWNBA
      ? data.bestSixDisplayWNBA || []
      : data.bestSixDisplayNBA || [],
    topProps: isWNBA ? data.topWNBAProps || [] : data.topNBAProps || [],
  };
}

export function buildLeagueBestSixBoard({
  league = "WNBA",
  bestSix = [],
  bestSixDisplay = [],
  topProps = [],
  games = [],
  dateView = "today",
  bestSixLimit = BEST_SIX_LIMIT,
} = {}) {
  const leagueCode = normalizeLeagueCode(league);
  const displayPool = resolveBestSixDisplayPool(bestSixDisplay, bestSix);
  const scopedPool =
    dateView === "full_board"
      ? applyDisplaySideBalance(
          displayPool.slice(0, bestSixLimit),
          collectLeagueCandidatesFromGames(games, leagueCode),
          { limit: bestSixLimit }
        )
      : resolveDateScopedDisplayPool(
          displayPool,
          games,
          leagueCode,
          dateView,
          bestSixLimit
        );
  const derivedTopProps = selectTopTwoFromDisplayBestSix(
    scopedPool,
    leagueCode,
    getTopPickLimitForLeague(leagueCode)
  );
  const topPickBadgeMap = buildTopPickBadgeMap(derivedTopProps, leagueCode);
  const bestSixCards = prepareBestSixDisplayCards(scopedPool, topPickBadgeMap, leagueCode);
  const summary = buildLeagueControlledSummary({
    league: leagueCode,
    bestSix,
    bestSixDisplay,
    topProps,
    games,
    dateView,
    bestSixLimit,
    scopedDisplayPool: scopedPool,
    bestSixCards,
  });

  return { league: leagueCode, bestSixCards, summary, topPickBadgeMap, displayPool, scopedPool };
}

export function scopeCandidatesByDateView(candidates = [], dateView = "today") {
  if (dateView === "full_board") return candidates;
  const target = dateView === "tomorrow" ? "TOMORROW" : "TODAY";
  return candidates.filter((pick) => resolveDayBucket(pick) === target);
}

export function buildLeagueControlledSummary({
  league = "WNBA",
  bestSix = [],
  bestSixDisplay = [],
  topProps = [],
  games = [],
  dateView = "today",
  bestSixLimit = BEST_SIX_LIMIT,
  bestSixWNBA,
  bestSixDisplayWNBA,
  topWNBAProps,
  wnbaGames,
  scopedDisplayPool = null,
  bestSixCards = null,
} = {}) {
  const leagueCode = normalizeLeagueCode(league);
  const resolvedBestSix = bestSix.length ? bestSix : bestSixWNBA || [];
  const resolvedDisplay = bestSixDisplay.length ? bestSixDisplay : bestSixDisplayWNBA || [];
  const resolvedGames = games.length ? games : wnbaGames || [];
  const topPickLimit = getTopPickLimitForLeague(leagueCode);

  const displayPool = resolveBestSixDisplayPool(resolvedDisplay, resolvedBestSix);
  const filteredResults = filterBestSixByDateView(resolvedBestSix, dateView);
  const dateScopedDisplay = (() => {
    if (scopedDisplayPool) return scopedDisplayPool;
    if (dateView === "full_board") {
      return applyDisplaySideBalance(
        displayPool.slice(0, bestSixLimit),
        collectLeagueCandidatesFromGames(resolvedGames, leagueCode),
        { limit: bestSixLimit }
      );
    }
    return resolveDateScopedDisplayPool(
      displayPool,
      resolvedGames,
      leagueCode,
      dateView,
      bestSixLimit
    );
  })();
  const scopedTotal = dateScopedDisplay.length;
  const resultsTrackedCount = scopedTotal;

  const candidates = collectLeagueCandidatesFromGames(resolvedGames, leagueCode);
  const scopedCandidates = scopeCandidatesByDateView(candidates, dateView);
  const eligibilityCounts = countCandidatesByEligibility(scopedCandidates);

  const derivedTopProps = selectTopTwoFromDisplayBestSix(
    dateScopedDisplay,
    leagueCode,
    topPickLimit
  );
  const badgeTopCount = Array.isArray(bestSixCards)
    ? bestSixCards.filter((card) => card.topPickRank).length
    : 0;
  const topPickCount = Math.min(
    Math.max(derivedTopProps.length, badgeTopCount),
    topPickLimit
  );

  return {
    league: leagueCode,
    controlledBestSix: resultsTrackedCount,
    controlledBestSixTotal: scopedTotal,
    controlledBestSixTrack: resultsTrackedCount,
    resultsTrackedCount,
    bestSixHiddenByDateView: Math.max(0, displayPool.length - dateScopedDisplay.length),
    bestSixLimit,
    topPicks: topPickCount,
    topPickLimit,
    boardCandidates: scopedCandidates.length,
    boardTrack: eligibilityCounts.track,
    boardHighRisk: eligibilityCounts.highRisk,
    boardOnly: eligibilityCounts.boardOnly,
    boardShadow: eligibilityCounts.shadowOnly,
    track: eligibilityCounts.track,
    highRisk: eligibilityCounts.highRisk,
    noBet: eligibilityCounts.noBet,
    other: eligibilityCounts.other,
    dateView,
  };
}

/** @deprecated use buildLeagueControlledSummary */
export function buildWnbaControlledSummary(input = {}) {
  return buildLeagueControlledSummary({ league: "WNBA", ...input });
}

export function shouldShowScoutMode(dateView = "today", showFullBoard = false) {
  return dateView === "full_board" || showFullBoard;
}

export function formatDateViewLabel(dateView = "today") {
  if (dateView === "tomorrow") return "Tomorrow";
  if (dateView === "full_board") return "Full Board";
  return "Today";
}

function formatReportValue(value) {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function formatControlledBestSixPickLine(pick = {}, index = 0, league = "WNBA") {
  const leagueCode = normalizeLeagueCode(pick.league || league);
  const rank = pick.bestSixRank || pick.controlledBestSixRank || index + 1;
  const side = pick.side || pick.pick || "—";
  const line = pick.line ?? pick.sportsbookLine;
  const stat = pick.stat || "Points";
  const team = pick.team || "—";
  const opponent = pick.opponent || "—";
  const game = pick.game || `${team} vs ${opponent}`;
  const trackDecision = resolveTrackEligibility(pick);
  const trueRisk = resolveTrueRisk(pick);
  const why =
    pick.displayResultsReason ||
    pick.displayWhy ||
    pick.decisionIntelligence?.simpleExplanation ||
    pick.wnbaTrackingReason ||
    "";
  const resultsNote =
    pick.resultsAdmissionEligible === false && pick.displayResultsReason
      ? `Results: ${pick.displayResultsReason}`
      : pick.resultsAdmissionEligible === false && pick.resultsAdmissionReason
        ? `Results: ${pick.resultsAdmissionReason}`
        : null;
  const sideRescueAction =
    pick.displaySideRescueAction ??
    pick.sideRescueAction ??
    pick.sideRescue?.action ??
    null;
  const sideRescueExplanation =
    pick.displaySideRescueExplanation ??
    pick.sideRescueExplanation ??
    pick.sideRescue?.simpleExplanation ??
    "";
  const flipLabels =
    pick.displayFlipFirstLabels ??
    pick.flipFirstLabels ??
    pick.decisionDataIntelligence?.flipFirstLabels ??
    null;
  const topBadge = pick.topPickLabel ? ` · ${pick.topPickLabel}` : "";

  return [
    `[Best #${rank}${topBadge}] ${pick.player || "Unknown"} (${leagueCode})`,
    `  Game: ${game}`,
    `  Prop: ${side} ${formatReportValue(line)} ${stat}`,
    `  Confidence: ${formatReportValue(pick.confidence ?? pick.winProbability)}% | True Risk: ${trueRisk} | Decision: ${trackDecision}`,
    flipLabels
      ? `  Flip-First: Usage ${flipLabels.usage} | Collision ${flipLabels.collision} | Market ${flipLabels.market} | Avail ${flipLabels.availability} | Proj ${flipLabels.projectionQuality} | ${flipLabels.flipCheck}`
      : null,
    why ? `  Why: ${why}` : null,
    resultsNote,
    sideRescueAction ? `  Side Rescue: ${sideRescueAction}` : null,
    sideRescueExplanation ? `  Rescue: ${sideRescueExplanation}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildLeagueControlledBestSixReportText({
  league = "WNBA",
  bestSixCards = [],
  summary = {},
  lastUpdated = null,
  loading = false,
  dateView = "today",
  includeFullBoard = false,
  games = [],
} = {}) {
  const leagueCode = normalizeLeagueCode(league);
  const viewLabel = formatDateViewLabel(dateView);
  const bestSixLimit = summary.bestSixLimit ?? BEST_SIX_LIMIT;
  const topPickLimit = summary.topPickLimit ?? getTopPickLimitForLeague(leagueCode);
  const controlledTotal = summary.controlledBestSixTotal ?? bestSixCards.length;
  const topPicks = summary.topPicks ?? 0;
  const boardCandidates = summary.boardCandidates ?? 0;
  const track = summary.track ?? 0;
  const highRisk = summary.highRisk ?? 0;
  const noBet = summary.noBet ?? 0;
  const other = summary.other ?? 0;
  const resultsTrack = summary.controlledBestSixTrack ?? summary.controlledBestSix ?? 0;

  const lines = [
    `${leagueCode} Props — Controlled Best 6`,
    `View: ${viewLabel}`,
    lastUpdated ? `Last updated: ${lastUpdated}` : null,
    "",
    "--- Summary ---",
    `Controlled Best 6: ${controlledTotal}/${bestSixLimit}`,
    `Results Tracked: ${resultsTrack}/${bestSixLimit}`,
    `Top Picks: ${topPicks}/${topPickLimit}`,
    `Board Candidates: ${boardCandidates}`,
    `Natural Track (board): ${summary.boardTrack ?? track}`,
    `High Risk (board): ${highRisk || 0}`,
    `No Bet: ${noBet}`,
    other ? `Other: ${other}` : null,
    "",
    "--- Controlled Best 6 ---",
    bestSixCards.length
      ? bestSixCards
          .map((pick, index) => formatControlledBestSixPickLine(pick, index, leagueCode))
          .join("\n\n")
      : `No Controlled Best 6 props for ${viewLabel}.`,
  ];

  if (includeFullBoard && games.length) {
    lines.push(
      "",
      "--- Scout Mode — Full Board ---",
      `Games: ${games.length} (expanded board available in app only)`
    );
  }

  if (loading) {
    lines.push("", "Status: Loading Controlled Best 6...");
  }

  return lines.filter((line) => line !== null).join("\n");
}

/** @deprecated use buildLeagueControlledBestSixReportText */
export function buildWnbaControlledBestSixReportText(input = {}) {
  return buildLeagueControlledBestSixReportText({ league: "WNBA", ...input });
}

export function buildHomeControlledBestSixReportText({
  wnba = {},
  nba = {},
  lastUpdated = null,
  loading = false,
  dateView = HOME_DATE_VIEW,
} = {}) {
  const sections = SUPPORTED_LEAGUES.map((league) => {
    const payload = league === "WNBA" ? wnba : nba;
    return buildLeagueControlledBestSixReportText({
      league,
      dateView,
      lastUpdated: league === "WNBA" ? lastUpdated : null,
      loading: league === "WNBA" ? loading : false,
      ...payload,
    });
  });

  return [
    "CourtEdge Home — Tomorrow Controlled Best 6",
    lastUpdated ? `Last updated: ${lastUpdated}` : null,
    "",
    sections.join("\n\n---\n\n"),
  ]
    .filter(Boolean)
    .join("\n");
}
