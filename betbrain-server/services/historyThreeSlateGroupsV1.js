/**
 * CourtEdge History 3-Slate Groups v1
 * Groups archived slates into blocks of 3 for signal learning cadence.
 */

import {
  aggregateSignalRows,
  buildSignalPerformanceTable,
  classifySignalImpact,
  SMALL_SAMPLE_THRESHOLD,
} from "./signalPerformanceV1.js";

export const HISTORY_THREE_SLATE_GROUPS_VERSION = "history-three-slate-groups-v1";
const GROUP_SIZE = 3;

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

function buildSlateRecord(props = []) {
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
    totalProps: props.length,
    graded: graded.length,
    pending,
    wins: wins.length,
    losses: losses.length,
    pushes: pushes.length,
    record: `${wins.length}-${losses.length}-${pushes.length}`,
    winRate,
    avgMargin: avg(margins),
    decided,
  };
}

function buildRiskBucketBreakdown(props = []) {
  const buckets = { LOW: [], MEDIUM: [], HIGH: [], UNKNOWN: [] };
  for (const prop of props) {
    const bucket = normalizeRiskBucket(prop.riskLabel || prop.trueRisk);
    buckets[bucket].push(prop);
  }

  const result = {};
  for (const [bucket, bucketProps] of Object.entries(buckets)) {
    if (!bucketProps.length) continue;
    result[bucket] = buildSlateRecord(bucketProps);
  }
  return result;
}

function buildSideBreakdown(props = []) {
  const buckets = { Over: [], Under: [], UNKNOWN: [] };
  for (const prop of props) {
    const side = String(prop.currentEngineSide || "UNKNOWN");
    const key = side === "Over" || side === "Under" ? side : "UNKNOWN";
    buckets[key].push(prop);
  }

  const result = {};
  for (const [side, sideProps] of Object.entries(buckets)) {
    if (!sideProps.length) continue;
    result[side] = buildSlateRecord(sideProps);
  }
  return result;
}

function rankSignals(rows = [], status) {
  return rows
    .filter((row) => row.impactStatus === status && row.decided > 0)
    .sort((a, b) => {
      if (status === "hurt") {
        const wrDiff = num(a.winRate) - num(b.winRate);
        if (wrDiff !== 0) return wrDiff;
        return num(a.avgMargin) - num(b.avgMargin);
      }
      const wrDiff = num(b.winRate) - num(a.winRate);
      if (wrDiff !== 0) return wrDiff;
      return num(b.avgMargin) - num(a.avgMargin);
    })
    .slice(0, 6)
    .map((row) => ({
      signal: `${row.signalCategory} → ${row.value}`,
      record: row.record,
      winRate: row.winRate,
      avgMargin: row.avgMargin,
      n: row.n,
      smallSample: row.smallSample,
    }));
}

function compareToPreviousBlock(current, previous) {
  if (!previous) {
    return {
      hasPrevious: false,
      notes: ["First 3-slate block — no prior block to compare."],
    };
  }

  const notes = [];
  const wrDelta =
    current.winRate !== null && previous.winRate !== null
      ? Number((current.winRate - previous.winRate).toFixed(1))
      : null;
  const marginDelta =
    current.avgMargin !== null && previous.avgMargin !== null
      ? Number((current.avgMargin - previous.avgMargin).toFixed(2))
      : null;

  if (wrDelta !== null) {
    if (wrDelta > 3) notes.push(`Win rate improved +${wrDelta}% vs prior block (${previous.winRate}% → ${current.winRate}%).`);
    else if (wrDelta < -3) notes.push(`Win rate declined ${wrDelta}% vs prior block (${previous.winRate}% → ${current.winRate}%).`);
    else notes.push(`Win rate stable (${wrDelta >= 0 ? "+" : ""}${wrDelta}% vs prior block).`);
  }

  if (marginDelta !== null) {
    if (marginDelta > 0.5) notes.push(`Avg margin improved +${marginDelta} vs prior block.`);
    else if (marginDelta < -0.5) notes.push(`Avg margin declined ${marginDelta} vs prior block.`);
  }

  const currentHurt = new Set(
    (current.topSignalHurters || []).map((s) => s.signal)
  );
  const prevHurt = new Set(
    (previous.topSignalHurters || []).map((s) => s.signal)
  );
  const recurringHurt = [...currentHurt].filter((s) => prevHurt.has(s));
  if (recurringHurt.length > 0) {
    notes.push(`Recurring hurters: ${recurringHurt.slice(0, 3).join("; ")}.`);
  }

  const newHelpers = (current.topSignalHelpers || [])
    .filter((s) => !(previous.topSignalHelpers || []).some((p) => p.signal === s.signal))
    .slice(0, 3);
  if (newHelpers.length > 0) {
    notes.push(`New helpers this block: ${newHelpers.map((s) => s.signal).join("; ")}.`);
  }

  if (notes.length === 0) {
    notes.push("Performance similar to prior 3-slate block.");
  }

  return {
    hasPrevious: true,
    winRateDelta: wrDelta,
    avgMarginDelta: marginDelta,
    notes,
  };
}

function buildLearningBlockComparison(archives = [], previousArchives = []) {
  const summaries = archives
    .map((a) => a.report?.officialLabDailySummary || a.officialLabDailySummary)
    .filter(Boolean);
  if (!summaries.length) return null;

  const notes = [];
  const avg = (vals) => {
    const nums = vals.filter((v) => v != null && Number.isFinite(Number(v))).map(Number);
    if (!nums.length) return null;
    return Number((nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(2));
  };

  const winRates = summaries.map((s) => s.overallRecord?.winRate);
  const margins = summaries.map((s) => s.overallRecord?.avgMargin).filter(Boolean);
  const topWinRates = summaries.map((s) => s.topPicks?.winRate);
  const missTypes = {};
  for (const s of summaries) {
    for (const [k, v] of Object.entries(s.missTypeCounts || {})) {
      missTypes[k] = (missTypes[k] || 0) + Number(v);
    }
  }

  const prevSummaries = previousArchives
    .map((a) => a.report?.officialLabDailySummary || a.officialLabDailySummary)
    .filter(Boolean);
  const prevWinRate = avg(prevSummaries.map((s) => s.overallRecord?.winRate));
  const curWinRate = avg(winRates);
  const prevTopWr = avg(prevSummaries.map((s) => s.topPicks?.winRate));
  const curTopWr = avg(topWinRates);

  if (curWinRate != null && prevWinRate != null) {
    const d = Number((curWinRate - prevWinRate).toFixed(1));
    if (d > 2) notes.push(`Win rate improved +${d}% vs prior 3-slate block.`);
    else if (d < -2) notes.push(`Win rate declined ${d}% vs prior 3-slate block.`);
  }
  if (curTopWr != null && prevTopWr != null) {
    const d = Number((curTopWr - prevTopWr).toFixed(1));
    if (d > 2) notes.push(`Top 2 outperformed prior block (+${d}% WR).`);
    else if (d < -2) notes.push(`Top 2 underperformed prior block (${d}% WR).`);
  }
  const topMiss = Object.entries(missTypes).sort((a, b) => b[1] - a[1])[0];
  if (topMiss) notes.push(`Dominant miss type in block: ${topMiss[0]} (${topMiss[1]}).`);

  const poorProfiles = [];
  for (const s of summaries) {
    const rows = s.aggregateBreakdown?.dimensionIndex?.player_profile || [];
    for (const row of rows) {
      if (row.n >= 2 && row.winRate != null && row.winRate < 45) {
        poorProfiles.push(`${row.value} (${row.winRate}%)`);
      }
    }
  }
  if (poorProfiles.length) {
    notes.push(`Profiles projected poorly: ${[...new Set(poorProfiles)].slice(0, 3).join("; ")}.`);
  }

  if (!notes.length) {
    notes.push("Learning block stable vs prior — review per-prop packets for calibration tweaks.");
  }

  return {
    winRate: curWinRate,
    topPickWinRate: curTopWr,
    missTypeCounts: missTypes,
    notes,
    recommendation:
      "Evidence for human review only — Lab does not auto-modify engine weights.",
  };
}

function buildGroupFromArchives(archives, groupIndex, groupId, previousArchives = []) {
  const slateDates = archives.map((a) => a.slateDate).sort();
  const allProps = archives.flatMap((a) => a.props || []);
  const record = buildSlateRecord(allProps);

  const signalTables = archives.map((archive) => {
    const table = archive.report?.signalPerformance;
    if (table?.rows?.length) return table;
    return buildSignalPerformanceTable(archive.props || [], {
      slateDate: archive.slateDate,
    });
  });

  const aggregatedRows = aggregateSignalRows(
    signalTables.flatMap((table) => table.rows || [])
  );

  const topSignalHelpers = rankSignals(aggregatedRows, "helped");
  const topSignalHurters = rankSignals(aggregatedRows, "hurt");
  const neutralSignals = rankSignals(aggregatedRows, "neutral");

  return {
    groupId,
    groupIndex,
    slateDates,
    slateCount: archives.length,
    incomplete: archives.length < GROUP_SIZE,
    ...record,
    riskBucketBreakdown: buildRiskBucketBreakdown(allProps),
    sideBreakdown: buildSideBreakdown(allProps),
    topSignalHelpers,
    topSignalHurters,
    neutralSignals,
    signalRowCount: aggregatedRows.length,
    smallSampleSignals: aggregatedRows.filter((row) => row.smallSample).length,
    learningBlock: buildLearningBlockComparison(archives, previousArchives),
    comparison: null,
  };
}

/**
 * Build 3-slate groups from archived slate entries (ARCHIVED phase).
 * Archives should be sorted newest-first; groups are built chronologically.
 */
export function buildHistoryThreeSlateGroups(archives = [], options = {}) {
  const groupSize = options.groupSize || GROUP_SIZE;

  const archived = archives
    .filter((archive) => {
      const phase = String(archive.phase || "").toUpperCase();
      return phase === "ARCHIVED" || options.includeLab === true;
    })
    .filter((archive) => (archive.props || []).length > 0)
    .sort((a, b) => String(a.slateDate).localeCompare(String(b.slateDate)));

  const groups = [];
  for (let i = 0; i < archived.length; i += groupSize) {
    const chunk = archived.slice(i, i + groupSize);
    const prevChunk = i >= groupSize ? archived.slice(i - groupSize, i) : [];
    const groupIndex = Math.floor(i / groupSize);
    const groupId = `block-${groupIndex + 1}`;
    groups.push(buildGroupFromArchives(chunk, groupIndex, groupId, prevChunk));
  }

  for (let i = 0; i < groups.length; i++) {
    const previous = i > 0 ? groups[i - 1] : null;
    groups[i].comparison = compareToPreviousBlock(groups[i], previous);
  }

  return {
    version: HISTORY_THREE_SLATE_GROUPS_VERSION,
    generatedAt: new Date().toISOString(),
    groupSize,
    smallSampleThreshold: SMALL_SAMPLE_THRESHOLD,
    archivedSlateCount: archived.length,
    groupCount: groups.length,
    completeGroupCount: groups.filter((g) => !g.incomplete).length,
    groups: groups.reverse(),
  };
}

export function getLatestCompleteThreeSlateGroup(groupsPayload) {
  const groups = groupsPayload?.groups || [];
  return groups.find((group) => !group.incomplete && group.decided >= SMALL_SAMPLE_THRESHOLD) || null;
}
