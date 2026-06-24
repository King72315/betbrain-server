/**
 * Controlled Best 6 selector — full pool → quality gate → rank → Best 6 → Top 2 from Best 6.
 */
import { CONFIG } from "../../config.js";
import { scoreNbaTopProp } from "./nbaTopPropScore.js";
import { scoreWnbaTopProp } from "./wnbaTopPropScore.js";
import {
  isOfficialPick,
  isTestPick,
  isNoBetPick,
  summarizePickForAudit,
} from "./topPropSelectionAudit.js";
import {
  getPickTeamKey,
  buildTopPickLabel,
  collectAllGeneratedCandidates,
} from "./topPropSelector.js";
import {
  applyQualityGateToPick,
  evaluateWnbaTrackingEligibility,
  isWnbaQualityGatePick,
} from "../wnba/wnbaResultsQualityGate.js";

export const CONTROLLED_BEST_SIX_VERSION = "controlled-best-six-v1";
export const BEST_SIX_LIMIT = 6;
export const TOP_TWO_LIMIT = 2;
export const MAX_TEAM_IN_BEST_SIX = 2;
export const MAX_GAME_IN_BEST_SIX = 3;

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return raw;
}

function getGameKey(pick = {}) {
  return clean(pick.gameId || pick.game || "");
}

function exactDupeKey(pick = {}) {
  return [
    clean(pick.player),
    clean(pick.team),
    String(pick.line),
    normalizeSide(pick.side || pick.pick),
    String(pick.league || "").toUpperCase(),
    getGameKey(pick),
  ].join("|");
}

function playerKey(pick = {}) {
  return clean(`${pick.player}-${pick.team}`);
}

function playerLineKey(pick = {}) {
  return clean(`${pick.player}-${pick.line}-${pick.stat || "points"}`);
}

function hasCoreFields(pick = {}) {
  return Boolean(
    pick.player &&
      pick.team &&
      pick.line != null &&
      (pick.side || pick.pick) &&
      pick.league
  );
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

function compareByScore(a = {}, b = {}) {
  return (
    Number(b.bestPropScore || 0) - Number(a.bestPropScore || 0) ||
    Number(b.confidence || 0) - Number(a.confidence || 0) ||
    Number(b.netEdge || 0) - Number(a.netEdge || 0)
  );
}

function createControlledBestSixAudit(league = "") {
  return {
    version: CONTROLLED_BEST_SIX_VERSION,
    league: String(league || "").toUpperCase(),
    candidateCount: 0,
    qualityPassedCount: 0,
    afterInvalidFilter: 0,
    scoredCount: 0,
    selectedBestSixCount: 0,
    hiddenDueToBestSixCap: 0,
    hiddenDueToTeamCap: 0,
    hiddenDueToGameCap: 0,
    hiddenDueToQualityGate: 0,
    hiddenDuplicatePlayer: 0,
    hiddenOppositeSide: 0,
    hiddenStarted: 0,
    hiddenNoPlay: 0,
    hiddenNoBet: 0,
    hiddenExactDupe: 0,
    hiddenDueToSameTeam: 0,
    noDifferentTeamCandidate: false,
    selectedBestSixTeams: [],
    selectedTopTeams: [],
    hidden: [],
    rejected: [],
  };
}

function filterAndGateCandidates(candidates = [], audit = {}) {
  const exactSeen = new Map();
  const playerLineBest = new Map();
  const valid = [];
  let qualityPassed = 0;

  for (const rawPick of candidates) {
    let pick = rawPick;

    if (pick.isStarted) {
      audit.hiddenStarted += 1;
      audit.rejected.push({ reason: "started", pick: summarizePickForAudit(pick) });
      continue;
    }

    if (!hasCoreFields(pick)) {
      audit.rejected.push({ reason: "missing_data", pick: summarizePickForAudit(pick) });
      continue;
    }

    if (isNoBetPick(pick)) {
      audit.hiddenNoBet += 1;
      audit.rejected.push({ reason: "no_bet", pick: summarizePickForAudit(pick) });
      continue;
    }

    if (pick.noPlay) {
      audit.hiddenNoPlay += 1;
      audit.rejected.push({ reason: "no_play", pick: summarizePickForAudit(pick) });
      continue;
    }

    if (isWnbaQualityGatePick(pick)) {
      const gate = evaluateWnbaTrackingEligibility(
        pick,
        pick.wnbaDataCard,
        pick.wnbaReader
      );
      if (gate.trackingEligibility !== "TRACK") {
        audit.hiddenDueToQualityGate += 1;
        audit.rejected.push({
          reason: "quality_gate",
          eligibility: gate.trackingEligibility,
          pick: summarizePickForAudit(pick),
        });
        continue;
      }
      pick = applyQualityGateToPick(pick, gate);
    }

    qualityPassed += 1;

    const dupeKey = exactDupeKey(pick);
    if (exactSeen.has(dupeKey)) {
      audit.hiddenExactDupe += 1;
      audit.hidden.push({
        reason: "exact_dupe",
        pick: summarizePickForAudit(pick),
        kept: summarizePickForAudit(exactSeen.get(dupeKey)),
      });
      continue;
    }

    const pKey = playerKey(pick);
    if (exactSeen.has(`player|${pKey}`)) {
      audit.hiddenDuplicatePlayer += 1;
      audit.hidden.push({
        reason: "duplicate_player",
        pick: summarizePickForAudit(pick),
      });
      continue;
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
        continue;
      }
    }

    exactSeen.set(dupeKey, pick);
    exactSeen.set(`player|${pKey}`, pick);
    playerLineBest.set(plKey, pick);
    valid.push(pick);
  }

  audit.qualityPassedCount = qualityPassed;
  return valid;
}

function selectBestSixWithDiversity(sorted = [], options = {}, audit = {}) {
  const limit = Number(options.limit ?? BEST_SIX_LIMIT);
  const maxPerTeam = Number(options.maxPerTeam ?? MAX_TEAM_IN_BEST_SIX);
  const maxPerGame = Number(options.maxPerGame ?? MAX_GAME_IN_BEST_SIX);
  const selected = [];
  const teamCounts = new Map();
  const gameCounts = new Map();

  for (const pick of sorted) {
    if (selected.length >= limit) {
      audit.hiddenDueToBestSixCap += 1;
      audit.hidden.push({
        reason: "hidden_due_to_best_six_cap",
        limit,
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    const teamKey = getPickTeamKey(pick);
    const gameKey = getGameKey(pick);
    const teamCount = Number(teamCounts.get(teamKey) || 0);
    const gameCount = Number(gameCounts.get(gameKey) || 0);

    if (teamCount >= maxPerTeam) {
      audit.hiddenDueToTeamCap += 1;
      audit.hidden.push({
        reason: "hidden_due_to_team_cap",
        teamKey,
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    if (gameKey && gameCount >= maxPerGame) {
      audit.hiddenDueToGameCap += 1;
      audit.hidden.push({
        reason: "hidden_due_to_game_cap",
        gameKey,
        pick: summarizePickForAudit(pick),
      });
      continue;
    }

    selected.push(pick);
    teamCounts.set(teamKey, teamCount + 1);
    if (gameKey) gameCounts.set(gameKey, gameCount + 1);
  }

  return selected;
}

function rankBestSix(selected = [], league = "") {
  const leagueCode = String(league || selected[0]?.league || "").toUpperCase();

  return selected.map((pick, index) => {
    const rank = index + 1;
    return {
      ...pick,
      bestSixRank: rank,
      leagueBestSixRank: rank,
      bestSixLabel: `Best ${leagueCode} #${rank}`,
      selectedTeamKey: getPickTeamKey(pick),
      trackingCohortSource: "CONTROLLED_BEST_SIX",
    };
  });
}

export function selectControlledBestSix(candidates = [], league = "", options = {}) {
  const leagueCode = String(league || "").toUpperCase();
  const audit = createControlledBestSixAudit(leagueCode);

  const pool = (Array.isArray(candidates) ? candidates : []).filter(
    (p) => String(p.league || "").toUpperCase() === leagueCode
  );
  audit.candidateCount = pool.length;

  const valid = filterAndGateCandidates(pool, audit);
  audit.afterInvalidFilter = valid.length;

  const scored = valid.map(scoreCandidate);
  scored.sort(compareByScore);
  audit.scoredCount = scored.length;

  const selected = selectBestSixWithDiversity(
    scored,
    {
      limit: options.bestSixLimit ?? BEST_SIX_LIMIT,
      maxPerTeam: options.maxPerTeam ?? MAX_TEAM_IN_BEST_SIX,
      maxPerGame: options.maxPerGame ?? MAX_GAME_IN_BEST_SIX,
    },
    audit
  );
  const ranked = rankBestSix(selected, leagueCode);

  audit.selectedBestSixCount = ranked.length;
  audit.selectedBestSixTeams = [...new Set(ranked.map(getPickTeamKey))];

  return {
    bestSix: ranked,
    controlledBestSixAudit: audit,
  };
}

export function selectTopTwoFromBestSix(bestSix = [], league = "", options = {}) {
  const leagueCode = String(league || bestSix[0]?.league || "").toUpperCase();
  const limit = Number(options.topLimit ?? TOP_TWO_LIMIT);
  const audit = {
    league: leagueCode,
    hiddenDueToSameTeam: 0,
    hiddenDueToLeagueLimit: 0,
    noDifferentTeamCandidate: false,
    selectedTopTeams: [],
    hidden: [],
  };

  const selected = [];
  const selectedTeamKeys = new Set();

  for (const pick of bestSix) {
    if (selected.length >= limit) {
      audit.hiddenDueToLeagueLimit += 1;
      audit.hidden.push({
        reason: "hidden_due_to_league_limit",
        limit,
        pick: summarizePickForAudit(pick),
      });
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
    selectedTeamKeys.add(teamKey);
  }

  if (limit >= 2 && selected.length === 1 && bestSix.length > 1) {
    const firstTeam = getPickTeamKey(selected[0]);
    const hasDifferentTeam = bestSix.some(
      (pick) => getPickTeamKey(pick) !== firstTeam
    );
    if (!hasDifferentTeam) {
      audit.noDifferentTeamCandidate = true;
    }
  }

  const ranked = selected.map((pick, index) => {
    const rank = index + 1;
    return {
      ...pick,
      rank,
      topPropRank: rank,
      leagueRank: rank,
      topPickLabel: buildTopPickLabel(leagueCode, rank),
      selectedTeamKey: getPickTeamKey(pick),
      selectedFromBestSix: true,
      isTopPickReference: true,
      referenceOnly: true,
    };
  });

  audit.selectedTopTeams = [...selectedTeamKeys];

  return {
    topProps: ranked,
    audit,
  };
}

export function selectControlledBestSixCombined(gameCards = [], options = {}) {
  const candidates = collectAllGeneratedCandidates(gameCards);

  const wnbaBest = selectControlledBestSix(candidates, "WNBA", options);
  const nbaBest = selectControlledBestSix(candidates, "NBA", options);

  const wnbaTop = selectTopTwoFromBestSix(wnbaBest.bestSix, "WNBA", {
    topLimit: options.wnbaTopLimit ?? CONFIG.WNBA_TOP_PROP_LIMIT,
  });
  const nbaTop = selectTopTwoFromBestSix(nbaBest.bestSix, "NBA", {
    topLimit: options.nbaTopLimit ?? CONFIG.NBA_TOP_PROP_LIMIT,
  });

  const topWNBAProps = wnbaTop.topProps;
  const topNBAProps = nbaTop.topProps;
  const topProps = [...topNBAProps, ...topWNBAProps].slice(
    0,
    CONFIG.TOP_PROP_COMBINED_LIMIT
  );

  const controlledBestSixAudit = {
    version: CONTROLLED_BEST_SIX_VERSION,
    topPropsSource: "CONTROLLED_BEST_SIX",
    candidateCount: candidates.length,
    candidateCountByLeague: {
      WNBA: wnbaBest.controlledBestSixAudit.candidateCount,
      NBA: nbaBest.controlledBestSixAudit.candidateCount,
    },
    qualityPassedCountByLeague: {
      WNBA: wnbaBest.controlledBestSixAudit.qualityPassedCount,
      NBA: nbaBest.controlledBestSixAudit.qualityPassedCount,
    },
    bestSixCountByLeague: {
      WNBA: wnbaBest.bestSix.length,
      NBA: nbaBest.bestSix.length,
    },
    hiddenDueToBestSixCap:
      wnbaBest.controlledBestSixAudit.hiddenDueToBestSixCap +
      nbaBest.controlledBestSixAudit.hiddenDueToBestSixCap,
    hiddenDueToTeamCap:
      wnbaBest.controlledBestSixAudit.hiddenDueToTeamCap +
      nbaBest.controlledBestSixAudit.hiddenDueToTeamCap,
    hiddenDueToGameCap:
      wnbaBest.controlledBestSixAudit.hiddenDueToGameCap +
      nbaBest.controlledBestSixAudit.hiddenDueToGameCap,
    hiddenDueToQualityGate:
      wnbaBest.controlledBestSixAudit.hiddenDueToQualityGate +
      nbaBest.controlledBestSixAudit.hiddenDueToQualityGate,
    selectedBestSixTeamsByLeague: {
      WNBA: wnbaBest.controlledBestSixAudit.selectedBestSixTeams,
      NBA: nbaBest.controlledBestSixAudit.selectedBestSixTeams,
    },
    selectedTopTeamsByLeague: {
      WNBA: wnbaTop.audit.selectedTopTeams,
      NBA: nbaTop.audit.selectedTopTeams,
    },
    selectedTeamsByLeague: {
      WNBA: wnbaTop.audit.selectedTopTeams,
      NBA: nbaTop.audit.selectedTopTeams,
    },
    topWNBAPropsSelectedFromBestSix: true,
    topNBAPropsSelectedFromBestSix: true,
    noDifferentTeamCandidate:
      wnbaTop.audit.noDifferentTeamCandidate ||
      nbaTop.audit.noDifferentTeamCandidate,
    hiddenDueToSameTeam:
      wnbaTop.audit.hiddenDueToSameTeam + nbaTop.audit.hiddenDueToSameTeam,
    hiddenDueToLeagueLimit:
      wnbaTop.audit.hiddenDueToLeagueLimit + nbaTop.audit.hiddenDueToLeagueLimit,
    hiddenDueToNoDifferentTeamByLeague: {
      WNBA: wnbaTop.audit.noDifferentTeamCandidate ? 1 : 0,
      NBA: nbaTop.audit.noDifferentTeamCandidate ? 1 : 0,
    },
    wnba: wnbaBest.controlledBestSixAudit,
    nba: nbaBest.controlledBestSixAudit,
    wnbaTop: wnbaTop.audit,
    nbaTop: nbaTop.audit,
    selectedCount: topProps.length,
    officialCount: topProps.filter(isOfficialPick).length,
    testCount: topProps.filter(isTestPick).length,
    hidden: [
      ...(wnbaBest.controlledBestSixAudit.hidden || []),
      ...(nbaBest.controlledBestSixAudit.hidden || []),
      ...(wnbaTop.audit.hidden || []),
      ...(nbaTop.audit.hidden || []),
    ].slice(0, 100),
    rejected: [
      ...(wnbaBest.controlledBestSixAudit.rejected || []),
      ...(nbaBest.controlledBestSixAudit.rejected || []),
    ].slice(0, 100),
  };

  return {
    bestSixWNBA: wnbaBest.bestSix,
    bestSixNBA: nbaBest.bestSix,
    topWNBAProps,
    topNBAProps,
    topProps,
    topOfficialProps: topProps.filter(isOfficialPick),
    topTestProps: topProps.filter(isTestPick),
    topNBAOfficialProps: topNBAProps.filter(isOfficialPick),
    topNBATestProps: topNBAProps.filter(isTestPick),
    topWNBAOfficialProps: topWNBAProps.filter(isOfficialPick),
    topWNBATestProps: topWNBAProps.filter(isTestPick),
    controlledBestSixAudit,
    topSelectionAudit: controlledBestSixAudit,
    candidateCount: candidates.length,
    selectedCount: topProps.length,
    selectedNBA: topNBAProps.length,
    selectedWNBA: topWNBAProps.length,
    controlledBestSixVersion: CONTROLLED_BEST_SIX_VERSION,
    topPropsSource: "CONTROLLED_BEST_SIX",
    selectorVersion: CONTROLLED_BEST_SIX_VERSION,
    noBetCount:
      wnbaBest.controlledBestSixAudit.hiddenNoBet +
      nbaBest.controlledBestSixAudit.hiddenNoBet,
  };
}
