/**
 * CourtEdge Single Machine / Control-Plane Consolidation V1
 *
 * One owner per decision. Immutable product contract — not env-switched.
 */
export const CONTROL_PLANE_BUILD =
  "courteedge-single-machine-control-plane-v1-safer-side";

export const CONTROL_PLANE_CONTRACT = Object.freeze({
  pipeline: [
    "INTEGRITY",
    "DIRECTION_CHOOSE_SIDE",
    "C2_RISK",
    "SAFEST_2_TO_6_SELECTOR",
    "SEAL",
  ],
  directionMode: "EDUCATED_GUESS",
  directionAdmissions: ["PRIMARY", "BEST_GUESS"],
  /** On Direction NO_BET: C2 both sides, keep safer tier/rank. */
  bestGuessSidePolicy: "DUAL_C2_SAFER_SIDE",
  c2Role: "RISK_AND_RANKING",
  c2Freeze: "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
  officialPolicy: "SAFEST_2_TO_6",
  highPolicy: "MINIMUM_2_FILL_ONLY",
  /** BEST_GUESS+HIGH only fills min-2 after PRIMARY HIGH is exhausted. */
  highFillAdmissionPreference: "PRIMARY_BEFORE_BEST_GUESS",
  legacyBestSixAuthority: false,
  teamQuota: false,
  sideQuota: false,
  clientOfficialRebuild: false,
  trackingTypes: ["OFFICIAL", "RESEARCH"],
});

/** Hard-coded Official board bounds — not env-tunable. */
export const OFFICIAL_BOARD_MIN = 2;
export const OFFICIAL_BOARD_MAX = 6;

export const HIGH_POLICY = "MINIMUM_2_FILL_ONLY";

export function getOfficialBoardSizePolicy() {
  return {
    min: OFFICIAL_BOARD_MIN,
    max: OFFICIAL_BOARD_MAX,
    policy: "SAFEST_2_TO_6",
    highPolicy: HIGH_POLICY,
  };
}

export function directionConfidenceRank(confidence = null) {
  const c = String(confidence || "NONE").toUpperCase();
  if (c === "STRONG") return 3;
  if (c === "STANDARD") return 2;
  if (c === "WEAK") return 1;
  return 0;
}

/**
 * Existing C2 calibrated ranking signal — not a new formula.
 * Prefer reliabilityProbability; fall back to trustScore/100.
 */
export function resolveC2RankScore(packet = {}) {
  const rel = Number(
    packet.reliabilityProbability ?? packet.risk?.reliabilityProbability
  );
  if (Number.isFinite(rel)) return rel;
  const trust = Number(packet.trustScore ?? packet.risk?.trustScore);
  if (Number.isFinite(trust)) return trust / 100;
  const safety = Number(packet.safety?.finalSafetyScore);
  if (Number.isFinite(safety)) return safety / 100;
  return 0;
}

export function resolveAbsoluteDirectionalEdge(packet = {}) {
  const side = String(packet.selectedSide || packet.boardSide || "").toUpperCase();
  const sidePkt =
    side === "OVER"
      ? packet.overPacket
      : side === "UNDER"
        ? packet.underPacket
        : null;
  const edge = Number(
    sidePkt?.projectionEdge ??
      packet.projectionEdge ??
      packet.edge ??
      packet.selectedSideEdge
  );
  return Number.isFinite(edge) ? Math.abs(edge) : 0;
}

export function stableMarketId(packet = {}) {
  const propType = String(
    packet.propType ||
      packet.canonicalPropType ||
      packet.stat ||
      packet.marketType ||
      "POINTS"
  )
    .toUpperCase()
    .replace(/PLAYER_/g, "");
  const normalizedProp =
    propType.includes("REBOUND")
      ? "REBOUNDS"
      : propType.includes("ASSIST")
        ? "ASSISTS"
        : propType.includes("POINT") || propType === "PTS"
          ? "POINTS"
          : propType || "POINTS";
  return [
    packet.playerId || packet.player_id || "",
    String(packet.playerName || packet.player || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, ""),
    packet.eventId || packet.gameId || "",
    normalizedProp,
    packet.selectedSide || packet.boardSide || "",
    packet.line ?? packet.selectedLine ?? "",
  ].join("|");
}
