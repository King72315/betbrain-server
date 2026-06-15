import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getSlateDateCT, getTrackedProps } from "./trackedPropService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPORTS_FILE = path.join(__dirname, "..", "daily-slate-reports.json");
const BACKUP_FILE = path.join(
  __dirname,
  "..",
  "daily-slate-reports-backup-before-phase1.json"
);

const MIN_SAMPLE = 3;

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

  if (
    dangerReasons.some((r) => /injury|limited|questionable|out/i.test(String(r))) ||
    (prop.warningReasons || []).some((r) => /injury|limited/i.test(String(r)))
  ) {
    return {
      missType: "injury/limited minutes",
      explanation: "Injury or availability warning was present in the pick profile.",
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

function buildSlateReport(slateDate, props = []) {
  const slateProps = props.filter(
    (prop) => (prop.slateDate || getSlateDateCT(prop.commenceTime)) === slateDate
  );
  const record = buildRecord(slateProps);
  const allGraded = record.pending === 0 && slateProps.length > 0;
  const now = new Date().toISOString();
  const reportStatus = allGraded ? "final" : "in-progress";

  const sectionA = {
    title: "Slate Summary",
    slateDate,
    reportStatus,
    totalOfficialProps: slateProps.length,
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

  return {
    slateDate,
    status: reportStatus,
    reportStatus,
    generatedAt: now,
    updatedAt: now,
    sections: {
      A: sectionA,
      B: sectionB,
      C: sectionC,
      D: sectionD,
      E: sectionE,
      F: sectionF,
    },
  };
}

export function getDailySlateReports() {
  const reports = readJSON(REPORTS_FILE, []);
  return reports.sort((a, b) => String(b.slateDate).localeCompare(String(a.slateDate)));
}

export function getDailySlateReport(slateDate) {
  const reports = getDailySlateReports();
  return reports.find((report) => report.slateDate === slateDate) || null;
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
    const report = buildSlateReport(slateDate, trackedProps);
    const upsert = upsertDailySlateReport(report);
    built.push(report);
    results.push({
      slateDate,
      status: report.status,
      reportStatus: report.reportStatus,
      propCount: report.sections.A.totalOfficialProps,
      pending: report.sections.A.pending,
      upserted: upsert.ok,
    });
  }

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
