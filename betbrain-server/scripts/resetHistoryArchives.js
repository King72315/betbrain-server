/**
 * Erase History archives + registry rows, then rebuild ARCHIVED slates.
 *
 * Render shell (no ADMIN_SECRET required):
 *   cd betbrain-server
 *   node scripts/resetHistoryArchives.js
 *
 * Dry run:
 *   node scripts/resetHistoryArchives.js --dry-run
 */
import { resetHistoryArchives } from "../services/resetHistoryArchivesService.js";

const dryRun = process.argv.includes("--dry-run");

const result = resetHistoryArchives({ dryRun });

console.log(JSON.stringify(result, null, 2));

if (!result.ok) {
  process.exit(1);
}

if (!dryRun) {
  const labStillStuck =
    result.after?.currentLabSlateDate === "2026-06-21" &&
    !result.after?.historySlateDates?.includes("2026-06-21");

  if (labStillStuck) {
    console.error(
      "\nBLOCKER: 06/21 still current Lab without History placement. Inspect archive/registry."
    );
    process.exit(1);
  }
}
