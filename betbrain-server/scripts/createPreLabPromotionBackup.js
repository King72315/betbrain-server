import fs from "fs";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.join(__dirname, "..", "..");
const SOURCE = "https://betbrain-server-1.onrender.com/tracked-props";
const TARGET = "2026-06-21";
const ts = new Date().toISOString().replace(/[:.]/g, "-");
const base = path.join(
  ROOT,
  "betbrain-server/safe-backups",
  `pre-lab-promotion-fix-prod-${TARGET}-14graded-${ts}`
);

const inputFile =
  process.argv[2] ||
  path.join(ROOT, ".tmp-prod-tracked-props-backup.json");

const raw = JSON.parse(fs.readFileSync(inputFile, "utf8"));
const allProps = Array.isArray(raw) ? raw : raw.props || raw.trackedProps || [];
const props = allProps
  .filter((p) => p.slateDate === TARGET)
  .sort((a, b) => String(a.trackedId || "").localeCompare(String(b.trackedId || "")));

const graded = props.filter((p) =>
  ["win", "loss", "push"].includes(String(p.status || "").toLowerCase())
);
const pending = props.length - graded.length;
const wins = graded.filter((p) => String(p.status).toLowerCase() === "win").length;
const losses = graded.filter(
  (p) => String(p.status).toLowerCase() === "loss"
).length;
const pushes = graded.filter(
  (p) => String(p.status).toLowerCase() === "push"
).length;
const nullLine = props.filter((p) => p.officialLine == null).length;

const identityPayload = props.map((p) => ({
  trackedId: p.trackedId,
  player: p.player,
  team: p.team,
  opponent: p.opponent,
  stat: p.stat,
  currentEngineSide: p.currentEngineSide,
  officialLine: p.officialLine,
}));
const identityChecksum = crypto
  .createHash("sha256")
  .update(JSON.stringify(identityPayload))
  .digest("hex");
const fullChecksum = crypto
  .createHash("sha256")
  .update(JSON.stringify(props))
  .digest("hex");

let freezeChecksum = null;
let checksumMatch = false;
try {
  const freezePath = path.join(
    ROOT,
    "betbrain-server/tracked-props-06-21-official-freeze-20260621.json"
  );
  const freeze = JSON.parse(fs.readFileSync(freezePath, "utf8"));
  const freezeProps = (freeze.props || []).sort((a, b) =>
    String(a.trackedId || "").localeCompare(String(b.trackedId || ""))
  );
  const freezeIdentity = freezeProps.map((p) => ({
    trackedId: p.trackedId,
    player: p.player,
    team: p.team,
    opponent: p.opponent,
    stat: p.stat,
    currentEngineSide: p.currentEngineSide,
    officialLine: p.officialLine,
  }));
  freezeChecksum = crypto
    .createHash("sha256")
    .update(JSON.stringify(freezeIdentity))
    .digest("hex");
  checksumMatch = freezeChecksum === identityChecksum;
} catch {
  // optional freeze file
}

const dupIds = props
  .map((p) => p.trackedId)
  .filter((id, i, arr) => arr.indexOf(id) !== i);

const doc = {
  meta: {
    capturedAt: new Date().toISOString(),
    source: SOURCE,
    slateDate: TARGET,
    propCount: props.length,
    graded: graded.length,
    pending,
    wins,
    losses,
    pushes,
    checksumSha256: fullChecksum,
    identityChecksumSha256: identityChecksum,
    freezeChecksum,
    checksumMatch,
    officialLineNull: nullLine,
    duplicates: dupIds.length,
    slateLocked: props.filter((p) => p.slateLocked === true).length,
    step0Pass:
      props.length === 14 &&
      pending === 0 &&
      graded.length === 14 &&
      nullLine === 0,
  },
  props,
};

fs.mkdirSync(path.dirname(`${base}.json`), { recursive: true });
fs.writeFileSync(`${base}.json`, JSON.stringify(doc, null, 2));

const playerLines = props
  .map(
    (p) =>
      `- ${p.player} ${p.stat} ${p.currentEngineSide} ${p.officialLine} [${String(
        p.status || "pending"
      ).toLowerCase()}]`
  )
  .join("\n");

const md = `# Pre-lab-promotion-fix prod safety backup — ${TARGET}

- **Captured:** ${doc.meta.capturedAt}
- **Source:** ${SOURCE}
- **Props (06/21):** ${props.length}
- **Full backup checksum:** \`${fullChecksum}\`
- **Identity checksum:** \`${identityChecksum}\`
- **Official freeze checksum:** \`${freezeChecksum || "n/a"}\`
- **Checksum match:** ${checksumMatch ? "YES" : "NO"}
- **officialLine null:** ${nullLine}
- **Duplicates:** ${dupIds.length}
- **slateLocked:** ${doc.meta.slateLocked}/${props.length}
- **Graded:** ${graded.length}
- **Pending:** ${pending}
- **Record:** ${wins}-${losses}-${pushes}
- **step0Pass:** ${doc.meta.step0Pass}

## Players
${playerLines}
`;

fs.writeFileSync(`${base}.md`, md);
console.log(
  JSON.stringify(
    {
      backupJson: `${base}.json`,
      backupMd: `${base}.md`,
      ...doc.meta,
    },
    null,
    2
  )
);
