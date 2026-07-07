/**
 * Retro report: compare live 4.0 vs retro 3.5 Over floor for WNBA_FULL_DATA + stable minutes.
 * Usage: node betbrain-server/scripts/buildFullDataOverFloorRetroReport.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveWnbaGapFloors } from "../engines/wnba/wnbaGraduatedDataModeV1.js";
import { evaluateWnbaTrackingGateV2 } from "../engines/wnba/wnbaTrackingGateV2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const TRACKED = path.join(ROOT, "tracked-props.json");
const OUT = path.join(ROOT, "COURTEDGE_FULL_DATA_OVER_FLOOR_RETRO_REPORT.md");

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER")) return "OVER";
  if (raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function isEligible(prop = {}) {
  if (String(prop.league || "").toUpperCase() !== "WNBA") return false;
  const side = normalizeSide(prop.side || prop.pick);
  if (side !== "OVER") return false;
  const stat = String(prop.stat || prop.propType || "points").toLowerCase();
  if (!(stat.includes("point") || stat === "pts" || !prop.stat)) return false;
  const dataMode = prop.dataMode || prop.wnbaDataCard?.dataMode || "";
  if (dataMode !== "WNBA_FULL_DATA") return false;
  const vol = String(
    prop.minutesVolatility ||
      prop.wnbaDataCard?.minutesVolatility ||
      prop.volumeProfile?.minutesVolatility ||
      "stable"
  ).toLowerCase();
  if (vol === "volatile" || vol === "unstable") return false;
  return true;
}

function gapFor(prop = {}) {
  const line = num(prop.line ?? prop.sportsbookLine);
  const projection = num(prop.projection ?? prop.wnbaDataCard?.projection?.projection);
  return projection - line;
}

function wouldPassGap(prop, floor) {
  return gapFor(prop) >= floor;
}

function simulateGateDecision(prop, floorScenario) {
  const clone = {
    ...prop,
    wnbaDataCard: {
      ...(prop.wnbaDataCard || {}),
      dataMode: "WNBA_FULL_DATA",
      minutesVolatility: "stable",
    },
    minutesVolatility: "stable",
    dataMode: "WNBA_FULL_DATA",
  };
  const gap = gapFor(clone);
  const floors = resolveWnbaGapFloors(
    { side: "OVER", dataMode: "WNBA_FULL_DATA", volatility: "stable" },
    { scenario: floorScenario === "retro" ? "retro_full_data_stable" : "live" }
  );
  const gapPass = gap >= floors.gapFloor;
  let gate = null;
  try {
    gate = evaluateWnbaTrackingGateV2(clone);
  } catch {
    gate = null;
  }
  const dangerFailures = (gate?.dangerGateCount || 0) >= 4 || (gate?.trackingBlockReasons || []).length > 0;
  return {
    gap,
    gapFloor: floors.gapFloor,
    gapPass,
    gateDecision: gate?.wnbaTrackingDecision || gate?.trackingEligibility || "UNKNOWN",
    dangerFailures,
    wouldTrack: gapPass && gate?.trackingEligibility === "TRACK",
  };
}

function gradeBucket(status = "") {
  const s = String(status || "").toLowerCase();
  if (s === "win") return "win";
  if (s === "loss") return "loss";
  if (s === "push") return "push";
  return "pending";
}

function summarize(rows = []) {
  const graded = rows.filter((r) => r.result !== "pending");
  const wins = graded.filter((r) => r.result === "win").length;
  const losses = graded.filter((r) => r.result === "loss").length;
  const pushes = graded.filter((r) => r.result === "push").length;
  const margins = graded.map((r) => num(r.margin)).filter((m) => m !== 0);
  const avgMargin =
    margins.length > 0
      ? Number((margins.reduce((a, b) => a + b, 0) / margins.length).toFixed(2))
      : null;
  return {
    sample: rows.length,
    graded: graded.length,
    wins,
    losses,
    pushes,
    winRate: graded.length ? Number(((wins / graded.length) * 100).toFixed(1)) : null,
    avgMargin,
    dangerGateFailures: rows.filter((r) => r.dangerFailures).length,
  };
}

const raw = JSON.parse(fs.readFileSync(TRACKED, "utf8"));
const props = Array.isArray(raw) ? raw : raw.props || raw.trackedProps || [];

const eligible = props.filter(isEligible).map((prop) => {
  const live = simulateGateDecision(prop, "live");
  const retro = simulateGateDecision(prop, "retro");
  const result = gradeBucket(prop.status);
  const margin = num(prop.margin ?? prop.resultMargin);
  return {
    player: prop.player,
    line: prop.line,
    gap: Number(gapFor(prop).toFixed(2)),
    result,
    margin,
    liveWouldTrack: live.wouldTrack,
    retroWouldTrack: retro.wouldTrack,
    newlyQualifying: !live.wouldTrack && retro.wouldTrack,
    dangerFailures: live.dangerFailures || retro.dangerFailures,
  };
});

const sample = eligible.length;
const newlyQualifying = eligible.filter((r) => r.newlyQualifying);
const liveTrack = eligible.filter((r) => r.liveWouldTrack);
const retroTrack = eligible.filter((r) => r.retroWouldTrack);

const liveSummary = summarize(liveTrack);
const retroSummary = summarize(retroTrack);
const newSummary = summarize(newlyQualifying);

const md = `# CourtEdge FULL_DATA Over Floor Retro Report

**Generated:** ${new Date().toISOString()}  
**SERVER_BUILD:** courteedge-trust-accuracy-engine-v2  
**Scope:** WNBA point Overs with \`WNBA_FULL_DATA\` + stable minutes only  
**Live floor:** 4.0 (unchanged)  
**Retro candidate floor:** 3.5 (report-only)

## Summary

| Metric | Live 4.0 TRACK-eligible | Retro 3.5 TRACK-eligible | Newly qualifying (retro only) |
|--------|-------------------------|----------------------------|-------------------------------|
| Sample size | ${liveSummary.sample} | ${retroSummary.sample} | ${newSummary.sample} |
| Graded W/L/P | ${liveSummary.wins}/${liveSummary.losses}/${liveSummary.pushes} | ${retroSummary.wins}/${retroSummary.losses}/${retroSummary.pushes} | ${newSummary.wins}/${newSummary.losses}/${newSummary.pushes} |
| Win rate | ${liveSummary.winRate ?? "n/a"}% | ${retroSummary.winRate ?? "n/a"}% | ${newSummary.winRate ?? "n/a"}% |
| Avg margin | ${liveSummary.avgMargin ?? "n/a"} | ${retroSummary.avgMargin ?? "n/a"} | ${newSummary.avgMargin ?? "n/a"} |
| Danger-gate failures | ${liveSummary.dangerGateFailures} | ${retroSummary.dangerGateFailures} | ${newSummary.dangerGateFailures} |

**Eligible pool (FULL+stable Overs):** ${sample} props in tracked history.

## Recommendation

Live production **keeps 4.0** Over gap floor. Retro 3.5 is **not enabled** unless future review approves based on graded outcomes above.

## Newly qualifying props (retro 3.5 only)

${newlyQualifying.length
  ? newlyQualifying
      .slice(0, 40)
      .map(
        (r) =>
          `- ${r.player} O${r.line} gap ${r.gap} → ${r.result.toUpperCase()} margin ${r.margin}`
      )
      .join("\n")
  : "_None in current tracked history._"}

`;

fs.writeFileSync(OUT, md, "utf8");
console.log(`Wrote ${OUT}`);
console.log(
  JSON.stringify(
    {
      sample,
      liveTrack: liveSummary.sample,
      retroTrack: retroSummary.sample,
      newlyQualifying: newSummary.sample,
      liveWinRate: liveSummary.winRate,
      retroWinRate: retroSummary.winRate,
    },
    null,
    2
  )
);
