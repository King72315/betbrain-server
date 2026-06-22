/**
 * Local 06/22 TEST slate repair from live top-props board.
 * Usage: node betbrain-server/scripts/reslate0622TestLocal.js [--dry-run]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { reslate0622Test } from "../services/reslate0622TestService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

function readLocalTopProps() {
  const cacheFile = path.join(ROOT, ".picks-cache.json");
  if (fs.existsSync(cacheFile)) {
    const data = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    return data.topWNBAProps || data.topProps || [];
  }
  return [];
}

async function fetchTopProps() {
  const base = process.env.API_URL || "http://localhost:3001";
  try {
    const res = await fetch(`${base}/top-props`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.topWNBAProps || data.topProps || [];
  } catch {
    return readLocalTopProps();
  }
}

async function main() {
  const boardPicks = await fetchTopProps();
  const result = reslate0622Test({ dryRun, boardPicks, backupTag: "pre-0622-test-reslate" });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error("RESLATE 0622 TEST LOCAL FAILED:", err);
  process.exit(1);
});
