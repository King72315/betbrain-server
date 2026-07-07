/**
 * WNBA graduated data mode — per-prop coverage instead of league-wide LIMITED.
 * WNBA_FULL_DATA when core fields are present; WNBA_LIMITED_DATA when core gaps exist.
 */
export const WNBA_GRADUATED_DATA_MODE_VERSION = "wnba-graduated-data-mode-v1";

const CORE_COVERAGE_KEYS = new Set([
  "playerId",
  "seasonStats",
  "last5",
  "minutes",
  "fga",
  "market",
]);

const FLAG_DEBT_MAP = {
  playerId: {
    code: "MISSING_PLAYER_ID",
    severity: "MEDIUM",
    reason: "No stable BallDontLie player id",
  },
  seasonStats: {
    code: "MISSING_SEASON_STATS",
    severity: "MEDIUM",
    reason: "Missing season scoring stats",
  },
  last5: {
    code: "MISSING_LAST5",
    severity: "MEDIUM",
    reason: "Fewer than 3 recent games",
  },
  minutes: {
    code: "MISSING_MINUTES",
    severity: "MEDIUM",
    reason: "No minutes sample (recent or season)",
  },
  fga: {
    code: "MISSING_FGA",
    severity: "MEDIUM",
    reason: "No shot-volume sample (recent or season FGA)",
  },
  availabilityFeed: {
    code: "MISSING_AVAILABILITY",
    severity: "LOW",
    reason: "Injury/availability feed is missing",
  },
  defense: {
    code: "MISSING_OPPONENT_DEFENSE",
    severity: "LOW",
    reason: "Opponent defense context missing",
  },
  matchup: {
    code: "MISSING_MATCHUP",
    severity: "LOW",
    reason: "No opponent matchup history",
  },
  market: {
    code: "MISSING_MARKET",
    severity: "MEDIUM",
    reason: "No sportsbook line data",
  },
  projection: {
    code: "MISSING_PROJECTION",
    severity: "MEDIUM",
    reason: "Volume projection unavailable",
  },
  gameContext: {
    code: "MISSING_GAME_CONTEXT",
    severity: "LOW",
    reason: "Game spread/total context missing",
  },
};

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function isWnbaLimitedDataMode(dataMode = "") {
  return String(dataMode || "").toUpperCase() === "WNBA_LIMITED_DATA";
}

export function isWnbaFullDataMode(dataMode = "") {
  const mode = String(dataMode || "").toUpperCase();
  return mode === "WNBA_FULL_DATA" || mode === "WNBA_FULL";
}

export const WNBA_FULL_OVER_GAP_FLOOR = 3.5;
export const WNBA_LIMITED_OVER_GAP_FLOOR = 4.0;
export const WNBA_UNDER_GAP_FLOOR = 3.5;

const SIDE_INAPPLICABLE_DEBT_CODES = {
  UNDER: new Set(["LOW_VOLUME_OVER_TRAP", "LOW_FGA", "EFFICIENCY_ONLY_SCORING"]),
  OVER: new Set(["UNDER_FRAGILITY"]),
};

const GAP_FLOOR_REASON_CODES = new Set([
  "OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR",
  "OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR",
  "UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR",
]);

function normalizeGapSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw === "OVER" || raw === "O" || raw.startsWith("OVER")) return "OVER";
  if (raw === "UNDER" || raw === "U" || raw.startsWith("UNDER")) return "UNDER";
  return "";
}

/** Graduated Over/Under gap floors — FULL_DATA stable Over uses 3.5; limited/volatile Over uses 4.0. */
export function resolveWnbaGapFloors(metrics = {}) {
  const side = normalizeGapSide(metrics.side);
  if (side === "UNDER") {
    return {
      gapFloor: WNBA_UNDER_GAP_FLOOR,
      reasonCode: "UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR",
    };
  }
  const limited = isWnbaLimitedDataMode(metrics.dataMode);
  const volatile =
    metrics.volatility === "unstable" || metrics.volatility === "volatile";
  if (limited || volatile) {
    return {
      gapFloor: WNBA_LIMITED_OVER_GAP_FLOOR,
      reasonCode: "OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR",
    };
  }
  return {
    gapFloor: WNBA_FULL_OVER_GAP_FLOOR,
    reasonCode: "OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR",
  };
}

export function flagsFromAvailability(dataAvailabilityFlags = {}, values = {}) {
  const {
    playerId = "",
    last5Count = 0,
    seasonPoints = 0,
    recentMinutes = 0,
    seasonMinutes = 0,
    recentFGA = 0,
    seasonFGA = 0,
    bookCount = 0,
    projection = 0,
    availabilityDataMissing = false,
    defenseMissing = false,
    matchupMissing = false,
    gameContextMissing = false,
  } = values;

  if (dataAvailabilityFlags && Object.keys(dataAvailabilityFlags).length) {
    return [
      {
        key: "last5",
        missing: !dataAvailabilityFlags.hasLast5,
        note: `Only ${last5Count} recent games`,
      },
      {
        key: "seasonStats",
        missing: !dataAvailabilityFlags.hasSeasonStats,
        note: "Missing season points",
      },
      {
        key: "minutes",
        missing: !dataAvailabilityFlags.hasSeasonMinutes,
        note: "No minutes data",
      },
      {
        key: "fga",
        missing: !dataAvailabilityFlags.hasSeasonFGA,
        note: "No FGA data",
      },
      {
        key: "market",
        missing: !dataAvailabilityFlags.hasMarketData,
        note: "No book line data",
      },
      {
        key: "playerId",
        missing: !String(playerId || "").trim(),
        note: "No stable BallDontLie player id",
      },
      {
        key: "projection",
        missing: !(projection > 0 || dataAvailabilityFlags.hasSportsProjection),
        note: "Volume projection unavailable",
      },
      {
        key: "availabilityFeed",
        missing: availabilityDataMissing,
        note: "WNBA availability feed missing",
      },
      {
        key: "defense",
        missing: defenseMissing,
        note: "Opponent defense context missing",
      },
      {
        key: "matchup",
        missing: matchupMissing,
        note: "No opponent matchup history",
      },
      {
        key: "gameContext",
        missing: gameContextMissing,
        note: "Game spread/total context missing",
      },
    ];
  }

  return [
    {
      key: "playerId",
      missing: !String(playerId || "").trim(),
      note: "No stable BallDontLie player id",
    },
    {
      key: "seasonStats",
      missing: seasonPoints <= 0,
      note: "Missing season points",
    },
    {
      key: "last5",
      missing: last5Count < 3,
      note: `Only ${last5Count} recent games`,
    },
    {
      key: "minutes",
      missing: recentMinutes <= 0 && seasonMinutes <= 0,
      note: "No minutes data",
    },
    {
      key: "fga",
      missing: recentFGA <= 0 && seasonFGA <= 0,
      note: "No FGA data",
    },
    {
      key: "market",
      missing: bookCount <= 0,
      note: "No book line data",
    },
    {
      key: "projection",
      missing: projection <= 0,
      note: "Volume projection unavailable",
    },
    {
      key: "availabilityFeed",
      missing: availabilityDataMissing,
      note: "WNBA availability feed missing",
    },
    {
      key: "defense",
      missing: defenseMissing,
      note: "Opponent defense context missing",
    },
    {
      key: "matchup",
      missing: matchupMissing,
      note: "No opponent matchup history",
    },
    {
      key: "gameContext",
      missing: gameContextMissing,
      note: "Game spread/total context missing",
    },
  ];
}

export function hasCoreWnbaCoverage(flags = []) {
  return !flags.some((flag) => flag.missing && CORE_COVERAGE_KEYS.has(flag.key));
}

export function resolveWnbaGraduatedDataMode({
  league = "WNBA",
  dataMissingFlags = [],
  dataAvailabilityFlags = null,
  playerId = "",
  last5Count = 0,
  seasonPoints = 0,
  recentMinutes = 0,
  seasonMinutes = 0,
  recentFGA = 0,
  seasonFGA = 0,
  bookCount = 0,
  projection = 0,
  availabilityDataMissing = false,
  defenseMissing = false,
  matchupMissing = false,
  gameContextMissing = false,
} = {}) {
  if (String(league || "").toUpperCase() !== "WNBA") {
    return "NBA_FULL_DATA";
  }

  const flags = dataMissingFlags.length
    ? dataMissingFlags
    : flagsFromAvailability(dataAvailabilityFlags, {
        playerId,
        last5Count,
        seasonPoints,
        recentMinutes,
        seasonMinutes,
        recentFGA,
        seasonFGA,
        bookCount,
        projection,
        availabilityDataMissing,
        defenseMissing,
        matchupMissing,
        gameContextMissing,
      });

  return hasCoreWnbaCoverage(flags) ? "WNBA_FULL_DATA" : "WNBA_LIMITED_DATA";
}

export function debtItemFromMissingFlag(flag = {}) {
  const mapped = FLAG_DEBT_MAP[flag.key];
  if (!mapped || !flag.missing) return null;
  return {
    code: mapped.code,
    severity: mapped.severity,
    reason: flag.note || mapped.reason,
    side: "BOTH",
    repairable: mapped.severity !== "KILL",
  };
}

export function collectWnbaDataCoverageDebts(candidate = {}, metrics = {}) {
  const card = candidate.wnbaDataCard || metrics.card || {};
  const missingFlags = (
    card.dataMissingFlags ||
    candidate.dataMissingFlags ||
    metrics.missingFlags ||
    []
  ).filter((flag) => flag?.missing);

  const debts = [];
  const seen = new Set();
  for (const flag of missingFlags) {
    const debt = debtItemFromMissingFlag(flag);
    if (!debt || seen.has(debt.code)) continue;
    seen.add(debt.code);
    debts.push(debt);
  }
  return debts;
}

function debtPriority(debt = {}) {
  if (debt.severity === "KILL") return 100;
  if (debt.severity === "HIGH") return 80;
  if (String(debt.code || "").startsWith("MISSING_")) return 70;
  if (debt.severity === "MEDIUM") return 50;
  return 30;
}

export function sortRiskDebtsForDisplay(riskDebts = []) {
  return [...riskDebts]
    .filter((debt) => debt.code !== "WNBA_LIMITED_DATA")
    .sort((a, b) => debtPriority(b) - debtPriority(a));
}

export function pickPrimaryDebtExplanation(riskDebts = [], options = {}) {
  const side = normalizeGapSide(options.side || "");
  const gateReason = String(options.gateReason || "");

  if (GAP_FLOOR_REASON_CODES.has(gateReason)) {
    const thinEdge = sortRiskDebtsForDisplay(riskDebts).find((d) => d.code === "THIN_EDGE");
    if (thinEdge?.reason) return thinEdge.reason;
    return gateReason.replace(/_/g, " ").toLowerCase();
  }

  const inapplicable = SIDE_INAPPLICABLE_DEBT_CODES[side] || new Set();
  const sorted = sortRiskDebtsForDisplay(riskDebts).filter(
    (debt) => !inapplicable.has(debt.code)
  );
  if (!sorted.length) return "minor concerns";
  const debt = sorted[0];
  return debt.reason || debt.code.replace(/_/g, " ").toLowerCase();
}

export function hasMaterialDataCoverageGaps(riskDebts = []) {
  return riskDebts.some(
    (debt) =>
      String(debt.code || "").startsWith("MISSING_") &&
      ["MEDIUM", "HIGH", "KILL"].includes(String(debt.severity || "").toUpperCase())
  );
}
