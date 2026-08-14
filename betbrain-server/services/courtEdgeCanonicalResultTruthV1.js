/**
 * CourtEdge Canonical Result Truth V1 — SINGLE grading/result owner.
 *
 * Allowed grades: WIN | LOSS | PUSH | VOID | PENDING | UNRESOLVED
 * Clients display this object; they must not recompute actual/grade/gameFinal.
 */
import {
  appendCanonicalResult,
  loadCanonicalPredictionStore,
  upsertCanonicalPredictionRecords,
} from "./courtEdgeCanonicalPredictionRecordV1.js";
import { buildCanonicalPropId } from "./courtEdgeCanonicalPropIdV1.js";

export const CANONICAL_RESULT_BUILD =
  "courteedge-decision-intelligence-single-truth-v1";

export const CANONICAL_GRADES = Object.freeze([
  "WIN",
  "LOSS",
  "PUSH",
  "VOID",
  "PENDING",
  "UNRESOLVED",
]);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeGrade(value = "") {
  const g = String(value || "").trim().toUpperCase();
  if (CANONICAL_GRADES.includes(g)) return g;
  const legacy = String(value || "").trim().toLowerCase();
  if (legacy === "win") return "WIN";
  if (legacy === "loss") return "LOSS";
  if (legacy === "push") return "PUSH";
  if (legacy === "void" || legacy === "dnp") return "VOID";
  if (legacy === "pending") return "PENDING";
  if (legacy === "unresolved") return "UNRESOLVED";
  return null;
}

/**
 * Pure grade from side/line/actual. Does not invent missing actuals.
 */
export function gradeFromActual({ side, line, actual } = {}) {
  const s = String(side || "").toUpperCase();
  const ln = num(line);
  const act = num(actual);
  if (act == null || ln == null || (!s.startsWith("OVER") && !s.startsWith("UNDER"))) {
    return { grade: "PENDING", reason: "MISSING_ACTUAL_OR_LINE" };
  }
  if (act === ln) return { grade: "PUSH", reason: "HIT_LINE" };
  if (s.startsWith("OVER")) {
    return { grade: act > ln ? "WIN" : "LOSS", reason: "OVER_COMPARE" };
  }
  return { grade: act < ln ? "WIN" : "LOSS", reason: "UNDER_COMPARE" };
}

export function buildCanonicalResultObject(patch = {}) {
  const grade = normalizeGrade(patch.grade || patch.status) || "PENDING";
  return {
    status: grade,
    actual: patch.actual == null ? null : num(patch.actual),
    grade,
    gameFinal: Boolean(patch.gameFinal),
    gradedAt: patch.gradedAt || null,
    gradeSource: patch.gradeSource || null,
    voidReason: patch.voidReason || null,
    unresolvedReason: patch.unresolvedReason || null,
    build: CANONICAL_RESULT_BUILD,
  };
}

/**
 * Append/overwrite result on canonical store. Never invents actual.
 */
export function writeCanonicalResult(canonicalPropId, patch = {}) {
  if (!canonicalPropId) {
    return { ok: false, message: "canonicalPropId required" };
  }

  let grade = normalizeGrade(patch.grade || patch.status);
  if (!grade && patch.actual != null && patch.side != null && patch.line != null) {
    grade = gradeFromActual(patch).grade;
  }
  if (!grade) grade = patch.gameFinal ? "UNRESOLVED" : "PENDING";

  if (grade === "UNRESOLVED" && !patch.unresolvedReason && !patch.voidReason) {
    patch.unresolvedReason = patch.reason || "AUTHORITATIVE_FINAL_WITHOUT_SAFE_STAT";
  }

  const result = buildCanonicalResultObject({
    ...patch,
    grade,
    status: grade,
    gradedAt: patch.gradedAt || new Date().toISOString(),
  });

  return appendCanonicalResult(canonicalPropId, result);
}

/**
 * Sync a tracked-style row into canonical result truth (by identity).
 */
export function syncTrackedRowIntoCanonicalResult(row = {}, options = {}) {
  const idBuilt = buildCanonicalPropId(row, options);
  if (!idBuilt.ok) {
    return { ok: false, reason: "INCOMPLETE_IDENTITY", identity: idBuilt };
  }

  // Ensure prediction row exists (research/official) without rewriting freeze fields.
  upsertCanonicalPredictionRecords([row], {
    ...options,
    reconstructionConfidence: options.reconstructionConfidence || "RECOVERED",
  });

  const status = String(row.status || "").toLowerCase();
  const gameFinal = Boolean(row.resolveDebug?.gameFinal || row.gameFinal);
  const actual = row.actual ?? row.actualStat ?? row.resolveDebug?.actual ?? null;

  if (["win", "loss", "push"].includes(status) && actual != null) {
    return writeCanonicalResult(idBuilt.canonicalPropId, {
      grade: status.toUpperCase(),
      actual,
      gameFinal: true,
      gradeSource: options.gradeSource || "TRACKED_SYNC",
      side: row.side || row.pick,
      line: row.line,
    });
  }

  if (gameFinal && actual == null) {
    return writeCanonicalResult(idBuilt.canonicalPropId, {
      grade: "UNRESOLVED",
      actual: null,
      gameFinal: true,
      gradeSource: options.gradeSource || "TRACKED_SYNC",
      unresolvedReason:
        row.pendingReason ||
        "GAME_FINAL_WITHOUT_PLAYER_STAT",
    });
  }

  return writeCanonicalResult(idBuilt.canonicalPropId, {
    grade: "PENDING",
    actual: null,
    gameFinal: false,
    gradeSource: options.gradeSource || "TRACKED_SYNC",
  });
}

export function getCanonicalResultById(canonicalPropId) {
  const store = loadCanonicalPredictionStore();
  const row = store.records.find((r) => r.canonicalPropId === canonicalPropId);
  if (!row) return null;
  return {
    canonicalPropId: row.canonicalPropId,
    propType: row.propType,
    side: row.side,
    line: row.line,
    playerName: row.playerName,
    membership: row.membership,
    result: row.result,
  };
}

export function summarizeCanonicalResults(rows = []) {
  const out = { WIN: 0, LOSS: 0, PUSH: 0, VOID: 0, PENDING: 0, UNRESOLVED: 0 };
  for (const row of rows) {
    const g = normalizeGrade(row.result?.grade || row.grade || row.status) || "PENDING";
    out[g] = (out[g] || 0) + 1;
  }
  const decided = out.WIN + out.LOSS;
  return {
    ...out,
    hitRate: decided ? Number(((out.WIN / decided) * 100).toFixed(1)) : null,
    n: rows.length,
  };
}
