/**
 * Create non-secret operational backup for pre-full-roster checkpoint.
 * Usage: node scripts/createPreFullRosterCheckpointBackupV1.js
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const STAMP = new Date().toISOString().replace(/[:.]/g, "-");
const BACKUP_DIR = path.join(
  ROOT,
  "backups",
  "courteedge-pre-full-roster-experiment-v1"
);

const SECRET_NAME_RE =
  /(\.env$|credentials|secret|token|apikey|api[_-]?key|password|private)/i;

const SOURCES = [
  { rel: "tracked-props.json", purpose: "Results membership / tracked props" },
  { rel: "three-slate-blocks-v2.json", purpose: "Three-slate lifecycle blocks" },
  { rel: "daily-slate-reports.json", purpose: "Daily slate reports metadata" },
  { rel: "pick-history.json", purpose: "Pick history metadata" },
  { rel: "pick-analytics.json", purpose: "Pick analytics" },
  { rel: "line-snapshots.json", purpose: "Line snapshots" },
  {
    rel: "engines/topProps/courtEdgeFeatureFlagsV1.js",
    purpose: "Feature flag defaults source",
  },
  {
    rel: "COURTEDGE_CLEAR_SIDE_STRONG_EDGE_MEMBERSHIP_PATH_V1_REPORT.md",
    purpose: "Clear-side membership repair report",
  },
  {
    rel: "_dryrun_clear_side_strong_edge_membership_path_v1_aug5.json",
    purpose: "Aug5 membership dry-run baseline",
  },
];

function sha256File(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

function copyFileSafe(srcRel) {
  const src = path.join(ROOT, srcRel);
  if (!fs.existsSync(src)) return null;
  if (SECRET_NAME_RE.test(srcRel)) {
    return { skipped: true, reason: "secret_pattern", srcRel };
  }
  const dest = path.join(BACKUP_DIR, "data", srcRel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  const st = fs.statSync(dest);
  return {
    relativePath: path.join("data", srcRel).replace(/\\/g, "/"),
    sourcePath: srcRel.replace(/\\/g, "/"),
    sizeBytes: st.size,
    sha256: sha256File(dest),
    backupTimestamp: new Date().toISOString(),
  };
}

function copySlateSnapshots() {
  const dir = path.join(ROOT, "slate-snapshots");
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".json")) continue;
    // Skip oversized backups / pre-repair dumps
    if (name.includes("pre-repair") || name.includes(".bak")) continue;
    const srcRel = path.join("slate-snapshots", name);
    const copied = copyFileSafe(srcRel);
    if (copied && !copied.skipped) {
      copied.purpose = `Slate snapshot ${name}`;
      out.push(copied);
    }
  }
  return out;
}

function copyActiveBundlesIndex() {
  const dir = path.join(ROOT, "active-bundles");
  const out = [];
  if (!fs.existsSync(dir)) return out;
  // Only index metadata — skip huge per-player dumps
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      const indexCandidates = ["index.json", "manifest.json", "meta.json", "board.json"];
      for (const f of indexCandidates) {
        const p = path.join(name, f);
        if (fs.existsSync(path.join(dir, p))) {
          const copied = copyFileSafe(path.join("active-bundles", p));
          if (copied && !copied.skipped) {
            copied.purpose = `Active bundle metadata ${name}/${f}`;
            out.push(copied);
          }
        }
      }
      continue;
    }
    if (name.endsWith(".json") && st.size < 2_000_000) {
      const copied = copyFileSafe(path.join("active-bundles", name));
      if (copied && !copied.skipped) {
        copied.purpose = `Active bundle file ${name}`;
        out.push(copied);
      }
    }
  }
  return out;
}

fs.mkdirSync(path.join(BACKUP_DIR, "data"), { recursive: true });

const files = [];
for (const src of SOURCES) {
  const copied = copyFileSafe(src.rel);
  if (!copied) continue;
  if (copied.skipped) {
    files.push({ ...copied, purpose: src.purpose });
    continue;
  }
  files.push({ ...copied, purpose: src.purpose });
}
files.push(...copySlateSnapshots());
files.push(...copyActiveBundlesIndex());

const healthPath = path.join(BACKUP_DIR, "health-snapshot.json");
let health = { note: "health_not_fetched" };
try {
  const res = await fetch("http://127.0.0.1:3000/health");
  health = await res.json();
  // Scrub any accidental secret-looking keys
  delete health.env;
  delete health.secrets;
} catch (err) {
  health = { ok: false, error: String(err?.message || err) };
}
fs.writeFileSync(healthPath, JSON.stringify(health, null, 2));
files.push({
  relativePath: "health-snapshot.json",
  sourcePath: "http://127.0.0.1:3000/health",
  sizeBytes: fs.statSync(healthPath).size,
  sha256: sha256File(healthPath),
  backupTimestamp: new Date().toISOString(),
  purpose: "Local /health snapshot at backup time (may be pre-restart)",
});

const providerBaseline = {
  note: "No new provider calls made during checkpoint. Baseline from last known health/config only.",
  capturedAt: new Date().toISOString(),
  providerPolicy: health.providerPolicy || null,
  cacheMinutes: health.config?.cacheMinutes ?? null,
  paidCreditsThisCheckpoint: 0,
  requestCountThisCheckpoint: 0,
  cacheHits: null,
  cacheMisses: null,
  deduplicatedCalls: null,
  retryCalls: null,
  failedCalls: null,
  refreshDurationMs: null,
  warning:
    "Representative refresh metrics were not re-run to avoid burning credits. Use next scheduled refresh logs for delta comparison after experiment.",
};
const providerPath = path.join(BACKUP_DIR, "provider-credit-baseline.json");
fs.writeFileSync(providerPath, JSON.stringify(providerBaseline, null, 2));
files.push({
  relativePath: "provider-credit-baseline.json",
  sourcePath: "derived",
  sizeBytes: fs.statSync(providerPath).size,
  sha256: sha256File(providerPath),
  backupTimestamp: new Date().toISOString(),
  purpose: "Provider credit baseline (no new paid calls)",
});

const manifest = {
  checkpoint: "courteedge-pre-full-roster-experiment-v1",
  createdAt: new Date().toISOString(),
  timezone: "America/Chicago",
  stamp: STAMP,
  backupDir: "backups/courteedge-pre-full-roster-experiment-v1",
  fileCount: files.filter((f) => !f.skipped).length,
  skippedSecrets: files.filter((f) => f.skipped).length,
  files,
  secretScan: {
    pattern: String(SECRET_NAME_RE),
    envIncluded: false,
    apiKeysIncluded: false,
  },
};

fs.writeFileSync(
  path.join(BACKUP_DIR, "MANIFEST.json"),
  JSON.stringify(manifest, null, 2)
);

// Verify checksums
let checksumOk = true;
for (const f of files) {
  if (f.skipped || !f.relativePath || f.relativePath.startsWith("http")) continue;
  const full = path.join(BACKUP_DIR, f.relativePath);
  if (!fs.existsSync(full)) {
    checksumOk = false;
    f.verify = "MISSING";
    continue;
  }
  const again = sha256File(full);
  f.verify = again === f.sha256 ? "OK" : "MISMATCH";
  if (f.verify !== "OK") checksumOk = false;
}
manifest.checksumVerification = checksumOk ? "PASS" : "FAIL";
fs.writeFileSync(
  path.join(BACKUP_DIR, "MANIFEST.json"),
  JSON.stringify(manifest, null, 2)
);

console.log(
  JSON.stringify(
    {
      backupDir: BACKUP_DIR,
      fileCount: manifest.fileCount,
      checksumVerification: manifest.checksumVerification,
    },
    null,
    2
  )
);
