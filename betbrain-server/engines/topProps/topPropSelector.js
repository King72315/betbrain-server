/**
 * Per-league Top Props selector — score, team diversity, no forced weak #2.
 */
import { CONFIG } from "../../config.js";
import { scoreNbaTopProp } from "./nbaTopPropScore.js";
import { scoreWnbaTopProp } from "./wnbaTopPropScore.js";
import {
  TOP_PROP_SELECTOR_VERSION,
  createTopPropSelectionAudit,
  finalizeTopPropSelectionAudit,
  isNoBetPick,
  isOfficialPick,
  isTestPick,
  summarizePickForAudit,
} from "./topPropSelectionAudit.js";

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function normalizeTeamKey(team = "") {
  return clean(team);
}

export function getPickTeamKey(pick = {}) {
  if (pick.teamKey) return normalizeTeamKey(pick.teamKey);
  return normalizeTeamKey(pick.team || pick.teamName || "");
}

export function buildTopPickLabel(league = "", rank = 1) {
  const code = String(league || "").toUpperCase();
  return `Top ${code} #${rank}`;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw === "OVER") return "OVER";
  if (raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return raw;
}

function enrichPickFromGame(pick = {}, game = {}) {
  return {
    ...pick,
    gameId: game.gameId || game.id,
    game: game.game,
    date: game.date,
    dateLabel: game.dateLabel,
    dayBucket: game.dayBucket || pick.dayBucket || "",
    time: game.time,
    commenceTime: game.commenceTime,
    minutesUntilStart: game.minutesUntilStart,
    isStarted: Boolean(game.isStarted || pick.isStarted),
    league: game.league || pick.league,
  };
}

export function collectAllGeneratedCandidates(gameCards = []) {
  const candidates = [];

  for (const game of gameCards) {
    const pool = game.allGeneratedCandidates?.length
      ? game.allGeneratedCandidates
      : game.picks || [];

    for (const pick of pool) {
      candidates.push(enrichPickFromGame(pick, game));
    }
  }

  return candidates;
}

function exactDupeKey(pick = {}) {
  return [
    clean(pick.player),
    clean(pick.team),
    String(pick.line),
    normalizeSide(pick.side || pick.pick),
    String(pick.league || "").toUpperCase(),
    clean(pick.gameId || pick.game),
  ].join("|");
}

function playerKey(pick = {}) {
  return clean(`${pick.player}-${pick.team}`);
}

function playerLineKey(pick = {}) {
  return clean(`${pick.player}-${pick.line}-${pick.stat || "points"}`);
}

function scoreCandidate(pick = {}) {
  const league = String(pick.league || "").toUpperCase();
  const scored =
    league === "WNBA" ? scoreWnbaTopProp(pick) : scoreNbaTopProp(pick);

  return {
    ...pick,
    ...scored,
    pickScore: scored.bestPropScore,
  };
}

function filterInvalidCandidates(candidates = [], audit = {}) {
  const exactSeen = new Map();
  const valid = [];

  for (const pick of candidates) {
    if (pick.isStarted) {
      audit.hiddenStarted += 1;
      audit.rejected.push({
        reason: "started",
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    if (isNoBetPick(pick)) {
      audit.noBetCount += 1;
      audit.hiddenNoBet += 1;
      audit.rejected.push({
        reason: "no_bet",
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    if (pick.noPlay) {
      audit.hiddenNoPlay += 1;
      audit.rejected.push({
        reason: "no_play",
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    const dupeKey = exactDupeKey(pick);
    const existing = exactSeen.get(dupeKey);
    if (existing) {
      audit.hiddenExactDupe += 1;
      audit.hidden.push({
        reason: "exact_dupe",
        pick: summarizePickForAudit(pick),
        kept: summarizePickForAudit(existing),
      });
      continue;
    }

    exactSeen.set(dupeKey, pick);
    valid.push(pick);

    const engine = pick.engineHandled || pick.league || "UNKNOWN";
    audit.engineHandled[engine] = Number(audit.engineHandled[engine] || 0) + 1;
  }

  audit.afterInvalidFilter = valid.length;
  return valid;
}

function hasPlayerConflict(pick = {}, playersSeen = new Set(), playerLineBest = new Map(), audit = {}) {
  const pKey = playerKey(pick);
  if (playersSeen.has(pKey)) {
    audit.hiddenDuplicatePlayer += 1;
    audit.hidden.push({
      reason: "duplicate_player",
      pick: summarizePickForAudit(pick),
    });
    return true;
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
      return true;
    }
  }

  return false;
}

function selectByTeamDiversity(sorted = [], options = {}, audit = {}) {
  const limit = Number(
    options.limit ??
      (String(options.league || "").toUpperCase() === "WNBA"
        ? CONFIG.WNBA_TOP_PROP_LIMIT
        : String(options.league || "").toUpperCase() === "NBA"
          ? CONFIG.NBA_TOP_PROP_LIMIT
          : CONFIG.TOP_PROP_LIMIT) ??
      2
  );
  const league = String(options.league || sorted[0]?.league || "").toUpperCase();
  const selected = [];
  const playersSeen = new Set();
  const playerLineBest = new Map();
  const selectedTeamKeys = new Set();

  audit.selectedTeamsByLeague = audit.selectedTeamsByLeague || {};
  audit.hiddenDueToNoDifferentTeamByLeague =
    audit.hiddenDueToNoDifferentTeamByLeague || {};
  audit.candidateCountByLeague = audit.candidateCountByLeague || {};
  audit.scoredCountByLeague = audit.scoredCountByLeague || {};

  if (league) {
    audit.scoredCountByLeague[league] = sorted.length;
  }

  for (const pick of sorted) {
    if (selected.length >= limit) {
      audit.hiddenDueToLeagueLimit += 1;
      audit.hidden.push({
        reason: "hidden_due_to_league_limit",
        limit,
        league,
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    if (hasPlayerConflict(pick, playersSeen, playerLineBest, audit)) {
      continue;
    }

    const teamKey = getPickTeamKey(pick);
    if (selectedTeamKeys.has(teamKey)) {
      audit.hiddenDueToSameTeam += 1;
      audit.hidden.push({
        reason: "hidden_due_to_same_team",
        teamKey,
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    selected.push(pick);
    playersSeen.add(playerKey(pick));
    playerLineBest.set(playerLineKey(pick), pick);
    selectedTeamKeys.add(teamKey);
  }

  if (league) {
    audit.selectedTeamsByLeague[league] = [...selectedTeamKeys];
  }

  if (limit >= 2 && selected.length === 1 && sorted.length > 1) {
    const firstTeam = getPickTeamKey(selected[0]);
    const hasDifferentTeam = sorted.some(
      (pick) => getPickTeamKey(pick) !== firstTeam
    );
    if (!hasDifferentTeam) {
      audit.noDifferentTeamCandidate = true;
      if (league) {
        audit.hiddenDueToNoDifferentTeamByLeague[league] = 1;
      }
    }
  }

  return selected;
}

function rankSelectedPicks(selected = [], league = "") {
  const leagueCode = String(league || selected[0]?.league || "").toUpperCase();

  return selected.map((pick, index) => {
    const rank = index + 1;
    return {
      ...pick,
      rank,
      topPropRank: rank,
      leagueRank: rank,
      topPickLabel: buildTopPickLabel(leagueCode, rank),
      selectedTeamKey: getPickTeamKey(pick),
    };
  });
}

export function selectTopProps(gameCards = [], options = {}) {
  const audit = createTopPropSelectionAudit();
  const leagueFilter = options.league
    ? String(options.league).toUpperCase()
    : null;

  let candidates = collectAllGeneratedCandidates(gameCards);
  audit.candidateCount = candidates.length;

  if (leagueFilter) {
    candidates = candidates.filter(
      (p) => String(p.league || "").toUpperCase() === leagueFilter
    );
    audit.candidateCountByLeague = audit.candidateCountByLeague || {};
    audit.candidateCountByLeague[leagueFilter] = candidates.length;
  }

  const valid = filterInvalidCandidates(candidates, audit);
  const scored = valid.map(scoreCandidate);
  scored.sort(
    (a, b) =>
      Number(b.bestPropScore || 0) - Number(a.bestPropScore || 0) ||
      Number(b.confidence || 0) - Number(a.confidence || 0) ||
      Number(b.netEdge || 0) - Number(a.netEdge || 0)
  );

  const selected = selectByTeamDiversity(
    scored,
    { ...options, league: leagueFilter },
    audit
  );
  const ranked = rankSelectedPicks(selected, leagueFilter);

  finalizeTopPropSelectionAudit(audit, ranked, scored);

  const topOfficialProps = ranked.filter(isOfficialPick);
  const topTestProps = ranked.filter(isTestPick);

  return {
    topProps: ranked,
    topOfficialProps,
    topTestProps,
    topSelectionAudit: audit,
    candidateCount: audit.candidateCount,
    selectedCount: audit.selectedCount,
    officialCount: audit.officialCount,
    testCount: audit.testCount,
    noBetCount: audit.noBetCount,
    selectorVersion: TOP_PROP_SELECTOR_VERSION,
  };
}

export function selectCombinedTopProps(gameCards = [], options = {}) {
  const nba = selectTopProps(gameCards, {
    ...options,
    league: "NBA",
    limit: options.nbaLimit ?? CONFIG.NBA_TOP_PROP_LIMIT,
  });
  const wnba = selectTopProps(gameCards, {
    ...options,
    league: "WNBA",
    limit: options.wnbaLimit ?? CONFIG.WNBA_TOP_PROP_LIMIT,
  });

  const combinedLimit =
    Number(options.combinedLimit ?? CONFIG.TOP_PROP_COMBINED_LIMIT) ||
    Number(CONFIG.NBA_TOP_PROP_LIMIT || 2) + Number(CONFIG.WNBA_TOP_PROP_LIMIT || 2);

  const topProps = [...nba.topProps, ...wnba.topProps].slice(0, combinedLimit);
  const topOfficialProps = topProps.filter(isOfficialPick);
  const topTestProps = topProps.filter(isTestPick);

  const audit = {
    ...nba.topSelectionAudit,
    version: TOP_PROP_SELECTOR_VERSION,
    candidateCount:
      Number(nba.topSelectionAudit?.candidateCount || 0) +
      Number(wnba.topSelectionAudit?.candidateCount || 0),
    selectedCount: topProps.length,
    officialCount: topOfficialProps.length,
    testCount: topTestProps.length,
    noBetCount:
      Number(nba.topSelectionAudit?.noBetCount || 0) +
      Number(wnba.topSelectionAudit?.noBetCount || 0),
    nba: nba.topSelectionAudit,
    wnba: wnba.topSelectionAudit,
    selectedTeamsByLeague: {
      ...(nba.topSelectionAudit?.selectedTeamsByLeague || {}),
      ...(wnba.topSelectionAudit?.selectedTeamsByLeague || {}),
    },
    candidateCountByLeague: {
      ...(nba.topSelectionAudit?.candidateCountByLeague || {}),
      ...(wnba.topSelectionAudit?.candidateCountByLeague || {}),
    },
    scoredCountByLeague: {
      ...(nba.topSelectionAudit?.scoredCountByLeague || {}),
      ...(wnba.topSelectionAudit?.scoredCountByLeague || {}),
    },
    hiddenDueToNoDifferentTeamByLeague: {
      ...(nba.topSelectionAudit?.hiddenDueToNoDifferentTeamByLeague || {}),
      ...(wnba.topSelectionAudit?.hiddenDueToNoDifferentTeamByLeague || {}),
    },
    hiddenDueToSameTeam:
      Number(nba.topSelectionAudit?.hiddenDueToSameTeam || 0) +
      Number(wnba.topSelectionAudit?.hiddenDueToSameTeam || 0),
    hiddenDueToLeagueLimit:
      Number(nba.topSelectionAudit?.hiddenDueToLeagueLimit || 0) +
      Number(wnba.topSelectionAudit?.hiddenDueToLeagueLimit || 0),
    noDifferentTeamCandidate:
      Boolean(nba.topSelectionAudit?.noDifferentTeamCandidate) ||
      Boolean(wnba.topSelectionAudit?.noDifferentTeamCandidate),
    engineHandled: {
      ...(nba.topSelectionAudit?.engineHandled || {}),
      ...(wnba.topSelectionAudit?.engineHandled || {}),
    },
    hidden: [
      ...(nba.topSelectionAudit?.hidden || []),
      ...(wnba.topSelectionAudit?.hidden || []),
    ].slice(0, 100),
    rejected: [
      ...(nba.topSelectionAudit?.rejected || []),
      ...(wnba.topSelectionAudit?.rejected || []),
    ].slice(0, 100),
  };

  return {
    topProps,
    topOfficialProps,
    topTestProps,
    topNBAProps: nba.topProps,
    topWNBAProps: wnba.topProps,
    topNBAOfficialProps: nba.topOfficialProps,
    topNBATestProps: nba.topTestProps,
    topWNBAOfficialProps: wnba.topOfficialProps,
    topWNBATestProps: wnba.topTestProps,
    topSelectionAudit: audit,
    candidateCount: audit.candidateCount,
    selectedCount: topProps.length,
    officialCount: topOfficialProps.length,
    testCount: topTestProps.length,
    noBetCount: audit.noBetCount,
    selectorVersion: TOP_PROP_SELECTOR_VERSION,
    selectedNBA: nba.topProps.length,
    selectedWNBA: wnba.topProps.length,
  };
}

export { TOP_PROP_SELECTOR_VERSION };
