/**
 * Emergency seed production board cache from a local picks snapshot.
 * Loads ADMIN_SECRET from .env via dotenv (never logs it).
 *
 * node scripts/seedProdBoardFromBackup.js backups/.../picks.json
 */
import "dotenv/config";
import fs from "fs";
import path from "path";

const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const ADMIN_SECRET = String(process.env.ADMIN_SECRET || "").trim();
const SERVER_BUILD = "courteedge-home-completion-tomorrow-six-v1";
const file = process.argv[2];

if (!file) {
  console.error("Usage: node scripts/seedProdBoardFromBackup.js <picks.json>");
  process.exit(1);
}
if (!ADMIN_SECRET) {
  console.error("ADMIN_SECRET missing in env");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
const display = raw.bestSixDisplayWNBA || [];
const tomorrowFromDisplay = display.filter(
  (p) => String(p.dayBucket || "").toUpperCase() === "TOMORROW"
);
const board = {
  ...raw,
  ok: true,
  serverBuild: SERVER_BUILD,
  boardSchemaVersion: raw.boardSchemaVersion || "courtedge-board-schema-v2",
  bestSixDisplayTomorrowWNBA:
    raw.bestSixDisplayTomorrowWNBA?.length
      ? raw.bestSixDisplayTomorrowWNBA
      : tomorrowFromDisplay,
  bestSixDisplayTomorrowNBA: raw.bestSixDisplayTomorrowNBA || [],
  lastUpdated: new Date().toISOString(),
};

const res = await fetch(`${SOURCE}/admin/seed-board-cache`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "x-admin-secret": ADMIN_SECRET,
  },
  body: JSON.stringify({
    confirm: true,
    reason: "home-completion-tomorrow-six-v1-emergency-seed",
    board,
  }),
});
const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  data = { preview: text.slice(0, 500) };
}
console.log(JSON.stringify({ status: res.status, data }, null, 2));
if (!res.ok) process.exit(1);
