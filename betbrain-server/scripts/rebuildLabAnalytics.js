/**
 * Rebuild / dedupe Lab analytics plan from local tracked props + daily reports.
 *
 * Dry-run (default when --dry-run):
 *   node scripts/rebuildLabAnalytics.js --dry-run
 *   Writes .tmp-rebuild-lab-analytics-dry-run.json only (no store mutation).
 *
 * Apply (local stores only — do not use against prod HTTP):
 *   node scripts/rebuildLabAnalytics.js --apply
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  getTrackedProps,
  writeTrackedProps,
  getStableTrackedPropKey,
  isResolvedStatus,
} from "../services/trackedPropService.js";
import { getDailySlateReports } from "../services/dailySlateReportService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const DRY_RUN_OUT = path.join(SERVER_ROOT, ".tmp-rebuild-lab-analytics-dry-run.json");

function parseArgs(argv = process.argv.slice(2)) {
  const out = { dryRun: false, apply: false };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--apply") out.apply = true;
  }
  return out;
}

function buildDedupePlan(tracked = [], reports = []) {
  const byStable = new Map();
  const collisions = [];

  tracked.forEach((prop, index) => {
    const stableKey = getStableTrackedPropKey(prop);
    if (!byStable.has(stableKey)) {
      byStable.set(stableKey, []);
    }
    byStable.get(stableKey).push({ index, prop, stableKey });
  });

  for (const [stableKey, group] of byStable.entries()) {
    if (group.length < 2) continue;
    const keep = group.find((g) => isResolvedStatus(g.prop.status)) || group[0];
    const drop = group.filter((g) => g.index !== keep.index);
    collisions.push({
      stableKey,
      keepIndex: keep.index,
      keepPlayer: keep.prop.player,
      keepStatus: keep.prop.status || null,
      dropIndices: drop.map((d) => d.index),
      dropPlayers: drop.map((d) => d.prop.player),
      count: group.length,
    });
  }

  const reportDates = (reports || [])
    .map((r) => String(r.slateDate || "").slice(0, 10))
    .filter(Boolean)
    .sort();

  const trackedByDate = {};
  for (const prop of tracked) {
    const d = String(prop.slateDate || "").slice(0, 10);
    if (!d) continue;
    trackedByDate[d] = (trackedByDate[d] || 0) + 1;
  }

  const reportAlignment = reportDates.map((slateDate) => ({
    slateDate,
    trackedCount: trackedByDate[slateDate] || 0,
    reportExists: true,
  }));

  const dropIndexSet = new Set(collisions.flatMap((c) => c.dropIndices));
  const dedupedCount = tracked.length - dropIndexSet.size;

  return {
    generatedAt: new Date().toISOString(),
    trackedCount: tracked.length,
    reportCount: reports.length,
    uniqueStableKeys: byStable.size,
    collisionCount: collisions.length,
    dropCount: dropIndexSet.size,
    dedupedCount,
    collisions,
    reportDates,
    reportAlignment,
    trackedDates: Object.keys(trackedByDate).sort(),
  };
}

function applyDedupe(tracked = [], plan) {
  const drop = new Set(plan.collisions.flatMap((c) => c.dropIndices));
  return tracked.filter((_, index) => !drop.has(index)).map((prop) => {
    const stableKey = getStableTrackedPropKey(prop);
    return {
      ...prop,
      trackedKey: stableKey,
      trackedId: prop.trackedId || stableKey,
    };
  });
}

function main() {
  const args = parseArgs();
  if (!args.dryRun && !args.apply) {
    console.error("Pass --dry-run or --apply");
    process.exit(1);
  }
  if (args.dryRun && args.apply) {
    console.error("Pass only one of --dry-run or --apply");
    process.exit(1);
  }

  const tracked = getTrackedProps();
  const reports = getDailySlateReports();
  const plan = buildDedupePlan(tracked, reports);

  console.log(
    JSON.stringify(
      {
        mode: args.apply ? "APPLY" : "DRY_RUN",
        trackedCount: plan.trackedCount,
        reportCount: plan.reportCount,
        uniqueStableKeys: plan.uniqueStableKeys,
        collisionCount: plan.collisionCount,
        dropCount: plan.dropCount,
        dedupedCount: plan.dedupedCount,
        collisions: plan.collisions,
        reportAlignment: plan.reportAlignment,
      },
      null,
      2
    )
  );

  if (args.dryRun) {
    fs.writeFileSync(DRY_RUN_OUT, JSON.stringify(plan, null, 2), "utf8");
    console.log("Wrote " + DRY_RUN_OUT);
    return;
  }

  const next = applyDedupe(tracked, plan);
  writeTrackedProps(next, {
    sourcePath: "rebuildLabAnalytics.apply",
    allowMerge: false,
  });
  console.log(
    "APPLY complete: " + tracked.length + " -> " + next.length + " tracked props (local store)"
  );
}

main();
