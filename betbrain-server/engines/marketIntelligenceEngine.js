function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O") return "OVER";
  if (raw === "UNDER" || raw === "U") return "UNDER";
  return "";
}

/**
 * Canonical WNBA/NBA points line movement:
 * line down hurts Over; line up hurts Under.
 */
export function computeLineMovementAgainstSide(pickSide = "", lineDelta = 0) {
  const side = normalizeSide(pickSide);
  const delta = num(lineDelta);
  if (!side || delta === 0) return false;
  if (side === "OVER") return delta < -0.5;
  if (side === "UNDER") return delta > 0.5;
  return false;
}

export function buildMarketIntelligence({
  prop = {},
  marketSnapshot = {},
  side = "",
  volumeProfile = {},
} = {}) {
  const pickSide = normalizeSide(side);
  const openingLine = num(
    marketSnapshot.openingLine ?? prop.openingLine
  );
  const currentLine = num(
    marketSnapshot.currentLine ??
      marketSnapshot.bookLine ??
      prop.line ??
      prop.sportsbookLine
  );
  const consensusLine = num(prop.consensusLine ?? currentLine);
  const bookCount = num(prop.bookCount);
  const consensusBookCount = num(prop.consensusBookCount);
  const lineSpread = num(prop.lineSpread);
  const marketQuality = num(prop.marketQuality);

  const lineDelta =
    openingLine > 0 && currentLine > 0
      ? Number((currentLine - openingLine).toFixed(1))
      : 0;

  const consensusDelta =
    consensusLine > 0 && currentLine > 0
      ? Number((currentLine - consensusLine).toFixed(1))
      : 0;

  const signals = [];
  const supportReasons = [];
  const dangerReasons = [];
  let dangerPressure = 0;
  let supportScore = 0;
  let resistanceScore = 0;

  const weakVolume =
    volumeProfile.volumeStability === "UNSTABLE" ||
    volumeProfile.volumeStability === "VOLATILE" ||
    num(volumeProfile.recentFGA) < 10;

  if (lineDelta !== 0 && pickSide) {
    const movedAgainstOver = lineDelta < -0.5;
    const movedAgainstUnder = lineDelta > 0.5;

    if (pickSide === "OVER" && movedAgainstOver) {
      signals.push("line_moved_against_over");
      dangerReasons.push(
        `Line steamed up ${lineDelta > 0 ? "+" : ""}${lineDelta} vs open`
      );
      dangerPressure += weakVolume ? 0.14 : 0.08;
      resistanceScore += weakVolume ? 12 : 6;
    }

    if (pickSide === "UNDER" && movedAgainstUnder) {
      signals.push("line_moved_against_under");
      dangerReasons.push(
        `Line steamed down ${lineDelta} vs open`
      );
      dangerPressure += weakVolume ? 0.14 : 0.08;
      resistanceScore += weakVolume ? 12 : 6;
    }

    if (pickSide === "OVER" && lineDelta <= -0.5) {
      signals.push("opening_line_value_over");
      supportReasons.push(
        `Line dropped ${Math.abs(lineDelta)} from open — value on over`
      );
      supportScore += 5;
    }

    if (pickSide === "UNDER" && lineDelta >= 0.5) {
      signals.push("opening_line_value_under");
      supportReasons.push(
        `Line rose +${lineDelta} from open — value on under`
      );
      supportScore += 5;
    }
  }

  if (bookCount >= 5 && consensusBookCount >= 4 && marketQuality >= 60) {
    signals.push("strong_market_consensus");
    supportReasons.push(
      `Strong market (${bookCount} books, ${consensusBookCount} on line)`
    );
    supportScore += 6;
  }

  if (bookCount <= 1) {
    signals.push("one_book_market");
    dangerReasons.push("One-book market — thin pricing");
    dangerPressure += 0.12;
    resistanceScore += 8;
  } else if (bookCount === 2 && marketQuality < 50) {
    signals.push("thin_market");
    dangerReasons.push("Thin two-book market");
    dangerPressure += 0.06;
    resistanceScore += 4;
  }

  if (lineSpread >= 2) {
    signals.push("wide_line_spread");
    dangerReasons.push(`Wide line spread (${lineSpread}) across books`);
    dangerPressure += 0.08;
    resistanceScore += 5;
  }

  if (Math.abs(consensusDelta) >= 1 && pickSide === "OVER" && consensusDelta > 0) {
    signals.push("above_consensus");
    dangerReasons.push(`Current line ${consensusDelta} above consensus`);
    dangerPressure += 0.05;
    resistanceScore += 3;
  }

  if (Math.abs(consensusDelta) >= 1 && pickSide === "UNDER" && consensusDelta < 0) {
    signals.push("below_consensus");
    dangerReasons.push(`Current line ${Math.abs(consensusDelta)} below consensus`);
    dangerPressure += 0.05;
    resistanceScore += 3;
  }

  return {
    openingLine,
    currentLine,
    consensusLine,
    lineDelta,
    consensusDelta,
    bookCount,
    consensusBookCount,
    lineSpread,
    marketQuality,
    signals,
    supportReasons,
    dangerReasons,
    dangerPressure: clamp(dangerPressure, 0, 0.35),
    supportScore,
    resistanceScore,
    lineMovementAgainstSide: computeLineMovementAgainstSide(pickSide, lineDelta),
    lineMovedAgainstSide: computeLineMovementAgainstSide(pickSide, lineDelta),
  };
}
