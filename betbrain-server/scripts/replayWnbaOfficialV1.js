/**
 * Replay 06/21 + 06/22 with WNBA v1 official rules — read-only, does not mutate Lab.
 * Usage: node betbrain-server/scripts/replayWnbaOfficialV1.js [backup-json]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyWnbaOfficialV1Rules,
  evaluateWnbaOfficialEligibility,
} from "../engines/wnbaOfficialEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEFAULT_BACKUP = path.join(
  ROOT,
  "safe-backups",
  "pre-lab-promotion-fix-prod-2026-06-21-14graded-2026-06-22T04-47-57-084Z.json"
);

const inputPath = process.argv[2] || DEFAULT_BACKUP;
const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const allProps = Array.isArray(raw) ? raw : raw.props || [];

function replayDate(targetDate) {
  const props = allProps.filter((p) => p.slateDate === targetDate);
  return props.map((prop) => {
    const replayed = applyWnbaOfficialV1Rules(prop);
    const eligibility = evaluateWnbaOfficialEligibility(replayed);
    return {
      player: prop.player,
      side: prop.currentEngineSide || prop.side,
      line: prop.officialLine ?? prop.line,
      status: prop.status,
      slateDate: targetDate,
      officialTier: prop.tier,
      replayTier: replayed.tier,
      officialEligible: eligibility.eligible,
      reasons: eligibility.reasons,
      gapPasses: eligibility.gates?.gapEval?.passes,
    };
  });
}

const dates = ["2026-06-21", "2026-06-22"];
const results = {};

for (const date of dates) {
  const rows = replayDate(date);
  results[date] = {
    propCount: rows.length,
    officialEligible: rows.filter((r) => r.officialEligible).length,
    tierChanges: rows.filter((r) => r.officialTier !== r.replayTier).length,
    rows,
  };
}

console.log("\n=== WNBA Official V1 Replay (read-only) ===");
for (const date of dates) {
  const summary = results[date];
  console.log(
    `${date}: ${summary.propCount} props | official-eligible ${summary.officialEligible} | tier changes ${summary.tierChanges}`
  );
  for (const row of summary.rows) {
    console.log(
      `  ${row.player} ${row.side} ${row.line} | tier ${row.officialTier}→${row.replayTier} | official=${row.officialEligible} | gap=${row.gapPasses}`
    );
  }
}

const outPath = path.join(
  ROOT,
  "safe-backups",
  `replay-wnba-official-v1-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
fs.writeFileSync(outPath, JSON.stringify({ source: inputPath, results }, null, 2));
console.log(`\nWrote: ${outPath}`);
