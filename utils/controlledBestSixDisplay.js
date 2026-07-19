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
/**
 * Home default = Today (live grading slate). Tomorrow remains selectable on Home
 * and is still the Top-tab default look-ahead board (America/Chicago).
 */
export const HOME_DATE_VIEW = "today";
export const HOME_SECONDARY_DATE_VIEW = "tomorrow";
export const TOP_DATE_VIEW = "tomorrow";

/** Home defaults to Today so live games are not hidden behind tomorrow-only. */
export function resolveHomeControlledDateView(requested = null) {
  const raw = String(requested || HOME_DATE_VIEW).toLowerCase();
  if (raw === "tomorrow" || raw === "full_board") return raw;
  return "today";
}

export function resolveTopControlledDateView() {
  return TOP_DATE_VIEW;
}

export function filterPicksByDateView(picks = [], dateView = "tomorrow") {
  return filterBestSixByDateView(picks, dateView);
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
    else if (eligibility === "BOARD_ONLY") counts.boardOnly += 1;
    else if (eligibility === "SHADOW_ONLY") counts.shadowOnly += 1;
    else counts.other += 1;

    // High Risk summary MUST use canonical final trueRisk — not BOARD_ONLY.
    if (resolveTrueRisk(pick) === "HIGH") counts.highRisk += 1;
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
  // Side-symmetry policy: no forced O/U quota swaps that replace stronger with weaker.
  void candidatePool;
  void options;
  return selected;
}

export function resolveBestSixDisplayPool(
  bestSixDisplayWNBA = [],
  bestSixWNBA = []
) {
  return bestSixDisplayWNBA?.length ? bestSixDisplayWNBA : bestSixWNBA;
}

export function resolveTrueRisk(pick = {}) {
  const canonical = pick.homeDetailedAnalysisV1?.canonical?.risk;
  return String(
    canonical ||
      pick.displayTrueRisk ||
      pick.decisionIntelligence?.trueRisk ||
      pick.trueRisk ||
      "—"
  ).toUpperCase();
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

/** America/Chicago calendar date (YYYY-MM-DD). */
export function getChicagoCalendarDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Home Today pool: prefer slateDate over stale dayBucket=TODAY after Lab promotion.
 */
export function filterCalendarTodayHomePool(picks = [], today = getChicagoCalendarDate()) {
  return (Array.isArray(picks) ? picks : []).filter((pick) => {
    const d = String(pick.slateDate || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d === today;
    return resolveDayBucket(pick) === "TODAY";
  });
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
    const gameLeague = normalizeLeagueCode(game.league || "");
    // Skip opposite-league cards (mixed /picks payloads must not fill NBA from WNBA).
    if (game.league && gameLeague !== leagueCode) continue;

    const pool = game.allGeneratedCandidates?.length
      ? game.allGeneratedCandidates
      : game.picks || [];
    for (const pick of pool) {
      const pickLeague = normalizeLeagueCode(pick.league || game.league || leagueCode);
      if (pickLeague !== leagueCode) continue;
      candidates.push({
        ...pick,
        league: leagueCode,
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

  const display = isWNBA
    ? data.bestSixDisplayWNBA || []
    : data.bestSixDisplayNBA || [];
  const bestSix = isWNBA ? data.bestSixWNBA || [] : data.bestSixNBA || [];
  const explicitToday = isWNBA
    ? data.bestSixDisplayTodayWNBA
    : data.bestSixDisplayTodayNBA;
  // Never fall back to Results/Lab cohort (bestSix*) for Home Today.
  const bestSixDisplayToday =
    Array.isArray(explicitToday) && explicitToday.length
      ? explicitToday
      : filterBestSixByDateView(display.length ? display : bestSix, "today");

  return {
    league: leagueCode,
    games,
    bestSix,
    bestSixDisplay: display.length ? display : bestSix,
    bestSixDisplayToday,
    topProps: isWNBA ? data.topWNBAProps || [] : data.topNBAProps || [],
  };
}

export function buildLeagueBestSixBoard({
  league = "WNBA",
  bestSix = [],
  bestSixDisplay = [],
  bestSixDisplayToday = [],
  topProps = [],
  games = [],
  dateView = "today",
  bestSixLimit = BEST_SIX_LIMIT,
} = {}) {
  const leagueCode = normalizeLeagueCode(league);
  const displayPool = resolveBestSixDisplayPool(bestSixDisplay, bestSix);
  const today = getChicagoCalendarDate();
  const serverTodayPool = filterCalendarTodayHomePool(
    bestSixDisplayToday?.length
      ? bestSixDisplayToday
      : filterBestSixByDateView(bestSix, "today"),
    today
  ).slice(0, bestSixLimit);
  const scopedPool =
    dateView === "full_board"
      ? applyDisplaySideBalance(
          displayPool.slice(0, bestSixLimit),
          collectLeagueCandidatesFromGames(games, leagueCode),
          { limit: bestSixLimit }
        )
      : dateView === "today" && serverTodayPool.length > 0
        ? applyDisplaySideBalance(
            serverTodayPool,
            collectLeagueCandidatesFromGames(games, leagueCode),
            { limit: bestSixLimit }
          )
        : dateView === "today"
          ? applyDisplaySideBalance(
              filterCalendarTodayHomePool(
                resolveDateScopedDisplayPool(
                  displayPool,
                  games,
                  leagueCode,
                  dateView,
                  bestSixLimit
                ),
                today
              ),
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
  const trackDecision = "TRACK";
  const trueRisk = resolveTrueRisk(pick);
  const canonical = pick.homeDetailedAnalysisV1?.canonical || {};
  const conf =
    canonical.confidence ??
    pick.finalConfidence ??
    pick.confidence ??
    pick.winProbability;
  const confDisplay =
    conf === null || conf === undefined || conf === ""
      ? "—"
      : String(Math.round(Number(conf)));
  const whyRaw =
    pick.displayWhy ||
    pick.decisionIntelligence?.simpleExplanation ||
    "";
  const why = String(whyRaw)
    .replace(/\b(BOARD_ONLY|NO_BET|SHADOW_ONLY|NATURAL_TRACK|READER_UNCERTAIN(?:_TEST)?|NO_DECISIVE_RESCUE)\b/gi, "")
    .replace(
      /\b(UNDER_GAP_BELOW_[A-Z0-9_]+|OVER_GAP_BELOW_[A-Z0-9_]+|DANGER_STACK_[A-Z0-9_]+|DANGER_GATE_STACK_[A-Z0-9_]+)\b/gi,
      ""
    )
    .replace(/\bdanger[\s_-]*gates?\b/gi, "risk factors")
    .replace(/\bgap[\s_-]*floors?\b/gi, "projection threshold")
    .replace(/prior gate:\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*[—–-]\s*$/g, "")
    .trim();
  const whyTranslated = (() => {
    const code =
      pick.decisionIntelligence?.naturalGateReason ||
      pick.wnbaTrackingReason ||
      pick.decisionIntelligence?.gateReason ||
      "";
    const map = {
      UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR:
        "The Under projection edge is below the normal limited-data threshold.",
      OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR:
        "The Over has a limited projection advantage despite otherwise complete data.",
      DANGER_STACK_INSUFFICIENT_EDGE:
        "The projection edge is thin relative to the identified risk factors.",
      NO_DECISIVE_RESCUE: "No stronger opposite-side case was found.",
      DANGER_GATE_STACK_BOARD_ONLY:
        "Multiple risk factors are stacked against this side.",
    };
    const key = String(code || "").toUpperCase();
    for (const [raw, text] of Object.entries(map)) {
      if (key.includes(raw)) return text;
    }
    return "";
  })();
  const whyFinal =
    why && why !== "—"
      ? why
      : whyTranslated
        ? `TRACK — ${whyTranslated}`
        : `TRACK — Selected on available evidence. True risk ${trueRisk}.`;
  const sameTeamFlip = Boolean(
    pick.sameTeamArbitrationFlip ||
      pick.flipReasonCode === "SAME_TEAM_ARBITRATION_FLIP"
  );
  const originalModelSide =
    pick.originalModelSide || pick.sameTeamArbitration?.originalModelSide || null;
  const sideRescueAction = sameTeamFlip
    ? "SAME_TEAM_ARBITRATION"
    : pick.displaySideRescueAction ??
      pick.sideRescueAction ??
      pick.sideRescue?.action ??
      null;
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
    `  Confidence: ${confDisplay}% | Risk: ${trueRisk} | Decision: ${trackDecision}`,
    sameTeamFlip
      ? `  Model Side: ${originalModelSide || "OVER"} → Final Side: UNDER | Same-Team Arbitration: Applied`
      : null,
    flipLabels
      ? `  Signals: Usage ${flipLabels.usage} | Collision ${flipLabels.collision} | Market ${flipLabels.market} | Avail ${flipLabels.availability} | Proj ${flipLabels.projectionQuality}`
      : null,
    whyFinal ? `  Why: ${whyFinal}` : null,
    sideRescueAction &&
    sideRescueAction !== "KEEP_ORIGINAL" &&
    !/BOARD_ONLY|NO_BET|FLIPPED_TO_|NO_DECISIVE_RESCUE/i.test(String(sideRescueAction))
      ? `  ${sameTeamFlip ? "Arbitration" : "Side Rescue"}: ${sideRescueAction}`
      : null,
    formatDetailedAnalysisReportBlock(pick),
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDetailedAnalysisReportBlock(pick = {}) {
  const a = pick.homeDetailedAnalysisV1;
  if (!a || !a.schemaVersion) return null;
  const s = a.propSnapshot || {};
  const r = a.recentPerformance || {};
  const m = a.matchupHistory || {};
  const role = a.roleOpportunity || {};
  const proj = a.projectionDistribution || {};
  const opp = a.opponentContext || {};
  const env = a.gameEnvironment || {};
  const mkt = a.marketAnalysis || {};
  const avail = a.availability || {};
  const dec = a.finalDecision || {};
  const dq = a.dataQuality || {};
  const matchups = Array.isArray(m.recentMatchups) ? m.recentMatchups : [];
  const conf = s.confidence ?? dec.finalConfidence ?? a.canonical?.confidence;
  const risk = s.risk ?? dec.finalRisk ?? a.canonical?.risk;
  const matchupLines =
    m.status === "UNAVAILABLE" || !matchups.length
      ? [
          `  Matchup: ${m.display || "No previous matchup data available."}`,
        ]
      : matchups.map(
          (row, i) =>
            `  Matchup ${i + 1}: ${row.date || "—"} pts ${row.points ?? "Unavailable"} min ${row.minutes ?? "Unavailable"} FGA ${row.fga ?? "Unavailable"} FTA ${row.fta ?? "Unavailable"} vs line ${row.againstTodaysLine || "—"}`
        );
  const rescue =
    dec.sideRescueDisplay ||
    (String(dec.sideRescueAction || "").toUpperCase() === "NO_DECISIVE_RESCUE"
      ? "No stronger opposite-side case was found."
      : dec.sideRescueAction || "—");
  return [
    "  --- DETAILED ANALYSIS ---",
    `  Snapshot: ${s.player || pick.player} | ${s.finalCourtEdgeSide} ${s.sealedLine} | Conf ${conf}% | Risk ${risk} | ${s.sealedLiveStatus}`,
    `  Original side: ${s.originalModelSide} | Coverage ${s.evidenceCoverage ?? "—"}%`,
    `  L5: [${(r.last5Points || []).join(", ") || "Unavailable"}] avg ${r.last5Average ?? "Unavailable"} hit ${r.last5HitRate?.label || "Unavailable"}`,
    `  L10: [${(r.last10Points || []).join(", ") || "Unavailable"}] avg ${r.last10Average ?? "Unavailable"} (n=${r.last10SampleSize ?? 0}) season ${r.seasonAverage ?? "Unavailable"} trend ${r.scoringTrend?.trend || "Unavailable"}`,
    ...matchupLines,
    `  Role: expMin ${role.expectedMinutes ?? "Unavailable"} L5min ${role.last5Minutes ?? "Unavailable"} FGA ${role.expectedFGA ?? "Unavailable"} FTA ${role.expectedFTA ?? "Unavailable"}`,
    `  Projection: final ${proj.finalProjection ?? "—"} fair ${proj.fairLine ?? "—"} gap ${proj.projectionGap ?? "—"} vol ${proj.volatilityTier ?? "—"}`,
    `  Opponent: defense ${opp.opponentDefenseStatus} score ${opp.defenseScore ?? "Unavailable"}`,
    `  Environment: spread ${env.spread ?? "Unavailable"} total ${env.gameTotal ?? "Unavailable"} paceProxy ${env.paceProxy ?? "Unavailable"}`,
    `  Market: open ${mkt.openingLine ?? "Unavailable"} sealed ${mkt.selectedSealedLine ?? "Unavailable"} current ${mkt.currentLine ?? "Unavailable"} → ${mkt.compactResult}`,
    `  Availability: ${avail.displayStatus || "Unavailable"}`,
    `  Decision: ${dec.originalModelSide} → ${dec.finalCourtEdgeSide} | Conf ${dec.finalConfidence ?? conf}% | Risk ${dec.finalRisk ?? risk} | Flip ${dec.flipFirstAction} | Rescue ${rescue}`,
    dec.topPickTransparency
      ? `  Top: rank ${dec.topPickTransparency.rank} | ${dec.topPickTransparency.reason}`
      : null,
    `  Sources: coverage ${dq.coverage ?? "—"}% fetchedAt ${dq.fetchedAt || "—"}`,
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
  const highRisk = summary.highRisk ?? 0;
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
    `Selected / Tracked: ${resultsTrack}/${bestSixLimit}`,
    `High Risk (board): ${highRisk || 0}`,
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
  wnbaToday = null,
  wnbaTomorrow = null,
  nbaToday = null,
  nbaTomorrow = null,
  lastUpdated = null,
  loading = false,
  dateView = HOME_DATE_VIEW,
} = {}) {
  const hasDualSlate =
    wnbaToday || wnbaTomorrow || nbaToday || nbaTomorrow;

  if (hasDualSlate) {
    const blocks = [];
    for (const league of SUPPORTED_LEAGUES) {
      const todayPayload =
        league === "WNBA" ? wnbaToday || wnba : nbaToday || nba;
      const tomorrowPayload =
        league === "WNBA" ? wnbaTomorrow || wnba : nbaTomorrow || nba;
      blocks.push(
        buildLeagueControlledBestSixReportText({
          league,
          dateView: "today",
          lastUpdated: league === "WNBA" ? lastUpdated : null,
          loading: league === "WNBA" ? loading : false,
          ...todayPayload,
        })
      );
      blocks.push(
        buildLeagueControlledBestSixReportText({
          league,
          dateView: "tomorrow",
          ...tomorrowPayload,
        })
      );
    }
    return [
      "CourtEdge Home — Today + Tomorrow Controlled Best 6",
      lastUpdated ? `Last updated: ${lastUpdated}` : null,
      "",
      blocks.join("\n\n---\n\n"),
    ]
      .filter(Boolean)
      .join("\n");
  }

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

  const titleView = formatDateViewLabel(dateView);
  return [
    `CourtEdge Home — ${titleView} Controlled Best 6`,
    lastUpdated ? `Last updated: ${lastUpdated}` : null,
    "",
    sections.join("\n\n---\n\n"),
  ]
    .filter(Boolean)
    .join("\n");
}
