/**
 * CourtEdge Controlled Best 6 display helpers — NBA + WNBA (shared UI + node tests).
 */

export const BEST_SIX_LIMIT = 6;
export const WNBA_TOP_PICK_LIMIT = 2;
export const NBA_TOP_PICK_LIMIT = 2;
export const SUPPORTED_LEAGUES = ["NBA", "WNBA"];

export const DATE_VIEWS = ["today", "tomorrow", "full_board"];
/** Home tab shows tomorrow slate only — no Today section. */
export const HOME_DATE_VIEW = "tomorrow";

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
    noBet: 0,
    shadowOnly: 0,
    other: 0,
  };

  for (const pick of candidates) {
    const eligibility = resolveTrackEligibility(pick);
    if (eligibility === "TRACK") counts.track += 1;
    else if (eligibility === "BOARD_ONLY") counts.boardOnly += 1;
    else if (eligibility === "NO_BET") counts.noBet += 1;
    else if (eligibility === "SHADOW_ONLY") counts.shadowOnly += 1;
    else counts.other += 1;
  }

  return counts;
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

/** Top 2 from display Best 6 rank order (Best #1 + #2). Team diversity on slot 2 only. */
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
  const selected = [];
  const selectedTeamKeys = new Set();

  for (const pick of displayBestSix) {
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
      topPickLabel: `Top ${leagueCode} #${rank}`,
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

export function stablePickKey(pick = {}) {
  return [
    String(pick.player || "").toLowerCase(),
    String(pick.team || "").toLowerCase(),
    String(pick.line ?? ""),
    String(pick.side || pick.pick || "").toLowerCase(),
  ].join("|");
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

  return {
    ...pick,
    bestSixRank: rank,
    controlledBestSixRank: rank,
    serverBestSixRank: serverRank,
    bestSixLabel: `Best ${leagueCode} #${rank}`,
    topPickRank: topMeta?.topPickRank ?? pick.topPickRank ?? null,
    topPickLabel: topMeta?.topPickLabel ?? pick.topPickLabel ?? null,
    league: leagueCode,
    displayTrackEligibility: resolveTrackEligibility(pick),
    displayTrueRisk: resolveTrueRisk(pick),
    displayWhy:
      pick.displayResultsReason ||
      pick.resultsAdmissionReason ||
      di.simpleExplanation ||
      pick.decisionIntelligence?.simpleExplanation ||
      pick.wnbaTrackingReason ||
      "",
    displayResultsReason:
      pick.displayResultsReason ||
      pick.resultsAdmissionReason ||
      (resolveTrackEligibility(pick) !== "TRACK" || pick.resultsAdmissionEligible === false
        ? di.simpleExplanation || pick.wnbaTrackingReason || ""
        : ""),
    resultsAdmissionEligible:
      pick.resultsAdmissionEligible ??
      isResultsPoolTrackProp(pick),
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
  if (pick.resultsAdmissionEligible === false) return false;
  const di = pick.decisionIntelligence || {};
  return (
    resolveTrackEligibility(pick) === "TRACK" && di.bestSixEligibility === true
  );
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
    return displayPool.slice(0, bestSixLimit);
  }

  const inBucket = filterBestSixByDateView(displayPool, dateView);
  if (inBucket.length >= bestSixLimit || !games?.length) {
    return inBucket.slice(0, bestSixLimit);
  }

  const displayByKey = new Map(displayPool.map((pick) => [stablePickKey(pick), pick]));
  const merged = [...inBucket];
  const usedKeys = new Set(merged.map((pick) => stablePickKey(pick)));

  const candidates = scopeCandidatesByDateView(
    collectLeagueCandidatesFromGames(games, league),
    dateView
  )
    .map((pick) => displayByKey.get(stablePickKey(pick)) || pick)
    .sort(compareCandidatesForDisplay);

  for (const pick of candidates) {
    if (merged.length >= bestSixLimit) break;
    const key = stablePickKey(pick);
    if (usedKeys.has(key)) continue;
    merged.push(pick);
    usedKeys.add(key);
  }

  return merged.slice(0, bestSixLimit);
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
      ? displayPool.slice(0, bestSixLimit)
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
  const dateScopedDisplay =
    scopedDisplayPool ??
    (dateView === "full_board"
      ? displayPool.slice(0, bestSixLimit)
      : resolveDateScopedDisplayPool(
          displayPool,
          resolvedGames,
          leagueCode,
          dateView,
          bestSixLimit
        ));
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
    track: eligibilityCounts.track,
    boardOnly: eligibilityCounts.boardOnly,
    noBet: eligibilityCounts.noBet,
    shadowOnly: eligibilityCounts.shadowOnly,
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
  const boardOnly = summary.boardOnly ?? 0;
  const noBet = summary.noBet ?? 0;
  const shadowOnly = summary.shadowOnly ?? 0;
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
    `Board Track: ${summary.boardTrack ?? track}`,
    `Board Only: ${boardOnly}`,
    `No Bet: ${noBet}`,
    shadowOnly ? `Shadow Only: ${shadowOnly}` : null,
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
