/**
 * CourtEdge Canonical Prop Identity V1 — SINGLE OWNER
 *
 * Identity:
 *   league | slateDateCt | gameId | playerCanonicalName | propType | line
 *
 * propType MUST be POINTS | REBOUNDS | ASSISTS.
 * Never default to Points when a usable propType is available.
 */
import {
  normalizePropTypeV1,
  propTypeStatLabel,
  PROP_TYPE_TO_ODDS_MARKET,
} from "../engines/wnba/propTypeV1.js";

export const CANONICAL_PROP_ID_BUILD =
  "courteedge-decision-intelligence-single-truth-v1";
export const CANONICAL_PROP_ID_VERSION = "canonical-prop-id-v1";

export const CANONICAL_PROP_TYPES = Object.freeze([
  "POINTS",
  "REBOUNDS",
  "ASSISTS",
]);

function cleanToken(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function cleanSlug(value = "") {
  const raw = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
  const dashed = raw
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return dashed || cleanToken(raw);
}

function numLine(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Resolve propType without silent Points default when a market signal exists.
 * Returns { propType, source, ambiguous }.
 */
export function resolveCanonicalPropType(input = {}) {
  const candidates = [
    ["propType", input.propType],
    ["canonicalPropType", input.canonicalPropType],
    ["marketType", input.marketType],
    ["marketKey", input.marketKey],
    ["oddsMarket", input.oddsMarket],
    ["market", input.market],
    ["stat", input.stat],
    ["boxField", input.boxField],
  ];

  for (const [source, raw] of candidates) {
    const pt = normalizePropTypeV1(raw);
    if (pt) return { propType: pt, source, ambiguous: false };
  }

  // trackedKey / officialPropId segment hints
  const keyBlob = String(
    input.trackedKey || input.officialPropId || input.canonicalPropId || ""
  ).toLowerCase();
  if (/(^|[|_\-])assists?([|_\-]|$)/.test(keyBlob) || keyBlob.includes("player_assists")) {
    return { propType: "ASSISTS", source: "keyHint", ambiguous: false };
  }
  if (/(^|[|_\-])rebounds?([|_\-]|$)/.test(keyBlob) || keyBlob.includes("player_rebounds")) {
    return { propType: "REBOUNDS", source: "keyHint", ambiguous: false };
  }
  if (/(^|[|_\-])points?([|_\-]|$)/.test(keyBlob) || keyBlob.includes("player_points")) {
    return { propType: "POINTS", source: "keyHint", ambiguous: false };
  }

  return {
    propType: null,
    source: "MISSING",
    ambiguous: true,
  };
}

/**
 * Require propType — never invent Points for identity when missing.
 */
export function requireCanonicalPropType(input = {}, options = {}) {
  const resolved = resolveCanonicalPropType(input);
  if (resolved.propType) return resolved;
  if (options.allowPointsFallback === true) {
    return { propType: "POINTS", source: "EXPLICIT_FALLBACK", ambiguous: true };
  }
  return resolved;
}

export function resolvePlayerCanonicalName(input = {}) {
  const explicit =
    input.playerCanonicalName ||
    input.playerSlug ||
    input.canonicalPlayerName;
  if (explicit) return cleanSlug(explicit);
  return cleanSlug(input.playerName || input.player || input.playerId || "");
}

export function resolveGameId(input = {}) {
  const raw =
    input.gameId ||
    input.providerEventId ||
    input.oddsEventId ||
    input.eventId ||
    input.gameKey ||
    "";
  const cleaned = String(raw || "").trim();
  if (cleaned) return cleaned;

  // Fallback abbreviation pair only when teams known (never player-only).
  const team = cleanToken(input.team || input.homeTeam || "");
  const opp = cleanToken(input.opponent || input.awayTeam || "");
  if (team && opp) {
    const a = team.slice(0, 3).toUpperCase();
    const b = opp.slice(0, 3).toUpperCase();
    return `${b}-${a}`;
  }
  return "";
}

export function resolveSlateDateCt(input = {}, fallback = "") {
  const date = String(
    input.slateDateCt ||
      input.canonicalSlateDateCT ||
      input.canonicalSlateDate ||
      input.slateDate ||
      input.resultsSlateDate ||
      input.cohortSlateDate ||
      input.gameDate ||
      fallback ||
      ""
  ).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

/**
 * Canonical identity owner.
 * Format: league|slateDateCt|gameId|playerCanonicalName|PROPTYPE|line
 */
export function buildCanonicalPropId(input = {}, options = {}) {
  const league = String(input.league || options.league || "WNBA").toUpperCase();
  const slateDateCt = resolveSlateDateCt(input, options.slateDateCt || options.slateDate);
  const gameId = resolveGameId(input);
  const playerCanonicalName = resolvePlayerCanonicalName(input);
  const typeRes = requireCanonicalPropType(input, options);
  const line = numLine(
    input.line ?? input.officialLine ?? input.sealedLine ?? input.pickLine
  );

  if (!slateDateCt || !playerCanonicalName || !typeRes.propType || line == null) {
    return {
      ok: false,
      canonicalPropId: null,
      propType: typeRes.propType,
      propTypeSource: typeRes.source,
      ambiguous: true,
      reason: "INCOMPLETE_IDENTITY",
      parts: { league, slateDateCt, gameId, playerCanonicalName, propType: typeRes.propType, line },
      build: CANONICAL_PROP_ID_BUILD,
    };
  }

  const canonicalPropId = [
    league,
    slateDateCt,
    gameId || "UNKNOWN_GAME",
    playerCanonicalName,
    typeRes.propType,
    String(line),
  ].join("|");

  return {
    ok: true,
    canonicalPropId,
    propType: typeRes.propType,
    propTypeSource: typeRes.source,
    ambiguous: typeRes.ambiguous || !gameId,
    reason: gameId ? null : "GAME_ID_FALLBACK",
    parts: {
      league,
      slateDateCt,
      gameId: gameId || "UNKNOWN_GAME",
      playerCanonicalName,
      propType: typeRes.propType,
      line,
    },
    build: CANONICAL_PROP_ID_BUILD,
    version: CANONICAL_PROP_ID_VERSION,
  };
}

export function parseCanonicalPropId(canonicalPropId = "") {
  const parts = String(canonicalPropId || "").split("|");
  if (parts.length < 6) return null;
  const [league, slateDateCt, gameId, playerCanonicalName, propTypeRaw, lineRaw] = parts;
  const propType = normalizePropTypeV1(propTypeRaw);
  const line = numLine(lineRaw);
  if (!propType || line == null) return null;
  return {
    league: String(league || "").toUpperCase(),
    slateDateCt,
    gameId,
    playerCanonicalName,
    propType,
    line,
  };
}

/** Stable tracked hyphen key — propType-aware, includes line. */
export function buildCanonicalTrackedKey(input = {}, options = {}) {
  const built = buildCanonicalPropId(input, options);
  if (!built.ok) return null;
  const p = built.parts;
  const side = String(input.side || input.pick || input.lockedSide || "")
    .toUpperCase()
    .startsWith("UNDER")
    ? "under"
    : String(input.side || input.pick || "")
          .toUpperCase()
          .startsWith("OVER")
      ? "over"
      : "na";
  return [
    cleanToken(p.slateDateCt),
    cleanToken(p.league),
    cleanToken(p.playerCanonicalName),
    cleanToken(input.team || ""),
    cleanToken(input.opponent || ""),
    cleanToken(propTypeStatLabel(p.propType)),
    cleanToken(String(p.line)),
    side,
  ].join("-");
}

/** Official pipe id — propType-aware (replaces Points default). */
export function buildCanonicalOfficialPropId(input = {}, options = {}) {
  const built = buildCanonicalPropId(input, options);
  if (!built.ok) return null;
  const p = built.parts;
  const side = String(input.side || input.pick || input.lockedSide || "na").toUpperCase();
  return [
    p.slateDateCt,
    p.league,
    cleanToken(p.playerCanonicalName),
    cleanToken(input.team || ""),
    cleanToken(input.opponent || ""),
    cleanToken(propTypeStatLabel(p.propType)),
    side.startsWith("UNDER") ? "UNDER" : side.startsWith("OVER") ? "OVER" : side,
    String(p.line),
  ].join("|");
}

export function stampCanonicalIdentity(record = {}, options = {}) {
  const built = buildCanonicalPropId(record, options);
  if (!built.ok) {
    return {
      ...record,
      propIdentityStatus: "INCOMPLETE",
      propTypeSource: built.propTypeSource,
      canonicalPropIdBuild: CANONICAL_PROP_ID_BUILD,
    };
  }

  const propType = built.propType;
  const marketKey =
    record.marketKey ||
    PROP_TYPE_TO_ODDS_MARKET[propType] ||
    null;

  return {
    ...record,
    canonicalPropId: built.canonicalPropId,
    propType,
    canonicalPropType: propType,
    stat: propTypeStatLabel(propType),
    marketKey,
    marketType: propType,
    propTypeSource: built.propTypeSource,
    propIdentityStatus: built.ambiguous ? "AMBIGUOUS_GAME" : "CLEAN",
    canonicalPropIdBuild: CANONICAL_PROP_ID_BUILD,
    officialPropId:
      record.officialPropId ||
      buildCanonicalOfficialPropId({ ...record, propType }, options) ||
      record.officialPropId,
    trackedKey:
      record.trackedKey ||
      buildCanonicalTrackedKey({ ...record, propType }, options) ||
      record.trackedKey,
  };
}

export function identityOwnershipReport() {
  return {
    ownerModule: "betbrain-server/services/courtEdgeCanonicalPropIdV1.js",
    build: CANONICAL_PROP_ID_BUILD,
    version: CANONICAL_PROP_ID_VERSION,
    format: "league|slateDateCt|gameId|playerCanonicalName|PROPTYPE|line",
    propTypes: CANONICAL_PROP_TYPES,
    rules: [
      "Never default to Points when propType/market/stat resolves",
      "No player-only fallback matching for multistat records",
      "gameId preferred; team-opponent abbrev only as last resort",
      "All consumers must stamp via stampCanonicalIdentity / buildCanonicalPropId",
    ],
    requiredCallSites: [
      "marketSnapshotService",
      "trackedPropService.getStableTrackedPropKey",
      "trackedPropService.mapPickToTrackedFields",
      "officialSlateService.buildOfficialPropId",
      "officialSlateService.freezeOfficialProp",
      "courtEdgeTabFlowRepairV1.normalizeSealedAdmissionProps",
      "resultService / grader",
      "GET /picks sanitize",
      "GET /tracked-props",
      "Lab / History / Copy Report",
    ],
  };
}
