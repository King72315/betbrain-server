/**
 * Shadow replay: 06/21 Lab slate from pre-lab-promotion-fix safe-backup.
 * Does NOT mutate prod or tracked-props — read-only replay + stdout report.
 *
 * Usage: node betbrain-server/scripts/replayWnbaShadow0621.js [backup-json-path]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { applyWnbaShadowRecalibration } from "../engines/wnbaShadowEngine.js";
import { classifyWnbaShadowLoss } from "../engines/wnbaShadowEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DEFAULT_BACKUP = path.join(
  ROOT,
  "safe-backups",
  "pre-lab-promotion-fix-prod-2026-06-21-14graded-2026-06-22T04-47-57-084Z.json"
);
const TARGET_DATE = "2026-06-21";

const inputPath = process.argv[2] || DEFAULT_BACKUP;
const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const allProps = Array.isArray(raw) ? raw : raw.props || [];
const props = allProps.filter((p) => p.slateDate === TARGET_DATE);

console.log(`\n=== WNBA Shadow Replay ${TARGET_DATE} ===`);
console.log(`Source: ${inputPath}`);
console.log(`Props: ${props.length}\n`);

const results = props.map((prop) => {
  const shadow = applyWnbaShadowRecalibration(prop);
  const shadowLoss = String(prop.status).toLowerCase() === "loss"
    ? classifyWnbaShadowLoss(prop)
    : null;
  return {
    player: prop.player,
    side: prop.currentEngineSide,
    line: prop.officialLine ?? prop.line,
    status: prop.status,
    officialTier: prop.tier,
    shadowTier: shadow?.shadowTier ?? prop.tier,
    officialPickScore: prop.pickScore,
    shadowPickScore: shadow?.shadowPickScore ?? prop.pickScore,
    gap: shadow?.gapEval?.gap,
    gapPasses: shadow?.gapEval?.passes,
    lineMovementAgainstSide: shadow?.lineMovementAgainstSide,
    fairLineSuppressed: shadow?.fairLineShadow?.fairLineBoostSuppressed,
    shadowLossMiss: shadowLoss?.missType || null,
  };
});

const tierChanges = results.filter((r) => r.officialTier !== r.shadowTier);
const gapFails = results.filter((r) => r.gapPasses === false);
const lineFlags = results.filter((r) => r.lineMovementAgainstSide);

console.log("--- Per-prop shadow ---");
for (const row of results) {
  console.log(
    `${row.player} ${row.side} ${row.line} | ${row.status} | tier ${row.officialTier}→${row.shadowTier} | score ${row.officialPickScore}→${row.shadowPickScore} | gap=${row.gap} pass=${row.gapPasses} lineMv=${row.lineMovementAgainstSide}`
  );
}

const wins = results.filter((r) => r.status === "win").length;
const losses = results.filter((r) => r.status === "loss").length;

console.log("\n--- Summary ---");
console.log(`Record: ${wins}-${losses}-0 (${props.length} graded)`);
console.log(`Tier changes: ${tierChanges.length}`);
console.log(`Gap floor fails: ${gapFails.length}`);
console.log(`Line movement against (shadow): ${lineFlags.length}`);
console.log(
  `Shadow loss reclassifications: ${results.filter((r) => r.shadowLossMiss).length}`
);

const outPath = path.join(
  ROOT,
  "safe-backups",
  `replay-wnba-shadow-${TARGET_DATE}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`
);
fs.writeFileSync(
  outPath,
  JSON.stringify({ targetDate: TARGET_DATE, source: inputPath, results }, null, 2)
);
console.log(`\nWrote replay artifact: ${outPath}`);
