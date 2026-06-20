/**
 * CourtEdge full prop flow validation against a running API.
 * Run: node betbrain-server/scripts/validateCourtEdgeFlow.js [baseUrl] [league]
 * Example: node betbrain-server/scripts/validateCourtEdgeFlow.js http://localhost:3000 WNBA
 */
const BASE_URL = process.argv[2] || process.env.API_URL || "https://betbrain-server-1.onrender.com";
const LEAGUE = (process.argv[3] || "WNBA").toUpperCase();

async function fetchJson(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`${path} failed (${res.status}): ${data.message || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function fetchJsonOptional(path, options = {}) {
  try {
    return await fetchJson(path, options);
  } catch (error) {
    if (error.status === 404) return null;
    throw error;
  }
}

function getSlateDateCT(commenceTime) {
  if (!commenceTime) return "";
  const parsed = new Date(commenceTime);
  if (Number.isNaN(parsed.getTime())) return String(commenceTime).slice(0, 10);
  return parsed.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

function stableKey(pick) {
  const clean = (v = "") =>
    String(v)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");
  const side = String(pick.side || pick.pick || "").toLowerCase();
  const normSide = side === "over" || side === "o" ? "over" : side === "under" || side === "u" ? "under" : "";
  return [
    pick.slateDate || getSlateDateCT(pick.commenceTime || pick.time),
    pick.league || "",
    pick.player || "",
    pick.team || "",
    pick.opponent || "",
    pick.stat || "Points",
    normSide,
  ]
    .map(clean)
    .join("-");
}

function countDupes(props) {
  const seen = new Map();
  let duplicates = 0;
  for (const prop of props) {
    const key = prop.trackedKey || prop.trackedId || stableKey(prop);
    if (seen.has(key)) duplicates += 1;
    else seen.set(key, 1);
  }
  return { total: props.length, unique: seen.size, duplicates };
}

function filterLeague(props) {
  return props.filter((p) => String(p.league || "").toUpperCase() === LEAGUE);
}

function summarize(label, data) {
  console.log(`\n--- ${label} ---`);
  for (const [key, value] of Object.entries(data)) {
    console.log(`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
  }
}

async function main() {
  console.log(`CourtEdge flow validation → ${BASE_URL} (${LEAGUE})`);

  const refresh1 = await fetchJson("/refresh-picks", { method: "POST" });
  const games = refresh1.games || [];
  const generated = (refresh1.generatedProps || []).filter(
    (p) => String(p.league || "").toUpperCase() === LEAGUE
  );
  const topProps = (refresh1.topProps || []).filter(
    (p) => String(p.league || "").toUpperCase() === LEAGUE
  );
  const boardCount = games
    .filter((g) => g.league === LEAGUE)
    .reduce((sum, g) => sum + (g.picks?.length || 0), 0);

  const tracked1 = await fetchJson("/tracked-props");
  const trackedLeague = filterLeague(tracked1.props || []);
  const dupes1 = countDupes(trackedLeague);

  const topKeys = new Set(topProps.map(stableKey));
  const trackedKeys1 = new Set(
    trackedLeague.map((p) => p.trackedKey || p.trackedId || stableKey(p))
  );
  const missingTop1 = [...topKeys].filter((k) => !trackedKeys1.has(k));

  const refresh2 = await fetchJson("/refresh-picks", { method: "POST" });
  const tracked2 = await fetchJson("/tracked-props");
  const trackedLeague2 = filterLeague(tracked2.props || []);
  const dupes2 = countDupes(trackedLeague2);

  const shrink = trackedLeague2.length < trackedLeague.length;
  const grewDupes = dupes2.duplicates > dupes1.duplicates;

  const grade1 = await fetchJson("/resolve-tracked-props", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requireLikelyFinished: false }),
  });
  const grade2 = await fetchJson("/resolve-tracked-props", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requireLikelyFinished: false }),
  });

  const gradedAfterFirst = grade1.summary?.gradedCount ?? 0;
  const gradedDelta = (grade2.summary?.gradedCount ?? 0) - gradedAfterFirst;
  const doubleGrade = gradedDelta > 0;

  const reports = await fetchJson("/daily-slate-reports");
  const todaySlates = [
    ...new Set(trackedLeague2.map((p) => p.slateDate).filter(Boolean)),
  ].sort();
  const focusSlate = todaySlates[todaySlates.length - 1] || null;
  const slateTracked = focusSlate
    ? trackedLeague2.filter((p) => p.slateDate === focusSlate)
    : trackedLeague2;
  const labReport = focusSlate
    ? (reports.reports || []).find((r) => String(r.slateDate) === focusSlate)
    : null;
  const labCount = labReport?.sections?.A?.totalOfficialProps ?? null;

  const archives = await fetchJsonOptional("/history-archives");
  const archive = focusSlate
    ? (archives?.archives || []).find((a) => String(a.slateDate) === focusSlate)
    : null;
  const historyCount = archive?.props?.length ?? null;

  const diagnostics = await fetchJsonOptional(
    `/diagnostics?league=${LEAGUE}${focusSlate ? `&slateDate=${focusSlate}` : ""}`
  );
  const flow = diagnostics?.flowValidation || {};

  const pass =
    refresh1.trackingMode === "ALL_GENERATED_PROPS" &&
    missingTop1.length === 0 &&
    !shrink &&
    !grewDupes &&
    !doubleGrade &&
    dupes2.duplicates === 0 &&
    (labCount === null || labCount === slateTracked.length) &&
    (historyCount === null || historyCount === slateTracked.length || historyCount >= slateTracked.length);

  summarize("COURTEDGE FULL FLOW VALIDATION", {
    GeneratedProps: generated.length,
    BoardProps: boardCount,
    TopProps: topProps.length,
    TrackedResults: trackedLeague2.length,
    FocusSlate: focusSlate,
    SlateTracked: slateTracked.length,
    duplicateStableKeys: dupes2.duplicates,
    topPropsMissingFromResults: missingTop1.length,
    refreshShrink: shrink,
    refreshDuplicateGrowth: grewDupes,
    doubleGradeOnSecondResolve: doubleGrade,
    LabPropCount: labCount,
    HistoryPropCount: historyCount,
    tierCounts: refresh1.filterAudit?.tierDistribution || flow.tierCounts,
    trackingMode: refresh1.trackingMode,
    serverFlowValidation: flow,
    FinalFlowVerdict: pass ? "PASS" : "FAIL",
  });

  if (!pass) process.exitCode = 1;
}

main().catch((error) => {
  console.error("Validation failed:", error.message);
  process.exitCode = 1;
});
