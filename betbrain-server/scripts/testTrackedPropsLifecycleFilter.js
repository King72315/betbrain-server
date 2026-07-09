/**
 * CourtEdge active-results lifecycle filter tests.
 * Usage: node betbrain-server/scripts/testTrackedPropsLifecycleFilter.js
 */
import assert from "assert";

import { BEST_SIX_LIMIT } from "../engines/topProps/controlledBestSixSelector.js";
import {
  classifyTrackedPropsByLifecycle,
  SLATE_LIFECYCLE_STATES,
  TRACKED_PROP_LIFECYCLE,
} from "../services/slateLifecycleService.js";
import { buildTrackingCohortDiagnostics } from "../services/trackedPropService.js";

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

function makeProp(overrides = {}) {
  return {
    player: overrides.player || "Player A",
    team: overrides.team || "Team A",
    opponent: overrides.opponent || "Team B",
    league: overrides.league || "WNBA",
    slateDate: overrides.slateDate || "2026-06-25",
    side: overrides.side || "Over",
    line: overrides.line ?? 15.5,
    stat: "Points",
    commenceTime: overrides.commenceTime || `${overrides.slateDate || "2026-06-25"}T23:00:00Z`,
    trackingType: overrides.trackingType || "OFFICIAL",
    status: overrides.status || "pending",
    ...overrides,
  };
}

function completedReport(slateDate, overrides = {}) {
  return {
    slateDate,
    reportStatus: "final",
    frozen: true,
    sections: {
      A: {
        slateDate,
        reportStatus: "final",
        pending: 0,
        graded: 6,
        totalOfficialProps: 6,
        awaitingStats: 0,
        wins: 4,
        losses: 2,
        pushes: 0,
      },
    },
    ...overrides,
  };
}

const TODAY = "2026-06-25";

test("01 active TRACKING_ACTIVE slate props appear in activeResultsProps", () => {
  const props = [makeProp({ slateDate: TODAY })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [{ slateDate: TODAY, phase: "ACTIVE" }],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 1);
  assert.equal(result.activeResultsSlateDate, TODAY);
});

test("02 PARTIALLY_GRADED blocking slate stays in active results", () => {
  const slate = "2026-06-22";
  const props = [
    makeProp({ slateDate: slate, status: "win" }),
    makeProp({ slateDate: slate, player: "Player B", status: "pending" }),
  ];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [{ slateDate: slate, phase: "ACTIVE" }],
    today: TODAY,
  });
  assert.equal(result.activeResultsSlateDate, slate);
  assert.equal(result.activeResultsTrackedCount, 2);
});

test("03 LAB_CURRENT slate excluded from active results", () => {
  const labDate = "2026-06-21";
  const props = Array.from({ length: 14 }, (_, i) =>
    makeProp({ slateDate: labDate, player: `P${i}` })
  );
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [completedReport(labDate)],
    archives: [],
    lockedSlates: [{ slateDate: labDate, phase: "ACTIVE" }],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 0);
  assert.equal(result.labCurrentTrackedCount, 14);
});

test("04 ARCHIVED_HISTORY slate excluded from active results", () => {
  const historyDate = "2026-06-20";
  const props = [makeProp({ slateDate: historyDate })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [completedReport("2026-06-21"), completedReport(historyDate)],
    archives: [],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 0);
  assert.equal(result.archivedHistoryTrackedCount, 1);
});

test("05 legacy completed slate stays out of active results", () => {
  const legacyDate = "2026-06-20";
  const props = Array.from({ length: 10 }, (_, i) =>
    makeProp({ slateDate: legacyDate, player: `Legacy ${i}`, status: "win", actualStat: 18, result: 18 })
  );
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [completedReport(legacyDate), completedReport("2026-06-24")],
    archives: [],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 0);
  assert.ok(
    result.archivedHistoryTrackedCount + result.labCurrentTrackedCount >= 10
  );
});

test("06 prior unresolved past slate blocks Results when lock missed", () => {
  const staleDate = "2026-06-20";
  const props = [makeProp({ slateDate: staleDate, status: "pending" })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(result.activeResultsSlateDate, staleDate);
  assert.equal(result.activeResultsTrackedCount, 1);
  assert.equal(result.staleUnresolvedTrackedCount, 0);
  assert.equal(
    result.trackedCountsByLifecycleState[TRACKED_PROP_LIFECYCLE.ACTIVE_RESULTS],
    1
  );
});

test("07 pre-cutoff props quarantined not active", () => {
  const props = [makeProp({ slateDate: "2026-06-10" })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 0);
  assert.equal(result.quarantinedLegacyTrackedCount, 1);
});

test("08 locked 06/21 lab props untouched in labCurrent bucket", () => {
  const labDate = "2026-06-21";
  const props = [makeProp({ slateDate: labDate, slateLocked: true })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [completedReport(labDate)],
    archives: [{ slateDate: labDate, props: [props[0]], phase: "LAB" }],
    lockedSlates: [{ slateDate: labDate, phase: "ACTIVE" }],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 0);
  assert.ok(result.labCurrentTrackedCount + result.archivedHistoryTrackedCount >= 1);
});

test("09 cap validation uses active results only", () => {
  const slate = "2026-06-22";
  const activeProps = Array.from({ length: BEST_SIX_LIMIT + 2 }, (_, i) =>
    makeProp({ slateDate: slate, player: `Active ${i}` })
  );
  const legacyProps = Array.from({ length: 20 }, (_, i) =>
    makeProp({
      slateDate: "2026-06-20",
      player: `Old ${i}`,
      status: "win",
      actualStat: 20,
      result: 20,
    })
  );
  const all = [...activeProps, ...legacyProps];
  const classification = classifyTrackedPropsByLifecycle(all, {
    reports: [],
    archives: [],
    lockedSlates: [{ slateDate: slate, phase: "ACTIVE" }],
    today: TODAY,
  });
  assert.equal(classification.activeResultsExcessCount, 2);
  const diag = buildTrackingCohortDiagnostics([], all, [], {
    todayLocalDate: TODAY,
    activeResultsSlateDate: classification.activeResultsSlateDate,
    activeResultsProps: classification.activeResultsProps,
  });
  assert.equal(diag.excessTrackedDueToPreCap, 2);
});

test("10 excessTrackedDueToPreCap zero when legacy store ignored", () => {
  const legacyOnly = Array.from({ length: 33 }, (_, i) =>
    makeProp({
      slateDate: "2026-06-20",
      player: `WNBA ${i}`,
      status: "win",
      actualStat: 20,
      result: 20,
    })
  );
  const classification = classifyTrackedPropsByLifecycle(legacyOnly, {
    reports: [completedReport("2026-06-21")],
    archives: [],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(classification.activeResultsTrackedCount, 0);
  assert.equal(classification.activeResultsExcessCount, 0);
  assert.equal(classification.allStoredPropsExceedCapButExcluded, true);
});

test("11 homeStaged props excluded from active results", () => {
  const props = [makeProp({ slateDate: TODAY, homeStaged: true })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 0);
  assert.equal(result.homeStagedTrackedCount, 1);
});

test("12 TEST props excluded from active results official cohort", () => {
  const props = [makeProp({ slateDate: TODAY, trackingType: "TEST" })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [{ slateDate: TODAY, phase: "ACTIVE" }],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 0);
});

test("13 trackedCountsBySlateDate aggregates all stored props", () => {
  const props = [
    makeProp({ slateDate: "2026-06-20", player: "A", status: "win", actualStat: 10, result: 10 }),
    makeProp({ slateDate: "2026-06-20", player: "B", status: "win", actualStat: 11, result: 11 }),
    makeProp({ slateDate: TODAY, player: "C" }),
  ];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [{ slateDate: TODAY, phase: "ACTIVE" }],
    today: TODAY,
  });
  assert.equal(result.trackedCountsBySlateDate["2026-06-20"], 2);
  assert.equal(result.trackedStoreTotalCount, 3);
});

test("14 archive-backed completed slate -> legacy completed not active", () => {
  const slate = "2026-06-20";
  const props = [makeProp({ slateDate: slate, status: "win", actualStat: 10, result: 10 })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [completedReport("2026-06-21"), completedReport(slate)],
    archives: [{ slateDate: slate, props, phase: "ARCHIVED" }],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 0);
  assert.ok(
    result.archivedHistoryTrackedCount + result.legacyStoredTrackedCount + result.labCurrentTrackedCount >=
      1
  );
});

test("15 all-graded slate without archive inferred to current Lab", () => {
  const slate = "2026-06-20";
  const props = [makeProp({ slateDate: slate, status: "win", actualStat: 10, result: 10 })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(result.labCurrentTrackedCount, 1);
  assert.equal(result.currentLabSlateDate, slate);
});

test("16 active results within cap when count <= 6 per league", () => {
  const slate = TODAY;
  const props = Array.from({ length: 6 }, (_, i) =>
    makeProp({ slateDate: slate, player: `W${i}`, league: "WNBA" })
  );
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [{ slateDate: slate, phase: "ACTIVE" }],
    today: TODAY,
  });
  assert.equal(result.activeResultsWithinCap, true);
  assert.equal(result.activeResultsCapStatus, "WITHIN_CAP");
});

test("17 slate lifecycle map includes TRACKING_ACTIVE for today slate", () => {
  const props = [makeProp({ slateDate: TODAY })];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(
    result.slateLifecycleMap[TODAY]?.state,
    SLATE_LIFECYCLE_STATES.TRACKING_ACTIVE
  );
});

test("18 stale unresolved scan accepts quarantinedSlates without ReferenceError", () => {
  assert.doesNotThrow(() =>
    classifyTrackedPropsByLifecycle(
      [
        makeProp({ slateDate: "2026-06-20", status: "pending" }),
        makeProp({ slateDate: TODAY, status: "pending" }),
      ],
      {
        reports: [],
        archives: [],
        lockedSlates: [{ slateDate: TODAY, phase: "ACTIVE" }],
        quarantinedSlates: [{ slateDate: "2026-06-14", reason: "legacy" }],
        today: TODAY,
      }
    )
  );
});

test("19 TRACK reader-demoted TEST props appear in active results", () => {
  const props = [
    makeProp({
      slateDate: TODAY,
      trackingType: "TEST",
      excludedFromOfficialRecord: true,
      trackingEligibility: "TRACK",
      decisionIntelligence: { trackEligibility: "TRACK", bestSixEligibility: true },
      controlledBestSixApplied: true,
      trackingAdmissionSource: "CONTROLLED_BEST_SIX",
    }),
  ];
  const result = classifyTrackedPropsByLifecycle(props, {
    reports: [],
    archives: [],
    lockedSlates: [],
    today: TODAY,
  });
  assert.equal(result.activeResultsTrackedCount, 1);
  assert.equal(result.activeResultsSlateDate, TODAY);
});

console.log("\nCourtEdge tracked-props lifecycle filter tests\n");
console.log(`Results: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
