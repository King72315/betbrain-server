import { formatFullPropDetailPacket } from "./courtEdgeFullPropDetailCopyV1.js";

export const PRODUCT_TRUTH_CLIENT_BUILD =
  "courteedge-decision-intelligence-single-truth-v1";

export function readCanonicalPropType(pick = {}) {
  const raw =
    pick.propType ||
    pick.canonicalPropType ||
    pick.marketType ||
    pick.stat ||
    pick.market ||
    "";
  const s = String(raw || "").trim().toUpperCase();
  if (s.includes("ASSIST") || s === "AST") return "ASSISTS";
  if (s.includes("REBOUND") || s === "REB") return "REBOUNDS";
  if (s.includes("POINT") || s === "PTS") return "POINTS";
  return null;
}

export function toProductTruthView(pick = {}) {
  const propType = readCanonicalPropType(pick);
  const result = pick.result || {};
  const grade = String(
    result.grade || pick.grade || pick.status || "PENDING"
  ).toUpperCase();
  const modelWinProbability = (() => {
    // Prefer Decision Engine V2 stored score for ranking/display Model %.
    // Do not fall back to legacy sealed priors (those can read 97%).
    const raw =
      pick.modelWinProbability ??
      pick.decisionScoreV2 ??
      pick.calibratedWinProbability ??
      null;
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n > 1 ? n / 100 : n;
  })();
  const storedPredicted = (() => {
    const raw = pick.predictedProbability;
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n > 1 ? n / 100 : n;
  })();
  return {
    ...pick,
    canonicalPropId: pick.canonicalPropId || null,
    player: pick.player || pick.playerName || null,
    propType,
    side: String(pick.side || pick.pick || "").toUpperCase() || null,
    line: pick.line ?? pick.sealedLine ?? pick.officialLine ?? null,
    projection: pick.projection ?? null,
    modelWinProbability,
    predictedProbability: storedPredicted,
    decisionScoreV2: pick.decisionScoreV2 ?? modelWinProbability,
    safetyScore: pick.safetyScore ?? pick.SafetyScore ?? null,
    risk: pick.risk || pick.trueRisk || pick.c2Risk || null,
    membership:
      pick.membership ||
      (pick.officialSelected || pick.immutableOfficial
        ? "OFFICIAL"
        : pick.trackingType || null),
    actual: result.actual ?? pick.actual ?? null,
    grade,
    gameFinal: Boolean(result.gameFinal ?? pick.gameFinal),
    decision: pick.membership || pick.trackingType || null,
    game: pick.game || null,
  };
}

export function formatProductTruthCopyLine(view = {}) {
  return formatFullPropDetailPacket(view, 1);
}

export function assertClientBackendParity(backendCard = {}, clientPick = {}) {
  const a = toProductTruthView(backendCard);
  const b = toProductTruthView(clientPick);
  const fields = [
    "canonicalPropId",
    "player",
    "propType",
    "side",
    "line",
    "actual",
    "grade",
  ];
  const mismatches = [];
  for (const field of fields) {
    if (String(a[field] ?? "") !== String(b[field] ?? "")) {
      mismatches.push({ field, backend: a[field], client: b[field] });
    }
  }
  return { ok: mismatches.length === 0, mismatches, build: PRODUCT_TRUTH_CLIENT_BUILD };
}
