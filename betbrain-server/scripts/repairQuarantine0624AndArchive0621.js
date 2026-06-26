/**
 * Runtime repair: quarantine 06/24 (INCOMPLETE_PROD_DATA), archive 06/21 to History.
 * Does NOT restore 06/24 props or rebuild 06/24 Lab report.
 *
 * Usage: node betbrain-server/scripts/repairQuarantine0624AndArchive0621.js
 *
 * Optional env:
 *   DRY_RUN=1 — preview only, no writes
 */
import {
  ARCHIVE_TARGET_DATE,
  QUARANTINE_TARGET_DATE,
  repairQuarantine0624AndArchive0621,
} from "../services/repairQuarantine0624AndArchive0621Service.js";

async function main() {
  const dryRun = process.env.DRY_RUN === "1" || process.argv.includes("--dry-run");
  const result = repairQuarantine0624AndArchive0621({ dryRun });

  console.log("Repair:", result.repairId);
  if (result.backupId) {
    console.log("Backup created:", result.backupId);
  }
  console.log(`06/24 tracked props left untouched: ${result.props0624Untouched}`);
  console.log(`Archive ${ARCHIVE_TARGET_DATE}:`, result.archive621);
  console.log(`Quarantine ${QUARANTINE_TARGET_DATE}:`, result.quarantine0624);
  console.log("Remove 06/24 report:", result.remove0624Report);
  console.log("\nPost-repair rotation:", result.meta);

  return result;
}

main().catch((error) => {
  console.error("Repair failed:", error);
  process.exit(1);
});
