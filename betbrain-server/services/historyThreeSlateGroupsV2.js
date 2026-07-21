/**
 * CourtEdge History 3-Slate Groups V2
 *
 * Persistent non-overlapping blocks (A-B-C then D-E-F).
 * Frozen membership never regrouped. Lab and History share this builder.
 *
 * Primary APIs:
 *   syncThreeSlateBlocksV2(sortedDates)
 *   buildHistoryThreeSlateGroupsV2({ archives, reports, trackedProps, persist })
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  buildHistoryThreeSlateGroups as buildHistoryThreeSlateGroupsV1,
  HISTORY_THREE_SLATE_GROUPS_VERSION as V1_VERSION,
  getLatestCompleteThreeSlateGroup as getLatestCompleteThreeSlateGroupV1,
} from "./historyThreeSlateGroupsV1.js";
import {
  HISTORY_THREE_SLATE_GROUPS_V2_VERSION,
  HISTORY_THREE_SLATE_GROUPS_V2,
  LAB_V2_BUILD,
  LAB_V2_ENGINE_KEYS,
  isLabSixPropLearningTrackDate,
} from "./courtEdgeLabV2Constants.js";
import {
  buildRecordStats,
  buildLabPropRecord,
  buildAllEngineScorecards,
  isOfficialBestSixProp,
  compareRecords,
  deltaMetric,
  isResolvedStatus,
  statusOf,
  classifySlateInstrumentation,
  filterInstrumentedRecords,
} from "./courtEdgeLabV2Helpers.js";
import { buildCompatibleDeltaMetric } from "./labMetricAvailability.js";

export { V1_VERSION, HISTORY_THREE_SLATE_GROUPS_V2 };
export const HISTORY_THREE_SLATE_GROUPS_VERSION = HISTORY_THREE_SLATE_GROUPS_V2_VERSION;
export const GROUP_SIZE = 3;

/**
 * Known historical frozen membership that must survive Render wipes / partial
 * completed-date sets. Never regroup these once the three dates are present.
 */
export const HISTORICAL_THREE_SLATE_ANCHORS = Object.freeze([
  ["2026-06-21", "2026-06-22", "2026-07-08"],
  ["2026-07-14", "2026-07-15", "2026-07-16"],
]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, "..", "three-slate-blocks-v2.json");

function emptyStore() {
  return {
    version: HISTORY_THREE_SLATE_GROUPS_V2_VERSION,
    frozenBlocks: [],
    activeBlock: null,
    legacySlateDates: [],
    demotedFromActive: [],
    learningTrack: "instrumented-six-prop-v1",
    updatedAt: null,
  };
}

function readStore() {
  try {
    if (!fs.existsSync(STORE_FILE)) return emptyStore();
    const raw = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      version: HISTORY_THREE_SLATE_GROUPS_V2_VERSION,
      frozenBlocks: Array.isArray(raw.frozenBlocks) ? raw.frozenBlocks : [],
      activeBlock: raw.activeBlock || null,
      legacySlateDates: Array.isArray(raw.legacySlateDates) ? raw.legacySlateDates : [],
      demotedFromActive: Array.isArray(raw.demotedFromActive) ? raw.demotedFromActive : [],
      learningTrack: raw.learningTrack || "instrumented-six-prop-v1",
      updatedAt: raw.updatedAt || null,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  const next = {
    ...store,
    version: HISTORY_THREE_SLATE_GROUPS_V2_VERSION,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(STORE_FILE, JSON.stringify(next, null, 2));
  return next;
}

export function resetThreeSlateBlocksStoreForTests() {
  try {
    if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  } catch (err) {
    // Windows can briefly EPERM/ENOENT during parallel test resets — overwrite instead.
    try {
      fs.writeFileSync(STORE_FILE, JSON.stringify(emptyStore(), null, 2));
    } catch {
      // ignore
    }
  }
  return emptyStore();
}

export function clearFrozenThreeSlateMembershipCache() {
  return resetThreeSlateBlocksStoreForTests();
}

/**
 * Sync membership from an ordered list of completed official slate dates.
 * Non-overlapping chunks of 3. Frozen membership never regrouped.
 *
 * When options.learningDates is provided, only those dates enter/continue the
 * active instrumented learning track. Ineligible dates already sitting in an
 * incomplete active block are demoted to legacy (not frozen as a fake block).
 *
 * activeBlock holds the in-progress learning block (1/3–2/3). When a block
 * reaches 3/3 it freezes immutable membership and active becomes a new empty
 * 0/3 block until the next eligible completed slate arrives.
 */
export function syncThreeSlateBlocksV2(completedDates = [], options = {}) {
  const dates = [...new Set((completedDates || []).map(String).filter(Boolean))].sort();
  const learningDates = Array.isArray(options.learningDates)
    ? [...new Set(options.learningDates.map(String).filter(Boolean))].sort()
    : dates;
  const learningSet = new Set(learningDates);
  const restrictToLearning = Array.isArray(options.learningDates);
  const legacyExtra = Array.isArray(options.legacyDates)
    ? options.legacyDates.map(String)
    : [];

  const store = readStore();

  // Preserve already-frozen membership dates
  let priorFrozen = (store.frozenBlocks || []).map((b) => ({
    ...b,
    frozen: true,
    incomplete: false,
    progress: "3/3",
    progressLabel: "Slate 3 of 3 — Block Complete",
  }));

  // Apply known historical anchors when all three dates are completed
  // (keeps Jul 16 with Jul 14–15 even if earlier dates are missing on disk).
  const dateSet = new Set(dates);
  for (const anchor of HISTORICAL_THREE_SLATE_ANCHORS) {
    if (!anchor.every((d) => dateSet.has(d))) continue;
    if (priorFrozen.some((b) => sameDates(b.slateDates, anchor))) continue;
    priorFrozen = priorFrozen.filter(
      (b) => !(b.slateDates || []).some((d) => anchor.includes(String(d)))
    );
    priorFrozen.push(makeCompleteBlock(priorFrozen.length, anchor));
  }
  priorFrozen = priorFrozen
    .sort((a, b) =>
      String(a.slateDates?.[0] || "").localeCompare(String(b.slateDates?.[0] || ""))
    )
    .map((b, index) => ({
      ...b,
      groupId: `block-${index + 1}`,
      groupIndex: index,
      sequenceNumber: index + 1,
    }));

  // Empty-store bootstrap OR wipe-corruption self-heal for non-anchor dates:
  // freeze remaining completed dates in chronological chunks of 3.
  // When a learning track is active, NEVER bootstrap-freeze learning dates —
  // otherwise a missing early anchor date (e.g. 06-21) can steal Jul 17 into a
  // fake frozen block with legacy 06-22/07-08 and leave Jul 20 alone as 1/3.
  const anchoredDates = new Set(priorFrozen.flatMap((b) => b.slateDates || []));
  const expectedBlocks = [];
  let histWorking = dates.filter((d) => !anchoredDates.has(d)).sort();
  if (restrictToLearning) {
    histWorking = histWorking.filter((d) => !learningSet.has(d));
  }
  while (histWorking.length >= GROUP_SIZE) {
    expectedBlocks.push(histWorking.slice(0, GROUP_SIZE));
    histWorking = histWorking.slice(GROUP_SIZE);
  }
  const expectedFrozenDates = new Set(expectedBlocks.flat());
  const priorFrozenDates = new Set(priorFrozen.flatMap((b) => b.slateDates || []));
  const missingHistorical = [...expectedFrozenDates].filter(
    (d) => !priorFrozenDates.has(d)
  );
  const shouldBootstrap =
    (priorFrozen.length === 0 && dates.length > 0) ||
    (expectedBlocks.length > 0 && missingHistorical.length > 0);

  if (shouldBootstrap) {
    for (const chunk of expectedBlocks) {
      priorFrozen.push(makeCompleteBlock(priorFrozen.length, chunk));
    }
    for (const d of histWorking) {
      if (restrictToLearning && !learningSet.has(d)) {
        if (!legacyExtra.includes(d)) legacyExtra.push(d);
      }
    }
    priorFrozen = priorFrozen
      .sort((a, b) =>
        String(a.slateDates?.[0] || "").localeCompare(String(b.slateDates?.[0] || ""))
      )
      .map((b, index) => ({
        ...b,
        groupId: `block-${index + 1}`,
        groupIndex: index,
        sequenceNumber: index + 1,
      }));
  } else {
    for (const d of histWorking) {
      if (restrictToLearning && !learningSet.has(d)) {
        if (!legacyExtra.includes(d)) legacyExtra.push(d);
      }
    }
  }

  // Heal corrupt non-anchor frozen blocks that mixed learning-track dates with
  // legacy dates (immutable anchors and pure completed learning 3/3 stay).
  if (restrictToLearning) {
    const historicalAnchorDateSet = new Set(
      HISTORICAL_THREE_SLATE_ANCHORS.flat().map(String)
    );
    const healed = [];
    for (const block of priorFrozen) {
      const blockDates = (block.slateDates || []).map(String);
      if (HISTORICAL_THREE_SLATE_ANCHORS.some((a) => sameDates(a, blockDates))) {
        healed.push(block);
        continue;
      }
      const learningInBlock = blockDates.filter((d) => learningSet.has(d));
      const nonLearningInBlock = blockDates.filter((d) => !learningSet.has(d));
      const hasHistoricalMember = blockDates.some((d) =>
        historicalAnchorDateSet.has(d)
      );
      // Non-anchor block that dragged a historical-anchor member (e.g. 06-22)
      // into a fake learning 3/3 with Jul 17/20 — dissolve.
      if (hasHistoricalMember) {
        for (const d of blockDates) {
          if (!learningSet.has(d) && !legacyExtra.includes(d)) {
            legacyExtra.push(d);
          }
        }
        continue;
      }
      if (
        learningInBlock.length === blockDates.length &&
        blockDates.length === GROUP_SIZE
      ) {
        // Valid peeled learning block (A-B-C of six-prop track).
        healed.push(block);
        continue;
      }
      if (learningInBlock.length > 0 && nonLearningInBlock.length > 0) {
        // Corrupt bootstrap mix — release learning dates back to active track.
        for (const d of nonLearningInBlock) {
          if (!legacyExtra.includes(d)) legacyExtra.push(d);
        }
        continue;
      }
      if (learningInBlock.length === 0 && blockDates.length === GROUP_SIZE) {
        healed.push(block);
        continue;
      }
      for (const d of blockDates) {
        if (!legacyExtra.includes(d)) legacyExtra.push(d);
      }
    }
    priorFrozen = healed
      .sort((a, b) =>
        String(a.slateDates?.[0] || "").localeCompare(String(b.slateDates?.[0] || ""))
      )
      .map((b, index) => ({
        ...b,
        groupId: `block-${index + 1}`,
        groupIndex: index,
        sequenceNumber: index + 1,
      }));
  }

  const frozenDateSet = new Set(priorFrozen.flatMap((b) => b.slateDates || []));

  // New learning dates only (never reassign frozen membership)
  const newDates = learningDates.filter((d) => !frozenDateSet.has(d));

  // If there was an incomplete active, continue it with eligible learning dates
  let working = [];
  const demoted = [...(store.demotedFromActive || [])];
  if (store.activeBlock?.incomplete && Array.isArray(store.activeBlock.slateDates)) {
    for (const d of store.activeBlock.slateDates) {
      if (frozenDateSet.has(d)) continue;
      if (restrictToLearning && !learningSet.has(d)) {
        if (!demoted.includes(d)) demoted.push(d);
        continue;
      }
      working.push(d);
    }
  }
  for (const d of newDates) {
    if (!working.includes(d)) working.push(d);
  }
  working = [...new Set(working)].sort();

  const frozenBlocks = [...priorFrozen];

  // Peel complete chunks into frozen; a trailing exact-3 also freezes and
  // yields a fresh empty active block (never leave 3/3 pinned as active).
  while (working.length >= GROUP_SIZE) {
    const chunk = working.slice(0, GROUP_SIZE);
    working = working.slice(GROUP_SIZE);
    if (!frozenBlocks.some((b) => sameDates(b.slateDates, chunk))) {
      frozenBlocks.push(makeCompleteBlock(frozenBlocks.length, chunk));
    }
  }

  let activeBlock = null;
  if (working.length > 0) {
    activeBlock = {
      groupId: `block-${frozenBlocks.length + 1}`,
      groupIndex: frozenBlocks.length,
      sequenceNumber: frozenBlocks.length + 1,
      slateDates: working,
      slateCount: working.length,
      incomplete: true,
      frozen: false,
      progress: `${working.length}/${GROUP_SIZE}`,
      progressLabel: `Slate ${working.length} of ${GROUP_SIZE}`,
      buildVersion: LAB_V2_BUILD,
      instrumentedLearning: true,
    };
  } else if (frozenBlocks.length > 0 && learningDates.length === 0 && restrictToLearning) {
    // Instrumented track idle — do not keep a legacy incomplete date as active
    activeBlock = null;
  } else if (frozenBlocks.length > 0) {
    // 3/3 just froze (or all learning dates already frozen) — start empty next
    activeBlock = makeEmptyActiveBlock(frozenBlocks.length);
  }

  const legacySlateDates = [
    ...new Set([
      ...(store.legacySlateDates || []),
      ...legacyExtra,
      ...demoted,
      ...dates.filter((d) => restrictToLearning && !learningSet.has(d)),
    ]),
  ].sort();

  return writeStore({
    frozenBlocks,
    activeBlock,
    legacySlateDates,
    demotedFromActive: [...new Set(demoted)].sort(),
    learningTrack: "instrumented-six-prop-v1",
  });
}

function sameDates(a = [], b = []) {
  if (a.length !== b.length) return false;
  const as = [...a].map(String).sort().join(",");
  const bs = [...b].map(String).sort().join(",");
  return as === bs;
}

function makeEmptyActiveBlock(frozenCount) {
  return {
    groupId: `block-${frozenCount + 1}`,
    groupIndex: frozenCount,
    sequenceNumber: frozenCount + 1,
    slateDates: [],
    slateCount: 0,
    incomplete: true,
    frozen: false,
    empty: true,
    progress: `0/${GROUP_SIZE}`,
    progressLabel: `Slate 0 of ${GROUP_SIZE}`,
    buildVersion: LAB_V2_BUILD,
    instrumentedLearning: true,
  };
}

function makeCompleteBlock(index, slateDates) {
  return {
    groupId: `block-${index + 1}`,
    groupIndex: index,
    sequenceNumber: index + 1,
    slateDates: slateDates.slice(),
    slateCount: GROUP_SIZE,
    incomplete: false,
    frozen: true,
    progress: "3/3",
    progressLabel: "Slate 3 of 3 — Block Complete",
    frozenAt: new Date().toISOString(),
    completionTimestamp: new Date().toISOString(),
    buildVersion: LAB_V2_BUILD,
  };
}

export function collectCompletedOfficialSlateDates(input = {}) {
  const dates = new Set();

  const archives = input.archives || [];
  const reports = input.reports || [];
  const trackedProps = input.trackedProps || [];

  for (const archive of archives) {
    const props = (archive.props || []).filter(isOfficialBestSixProp);
    if (!props.length) continue;
    if (props.every((p) => isResolvedStatus(statusOf(p)))) {
      dates.add(String(archive.slateDate));
    }
  }

  for (const report of reports) {
    const fromTracked = trackedProps.filter(
      (p) => String(p.slateDate) === String(report.slateDate) && isOfficialBestSixProp(p)
    );
    const props =
      fromTracked.length > 0
        ? fromTracked
        : (report.props || report.trackedProps || []).filter(isOfficialBestSixProp);
    if (!props.length) continue;
    if (props.every((p) => isResolvedStatus(statusOf(p)))) {
      dates.add(String(report.slateDate));
    }
  }

  const byDate = new Map();
  for (const prop of trackedProps) {
    if (!isOfficialBestSixProp(prop)) continue;
    const d = String(prop.slateDate || "");
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(prop);
  }
  for (const [d, props] of byDate.entries()) {
    if (props.every((p) => isResolvedStatus(statusOf(p)))) {
      dates.add(d);
    }
  }

  return [...dates].sort();
}

/** Alias expected by tests — returns date strings or { slateDate } objects */
export function collectCompletedSlates(input = {}) {
  return collectCompletedOfficialSlateDates(input).map((slateDate) => ({ slateDate }));
}

function enrichBlock(block, propsByDate = {}) {
  if (!block) return null;
  const props = (block.slateDates || []).flatMap((d) => propsByDate[d] || []);
  const records = props.map(buildLabPropRecord);
  const instrumentedRecords = filterInstrumentedRecords(records);
  const record = buildRecordStats(records);
  // Engine scoreboards: instrumented sealed signals only — never poison with legacy.
  const engineScorecards = buildAllEngineScorecards(instrumentedRecords, {
    instrumentedOnly: true,
  });
  const perSlate = (block.slateDates || []).map((d) => {
    const slateProps = propsByDate[d] || [];
    const slateRecords = slateProps.map(buildLabPropRecord);
    const instrumentation = classifySlateInstrumentation(slateProps);
    return {
      slateDate: d,
      ...buildRecordStats(slateRecords),
      ...instrumentation.flags,
      evidenceCoverage: instrumentation.evidenceCoverage,
      instrumentation,
    };
  });

  const slateFlags = (block.slateDates || []).map((d) =>
    classifySlateInstrumentation(propsByDate[d] || [])
  );
  const anyLegacy = slateFlags.some((f) => f.legacy || f.uninstrumented);
  const allInstrumented = slateFlags.length > 0 && slateFlags.every((f) => f.instrumented);

  return {
    ...block,
    perSlate,
    recordStats: record,
    // Spread numeric stats onto the block for convenience. Note: buildRecordStats
    // also exposes `record` as the W-L-P string — keep object stats on recordStats.
    ...record,
    record: record.record,
    legacy: anyLegacy,
    uninstrumented: slateFlags.some((f) => f.uninstrumented),
    instrumented: allInstrumented,
    instrumentedPropCount: instrumentedRecords.length,
    excludedUninstrumentedPropCount: Math.max(0, records.length - instrumentedRecords.length),
    overRecord: buildRecordStats(records.filter((r) => r.finalSide === "OVER")),
    underRecord: buildRecordStats(records.filter((r) => r.finalSide === "UNDER")),
    nbaRecord: buildRecordStats(records.filter((r) => r.league === "NBA")),
    wnbaRecord: buildRecordStats(records.filter((r) => r.league === "WNBA")),
    riskRecords: {
      LOW: buildRecordStats(records.filter((r) => r.risk === "LOW")),
      MEDIUM: buildRecordStats(records.filter((r) => r.risk === "MEDIUM")),
      HIGH: buildRecordStats(records.filter((r) => r.risk === "HIGH")),
    },
    topPickRecord: buildRecordStats(records.filter((r) => r.isTopPick)),
    nonTopRecord: buildRecordStats(records.filter((r) => !r.isTopPick)),
    organicSideRecord: buildRecordStats(records.filter((r) => !r.forcedSameTeam)),
    sameTeamForcedRecord: buildRecordStats(records.filter((r) => r.forcedSameTeam)),
    flipFirstRecord: buildRecordStats(
      records.filter((r) =>
        String(r.flipFirst?.action || r.flipFirst?.decision || "")
          .toUpperCase()
          .includes("FLIP")
      )
    ),
    sideRescueRecord: buildRecordStats(
      records.filter((r) =>
        String(r.sideRescue?.action || r.sideRescue?.terminalAction || "")
          .toUpperCase()
          .includes("FLIP")
      )
    ),
    engineScorecards,
    propCount: props.length,
  };
}

function isCompleteThreeSlateBlock(block) {
  if (!block) return false;
  if (block.incomplete === true) return false;
  const count = Array.isArray(block.slateDates)
    ? block.slateDates.length
    : Number(block.slateCount || 0);
  return count === GROUP_SIZE;
}

function erasCompatibleForComparison(current, previous) {
  // Result W-L deltas are era-agnostic. Engine scoreboard deltas apply a
  // stricter instrumentedEligible gate inside engineChanges.
  return Boolean(current && previous);
}

function buildRichComparison(current, previous) {
  if (!previous) {
    return {
      hasPrevious: false,
      available: false,
      reason: "NOT_APPLICABLE",
      previousBlockDates: [],
      currentBlockDates: current?.slateDates || [],
      notes: ["First three-slate block — no prior block to compare."],
      metrics: {
        winRate: {
          available: false,
          value: null,
          reason: "NOT_APPLICABLE",
          previous: null,
          current: null,
          difference: null,
          direction: "unavailable",
          display: "N/A",
          label: "N/A",
          note: "Comparison available after 3 compatible completed slates.",
        },
      },
    };
  }

  const previousComplete = isCompleteThreeSlateBlock(previous);
  const currentComplete = isCompleteThreeSlateBlock(current);
  const erasCompatible = erasCompatibleForComparison(current, previous);
  const gate = {
    gateOfficialDeltas: true,
    previousComplete,
    currentComplete,
    erasCompatible,
  };

  const currentStats =
    current?.recordStats && typeof current.recordStats === "object"
      ? current.recordStats
      : current;
  const previousStats =
    previous?.recordStats && typeof previous.recordStats === "object"
      ? previous.recordStats
      : previous;
  const base = compareRecords(currentStats, previousStats, gate);
  return {
    hasPrevious: true,
    available: base.available === true,
    reason: base.reason || null,
    note: base.note ||
      (base.available
        ? null
        : "Comparison available after 3 compatible completed slates."),
    previousBlockDates: previous.slateDates || [],
    currentBlockDates: current.slateDates || [],
    previousComplete,
    currentComplete,
    erasCompatible,
    metrics: base.metrics,
    over: compareRecords(
      current.overRecord || currentStats,
      previous.overRecord || previousStats,
      gate
    ),
    under: compareRecords(
      current.underRecord || currentStats,
      previous.underRecord || previousStats,
      gate
    ),
    nba: compareRecords(
      current.nbaRecord || currentStats,
      previous.nbaRecord || previousStats,
      gate
    ),
    wnba: compareRecords(
      current.wnbaRecord || currentStats,
      previous.wnbaRecord || previousStats,
      gate
    ),
    risk: {
      LOW: compareRecords(current.riskRecords?.LOW, previous.riskRecords?.LOW, gate),
      MEDIUM: compareRecords(
        current.riskRecords?.MEDIUM,
        previous.riskRecords?.MEDIUM,
        gate
      ),
      HIGH: compareRecords(current.riskRecords?.HIGH, previous.riskRecords?.HIGH, gate),
    },
    top: compareRecords(current.topPickRecord, previous.topPickRecord, gate),
    nonTop: compareRecords(current.nonTopRecord, previous.nonTopRecord, gate),
    organic: compareRecords(current.organicSideRecord, previous.organicSideRecord, gate),
    sameTeamForced: compareRecords(
      current.sameTeamForcedRecord,
      previous.sameTeamForcedRecord,
      gate
    ),
    engineChanges: Object.fromEntries(
      LAB_V2_ENGINE_KEYS.map((key) => {
        const prevCov = previous.engineScorecards?.[key]?.coverage;
        const curCov = current.engineScorecards?.[key]?.coverage;
        const prevDir = previous.engineScorecards?.[key]?.directionalAccuracyMetric;
        const curDir = current.engineScorecards?.[key]?.directionalAccuracyMetric;
        return [
          key,
          {
            directionalAccuracy: buildCompatibleDeltaMetric(
              prevDir ?? previous.engineScorecards?.[key]?.directionalAccuracy,
              curDir ?? current.engineScorecards?.[key]?.directionalAccuracy,
              {
                previousComplete,
                currentComplete,
                erasCompatible:
                  erasCompatible &&
                  previous.engineScorecards?.[key]?.instrumentedEligibleCount > 0 &&
                  current.engineScorecards?.[key]?.instrumentedEligibleCount > 0,
              }
            ),
            coveragePct: buildCompatibleDeltaMetric(
              prevCov ?? previous.engineScorecards?.[key]?.coveragePct,
              curCov ?? current.engineScorecards?.[key]?.coveragePct,
              {
                previousComplete,
                currentComplete,
                erasCompatible:
                  erasCompatible &&
                  previous.engineScorecards?.[key]?.instrumentedEligibleCount > 0 &&
                  current.engineScorecards?.[key]?.instrumentedEligibleCount > 0,
              }
            ),
          },
        ];
      })
    ),
  };
}

function propsByDateFromSources({ archives, reports, trackedProps }) {
  const map = {};
  const propKey = (prop) => {
    if (prop.officialPropId) return `id:${prop.officialPropId}`;
    return [
      "fallback",
      prop.player || prop.playerName || "",
      prop.team || "",
      prop.opponent || "",
      prop.bestSixRank ?? prop.controlledBestSixRank ?? "",
      prop.side || prop.pick || "",
      prop.line ?? prop.sealedLine ?? "",
    ].join("|");
  };
  const add = (props) => {
    for (const prop of (props || []).filter(isOfficialBestSixProp)) {
      const d = String(prop.slateDate || "");
      if (!d) continue;
      if (!map[d]) map[d] = [];
      const key = propKey(prop);
      if (!map[d].some((p) => propKey(p) === key)) {
        map[d].push(prop);
      }
    }
  };
  for (const a of archives || []) add(a.props);
  for (const r of reports || []) add(r.props || r.trackedProps);
  add(trackedProps);
  return map;
}

/**
 * Build V2 three-slate groups with shared Lab/History membership.
 */
export function buildHistoryThreeSlateGroupsV2(input = {}, maybeOptions = {}) {
  let archives;
  let reports;
  let trackedProps;
  let persist;

  if (Array.isArray(input)) {
    archives = input;
    const options = maybeOptions || {};
    reports = options.reports || [];
    trackedProps = options.trackedProps || [];
    persist = options.persist !== false;
  } else {
    archives = input.archives || [];
    reports = input.reports || [];
    trackedProps = input.trackedProps || [];
    persist = input.persist !== false;
  }

  const dates = collectCompletedOfficialSlateDates({ archives, reports, trackedProps });
  const byDate = propsByDateFromSources({ archives, reports, trackedProps });

  const slateInstrumentation = {};
  const learningDates = [];
  const legacyDates = [];
  // Dates that belong to known historical three-slate anchors never re-enter the
  // post-anchor six-prop learning track — even if propCount >= 6 (e.g. 06-22 had 13).
  const historicalAnchorDateSet = new Set(
    HISTORICAL_THREE_SLATE_ANCHORS.flat().map(String)
  );
  for (const d of dates) {
    const info = classifySlateInstrumentation(byDate[d] || []);
    slateInstrumentation[d] = info;
    // Six-prop official slates enter the new active learning track.
    // Thin/uninstrumented eras (e.g. Jul 16 three-prop) stay historical/legacy.
    // Historical-anchor member dates stay historical even when sixProp-sized.
    // Pre-track dates (e.g. 2026-07-17) stay History-only — never Lab learning UI.
    if (
      info.eligibleForSixPropLearningBlock &&
      !historicalAnchorDateSet.has(d) &&
      isLabSixPropLearningTrackDate(d)
    ) {
      learningDates.push(d);
    } else {
      legacyDates.push(d);
    }
  }

  let frozenBlocks;
  let activeBlock;
  let store = emptyStore();

  if (persist) {
    store = syncThreeSlateBlocksV2(dates, {
      learningDates,
      legacyDates,
    });
    frozenBlocks = store.frozenBlocks || [];
    activeBlock = store.activeBlock;
  } else {
    // Ephemeral chunking — instrumented learning dates only for active track
    frozenBlocks = [];
    const remaining = [...learningDates];
    while (remaining.length >= GROUP_SIZE) {
      const chunk = remaining.splice(0, GROUP_SIZE);
      frozenBlocks.push(makeCompleteBlock(frozenBlocks.length, chunk));
    }
    if (remaining.length > 0) {
      activeBlock = {
        groupId: `block-${frozenBlocks.length + 1}`,
        groupIndex: frozenBlocks.length,
        sequenceNumber: frozenBlocks.length + 1,
        slateDates: remaining,
        slateCount: remaining.length,
        incomplete: true,
        frozen: false,
        progress: `${remaining.length}/${GROUP_SIZE}`,
        progressLabel: `Slate ${remaining.length} of ${GROUP_SIZE}`,
        buildVersion: LAB_V2_BUILD,
        instrumentedLearning: true,
      };
    } else if (frozenBlocks.length > 0) {
      activeBlock = makeEmptyActiveBlock(frozenBlocks.length);
    } else {
      activeBlock = null;
    }
  }

  const enrichedFrozen = frozenBlocks.map((b) => enrichBlock(b, byDate));
  const enrichedActive = enrichBlock(activeBlock, byDate);

  // Attach comparisons — never compare a completed active block to itself when
  // it is also present in frozenBlocks (trailing complete active pattern).
  for (let i = 0; i < enrichedFrozen.length; i++) {
    const prev = i > 0 ? enrichedFrozen[i - 1] : null;
    enrichedFrozen[i].comparison = buildRichComparison(enrichedFrozen[i], prev);
  }
  if (enrichedActive) {
    const prevDistinct =
      enrichedFrozen
        .filter((b) => !sameDates(b.slateDates, enrichedActive.slateDates))
        .slice(-1)[0] || null;
    enrichedActive.comparison = buildRichComparison(enrichedActive, prevDistinct);
  }

  // Active is the in-progress learning block (may be empty 0/3 after a 3/3 freeze).
  // Previous is the latest distinct frozen block.
  const resolvedActive = enrichedActive || null;
  let resolvedPrevious = null;
  if (resolvedActive) {
    const priorFrozen = enrichedFrozen.filter(
      (b) => !sameDates(b.slateDates, resolvedActive.slateDates)
    );
    resolvedPrevious =
      priorFrozen.length > 0 ? priorFrozen[priorFrozen.length - 1] : null;
  } else if (enrichedFrozen.length > 0) {
    // Instrumented track idle (e.g. waiting for first sealed six-prop) — still expose last frozen.
    resolvedPrevious = enrichedFrozen[enrichedFrozen.length - 1];
  }

  const v1Archives = dates.map((d) => ({
    slateDate: d,
    phase: "ARCHIVED",
    props: byDate[d] || [],
  }));
  const v1 = buildHistoryThreeSlateGroupsV1(v1Archives, { includeLab: true });

  const allGroups = [
    ...enrichedFrozen.filter(
      (b) =>
        !resolvedActive ||
        resolvedActive.incomplete ||
        !sameDates(b.slateDates, resolvedActive.slateDates)
    ),
    ...(resolvedActive ? [resolvedActive] : []),
  ];

  return {
    version: HISTORY_THREE_SLATE_GROUPS_V2,
    v1Version: V1_VERSION,
    generatedAt: new Date().toISOString(),
    buildVersion: LAB_V2_BUILD,
    groupSize: GROUP_SIZE,
    archivedSlateCount: dates.length,
    groupCount: allGroups.length,
    completeGroupCount: enrichedFrozen.length,
    frozenBlocks: enrichedFrozen,
    activeBlock: resolvedActive,
    previousBlock: resolvedPrevious,
    groups: allGroups.slice().reverse(),
    v1Groups: v1.groups || [],
    learningTrack: "instrumented-six-prop-v1",
    instrumentedLearningDates: learningDates,
    legacySlateDates: [
      ...new Set([...(store.legacySlateDates || []), ...legacyDates]),
    ].sort(),
    demotedFromActive: store.demotedFromActive || [],
    slateInstrumentation,
    store: {
      updatedAt: persist ? store.updatedAt : null,
      frozenGroupIds: enrichedFrozen.map((b) => b.groupId),
      learningTrack: store.learningTrack || "instrumented-six-prop-v1",
    },
    v1Compatible: {
      version: v1.version,
      groupCount: v1.groupCount,
      membership: (v1.groups || []).map((g) => ({
        groupId: g.groupId,
        slateDates: g.slateDates,
        incomplete: g.incomplete,
      })),
    },
  };
}

export function buildHistoryThreeSlateGroups(archives = [], options = {}) {
  if (archives && !Array.isArray(archives) && typeof archives === "object") {
    return buildHistoryThreeSlateGroupsV2(archives);
  }
  return buildHistoryThreeSlateGroupsV2({
    archives,
    reports: options.reports || [],
    trackedProps: options.trackedProps || [],
    persist: options.persist !== false,
    ...options,
  });
}

export function getLatestCompleteThreeSlateGroup(groupsPayload) {
  const frozen = groupsPayload?.frozenBlocks || [];
  if (frozen.length) return frozen[frozen.length - 1];
  const groups = groupsPayload?.groups || [];
  return (
    groups.find((group) => !group.incomplete) ||
    getLatestCompleteThreeSlateGroupV1(groupsPayload) ||
    null
  );
}

export function getActiveAndPreviousBlocks(groupsPayload) {
  return {
    activeBlock: groupsPayload?.activeBlock || null,
    previousBlock: groupsPayload?.previousBlock || null,
  };
}

export {
  buildHistoryThreeSlateGroupsV1,
  getLatestCompleteThreeSlateGroupV1,
};
