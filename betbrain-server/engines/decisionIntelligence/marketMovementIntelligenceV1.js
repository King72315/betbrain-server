/**
 * Market Movement Intelligence v1 — line movement, edge shrink, stale line detection.
 */
import {
  computeLineMovementAgainstSide,
  interpretLineMovement,
} from "../marketIntelligenceEngine.js";

export const MARKET_MOVEMENT_VERSION = "market-movement-intelligence-v1";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

export function evaluateMarketMovementIntelligence(pick = {}, options = {}) {
  const card = options.dataCard || pick.wnbaDataCard || {};
  const side = normalizeSide(options.side || pick.side || pick.pick);
  const market = pick.marketIntelligence || options.marketIntelligence || {};
  const line = num(pick.line ?? card.bookLine ?? card.currentLine);
  const openingLine = num(market.openingLine ?? pick.openingLine ?? card.openingLine);
  const currentLine = num(market.currentLine ?? pick.currentLine ?? card.currentLine ?? line);
  const lineDelta =
    market.lineDelta != null
      ? num(market.lineDelta)
      : openingLine > 0 && currentLine > 0
        ? Number((currentLine - openingLine).toFixed(1))
        : 0;
  const bookCount = num(pick.bookCount ?? card.bookCount ?? market.bookCount);
  const projection = num(pick.projection ?? card.projection?.projection);
  const reasons = [];

  const movementInterp = interpretLineMovement(side, lineDelta);
  const movedAgainst = computeLineMovementAgainstSide(side, lineDelta);
  const edgeAtOpen =
    side === "OVER" ? num(projection) - openingLine : openingLine - num(projection);
  const edgeNow = side === "OVER" ? num(projection) - currentLine : currentLine - num(projection);

  let movement = "flat";
  if (lineDelta <= -0.5) movement = "down";
  else if (lineDelta >= 0.5) movement = "up";

  const staleLineSuspected =
    bookCount > 0 &&
    bookCount <= 2 &&
    Math.abs(lineDelta) >= 1.5;

  let bookConsensus = "UNKNOWN";
  if (bookCount >= 5) bookConsensus = "STRONG";
  else if (bookCount >= 3) bookConsensus = "MODERATE";
  else if (bookCount >= 1) bookConsensus = "THIN";

  let sideImpact = "NEUTRAL";
  let marketWarning = false;

  if (movedAgainst) {
    marketWarning = true;
    reasons.push(movementInterp.lineMovementInterpretation || "Line moved against pick side.");
    sideImpact = side === "OVER" ? "UNDER" : "OVER";
  } else if (movementInterp.lineMovedForPickSide) {
    reasons.push(movementInterp.lineMovementInterpretation || "Line moved for pick side.");
    sideImpact = side || "NEUTRAL";
  }

  if (edgeAtOpen >= 3 && edgeNow < 1.5) {
    marketWarning = true;
    reasons.push(`Edge shrank from ${edgeAtOpen.toFixed(1)} to ${edgeNow.toFixed(1)}.`);
    if (side === "OVER" && edgeNow <= 0) sideImpact = "UNDER";
    if (side === "UNDER" && edgeNow <= 0) sideImpact = "OVER";
  }

  if (staleLineSuspected) {
    reasons.push("Thin book count with large line move — stale line suspected.");
  }

  if (bookConsensus === "THIN") {
    marketWarning = true;
    reasons.push("Low book count — market quality thin.");
  }

  return {
    version: MARKET_MOVEMENT_VERSION,
    openingLine: openingLine > 0 ? openingLine : null,
    currentLine: currentLine > 0 ? currentLine : null,
    movement,
    lineDelta,
    edgeAtOpen: Number.isFinite(edgeAtOpen) ? Number(edgeAtOpen.toFixed(2)) : null,
    edgeNow: Number.isFinite(edgeNow) ? Number(edgeNow.toFixed(2)) : null,
    marketWarning,
    staleLineSuspected,
    bookConsensus,
    sideImpact,
    reasons: reasons.slice(0, 6),
  };
}
