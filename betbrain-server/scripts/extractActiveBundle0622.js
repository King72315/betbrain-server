import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const backupDir = path.join(
  ROOT,
  "safe-backups/pre-wnba-v1-engine-fix-2026-06-22T07-35-55-785Z"
);
const bundleDir = path.join(ROOT, "active-bundles/2026-06-22");

fs.mkdirSync(bundleDir, { recursive: true });

const tracked = JSON.parse(
  fs.readFileSync(path.join(backupDir, "tracked-props.json"), "utf8")
);
const props = (tracked.props || tracked).filter(
  (p) => p.slateDate === "2026-06-22"
);
fs.writeFileSync(
  path.join(bundleDir, "tracked-props.json"),
  JSON.stringify({ slateDate: "2026-06-22", propCount: props.length, props }, null, 2)
);

const locked = {
  slateDate: "2026-06-22",
  phase: "ACTIVE",
  lockedAt: "2026-06-22T07:38:45.597Z",
  lockReason: "auto_results_track",
  autoLocked: true,
  propCount: props.length,
  snapshotFile: "slate-snapshots/2026-06-22.json",
};

fs.writeFileSync(path.join(bundleDir, "locked-slate-entry.json"), JSON.stringify(locked, null, 2));
fs.writeFileSync(
  path.join(bundleDir, "slate-snapshot.json"),
  JSON.stringify(
    {
      ...locked,
      props,
    },
    null,
    2
  )
);

const manifest = {
  slateDate: "2026-06-22",
  phase: "ACTIVE",
  expectedPropCount: 13,
  actual: {
    propCount: props.length,
    locked: props.filter((p) => p.slateLocked).length,
    pending: props.filter(
      (p) => !["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
    ).length,
  },
  sourceBackup: "safe-backups/pre-wnba-v1-engine-fix-2026-06-22T07-35-55-785Z",
};

fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
