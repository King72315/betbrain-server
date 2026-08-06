/**
 * CourtEdge Final Variable Team Board + Home→Results→History Lock V1
 * Structural only — no prediction weight changes.
 *
 * Contract:
 *   Verified games → best organic Over + Under per team
 *   → full board ranked safest→riskiest on Home
 *   → exact same board Official / Results
 *   → completed slate → History (no Lab)
 */

import { createHash } from "node:crypto";

export const HOME_HISTORY_LOCK_BUILD =
  "courteedge-final-variable-team-board-home-history-lock-v1";
export const HOME_HISTORY_LOCK_VERSION = "variable-team-board-home-history-lock-v1";

export const MAX_OVERS_PER_TEAM = 1;
export const MAX_UNDERS_PER_TEAM = 1;
export const MAX_PROPS_PER_TEAM = 2;
export const MAX_PROPS_PER_GAME = 4;

/** Fail codes for structural lock */
export const LOCK_FAIL = Object.freeze({
  DUPLICATE_BOARD_MEMBERSHIP: "DUPLICATE_BOARD_MEMBERSHIP",
  STALE_SELECTION_BUILD: "STALE_SELECTION_BUILD",
  SIDE_OR_LINE_MUTATION: "SIDE_OR_LINE_MUTATION",
  MEMBERSHIP_MISMATCH: "MEMBERSHIP_MISMATCH",
  SIX_ROW_CAP_APPLIED: "SIX_ROW_CAP_APPLIED_TO_MEMBERSHIP",
  SAFETY_RANK_INVALID: "SAFETY_RANK_INVALID",
});

function str(v) {
  return v == null ? "" : String(v).trim();
}

function num(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER")) return "OVER";
  if (raw.startsWith("UNDER")) return "UNDER";
  return null;
}

export function cleanPlayerId(pick = {}) {
  return str(pick.playerId || pick.player)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Canonical identity — exact duplicates collapse; different side/line stay separate.
 * league | canonicalSlateDate | providerEventId | playerId | marketType | side | line
 */
export function canonicalPropIdentity(pick = {}, slateDate = "") {
  const league = str(pick.league || "WNBA").toUpperCase();
  const date = str(
    slateDate || pick.canonicalSlateDate || pick.slateDate || ""
  ).slice(0, 10);
  const eventId = str(
    pick.providerEventId || pick.oddsEventId || pick.gameId || pick.eventId || ""
  );
  const playerId = cleanPlayerId(pick);
  const market = str(pick.stat || pick.marketType || pick.propType || "points")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "") || "points";
  const side = normalizeSide(pick.side || pick.pick || pick.lockedSide) || "";
  const line = num(pick.officialLine ?? pick.line ?? pick.pickLine, null);
  const lineKey = line == null ? "na" : String(line);
  return [league, date, eventId, playerId, market, side, lineKey].join("|");
}

/**
 * Assert rawCount === uniqueIdentityCount. Blocks writes on failure.
 */
export function assertNoDuplicateMembership(props = [], slateDate = "") {
  const list = Array.isArray(props) ? props : [];
  const ids = list.map((p) => canonicalPropIdentity(p, slateDate));
  const unique = new Set(ids);
  const ok = ids.length === unique.size;
  const duplicates = [];
  if (!ok) {
    const seen = new Map();
    for (const id of ids) {
      seen.set(id, (seen.get(id) || 0) + 1);
    }
    for (const [id, count] of seen) {
      if (count > 1) duplicates.push({ id, count });
    }
  }
  return {
    ok,
    status: ok ? "PASS" : LOCK_FAIL.DUPLICATE_BOARD_MEMBERSHIP,
    reason: ok ? null : LOCK_FAIL.DUPLICATE_BOARD_MEMBERSHIP,
    rawCount: ids.length,
    uniqueIdentityCount: unique.size,
    duplicates,
  };
}

function trueRiskRank(pick = {}) {
  const risk = String(
    pick.trueRisk || pick.riskLabel || pick.risk || ""
  ).toUpperCase();
  if (risk.includes("LOW")) return 3;
  if (risk.includes("MED")) return 2;
  if (risk.includes("HIGH")) return 1;
  return 2;
}

/**
 * Existing production evidence only — no new model weights.
 * Mirrors client/server computeSafetyScore pattern.
 */
export function computeCanonicalSafetyScore(pick = {}) {
  const di = pick.decisionIntelligence || {};
  // Prefer calibrated side score when present (directional calibration V1).
  const score = num(
    pick.calibratedTeamSideScore ??
      pick.calibratedSafetyScore ??
      pick.bestPropScore ??
      pick.pickScore ??
      pick.teamSideScore ??
      pick.controlledBestSixScore,
    0
  );
  const confidence = num(
    pick.calibratedConfidence ?? pick.confidence ?? pick.winProbability,
    50
  );
  const dangerPenalty = num(di.dangerGateCount ?? pick.dangerGateCount, 0) * 6;
  const riskBonus = trueRiskRank(pick) * 15;
  const gateBonus =
    String(pick.resultsDecision || pick.trackEligibility || "TRACK").toUpperCase() ===
    "TRACK"
      ? 40
      : 20;
  const repairBonus = num(di.repairScore, 0) * 0.1;
  const debtPenalty = (Array.isArray(di.riskDebts) ? di.riskDebts.length : 0) * 4;
  const killPenalty = (Array.isArray(di.killReasons) ? di.killReasons.length : 0) * 20;
  const stabilityBonus =
    num(
      pick.minutesStabilityScore ??
        di.minutesStabilityScore ??
        pick.volumeStabilityScore ??
        di.volumeStabilityScore ??
        pick.roleStabilityScore,
      0
    ) * 0.15;
  const bookBonus = Math.min(num(pick.bookCount ?? pick.books, 1) || 1, 8) * 1.5;
  const marketBonus = num(pick.marketQuality, 0) * 0.2;
  const proj = num(pick.projection ?? pick.finalProjection, null);
  const line = num(pick.line ?? pick.officialLine, null);
  const side = normalizeSide(pick.side || pick.pick);
  let marginBonus = 0;
  if (proj != null && line != null && side) {
    const margin = side === "OVER" ? proj - line : line - proj;
    marginBonus = Math.max(-8, Math.min(12, margin * 2));
  }
  const conflictPenalty =
    num(pick.signalConflictCount ?? di.signalConflictCount, 0) * 3;
  const blowoutPenalty = num(pick.blowoutRisk ?? di.blowoutRisk, 0) * 4;
  const promotedPenalty =
    (pick.bestSixQualityFlags?.length || di.promotionReasons?.length || 0) * 8 +
    (di.bestSixPromoted ? 8 : 0);
  const calibrationConflictPenalty =
    (Array.isArray(pick.highRiskReasons) ? pick.highRiskReasons.length : 0) * 5 +
    Math.max(0, -num(pick.calibrationDelta, 0)) * 0.25;
  const agreementBonus = Math.max(0, num(pick.calibrationDelta, 0)) * 0.15;

  return (
    score +
    confidence * 0.4 +
    riskBonus +
    gateBonus +
    repairBonus +
    stabilityBonus +
    bookBonus +
    marketBonus +
    marginBonus +
    agreementBonus -
    dangerPenalty -
    debtPenalty -
    killPenalty -
    conflictPenalty -
    blowoutPenalty -
    promotedPenalty -
    calibrationConflictPenalty
  );
}

function compareSafety(a, b) {
  const sa = num(a.canonicalSafetyScore, computeCanonicalSafetyScore(a));
  const sb = num(b.canonicalSafetyScore, computeCanonicalSafetyScore(b));
  if (sb !== sa) return sb - sa;
  const ca = num(a.confidence ?? a.winProbability, 0);
  const cb = num(b.confidence ?? b.winProbability, 0);
  if (cb !== ca) return cb - ca;
  const ra = trueRiskRank(a);
  const rb = trueRiskRank(b);
  if (rb !== ra) return rb - ra;
  const ma = num(a.projectionMargin, 0);
  const mb = num(b.projectionMargin, 0);
  if (mb !== ma) return mb - ma;
  const mqa = num(a.marketQuality, 0);
  const mqb = num(b.marketQuality, 0);
  if (mqb !== mqa) return mqb - mqa;
  return canonicalPropIdentity(a).localeCompare(canonicalPropIdentity(b));
}

/**
 * Sort full board safest → riskiest. Assign unique safetyRank 1..N.
 */
export function applySafetyRanking(props = [], slateDate = "") {
  const list = (Array.isArray(props) ? props : []).map((p) => {
    const side = normalizeSide(p.side || p.pick);
    const proj = num(p.projection ?? p.finalProjection, null);
    const line = num(p.line ?? p.officialLine, null);
    let projectionMargin = null;
    if (proj != null && line != null && side) {
      projectionMargin =
        side === "OVER"
          ? Number((proj - line).toFixed(2))
          : Number((line - proj).toFixed(2));
    }
    const score = computeCanonicalSafetyScore(p);
    const baselineSafety = num(
      p.baselineSafetyScore,
      // Reconstruct baseline-ish safety if only baseline side score exists
      p.baselineTeamSideScore != null
        ? computeCanonicalSafetyScore({
            ...p,
            teamSideScore: p.baselineTeamSideScore,
            calibratedTeamSideScore: p.baselineTeamSideScore,
            confidence: p.baselineConfidence ?? p.confidence,
            calibratedConfidence: p.baselineConfidence ?? p.confidence,
            trueRisk: p.baselineTrueRisk ?? p.trueRisk,
            highRiskReasons: [],
            calibrationDelta: 0,
          })
        : score
    );
    return {
      ...p,
      projectionMargin:
        projectionMargin != null ? projectionMargin : p.projectionMargin ?? null,
      canonicalSafetyScore: Number(score.toFixed(3)),
      calibratedSafetyScore: Number(score.toFixed(3)),
      baselineSafetyScore: Number(Number(baselineSafety).toFixed(3)),
      canonicalPropId: canonicalPropIdentity(p, slateDate),
    };
  });

  list.sort(compareSafety);

  const ranked = list.map((p, i) => ({
    ...p,
    safetyRank: i + 1,
    sealedSafetyRank: i + 1,
    controlledBestBoardRank: i + 1,
    // Legacy rank fields retained only as aliases of safety rank — not Top/Best6 membership
    controlledBestSixRank: i + 1,
    isTopPick: false,
    topPickRank: null,
    topPickLabel: null,
    bestSixOverallRank: null,
    bestSixOverallView: false,
  }));

  const ranks = new Set(ranked.map((p) => p.safetyRank));
  const rankOk = ranks.size === ranked.length;
  return {
    props: ranked,
    ok: rankOk,
    reason: rankOk ? null : LOCK_FAIL.SAFETY_RANK_INVALID,
  };
}

/**
 * Strip active Top / Best 6 / Lab payload fields from live responses.
 * Historical archives may still contain them.
 */
export function stripLegacySelectionSurfaces(payload = {}) {
  const next = { ...payload };
  delete next.topPicks;
  delete next.topTwo;
  delete next.topWNBAProps;
  delete next.topNBAProps;
  delete next.bestSixOverall;
  delete next.bestSixOverallWNBA;
  delete next.bestSixOverallNBA;
  delete next.labSlate;
  delete next.labReady;
  delete next.currentLabSlate;
  delete next.currentLabSlateDate;
  next.topPicksRemoved = true;
  next.bestSixRemoved = true;
  next.labLifecycleRemoved = true;
  next.variableBoardSize = true;
  next.homeHistoryLockBuild = HOME_HISTORY_LOCK_BUILD;
  return next;
}

/**
 * Build Home summary for variable board (no /6 denominators).
 */
export function buildHomeBoardSummary(props = [], meta = {}) {
  const list = Array.isArray(props) ? props : [];
  const teams = new Set(
    list.map((p) =>
      str(p.teamKey || p.team || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
    )
  );
  teams.delete("");
  const games = new Set(
    list.map((p) =>
      str(p.providerEventId || p.gameId || p.eventId || p.gameKey || "")
    )
  );
  games.delete("");
  let overs = 0;
  let unders = 0;
  let low = 0;
  let med = 0;
  let high = 0;
  for (const p of list) {
    const side = normalizeSide(p.side || p.pick);
    if (side === "OVER") overs += 1;
    if (side === "UNDER") unders += 1;
    const risk = String(p.trueRisk || p.riskLabel || p.risk || "").toUpperCase();
    if (risk.includes("LOW")) low += 1;
    else if (risk.includes("HIGH")) high += 1;
    else med += 1;
  }
  const n = list.length;
  return {
    controlledBestBoard: n,
    games: games.size || meta.gamesCount || 0,
    teams: teams.size || meta.teamCount || 0,
    overs,
    unders,
    lowRisk: low,
    mediumRisk: med,
    highRisk: high,
    resultsTracked: `${n}/${n}`,
    dateVerification: meta.dateVerificationStatus || "PASS",
    boardVersion: meta.boardVersion || HOME_HISTORY_LOCK_VERSION,
    selectionBuildId: meta.selectionBuildId || null,
    variableBoardSize: true,
    noGlobalCap: true,
    topRemoved: true,
    bestSixRemoved: true,
    labRemoved: true,
  };
}

/**
 * Reject Results admission when identity mutated after seal
 * (e.g. Under 11.5 → Over 9.5).
 */
export function assertSealedIdentityImmutable(sealedProp = {}, incomingProp = {}) {
  const sealedId = canonicalPropIdentity(sealedProp);
  const incomingId = canonicalPropIdentity(incomingProp);
  if (sealedId === incomingId) {
    return { ok: true, status: "PASS" };
  }
  const samePlayer =
    cleanPlayerId(sealedProp) === cleanPlayerId(incomingProp) &&
    cleanPlayerId(sealedProp) !== "";
  if (samePlayer) {
    return {
      ok: false,
      status: LOCK_FAIL.SIDE_OR_LINE_MUTATION,
      reason: LOCK_FAIL.SIDE_OR_LINE_MUTATION,
      sealedId,
      incomingId,
    };
  }
  return {
    ok: false,
    status: LOCK_FAIL.MEMBERSHIP_MISMATCH,
    reason: LOCK_FAIL.MEMBERSHIP_MISMATCH,
    sealedId,
    incomingId,
  };
}

export function assertSelectionBuildLock({
  selectionBuildId = null,
  sealBuildId = null,
} = {}) {
  if (!selectionBuildId || !sealBuildId) {
    return { ok: true, status: "SKIP", reason: null };
  }
  if (String(selectionBuildId) === String(sealBuildId)) {
    return { ok: true, status: "PASS", reason: null };
  }
  return {
    ok: false,
    status: LOCK_FAIL.STALE_SELECTION_BUILD,
    reason: LOCK_FAIL.STALE_SELECTION_BUILD,
  };
}

export function hashMembership(props = [], slateDate = "") {
  const ids = (Array.isArray(props) ? props : [])
    .map((p) => canonicalPropIdentity(p, slateDate))
    .sort();
  return createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 24);
}

export function assertHomeOfficialResultsMatch({
  homeProps = [],
  officialProps = [],
  resultsProps = [],
  slateDate = "",
} = {}) {
  const homeIds = new Set(
    (homeProps || []).map((p) => canonicalPropIdentity(p, slateDate))
  );
  const officialIds = new Set(
    (officialProps || []).map((p) => canonicalPropIdentity(p, slateDate))
  );
  const resultsIds = new Set(
    (resultsProps || []).map((p) => canonicalPropIdentity(p, slateDate))
  );
  const sameSize =
    homeIds.size === officialIds.size && officialIds.size === resultsIds.size;
  let equal = sameSize;
  if (equal) {
    for (const id of homeIds) {
      if (!officialIds.has(id) || !resultsIds.has(id)) {
        equal = false;
        break;
      }
    }
  }
  return {
    ok: equal,
    status: equal ? "PASS" : LOCK_FAIL.MEMBERSHIP_MISMATCH,
    homeCount: homeIds.size,
    officialCount: officialIds.size,
    resultsCount: resultsIds.size,
  };
}
