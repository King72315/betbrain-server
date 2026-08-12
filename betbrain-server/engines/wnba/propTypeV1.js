/**
 * CourtEdge canonical propType V1 — POINTS | REBOUNDS | ASSISTS
 *
 * Single market identity dimension for the multi-stat machine.
 * Never infer propType from UI text once a canonical packet exists.
 */
export const COURTEDGE_PROP_TYPES_V1 = Object.freeze([
  "POINTS",
  "REBOUNDS",
  "ASSISTS",
]);

export const PROP_TYPE_TO_ODDS_MARKET = Object.freeze({
  POINTS: "player_points",
  REBOUNDS: "player_rebounds",
  ASSISTS: "player_assists",
});

export const ODDS_MARKET_TO_PROP_TYPE = Object.freeze({
  player_points: "POINTS",
  player_rebounds: "REBOUNDS",
  player_assists: "ASSISTS",
});

export const PROP_TYPE_TO_STAT_LABEL = Object.freeze({
  POINTS: "Points",
  REBOUNDS: "Rebounds",
  ASSISTS: "Assists",
});

export const PROP_TYPE_TO_BOX_FIELD = Object.freeze({
  POINTS: "points",
  REBOUNDS: "rebounds",
  ASSISTS: "assists",
});

export const PRA_MULTISTAT_BUILD = "courteedge-points-rebounds-assists-v1";

function clean(v = "") {
  return String(v || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Normalize any incoming label to canonical propType.
 */
export function normalizePropTypeV1(raw = "") {
  const s = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (s === "POINTS" || s === "PTS" || s === "POINT" || s === "PLAYER_POINTS") {
    return "POINTS";
  }
  if (
    s === "REBOUNDS" ||
    s === "REB" ||
    s === "REBOUND" ||
    s === "PLAYER_REBOUNDS"
  ) {
    return "REBOUNDS";
  }
  if (
    s === "ASSISTS" ||
    s === "AST" ||
    s === "ASSIST" ||
    s === "PLAYER_ASSISTS"
  ) {
    return "ASSISTS";
  }
  // Legacy defaults
  if (/point/i.test(String(raw || ""))) return "POINTS";
  if (/rebound/i.test(String(raw || ""))) return "REBOUNDS";
  if (/assist/i.test(String(raw || ""))) return "ASSISTS";
  return null;
}

export function propTypeToOddsMarket(propType) {
  const p = normalizePropTypeV1(propType);
  return p ? PROP_TYPE_TO_ODDS_MARKET[p] : null;
}

export function oddsMarketToPropType(marketKey) {
  const k = String(marketKey || "").toLowerCase();
  return ODDS_MARKET_TO_PROP_TYPE[k] || null;
}

export function propTypeStatLabel(propType) {
  const p = normalizePropTypeV1(propType) || "POINTS";
  return PROP_TYPE_TO_STAT_LABEL[p];
}

export function propTypeBoxField(propType) {
  const p = normalizePropTypeV1(propType) || "POINTS";
  return PROP_TYPE_TO_BOX_FIELD[p];
}

/**
 * Canonical market identity (event + player + propType + line + side + pregame).
 */
export function buildCanonicalMarketIdV1({
  eventId = "",
  player = "",
  propType = "POINTS",
  line = null,
  side = "",
  pregameTimestamp = "",
} = {}) {
  const pt = normalizePropTypeV1(propType) || "POINTS";
  const s = String(side || "").toUpperCase();
  return [
    String(eventId || ""),
    clean(player),
    pt,
    line == null ? "" : String(line),
    s,
    String(pregameTimestamp || ""),
  ].join("|");
}

export function softMarketKeyV1({
  date = "",
  player = "",
  propType = "POINTS",
  line = null,
} = {}) {
  const pt = normalizePropTypeV1(propType) || "POINTS";
  return `${String(date).slice(0, 10)}|${clean(player)}|${pt}|${line}`;
}
