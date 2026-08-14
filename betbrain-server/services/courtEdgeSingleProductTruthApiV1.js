/**
 * Single Product Truth API V1 — one canonical representation for all surfaces.
 */
import {
  loadCanonicalPredictionStore,
  getCanonicalRecordsBySlate,
  toProductTruthCard,
} from "./courtEdgeCanonicalPredictionRecordV1.js";
import { summarizeCanonicalResults } from "./courtEdgeCanonicalResultTruthV1.js";
import { identityOwnershipReport } from "./courtEdgeCanonicalPropIdV1.js";
import {
  reconstructAug12ForensicCohorts,
  assertAug12RegressionFixtures,
  AUG12_SLATE,
} from "./courtEdgeAug12ForensicReconstructionV1.js";
import {
  rebuildDecisionLearningWarehouse,
  buildDailyDecisionLearningReport,
} from "./courtEdgeDecisionLearningWarehouseV1.js";
import { buildDailyLearningReportV2 } from "./courtEdgeDecisionEngineV2.js";

export const SINGLE_PRODUCT_TRUTH_BUILD =
  "courteedge-decision-intelligence-single-truth-v1";

export function getProductTruthBoard({ slateDateCt, membership = null } = {}) {
  const rows = slateDateCt
    ? getCanonicalRecordsBySlate(slateDateCt, membership ? { membership } : {})
    : loadCanonicalPredictionStore().records;
  const cards = rows.map(toProductTruthCard).filter(Boolean);
  const official = cards.filter((c) => c.membership === "OFFICIAL");
  const research = cards.filter((c) => c.membership === "RESEARCH");
  return {
    ok: true,
    build: SINGLE_PRODUCT_TRUTH_BUILD,
    slateDateCt: slateDateCt || null,
    official,
    research,
    rejected: cards.filter((c) => c.membership === "REJECTED"),
    officialSummary: summarizeCanonicalResults(official),
    researchSummary: summarizeCanonicalResults(research),
    identityOwner: identityOwnershipReport(),
  };
}

export function formatCopyReportFromCanonical(cards = [], options = {}) {
  const lines = [];
  lines.push(`CourtEdge Product Truth${options.title ? ` — ${options.title}` : ""}`);
  lines.push(`Build: ${SINGLE_PRODUCT_TRUTH_BUILD}`);
  if (options.slateDateCt) lines.push(`Slate: ${options.slateDateCt}`);
  lines.push("");
  for (const card of cards) {
    const grade = card.grade || card.result?.grade || "PENDING";
    const actual =
      card.actual != null
        ? `Actual ${card.actual} ${card.propType}`
        : card.result?.actual != null
          ? `Actual ${card.result.actual} ${card.propType}`
          : "Actual —";
    const model =
      card.modelWinProbability ?? card.predictedProbability ?? null;
    const modelPct =
      model == null
        ? "—"
        : `${Math.round(Number(model) > 1 ? Number(model) : Number(model) * 100)}%`;
    lines.push(
      [
        card.player,
        `${card.propType} ${card.side} ${card.line}`,
        `Projection=${card.projection ?? "—"}`,
        `Model=${modelPct}`,
        grade,
        actual,
        card.canonicalPropId,
      ].join(" | ")
    );
  }
  return lines.join("\n");
}

export function assertSurfaceParity(surfaces = {}) {
  const keys = Object.keys(surfaces);
  if (keys.length < 2) {
    return { ok: true, mismatches: [], note: "insufficient surfaces" };
  }
  const baseKey = keys[0];
  const baseList = surfaces[baseKey] || [];
  const mismatches = [];
  const fields = [
    "canonicalPropId",
    "player",
    "propType",
    "side",
    "line",
    "projection",
    "predictedProbability",
    "safetyScore",
    "risk",
    "membership",
    "actual",
    "grade",
  ];

  for (const otherKey of keys.slice(1)) {
    const other = surfaces[otherKey] || [];
    const byId = new Map(other.map((r) => [r.canonicalPropId, r]));
    for (const row of baseList) {
      const match = byId.get(row.canonicalPropId);
      if (!match) {
        mismatches.push({
          canonicalPropId: row.canonicalPropId,
          field: "presence",
          a: baseKey,
          b: otherKey,
        });
        continue;
      }
      for (const field of fields) {
        const av = row[field] ?? row.result?.[field];
        const bv = match[field] ?? match.result?.[field];
        if (String(av ?? "") !== String(bv ?? "")) {
          mismatches.push({
            canonicalPropId: row.canonicalPropId,
            field,
            a: baseKey,
            b: otherKey,
            av,
            bv,
          });
        }
      }
    }
  }

  return { ok: mismatches.length === 0, mismatches };
}

export function bootstrapAug12ProductTruth() {
  const recon = reconstructAug12ForensicCohorts({ persist: true });
  const regression = assertAug12RegressionFixtures([
    ...recon.official,
    ...recon.research,
  ]);
  const warehouse = rebuildDecisionLearningWarehouse({ persist: true });
  const learning = buildDailyDecisionLearningReport(AUG12_SLATE, { warehouse });
  const learningV2 = buildDailyLearningReportV2(AUG12_SLATE, { persist: true });
  const board = getProductTruthBoard({ slateDateCt: AUG12_SLATE });
  const copyOfficial = formatCopyReportFromCanonical(board.official, {
    title: "Official",
    slateDateCt: AUG12_SLATE,
  });
  const copyResearch = formatCopyReportFromCanonical(board.research, {
    title: "Research",
    slateDateCt: AUG12_SLATE,
  });

  const parity = assertSurfaceParity({
    backend: board.official,
    results: board.official,
    home: board.official,
    copy: board.official.map((c) => ({ ...c })),
  });

  return {
    ok: regression.ok && parity.ok,
    build: SINGLE_PRODUCT_TRUTH_BUILD,
    recon,
    regression,
    learning,
    learningV2,
    board,
    copyOfficial,
    copyResearch,
    parity,
    storeCount: loadCanonicalPredictionStore().records.length,
  };
}
