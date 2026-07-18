/**
 * Recover sealed Official slates stuck unresolved after Results advances.
 *
 * Dry-run (default / required first):
 *   node scripts/recoverStaleSealedSlates.js --date=2026-07-17 --dry-run
 *
 * Apply (local stores only — never run against prod while connectivity is weak):
 *   node scripts/recoverStaleSealedSlates.js --date=2026-07-17 --apply
 *
 * Does not change sealed membership (players/sides/lines/ids/timestamps).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  recoverStaleSealedSlates,
  writeRecoveryPlanArtifact,
  listStaleSealedUnresolvedSlateDates,
  STALE_SEALED_RECOVERY_BUILD,
} from "../services/staleSealedRecoveryService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false, apply: false, date: null, all: false };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--apply") out.apply = true;
    else if (arg === "--all") out.all = true;
    else if (arg.startsWith("--date=")) out.date = arg.slice("--date=".length).trim();
  }
  return out;
}

async function main() {
  const args = parseArgs();
  if (!args.dryRun && !args.apply) {
    console.error("Pass --dry-run or --apply");
    console.error(
      "Example: node scripts/recoverStaleSealedSlates.js --date=2026-07-17 --dry-run"
    );
    process.exit(1);
  }
  if (args.dryRun && args.apply) {
    console.error("Pass only one of --dry-run or --apply");
    process.exit(1);
  }
  if (!args.date && !args.all) {
    console.error("Pass --date=YYYY-MM-DD or --all");
    process.exit(1);
  }

  // Offline discovery preview from current local tracked store
  const discovered = listStaleSealedUnresolvedSlateDates({
    slateDate: args.all ? null : args.date,
  });

  const plan = await recoverStaleSealedSlates({
    slateDate: args.all ? null : args.date,
    dryRun: args.dryRun,
    apply: args.apply,
    requireLikelyFinished: true,
  });

  const outPath = writeRecoveryPlanArtifact(plan);
  const summary = {
    build: STALE_SEALED_RECOVERY_BUILD,
    mode: args.apply ? "APPLY" : "DRY_RUN",
    date: args.date || "ALL",
    discoveredBefore: discovered,
    planSummary: {
      discoveredCount: plan.discoveredCount,
      actions: plan.actions,
      resolve: plan.resolve || null,
      stampedResolveAttempts: plan.stampedResolveAttempts ?? null,
      reportBuild: plan.reportBuild || null,
      afterCount: plan.after?.length ?? null,
      membershipPreserved: plan.membershipPreserved,
      warnings: plan.warnings,
      artifact: outPath,
    },
  };

  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${outPath}`);

  // Also write a stable dry-run artifact name for Jul 17 offline review
  if (args.date === "2026-07-17" && args.dryRun) {
    const stable = path.join(
      __dirname,
      "..",
      ".tmp-recover-2026-07-17-dry-run.json"
    );
    fs.writeFileSync(stable, JSON.stringify(plan, null, 2), "utf8");
    console.log(`Also wrote ${stable}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
