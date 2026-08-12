/**
 * PropType display sanitize V1
 *
 * Read-path repair for Home Official cards:
 * - align stat/canonicalPropType with propType
 * - strip Side Rescue display authority
 * - rebuild detailed analysis from propType-scoped box scores (no Odds refresh)
 */
import {
  normalizePropTypeV1,
  propTypeStatLabel,
} from "../engines/wnba/propTypeV1.js";
import { attachHomeDetailedAnalysisV1 } from "./courtEdgeHomeDetailedAnalysisV1.js";
import { buildCourtEdgePlayerEvidenceV1 } from "./courtEdgePlayerEvidenceV1.js";
import { applyHomeDisplayWhyToPick } from "../engines/topProps/homeReasonTextV1.js";

export const PROP_TYPE_DISPLAY_SANITIZE_BUILD =
  "courteedge-proptype-display-sanitize-v1";

function resolvePropType(pick = {}) {
  return (
    normalizePropTypeV1(
      pick.propType || pick.canonicalPropType || pick.stat || "POINTS"
    ) || "POINTS"
  );
}

function scrubRescueText(text = "") {
  return String(text || "")
    .replace(/Side\s*Rescue\s*:\s*/gi, "")
    .replace(/\bKEEP[_\s-]?ORIGINAL\b/gi, "")
    .replace(/\bNO[_\s-]?DECISIVE[_\s-]?RESCUE\b/gi, "")
    .replace(/\bKept original side\b/gi, "")
    .replace(/\bNo stronger opposite-side case was found\.?/gi, "")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*[—–-]+\s*/g, "")
    .replace(/\s*[—–-]\s*$/g, "")
    .trim();
}

function needsAnalysisRebuild(pick = {}, propType) {
  const analysis = pick.homeDetailedAnalysisV1;
  if (!analysis || !analysis.schemaVersion) return true;
  const snapType = normalizePropTypeV1(
    analysis.propSnapshot?.propType || analysis.recentPerformance?.propType
  );
  if (snapType && snapType !== propType) return true;
  if (propType !== "POINTS") {
    const l5 = analysis.recentPerformance?.last5Values ||
      analysis.recentPerformance?.last5Points ||
      [];
    // Heuristic: ASSISTS/REBOUNDS L5 averages in the high teens are almost always
    // points contamination (true AST/REB L5 means are usually much lower).
    if (Array.isArray(l5) && l5.length) {
      const avg = l5.reduce((s, v) => s + Number(v || 0), 0) / l5.length;
      if (avg >= 12) return true;
    }
  }
  if (
    analysis.finalDecision?.sideRescueAction ||
    analysis.finalDecision?.sideRescueDisplay
  ) {
    return true;
  }
  return false;
}

/**
 * Sanitize one Official/Home pick for propType-correct consumer display.
 * Does not change side/line/confidence/risk membership.
 */
export function sanitizePropTypeDisplayOnPick(pick = {}) {
  if (!pick || typeof pick !== "object") return pick;
  const propType = resolvePropType(pick);
  const statLabel = propTypeStatLabel(propType);

  let next = {
    ...pick,
    propType,
    canonicalPropType: propType,
    stat: statLabel,
    marketType:
      pick.marketType ||
      pick.marketKey ||
      (propType === "REBOUNDS"
        ? "player_rebounds"
        : propType === "ASSISTS"
          ? "player_assists"
          : "player_points"),
    sideRescue: {
      action: null,
      productionAuthority: false,
      skippedReason: "NO_PRODUCTION_RESCUE_AUTHORITY",
      version: pick.sideRescue?.version || null,
    },
    sideRescueAction: null,
    sideRescueExplanation: null,
    displaySideRescueAction: null,
    displaySideRescueExplanation: null,
    displayWhy: scrubRescueText(pick.displayWhy),
  };

  if (needsAnalysisRebuild(next, propType) && Array.isArray(next.last5)) {
    const evidence = buildCourtEdgePlayerEvidenceV1({
      ...next,
      propType,
      prop: { ...(next.prop || {}), propType, stat: statLabel, line: next.line },
      last5: next.last5,
      seasonGames: next.bdlSeasonGames || next.seasonGames || next.last5,
      matchupGames: next.matchupGames || [],
      defenseResult: next.defenseResult || {},
      line: next.line,
      playerName: next.player,
    });
    next = {
      ...next,
      courtEdgePlayerEvidence: evidence,
      courtEdgePlayerEvidenceV1: evidence,
    };
    next = attachHomeDetailedAnalysisV1(next, {
      sealed: Boolean(next.immutableOfficial || next.officialSelected),
    });
  } else if (next.homeDetailedAnalysisV1) {
    next = {
      ...next,
      homeDetailedAnalysisV1: {
        ...next.homeDetailedAnalysisV1,
        propSnapshot: {
          ...(next.homeDetailedAnalysisV1.propSnapshot || {}),
          propType,
          stat: statLabel,
        },
        recentPerformance: {
          ...(next.homeDetailedAnalysisV1.recentPerformance || {}),
          propType,
        },
        finalDecision: {
          ...(next.homeDetailedAnalysisV1.finalDecision || {}),
          sideRescueAction: null,
          sideRescueDisplay: null,
          sideRescueProductionAuthority: false,
        },
      },
    };
  }

  next = applyHomeDisplayWhyToPick(next);
  next.displayWhy = scrubRescueText(next.displayWhy);
  if (next.decisionIntelligence) {
    next.decisionIntelligence = {
      ...next.decisionIntelligence,
      simpleExplanation: scrubRescueText(
        next.decisionIntelligence.simpleExplanation || next.displayWhy
      ),
    };
  }
  next.propTypeDisplaySanitizeBuild = PROP_TYPE_DISPLAY_SANITIZE_BUILD;
  return next;
}

export function sanitizePropTypeDisplayOnList(list = []) {
  if (!Array.isArray(list)) return list;
  return list.map((p) => sanitizePropTypeDisplayOnPick(p));
}

export function sanitizePropTypeDisplayOnBoard(board = {}) {
  if (!board || typeof board !== "object") return board;
  const keys = [
    "bestSixDisplayTodayWNBA",
    "bestSixDisplayTomorrowWNBA",
    "bestSixDisplayWNBA",
    "bestSixWNBA",
    "bestSixDisplayTodayNBA",
    "bestSixDisplayTomorrowNBA",
    "bestSixDisplayNBA",
    "bestSixNBA",
    "controlledBestBoard",
    "selectedPropsTodayWNBA",
    "selectedPropsTomorrowWNBA",
    "officialMembership",
    "topWNBAProps",
    "topNBAProps",
    "topProps",
  ];
  const next = { ...board };
  for (const key of keys) {
    if (Array.isArray(next[key])) {
      next[key] = sanitizePropTypeDisplayOnList(next[key]);
    }
  }
  if (Array.isArray(next.games)) {
    next.games = next.games.map((g) => {
      if (!g || typeof g !== "object") return g;
      return {
        ...g,
        picks: sanitizePropTypeDisplayOnList(g.picks),
        controlledBestSix: sanitizePropTypeDisplayOnList(g.controlledBestSix),
      };
    });
  }
  next.propTypeDisplaySanitizeBuild = PROP_TYPE_DISPLAY_SANITIZE_BUILD;
  return next;
}
