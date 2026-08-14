/**
 * CourtEdge Canonical Frozen Prediction Record V1
 *
 * Compact durable rows consumed by Home / Results / Lab / History / Copy Report.
 * Heavy evidence lives in separate artifacts keyed by canonicalPropId.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  CANONICAL_PROP_ID_BUILD,
  buildCanonicalPropId,
  stampCanonicalIdentity,
  resolveCanonicalPropType,
} from "./courtEdgeCanonicalPropIdV1.js";
import { propTypeStatLabel as labelFromEngine } from "../engines/wnba/propTypeV1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

export const CANONICAL_PREDICTION_BUILD =
  "courteedge-decision-intelligence-single-truth-v1";
export const CANONICAL_PREDICTION_SCHEMA = "canonical-prediction-record-v1";
export const CANONICAL_MEMBERSHIP = Object.freeze({
  OFFICIAL: "OFFICIAL",
  RESEARCH: "RESEARCH",
  REJECTED: "REJECTED",
});

export const DURABLE_CANONICAL_FILE = path.join(
  SERVER_ROOT,
  "canonical-predictions-v1.json"
);
export const DURABLE_EVIDENCE_DIR = path.join(
  SERVER_ROOT,
  "canonical-evidence-v1"
);

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWriteJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  const payload = JSON.stringify(data, null, 2);
  fs.writeFileSync(tmp, payload);

  // Windows: rename over an existing file can EPERM when another process
  // (local API) has the destination open. Retry, then fall back to replace.
  const maxAttempts = 8;
  let lastErr = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      lastErr = err;
      const code = err?.code;
      if (code !== "EPERM" && code !== "EACCES" && code !== "EBUSY") throw err;
      try {
        if (fs.existsSync(file)) fs.unlinkSync(file);
        fs.renameSync(tmp, file);
        return;
      } catch (err2) {
        lastErr = err2;
      }
      // brief backoff
      const waitMs = 40 * attempt;
      const start = Date.now();
      while (Date.now() - start < waitMs) {
        /* spin */
      }
    }
  }
  try {
    fs.copyFileSync(tmp, file);
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    return;
  } catch (err3) {
    throw lastErr || err3;
  }
}

function resolveMembership(input = {}) {
  if (
    input.membership === CANONICAL_MEMBERSHIP.OFFICIAL ||
    input.officialSelected === true ||
    input.immutableOfficial === true ||
    String(input.trackingType || "").toUpperCase() === "OFFICIAL" ||
    String(input.finalDecision || "").toUpperCase() === "OFFICIAL"
  ) {
    return CANONICAL_MEMBERSHIP.OFFICIAL;
  }
  if (
    input.membership === CANONICAL_MEMBERSHIP.REJECTED ||
    String(input.finalDecision || "").toUpperCase() === "REJECTED" ||
    String(input.trackingEligibility || "").toUpperCase() === "NO_BET"
  ) {
    return CANONICAL_MEMBERSHIP.REJECTED;
  }
  if (
    input.membership === CANONICAL_MEMBERSHIP.RESEARCH ||
    String(input.trackingType || "").toUpperCase() === "RESEARCH" ||
    input.boardCandidate === true ||
    input.analysisEligible === true
  ) {
    return CANONICAL_MEMBERSHIP.RESEARCH;
  }
  return CANONICAL_MEMBERSHIP.RESEARCH;
}

function slimSignals(input = {}) {
  const src = input.engineSignals || input.decisionPacket || null;
  if (!src || typeof src !== "object") return null;
  return {
    version: src.version || src.build || src.schemaVersion || null,
    finalSide: src.finalSide || src.side || null,
    confidenceAdjustment: src.confidenceAdjustment ?? src.confDelta ?? null,
    riskAdjustment: src.riskAdjustment ?? src.riskDelta ?? null,
    flags: src.flags || src.signalFlags || null,
    evidenceCoverage: src.evidenceCoverage || input.evidenceCoverage || null,
  };
}

/**
 * Build immutable-at-freeze prediction record. Result fields start empty/pending.
 */
export function buildCanonicalPredictionRecord(input = {}, options = {}) {
  const stamped = stampCanonicalIdentity(input, options);
  const idBuilt = buildCanonicalPropId(stamped, options);
  if (!idBuilt.ok) {
    return {
      ok: false,
      reason: idBuilt.reason || "INCOMPLETE_IDENTITY",
      record: null,
      identity: idBuilt,
    };
  }

  const membership = resolveMembership(stamped);
  const frozenAt = options.frozenAt || stamped.frozenAt || new Date().toISOString();
  const side = String(stamped.side || stamped.pick || stamped.lockedSide || "")
    .toUpperCase()
    .startsWith("UNDER")
    ? "UNDER"
    : "OVER";

  const openingLine = num(
    stamped.openingLine ?? stamped.openLine ?? stamped.marketOpenLine
  );
  const sealedLine = num(
    stamped.sealedLine ?? stamped.officialLine ?? stamped.line
  );
  const currentLine = num(stamped.currentLine ?? sealedLine);

  const marketHistoryIntegrity =
    stamped.marketHistoryIntegrity ||
    (stamped.openingLineUsable === false
      ? "CONTAMINATED_LEGACY_IDENTITY"
      : "OK");
  const openingLineUsable =
    stamped.openingLineUsable === false
      ? false
      : marketHistoryIntegrity === "CONTAMINATED_LEGACY_IDENTITY"
        ? false
        : openingLine != null;

  const record = {
    schema: CANONICAL_PREDICTION_SCHEMA,
    build: CANONICAL_PREDICTION_BUILD,
    canonicalPropId: idBuilt.canonicalPropId,
    league: idBuilt.parts.league,
    slateDateCt: idBuilt.parts.slateDateCt,
    gameId: idBuilt.parts.gameId,
    playerId: stamped.playerId || null,
    playerName: stamped.playerName || stamped.player || null,
    playerCanonicalName: idBuilt.parts.playerCanonicalName,
    team: stamped.team || null,
    opponent: stamped.opponent || null,
    propType: idBuilt.parts.propType,
    marketKey:
      stamped.marketKey ||
      `player_${String(idBuilt.parts.propType).toLowerCase()}`,
    side,
    line: idBuilt.parts.line,

    projection: num(stamped.projection ?? stamped.projectedStat ?? stamped.sportsProjection),
    fairLine: num(stamped.fairLine),
    projectionGap: num(
      stamped.projectionGap ??
        stamped.edge ??
        (num(stamped.projection) != null && num(stamped.line) != null
          ? num(stamped.projection) - num(stamped.line)
          : null)
    ),

    predictedProbability: num(
      stamped.predictedProbability ??
        stamped.rawWinProbability ??
        stamped.winProbability ??
        stamped.reliabilityProbability
    ),
    probabilityCalibrationVersion:
      stamped.probabilityCalibrationVersion ||
      stamped.modelVersions?.probability ||
      null,

    safetyScore: num(stamped.SafetyScore ?? stamped.safetyScore ?? stamped.safety),
    safetyVersion: stamped.safetyVersion || stamped.modelVersions?.safety || null,

    risk: stamped.risk || stamped.v2Risk || stamped.c2Risk || stamped.trueRisk || null,
    riskScore: num(stamped.riskScore ?? stamped.c2RankScore),
    riskVersion: stamped.riskVersion || stamped.modelVersions?.riskV2 || null,

    confidence: num(
      stamped.confidence ?? stamped.finalConfidence ?? stamped.readerConfidence
    ),
    officialRankScore: num(
      stamped.officialRankScore ?? stamped.c2RankScore ?? stamped.rankScore
    ),

    engineSignals: slimSignals(stamped),
    decisionPacket: stamped.decisionPacket
      ? {
          version: stamped.decisionPacket.version || stamped.decisionPacket.build || null,
          finalSide: stamped.decisionPacket.finalSide || null,
          finalConfidence: stamped.decisionPacket.finalConfidence ?? null,
        }
      : null,
    evidenceCoverage: stamped.evidenceCoverage || null,
    evidenceArtifactId: options.persistEvidence
      ? `${idBuilt.canonicalPropId}__evidence`
      : stamped.evidenceArtifactId || null,

    membership,
    officialSelected: membership === CANONICAL_MEMBERSHIP.OFFICIAL,
    officialRank: num(stamped.officialRank ?? stamped.bestSixRank ?? stamped.controlledBestSixRank),

    // Home weave visibility ranks (surfacing only — not scoring authority)
    marketRank: num(stamped.marketRank),
    homeWeaveRank: num(stamped.homeWeaveRank),
    modelWinProbability: num(
      stamped.modelWinProbability ?? stamped.decisionScoreV2
    ),
    decisionScoreV2: num(
      stamped.decisionScoreV2 ?? stamped.modelWinProbability
    ),

    frozenAt,
    marketTimestamp: stamped.marketTimestamp || stamped.pregameTimestamp || null,
    pregameVerified: stamped.pregameVerified !== false,

    openingLine,
    sealedLine,
    currentLine,
    marketHistoryIntegrity,
    openingLineUsable,
    legacyOpeningLineRaw:
      marketHistoryIntegrity === "CONTAMINATED_LEGACY_IDENTITY"
        ? openingLine
        : stamped.legacyOpeningLineRaw ?? null,

    result: {
      status: "PENDING",
      actual: null,
      grade: "PENDING",
      gameFinal: false,
      gradedAt: null,
      gradeSource: null,
      voidReason: null,
    },

    integrity: {
      propIdentityStatus: stamped.propIdentityStatus || (idBuilt.ambiguous ? "AMBIGUOUS_GAME" : "CLEAN"),
      lifecycleStatus: stamped.lifecycleStatus || "ACTIVE",
      evidenceStatus: stamped.evidenceStatus || "PRESENT",
      reconstructionConfidence: options.reconstructionConfidence || "CLEAN",
    },

    // Compatibility mirrors for existing consumers
    officialPropId: stamped.officialPropId || null,
    trackedKey: stamped.trackedKey || null,
    stat: labelFromEngine(idBuilt.parts.propType),
    canonicalPropIdBuild: CANONICAL_PROP_ID_BUILD,
  };

  return { ok: true, record, identity: idBuilt };
}

export function loadCanonicalPredictionStore() {
  const stored = readJSON(DURABLE_CANONICAL_FILE, { version: 1, records: [] });
  const records = Array.isArray(stored?.records)
    ? stored.records
    : Array.isArray(stored)
      ? stored
      : [];
  return {
    version: stored?.version || 1,
    build: stored?.build || CANONICAL_PREDICTION_BUILD,
    updatedAt: stored?.updatedAt || null,
    records,
  };
}

export function saveCanonicalPredictionStore(store) {
  const payload = {
    version: 1,
    build: CANONICAL_PREDICTION_BUILD,
    schema: CANONICAL_PREDICTION_SCHEMA,
    updatedAt: new Date().toISOString(),
    count: (store.records || []).length,
    records: store.records || [],
  };
  atomicWriteJson(DURABLE_CANONICAL_FILE, payload);
  try {
    // Fire-and-forget durable mirror for compact product-truth rows.
    import("./courtEdgeDurableStoreV1.js").then((mod) => {
      mod.syncKeyToDurableFireAndForget?.(
        mod.DURABLE_KEYS.CANONICAL_PREDICTIONS,
        payload
      );
    }).catch(() => {});
  } catch {
    // ignore
  }
  return payload;
}

/**
 * Remove canonical rows for a slate (optionally by membership).
 * Used when rematerializing a corrupted POINTS-only slate with multi-stat truth.
 */
export function purgeCanonicalRecordsForSlate(slateDateCt, options = {}) {
  const membership = options.membership
    ? String(options.membership).toUpperCase()
    : null;
  const store = loadCanonicalPredictionStore();
  const before = store.records.length;
  const records = (store.records || []).filter((r) => {
    if (String(r.slateDateCt || "") !== String(slateDateCt)) return true;
    if (membership && String(r.membership || "").toUpperCase() !== membership) {
      return true;
    }
    return false;
  });
  saveCanonicalPredictionStore({ ...store, records });
  return {
    ok: true,
    slateDateCt,
    membership: membership || "ALL",
    removed: before - records.length,
    remaining: records.length,
  };
}

export function upsertCanonicalPredictionRecords(records = [], options = {}) {
  const store = loadCanonicalPredictionStore();
  const byId = new Map(store.records.map((r) => [r.canonicalPropId, r]));

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const incoming of records) {
    const built =
      incoming?.canonicalPropId && incoming?.schema === CANONICAL_PREDICTION_SCHEMA
        ? { ok: true, record: incoming }
        : buildCanonicalPredictionRecord(incoming, options);
    if (!built.ok || !built.record?.canonicalPropId) {
      skipped += 1;
      continue;
    }
    const id = built.record.canonicalPropId;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, built.record);
      inserted += 1;
      continue;
    }

    // Original frozen prediction values are immutable; only result/integrity may append.
    // Home weave ranks are visibility metadata and may be stamped after freeze.
    const merged = {
      ...existing,
      result: built.record.result?.grade && built.record.result.grade !== "PENDING"
        ? built.record.result
        : existing.result,
      integrity: {
        ...existing.integrity,
        ...built.record.integrity,
      },
      currentLine: built.record.currentLine ?? existing.currentLine,
      marketRank: built.record.marketRank ?? existing.marketRank ?? null,
      homeWeaveRank: built.record.homeWeaveRank ?? existing.homeWeaveRank ?? null,
      modelWinProbability:
        existing.modelWinProbability ?? built.record.modelWinProbability ?? null,
      decisionScoreV2:
        existing.decisionScoreV2 ?? built.record.decisionScoreV2 ?? null,
      homeWeaveBuild: built.record.homeWeaveBuild ?? existing.homeWeaveBuild ?? null,
    };
    // Never overwrite frozen pregame fields.
    byId.set(id, {
      ...merged,
      projection: existing.projection,
      fairLine: existing.fairLine,
      predictedProbability: existing.predictedProbability,
      safetyScore: existing.safetyScore,
      risk: existing.risk,
      confidence: existing.confidence,
      side: existing.side,
      line: existing.line,
      propType: existing.propType,
      membership: existing.membership,
      officialSelected: existing.officialSelected,
      openingLine: existing.openingLine,
      sealedLine: existing.sealedLine,
      marketHistoryIntegrity: existing.marketHistoryIntegrity,
      openingLineUsable: existing.openingLineUsable,
      frozenAt: existing.frozenAt,
    });
    updated += 1;
  }

  const next = {
    ...store,
    records: [...byId.values()].sort((a, b) =>
      String(a.canonicalPropId).localeCompare(String(b.canonicalPropId))
    ),
  };
  saveCanonicalPredictionStore(next);
  return { ok: true, inserted, updated, skipped, total: next.records.length };
}

export function appendCanonicalResult(canonicalPropId, resultPatch = {}) {
  const store = loadCanonicalPredictionStore();
  const idx = store.records.findIndex((r) => r.canonicalPropId === canonicalPropId);
  if (idx < 0) {
    return { ok: false, message: "canonicalPropId not found" };
  }
  const existing = store.records[idx];
  const nextResult = {
    ...existing.result,
    ...resultPatch,
    gradedAt: resultPatch.gradedAt || new Date().toISOString(),
  };
  store.records[idx] = {
    ...existing,
    result: nextResult,
    integrity: {
      ...existing.integrity,
      lifecycleStatus:
        ["WIN", "LOSS", "PUSH", "VOID"].includes(String(nextResult.grade || "").toUpperCase())
          ? "GRADED"
          : existing.integrity?.lifecycleStatus || "ACTIVE",
    },
  };
  saveCanonicalPredictionStore(store);
  return { ok: true, record: store.records[idx] };
}

/**
 * Apply many result patches in one load/save cycle (avoids Windows EPERM
 * from dozens of atomic renames while the API holds the file open).
 */
export function batchAppendCanonicalResults(patches = []) {
  const store = loadCanonicalPredictionStore();
  const byId = new Map(store.records.map((r, i) => [r.canonicalPropId, i]));
  let updated = 0;
  let missing = 0;
  const records = [...store.records];

  for (const patch of patches) {
    const id = patch?.canonicalPropId;
    if (!id || !byId.has(id)) {
      missing += 1;
      continue;
    }
    const idx = byId.get(id);
    const existing = records[idx];
    const nextResult = {
      ...existing.result,
      ...patch.result,
      gradedAt: patch.result?.gradedAt || new Date().toISOString(),
    };
    records[idx] = {
      ...existing,
      result: nextResult,
      integrity: {
        ...existing.integrity,
        lifecycleStatus: ["WIN", "LOSS", "PUSH", "VOID"].includes(
          String(nextResult.grade || "").toUpperCase()
        )
          ? "GRADED"
          : existing.integrity?.lifecycleStatus || "ACTIVE",
      },
    };
    updated += 1;
  }

  saveCanonicalPredictionStore({ ...store, records });
  return { ok: true, updated, missing, total: records.length };
}

export function getCanonicalRecordsBySlate(slateDateCt, options = {}) {
  const store = loadCanonicalPredictionStore();
  let rows = store.records.filter((r) => r.slateDateCt === slateDateCt);
  if (options.membership) {
    rows = rows.filter((r) => r.membership === options.membership);
  }
  if (options.propType) {
    const pt = String(options.propType).toUpperCase();
    rows = rows.filter((r) => r.propType === pt);
  }
  return rows;
}

export function toProductTruthCard(record = {}) {
  if (!record?.canonicalPropId) return null;
  return {
    canonicalPropId: record.canonicalPropId,
    league: record.league,
    slateDateCt: record.slateDateCt,
    gameId: record.gameId,
    player: record.playerName,
    playerId: record.playerId,
    team: record.team,
    opponent: record.opponent,
    propType: record.propType,
    stat: record.stat || labelFromEngine(record.propType) || record.propType,
    side: record.side,
    line: record.line,
    projection: record.projection,
    fairLine: record.fairLine,
    predictedProbability: record.predictedProbability,
    modelWinProbability:
      record.modelWinProbability ??
      record.decisionScoreV2 ??
      record.predictedProbability ??
      null,
    decisionScoreV2: record.decisionScoreV2 ?? record.modelWinProbability ?? null,
    normalizedProjectionStrength: record.normalizedProjectionStrength ?? null,
    marketRank: record.marketRank ?? null,
    homeWeaveRank: record.homeWeaveRank ?? null,
    safetyScore: record.safetyScore,
    risk: record.risk,
    confidence: record.confidence,
    officialRankScore: record.officialRankScore,
    membership: record.membership,
    officialSelected: record.officialSelected,
    officialRank: record.officialRank,
    engineSignals: record.engineSignals,
    openingLine: record.openingLineUsable ? record.openingLine : null,
    sealedLine: record.sealedLine,
    currentLine: record.currentLine,
    marketHistoryIntegrity: record.marketHistoryIntegrity,
    openingLineUsable: record.openingLineUsable,
    result: record.result,
    integrity: record.integrity,
    decision: record.membership,
    actual: record.result?.actual ?? null,
    grade: record.result?.grade ?? "PENDING",
    status: String(record.result?.grade || "PENDING").toLowerCase(),
    gameFinal: Boolean(record.result?.gameFinal),
  };
}

export function markContaminatedMarketHistory(canonicalPropId, legacyOpeningLine = null) {
  const store = loadCanonicalPredictionStore();
  const idx = store.records.findIndex((r) => r.canonicalPropId === canonicalPropId);
  if (idx < 0) return { ok: false };
  const row = store.records[idx];
  store.records[idx] = {
    ...row,
    marketHistoryIntegrity: "CONTAMINATED_LEGACY_IDENTITY",
    openingLineUsable: false,
    legacyOpeningLineRaw:
      legacyOpeningLine != null ? legacyOpeningLine : row.openingLine ?? row.legacyOpeningLineRaw,
  };
  saveCanonicalPredictionStore(store);
  return { ok: true, record: store.records[idx] };
}

export { resolveCanonicalPropType };
