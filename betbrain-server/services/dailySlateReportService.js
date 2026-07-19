import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildEngineReportCardBundle } from "./engineReportCardService.js";
import { getSlateDateCT, getTrackedProps, getTrackedPropsForSlate } from "./trackedPropService.js";
import {
  archiveSlate,
  getAllHistoryArchives,
  getHistoryArchive,
  getLockedSlatesRegistry,
  getLockedSnapshot,
  getQuarantinedSlatesFromRegistry,
  isSlateLocked,
  mergeSnapshotPropsWithLiveGrades,
  promoteSlateToLab,
  syncGradedPropsToLockedSlate,
  writeSlateHistoryArchive,
} from "./slateLockService.js";
import {
  attachGradedResultsToSnapshot,
  buildBestSixReview,
  buildTopPicksReview,
  clearActiveTopPicksSnapshot,
  archiveTopPicksSnapshotToReportMetadata,
} from "./topPicksSnapshotService.js";
import { attachOfficialLearningToReport } from "./officialLearningRecordBuilder.js";
import { enrichGradedPropsForLab } from "./labLearningEnrichmentService.js";
import { attachLabV2ToReport } from "./courtEdgeLabV2.js";
import {
  mergeMembershipWithLiveGrades,
  resolveOfficialSlateMembership,
  validateMembershipIntegrity,
} from "./officialSlateMembershipService.js";
import { logLifecycleIntegrityFailure } from "./lifecyclePointerStateService.js";
import {
  validateOfficialSlateLifecycle,
} from "./officialSlateService.js";
import {
  computeSlateRotation,
  filterOutQuarantinedReports,
  filterReportsOnOrAfterCutoff,
  filterValidDailyReports,
  inferCompletedReportsFromTrackedProps,
  getTodayLocalDate,
  hasUnresolvedGradingProps,
  isFutureSlateDate,
  isOnOrAfterCleanDataCutoff,
  isQuarantinedSlateDate,
} from "./slateScopeService.js";
import {
  buildQualityGatePerformanceFromProps,
  buildRetroactiveGateSimulation,
  buildWnbaV2GateReview,
} from "../engines/wnba/wnbaResultsQualityGate.js";
import {
  buildDecisionIntelligenceReview,
  buildDecisionIntelligenceRetroSimulation,
  buildRiskHonestyReview,
  buildUpgradeDemotionReview,
  DECISION_INTELLIGENCE_VERSION,
} from "../engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import {
  buildSideRescueReview,
  buildSideRescueRetroSimulation,
  SIDE_RESCUE_VERSION,
} from "../engines/decisionIntelligence/sideRescueEngineV1.js";
import { buildSlateResultsSnapshot } from "./slateResultsSnapshot.js";
import {
  buildSignalPerformanceTable,
  SIGNAL_PERFORMANCE_VERSION,
} from "./signalPerformanceV1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORTS_FILE = path.join(__dirname, "..", "daily-slate-reports.json");
const BACKUP_FILE = path.join(
  __dirname,
  "..",
  "daily-slate-reports-backup-before-phase1.json"
);

const MIN_SAMPLE = 3;

/** First slate date included in clean collectible Lab/History/report era. */
export { CLEAN_DATA_CUTOFF } from "./slateScopeService.js";

export const WNBA_STRUCTURAL_GAPS = {
  availabilityGate:
    "skipped — evaluateAvailabilityGate returns N/A for non-NBA (no injury/status gate)",
  defenseScore:
    "neutral default (50) — computeDefenseScore has no WNBA team season stats",
  primaryStatSource:
    "BallDontLie (BDL) primary — no SportsData projections, usage boost, or missing-player context",
};

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

function readJSON(file, fallback = []) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensureReportsFile() {
  if (!fs.existsSync(REPORTS_FILE)) {
    writeJSON(REPORTS_FILE, []);
    return;
  }

  const existing = readJSON(REPORTS_FILE, []);

  if (Array.isArray(existing) && existing.length > 0 && !fs.existsSync(BACKUP_FILE)) {
    writeJSON(BACKUP_FILE, existing);
  }
}

ensureReportsFile();

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

export { hasUnresolvedGradingProps } from "./slateScopeService.js";

function normalizeRiskBucket(riskLabel = "") {
  const label = String(riskLabel || "").toLowerCase();
  if (label.includes("low")) return "LOW";
  if (label.includes("medium")) return "MEDIUM";
  if (label.includes("high")) return "HIGH";
  return "UNKNOWN";
}

function buildRecord(props = []) {
  const graded = props.filter((prop) => isResolvedStatus(prop.status));
  const wins = graded.filter((prop) => String(prop.status).toLowerCase() === "win");
  const losses = graded.filter((prop) =>
    String(prop.status).toLowerCase() === "loss"
  );
  const pushes = graded.filter((prop) =>
    String(prop.status).toLowerCase() === "push"
  );
  const pending = props.length - graded.length;
  const decided = wins.length + losses.length;
  const winRate =
    decided > 0 ? Number(((wins.length / decided) * 100).toFixed(1)) : null;

  return {
    total: props.length,
    graded: graded.length,
    pending,
    wins: wins.length,
    losses: losses.length,
    pushes: pushes.length,
    winRate,
    netUnits: wins.length - losses.length,
  };
}

function buildGroupPerformance(props = []) {
  const record = buildRecord(props);
  const graded = props.filter((prop) => isResolvedStatus(prop.status));
  const decided = record.wins + record.losses;

  return {
    sample: props.length,
    pending: record.pending,
    graded: record.graded,
    wins: record.wins,
    losses: record.losses,
    pushes: record.pushes,
    winRate: record.winRate,
    needsMoreData: decided < MIN_SAMPLE,
    smallSampleNote:
      decided > 0 && decided < MIN_SAMPLE
        ? `Only ${decided} decided prop(s) — treat as directional only`
        : decided === 0
          ? "No graded props in this group"
          : null,
  };
}

function getProjectionValue(prop = {}) {
  const ps = prop.playerState || {};
  const value =
    prop.projection ??
    prop.sportsProjection ??
    ps.sportsProjection ??
    prop.fairLine ??
    null;
  return value !== null && Number.isFinite(Number(value)) ? num(value) : null;
}

function classifyLoss(prop = {}) {
  const side = String(prop.currentEngineSide || "").toLowerCase();
  const line = num(prop.line);
  const actual = num(prop.actualStat);
  const projection = getProjectionValue(prop);
  const fairLine = num(prop.fairLine);
  const expectedMinutes = num(prop.expectedMinutes);
  const seasonMinutes = num(prop.playerState?.seasonMinutes);
  const recentMinutes = num(prop.playerState?.recentMinutes);
  const confidence = num(prop.confidence);
  const dataCoverage = num(prop.dataCoverage);
  const supportReasons = [
    ...(prop.supportReasons || []),
    ...(prop.support || []),
  ];
  const dangerReasons = [
    ...(prop.dangerReasons || []),
    ...(prop.resistance || []),
  ];
  const roleChange = prop.roleChange || {};
  const margin = num(prop.resultMargin);

  const reasons = [];

  if (dataCoverage > 0 && dataCoverage < 50) {
    return {
      missType: "low data coverage",
      explanation: `Data coverage was ${dataCoverage}% — limited signal depth for this pick.`,
    };
  }

  const isWnbaLimited =
    String(prop.league || "").toUpperCase() === "WNBA" ||
    String(prop.dataMode || prop.playerState?.dataMode || "").includes(
      "WNBA_LIMITED"
    );
  if (isWnbaLimited && projection !== null && line > 0) {
    const underGap = line - projection;
    const overGap = projection - line;
    if (side === "under" && underGap < 3) {
      return {
        missType: "under_gap_too_small",
        explanation: `Under gap was ${underGap.toFixed(1)} — below WNBA 3.0 floor for limited data.`,
      };
    }
    if (side === "over" && overGap < 4) {
      return {
        missType: "over_gap_too_small",
        explanation: `Over gap was ${overGap.toFixed(1)} — below WNBA 4.0 floor for limited data.`,
      };
    }
  }

  if (confidence >= 75 && Math.abs(margin) <= 2) {
    return {
      missType: "confidence overreaction",
      explanation: `High confidence (${confidence}%) on a narrow miss (${margin > 0 ? "+" : ""}${margin}).`,
    };
  }

  if (
    expectedMinutes > 0 &&
    seasonMinutes > 0 &&
    expectedMinutes < seasonMinutes - 4 &&
    actual < line
  ) {
    return {
      missType: "player minutes dropped",
      explanation: `Expected ${expectedMinutes} min vs season ${seasonMinutes.toFixed(1)} — scoring volume likely constrained.`,
    };
  }

  if (
    recentMinutes > 0 &&
    seasonMinutes > 0 &&
    recentMinutes < seasonMinutes - 5 &&
    side === "over"
  ) {
    return {
      missType: "player minutes dropped",
      explanation: `Recent minutes (${recentMinutes}) well below season (${seasonMinutes.toFixed(1)}).`,
    };
  }

  if (
    roleChange.recentMinutesTrend === "DOWN" ||
    (roleChange.expectedMinutesDelta && roleChange.expectedMinutesDelta < -3)
  ) {
    return {
      missType: "usage assumption failed",
      explanation: "Role/minutes trend was down — usage assumption did not hold.",
    };
  }

  const isWnba =
    String(prop.league || "").toUpperCase() === "WNBA" ||
    String(prop.dataMode || prop.playerState?.dataMode || "").includes(
      "WNBA_LIMITED"
    );
  const availabilityApplicable = prop.availabilityGate?.applicable !== false;

  if (isWnba && !availabilityApplicable) {
    const hasRealAvailabilitySignal = [
      ...(prop.dangerReasons || []),
      ...(prop.warningReasons || []),
      ...(prop.resistance || []),
    ].some((r) =>
      /injury|questionable|out|inactive|gtd|doubtful/i.test(String(r))
    );

    if (hasRealAvailabilitySignal) {
      return {
        missType: "wnba_availability_unknown",
        explanation:
          "WNBA has no availability gate — injury wording is unverified, not a confirmed availability miss.",
      };
    }
  }

  if (
    availabilityApplicable &&
    (dangerReasons.some((r) =>
      /injury|questionable|out|inactive|gtd|doubtful/i.test(String(r))
    ) ||
      (prop.warningReasons || []).some((r) =>
        /injury|questionable|out|inactive|gtd|doubtful/i.test(String(r))
      ) ||
      prop.availabilityGate?.statusLevel === "OUT" ||
      prop.availabilityGate?.statusLevel === "QUESTIONABLE")
  ) {
    return {
      missType: "player_availability_miss",
      explanation: "Availability warning was present in the pick profile.",
    };
  }

  const volumeGates = prop.volumeDangerGates?.gates || [];

  if (
    volumeGates.includes("efficiency_only_scoring") &&
    side === "over" &&
    actual < line
  ) {
    return {
      missType: "efficiency_regression",
      explanation: "Efficiency-only scoring profile regressed — volume did not support the over.",
    };
  }

  if (
    volumeGates.includes("low_volume_over_trap") ||
    (volumeGates.includes("low_fga_floor") && side === "over")
  ) {
    return {
      missType: "low_volume_over_trap",
      explanation: "Low FGA/volume floor — over required hot shooting that did not sustain.",
    };
  }

  if (volumeGates.includes("unstable_minutes") || volumeGates.includes("volatile_minutes")) {
    return {
      missType: "volume_profile_miss",
      explanation: "Unstable/volatile minutes profile — role variance drove the miss.",
    };
  }

  const lineDelta = num(prop.lineDelta ?? prop.marketIntelligence?.lineDelta);
  const lineMovedAgainst =
    prop.wnbaShadow?.lineMovementAgainstSide ??
    prop.marketIntelligence?.lineMovementAgainstSide ??
    prop.marketIntelligence?.lineMovedAgainstSide ??
    ((side === "over" && lineDelta < -0.5) ||
      (side === "under" && lineDelta > 0.5));

  if (lineMovedAgainst && actual < line && side === "over") {
    return {
      missType: "line_movement_trap",
      explanation: `Line steamed against the over (${lineDelta >= 0 ? "+" : ""}${lineDelta}) — market was sharper.`,
    };
  }

  if (lineMovedAgainst && actual > line && side === "under") {
    return {
      missType: "market_steam_against_side",
      explanation: `Line moved against the under (${lineDelta}) — steam trap.`,
    };
  }

  if (
    side === "over" &&
    lineDelta <= -0.5 &&
    actual < line &&
    num(prop.openingLine) > 0
  ) {
    return {
      missType: "opening_line_value_miss",
      explanation: "Line dropped from open but over still missed — value signal failed.",
    };
  }

  if (
    (prop.marketIntelligence?.signals || []).includes("one_book_market") ||
    (prop.marketIntelligence?.signals || []).includes("thin_market") ||
    (num(prop.bookCount) <= 1 && actual !== line)
  ) {
    return {
      missType: "weak_market_trap",
      explanation: "Thin/one-book market — pricing was unreliable.",
    };
  }

  if (projection !== null && line > 0) {
    if (side === "over" && projection > line + 2 && actual < line) {
      return {
        missType: "projection inflated",
        explanation: `Projection ${projection} was above line ${line} but actual was ${actual}.`,
      };
    }
    if (side === "under" && projection < line - 2 && actual > line) {
      return {
        missType: "projection too conservative",
        explanation: `Projection ${projection} was below line ${line} but actual was ${actual}.`,
      };
    }
  }

  if (fairLine !== 0 && line > 0) {
    if (side === "over" && fairLine > line + 1 && actual < line) {
      return {
        missType: "market line too sharp",
        explanation: `Fair line ${fairLine} exceeded book ${line} — market may have been sharper.`,
      };
    }
    if (side === "under" && fairLine < line - 1 && actual > line) {
      return {
        missType: "market line too sharp",
        explanation: `Fair line ${fairLine} was below book ${line} — market may have been sharper.`,
      };
    }
  }

  if (
    supportReasons.some((r) => /recent|last 5|last five/i.test(String(r))) &&
    side === "over" &&
    actual < line
  ) {
    return {
      missType: "recent form misleading",
      explanation: "Recent-form support did not carry through to the result.",
    };
  }

  if (
    supportReasons.some((r) => /h2h|head.to.head|matchup history/i.test(String(r))) ||
    dangerReasons.some((r) => /h2h|head.to.head|matchup history/i.test(String(r)))
  ) {
    return {
      missType: "H2H misleading",
      explanation: "Head-to-head signal did not predict this outcome.",
    };
  }

  if (
    dangerReasons.some((r) => /opponent|defense|matchup/i.test(String(r))) ||
    supportReasons.some((r) => /opponent|defense|matchup/i.test(String(r)))
  ) {
    return {
      missType: "opponent defense signal failed",
      explanation: "Opponent/matchup signal did not align with the final stat.",
    };
  }

  if (prop.volumeDangerGates?.gates?.includes("pace_mismatch")) {
    return {
      missType: "pace_mismatch",
      explanation: "Pace/tempo signal did not align with actual game flow.",
    };
  }

  if (
    prop.defenseResult?.defenseScore !== undefined &&
    dangerReasons.some((r) => /defense|matchup/i.test(String(r)))
  ) {
    return {
      missType: "defense_rating_miss",
      explanation: "Defense/matchup rating signal failed on this slate.",
    };
  }

  if (
    prop.scoreLedger?.some?.((entry) => entry?.label?.toLowerCase?.().includes("gate")) &&
    side === "over" &&
    actual < line
  ) {
    return {
      missType: "score_ledger_gate_miss",
      explanation: "Score ledger gate was active but over still missed.",
    };
  }

  if (
    (prop.lockedScoreLedger || prop.scoreLedger || []).some?.(
      (entry) => entry?.direction === "danger" && num(entry?.weight) >= 2
    )
  ) {
    return {
      missType: "ledger_danger_ignored",
      explanation: "Locked score ledger flagged danger that was not respected.",
    };
  }

  if (Math.abs(margin) >= 8) {
    return {
      missType: "blowout/game script",
      explanation: `Large miss margin (${margin > 0 ? "+" : ""}${margin}) suggests game script variance.`,
    };
  }

  const riskBucket = normalizeRiskBucket(prop.riskLabel);
  if (riskBucket === "HIGH" && side === "over" && actual < line) {
    return {
      missType: "risk label misclassified",
      explanation: "High-risk over pick missed — risk label may have understated danger.",
    };
  }

  return {
    missType: "unknown",
    explanation: "No dominant heuristic matched — review manually.",
  };
}

function buildRiskBucketBreakdown(props = []) {
  const buckets = { LOW: [], MEDIUM: [], HIGH: [], UNKNOWN: [] };

  for (const prop of props) {
    const key = normalizeRiskBucket(prop.riskLabel);
    buckets[key].push(prop);
  }

  const result = {};

  for (const [key, bucketProps] of Object.entries(buckets)) {
    if (key === "UNKNOWN" && bucketProps.length === 0) continue;

    const record = buildRecord(bucketProps);
    const graded = bucketProps.filter((p) => isResolvedStatus(p.status));
    const decided = record.wins + record.losses;

    result[key] = {
      ...record,
      winRate: record.winRate,
      avgConfidence: avg(graded.map((p) => p.confidence)),
      avgFairLineEdge: avg(graded.map((p) => p.fairLineEdge)),
      avgProjectionEdge: avg(
        graded.map((p) => {
          const proj = getProjectionValue(p);
          return proj !== null ? proj - num(p.line) : null;
        })
      ),
      avgSupport: avg(graded.map((p) => p.supportScore)),
      avgDanger: avg(graded.map((p) => p.resistanceScore)),
      avgSupportDangerGap: avg(graded.map((p) => p.supportDangerGap ?? p.netEdge)),
      smallSampleNote:
        decided > 0 && decided < MIN_SAMPLE
          ? `Only ${decided} decided — directional only`
          : null,
    };
  }

  return result;
}

function buildProjectionAccuracy(props = []) {
  const graded = props.filter((p) => isResolvedStatus(p.status));
  const withProjection = graded.filter((p) => getProjectionValue(p) !== null);
  const withActual = graded.filter((p) => num(p.actualStat) > 0 || p.actualStat === 0);

  const decidedWithProjection = withProjection.filter((p) =>
    ["win", "loss"].includes(String(p.status).toLowerCase())
  );
  const winsWithProjection = decidedWithProjection.filter(
    (p) => String(p.status).toLowerCase() === "win"
  );

  const errors = withProjection
    .map((p) => getProjectionValue(p) - num(p.actualStat))
    .filter(Number.isFinite);
  const absErrors = errors.map(Math.abs);
  const avgError = avg(errors);
  const avgAbsError = avg(absErrors);

  let bias = "not enough data";
  if (errors.length >= MIN_SAMPLE) {
    const mean = avg(errors);
    if (mean !== null && mean > 1.5) bias = "too high";
    else if (mean !== null && mean < -1.5) bias = "too low";
    else if (mean !== null) bias = "balanced";
  }

  let bestCall = null;
  let worstMiss = null;

  for (const p of withProjection) {
    const proj = getProjectionValue(p);
    const actual = num(p.actualStat);
    const err = Math.abs(proj - actual);
    const entry = {
      player: p.player,
      game: p.gameLabel || p.game || "",
      side: p.currentEngineSide,
      line: p.line,
      projection: proj,
      fairLine: p.fairLine ?? null,
      actualStat: actual,
      error: Number((proj - actual).toFixed(1)),
    };

    if (!bestCall || err < Math.abs(bestCall.projection - bestCall.actualStat)) {
      if (String(p.status).toLowerCase() === "win") bestCall = entry;
    }
    if (!worstMiss || err > Math.abs(worstMiss.projection - worstMiss.actualStat)) {
      if (String(p.status).toLowerCase() === "loss") worstMiss = entry;
    }
  }

  const edgeBuckets = {};
  for (const p of withProjection) {
    const bucket =
      p.projectionEdgeBucket ||
      p.fairLineEdgeBucket ||
      p.signalSnapshot?.projectionEdgeBucket ||
      "unknown";
    if (!edgeBuckets[bucket]) edgeBuckets[bucket] = [];
    edgeBuckets[bucket].push(p);
  }

  const edgeBucketPerformance = {};
  for (const [bucket, bucketProps] of Object.entries(edgeBuckets)) {
    edgeBucketPerformance[bucket] = buildGroupPerformance(bucketProps);
  }

  return {
    sample: withProjection.length,
    projectionSideWinRate:
      decidedWithProjection.length >= MIN_SAMPLE
        ? Number(
            (
              (winsWithProjection.length / decidedWithProjection.length) *
              100
            ).toFixed(1)
          )
        : null,
    avgProjected: avg(withProjection.map(getProjectionValue)),
    avgFairLine: avg(withProjection.map((p) => num(p.fairLine))),
    avgActual: avg(withActual.map((p) => num(p.actualStat))),
    avgError,
    avgAbsError,
    bias,
    bestCall,
    worstMiss,
    edgeBucketPerformance:
      Object.keys(edgeBucketPerformance).length >= 2
        ? edgeBucketPerformance
        : { note: "not enough data for edge bucket breakdown" },
    needsMoreData: withProjection.length < MIN_SAMPLE,
  };
}

function groupByField(props = [], getKey) {
  const groups = {};

  for (const prop of props) {
    const key = getKey(prop) || "not enough data";
    if (!groups[key]) groups[key] = [];
    groups[key].push(prop);
  }

  const result = {};
  for (const [key, groupProps] of Object.entries(groups)) {
    result[key] = buildGroupPerformance(groupProps);
  }

  return result;
}

function buildEngineSignalPerformance(props = []) {
  const snap = (prop, field) =>
    prop.signalSnapshot?.[field] ?? "not enough data";

  return {
    last5: groupByField(props, (p) => snap(p, "last5Signal")),
    seasonAverage: groupByField(props, (p) => snap(p, "seasonAverageSignal")),
    h2h: groupByField(props, (p) => snap(p, "h2hSignal")),
    opponentDefense: groupByField(props, (p) => snap(p, "opponentDefenseSignal")),
    usageMinutes: groupByField(props, (p) => snap(p, "usageMinutesSignal")),
    injuryAvailability: groupByField(props, (p) => snap(p, "injuryAvailabilitySignal")),
    homeAway: groupByField(props, (p) => snap(p, "homeAwaySignal")),
    restTravel: groupByField(props, (p) => snap(p, "restTravelSignal")),
    pace: groupByField(props, (p) => snap(p, "paceSignal")),
    marketBookCount: groupByField(
      props,
      (p) => p.bookCountBucket || p.signalSnapshot?.marketSignal || "not enough data"
    ),
    supportDangerGap: groupByField(
      props,
      (p) =>
        p.signalSnapshot?.supportDangerGapBucket ||
        p.supportDangerGapBucket ||
        "not enough data"
    ),
    confidenceBucket: groupByField(
      props,
      (p) => p.confidenceBucket || p.signalSnapshot?.confidenceBucket || "not enough data"
    ),
    projectionEdgeBucket: groupByField(
      props,
      (p) =>
        p.fairLineEdgeBucket ||
        p.signalSnapshot?.projectionEdgeBucket ||
        "not enough data"
    ),
    riskBucket: groupByField(props, (p) => normalizeRiskBucket(p.riskLabel)),
    tier: groupByField(props, (p) => p.tier || "UNKNOWN"),
  };
}

function buildLossMissReport(props = []) {
  const losses = props.filter(
    (p) => String(p.status || "").toLowerCase() === "loss"
  );

  return losses.map((prop) => {
    const { missType, explanation } = classifyLoss(prop);

    return {
      player: prop.player,
      game: prop.gameLabel || prop.game || "",
      propType: prop.stat || "Points",
      side: prop.currentEngineSide,
      line: prop.line,
      actualStat: prop.actualStat ?? null,
      confidence: prop.confidence,
      risk: prop.riskLabel || "",
      missType,
      explanation,
    };
  });
}

function buildCalibrationRecommendations(props = [], sections = {}) {
  const graded = props.filter((p) => isResolvedStatus(p.status));
  const decided = graded.filter((p) =>
    ["win", "loss"].includes(String(p.status).toLowerCase())
  );
  const totalDecided = decided.length;

  const trustMore = [];
  const trustLess = [];
  const riskBucketNotes = [];
  const projectionNotes = [];
  const sampleSizeGaps = [];
  let nextAdjustment = "Review loss/miss patterns after more slates grade.";
  let doNotAdjustYet = totalDecided < MIN_SAMPLE * 2;

  if (doNotAdjustYet) {
    nextAdjustment = "Do not adjust yet — overall sample too small.";
  }

  const signalPerf = sections.D || {};
  for (const [groupName, groups] of Object.entries(signalPerf)) {
    for (const [key, perf] of Object.entries(groups)) {
      if (key === "not enough data" || perf.needsMoreData) {
        sampleSizeGaps.push(`${groupName}/${key}: needs more data`);
        continue;
      }
      if (perf.winRate !== null && perf.winRate >= 60 && perf.graded >= MIN_SAMPLE) {
        trustMore.push(`${groupName} → ${key} (${perf.winRate}% on ${perf.graded} graded)`);
      }
      if (perf.winRate !== null && perf.winRate <= 40 && perf.graded >= MIN_SAMPLE) {
        trustLess.push(`${groupName} → ${key} (${perf.winRate}% on ${perf.graded} graded)`);
      }
    }
  }

  const riskBreakdown = sections.B || {};
  for (const [bucket, stats] of Object.entries(riskBreakdown)) {
    if (bucket === "UNKNOWN") continue;
    const decidedBucket = (stats.wins || 0) + (stats.losses || 0);
    if (decidedBucket < MIN_SAMPLE) {
      riskBucketNotes.push(`${bucket}: insufficient sample (${decidedBucket} decided)`);
    } else if (stats.winRate !== null && stats.winRate < 45) {
      riskBucketNotes.push(`${bucket}: underperforming at ${stats.winRate}% — review sizing`);
    } else if (stats.winRate !== null && stats.winRate >= 55) {
      riskBucketNotes.push(`${bucket}: performing at ${stats.winRate}% — monitor before changes`);
    }
  }

  const proj = sections.C || {};
  if (proj.bias === "too high") {
    projectionNotes.push("Projections skew high vs actuals — watch over-side inflation.");
  } else if (proj.bias === "too low") {
    projectionNotes.push("Projections skew low vs actuals — watch under-side inflation.");
  } else if (proj.needsMoreData) {
    projectionNotes.push("Not enough graded projection data for bias call.");
  } else {
    projectionNotes.push(`Projection bias appears ${proj.bias}.`);
  }

  if (totalDecided < MIN_SAMPLE) {
    sampleSizeGaps.push(`Slate has only ${totalDecided} decided props overall`);
  }

  return {
    signalsToTrustMore: trustMore.slice(0, 5),
    signalsToTrustLess: trustLess.slice(0, 5),
    riskBucketNotes,
    projectionNotes,
    sampleSizeGaps: [...new Set(sampleSizeGaps)].slice(0, 8),
    nextAdjustment,
    doNotAdjustYet,
    note: "Report only — no engine weights were changed.",
  };
}

function mapTierToLabBucket(tier = "") {
  const normalized = String(tier || "").toUpperCase();
  if (normalized === "PREMIUM" || normalized === "PLAYABLE") return "OFFICIAL";
  if (normalized === "WATCHLIST") return "WATCHLIST";
  if (normalized === "LEAN") return "LEAN/TESTING";
  return "SHADOW_TESTING";
}

function filterByLeague(props = [], league = "NBA") {
  return props.filter(
    (prop) => String(prop.league || "").toUpperCase() === league
  );
}

function buildTierPerformanceByTier(props = []) {
  const tiers = ["PREMIUM", "PLAYABLE", "WATCHLIST", "LEAN"];
  const result = {};

  for (const tier of tiers) {
    const tierProps = props.filter(
      (prop) => String(prop.tier || "").toUpperCase() === tier
    );
    if (tierProps.length === 0) continue;
    result[tier] = {
      ...buildGroupPerformance(tierProps),
      propCount: tierProps.length,
    };
  }

  return result;
}

export function buildLeagueSplitCalibration(props = []) {
  const leagues = ["NBA", "WNBA"];
  const byLeague = {};

  for (const league of leagues) {
    const leagueProps = filterByLeague(props, league);
    byLeague[league] = {
      propCount: leagueProps.length,
      record: buildRecord(leagueProps),
      premium: buildGroupPerformance(
        leagueProps.filter(
          (prop) => String(prop.tier || "").toUpperCase() === "PREMIUM"
        )
      ),
      playable: buildGroupPerformance(
        leagueProps.filter(
          (prop) => String(prop.tier || "").toUpperCase() === "PLAYABLE"
        )
      ),
      tierBuckets: buildTierPerformanceByTier(leagueProps),
      tierLabBuckets: buildTierLabBuckets(leagueProps),
      riskBuckets: buildRiskBucketBreakdown(leagueProps),
    };
  }

  return {
    structuralNotes: WNBA_STRUCTURAL_GAPS,
    byLeague,
    note: "Calibration split by league — WNBA picks use same tier/confidence math but skip availability gate and use neutral defense defaults.",
  };
}

function buildTierLabBuckets(props = []) {
  const groups = {
    OFFICIAL: [],
    WATCHLIST: [],
    SHADOW_TESTING: [],
    "LEAN/TESTING": [],
  };

  for (const prop of props) {
    const bucket = mapTierToLabBucket(prop.tier);
    groups[bucket].push(prop);
  }

  const buckets = {};
  for (const [key, groupProps] of Object.entries(groups)) {
    buckets[key] = {
      ...buildGroupPerformance(groupProps),
      propCount: groupProps.length,
    };
  }

  return buckets;
}

/** Slate dates with LAB-phase archives that should move to History. */
export function getStaleLabArchiveCandidates(rotation = {}, archives = []) {
  const keepLabDate = rotation.currentLabSlateDate;
  const candidates = new Set();

  for (const archive of archives) {
    const slateDate = String(archive?.slateDate || "");
    if (!slateDate || slateDate === keepLabDate) continue;
    if (!archive?.props?.length) continue;
    if (String(archive.phase || "").toUpperCase() === "ARCHIVED") continue;
    candidates.add(slateDate);
  }

  return [...candidates].sort();
}

/** Archive LAB-phase bundles superseded by the current Lab slate (rotation-aware). */
export function rotateStaleLabArchives(options = {}) {
  const trackedProps = options.trackedProps ?? getTrackedProps();
  const reports = options.reports ?? getRawDailySlateReports();
  const archives = options.archives ?? getAllHistoryArchives();
  const lockedSlates =
    options.lockedSlates ?? getLockedSlatesRegistry().slates ?? [];
  const quarantinedSlates =
    options.quarantinedSlates ?? getQuarantinedSlatesFromRegistry();
  const today = options.today ?? getTodayLocalDate();

  const rotation = computeSlateRotation(reports, {
    lockedSlates,
    archives,
    trackedProps,
    quarantinedSlates,
    today,
  });

  const keepLabDate = rotation.currentLabSlateDate;
  const archived = [];
  const skipped = [];

  for (const slateDate of getStaleLabArchiveCandidates(rotation, archives)) {
    const existing = getHistoryArchive(slateDate);
    if (!existing?.props?.length) {
      skipped.push({ slateDate, reason: "no_archive_props" });
      continue;
    }
    if (String(existing.phase || "").toUpperCase() === "ARCHIVED") {
      skipped.push({ slateDate, reason: "already_archived" });
      continue;
    }

    const report =
      reports.find((item) => String(item.slateDate || "") === slateDate) ||
      existing.report ||
      null;
    const result = archiveSlate(slateDate, { report });
    if (result.ok) {
      clearActiveTopPicksSnapshot(slateDate);
      archived.push({ slateDate, message: result.message });
    } else {
      skipped.push({ slateDate, reason: result.message || "archive_failed" });
    }
  }

  return {
    currentLabSlateDate: keepLabDate,
    historySlateDates: rotation.historySlateDates,
    archived,
    skipped,
  };
}

function rotateOlderLabArchives(reports = []) {
  rotateStaleLabArchives({ reports });
}

function getLedgerForLearning(prop = {}) {
  if (Array.isArray(prop.lockedScoreLedger) && prop.lockedScoreLedger.length) {
    return prop.lockedScoreLedger;
  }
  return prop.scoreLedger || [];
}

function buildTrackingCalibrationSplit(slateProps = []) {
  const officialProps = slateProps.filter(
    (prop) => String(prop.trackingType || prop.recordType || "").toUpperCase() === "OFFICIAL"
  );
  const testProps = slateProps.filter(
    (prop) => String(prop.trackingType || prop.recordType || "").toUpperCase() === "TEST"
  );
  const readerOfficialDemotedProps = testProps.filter(
    (prop) => prop.readerOfficialDemoted === true
  );
  const readerUncertainTestProps = testProps.filter(
    (prop) => prop.readerOfficialDemoted !== true
  );

  return {
    totalTracked: slateProps.length,
    officialCount: officialProps.length,
    testCount: testProps.length,
    readerOfficialDemotedCount: readerOfficialDemotedProps.length,
    readerUncertainTestCount: readerUncertainTestProps.length,
    officialRecord: buildRecord(officialProps),
    testRecord: buildRecord(testProps),
    readerOfficialDemotedRecord: buildRecord(readerOfficialDemotedProps),
    readerUncertainTestRecord: buildRecord(readerUncertainTestProps),
  };
}

function buildSlateReport(slateDate, props = [], options = {}) {
  const membership = options.membership || null;
  const membershipProps = membership?.props?.length ? membership.props : props;
  const rawSlateProps = membershipProps.filter(
    (prop) => (prop.slateDate || getSlateDateCT(prop.commenceTime)) === slateDate
  );
  // Persist postgame lessons + module attribution onto Lab-bound props.
  const slateProps = enrichGradedPropsForLab(rawSlateProps);
  const record = buildRecord(slateProps);
  const allGraded =
    record.pending === 0 &&
    slateProps.length > 0 &&
    !hasUnresolvedGradingProps(slateProps);
  const now = new Date().toISOString();
  const reportStatus = allGraded ? "final" : "in-progress";

  const trackingCalibration = buildTrackingCalibrationSplit(slateProps);
  const qualityGatePerformance = buildQualityGatePerformanceFromProps(slateProps);
  qualityGatePerformance.trackedRecord = buildRecord(
    slateProps.filter(
      (p) =>
        String(p.league).toUpperCase() === "WNBA" &&
        (p.wnbaTrackingDecision === "TRACK" ||
          p.trackingEligibility === "TRACK" ||
          !p.trackingEligibility)
    )
  );

  const wnbaV2GateReview = buildWnbaV2GateReview(slateProps);
  const decisionIntelligenceReview = buildDecisionIntelligenceReview(slateProps);
  const riskHonestyReview = buildRiskHonestyReview(slateProps);
  const upgradeDemotionReview = buildUpgradeDemotionReview(slateProps);
  const retroGateSimulation = allGraded
    ? buildDecisionIntelligenceRetroSimulation(slateProps, { slateDate })
    : null;
  const sideRescueReview = buildSideRescueReview(slateProps);
  const sideRescueRetroSimulation = allGraded
    ? buildSideRescueRetroSimulation(slateProps, { slateDate })
    : null;

  const sectionA = {
    title: "Slate Summary",
    slateDate,
    reportStatus,
    totalOfficialProps:
      membership?.propCount ||
      trackingCalibration.officialCount ||
      slateProps.length,
    totalTrackedProps: slateProps.length,
    officialPropsCount:
      membership?.propCount || trackingCalibration.officialCount,
    testPropsCount: trackingCalibration.testCount,
    readerOfficialDemotedCount: trackingCalibration.readerOfficialDemotedCount,
    readerUncertainTestCount: trackingCalibration.readerUncertainTestCount,
    trackingCalibration,
    qualityGatePerformance,
    wnbaV2GateReview,
    decisionIntelligenceReview,
    riskHonestyReview,
    upgradeDemotionReview,
    retroGateSimulation,
    sideRescueReview,
    sideRescueRetroSimulation,
    decisionIntelligenceVersion: DECISION_INTELLIGENCE_VERSION,
    sideRescueVersion: SIDE_RESCUE_VERSION,
    graded: record.graded,
    pending: record.pending,
    wins: record.wins,
    losses: record.losses,
    pushes: record.pushes,
    overallWinRate: record.winRate,
    leagues: [...new Set(slateProps.map((p) => p.league).filter(Boolean))],
    generatedAt: now,
    updatedAt: now,
  };

  const sectionB = {
    title: "Risk Bucket Breakdown",
    buckets: buildRiskBucketBreakdown(slateProps),
  };

  const sectionC = {
    title: "Projection/Fair Line Accuracy",
    ...buildProjectionAccuracy(slateProps),
  };

  const sectionD = {
    title: "Engine/Signal Performance",
    groups: buildEngineSignalPerformance(slateProps),
  };

  const sectionE = {
    title: "Loss/Miss Type Report",
    losses: buildLossMissReport(slateProps),
    totalLosses: slateProps.filter(
      (p) => String(p.status).toLowerCase() === "loss"
    ).length,
  };

  const sectionF = {
    title: "Calibration Recommendations",
    ...buildCalibrationRecommendations(slateProps, {
      B: sectionB.buckets,
      C: sectionC,
      D: sectionD.groups,
    }),
  };

  const reportCard = buildEngineReportCardBundle(slateProps, {
    slateDate,
    reportStatus,
    locked: Boolean(options.locked),
    getLedger: getLedgerForLearning,
  });

  const sectionG = {
    title: "Engine Scorecard",
    ...reportCard.engineScorecard,
  };

  const sectionH = {
    title: "Mistake Breakdown",
    ...reportCard.mistakeBreakdown,
  };

  const sectionI = {
    title: "Calibration Rules",
    ...reportCard.calibrationRules,
  };

  const sectionJ = {
    title: "Slate Lesson",
    ...reportCard.slateLesson,
  };

  const tierLabBuckets = buildTierLabBuckets(slateProps);
  const leagueSplit = buildLeagueSplitCalibration(slateProps);
  const topPicksReview =
    options.topPicksReview ||
    buildTopPicksReview(slateDate, slateProps) ||
    {
      title: "Top Picks Selection Review",
      slateDate,
      snapshotMissing: true,
      message: "No Top Picks snapshot found for this slate.",
      referenceOnly: true,
    };
  const bestSixReview =
    options.bestSixReview ||
    buildBestSixReview(slateDate, slateProps) ||
    {
      title: "Controlled Best 6 Performance",
      slateDate,
      snapshotMissing: true,
      message: "No Best 6 snapshot found for this slate.",
      referenceOnly: true,
    };

  const slateResultsSnapshot =
    options.slateResultsSnapshot ||
    buildSlateResultsSnapshot(slateProps, { slateDate });

  const signalPerformance = buildSignalPerformanceTable(slateProps, { slateDate });

  const sectionL = {
    title: "League-Split Calibration",
    ...leagueSplit,
  };

  const baseReport = {
    slateDate,
    officialSlateId: membership?.officialSlateId || slateDate,
    officialPropIds:
      membership?.officialPropIds ||
      slateProps.map((p) => p.officialPropId).filter(Boolean),
    officialMembershipSource: membership?.source || null,
    status: reportStatus,
    reportStatus,
    locked: Boolean(options.locked),
    frozen: Boolean(options.frozen),
    generatedAt: now,
    updatedAt: now,
    engineScorecard: reportCard.engineScorecard,
    mistakeBreakdown: reportCard.mistakeBreakdown,
    calibrationRules: reportCard.calibrationRules,
    slateLesson: reportCard.slateLesson,
    wnbaStructuralGaps: reportCard.wnbaStructuralGaps,
    tierLabBuckets,
    leagueSplit,
    topPicksReview,
    bestSixReview,
    slateResultsSnapshot,
    sideRescueReview,
    sideRescueRetroSimulation,
    signalPerformance,
    signalPerformanceVersion: SIGNAL_PERFORMANCE_VERSION,
    lifecycleIntegrity: validateOfficialSlateLifecycle(slateDate, {
      trackedProps: slateProps,
    }),
    sections: {
      A: {
        ...sectionA,
        tierLabBuckets,
        leagueSplit,
      },
      B: sectionB,
      C: sectionC,
      D: sectionD,
      E: sectionE,
      F: sectionF,
      G: sectionG,
      H: sectionH,
      I: sectionI,
      J: sectionJ,
      K: {
        title: "Tier Lab Buckets",
        buckets: tierLabBuckets,
      },
      L: sectionL,
      M: {
        title: "Top Picks Selection Review",
        ...topPicksReview,
      },
      O: {
        title: "Controlled Best 6 Performance",
        ...bestSixReview,
      },
      P: {
        title: "Slate Results Snapshot",
        ...slateResultsSnapshot,
      },
      N: {
        title: "WNBA v2 Gate Review",
        ...wnbaV2GateReview,
        ...qualityGatePerformance,
      },
      Q: {
        title: "WNBA v2 Gate Review Detail",
        ...wnbaV2GateReview,
      },
      R: retroGateSimulation
        ? {
            title: "Decision Intelligence Retro Simulation",
            available: true,
            ...retroGateSimulation,
          }
        : {
            title: "Decision Intelligence Retro Simulation",
            reportOnly: true,
            available: false,
            message: "Retro simulation runs when slate is fully graded.",
          },
      S: {
        title: "Decision Intelligence Review",
        ...decisionIntelligenceReview,
      },
      T: {
        title: "Risk Honesty Review",
        ...riskHonestyReview,
      },
      U: {
        title: "Upgrade/Demotion Review",
        ...upgradeDemotionReview,
      },
      V: {
        title: "Side Rescue Review",
        ...sideRescueReview,
      },
      W: sideRescueRetroSimulation
        ? {
            title: "Side Rescue Retro Simulation",
            available: true,
            ...sideRescueRetroSimulation,
          }
        : {
            title: "Side Rescue Retro Simulation",
            reportOnly: true,
            available: false,
            message: "Retro simulation runs when slate is fully graded.",
          },
      X: {
        title: "Signal Performance",
        version: SIGNAL_PERFORMANCE_VERSION,
        ...signalPerformance,
      },
    },
  };

  // Lab enrichment: mine locked props into durable learning records (no rebuild).
  const withLearning = attachOfficialLearningToReport(baseReport, slateProps);
  // Lab V2: one authoritative analysis payload (does not mutate sealed pregame).
  return attachLabV2ToReport(withLearning, {
    trackedProps: getTrackedProps(),
    archives: getAllHistoryArchives(),
    reports: [withLearning],
    persistThreeSlate: true,
  });
}

function sortReportsByDateDesc(reports = []) {
  return [...reports].sort((a, b) =>
    String(b.slateDate).localeCompare(String(a.slateDate))
  );
}

export function getRawDailySlateReports() {
  return sortReportsByDateDesc(readJSON(REPORTS_FILE, []));
}

export function getDailySlateReports() {
  const quarantinedSlates = getQuarantinedSlatesFromRegistry();
  return filterOutQuarantinedReports(
    filterValidDailyReports(getRawDailySlateReports()),
    quarantinedSlates
  );
}

/** Lifecycle-facing reports: valid filtered + raw/inferred stubs for current Lab and History. */
export function getLifecycleDeliverableReports(options = {}) {
  const {
    rotation = null,
    trackedProps = getTrackedProps(),
    quarantinedSlates = getQuarantinedSlatesFromRegistry(),
    today = getTodayLocalDate(),
  } = options;

  const rawReports = getRawDailySlateReports();
  const filtered = getDailySlateReports();
  const byDate = new Map(
    filtered.map((report) => [String(report.slateDate || ""), report])
  );

  const lifecycleDates = rotation
    ? [
        rotation.currentLabSlateDate,
        rotation.viewedSlateDate,
        ...(rotation.historySlateDates || []),
      ].filter(Boolean)
    : [];

  const uniqueDates = [...new Set(lifecycleDates.map(String))];
  if (!uniqueDates.length) {
    return filtered;
  }

  const inferred = inferCompletedReportsFromTrackedProps(
    trackedProps,
    rawReports,
    today,
    quarantinedSlates
  );

  for (const slateDate of uniqueDates) {
    if (byDate.has(slateDate)) continue;
    const raw = rawReports.find((report) => String(report.slateDate) === slateDate);
    if (raw) {
      byDate.set(slateDate, raw);
      continue;
    }
    const stub = inferred.find((report) => String(report.slateDate) === slateDate);
    if (stub) {
      byDate.set(slateDate, stub);
    }
  }

  return sortReportsByDateDesc([...byDate.values()]);
}

export function resolveDeliverableDailySlateReport(slateDate, options = {}) {
  const date = String(slateDate || "");
  if (!date) return null;

  const direct = getDailySlateReport(date);
  if (direct) return direct;

  const raw = getRawDailySlateReports().find((report) => String(report.slateDate) === date);
  if (raw) return raw;

  const {
    trackedProps = getTrackedProps(),
    quarantinedSlates = getQuarantinedSlatesFromRegistry(),
    today = getTodayLocalDate(),
  } = options;

  return (
    inferCompletedReportsFromTrackedProps(
      trackedProps,
      getRawDailySlateReports(),
      today,
      quarantinedSlates
    ).find((report) => String(report.slateDate) === date) || null
  );
}

export function removeDailySlateReport(slateDate) {
  const date = String(slateDate || "");
  if (!date) {
    return { ok: false, message: "Missing slateDate", removed: false };
  }

  const reports = readJSON(REPORTS_FILE, []);
  const nextReports = reports.filter((report) => String(report.slateDate || "") !== date);
  const removed = nextReports.length !== reports.length;

  if (removed) {
    writeJSON(REPORTS_FILE, nextReports);
  }

  return {
    ok: true,
    message: removed
      ? `Daily slate report removed for ${date}`
      : `No daily slate report found for ${date}`,
    slateDate: date,
    removed,
    reports: getDailySlateReports(),
  };
}

export function getDailySlateReport(slateDate) {
  const date = String(slateDate || "");
  if (isQuarantinedSlateDate(date, getQuarantinedSlatesFromRegistry())) {
    return null;
  }

  const reports = getDailySlateReports();
  return reports.find((report) => report.slateDate === date) || null;
}

export function upsertDailySlateReport(report = {}) {
  const slateDate = String(report.slateDate || "");
  if (!slateDate) {
    return { ok: false, message: "Missing slateDate", report: null };
  }

  const reports = readJSON(REPORTS_FILE, []);
  const existingIndex = reports.findIndex((item) => item.slateDate === slateDate);
  const existing = existingIndex >= 0 ? reports[existingIndex] : null;
  const now = new Date().toISOString();

  const nextReport = {
    ...existing,
    ...report,
    slateDate,
    updatedAt: now,
    generatedAt: existing?.generatedAt || report.generatedAt || now,
  };

  if (existingIndex >= 0) {
    reports[existingIndex] = nextReport;
  } else {
    reports.push(nextReport);
  }

  writeJSON(REPORTS_FILE, reports);

  return { ok: true, message: "Daily slate report saved", report: nextReport, reports: getDailySlateReports() };
}

export function buildDailySlateReportsFromTrackedProps(
  trackedProps = getTrackedProps(),
  options = {}
) {
  const targetSlateDate = options.slateDate ? String(options.slateDate) : null;
  const forceRebuild = Boolean(options.forceRebuild);

  const slateDates = targetSlateDate
    ? [targetSlateDate]
    : [
        ...new Set(
          trackedProps
            .map((prop) => prop.slateDate || getSlateDateCT(prop.commenceTime))
            .filter(Boolean)
        ),
      ].sort();

  const built = [];
  const results = [];

  for (const slateDate of slateDates) {
    if (!isOnOrAfterCleanDataCutoff(slateDate)) {
      results.push({
        slateDate,
        skipped: true,
        skipReason: "pre_cutoff_slate",
      });
      continue;
    }

    if (isFutureSlateDate(slateDate, getTodayLocalDate())) {
      results.push({
        slateDate,
        skipped: true,
        skipReason: "future_slate",
      });
      continue;
    }

    const existing = getDailySlateReport(slateDate);
    const locked = isSlateLocked(slateDate);
    const snapshot = locked ? getLockedSnapshot(slateDate) : null;
    const liveSlateProps = trackedProps.filter(
      (prop) =>
        (prop.slateDate || getSlateDateCT(prop.commenceTime)) === slateDate
    );

    let slateProps = liveSlateProps;
    const membership = mergeMembershipWithLiveGrades(
      resolveOfficialSlateMembership(slateDate, trackedProps),
      liveSlateProps
    );
    if (membership.props?.length) {
      slateProps = membership.props;
    } else if (locked && snapshot?.props?.length) {
      slateProps = mergeSnapshotPropsWithLiveGrades(snapshot.props, liveSlateProps);
      syncGradedPropsToLockedSlate(slateDate, slateProps);
    } else if (snapshot?.props?.length) {
      slateProps = snapshot.props;
    }

    if (!membership.props?.length && liveSlateProps.length) {
      logLifecycleIntegrityFailure({
        code: "REPORT_BUILD_WITHOUT_OFFICIAL_MEMBERSHIP",
        slateDate,
        trackedCount: liveSlateProps.length,
      });
    }

    const preview = buildSlateReport(slateDate, slateProps, {
      locked,
      membership,
    });
    const isFinal = preview.reportStatus === "final";

    if (
      !forceRebuild &&
      existing &&
      existing.frozen === true &&
      existing.reportStatus === "final"
    ) {
      built.push(existing);
      results.push({
        slateDate,
        status: existing.status,
        reportStatus: existing.reportStatus,
        propCount: existing.sections?.A?.totalOfficialProps ?? 0,
        pending: existing.sections?.A?.pending ?? 0,
        upserted: false,
        frozen: true,
        skipped: true,
      });
      continue;
    }

    if (
      !forceRebuild &&
      locked &&
      isFinal &&
      existing &&
      existing.reportStatus === "final"
    ) {
      built.push(existing);
      results.push({
        slateDate,
        status: existing.status,
        reportStatus: existing.reportStatus,
        propCount: existing.sections?.A?.totalOfficialProps ?? 0,
        pending: existing.sections?.A?.pending ?? 0,
        upserted: false,
        frozen: true,
        skipped: true,
      });
      continue;
    }

    const report = buildSlateReport(slateDate, slateProps, {
      locked,
      frozen: locked && isFinal,
      topPicksReview: buildTopPicksReview(slateDate, trackedProps),
      membership,
    });

    const integrity = validateMembershipIntegrity(membership, report);
    if (!integrity.ok) {
      logLifecycleIntegrityFailure({
        code: "REPORT_MEMBERSHIP_INTEGRITY_FAILURE",
        slateDate,
        failures: integrity.failures,
      });
      if (isFinal) {
        results.push({
          slateDate,
          skipped: true,
          integrityFailure: true,
          failures: integrity.failures,
        });
        continue;
      }
    }

    const upsert = upsertDailySlateReport({
      ...report,
      frozen: locked && isFinal,
      topPicksSnapshot: archiveTopPicksSnapshotToReportMetadata(slateDate),
    });
    built.push(report);
    results.push({
      slateDate,
      status: report.status,
      reportStatus: report.reportStatus,
      propCount: report.sections.A.totalOfficialProps,
      pending: report.sections.A.pending,
      upserted: upsert.ok,
      frozen: locked && isFinal,
      locked,
    });

    if (isFinal) {
      if (hasUnresolvedGradingProps(slateProps)) {
        results[results.length - 1].labPromotionBlocked = true;
        results[results.length - 1].labPromotionReason =
          "Slate has props awaiting stats or unresolved grades";
      } else {
        writeSlateHistoryArchive(slateDate, {
          props: slateProps,
          report,
        });
        attachGradedResultsToSnapshot(slateDate, trackedProps);
        promoteSlateToLab(slateDate, { report, props: slateProps });
        clearActiveTopPicksSnapshot(slateDate);
      }
    }
  }

  rotateOlderLabArchives(getDailySlateReports());

  return {
    reports: getDailySlateReports(),
    built,
    summary: {
      slateCount: built.length,
      finalCount: built.filter((report) => report.status === "final").length,
      inProgressCount: built.filter((report) => report.status === "in-progress")
        .length,
      slates: results,
    },
  };
}

export function attemptDailySlateReportBuild(trackedProps = getTrackedProps(), options = {}) {
  return buildDailySlateReportsFromTrackedProps(trackedProps, options);
}
