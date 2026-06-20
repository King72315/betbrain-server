/**
 * CourtEdge clean-data cutoff — removes report/archive/lifecycle data before 2026-06-19.
 * Preserves tracked-props.json active queue unchanged.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const CUTOFF = "2026-06-19";

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

function copyFile(src, dest) {
  fs.copyFileSync(src, dest);
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const s = path.join(src, name);
    const d = path.join(dest, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else copyFile(s, d);
  }
}

function isBeforeCutoff(slateDate) {
  return String(slateDate || "") < CUTOFF;
}

const stats = {
  cutoff: CUTOFF,
  before: {},
  after: {},
  removed: {},
  backups: [],
};

// --- daily-slate-reports.json ---
const reportsFile = path.join(SERVER_ROOT, "daily-slate-reports.json");
const reports = readJSON(reportsFile, []) || [];
stats.before.dailySlateReports = {
  count: reports.length,
  dates: reports.map((r) => r.slateDate).sort(),
};
copyFile(reportsFile, path.join(SERVER_ROOT, "daily-slate-reports-before-clean-data-cutoff.json"));
stats.backups.push("daily-slate-reports-before-clean-data-cutoff.json");

const keptReports = reports.filter((r) => !isBeforeCutoff(r.slateDate));
const removedReports = reports.filter((r) => isBeforeCutoff(r.slateDate));
writeJSON(reportsFile, keptReports);
stats.removed.dailySlateReports = removedReports.map((r) => r.slateDate);
stats.after.dailySlateReports = {
  count: keptReports.length,
  dates: keptReports.map((r) => r.slateDate).sort(),
};

// --- history-archive/ ---
const archiveDir = path.join(SERVER_ROOT, "history-archive");
const archiveBackupDir = path.join(SERVER_ROOT, "history-archive-before-clean-data-cutoff");
if (fs.existsSync(archiveDir)) {
  copyDir(archiveDir, archiveBackupDir);
  stats.backups.push("history-archive-before-clean-data-cutoff/");
  const files = fs.readdirSync(archiveDir).filter((f) => f.endsWith(".json"));
  stats.before.historyArchive = { count: files.length, files: files.sort() };
  const removedArchive = [];
  for (const file of files) {
    const slateDate = file.replace(".json", "");
    if (isBeforeCutoff(slateDate)) {
      fs.unlinkSync(path.join(archiveDir, file));
      removedArchive.push(file);
    }
  }
  stats.removed.historyArchive = removedArchive;
  stats.after.historyArchive = {
    count: fs.readdirSync(archiveDir).filter((f) => f.endsWith(".json")).length,
    files: fs.readdirSync(archiveDir).filter((f) => f.endsWith(".json")).sort(),
  };
} else {
  stats.before.historyArchive = { count: 0, files: [] };
  stats.after.historyArchive = { count: 0, files: [] };
}

// --- locked-slates.json ---
const lockedFile = path.join(SERVER_ROOT, "locked-slates.json");
const locked = readJSON(lockedFile, { slates: [] }) || { slates: [] };
stats.before.lockedSlates = {
  count: (locked.slates || []).length,
  dates: (locked.slates || []).map((s) => `${s.slateDate}/${s.phase}`),
};
copyFile(lockedFile, path.join(SERVER_ROOT, "locked-slates-before-clean-data-cutoff.json"));
stats.backups.push("locked-slates-before-clean-data-cutoff.json");

const keptSlates = (locked.slates || []).filter((s) => !isBeforeCutoff(s.slateDate));
const removedSlates = (locked.slates || []).filter((s) => isBeforeCutoff(s.slateDate));
writeJSON(lockedFile, {
  ...locked,
  slates: keptSlates,
  updatedAt: new Date().toISOString(),
});
stats.removed.lockedSlates = removedSlates.map((s) => `${s.slateDate}/${s.phase}`);
stats.after.lockedSlates = {
  count: keptSlates.length,
  dates: keptSlates.map((s) => `${s.slateDate}/${s.phase}`),
};

// --- slate-snapshots/ (lifecycle) ---
const snapshotsDir = path.join(SERVER_ROOT, "slate-snapshots");
if (fs.existsSync(snapshotsDir)) {
  copyDir(snapshotsDir, path.join(SERVER_ROOT, "slate-snapshots-before-clean-data-cutoff"));
  stats.backups.push("slate-snapshots-before-clean-data-cutoff/");
  const snapFiles = fs.readdirSync(snapshotsDir).filter((f) => f.endsWith(".json"));
  stats.before.slateSnapshots = { count: snapFiles.length, files: snapFiles.sort() };
  const removedSnaps = [];
  for (const file of snapFiles) {
    const slateDate = file.replace(".json", "");
    if (isBeforeCutoff(slateDate)) {
      fs.unlinkSync(path.join(snapshotsDir, file));
      removedSnaps.push(file);
    }
  }
  stats.removed.slateSnapshots = removedSnaps;
  stats.after.slateSnapshots = {
    count: fs.readdirSync(snapshotsDir).filter((f) => f.endsWith(".json")).length,
    files: fs.readdirSync(snapshotsDir).filter((f) => f.endsWith(".json")).sort(),
  };
} else {
  stats.before.slateSnapshots = { count: 0, files: [] };
  stats.after.slateSnapshots = { count: 0, files: [] };
}

// --- tracked-props.json (read-only counts) ---
const trackedFile = path.join(SERVER_ROOT, "tracked-props.json");
const tracked = readJSON(trackedFile, []) || [];
const bySlate = {};
for (const p of tracked) {
  const d = p.slateDate || "unknown";
  bySlate[d] = (bySlate[d] || 0) + 1;
}
stats.trackedProps = { total: tracked.length, bySlateDate: bySlate, modified: false };

console.log(JSON.stringify(stats, null, 2));
