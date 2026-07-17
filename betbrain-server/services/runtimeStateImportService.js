/**
 * Runtime state import — merge-only rescue for wiped Render disk.
 * Never deletes existing props; overlays by stable key; can write slate snapshots + locks.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createBackup } from "./backupService.js";
import {
  writeTrackedProps,
  getTrackedProps,
  getStableTrackedPropKey,
  applySlateLockFreeze,
} from "./trackedPropService.js";
import {
  lockSlate,
  getLockedSlatesRegistry,
  isSlateLocked,
} from "./slateLockService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");
const SNAPSHOTS_DIR = path.join(SERVER_ROOT, "slate-snapshots");

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function writeJson(file, data) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

/**
 * Merge incoming tracked props into store (no deletes).
 * Optionally lock slateDates and write snapshot props for durability.
 */
export function importRuntimeState(payload = {}, options = {}) {
  const dryRun = Boolean(options.dryRun);
  const incomingProps = Array.isArray(payload.trackedProps)
    ? payload.trackedProps
    : [];
  const slateSnapshots = Array.isArray(payload.slateSnapshots)
    ? payload.slateSnapshots
    : [];
  const lockDates = Array.isArray(payload.lockSlateDates)
    ? payload.lockSlateDates.map(String)
    : [];

  if (!incomingProps.length && !slateSnapshots.length) {
    return { ok: false, message: "No trackedProps or slateSnapshots provided" };
  }

  let backupId = null;
  if (!dryRun) {
    try {
      backupId = createBackup(
        options.backupReason || "pre-runtime-state-import-v1"
      )?.backupId;
    } catch (err) {
      console.log("IMPORT BACKUP WARNING:", err.message);
    }
  }

  const existing = getTrackedProps();
  const byKey = new Map();
  for (const p of existing) {
    const k = getStableTrackedPropKey(p) || p.trackedKey || p.trackedId;
    if (k) byKey.set(String(k), p);
  }

  let inserted = 0;
  let updated = 0;
  for (const prop of incomingProps) {
    if (!prop?.player) continue;
    const k = String(
      getStableTrackedPropKey(prop) ||
        prop.trackedKey ||
        `${prop.player}|${prop.line}|${prop.slateDate}`
    );
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, { ...prop, trackedKey: prop.trackedKey || k });
      inserted += 1;
    } else {
      const next = { ...prev, ...prop };
      // Never downgrade a graded prop back to pending.
      if (
        String(prev.status || "").toLowerCase() !== "pending" &&
        String(prop.status || "").toLowerCase() === "pending"
      ) {
        next.status = prev.status;
        next.result = prev.result;
        next.resultMargin = prev.resultMargin;
        next.actualStat = prev.actualStat;
        next.gradedAt = prev.gradedAt;
      }
      byKey.set(k, next);
      updated += 1;
    }
  }

  const merged = [...byKey.values()];
  if (!dryRun) {
    writeTrackedProps(merged, {
      sourcePath: "importRuntimeState",
      allowGradeCorrection: true,
      gradeCorrectionReason: "runtime_state_import_rescue",
    });
  }

  const snapshotWrites = [];
  for (const snap of slateSnapshots) {
    const date = String(snap.slateDate || "");
    if (!date || !Array.isArray(snap.props) || !snap.props.length) continue;
    const file = path.join(SNAPSHOTS_DIR, `${date}.json`);
    snapshotWrites.push({ slateDate: date, propCount: snap.props.length });
    if (!dryRun) {
      writeJson(file, {
        ...snap,
        slateDate: date,
        propCount: snap.props.length,
        importedAt: new Date().toISOString(),
      });
    }
  }

  const lockResults = [];
  for (const date of lockDates) {
    if (!date) continue;
    if (dryRun) {
      lockResults.push({ slateDate: date, dryRun: true });
      continue;
    }
    const slateProps = merged.filter((p) => String(p.slateDate) === date);
    if (!slateProps.length) {
      lockResults.push({
        slateDate: date,
        ok: false,
        message: "No props for date after merge",
      });
      continue;
    }
    if (isSlateLocked(date)) {
      applySlateLockFreeze(date, slateProps);
      lockResults.push({
        slateDate: date,
        alreadyLocked: true,
        freezeSynced: true,
      });
      continue;
    }
    const result = lockSlate(date, {
      reason: options.lockReason || "runtime_state_import_rescue",
      trackedProps: slateProps,
      getTrackedProps: () => slateProps,
      allowFutureOfficialSeal: true,
      officialSeal: {
        sealed: true,
        status: "SEALED",
        sealedAt: new Date().toISOString(),
        sealReason: options.sealReason || "RESCUE_IMPORT",
        sourcePool: "RUNTIME_STATE_IMPORT",
        lifecycleStage: "RESULTS",
        stage: "RESULTS",
      },
    });
    if (result.ok || result.alreadyLocked) {
      applySlateLockFreeze(date, result.snapshot?.props || slateProps);
    }
    lockResults.push(result);
  }

  return {
    ok: true,
    dryRun,
    backupId,
    inserted,
    updated,
    mergedCount: merged.length,
    snapshotWrites,
    lockResults,
    registryCount: getLockedSlatesRegistry().slates?.length || 0,
  };
}
