/**
 * One-time FS → Postgres migrator (dry-run default).
 *
 *   node scripts/migrateCourtEdgeFilesystemToPostgresV1.js
 *   DRY_RUN=false node scripts/migrateCourtEdgeFilesystemToPostgresV1.js
 *
 * Never seals Aug 7 as Official. May import Aug 7 prospective freeze as research.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyCanonicalMigrations,
  getCanonicalDurableHealth,
  persistResearchFreezeV1,
  sealCanonicalSlateV1,
  C2_CALIBRATION_HASH_CEREMONY,
} from "../services/courtEdgePostgres/canonicalStoreV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DRY_RUN = String(process.env.DRY_RUN || "true").toLowerCase() !== "false";

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function classifySlate(date) {
  if (date === "2026-08-05") return "QUARANTINED";
  if (date === "2026-08-07") return "RESEARCH_ONLY";
  return "HISTORICAL";
}

function summary() {
  return {
    dryRun: DRY_RUN,
    slatesDiscovered: 0,
    officialRows: 0,
    researchRows: 0,
    historyRows: 0,
    locks: 0,
    duplicates: 0,
    conflicts: 0,
    quarantined: 0,
    researchFreezes: 0,
    inserted: 0,
    skipped: 0,
    actions: [],
  };
}

async function main() {
  const report = summary();
  const health = await getCanonicalDurableHealth();
  if (!health.databaseUrlConfigured) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason: "DATABASE_URL_not_configured",
          dryRun: DRY_RUN,
          hint: "Set DATABASE_URL then re-run. Dry-run can still inventory FS.",
        },
        null,
        2
      )
    );
  } else {
    const mig = await applyCanonicalMigrations();
    report.migration = mig;
  }

  const locked = readJson(path.join(ROOT, "locked-slates.json"), { slates: [] });
  const tracked = readJson(path.join(ROOT, "tracked-props.json"), []);
  const trackedProps = Array.isArray(tracked)
    ? tracked
    : Array.isArray(tracked?.props)
      ? tracked.props
      : [];

  const byDate = new Map();
  for (const prop of trackedProps) {
    const d = String(prop.slateDate || "").trim();
    if (!d) continue;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(prop);
  }

  for (const entry of locked.slates || []) {
    const d = String(entry.slateDate || "").trim();
    if (!d) continue;
    report.locks += 1;
    if (!byDate.has(d)) byDate.set(d, []);
  }

  report.slatesDiscovered = byDate.size;

  for (const [date, props] of byDate.entries()) {
    const trust = classifySlate(date);
    const snap = readJson(path.join(ROOT, "slate-snapshots", `${date}.json`), null);
    const snapProps = Array.isArray(snap?.props) ? snap.props : props;
    const official = snapProps.filter((p) => {
      const risk = String(p.trueRisk || p.riskLabel || p.risk || "").toUpperCase();
      return risk === "LOW" || risk === "MEDIUM" || p.slateLocked === true;
    });
    const research = props;

    report.officialRows += official.length;
    report.researchRows += research.length;

    if (trust === "QUARANTINED") {
      report.quarantined += official.length;
      report.skipped += 1;
      report.actions.push({
        slateDate: date,
        action: "skip_quarantined",
        trust,
        official: official.length,
      });
      continue;
    }

    if (trust === "RESEARCH_ONLY" || date === "2026-08-07") {
      report.skipped += 1;
      report.actions.push({
        slateDate: date,
        action: "skip_no_retroactive_official",
        trust,
        official: official.length,
      });
      continue;
    }

    if (!official.length) {
      report.skipped += 1;
      report.actions.push({ slateDate: date, action: "skip_empty_official" });
      continue;
    }

    if (DRY_RUN || !health.durableStoreReady) {
      report.actions.push({
        slateDate: date,
        action: DRY_RUN ? "dry_run_would_seal_historical" : "skip_db_not_ready",
        trust,
        official: official.length,
        research: research.length,
      });
      continue;
    }

    const sealed = await sealCanonicalSlateV1({
      league: "WNBA",
      slateDate: date,
      dayBucket: "TODAY",
      officialProps: official,
      researchProps: research,
      classification: "HISTORICAL",
      calibrationHash: C2_CALIBRATION_HASH_CEREMONY,
      lockReason: "HISTORICAL_IMPORT",
      sourceBuild: "migrateCourtEdgeFilesystemToPostgresV1",
    });
    report.actions.push({
      slateDate: date,
      action: sealed.ok ? "inserted" : "conflict_or_failed",
      reason: sealed.reason || null,
      official: sealed.officialCount,
    });
    if (sealed.ok) report.inserted += 1;
    else {
      report.conflicts += 1;
      report.skipped += 1;
    }
  }

  // Aug 7 prospective research freeze (not Official)
  const freezeDir = path.join(
    ROOT,
    "research",
    "empirical-safe-prop-v2",
    "prospective-slate-freezes"
  );
  const latestFreeze = path.join(freezeDir, "2026-08-07__LATEST_PROSPECTIVE.json");
  if (fs.existsSync(latestFreeze)) {
    const freeze = readJson(latestFreeze, null);
    report.researchFreezes += 1;
    if (DRY_RUN || !health.durableStoreReady) {
      report.actions.push({
        slateDate: "2026-08-07",
        action: "dry_run_research_freeze",
        officialRecordEligible: false,
      });
    } else {
      const saved = await persistResearchFreezeV1({
        slateDate: "2026-08-07",
        freezeTimestamp: freeze.frozenAt || freeze.freezeTimestamp,
        freezeJson: freeze,
        classificationCounts: freeze.classificationCounts || null,
        calibrationHash: freeze.calibrationHash || C2_CALIBRATION_HASH_CEREMONY,
        officialRecordEligible: false,
      });
      report.actions.push({
        slateDate: "2026-08-07",
        action: saved.ok ? "research_freeze_persisted" : "research_freeze_failed",
        officialRecordEligible: false,
      });
      if (saved.ok) report.inserted += 1;
    }
  }

  const histDir = path.join(ROOT, "history-archive");
  if (fs.existsSync(histDir)) {
    report.historyRows = fs
      .readdirSync(histDir)
      .filter((f) => f.endsWith(".json")).length;
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        dryRun: DRY_RUN,
        durableStoreReady: health.durableStoreReady,
        databaseUrlConfigured: health.databaseUrlConfigured,
        report,
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
