/**
 * History 3-Slate Groups v1 tests
 * Usage: node betbrain-server/scripts/testHistoryThreeSlateGroupsV1.js
 */
import assert from "node:assert/strict";

import { buildSignalPerformanceTable } from "../services/signalPerformanceV1.js";
import {
  buildHistoryThreeSlateGroups,
  HISTORY_THREE_SLATE_GROUPS_VERSION,
  getLatestCompleteThreeSlateGroup,
} from "../services/historyThreeSlateGroupsV1.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

function makeProp(slateDate, status = "win", margin = 2) {
  return {
    player: `Player-${slateDate}`,
    slateDate,
    status,
    resultMargin: status === "loss" ? -Math.abs(margin) : margin,
    currentEngineSide: "Over",
    riskLabel: "Low Risk",
    tier: "LEAN",
    confidence: 60,
    line: 15,
    signalSnapshot: {
      last5Signal: "supports_side",
      seasonAverageSignal: "supports_side",
      confidenceBucket: "60-69",
      projectionEdgeBucket: "2.5-3.9",
    },
  };
}

function makeArchive(slateDate, wins = 2, losses = 1) {
  const props = [];
  for (let i = 0; i < wins; i++) props.push(makeProp(slateDate, "win", 3));
  for (let i = 0; i < losses; i++) props.push(makeProp(slateDate, "loss", -2));

  return {
    slateDate,
    phase: "ARCHIVED",
    props,
    report: {
      signalPerformance: buildSignalPerformanceTable(props, { slateDate }),
    },
  };
}

test("buildHistoryThreeSlateGroups groups archived slates by 3", () => {
  const archives = [
    makeArchive("2026-06-19"),
    makeArchive("2026-06-20"),
    makeArchive("2026-06-21"),
    makeArchive("2026-06-22"),
    makeArchive("2026-06-23"),
  ];

  const payload = buildHistoryThreeSlateGroups(archives);
  assert.strictEqual(payload.version, HISTORY_THREE_SLATE_GROUPS_VERSION);
  assert.strictEqual(payload.archivedSlateCount, 5);
  assert.strictEqual(payload.groupCount, 2);
  assert.strictEqual(payload.completeGroupCount, 1);

  const complete = payload.groups.find((g) => !g.incomplete);
  assert.ok(complete);
  assert.strictEqual(complete.slateDates.length, 3);
  assert.ok(complete.wins > 0);
  assert.ok(complete.topSignalHelpers !== undefined);
  assert.ok(complete.riskBucketBreakdown.LOW);
  assert.ok(complete.sideBreakdown.Over);
});

test("comparison notes generated vs prior block", () => {
  const archives = [
    makeArchive("2026-06-19", 1, 2),
    makeArchive("2026-06-20", 1, 2),
    makeArchive("2026-06-21", 1, 2),
    makeArchive("2026-06-22", 3, 0),
    makeArchive("2026-06-23", 3, 0),
    makeArchive("2026-06-24", 3, 0),
  ];

  const payload = buildHistoryThreeSlateGroups(archives);
  const newerComplete = payload.groups.find(
    (g) => !g.incomplete && g.slateDates.includes("2026-06-24")
  );
  assert.ok(newerComplete);
  assert.ok(newerComplete.comparison?.hasPrevious);
  assert.ok((newerComplete.comparison?.notes || []).length > 0);
});

test("incomplete final group when slate count not divisible by 3", () => {
  const archives = [makeArchive("2026-06-21"), makeArchive("2026-06-22")];
  const payload = buildHistoryThreeSlateGroups(archives);
  assert.strictEqual(payload.groupCount, 1);
  assert.strictEqual(payload.groups[0].incomplete, true);
});

test("getLatestCompleteThreeSlateGroup returns newest complete block", () => {
  const archives = [
    makeArchive("2026-06-19"),
    makeArchive("2026-06-20"),
    makeArchive("2026-06-21"),
    makeArchive("2026-06-22"),
  ];
  const payload = buildHistoryThreeSlateGroups(archives);
  const latest = getLatestCompleteThreeSlateGroup(payload);
  assert.ok(latest);
  assert.strictEqual(latest.incomplete, false);
});

test("LAB phase archives excluded by default", () => {
  const archives = [
    { ...makeArchive("2026-06-21"), phase: "LAB" },
    makeArchive("2026-06-22"),
  ];
  const payload = buildHistoryThreeSlateGroups(archives);
  assert.strictEqual(payload.archivedSlateCount, 1);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
