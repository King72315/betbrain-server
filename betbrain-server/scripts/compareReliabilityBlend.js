/**
 * Compare old vs new evidenceReliability blend on tracked-props sample.
 */
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, "..", "tracked-props.json");

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function oldBlend({ marketQuality, bookCount, consensusBookCount, dataCoverage, rawQuality, hasBothSides }) {
  const components = [];
  if (Number.isFinite(marketQuality)) components.push({ w: 0.3, v: clamp(marketQuality / 100, 0, 1) });
  if (Number.isFinite(bookCount) && bookCount > 0) components.push({ w: 0.2, v: clamp((bookCount - 1) / 7, 0, 1) });
  if (Number.isFinite(consensusBookCount)) components.push({ w: 0.15, v: clamp(consensusBookCount / 6, 0, 1) });
  if (Number.isFinite(dataCoverage)) components.push({ w: 0.2, v: clamp(dataCoverage / 100, 0, 1) });
  if (Number.isFinite(rawQuality)) components.push({ w: 0.1, v: clamp(rawQuality / 100, 0, 1) });
  components.push({ w: 0.05, v: hasBothSides ? 1 : 0.4 });
  const wt = components.reduce((s, c) => s + c.w, 0);
  return wt > 0 ? components.reduce((s, c) => s + c.w * c.v, 0) / wt : 0;
}

function newBlend({ marketQuality, dataCoverage, rawQuality, hasBothSides }) {
  const components = [];
  if (Number.isFinite(marketQuality)) components.push({ w: 0.45, v: clamp(marketQuality / 100, 0, 1) });
  if (Number.isFinite(dataCoverage)) components.push({ w: 0.25, v: clamp(dataCoverage / 100, 0, 1) });
  if (Number.isFinite(rawQuality)) components.push({ w: 0.15, v: clamp(rawQuality / 100, 0, 1) });
  components.push({ w: 0.05, v: hasBothSides ? 1 : 0.4 });
  const wt = components.reduce((s, c) => s + c.w, 0);
  return wt > 0 ? components.reduce((s, c) => s + c.w * c.v, 0) / wt : 0;
}

const raw = JSON.parse(readFileSync(dataPath, "utf8"));
const props = Array.isArray(raw) ? raw : [];

let n = 0;
let deltaSum = 0;
let oldPass = 0;
let newPass = 0;
let flips = 0;

for (const p of props) {
  const inputs = {
    marketQuality: p.marketQuality,
    bookCount: p.bookCount,
    consensusBookCount: p.consensusBookCount ?? p.marketIntelligence?.consensusBookCount,
    dataCoverage: p.dataCoverage ?? p.playerState?.dataAvailability,
    rawQuality: p.dataQuality,
    hasBothSides: Boolean(p.overOdds && p.underOdds),
  };
  if (!Number.isFinite(inputs.marketQuality) || !Number.isFinite(inputs.bookCount)) continue;

  const oldR = oldBlend(inputs);
  const newR = newBlend(inputs);
  n++;
  deltaSum += newR - oldR;
  const oldOk = oldR >= 0.65;
  const newOk = newR >= 0.65;
  if (oldOk) oldPass++;
  if (newOk) newPass++;
  if (oldOk !== newOk) flips++;
}

console.log(`Props compared: ${n}`);
console.log(`Mean delta (new - old): ${(deltaSum / n).toFixed(4)}`);
console.log(`Old >=65% gate pass: ${oldPass}/${n}`);
console.log(`New >=65% gate pass: ${newPass}/${n}`);
console.log(`Gate flips (pass/fail): ${flips}`);
