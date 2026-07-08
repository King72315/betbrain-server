/**
 * Wipe stuck LAB archives/registry with NO snapshot restore into Lab.
 *
 * Render shell (no ADMIN_SECRET required):
 *   cd betbrain-server
 *   node scripts/resetLabNoRestore.js
 *
 * Dry run:
 *   node scripts/resetLabNoRestore.js --dry-run
 */
import { resetLabNoRestore } from "../services/resetLabArchivesService.js";

const dryRun = process.argv.includes("--dry-run");

const result = resetLabNoRestore({ dryRun });

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

if (!dryRun) {
  if (result.after?.currentLabSlateDate != null) {
    console.error(
      `\nBLOCKER: Lab not empty after wipe (currentLabSlateDate=${result.after.currentLabSlateDate}).`
    );
    process.exit(1);
  }

  if (result.after?.trackedPreserved === false) {
    console.error(
      "\nBLOCKER: Tracked prop counts changed unexpectedly. Inspect Results cohort."
    );
    process.exit(1);
  }
}
