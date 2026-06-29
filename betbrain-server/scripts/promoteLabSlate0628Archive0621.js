/**
 * Promote 2026-06-28 to Lab and archive 2026-06-21 to History.
 *
 * Render shell (recommended — no ADMIN_SECRET required):
 *   cd betbrain-server
 *   node scripts/promoteLabSlate0628Archive0621.js
 *
 * Dry run:
 *   node scripts/promoteLabSlate0628Archive0621.js --dry-run
 *
 * If 06/28 props are missing, generate bundled slice first:
 *   node scripts/capture0628TrackedPropsSlice.js
 */
import { promoteLabSlate0628Archive0621 } from "../services/promoteLabSlate0628Archive0621Service.js";

const dryRun = process.argv.includes("--dry-run");
const skipResolve = process.argv.includes("--skip-resolve");

async function main() {
  const result = await promoteLabSlate0628Archive0621({ dryRun, skipResolve });

  console.log(JSON.stringify(result, null, 2));

  if (!dryRun && result.after0628 === 0) {
    console.error(
      "\nBLOCKER: no 06/28 tracked props after repair. Run capture0628TrackedPropsSlice.js, deploy slice, then re-run."
    );
    process.exit(1);
  }

  if (!dryRun && result.meta?.currentLabSlateDate !== "2026-06-28") {
    console.warn(
      `\nWARNING: currentLabSlateDate is ${result.meta?.currentLabSlateDate} (expected 2026-06-28). Check grading/report build.`
    );
  }
}

main().catch((error) => {
  console.error("Promote Lab 06/28 repair failed:", error);
  process.exit(1);
});
