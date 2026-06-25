/**
 * Slate results snapshot tests.
 * Usage: node betbrain-server/scripts/testSlateResultsSnapshot.js
 */
import assert from "assert";

import {
  buildSlateResultsSnapshot,
  formatSnapshotLine,
} from "../services/slateResultsSnapshot.js";

function makeProp(overrides = {}) {
  return {
    player: "Test Player",
    team: "TeamA",
    opponent: "TeamB",
    league: "WNBA",
    side: "Over",
    line: 14.5,
    stat: "Points",
    slateDate: "2026-06-24",
    status: "win",
    actualStat: 20,
    resultMargin: 5.5,
    bestSixRank: 1,
    trackingType: "TEST",
    ...overrides,
  };
}

function testBuildsFromGradedProps() {
  const snapshot = buildSlateResultsSnapshot(
    [
      makeProp({ status: "win", resultMargin: 8 }),
      makeProp({ player: "Loser", status: "loss", resultMargin: -3 }),
      makeProp({ player: "Pending", status: "pending" }),
    ],
    { slateDate: "2026-06-24" }
  );

  assert.strictEqual(snapshot.snapshotMissing, false);
  assert.strictEqual(snapshot.winsCount, 1);
  assert.strictEqual(snapshot.lossesCount, 1);
  assert.strictEqual(snapshot.gradedCount, 2);
  assert.ok(snapshot.winningProps[0].formattedLine.includes("[WIN]"));
  assert.ok(snapshot.losingProps[0].formattedLine.includes("[LOSS]"));
}

function testSortsByMargin() {
  const snapshot = buildSlateResultsSnapshot(
    [
      makeProp({ player: "Small Win", status: "win", resultMargin: 1 }),
      makeProp({ player: "Big Win", status: "win", resultMargin: 10 }),
      makeProp({ player: "Small Loss", status: "loss", resultMargin: -1 }),
      makeProp({ player: "Big Loss", status: "loss", resultMargin: -8 }),
    ],
    { slateDate: "2026-06-24" }
  );

  assert.strictEqual(snapshot.winningProps[0].player, "Big Win");
  assert.strictEqual(snapshot.losingProps[0].player, "Big Loss");
  assert.strictEqual(snapshot.biggestWins.length, 2);
  assert.strictEqual(snapshot.biggestMisses.length, 2);
}

function testMissingWhenNoGraded() {
  const snapshot = buildSlateResultsSnapshot(
    [makeProp({ status: "pending" })],
    { slateDate: "2026-06-24" }
  );
  assert.strictEqual(snapshot.snapshotMissing, true);
}

function testFormatLine() {
  const line = formatSnapshotLine({
    result: "WIN",
    player: "A'ja Wilson",
    side: "OVER",
    line: 22.5,
    stat: "Points",
    actual: 28,
    margin: 5.5,
  });
  assert.ok(line.includes("[WIN]"));
  assert.ok(line.includes("margin +5.5"));
}

function run() {
  const tests = [
    ["builds from graded props", testBuildsFromGradedProps],
    ["sorts by margin", testSortsByMargin],
    ["missing when no graded", testMissingWhenNoGraded],
    ["format line", testFormatLine],
  ];

  for (const [name, fn] of tests) {
    fn();
    console.log(`✓ ${name}`);
  }

  console.log(`\nAll ${tests.length}/${tests.length} slate results snapshot tests passed.`);
}

run();
