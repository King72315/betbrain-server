/**
 * CourtEdge Engine Expansion V1 — dry-run replay / analysis.
 * Usage: node scripts/replayCourtEdgeEngineExpansionV1.js
 *
 * Loads any available sealed/history JSON from local disk (if present),
 * runs buildCourtEdgeEngineSignalsV1 with force:true, and prints a
 * comparison summary. NEVER writes or mutates archives.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCourtEdgeEngineSignalsV1 } from "../engines/courtEdgeExpansion/orchestratorV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const CANDIDATE_PATHS = [
  path.join(ROOT, "test-fixtures", "engine-expansion-v1", "same-team.json"),
  path.join(ROOT, "test-fixtures", "engine-expansion-v1", "game-logs-rich.json"),
  path.join(ROOT, "daily-slate-reports.json"),
  path.join(ROOT, "pick-history.json"),
  path.join(ROOT, "tracked-props.json"),
  path.join(ROOT, "history-archive"),
];

function tryReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) return null;
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractProps(payload) {
  if (!payload) return [];
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.props)) return payload.props;
  if (Array.isArray(payload.picks)) return payload.picks;
  if (Array.isArray(payload.trackedProps)) return payload.trackedProps;
  if (Array.isArray(payload.entries)) return payload.entries;
  if (payload.gameLogs || payload.line || payload.projection) return [payload];
  // daily-slate-reports style: { "2026-07-18": { picks: [] } }
  const nested = [];
  for (const value of Object.values(payload)) {
    if (value && typeof value === "object") {
      if (Array.isArray(value.picks)) nested.push(...value.picks);
      if (Array.isArray(value.props)) nested.push(...value.props);
      if (value.canonicalSealedProp) nested.push(value);
    }
  }
  return nested;
}

function ctxFromProp(prop = {}) {
  const sealed = prop.canonicalSealedProp || {};
  return {
    league: prop.league || sealed.league || "WNBA",
    gameLogs: prop.gameLogs || prop.last10 || [],
    seasonAverage: prop.seasonAverage,
    line: prop.line ?? sealed.line,
    projection: prop.projection ?? sealed.finalProjection,
    openingLine: prop.openingLine ?? sealed.openingLine,
    selectedLine: prop.selectedLine ?? sealed.selectedLine,
    sealedLine: prop.sealedLine ?? sealed.sealedLine,
    currentLine: prop.currentLine ?? sealed.currentLine,
    organicModelSide: prop.originalModelSide || sealed.originalModelSide,
    finalSide: prop.side || prop.pick || sealed.side,
    bookCount: prop.bookCount,
    availabilityStatus: prop.availabilityStatus,
    teammateStatuses: prop.teammateStatuses || [],
    teamGameDates: prop.teamGameDates || [],
    courtEdgeEngineSignalsV1:
      prop.courtEdgeEngineSignalsV1 ||
      sealed.courtEdgeEngineSignalsV1 ||
      prop.courtEdgeEngineSignals ||
      null,
  };
}

function summarize(signals) {
  if (!signals?.engines) return { available: 0, voting: 0, organicSide: null };
  const engines = Object.values(signals.engines).filter((e) => !e.storeOnly);
  const available = engines.filter((e) => e.available).length;
  const voting = engines.filter((e) => e.available && e.normalizedSignal !== 0).length;
  return {
    available,
    voting,
    organicSide: signals.aggregation?.organicSide ?? null,
    confidenceAdjustment: signals.aggregation?.confidenceAdjustment ?? null,
  };
}

console.log("CourtEdge Engine Expansion V1 — dry-run replay (read-only)\n");

const loadedSources = [];
const sampleProps = [];

for (const candidate of CANDIDATE_PATHS) {
  if (!fs.existsSync(candidate)) continue;
  const stat = fs.statSync(candidate);
  if (stat.isDirectory()) {
    const files = fs.readdirSync(candidate).filter((f) => f.endsWith(".json")).slice(0, 3);
    for (const f of files) {
      const full = path.join(candidate, f);
      const data = tryReadJson(full);
      const props = extractProps(data);
      if (props.length) {
        loadedSources.push(path.relative(ROOT, full));
        sampleProps.push(...props.slice(0, 5));
      }
    }
    continue;
  }
  const data = tryReadJson(candidate);
  const props = extractProps(data);
  if (props.length) {
    loadedSources.push(path.relative(ROOT, candidate));
    sampleProps.push(...props.slice(0, 10));
  }
}

if (!sampleProps.length) {
  console.log("No local sealed/history props found. Running fixture-only dry-run.");
}

let targets = sampleProps.slice(0, 12);
if (!targets.length) {
  targets = [tryReadJson(path.join(ROOT, "test-fixtures", "engine-expansion-v1", "game-logs-rich.json"))];
}

console.log(`Sources loaded (read-only): ${loadedSources.length ? loadedSources.join(", ") : "(fixtures only)"}`);
console.log(`Props analyzed: ${targets.filter(Boolean).length}\n`);

let compared = 0;
for (const prop of targets.filter(Boolean)) {
  const ctx = ctxFromProp(prop);
  const prior = ctx.courtEdgeEngineSignalsV1;
  const priorSnap = prior ? JSON.stringify(prior) : null;

  const rebuilt = buildCourtEdgeEngineSignalsV1(ctx, { force: true });
  const before = summarize(prior);
  const after = summarize(rebuilt);

  // Prove we did not mutate prior signals object if it existed.
  if (prior && priorSnap !== null) {
    if (JSON.stringify(prior) !== priorSnap) {
      console.error("ERROR: prior sealed signals object was mutated — aborting.");
      process.exitCode = 1;
      break;
    }
  }

  compared += 1;
  const label = prop.player || prop.playerName || sealedLabel(prop) || `prop#${compared}`;
  console.log(
    `${compared}. ${label} | prior avail=${before.available ?? "n/a"} vote=${before.voting ?? "n/a"} side=${before.organicSide ?? "n/a"}` +
      ` -> replay avail=${after.available} vote=${after.voting} side=${after.organicSide} confAdj=${after.confidenceAdjustment}`
  );
}

function sealedLabel(prop) {
  return prop.canonicalSealedProp?.player || null;
}

console.log(`\nDry-run complete. Compared ${compared} prop(s). No archives were written.`);
