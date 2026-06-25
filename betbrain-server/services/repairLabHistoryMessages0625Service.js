import {
  LAB_ARCHIVE_DATE,
  TARGET_LAB_DATE,
  repairSlateRotation0624,
} from "./repairSlateRotation0624Service.js";

export const REPAIR_ARCHIVE_DATE = LAB_ARCHIVE_DATE;
export const REPAIR_TARGET_LAB_DATE = TARGET_LAB_DATE;

export function repairLabHistoryMessages0625(options = {}) {
  const result = repairSlateRotation0624({
    ...options,
    backupReason:
      options.backupReason || "pre-lab-history-message-cleanup-v1-0625",
  });

  return {
    ...result,
    repairId: "lab-history-message-cleanup-v1-0625",
    archiveDate: REPAIR_ARCHIVE_DATE,
    targetLabDate: REPAIR_TARGET_LAB_DATE,
    beforeRotation: result.meta,
    afterRotation: result.meta,
    message: result.dryRun
      ? `${REPAIR_ARCHIVE_DATE} archive + ${REPAIR_TARGET_LAB_DATE} Lab repair dry-run complete`
      : `${REPAIR_ARCHIVE_DATE} archived to History; ${REPAIR_TARGET_LAB_DATE} set as current Lab`,
  };
}
