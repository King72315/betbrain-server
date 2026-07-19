/**
 * CourtEdge Engine Expansion — Line Movement / Closing-Line-Value Engine.
 *
 * Reads opening/selected/sealed/current lines and prices as-is. NEVER
 * rewrites or "corrects" a line — every stage of the line lifecycle is
 * reported verbatim in rawValues so downstream auditing can see exactly
 * what the market did.
 *
 * Directional market movement (did the number move toward Over or Under)
 * is kept separate from line VALUE (did the bettor get a better or worse
 * number than where the market settled).
 */
import {
  numOrNull,
  clamp,
  first,
  baseEngineSignal,
  emptyEngineSignal,
  contributionsFromSignal,
  ENGINE_SIGNAL_QUALITY,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const LINE_MOVEMENT_CLV_ENGINE = "lineMovementClvEngine";

/** American odds -> implied probability. Returns null for missing/invalid odds. */
function americanToImpliedProb(odds) {
  const o = numOrNull(odds);
  if (o === null || o === 0) return null;
  if (o > 0) return Number((100 / (o + 100)).toFixed(4));
  return Number((-o / (-o + 100)).toFixed(4));
}

function movementDirection(delta, epsilon = 0.25) {
  if (delta === null) return null;
  if (delta > epsilon) return "UP";
  if (delta < -epsilon) return "DOWN";
  return "FLAT";
}

/** Does a lean toward OVER/UNDER agree with a move UP/DOWN in the line? */
function movedToward(side, direction) {
  if (!side || !direction || direction === "FLAT") return null;
  if (side === "OVER") return direction === "UP";
  if (side === "UNDER") return direction === "DOWN";
  return null;
}

function classifyMovementReliability({ bookCount, lineDispersion }) {
  const books = numOrNull(bookCount);
  const dispersion = numOrNull(lineDispersion);
  if (books === null && dispersion === null) return "UNKNOWN";
  if (books !== null && books <= 1) return "LOW";
  if (dispersion !== null && dispersion >= 1.5) return "LOW";
  if (books !== null && books >= 5 && (dispersion === null || dispersion < 0.75)) return "HIGH";
  if (books !== null && books >= 3) return "MODERATE";
  return "LOW";
}

export function evaluateLineMovementClv(ctx = {}) {
  const openingLine = numOrNull(ctx.openingLine);
  const selectedLine = numOrNull(ctx.selectedLine);
  const sealedLine = numOrNull(ctx.sealedLine);
  const currentLine = numOrNull(ctx.currentLine ?? ctx.line);
  const bookCount = numOrNull(ctx.bookCount);
  const lineDispersion = numOrNull(ctx.lineDispersion);

  const openingOverPrice = numOrNull(ctx.openingOverPrice);
  const openingUnderPrice = numOrNull(ctx.openingUnderPrice);
  const currentOverPrice = numOrNull(ctx.currentOverPrice);
  const currentUnderPrice = numOrNull(ctx.currentUnderPrice);

  const organicModelSide = String(ctx.organicModelSide || "").toUpperCase() || null;
  const finalSide = String(ctx.finalSide || "").toUpperCase() || null;

  const rawValues = {
    openingLine,
    selectedLine,
    sealedLine,
    currentLine,
    openingOverPrice,
    openingUnderPrice,
    currentOverPrice,
    currentUnderPrice,
    bookCount,
    lineDispersion,
    organicModelSide,
    finalSide,
  };

  const haveAnyLine =
    openingLine !== null || selectedLine !== null || sealedLine !== null || currentLine !== null;

  if (!haveAnyLine) {
    return emptyEngineSignal(LINE_MOVEMENT_CLV_ENGINE, "no_line_data_provided", { rawValues });
  }

  // --- Directional movement (opening -> current) ---
  const lineDelta =
    openingLine !== null && currentLine !== null
      ? Number((currentLine - openingLine).toFixed(2))
      : null;
  const movement = movementDirection(lineDelta);

  // --- Price deltas (opening -> current), implied-probability terms ---
  const overPriceDelta =
    openingOverPrice !== null && currentOverPrice !== null
      ? Number((currentOverPrice - openingOverPrice).toFixed(1))
      : null;
  const underPriceDelta =
    openingUnderPrice !== null && currentUnderPrice !== null
      ? Number((currentUnderPrice - openingUnderPrice).toFixed(1))
      : null;

  const openingOverProb = americanToImpliedProb(openingOverPrice);
  const currentOverProb = americanToImpliedProb(currentOverPrice);
  const openingUnderProb = americanToImpliedProb(openingUnderPrice);
  const currentUnderProb = americanToImpliedProb(currentUnderPrice);

  const overProbShift =
    openingOverProb !== null && currentOverProb !== null
      ? Number((currentOverProb - openingOverProb).toFixed(4))
      : null;
  const underProbShift =
    openingUnderProb !== null && currentUnderProb !== null
      ? Number((currentUnderProb - openingUnderProb).toFixed(4))
      : null;

  // --- Market lean toward Over/Under (side-agnostic, absolute) ---
  // Convention: a rising prop total/line reflects the market pricing MORE
  // production as likely (Over lean); a falling line reflects LESS
  // production as likely (Under lean). Price shifts corroborate this when
  // Over's implied probability rose relative to Under's.
  let leanFromLine = 0;
  if (lineDelta !== null) {
    leanFromLine = clamp(lineDelta / 2, -1, 1);
  }
  let leanFromPrice = 0;
  let priceLeanAvailable = false;
  if (overProbShift !== null && underProbShift !== null) {
    leanFromPrice = clamp((overProbShift - underProbShift) * 4, -1, 1);
    priceLeanAvailable = true;
  } else if (overProbShift !== null) {
    leanFromPrice = clamp(overProbShift * 4, -1, 1);
    priceLeanAvailable = true;
  } else if (underProbShift !== null) {
    leanFromPrice = clamp(-underProbShift * 4, -1, 1);
    priceLeanAvailable = true;
  }

  const lineWeight = lineDelta !== null ? 0.65 : 0;
  const priceWeight = priceLeanAvailable ? 0.35 : 0;
  const totalWeight = lineWeight + priceWeight;
  const normalizedSignal =
    totalWeight > 0
      ? clamp(
          (leanFromLine * lineWeight + leanFromPrice * priceWeight) / totalWeight,
          -1,
          1
        )
      : 0;

  // --- Movement relative to organic/final side ---
  const movedTowardOriginal = movedToward(organicModelSide, movement);
  const movedTowardFinal = movedToward(finalSide, movement);
  const marketMovedAgainstOriginal = movedTowardOriginal === false;
  const marketMovedAgainstFinal = movedTowardFinal === false;
  const marketMovedTowardOriginal = movedTowardOriginal === true;
  const marketMovedTowardFinal = movedTowardFinal === true;

  // --- Closing line value: did we get a better number than the terminal one? ---
  // Positive sealedLineValue = the sealed number was more favorable to the
  // organic side than the current/closing number turned out to be.
  let sealedLineValue = null;
  if (sealedLine !== null && currentLine !== null && organicModelSide) {
    sealedLineValue =
      organicModelSide === "OVER"
        ? Number((currentLine - sealedLine).toFixed(2))
        : Number((sealedLine - currentLine).toFixed(2));
  }
  const closingLineValueDirection =
    sealedLineValue === null
      ? null
      : sealedLineValue > 0.25
        ? "POSITIVE"
        : sealedLineValue < -0.25
          ? "NEGATIVE"
          : "FLAT";

  // How much harder is clearing the CURRENT line vs the line actually taken,
  // from the final side's perspective. Positive = harder now.
  let currentLineDifficulty = null;
  const takenLine = first(selectedLine, sealedLine, openingLine);
  if (takenLine !== null && currentLine !== null && finalSide) {
    currentLineDifficulty =
      finalSide === "OVER"
        ? Number((currentLine - takenLine).toFixed(2))
        : Number((takenLine - currentLine).toFixed(2));
  }

  const movementReliability = classifyMovementReliability({ bookCount, lineDispersion });
  const staleMarket =
    (bookCount !== null && bookCount < 2) ||
    (lineDispersion !== null && lineDispersion >= 2) ||
    (openingLine !== null && currentLine === null);

  const sampleSize = bookCount !== null ? bookCount : 0;
  let quality = ENGINE_SIGNAL_QUALITY.UNAVAILABLE;
  if (lineDelta !== null || priceLeanAvailable) {
    if (movementReliability === "HIGH") quality = ENGINE_SIGNAL_QUALITY.STRONG;
    else if (movementReliability === "MODERATE") quality = ENGINE_SIGNAL_QUALITY.USABLE;
    else if (movementReliability === "LOW") quality = ENGINE_SIGNAL_QUALITY.EARLY;
    else quality = ENGINE_SIGNAL_QUALITY.DEVELOPING;
  }

  const reasons = [];
  if (movement && movement !== "FLAT") {
    reasons.push(`Line moved ${movement} by ${Math.abs(lineDelta).toFixed(1)} (opening -> current).`);
  }
  if (marketMovedAgainstFinal) {
    reasons.push(`Market moved against final side (${finalSide}).`);
  } else if (marketMovedTowardFinal) {
    reasons.push(`Market moved with final side (${finalSide}).`);
  }
  if (closingLineValueDirection === "NEGATIVE") {
    reasons.push(`Closing line value negative (${sealedLineValue}).`);
  } else if (closingLineValueDirection === "POSITIVE") {
    reasons.push(`Closing line value positive (${sealedLineValue}).`);
  }
  if (staleMarket) {
    reasons.push("Thin book count or missing current line — market may be stale.");
  }

  let confidenceAdjustment = 0;
  let riskAdjustment = RISK_ADJUSTMENT.NEUTRAL;
  if (!staleMarket && finalSide) {
    if (marketMovedAgainstFinal) {
      confidenceAdjustment -= movementReliability === "HIGH" ? 6 : movementReliability === "MODERATE" ? 4 : 2;
      riskAdjustment = movementReliability === "HIGH" ? RISK_ADJUSTMENT.ELEVATE : RISK_ADJUSTMENT.MONITOR;
    } else if (marketMovedTowardFinal) {
      confidenceAdjustment += movementReliability === "HIGH" ? 4 : movementReliability === "MODERATE" ? 2 : 1;
    }
    if (closingLineValueDirection === "NEGATIVE") {
      confidenceAdjustment -= 2;
      if (riskAdjustment === RISK_ADJUSTMENT.NEUTRAL) riskAdjustment = RISK_ADJUSTMENT.MONITOR;
    } else if (closingLineValueDirection === "POSITIVE") {
      confidenceAdjustment += 2;
    }
  } else if (staleMarket) {
    riskAdjustment = RISK_ADJUSTMENT.MONITOR;
  }
  confidenceAdjustment = clamp(Math.round(confidenceAdjustment), -8, 8);

  const { overContribution, underContribution } = contributionsFromSignal(normalizedSignal);

  return baseEngineSignal({
    engine: LINE_MOVEMENT_CLV_ENGINE,
    available: true,
    source: "internal_market_snapshot",
    sourceIds: ctx.sourceIds || {},
    fetchedAt: ctx.fetchedAt || null,
    sampleSize,
    quality,
    stale: staleMarket,
    fallbackUsed: takenLine !== null && takenLine !== selectedLine && selectedLine === null,
    rawValues: {
      ...rawValues,
      overPriceDelta,
      underPriceDelta,
      openingOverProb,
      currentOverProb,
      openingUnderProb,
      currentUnderProb,
      overProbShift,
      underProbShift,
    },
    normalizedSignal,
    overContribution,
    underContribution,
    confidenceAdjustment,
    riskAdjustment,
    reason: reasons.length ? reasons.join(" ") : "Line movement evaluated with no strong directional signal.",
    units: "line_points",

    lineDelta,
    movement,
    overPriceDelta,
    underPriceDelta,
    marketMovedTowardOriginal,
    marketMovedAgainstOriginal,
    marketMovedTowardFinal,
    marketMovedAgainstFinal,
    sealedLineValue,
    closingLineValueDirection,
    currentLineDifficulty,
    movementReliability,
    staleMarket,
  });
}
