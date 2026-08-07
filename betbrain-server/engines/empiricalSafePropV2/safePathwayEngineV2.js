/**
 * courtEdgeSafePropPathwayEngineV2
 * Multiple historically-supported safe profiles (OR routes).
 * Pathway alone cannot admit without reliability floors in classifyRisk.
 */
import {
  PATHWAY_MODEL_VERSION,
  RISK_THRESHOLDS_V2,
  SAFE_PATHWAY_IDS,
} from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function hit(id, tier, score, evidence, warnings = []) {
  return {
    id,
    safePathway: id,
    tier,
    pathwayMatched: true,
    pathwayScore: score,
    pathwayEvidence: evidence,
    pathwayWarnings: warnings,
    description: id,
  };
}

/**
 * Evaluate named pathways A–E. Returns ranked pathway hits.
 */
export function evaluateSafePropPathwaysV2(ctx = {}) {
  const edge = num(ctx.projectionEdge);
  const mins = num(ctx.minutesStability);
  const role = num(ctx.roleStability);
  const p = num(ctx.rawWinProbability);
  const books = num(ctx.bookCount);
  const mkt = num(ctx.marketQuality);
  const conflict = num(ctx.conflictIndex, 0);
  const rel = num(ctx.reliabilityProbability);
  const fails = num(ctx.majorFailurePathCount, 0);
  const safety = num(ctx.SafetyScore);
  const sideU = String(ctx.side || "").toUpperCase();
  const volumeStability = num(ctx.volumeStability ?? ctx.fgaStability);
  const usageStability = num(ctx.usageStability);
  const pathways = [];

  // PATHWAY A — STABLE_HIGH_EDGE
  if (
    edge != null &&
    edge >= 4.0 &&
    mins != null &&
    mins >= 80 &&
    (role == null || role >= 65) &&
    conflict <= 15 &&
    fails <= 1 &&
    p != null &&
    p >= 0.62
  ) {
    const evidence = [
      `projection edge ${edge.toFixed(1)}`,
      `minutes stability ${mins}`,
      role == null ? "role unknown (not treated as unstable)" : `role stability ${role}`,
      `conflict ${conflict}`,
    ];
    const warnings = [];
    if (books != null && books <= 2) warnings.push("thin book count (soft)");
    pathways.push(
      hit("STABLE_HIGH_EDGE", "LOW_CANDIDATE", 88, evidence, warnings)
    );
  }

  // PATHWAY B — STRUCTURAL_UNDER
  if (
    sideU.startsWith("UNDER") &&
    edge != null &&
    edge >= 3.0 &&
    mins != null &&
    mins >= 75 &&
    p != null &&
    p >= 0.62 &&
    conflict <= 20 &&
    fails <= 1
  ) {
    const evidence = [
      "UNDER side with model edge",
      `edge ${edge.toFixed(1)}`,
      `minutes stability ${mins}`,
      "limited upside paths implied by projection vs line",
    ];
    if (volumeStability != null && volumeStability >= 70) {
      evidence.push(`volume stability ${volumeStability}`);
    }
    pathways.push(
      hit("STRUCTURAL_UNDER", "MEDIUM_CANDIDATE", 80, evidence, [])
    );
    // Elevate to LOW candidate when reliability also strong
    if (rel != null && rel >= RISK_THRESHOLDS_V2.lowReliability && mins >= 80) {
      pathways.push(
        hit("STRUCTURAL_UNDER", "LOW_CANDIDATE", 84, [
          ...evidence,
          `reliability ${(rel * 100).toFixed(1)}%`,
        ])
      );
    }
  }

  // PATHWAY C — STABLE_VOLUME_OVER
  if (
    sideU.startsWith("OVER") &&
    edge != null &&
    edge >= 3.0 &&
    mins != null &&
    mins >= 80 &&
    p != null &&
    p >= 0.6 &&
    conflict <= 22 &&
    fails <= 1 &&
    (role == null || role >= 65)
  ) {
    const evidence = [
      "OVER with stable minutes/role",
      `edge ${edge.toFixed(1)}`,
      `minutes stability ${mins}`,
    ];
    if (usageStability != null) evidence.push(`usage stability ${usageStability}`);
    if (volumeStability != null) evidence.push(`FGA/volume stability ${volumeStability}`);
    pathways.push(
      hit("STABLE_VOLUME_OVER", "MEDIUM_CANDIDATE", 80, evidence, [])
    );
    if (rel != null && rel >= RISK_THRESHOLDS_V2.lowReliability && edge >= 3.5) {
      pathways.push(
        hit("STABLE_VOLUME_OVER", "LOW_CANDIDATE", 85, [
          ...evidence,
          `reliability ${(rel * 100).toFixed(1)}%`,
        ])
      );
    }
  }

  // PATHWAY D — THIN_MARKET_STRONG_EDGE
  const thinMarket =
    books == null || books <= 2 || (mkt != null && mkt < 55);
  if (
    thinMarket &&
    edge != null &&
    edge >= 3.5 &&
    mins != null &&
    mins >= 75 &&
    p != null &&
    p >= 0.65 &&
    conflict <= 20 &&
    fails <= 1 &&
    (role == null || role >= 60)
  ) {
    pathways.push(
      hit(
        "THIN_MARKET_STRONG_EDGE",
        "LOW_CANDIDATE",
        83,
        [
          `strong edge ${edge.toFixed(1)} despite thin market`,
          `minutes stability ${mins}`,
          books != null ? `bookCount ${books}` : "bookCount unknown",
          mkt != null ? `marketQuality ${mkt}` : "marketQuality unknown",
          "thin market treated as soft uncertainty, not veto",
        ],
        ["THIN_MARKET_SOFT"]
      )
    );
  }

  // PATHWAY E — GENERAL_HIGH_RELIABILITY
  // Missing minutes/role are not treated as failed floors.
  const minsOkLow =
    mins == null || mins >= RISK_THRESHOLDS_V2.lowMinutesFloor;
  const minsOkMed =
    mins == null || mins >= RISK_THRESHOLDS_V2.mediumMinutesFloor;

  if (
    rel != null &&
    rel >= RISK_THRESHOLDS_V2.lowReliability &&
    p != null &&
    p >= RISK_THRESHOLDS_V2.lowRawProbabilityFloor &&
    minsOkLow &&
    conflict <= RISK_THRESHOLDS_V2.maxConflictForLow &&
    fails <= RISK_THRESHOLDS_V2.maxMajorFailsForLow
  ) {
    const evidence = [
      `empirical reliability ${(rel * 100).toFixed(1)}%`,
      `rawP ${(p * 100).toFixed(1)}%`,
      safety != null ? `SafetyScore ${safety}` : "SafetyScore missing",
    ];
    const warnings = [];
    if (mins == null) warnings.push("minutesStability unknown (not treated as weak)");
    pathways.push(
      hit(
        "GENERAL_HIGH_RELIABILITY",
        "LOW_CANDIDATE",
        Math.round(rel * 100),
        evidence,
        warnings
      )
    );
  }

  if (
    rel != null &&
    rel >= RISK_THRESHOLDS_V2.mediumReliability &&
    rel < RISK_THRESHOLDS_V2.lowReliability &&
    p != null &&
    p >= RISK_THRESHOLDS_V2.mediumRawProbabilityFloor &&
    minsOkMed
  ) {
    pathways.push(
      hit(
        "GENERAL_HIGH_RELIABILITY",
        "MEDIUM_CANDIDATE",
        Math.round(rel * 100),
        [
          `empirical reliability ${(rel * 100).toFixed(1)}% in MEDIUM band`,
          `rawP ${(p * 100).toFixed(1)}%`,
        ]
      )
    );
  }

  // Deduplicate by id+tier keeping highest score
  const best = new Map();
  for (const pw of pathways) {
    const key = `${pw.id}|${pw.tier}`;
    const prev = best.get(key);
    if (!prev || pw.pathwayScore > prev.pathwayScore) best.set(key, pw);
  }
  const unique = [...best.values()].sort(
    (a, b) => (b.pathwayScore || 0) - (a.pathwayScore || 0)
  );

  const lowHits = unique.filter((x) => x.tier === "LOW_CANDIDATE");
  const medHits = unique.filter((x) => x.tier === "MEDIUM_CANDIDATE");
  const primary = lowHits[0] || medHits[0] || null;

  return {
    version: PATHWAY_MODEL_VERSION,
    supportedPathwayIds: SAFE_PATHWAY_IDS,
    pathways: unique,
    lowPathwayHits: lowHits,
    mediumPathwayHits: medHits,
    primaryPathway: primary
      ? {
          safePathway: primary.id,
          pathwayMatched: true,
          pathwayScore: primary.pathwayScore,
          pathwayEvidence: primary.pathwayEvidence,
          pathwayWarnings: primary.pathwayWarnings,
          tier: primary.tier,
        }
      : {
          safePathway: "NONE",
          pathwayMatched: false,
          pathwayScore: 0,
          pathwayEvidence: [],
          pathwayWarnings: [],
          tier: null,
        },
  };
}

/** Back-compat alias used by older imports. */
export function classifySafePathwaysV2(ctx = {}) {
  return evaluateSafePropPathwaysV2(ctx);
}
