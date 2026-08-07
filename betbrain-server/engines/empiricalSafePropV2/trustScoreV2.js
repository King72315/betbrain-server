/**
 * courtEdgeTrustScoreV2 — unified 0–100 ranking score.
 * Combines reliability, raw probability, SafetyScore, pathway strength, soft penalties.
 * Ranking tool — not a sole giant gate.
 */
import {
  RISK_THRESHOLDS_V2,
  TRUST_SCORE_VERSION,
  TRUST_SCORE_WEIGHTS_V2,
} from "./versions.js";

function num(v, fb = null) {
  if (v == null || v === "") return fb;
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function pathwayStrengthPoints(pathwayId, pathwayScore = null) {
  if (pathwayScore != null) return clamp(num(pathwayScore, 0), 0, 100);
  const id = String(pathwayId || "NONE");
  if (id === "NONE" || !id) return 0;
  if (id === "GENERAL_HIGH_RELIABILITY") return 78;
  if (id === "STABLE_HIGH_EDGE") return 86;
  if (id === "STRUCTURAL_UNDER") return 80;
  if (id === "STABLE_VOLUME_OVER") return 80;
  if (id === "THIN_MARKET_STRONG_EDGE") return 82;
  return 60;
}

/**
 * @returns {{ trustScore, trustComponents, trustBonuses, trustPenalties, version }}
 */
export function computeTrustScoreV2(ctx = {}) {
  const w = TRUST_SCORE_WEIGHTS_V2;
  const rel = num(ctx.reliabilityProbability);
  const rawP = num(ctx.rawWinProbability);
  const safety = num(ctx.SafetyScore);
  const edge = num(ctx.projectionEdge);
  const conflict = num(ctx.conflictIndex);
  const fails = num(ctx.majorFailurePathCount, 0);
  const books = num(ctx.bookCount);
  const mkt = num(ctx.marketQuality);
  const mins = num(ctx.minutesStability);
  const role = num(ctx.roleStability);

  const components = {};
  let base = 0;
  let weightUsed = 0;

  if (rel != null) {
    const pts = clamp(rel * 100, 0, 100);
    components.reliability = pts;
    base += pts * w.reliability;
    weightUsed += w.reliability;
  }
  if (rawP != null) {
    const pts = clamp(rawP * 100, 0, 100);
    components.rawWinProbability = pts;
    base += pts * w.rawWinProbability;
    weightUsed += w.rawWinProbability;
  }
  if (safety != null) {
    const pts = clamp(safety, 0, 100);
    components.SafetyScore = pts;
    base += pts * w.SafetyScore;
    weightUsed += w.SafetyScore;
  }

  const pathwayPts = pathwayStrengthPoints(ctx.safePathway, ctx.pathwayScore);
  components.pathwayStrength = pathwayPts;
  base += pathwayPts * w.pathwayStrength;
  weightUsed += w.pathwayStrength;

  if (edge != null) {
    // Map edge ~0–8 → 0–100 support (saturates)
    const pts = clamp((edge / 6) * 100, 0, 100);
    components.projectionEdgeSupport = pts;
    base += pts * w.projectionEdgeSupport;
    weightUsed += w.projectionEdgeSupport;
  }

  // Renormalize if some features missing (do not treat missing as 0)
  const scaled = weightUsed > 0 ? base / weightUsed : 50;

  const bonuses = [];
  const penalties = [];
  let adj = 0;

  if (rel != null && rel >= RISK_THRESHOLDS_V2.exceptionalReliability) {
    adj += 4;
    bonuses.push({ code: "EXCEPTIONAL_RELIABILITY", points: 4 });
  }
  if (
    ctx.safePathway &&
    ctx.safePathway !== "NONE" &&
    pathwayPts >= 80 &&
    rel != null &&
    rel >= RISK_THRESHOLDS_V2.mediumReliability
  ) {
    adj += 3;
    bonuses.push({ code: "STRONG_PATHWAY_ALIGN", points: 3 });
  }

  if (conflict != null && conflict > 35) {
    const p = clamp((conflict - 35) * 0.4, 0, 12);
    adj -= p;
    penalties.push({ code: "CONFLICT", points: -p });
  }
  if (fails >= 2) {
    const p = fails >= 3 ? 10 : 5;
    adj -= p;
    penalties.push({ code: "FAILURE_PATHS", points: -p });
  }
  if (mins != null && mins < 55) {
    adj -= 8;
    penalties.push({ code: "WEAK_MINUTES", points: -8 });
  }
  // Thin market: slight uncertainty only — never a veto
  if (books != null && books <= 1) {
    adj -= 2;
    penalties.push({ code: "THIN_BOOK_SOFT", points: -2 });
  } else if (mkt != null && mkt < 45) {
    adj -= 2;
    penalties.push({ code: "THIN_MARKET_SOFT", points: -2 });
  }
  // Role unknown: no penalty. Role known and severe: soft penalty only.
  if (role != null && role < 55) {
    adj -= 4;
    penalties.push({ code: "SEVERE_ROLE_SOFT", points: -4 });
  }

  const trustScore = Math.round(clamp(scaled + adj, 0, 100));

  return {
    version: TRUST_SCORE_VERSION,
    trustScore,
    trustComponents: components,
    trustBonuses: bonuses,
    trustPenalties: penalties,
    weightUsed: Number(weightUsed.toFixed(3)),
  };
}
