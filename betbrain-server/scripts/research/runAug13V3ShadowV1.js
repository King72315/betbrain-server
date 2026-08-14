/**
 * 8/13 V3 SHADOW — counterfactual only. Does NOT rewrite historical product truth.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadCanonicalPredictionStore } from "../../services/courtEdgeCanonicalPredictionRecordV1.js";
import {
  buildHomeProductTruthSectionsV3,
  hasCompleteTrustedPacketV3,
} from "../../services/courtEdgeHomeProductTruthSectionsV3.js";
import { selectHomeBoardMarketWeaveV1 } from "../../services/courtEdgeHomeMarketWeaveV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(
  __dirname,
  "..",
  "..",
  "research",
  "courteedge-grade-a-recovery-v3",
  "20-aug13-shadow"
);
fs.mkdirSync(OUT, { recursive: true });

const SLATE = "2026-08-13";
const store = loadCanonicalPredictionStore();
const cohort = (store.records || []).filter(
  (r) => String(r.slateDateCt || "").slice(0, 10) === SLATE
);

function gradeOf(r) {
  return String(r.grade || r.result?.grade || "PENDING").toUpperCase();
}

function wl(rows) {
  const WIN = rows.filter((r) => gradeOf(r) === "WIN").length;
  const LOSS = rows.filter((r) => gradeOf(r) === "LOSS").length;
  const n = WIN + LOSS;
  return {
    WIN,
    LOSS,
    n,
    hit: n ? Number((WIN / n).toFixed(4)) : null,
    record: `${WIN}-${LOSS}`,
  };
}

const byType = { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 };
for (const r of cohort) {
  if (byType[r.propType] != null) byType[r.propType] += 1;
}

const official = cohort.filter(
  (r) => r.membership === "OFFICIAL" || r.officialSelected === true
);
const research = cohort.filter((r) => r.membership !== "OFFICIAL");

const weave = selectHomeBoardMarketWeaveV1(cohort, { maxBoard: 10 });
const sections = buildHomeProductTruthSectionsV3({
  trusted: official,
  full: cohort,
  bestAvailableDisplayMax: 10,
});

const completeN = cohort.filter((r) => hasCompleteTrustedPacketV3(r).ok).length;
const incompleteReasons = {};
for (const r of cohort) {
  const g = hasCompleteTrustedPacketV3(r);
  if (g.ok) continue;
  for (const reason of g.reasons) {
    incompleteReasons[reason] = (incompleteReasons[reason] || 0) + 1;
  }
}

const globalTop10 = [...cohort]
  .sort(
    (a, b) =>
      Number(b.decisionScoreV2 || b.modelWinProbability || 0) -
      Number(a.decisionScoreV2 || a.modelWinProbability || 0)
  )
  .slice(0, 10);

const artifact = {
  label: "SHADOW_NOT_HISTORICAL_PRODUCT_TRUTH",
  slateDateCt: SLATE,
  note: "Original 8/13 freezes preserved. This is counterfactual membership under V3 rules.",
  original: {
    candidateCount: cohort.length,
    byType,
    fullWl: wl(cohort),
    homeWeaveWl: wl(weave.selectedPackets || []),
    officialCount: official.length,
    officialWl: wl(official),
  },
  v3Shadow: {
    candidateCount: cohort.length,
    byTypeUnchanged: byType,
    note: "Candidate count unchanged because 8/13 freeze already truncated; V3 removes future truncation only.",
    trustedCount: sections.trustedCount,
    trustedWl: wl(sections.trusted),
    bestAvailableWl: wl(sections.bestAvailable),
    fullWl: wl(sections.fullPredictions),
    globalTop10Wl: wl(globalTop10),
    completeTrustedPacketN: completeN,
    incompleteReasons,
    marketBalancedWeave: false,
    forcedHomeFill: false,
  },
  interpretation: [
    "Original Official=0 remains 0 under V3 because odds-only packets fail complete Trusted gate.",
    "Best Available shows honest non-trusted top quality (not labeled Official).",
    "Weave no longer production authority; global Top10 W-L remains 5-5 on this slate (ranking still weak on odds-implied scores).",
    "Do not treat any W-L change here as Grade-A proof.",
  ],
};

fs.writeFileSync(
  path.join(OUT, "aug13-v3-shadow.json"),
  JSON.stringify(artifact, null, 2)
);
console.log(JSON.stringify(artifact, null, 2));
