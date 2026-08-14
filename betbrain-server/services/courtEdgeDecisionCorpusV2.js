/**
 * Expanded CLEAN learning corpus for Decision Engine V2.
 * Chronological rows with PRE-GAME features only (labels attached post-hoc).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { rebuildDecisionLearningWarehouse } from "./courtEdgeDecisionLearningWarehouseV1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

export const DECISION_CORPUS_BUILD = "courteedge-decision-engine-v2-corpus";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normPropType(raw) {
  const s = String(raw || "POINTS").toUpperCase();
  if (s.includes("ASSIST") || s === "AST") return "ASSISTS";
  if (s.includes("REBOUND") || s === "REB") return "REBOUNDS";
  return "POINTS";
}

function normSide(raw) {
  const s = String(raw || "").toUpperCase();
  if (s.startsWith("U")) return "UNDER";
  if (s.startsWith("O")) return "OVER";
  return null;
}

function normGrade(raw) {
  const s = String(raw || "").toUpperCase();
  if (s === "WIN" || s === "W") return "WIN";
  if (s === "LOSS" || s === "L" || s === "LOSE") return "LOSS";
  if (s === "PUSH" || s === "P") return "PUSH";
  if (s === "VOID" || s === "V") return "VOID";
  if (s === "PENDING") return "PENDING";
  return s || "PENDING";
}

function rowKey(row) {
  return [
    row.slateDateCt,
    String(row.player || "").toLowerCase().replace(/\s+/g, "-"),
    row.propType,
    row.side,
    row.line,
  ].join("|");
}

function baseRow(partial) {
  const projection = num(partial.projection);
  const line = num(partial.line);
  const actual = num(partial.actual);
  const side = normSide(partial.side);
  const propType = normPropType(partial.propType);
  const signedGap =
    projection == null || line == null || !side
      ? null
      : side === "OVER"
        ? projection - line
        : line - projection;
  return {
    slateDateCt: partial.slateDateCt || null,
    player: partial.player || null,
    propType,
    side,
    line,
    projection,
    actual,
    grade: normGrade(partial.grade),
    membership: partial.membership || null,
    officialSelected: Boolean(partial.officialSelected),
    probability: num(partial.probability),
    safetyScore: num(partial.safetyScore),
    risk: partial.risk || null,
    expectedMinutes: num(partial.expectedMinutes),
    bookCount: num(partial.bookCount),
    reliabilityProbability: num(partial.reliabilityProbability),
    officialRankScore: num(partial.officialRankScore),
    signedGap,
    projectionError:
      actual == null || projection == null ? null : actual - projection,
    source: partial.source || "UNKNOWN",
    lane: partial.lane || "HISTORICAL_REPLAY",
    marketHistoryIntegrity: partial.marketHistoryIntegrity || "OK",
    openingLineUsable: partial.openingLineUsable !== false,
  };
}

function loadHistoryArchiveRows() {
  const dir = path.join(SERVER_ROOT, "history-archive");
  if (!fs.existsSync(dir)) return [];
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  const out = [];
  for (const file of files) {
    const slateDateCt = file.replace(/\.json$/, "");
    let payload;
    try {
      payload = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    } catch {
      continue;
    }
    for (const p of payload.props || []) {
      const membership = String(
        p.trackingType || (p.officialSelected ? "OFFICIAL" : "RESEARCH")
      ).toUpperCase();
      out.push(
        baseRow({
          slateDateCt,
          player: p.player || p.playerName,
          propType: p.propType || p.stat || "POINTS",
          side: p.lockedSide || p.currentEngineSide || p.pick || p.side,
          line: p.line ?? p.sealedLine ?? p.currentLine,
          projection: p.projection,
          actual: p.actualStat ?? p.actual,
          grade: p.status,
          membership: membership === "TEST" ? "RESEARCH" : membership,
          officialSelected:
            membership === "OFFICIAL" || p.officialSelected === true,
          probability:
            Number(p.confidence) > 1
              ? Number(p.confidence) / 100
              : p.confidence ?? p.rawWinProbability,
          safetyScore: p.safetyScore ?? p.SafetyScore,
          risk: p.c2Risk || p.trueRisk || p.riskLabel,
          expectedMinutes: p.expectedMinutes,
          bookCount: p.bookCount,
          reliabilityProbability: p.reliabilityProbability,
          officialRankScore: p.officialRankScore ?? p.c2RankScore,
          source: "history-archive",
          lane: "CLEAN_PROSPECTIVE",
        })
      );
    }
  }
  return out;
}

function loadRecoveredRejectedRows() {
  const file = path.join(
    SERVER_ROOT,
    "research/empirical-safe-prop-v2/exports/COURTEDGE_RECOVERED_REJECTED_GRADED_V2.json"
  );
  if (!fs.existsSync(file)) return [];
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const out = [];
  for (const r of payload.records || []) {
    if (r.contaminated === true) continue;
    out.push(
      baseRow({
        slateDateCt: r.slateDateCT || r.slateDateCt,
        player: r.playerName || r.player,
        propType: "POINTS",
        side: r.selectedSide || r.side,
        line: r.line,
        projection: r.originalProjection ?? r.projection,
        actual: r.actualPoints ?? r.actual,
        grade: r.result,
        membership: r.wasOfficialOnHomeDay ? "OFFICIAL" : "RESEARCH",
        officialSelected: Boolean(r.wasOfficialOnHomeDay || r.originalSelectedOfficial),
        probability: null,
        expectedMinutes: r.avgMinutesL5,
        bookCount: r.bookCount,
        source: "recovered-rejected-graded-v2",
        lane: "HISTORICAL_REPLAY",
      })
    );
  }
  return out;
}

function loadGoldDatasetRows() {
  const file = path.join(
    SERVER_ROOT,
    "research/courteedge-gold-learning-v1/COURTEDGE_GOLD_DATASET_V1.json"
  );
  if (!fs.existsSync(file)) return [];
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  const out = [];
  for (const r of payload.rows || []) {
    out.push(
      baseRow({
        slateDateCt: r.date || r.slateDateCt,
        player: r.players || r.player,
        propType: "POINTS",
        side: r.predictedSide || r.side,
        line: r.marketLine ?? r.line,
        projection: r.projectedTotal ?? r.projection,
        actual: r.actualPoints ?? r.actual,
        grade: r.result,
        membership: r.trackingType || (r.officialSelected ? "OFFICIAL" : "RESEARCH"),
        officialSelected: Boolean(r.officialSelected),
        probability: r.predictedProbability,
        safetyScore: r.Safety,
        risk: r.RiskV2,
        reliabilityProbability: r.Reliability,
        source: "gold-dataset-v1",
        lane: "CLEAN_PROSPECTIVE",
      })
    );
  }
  return out;
}

function loadWarehouseRows() {
  let warehouse;
  try {
    warehouse = rebuildDecisionLearningWarehouse({ persist: false });
  } catch {
    return [];
  }
  return (warehouse.rows || []).map((r) =>
    baseRow({
      slateDateCt: r.slateDateCt,
      player: String(r.canonicalPropId || "").split("|")[3] || null,
      propType: r.propType,
      side: r.side,
      line: r.line,
      projection: r.projection,
      actual: r.actual,
      grade: r.grade,
      membership: r.membership,
      officialSelected: r.membership === "OFFICIAL",
      probability: r.probability,
      safetyScore: r.safetyScore,
      risk: r.risk,
      officialRankScore: r.officialRankScore,
      source: "decision-learning-warehouse-v1",
      lane: r.lane || "FORENSIC",
      marketHistoryIntegrity: r.marketHistoryIntegrity,
      openingLineUsable: r.openingLineUsable,
    })
  );
}

function loadStaticResidualPriors() {
  const load = (rel) => {
    const file = path.join(SERVER_ROOT, rel);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return null;
    }
  };
  const reb = load(
    "research/courteedge-gold-learning-v1/reb-ast-historical-calibration-v1/rebounds-projection-calibration.json"
  );
  const ast = load(
    "research/courteedge-gold-learning-v1/reb-ast-historical-calibration-v1/assists-projection-calibration.json"
  );
  return {
    REBOUNDS: reb?.overall
      ? {
          n: reb.overall.n,
          mae: reb.overall.mae,
          bias: reb.overall.signedBias,
          rmse: reb.overall.rmse,
          source: "rebounds-projection-calibration",
        }
      : null,
    ASSISTS: ast?.overall
      ? {
          n: ast.overall.n,
          mae: ast.overall.mae,
          bias: ast.overall.signedBias,
          rmse: ast.overall.rmse,
          source: "assists-projection-calibration",
        }
      : null,
  };
}

/**
 * Deduped chronological corpus. Prefer CLEAN_PROSPECTIVE over FORENSIC when keys collide.
 */
export function buildDecisionCorpusV2(options = {}) {
  const laneRank = {
    CLEAN_PROSPECTIVE: 3,
    HISTORICAL_REPLAY: 2,
    FORENSIC: 1,
  };
  const merged = new Map();
  const streams = [
    ...loadHistoryArchiveRows(),
    ...loadGoldDatasetRows(),
    ...loadRecoveredRejectedRows(),
    ...loadWarehouseRows(),
  ];
  for (const row of streams) {
    if (!row.slateDateCt || !row.side || row.line == null || row.projection == null) {
      continue;
    }
    const key = rowKey(row);
    const prev = merged.get(key);
    if (!prev || (laneRank[row.lane] || 0) > (laneRank[prev.lane] || 0)) {
      merged.set(key, row);
    }
  }
  const rows = [...merged.values()].sort((a, b) => {
    if (a.slateDateCt !== b.slateDateCt) {
      return String(a.slateDateCt).localeCompare(String(b.slateDateCt));
    }
    return String(a.player || "").localeCompare(String(b.player || ""));
  });
  const graded = rows.filter((r) => r.grade === "WIN" || r.grade === "LOSS");
  const byProp = { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 };
  const gradedByProp = { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 };
  for (const r of rows) {
    if (byProp[r.propType] != null) byProp[r.propType] += 1;
  }
  for (const r of graded) {
    if (gradedByProp[r.propType] != null) gradedByProp[r.propType] += 1;
  }
  const payload = {
    version: 2,
    build: DECISION_CORPUS_BUILD,
    updatedAt: new Date().toISOString(),
    count: rows.length,
    gradedCount: graded.length,
    byPropType: byProp,
    gradedByPropType: gradedByProp,
    dates: [...new Set(rows.map((r) => r.slateDateCt))].sort(),
    residualPriors: loadStaticResidualPriors(),
    rows,
  };
  if (options.persist) {
    const out = path.join(SERVER_ROOT, "decision-learning-corpus-v2.json");
    fs.writeFileSync(out, JSON.stringify(payload, null, 2));
    payload.persistedTo = out;
  }
  return payload;
}

export function loadDecisionCorpusV2(options = {}) {
  const file = path.join(SERVER_ROOT, "decision-learning-corpus-v2.json");
  if (!options.rebuild && fs.existsSync(file)) {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      /* rebuild */
    }
  }
  return buildDecisionCorpusV2({ persist: options.persist !== false });
}
