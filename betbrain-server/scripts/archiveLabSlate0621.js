/**
 * Archive stuck 2026-06-21 from Lab without promoting a replacement slate.
 *
 * Render shell (recommended — no ADMIN_SECRET required):
 *   cd betbrain-server
 *   node scripts/archiveLabSlate0621.js
 *
 * Dry run:
 *   node scripts/archiveLabSlate0621.js --dry-run
 */
import { archiveLabSlate0621 } from "../services/archiveLabSlate0621Service.js";

const dryRun = process.argv.includes("--dry-run");

const result = archiveLabSlate0621({ dryRun });

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

if (!dryRun && result.meta?.currentLabSlateDate === "2026-06-21") {
  console.error(
    "\nBLOCKER: currentLabSlateDate is still 2026-06-21 after archive. Check archive phase/registry."
  );
  process.exit(1);
}
