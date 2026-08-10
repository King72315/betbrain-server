export const TOP_PROP_SELECTOR_VERSION = "top-prop-selector-v3-league-split";

export function createTopPropSelectionAudit() {
  return {
    version: TOP_PROP_SELECTOR_VERSION,
    candidateCount: 0,
    afterInvalidFilter: 0,
    scoredCount: 0,
    selectedCount: 0,
    officialCount: 0,
    testCount: 0,
    noBetCount: 0,
    engineHandled: {},
    avgBestPropScore: null,
    avgNbaScore: null,
    avgWnbaScore: null,
    hiddenDueToCap: 0,
    hiddenDueToLimit: 0,
    hiddenDueToSameTeam: 0,
    hiddenDueToLeagueLimit: 0,
    noDifferentTeamCandidate: false,
    selectedTeamsByLeague: {},
    candidateCountByLeague: {},
    scoredCountByLeague: {},
    hiddenDueToNoDifferentTeamByLeague: {},
    topPropTeamDiversityRequired: true,
    hiddenDuplicatePlayer: 0,
    hiddenOppositeSide: 0,
    hiddenStarted: 0,
    hiddenNoPlay: 0,
    hiddenNoBet: 0,
    hiddenExactDupe: 0,
    hidden: [],
    rejected: [],
  };
}

function avg(nums = []) {
  const valid = nums.filter((n) => Number.isFinite(n));
  if (!valid.length) return null;
  return Number((valid.reduce((s, n) => s + n, 0) / valid.length).toFixed(2));
}

export function finalizeTopPropSelectionAudit(audit = {}, selected = [], scored = []) {
  const official = selected.filter(isOfficialPick);
  const test = selected.filter((p) => !isOfficialPick(p));

  audit.selectedCount = selected.length;
  audit.officialCount = official.length;
  audit.testCount = test.length;
  audit.scoredCount = scored.length;
  audit.avgBestPropScore = avg(scored.map((p) => p.bestPropScore));
  audit.avgNbaScore = avg(
    scored.filter((p) => String(p.league || "").toUpperCase() === "NBA").map((p) => p.bestPropScore)
  );
  audit.avgWnbaScore = avg(
    scored.filter((p) => String(p.league || "").toUpperCase() === "WNBA").map((p) => p.bestPropScore)
  );

  audit.hiddenDueToCap = audit.hidden.filter((h) => h.reason === "hidden_due_to_cap").length;
  audit.hiddenDueToLimit = audit.hidden.filter((h) => h.reason === "hidden_due_to_limit").length;
  audit.hiddenDuplicatePlayer = audit.hidden.filter((h) => h.reason === "duplicate_player").length;
  audit.hiddenOppositeSide = audit.hidden.filter((h) => h.reason === "opposite_side").length;

  return audit;
}

export function isOfficialPick(pick = {}) {
  // Direction NO_BET / closed gate can never be treated as Official, even if a
  // stale seal or display path left officialEligible=true.
  const directionDecision = String(
    pick.directionDecision ||
      pick.direction?.decision ||
      pick.membership?.directionDecision ||
      ""
  ).toUpperCase();
  if (
    directionDecision === "NO_BET" ||
    pick.blockedByDirectionNoBet === true ||
    pick.membership?.blockedByDirectionNoBet === true
  ) {
    return false;
  }
  if (pick.officialEligible === true) return true;
  if (String(pick.finalDecision || "").toUpperCase() === "OFFICIAL") return true;
  if (String(pick.trackingType || "").toUpperCase() === "OFFICIAL") return true;
  return false;
}

export function isTestPick(pick = {}) {
  if (isNoBetPick(pick)) return false;
  if (isOfficialPick(pick)) return false;
  const decision = String(pick.finalDecision || pick.trackingType || pick.readerDecision || "").toUpperCase();
  return decision === "TEST" || decision === "WATCHLIST" || decision === "LEAN" || !decision;
}

export function isNoBetPick(pick = {}) {
  if (pick.noPlay) return true;
  if (String(pick.trackingType || "").toUpperCase() === "NO_BET") return true;
  if (String(pick.finalDecision || "").toUpperCase() === "NO_BET") return true;
  if (String(pick.readerDecision || "").toUpperCase() === "NO_BET") return true;
  return false;
}

export function summarizePickForAudit(pick = {}) {
  return {
    player: pick.player,
    team: pick.team,
    line: pick.line,
    side: pick.side || pick.pick,
    league: pick.league,
    game: pick.game,
    bestPropScore: pick.bestPropScore,
    tier: pick.tier,
    officialEligible: pick.officialEligible,
    readerDecision: pick.readerDecision,
    engineHandled: pick.engineHandled,
  };
}
