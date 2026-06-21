import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { createBackup } from "./backupService.js";
import {
  applySlateLockFreeze,
  getTrackedProps,
} from "./trackedPropService.js";
import {
  getLockedSlatesRegistry,
  getLockedSnapshot,
  getHistoryArchiveProps,
  isSlateLocked,
  lockSlate,
  writeSlateHistoryArchive,
} from "./slateLockService.js";
import { getTodayLocalDate } from "./slateScopeService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const TRACKED_FILE = path.join(SERVER_ROOT, "tracked-props.json");

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
  const tracked = getTrackedProps();
  const registry = getLockedSlatesRegistry();

  for (const entry of registry.slates || []) {
    const date = String(entry.slateDate || "");
    if (!date) continue;

    const count = countPropsForSlate(tracked, date);
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

  return { ok: true, results };
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
