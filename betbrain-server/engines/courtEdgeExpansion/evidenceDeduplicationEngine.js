/**
 * CourtEdge Engine Expansion — Evidence Deduplication Engine.
 *
 * Takes the full set of engine signals and the calibration weights for the
 * given league, then:
 *   - groups engines per calibration group (see calibrationV1.js)
 *   - suppresses duplicate/correlated votes WITHIN a group (diminishing
 *     weight for additional same-direction signals in the same group)
 *   - caps confidence/risk contribution per engine, per group, and overall
 *   - preserves every raw signal untouched in the ledger for audit
 *
 * This engine never mutates the engine signals it receives — it only reads
 * them and produces a capped/deduped ledger for the orchestrator.
 */
import { getCalibration } from "./calibrationV1.js";
import {
  num,
  clamp,
  qualityMultiplier,
  normalizeLeague,
  RISK_ADJUSTMENT,
} from "./shared.js";

export const EVIDENCE_DEDUPLICATION_ENGINE = "evidenceDeduplicationEngine";

const RISK_ORDINAL = Object.freeze({
  [RISK_ADJUSTMENT.REDUCE]: -1,
  [RISK_ADJUSTMENT.NEUTRAL]: 0,
  [RISK_ADJUSTMENT.MONITOR]: 1,
  [RISK_ADJUSTMENT.ELEVATE]: 2,
});

// Diminishing multiplier applied to same-direction signals within a group,
// ranked by |weightedSignal| descending. First signal keeps full weight.
const SAME_DIRECTION_DIMINISHING = [1, 0.6, 0.35, 0.2, 0.1];

function riskLabelFromScore(score) {
  if (score >= 2) return RISK_ADJUSTMENT.ELEVATE;
  if (score >= 1) return RISK_ADJUSTMENT.MONITOR;
  if (score <= -1) return RISK_ADJUSTMENT.REDUCE;
  return RISK_ADJUSTMENT.NEUTRAL;
}

export function evaluateEvidenceDeduplication(ctx = {}, engineSignals = {}) {
  const league = normalizeLeague(ctx.league);
  const calibration = getCalibration(league);
  const ledger = [];
  const groups = {};

  for (const [engineKey, engineCfg] of Object.entries(calibration.engines)) {
    const signal = engineSignals[engineKey];
    const group = engineCfg.group;
    if (!groups[group]) {
      groups[group] = {
        group,
        engines: [],
        rawWeightedSignalSum: 0,
        cappedWeightedSignalSum: 0,
        rawConfidenceSum: 0,
        cappedConfidenceSum: 0,
        riskScoreSum: 0,
        cappedRiskScoreSum: 0,
      };
    }

    if (!signal) {
      ledger.push({
        engine: engineKey,
        group,
        included: false,
        reason: "engine_signal_not_provided",
      });
      continue;
    }

    if (!signal.available) {
      ledger.push({
        engine: engineKey,
        group,
        included: false,
        available: false,
        reason: signal.reason || "unavailable",
        rawNormalizedSignal: 0,
      });
      continue;
    }

    const qMul = qualityMultiplier(signal.quality);
    const fallbackMul = signal.fallbackUsed ? 0.75 : 1;
    const engineWeight = num(engineCfg.weight, 0);

    const rawNormalizedSignal = num(signal.normalizedSignal, 0);
    const weightedSignal = Number((rawNormalizedSignal * engineWeight * qMul * fallbackMul).toFixed(4));

    const rawConfidenceAdjustment = clamp(
      num(signal.confidenceAdjustment, 0),
      -engineCfg.confidenceCap,
      engineCfg.confidenceCap
    );
    const weightedConfidenceAdjustment = Number(
      (rawConfidenceAdjustment * qMul * fallbackMul).toFixed(3)
    );

    const riskScore = RISK_ORDINAL[signal.riskAdjustment] ?? 0;

    groups[group].engines.push({
      engine: engineKey,
      weight: engineWeight,
      quality: signal.quality,
      qualityMultiplier: qMul,
      fallbackUsed: Boolean(signal.fallbackUsed),
      rawNormalizedSignal,
      weightedSignal,
      rawConfidenceAdjustment,
      weightedConfidenceAdjustment,
      riskAdjustment: signal.riskAdjustment,
      riskScore,
    });
  }

  // --- Suppress duplicate same-direction signals within each group ---
  for (const group of Object.values(groups)) {
    const sameSignEntries = group.engines.filter((e) => e.weightedSignal !== 0);
    const sortedBySign = {
      positive: sameSignEntries.filter((e) => e.weightedSignal > 0).sort((a, b) => Math.abs(b.weightedSignal) - Math.abs(a.weightedSignal)),
      negative: sameSignEntries.filter((e) => e.weightedSignal < 0).sort((a, b) => Math.abs(b.weightedSignal) - Math.abs(a.weightedSignal)),
    };

    for (const bucket of [sortedBySign.positive, sortedBySign.negative]) {
      bucket.forEach((entry, rank) => {
        const diminish = SAME_DIRECTION_DIMINISHING[Math.min(rank, SAME_DIRECTION_DIMINISHING.length - 1)];
        entry.dedupedSignal = Number((entry.weightedSignal * diminish).toFixed(4));
        entry.dedupedConfidenceAdjustment = Number((entry.weightedConfidenceAdjustment * diminish).toFixed(3));
        entry.duplicateRank = rank;
        entry.suppressed = diminish < 1;
      });
    }
    // Entries with weightedSignal === 0 still contribute confidence/risk (e.g. availability engine).
    for (const entry of group.engines) {
      if (entry.dedupedSignal === undefined) {
        entry.dedupedSignal = 0;
        entry.dedupedConfidenceAdjustment = entry.weightedConfidenceAdjustment;
        entry.duplicateRank = 0;
        entry.suppressed = false;
      }
    }

    group.rawWeightedSignalSum = Number(
      group.engines.reduce((s, e) => s + e.weightedSignal, 0).toFixed(4)
    );
    group.cappedWeightedSignalSum = Number(
      group.engines.reduce((s, e) => s + e.dedupedSignal, 0).toFixed(4)
    );
    group.rawConfidenceSum = Number(
      group.engines.reduce((s, e) => s + e.weightedConfidenceAdjustment, 0).toFixed(3)
    );

    const groupCap = calibration.groupCaps[group.group] || { confidenceCap: 6, riskCap: 8 };
    const dedupedConfidenceSum = group.engines.reduce((s, e) => s + e.dedupedConfidenceAdjustment, 0);
    group.cappedConfidenceSum = Number(
      clamp(dedupedConfidenceSum, -groupCap.confidenceCap, groupCap.confidenceCap).toFixed(3)
    );
    group.groupConfidenceCapApplied = Math.abs(dedupedConfidenceSum) > groupCap.confidenceCap;

    group.riskScoreSum = group.engines.reduce((s, e) => s + e.riskScore, 0);
    const riskCapOrdinal = 2; // ELEVATE is the maximum ordinal per engine-group regardless of stacking
    group.cappedRiskScoreSum = clamp(group.riskScoreSum, -1, riskCapOrdinal);
    group.groupRiskCapApplied = group.riskScoreSum > riskCapOrdinal;

    for (const e of group.engines) {
      ledger.push({
        engine: e.engine,
        group: group.group,
        included: true,
        available: true,
        weight: e.weight,
        quality: e.quality,
        qualityMultiplier: e.qualityMultiplier,
        fallbackUsed: e.fallbackUsed,
        rawNormalizedSignal: e.rawNormalizedSignal,
        weightedSignal: e.weightedSignal,
        dedupedSignal: e.dedupedSignal,
        suppressed: e.suppressed,
        duplicateRank: e.duplicateRank,
        rawConfidenceAdjustment: e.rawConfidenceAdjustment,
        dedupedConfidenceAdjustment: e.dedupedConfidenceAdjustment,
        riskAdjustment: e.riskAdjustment,
        riskScore: e.riskScore,
      });
    }
  }

  // --- Totals across all groups, capped at the calibration's overall caps ---
  const rawSignalTotal = Object.values(groups).reduce((s, g) => s + g.rawWeightedSignalSum, 0);
  const netSignalTotal = Object.values(groups).reduce((s, g) => s + g.cappedWeightedSignalSum, 0);
  const rawConfidenceTotal = Object.values(groups).reduce((s, g) => s + g.rawConfidenceSum, 0);
  const cappedConfidenceTotal = clamp(
    Object.values(groups).reduce((s, g) => s + g.cappedConfidenceSum, 0),
    -calibration.totalConfidenceCap,
    calibration.totalConfidenceCap
  );
  const totalConfidenceCapApplied =
    Math.abs(Object.values(groups).reduce((s, g) => s + g.cappedConfidenceSum, 0)) >
    calibration.totalConfidenceCap;

  const riskScoreTotalRaw = Object.values(groups).reduce((s, g) => s + g.cappedRiskScoreSum, 0);
  const riskScoreTotal = clamp(riskScoreTotalRaw, -1, calibration.totalRiskScoreCap);
  const riskAdjustment = riskLabelFromScore(riskScoreTotal);

  const overWeight = Object.values(groups).reduce(
    (s, g) => s + g.engines.reduce((gs, e) => gs + Math.max(0, e.dedupedSignal), 0),
    0
  );
  const underWeight = Object.values(groups).reduce(
    (s, g) => s + g.engines.reduce((gs, e) => gs + Math.max(0, -e.dedupedSignal), 0),
    0
  );

  const totalEngineCount = Object.keys(calibration.engines).length;
  const availableEngineCount = ledger.filter((l) => l.available).length;
  const votingEngineCount = ledger.filter((l) => l.available && l.dedupedSignal !== 0).length;

  return {
    version: "courtedge-evidence-dedup-v1",
    league,
    ledger,
    groups,
    totals: {
      rawSignalTotal: Number(rawSignalTotal.toFixed(4)),
      netSignalTotal: Number(netSignalTotal.toFixed(4)),
      rawConfidenceTotal: Number(rawConfidenceTotal.toFixed(3)),
      confidenceAdjustment: Number(cappedConfidenceTotal.toFixed(3)),
      totalConfidenceCapApplied,
      riskScoreTotal,
      riskAdjustment,
      overWeight: Number(overWeight.toFixed(4)),
      underWeight: Number(underWeight.toFixed(4)),
      availableEngineCount,
      votingEngineCount,
      totalEngineCount,
      coveragePct: Number(((availableEngineCount / totalEngineCount) * 100).toFixed(1)),
    },
  };
}
