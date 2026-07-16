import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createBackup } from "./backupService.js";
import { overlayLiveGradingFields } from "./gradeMonotonicityGuard.js";
import {
  getTodayLocalDate,
  hasUnresolvedGradingProps,
  isFutureSlateDate,
  isQuarantinedSlateDate,
  normalizeQuarantinedSlates,
  QUARANTINE_REASONS,
} from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ROOT = path.join(__dirname, "..");
const REGISTRY_FILE = path.join(SERVER_ROOT, "locked-slates.json");
const SNAPSHOTS_DIR = path.join(SERVER_ROOT, "slate-snapshots");
const HISTORY_ARCHIVE_DIR = path.join(SERVER_ROOT, "history-archive");

export const SLATE_PHASE = {
  ACTIVE: "ACTIVE",
  LAB: "LAB",
  ARCHIVED: "ARCHIVED",
};

/** First slate date included in clean collectible Lab/History/report era. */
export const CLEAN_DATA_CUTOFF = "2026-06-19";

function isOnOrAfterCleanDataCutoff(slateDate) {
  const value = String(slateDate || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= CLEAN_DATA_CUTOFF;
}

let lastBlockedWrite = null;

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function ensureDirs() {
  for (const dir of [SNAPSHOTS_DIR, HISTORY_ARCHIVE_DIR]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  if (!fs.existsSync(REGISTRY_FILE)) {
    writeJSON(REGISTRY_FILE, {
      slates: [],
      quarantinedSlates: [],
      updatedAt: new Date().toISOString(),
    });
  }
}

ensureDirs();

function getRegistry() {
  ensureDirs();
  const raw = readJSON(REGISTRY_FILE, { slates: [], quarantinedSlates: [] });
  return {
    slates: Array.isArray(raw.slates) ? raw.slates : [],
    quarantinedSlates: Array.isArray(raw.quarantinedSlates) ? raw.quarantinedSlates : [],
    updatedAt: raw.updatedAt || new Date().toISOString(),
    lastBlockedWrite: raw.lastBlockedWrite || lastBlockedWrite,
  };
}

function saveRegistry(registry) {
  writeJSON(REGISTRY_FILE, {
    ...registry,
    lastBlockedWrite: lastBlockedWrite || registry.lastBlockedWrite || null,
    updatedAt: new Date().toISOString(),
  });
}

function snapshotPath(slateDate) {
  return path.join(SNAPSHOTS_DIR, `${slateDate}.json`);
}

function historyArchivePath(slateDate) {
  return path.join(HISTORY_ARCHIVE_DIR, `${slateDate}.json`);
}

export function getQuarantinedSlatesFromRegistry() {
  return getRegistry().quarantinedSlates || [];
}

export function isSlateQuarantined(slateDate, registryEntries = getQuarantinedSlatesFromRegistry()) {
  return isQuarantinedSlateDate(slateDate, registryEntries);
}

export function quarantineSlate(
  slateDate,
  reason = QUARANTINE_REASONS.INCOMPLETE_PROD_DATA
) {
  const date = String(slateDate || "");
  if (!date) {
    return { ok: false, message: "Missing slateDate" };
  }

  const registry = getRegistry();
  registry.quarantinedSlates = registry.quarantinedSlates || [];
  const now = new Date().toISOString();
  const index = registry.quarantinedSlates.findIndex((entry) => entry.slateDate === date);

  if (index >= 0) {
    registry.quarantinedSlates[index] = {
      ...registry.quarantinedSlates[index],
      slateDate: date,
      reason,
      quarantinedAt: registry.quarantinedSlates[index].quarantinedAt || now,
      updatedAt: now,
    };
  } else {
    registry.quarantinedSlates.push({
      slateDate: date,
      reason,
      quarantinedAt: now,
    });
  }

  saveRegistry(registry);

  return {
    ok: true,
    message: `Slate ${date} quarantined`,
    slateDate: date,
    reason,
    entry: registry.quarantinedSlates.find((entry) => entry.slateDate === date),
  };
}

export function getMergedQuarantinedSlateSummary(registryEntries = getQuarantinedSlatesFromRegistry()) {
  return normalizeQuarantinedSlates(registryEntries);
}

export function getLockedSlatesRegistry() {
  const registry = getRegistry();
  return {
    ...registry,
    slates: (registry.slates || []).filter((entry) =>
      isOnOrAfterCleanDataCutoff(entry?.slateDate)
    ),
  };
}

export function isSlateLocked(slateDate) {
  const date = String(slateDate || "");
  if (!date) return false;

  const entry = getRegistry().slates.find((s) => s.slateDate === date);
  return Boolean(entry && entry.phase !== SLATE_PHASE.ARCHIVED);
}

export function getSlateLockEntry(slateDate) {
  const date = String(slateDate || "");
  if (!date) return null;
  return getRegistry().slates.find((s) => s.slateDate === date) || null;
}

export function getLockedSnapshot(slateDate) {
  const date = String(slateDate || "");
  if (!date) return null;

  const file = snapshotPath(date);
  if (!fs.existsSync(file)) return null;

  return readJSON(file, null);
}

export function getHistoryArchive(slateDate) {
  const date = String(slateDate || "");
  if (!date || !isOnOrAfterCleanDataCutoff(date)) return null;

  const file = historyArchivePath(date);
  if (!fs.existsSync(file)) return null;

  return readJSON(file, null);
}

export function listHistoryArchiveSlateDates() {
  ensureDirs();
  if (!fs.existsSync(HISTORY_ARCHIVE_DIR)) return [];

  return fs
    .readdirSync(HISTORY_ARCHIVE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""))
    .filter((slateDate) => isOnOrAfterCleanDataCutoff(slateDate))
    .sort()
    .reverse();
}

export function deleteHistoryArchive(slateDate) {
  const date = String(slateDate || "");
  if (!date) return { ok: false, message: "Missing slateDate" };

  const file = historyArchivePath(date);
  if (!fs.existsSync(file)) {
    return { ok: true, skipped: true, slateDate: date, reason: "missing_file" };
  }

  fs.unlinkSync(file);
  return { ok: true, slateDate: date, deleted: true };
}

/** Remove ARCHIVED/LAB registry rows; keep ACTIVE and explicit preserveDates. */
export function resetHistoryRegistryEntries(options = {}) {
  const preserveDates = new Set((options.preserveDates || []).map(String));
  const registry = getRegistry();
  const removed = [];
  const kept = [];

  registry.slates = (registry.slates || []).filter((entry) => {
    const slateDate = String(entry.slateDate || "");
    const phase = String(entry.phase || "").toUpperCase();

    if (preserveDates.has(slateDate) || phase === SLATE_PHASE.ACTIVE) {
      kept.push({ slateDate, phase });
      return true;
    }

    if (phase === SLATE_PHASE.ARCHIVED || phase === SLATE_PHASE.LAB) {
      removed.push({ slateDate, phase });
      return false;
    }

    kept.push({ slateDate, phase });
    return true;
  });

  saveRegistry(registry);
  return { removed, kept };
}

/** Delete history-archive JSON files except preserveDates. */
export function clearHistoryArchiveFiles(options = {}) {
  const preserveDates = new Set((options.preserveDates || []).map(String));
  const deleted = [];
  const skipped = [];

  ensureDirs();
  if (!fs.existsSync(HISTORY_ARCHIVE_DIR)) {
    return { deleted, skipped };
  }

  for (const name of fs
    .readdirSync(HISTORY_ARCHIVE_DIR)
    .filter((entry) => entry.endsWith(".json"))) {
    const slateDate = name.replace(/\.json$/, "");
    if (preserveDates.has(slateDate)) {
      skipped.push(slateDate);
      continue;
    }

    fs.unlinkSync(path.join(HISTORY_ARCHIVE_DIR, name));
    deleted.push(slateDate);
  }

  return { deleted, skipped };
}

/** Remove only LAB-phase registry rows; keep ACTIVE / ARCHIVED / preserveDates. */
export function clearLabPhaseRegistryEntries(options = {}) {
  const preserveDates = new Set((options.preserveDates || []).map(String));
  const registry = getRegistry();
  const removed = [];
  const kept = [];

  registry.slates = (registry.slates || []).filter((entry) => {
    const slateDate = String(entry.slateDate || "");
    const phase = String(entry.phase || "").toUpperCase();

    if (preserveDates.has(slateDate) || phase === SLATE_PHASE.ACTIVE) {
      kept.push({ slateDate, phase });
      return true;
    }

    if (phase === SLATE_PHASE.LAB) {
      removed.push({ slateDate, phase });
      return false;
    }

    kept.push({ slateDate, phase });
    return true;
  });

  saveRegistry(registry);
  return { removed, kept };
}

/**
 * Delete history-archive files whose phase is LAB (or missing phase treated as LAB).
 * Keeps ARCHIVED bundles and preserveDates.
 */
export function clearLabPhaseArchiveFiles(options = {}) {
  const preserveDates = new Set((options.preserveDates || []).map(String));
  const deleted = [];
  const skipped = [];

  ensureDirs();
  if (!fs.existsSync(HISTORY_ARCHIVE_DIR)) {
    return { deleted, skipped };
  }

  for (const name of fs
    .readdirSync(HISTORY_ARCHIVE_DIR)
    .filter((entry) => entry.endsWith(".json"))) {
    const slateDate = name.replace(/\.json$/, "");
    const file = path.join(HISTORY_ARCHIVE_DIR, name);
    const archive = readJSON(file, null);
    const phase = String(archive?.phase || SLATE_PHASE.LAB).toUpperCase();

    if (preserveDates.has(slateDate)) {
      skipped.push({ slateDate, reason: "preserved" });
      continue;
    }

    if (phase === SLATE_PHASE.ARCHIVED) {
      skipped.push({ slateDate, reason: "archived_kept" });
      continue;
    }

    if (phase === SLATE_PHASE.LAB || !archive?.phase) {
      fs.unlinkSync(file);
      deleted.push({ slateDate, phase: phase || SLATE_PHASE.LAB });
      continue;
    }

    skipped.push({ slateDate, reason: `phase_${phase}` });
  }

  return { deleted, skipped };
}

export function getAllHistoryArchives() {
  ensureDirs();
  if (!fs.existsSync(HISTORY_ARCHIVE_DIR)) return [];

  return fs
    .readdirSync(HISTORY_ARCHIVE_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readJSON(path.join(HISTORY_ARCHIVE_DIR, name), null))
    .filter(Boolean)
    .filter((archive) => isOnOrAfterCleanDataCutoff(archive?.slateDate))
    .sort((a, b) =>
      String(b.slateDate || "").localeCompare(String(a.slateDate || ""))
    );
}

function freezePropAtLock(prop = {}) {
  const line = Number(prop.line ?? prop.currentLine ?? prop.sportsbookLine) || 0;
  const side = prop.currentEngineSide || prop.side || prop.pick || "";

  return {
    ...prop,
    slateLocked: true,
    officialLine: prop.officialLine ?? line,
    pickLine: prop.pickLine ?? line,
    lockedSide: prop.lockedSide ?? side,
    lockedScoreLedger: prop.lockedScoreLedger ?? prop.scoreLedger ?? [],
    lockedSignalSnapshot: prop.lockedSignalSnapshot ?? prop.signalSnapshot ?? null,
    lockedPlayerState: prop.lockedPlayerState ?? prop.playerState ?? null,
    lockedVolumeProfile: prop.lockedVolumeProfile ?? prop.volumeProfile ?? null,
    latestLine: prop.latestLine ?? prop.currentLine ?? line,
    lineHistory: Array.isArray(prop.lineHistory)
      ? prop.lineHistory
      : prop.lineMovement
        ? [prop.lineMovement]
        : [],
  };
}

export function lockSlate(slateDate, options = {}) {
  const date = String(slateDate || "");
  const reason = String(options.reason || "manual");

  if (!date) {
    return { ok: false, message: "Missing slateDate" };
  }

  // Official Tomorrow Best 6 seals are allowed before calendar day (immutable Home lock).
  // All other future locks remain blocked.
  if (
    isFutureSlateDate(date, getTodayLocalDate()) &&
    !options.allowFutureOfficialSeal
  ) {
    recordBlockedWrite({
      action: "lockSlate",
      slateDate: date,
      reason: "future_slate",
    });
    return {
      ok: false,
      message: `Slate ${date} is in the future — lock blocked`,
      blockedByFutureGame: true,
    };
  }

  if (isSlateLocked(date)) {
    const existing = getSlateLockEntry(date);
    return {
      ok: true,
      message: "Slate already locked",
      slateDate: date,
      entry: existing,
      snapshot: getLockedSnapshot(date),
      alreadyLocked: true,
    };
  }

  const { getTrackedProps } = options;
  const tracked = typeof getTrackedProps === "function" ? getTrackedProps() : options.trackedProps || [];

  const slateProps = tracked.filter(
    (p) => String(p.slateDate || "") === date
  );

  if (!slateProps.length) {
    return { ok: false, message: `No tracked props found for slate ${date}` };
  }

  let backupId = null;
  try {
    const backup = createBackup(`pre-lock-${date}`);
    backupId = backup.backupId;
  } catch (err) {
    console.log("LOCK BACKUP WARNING:", err.message);
  }

  const frozenProps = slateProps.map(freezePropAtLock);
  const now = new Date().toISOString();

  const autoLocked = Boolean(
    options.autoLocked ?? String(reason).startsWith("auto_")
  );
  const officialSeal = options.officialSeal || null;

  const snapshot = {
    slateDate: date,
    lockedAt: now,
    lockReason: reason,
    autoLocked,
    phase: SLATE_PHASE.ACTIVE,
    propCount: frozenProps.length,
    props: frozenProps,
    backupId,
    immutableOfficial: Boolean(officialSeal?.sealed),
    officialSeal: officialSeal || undefined,
  };

  writeJSON(snapshotPath(date), snapshot);

  const registry = getRegistry();

  registry.slates.push({
    slateDate: date,
    phase: SLATE_PHASE.ACTIVE,
    lockedAt: now,
    lockReason: reason,
    autoLocked,
    propCount: frozenProps.length,
    snapshotFile: `slate-snapshots/${date}.json`,
    backupId,
    immutableOfficial: Boolean(officialSeal?.sealed),
    officialSealedAt: officialSeal?.sealedAt || null,
  });

  saveRegistry(registry);

  return {
    ok: true,
    message: `Slate ${date} locked (${frozenProps.length} props)`,
    slateDate: date,
    entry: registry.slates.find((s) => s.slateDate === date),
    snapshot,
    backupId,
  };
}

export function writeSlateHistoryArchive(slateDate, options = {}) {
  const date = String(slateDate || "");
  const props = Array.isArray(options.props) ? options.props : [];
  const report = options.report || null;

  if (!date) return { ok: false, message: "Missing slateDate" };
  if (!props.length) return { ok: false, message: "Missing props bundle" };

  ensureDirs();
  const existing = getHistoryArchive(date) || {};
  const now = new Date().toISOString();
  const phase = options.phase || existing.phase || SLATE_PHASE.LAB;

  const archive = {
    ...existing,
    slateDate: date,
    phase,
    archivedAt: existing.archivedAt || now,
    updatedAt: now,
    propCount: props.length,
    props,
    report: report || existing.report || null,
    snapshotFile: existing.snapshotFile || `slate-snapshots/${date}.json`,
  };

  writeJSON(historyArchivePath(date), archive);

  return { ok: true, message: `History archive written for ${date}`, archive };
}

export function hasHistoryArchive(slateDate) {
  const archive = getHistoryArchive(String(slateDate || ""));
  return Boolean(archive?.props?.length);
}

const LIVE_GRADING_FIELDS = [
  "status",
  "result",
  "actualStat",
  "margin",
  "resultMargin",
  "gradedAt",
  "resolveDebug",
  "matchedSource",
  "pendingReason",
  "gradingNotes",
  "matchedDate",
  "matchedGameId",
  "matchVerified",
  "resultConfidence",
  "resolvedAt",
  "currentEngineResult",
  "currentEngineWon",
  "currentEngineMargin",
];

function indexLiveProps(liveProps = []) {
  const byId = new Map();
  const byKey = new Map();

  for (const prop of liveProps) {
    if (prop.trackedId) byId.set(String(prop.trackedId), prop);
    if (prop.trackedKey) byKey.set(String(prop.trackedKey), prop);
  }

  return { byId, byKey };
}

function findLivePropForSnapshot(snapshotProp = {}, index = {}) {
  const trackedId = snapshotProp.trackedId ? String(snapshotProp.trackedId) : "";
  if (trackedId && index.byId?.has(trackedId)) {
    return index.byId.get(trackedId);
  }

  const trackedKey = snapshotProp.trackedKey ? String(snapshotProp.trackedKey) : "";
  if (trackedKey && index.byKey?.has(trackedKey)) {
    return index.byKey.get(trackedKey);
  }

  return null;
}

/** Keep locked snapshot identity; overlay live grading fields by trackedId/trackedKey. */
export function mergeSnapshotPropsWithLiveGrades(snapshotProps = [], liveProps = []) {
  if (!Array.isArray(snapshotProps) || !snapshotProps.length) {
    return Array.isArray(liveProps) ? [...liveProps] : [];
  }

  if (!Array.isArray(liveProps) || !liveProps.length) {
    return snapshotProps.map((prop) => ({ ...prop }));
  }

  const index = indexLiveProps(liveProps);

  return snapshotProps.map((snapshotProp) => {
    const live = findLivePropForSnapshot(snapshotProp, index);
    if (!live) return { ...snapshotProp };

    return overlayLiveGradingFields(snapshotProp, live, {
      sourcePath: "mergeSnapshotPropsWithLiveGrades",
      slateDate: snapshotProp.slateDate || live.slateDate,
    });
  });
}

export function syncGradedPropsToLockedSlate(slateDate, mergedProps = []) {
  const date = String(slateDate || "");
  if (!date || !isSlateLocked(date)) {
    return { ok: false, skipped: true, message: "Slate not locked" };
  }

  if (!Array.isArray(mergedProps) || !mergedProps.length) {
    return { ok: false, message: "Missing merged props" };
  }

  const snapshot = getLockedSnapshot(date);
  if (!snapshot?.props?.length) {
    return { ok: false, message: "Missing locked snapshot" };
  }

  const now = new Date().toISOString();

  writeJSON(snapshotPath(date), {
    ...snapshot,
    props: mergedProps,
    propCount: mergedProps.length,
    gradesSyncedAt: now,
  });

  const archive = getHistoryArchive(date);
  if (archive?.props?.length) {
    writeJSON(historyArchivePath(date), {
      ...archive,
      props: mergedProps,
      propCount: mergedProps.length,
      gradesSyncedAt: now,
      updatedAt: now,
    });
  }

  return { ok: true, slateDate: date, propCount: mergedProps.length };
}

const LAB_SNAPSHOT_LEARNING_FIELDS = [
  "postgameTruth",
  "actualMinutes",
  "actualFGA",
  "actualFTA",
  "actualFGPct",
  "actualTSPct",
  "teamFinalScore",
  "opponentFinalScore",
  "finalMargin",
  "closingLine",
  "closingLineValue",
  "lockLine",
  "missType",
  "missSubtype",
  "calibrationLesson",
  "modulesHelped",
  "modulesHurt",
  "modulesNeutral",
  "labCounterfactual",
  "labLearningVersion",
];

function snapshotPropKey(prop = {}) {
  return String(prop.trackedKey || prop.trackedId || prop.officialPropId || "");
}

/**
 * Overlay Lab learning fields onto a locked snapshot only.
 * Does not touch history archives, membership, officialPropId, or pregame snapshots.
 */
export function patchLockedSnapshotLearningFields(slateDate, enrichedProps = []) {
  const date = String(slateDate || "");
  if (!date || !isSlateLocked(date)) {
    return { ok: false, skipped: true, message: "Slate not locked" };
  }

  const snapshot = getLockedSnapshot(date);
  if (!snapshot?.props?.length) {
    return { ok: false, message: "Missing locked snapshot" };
  }

  const byKey = new Map(
    (Array.isArray(enrichedProps) ? enrichedProps : []).map((prop) => [
      snapshotPropKey(prop),
      prop,
    ])
  );

  const now = new Date().toISOString();
  let patchedCount = 0;
  const nextProps = snapshot.props.map((snapshotProp) => {
    const enriched = byKey.get(snapshotPropKey(snapshotProp));
    if (!enriched) return { ...snapshotProp };

    const next = { ...snapshotProp };
    for (const field of LAB_SNAPSHOT_LEARNING_FIELDS) {
      if (enriched[field] !== undefined) {
        next[field] = enriched[field];
      }
    }
    if (snapshotProp.officialPropId) {
      next.officialPropId = snapshotProp.officialPropId;
    }
    if (snapshotProp.pregameSnapshot) {
      next.pregameSnapshot = snapshotProp.pregameSnapshot;
    }
    patchedCount += 1;
    return next;
  });

  writeJSON(snapshotPath(date), {
    ...snapshot,
    props: nextProps,
    propCount: nextProps.length,
    labLearningBackfilledAt: now,
  });

  return {
    ok: true,
    slateDate: date,
    propCount: nextProps.length,
    patchedCount,
    historyArchiveTouched: false,
  };
}

/**
 * Append-only Best 6 backfill into a locked ACTIVE snapshot.
 * Never removes or replaces existing snapshot props / grades.
 *
 * Official sealed slates reject appends — membership is frozen at seal.
 */
export function appendMissingPropsToLockedSnapshot(slateDate, incomingProps = []) {
  const date = String(slateDate || "");
  if (!date || !isSlateLocked(date)) {
    return { ok: false, skipped: true, message: "Slate not locked" };
  }

  const incoming = (Array.isArray(incomingProps) ? incomingProps : []).filter(Boolean);
  if (!incoming.length) {
    return { ok: true, skipped: true, appended: 0, slateDate: date };
  }

  const snapshot = getLockedSnapshot(date);
  if (!snapshot) {
    return { ok: false, message: "Missing locked snapshot" };
  }

  if (snapshot.immutableOfficial === true || snapshot.officialSeal?.sealed === true) {
    return {
      ok: false,
      skipped: true,
      appended: 0,
      slateDate: date,
      message: "Official sealed slate rejects membership appends",
      blockedByOfficialSeal: true,
    };
  }

  const existingProps = Array.isArray(snapshot.props) ? [...snapshot.props] : [];
  const existingKeys = new Set(
    existingProps.map((prop) => String(prop.trackedKey || prop.trackedId || "")).filter(Boolean)
  );

  const appended = [];
  for (const prop of incoming) {
    const frozen = freezePropAtLock(prop);
    const key = String(frozen.trackedKey || frozen.trackedId || "");
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    existingProps.push(frozen);
    appended.push(frozen);
  }

  if (!appended.length) {
    return {
      ok: true,
      skipped: true,
      appended: 0,
      slateDate: date,
      propCount: existingProps.length,
    };
  }

  const now = new Date().toISOString();
  writeJSON(snapshotPath(date), {
    ...snapshot,
    props: existingProps,
    propCount: existingProps.length,
    bestSixBackfilledAt: now,
    bestSixBackfillCount: (Number(snapshot.bestSixBackfillCount) || 0) + appended.length,
  });

  const registry = getRegistry();
  const entry = registry.slates.find((s) => s.slateDate === date);
  if (entry) {
    entry.propCount = existingProps.length;
    entry.bestSixBackfilledAt = now;
    saveRegistry(registry);
  }

  return {
    ok: true,
    slateDate: date,
    appended: appended.length,
    propCount: existingProps.length,
    players: appended.map((prop) => prop.player),
  };
}

export function syncLockedSlateGradesFromLive(liveProps = [], slateDate = null) {
  const targets = slateDate
    ? [String(slateDate)]
    : getRegistry()
        .slates.filter((entry) => isOnOrAfterCleanDataCutoff(entry?.slateDate))
        .map((entry) => entry.slateDate);

  const results = [];

  for (const date of targets) {
    if (!isSlateLocked(date)) continue;

    const snapshot = getLockedSnapshot(date);
    if (!snapshot?.props?.length) continue;

    const slateLiveProps = liveProps.filter((prop) => String(prop.slateDate || "") === date);
    if (!slateLiveProps.length) continue;

    const merged = mergeSnapshotPropsWithLiveGrades(snapshot.props, slateLiveProps);
    results.push(syncGradedPropsToLockedSlate(date, merged));
  }

  return results;
}

export function getHistoryArchiveProps(slateDate) {
  const archive = getHistoryArchive(String(slateDate || ""));
  return archive?.props || [];
}

export function promoteSlateToLab(slateDate, options = {}) {
  const date = String(slateDate || "");
  if (!date) return { ok: false, message: "Missing slateDate" };

  if (!isOnOrAfterCleanDataCutoff(date)) {
    return {
      ok: false,
      message: `Slate ${date} is before clean data cutoff — Lab promotion skipped`,
      skippedPreCutoff: true,
    };
  }

  if (isFutureSlateDate(date, getTodayLocalDate())) {
    recordBlockedWrite({
      action: "promoteSlateToLab",
      slateDate: date,
      reason: "future_slate",
    });
    return {
      ok: false,
      message: `Slate ${date} is in the future — Lab promotion blocked`,
      blockedByFutureGame: true,
    };
  }

  const snapshot = getLockedSnapshot(date) || { props: [] };
  const passedProps = Array.isArray(options.props) ? options.props : [];
  const props =
    passedProps.length > 0
      ? passedProps
      : snapshot.props?.length
        ? snapshot.props
        : getHistoryArchiveProps(date);
  const report = options.report || null;
  const now = new Date().toISOString();

  if (!props.length) {
    return { ok: false, message: `No props available to promote slate ${date}` };
  }

  if (report) {
    const reportStatus = String(report.reportStatus || report.status || "").toLowerCase();
    const pending = Number(report.sections?.A?.pending ?? report.pending ?? 0);

    if (reportStatus !== "final" || pending > 0) {
      return {
        ok: false,
        message: `Slate ${date} daily report is not final — Lab promotion blocked`,
        blockedByIncompleteReport: true,
      };
    }
  }

  if (hasUnresolvedGradingProps(props)) {
    return {
      ok: false,
      message: `Slate ${date} has unresolved props — Lab promotion blocked`,
      blockedByUnresolvedGrades: true,
    };
  }

  const archiveResult = writeSlateHistoryArchive(date, {
    props,
    report,
    phase: SLATE_PHASE.LAB,
  });

  const registry = getRegistry();
  let index = registry.slates.findIndex((s) => s.slateDate === date);

  if (index < 0) {
    registry.slates.push({
      slateDate: date,
      phase: SLATE_PHASE.LAB,
      lockedAt: snapshot.lockedAt || null,
      lockReason: snapshot.lockReason || "auto_lab",
      propCount: props.length,
      historyArchiveFile: `history-archive/${date}.json`,
      labPromotedAt: now,
      finalReportAt: report ? now : null,
    });
    index = registry.slates.length - 1;
  } else {
    registry.slates[index] = {
      ...registry.slates[index],
      phase: SLATE_PHASE.LAB,
      labPromotedAt: now,
      propCount: props.length,
      historyArchiveFile: `history-archive/${date}.json`,
      finalReportAt: report ? now : registry.slates[index].finalReportAt || now,
    };
  }

  saveRegistry(registry);

  return {
    ok: true,
    message: `Slate ${date} promoted to LAB`,
    slateDate: date,
    entry: registry.slates[index],
    archive: archiveResult.archive,
  };
}

export function archiveSlate(slateDate, options = {}) {
  const date = String(slateDate || "");
  if (!date) return { ok: false, message: "Missing slateDate" };

  const registry = getRegistry();
  let index = registry.slates.findIndex((s) => s.slateDate === date);
  const now = new Date().toISOString();
  const existingArchive = getHistoryArchive(date) || {};

  if (index < 0) {
    if (!existingArchive?.props?.length && !options.props?.length) {
      return { ok: false, message: `Slate ${date} is not in registry and has no archive` };
    }

    registry.slates.push({
      slateDate: date,
      phase: SLATE_PHASE.ARCHIVED,
      propCount:
        existingArchive.propCount ||
        existingArchive.props?.length ||
        options.props?.length ||
        0,
      historyArchiveFile: `history-archive/${date}.json`,
      archivedAt: now,
    });
    index = registry.slates.length - 1;
  }

  writeJSON(historyArchivePath(date), {
    ...existingArchive,
    slateDate: date,
    phase: SLATE_PHASE.ARCHIVED,
    archivedAt: existingArchive.archivedAt || now,
    fullyArchivedAt: now,
    propCount:
      existingArchive.propCount ||
      existingArchive.props?.length ||
      options.props?.length ||
      0,
    props: existingArchive.props?.length
      ? existingArchive.props
      : options.props || [],
    report: options.report || existingArchive.report || null,
  });

  registry.slates[index] = {
    ...registry.slates[index],
    phase: SLATE_PHASE.ARCHIVED,
    archivedAt: now,
  };

  saveRegistry(registry);

  return {
    ok: true,
    message: `Slate ${date} archived`,
    slateDate: date,
    entry: registry.slates[index],
  };
}

export function recordBlockedWrite(audit = {}) {
  lastBlockedWrite = {
    ...audit,
    at: new Date().toISOString(),
  };

  const registry = getRegistry();
  registry.lastBlockedWrite = lastBlockedWrite;
  saveRegistry(registry);

  console.log("BLOCKED WRITE AUDIT:", lastBlockedWrite);

  return lastBlockedWrite;
}

export function getLastBlockedWrite() {
  const registry = getRegistry();
  return lastBlockedWrite || registry.lastBlockedWrite || null;
}

export function getTrackedPropsFromSnapshots(slateDate = null) {
  if (slateDate) {
    const snapshot = getLockedSnapshot(slateDate);
    return snapshot?.props || [];
  }

  ensureDirs();
  const props = [];

  for (const file of fs.readdirSync(SNAPSHOTS_DIR).filter((n) => n.endsWith(".json"))) {
    const snapshot = readJSON(path.join(SNAPSHOTS_DIR, file), null);
    if (snapshot?.props) {
      props.push(...snapshot.props);
    }
  }

  return props;
}

export function countDuplicateStableKeys(props = []) {
  const seen = new Map();
  let duplicates = 0;

  for (const prop of props) {
    const key = prop.trackedKey || prop.trackedId || "";
    if (!key) continue;
    if (seen.has(key)) duplicates += 1;
    else seen.set(key, 1);
  }

  return { total: props.length, unique: seen.size, duplicates };
}
