/**
 * Full Prop Detail Copy V1 — read-only frozen packet export tests.
 * Does not mutate Product Truth. Does not rescore.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  formatFullPropDetailPacket,
  formatFullPropDetailCopyReport,
  formatStoredProbability,
  FULL_PROP_DETAIL_COPY_BUILD,
} from "../../utils/courtEdgeFullPropDetailCopyV1.js";
import { formatCopyReportFromCanonical } from "../services/courtEdgeSingleProductTruthApiV1.js";
import { getProductTruthCopyReport } from "../services/courtEdgeProductTruthUiCutoverV1.js";
import { toProductTruthView } from "../../utils/courtEdgeProductTruthV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const CAL = path.join(
  ROOT,
  "research/courteedge-two-slate-deep-calibration-v1"
);

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

const trustedFreeze = JSON.parse(
  fs.readFileSync(path.join(CAL, "00-freeze/pregame-trusted-15.json"), "utf8")
);
const fullFreeze = JSON.parse(
  fs.readFileSync(path.join(CAL, "00-freeze/pregame-full-50.json"), "utf8")
);
const trustedGraded = JSON.parse(
  fs.readFileSync(path.join(CAL, "01-aug14-final-50/trusted-15-graded.json"), "utf8")
);
const fullGraded = JSON.parse(
  fs.readFileSync(path.join(CAL, "01-aug14-final-50/full-50-graded.json"), "utf8")
);

const trustedFreezeRows = trustedFreeze.records || trustedFreeze.rows || [];
const fullFreezeRows = fullFreeze.records || fullFreeze.rows || [];
const trustedGradedRows = trustedGraded.records || [];
const fullGradedRows = fullGraded.records || [];

test("probability formatter does not integer-round 69.8 → 70", () => {
  assert.strictEqual(formatStoredProbability(0.698), "69.8%");
  assert.strictEqual(formatStoredProbability(0.7062), "70.6%");
  assert.notStrictEqual(formatStoredProbability(0.7062), "71%");
});

const carletonReb = trustedGradedRows.find(
  (r) =>
    String(r.playerName || r.player || "").includes("Carleton") &&
    r.propType === "REBOUNDS"
);
assert.ok(carletonReb, "Carleton REB graded row missing");

test("8/14 Carleton REB copy exposes stored predictedProbability AND decisionScoreV2", () => {
  const text = formatFullPropDetailPacket(carletonReb, 1);
  assert.ok(text.includes("Predicted Probability: 89.6%"), text.slice(0, 800));
  assert.ok(text.includes("Probability Field: predictedProbability"));
  assert.ok(text.includes("decisionScoreV2: 70.6%"));
  assert.ok(text.includes("modelWinProbability: 70.6%"));
  assert.ok(!/^Predicted Probability: 71%/m.test(text));
  assert.ok(text.includes("Projection: 7.1"));
  assert.ok(text.includes("Fair Line: 7.2"));
  assert.ok(text.includes("Safety: 73"));
  assert.ok(text.includes("RiskV2: HIGH"));
  assert.ok(text.includes("RESULT"));
  assert.ok(/\bWIN\b/.test(text));
  assert.ok(text.includes("Actual: 9 REB"));
});

test("missing historical fields print N/A — not stored (no fabrication)", () => {
  const text = formatFullPropDetailPacket(carletonReb, 1);
  assert.ok(text.includes("pOver: N/A — not stored"));
  assert.ok(text.includes("Expected Minutes: N/A — not stored"));
  assert.ok(text.includes("Season Average: N/A — not stored"));
  assert.ok(!text.toLowerCase().includes("fabricat"));
});

test("postgame result cannot appear as a pregame probability rewrite", () => {
  const text = formatFullPropDetailPacket(carletonReb, 1);
  const predIdx = text.indexOf("PREDICTION");
  const resultIdx = text.indexOf("\nRESULT");
  assert.ok(predIdx >= 0 && resultIdx > predIdx);
  const pregame = text.slice(0, resultIdx);
  assert.ok(!pregame.includes("Actual: 9"));
});

test("Copy one Trusted prop → full detail included", () => {
  const text = formatFullPropDetailPacket(trustedFreezeRows[0], 1);
  for (const heading of [
    "IDENTITY",
    "PREDICTION",
    "TRUST",
    "ROLE / DATA",
    "MARKET",
    "GAME ENVIRONMENT",
    "EXPOSURE",
    "WHY",
    "PROVENANCE",
  ]) {
    assert.ok(text.includes(heading), `missing ${heading}`);
  }
});

test("Copy all 15 Trusted — no truncation, each prop detailed", () => {
  const text = formatFullPropDetailCopyReport({
    cards: trustedGradedRows,
    slateDateCt: "2026-08-14",
    mode: "trusted",
    title: "TRUSTED/OFFICIAL",
  });
  assert.strictEqual(trustedGradedRows.length, 15);
  assert.ok(text.includes("N: 15"));
  for (let i = 1; i <= 15; i++) {
    assert.ok(text.includes(`[${i}] `), `missing [${i}]`);
  }
  assert.ok(text.includes("COURTEDGE PRODUCT TRUTH — FULL PROP DETAIL"));
});

test("Copy Full 50 — no truncation", () => {
  const text = formatFullPropDetailCopyReport({
    cards: fullGradedRows,
    slateDateCt: "2026-08-14",
    mode: "full",
    title: "FULL_PREDICTIONS",
  });
  assert.strictEqual(fullGradedRows.length, 50);
  assert.ok(text.includes("N: 50"));
  assert.ok(text.includes("[50] "));
  assert.ok(text.includes("[1] "));
});

test("Best Available copy uses freeze membership flags when present", () => {
  const best = fullFreezeRows.filter((r) => r.bestAvailableMembership === true);
  const text = formatFullPropDetailCopyReport({
    cards: best,
    slateDateCt: "2026-08-14",
    mode: "best",
    title: "BEST_AVAILABLE",
  });
  assert.ok(best.length >= 1, `best n=${best.length}`);
  assert.ok(text.includes("BEST_AVAILABLE"));
  assert.ok(text.includes("[1] "));
});

test("completed fields do not change if a live rescore hint is attached", () => {
  const poisoned = {
    ...carletonReb,
    liveRescoreProbability: 0.99,
    correctedProjection: 99,
  };
  const a = formatFullPropDetailPacket(carletonReb, 1);
  const b = formatFullPropDetailPacket(poisoned, 1);
  assert.ok(a.includes("Predicted Probability: 89.6%"));
  assert.ok(b.includes("Predicted Probability: 89.6%"));
  assert.ok(b.includes("Projection: 7.1"));
  assert.ok(!b.includes("Projection: 99"));
});

test("toProductTruthView no longer aliases Model score onto predictedProbability", () => {
  const view = toProductTruthView({
    predictedProbability: 0.698,
    modelWinProbability: 0.7062,
    decisionScoreV2: 0.7062,
    player: "Bridget Carleton",
    propType: "REBOUNDS",
    side: "OVER",
    line: 4.5,
    projection: 7.1,
  });
  assert.strictEqual(view.predictedProbability, 0.698);
  assert.strictEqual(view.modelWinProbability, 0.7062);
});

test("formatCopyReportFromCanonical default is full detail not one-liner Model=", () => {
  const text = formatCopyReportFromCanonical(trustedGradedRows.slice(0, 1), {
    title: "Official",
    slateDateCt: "2026-08-14",
  });
  assert.ok(text.includes("Predicted Probability:"));
  assert.ok(!text.includes("Model="));
  assert.ok(text.includes("Probability Field: predictedProbability"));
});

test("copy formatter module does not import Decision Engine", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "../utils/courtEdgeFullPropDetailCopyV1.js"),
    "utf8"
  );
  assert.ok(!src.includes("scoreCandidateV2"));
  assert.ok(!src.includes("courtEdgeDecisionEngineV2"));
  assert.ok(src.includes(FULL_PROP_DETAIL_COPY_BUILD));
});

test("optional live canonical copy for 8/14 if store present — no writes", () => {
  const freezeHashBefore = fs.readFileSync(
    path.join(CAL, "00-freeze/pregame-trusted-15.json"),
    "utf8"
  );
  let text = "";
  try {
    text = getProductTruthCopyReport({
      slateDateCt: "2026-08-14",
      cohort: "trusted",
    });
  } catch (err) {
    console.log("store copy skipped:", err.message);
    return;
  }
  const freezeHashAfter = fs.readFileSync(
    path.join(CAL, "00-freeze/pregame-trusted-15.json"),
    "utf8"
  );
  assert.strictEqual(freezeHashBefore, freezeHashAfter);
  if (text.includes("N: 0") || text.includes("No props")) {
    console.log("canonical store has no 8/14 rows — freeze-file tests cover copy");
    return;
  }
  assert.ok(text.includes("COURTEDGE PRODUCT TRUTH — FULL PROP DETAIL"));
  assert.ok(text.includes("Read-only: YES"));
});

if (process.exitCode) {
  console.log("Full Prop Detail Copy V1 tests FAILED");
} else {
  console.log("Full Prop Detail Copy V1 tests PASSED");
}
