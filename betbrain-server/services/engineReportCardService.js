const MIN_SAMPLE = 3;
const EARLY_SIGNAL_MAX = 4;

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

function getProjectionValue(prop = {}) {
  const ps = prop.playerState || {};
  const value =
    prop.projection ??
    prop.sportsProjection ??
    ps.sportsProjection ??
    null;
  return value !== null && Number.isFinite(Number(value)) && num(value) !== 0
    ? num(value)
    : value !== null && Number.isFinite(Number(value))
      ? num(value)
      : null;
}

function getMargin(prop = {}) {
  const m = prop.resultMargin ?? prop.margin ?? prop.currentEngineMargin;
  return m !== null && m !== undefined && Number.isFinite(Number(m)) ? num(m) : null;
}

function getSide(prop = {}) {
  return String(prop.currentEngineSide || prop.side || prop.pick || "").toLowerCase();
}

function buildRecordFromProps(props = []) {
  const graded = props.filter((p) => isResolvedStatus(p.status));
  const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
  const losses = graded.filter((p) => String(p.status).toLowerCase() === "loss").length;
  const pushes = graded.filter((p) => String(p.status).toLowerCase() === "push").length;
  const decided = wins + losses;
  const winRate = decided > 0 ? Number(((wins / decided) * 100).toFixed(1)) : null;
  const margins = graded
    .map(getMargin)
    .filter((m) => m !== null && Number.isFinite(m));

  return {
    sampleSize: props.length,
    graded: graded.length,
    wins,
    losses,
    pushes,
    decided,
    winRate,
    record: `${wins}-${losses}-${pushes}`,
    avgMargin: avg(margins),
  };
}

function deriveStatus(decided, winRate) {
  if (decided < MIN_SAMPLE) return "NOT ENOUGH DATA";
  if (winRate === null) return "NOT ENOUGH DATA";
  if (winRate >= 55) return "WORKING";
  if (winRate >= 45) return "WEAK";
  return "FAILING";
}

function buildEngineLesson(engineName, stats = {}) {
  const { status, winRate, decided, earlySignal, avgMargin } = stats;

  if (stats.hasData === false || stats.sampleSize === 0) {
    return "Field not present on tracked props — cannot score this engine yet.";
  }
  if (decided === 0) {
    return "No graded props yet — check back after games finish.";
  }
  if (status === "NOT ENOUGH DATA") {
    return earlySignal
      ? `Early signal only (${decided} decided) — treat as directional, not conclusive.`
      : `Only ${decided} decided prop(s) — need ${MIN_SAMPLE}+ for a status call.`;
  }

  const marginNote =
    avgMargin !== null
      ? avgMargin > 0
        ? ` Average margin +${avgMargin}.`
        : avgMargin < 0
          ? ` Average margin ${avgMargin}.`
          : ""
      : "";

  if (status === "WORKING") {
    return `${winRate}% win rate on ${decided} decided — engine is contributing.${marginNote}`;
  }
  if (status === "WEAK") {
    return `${winRate}% win rate — mixed results; monitor before changing weights.${marginNote}`;
  }
  return `${winRate}% win rate — engine underperformed this slate; review before trusting.${marginNote}`;
}

function buildEngineEntry(engineName, props = [], hasData = true) {
  const stats = buildRecordFromProps(props);
  const status = hasData ? deriveStatus(stats.decided, stats.winRate) : "NOT ENOUGH DATA";
  const earlySignal = stats.decided >= 1 && stats.decided <= EARLY_SIGNAL_MAX;

  const entry = {
    engine: engineName,
    record: stats.record,
    winRate: stats.winRate,
    sampleSize: stats.sampleSize,
    gradedCount: stats.decided,
    avgMargin: stats.avgMargin,
    status,
    earlySignal,
    lesson: buildEngineLesson(engineName, {
      ...stats,
      status,
      earlySignal,
      hasData,
    }),
    hasData,
  };

  return entry;
}

function filterWithField(props, predicate) {
  return props.filter(predicate);
}

function projectionSupportsSide(prop) {
  const projection = getProjectionValue(prop);
  const line = num(prop.line);
  const side = getSide(prop);
  if (projection === null || !line) return false;
  if (side === "over") return projection >= line;
  if (side === "under") return projection <= line;
  return false;
}

function fairLineSupportsSide(prop) {
  const fairSide = String(prop.fairLineSide || prop.signalSnapshot?.fairLineSide || "").toUpperCase();
  const pickSide = String(prop.currentEngineSide || "").toUpperCase();
  if (fairSide === "NONE" || !fairSide) return false;
  if (pickSide === "OVER" || pickSide === "O") return fairSide === "OVER";
  if (pickSide === "UNDER" || pickSide === "U") return fairSide === "UNDER";
  return false;
}

function recentFormActive(prop) {
  const sig = prop.signalSnapshot?.last5Signal;
  return sig && sig !== "not enough data";
}

function minutesOpportunityActive(prop) {
  const sig = prop.signalSnapshot?.usageMinutesSignal;
  return (
    (sig && sig !== "not enough data") ||
    num(prop.expectedMinutes) > 0 ||
    num(prop.playerState?.seasonMinutes) > 0
  );
}

function dataCoverageActive(prop) {
  return (
    num(prop.dataCoverage) > 0 ||
    num(prop.dataQuality) > 0 ||
    Boolean(prop.dataMode) ||
    Boolean(prop.playerState?.dataMode)
  );
}

export function buildEngineScorecard(props = []) {
  const engines = [];

  const projectionProps = filterWithField(
    props,
    (p) => getProjectionValue(p) !== null
  );
  engines.push(
    buildEngineEntry("Projection Engine", projectionProps, projectionProps.length > 0)
  );

  const fairLineProps = filterWithField(
    props,
    (p) =>
      (p.fairLine !== null && p.fairLine !== undefined && num(p.fairLine) !== 0) ||
      String(p.fairLineSide || p.signalSnapshot?.fairLineSide || "NONE").toUpperCase() !==
        "NONE"
  );
  engines.push(
    buildEngineEntry("Fair Line Engine", fairLineProps, fairLineProps.length > 0)
  );

  const marketProps = filterWithField(
    props,
    (p) => num(p.bookCount) > 0 || num(p.marketQuality) > 0
  );
  engines.push(
    buildEngineEntry(
      "Market Quality / Book Count",
      marketProps,
      marketProps.length > 0
    )
  );

  const confidenceProps = filterWithField(
    props,
    (p) => num(p.confidence) > 0 || Boolean(p.confidenceBucket)
  );
  engines.push(
    buildEngineEntry("Confidence Engine", confidenceProps, confidenceProps.length > 0)
  );

  const riskProps = filterWithField(props, (p) => Boolean(p.riskLabel));
  engines.push(
    buildEngineEntry("Risk Label Engine", riskProps, riskProps.length > 0)
  );

  const tierProps = filterWithField(props, (p) => Boolean(p.tier));
  engines.push(buildEngineEntry("Tier Engine", tierProps, tierProps.length > 0));

  const recentFormProps = filterWithField(props, recentFormActive);
  engines.push(
    buildEngineEntry("Recent Form", recentFormProps, recentFormProps.length > 0)
  );

  const minutesProps = filterWithField(props, minutesOpportunityActive);
  engines.push(
    buildEngineEntry(
      "Minutes / Opportunity",
      minutesProps,
      minutesProps.length > 0
    )
  );

  const dataProps = filterWithField(props, dataCoverageActive);
  engines.push(
    buildEngineEntry("Data Coverage", dataProps, dataProps.length > 0)
  );

  const nbaProps = filterWithField(props, (p) => String(p.league).toUpperCase() === "NBA");
  engines.push(buildEngineEntry("League — NBA", nbaProps, nbaProps.length > 0));

  const wnbaProps = filterWithField(props, (p) => String(p.league).toUpperCase() === "WNBA");
  engines.push(buildEngineEntry("League — WNBA", wnbaProps, wnbaProps.length > 0));

  const overProps = filterWithField(props, (p) => getSide(p) === "over");
  engines.push(buildEngineEntry("Side — Over", overProps, overProps.length > 0));

  const underProps = filterWithField(props, (p) => getSide(p) === "under");
  engines.push(buildEngineEntry("Side — Under", underProps, underProps.length > 0));

  const losses = props.filter((p) => String(p.status).toLowerCase() === "loss");
  engines.push(
    buildEngineEntry("Miss Type Engine", losses, losses.length > 0 || props.length > 0)
  );

  return {
    engines,
    summary: {
      totalEngines: engines.length,
      working: engines.filter((e) => e.status === "WORKING").length,
      weak: engines.filter((e) => e.status === "WEAK").length,
      failing: engines.filter((e) => e.status === "FAILING").length,
      notEnoughData: engines.filter((e) => e.status === "NOT ENOUGH DATA").length,
    },
  };
}

export function classifyCalibrationMistake(prop = {}) {
  if (String(prop.status || "").toLowerCase() !== "loss") return null;

  const absMargin = Math.abs(num(getMargin(prop) ?? 0));
  const side = getSide(prop);
  const line = num(prop.line);
  const projection = getProjectionValue(prop);
  const fairLine = num(prop.fairLine);
  const confidence = num(prop.confidence);
  const bookCount = num(prop.bookCount);
  const marketQuality = num(prop.marketQuality);
  const dataCoverage = num(prop.dataCoverage ?? prop.dataQuality);
  const tier = String(prop.tier || "").toUpperCase();
  const riskBucket = normalizeRiskBucket(prop.riskLabel);
  const dataMode = String(prop.dataMode || prop.playerState?.dataMode || "");

  const base = {
    player: prop.player,
    game: prop.gameLabel || prop.game || "",
    side: prop.currentEngineSide || prop.side,
    line: prop.line,
    actualStat: prop.actualStat ?? null,
    margin: getMargin(prop),
    confidence: prop.confidence,
    risk: prop.riskLabel || "",
    tier: prop.tier || "",
  };

  if (tier === "LEAN") {
    return {
      ...base,
      category: "lean_promotion",
      label: "Lean should not have been promoted (LEAN loss)",
      explanation: "LEAN tier pick lost — LEAN should not appear as official Top Props.",
    };
  }

  if (
    (dataCoverage > 0 && dataCoverage < 50) ||
    dataMode.includes("LIMITED") ||
    dataMode.includes("WNBA_LIMITED")
  ) {
    return {
      ...base,
      category: "missing_data",
      label: "Missing / limited data problem",
      explanation: `Data coverage/mode (${dataCoverage || dataMode || "limited"}) was thin for this pick.`,
    };
  }

  if (bookCount <= 1) {
    return {
      ...base,
      category: "one_book_trap",
      label: "Weak market / 1-book trap",
      explanation: `Only ${bookCount} book(s) — thin market trap.`,
    };
  }

  if (riskBucket === "LOW" && absMargin >= 4) {
    return {
      ...base,
      category: "wrong_risk_label",
      label: "Wrong risk label",
      explanation: `Low Risk pick lost by ${absMargin} — risk label understated danger.`,
    };
  }

  if (confidence > 0 && confidence < 55) {
    return {
      ...base,
      category: "low_confidence_trap",
      label: "Low confidence trap",
      explanation: `Confidence was ${confidence}% — below playable threshold but still tracked.`,
    };
  }

  if (absMargin >= 0.5 && absMargin <= 1.5) {
    return {
      ...base,
      category: "close_miss",
      label: "Close miss",
      explanation: `Narrow miss (${getMargin(prop) > 0 ? "+" : ""}${getMargin(prop)}) — variance, not necessarily a bad read.`,
    };
  }

  if (projection !== null && line > 0 && absMargin >= 4) {
    const projEdge =
      side === "over" ? projection - line : side === "under" ? line - projection : 0;
    if (projEdge >= 2) {
      return {
        ...base,
        category: "bad_projection",
        label: "Bad projection",
        explanation: `Projection edge ${projEdge.toFixed(1)} but lost by ${absMargin} — projection read failed.`,
      };
    }
  }

  if (
    fairLine !== 0 &&
    String(prop.fairLineSide || prop.signalSnapshot?.fairLineSide || "NONE").toUpperCase() !==
      "NONE"
  ) {
    const fairAgrees = fairLineSupportsSide(prop);
    if (!fairAgrees && absMargin >= 2) {
      return {
        ...base,
        category: "bad_fair_line",
        label: "Bad fair line read",
        explanation: `Fair line side disagreed with pick and missed by ${absMargin}.`,
      };
    }
    if (fairAgrees && absMargin >= 4) {
      return {
        ...base,
        category: "bad_fair_line",
        label: "Bad fair line read",
        explanation: `Fair line agreed but pick still lost by ${absMargin}.`,
      };
    }
  }

  if (marketQuality > 0 && marketQuality < 50 && bookCount <= 2) {
    return {
      ...base,
      category: "weak_market",
      label: "Weak market / 1-book trap",
      explanation: `Weak market quality (${marketQuality}%) with ${bookCount} books.`,
    };
  }

  return {
    ...base,
    category: "unknown",
    label: "Unknown",
    explanation: "No dominant calibration category matched — review manually.",
  };
}

export function buildMistakeBreakdown(props = []) {
  const losses = props.filter((p) => String(p.status || "").toLowerCase() === "loss");
  const categorized = losses
    .map((prop) => classifyCalibrationMistake(prop))
    .filter(Boolean);

  const categoryDefs = [
    { key: "close_miss", label: "Close miss (0.5–1.5 margin)" },
    { key: "bad_projection", label: "Bad projection (edge but loss 4+)" },
    { key: "weak_market", label: "Weak market / thin books" },
    { key: "one_book_trap", label: "1-book trap" },
    { key: "wrong_risk_label", label: "Wrong risk label (Low Risk, loss 4+)" },
    { key: "low_confidence_trap", label: "Low confidence trap" },
    { key: "lean_promotion", label: "LEAN should not have been promoted" },
    { key: "missing_data", label: "Missing / limited data" },
    { key: "bad_fair_line", label: "Bad fair line read" },
    { key: "unknown", label: "Unknown" },
  ];

  const buckets = {};
  for (const def of categoryDefs) {
    buckets[def.key] = {
      key: def.key,
      label: def.label,
      count: 0,
      pct: 0,
      losses: [],
    };
  }

  for (const item of categorized) {
    const key = item.category || "unknown";
    if (!buckets[key]) {
      buckets[key] = { key, label: item.label, count: 0, pct: 0, losses: [] };
    }
    buckets[key].count += 1;
    buckets[key].losses.push(item);
  }

  const totalLosses = losses.length;
  for (const bucket of Object.values(buckets)) {
    bucket.pct =
      totalLosses > 0 ? Number(((bucket.count / totalLosses) * 100).toFixed(1)) : 0;
  }

  return {
    totalLosses,
    categories: buckets,
    losses: categorized,
    topCategory:
      categorized.length > 0
        ? Object.values(buckets).sort((a, b) => b.count - a.count)[0]
        : null,
  };
}

export function buildCalibrationRules(props = [], context = {}) {
  const rules = [];
  const graded = props.filter((p) => isResolvedStatus(p.status));
  const decided = graded.filter((p) =>
    ["win", "loss"].includes(String(p.status).toLowerCase())
  );
  const losses = props.filter((p) => String(p.status).toLowerCase() === "loss");
  const mistakeBreakdown = context.mistakeBreakdown || buildMistakeBreakdown(props);
  const engineScorecard = context.engineScorecard || buildEngineScorecard(props);

  rules.push({
    id: "no_lean_official",
    priority: "high",
    rule: "Don't show LEAN as official Top Props",
    reason: "LEAN tier is for directional signal only — not official plays.",
    triggered: props.some((p) => String(p.tier).toUpperCase() === "LEAN"),
  });

  const premiumProps = props.filter((p) => String(p.tier).toUpperCase() === "PREMIUM");
  const premiumGraded = premiumProps.filter((p) => isResolvedStatus(p.status));
  if (premiumProps.length === 0) {
    rules.push({
      id: "no_premium_found",
      priority: "medium",
      rule: 'If Premium=0, show "No Premium Plays Found" and move best LEAN to Watchlist',
      reason: "No PREMIUM tier props on this slate.",
      triggered: true,
    });
  }

  const lowRiskOneBook = props.filter(
    (p) =>
      normalizeRiskBucket(p.riskLabel) === "LOW" && num(p.bookCount) <= 1
  );
  if (lowRiskOneBook.length > 0) {
    rules.push({
      id: "no_one_book_low_risk",
      priority: "high",
      rule: "Don't allow 1-book props as Low Risk",
      reason: `${lowRiskOneBook.length} Low Risk prop(s) had ≤1 book.`,
      triggered: true,
    });
  }

  const wnbaLimited = props.filter(
    (p) =>
      String(p.dataMode || p.playerState?.dataMode || "").includes("WNBA_LIMITED") ||
      String(p.league).toUpperCase() === "WNBA"
  );
  if (wnbaLimited.length > 0) {
    rules.push({
      id: "wnba_stronger_edge",
      priority: "medium",
      rule: "Require stronger edge for WNBA_LIMITED_DATA",
      reason: `${wnbaLimited.length} WNBA/limited-data prop(s) on slate — edge bar should be higher.`,
      triggered: true,
    });
  }

  const lowConfLosses = mistakeBreakdown.categories?.low_confidence_trap?.count || 0;
  if (lowConfLosses > 0) {
    rules.push({
      id: "raise_confidence_threshold",
      priority: "high",
      rule: "Raise confidence threshold for official plays",
      reason: `${lowConfLosses} loss(es) came from sub-55% confidence picks.`,
      triggered: true,
    });
  }

  const closeMisses = mistakeBreakdown.categories?.close_miss?.count || 0;
  const badReads =
    (mistakeBreakdown.categories?.bad_projection?.count || 0) +
    (mistakeBreakdown.categories?.bad_fair_line?.count || 0);
  if (closeMisses > 0 || badReads > 0) {
    rules.push({
      id: "separate_close_misses",
      priority: "medium",
      rule: "Separate close misses from bad reads in Lab reporting",
      reason: `${closeMisses} close miss(es) vs ${badReads} bad read(s) — different calibration actions.`,
      triggered: true,
    });
  }

  const weakMarketLosses =
    (mistakeBreakdown.categories?.weak_market?.count || 0) +
    (mistakeBreakdown.categories?.one_book_trap?.count || 0);
  if (weakMarketLosses > 0) {
    rules.push({
      id: "downgrade_weak_market",
      priority: "high",
      rule: "Downgrade risk when market quality is weak",
      reason: `${weakMarketLosses} loss(es) tied to weak/thin markets.`,
      triggered: true,
    });
  }

  const overEngine = engineScorecard.engines?.find((e) => e.engine === "Side — Over");
  const underEngine = engineScorecard.engines?.find((e) => e.engine === "Side — Under");
  if (
    overEngine?.gradedCount >= MIN_SAMPLE ||
    underEngine?.gradedCount >= MIN_SAMPLE
  ) {
    rules.push({
      id: "track_side_separately",
      priority: "medium",
      rule: "Track Over/Under separately in calibration",
      reason: `Over ${overEngine?.record || "—"} vs Under ${underEngine?.record || "—"}.`,
      triggered: true,
    });
  }

  const leanLosses = mistakeBreakdown.categories?.lean_promotion?.count || 0;
  if (leanLosses > 0) {
    rules.push({
      id: "lean_promotion_loss",
      priority: "high",
      rule: "Block LEAN from auto-track pipeline",
      reason: `${leanLosses} LEAN loss(es) — LEAN should never be official.`,
      triggered: true,
    });
  }

  const failingEngines = (engineScorecard.engines || []).filter(
    (e) => e.status === "FAILING" && e.hasData
  );
  for (const eng of failingEngines.slice(0, 3)) {
    rules.push({
      id: `engine_failing_${eng.engine.replace(/\s+/g, "_").toLowerCase()}`,
      priority: "medium",
      rule: `Review ${eng.engine} — status FAILING (${eng.winRate}% on ${eng.gradedCount})`,
      reason: eng.lesson,
      triggered: true,
    });
  }

  if (decided.length < MIN_SAMPLE * 2) {
    rules.push({
      id: "sample_too_small",
      priority: "low",
      rule: "Do not adjust engine weights yet — sample too small",
      reason: `Only ${decided.length} decided prop(s) on this slate.`,
      triggered: true,
    });
  }

  return {
    rules: rules.filter((r) => r.triggered),
    totalRules: rules.filter((r) => r.triggered).length,
    doNotAdjustYet: decided.length < MIN_SAMPLE * 2,
    note: "Calibration rules are advisory — no engine weights were changed.",
  };
}

export function buildSlateLesson(props = [], context = {}) {
  const record = buildRecordFromProps(props);
  const slateDate = context.slateDate || "";
  const reportStatus = context.reportStatus || "in-progress";
  const mistakeBreakdown = context.mistakeBreakdown || buildMistakeBreakdown(props);
  const engineScorecard = context.engineScorecard || buildEngineScorecard(props);
  const calibrationRules = context.calibrationRules || buildCalibrationRules(props, context);

  if (props.length === 0) {
    return {
      headline: "No official props tracked for this slate.",
      body: "Build a report after Top Props are auto-tracked.",
      bullets: [],
    };
  }

  if (record.decided === 0) {
    return {
      headline: `${props.length} official prop(s) tracked — waiting for grades.`,
      body: "Once games finish and props grade, the Engine Report Card will show which signals helped or hurt.",
      bullets: [
        `${record.sampleSize} props pending`,
        `Leagues: ${[...new Set(props.map((p) => p.league).filter(Boolean))].join(", ") || "—"}`,
      ],
    };
  }

  const winPct = record.winRate ?? 0;
  const headline =
    winPct >= 60
      ? `Strong slate — ${record.record} (${winPct}%).`
      : winPct >= 45
        ? `Mixed slate — ${record.record} (${winPct}%).`
        : `Rough slate — ${record.record} (${winPct}%).`;

  const bullets = [];

  const working = (engineScorecard.engines || []).filter((e) => e.status === "WORKING");
  const failing = (engineScorecard.engines || []).filter((e) => e.status === "FAILING");

  if (working.length) {
    bullets.push(
      `Engines working: ${working.map((e) => e.engine).slice(0, 3).join(", ")}.`
    );
  }
  if (failing.length) {
    bullets.push(
      `Engines failing: ${failing.map((e) => e.engine).slice(0, 3).join(", ")} — review before next slate.`
    );
  }

  if (mistakeBreakdown.totalLosses > 0 && mistakeBreakdown.topCategory?.count > 0) {
    bullets.push(
      `Top loss pattern: ${mistakeBreakdown.topCategory.label} (${mistakeBreakdown.topCategory.count} of ${mistakeBreakdown.totalLosses}).`
    );
  }

  const highPriorityRules = calibrationRules.rules?.filter((r) => r.priority === "high") || [];
  if (highPriorityRules.length) {
    bullets.push(`Priority fix: ${highPriorityRules[0].rule}.`);
  }

  if (reportStatus !== "final") {
    bullets.push(`${record.sampleSize - record.graded} prop(s) still pending — lesson may shift.`);
  }

  const bodyParts = [];
  if (record.avgMargin !== null) {
    bodyParts.push(`Average margin ${record.avgMargin > 0 ? "+" : ""}${record.avgMargin}.`);
  }
  bodyParts.push(
    calibrationRules.doNotAdjustYet
      ? "Sample is still small — use this slate for direction, not permanent rule changes."
      : "Enough graded props to start comparing engine performance across slates."
  );

  return {
    slateDate,
    headline,
    body: bodyParts.join(" "),
    bullets,
    reportStatus,
  };
}

export function buildEngineReportCardBundle(props = [], context = {}) {
  const engineScorecard = buildEngineScorecard(props);
  const mistakeBreakdown = buildMistakeBreakdown(props);
  const calibrationRules = buildCalibrationRules(props, {
    ...context,
    engineScorecard,
    mistakeBreakdown,
  });
  const slateLesson = buildSlateLesson(props, {
    ...context,
    engineScorecard,
    mistakeBreakdown,
    calibrationRules,
  });

  return {
    engineScorecard,
    mistakeBreakdown,
    calibrationRules,
    slateLesson,
  };
}
