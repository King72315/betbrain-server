/**
 * CourtEdge 06/22 v1 reslate — prod orchestration.
 * Usage:
 *   node betbrain-server/scripts/reslate0622V1ToProd.js [--dry-run]
 *   ADMIN_SECRET=... node betbrain-server/scripts/reslate0622V1ToProd.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyWnbaOfficialV1Rules,
  evaluateWnbaOfficialEligibility,
} from "../engines/wnbaOfficialEngine.js";
import { anyGameStarted } from "../services/reslate0622V1Service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();
const SLATE_DATE = "2026-06-22";
const dryRun = process.argv.includes("--dry-run");

async function fetchJson(url, options = {}, timeoutMs = 180000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { preview: text.slice(0, 400) };
    }
    return { status: res.status, ok: res.ok, data };
  } finally {
    clearTimeout(timer);
  }
}

function classifyBoard(topProps = []) {
  const wnba = topProps.filter((p) => String(p.league || "").toUpperCase() === "WNBA");
  const rows = wnba.map((pick) => {
    const replayed = applyWnbaOfficialV1Rules(pick);
    const eligibility = evaluateWnbaOfficialEligibility(replayed);
    const tier = String(replayed.tier || "").toUpperCase();
    return {
      player: pick.player,
      side: pick.side || pick.pick,
      line: pick.line,
      tier,
      officialEligible: eligibility.eligible,
      reasons: eligibility.reasons,
    };
  });

  const official = rows.filter((r) => r.officialEligible && r.tier === "PREMIUM");
  const watchlist = rows.filter((r) => r.tier === "WATCHLIST");
  const blocked = rows.filter((r) => r.tier === "LEAN" || !r.officialEligible);

  return {
    total: rows.length,
    official: official.length,
    watchlist: watchlist.length,
    blocked: blocked.length,
    rows,
    officialRows: official,
  };
}

function summarizeProd(tracked = {}, diagnostics = {}) {
  const props = tracked.props || [];
  const d21 = props.filter((p) => p.slateDate === "2026-06-21");
  const d22 = props.filter(
    (p) => p.slateDate === SLATE_DATE && !p.preV1Shadow && !p.excludedFromV1OfficialRecord
  );
  const graded = d21.filter((p) =>
    ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
  );
  const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
  const losses = graded.filter((p) => String(p.status).toLowerCase() === "loss").length;
  const pushes = graded.filter((p) => String(p.status).toLowerCase() === "push").length;

  return {
    tracked0621: d21.length,
    tracked0622Official: d22.length,
    graded0621: graded.length,
    record0621: `${wins}-${losses}-${pushes}`,
    activeResultsSlateDate: diagnostics.activeResultsSlateDate || null,
    activeResultsPropCount: diagnostics.activeResultsPropCount ?? null,
    serverBuild: diagnostics.serverBuild || null,
  };
}

async function verify(label) {
  const [tracked, diagnostics, locked, topProps, reports, archive21] = await Promise.all([
    fetchJson(`${SOURCE}/tracked-props`),
    fetchJson(`${SOURCE}/diagnostics`),
    fetchJson(`${SOURCE}/slates/locked`),
    fetchJson(`${SOURCE}/top-props`),
    fetchJson(`${SOURCE}/daily-slate-reports`),
    fetchJson(`${SOURCE}/history-archive/2026-06-21`),
  ]);

  return {
    label,
    summary: summarizeProd(tracked.data, diagnostics.data),
    locked0622: (locked.data?.slates || []).find((s) => s.slateDate === SLATE_DATE) || null,
    topPropsStatus: topProps.status,
    boardEval: classifyBoard(topProps.data?.topWNBAProps || topProps.data?.topProps || []),
    reportsStatus: reports.status,
    archive21Status: archive21.status,
  };
}

async function runReslate(boardPicks = []) {
  const headers = {
    "Content-Type": "application/json",
    ...(ADMIN_SECRET ? { "x-admin-secret": ADMIN_SECRET } : {}),
  };

  const admin = await fetchJson(`${SOURCE}/admin/reslate-0622-v1`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      confirm: !dryRun,
      dryRun,
      source: "reslate0622V1ToProd.js",
    }),
  });

  if (admin.status === 503 && !ADMIN_SECRET) {
    return {
      method: "admin_unavailable",
      message:
        "ADMIN_SECRET not configured on prod — deploy with COURTEDGE_RESLATE_0622_V1=true or set ADMIN_SECRET locally",
      status: admin.status,
      data: admin.data,
    };
  }

  return { method: "admin_reslate", status: admin.status, ok: admin.ok, data: admin.data };
}

async function main() {
  const before = await verify("before");
  console.log("BEFORE", JSON.stringify(before, null, 2));

  const tracked = await fetchJson(`${SOURCE}/tracked-props`);
  const slateProps = (tracked.data?.props || []).filter((p) => p.slateDate === SLATE_DATE);
  const gameCheck = anyGameStarted(slateProps);
  if (gameCheck.blocked) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          step: 2,
          blocked: true,
          message: "06/22 games started — STOP",
          gameCheck,
        },
        null,
        2
      )
    );
    process.exit(2);
  }

  const topProps = await fetchJson(`${SOURCE}/top-props`);
  const boardEval = classifyBoard(
    topProps.data?.topWNBAProps || topProps.data?.topProps || []
  );
  console.log("BOARD_EVAL", JSON.stringify(boardEval, null, 2));

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          gameCheck,
          boardEval,
          before: before.summary,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  const reslate = await runReslate();
  console.log("RESLATE", JSON.stringify(reslate, null, 2));

  if (reslate.method === "admin_unavailable") {
    process.exit(3);
  }

  const refresh = await fetchJson(`${SOURCE}/refresh-picks`, { method: "POST" });
  console.log("REFRESH", refresh.status, refresh.data?.message || refresh.data?.ok);

  const after = await verify("after");
  console.log("AFTER", JSON.stringify(after, null, 2));

  const pass =
    after.summary.tracked0621 === 14 &&
    after.summary.graded0621 === 14 &&
    after.summary.record0621 === "5-9-0" &&
    after.archive21Status === 200 &&
    (boardEval.official === 0
      ? after.summary.tracked0622Official === 0
      : after.summary.tracked0622Official === boardEval.official);

  console.log(
    JSON.stringify(
      {
        ok: pass,
        gameCheck,
        boardEval,
        before: before.summary,
        after: after.summary,
        reslate,
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
