/** Quick post-reslate endpoint verification */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const ENDPOINTS = [
  "/diagnostics",
  "/tracked-props",
  "/slates/locked",
  "/top-props",
  "/daily-slate-reports",
  "/history-archive/2026-06-21",
  "/history-archives",
  "/picks/WNBA",
];

async function fetchJson(pathname) {
  const res = await fetch(`${SOURCE}${pathname}`);
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: { preview: text.slice(0, 200) } };
  }
}

async function main() {
  const out = { source: SOURCE, checkedAt: new Date().toISOString(), endpoints: {} };
  for (const ep of ENDPOINTS) {
    out.endpoints[ep] = await fetchJson(ep);
  }

  const tracked = out.endpoints["/tracked-props"].data?.props || [];
  const d21 = tracked.filter((p) => p.slateDate === "2026-06-21");
  const d22 = tracked.filter((p) => p.slateDate === "2026-06-22");
  const graded = d21.filter((p) =>
    ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
  );
  const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
  const losses = graded.filter((p) => String(p.status).toLowerCase() === "loss").length;
  const pushes = graded.filter((p) => String(p.status).toLowerCase() === "push").length;

  const top = out.endpoints["/top-props"].data;
  const wnba = top?.topWNBAProps || [];
  const diag = out.endpoints["/diagnostics"].data || {};

  out.summary = {
    lab0621: { count: d21.length, graded: graded.length, record: `${wins}-${losses}-${pushes}` },
    tracked0622: d22.length,
    locked0622: (out.endpoints["/slates/locked"].data?.slates || []).find(
      (s) => s.slateDate === "2026-06-22"
    ),
    activeResultsSlateDate: diag.activeResultsSlateDate,
    activeResultsPropCount: diag.activeResultsPropCount,
    serverBuild: diag.serverBuild,
    topWnbaCount: wnba.length,
    archive21Status: out.endpoints["/history-archive/2026-06-21"].status,
  };

  const file = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "safe-backups",
    `post-reslate-verify-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
  );
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ file, summary: out.summary }, null, 2));
}

main().catch(console.error);
