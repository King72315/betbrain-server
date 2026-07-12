/**
 * CourtEdge Lab Signal Performance v1
 * Per-slate signal bucket performance with helped/hurt/neutral classification.
 */

import {
  buildCounterfactualSideLearning,
} from "../engines/decisionIntelligence/sideSelectionTrustV1.js";

export const SIGNAL_PERFORMANCE_VERSION = "signal-performance-v1.1";
export const SMALL_SAMPLE_THRESHOLD = 3;

/** Win-rate / margin thresholds for objective helped/hurt/neutral. */
export const HELPED_WIN_RATE = 55;
export const HURT_WIN_RATE = 45;
export const HELPED_STRONG_WIN_RATE = 60;
export const HURT_STRONG_WIN_RATE = 40;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function avg(values = []) {
  const nums = values
    .map((value) => (value === null || value === undefined ? NaN : num(value)))
    .filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return Number((nums.reduce((s, n) => s + n, 0) / nums.length).toFixed(2));
}

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function normalizeRiskBucket(riskLabel = "") {
  const label = String(riskLabel || "").toLowerCase();
  if (label.includes("low")) return "LOW";
  if (label.includes("medium")) return "MEDIUM";
  if (label.includes("high")) return "HIGH";
  return "UNKNOWN";
}

function bucketMinutesStability(prop = {}) {
  const score = num(prop.minutesStabilityScore);
  if (score >= 70) return "stable_70+";
  if (score >= 50) return "moderate_50-69";
  if (score > 0) return "volatile_<50";
  const snap = prop.signalSnapshot?.usageMinutesSignal;
  if (snap && snap !== "not enough data") return String(snap);
  return "not enough data";
}

function bucketUsage(prop = {}) {
  const label = prop.flipFirstLabels?.usage;
  if (label) return String(label);
  return prop.signalSnapshot?.usageMinutesSignal || "not enough data";
}

function bucketMarket(prop = {}) {
  const bookBucket = prop.bookCountBucket;
  const qualityBucket = prop.marketQualityBucket;
  if (bookBucket && qualityBucket) return `${bookBucket}|${qualityBucket}`;
  return (
    prop.bookCountBucket ||
    prop.marketQualityBucket ||
    prop.signalSnapshot?.marketSignal ||
    "not enough data"
  );
}

function bucketImpliedTeamTotal(prop = {}) {
  const audit =
    prop.impliedTeamTotalAudit ||
    prop.decisionDataIntelligence?.impliedTeamTotalAudit ||
    null;
  const value =
    audit?.value ??
    prop.gameEnvironment?.impliedTeamTotal ??
    prop.playerState?.impliedTeamTotal ??
    null;
  if (value === null || value === undefined) return "not enough data";
  const n = num(value);
  if (n >= 90) return "90+";
  if (n >= 82) return "82-89";
  if (n >= 75) return "75-81";
  return "<75";
}

function bucketCollision(prop = {}) {
  const label = prop.flipFirstLabels?.collision;
  if (label) return String(label);
  const collision = prop.decisionDataIntelligence?.sameTeamCollision;
  if (!collision) return "not enough data";
  if (collision.unrealistic) return "UNREALISTIC";
  const score = num(collision.collisionScore);
  if (score >= 45) return "WARNING";
  if (score > 0) return "CLEAR";
  return "not enough data";
}

function bucketFlipFirst(prop = {}) {
  const action = prop.flipFirstAction || prop.flipFirstAudit?.action;
  const flipped = Boolean(prop.flipFirstFlipped || prop.flipFirstAudit?.flipTriggered);
  if (action) return `${action}${flipped ? "_flipped" : "_retained"}`;
  if (flipped) return "flipped";
  return "retained";
}

function bucketSideRescue(prop = {}) {
  const action = prop.sideRescueAction || prop.sideRescue?.action;
  if (!action || action === "NONE" || action === "PASS") return "no_rescue";
  const flipped = Boolean(prop.sideRescueFlipped);
  return `${action}${flipped ? "_flipped" : ""}`;
}

function bucketGapFloor(prop = {}) {
  const audit = prop.wnbaDataModeAudit;
  if (audit?.gapFloorApplied !== undefined && audit?.gapFloorApplied !== null) {
    return audit.gapFloorApplied ? `applied_${audit.gapFloorReasonCode || "yes"}` : "not_applied";
  }
  if (prop.underGapFloorPassed === true) return "floor_passed";
  if (prop.underGapFloorPassed === false) return "floor_failed";
  return "not enough data";
}

function bucketDangerGate(prop = {}) {
  const count = prop.dangerGateCount;
  if (count !== null && count !== undefined) {
    const n = num(count);
    if (n === 0) return "0_gates";
    if (n === 1) return "1_gate";
    return "2+_gates";
  }
  const stack = prop.dangerGateStack;
  if (Array.isArray(stack) && stack.length > 0) return `${stack.length}_gates`;
  return "not enough data";
}

function bucketTrueRisk(prop = {}) {
  return (
    prop.trueRisk ||
    prop.decisionIntelligence?.trueRisk ||
    normalizeRiskBucket(prop.riskLabel)
  );
}

function bucketDataMode(prop = {}) {
  const audit = prop.wnbaDataModeAudit;
  if (audit?.resolvedDataMode) return String(audit.resolvedDataMode);
  return prop.dataMode || prop.playerState?.dataMode || "not enough data";
}

function bucketFairLineEdge(prop = {}) {
  return (
    prop.fairLineEdgeBucket ||
    prop.signalSnapshot?.projectionEdgeBucket ||
    getFairLineEdgeBucket(prop.fairLineEdge) ||
    "not enough data"
  );
}

function getFairLineEdgeBucket(edge) {
  const n = num(edge);
  if (!Number.isFinite(n) || n === 0) return "0";
  const abs = Math.abs(n);
  if (abs < 1) return "0-0.9";
  if (abs < 2.5) return "1.0-2.4";
  if (abs < 4) return "2.5-3.9";
  return "4+";
}

function buildRawRecord(prop = {}) {
  const counterfactual = buildCounterfactualSideLearning(prop);
  return {
    trackedId: prop.trackedId || prop.trackedKey || null,
    player: prop.player || null,
    stat: prop.stat || null,
    side: prop.currentEngineSide || null,
    line: prop.line ?? null,
    status: prop.status || null,
    resultMargin: prop.resultMargin ?? prop.currentEngineMargin ?? null,
    confidence: prop.confidence ?? null,
    naturalDecision: prop.naturalDecision || counterfactual.naturalDecision || null,
    riskDebtReasons: counterfactual.riskDebtReasons || [],
    counterfactualSideLearning: counterfactual,
  };
}

function buildRecord(props = []) {
  const graded = props.filter((prop) => isResolvedStatus(prop.status));
  const wins = graded.filter((prop) => String(prop.status).toLowerCase() === "win");
  const losses = graded.filter((prop) => String(prop.status).toLowerCase() === "loss");
  const pushes = graded.filter((prop) => String(prop.status).toLowerCase() === "push");
  const pending = props.length - graded.length;
  const decided = wins.length + losses.length;
  const winRate =
    decided > 0 ? Number(((wins.length / decided) * 100).toFixed(1)) : null;

  const margins = graded
    .map((prop) => prop.resultMargin ?? prop.currentEngineMargin)
    .filter((v) => v !== null && v !== undefined && Number.isFinite(Number(v)));

  return {
    n: props.length,
    pending,
    graded: graded.length,
    wins: wins.length,
    losses: losses.length,
    pushes: pushes.length,
    winRate,
    avgMargin: avg(margins),
    avgConfidence: avg(props.map((prop) => prop.confidence)),
    decided,
    smallSample: decided > 0 && decided < SMALL_SAMPLE_THRESHOLD,
    rawRecords: props.map(buildRawRecord),
  };
}

/**
 * Classify signal bucket performance as helped, hurt, or neutral.
 * Uses win rate + avg margin with objective thresholds.
 */
export function classifySignalImpact({ winRate = null, avgMargin = null, decided = 0 } = {}) {
  if (decided === 0) {
    return {
      status: "neutral",
      reason: "no_graded_props",
    };
  }

  const wr = winRate !== null && winRate !== undefined ? num(winRate) : null;
  const margin = avgMargin !== null && avgMargin !== undefined ? num(avgMargin) : null;

  if (wr !== null && wr >= HELPED_STRONG_WIN_RATE) {
    return { status: "helped", reason: `win_rate_${wr}%_>=_${HELPED_STRONG_WIN_RATE}` };
  }
  if (wr !== null && wr <= HURT_STRONG_WIN_RATE) {
    return { status: "hurt", reason: `win_rate_${wr}%_<=_${HURT_STRONG_WIN_RATE}` };
  }

  if (
    wr !== null &&
    margin !== null &&
    wr >= HELPED_WIN_RATE &&
    margin > 0
  ) {
    return { status: "helped", reason: `win_rate_${wr}%_margin_+${margin}` };
  }

  if (
    wr !== null &&
    margin !== null &&
    wr <= HURT_WIN_RATE &&
    margin < 0
  ) {
    return { status: "hurt", reason: `win_rate_${wr}%_margin_${margin}` };
  }

  return { status: "neutral", reason: "mixed_or_inconclusive" };
}

/** Signal dimension extractors: category → (prop) => bucket value */
export const SIGNAL_DIMENSIONS = [
  { category: "projectionEdgeBucket", extract: (p) => p.signalSnapshot?.projectionEdgeBucket || p.projectionEdgeBucket || "not enough data" },
  { category: "fairLineEdge", extract: bucketFairLineEdge },
  { category: "confidenceBucket", extract: (p) => p.confidenceBucket || p.signalSnapshot?.confidenceBucket || "not enough data" },
  { category: "trueRiskBucket", extract: bucketTrueRisk },
  { category: "sideOU", extract: (p) => p.currentEngineSide || "UNKNOWN" },
  { category: "tier", extract: (p) => p.tier || p.signalSnapshot?.tier || "UNKNOWN" },
  { category: "dataMode", extract: bucketDataMode },
  { category: "minutesStability", extract: bucketMinutesStability },
  { category: "usage", extract: bucketUsage },
  { category: "market", extract: bucketMarket },
  { category: "availability", extract: (p) => p.signalSnapshot?.injuryAvailabilitySignal || p.flipFirstLabels?.availability || "not enough data" },
  { category: "opponentDefense", extract: (p) => p.signalSnapshot?.opponentDefenseSignal || "not enough data" },
  { category: "impliedTeamTotal", extract: bucketImpliedTeamTotal },
  { category: "sameTeamCollision", extract: bucketCollision },
  { category: "flipFirst", extract: bucketFlipFirst },
  { category: "sideRescue", extract: bucketSideRescue },
  { category: "gapFloor", extract: bucketGapFloor },
  { category: "dangerGate", extract: bucketDangerGate },
  { category: "supportDangerGap", extract: (p) => p.supportDangerGapBucket || p.signalSnapshot?.supportDangerGapBucket || "not enough data" },
  { category: "recentForm", extract: (p) => p.signalSnapshot?.last5Signal || "not enough data" },
  { category: "seasonAvg", extract: (p) => p.signalSnapshot?.seasonAverageSignal || "not enough data" },
  { category: "homeAway", extract: (p) => p.signalSnapshot?.homeAwaySignal || "not enough data" },
  { category: "restTravel", extract: (p) => p.signalSnapshot?.restTravelSignal || "not enough data" },
  { category: "pace", extract: (p) => p.signalSnapshot?.paceSignal || "not enough data" },
  { category: "bookCount", extract: (p) => p.bookCountBucket || "not enough data" },
  { category: "marketQuality", extract: (p) => p.marketQualityBucket || "not enough data" },
];

function groupPropsByDimension(props, dimension) {
  const groups = {};
  for (const prop of props) {
    const value = String(dimension.extract(prop) || "not enough data");
    if (!groups[value]) groups[value] = [];
    groups[value].push(prop);
  }
  return groups;
}

function buildDimensionRows(props, dimension) {
  const groups = groupPropsByDimension(props, dimension);
  const rows = [];

  for (const [value, groupProps] of Object.entries(groups)) {
    const record = buildRecord(groupProps);
    const impact = classifySignalImpact(record);

    rows.push({
      signalCategory: dimension.category,
      value,
      ...record,
      record: `${record.wins}-${record.losses}-${record.pushes}`,
      impactStatus: impact.status,
      impactReason: impact.reason,
      smallSampleNote: record.smallSample
        ? `Small sample (${record.decided} decided) — visible but directional only`
        : null,
    });
  }

  rows.sort((a, b) => b.n - a.n || String(a.value).localeCompare(String(b.value)));
  return rows;
}

/**
 * Build full signal performance table for a slate's tracked props.
 */
export function buildSignalPerformanceTable(props = [], options = {}) {
  const slateDate = options.slateDate || null;
  const allRows = [];

  for (const dimension of SIGNAL_DIMENSIONS) {
    allRows.push(...buildDimensionRows(props, dimension));
  }

  const helped = allRows.filter((row) => row.impactStatus === "helped" && row.decided > 0);
  const hurt = allRows.filter((row) => row.impactStatus === "hurt" && row.decided > 0);
  const neutral = allRows.filter((row) => row.impactStatus === "neutral" && row.decided > 0);

  const sortByImpact = (rows) =>
    [...rows].sort((a, b) => {
      const wrDiff = num(b.winRate) - num(a.winRate);
      if (wrDiff !== 0) return wrDiff;
      return num(b.avgMargin) - num(a.avgMargin);
    });

  return {
    version: SIGNAL_PERFORMANCE_VERSION,
    slateDate,
    generatedAt: new Date().toISOString(),
    propCount: props.length,
    rowCount: allRows.length,
    thresholds: {
      helpedWinRate: HELPED_WIN_RATE,
      hurtWinRate: HURT_WIN_RATE,
      helpedStrongWinRate: HELPED_STRONG_WIN_RATE,
      hurtStrongWinRate: HURT_STRONG_WIN_RATE,
      smallSampleThreshold: SMALL_SAMPLE_THRESHOLD,
    },
    rows: allRows,
    summary: {
      helped: sortByImpact(helped).slice(0, 8),
      hurt: sortByImpact(hurt)
        .sort((a, b) => num(a.winRate) - num(b.winRate))
        .slice(0, 8),
      neutral: sortByImpact(neutral).slice(0, 8),
      smallSampleCount: allRows.filter((row) => row.smallSample).length,
    },
    byCategory: Object.fromEntries(
      SIGNAL_DIMENSIONS.map((dim) => [
        dim.category,
        allRows.filter((row) => row.signalCategory === dim.category),
      ])
    ),
  };
}

export function aggregateSignalRows(rows = []) {
  const buckets = {};

  for (const row of rows) {
    const key = `${row.signalCategory}::${row.value}`;
    if (!buckets[key]) {
      buckets[key] = {
        signalCategory: row.signalCategory,
        value: row.value,
        wins: 0,
        losses: 0,
        pushes: 0,
        n: 0,
        margins: [],
        confidences: [],
        rawRecords: [],
      };
    }
    const bucket = buckets[key];
    bucket.wins += row.wins || 0;
    bucket.losses += row.losses || 0;
    bucket.pushes += row.pushes || 0;
    bucket.n += row.n || 0;
    for (const rec of row.rawRecords || []) {
      bucket.rawRecords.push(rec);
      if (rec.resultMargin !== null && rec.resultMargin !== undefined) {
        bucket.margins.push(num(rec.resultMargin));
      }
      if (rec.confidence !== null && rec.confidence !== undefined) {
        bucket.confidences.push(num(rec.confidence));
      }
    }
  }

  return Object.values(buckets).map((bucket) => {
    const decided = bucket.wins + bucket.losses;
    const winRate =
      decided > 0 ? Number(((bucket.wins / decided) * 100).toFixed(1)) : null;
    const avgMargin = avg(bucket.margins);
    const avgConfidence = avg(bucket.confidences);
    const impact = classifySignalImpact({ winRate, avgMargin, decided });

    return {
      signalCategory: bucket.signalCategory,
      value: bucket.value,
      n: bucket.n,
      wins: bucket.wins,
      losses: bucket.losses,
      pushes: bucket.pushes,
      record: `${bucket.wins}-${bucket.losses}-${bucket.pushes}`,
      winRate,
      avgMargin,
      avgConfidence,
      decided,
      smallSample: decided > 0 && decided < SMALL_SAMPLE_THRESHOLD,
      impactStatus: impact.status,
      impactReason: impact.reason,
      rawRecords: bucket.rawRecords,
    };
  });
}
