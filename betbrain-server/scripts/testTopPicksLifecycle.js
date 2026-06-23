/**
 * Top Picks lifecycle tests — snapshot reference-only, no duplicate tracking.
 * Usage: node betbrain-server/scripts/testTopPicksLifecycle.js
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { CONFIG } from "../config.js";
import {
  selectTopProps,
  selectCombinedTopProps,
  getPickTeamKey,
} from "../engines/topProps/topPropSelector.js";
import {
  saveTopPicksSnapshot,
  getTopPicksSnapshot,
  getActiveTopPicksSnapshot,
  buildTopPicksReview,
  clearActiveTopPicksSnapshot,
  attachGradedResultsToSnapshot,
  getTopPickMetaMap,
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

function makeNbaPick(overrides = {}) {
  return {
    player: overrides.player || "NBA Player",
    team: overrides.team || "LAL",
    opponent: "BOS",
    line: overrides.line ?? 24.5,
    pick: "Over",
    side: "Over",
    league: "NBA",
    slateDate: overrides.slateDate || "2026-06-23",
    commenceTime: "2026-06-23T23:00:00Z",
    tier: "PREMIUM",
    confidence: overrides.confidence ?? 88,
    netEdge: overrides.netEdge ?? 8,
    supportScore: 12,
    chosenRisk: 35,
    noPlay: false,
    ...overrides,
  };
}

function makeGame(picks, overrides = {}) {
  return {
    gameId: overrides.gameId || "game-1",
    game: "Away @ Home",
    league: overrides.league || "WNBA",
    date: "2026-06-23",
    slateDate: "2026-06-23",
    commenceTime: "2026-06-23T23:00:00Z",
    isStarted: false,
    picks,
    allGeneratedCandidates: picks,
    ...overrides,
  };
}

function testLeagueLimitsConfig() {
  assert.strictEqual(CONFIG.NBA_TOP_PROP_LIMIT, 2);
  assert.strictEqual(CONFIG.WNBA_TOP_PROP_LIMIT, 2);
}

function testSnapshotStoresLeagueLabels() {
  const nba = makeNbaPick({ player: "NBA A", team: "LAL" });
  const wnba = makeWnbaPick({ player: "WNBA A", team: "Mystics", overScore: 90 });
  const combined = selectCombinedTopProps([
    makeGame([nba], { league: "NBA", gameId: "nba-1" }),
    makeGame([wnba], { league: "WNBA", gameId: "wnba-1" }),
  ]);

  const saved = saveTopPicksSnapshot(combined.topProps, {
    slateDate: "2026-06-23",
    topSelectionAudit: combined.topSelectionAudit,
    limit: CONFIG.TOP_PROP_COMBINED_LIMIT,
  });

  assert.strictEqual(saved.snapshot.pickCount, 2);
  assert.strictEqual(saved.snapshot.picks[0].topPickLabel, "Top NBA #1");
  assert.strictEqual(saved.snapshot.picks[1].topPickLabel, "Top WNBA #1");
  assert.ok(saved.snapshot.picks[0].selectedTeamKey);
  assert.strictEqual(saved.snapshot.referenceOnly, true);
}

function testTopPickSelectionDoesNotIncreaseTrackedCount() {
  const before = getTrackedProps().length;
  const pick = makeWnbaPick({
    player: `Reference Only ${Date.now()}`,
    team: "Mystics",
    overScore: 88,
  });
  const key = getStableTrackedPropKey(pick);
  const referencePick = { ...pick, isTopPickReference: true };

  saveTopPicksSnapshot([pick], { slateDate: "2026-06-23" });
  addTrackedProps([referencePick], { skipTopPickReferences: true });

  const after = getTrackedProps().length;
  const matches = getTrackedProps().filter(
    (item) => (item.trackedKey || getStableTrackedPropKey(item)) === key
  );
  assert.strictEqual(matches.length, 0);
  assert.strictEqual(after, before);
}

function testResultsMetaReferencesOriginalOnce() {
  const pick = makeWnbaPick({ player: "Badge Player", team: "Mystics", overScore: 91 });
  const key = getStableTrackedPropKey(pick);
  saveTopPicksSnapshot(
    [{ ...pick, topPickLabel: "Top WNBA #1", selectedTeamKey: "mystics" }],
    { slateDate: "2026-06-23" }
  );

  const meta = getTopPickMetaMap("2026-06-23");
  assert.strictEqual(meta.size, 1);
  assert.strictEqual(meta.get(key)?.topPickLabel, "Top WNBA #1");
}

function testLabReviewReferencesOriginalProps() {
  const slateDate = "2026-06-23";
  const nbaPick = makeNbaPick({ player: "NBA Top", team: "LAL" });
  const wnbaPick = makeWnbaPick({ player: "WNBA Top", team: "Mystics", overScore: 99 });
  const other = makeWnbaPick({ player: "Other", team: "Mercury", overScore: 40 });

  saveTopPicksSnapshot(
    [
      { ...nbaPick, topPickLabel: "Top NBA #1" },
      { ...wnbaPick, topPickLabel: "Top WNBA #1" },
    ],
    { slateDate }
  );

  const tracked = [
    {
      ...nbaPick,
      trackedKey: getStableTrackedPropKey(nbaPick),
      status: "win",
    },
    {
      ...wnbaPick,
      trackedKey: getStableTrackedPropKey(wnbaPick),
      status: "loss",
    },
    {
      ...other,
      trackedKey: getStableTrackedPropKey(other),
      status: "loss",
    },
  ];

  const review = buildTopPicksReview(slateDate, tracked);
  assert.ok(review);
  assert.strictEqual(review.subsetAnalysisOnly, true);
  assert.strictEqual(review.record.total, 2);
  assert.strictEqual(review.nbaTopPicksReview.record.total, 1);
  assert.strictEqual(review.wnbaTopPicksReview.record.total, 1);
  assert.strictEqual(review.vsRestOfSlate.restPropCount, 1);
}

function testHistorySnapshotReferenceOnly() {
  const pick = makeNbaPick({ player: "Archive One", team: "LAL" });
  const saved = saveTopPicksSnapshot([pick], { slateDate: "2026-06-22" });
  const snapshot = getTopPicksSnapshot("2026-06-22");
  assert.ok(snapshot);
  assert.strictEqual(snapshot.referenceOnly, true);
  assert.strictEqual(saved.snapshot.picks[0].isTopPickReference, true);
  assert.ok(saved.snapshot.picks[0].trackedKey);
}

function testNoDuplicateTrackedCount() {
  const pick = makeWnbaPick({
    player: `Tracked Once ${Date.now()}`,
    team: "Mystics",
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
}

function testAttachGradedResults() {
  const slateDate = "2026-06-23";
  const pick = makeWnbaPick({ player: "Grader", team: "Mystics", overScore: 85 });
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
  saveTopPicksSnapshot([makeWnbaPick({ slateDate, team: "Mystics" })], { slateDate });
  assert.ok(getActiveTopPicksSnapshot());

  clearActiveTopPicksSnapshot(slateDate);
  assert.strictEqual(getActiveTopPicksSnapshot(), null);
  assert.ok(getTopPicksSnapshot(slateDate));
}

function testWnbaTeamDiversityInSelection() {
  const picks = [
    makeWnbaPick({ player: "A", team: "Mystics", overScore: 90 }),
    makeWnbaPick({ player: "B", team: "Mystics", overScore: 85 }),
    makeWnbaPick({ player: "C", team: "Mercury", overScore: 70 }),
  ];
  const result = selectTopProps([makeGame(picks)], { league: "WNBA" });
  assert.strictEqual(result.topProps.length, 2);
  assert.notStrictEqual(
    getPickTeamKey(result.topProps[0]),
    getPickTeamKey(result.topProps[1])
  );
}

function run() {
  const snapshotBackup = backupFile(SNAPSHOT_FILE);
  const trackedBackup = backupFile(TRACKED_FILE);
  try {
    const tests = [
      ["league top prop limits are 2", testLeagueLimitsConfig],
      ["snapshot stores league labels + team key", testSnapshotStoresLeagueLabels],
      ["9. top pick selection does not increase tracked count", testTopPickSelectionDoesNotIncreaseTrackedCount],
      ["10. results meta references original once", testResultsMetaReferencesOriginalOnce],
      ["11. lab review references original props by league", testLabReviewReferencesOriginalProps],
      ["12. history snapshot reference-only", testHistorySnapshotReferenceOnly],
      ["no duplicate tracked count", testNoDuplicateTrackedCount],
      ["attach graded results to snapshot", testAttachGradedResults],
      ["clear active after history transition", testClearActiveAfterHistoryTransition],
      ["WNBA team diversity in selection", testWnbaTeamDiversityInSelection],
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
