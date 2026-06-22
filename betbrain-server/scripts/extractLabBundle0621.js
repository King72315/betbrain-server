import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const backupDir = path.join(
  ROOT,
  "safe-backups/pre-wnba-v1-engine-fix-2026-06-22T07-35-55-785Z"
);
const bundleDir = path.join(ROOT, "lab-bundles/2026-06-21");

fs.mkdirSync(bundleDir, { recursive: true });

const tracked = JSON.parse(
  fs.readFileSync(path.join(backupDir, "tracked-props.json"), "utf8")
);
const props = (tracked.props || tracked).filter(
  (p) => p.slateDate === "2026-06-21"
);
fs.writeFileSync(
  path.join(bundleDir, "tracked-props.json"),
  JSON.stringify({ slateDate: "2026-06-21", propCount: props.length, props }, null, 2)
);

const reports = JSON.parse(
  fs.readFileSync(path.join(backupDir, "daily-slate-reports.json"), "utf8")
);
const report = (reports.reports || reports).find((r) => r.slateDate === "2026-06-21");
fs.writeFileSync(
  path.join(bundleDir, "daily-slate-report.json"),
  JSON.stringify(report, null, 2)
);

const histSrc = path.join(ROOT, "history-archive/2026-06-21.json");
if (fs.existsSync(histSrc)) {
  fs.copyFileSync(histSrc, path.join(bundleDir, "history-archive.json"));
}

const snapSrc = path.join(
  ROOT,
  "safe-backups/pre-wnba-engine-recalibration-2026-06-22T01-18-48-695Z/slate-snapshot-2026-06-21.json"
);
if (fs.existsSync(snapSrc)) {
  fs.copyFileSync(snapSrc, path.join(bundleDir, "slate-snapshot.json"));
}

const locked = JSON.parse(fs.readFileSync(path.join(ROOT, "locked-slates.json"), "utf8"));
const entry = (locked.slates || []).find((s) => s.slateDate === "2026-06-21");
if (entry) {
  fs.writeFileSync(
    path.join(bundleDir, "locked-slate-entry.json"),
    JSON.stringify(entry, null, 2)
  );
}

const graded = props.filter((p) =>
  ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
);
const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
const losses = graded.filter((p) => String(p.status).toLowerCase() === "loss").length;
const pushes = graded.filter((p) => String(p.status).toLowerCase() === "push").length;

const manifest = {
  slateDate: "2026-06-21",
  phase: "LAB",
  expectedPropCount: 14,
  expectedRecord: "5-9-0",
  expectedGraded: 14,
  actual: {
    propCount: props.length,
    graded: graded.length,
    record: `${wins}-${losses}-${pushes}`,
  },
  files: [
    "tracked-props.json",
    "daily-slate-report.json",
    "history-archive.json",
    "slate-snapshot.json",
    "locked-slate-entry.json",
  ],
  sourceBackup: "safe-backups/pre-wnba-v1-engine-fix-2026-06-22T07-35-55-785Z",
};

fs.writeFileSync(path.join(bundleDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify(manifest, null, 2));
