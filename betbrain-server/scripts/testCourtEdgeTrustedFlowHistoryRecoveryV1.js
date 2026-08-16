/**
 * Product Truth Trusted / Lab / History lifecycle tests.
 * Read-only vs frozen 8/13 and 8/14 canonical identities. Does not remint.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getCanonicalRecordsBySlate, toProductTruthCard } from "../services/courtEdgeCanonicalPredictionRecordV1.js";
import { buildHomeProductTruthSectionsV3 } from "../services/courtEdgeHomeProductTruthSectionsV3.js";
import {
  summarizeCanonicalSlate,
  assembleHistoryArchives,
  attachProductTruthLab,
  mergeCanonicalIntoTrackedProps,
  canonicalRecordToTrackedMirror,
  newestFullyGradedProductTruthSlate,
  PRODUCT_TRUTH_LIFECYCLE_BUILD,
} from "../services/courtEdgeProductTruthLifecycleV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CAL = path.join(ROOT, "research/courteedge-two-slate-deep-calibration-v1");

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const recs14 = getCanonicalRecordsBySlate("2026-08-14");
const recs13 = getCanonicalRecordsBySlate("2026-08-13");
const recs16 = getCanonicalRecordsBySlate("2026-08-16");
const cards14 = recs14.map(toProductTruthCard).filter(Boolean);
const trusted14 = cards14.filter((c) => c.membership === "OFFICIAL");
const sections14 = buildHomeProductTruthSectionsV3({
  trusted: trusted14,
  full: cards14,
});
const summary14 = summarizeCanonicalSlate("2026-08-14", recs14);
const summary13 = summarizeCanonicalSlate("2026-08-13", recs13);

const freeze14 = JSON.parse(
  fs.readFileSync(path.join(CAL, "00-freeze/pregame-full-50.json"), "utf8")
);
const freezeRows = freeze14.records || freeze14.rows || [];

test("1 Full candidate becomes frozen Product Truth (8/14 N=50)", () => {
  assert.equal(recs14.length, 50);
  assert.ok(recs14.every((r) => r.canonicalPropId && r.side && r.line != null));
});

test("2 Best is membership on same row", () => {
  const fullIds = new Set(cards14.map((c) => c.canonicalPropId));
  for (const row of sections14.bestAvailable || []) {
    assert.ok(fullIds.has(row.canonicalPropId));
  }
  assert.equal(sections14.bestAvailable.length, 10);
});

test("3 Trusted is membership on same row", () => {
  const fullIds = new Set(cards14.map((c) => c.canonicalPropId));
  assert.equal(trusted14.length, 15);
  for (const row of trusted14) {
    assert.ok(fullIds.has(row.canonicalPropId));
  }
});

test("4 Trusted=0 valid (8/13)", () => {
  assert.equal(summary13.trustedN, 0);
  assert.equal(summary13.n, 45);
  assert.equal(summary13.fullyGraded, true);
});

test("5 Trusted>0 valid (8/14)", () => {
  assert.equal(summary14.trustedN, 15);
  assert.equal(summary14.full.record, "24-26");
  assert.equal(summary14.trusted.record, "7-8");
});

test("6 Frozen prediction enters Results mirror without remint", () => {
  const mirror = canonicalRecordToTrackedMirror(recs14[0]);
  assert.equal(mirror.canonicalPropId, recs14[0].canonicalPropId);
  assert.equal(mirror.side, recs14[0].side);
  assert.equal(Number(mirror.line), Number(recs14[0].line));
  assert.equal(mirror.projection, recs14[0].projection);
  assert.equal(mirror.predictedProbability, recs14[0].predictedProbability);
  assert.equal(mirror.productTruthProvenance, "CANONICAL_PREDICTIONS_V1");
});

test("7 Result appends grade without changing pregame fields", () => {
  const r = recs14.find((x) => x.result?.grade);
  assert.ok(r);
  const frozen = r.frozenPredictionFields || {};
  if (frozen.side) assert.equal(r.side, frozen.side);
  if (frozen.line != null) assert.equal(Number(r.line), Number(frozen.line));
  assert.ok(["WIN", "LOSS", "PUSH"].includes(String(r.result.grade).toUpperCase()));
});

test("8 Fully graded cohort enters Lab", () => {
  const newest = newestFullyGradedProductTruthSlate();
  assert.equal(newest.slateDateCt, "2026-08-14");
  const lab = attachProductTruthLab({ slateDate: "2026-08-05", currentSlate: { slateDate: "2026-08-05" } });
  assert.equal(lab.slateDate, "2026-08-14");
  assert.equal(lab.productTruth.fullN, 50);
  assert.equal(lab.productTruth.trustedN, 15);
});

test("9 Prior Lab archives to History (8/13 present, 8/14 excluded as current Lab)", () => {
  const archives = assembleHistoryArchives({
    diskArchives: [],
    currentLabSlateDate: "2026-08-14",
    today: "2026-08-16",
  });
  const dates = archives.map((a) => a.slateDate);
  assert.ok(dates.includes("2026-08-13"));
  assert.ok(!dates.includes("2026-08-14"));
  const e13 = archives.find((a) => a.slateDate === "2026-08-13");
  assert.equal(e13.phase, "ARCHIVED");
  assert.equal(e13.architectureEra, "PRE_V3_INCOMPLETE_STACK");
  assert.ok(e13.props.length === 45);
});

test("10 History persist shape does not require daily-slate-reports", () => {
  const archives = assembleHistoryArchives({
    diskArchives: [],
    currentLabSlateDate: "2026-08-14",
    today: "2026-08-16",
  });
  assert.ok(archives.some((e) => e.slateDate === "2026-08-13"));
  assert.ok(archives.every((e) => (e.leagues || []).includes("WNBA")));
});

test("11 8/14 Full 50 survives lifecycle", () => {
  assert.equal(summary14.fullN, 50);
  assert.equal(summary14.gradedN, 50);
});

test("12 8/14 Trusted 15 survives", () => {
  assert.equal(summary14.trustedN, 15);
});

test("13 8/14 grades survive vs freeze identities", () => {
  assert.equal(freezeRows.length, 50);
  const freezeKeys = new Set(
    freezeRows.map((r) =>
      `${r.playerName || r.player}|${r.propType}|${r.side}|${r.line}`
    )
  );
  for (const r of recs14) {
    const k = `${r.playerName}|${r.propType}|${r.side}|${r.line}`;
    assert.ok(freezeKeys.has(k), `missing freeze identity ${k}`);
    assert.ok(["WIN", "LOSS", "PUSH"].includes(String(r.result?.grade || "").toUpperCase()));
  }
});

test("14 8/13 legacy fields preserved", () => {
  assert.equal(recs13.length, 45);
  assert.equal(summary13.architectureEra, "PRE_V3_INCOMPLETE_STACK");
  assert.ok(recs13.every((r) => r.membership !== "OFFICIAL"));
});

test("15 missing legacy fields remain N/A (not backfilled)", () => {
  const mirror = canonicalRecordToTrackedMirror(recs13[0]);
  assert.equal(mirror.architectureEra, "PRE_V3_INCOMPLETE_STACK");
  // Do not invent current calibration fields that were absent.
  if (recs13[0].riskV2 == null) assert.ok(mirror.riskV2 == null);
});

test("16 no duplicate props on 8/14 canonical", () => {
  const ids = recs14.map((r) => r.canonicalPropId);
  assert.equal(new Set(ids).size, ids.length);
});

test("17 no duplicate grading", () => {
  for (const r of recs14) {
    const grades = [r.result?.grade, r.grade].filter(Boolean);
    const uniq = new Set(grades.map((g) => String(g).toUpperCase()));
    assert.ok(uniq.size <= 1 || [...uniq].every((g) => g === String(r.result.grade).toUpperCase()));
  }
});

test("18 no current-model recalculation of old data", () => {
  const r = recs14[0];
  const p = r.predictedProbability;
  const again = summarizeCanonicalSlate("2026-08-14", recs14);
  const same = getCanonicalRecordsBySlate("2026-08-14")[0];
  assert.equal(same.predictedProbability, p);
  assert.equal(again.n, 50);
});

test("24 zero Trusted does not block Full grading", () => {
  assert.equal(summary13.trustedN, 0);
  assert.equal(summary13.gradedN, 45);
  assert.equal(summary13.fullyGraded, true);
});

test("25 Full research pool can still reach Lab/History", () => {
  const merged = mergeCanonicalIntoTrackedProps([]);
  assert.ok(merged.filter((p) => p.slateDate === "2026-08-14").length === 50);
  assert.ok(merged.filter((p) => p.slateDate === "2026-08-13").length === 45);
});

test("8/16 Product Truth remains uningested (not reminted)", () => {
  assert.equal(recs16.length, 0);
});

test("lifecycle build stamped", () => {
  assert.equal(PRODUCT_TRUTH_LIFECYCLE_BUILD, "courteedge-product-truth-lifecycle-v1");
});

if (process.exitCode) {
  console.error("SOME TESTS FAILED");
} else {
  console.log("ALL TESTS PASSED");
}
