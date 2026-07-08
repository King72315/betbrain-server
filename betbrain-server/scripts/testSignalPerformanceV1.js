/**
 * Signal Performance v1 tests
 * Usage: node betbrain-server/scripts/testSignalPerformanceV1.js
 */
import assert from "node:assert/strict";

import {
  buildSignalPerformanceTable,
  classifySignalImpact,
  aggregateSignalRows,
  SIGNAL_PERFORMANCE_VERSION,
  SMALL_SAMPLE_THRESHOLD,
} from "../services/signalPerformanceV1.js";

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

function makeProp(overrides = {}) {
  return {
    player: "Test Player",
    stat: "Points",
    slateDate: "2026-06-21",
    currentEngineSide: "Over",
    line: 20,
    confidence: 62,
    riskLabel: "Low Risk",
    tier: "LEAN",
    status: "win",
    resultMargin: 3,
    fairLineEdge: 2.5,
    fairLineEdgeBucket: "2.5-3.9",
    confidenceBucket: "60-69",
    dataMode: "FULL",
    bookCountBucket: "5+",
    marketQualityBucket: "adequate",
    supportDangerGapBucket: "10-19",
    minutesStabilityScore: 72,
    trueRisk: "LOW",
    flipFirstLabels: { collision: "CLEAR", usage: "STABLE" },
    signalSnapshot: {
      last5Signal: "supports_side",
      seasonAverageSignal: "supports_side",
      opponentDefenseSignal: "supportive",
      usageMinutesSignal: "stable",
      injuryAvailabilitySignal: "clear",
      homeAwaySignal: "home_support",
      restTravelSignal: "rest_support",
      paceSignal: "pace_support",
      marketSignal: "adequate_market",
      supportDangerGapBucket: "10-19",
      confidenceBucket: "60-69",
      projectionEdgeBucket: "2.5-3.9",
    },
    ...overrides,
  };
}

test("classifySignalImpact helped on strong win rate", () => {
  const result = classifySignalImpact({ winRate: 66.7, avgMargin: 1.2, decided: 3 });
  assert.strictEqual(result.status, "helped");
});

test("classifySignalImpact hurt on weak win rate", () => {
  const result = classifySignalImpact({ winRate: 33.3, avgMargin: -2.1, decided: 3 });
  assert.strictEqual(result.status, "hurt");
});

test("classifySignalImpact neutral on mixed signals", () => {
  const result = classifySignalImpact({ winRate: 50, avgMargin: 0.1, decided: 4 });
  assert.strictEqual(result.status, "neutral");
});

test("buildSignalPerformanceTable includes all signal categories", () => {
  const props = [
    makeProp({ status: "win", resultMargin: 4 }),
    makeProp({ player: "B", status: "loss", resultMargin: -2, currentEngineSide: "Under" }),
    makeProp({ player: "C", status: "win", resultMargin: 1 }),
  ];

  const table = buildSignalPerformanceTable(props, { slateDate: "2026-06-21" });
  assert.strictEqual(table.version, SIGNAL_PERFORMANCE_VERSION);
  assert.strictEqual(table.slateDate, "2026-06-21");
  assert.ok(table.rows.length > 20, "expected many signal rows");
  assert.ok(table.byCategory.projectionEdgeBucket?.length > 0);
  assert.ok(table.byCategory.trueRiskBucket?.length > 0);
  assert.ok(table.byCategory.flipFirst?.length > 0);
});

test("small samples are visible not hidden", () => {
  const props = [makeProp({ status: "win" })];
  const table = buildSignalPerformanceTable(props);
  const smallRows = table.rows.filter((row) => row.smallSample);
  assert.ok(smallRows.length > 0);
  assert.ok(smallRows.every((row) => row.smallSampleNote));
});

test("rows include raw records", () => {
  const props = [makeProp()];
  const table = buildSignalPerformanceTable(props);
  const row = table.rows[0];
  assert.ok(Array.isArray(row.rawRecords));
  assert.strictEqual(row.rawRecords[0].player, "Test Player");
});

test("aggregateSignalRows merges rows across slates", () => {
  const tableA = buildSignalPerformanceTable([makeProp({ status: "win" })], {
    slateDate: "2026-06-21",
  });
  const tableB = buildSignalPerformanceTable(
    [makeProp({ player: "B", status: "loss", resultMargin: -1 })],
    { slateDate: "2026-06-22" }
  );
  const merged = aggregateSignalRows([...tableA.rows, ...tableB.rows]);
  const tierRow = merged.find((row) => row.signalCategory === "tier" && row.value === "LEAN");
  assert.ok(tierRow);
  assert.strictEqual(tierRow.wins, 1);
  assert.strictEqual(tierRow.losses, 1);
});

test("threshold constants exported", () => {
  assert.strictEqual(SMALL_SAMPLE_THRESHOLD, 3);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
