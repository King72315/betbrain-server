/**
 * Grade recoverable Aug 12 Research candidates from ESPN box scores.
 * No Odds remint. Preserves POINTS/REB/AST identity.
 */
import {
  getCanonicalRecordsBySlate,
  loadCanonicalPredictionStore,
} from "./courtEdgeCanonicalPredictionRecordV1.js";
import {
  writeCanonicalResult,
  gradeFromActual,
} from "./courtEdgeCanonicalResultTruthV1.js";
import {
  AUG12_SLATE,
  reconstructAug12ForensicCohorts,
} from "./courtEdgeAug12ForensicReconstructionV1.js";
import {
  rebuildDecisionLearningWarehouse,
  buildDailyDecisionLearningReport,
  auditGateEffectiveness,
  calibrateByPropType,
  LEARNING_LANES,
} from "./courtEdgeDecisionLearningWarehouseV1.js";
import { PROP_TYPE_TO_BOX_FIELD } from "../engines/wnba/propTypeV1.js";

export const AUG12_RESEARCH_GRADING_BUILD =
  "courteedge-product-truth-ui-cutover-v1";

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard";
const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary";

function clean(v = "") {
  return String(v || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function boxFieldForPropType(propType = "") {
  const pt = String(propType || "").toUpperCase();
  return PROP_TYPE_TO_BOX_FIELD[pt] || null;
}

function extractStat(map = {}, propType = "") {
  const field = boxFieldForPropType(propType);
  if (!field) return null;
  const key =
    field === "points"
      ? "PTS"
      : field === "rebounds"
        ? "REB"
        : field === "assists"
          ? "AST"
          : null;
  if (!key) return null;
  const raw = map[key];
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function fetchEspnPlayerBoxMap(slateDateCt = AUG12_SLATE) {
  const ymd = String(slateDateCt).replace(/-/g, "");
  const sb = await fetch(`${ESPN_SCOREBOARD}?dates=${ymd}`).then((r) => r.json());
  const byPlayer = new Map();

  for (const event of sb.events || []) {
    const completed = Boolean(event?.status?.type?.completed);
    const summary = await fetch(`${ESPN_SUMMARY}?event=${event.id}`).then((r) =>
      r.json()
    );
    for (const teamBlock of summary.boxscore?.players || []) {
      for (const statGroup of teamBlock.statistics || []) {
        const labels = statGroup.labels || statGroup.names || [];
        for (const athlete of statGroup.athletes || []) {
          const name = athlete.athlete?.displayName || athlete.athlete?.fullName;
          if (!name) continue;
          const stats = athlete.stats || [];
          const map = {};
          labels.forEach((lab, i) => {
            map[String(lab).toUpperCase()] = stats[i];
          });
          byPlayer.set(clean(name), {
            name,
            map,
            gameFinal: completed,
            eventId: event.id,
            eventName: event.name,
          });
        }
      }
    }
  }
  return byPlayer;
}

function findPlayerBox(byPlayer, playerName = "") {
  const key = clean(playerName);
  if (byPlayer.has(key)) return byPlayer.get(key);
  for (const [k, v] of byPlayer.entries()) {
    if (k.includes(key) || key.includes(k)) return v;
  }
  // last-token match
  const token = key.slice(-8);
  for (const [k, v] of byPlayer.entries()) {
    if (token && k.endsWith(token)) return v;
  }
  return null;
}

export async function gradeAug12ResearchCandidates(options = {}) {
  // Ensure cohorts exist.
  reconstructAug12ForensicCohorts({ persist: true });
  const slateDateCt = options.slateDateCt || AUG12_SLATE;
  const research = getCanonicalRecordsBySlate(slateDateCt, {
    membership: "RESEARCH",
  });
  const official = getCanonicalRecordsBySlate(slateDateCt, {
    membership: "OFFICIAL",
  });

  const byPlayer = await fetchEspnPlayerBoxMap(slateDateCt);
  const graded = [];
  const unresolved = [];

  for (const row of research) {
    const box = findPlayerBox(byPlayer, row.playerName);
    if (!box) {
      const written = writeCanonicalResult(row.canonicalPropId, {
        grade: "UNRESOLVED",
        actual: null,
        gameFinal: false,
        unresolvedReason: "PLAYER_NOT_FOUND_IN_ESPN_BOX",
        gradeSource: AUG12_RESEARCH_GRADING_BUILD,
      });
      unresolved.push({
        canonicalPropId: row.canonicalPropId,
        playerName: row.playerName,
        propType: row.propType,
        reason: "PLAYER_NOT_FOUND_IN_ESPN_BOX",
        record: written.record,
      });
      continue;
    }

    if (!box.gameFinal) {
      const written = writeCanonicalResult(row.canonicalPropId, {
        grade: "PENDING",
        actual: null,
        gameFinal: false,
        gradeSource: AUG12_RESEARCH_GRADING_BUILD,
      });
      unresolved.push({
        canonicalPropId: row.canonicalPropId,
        playerName: row.playerName,
        reason: "GAME_NOT_FINAL",
        record: written.record,
      });
      continue;
    }

    const actual = extractStat(box.map, row.propType);
    if (actual == null) {
      // DNP / missing stat line
      const dnp = box.map.MIN === "0" || box.map.MIN === "0:00" || !box.map.MIN;
      const written = writeCanonicalResult(row.canonicalPropId, {
        grade: dnp ? "VOID" : "UNRESOLVED",
        actual: null,
        gameFinal: true,
        voidReason: dnp ? "DNP_OR_ZERO_MINUTES" : "STAT_MISSING_IN_BOX",
        unresolvedReason: dnp ? null : "STAT_MISSING_IN_BOX",
        gradeSource: AUG12_RESEARCH_GRADING_BUILD,
      });
      unresolved.push({
        canonicalPropId: row.canonicalPropId,
        playerName: row.playerName,
        propType: row.propType,
        reason: dnp ? "VOID_DNP" : "STAT_MISSING",
        record: written.record,
      });
      continue;
    }

    const g = gradeFromActual({
      side: row.side,
      line: row.line,
      actual,
    });
    const written = writeCanonicalResult(row.canonicalPropId, {
      grade: g.grade,
      actual,
      gameFinal: true,
      gradeSource: "ESPN_BOXSCORE_RESEARCH",
      side: row.side,
      line: row.line,
    });
    graded.push({
      canonicalPropId: row.canonicalPropId,
      playerName: row.playerName,
      propType: row.propType,
      side: row.side,
      line: row.line,
      actual,
      grade: g.grade,
      record: written.record,
    });
  }

  const warehouse = rebuildDecisionLearningWarehouse({ persist: true });
  const learning = buildDailyDecisionLearningReport(slateDateCt, { warehouse });

  // Gate effectiveness placeholder from engineSignals.failurePaths when present.
  const gateHits = [];
  for (const row of [...official, ...research]) {
    const paths = row.engineSignals?.failurePaths || [];
    for (const gate of paths) {
      gateHits.push({
        canonicalPropId: row.canonicalPropId,
        gate: typeof gate === "string" ? gate : gate?.code || String(gate),
        blocked: row.membership !== "OFFICIAL",
      });
    }
  }

  const report = {
    build: AUG12_RESEARCH_GRADING_BUILD,
    slateDateCt,
    officialSummary: learning.officialSummary,
    researchSummary: learning.researchSummary,
    byPropType: calibrateByPropType(
      (warehouse.rows || []).filter((r) => r.slateDateCt === slateDateCt)
    ),
    byPropTypeForensic: calibrateByPropType(
      (warehouse.rows || []).filter((r) => r.slateDateCt === slateDateCt),
      { lane: LEARNING_LANES.FORENSIC }
    ),
    winnersLeftBehind: learning.winnersLeftBehind,
    losersAdmitted: learning.losersAdmitted,
    gateEffectiveness: auditGateEffectiveness(warehouse.rows || [], gateHits),
    riskBuckets: bucketBy(warehouse.rows.filter((r) => r.slateDateCt === slateDateCt), "risk"),
    safetyBuckets: bucketSafety(
      warehouse.rows.filter((r) => r.slateDateCt === slateDateCt)
    ),
    probabilityBuckets: bucketProbability(
      warehouse.rows.filter((r) => r.slateDateCt === slateDateCt)
    ),
    winnerRejectionReasons: (learning.winnersLeftBehind || []).map((w) => ({
      canonicalPropId: w.canonicalPropId,
      propType: w.propType,
      side: w.side,
      line: w.line,
      grade: w.grade,
      officialRankScore: w.officialRankScore,
      probability: w.probability,
      risk: w.risk,
      safetyScore: w.safetyScore,
      exactReasonNotOfficial:
        w.rejectionGate ||
        "NON_OFFICIAL_MEMBERSHIP — selector did not admit to Official on pregame rank/gates",
    })),
    shadowComparison: learning.shadowComparison,
    gradedResearchCount: graded.length,
    unresolvedResearchCount: unresolved.length,
    graded,
    unresolved,
    noModelRetune: true,
    shadowRecommendationsOnly: true,
  };

  return {
    ok: true,
    gradedCount: graded.length,
    unresolvedCount: unresolved.length,
    officialCount: official.length,
    researchCount: research.length,
    storeCount: loadCanonicalPredictionStore().records.length,
    report,
  };
}

function bucketBy(rows, key) {
  const out = {};
  for (const r of rows) {
    const k = String(r[key] || "UNKNOWN").toUpperCase();
    if (!out[k]) out[k] = { n: 0, WIN: 0, LOSS: 0, PUSH: 0, PENDING: 0, UNRESOLVED: 0, VOID: 0 };
    out[k].n += 1;
    const g = String(r.grade || "PENDING").toUpperCase();
    if (out[k][g] != null) out[k][g] += 1;
  }
  return out;
}

function bucketSafety(rows) {
  const bands = {
    "0-49": { n: 0, WIN: 0, LOSS: 0 },
    "50-69": { n: 0, WIN: 0, LOSS: 0 },
    "70-84": { n: 0, WIN: 0, LOSS: 0 },
    "85-100": { n: 0, WIN: 0, LOSS: 0 },
    UNKNOWN: { n: 0, WIN: 0, LOSS: 0 },
  };
  for (const r of rows) {
    const s = Number(r.safetyScore);
    let band = "UNKNOWN";
    if (Number.isFinite(s)) {
      if (s < 50) band = "0-49";
      else if (s < 70) band = "50-69";
      else if (s < 85) band = "70-84";
      else band = "85-100";
    }
    bands[band].n += 1;
    if (r.grade === "WIN") bands[band].WIN += 1;
    if (r.grade === "LOSS") bands[band].LOSS += 1;
  }
  return bands;
}

function bucketProbability(rows) {
  const bands = {
    "<0.50": { n: 0, WIN: 0, LOSS: 0 },
    "0.50-0.59": { n: 0, WIN: 0, LOSS: 0 },
    "0.60-0.69": { n: 0, WIN: 0, LOSS: 0 },
    "0.70+": { n: 0, WIN: 0, LOSS: 0 },
    UNKNOWN: { n: 0, WIN: 0, LOSS: 0 },
  };
  for (const r of rows) {
    let p = Number(r.probability);
    if (Number.isFinite(p) && p > 1) p = p / 100;
    let band = "UNKNOWN";
    if (Number.isFinite(p)) {
      if (p < 0.5) band = "<0.50";
      else if (p < 0.6) band = "0.50-0.59";
      else if (p < 0.7) band = "0.60-0.69";
      else band = "0.70+";
    }
    bands[band].n += 1;
    if (r.grade === "WIN") bands[band].WIN += 1;
    if (r.grade === "LOSS") bands[band].LOSS += 1;
  }
  return bands;
}
