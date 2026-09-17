import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TRACKING } from "../engines/wnba/winnersV1/constants.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "data", "wnba-winners-v1.json");

function readStore() {
  if (!fs.existsSync(FILE)) return { slates: {} };
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { slates: {} };
  }
}

function writeStore(store) {
  const dir = path.dirname(FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(store, null, 2));
}

export function persistWinnerSlate(slate) {
  const store = readStore();
  const date = slate.slateDateCT;
  const existing = store.slates[date];
  if (existing?.frozen === true) {
    return { ok: true, frozen: true, reused: true, slate: existing };
  }
  store.slates[date] = { ...slate, frozen: true, persistedAt: new Date().toISOString() };
  writeStore(store);
  return { ok: true, frozen: true, reused: false, slate: store.slates[date] };
}

export function getWinnerSlate(date) {
  const store = readStore();
  return store.slates[String(date || "")] || null;
}

export function officialWinnersForResults(date) {
  const slate = getWinnerSlate(date);
  if (!slate) return [];
  return (slate.fullSlate || []).filter((r) => r.winnerTrackingType === TRACKING.OFFICIAL);
}

export function labWinnerSlate(date) {
  return getWinnerSlate(date);
}
