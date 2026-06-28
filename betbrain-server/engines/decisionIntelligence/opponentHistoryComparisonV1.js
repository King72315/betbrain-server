/**
 * Opponent History Comparison v1 — recent form vs opponent matchup history.
 * 0 opponent games = NO_HISTORY (neutral, no penalty — same principle as availability ACTIVE fix).
 */
export const OPPONENT_HISTORY_COMPARISON_VERSION = "opponent-history-comparison-v1";

const MAX_OPPONENT_GAMES = 5;
const MAX_RECENT_GAMES = 5;

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(values = []) {
  const nums = values.map((v) => num(v)).filter((v) => v != null);
  if (!nums.length) return null;
  return Number((nums.reduce((s, v) => s + v, 0) / nums.length).toFixed(2));
}

function volatility(values = []) {
  const nums = values.map((v) => num(v)).filter((v) => v != null);
  if (nums.length < 2) return null;
  const mean = nums.reduce((s, v) => s + v, 0) / nums.length;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / nums.length;
  const sd = Math.sqrt(variance);
  if (sd >= 6) return "high";
  if (sd >= 3.5) return "moderate";
  return "low";
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function hitRateVsLine(pointsList = [], line = 0, side = "") {
  const cleanLine = num(line);
  if (cleanLine == null || !pointsList.length) return null;
  const hits = pointsList.filter((pts) => {
    const p = num(pts);
    if (p == null) return false;
    if (side === "OVER") return p > cleanLine;
    if (side === "UNDER") return p < cleanLine;
    return false;
  }).length;
  return Number(((hits / pointsList.length) * 100).toFixed(1));
}

function sideSupportFromAvg(avgPoints, line) {
  const cleanAvg = num(avgPoints);
  const cleanLine = num(line);
  if (cleanAvg == null || cleanLine == null) return "NEUTRAL";
  const gap = cleanAvg - cleanLine;
  if (gap >= 1.5) return "OVER";
  if (gap <= -1.5) return "UNDER";
  return "NEUTRAL";
}

function sampleStatusFromCount(count = 0) {
  if (count <= 0) return "NONE";
  if (count >= 5) return "STRONG_SAMPLE";
  if (count >= 3) return "USABLE";
  return "SMALL_SAMPLE";
}

function sampleWeight(status = "") {
  switch (status) {
    case "STRONG_SAMPLE":
      return 1;
    case "USABLE":
      return 0.55;
    case "SMALL_SAMPLE":
      return 0.25;
    default:
      return 0;
  }
}

function normalizeGame(game = {}) {
  return {
    date: game.date || null,
    points: num(game.points),
    minutes: num(game.minutes),
    fga: num(game.fga),
    fta: num(game.fta),
    threePa: num(game.threePa ?? game.three_pa ?? game.fg3a),
  };
}

export function resolveRecentFormGames(pick = {}, options = {}) {
  if (Array.isArray(options.last5) && options.last5.length) {
    return options.last5.slice(0, MAX_RECENT_GAMES).map(normalizeGame);
  }
  if (Array.isArray(pick.last5) && pick.last5.length && typeof pick.last5[0] === "object") {
    return pick.last5.slice(0, MAX_RECENT_GAMES).map(normalizeGame);
  }
  const card = options.dataCard || pick.wnbaDataCard || {};
  const pointsList = card.last5?.pointsList || [];
  if (pointsList.length) {
    return pointsList.slice(0, MAX_RECENT_GAMES).map((points) => normalizeGame({ points }));
  }
  return [];
}

export function resolveOpponentHistoryGames(pick = {}, options = {}) {
  if (Array.isArray(options.matchupGames) && options.matchupGames.length) {
    return options.matchupGames.slice(0, MAX_OPPONENT_GAMES).map(normalizeGame);
  }
  const card = options.dataCard || pick.wnbaDataCard || {};
  const recovery = card.dataRecovery || {};
  const probeGames =
    recovery.context?.matchupProbe?.matchupGames ||
    recovery.matchupProbe?.matchupGames ||
    card.dataIntegrity?.meta?.probe?.matchupGames ||
    null;
  if (Array.isArray(probeGames) && probeGames.length) {
    return probeGames.slice(0, MAX_OPPONENT_GAMES).map(normalizeGame);
  }
  const fromPick = pick.matchupGames || recovery.matchupGames || [];
  if (Array.isArray(fromPick) && fromPick.length) {
    return fromPick.slice(0, MAX_OPPONENT_GAMES).map(normalizeGame);
  }
  return [];
}

function buildFormBlock(games = [], line = 0) {
  const points = games.map((g) => g.points).filter((v) => v != null);
  const minutes = games.map((g) => g.minutes).filter((v) => v != null);
  const fga = games.map((g) => g.fga).filter((v) => v != null);
  const fta = games.map((g) => g.fta).filter((v) => v != null);
  const threePa = games.map((g) => g.threePa).filter((v) => v != null);
  const pointsAvg = avg(points);
  const overHit = hitRateVsLine(points, line, "OVER");
  const underHit = hitRateVsLine(points, line, "UNDER");
  const sideSupport = sideSupportFromAvg(pointsAvg, line);
  const reasons = [];
  if (pointsAvg != null) {
    reasons.push(`Recent ${pointsAvg} pts avg over ${games.length} games.`);
  }
  if (sideSupport === "OVER") reasons.push("Recent form leans Over vs line.");
  if (sideSupport === "UNDER") reasons.push("Recent form leans Under vs line.");
  return {
    gamesUsed: games.length,
    pointsAvg,
    minutesAvg: avg(minutes),
    fgaAvg: avg(fga),
    threePaAvg: avg(threePa),
    ftaAvg: avg(fta),
    hitRateVsLine: sideSupport === "OVER" ? overHit : sideSupport === "UNDER" ? underHit : overHit,
    hitRateOver: overHit,
    hitRateUnder: underHit,
    volatility: volatility(points),
    sideSupport,
    reasons: reasons.slice(0, 4),
  };
}

function buildOpponentBlock(games = [], line = 0) {
  const gamesFound = games.length;
  if (gamesFound === 0) {
    return {
      gamesFound: 0,
      gamesUsed: 0,
      sampleStatus: "NONE",
      pointsAvg: null,
      minutesAvg: null,
      fgaAvg: null,
      threePaAvg: null,
      ftaAvg: null,
      hitRateVsLine: null,
      hitRateOver: null,
      hitRateUnder: null,
      volatility: null,
      sideSupport: "NO_HISTORY",
      noHistory: true,
      reasons: ["No opponent history — treated as neutral."],
    };
  }

  const points = games.map((g) => g.points).filter((v) => v != null);
  const minutes = games.map((g) => g.minutes).filter((v) => v != null);
  const fga = games.map((g) => g.fga).filter((v) => v != null);
  const fta = games.map((g) => g.fta).filter((v) => v != null);
  const threePa = games.map((g) => g.threePa).filter((v) => v != null);
  const pointsAvg = avg(points);
  const sampleStatus = sampleStatusFromCount(gamesFound);
  const sideSupport = sideSupportFromAvg(pointsAvg, line);
  const overHit = hitRateVsLine(points, line, "OVER");
  const underHit = hitRateVsLine(points, line, "UNDER");
  const reasons = [`${gamesFound} opponent game(s) found.`];
  if (sampleStatus === "SMALL_SAMPLE") {
    reasons.push("Small opponent sample — context only.");
  } else if (sampleStatus === "USABLE") {
    reasons.push("Medium opponent sample.");
  } else if (sampleStatus === "STRONG_SAMPLE") {
    reasons.push("Strong opponent sample (5+ games).");
  }
  if (sideSupport === "OVER") reasons.push("Opponent history leans Over vs line.");
  if (sideSupport === "UNDER") reasons.push("Opponent history leans Under vs line.");

  return {
    gamesFound,
    gamesUsed: games.length,
    sampleStatus,
    pointsAvg,
    minutesAvg: avg(minutes),
    fgaAvg: avg(fga),
    threePaAvg: avg(threePa),
    ftaAvg: avg(fta),
    hitRateVsLine: sideSupport === "OVER" ? overHit : sideSupport === "UNDER" ? underHit : overHit,
    hitRateOver: overHit,
    hitRateUnder: underHit,
    volatility: volatility(points),
    sideSupport,
    noHistory: false,
    reasons: reasons.slice(0, 5),
  };
}

function buildComparison(recentForm = {}, opponentHistory = {}, evalSide = "") {
  if (opponentHistory.noHistory || opponentHistory.gamesFound === 0) {
    return {
      agreement: "NO_HISTORY",
      confidenceImpact: "NONE",
      riskImpact: "NONE",
      flipSignal: "NONE",
      finalImpact: "NEUTRAL",
      sideImpact: "NEUTRAL",
      weight: 0,
      reasons: ["No opponent history — no boost, penalty, or flip."],
    };
  }

  const recentSide = recentForm.sideSupport || "NEUTRAL";
  const oppSide = opponentHistory.sideSupport || "NEUTRAL";
  const weight = sampleWeight(opponentHistory.sampleStatus);

  let agreement = "NEUTRAL";
  if (recentSide !== "NEUTRAL" && oppSide !== "NEUTRAL") {
    agreement = recentSide === oppSide ? "AGREES_WITH_RECENT" : "CONTRADICTS_RECENT";
  }

  let confidenceImpact = "NONE";
  let riskImpact = "NONE";
  let flipSignal = "NONE";
  let finalImpact = "NEUTRAL";
  let sideImpact = "NEUTRAL";
  const reasons = [];

  if (agreement === "AGREES_WITH_RECENT") {
    if (weight >= 0.55) {
      confidenceImpact = "BOOST";
      riskImpact = weight >= 1 ? "LOWER" : "NONE";
      finalImpact = "STRENGTHEN";
      sideImpact = recentSide;
      reasons.push("Opponent history agrees with recent form.");
    } else {
      finalImpact = "NEUTRAL";
      reasons.push("Agreement present but opponent sample too small for strong boost.");
    }
  } else if (agreement === "CONTRADICTS_RECENT") {
    confidenceImpact = weight >= 0.55 ? "REDUCE" : "NONE";
    riskImpact = weight >= 0.25 ? "RAISE" : "NONE";
    finalImpact = weight >= 0.55 ? "WEAKEN" : "NEUTRAL";
    sideImpact = oppSide;
    reasons.push("Opponent history contradicts recent form.");

    if (weight >= 1) {
      flipSignal = oppSide === "OVER" ? "CHECK_OVER" : oppSide === "UNDER" ? "CHECK_UNDER" : "NONE";
      reasons.push(`Flip-first check: ${flipSignal.replace("CHECK_", "")}.`);
    } else if (weight >= 0.55) {
      flipSignal = oppSide === "OVER" ? "CHECK_OVER" : oppSide === "UNDER" ? "CHECK_UNDER" : "NONE";
      reasons.push("Medium sample — flip check only, no hard flip.");
    } else {
      reasons.push("Small sample — context only, no flip signal.");
    }
  }

  if (evalSide && sideImpact !== "NEUTRAL" && evalSide !== sideImpact) {
    if (agreement === "CONTRADICTS_RECENT" && weight >= 0.55) {
      sideImpact = sideImpact;
    } else {
      sideImpact = "NEUTRAL";
    }
  }

  return {
    agreement,
    confidenceImpact,
    riskImpact,
    flipSignal,
    finalImpact,
    sideImpact,
    weight,
    reasons: reasons.slice(0, 5),
  };
}

export function evaluateOpponentHistoryComparison(pick = {}, options = {}) {
  const card = options.dataCard || pick.wnbaDataCard || {};
  const line = num(options.line ?? pick.line ?? card.bookLine ?? card.currentLine, 0);
  const evalSide = normalizeSide(options.side || pick.side || pick.pick);
  const stat = String(pick.stat || card.propType || "Points").toLowerCase();

  if (stat !== "points" && !stat.includes("point")) {
    return {
      version: OPPONENT_HISTORY_COMPARISON_VERSION,
      skipped: true,
      skipReason: "POINTS_ONLY",
      recentForm: { gamesUsed: 0, sideSupport: "NEUTRAL", reasons: [] },
      opponentHistory: {
        gamesFound: 0,
        gamesUsed: 0,
        sampleStatus: "NONE",
        sideSupport: "NO_HISTORY",
        noHistory: true,
        reasons: [],
      },
      comparison: {
        agreement: "NEUTRAL",
        confidenceImpact: "NONE",
        riskImpact: "NONE",
        flipSignal: "NONE",
        finalImpact: "NEUTRAL",
        sideImpact: "NEUTRAL",
        reasons: ["Non-points market — opponent history comparison skipped."],
      },
      sideImpact: "NEUTRAL",
      status: "SKIPPED",
      reasons: [],
    };
  }

  const recentGames = resolveRecentFormGames(pick, options);
  const opponentGames = resolveOpponentHistoryGames(pick, options);
  const recentForm = buildFormBlock(recentGames, line);
  const opponentHistory = buildOpponentBlock(opponentGames, line);
  const comparison = buildComparison(recentForm, opponentHistory, evalSide);

  let status = "NEUTRAL";
  if (comparison.finalImpact === "STRENGTHEN") status = "SUPPORTS";
  if (comparison.finalImpact === "WEAKEN") status = "CONTRADICTS";
  if (opponentHistory.noHistory) status = "NO_HISTORY";

  return {
    version: OPPONENT_HISTORY_COMPARISON_VERSION,
    recentForm,
    opponentHistory,
    comparison,
    sideImpact: comparison.sideImpact,
    status,
    flipSignal: comparison.flipSignal,
    reasons: [...recentForm.reasons, ...opponentHistory.reasons, ...comparison.reasons].slice(0, 8),
  };
}

export function buildOpponentHistoryCompactLabel(ohc = {}) {
  const opp = ohc.opponentHistory || {};
  const cmp = ohc.comparison || {};
  if (opp.noHistory || opp.gamesFound === 0 || cmp.agreement === "NO_HISTORY") {
    return "No history";
  }
  const gamesUsed = opp.gamesUsed || opp.gamesFound || 0;
  const side = opp.sideSupport === "OVER" ? "Over" : opp.sideSupport === "UNDER" ? "Under" : "";
  if (opp.sampleStatus === "SMALL_SAMPLE") {
    return `Small sample, ${gamesUsed} game${gamesUsed === 1 ? "" : "s"} used`;
  }
  if (cmp.agreement === "AGREES_WITH_RECENT" && side) {
    return `Supports ${side}, ${gamesUsed} games used`;
  }
  if (cmp.agreement === "CONTRADICTS_RECENT" && side) {
    return `Contradicts ${side === "Over" ? "Over" : "Under"}, ${gamesUsed} games used`;
  }
  if (side) {
    return `Supports ${side}, ${gamesUsed} games used`;
  }
  return `Neutral, ${gamesUsed} games used`;
}

export function applyOpponentHistoryComparisonToPick(pick = {}, options = {}) {
  const ohc =
    options.opponentHistoryComparison ||
    evaluateOpponentHistoryComparison(pick, options);

  return {
    ...pick,
    opponentHistoryComparison: ohc,
    opponentHistoryComparisonVersion: OPPONENT_HISTORY_COMPARISON_VERSION,
    opponentHistoryLabel: buildOpponentHistoryCompactLabel(ohc),
  };
}
