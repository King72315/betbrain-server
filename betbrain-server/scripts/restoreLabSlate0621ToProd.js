/**
 * Merge-restore 06/21 completed Lab slate to production.
 * Usage:
 *   node betbrain-server/scripts/restoreLabSlate0621ToProd.js
 *   ADMIN_SECRET=... node betbrain-server/scripts/restoreLabSlate0621ToProd.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const SLATE_DATE = "2026-06-21";
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { preview: text.slice(0, 300) };
  }
  return { status: res.status, ok: res.ok, data };
}

function summarizeProd(tracked = {}, reports = {}, archives = {}) {
  const props = tracked.props || [];
  const d21 = props.filter((p) => p.slateDate === SLATE_DATE);
  const d22 = props.filter((p) => p.slateDate === "2026-06-22");
  const graded = d21.filter((p) =>
    ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
  );
  const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
  const losses = graded.filter((p) => String(p.status).toLowerCase() === "loss").length;
  const pushes = graded.filter((p) => String(p.status).toLowerCase() === "push").length;
  const reportList = reports.reports || reports || [];
  const report = Array.isArray(reportList)
    ? reportList.find((r) => r.slateDate === SLATE_DATE)
    : null;

  return {
    tracked0621: d21.length,
    tracked0622: d22.length,
    graded0621: graded.length,
    record0621: `${wins}-${losses}-${pushes}`,
    reportFound: Boolean(report),
    reportProps:
      report?.sections?.A?.totalOfficialProps ??
      (Array.isArray(report?.props) ? report.props.length : 0),
    reportStatus: report?.reportStatus || report?.status || null,
    archiveCount: archives.count ?? (archives.archives || []).length,
    archive0621Props: archives.archive?.propCount ?? archives.props?.length ?? 0,
  };
}

async function verifyProd(label) {
  const [tracked, reports, archives, archiveDate] = await Promise.all([
    fetchJson(`${SOURCE}/tracked-props`),
    fetchJson(`${SOURCE}/daily-slate-reports`),
    fetchJson(`${SOURCE}/history-archives`),
    fetchJson(`${SOURCE}/history-archive/${SLATE_DATE}`),
  ]);

  const summary = summarizeProd(tracked.data, reports.data, {
    ...archives.data,
    archive: archiveDate.ok ? archiveDate.data?.archive || archiveDate.data : null,
  });

  return {
    label,
    trackedStatus: tracked.status,
    reportsStatus: reports.status,
    archivesStatus: archives.status,
    archiveDateStatus: archiveDate.status,
    summary,
  };
}

async function restoreViaAdmin(props) {
  const headers = {
    "Content-Type": "application/json",
    ...(ADMIN_SECRET ? { "x-admin-secret": ADMIN_SECRET } : {}),
  };

  const labRestore = await fetchJson(`${SOURCE}/admin/restore-official-slate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      slateDate: SLATE_DATE,
      confirm: true,
      mode: "lab",
      source: "restoreLabSlate0621ToProd.js",
    }),
  });

  if (labRestore.ok) {
    return { method: "admin_lab_mode", result: labRestore.data };
  }

  if (!props?.length) {
    return { method: "admin_lab_mode", error: labRestore.data };
  }

  const propRestore = await fetchJson(`${SOURCE}/admin/restore-official-slate`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      slateDate: SLATE_DATE,
      confirm: true,
      mode: "official",
      lock: false,
      props,
      source: "restoreLabSlate0621ToProd.js_props_fallback",
      reason: "lab_merge_restore",
    }),
  });

  return { method: "admin_props_fallback", result: propRestore.data, status: propRestore.status };
}

async function main() {
  const bundlePath = path.join(ROOT, "lab-bundles/2026-06-21/tracked-props.json");
  const bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8"));
  const props = bundle.props || [];

  const before = await verifyProd("before");
  console.log("BEFORE", JSON.stringify(before, null, 2));

  const restore = await restoreViaAdmin(props);
  console.log("RESTORE", JSON.stringify(restore, null, 2));

  const after = await verifyProd("after");
  console.log("AFTER", JSON.stringify(after, null, 2));

  const pass =
    after.summary.tracked0621 === 14 &&
    after.summary.graded0621 === 14 &&
    after.summary.record0621 === "5-9-0" &&
    after.summary.tracked0622 === before.summary.tracked0622 &&
    after.summary.reportProps > 0 &&
    (after.archiveDateStatus === 200 || after.summary.archive0621Props === 14);

  console.log(
    JSON.stringify(
      {
        ok: pass,
        message: pass
          ? "06/21 Lab restore verified on production"
          : "06/21 Lab restore incomplete — deploy lab-bundle startup protection or set ADMIN_SECRET",
        before: before.summary,
        after: after.summary,
        restore,
      },
      null,
      2
    )
  );

  process.exit(pass ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
