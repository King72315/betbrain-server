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
} from "./courtEdgeLabV2Helpers.js";

export { V1_VERSION, HISTORY_THREE_SLATE_GROUPS_V2 };
export const HISTORY_THREE_SLATE_GROUPS_VERSION = HISTORY_THREE_SLATE_GROUPS_V2_VERSION;
export const GROUP_SIZE = 3;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, "..", "three-slate-blocks-v2.json");

function emptyStore() {
  return {
    version: HISTORY_THREE_SLATE_GROUPS_V2_VERSION,
    frozenBlocks: [],
    activeBlock: null,
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
  if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  return emptyStore();
}

export function clearFrozenThreeSlateMembershipCache() {
  return resetThreeSlateBlocksStoreForTests();
}

/**
 * Sync membership from an ordered list of completed official slate dates.
 * Non-overlapping chunks of 3. Frozen membership never regrouped.
 *
 * activeBlock is always the latest block (may be incomplete 1/3–2/3 OR
 * complete 3/3 when no newer slate has started yet).
 */
export function syncThreeSlateBlocksV2(completedDates = []) {
  const dates = [...new Set((completedDates || []).map(String).filter(Boolean))].sort();
  const store = readStore();

  // Preserve already-frozen membership dates
  const priorFrozen = (store.frozenBlocks || []).map((b) => ({
    ...b,
    frozen: true,
    incomplete: false,
    progress: "3/3",
    progressLabel: "Slate 3 of 3 — Block Complete",
  }));
  const frozenDateSet = new Set(priorFrozen.flatMap((b) => b.slateDates || []));

  // New dates only (never reassign frozen membership)
  const newDates = dates.filter((d) => !frozenDateSet.has(d));

  // If there was an incomplete active, continue it with new dates
  let working = [];
  if (store.activeBlock?.incomplete && Array.isArray(store.activeBlock.slateDates)) {
    working = store.activeBlock.slateDates.filter((d) => !frozenDateSet.has(d));
  }
  for (const d of newDates) {
    if (!working.includes(d)) working.push(d);
  }
  working = [...new Set(working)].sort();

  const frozenBlocks = [...priorFrozen];

  // Peel complete chunks into frozen (except leave a trailing complete as active)
  while (working.length > GROUP_SIZE) {
    const chunk = working.slice(0, GROUP_SIZE);
    working = working.slice(GROUP_SIZE);
    frozenBlocks.push(makeCompleteBlock(frozenBlocks.length, chunk));
  }

  let activeBlock = null;
  if (working.length === GROUP_SIZE) {
    // Exactly 3 — block is complete and remains active until next slate
    const block = makeCompleteBlock(frozenBlocks.length, working);
    // Also record in frozenBlocks for archive/history
    if (!frozenBlocks.some((b) => sameDates(b.slateDates, working))) {
      frozenBlocks.push(block);
    }
    activeBlock = { ...block };
  } else if (working.length > 0) {
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
    };
  } else if (frozenBlocks.length > 0) {
    // No working dates — latest frozen is still the active completed block
    activeBlock = { ...frozenBlocks[frozenBlocks.length - 1] };
  }

  return writeStore({
    frozenBlocks,
    activeBlock,
  });
}

function sameDates(a = [], b = []) {
  if (a.length !== b.length) return false;
  const as = [...a].map(String).sort().join(",");
  const bs = [...b].map(String).sort().join(",");
  return as === bs;
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
  const record = buildRecordStats(records);
  const engineScorecards = buildAllEngineScorecards(records);
  const perSlate = (block.slateDates || []).map((d) => ({
    slateDate: d,
    ...buildRecordStats((propsByDate[d] || []).map(buildLabPropRecord)),
  }));

  return {
    ...block,
    perSlate,
    record,
    ...record,
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

function buildRichComparison(current, previous) {
  if (!previous) {
    return {
      hasPrevious: false,
      previousBlockDates: [],
      currentBlockDates: current?.slateDates || [],
      notes: ["First three-slate block — no prior block to compare."],
    };
  }
  const base = compareRecords(current.record, previous.record);
  return {
    hasPrevious: true,
    previousBlockDates: previous.slateDates || [],
    currentBlockDates: current.slateDates || [],
    metrics: base.metrics,
    over: compareRecords(current.overRecord, previous.overRecord),
    under: compareRecords(current.underRecord, previous.underRecord),
    nba: compareRecords(current.nbaRecord, previous.nbaRecord),
    wnba: compareRecords(current.wnbaRecord, previous.wnbaRecord),
    risk: {
      LOW: compareRecords(current.riskRecords?.LOW, previous.riskRecords?.LOW),
      MEDIUM: compareRecords(current.riskRecords?.MEDIUM, previous.riskRecords?.MEDIUM),
      HIGH: compareRecords(current.riskRecords?.HIGH, previous.riskRecords?.HIGH),
    },
    top: compareRecords(current.topPickRecord, previous.topPickRecord),
    nonTop: compareRecords(current.nonTopRecord, previous.nonTopRecord),
    organic: compareRecords(current.organicSideRecord, previous.organicSideRecord),
    sameTeamForced: compareRecords(
      current.sameTeamForcedRecord,
      previous.sameTeamForcedRecord
    ),
    engineChanges: Object.fromEntries(
      LAB_V2_ENGINE_KEYS.map((key) => [
        key,
        {
          directionalAccuracy: deltaMetric(
            previous.engineScorecards?.[key]?.directionalAccuracy,
            current.engineScorecards?.[key]?.directionalAccuracy
          ),
          coveragePct: deltaMetric(
            previous.engineScorecards?.[key]?.coveragePct,
            current.engineScorecards?.[key]?.coveragePct
          ),
        },
      ])
    ),
  };
}

function propsByDateFromSources({ archives, reports, trackedProps }) {
  const map = {};
  const add = (props) => {
    for (const prop of (props || []).filter(isOfficialBestSixProp)) {
      const d = String(prop.slateDate || "");
      if (!d) continue;
      if (!map[d]) map[d] = [];
      if (!map[d].some((p) => p.officialPropId === prop.officialPropId)) {
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

  let frozenBlocks;
  let activeBlock;
  let store = emptyStore();

  if (persist) {
    store = syncThreeSlateBlocksV2(dates);
    frozenBlocks = store.frozenBlocks || [];
    activeBlock = store.activeBlock;
  } else {
    // Ephemeral chunking — do not touch the on-disk store
    frozenBlocks = [];
    const remaining = [...dates];
    while (remaining.length > GROUP_SIZE) {
      const chunk = remaining.splice(0, GROUP_SIZE);
      frozenBlocks.push(makeCompleteBlock(frozenBlocks.length, chunk));
    }
    if (remaining.length === GROUP_SIZE) {
      const block = makeCompleteBlock(frozenBlocks.length, remaining);
      if (!frozenBlocks.some((b) => sameDates(b.slateDates, remaining))) {
        frozenBlocks.push(block);
      }
      activeBlock = { ...block };
    } else if (remaining.length > 0) {
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
      };
    } else {
      activeBlock = null;
    }
  }

  const byDate = propsByDateFromSources({ archives, reports, trackedProps });
  const enrichedFrozen = frozenBlocks.map((b) => enrichBlock(b, byDate));
  const enrichedActive = enrichBlock(activeBlock, byDate);

  // Attach comparisons
  for (let i = 0; i < enrichedFrozen.length; i++) {
    const prev = i > 0 ? enrichedFrozen[i - 1] : null;
    enrichedFrozen[i].comparison = buildRichComparison(enrichedFrozen[i], prev);
  }
  if (enrichedActive) {
    const prev =
      enrichedFrozen.length > 0 ? enrichedFrozen[enrichedFrozen.length - 1] : null;
    enrichedActive.comparison = buildRichComparison(enrichedActive, prev);
  }

  // Active is latest block. Previous is the frozen block before it.
  const resolvedActive = enrichedActive || null;
  let resolvedPrevious = null;
  if (resolvedActive) {
    const priorFrozen = enrichedFrozen.filter(
      (b) => !sameDates(b.slateDates, resolvedActive.slateDates)
    );
    resolvedPrevious =
      priorFrozen.length > 0 ? priorFrozen[priorFrozen.length - 1] : null;
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
    store: {
      updatedAt: persist ? store.updatedAt : null,
      frozenGroupIds: enrichedFrozen.map((b) => b.groupId),
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
