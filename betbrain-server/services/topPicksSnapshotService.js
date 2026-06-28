import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { CONFIG } from "../config.js";
import { buildTopPickLabel } from "../engines/topProps/topPropSelector.js";
import { TOP_PROP_SELECTOR_VERSION } from "../engines/topProps/topPropSelectionAudit.js";
import { CONTROLLED_BEST_SIX_VERSION } from "../engines/topProps/controlledBestSixSelector.js";
import { getStableTrackedPropKey } from "./trackedPropService.js";
import { buildSlateResultsSnapshot } from "./slateResultsSnapshot.js";
import { getTodayLocalDate } from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SNAPSHOT_FILE = path.join(__dirname, "..", "top-picks-snapshots.json");
const BEST_SIX_SNAPSHOT_FILE = path.join(__dirname, "..", "best-six-snapshots.json");
export const TOP_PICKS_SOURCE_POOL = "CONTROLLED_BEST_SIX_DISPLAY";

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
  const league = String(pick.league || options.league || "").toUpperCase();
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
    league,
    sourcePool: options.sourcePool || TOP_PICKS_SOURCE_POOL,
    topPickRank: rank,
    topPickLabel: pick.topPickLabel || buildTopPickLabel(league, rank),
    trackedId: trackedKey,
    trackedKey,
    stablePropKey,
    selectedTeamKey: pick.selectedTeamKey || pick.teamKey || pick.team || "",
    selectedAt: options.selectedAt || new Date().toISOString(),
    selectorVersion:
      options.selectorVersion || CONTROLLED_BEST_SIX_VERSION || TOP_PROP_SELECTOR_VERSION,
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
    tier: pick.tier,
    officialEligible: pick.officialEligible,
    readerDecision: pick.readerDecision || pick.wnbaReader?.decision,
    engineHandled: pick.engineHandled,
    sideRescueAction: pick.sideRescueAction ?? pick.sideRescue?.action ?? null,
    sideRescueExplanation:
      pick.sideRescueExplanation ?? pick.sideRescue?.simpleExplanation ?? null,
    initialSide: pick.initialSide ?? pick.sideRescue?.originalSide ?? null,
    flippedFromSide: pick.flippedFromSide ?? null,
    isTopPickReference: true,
    referenceOnly: true,
  };
}

function ensureBestSixStore() {
  if (!fs.existsSync(BEST_SIX_SNAPSHOT_FILE)) {
    writeJSON(BEST_SIX_SNAPSHOT_FILE, { active: null, bySlate: {} });
  }
}

function readBestSixStore() {
  ensureBestSixStore();
  return readJSON(BEST_SIX_SNAPSHOT_FILE, { active: null, bySlate: {} });
}

function writeBestSixStore(store) {
  writeJSON(BEST_SIX_SNAPSHOT_FILE, store);
}

function buildBestSixSnapshotEntry(pick = {}, rank = 1, options = {}) {
  const trackedKey = getStableTrackedPropKey(pick);
  const league = String(pick.league || options.league || "").toUpperCase();
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
    league,
    sourcePool: TOP_PICKS_SOURCE_POOL,
    bestSixRank: pick.bestSixRank || pick.controlledBestSixRank || rank,
    controlledBestSixRank: pick.controlledBestSixRank ?? pick.bestSixRank ?? rank,
    controlledBestSixVersion: pick.controlledBestSixVersion || CONTROLLED_BEST_SIX_VERSION,
    bestSixLabel: pick.bestSixLabel || `Best ${league} #${rank}`,
    trackedId: trackedKey,
    trackedKey,
    stablePropKey,
    selectedTeamKey: pick.selectedTeamKey || pick.teamKey || pick.team || "",
    selectedAt: options.selectedAt || new Date().toISOString(),
    selectorVersion: options.selectorVersion || CONTROLLED_BEST_SIX_VERSION,
    bestPropScore: pick.bestPropScore ?? pick.pickScore ?? null,
    qualityGateScore: pick.qualityGateScore ?? null,
    sideRescueAction: pick.sideRescueAction ?? pick.sideRescue?.action ?? null,
    sideRescueExplanation:
      pick.sideRescueExplanation ?? pick.sideRescue?.simpleExplanation ?? null,
    initialSide: pick.initialSide ?? pick.sideRescue?.originalSide ?? null,
    flippedFromSide: pick.flippedFromSide ?? null,
    referenceOnly: true,
    isTopPickReference: false,
  };
}

export function saveBestSixSnapshot(bestSix = [], options = {}) {
  const ranked = Array.isArray(bestSix) ? bestSix : [];
  const slateDate =
    options.slateDate || ranked[0]?.slateDate || getTodayLocalDate();
  const selectedAt = options.selectedAt || new Date().toISOString();
  const selectorVersion = options.selectorVersion || CONTROLLED_BEST_SIX_VERSION;
  const audit = options.controlledBestSixAudit || null;

  const picks = ranked.map((pick, index) =>
    buildBestSixSnapshotEntry(
      { ...pick, slateDate: pick.slateDate || slateDate },
      pick.bestSixRank || index + 1,
      { selectedAt, selectorVersion, slateDate, league: pick.league }
    )
  );

  const snapshot = {
    slateDate,
    selectedAt,
    selectorVersion,
    sourcePool: TOP_PICKS_SOURCE_POOL,
    pickCount: picks.length,
    picks,
    bestSixCountByLeague: audit?.bestSixCountByLeague || {},
    hiddenDueToBestSixCap: audit?.hiddenDueToBestSixCap ?? null,
    hiddenDueToTeamCap: audit?.hiddenDueToTeamCap ?? null,
    hiddenDueToGameCap: audit?.hiddenDueToGameCap ?? null,
    hiddenDueToQualityGate: audit?.hiddenDueToQualityGate ?? null,
    referenceOnly: true,
  };

  const store = readBestSixStore();
  store.active = snapshot;
  store.bySlate = store.bySlate || {};
  store.bySlate[slateDate] = snapshot;
  writeBestSixStore(store);

  return { ok: true, snapshot };
}

export function getBestSixSnapshot(slateDate) {
  const store = readBestSixStore();
  const date = String(slateDate || "");
  if (date && store.bySlate?.[date]) {
    return store.bySlate[date];
  }
  if (!date && store.active) {
    return store.active;
  }
  return null;
}

export function getActiveBestSixSnapshot() {
  const store = readBestSixStore();
  return store.active || null;
}

export function saveTopPicksSnapshot(topProps = [], options = {}) {
  const limit = Number(
    options.limit ?? CONFIG.TOP_PROP_COMBINED_LIMIT ?? CONFIG.TOP_PROP_LIMIT ?? 4
  );
  const ranked = (Array.isArray(topProps) ? topProps : []).slice(0, limit);
  const slateDate =
    options.slateDate ||
    ranked[0]?.slateDate ||
    getTodayLocalDate();
  const selectedAt = options.selectedAt || new Date().toISOString();
  const selectorVersion =
    options.selectorVersion || CONTROLLED_BEST_SIX_VERSION || TOP_PROP_SELECTOR_VERSION;
  const sourcePool = options.sourcePool || TOP_PICKS_SOURCE_POOL;
  const audit = options.topSelectionAudit || null;

  const picks = ranked.map((pick, index) =>
    buildSnapshotEntry(
      { ...pick, slateDate: pick.slateDate || slateDate },
      pick.leagueRank || pick.topPropRank || index + 1,
      { selectedAt, selectorVersion, slateDate, league: pick.league, sourcePool }
    )
  );

  const snapshot = {
    slateDate,
    selectedAt,
    selectorVersion,
    sourcePool,
    topPropLimit: limit,
    pickCount: picks.length,
    picks,
    candidateCount: audit?.candidateCount ?? null,
    hiddenDueToLimit: audit?.hiddenDueToLeagueLimit ?? audit?.hiddenDueToLimit ?? null,
    hiddenDueToSameTeam: audit?.hiddenDueToSameTeam ?? null,
    selectedTeamsByLeague: audit?.selectedTeamsByLeague || {},
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
  const meta = getTopPickMetaMap(slateDate);
  const map = new Map();
  for (const [key, value] of meta.entries()) {
    map.set(key, value.topPickRank);
  }
  return map;
}

export function getTopPickMetaMap(slateDate = null) {
  const snapshot = slateDate
    ? getTopPicksSnapshot(slateDate)
    : getActiveTopPicksSnapshot();
  const map = new Map();
  for (const pick of snapshot?.picks || []) {
    if (pick.trackedKey) {
      map.set(pick.trackedKey, {
        topPickRank: pick.topPickRank,
        topPickLabel: pick.topPickLabel,
        league: pick.league,
        selectedTeamKey: pick.selectedTeamKey,
      });
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

function buildLeagueTopPicksReview(enrichedPicks = [], league = "") {
  const leagueCode = String(league || "").toUpperCase();
  const picks = enrichedPicks.filter(
    (pick) => String(pick.league || "").toUpperCase() === leagueCode
  );
  const record = buildRecord(picks);
  const pickOne = picks.find((p) => p.topPickRank === 1) || null;
  const pickTwo = picks.find((p) => p.topPickRank === 2) || null;

  return {
    league: leagueCode,
    title: `${leagueCode} Top Picks Record`,
    record,
    pickOne,
    pickTwo,
    picks,
    referenceOnly: true,
    subsetAnalysisOnly: true,
  };
}

function buildLeagueBestSixReview(enrichedPicks = [], league = "") {
  const leagueCode = String(league || "").toUpperCase();
  const picks = enrichedPicks.filter(
    (pick) => String(pick.league || "").toUpperCase() === leagueCode
  );
  const record = buildRecord(picks);
  const official = picks.filter((p) => p.officialEligible === true || p.trackingType === "OFFICIAL");
  const test = picks.filter((p) => p.trackingType === "TEST" || p.excludedFromOfficialRecord);
  const readerOfficialDemoted = picks.filter(
    (p) => p.readerOfficialDemoted === true
  );
  const readerUncertainTest = picks.filter(
    (p) =>
      (p.trackingType === "TEST" || p.excludedFromOfficialRecord) &&
      p.readerOfficialDemoted !== true
  );

  return {
    league: leagueCode,
    title: `${leagueCode} Best 6 Record`,
    record,
    officialRecord: buildRecord(official),
    testRecord: buildRecord(test),
    readerOfficialDemotedRecord: buildRecord(readerOfficialDemoted),
    readerUncertainTestRecord: buildRecord(readerUncertainTest),
    picks,
    referenceOnly: false,
    subsetAnalysisOnly: false,
  };
}

export function buildBestSixReview(slateDate, trackedProps = [], options = {}) {
  const date = String(slateDate || "");
  const snapshot =
    getBestSixSnapshot(date) || (options.snapshot ? options.snapshot : null);

  if (!snapshot?.picks?.length) {
    return {
      title: "Controlled Best 6 Performance",
      slateDate: date,
      snapshotMissing: true,
      message: "No Best 6 snapshot found for this slate.",
      referenceOnly: true,
    };
  }

  const bestSixKeys = new Set(
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
    return tracked
      ? {
          ...entry,
          ...tracked,
          bestSixRank: entry.bestSixRank,
          bestSixLabel: entry.bestSixLabel,
          league: entry.league,
        }
      : entry;
  });

  const bestSixRecord = buildRecord(enrichedPicks);
  const gradedSnapshot = buildSlateResultsSnapshot(enrichedPicks, { slateDate: date });
  const nbaReview = buildLeagueBestSixReview(enrichedPicks, "NBA");
  const wnbaReview = buildLeagueBestSixReview(enrichedPicks, "WNBA");
  const official = enrichedPicks.filter(
    (p) => p.officialEligible === true || p.trackingType === "OFFICIAL"
  );
  const test = enrichedPicks.filter(
    (p) => p.trackingType === "TEST" || p.excludedFromOfficialRecord
  );

  return {
    title: "Controlled Best 6 Performance",
    slateDate: date,
    selectorVersion: snapshot.selectorVersion,
    sourcePool: snapshot.sourcePool || TOP_PICKS_SOURCE_POOL,
    referenceOnly: false,
    subsetAnalysisOnly: false,
    record: bestSixRecord,
    winningProps: gradedSnapshot.winningProps,
    losingProps: gradedSnapshot.losingProps,
    biggestWins: gradedSnapshot.biggestWins,
    biggestMisses: gradedSnapshot.biggestMisses,
    nbaBestSixReview: nbaReview,
    wnbaBestSixReview: wnbaReview,
    officialVsTest: {
      officialRecord: buildRecord(official),
      testRecord: buildRecord(test),
    },
    picks: enrichedPicks,
    bestSixKeys: [...bestSixKeys],
    pickCount: enrichedPicks.length,
    selectedAt: snapshot.selectedAt,
  };
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
  const bestSixSnapshot = getBestSixSnapshot(date);
  const bestSixKeys = new Set(
    bestSixSnapshot?.picks?.map((pick) => pick.trackedKey).filter(Boolean) || []
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
    return tracked
      ? {
          ...entry,
          ...tracked,
          topPickRank: entry.topPickRank,
          topPickLabel: entry.topPickLabel,
          league: entry.league,
        }
      : entry;
  });

  const topPickRecord = buildRecord(enrichedPicks);
  const bestSixProps = slateProps.filter((prop) => {
    const key = prop.trackedKey || prop.trackedId;
    return key && bestSixKeys.has(key);
  });
  const bestSixRecord = buildRecord(bestSixProps);
  const nonTopBestSix = bestSixProps.filter((prop) => {
    const key = prop.trackedKey || prop.trackedId;
    return key && !topPickKeys.has(key);
  });
  const nonTopBestSixRecord = buildRecord(nonTopBestSix);
  const restOfSlate = slateProps.filter((prop) => {
    const key = prop.trackedKey || prop.trackedId;
    return key && !topPickKeys.has(key);
  });
  const restRecord = buildRecord(restOfSlate);

  const nbaReview = buildLeagueTopPicksReview(enrichedPicks, "NBA");
  const wnbaReview = buildLeagueTopPicksReview(enrichedPicks, "WNBA");

  return {
    title: "Top Picks Selection Review",
    slateDate: date,
    selectorVersion: snapshot.selectorVersion,
    sourcePool: snapshot.sourcePool || TOP_PICKS_SOURCE_POOL,
    topPropLimit: snapshot.topPropLimit ?? CONFIG.TOP_PROP_COMBINED_LIMIT,
    referenceOnly: true,
    subsetAnalysisOnly: true,
    record: topPickRecord,
    nbaTopPicksReview: nbaReview,
    wnbaTopPicksReview: wnbaReview,
    pickOne: enrichedPicks.find((p) => p.topPickRank === 1) || null,
    pickTwo: enrichedPicks.find((p) => p.topPickRank === 2) || null,
    picks: enrichedPicks,
    vsBestSix: {
      bestSixPropCount: bestSixProps.length,
      bestSixRecord,
      topPickWinRate: topPickRecord.winRate,
      bestSixWinRate: bestSixRecord.winRate,
      winRateDelta:
        topPickRecord.winRate !== null && bestSixRecord.winRate !== null
          ? Number((topPickRecord.winRate - bestSixRecord.winRate).toFixed(1))
          : null,
    },
    vsNonTopBestSix: {
      nonTopBestSixPropCount: nonTopBestSix.length,
      nonTopBestSixRecord,
      topPickWinRate: topPickRecord.winRate,
      nonTopBestSixWinRate: nonTopBestSixRecord.winRate,
      winRateDelta:
        topPickRecord.winRate !== null && nonTopBestSixRecord.winRate !== null
          ? Number((topPickRecord.winRate - nonTopBestSixRecord.winRate).toFixed(1))
          : null,
    },
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
