/**
 * CourtEdge Home Analysis Hydrate V1
 * Re-fetch BDL game logs + Odds game context onto existing Best 6 picks,
 * rebuild homeDetailedAnalysisV1, and preserve sealed membership/side/line/conf/risk.
 */

import {
  fetchLast5,
  fetchLast3VsOpponent,
  fetchPlayerStats,
  filterGamesBeforeCutoff,
} from "./ballService.js";
import { buildOpportunityScore } from "../engines/opportunityEngine.js";
import { buildCourtEdgePlayerEvidenceV1 } from "./courtEdgePlayerEvidenceV1.js";
import { buildWnbaOpponentDefenseContext } from "./wnbaOpponentContextService.js";
import {
  buildWnbaGameContext,
  enrichWnbaGameContextForTeam,
} from "./wnbaGameContextService.js";
import {
  attachHomeDetailedAnalysisV1,
  HOME_DETAILED_ANALYSIS_BUILD,
} from "./courtEdgeHomeDetailedAnalysisV1.js";
import { applyHomeDisplayWhyToPick } from "../engines/topProps/homeReasonTextV1.js";
import { ANALYSIS_INTEGRITY_BUILD } from "./courtEdgeAnalysisIntegrityV1.js";

export const HOME_ANALYSIS_HYDRATE_VERSION = "homeAnalysisHydrateV1";
export const HOME_ANALYSIS_HYDRATE_BUILD = "courteedge-home-analysis-hydrate-v1";

/** Coverage without recent form is a shell — never treat as complete. */
export const ANALYSIS_SHELL_COVERAGE_MAX = 55;
export const ANALYSIS_MIN_L5_FOR_COMPLETE = 3;

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function first(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return null;
}

function avgPoints(games = []) {
  const pts = (games || [])
    .map((g) => num(g?.points ?? g?.pts))
    .filter((v) => v !== null);
  if (!pts.length) return null;
  return Number((pts.reduce((s, v) => s + v, 0) / pts.length).toFixed(2));
}

/**
 * True when analysis/evidence is a partial shell (typical ~44% coverage, n=0 L5).
 */
export function isShellHomeAnalysis(pick = {}) {
  const analysis = pick.homeDetailedAnalysisV1 || {};
  const evidence = pick.courtEdgePlayerEvidence || pick.courtEdgePlayerEvidenceV1 || {};
  const l5 =
    analysis.recentPerformance?.last5Points ||
    evidence.recentForm?.last5Points ||
    (Array.isArray(pick.last5)
      ? pick.last5.map((g) => (typeof g === "number" ? g : g?.points)).filter((v) => v != null)
      : []);
  const coverage = num(
    first(
      analysis.dataQuality?.coverage,
      analysis.propSnapshot?.evidenceCoverage,
      evidence.dataQuality?.coveragePct
    ),
    0
  );
  const l5n = Array.isArray(l5) ? l5.length : 0;
  if (analysis.dataQuality?.shellAnalysis === true) return true;
  if (l5n >= ANALYSIS_MIN_L5_FOR_COMPLETE) return false;
  if (coverage > 0 && coverage <= ANALYSIS_SHELL_COVERAGE_MAX) return true;
  if (l5n === 0 && (!analysis.schemaVersion || coverage < 66)) return true;
  return false;
}

export function assessAnalysisCompleteness(pickOrAnalysis = {}) {
  const analysis =
    pickOrAnalysis.homeDetailedAnalysisV1 ||
    (pickOrAnalysis.schemaVersion ? pickOrAnalysis : {});
  const l5 = analysis.recentPerformance?.last5Points || [];
  const coverage = num(analysis.dataQuality?.coverage, 0);
  const hasForm = Array.isArray(l5) && l5.length >= ANALYSIS_MIN_L5_FOR_COMPLETE;
  const shell = !hasForm && coverage <= ANALYSIS_SHELL_COVERAGE_MAX;
  return {
    complete: hasForm || coverage >= 66.6,
    shell,
    coveragePct: coverage,
    last5Sample: Array.isArray(l5) ? l5.length : 0,
    reason: shell
      ? "shell_missing_recent_form"
      : hasForm
        ? null
        : "partial_without_form_floor",
  };
}

function preserveCanonicalDecision(pick = {}) {
  const sealed = pick.homeDetailedAnalysisV1?.canonical || {};
  return {
    side: first(
      sealed.side,
      pick.finalCourtEdgeSide,
      pick.finalSide,
      pick.side,
      pick.pick
    ),
    line: num(
      first(sealed.line, pick.sealedLine, pick.selectedLine, pick.line, pick.officialLine)
    ),
    confidence: num(
      first(sealed.confidence, pick.finalConfidence, pick.confidence)
    ),
    risk: first(sealed.risk, pick.trueRisk, pick.displayTrueRisk, pick.riskLabel),
    bestSixRank: first(
      sealed.bestSixRank,
      pick.bestSixRank,
      pick.controlledBestSixRank
    ),
    topRank: first(sealed.topRank, pick.topPickRank),
    originalModelSide: first(
      pick.originalModelSide,
      pick.sameTeamArbitration?.originalModelSide,
      sealed.originalModelSide
    ),
  };
}

/**
 * Fetch BDL + Odds context for one pick and rebuild evidence + analysis.
 * Does not change Best 6 membership or sealed side/line/confidence/risk.
 */
export async function hydrateHomeDetailedAnalysisForPick(pick = {}, options = {}) {
  if (!pick || typeof pick !== "object") return pick;

  const playerName = first(pick.player, pick.playerName);
  const league = String(first(pick.league, "WNBA")).toUpperCase();
  const opponent = first(pick.opponent, pick.courtEdgePlayerEvidence?.identity?.opponent);
  const team = first(pick.team, pick.courtEdgePlayerEvidence?.identity?.team);
  const gameCutoff = first(pick.commenceTime, pick.time, pick.gameDateTime, pick.date);
  const oddsEventId = first(
    pick.oddsEventId,
    pick.gameId,
    pick.providerIdentity?.oddsEventId,
    pick.courtEdgePlayerEvidence?.identity?.oddsEventId
  );

  const preserved = preserveCanonicalDecision(pick);
  let last5 = Array.isArray(pick.last5) && pick.last5.length ? pick.last5 : [];
  let bdlSeasonGames =
    Array.isArray(pick.bdlSeasonGames) && pick.bdlSeasonGames.length
      ? pick.bdlSeasonGames
      : Array.isArray(pick.seasonGames) && pick.seasonGames.length
        ? pick.seasonGames
        : [];
  let matchupGames =
    Array.isArray(pick.matchupGames) && pick.matchupGames.length
      ? pick.matchupGames
      : Array.isArray(pick.opponentMatchupGames) && pick.opponentMatchupGames.length
        ? pick.opponentMatchupGames
        : [];

  const fetchErrors = [];

  if ((!last5.length || !bdlSeasonGames.length) && playerName && league === "WNBA") {
    try {
      const seasonRaw = await fetchPlayerStats(playerName, league);
      bdlSeasonGames = filterGamesBeforeCutoff(seasonRaw || [], gameCutoff);
      if (!last5.length) {
        last5 = await fetchLast5(playerName, league, { beforeTime: gameCutoff });
      }
    } catch (err) {
      fetchErrors.push(`bdl_logs:${err.message || err}`);
    }
  }

  if (!matchupGames.length && playerName && opponent && league === "WNBA") {
    try {
      matchupGames = await fetchLast3VsOpponent(playerName, opponent, league, {
        beforeTime: gameCutoff,
        playerTeam: team,
      });
    } catch (err) {
      fetchErrors.push(`bdl_matchup:${err.message || err}`);
    }
  }

  let defenseResult = pick.defenseResult || null;
  if (
    league === "WNBA" &&
    opponent &&
    (!defenseResult ||
      defenseResult.status === "UNAVAILABLE" ||
      defenseResult.available === false)
  ) {
    try {
      defenseResult = await buildWnbaOpponentDefenseContext({
        opponentTeam: opponent,
      });
    } catch (err) {
      fetchErrors.push(`bdl_defense:${err.message || err}`);
    }
  }

  let wnbaGameContext = pick.wnbaGameContext || null;
  if (
    league === "WNBA" &&
    oddsEventId &&
    (num(wnbaGameContext?.spread) === null || num(wnbaGameContext?.total) === null)
  ) {
    try {
      const built = await buildWnbaGameContext({
        oddsEventId,
        league,
        homeTeam: first(pick.homeTeam, pick.game?.homeTeam),
        awayTeam: first(pick.awayTeam, pick.game?.awayTeam),
        playerTeam: team,
      });
      wnbaGameContext = enrichWnbaGameContextForTeam(built, team || "");
    } catch (err) {
      fetchErrors.push(`odds_env:${err.message || err}`);
    }
  } else if (wnbaGameContext && team) {
    wnbaGameContext = enrichWnbaGameContextForTeam(wnbaGameContext, team);
  }

  const seasonAverage =
    num(pick.seasonAverage) ??
    avgPoints(bdlSeasonGames) ??
    avgPoints(last5);

  const opportunity = buildOpportunityScore({
    last5,
    projection: {
      projection: preserved.confidence != null ? pick.projection : pick.projection,
    },
    seasonAverage: seasonAverage || 0,
    isPlayoff: true,
    league,
  });

  const line = preserved.line ?? num(pick.line);
  const evidence = buildCourtEdgePlayerEvidenceV1({
    ...pick,
    player: playerName,
    playerName,
    team,
    opponent,
    league,
    line,
    last5,
    bdlSeasonGames,
    seasonGames: bdlSeasonGames,
    seasonAverage,
    matchupGames,
    defenseResult: defenseResult || pick.defenseResult || {},
    wnbaGameContext,
    opportunity,
    availabilityGate: pick.availabilityGate || {},
    identity: {
      ...(pick.providerIdentity || {}),
      ...(pick.courtEdgePlayerEvidence?.identity || {}),
      oddsPlayerName: playerName,
      bdlPlayerId: first(
        pick.wnbaPlayerId,
        pick.playerId,
        pick.providerIdentity?.bdlPlayerId
      ),
      team,
      opponent,
      oddsEventId,
      commenceTime: gameCutoff,
    },
    projectionResult: {
      finalProjection: num(pick.projection ?? pick.projectedPoints),
      fairLine: num(pick.fairLine),
    },
    marketSnapshot: {
      openingLine: num(pick.openingLine),
      currentLine: num(pick.currentLine ?? line),
      line,
    },
  });

  // Preserve sealed decision fields; only refresh analysis evidence.
  let working = {
    ...pick,
    last5,
    bdlSeasonGames,
    seasonGames: bdlSeasonGames,
    seasonAverage,
    matchupGames,
    opponentMatchupGames: matchupGames,
    defenseResult: defenseResult || pick.defenseResult,
    wnbaGameContext,
    expectedMinutes: opportunity.recentMinutes,
    expectedFGA: opportunity.recentFGA,
    expectedFTA: opportunity.recentFTA,
    spread: first(pick.spread, wnbaGameContext?.spread),
    gameTotal: first(pick.gameTotal, wnbaGameContext?.total),
    impliedTeamTotal: first(pick.impliedTeamTotal, wnbaGameContext?.impliedTeamTotal),
    courtEdgePlayerEvidence: evidence,
    courtEdgePlayerEvidenceV1: evidence,
    analysisHydrateV1: {
      version: HOME_ANALYSIS_HYDRATE_VERSION,
      build: HOME_ANALYSIS_HYDRATE_BUILD,
      hydratedAt: new Date().toISOString(),
      last5Sample: last5.length,
      matchupSample: matchupGames.length,
      fetchErrors,
      preservedSide: preserved.side,
      preservedLine: preserved.line,
      preservedConfidence: preserved.confidence,
      preservedRisk: preserved.risk,
    },
  };

  // Same-team honesty: organic original is Over when arbitration forced Under.
  const sameTeam =
    Boolean(working.sameTeamArbitrationFlip) ||
    Boolean(working.sameTeamArbitration?.applied) ||
    String(working.flipReasonCode || "").toUpperCase() === "SAME_TEAM_ARBITRATION_FLIP";
  if (sameTeam) {
    working.originalModelSide = first(
      working.originalModelSide,
      working.sameTeamArbitration?.originalModelSide,
      "OVER"
    );
    working.sameTeamArbitration = {
      ...(working.sameTeamArbitration || {}),
      applied: true,
      originalModelSide: working.originalModelSide,
    };
  }

  // Keep sealed canonical decision — do not reshuffle confidence/side/line.
  if (preserved.side) {
    working.finalCourtEdgeSide = preserved.side;
    working.finalSide = preserved.side;
    working.side = /over/i.test(String(preserved.side)) ? "Over" : "Under";
    working.pick = working.side;
  }
  if (preserved.line != null) {
    working.sealedLine = preserved.line;
    working.line = preserved.line;
    working.selectedLine = preserved.line;
    working.currentLine = num(working.currentLine, preserved.line);
  }
  if (preserved.confidence != null) {
    working.finalConfidence = preserved.confidence;
    working.confidence = preserved.confidence;
  }
  if (preserved.risk) {
    working.trueRisk = String(preserved.risk)
      .replace(/risk/gi, "")
      .trim()
      .toUpperCase()
      .replace(/MEDIUM/, "MEDIUM")
      .replace(/HIGH/, "HIGH")
      .replace(/LOW/, "LOW");
    if (!/^(LOW|MEDIUM|HIGH)$/.test(working.trueRisk)) {
      working.trueRisk = preserved.risk;
    }
    working.displayTrueRisk = working.trueRisk;
  }

  working = applyHomeDisplayWhyToPick(working);

  const rebuilt = attachHomeDetailedAnalysisV1(working, {
    rebuildSealed: true,
    forceSealed: Boolean(
      pick.officiallySealed ||
        pick.sealed === true ||
        pick.homeDetailedAnalysisV1?.sealed === true
    ),
    useCache: false,
  });

  const completeness = assessAnalysisCompleteness(rebuilt);
  if (rebuilt.homeDetailedAnalysisV1) {
    rebuilt.homeDetailedAnalysisV1 = {
      ...rebuilt.homeDetailedAnalysisV1,
      buildVersion: HOME_DETAILED_ANALYSIS_BUILD,
      analysisHydrateBuild: HOME_ANALYSIS_HYDRATE_BUILD,
      dataQuality: {
        ...(rebuilt.homeDetailedAnalysisV1.dataQuality || {}),
        analysisComplete: completeness.complete,
        shellAnalysis: completeness.shell,
        completenessReason: completeness.reason,
        hydrateFetchErrors: fetchErrors,
        integrityBuild: ANALYSIS_INTEGRITY_BUILD,
      },
    };
  }

  return rebuilt;
}

/**
 * Hydrate a list of picks (Best 6). Membership order preserved.
 */
export async function hydrateHomeDetailedAnalysisOnPicks(picks = [], options = {}) {
  const list = Array.isArray(picks) ? picks : [];
  const out = [];
  for (const pick of list) {
    if (options.onlyShells && !isShellHomeAnalysis(pick)) {
      out.push(applyHomeDisplayWhyToPick(pick));
      continue;
    }
    try {
      out.push(await hydrateHomeDetailedAnalysisForPick(pick, options));
    } catch (err) {
      out.push({
        ...applyHomeDisplayWhyToPick(pick),
        analysisHydrateV1: {
          version: HOME_ANALYSIS_HYDRATE_VERSION,
          build: HOME_ANALYSIS_HYDRATE_BUILD,
          hydratedAt: new Date().toISOString(),
          error: String(err.message || err),
        },
      });
    }
  }
  return out;
}

/**
 * Hydrate Best 6 / top lists on a board object without reshuffling membership.
 */
export async function hydrateHomeBoardAnalysis(board = {}, options = {}) {
  if (!board || typeof board !== "object") return board;

  const hydrateList = async (list) =>
    hydrateHomeDetailedAnalysisOnPicks(list, options);

  const next = { ...board };
  const keys = [
    "bestSixWNBA",
    "bestSixDisplayWNBA",
    "bestSixDisplayTodayWNBA",
    "bestSixDisplayTomorrowWNBA",
    "bestSixNBA",
    "bestSixDisplayNBA",
    "bestSixDisplayTodayNBA",
    "bestSixDisplayTomorrowNBA",
    "topProps",
    "topWNBAProps",
    "topNBAProps",
    "topOfficialProps",
    "topWNBAOfficialProps",
    "topNBAOfficialProps",
  ];

  for (const key of keys) {
    if (Array.isArray(next[key]) && next[key].length) {
      next[key] = await hydrateList(next[key]);
    }
  }

  // Keep game-card Best 6 mirrors in sync by player+line when present.
  if (Array.isArray(next.games)) {
    const index = new Map();
    for (const p of next.bestSixDisplayTodayWNBA || next.bestSixDisplayWNBA || []) {
      const k = `${String(p.player || "").toLowerCase()}|${num(p.line ?? p.sealedLine)}`;
      index.set(k, p);
    }
    next.games = next.games.map((g) => {
      if (!g || typeof g !== "object") return g;
      const patch = (list) =>
        (Array.isArray(list) ? list : []).map((p) => {
          const k = `${String(p.player || "").toLowerCase()}|${num(p.line ?? p.sealedLine)}`;
          return index.get(k) || p;
        });
      return {
        ...g,
        picks: patch(g.picks),
        controlledBestSix: patch(g.controlledBestSix),
      };
    });
  }

  next.homeAnalysisHydrateV1 = {
    version: HOME_ANALYSIS_HYDRATE_VERSION,
    build: HOME_ANALYSIS_HYDRATE_BUILD,
    hydratedAt: new Date().toISOString(),
    onlyShells: Boolean(options.onlyShells),
  };
  next.lastUpdated = new Date().toISOString();
  return next;
}
