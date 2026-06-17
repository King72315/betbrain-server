import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { buildEngineReportCardBundle } from "../services/engineReportCardService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function mapPickToTrackedShape(pick) {
  const side = String(pick.side || pick.pick || "").toLowerCase();
  const normalizedSide =
    side === "over" || side === "o"
      ? "Over"
      : side === "under" || side === "u"
        ? "Under"
        : pick.side || pick.pick;

  return {
    source: "TEST_SAVED_PICK",
    league: pick.league || "WNBA",
    player: pick.player,
    game: pick.game,
    gameLabel: pick.game,
    slateDate: String(pick.time || pick.savedAt || "").slice(0, 10),
    line: pick.line ?? pick.sportsbookLine,
    currentEngineSide: normalizedSide,
    side: normalizedSide,
    confidence: pick.confidence ?? pick.winProbability,
    riskLabel: pick.riskLabel || "",
    tier: pick.tier || "WATCHLIST",
    projection: pick.projection ?? pick.sportsProjection ?? null,
    fairLine: pick.fairLine ?? null,
    fairLineSide: pick.fairLineSide || "NONE",
    bookCount: pick.bookCount ?? 0,
    marketQuality: pick.marketQuality ?? 0,
    dataCoverage: pick.dataCoverage ?? pick.dataQuality ?? 0,
    dataQuality: pick.dataQuality ?? 0,
    dataMode: pick.dataMode || "",
    status: pick.status,
    actualStat: pick.actualStat ?? pick.actualPoints ?? pick.result,
    resultMargin: pick.resultMargin ?? pick.margin,
    margin: pick.margin ?? pick.resultMargin,
    playerState: pick.playerState || null,
    signalSnapshot: pick.signalSnapshot || {
      last5Signal: pick.last5Profile ? "supports_side" : "not enough data",
      usageMinutesSignal: "not enough data",
      fairLineSide: pick.fairLineSide || "NONE",
    },
    confidenceBucket: pick.confidenceBucket,
    bookCountBucket: pick.bookCountBucket,
  };
}

const pickHistory = readJSON(path.join(__dirname, "..", "pick-history.json"));
const gradedWnba = pickHistory.filter(
  (p) =>
    String(p.league).toUpperCase() === "WNBA" &&
    ["win", "loss"].includes(String(p.status).toLowerCase())
);

const sampleProps = gradedWnba.slice(0, 3).map(mapPickToTrackedShape);

console.log("=== SAMPLE GRADED WNBA PICKS ===");
for (const p of sampleProps) {
  console.log(
    `${p.player} ${p.currentEngineSide} ${p.line} — ${p.status} (margin ${p.resultMargin})`
  );
}

const bundle = buildEngineReportCardBundle(sampleProps, {
  slateDate: sampleProps[0]?.slateDate || "2026-06-14",
  reportStatus: "final",
});

console.log("\n=== ENGINE SCORECARD ===");
for (const engine of bundle.engineScorecard.engines) {
  console.log(
    `${engine.engine}: ${engine.record} (${engine.winRate ?? "—"}%) status=${engine.status} — ${engine.lesson}`
  );
}

console.log("\n=== MISTAKE BREAKDOWN ===");
console.log(`Total losses: ${bundle.mistakeBreakdown.totalLosses}`);
for (const cat of Object.values(bundle.mistakeBreakdown.categories).filter(
  (c) => c.count > 0
)) {
  console.log(`  ${cat.label}: ${cat.count}`);
}

console.log("\n=== CALIBRATION RULES ===");
for (const rule of bundle.calibrationRules.rules) {
  console.log(`  [${rule.priority}] ${rule.rule}`);
}

console.log("\n=== SLATE LESSON ===");
console.log(bundle.slateLesson.headline);
console.log(bundle.slateLesson.body);
for (const bullet of bundle.slateLesson.bullets || []) {
  console.log(`  • ${bullet}`);
}
