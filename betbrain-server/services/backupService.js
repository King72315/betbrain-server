import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SERVER_ROOT = path.join(__dirname, "..");
const BACKUPS_DIR = path.join(SERVER_ROOT, "backups");

const BACKUP_FILES = [
  { name: "tracked-props.json", src: path.join(SERVER_ROOT, "tracked-props.json") },
  {
    name: "daily-slate-reports.json",
    src: path.join(SERVER_ROOT, "daily-slate-reports.json"),
  },
  { name: "pick-history.json", src: path.join(SERVER_ROOT, "pick-history.json") },
  { name: "pick-analytics.json", src: path.join(SERVER_ROOT, "pick-analytics.json") },
  { name: "locked-slates.json", src: path.join(SERVER_ROOT, "locked-slates.json") },
];

const BACKUP_DIRS = [
  { name: "slate-snapshots", src: path.join(SERVER_ROOT, "slate-snapshots") },
  { name: "history-archive", src: path.join(SERVER_ROOT, "history-archive") },
];

let lastBackupMeta = null;

function ensureBackupsDir() {
  if (!fs.existsSync(BACKUPS_DIR)) {
    fs.mkdirSync(BACKUPS_DIR, { recursive: true });
  }
}

function sanitizeReason(reason = "manual") {
  return String(reason)
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .slice(0, 48);
}

function copyFileIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, dest);
  return true;
}

function copyDirIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;

  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);

    if (entry.isDirectory()) {
      copyDirIfExists(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  return true;
}

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

function isResolvedStatus(status = "") {
  return ["win", "loss", "push"].includes(String(status || "").toLowerCase());
}

function mergeTrackedProps(existing = [], incoming = [], { preserveGrades = true } = {}) {
  const index = new Map();

  existing.forEach((item, i) => {
    const key = item.trackedKey || item.trackedId;
    if (key) index.set(key, i);
  });

  const merged = [...existing];

  for (const item of incoming) {
    const key = item.trackedKey || item.trackedId;
    if (!key) {
      merged.push(item);
      continue;
    }

    const existingIndex = index.get(key);

    if (existingIndex === undefined) {
      index.set(key, merged.length);
      merged.push(item);
      continue;
    }

    const prev = merged[existingIndex];

    if (preserveGrades && isResolvedStatus(prev.status)) {
      merged[existingIndex] = {
        ...item,
        ...prev,
        status: prev.status,
        actualStat: prev.actualStat,
        result: prev.result,
        resultMargin: prev.resultMargin,
        gradedAt: prev.gradedAt,
        resolvedAt: prev.resolvedAt,
        pendingReason: prev.pendingReason,
        currentEngineResult: prev.currentEngineResult,
        fairLineShadowResult: prev.fairLineShadowResult,
        sideComparison: prev.sideComparison,
      };
    } else {
      merged[existingIndex] = { ...prev, ...item };
    }
  }

  return merged;
}

export function listBackups() {
  ensureBackupsDir();

  return fs
    .readdirSync(BACKUPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const manifestPath = path.join(BACKUPS_DIR, entry.name, "manifest.json");
      const manifest = readJSON(manifestPath, { backupId: entry.name });
      return {
        backupId: entry.name,
        ...manifest,
      };
    })
    .sort((a, b) =>
      String(b.createdAt || b.backupId).localeCompare(String(a.createdAt || a.backupId))
    );
}

export function getLastBackup() {
  const backups = listBackups();
  return backups[0] || lastBackupMeta || null;
}

export function createBackup(reason = "manual") {
  ensureBackupsDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupId = `${timestamp}-${sanitizeReason(reason)}`;
  const backupDir = path.join(BACKUPS_DIR, backupId);

  if (fs.existsSync(backupDir)) {
    throw new Error(`Backup already exists: ${backupId}`);
  }

  fs.mkdirSync(backupDir, { recursive: true });

  const copied = { files: [], dirs: [] };

  for (const { name, src } of BACKUP_FILES) {
    const dest = path.join(backupDir, name);
    if (copyFileIfExists(src, dest)) {
      copied.files.push(name);
    }
  }

  for (const { name, src } of BACKUP_DIRS) {
    const dest = path.join(backupDir, name);
    if (copyDirIfExists(src, dest)) {
      copied.dirs.push(name);
    }
  }

  const manifest = {
    backupId,
    reason: sanitizeReason(reason),
    createdAt: new Date().toISOString(),
    copied,
  };

  writeJSON(path.join(backupDir, "manifest.json"), manifest);
  lastBackupMeta = manifest;

  return manifest;
}

export function restoreFromBackup(backupId, options = {}) {
  const { merge = true, preserveGrades = true } = options;
  const id = String(backupId || "");

  if (!id) {
    return { ok: false, message: "Missing backupId" };
  }

  const backupDir = path.join(BACKUPS_DIR, id);

  if (!fs.existsSync(backupDir)) {
    return { ok: false, message: `Backup not found: ${id}` };
  }

  const restored = { files: [], dirs: [] };

  for (const { name, src } of BACKUP_FILES) {
    const from = path.join(backupDir, name);
    if (!fs.existsSync(from)) continue;

    if (merge && name === "tracked-props.json" && fs.existsSync(src)) {
      const existing = readJSON(src, []);
      const incoming = readJSON(from, []);
      writeJSON(src, mergeTrackedProps(existing, incoming, { preserveGrades }));
    } else if (merge && name === "pick-history.json" && fs.existsSync(src)) {
      const existing = readJSON(src, []);
      const incoming = readJSON(from, []);
      const keys = new Set(existing.map((p) => p.pickKey || p.id));
      const merged = [
        ...existing,
        ...incoming.filter((p) => !keys.has(p.pickKey || p.id)),
      ];
      writeJSON(src, merged);
    } else {
      copyFileIfExists(from, src);
    }

    restored.files.push(name);
  }

  for (const { name, src } of BACKUP_DIRS) {
    const from = path.join(backupDir, name);
    if (!copyDirIfExists(from, src)) continue;
    restored.dirs.push(name);
  }

  return {
    ok: true,
    message: `Restored from backup ${id}`,
    backupId: id,
    restored,
    merge,
    preserveGrades,
  };
}
