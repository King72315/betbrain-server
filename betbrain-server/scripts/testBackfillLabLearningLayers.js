/**
 * Lab learning backfill tests — freeze preservation + report patch shape.
 */
import assert from "node:assert/strict";
import {
  reEnrichPropPreservingFreeze,
  LAB_LEARNING_OVERLAY_FIELDS,
} from "../services/backfillLabLearningLayersService.js";
import { attachOfficialLearningToReport } from "../services/officialLearningRecordBuilder.js";
import { LAB_LEARNING_VERSION } from "../services/labLearningEnrichmentService.js";

function gradedProp(overrides = {}) {
  return {
    trackedKey: "tk-test-1",
    slateDate: "2026-07-14",
    player: "Test Player",
    team: "dream",
    opponent: "tempo",
    league: "WNBA",
    side: "Over",
    line: 18.5,
    officialLine: 18.5,
    officialPropId: "official-test-1",
    status: "loss",
    actualStat: 12,
    resultMargin: -6.5,
    pregameSnapshot: {
      sealedAt: "2026-07-14T12:00:00.000Z",
      officialPropId: "official-test-1",
      player: "Test Player",
      side: "OVER",
      line: 18.5,
      projection: 21,
      confidence: 78,
    },
    decisionIntelligence: { trueRisk: "MEDIUM" },
    actualMinutes: 20,
    actualFGA: 10,
    ...overrides,
  };
}

function testPreservesOfficialPropIdAndPregame() {
  const before = gradedProp();
  const { prop: after, enriched } = reEnrichPropPreservingFreeze(before);
  assert.equal(enriched, true);
  assert.equal(after.officialPropId, "official-test-1");
  assert.equal(after.pregameSnapshot.sealedAt, before.pregameSnapshot.sealedAt);
  assert.equal(
    JSON.stringify(after.pregameSnapshot),
    JSON.stringify(before.pregameSnapshot)
  );
  assert.equal(after.labLearningVersion, LAB_LEARNING_VERSION);
  assert.ok(after.postgameTruth);
  assert.ok(after.missType);
}

function testOnlyLearningOverlayFields() {
  const before = gradedProp();
  const { prop: after } = reEnrichPropPreservingFreeze(before);
  for (const key of LAB_LEARNING_OVERLAY_FIELDS) {
    if (after[key] !== undefined) {
      assert.notEqual(after[key], undefined);
    }
  }
  assert.equal(after.player, before.player);
  assert.equal(after.team, before.team);
  assert.equal(after.status, before.status);
  assert.equal(after.actualStat, before.actualStat);
}

function testSkipsPending() {
  const { skipped, reason } = reEnrichPropPreservingFreeze(
    gradedProp({ status: "pending" })
  );
  assert.equal(skipped, true);
  assert.equal(reason, "not_graded");
}

function testReportLearningPatch() {
  const prop = gradedProp();
  const enriched = reEnrichPropPreservingFreeze(prop).prop;
  const base = {
    slateDate: "2026-07-14",
    reportStatus: "final",
    frozen: true,
    sections: { A: { totalOfficialProps: 1 } },
  };
  const patched = attachOfficialLearningToReport(base, [enriched]);
  assert.ok(patched.learningPackets?.length === 1);
  assert.ok(patched.labAggregateBreakdown);
  assert.ok(patched.officialLabDailySummary);
  assert.equal(patched.sections.A.totalOfficialProps, 1);
  assert.ok(patched.learningPackets[0].pregame);
  assert.ok(patched.learningPackets[0].postgame);
  assert.ok(patched.learningPackets[0].diagnosis);
}

const tests = [
  ["preserves officialPropId + sealed pregame", testPreservesOfficialPropIdAndPregame],
  ["only overlays learning fields", testOnlyLearningOverlayFields],
  ["skips pending props", testSkipsPending],
  ["report learning patch shape", testReportLearningPatch],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}
console.log(`\n${passed}/${tests.length} tests passed`);
