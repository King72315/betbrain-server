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
import {
  applyGradeMonotonicityGuard,
  buildLifecycleIntegrityDiagnostics,
  overlayLiveGradingFields,
  resetGradeMonotonicityDiagnosticsForTests,
  verifyResolvedPropsPersisted,
} from "../services/gradeMonotonicityGuard.js";
import { classifyTrackedPropsByLifecycle } from "../services/slateLifecycleService.js";

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
  gradedAt = null,
}) {
  const key =
    trackedKey ||
    `20260708-wnba-${String(player).toLowerCase().replace(/[^a-z0-9]/g, "")}-team-opp-points-${side.toLowerCase()}`;

  const resolvedAt =
    gradedAt ||
    (status === "pending" ? null : "2026-07-10T10:00:00.000Z");

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
    gradedAt: resolvedAt,
    resolvedAt,
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

function simulateResolverSummary(updated, verification) {
  const gradedCount = updated.filter((prop) =>
    ["win", "loss", "push"].includes(String(prop.status || "").toLowerCase())
  ).length;
  const verified = verification?.ok === true;
  return {
    calculated: true,
    persisted: true,
    verified,
    gradedCount: verified ? gradedCount : 0,
  };
}

console.log("\n0708 locked slate resolve persistence tests\n");

resetGradeMonotonicityDiagnosticsForTests();

test("A: fixture has 5 props with 3 pre-graded and 2 pending", () => {
  const { props } = buildFixture();
  const stats = summarizeSlate(props);
  assert.equal(stats.total, 5);
  assert.equal(stats.graded, 3);
  assert.equal(stats.pending, 2);
});

test("A: resolve grades Carleton (9) and Leite (13) as losses", () => {
  const { props } = buildFixture();
  const resolved = simulateResolve(props);
  const carleton = resolved.find((prop) => prop.player === "Bridget Carleton");
  const leite = resolved.find((prop) => prop.player === "Carla Leite");
  assert.equal(carleton.status, "loss");
  assert.equal(carleton.actualStat, 9);
  assert.equal(leite.status, "loss");
  assert.equal(leite.actualStat, 13);
});

test("A: after resolve + freeze guard, all 5 slate props stay graded 2-3 ACTIVE", () => {
  const { props, snapshotProps, lockedEntry } = buildFixture();
  const resolved = simulateResolve(props);
  const persisted = mergeLockedSlateFreezeIntoTracked(resolved, SLATE_0708, snapshotProps);
  const stats = summarizeSlate(persisted);

  assert.equal(stats.total, 5);
  assert.equal(stats.graded, 5);
  assert.equal(stats.pending, 0);
  assert.equal(stats.record, "2-3-0");
  assert.equal(lockedEntry.phase, "ACTIVE");
  assert.equal(
    persisted.filter((prop) => String(prop.slateDate) === SLATE_0708).length,
    5,
    "no props disappeared from the locked slate"
  );
});

test("B: stale lock pending vs live loss — live wins", () => {
  const { props } = buildFixture();
  const resolved = simulateResolve(props);
  const snapshot = props.map((prop) => ({ ...prop }));
  const carletonLive = resolved.find((prop) => prop.player === "Bridget Carleton");

  const merged = overlayLiveGradingFields(
    snapshot.find((prop) => prop.player === "Bridget Carleton"),
    carletonLive,
    { sourcePath: "testB", slateDate: SLATE_0708 }
  );

  assert.equal(merged.status, "loss");
  assert.equal(merged.actualStat, 9);
});

test("B: mergeSnapshotPropsWithLiveGrades prefers live resolved grade", () => {
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

test("C: poll safe-merge cannot downgrade resolved Carleton grade to pending", () => {
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

test("C: poll pending over live win is blocked by monotonicity guard", () => {
  const winProp = makeProp({
    player: "Test Player",
    line: 10.5,
    status: "win",
    actualStat: 15,
  });

  const { result, blocked } = applyGradeMonotonicityGuard(winProp, {
    status: "pending",
    actualStat: null,
    pendingReason: "Game not final yet.",
  }, { sourcePath: "testC" });

  assert.equal(blocked, true);
  assert.equal(result.status, "win");
  assert.equal(result.actualStat, 15);
});

test("D: simulated write verify fail — response does not claim graded", () => {
  const { props } = buildFixture();
  const resolved = simulateResolve(props);
  const failedReadBack = resolved.map((prop) =>
    prop.player === "Bridget Carleton"
      ? { ...prop, status: "pending", actualStat: null, gradedAt: null }
      : prop
  );

  const verification = verifyResolvedPropsPersisted(resolved, failedReadBack);
  assert.equal(verification.ok, false);

  const summary = simulateResolverSummary(resolved, verification);
  assert.equal(summary.calculated, true);
  assert.equal(summary.persisted, true);
  assert.equal(summary.verified, false);
  assert.equal(summary.gradedCount, 0, "must not report graded unless verified");
});

test("E: rehydrate ACTIVE 07/08 — props and grades survive freeze merge", () => {
  const { props, snapshotProps } = buildFixture();
  const resolved = simulateResolve(props);
  const rehydratedFromBundle = snapshotProps.map((prop) => ({ ...prop }));
  const withLiveGrades = mergeLockedSlateFreezeIntoTracked(
    resolved,
    SLATE_0708,
    rehydratedFromBundle
  );
  const stats = summarizeSlate(withLiveGrades);
  assert.equal(stats.total, 5);
  assert.equal(stats.graded, 5);
  assert.equal(stats.pending, 0);
});

test("F: lifecycle diagnostics readable with legacy+active classification", () => {
  const { props, snapshotProps, lockedEntry } = buildFixture();
  const legacyProp = makeProp({
    player: "Legacy Star",
    line: 8.5,
    status: "win",
    actualStat: 12,
    trackedKey: "legacy-0621-prop",
  });
  legacyProp.slateDate = "2026-06-21";
  legacyProp.resultsSlateDate = "2026-06-21";
  legacyProp.cohortSlateDate = "2026-06-21";

  const resolved = simulateResolve(props);
  const allProps = [...resolved, legacyProp];
  const classification = classifyTrackedPropsByLifecycle(allProps, {
    reports: [{ slateDate: "2026-06-21", reportStatus: "final", frozen: true }],
    archives: [{ slateDate: "2026-06-21", props: [legacyProp] }],
    lockedSlates: [lockedEntry, { slateDate: "2026-06-21", phase: "LAB", propCount: 1 }],
    quarantinedSlates: [],
    today: "2026-07-10",
  });

  assert.ok(classification);
  assert.ok(typeof classification.trackedCountsByLifecycleState === "object");
  assert.ok(Object.keys(classification.trackedCountsByLifecycleState).length > 0);
  assert.ok(Array.isArray(classification.activeResultsProps));
  assert.ok(Array.isArray(classification.legacyCompletedProps));

  const diagnostics = buildLifecycleIntegrityDiagnostics({
    trackedProps: resolved,
    lockedSlates: [lockedEntry],
    getSnapshot: () => ({ props: snapshotProps, updatedAt: "2026-07-10T08:00:00.000Z" }),
  });
  assert.equal(diagnostics.activeSlateDate, SLATE_0708);
  assert.equal(typeof diagnostics.blockedDowngradeCount, "number");
  assert.equal(diagnostics.lockedCount, 5);
  assert.equal(diagnostics.storedCount, 5);
  assert.ok(diagnostics.lastResolverPersistenceVerification === null ||
    typeof diagnostics.lastResolverPersistenceVerification === "object");
});

test("G: authorized correction with reason can change final grade", () => {
  const { props } = buildFixture();
  const resolved = simulateResolve(props);
  const carleton = resolved.find((prop) => prop.player === "Bridget Carleton");

  const corrected = applySafeLockedTrackedPropMerge(
    carleton,
    {
      status: "win",
      actualStat: 14,
      result: 14,
      resultMargin: carleton.officialLine - 14,
      gradedAt: "2026-07-10T12:00:00.000Z",
      pendingReason: null,
      currentLine: carleton.line,
    },
    {
      allowGradeCorrection: true,
      gradeCorrectionReason: "official_stat_correction",
    }
  );

  assert.equal(corrected.status, "win");
  assert.equal(corrected.actualStat, 14);
});

test("persistResolvedTrackedProps is exported for atomic resolve write-back", () => {
  assert.equal(typeof persistResolvedTrackedProps, "function");
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
