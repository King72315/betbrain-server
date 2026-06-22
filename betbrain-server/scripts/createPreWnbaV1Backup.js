/**
 * STEP 0 — fetch prod endpoints and write safe-backups/pre-wnba-v1-engine-fix-<ts>/
 * Usage: node betbrain-server/scripts/createPreWnbaV1Backup.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCE = "https://betbrain-server-1.onrender.com";
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const backupDir = path.join(ROOT, "safe-backups", `pre-wnba-v1-engine-fix-${ts}`);

const ENDPOINTS = [
  { name: "tracked-props", path: "/tracked-props" },
  { name: "daily-slate-reports", path: "/daily-slate-reports" },
  { name: "history-archives", path: "/history-archives" },
  { name: "locked-slates", path: "/locked-slates" },
  { name: "diagnostics", path: "/diagnostics" },
  { name: "history-archive-2026-06-21", path: "/history-archive/2026-06-21" },
];

async function fetchJson(endpoint) {
  const res = await fetch(`${SOURCE}${endpoint}`);
  const text = await res.text();
  try {
    return { status: res.status, ok: res.ok, data: JSON.parse(text) };
  } catch {
    return { status: res.status, ok: false, data: { preview: text.slice(0, 200) } };
  }
}

function summarizeLab(reports = []) {
  const lab = reports.find((r) => String(r.slateDate) === "2026-06-21");
  if (!lab) return { found: false };
  const props = lab.props || lab.trackedProps || [];
  const graded = props.filter((p) =>
    ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
  );
  const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
  const losses = graded.filter((p) => String(p.status).toLowerCase() === "loss").length;
  const pushes = graded.filter((p) => String(p.status).toLowerCase() === "push").length;
  return {
    found: true,
    slateDate: lab.slateDate,
    propCount: props.length,
    graded: graded.length,
    record: `${wins}-${losses}-${pushes}`,
    reportStatus: lab.reportStatus || lab.status,
    slateType: lab.slateType || lab.bucket,
  };
}

function summarizeActive0622(tracked = {}) {
  const props = tracked.props || [];
  const slate = props.filter((p) => String(p.slateDate) === "2026-06-22");
  return {
    propCount: slate.length,
    locked: slate.filter((p) => p.slateLocked).length,
    homeStaged: slate.filter((p) => p.homeStaged).length,
    pending: slate.filter(
      (p) => !["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
    ).length,
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

  const tracked = manifest.endpoints["tracked-props"]?.ok
    ? JSON.parse(fs.readFileSync(path.join(backupDir, "tracked-props.json"), "utf8"))
    : {};
  const reports = manifest.endpoints["daily-slate-reports"]?.ok
    ? JSON.parse(fs.readFileSync(path.join(backupDir, "daily-slate-reports.json"), "utf8"))
    : {};
  const reportList = reports.reports || reports || [];
  const trackedProps = tracked.props || [];

  const labFromTracked = (() => {
    const props = trackedProps.filter((p) => String(p.slateDate) === "2026-06-21");
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
  })();

  const lab = summarizeLab(Array.isArray(reportList) ? reportList : []);
  const active0622 = summarizeActive0622(tracked);

  manifest.verification = {
    lab0621: { ...lab, tracked: labFromTracked },
    active0622,
    step0Pass:
      labFromTracked.propCount === 14 &&
      labFromTracked.graded === 14 &&
      labFromTracked.record === "5-9-0" &&
      String(lab.reportStatus || "final").toUpperCase().includes("FINAL") &&
      active0622.propCount >= 0,
  };

  fs.writeFileSync(
    path.join(backupDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  const md = `# Pre WNBA v1 engine fix backup

- **Captured:** ${manifest.capturedAt}
- **Source:** ${SOURCE}
- **Lab 06/21:** ${lab.found ? `${lab.propCount} props, ${lab.record}, ${lab.reportStatus}` : "NOT FOUND"}
- **06/22 active:** ${active0622.propCount} props (${active0622.locked} locked, ${active0622.pending} pending)
- **step0Pass:** ${manifest.verification.step0Pass}
`;

  fs.writeFileSync(path.join(backupDir, "manifest.md"), md);
  console.log(JSON.stringify({ backupDir, ...manifest.verification }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
