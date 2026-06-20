/**
 * CourtEdge complete flow test (A–I).
 * Run: node betbrain-server/scripts/testCompleteFlow.js [baseUrl]
 * Example: node betbrain-server/scripts/testCompleteFlow.js http://127.0.0.1:3010
 */
const BASE_URL = process.argv[2] || process.env.API_URL || "http://127.0.0.1:3010";
const SIMULATE_GRADE = process.argv.includes("--simulate-grade");

async function fetchJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  const ct = res.headers.get("content-type") || "";
  const isJson = ct.includes("application/json");
  const data = isJson ? await res.json().catch(() => ({})) : null;
  return { ok: res.ok, status: res.status, isJson, data };
}

function countDupes(props = []) {
  const seen = new Map();
  let duplicates = 0;
  for (const prop of props) {
    const key = prop.trackedKey || prop.trackedId || "";
    if (!key) continue;
    if (seen.has(key)) duplicates += 1;
    else seen.set(key, 1);
  }
  return { total: props.length, unique: seen.size, duplicates };
}

function groupBySlate(props = []) {
  const groups = {};
  for (const prop of props) {
    const date = prop.slateDate || "unknown";
    groups[date] = (groups[date] || 0) + 1;
  }
  return groups;
}

function pickFocusSlate(props = []) {
  const groups = new Map();
  for (const prop of props) {
    const date = prop.slateDate;
    if (!date) continue;
    if (!groups.has(date)) groups.set(date, []);
    groups.get(date).push(prop);
  }
  let focus = null;
  for (const [date, slateProps] of groups.entries()) {
    if (!focus || slateProps.length < focus.props.length) {
      focus = { slateDate: date, props: slateProps };
    }
  }
  return focus;
}

async function simulateGradesForSlate(slateDate) {
  const tracked = await fetchJson("/tracked-props");
  const props = (tracked.data?.props || []).map((prop) => {
    if (prop.slateDate !== slateDate) return prop;
    if (["win", "loss", "push"].includes(String(prop.status || "").toLowerCase())) {
      return prop;
    }
    const line = Number(prop.officialLine ?? prop.line ?? 0);
    const side = String(prop.currentEngineSide || prop.side || "").toLowerCase();
    const actual = side === "under" ? line - 1 : line + 1;
    return {
      ...prop,
      status: "win",
      actualStat: actual,
      result: "win",
      resultMargin: Math.abs(actual - line),
      gradedAt: new Date().toISOString(),
      resolvedAt: new Date().toISOString(),
    };
  });

  const res = await fetch(`${BASE_URL}/test/apply-tracked-props`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ props }),
  }).catch(() => null);

  if (res?.ok) return true;

  // Fallback: direct file write when test endpoint unavailable (local dev only)
  if (BASE_URL.includes("127.0.0.1") || BASE_URL.includes("localhost")) {
    const fs = await import("fs");
    const path = await import("path");
    const { fileURLToPath } = await import("url");
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const file = path.join(__dirname, "..", "tracked-props.json");
    fs.writeFileSync(file, JSON.stringify(props, null, 2));
    return true;
  }

  return false;
}

async function main() {
  const results = {};
  console.log(`CourtEdge complete flow test → ${BASE_URL}\n`);

  const health = await fetchJson("/health");
  results.A_healthJson = health.isJson && health.data?.serverBuild;
  console.log("A health JSON:", results.A_healthJson ? "PASS" : "FAIL", health.data?.serverBuild || health.status);

  const refresh = await fetchJson("/refresh-picks", { method: "POST" });
  results.B_refresh = refresh.data?.ok && refresh.data?.trackingMode === "ALL_GENERATED_PROPS";
  console.log(
    "B refresh:",
    results.B_refresh ? "PASS" : "FAIL",
    "generated",
    refresh.data?.generatedPropCount
  );

  const top = await fetchJson("/top-props");
  const wnba = await fetchJson("/picks/WNBA");
  const tracked1 = await fetchJson("/tracked-props");
  const board = (wnba.data?.games || []).reduce((s, g) => s + (g.picks?.length || 0), 0);
  results.C_counts =
    (top.data?.topProps?.length || 0) > 0 &&
    board > 0 &&
    (tracked1.data?.count || 0) > 0;
  console.log(
    "C counts:",
    results.C_counts ? "PASS" : "FAIL",
    `top=${top.data?.topProps?.length || 0} board=${board} tracked=${tracked1.data?.count || 0}`
  );

  await fetchJson("/picks/WNBA");
  const tracked2 = await fetchJson("/tracked-props");
  results.D_cacheHitSync = (tracked2.data?.count || 0) >= (tracked1.data?.count || 0);
  console.log(
    "D cache-hit sync:",
    results.D_cacheHitSync ? "PASS" : "FAIL",
    tracked1.data?.count,
    "→",
    tracked2.data?.count
  );

  const archivesBefore = await fetchJson("/history-archives");
  results.E_historyArchives =
    archivesBefore.isJson && archivesBefore.ok && Array.isArray(archivesBefore.data?.archives);
  console.log(
    "E history-archives:",
    results.E_historyArchives ? "PASS" : "FAIL",
    "count",
    archivesBefore.data?.count ?? 0
  );

  const focus = pickFocusSlate(tracked2.data?.props || []);
  let focusSlate = focus?.slateDate || null;
  let focusCount = focus?.props?.length || 0;

  if (SIMULATE_GRADE && focusSlate) {
    const simulated = await simulateGradesForSlate(focusSlate);
    console.log("F simulate grade:", simulated ? "PASS" : "SKIP", focusSlate, focusCount, "props");
    results.F_simulateGrade = simulated;
  } else {
    results.F_simulateGrade = "skipped";
    console.log("F simulate grade: SKIP (use --simulate-grade)");
  }

  const build = await fetchJson("/daily-slate-reports/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(focusSlate ? { slateDate: focusSlate } : {}),
  });
  results.G_buildReport = build.data?.ok;
  console.log("G build report:", results.G_buildReport ? "PASS" : "FAIL");

  const archivesAfter = await fetchJson("/history-archives");
  const archive =
    focusSlate &&
    (archivesAfter.data?.archives || []).find((a) => a.slateDate === focusSlate);
  const reports = await fetchJson("/daily-slate-reports");
  const report =
    focusSlate &&
    (reports.data?.reports || []).find((r) => r.slateDate === focusSlate);

  results.H_archiveBundle =
    !focusSlate ||
    (archive?.props?.length || 0) === focusCount ||
    (archive?.propCount || 0) === focusCount;
  results.H_reportFinal = report?.reportStatus === "final" || report?.status === "final";
  console.log(
    "H lab/archive bundle:",
    results.H_archiveBundle ? "PASS" : "FAIL",
    "archiveProps",
    archive?.props?.length ?? 0,
    "expected",
    focusCount,
    "report",
    report?.reportStatus || report?.status || "n/a"
  );

  const dupes = countDupes(tracked2.data?.props || []);
  results.I_noDupes = dupes.duplicates === 0;
  console.log("I duplicate keys:", results.I_noDupes ? "PASS" : "FAIL", dupes);

  const pass =
    results.A_healthJson &&
    results.B_refresh &&
    results.C_counts &&
    results.D_cacheHitSync &&
    results.E_historyArchives &&
    results.G_buildReport &&
    results.I_noDupes &&
    (results.F_simulateGrade === "skipped" || results.H_archiveBundle);

  console.log("\n=== END-TO-END VERDICT ===");
  console.log(pass ? "PASS" : "FAIL");
  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Test failed:", error.message);
  process.exitCode = 1;
});
