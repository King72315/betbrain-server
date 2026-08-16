/**
 * Ingest authentic 2026-08-16 frozen research packets into Product Truth.
 * Does not remint 8/13 or 8/14. Does not fetch current odds. Does not ESPN-grade.
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
  ingestFullSlateToCanonical,
  applyOfficialMembershipFromFullPool,
  loadFrozenPacketsForSlate,
} from "../../services/courtEdgeFullSlateHomeV1.js";
import {
  summarizeCanonicalSlate,
} from "../../services/courtEdgeProductTruthLifecycleV1.js";
import { toProductTruthCard } from "../../services/courtEdgeCanonicalPredictionRecordV1.js";
import { buildHomeProductTruthSectionsV3 as buildSections } from "../../services/courtEdgeHomeProductTruthSectionsV3.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CANONICAL = path.join(ROOT, "canonical-predictions-v1.json");
const OUT = path.join(
  ROOT,
  "research/courteedge-trusted-flow-history-recovery-v1"
);

function sha(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}
function fp(rows) {
  return (rows || []).map((r) => ({
    id: r.canonicalPropId,
    player: r.playerName,
    propType: r.propType,
    side: r.side,
    line: r.line,
    projection: r.projection,
    fairLine: r.fairLine,
    predictedProbability: r.predictedProbability,
    safetyScore: r.safetyScore,
    risk: r.risk,
    membership: r.membership,
    grade: r.result?.grade || null,
  }));
}
function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const loaded = loadFrozenPacketsForSlate("2026-08-16");
const packetHash = loaded.file ? sha(loaded.file) : null;
const beforeHash = sha(CANONICAL);
const before13 = fp(getCanonicalRecordsBySlate("2026-08-13"));
const before14 = fp(getCanonicalRecordsBySlate("2026-08-14"));
const before16 = fp(getCanonicalRecordsBySlate("2026-08-16"));
const storeBeforeN = (loadCanonicalPredictionStore().records || []).length;

const ingest = ingestFullSlateToCanonical("2026-08-16", { persist: true });
const official = applyOfficialMembershipFromFullPool("2026-08-16");

const after13 = fp(getCanonicalRecordsBySlate("2026-08-13"));
const after14 = fp(getCanonicalRecordsBySlate("2026-08-14"));
const recs16 = getCanonicalRecordsBySlate("2026-08-16");
const cards = recs16.map(toProductTruthCard).filter(Boolean);
const trusted = cards.filter((c) => c.membership === "OFFICIAL");
const sections = buildSections({ trusted, full: cards });
const summary = summarizeCanonicalSlate("2026-08-16", recs16);
const afterHash = sha(CANONICAL);

const result = {
  ok: true,
  ingested16: true,
  graded16: false,
  remintedOdds: false,
  packetFile: loaded.file,
  packetHash,
  canonicalHashBefore: beforeHash,
  canonicalHashAfter: afterHash,
  storeBeforeN,
  storeAfterN: (loadCanonicalPredictionStore().records || []).length,
  identity13Unchanged: same(before13, after13),
  identity14Unchanged: same(before14, after14),
  before16n: before16.length,
  ingest: {
    packetCount: ingest.packetCount,
    ingested: ingest.ingested,
    inserted: ingest.upserted?.inserted,
    updated: ingest.upserted?.updated,
  },
  official,
  summary16: summary,
  sections: {
    full: sections.fullCount,
    best: sections.bestAvailableCount,
    trusted: sections.trustedCount,
  },
  trustedRows: trusted.map((c) => ({
    player: c.player,
    propType: c.propType,
    side: c.side,
    line: c.line,
    projection: c.projection,
    predictedProbability: c.predictedProbability,
    decisionScoreV2: c.decisionScoreV2,
    safetyScore: c.safetyScore,
    risk: c.risk,
  })),
};

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "40-aug16-ingest.json"), JSON.stringify(result, null, 2));
console.log(
  JSON.stringify(
    {
      identity13Unchanged: result.identity13Unchanged,
      identity14Unchanged: result.identity14Unchanged,
      ingested: result.ingest,
      officialCount: official.officialCount,
      promoted: official.promoted,
      summary16: {
        n: summary.n,
        full: summary.fullN,
        best: summary.bestN,
        trusted: summary.trustedN,
        byStat: summary.byStat,
        bySide: summary.bySide,
      },
      trustedRows: result.trustedRows,
    },
    null,
    2
  )
);
