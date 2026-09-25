/**
 * Attach independent REB/AST freeze rows onto Home display arrays.
 * Does not write Product Truth or remint PTS Official membership.
 */
import { getShadowSlate } from "./courtEdgeMarketShadowStoreV1.js";
import { isRebAstProductionEra } from "../engines/courtEdgeEraV1.js";

export const HOME_REB_AST_ATTACH_BUILD = "courteedge-home-reb-ast-attach-v1";

function isRebAstPick(pick = {}) {
  const pt = String(
    pick.propType || pick.canonicalPropType || pick.stat || pick.market || ""
  ).toUpperCase();
  return (
    pick.independentRebAst === true ||
    pt.includes("REB") ||
    pt.includes("ASSIST") ||
    pt === "AST"
  );
}

function isPtsPick(pick = {}) {
  return !isRebAstPick(pick);
}

function hollowUnder(row = {}) {
  const side = String(row.side || "").toUpperCase();
  const proj = Number(row.projection);
  if (row.postgame?.hollowUnder === true) return true;
  if (!side.startsWith("UNDER")) return false;
  if (row.invalid === true) return true;
  return !Number.isFinite(proj) || proj === 0;
}

export function independentRebAstRowToHomePick(
  row = {},
  { slateDateCT, dayBucket, dateLabel } = {}
) {
  if (!row || row.invalid === true || hollowUnder(row)) return null;
  const side = String(row.side || "").toUpperCase();
  const line = Number(row.line);
  const projection = Number(row.projection);
  if (!side || !Number.isFinite(line) || !Number.isFinite(projection)) return null;
  const market = String(row.market || "").toUpperCase().includes("REB")
    ? "REBOUNDS"
    : "ASSISTS";
  const p = Number(row.p ?? row.selectedProbability);
  const conf = Number.isFinite(p) ? Math.round(p * 100) : null;
  return {
    canonicalPropId:
      row.immutableId ||
      `reb-ast|${slateDateCT}|${row.player}|${market}|${line}|${side}`,
    player: row.player,
    playerName: row.player,
    team: row.team || null,
    opponent: row.opponent || null,
    matchup: row.matchup || null,
    league: "WNBA",
    propType: market,
    canonicalPropType: market,
    stat: market === "REBOUNDS" ? "Rebounds" : "Assists",
    side,
    pick: side,
    line,
    sealedLine: line,
    projection,
    projectionGap: row.projectionGap ?? null,
    gapBand: row.gapBand || null,
    historicallySupportedBand: row.historicallySupportedBand === true,
    predictedProbability: Number.isFinite(p) ? p : null,
    modelWinProbability: Number.isFinite(p) ? p : null,
    officialRankScore: Number.isFinite(p) ? p : null,
    decisionScoreV2: Number.isFinite(p) ? p : null,
    displayConfidence: conf,
    confidence: conf,
    pOver: row.pOver ?? null,
    pUnder: row.pUnder ?? null,
    bookCount: row.bookCount ?? null,
    expectedMinutes: row.expectedMinutes ?? null,
    commenceTime: row.startIso || null,
    startTimeDisplay: row.startCT || null,
    slateDate: slateDateCT,
    gameDate: slateDateCT,
    resultsSlateDate: slateDateCT,
    dayBucket: dayBucket || null,
    dateLabel: dateLabel || null,
    officialSelected: false,
    immutableOfficial: false,
    productTruthUntouched: true,
    independentRebAst: true,
    variableBoardSize: true,
    trackingType: "REB_AST_PRODUCTION",
    membership: "REB_AST_PRODUCTION",
    trackingEligibility: "REB_AST_PRODUCTION",
    label: row.label || "COURTEDGE REB/AST PRODUCTION — PTS LOCK UNTOUCHED",
    freezeHash: row.freezeHash || null,
    modelId: row.modelId || null,
    modelVersion: row.modelVersion || null,
  };
}

export function listIndependentRebAstHomePicks(
  slateDateCT,
  { dayBucket, dateLabel } = {}
) {
  const date = String(slateDateCT || "").slice(0, 10);
  if (!isRebAstProductionEra(date)) return [];
  const slate = getShadowSlate(date);
  if (!slate) return [];
  const rows = [...(slate.reb?.rows || []), ...(slate.ast?.rows || [])];
  return rows
    .map((row) =>
      independentRebAstRowToHomePick(row, {
        slateDateCT: date,
        dayBucket,
        dateLabel,
      })
    )
    .filter(Boolean)
    .map((pick) => ({ ...pick, freezeHash: slate.freezeHash || null }));
}

export function withIndependentRebAstHomeBoard(home = {}) {
  const today = String(home.todayLocalDate || "").slice(0, 10);
  const tomorrow = String(home.tomorrowLocalDate || "").slice(0, 10);
  const todayRows = listIndependentRebAstHomePicks(today, {
    dayBucket: "TODAY",
    dateLabel: "Today",
  });
  const tomorrowRows = listIndependentRebAstHomePicks(tomorrow, {
    dayBucket: "TOMORROW",
    dateLabel: "Tomorrow",
  });

  const priorFallback = home.homeTodayIsPriorDayFallback === true;
  const todayPtsSource = Array.isArray(home.homeTodayBest6) && home.homeTodayBest6.length
    ? home.homeTodayBest6
    : Array.isArray(home.homeTodayProductionBoard) && home.homeTodayProductionBoard.length
      ? home.homeTodayProductionBoard
      : Array.isArray(home.homeTodayDisplayOfficial)
        ? home.homeTodayDisplayOfficial
        : [];
  const todayPts =
    priorFallback && todayRows.length ? [] : todayPtsSource.filter(isPtsPick);
  const mergedToday = [...todayPts, ...todayRows];

  const tomorrowPts = (
    Array.isArray(home.tomorrowBest6) && home.tomorrowBest6.length
      ? home.tomorrowBest6
      : Array.isArray(home.tomorrowOfficial)
        ? home.tomorrowOfficial
        : []
  ).filter(isPtsPick);
  const mergedTomorrow = [...tomorrowPts, ...tomorrowRows];

  return {
    ...home,
    homeRebAstAttachBuild: HOME_REB_AST_ATTACH_BUILD,
    productTruthUntouched: true,
    variableBoardSize: true,
    homeTodayDisplayOfficial: mergedToday.length
      ? mergedToday
      : home.homeTodayDisplayOfficial,
    homeTodayBest6: mergedToday,
    homeTodayProductionBoard: mergedToday,
    tomorrowBest6: mergedTomorrow,
    tomorrowOfficial: mergedTomorrow,
    homeTodayIsPriorDayFallback: priorFallback && todayRows.length === 0,
    homeTodayDisplaySlateDate: todayRows.length
      ? today
      : home.homeTodayDisplaySlateDate,
    independentRebAstAttached: {
      today: todayRows.length,
      tomorrow: tomorrowRows.length,
      freezeHashToday: getShadowSlate(today)?.freezeHash || null,
      freezeHashTomorrow: getShadowSlate(tomorrow)?.freezeHash || null,
    },
  };
}
