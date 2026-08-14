/**
 * CourtEdge Home Product Truth sections V3
 *
 * TRUSTED / OFFICIAL  — quality-gated Official membership only (may be 0)
 * BEST AVAILABLE      — global quality rank of non-trusted Full candidates (honest)
 * FULL PREDICTIONS    — every valid modeled candidate
 *
 * No market-balanced weave. No forced volume fill into Trusted.
 * Display caps for Best Available are presentation-only (not membership).
 */
import { normalizePropTypeV1 } from "../engines/wnba/propTypeV1.js";

export const HOME_PRODUCT_TRUTH_SECTIONS_BUILD =
  "courteedge-home-product-truth-sections-v3";

/** Presentation-only UI limit for Best Available list (NOT a Trusted fill). */
export const BEST_AVAILABLE_DISPLAY_MAX_DEFAULT = 10;

function num(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function scoreOf(packet = {}) {
  const a = num(packet.decisionScoreV2);
  if (a != null) return a;
  const b = num(packet.modelWinProbability ?? packet.officialRankScore);
  if (b != null) return b > 1 ? b / 100 : b;
  return null;
}

function stableKey(packet = {}) {
  return String(
    packet.canonicalPropId ||
      [
        packet.playerName || packet.player || "",
        packet.propType || "",
        packet.side || packet.selectedSide || "",
        packet.line ?? "",
      ].join("|")
  );
}

function compareQualityDesc(a, b) {
  const sa = scoreOf(a);
  const sb = scoreOf(b);
  if (sa != null && sb != null && sb !== sa) return sb - sa;
  if (sa != null && sb == null) return -1;
  if (sa == null && sb != null) return 1;
  return stableKey(a).localeCompare(stableKey(b));
}

/**
 * Full canonical packet gate for Trusted / Grade-A eligibility.
 * Incomplete odds-only rows fail closed.
 *
 * options.allowMissingEnvironmentFields — historical walk-forward compat when
 * Safety/Risk were never stamped on older corpus rows. Production Trusted
 * must leave this false (default).
 */
export function hasCompleteTrustedPacketV3(packet = {}, options = {}) {
  const projection = num(packet.projection);
  const fairLine = num(packet.fairLine);
  const side = String(packet.side || packet.selectedSide || packet.pick || "")
    .toUpperCase();
  const line = num(packet.line ?? packet.sealedLine);
  const propType = normalizePropTypeV1(
    packet.propType || packet.canonicalPropType || packet.stat
  );
  const p = num(
    packet.predictedProbability ??
      packet.modelWinProbability ??
      packet.decisionScoreV2
  );
  const safety =
    num(packet.safetyScore) ??
    num(packet.SafetyScore) ??
    num(packet.safety);
  const riskRaw =
    packet.riskV2 ??
    packet.risk?.risk ??
    packet.risk ??
    packet.c2Risk ??
    packet.trueRisk ??
    null;
  const riskOk =
    riskRaw != null &&
    typeof riskRaw === "object"
      ? String(riskRaw.risk || riskRaw.level || "").trim() !== ""
      : String(riskRaw).trim() !== "";

  const reasons = [];
  if (!propType || !["POINTS", "REBOUNDS", "ASSISTS"].includes(propType)) {
    reasons.push("MISSING_OR_INVALID_PROP_TYPE");
  }
  if (!side.startsWith("O") && !side.startsWith("U")) {
    reasons.push("MISSING_SIDE");
  }
  if (line == null) reasons.push("MISSING_LINE");
  if (projection == null) reasons.push("MISSING_PROJECTION");
  if (p == null) reasons.push("MISSING_PROBABILITY");
  if (!options.allowMissingEnvironmentFields) {
    if (fairLine == null) reasons.push("MISSING_FAIR_LINE");
    if (safety == null) reasons.push("MISSING_SAFETY");
    if (!riskOk) reasons.push("MISSING_RISK");
  }

  return {
    ok: reasons.length === 0,
    reasons,
    propType,
  };
}

export function sortGlobalQualityV3(packets = []) {
  return [...(Array.isArray(packets) ? packets : [])].sort(compareQualityDesc);
}

/**
 * Build Home sections from already-mapped display picks.
 * Trusted = Official membership only (caller supplies).
 * Best Available = non-trusted Full, globally ranked (no weave).
 */
export function buildHomeProductTruthSectionsV3(options = {}) {
  const trusted = Array.isArray(options.trusted) ? options.trusted : [];
  const full = Array.isArray(options.full) ? options.full : [];
  const displayMax =
    num(options.bestAvailableDisplayMax) ?? BEST_AVAILABLE_DISPLAY_MAX_DEFAULT;

  const trustedIds = new Set(
    trusted.map((p) => stableKey(p)).filter(Boolean)
  );

  const fullSorted = sortGlobalQualityV3(full).map((p, i) => ({
    ...p,
    fullRank: i + 1,
    homeMembershipSection: trustedIds.has(stableKey(p))
      ? "TRUSTED"
      : "FULL",
    homeWeaveRank: null,
    marketRank: null,
  }));

  const bestAvailablePool = fullSorted.filter(
    (p) => !trustedIds.has(stableKey(p))
  );
  const bestAvailable = bestAvailablePool
    .slice(0, Math.max(0, displayMax))
    .map((p, i) => ({
      ...p,
      bestAvailableRank: i + 1,
      homeMembershipSection: "BEST_AVAILABLE",
    }));

  const byType = (rows) => ({
    POINTS: rows.filter((p) => p.propType === "POINTS").length,
    REBOUNDS: rows.filter((p) => p.propType === "REBOUNDS").length,
    ASSISTS: rows.filter((p) => p.propType === "ASSISTS").length,
  });

  return {
    build: HOME_PRODUCT_TRUTH_SECTIONS_BUILD,
    homeRankAuthority: "global_quality_v3",
    boardSizePolicy: "NO_FORCED_TRUSTED_FILL",
    forcedStatBalance: false,
    forcedHomeVolume: false,
    marketBalancedWeave: false,
    trustedCount: trusted.length,
    bestAvailableCount: bestAvailable.length,
    fullCount: fullSorted.length,
    bestAvailableDisplayMax: displayMax,
    trustedByMarket: byType(trusted),
    bestAvailableByMarket: byType(bestAvailable),
    fullByMarket: byType(fullSorted),
    trusted,
    bestAvailable,
    fullPredictions: fullSorted,
  };
}
