/**
 * Same-snapshot Reader/Gate disagreement audit for July 16 Tomorrow board.
 * Read-only analysis of saved picks JSON (no network, no store mutation).
 *
 * Usage:
 *   node scripts/auditReaderGateMismatch0716.js
 *   node scripts/auditReaderGateMismatch0716.js --after
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { resolveWnbaGapFloors, WNBA_FULL_OVER_GAP_FLOOR, WNBA_LIMITED_OVER_GAP_FLOOR, WNBA_UNDER_GAP_FLOOR } from "../engines/wnba/wnbaGraduatedDataModeV1.js";
import { evaluateWnbaTrackingGateV2 } from "../engines/wnba/wnbaTrackingGateV2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SNAPSHOT = path.join(__dirname, "..", ".tmp-jul16-picks-live.json");

function num(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function normalizeSide(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("OVER")) return "OVER";
  if (raw.startsWith("UNDER")) return "UNDER";
  return "";
}

function projectionGap(pick) {
  const side = normalizeSide(pick.side || pick.pick || pick.currentEngineSide);
  const proj = num(pick.projection ?? pick.wnbaDataCard?.projection?.projection);
  const line = num(pick.line ?? pick.wnbaDataCard?.bookLine);
  if (proj == null || line == null || !side) return null;
  return side === "UNDER" ? line - proj : proj - line;
}

function readerLabel(pick) {
  const reader = pick.wnbaReader || {};
  const codes = reader.reasonCodes || [];
  if (codes.includes("STRONG_READER_CASE")) return "STRONG";
  const side = normalizeSide(pick.side || pick.pick || reader.finalSide);
  const gap = projectionGap(pick);
  if (gap == null) return "UNKNOWN";
  if (gap >= 4) return "STRONG_GAP";
  if (gap >= 3) return "MEANINGFUL";
  if (gap >= 2.5) return "MODERATE_LEGACY";
  if (gap <= 1) return "WEAK";
  return "MIXED";
}

function loadCandidates() {
  let raw = fs.readFileSync(SNAPSHOT, "utf8");
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  const j = JSON.parse(raw);
  const pools = [
    ...(j.bestSixDisplayWNBA || []),
    ...(j.bestSixWNBA || []),
    ...(j.wnbaGames || []).flatMap((g) => g.props || g.picks || []),
    ...(j.generatedProps || []).filter((p) => String(p.league || "").toUpperCase() === "WNBA"),
  ];
  const byKey = new Map();
  for (const p of pools) {
    if (!p?.player) continue;
    const key = `${String(p.player).toLowerCase()}|${p.line}|${normalizeSide(p.side || p.pick)}`;
    if (!byKey.has(key)) byKey.set(key, p);
  }
  // Prefer Best 6 display cohort as the official Tomorrow membership when present
  const b6 = j.bestSixDisplayWNBA || j.bestSixWNBA || [];
  return {
    meta: {
      serverBuild: j.serverBuild,
      lastUpdated: j.lastUpdated,
      floors: {
        WNBA_FULL_OVER_GAP_FLOOR,
        WNBA_LIMITED_OVER_GAP_FLOOR,
        WNBA_UNDER_GAP_FLOOR,
      },
    },
    bestSix: b6,
    candidates: [...byKey.values()],
  };
}

function tracePick(pick, index = null) {
  const side = normalizeSide(pick.side || pick.pick || pick.currentEngineSide);
  const card = pick.wnbaDataCard || {};
  const reader = pick.wnbaReader || {};
  const di = pick.decisionIntelligence || {};
  const gap = projectionGap(pick);
  const dataMode = String(pick.dataMode || card.dataMode || "").toUpperCase();
  const floors = resolveWnbaGapFloors({
    side,
    dataMode,
    volatility: card.minutesVolatility || pick.minutesVolatility || "stable",
    projectionGap: gap,
  });
  const natural =
    pick.naturalDecision ||
    di.naturalDecision ||
    di.originalGateEligibility ||
    pick.wnbaTrackingDecision ||
    pick.trackingEligibility ||
    null;
  const promoted = Boolean(di.bestSixPromoted || di.promotedForBestSix);
  const readerMeaningful =
    gap != null &&
    ((side === "OVER" && gap >= 2.5) || (side === "UNDER" && gap >= 2.5));
  const gateRejectSolelyGap =
    String(natural).toUpperCase() !== "TRACK" &&
    String(pick.wnbaTrackingReason || di.gateReason || "").includes("GAP_BELOW");
  const disagreement =
    readerMeaningful &&
    gateRejectSolelyGap &&
    side === "OVER" &&
    gap != null &&
    gap < floors.gapFloor;

  return {
    rank: index != null ? index + 1 : pick.controlledBestSixRank || pick.bestSixRank || null,
    player: pick.player,
    line: pick.line,
    side,
    dataMode,
    seasonMinutes: card.season?.minutes ?? pick.seasonMinutes ?? null,
    expectedMinutes: card.projection?.expectedMinutes ?? pick.expectedMinutes ?? null,
    minutesFactorObserved: card.projection?.minutesFactorObserved ?? pick.minutesFactorObserved ?? null,
    minutesFactorApplied: card.projectionComponents?.minutesFactorApplied ?? 1,
    baseProjection:
      pick.projectionBeforeProfileCalibration ??
      card.projection?.projectionBeforeProfileCalibration ??
      null,
    profileAdj:
      pick.profileProjectionDelta ??
      card.projection?.profileProjectionDelta ??
      pick.playerProfileCalibration?.projectionAdjustment ??
      null,
    finalProjection: pick.projection ?? card.projection?.projection ?? null,
    projectionGap: gap,
    readerOverScore: reader.overCase?.score ?? null,
    readerUnderScore: reader.underCase?.score ?? null,
    readerLabel: readerLabel(pick),
    readerSide: reader.finalSide || null,
    gateFloorApplied: floors.gapFloor,
    gateFloorReason: floors.reasonCode,
    naturalDecision: natural,
    gateReason: pick.wnbaTrackingReason || di.gateReason || null,
    promotedDecision: promoted ? "TRACK" : natural,
    promotedForBestSix: promoted,
    confidence: pick.confidence ?? pick.finalConfidence ?? null,
    topStatus: pick.isTopPick || pick.topPickRank != null,
    disagreement,
  };
}

const { meta, bestSix, candidates } = loadCandidates();
const after = process.argv.includes("--after");

console.log(JSON.stringify({ phase: after ? "after_or_current" : "baseline", meta }, null, 2));
console.log("\n=== BEST 6 TRACE ===");
const traces = bestSix.map((p, i) => tracePick(p, i));
for (const t of traces) {
  console.log(
    [
      `#${t.rank}`,
      t.player,
      t.side,
      t.line,
      `proj=${t.finalProjection}`,
      `gap=${t.projectionGap}`,
      `floor=${t.gateFloorApplied}`,
      `nat=${t.naturalDecision}`,
      `prom=${t.promotedForBestSix}`,
      `reason=${t.gateReason}`,
      `reader=${t.readerLabel}`,
      `disagree=${t.disagreement}`,
      `conf=${t.confidence}`,
    ].join(" | ")
  );
}

const naturalTrack = traces.filter((t) => String(t.naturalDecision).toUpperCase() === "TRACK").length;
const boardOnly = traces.filter((t) => String(t.naturalDecision).toUpperCase() === "BOARD_ONLY").length;
const promoted = traces.filter((t) => t.promotedForBestSix).length;
const disagreements = traces.filter((t) => t.disagreement).length;
const overs = traces.filter((t) => t.side === "OVER").length;
const unders = traces.filter((t) => t.side === "UNDER").length;

console.log("\n=== BASELINE METRICS (Best 6 cohort) ===");
console.log(
  JSON.stringify(
    {
      candidateCount: traces.length,
      naturalTrackCount: naturalTrack,
      boardOnlyCount: boardOnly,
      promotedCount: promoted,
      overrideRate: traces.length ? Number((promoted / traces.length).toFixed(3)) : 0,
      readerGateDisagreementCount: disagreements,
      overUnder: `${overs}/${unders}`,
      floors: meta.floors,
    },
    null,
    2
  )
);

console.log("\n=== FOCUS PLAYERS ===");
const focus = [
  "Kelsey Mitchell",
  "Natisha Hiedeman",
  "Dominique Malonga",
  "Rhyne Howard",
  "Naz Hillmon",
  "Erica Wheeler",
];
for (const name of focus) {
  const hit =
    traces.find((t) => t.player === name) ||
    candidates.map((c) => tracePick(c)).find((t) => t.player === name);
  console.log(JSON.stringify(hit || { player: name, missing: true }, null, 2));
}
