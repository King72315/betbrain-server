import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { CONFIG } from "../config.js";
import { TOP_PROP_SELECTOR_VERSION } from "../engines/topProps/topPropSelectionAudit.js";
import { getStableTrackedPropKey } from "./trackedPropService.js";
import { getTodayLocalDate } from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNAPSHOT_FILE = path.join(__dirname, "..", "top-picks-snapshots.json");

function readJSON(file, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensureStore() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    writeJSON(SNAPSHOT_FILE, { active: null, bySlate: {} });
  }
}

ensureStore();

function readStore() {
  ensureStore();
  return readJSON(SNAPSHOT_FILE, { active: null, bySlate: {} });
}

function writeStore(store) {
  writeJSON(SNAPSHOT_FILE, store);
}

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
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
  const decided = wins.length + losses.length;
  const winRate =
    decided > 0 ? Number(((wins.length / decided) * 100).toFixed(1)) : null;

  return {
    total: props.length,
    graded: graded.length,
    pending: props.length - graded.length,
    wins: wins.length,
    losses: losses.length,
    pushes: pushes.length,
    winRate,
    netUnits: wins.length - losses.length,
  };
}

function buildSnapshotEntry(pick = {}, rank = 1, options = {}) {
  const trackedKey = getStableTrackedPropKey(pick);
  const stablePropKey = [
    pick.player,
    pick.team,
    pick.line,
    pick.side || pick.pick,
    pick.league,
  ]
    .filter(Boolean)
    .join("|");

  return {
    slateDate: pick.slateDate || options.slateDate || "",
    topPickRank: rank,
    trackedId: trackedKey,
    trackedKey,
    stablePropKey,
    selectedAt: options.selectedAt || new Date().toISOString(),
    selectorVersion: options.selectorVersion || TOP_PROP_SELECTOR_VERSION,
    bestPropScore: pick.bestPropScore ?? pick.pickScore ?? null,
    reasonCodes: pick.reasonCodes || pick.wnbaReader?.supports || [],
    scoreBreakdown: pick.scoreBreakdown || {
      bestPropScore: pick.bestPropScore ?? null,
      confidence: pick.confidence ?? null,
      netEdge: pick.netEdge ?? null,
      readerConfidence: pick.readerConfidence ?? pick.wnbaReader?.readerConfidence ?? null,
    },
    player: pick.player,
    team: pick.team,
    opponent: pick.opponent,
    line: pick.line,
    side: pick.side || pick.pick,
    league: pick.league,
    tier: pick.tier,
    officialEligible: pick.officialEligible,
    readerDecision: pick.readerDecision || pick.wnbaReader?.decision,
    engineHandled: pick.engineHandled,
    isTopPickReference: true,
  };
}

export function saveTopPicksSnapshot(topProps = [], options = {}) {
  const limit = Number(options.limit ?? CONFIG.TOP_PROP_LIMIT ?? 2);
  const ranked = (Array.isArray(topProps) ? topProps : []).slice(0, limit);
  const slateDate =
    options.slateDate ||
    ranked[0]?.slateDate ||
    getTodayLocalDate();
  const selectedAt = options.selectedAt || new Date().toISOString();
  const selectorVersion = options.selectorVersion || TOP_PROP_SELECTOR_VERSION;
  const audit = options.topSelectionAudit || null;

  const picks = ranked.map((pick, index) =>
    buildSnapshotEntry(
      { ...pick, slateDate: pick.slateDate || slateDate },
      index + 1,
      { selectedAt, selectorVersion, slateDate }
    )
  );

  const snapshot = {
    slateDate,
    selectedAt,
    selectorVersion,
    topPropLimit: limit,
    pickCount: picks.length,
    picks,
    candidateCount: audit?.candidateCount ?? null,
    hiddenDueToLimit: audit?.hiddenDueToLimit ?? null,
    engineHandled: audit?.engineHandled || {},
    hiddenCandidateAudit: (audit?.hidden || []).slice(0, 50),
    referenceOnly: true,
  };

  const store = readStore();
  store.active = snapshot;
  store.bySlate = store.bySlate || {};
  store.bySlate[slateDate] = snapshot;
  writeStore(store);

  return { ok: true, snapshot };
}

export function getTopPicksSnapshot(slateDate) {
  const store = readStore();
  const date = String(slateDate || "");
  if (date && store.bySlate?.[date]) {
    return store.bySlate[date];
  }
  if (!date && store.active) {
    return store.active;
  }
  return null;
}

export function getActiveTopPicksSnapshot() {
  const store = readStore();
  return store.active || null;
}

export function getTopPickRankMap(slateDate = null) {
  const snapshot = slateDate
    ? getTopPicksSnapshot(slateDate)
    : getActiveTopPicksSnapshot();
  const map = new Map();
  for (const pick of snapshot?.picks || []) {
    if (pick.trackedKey) {
      map.set(pick.trackedKey, pick.topPickRank);
    }
  }
  return map;
}

export function attachGradedResultsToSnapshot(slateDate, trackedProps = []) {
  const snapshot = getTopPicksSnapshot(slateDate);
  if (!snapshot?.picks?.length) {
    return { ok: false, message: "No top picks snapshot for slate", snapshot: null };
  }

  const byKey = new Map();
  for (const prop of trackedProps) {
    const key = prop.trackedKey || prop.trackedId;
    if (key) byKey.set(key, prop);
  }

  const picks = snapshot.picks.map((entry) => {
    const tracked = byKey.get(entry.trackedKey);
    if (!tracked) return { ...entry };

    return {
      ...entry,
      status: tracked.status,
      actualStat: tracked.actualStat,
      result: tracked.result,
      resultMargin: tracked.resultMargin,
      gradedAt: tracked.gradedAt,
      resolvedAt: tracked.resolvedAt,
      currentEngineResult: tracked.currentEngineResult,
      currentEngineWon: tracked.currentEngineWon,
      currentEngineMargin: tracked.currentEngineMargin,
    };
  });

  const gradedSnapshot = {
    ...snapshot,
    picks,
    record: buildRecord(picks),
    gradedAt: new Date().toISOString(),
  };

  const store = readStore();
  store.bySlate = store.bySlate || {};
  store.bySlate[slateDate] = gradedSnapshot;
  if (store.active?.slateDate === slateDate) {
    store.active = gradedSnapshot;
  }
  writeStore(store);

  return { ok: true, snapshot: gradedSnapshot };
}

export function buildTopPicksReview(slateDate, trackedProps = [], options = {}) {
  const date = String(slateDate || "");
  const snapshot =
    getTopPicksSnapshot(date) ||
    (options.snapshot ? options.snapshot : null);

  if (!snapshot?.picks?.length) {
    return null;
  }

  const topPickKeys = new Set(
    snapshot.picks.map((pick) => pick.trackedKey).filter(Boolean)
  );

  const slateProps = trackedProps.filter(
    (prop) => String(prop.slateDate || "") === date
  );

  const byKey = new Map();
  for (const prop of slateProps) {
    const key = prop.trackedKey || prop.trackedId;
    if (key) byKey.set(key, prop);
  }

  const enrichedPicks = snapshot.picks.map((entry) => {
    const tracked = byKey.get(entry.trackedKey);
    return tracked ? { ...entry, ...tracked, topPickRank: entry.topPickRank } : entry;
  });

  const topPickRecord = buildRecord(enrichedPicks);
  const restOfSlate = slateProps.filter((prop) => {
    const key = prop.trackedKey || prop.trackedId;
    return key && !topPickKeys.has(key);
  });
  const restRecord = buildRecord(restOfSlate);

  const pickOne = enrichedPicks.find((p) => p.topPickRank === 1) || null;
  const pickTwo = enrichedPicks.find((p) => p.topPickRank === 2) || null;

  return {
    title: "Top Picks Selection Review",
    slateDate: date,
    selectorVersion: snapshot.selectorVersion,
    topPropLimit: snapshot.topPropLimit ?? CONFIG.TOP_PROP_LIMIT,
    referenceOnly: true,
    subsetAnalysisOnly: true,
    record: topPickRecord,
    pickOne,
    pickTwo,
    picks: enrichedPicks,
    vsRestOfSlate: {
      restPropCount: restOfSlate.length,
      restRecord,
      topPickWinRate: topPickRecord.winRate,
      restWinRate: restRecord.winRate,
      winRateDelta:
        topPickRecord.winRate !== null && restRecord.winRate !== null
          ? Number((topPickRecord.winRate - restRecord.winRate).toFixed(1))
          : null,
    },
    hiddenCandidateAudit: snapshot.hiddenCandidateAudit || [],
    candidateCount: snapshot.candidateCount,
    hiddenDueToLimit: snapshot.hiddenDueToLimit,
    engineHandled: snapshot.engineHandled || {},
    selectedAt: snapshot.selectedAt,
  };
}

export function clearActiveTopPicksSnapshot(slateDate = null) {
  const store = readStore();
  const date = slateDate ? String(slateDate) : store.active?.slateDate;

  if (store.active && (!date || store.active.slateDate === date)) {
    store.active = null;
  }

  writeStore(store);
  return { ok: true, clearedSlateDate: date || null };
}

export function archiveTopPicksSnapshotToReportMetadata(slateDate) {
  const snapshot = getTopPicksSnapshot(slateDate);
  if (!snapshot) return null;

  return {
    slateDate,
    selectorVersion: snapshot.selectorVersion,
    topPropLimit: snapshot.topPropLimit,
    pickCount: snapshot.pickCount,
    picks: snapshot.picks,
    record: snapshot.record || buildRecord(snapshot.picks || []),
    hiddenCandidateAudit: snapshot.hiddenCandidateAudit || [],
    referenceOnly: true,
    archivedAt: new Date().toISOString(),
  };
}
