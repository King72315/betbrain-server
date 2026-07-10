/**
 * Build deploy-surviving active bundle for 2026-07-08 Results cohort.
 * Usage: node betbrain-server/scripts/build0708ActiveBundle.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const SOURCE = path.join(ROOT, "..", ".tmp-pending-tracked.json");
const BUNDLE_DIR = path.join(ROOT, "active-bundles", "2026-07-08");
const SLATE_DATE = "2026-07-08";

function main() {
  const raw = JSON.parse(fs.readFileSync(SOURCE, "utf8"));
  const props = (raw.props || []).filter((p) => p.slateDate === SLATE_DATE);
  if (props.length !== 5) {
    throw new Error(`Expected 5 props for ${SLATE_DATE}, got ${props.length}`);
  }

  fs.mkdirSync(BUNDLE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(BUNDLE_DIR, "tracked-props.json"),
    JSON.stringify(props, null, 2)
  );

  const lockedAt = "2026-07-09T02:05:27.407Z";
  const snapshot = {
    slateDate: SLATE_DATE,
    lockedAt,
    lockReason: "auto_results_track",
    autoLocked: true,
    phase: "ACTIVE",
    propCount: props.length,
    props,
  };
  fs.writeFileSync(
    path.join(BUNDLE_DIR, "slate-snapshot.json"),
    JSON.stringify(snapshot, null, 2)
  );
  fs.writeFileSync(
    path.join(BUNDLE_DIR, "locked-slate-entry.json"),
    JSON.stringify(
      {
        slateDate: SLATE_DATE,
        phase: "ACTIVE",
        lockedAt,
        lockReason: "auto_results_track",
        autoLocked: true,
        propCount: props.length,
        snapshotFile: `slate-snapshots/${SLATE_DATE}.json`,
      },
      null,
      2
    )
  );
  fs.writeFileSync(
    path.join(BUNDLE_DIR, "manifest.json"),
    JSON.stringify(
      {
        slateDate: SLATE_DATE,
        phase: "ACTIVE",
        expectedPropCount: 5,
        actual: {
          propCount: props.length,
          graded: props.filter((p) =>
            ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
          ).length,
          pending: props.filter(
            (p) => String(p.status || "pending").toLowerCase() === "pending"
          ).length,
        },
        sourceSnapshot: ".tmp-pending-tracked.json",
        sourceBackupId: "2026-07-09T02-05-27-401Z-pre-lock-2026-07-08",
      },
      null,
      2
    )
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        slateDate: SLATE_DATE,
        propCount: props.length,
        players: props.map((p) => ({
          player: p.player,
          status: p.status || "pending",
        })),
        bundleDir: BUNDLE_DIR,
      },
      null,
      2
    )
  );
}

main();
