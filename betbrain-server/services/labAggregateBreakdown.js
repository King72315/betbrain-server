/**
 * Lab aggregate learning breakdown — every signal dimension with small-sample visibility.
 */

function num(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(values = []) {
  const nums = values.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
  if (!nums.length) return null;
  return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
}

function emptyRow(dimension, value) {
  return {
    dimension,
    value: value ?? "ALL",
    n: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    record: "0-0-0",
    winRate: null,
    avgMargin: null,
    avgProjectionError: null,
    avgConfidence: null,
    modulesHelped: {},
    modulesHurt: {},
    modulesNeutral: {},
    propIds: [],
    smallSample: true,
  };
}

function bumpModule(map, mod, kind) {
  if (!mod) return;
  if (!map[mod]) map[mod] = { helped: 0, hurt: 0, neutral: 0 };
  map[mod][kind] += 1;
}

function rollupRecords(records = [], dimension, getKey) {
  const groups = new Map();
  for (const rec of records) {
    const key = getKey(rec);
    if (key == null || key === "") continue;
    const k = String(key);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(rec);
  }

  const rows = [];
  for (const [value, group] of groups.entries()) {
    let wins = 0;
    let losses = 0;
    let pushes = 0;
    const margins = [];
    const errors = [];
    const confidences = [];
    const helped = {};
    const hurt = {};
    const neutral = {};
    const propIds = [];

    for (const rec of group) {
      propIds.push(rec.officialPropId);
      if (rec.outcome?.won) wins += 1;
      else if (rec.outcome?.lost) losses += 1;
      else if (rec.outcome?.push) pushes += 1;
      if (rec.outcome?.margin != null) margins.push(rec.outcome.margin);
      if (rec.projection?.absoluteError != null) errors.push(rec.projection.absoluteError);
      if (rec.projection?.projectionStrength != null) {
        confidences.push(rec.projection.projectionStrength);
      }
      for (const m of rec.calibration?.modulesHelped || []) bumpModule(helped, m, "helped");
      for (const m of rec.calibration?.modulesHurt || []) bumpModule(hurt, m, "hurt");
      for (const m of rec.calibration?.modulesNeutral || []) bumpModule(neutral, m, "neutral");
    }

    const decided = wins + losses;
    rows.push({
      dimension,
      value,
      n: group.length,
      wins,
      losses,
      pushes,
      record: `${wins}-${losses}-${pushes}`,
      winRate: decided > 0 ? Number(((wins / decided) * 100).toFixed(1)) : null,
      avgMargin: avg(margins),
      avgProjectionError: avg(errors),
      avgConfidence: avg(confidences),
      modulesHelped: helped,
      modulesHurt: hurt,
      modulesNeutral: neutral,
      // Keep ids only — embedding full learning records here duplicated every
      // dimension row and ballooned daily-slate-reports.json past free-tier RAM
      // (Render 502 before listen). Full packets stay on officialLearningRecords.
      propIds,
      smallSample: group.length < 3,
    });
  }

  return rows.sort((a, b) => b.n - a.n);
}

function confidenceBucket(conf) {
  const c = num(conf);
  if (c == null) return "unknown";
  if (c < 60) return "<60";
  if (c < 70) return "60-69";
  if (c < 80) return "70-79";
  if (c < 90) return "80-89";
  return "90+";
}

function clvBucket(clv) {
  const v = num(clv);
  if (v == null) return "unknown";
  if (v <= -1.5) return "<=-1.5";
  if (v < 0) return "-1.5..0";
  if (v === 0) return "0";
  if (v <= 1) return "0..1";
  return ">1";
}

function minutesDeltaBucket(rec) {
  const exp = num(rec.pregameSnapshot?.expectedMinutes);
  const act = num(rec.postgameLearning?.actualMinutes);
  if (exp == null || act == null) return "unknown";
  const d = act - exp;
  if (d <= -6) return "<=-6";
  if (d <= -3) return "-6..-3";
  if (d < 3) return "-3..+3";
  if (d < 6) return "+3..+6";
  return ">=+6";
}

function fgaDeltaBucket(rec) {
  const exp = num(rec.pregameSnapshot?.expectedFGA);
  const act = num(rec.postgameLearning?.actualFGA);
  if (exp == null || act == null) return "unknown";
  const d = act - exp;
  if (d <= -4) return "<=-4";
  if (d <= -2) return "-4..-2";
  if (d < 2) return "-2..+2";
  if (d < 4) return "+2..+4";
  return ">=+4";
}

export function buildLabAggregateBreakdown(records = []) {
  const list = Array.isArray(records) ? records : [];
  if (!list.length) {
    return { version: "lab-aggregate-breakdown-v1", rows: [], dimensionIndex: {} };
  }

  const dimensionFns = [
    ["side", (r) => r.sideAnalysis?.chosenSide],
    ["pool", (r) => (r.isTopPick ? "TOP_2" : "BEST_6")],
    ["risk", (r) => r.decisionIntelligence?.risk],
    ["confidence_bucket", (r) => confidenceBucket(r.projection?.projectionStrength)],
    ["projection_gap", (r) => r.projection?.gapBucket],
    ["player_profile", (r) => r.playerIntelligence?.profileType],
    ["role_stability", (r) => r.playerIntelligence?.roleStability],
    ["minutes_stability", (r) => r.playerIntelligence?.minutesStability],
    ["scoring_volatility", (r) => r.playerIntelligence?.scoringVariance],
    ["role_trend", (r) => r.playerIntelligence?.roleTrend],
    ["book_count", (r) => (r.market?.bookCount != null ? String(r.market.bookCount) : null)],
    ["market_quality", (r) => (r.market?.marketQuality != null ? String(r.market.marketQuality) : null)],
    [
      "same_team_opportunity",
      (r) =>
        r.pregameSnapshot?.sameTeamOpportunity?.opportunityAssessment ||
        r.pregameSnapshot?.sameTeamOpportunity?.status ||
        null,
    ],
    ["flip_first", (r) => r.flipFirst?.action || (r.flipFirst?.triggered ? "FLIP" : "NO_FLIP")],
    ["side_rescue", (r) => r.sideAnalysis?.rescueAction || "NONE"],
    ["gate", (r) => r.trackingGate?.gateDecision],
    ["gate_reason", (r) => r.trackingGate?.gateReason],
    [
      "natural_decision",
      (r) => r.trackingGate?.naturalDecision || r.naturalDecision || null,
    ],
    [
      "promoted_fill",
      (r) =>
        r.trackingGate?.promotedForBestSix || r.trackingGate?.bestSixPromoted
          ? "PROMOTED"
          : "NATURAL",
    ],
    [
      "reader_gate_disagreement",
      (r) => (r.trackingGate?.readerGateDisagreement ? "DISAGREE" : "AGREE"),
    ],
    [
      "reader_vs_gate",
      (r) => {
        const label =
          r.reader?.evidence ||
          (r.projection?.gapBucket != null
            ? `gap:${r.projection.gapBucket}`
            : "unknown");
        const gate =
          r.trackingGate?.naturalDecision ||
          r.trackingGate?.gateDecision ||
          "unknown";
        return `${label}|${gate}`;
      },
    ],
    [
      "top2_promotion",
      (r) => {
        if (!r.isTopPick) return null;
        return r.trackingGate?.promotedForBestSix || r.trackingGate?.bestSixPromoted
          ? "TOP_PROMOTED"
          : "TOP_NATURAL";
      },
    ],
    ["miss_type", (r) => r.postgameLearning?.missType],
    ["data_mode", (r) => r.pregameSnapshot?.dataMode || r.decisionIntelligence?.dataMode],
    ["minutes_delta", minutesDeltaBucket],
    ["fga_delta", fgaDeltaBucket],
    ["clv_bucket", (r) => clvBucket(r.market?.closingLineValue)],
    [
      "opponent_defense_signal",
      (r) => r.pregameSnapshot?.signalSnapshot?.opponentDefenseSignal || null,
    ],
    ["recent_form_signal", (r) => r.pregameSnapshot?.signalSnapshot?.last5Signal || null],
    ["season_form_signal", (r) => r.pregameSnapshot?.signalSnapshot?.seasonAverageSignal || null],
  ];

  const dimensionIndex = {};
  const allRows = [];

  for (const [dimension, getKey] of dimensionFns) {
    const rows = rollupRecords(list, dimension, getKey);
    dimensionIndex[dimension] = rows;
    allRows.push(...rows);
  }

  const debtRows = [];
  const repairRows = [];
  for (const rec of list) {
    for (const d of rec.decisionIntelligence?.debtCategories || []) {
      debtRows.push({ ...rec, _rollupKey: d });
    }
    for (const r of rec.decisionIntelligence?.repairCategories || []) {
      repairRows.push({ ...rec, _rollupKey: r });
    }
  }
  dimensionIndex.risk_debt = rollupRecords(debtRows, "risk_debt", (r) => r._rollupKey);
  dimensionIndex.risk_repair = rollupRecords(repairRows, "risk_repair", (r) => r._rollupKey);

  const overall = rollupRecords(list, "slate", () => "ALL")[0] || emptyRow("slate", "ALL");

  return {
    version: "lab-aggregate-breakdown-v1",
    overall,
    dimensionIndex,
    rows: allRows,
    recordCount: list.length,
  };
}
