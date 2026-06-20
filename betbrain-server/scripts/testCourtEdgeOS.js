/**
 * Read-only local logic tests for CourtEdge OS (no production file writes).
 * Run: node betbrain-server/scripts/testCourtEdgeOS.js
 */
import { getStableTrackedPropKey } from "../services/trackedPropService.js";
import { countDuplicateStableKeys } from "../services/slateLockService.js";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function makeProp(overrides = {}) {
  return {
    player: "Test Player",
    team: "LAL",
    opponent: "BOS",
    league: "NBA",
    stat: "Points",
    side: "Over",
    line: 20.5,
    slateDate: "2026-06-19",
    commenceTime: "2026-06-19T23:00:00Z",
    tier: "PREMIUM",
    ...overrides,
  };
}

function simulateShrinkGuard(beforeCount, afterCount) {
  return afterCount < beforeCount;
}

function simulateSafeLockedMerge(existing, incoming) {
  const SAFE = new Set(["latestLine", "currentLine", "bookCount", "lastSeenAt"]);
  const next = { ...existing };
  for (const key of SAFE) {
    if (incoming[key] !== undefined) next[key] = incoming[key];
  }
  next.officialLine = existing.officialLine;
  next.slateLocked = true;
  return next;
}

console.log("CourtEdge OS local tests (read-only)...");

const keyA = getStableTrackedPropKey(makeProp());
const keyB = getStableTrackedPropKey(makeProp({ player: "Other Player" }));
const keySameLine = getStableTrackedPropKey(makeProp({ line: 22.5 }));

assert(keyA !== keyB, "stable keys differ for different players");
assert(keyA === keySameLine, "stable key ignores line changes");

const frozen = {
  officialLine: 20.5,
  slateLocked: true,
  bookCount: 3,
};
const merged = simulateSafeLockedMerge(frozen, {
  latestLine: 21.5,
  currentLine: 21.5,
  bookCount: 5,
  line: 21.5,
  player: "Hacked",
});
assert(merged.latestLine === 21.5, "safe field updated");
assert(merged.officialLine === 20.5, "official line frozen");
assert(merged.player === undefined, "unsafe fields not merged in simulation");

assert(simulateShrinkGuard(10, 9) === true, "shrink guard triggers");
assert(simulateShrinkGuard(10, 10) === false, "equal count allowed");

const dupes = countDuplicateStableKeys([
  { trackedKey: "a" },
  { trackedKey: "a" },
  { trackedKey: "b" },
]);
assert(dupes.duplicates === 1, "duplicate counter works");

const firstTrackLine = 20.5;
const refreshedLine = 21.5;
const trackedAtAdd = {
  line: firstTrackLine,
  officialLine: firstTrackLine,
  pickLine: firstTrackLine,
  lockedSide: "Over",
  latestLine: firstTrackLine,
};
const trackedAfterRefresh = simulateSafeLockedMerge(trackedAtAdd, {
  latestLine: refreshedLine,
  currentLine: refreshedLine,
  line: refreshedLine,
});
assert(trackedAfterRefresh.officialLine === firstTrackLine, "official line locked at tracking");
assert(trackedAfterRefresh.latestLine === refreshedLine, "latest line updates on refresh");

console.log("All CourtEdge OS local tests passed.");
