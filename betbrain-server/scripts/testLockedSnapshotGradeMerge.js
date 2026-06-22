import assert from "node:assert/strict";

import { mergeSnapshotPropsWithLiveGrades } from "../services/slateLockService.js";

function makeSnapshotProp(overrides = {}) {
  return {
    trackedId: "prop-1",
    trackedKey: "2026-06-21-wnba-testplayer-team1-team2-points-over",
    slateDate: "2026-06-21",
    player: "Test Player",
    team: "team1",
    opponent: "team2",
    stat: "Points",
    currentEngineSide: "Over",
    officialLine: 18.5,
    pickLine: 18.5,
    lockedSide: "Over",
    status: "pending",
    result: null,
    actualStat: null,
    margin: null,
    slateLocked: true,
    ...overrides,
  };
}

function makeLiveProp(snapshotProp, overrides = {}) {
  return {
    ...snapshotProp,
    officialLine: 99,
    player: "Changed Name",
    team: "changed",
    opponent: "changed",
    stat: "Assists",
    currentEngineSide: "Under",
    status: "win",
    result: "WIN",
    actualStat: 22,
    margin: 3.5,
    gradedAt: "2026-06-22T05:00:00.000Z",
    resolveDebug: { matched: true },
    matchedSource: "bdl",
    ...overrides,
  };
}

const snapshotProps = [makeSnapshotProp()];
const liveProps = [makeLiveProp(snapshotProps[0])];
const merged = mergeSnapshotPropsWithLiveGrades(snapshotProps, liveProps);

assert.equal(merged.length, 1);
assert.equal(merged[0].officialLine, 18.5, "snapshot officialLine wins");
assert.equal(merged[0].player, "Test Player", "snapshot player wins");
assert.equal(merged[0].team, "team1", "snapshot team wins");
assert.equal(merged[0].opponent, "team2", "snapshot opponent wins");
assert.equal(merged[0].stat, "Points", "snapshot stat wins");
assert.equal(merged[0].currentEngineSide, "Over", "snapshot side wins");
assert.equal(merged[0].trackedId, "prop-1", "snapshot trackedId wins");
assert.equal(merged[0].status, "win", "live status wins");
assert.equal(merged[0].result, "WIN", "live result wins");
assert.equal(merged[0].actualStat, 22, "live actualStat wins");
assert.equal(merged[0].margin, 3.5, "live margin wins");
assert.equal(merged[0].gradedAt, "2026-06-22T05:00:00.000Z", "live gradedAt wins");
assert.equal(merged[0].matchedSource, "bdl", "live matchedSource wins");
assert.deepEqual(merged[0].resolveDebug, { matched: true }, "live resolveDebug wins");

const trackedKeyMatch = mergeSnapshotPropsWithLiveGrades(
  [makeSnapshotProp({ trackedId: null, trackedKey: "key-only" })],
  [makeLiveProp(makeSnapshotProp({ trackedId: null, trackedKey: "key-only" }))]
);
assert.equal(trackedKeyMatch[0].status, "win", "matches by trackedKey when trackedId missing");

console.log("testLockedSnapshotGradeMerge: all assertions passed");
