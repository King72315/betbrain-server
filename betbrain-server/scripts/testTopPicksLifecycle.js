/**
 * Top Picks lifecycle tests — snapshot reference-only, no duplicate tracking.
 * Usage: node betbrain-server/scripts/testTopPicksLifecycle.js
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { CONFIG } from "../config.js";
import { selectTopProps } from "../engines/topProps/topPropSelector.js";
import {
  saveTopPicksSnapshot,
  getTopPicksSnapshot,
  getActiveTopPicksSnapshot,
  buildTopPicksReview,
  clearActiveTopPicksSnapshot,
  attachGradedResultsToSnapshot,
} from "../services/topPicksSnapshotService.js";
import {
  addTrackedProps,
  getStableTrackedPropKey,
  getTrackedProps,
} from "../services/trackedPropService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SNAPSHOT_FILE = path.join(__dirname, "..", "top-picks-snapshots.json");
const TRACKED_FILE = path.join(__dirname, "..", "tracked-props.json");

function backupFile(file) {
  if (!fs.existsSync(file)) return null;
  const backup = `${file}.test-backup`;
  fs.copyFileSync(file, backup);
  return backup;
}

function restoreFile(file, backup) {
  if (backup && fs.existsSync(backup)) {
    fs.copyFileSync(backup, file);
    fs.unlinkSync(backup);
    return;
  }
  if (fs.existsSync(file)) {
    fs.unlinkSync(file);
  }
}

function makeWnbaPick(overrides = {}) {
  const reader = {
    finalSide: "OVER",
    decision: overrides.readerDecision || "TEST",
    readerConfidence: overrides.readerConfidence ?? 68,
    supports: ["Volume path supports over"],
    overCase: { score: overrides.overScore ?? overrides.bestPropScore ?? 50 },
    underCase: { score: overrides.underScore ?? 20 },
    ...overrides.reader,
  };

  return {
    player: overrides.player || "Test Player",
    team: overrides.team || "TeamA",
    opponent: "TeamB",
    line: overrides.line ?? 14.5,
    pick: "Over",
    side: "Over",
    league: "WNBA",
    slateDate: overrides.slateDate || "2026-06-23",
    commenceTime: "2026-06-23T23:00:00Z",
    tier: "WATCHLIST",
    confidence: 65,
    noPlay: false,
    engineHandled: "WNBA_V2",
    officialEligible: false,
    finalDecision: overrides.finalDecision || "TEST",
    trackingType: overrides.trackingType || "TEST",
    readerDecision: reader.decision,
    wnbaReader: reader,
    wnbaDataCard: {
      bookLine: overrides.line ?? 14.5,
      dataConfidenceScore: 72,
      projection: { projection: 18 },
      last5: { points: 17, minutes: 30, fga: 12 },
      bookCount: 5,
      dataMissingFlags: [],
    },
    ...overrides,
  };
}

function makeGame(picks) {
  return {
    gameId: "game-1",
    game: "Away @ Home",
    league: "WNBA",
    date: "2026-06-23",
    slateDate: "2026-06-23",
    commenceTime: "2026-06-23T23:00:00Z",
    isStarted: false,
    picks,
    allGeneratedCandidates: picks,
  };
}

function testMaxTwoInSnapshot() {
  const picks = [
    makeWnbaPick({ player: "A", overScore: 90, line: 10.5 }),
    makeWnbaPick({ player: "B", overScore: 80, line: 11.5 }),
    makeWnbaPick({ player: "C", overScore: 70, line: 12.5 }),
    makeWnbaPick({ player: "D", overScore: 60, line: 13.5 }),
  ];
  const result = selectTopProps([makeGame(picks)], { league: "WNBA" });
  assert.strictEqual(result.topProps.length, 2);

  const saved = saveTopPicksSnapshot(result.topProps, {
    slateDate: "2026-06-23",
    topSelectionAudit: result.topSelectionAudit,
  });
  assert.strictEqual(saved.snapshot.pickCount, 2);
  assert.strictEqual(saved.snapshot.picks.length, 2);
}

function testBestScoreSelected() {
  const picks = [
    makeWnbaPick({ player: "Low", overScore: 20, line: 10.5 }),
    makeWnbaPick({ player: "High", overScore: 95, line: 11.5 }),
  ];
  const result = selectTopProps([makeGame(picks)], { league: "WNBA" });
  assert.strictEqual(result.topProps[0].player, "High");
}

function testSnapshotReferenceOnlyNotTracked() {
  const pick = makeWnbaPick({
    player: `Snapshot Only ${Date.now()}`,
    overScore: 88,
  });
  const key = getStableTrackedPropKey(pick);
  const referencePick = { ...pick, isTopPickReference: true };

  addTrackedProps([referencePick], { skipTopPickReferences: true });

  const tracked = getTrackedProps();
  const matches = tracked.filter(
    (item) => (item.trackedKey || getStableTrackedPropKey(item)) === key
  );
  assert.strictEqual(matches.length, 0);
}

function testNoDuplicateTrackedCount() {
  const pick = makeWnbaPick({
    player: `Tracked Once ${Date.now()}`,
    overScore: 77,
  });
  const key = getStableTrackedPropKey(pick);

  saveTopPicksSnapshot([pick], { slateDate: "2026-06-23" });
  addTrackedProps([pick]);
  const afterFirst = getTrackedProps().filter(
    (item) => (item.trackedKey || getStableTrackedPropKey(item)) === key
  );
  addTrackedProps([pick]);
  const afterSecond = getTrackedProps().filter(
    (item) => (item.trackedKey || getStableTrackedPropKey(item)) === key
  );

  assert.strictEqual(afterFirst.length, 1);
  assert.strictEqual(afterSecond.length, 1);
  assert.ok(key);
}

function testLabReviewSubsetNotDoubleCount() {
  const slateDate = "2026-06-23";
  const topPick = makeWnbaPick({
    player: "Top One",
    overScore: 99,
    status: "win",
  });
  const other = makeWnbaPick({
    player: "Other",
    overScore: 40,
    status: "loss",
  });

  saveTopPicksSnapshot([topPick], { slateDate });
  const tracked = [
    { ...topPick, trackedKey: getStableTrackedPropKey(topPick), status: "win" },
    { ...other, trackedKey: getStableTrackedPropKey(other), status: "loss" },
  ];

  const review = buildTopPicksReview(slateDate, tracked);
  assert.ok(review);
  assert.strictEqual(review.record.total, 1);
  assert.strictEqual(review.subsetAnalysisOnly, true);
  assert.strictEqual(review.vsRestOfSlate.restPropCount, 1);
  assert.strictEqual(review.vsRestOfSlate.restRecord.losses, 1);
}

function testAttachGradedResults() {
  const slateDate = "2026-06-23";
  const pick = makeWnbaPick({ player: "Grader", overScore: 85 });
  saveTopPicksSnapshot([pick], { slateDate });

  const tracked = [
    {
      ...pick,
      trackedKey: getStableTrackedPropKey(pick),
      status: "win",
      actualStat: 22,
    },
  ];

  const attached = attachGradedResultsToSnapshot(slateDate, tracked);
  assert.strictEqual(attached.ok, true);
  assert.strictEqual(attached.snapshot.picks[0].status, "win");
}

function testClearActiveAfterHistoryTransition() {
  const slateDate = "2026-06-22";
  saveTopPicksSnapshot([makeWnbaPick({ slateDate })], { slateDate });
  assert.ok(getActiveTopPicksSnapshot());

  clearActiveTopPicksSnapshot(slateDate);
  assert.strictEqual(getActiveTopPicksSnapshot(), null);
  assert.ok(getTopPicksSnapshot(slateDate));
}

function testTopPropLimitConfig() {
  assert.strictEqual(CONFIG.TOP_PROP_LIMIT, 2);
}

function run() {
  const snapshotBackup = backupFile(SNAPSHOT_FILE);
  const trackedBackup = backupFile(TRACKED_FILE);
  try {
    const tests = [
      ["top prop limit config is 2", testTopPropLimitConfig],
      ["snapshot stores max 2", testMaxTwoInSnapshot],
      ["best score selected", testBestScoreSelected],
      ["snapshot reference-only not tracked", testSnapshotReferenceOnlyNotTracked],
      ["no duplicate tracked count", testNoDuplicateTrackedCount],
      ["lab review subset not double count", testLabReviewSubsetNotDoubleCount],
      ["attach graded results to snapshot", testAttachGradedResults],
      ["clear active after history transition", testClearActiveAfterHistoryTransition],
    ];

    let passed = 0;
    for (const [name, fn] of tests) {
      fn();
      console.log(`✓ ${name}`);
      passed += 1;
    }

    console.log(`\nAll ${passed}/${tests.length} top picks lifecycle tests passed.`);
  } finally {
    restoreFile(SNAPSHOT_FILE, snapshotBackup);
    restoreFile(TRACKED_FILE, trackedBackup);
  }
}

run();
