/**
 * Runtime repair: rebuild 06/24 Lab report, archive 06/21 to History.
 * Usage: node betbrain-server/scripts/repairSlateRotation0624.js
 *
 * Optional env:
 *   RESTORE_0624_PROPS_FROM=/path/to/tracked-props.json — override bundled 06/24 slice
 */
import {
  BUNDLED_0624_RESTORE_PATH,
  repairSlateRotation0624,
} from "../services/repairSlateRotation0624Service.js";

async function main() {
  const result = repairSlateRotation0624();

  console.log("Backup created:", result.backupId);
  console.log("Restore:", result.restorePreview);

  if (result.restorePreview?.merged > 0) {
    console.log(
      `Restored ${result.restorePreview.merged} missing 06/24 props from ${result.restorePreview.usedRestorePath}`
    );
  } else if (result.restorePreview?.skippedRestore) {
    console.log(`06/24 props present: ${result.restorePreview.existing0624Count}`);
  } else if (result.before0624 === 0) {
    console.warn(
      `WARNING: no tracked props for 2026-06-24 after restore attempt. Bundled slice: ${BUNDLED_0624_RESTORE_PATH}`
    );
  }

  console.log("Rebuild 06/24:", result.rebuildSummary);
  console.log("Archive 06/21:", result.archive621);
  console.log("\nPost-repair rotation:", result.meta);

  return result;
}

main().catch((error) => {
  console.error("Repair failed:", error);
  process.exit(1);
});
