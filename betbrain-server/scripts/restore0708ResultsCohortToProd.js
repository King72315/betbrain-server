/**
 * Restore 2026-07-08 Results cohort to production.
 *
 * Usage:
 *   node betbrain-server/scripts/restore0708ResultsCohortToProd.js
 *   ADMIN_SECRET=... node betbrain-server/scripts/restore0708ResultsCohortToProd.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const SLATE_DATE = "2026-07-08";
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();
const BUNDLE_FILE = path.join(
  ROOT,
  "active-bundles",
  SLATE_DATE,
  "tracked-props.json"
);

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { preview: text.slice(0, 400) };
  }
  return { status: res.status, ok: res.ok, data };
}

function summarize0708(tracked = {}) {
  const props = (tracked.props || []).filter((p) => p.slateDate === SLATE_DATE);
  const graded = props.filter((p) =>
    ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
  );
  const pending = props.filter(
    (p) => String(p.status || "pending").toLowerCase() === "pending"
  );
  return {
    count: props.length,
    graded: graded.length,
    pending: pending.length,
    players: props.map((p) => ({
      player: p.player,
      status: p.status || "pending",
    })),
    activeResultsSlateDate: tracked.activeResultsSlateDate || null,
  };
}

async function verify(label) {
  const [tracked, diag, locked] = await Promise.all([
    fetchJson(`${SOURCE}/tracked-props`),
    fetchJson(`${SOURCE}/diagnostics`),
    fetchJson(`${SOURCE}/slates/locked`),
  ]);
  return {
    label,
    tracked: summarize0708(tracked.data),
    diagnostics: {
      activeResultsSlateDate:
        diag.data?.courtEdgeFlow?.activeResultsSlateDate ||
        diag.data?.activeResultsSlateDate ||
        null,
      total: diag.data?.propCounts?.total ?? null,
      bySlate: diag.data?.propCounts?.bySlate ?? null,
    },
    lockedSlates: locked.data?.slates || locked.data || [],
  };
}

async function main() {
  const props = JSON.parse(fs.readFileSync(BUNDLE_FILE, "utf8"));
  if (!Array.isArray(props) || props.length !== 5) {
    throw new Error(`Bundle must contain exactly 5 props, got ${props?.length}`);
  }

  console.log("=== BEFORE ===");
  console.log(JSON.stringify(await verify("before"), null, 2));

  if (!ADMIN_SECRET) {
    console.error(
      "ADMIN_SECRET missing. Set Render env ADMIN_SECRET locally to restore via /admin/restore-official-slate."
    );
    process.exit(2);
  }

  const restore = await fetchJson(`${SOURCE}/admin/restore-official-slate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-secret": ADMIN_SECRET,
    },
    body: JSON.stringify({
      confirm: true,
      slateDate: SLATE_DATE,
      props,
      reason: "auto_results_track",
      lock: true,
      source: "restore0708_results_cohort_prod",
    }),
  });

  console.log("=== RESTORE ===");
  console.log(JSON.stringify({ status: restore.status, data: restore.data }, null, 2));
  if (!restore.ok || !restore.data?.ok) {
    process.exit(1);
  }

  const resolve = await fetchJson(`${SOURCE}/resolve-tracked-props`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });

  console.log("=== RESOLVE ===");
  console.log(JSON.stringify({ status: resolve.status, data: resolve.data }, null, 2));

  console.log("=== AFTER ===");
  console.log(JSON.stringify(await verify("after"), null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
