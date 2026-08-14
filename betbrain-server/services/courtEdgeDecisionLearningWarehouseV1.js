/**
 * Decision Learning Warehouse V1 + calibration / winners-left-behind reports.
 * Shadow-first: never auto-promotes a new live calibration.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  loadCanonicalPredictionStore,
  toProductTruthCard,
} from "./courtEdgeCanonicalPredictionRecordV1.js";
import { summarizeCanonicalResults } from "./courtEdgeCanonicalResultTruthV1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const WAREHOUSE_FILE = path.join(SERVER_ROOT, "decision-learning-warehouse-v1.json");

export const DECISION_LEARNING_BUILD =
  "courteedge-decision-intelligence-single-truth-v1";

export const LEARNING_LANES = Object.freeze({
  CLEAN_PROSPECTIVE: "CLEAN_PROSPECTIVE",
  HISTORICAL_REPLAY: "HISTORICAL_REPLAY",
  FORENSIC: "FORENSIC",
});

function atomicWriteJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function laneForRecord(record = {}) {
  const conf = String(record.integrity?.reconstructionConfidence || "CLEAN").toUpperCase();
  if (conf === "FORENSIC") return LEARNING_LANES.FORENSIC;
  if (conf === "HISTORICAL_REPLAY" || conf === "RECOVERED") {
    return LEARNING_LANES.HISTORICAL_REPLAY;
  }
  return LEARNING_LANES.CLEAN_PROSPECTIVE;
}

export function buildLearningRow(record = {}) {
  const actual = num(record.result?.actual);
  const projection = num(record.projection);
  const projectionError =
    actual == null || projection == null ? null : actual - projection;
  return {
    canonicalPropId: record.canonicalPropId,
    slateDateCt: record.slateDateCt,
    propType: record.propType,
    side: record.side,
    line: record.line,
    projection,
    projectionError,
    absoluteError:
      projectionError == null ? null : Math.abs(projectionError),
    probability: num(record.predictedProbability),
    safetyScore: num(record.safetyScore),
    risk: record.risk,
    confidence: num(record.confidence),
    officialRankScore: num(record.officialRankScore),
    signalBundle: record.engineSignals || null,
    membership: record.membership,
    actual,
    grade: record.result?.grade || "PENDING",
    lane: laneForRecord(record),
    marketHistoryIntegrity: record.marketHistoryIntegrity,
    openingLineUsable: record.openingLineUsable,
  };
}

export function rebuildDecisionLearningWarehouse(options = {}) {
  const store = loadCanonicalPredictionStore();
  const rows = (store.records || []).map(buildLearningRow);
  const payload = {
    version: 1,
    build: DECISION_LEARNING_BUILD,
    updatedAt: new Date().toISOString(),
    count: rows.length,
    lanes: {
      CLEAN_PROSPECTIVE: rows.filter((r) => r.lane === LEARNING_LANES.CLEAN_PROSPECTIVE).length,
      HISTORICAL_REPLAY: rows.filter((r) => r.lane === LEARNING_LANES.HISTORICAL_REPLAY).length,
      FORENSIC: rows.filter((r) => r.lane === LEARNING_LANES.FORENSIC).length,
    },
    rows,
  };
  if (options.persist !== false) atomicWriteJson(WAREHOUSE_FILE, payload);
  return payload;
}

function mae(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return null;
  return Number((xs.reduce((s, v) => s + Math.abs(v), 0) / xs.length).toFixed(4));
}

function bias(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return null;
  return Number((xs.reduce((s, v) => s + v, 0) / xs.length).toFixed(4));
}

function rmse(values) {
  const xs = values.filter((v) => Number.isFinite(v));
  if (!xs.length) return null;
  return Number(
    Math.sqrt(xs.reduce((s, v) => s + v * v, 0) / xs.length).toFixed(4)
  );
}

function median(values) {
  const xs = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Number(((xs[mid - 1] + xs[mid]) / 2).toFixed(4));
}

function brier(rows) {
  const scored = rows.filter(
    (r) =>
      Number.isFinite(r.probability) &&
      (r.grade === "WIN" || r.grade === "LOSS")
  );
  if (!scored.length) return null;
  let sum = 0;
  for (const r of scored) {
    const outcome = r.grade === "WIN" ? 1 : 0;
    const p = Math.min(1, Math.max(0, Number(r.probability) > 1 ? Number(r.probability) / 100 : Number(r.probability)));
    sum += (p - outcome) ** 2;
  }
  return Number((sum / scored.length).toFixed(4));
}

export function calibrateByPropType(rows = [], options = {}) {
  const lane = options.lane || null;
  const scoped = lane ? rows.filter((r) => r.lane === lane) : rows;
  const out = {};
  for (const propType of ["POINTS", "REBOUNDS", "ASSISTS"]) {
    const subset = scoped.filter((r) => r.propType === propType);
    const graded = subset.filter((r) => ["WIN", "LOSS", "PUSH", "VOID"].includes(r.grade));
    const summary = summarizeCanonicalResults(
      graded.map((r) => ({ result: { grade: r.grade } }))
    );
    const errors = subset.map((r) => r.projectionError).filter((v) => v != null);
    out[propType] = {
      n: subset.length,
      graded: summary,
      projectionMAE: mae(errors),
      projectionBias: bias(errors),
      medianAbsError: median(errors.map((e) => Math.abs(e))),
      rmse: rmse(errors),
      brier: brier(subset),
      lane: lane || "ALL",
    };
  }
  return out;
}

export function buildWinnersLeftBehind(rows = [], options = {}) {
  const slateDateCt = options.slateDateCt || null;
  const scoped = slateDateCt
    ? rows.filter((r) => r.slateDateCt === slateDateCt)
    : rows;
  const officialCutoff = Math.min(
    ...scoped
      .filter((r) => r.membership === "OFFICIAL" && Number.isFinite(r.officialRankScore))
      .map((r) => r.officialRankScore),
    Infinity
  );
  return scoped
    .filter((r) => r.membership !== "OFFICIAL" && r.grade === "WIN")
    .map((r) => ({
      ...r,
      officialCutoffDistance:
        Number.isFinite(officialCutoff) && Number.isFinite(r.officialRankScore)
          ? Number((officialCutoff - r.officialRankScore).toFixed(4))
          : null,
      rejectionGate: "NON_OFFICIAL_MEMBERSHIP",
    }));
}

export function buildLosersAdmitted(rows = [], options = {}) {
  const slateDateCt = options.slateDateCt || null;
  const scoped = slateDateCt
    ? rows.filter((r) => r.slateDateCt === slateDateCt)
    : rows;
  const alternatives = scoped.filter((r) => r.membership !== "OFFICIAL");
  return scoped
    .filter((r) => r.membership === "OFFICIAL" && r.grade === "LOSS")
    .map((r) => {
      const betterAlts = alternatives
        .filter(
          (a) =>
            a.propType === r.propType &&
            Number.isFinite(a.officialRankScore) &&
            Number.isFinite(r.officialRankScore) &&
            a.officialRankScore > r.officialRankScore
        )
        .slice(0, 5);
      return {
        ...r,
        whyOutrankedAlternatives:
          "Official membership selected on pregame rank/gates; alternatives listed by higher officialRankScore only (no outcome features).",
        higherRankedAlternativesPregame: betterAlts.map((a) => ({
          canonicalPropId: a.canonicalPropId,
          playerHint: a.canonicalPropId,
          officialRankScore: a.officialRankScore,
          probability: a.probability,
          risk: a.risk,
          safetyScore: a.safetyScore,
        })),
      };
    });
}

/**
 * Gate effectiveness — REPORT ONLY. Does not loosen thresholds.
 */
export function auditGateEffectiveness(rows = [], gateHits = []) {
  // gateHits: [{canonicalPropId, gate, blocked:true}]
  const byGate = {};
  for (const hit of gateHits || []) {
    const g = hit.gate || "UNKNOWN";
    if (!byGate[g]) {
      byGate[g] = {
        blocked: 0,
        blockedWins: 0,
        blockedLosses: 0,
        byPropType: { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 },
      };
    }
    byGate[g].blocked += 1;
    const row = rows.find((r) => r.canonicalPropId === hit.canonicalPropId);
    if (row?.grade === "WIN") byGate[g].blockedWins += 1;
    if (row?.grade === "LOSS") byGate[g].blockedLosses += 1;
    if (row?.propType && byGate[g].byPropType[row.propType] != null) {
      byGate[g].byPropType[row.propType] += 1;
    }
  }

  for (const g of Object.keys(byGate)) {
    const e = byGate[g];
    e.netUsefulness = e.blockedLosses - e.blockedWins;
    e.note =
      "Report-only. Do not loosen because a single slate lost. Test Points-era thresholds on REB/AST separately.";
  }
  return byGate;
}

export function buildShadowCalibrationComparison(rows = []) {
  // Shadow selector: prefer higher probability then higher safety, excluding contaminated opening-line influence.
  const eligible = rows.filter(
    (r) =>
      r.openingLineUsable !== false &&
      r.marketHistoryIntegrity !== "CONTAMINATED_LEGACY_IDENTITY"
  );
  const bySlate = new Map();
  for (const r of eligible) {
    if (!bySlate.has(r.slateDateCt)) bySlate.set(r.slateDateCt, []);
    bySlate.get(r.slateDateCt).push(r);
  }

  const comparisons = [];
  for (const [slateDateCt, slateRows] of bySlate.entries()) {
    const currentOfficial = slateRows.filter((r) => r.membership === "OFFICIAL");
    const shadow = [...slateRows]
      .sort((a, b) => {
        const ap = num(a.probability) || 0;
        const bp = num(b.probability) || 0;
        if (bp !== ap) return bp - ap;
        return (num(b.safetyScore) || 0) - (num(a.safetyScore) || 0);
      })
      .slice(0, Math.max(2, currentOfficial.length || 2));

    const currentSummary = summarizeCanonicalResults(
      currentOfficial.map((r) => ({ result: { grade: r.grade } }))
    );
    const shadowSummary = summarizeCanonicalResults(
      shadow.map((r) => ({ result: { grade: r.grade } }))
    );

    comparisons.push({
      slateDateCt,
      currentOfficialCount: currentOfficial.length,
      shadowOfficialCount: shadow.length,
      currentHitRate: currentSummary.hitRate,
      shadowHitRate: shadowSummary.hitRate,
      winnerCaptureShadow: shadow.filter((r) => r.grade === "WIN").length,
      loserAdmissionShadow: shadow.filter((r) => r.grade === "LOSS").length,
      mode: "SHADOW",
      livePromotion: false,
    });
  }

  return {
    build: DECISION_LEARNING_BUILD,
    policy: "SHADOW_ONLY_NO_LIVE_PROMOTE",
    comparisons,
  };
}

export function buildDailyDecisionLearningReport(slateDateCt, options = {}) {
  const warehouse = options.warehouse || rebuildDecisionLearningWarehouse({ persist: false });
  const rows = warehouse.rows || [];
  const slateRows = rows.filter((r) => r.slateDateCt === slateDateCt);
  const official = slateRows.filter((r) => r.membership === "OFFICIAL");
  const research = slateRows.filter((r) => r.membership === "RESEARCH");

  return {
    build: DECISION_LEARNING_BUILD,
    slateDateCt,
    officialSummary: summarizeCanonicalResults(
      official.map((r) => ({ result: { grade: r.grade } }))
    ),
    researchSummary: summarizeCanonicalResults(
      research.map((r) => ({ result: { grade: r.grade } }))
    ),
    calibrationByPropType: {
      forensic: calibrateByPropType(slateRows, { lane: LEARNING_LANES.FORENSIC }),
      all: calibrateByPropType(slateRows),
    },
    winnersLeftBehind: buildWinnersLeftBehind(slateRows, { slateDateCt }),
    losersAdmitted: buildLosersAdmitted(slateRows, { slateDateCt }),
    shadowComparison: buildShadowCalibrationComparison(slateRows),
    cards: slateRows.map((r) => {
      const full = (loadCanonicalPredictionStore().records || []).find(
        (x) => x.canonicalPropId === r.canonicalPropId
      );
      return full ? toProductTruthCard(full) : r;
    }),
  };
}
