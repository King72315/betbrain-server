import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..");

const EXPECTED_CARD_FIELDS = [
  "player",
  "gameLabel",
  "stat",
  "line",
  "currentEngineSide",
  "confidence",
  "riskLabel",
  "tier",
  "supportScore",
  "resistanceScore",
  "projection",
  "fairLine",
  "playerState",
  "scoreLedger",
  "signalSnapshot",
  "supportReasons",
  "dangerReasons",
  "status",
  "actualStat",
  "volumeProfile",
  "roleChange",
  "marketIntelligence",
];

function keys(obj) {
  return Object.keys(obj || {});
}

const tracked = JSON.parse(fs.readFileSync(path.join(SERVER, "tracked-props.json"), "utf8"));
const archive = JSON.parse(
  fs.readFileSync(path.join(SERVER, "history-archive", "2026-06-21.json"), "utf8")
);

const trackedSample = tracked.find((p) => p.slateDate === "2026-06-21") || tracked[0];
const archiveSample = archive.props?.[0] || {};

const trackedKeys = new Set(keys(trackedSample));
const archiveKeys = new Set(keys(archiveSample));

const missingInArchive = EXPECTED_CARD_FIELDS.filter((f) => !archiveKeys.has(f));
const missingInTracked = EXPECTED_CARD_FIELDS.filter((f) => !trackedKeys.has(f));
const archiveOnly = [...archiveKeys].filter((k) => !trackedKeys.has(k)).slice(0, 15);
const trackedOnly = [...trackedKeys].filter((k) => !archiveKeys.has(k)).slice(0, 15);

console.log(
  JSON.stringify(
    {
      trackedSampleKeys: trackedKeys.size,
      archiveSampleKeys: archiveKeys.size,
      missingInArchiveFromExpected: missingInArchive,
      missingInTrackedFromExpected: missingInTracked,
      archiveOnlySample: archiveOnly,
      trackedOnlySample: trackedOnly,
      archiveHasLockedFields: {
        lockedScoreLedger: archiveKeys.has("lockedScoreLedger"),
        lockedSignalSnapshot: archiveKeys.has("lockedSignalSnapshot"),
        lockedPlayerState: archiveKeys.has("lockedPlayerState"),
      },
    },
    null,
    2
  )
);
