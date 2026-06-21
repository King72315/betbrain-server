import {
  filterCompletedDailyReports,
  filterValidDailyReports,
  getTodayLocalDate,
  isFutureSlateDate,
} from "../services/slateScopeService.js";

const BASE = "https://betbrain-server-1.onrender.com";

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: `Non-JSON ${res.status} from ${path}`, preview: text.slice(0, 120) };
  }
}

async function run() {
  const today = getTodayLocalDate();
  console.log("todayLocalDate (CT):", today);

  const [tracked, reportsPayload, archivesPayload, analyticsPayload] =
    await Promise.all([
      fetchJson("/tracked-props"),
      fetchJson("/daily-slate-reports"),
      fetchJson("/history-archives"),
      fetchJson("/tracked-props/analytics"),
    ]);

  const props = tracked.props || [];
  const rawReports = reportsPayload.reports || [];
  const validReports = filterValidDailyReports(rawReports, today);
  const completedReports = filterCompletedDailyReports(rawReports, today);

  const todayProps = props.filter((prop) => {
    const slateDate = String(prop.slateDate || "").slice(0, 10);
    return slateDate === today && !isFutureSlateDate(slateDate, today);
  });

  const futureProps = props.filter((prop) =>
    isFutureSlateDate(String(prop.slateDate || "").slice(0, 10), today)
  );

  console.log("\n--- Production scope (read filters applied locally) ---");
  console.log("Tracked props total:", props.length);
  console.log("Today slate props:", todayProps.length);
  console.log("Future slate props:", futureProps.length);
  console.log(
    "Raw reports:",
    rawReports.length,
    rawReports.map((r) => `${r.slateDate}:${r.reportStatus || r.status}`)
  );
  console.log(
    "Valid reports:",
    validReports.length,
    validReports.map((r) => r.slateDate)
  );
  console.log(
    "Completed reports:",
    completedReports.length,
    completedReports.map((r) => r.slateDate)
  );
  console.log("History archives:", (archivesPayload.archives || []).length);
  console.log(
    "Analytics count (production endpoint):",
    analyticsPayload.count,
    "scope:",
    analyticsPayload.scope || "legacy-all-props"
  );
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
