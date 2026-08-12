/**
 * playerPropMarketModelV1
 */
import { MARKET_MODEL_VERSION } from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function buildPlayerPropMarketModelV1(pick = {}) {
  const bookCount =
    num(pick.bookCount) ??
    num(pick.books) ??
    (Array.isArray(pick.bookLines) ? pick.bookLines.length : null) ??
    num(pick.market?.bookCount);

  const consensusLine =
    num(pick.consensusLine) ??
    num(pick.line) ??
    num(pick.selectedLine);
  const openingLine = num(pick.openingLine) ?? num(pick.openLine);
  const currentLine = num(pick.currentLine) ?? consensusLine;
  const lineRange =
    num(pick.lineRange) ??
    (pick.lineHigh != null && pick.lineLow != null
      ? Number(pick.lineHigh) - Number(pick.lineLow)
      : null);

  const lineMovement =
    openingLine != null && currentLine != null
      ? currentLine - openingLine
      : num(pick.lineMovement);

  const overPrice = num(pick.overPrice) ?? num(pick.overOdds);
  const underPrice = num(pick.underPrice) ?? num(pick.underOdds);

  // Unknown bookCount → null (missing ≠ thin-book 40)
  let marketQualityScore = null;
  if (bookCount != null) {
    if (bookCount >= 5) marketQualityScore = 92;
    else if (bookCount >= 3) marketQualityScore = 78;
    else if (bookCount === 2) marketQualityScore = 58;
    else marketQualityScore = 38;
    if (lineRange != null && lineRange > 1.5) marketQualityScore -= 15;
    if (lineRange != null && lineRange > 2.5) marketQualityScore -= 10;
    if (pick.marketFresh === false || pick.staleMarket === true) {
      marketQualityScore -= 20;
    }
    marketQualityScore = clamp(Math.round(marketQualityScore), 0, 100);
  }

  const side = String(pick.side || pick.pick || "").toUpperCase();
  const projection = num(pick.projection ?? pick.projectedPoints);
  let movementTowardModel = null;
  let movementAgainstModel = null;
  if (lineMovement != null && projection != null && currentLine != null) {
    // line rising = more points expected by market
    if (side.startsWith("OVER")) {
      movementTowardModel = lineMovement < 0; // line down helps Over
      movementAgainstModel = lineMovement > 0;
    } else if (side.startsWith("UNDER")) {
      movementTowardModel = lineMovement > 0;
      movementAgainstModel = lineMovement < 0;
    }
  }

  return {
    version: MARKET_MODEL_VERSION,
    bookCount,
    consensusLine,
    lineRange,
    openingLine,
    currentLine,
    lineMovement,
    movementTowardModel,
    movementAgainstModel,
    overPrice,
    underPrice,
    marketAge: pick.marketAge ?? null,
    marketFreshness: pick.marketFreshness ?? pick.marketTimestamp ?? null,
    bookDisagreement: lineRange,
    marketQualityScore,
    singleBook: bookCount != null && bookCount < 2,
    theoreticalMin: 0,
    theoreticalMax: 100,
    missingness: {
      bookCount: bookCount == null,
      openingLine: openingLine == null,
      marketQualityUnknown: marketQualityScore == null,
    },
  };
}
