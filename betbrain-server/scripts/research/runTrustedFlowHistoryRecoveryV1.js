/**
 * Authentic recovery: feed canonical 8/13 + 8/14 into Results/Lab/History mirrors.
 * Does not remint, regrade, or ingest 8/16.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  getCanonicalRecordsBySlate,
  loadCanonicalPredictionStore,
} from "../../services/courtEdgeCanonicalPredictionRecordV1.js";
import {
  recoverCanonicalSlateIntoLifecycle,
  writeCompactHistoryArchive,
  summarizeCanonicalSlate,
} from "../../services/courtEdgeProductTruthLifecycleV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "../..");
const OUT = path.join(ROOT, "research/courteedge-trusted-flow-history-recovery-v1");
const CANONICAL = path.join(ROOT, "canonical-predictions-v1.json");
const PACKETS_16 = path.join(
  ROOT,
  "research/empirical-safe-prop-v2/frozen-research-packets/2026-08-16__LATEST.json"
);

function ensure(p) {
  fs.mkdirSync(p, { recursive: true });
}
function sha(p) {
  if (!fs.existsSync(p)) return null;
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function fingerprint(recs) {
  return (recs || []).map((r) => ({
    canonicalPropId: r.canonicalPropId,
    player: r.playerName,
    propType: r.propType,
    side: r.side,
    line: r.line,
    projection: r.projection,
    fairLine: r.fairLine,
    predictedProbability: r.predictedProbability,
    safetyScore: r.safetyScore,
    risk: r.risk,
    decisionScoreV2: r.decisionScoreV2,
    membership: r.membership,
    grade: r.result?.grade || null,
    actual: r.result?.actual ?? null,
  }));
}

ensure(OUT);
ensure(path.join(OUT, "25-checkpoint"));

const preHash = sha(CANONICAL);
const packetHash = sha(PACKETS_16);
fs.copyFileSync(CANONICAL, path.join(OUT, "25-checkpoint/canonical-predictions-v1.pre.json"));
if (fs.existsSync(PACKETS_16)) {
  fs.writeFileSync(
    path.join(OUT, "25-checkpoint/2026-08-16__LATEST.sha256.txt"),
    `${packetHash}\n`
  );
}

const before14 = fingerprint(getCanonicalRecordsBySlate("2026-08-14"));
const before13 = fingerprint(getCanonicalRecordsBySlate("2026-08-13"));
const before16 = fingerprint(getCanonicalRecordsBySlate("2026-08-16"));

const recover14 = recoverCanonicalSlateIntoLifecycle("2026-08-14");
const recover13 = recoverCanonicalSlateIntoLifecycle("2026-08-13");
const archive12 = writeCompactHistoryArchive("2026-08-12");
const archive13 = writeCompactHistoryArchive("2026-08-13");
const archive14 = writeCompactHistoryArchive("2026-08-14");

const after14 = fingerprint(getCanonicalRecordsBySlate("2026-08-14"));
const after13 = fingerprint(getCanonicalRecordsBySlate("2026-08-13"));
const after16 = fingerprint(getCanonicalRecordsBySlate("2026-08-16"));
const postHash = sha(CANONICAL);

const unchanged = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const result = {
  ok: true,
  provenance: "RECOVERED_FROM_AUTHENTIC_FROZEN_PRODUCT_TRUTH",
  reminted: false,
  productTruthMutated: preHash !== postHash,
  canonicalHashBefore: preHash,
  canonicalHashAfter: postHash,
  packets16Hash: packetHash,
  ingested16: false,
  identity14Unchanged: unchanged(before14, after14),
  identity13Unchanged: unchanged(before13, after13),
  identity16Unchanged: unchanged(before16, after16),
  d16n: after16.length,
  recover14,
  recover13,
  archive12,
  archive13,
  archive14,
  summary14: summarizeCanonicalSlate("2026-08-14"),
  summary13: summarizeCanonicalSlate("2026-08-13"),
};

fs.writeFileSync(path.join(OUT, "30-recovery.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify({
  productTruthMutated: result.productTruthMutated,
  identity14Unchanged: result.identity14Unchanged,
  identity13Unchanged: result.identity13Unchanged,
  identity16Unchanged: result.identity16Unchanged,
  d16n: result.d16n,
  recover14tracked: recover14.trackedAdded,
  recover13tracked: recover13.trackedAdded,
  archive13: archive13.ok,
  archive14: archive14.ok,
}, null, 2));
