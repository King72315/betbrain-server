/**
 * Runtime repair: archive 06/21 to History, set 06/24 as current Lab.
 * Usage: node betbrain-server/scripts/repairLabHistoryMessages0625.js
 *
 * Optional env:
 *   RESTORE_0624_PROPS_FROM=/path/to/tracked-props.json
 */
import {
  REPAIR_ARCHIVE_DATE,
  REPAIR_TARGET_LAB_DATE,
  repairLabHistoryMessages0625,
} from "../services/repairLabHistoryMessages0625Service.js";
import { BUNDLED_0624_RESTORE_PATH } from "../services/repairSlateRotation0624Service.js";

async function main() {
  const result = repairLabHistoryMessages0625();

  console.log("Repair:", result.repairId);
  console.log("Backup created:", result.backupId);
  console.log("Restore:", result.restorePreview);

  if (result.restorePreview?.merged > 0) {
    console.log(
      `Restored ${result.restorePreview.merged} missing ${REPAIR_TARGET_LAB_DATE} props from ${result.restorePreview.usedRestorePath}`
    );
  } else if (result.restorePreview?.skippedRestore) {
    console.log(
      `${REPAIR_TARGET_LAB_DATE} props present: ${result.restorePreview.existing0624Count}`
    );
  } else if (result.before0624 === 0) {
    console.warn(
      `WARNING: no tracked props for ${REPAIR_TARGET_LAB_DATE} after restore attempt. Bundled slice: ${BUNDLED_0624_RESTORE_PATH}`
    );
  }

  console.log(`Rebuild ${REPAIR_TARGET_LAB_DATE}:`, result.rebuildSummary);
  console.log(`Archive ${REPAIR_ARCHIVE_DATE}:`, result.archive621);
  console.log("\nPost-repair rotation:", result.meta);

  return result;
}

main().catch((error) => {
  console.error("Repair failed:", error);
  process.exit(1);
});
