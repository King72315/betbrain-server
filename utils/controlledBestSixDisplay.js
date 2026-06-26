/**
 * CourtEdge WNBA Controlled Best 6 display helpers (shared UI + node tests).
 */

export const BEST_SIX_LIMIT = 6;
export const WNBA_TOP_PICK_LIMIT = 2;

export const DATE_VIEWS = ["today", "tomorrow", "full_board"];

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

export function buildTopPickBadgeMap(topWNBAProps = []) {
  const map = new Map();
  for (const pick of topWNBAProps) {
    const key = stablePickKey(pick);
    const rank = pick.topPickRank || pick.leagueRank || pick.topPropRank;
    if (!key || !rank) continue;
    map.set(key, {
      topPickRank: rank,
      topPickLabel: pick.topPickLabel || `Top WNBA #${rank}`,
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

export function enrichBestSixForDisplay(pick = {}, topPickBadgeMap = new Map(), index = 0) {
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
    bestSixLabel: `Best WNBA #${rank}`,
    topPickRank: topMeta?.topPickRank ?? pick.topPickRank ?? null,
    topPickLabel: topMeta?.topPickLabel ?? pick.topPickLabel ?? null,
    league: pick.league || "WNBA",
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
      (resolveTrackEligibility(pick) === "TRACK" &&
        pick.decisionIntelligence?.bestSixEligibility === true),
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

/**
 * Controlled Best 6 is slate-level (not date-tab scoped). Renders full server pool
 * with contiguous display ranks so UI/report never show Best #2/#4 gaps.
 */
export function prepareBestSixDisplayCards(
  displayPool = [],
  topPickBadgeMap = new Map()
) {
  return displayPool.map((pick, index) =>
    enrichBestSixForDisplay(pick, topPickBadgeMap, index)
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

export function collectWnbaCandidatesFromGames(games = []) {
  const candidates = [];
  for (const game of games) {
    const pool = game.allGeneratedCandidates?.length
      ? game.allGeneratedCandidates
      : game.picks || [];
    for (const pick of pool) {
      candidates.push({
        ...pick,
        league: pick.league || game.league || "WNBA",
        game: pick.game || game.game,
        gameId: pick.gameId || game.gameId,
        dateLabel: pick.dateLabel || game.dateLabel,
        dayBucket: pick.dayBucket || game.dayBucket,
      });
    }
  }
  return candidates;
}

export function scopeCandidatesByDateView(candidates = [], dateView = "today") {
  if (dateView === "full_board") return candidates;
  const target = dateView === "tomorrow" ? "TOMORROW" : "TODAY";
  return candidates.filter((pick) => resolveDayBucket(pick) === target);
}

export function buildWnbaControlledSummary({
  bestSixWNBA = [],
  bestSixDisplayWNBA = [],
  topWNBAProps = [],
  wnbaGames = [],
  dateView = "today",
  bestSixLimit = BEST_SIX_LIMIT,
} = {}) {
  const displayPool = resolveBestSixDisplayPool(bestSixDisplayWNBA, bestSixWNBA);
  const filteredResults = filterBestSixByDateView(bestSixWNBA, dateView);
  const dateScopedDisplay = filterBestSixByDateView(displayPool, dateView);
  const resultsTrackCount = filteredResults.filter(
    (p) => resolveTrackEligibility(p) === "TRACK"
  ).length;
  const displayResultsCount = displayPool.filter(
    (p) =>
      p.resultsAdmissionEligible === true ||
      (p.resultsAdmissionEligible == null &&
        resolveTrackEligibility(p) === "TRACK" &&
        p.decisionIntelligence?.bestSixEligibility === true)
  ).length;

  const candidates = collectWnbaCandidatesFromGames(wnbaGames);
  const scopedCandidates = scopeCandidatesByDateView(candidates, dateView);
  const eligibilityCounts = countCandidatesByEligibility(scopedCandidates);

  const topPickCount =
    dateView === "full_board"
      ? topWNBAProps.length
      : topWNBAProps.filter((pick) => {
          const bucket = resolveDayBucket(pick);
          return dateView === "tomorrow" ? bucket === "TOMORROW" : bucket === "TODAY";
        }).length;

  return {
    controlledBestSix: displayResultsCount,
    controlledBestSixTotal: displayPool.length,
    controlledBestSixTrack: resultsTrackCount,
    bestSixHiddenByDateView: Math.max(0, displayPool.length - dateScopedDisplay.length),
    bestSixLimit,
    topPicks: Math.min(topPickCount, WNBA_TOP_PICK_LIMIT),
    topPickLimit: WNBA_TOP_PICK_LIMIT,
    boardCandidates: scopedCandidates.length,
    track: eligibilityCounts.track,
    boardOnly: eligibilityCounts.boardOnly,
    noBet: eligibilityCounts.noBet,
    shadowOnly: eligibilityCounts.shadowOnly,
    other: eligibilityCounts.other,
    dateView,
  };
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

export function formatControlledBestSixPickLine(pick = {}, index = 0) {
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
  const topBadge = pick.topPickLabel ? ` · ${pick.topPickLabel}` : "";

  return [
    `[Best #${rank}${topBadge}] ${pick.player || "Unknown"} (WNBA)`,
    `  Game: ${game}`,
    `  Prop: ${side} ${formatReportValue(line)} ${stat}`,
    `  Confidence: ${formatReportValue(pick.confidence ?? pick.winProbability)}% | True Risk: ${trueRisk} | Decision: ${trackDecision}`,
    why ? `  Why: ${why}` : null,
    resultsNote,
    sideRescueAction ? `  Side Rescue: ${sideRescueAction}` : null,
    sideRescueExplanation ? `  Rescue: ${sideRescueExplanation}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildWnbaControlledBestSixReportText({
  bestSixCards = [],
  summary = {},
  lastUpdated = null,
  loading = false,
  dateView = "today",
  includeFullBoard = false,
  games = [],
} = {}) {
  const viewLabel = formatDateViewLabel(dateView);
  const bestSixLimit = summary.bestSixLimit ?? BEST_SIX_LIMIT;
  const topPickLimit = summary.topPickLimit ?? WNBA_TOP_PICK_LIMIT;
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
    "WNBA Props — Controlled Best 6",
    `View: ${viewLabel}`,
    lastUpdated ? `Last updated: ${lastUpdated}` : null,
    "",
    "--- Summary ---",
    `Controlled Best 6: ${controlledTotal}/${bestSixLimit}`,
    `Results Track: ${resultsTrack}/${bestSixLimit}`,
    `Top Picks: ${topPicks}/${topPickLimit}`,
    `Board Candidates: ${boardCandidates}`,
    `Track: ${track}`,
    `Board Only: ${boardOnly}`,
    `No Bet: ${noBet}`,
    shadowOnly ? `Shadow Only: ${shadowOnly}` : null,
    other ? `Other: ${other}` : null,
    "",
    "--- Controlled Best 6 ---",
    bestSixCards.length
      ? bestSixCards
          .map((pick, index) => formatControlledBestSixPickLine(pick, index))
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
