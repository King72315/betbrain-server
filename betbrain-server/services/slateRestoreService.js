import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createBackup } from "./backupService.js";
import {
  applySlateLockFreeze,
  getTrackedProps,
  runTrackedPropStartupIntegrityCheck,
} from "./trackedPropService.js";
import { isResolvedStatus } from "./gradeMonotonicityGuard.js";
import {
  getDailySlateReport,
  upsertDailySlateReport,
} from "./dailySlateReportService.js";
import {
  getLockedSlatesRegistry,
  getLockedSnapshot,
  getHistoryArchiveProps,
  hasHistoryArchive,
  isSlateLocked,
  lockSlate,
  SLATE_PHASE,
  writeSlateHistoryArchive,
} from "./slateLockService.js";
import {
  BLOCKED_LAB_RESTORE_DATES,
  getTodayLocalDate,
} from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const TRACKED_FILE = path.join(SERVER_ROOT, "tracked-props.json");
const REGISTRY_FILE = path.join(SERVER_ROOT, "locked-slates.json");
const SNAPSHOTS_DIR = path.join(SERVER_ROOT, "slate-snapshots");

/** Bundled official slate freezes shipped in repo — survives Render ephemeral disk wipes. */
export const OFFICIAL_FREEZE_CATALOG = {
  "2026-06-21": {
    file: "tracked-props-06-21-official-freeze-20260621.json",
    expectedSha256:
      "077c9a8edda29ad4046f6c778513dfc47ad61bf3b9b84330ed3d497b406abbfb",
    expectedCount: 14,
    lockReason: "official_freeze_14_props",
  },
};

/** Active locked slates that must survive deploy wipes (today's Results clipboard). */
export const ACTIVE_SLATE_BUNDLE_CATALOG = {
  "2026-07-08": {
    bundleDir: "active-bundles/2026-07-08",
    expectedPropCount: 5,
    expectedGraded: 3,
    expectedPending: 2,
    lockReason: "auto_results_track",
    phase: SLATE_PHASE.ACTIVE,
  },
};

/** Completed Lab/History bundles — rehydrated after Render disk wipes. */
export const LAB_SLATE_BUNDLE_CATALOG = {
  "2026-06-21": {
    bundleDir: "lab-bundles/2026-06-21",
    expectedPropCount: 14,
    expectedGraded: 14,
    expectedRecord: "5-9-0",
    phase: SLATE_PHASE.LAB,
  },
};

function readJSON(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function countPropsForSlate(props, slateDate) {
  return props.filter((p) => String(p.slateDate || "") === slateDate).length;
}

function verifyBundleFiles(dir, requiredFiles = []) {
  const missing = requiredFiles.filter((file) => !fs.existsSync(path.join(dir, file)));
  return {
    ok: missing.length === 0,
    missing,
    checked: requiredFiles,
  };
}

function liveIsNewerThanBundle(liveProps = [], bundleProps = []) {
  const liveResolved = liveProps.filter((p) => isResolvedStatus(p.status)).length;
  const bundleResolved = bundleProps.filter((p) => isResolvedStatus(p.status)).length;
  if (liveResolved > bundleResolved) return true;
  if (liveResolved < bundleResolved) return false;

  const liveLatest = Math.max(
    0,
    ...liveProps.map((p) => Date.parse(p.gradedAt || p.resolvedAt || 0) || 0)
  );
  const bundleLatest = Math.max(
    0,
    ...bundleProps.map((p) => Date.parse(p.gradedAt || p.resolvedAt || 0) || 0)
  );
  return liveLatest >= bundleLatest && liveProps.length >= bundleProps.length;
}

function pyJsonStringify(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "null";
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map((item) => pyJsonStringify(item)).join(", ")}]`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys
      .map((key) => `${JSON.stringify(key)}: ${pyJsonStringify(value[key])}`)
      .join(", ")}}`;
  }
  return "null";
}

function canonicalPropsChecksum(props) {
  const canonical = pyJsonStringify(
    [...props]
      .sort((a, b) =>
        String(a.trackedId || a.player || "").localeCompare(
          String(b.trackedId || b.player || "")
        )
      )
      .map((p) => ({
        trackedId: p.trackedId,
        player: p.player,
        currentEngineSide: p.currentEngineSide,
        officialLine: p.officialLine,
        line: p.line,
        generatedAt: p.generatedAt,
        lastSeenAt: p.lastSeenAt,
      }))
  );
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

function loadBundledFreeze(slateDate) {
  const entry = OFFICIAL_FREEZE_CATALOG[slateDate];
  if (!entry) {
    return { ok: false, message: `No bundled official freeze for ${slateDate}` };
  }

  const filePath = path.join(SERVER_ROOT, entry.file);
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      message: `Bundled freeze file missing: ${entry.file}`,
    };
  }

  const raw = readJSON(filePath, null);
  const props = Array.isArray(raw?.props) ? raw.props : Array.isArray(raw) ? raw : [];
  const checksum = canonicalPropsChecksum(props);

  if (checksum !== entry.expectedSha256) {
    return {
      ok: false,
      message: `Canonical props checksum mismatch for ${entry.file}`,
      expected: entry.expectedSha256,
      actual: checksum,
      metaChecksum: raw?.meta?.checksumSha256 || null,
    };
  }

  if (props.length !== entry.expectedCount) {
    return {
      ok: false,
      message: `Prop count mismatch for ${slateDate}`,
      expected: entry.expectedCount,
      actual: props.length,
    };
  }

  return {
    ok: true,
    props,
    meta: raw?.meta || null,
    source: entry.file,
    checksum,
  };
}

function activeBundleDirFor(slateDate) {
  const entry = ACTIVE_SLATE_BUNDLE_CATALOG[slateDate];
  if (!entry?.bundleDir) return null;
  return path.join(SERVER_ROOT, entry.bundleDir);
}

function loadActiveBundle(slateDate) {
  const date = String(slateDate || "");
  const entry = ACTIVE_SLATE_BUNDLE_CATALOG[date];
  if (!entry) return { ok: false, message: `No active bundle catalog entry for ${date}` };

  const dir = activeBundleDirFor(date);
  if (!dir || !fs.existsSync(dir)) {
    console.error(`ACTIVE BUNDLE VERIFY FAILED: directory missing for ${date}`);
    return { ok: false, message: `Active bundle directory missing: ${entry.bundleDir}` };
  }

  const fileCheck = verifyBundleFiles(dir, [
    "tracked-props.json",
    "slate-snapshot.json",
    "locked-slate-entry.json",
  ]);
  if (!fileCheck.ok) {
    console.error(
      `ACTIVE BUNDLE VERIFY FAILED: missing files for ${date}:`,
      fileCheck.missing.join(", ")
    );
    return {
      ok: false,
      message: `Active bundle missing files: ${fileCheck.missing.join(", ")}`,
      missingFiles: fileCheck.missing,
    };
  }

  console.log(`ACTIVE BUNDLE VERIFY OK: ${date} files present`);

  const trackedRaw = readJSON(path.join(dir, "tracked-props.json"), null);
  const props = Array.isArray(trackedRaw?.props)
    ? trackedRaw.props
    : Array.isArray(trackedRaw)
      ? trackedRaw
      : [];
  const slateProps = props.filter((p) => String(p.slateDate || "") === date);

  if (slateProps.length !== entry.expectedPropCount) {
    return {
      ok: false,
      message: `Active bundle prop count mismatch for ${date}`,
      expected: entry.expectedPropCount,
      actual: slateProps.length,
    };
  }

  return {
    ok: true,
    slateDate: date,
    props: slateProps,
    snapshot: readJSON(path.join(dir, "slate-snapshot.json"), null),
    registryEntry: readJSON(path.join(dir, "locked-slate-entry.json"), null),
    source: entry.bundleDir,
    lockReason: entry.lockReason || "startup_active_bundle",
  };
}

export function needsActiveSlateRestore(slateDate) {
  const date = String(slateDate || "");
  if (!ACTIVE_SLATE_BUNDLE_CATALOG[date]) return false;
  return countPropsForSlate(getTrackedProps(), date) === 0;
}

export function restoreActiveSlateBundle(slateDate, options = {}) {
  const date = String(slateDate || "");
  const loaded = loadActiveBundle(date);
  if (!loaded.ok) return loaded;

  const existing = readJSON(TRACKED_FILE, []);
  const liveSlateProps = existing.filter((p) => String(p.slateDate || "") === date);
  if (liveSlateProps.length > 0 && liveIsNewerThanBundle(liveSlateProps, loaded.props)) {
    console.log(
      `ACTIVE BUNDLE RESTORE SKIPPED: live ${date} slate is newer than bundled snapshot`
    );
    return {
      ok: false,
      skipped: true,
      message: `Live slate ${date} is newer than bundle — restore skipped`,
      slateDate: date,
      liveCount: liveSlateProps.length,
      bundleCount: loaded.props.length,
    };
  }

  let backupId = null;
  try {
    const backup = createBackup(`pre-active-restore-${date}`);
    backupId = backup.backupId;
  } catch (err) {
    console.log("ACTIVE RESTORE BACKUP WARNING:", err.message);
  }

  const existing = readJSON(TRACKED_FILE, []);
  const preserved = existing.filter((p) => String(p.slateDate || "") !== date);
  writeJSON(TRACKED_FILE, [...preserved, ...loaded.props]);

  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }

  const snapshot =
    loaded.snapshot?.props?.length
      ? loaded.snapshot
      : {
          slateDate: date,
          lockedAt: loaded.registryEntry?.lockedAt || new Date().toISOString(),
          lockReason: loaded.lockReason,
          autoLocked: true,
          phase: SLATE_PHASE.ACTIVE,
          propCount: loaded.props.length,
          props: loaded.props,
        };

  writeJSON(path.join(SNAPSHOTS_DIR, `${date}.json`), snapshot);

  const registry = readJSON(REGISTRY_FILE, { slates: [] });
  const slates = Array.isArray(registry.slates) ? [...registry.slates] : [];
  const index = slates.findIndex((s) => s.slateDate === date);
  const nextEntry = {
    ...(index >= 0 ? slates[index] : {}),
    ...(loaded.registryEntry || {}),
    slateDate: date,
    phase: SLATE_PHASE.ACTIVE,
    propCount: loaded.props.length,
    snapshotFile: `slate-snapshots/${date}.json`,
  };
  if (index >= 0) slates[index] = nextEntry;
  else slates.push(nextEntry);
  writeJSON(REGISTRY_FILE, { ...registry, slates, updatedAt: new Date().toISOString() });

  applySlateLockFreeze(date, loaded.props);

  const restoredCount = countPropsForSlate(getTrackedProps(), date);
  return {
    ok: true,
    message: `Restored active slate ${date}`,
    slateDate: date,
    mode: "active",
    propCount: restoredCount,
    backupId,
    source: options.source || loaded.source,
    lockReason: loaded.lockReason,
  };
}

function bundleDirFor(slateDate) {
  const entry = LAB_SLATE_BUNDLE_CATALOG[slateDate];
  if (!entry?.bundleDir) return null;
  return path.join(SERVER_ROOT, entry.bundleDir);
}

function summarizeGradedRecord(props = []) {
  const graded = props.filter((p) =>
    ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
  );
  const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
  const losses = graded.filter((p) => String(p.status).toLowerCase() === "loss").length;
  const pushes = graded.filter((p) => String(p.status).toLowerCase() === "push").length;
  return {
    graded: graded.length,
    record: `${wins}-${losses}-${pushes}`,
  };
}

function loadLabBundle(slateDate) {
  const date = String(slateDate || "");
  const entry = LAB_SLATE_BUNDLE_CATALOG[date];
  if (!entry) {
    return { ok: false, message: `No lab bundle catalog entry for ${date}` };
  }

  const dir = bundleDirFor(date);
  if (!dir || !fs.existsSync(dir)) {
    return { ok: false, message: `Lab bundle directory missing: ${entry.bundleDir}` };
  }

  const trackedRaw = readJSON(path.join(dir, "tracked-props.json"), null);
  const props = Array.isArray(trackedRaw?.props)
    ? trackedRaw.props
    : Array.isArray(trackedRaw)
      ? trackedRaw
      : [];
  const slateProps = props.filter((p) => String(p.slateDate || "") === date);

  if (slateProps.length !== entry.expectedPropCount) {
    return {
      ok: false,
      message: `Lab bundle prop count mismatch for ${date}`,
      expected: entry.expectedPropCount,
      actual: slateProps.length,
    };
  }

  const { graded, record } = summarizeGradedRecord(slateProps);
  if (entry.expectedGraded && graded !== entry.expectedGraded) {
    return {
      ok: false,
      message: `Lab bundle graded count mismatch for ${date}`,
      expected: entry.expectedGraded,
      actual: graded,
    };
  }

  if (entry.expectedRecord && record !== entry.expectedRecord) {
    return {
      ok: false,
      message: `Lab bundle record mismatch for ${date}`,
      expected: entry.expectedRecord,
      actual: record,
    };
  }

  const report = readJSON(path.join(dir, "daily-slate-report.json"), null);
  const historyArchive = readJSON(path.join(dir, "history-archive.json"), null);
  const snapshot = readJSON(path.join(dir, "slate-snapshot.json"), null);
  const registryEntry = readJSON(path.join(dir, "locked-slate-entry.json"), null);
  const manifest = readJSON(path.join(dir, "manifest.json"), null);

  return {
    ok: true,
    slateDate: date,
    props: slateProps,
    report,
    historyArchive,
    snapshot,
    registryEntry,
    manifest,
    source: entry.bundleDir,
    graded,
    record,
  };
}

export function needsCompletedLabRestore(slateDate) {
  const date = String(slateDate || "");
  if (!LAB_SLATE_BUNDLE_CATALOG[date]) return false;

  const today = getTodayLocalDate();
  if (date >= today) return false;

  const tracked = getTrackedProps();
  const propCount = countPropsForSlate(tracked, date);
  const report = getDailySlateReport(date);
  const reportProps =
    report?.sections?.A?.totalOfficialProps ??
    (Array.isArray(report?.props) ? report.props.length : 0);

  return (
    propCount === 0 ||
    !hasHistoryArchive(date) ||
    !report ||
    reportProps === 0 ||
    String(report.reportStatus || report.status || "").toLowerCase() !== "final"
  );
}

function mergeLabRegistryEntry(slateDate, registryEntry = {}) {
  const date = String(slateDate || "");
  const registry = readJSON(REGISTRY_FILE, { slates: [] });
  const slates = Array.isArray(registry.slates) ? [...registry.slates] : [];
  const index = slates.findIndex((s) => s.slateDate === date);
  const now = new Date().toISOString();
  const nextEntry = {
    ...(index >= 0 ? slates[index] : {}),
    ...registryEntry,
    slateDate: date,
    phase: SLATE_PHASE.LAB,
    propCount:
      registryEntry.propCount ||
      LAB_SLATE_BUNDLE_CATALOG[date]?.expectedPropCount ||
      slates[index]?.propCount ||
      0,
    historyArchiveFile: registryEntry.historyArchiveFile || `history-archive/${date}.json`,
    snapshotFile: registryEntry.snapshotFile || `slate-snapshots/${date}.json`,
    labPromotedAt: registryEntry.labPromotedAt || slates[index]?.labPromotedAt || now,
    finalReportAt: registryEntry.finalReportAt || slates[index]?.finalReportAt || now,
  };

  if (index >= 0) {
    slates[index] = nextEntry;
  } else {
    slates.push(nextEntry);
  }

  writeJSON(REGISTRY_FILE, {
    ...registry,
    slates,
    updatedAt: now,
  });

  return nextEntry;
}

/**
 * Merge a completed Lab slate bundle into runtime JSON without touching other dates.
 */
export function restoreCompletedLabSlate(slateDate, options = {}) {
  const date = String(slateDate || "");
  if (!date) return { ok: false, message: "Missing slateDate" };

  if (BLOCKED_LAB_RESTORE_DATES.includes(date)) {
    return {
      ok: false,
      blocked: true,
      status: 403,
      message: `Lab restore blocked for ${date} after Lab wipe (COURTEDGE_LAB_WIPE_V1). Use graded Results→Lab promotion instead.`,
      slateDate: date,
    };
  }

  const loaded = loadLabBundle(date);
  if (!loaded.ok) return loaded;

  let backupId = null;
  try {
    const backup = createBackup(`pre-lab-restore-${date}`);
    backupId = backup.backupId;
  } catch (err) {
    console.log("LAB RESTORE BACKUP WARNING:", err.message);
  }

  const existing = readJSON(TRACKED_FILE, []);
  const preserved = existing.filter((p) => String(p.slateDate || "") !== date);
  const merged = [...preserved, ...loaded.props];
  writeJSON(TRACKED_FILE, merged);

  if (!fs.existsSync(SNAPSHOTS_DIR)) {
    fs.mkdirSync(SNAPSHOTS_DIR, { recursive: true });
  }

  const snapshot =
    loaded.snapshot && loaded.snapshot.props?.length
      ? loaded.snapshot
      : {
          slateDate: date,
          lockedAt: loaded.registryEntry?.lockedAt || new Date().toISOString(),
          lockReason: loaded.registryEntry?.lockReason || "official_freeze_14_props",
          autoLocked: false,
          phase: SLATE_PHASE.LAB,
          propCount: loaded.props.length,
          props: loaded.props,
        };

  writeJSON(path.join(SNAPSHOTS_DIR, `${date}.json`), snapshot);

  if (loaded.report) {
    upsertDailySlateReport(loaded.report);
  }

  const archiveResult = writeSlateHistoryArchive(date, {
    props: loaded.historyArchive?.props?.length
      ? loaded.historyArchive.props
      : loaded.props,
    report: loaded.report || loaded.historyArchive?.report || null,
    phase: SLATE_PHASE.LAB,
  });

  const registryEntry = mergeLabRegistryEntry(
    date,
    loaded.registryEntry || {
      slateDate: date,
      phase: SLATE_PHASE.LAB,
      lockReason: "official_freeze_14_props",
      propCount: loaded.props.length,
    }
  );

  applySlateLockFreeze(date, loaded.props);

  const final = getTrackedProps();
  const restoredCount = countPropsForSlate(final, date);
  const { graded, record } = summarizeGradedRecord(
    final.filter((p) => String(p.slateDate || "") === date)
  );

  return {
    ok: true,
    message: `Restored completed Lab slate ${date}`,
    slateDate: date,
    mode: "lab",
    propCount: restoredCount,
    graded,
    record,
    backupId,
    source: options.source || loaded.source,
    registryEntry,
    archive: archiveResult.archive || null,
    reportRestored: Boolean(loaded.report),
  };
}

function loadPropsFromSnapshotOrArchive(slateDate) {
  const snapshot = getLockedSnapshot(slateDate);
  if (snapshot?.props?.length) {
    return { ok: true, props: snapshot.props, source: `slate-snapshots/${slateDate}.json` };
  }

  const archiveProps = getHistoryArchiveProps(slateDate);
  if (archiveProps.length) {
    return {
      ok: true,
      props: archiveProps,
      source: `history-archive/${slateDate}.json`,
    };
  }

  return loadBundledFreeze(slateDate);
}

/**
 * Merge official slate props into tracked-props.json without touching other slate dates.
 */
export function restoreOfficialSlate(slateDate, options = {}) {
  const date = String(slateDate || "");
  if (!date) {
    return { ok: false, message: "Missing slateDate" };
  }

  let incoming = Array.isArray(options.props) ? options.props : null;
  let source = options.source || "request_body";
  let checksum = options.checksum || null;

  if (!incoming?.length) {
    const loaded = loadBundledFreeze(date);
    if (!loaded.ok) return loaded;
    incoming = loaded.props;
    source = loaded.source;
    checksum = loaded.checksum;
  }

  const slateIncoming = incoming.filter((p) => String(p.slateDate || "") === date);
  if (!slateIncoming.length) {
    return {
      ok: false,
      message: `No props in restore bundle for slate ${date}`,
    };
  }

  let backupId = null;
  try {
    const backup = createBackup(`pre-restore-${date}`);
    backupId = backup.backupId;
  } catch (err) {
    console.log("RESTORE BACKUP WARNING:", err.message);
  }

  const existing = readJSON(TRACKED_FILE, []);
  const preserved = existing.filter((p) => String(p.slateDate || "") !== date);
  const merged = [...preserved, ...slateIncoming];

  writeJSON(TRACKED_FILE, merged);

  const lockReason =
    String(options.reason || "") ||
    OFFICIAL_FREEZE_CATALOG[date]?.lockReason ||
    "official_slate_restore";

  let lockResult = null;
  if (options.lock !== false) {
    lockResult = lockSlate(date, {
      reason: lockReason,
      getTrackedProps,
    });

    if (!lockResult.ok && !lockResult.alreadyLocked) {
      return {
        ok: false,
        message: lockResult.message || "Lock failed after prop merge",
        propCount: slateIncoming.length,
        backupId,
        source,
        checksum,
      };
    }

    const frozenProps = lockResult.snapshot?.props || slateIncoming;
    if (frozenProps.length) {
      applySlateLockFreeze(date, frozenProps);
      writeSlateHistoryArchive(date, { props: frozenProps });
    }
  }

  const final = getTrackedProps();
  const restoredCount = countPropsForSlate(final, date);

  return {
    ok: true,
    message: `Restored ${restoredCount} props for slate ${date}`,
    slateDate: date,
    propCount: restoredCount,
    restoredIds: slateIncoming.map((p) => p.trackedId || p.trackedKey),
    backupId,
    source,
    checksum,
    lockReason,
    locked: options.lock !== false,
    lockResult: lockResult
      ? {
          ok: lockResult.ok,
          alreadyLocked: lockResult.alreadyLocked || false,
          propCount: lockResult.snapshot?.propCount ?? restoredCount,
        }
      : null,
  };
}

/**
 * On startup: rehydrate locked slates missing props, then official freeze for today if empty.
 */
export function rehydrateLockedSlatesOnStartup() {
  const results = [];
  const registry = getLockedSlatesRegistry();

  for (const date of Object.keys(ACTIVE_SLATE_BUNDLE_CATALOG)) {
    if (!needsActiveSlateRestore(date)) {
      results.push({ slateDate: date, action: "skip_active_bundle_intact" });
      continue;
    }

    const restored = restoreActiveSlateBundle(date, {
      source: "startup_rehydrate_active_bundle",
    });

    results.push({
      slateDate: date,
      action: restored.ok ? "restored_active_bundle" : "active_restore_failed",
      ...restored,
    });
  }

  for (const date of Object.keys(LAB_SLATE_BUNDLE_CATALOG)) {
    if (!needsCompletedLabRestore(date)) {
      results.push({ slateDate: date, action: "skip_lab_bundle_intact" });
      continue;
    }

    const restored = restoreCompletedLabSlate(date, {
      source: "startup_rehydrate_lab_bundle",
    });

    results.push({
      slateDate: date,
      action: restored.ok ? "restored_lab_bundle" : "lab_restore_failed",
      ...restored,
    });
  }

  for (const entry of registry.slates || []) {
    const date = String(entry.slateDate || "");
    if (!date) continue;

    if (entry.phase === SLATE_PHASE.LAB) {
      results.push({
        slateDate: date,
        action: needsCompletedLabRestore(date)
          ? "lab_still_incomplete"
          : "skip_lab_registry_intact",
      });
      continue;
    }

    const count = countPropsForSlate(getTrackedProps(), date);
    if (count > 0) {
      results.push({ slateDate: date, action: "skip_has_props", count });
      continue;
    }

    const loaded = loadPropsFromSnapshotOrArchive(date);
    if (!loaded.ok) {
      results.push({
        slateDate: date,
        action: "restore_failed",
        message: loaded.message,
      });
      continue;
    }

    const restored = restoreOfficialSlate(date, {
      props: loaded.props,
      lock: true,
      reason: entry.lockReason || "startup_rehydrate_locked_registry",
      source: loaded.source,
    });

    results.push({
      slateDate: date,
      action: restored.ok ? "restored_from_registry" : "restore_failed",
      ...restored,
    });
  }

  const today = getTodayLocalDate();
  const todayCount = countPropsForSlate(getTrackedProps(), today);

  if (
    today &&
    todayCount === 0 &&
    OFFICIAL_FREEZE_CATALOG[today] &&
    !isSlateLocked(today)
  ) {
    const restored = restoreOfficialSlate(today, {
      lock: true,
      reason: OFFICIAL_FREEZE_CATALOG[today].lockReason,
      source: "startup_rehydrate_official_freeze",
    });

    results.push({
      slateDate: today,
      action: restored.ok ? "restored_official_freeze" : "restore_failed",
      ...restored,
    });
  } else if (today && todayCount === 0 && isSlateLocked(today)) {
    const restored = restoreOfficialSlate(today, {
      lock: false,
      source: "startup_rehydrate_locked_empty",
    });

    results.push({
      slateDate: today,
      action: restored.ok ? "restored_locked_empty" : "restore_failed",
      ...restored,
    });

    if (restored.ok) {
      const relock = lockSlate(today, {
        reason: "startup_rehydrate_relock",
        getTrackedProps,
      });
      if (relock.snapshot?.props?.length) {
        applySlateLockFreeze(today, relock.snapshot.props);
      }
      results[results.length - 1].relock = relock.ok;
    }
  }

  const attempted = results.filter((r) => r.action?.includes("restored"));
  if (attempted.length) {
    console.log("STARTUP SLATE REHYDRATION:", JSON.stringify(results, null, 2));
  }

  const integrity = runTrackedPropStartupIntegrityCheck();

  return { ok: true, results, startupIntegrity: integrity };
}

export function getLabBundleInfo(slateDate) {
  const date = String(slateDate || "");
  const entry = LAB_SLATE_BUNDLE_CATALOG[date];
  if (!entry) return { ok: false, message: "No lab bundle catalog entry", slateDate: date };

  const dir = bundleDirFor(date);
  const exists = Boolean(dir && fs.existsSync(dir));
  let loaded = null;
  if (exists) {
    loaded = loadLabBundle(date);
  }

  return {
    ok: true,
    slateDate: date,
    bundleDir: entry.bundleDir,
    exists,
    needsRestore: needsCompletedLabRestore(date),
    expectedPropCount: entry.expectedPropCount,
    expectedRecord: entry.expectedRecord,
    bundleValid: loaded?.ok || false,
    bundleError: loaded?.ok ? null : loaded?.message || null,
    actual: loaded?.ok
      ? { propCount: loaded.props.length, graded: loaded.graded, record: loaded.record }
      : null,
  };
}

export function getOfficialFreezeInfo(slateDate) {
  const date = String(slateDate || "");
  const entry = OFFICIAL_FREEZE_CATALOG[date];
  if (!entry) return { ok: false, message: "No catalog entry", slateDate: date };

  const filePath = path.join(SERVER_ROOT, entry.file);
  const exists = fs.existsSync(filePath);
  let checksum = null;
  let propCount = 0;
  if (exists) {
    const raw = readJSON(filePath, null);
    const props = Array.isArray(raw?.props) ? raw.props : [];
    propCount = props.length;
    checksum = props.length ? canonicalPropsChecksum(props) : null;
  }

  return {
    ok: true,
    slateDate: date,
    file: entry.file,
    exists,
    propCount,
    checksum,
    expectedSha256: entry.expectedSha256,
    checksumMatch: checksum === entry.expectedSha256,
    expectedCount: entry.expectedCount,
    lockReason: entry.lockReason,
  };
}
