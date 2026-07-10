/**
 * Regression: resolver-confirmed grades on ACTIVE locked 07/08 slate must persist
 * even when a stale locked snapshot or poll refresh tries to keep props pending.
 *
 * In-memory only — does not read or write tracked-props.json.
 *
 * Usage: node betbrain-server/scripts/testLockedSlateResolvePersistence0708.js
 */
import assert from "assert";

import {
  applySafeLockedTrackedPropMerge,
  mergeLockedSlateFreezeIntoTracked,
  persistResolvedTrackedProps,
} from "../services/trackedPropService.js";
import { mergeSnapshotPropsWithLiveGrades } from "../services/slateLockService.js";

const SLATE_0708 = "2026-07-08";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

function makeProp({
  player,
  side = "Over",
  line,
  status = "pending",
  actualStat = null,
  trackedKey,
}) {
  const key =
    trackedKey ||
    `20260708-wnba-${String(player).toLowerCase().replace(/[^a-z0-9]/g, "")}-team-opp-points-${side.toLowerCase()}`;

  return {
    player,
    team: "team",
    opponent: "opp",
    league: "WNBA",
    slateDate: SLATE_0708,
    resultsSlateDate: SLATE_0708,
    cohortSlateDate: SLATE_0708,
    stat: "Points",
    side,
    commenceTime: "2026-07-10T02:00:00Z",
    trackingType: "OFFICIAL",
    currentEngineSide: side,
    lockedSide: side,
    officialLine: line,
    pickLine: line,
    line,
    trackedId: key,
    trackedKey: key,
    slateLocked: true,
    status,
    actualStat,
    result: actualStat,
    resultMargin: actualStat === null ? null : line - actualStat,
    gradedAt: status === "pending" ? null : "2026-07-10T10:00:00.000Z",
    pendingReason: status === "pending" ? "Game not final yet." : null,
  };
}

function buildFixture() {
  const props = [
    makeProp({ player: "Flau'jae Johnson", side: "Over", line: 12.5, status: "win", actualStat: 18 }),
    makeProp({ player: "Bridget Carleton", side: "Over", line: 10.5, status: "pending" }),
    makeProp({ player: "Carla Leite", side: "Over", line: 10.5, status: "pending" }),
    makeProp({ player: "Allisha Gray", side: "Under", line: 18.5, status: "loss", actualStat: 22 }),
    makeProp({
      player: "Dominique Malonga",
      side: "Under",
      line: 15.5,
      status: "win",
      actualStat: 11,
    }),
  ];

  const lockedEntry = {
    slateDate: SLATE_0708,
    phase: "ACTIVE",
    propCount: 5,
    lockReason: "auto_results_track",
  };

  const snapshotProps = props.map((prop) => ({ ...prop }));

  return { props, snapshotProps, lockedEntry };
}

function gradePendingLoss(prop, actualStat) {
  return {
    ...prop,
    status: "loss",
    actualStat,
    result: actualStat,
    resultMargin: prop.officialLine - actualStat,
    gradedAt: "2026-07-10T11:30:00.000Z",
    resolvedAt: "2026-07-10T11:30:00.000Z",
    pendingReason: null,
    currentEngineResult: "loss",
    matchVerified: true,
    matchedSource: "bdl",
  };
}

function simulateResolve(updatedTracked) {
  return updatedTracked.map((prop) => {
    if (prop.player === "Bridget Carleton") {
      return gradePendingLoss(prop, 9);
    }
    if (prop.player === "Carla Leite") {
      return gradePendingLoss(prop, 13);
    }
    return prop;
  });
}

function summarizeSlate(props = []) {
  const slateProps = props.filter((prop) => String(prop.slateDate) === SLATE_0708);
  const graded = slateProps.filter((prop) =>
    ["win", "loss", "push"].includes(String(prop.status || "").toLowerCase())
  );
  const wins = graded.filter((prop) => prop.status === "win").length;
  const losses = graded.filter((prop) => prop.status === "loss").length;
  const pending = slateProps.filter(
    (prop) => String(prop.status || "pending").toLowerCase() === "pending"
  ).length;

  return {
    total: slateProps.length,
    graded: graded.length,
    wins,
    losses,
    pending,
    record: `${wins}-${losses}-0`,
  };
}

console.log("\n0708 locked slate resolve persistence tests\n");

test("fixture has 5 props with 3 pre-graded and 2 pending", () => {
  const { props } = buildFixture();
  const stats = summarizeSlate(props);
  assert.equal(stats.total, 5);
  assert.equal(stats.graded, 3);
  assert.equal(stats.pending, 2);
});

test("resolve grades Carleton (9) and Leite (13) as losses", () => {
  const { props } = buildFixture();
  const resolved = simulateResolve(props);
  const carleton = resolved.find((prop) => prop.player === "Bridget Carleton");
  const leite = resolved.find((prop) => prop.player === "Carla Leite");
  assert.equal(carleton.status, "loss");
  assert.equal(carleton.actualStat, 9);
  assert.equal(leite.status, "loss");
  assert.equal(leite.actualStat, 13);
});

test("stale snapshot freeze merge keeps live resolved grades", () => {
  const { props, snapshotProps } = buildFixture();
  const resolved = simulateResolve(props);
  const merged = mergeLockedSlateFreezeIntoTracked(resolved, SLATE_0708, snapshotProps);
  const stats = summarizeSlate(merged);

  assert.equal(stats.total, 5);
  assert.equal(stats.graded, 5);
  assert.equal(stats.pending, 0);
  assert.equal(stats.record, "2-3-0");
});

test("poll safe-merge cannot downgrade resolved Carleton grade to pending", () => {
  const { props } = buildFixture();
  const resolved = simulateResolve(props);
  const carleton = resolved.find((prop) => prop.player === "Bridget Carleton");
  const merged = applySafeLockedTrackedPropMerge(carleton, {
    status: "pending",
    actualStat: null,
    result: null,
    pendingReason: "Game not final yet.",
    currentLine: carleton.line,
  });

  assert.equal(merged.status, "loss");
  assert.equal(merged.actualStat, 9);
  assert.equal(merged.pendingReason, null);
});

test("after resolve + freeze guard, all 5 slate props stay graded 2-3 with none pending", () => {
  const { props, snapshotProps } = buildFixture();
  const resolved = simulateResolve(props);
  const persisted = mergeLockedSlateFreezeIntoTracked(resolved, SLATE_0708, snapshotProps);
  const stats = summarizeSlate(persisted);

  assert.equal(stats.total, 5);
  assert.equal(stats.graded, 5);
  assert.equal(stats.pending, 0);
  assert.equal(stats.record, "2-3-0");
  assert.equal(
    persisted.filter((prop) => String(prop.slateDate) === SLATE_0708).length,
    5,
    "no props disappeared from the locked slate"
  );
});

test("mergeSnapshotPropsWithLiveGrades overlays loss onto pending snapshot row", () => {
  const { props } = buildFixture();
  const resolved = simulateResolve(props);
  const snapshot = props.map((prop) => ({ ...prop }));
  const live = resolved.filter((prop) =>
    ["Bridget Carleton", "Carla Leite"].includes(prop.player)
  );
  const merged = mergeSnapshotPropsWithLiveGrades(
    snapshot.filter((prop) =>
      ["Bridget Carleton", "Carla Leite"].includes(prop.player)
    ),
    live
  );

  assert.equal(merged.length, 2);
  assert.ok(merged.every((prop) => prop.status === "loss"));
});

test("persistResolvedTrackedProps is exported for atomic resolve write-back", () => {
  assert.equal(typeof persistResolvedTrackedProps, "function");
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
