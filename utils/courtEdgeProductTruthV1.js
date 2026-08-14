/**
 * Client single-product-truth helpers.
 * Display-only: never recompute actual / grade / propType / side / line.
 */

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
    // Prefer Decision Engine V2 — do not fall back to legacy sealed priors
    // (those can read 97% and mislead the primary copy line).
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
  return {
    canonicalPropId: pick.canonicalPropId || null,
    player: pick.player || pick.playerName || null,
    propType,
    side: String(pick.side || pick.pick || "").toUpperCase() || null,
    line: pick.line ?? pick.sealedLine ?? pick.officialLine ?? null,
    projection: pick.projection ?? pick.correctedProjection ?? null,
    modelWinProbability,
    predictedProbability: modelWinProbability,
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
  const actual =
    view.actual != null ? `Actual ${view.actual} ${view.propType}` : "Actual —";
  const modelPct =
    view.modelWinProbability == null
      ? "—"
      : `${Math.round(Number(view.modelWinProbability) * 100)}%`;
  return [
    view.player,
    `${view.propType} ${view.side} ${view.line}`,
    `Projection=${view.projection ?? "—"}`,
    `Model=${modelPct}`,
    view.grade || "PENDING",
    actual,
  ].join(" | ");
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
