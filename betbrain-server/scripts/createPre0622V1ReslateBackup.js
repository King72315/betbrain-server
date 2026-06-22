/**
 * STEP 1 — fetch prod state before 06/22 v1 reslate.
 * Usage: node betbrain-server/scripts/createPre0622V1ReslateBackup.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(ROOT, "safe-backups", `pre-0622-v1-reslate-${ts}`);

const ENDPOINTS = [
  { name: "tracked-props", path: "/tracked-props" },
  { name: "locked-slates", path: "/slates/locked" },
  { name: "daily-slate-reports", path: "/daily-slate-reports" },
  { name: "diagnostics", path: "/diagnostics" },
  { name: "top-props", path: "/top-props" },
  { name: "history-archive-2026-06-21", path: "/history-archive/2026-06-21" },
];

async function fetchJson(endpoint, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${SOURCE}${endpoint}`, { signal: controller.signal });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { preview: text.slice(0, 300) };
    }
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

function summarize0621(tracked = {}) {
  const props = (tracked.props || tracked).filter((p) => p.slateDate === "2026-06-21");
  const graded = props.filter((p) =>
    ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
  );
  const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
  const losses = graded.filter((p) => String(p.status).toLowerCase() === "loss").length;
  const pushes = graded.filter((p) => String(p.status).toLowerCase() === "push").length;
  return {
    propCount: props.length,
    graded: graded.length,
    record: `${wins}-${losses}-${pushes}`,
  };
}

function summarize0622(tracked = {}) {
  const props = (tracked.props || tracked).filter((p) => p.slateDate === "2026-06-22");
  const commenceTimes = [
    ...new Set(props.map((p) => p.commenceTime).filter(Boolean)),
  ].sort();
  return {
    propCount: props.length,
    locked: props.filter((p) => p.slateLocked).length,
    pending: props.filter(
      (p) => !["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
    ).length,
    commenceTimes,
  };
}

async function main() {
  fs.mkdirSync(backupDir, { recursive: true });

  const manifest = {
    capturedAt: new Date().toISOString(),
    source: SOURCE,
    endpoints: {},
    verification: {},
  };

  for (const ep of ENDPOINTS) {
    const result = await fetchJson(ep.path);
    const outFile = path.join(backupDir, `${ep.name}.json`);
    fs.writeFileSync(outFile, JSON.stringify(result.data, null, 2));
    manifest.endpoints[ep.name] = {
      path: ep.path,
      status: result.status,
      ok: result.ok,
      file: path.basename(outFile),
    };
  }

  const tracked = JSON.parse(
    fs.readFileSync(path.join(backupDir, "tracked-props.json"), "utf8")
  );
  const reports = JSON.parse(
    fs.readFileSync(path.join(backupDir, "daily-slate-reports.json"), "utf8")
  );
  const reportList = reports.reports || reports || [];
  const lab = Array.isArray(reportList)
    ? reportList.find((r) => String(r.slateDate) === "2026-06-21")
    : null;
  const lab0621 = summarize0621(tracked);
  const active0622 = summarize0622(tracked);

  manifest.verification = {
    lab0621: {
      ...lab0621,
      reportStatus: lab?.reportStatus || lab?.status || null,
      reportFound: Boolean(lab),
    },
    active0622,
    step1Pass:
      lab0621.propCount === 14 &&
      lab0621.graded === 14 &&
      lab0621.record === "5-9-0" &&
      String(lab?.reportStatus || lab?.status || "final")
        .toLowerCase()
        .includes("final"),
  };

  fs.writeFileSync(path.join(backupDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(
    path.join(backupDir, "manifest.md"),
    `# Pre 06/22 v1 reslate backup

- **Captured:** ${manifest.capturedAt}
- **Source:** ${SOURCE}
- **Lab 06/21:** ${lab0621.propCount} props, ${lab0621.record}, ${lab?.reportStatus || lab?.status || "?"}
- **06/22 active:** ${active0622.propCount} props (${active0622.locked} locked)
- **step1Pass:** ${manifest.verification.step1Pass}
`
  );

  const snapshotSrc = path.join(ROOT, "slate-snapshots/2026-06-22.json");
  if (fs.existsSync(snapshotSrc)) {
    fs.copyFileSync(snapshotSrc, path.join(backupDir, "slate-snapshot-2026-06-22.json"));
  }

  console.log(JSON.stringify({ backupDir, ...manifest.verification }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
