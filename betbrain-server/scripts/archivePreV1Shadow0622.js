/**
 * Archive 06/22 pre-v1 props from backup to safe-backups/06-22-PRE_V1_LOCKED_PROPS/
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { labelPreV1ShadowProps } from "../services/trackedPropService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const backupDir =
  process.argv[2] ||
  path.join(ROOT, "safe-backups/pre-0622-v1-reslate-2026-06-22T08-15-56-917Z");
const outDir = path.join(ROOT, "safe-backups/06-22-PRE_V1_LOCKED_PROPS");

const tracked = JSON.parse(fs.readFileSync(path.join(backupDir, "tracked-props.json"), "utf8"));
const props = (tracked.props || tracked).filter((p) => p.slateDate === "2026-06-22");
const labeled = labelPreV1ShadowProps(props, {
  shadowLabel: "PRE_V1_LOCKED_PROPS",
  archiveReason: "0622_v1_reslate_step3",
});

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(
  path.join(outDir, "PRE_V1_MANIFEST.json"),
  JSON.stringify(
    {
      label: "PRE_V1_LOCKED_PROPS",
      slateDate: "2026-06-22",
      propCount: labeled.length,
      metadata: {
        generated_before_wnba_v1_engine: true,
        excluded_from_v1_official_record: true,
      },
      archivedAt: new Date().toISOString(),
      sourceBackup: backupDir,
    },
    null,
    2
  )
);
fs.writeFileSync(
  path.join(outDir, "pre-v1-shadow-props.json"),
  JSON.stringify({ props: labeled }, null, 2)
);

console.log(JSON.stringify({ outDir, propCount: labeled.length }, null, 2));
