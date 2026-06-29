/**
 * Archive stale LAB bundles so only the current Lab slate remains.
 * Usage: node betbrain-server/scripts/repairLabSlateRotation.js [--dry-run]
 */
import { repairLabSlateRotation } from "../services/repairLabSlateRotationService.js";

const dryRun = process.argv.includes("--dry-run");

const result = repairLabSlateRotation({ dryRun });

console.log(JSON.stringify(result, null, 2));
