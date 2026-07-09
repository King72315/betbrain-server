import assert from "node:assert/strict";

import {
  pickActiveResultsSlateDate,
  buildCourtEdgeFlowDiagnostics,
  getBlockingActiveResultsSlateDate,
  getUnresolvedPriorCohortSlateDates,
  countStagedHomeProps,
  hasUnresolvedGradingProps,
} from "../services/slateScopeService.js";

const JUNE_21 = "2026-06-21";
const JUNE_22 = "2026-06-22";

function makeProp(slateDate, status = "pending", extra = {}) {
  return {
    player: "Test Player",
    slateDate,
    status,
    league: "WNBA",
    line: 10,
    officialLine: 10,
    ...extra,
  };
}

function makeLockedEntry(slateDate, phase = "ACTIVE") {
  return {
    slateDate,
    phase,
    lockedAt: "2026-06-21T12:00:00.000Z",
    lockReason: "test_lock",
    propCount: 14,
  };
}

function makeCompletedReport(slateDate) {
  return {
    slateDate,
    status: "final",
    reportStatus: "final",
    frozen: true,
    sections: {
      A: {
        reportStatus: "final",
        pending: 0,
        awaitingStats: 0,
        graded: 14,
        totalOfficialProps: 14,
        wins: 8,
        losses: 6,
        pushes: 0,
      },
    },
  };
}

function gradedProp(slateDate, extra = {}) {
  return makeProp(slateDate, "win", {
    actualStat: 12,
    result: "win",
    resolveDebug: { gameFinal: true },
    ...extra,
  });
}

console.log("testActiveResultsSlate: Home→Results→Lab flow");

// Test 1 — 06/21 locked 9 graded 5 pending, 06/22 exists → Results shows 06/21
{
  const tracked = [
    ...Array.from({ length: 9 }, (_, i) =>
      gradedProp(JUNE_21, { player: `Graded ${i}` })
    ),
    ...Array.from({ length: 5 }, (_, i) =>
      makeProp(JUNE_21, "pending", { player: `Pending ${i}` })
    ),
    makeProp(JUNE_22, "pending", { homeStaged: true }),
    makeProp(JUNE_22, "pending", { homeStaged: true, player: "Staged 2" }),
  ];
  const lockedSlates = [makeLockedEntry(JUNE_21)];
  const today = JUNE_22;

  const active = pickActiveResultsSlateDate(tracked, [], today, lockedSlates);
  assert.equal(active, JUNE_21, "Results keeps unresolved locked 06/21");

  const resultsProps = tracked.filter((prop) => String(prop.slateDate) === active);
  assert.equal(resultsProps.length, 14);

  const blocking = getBlockingActiveResultsSlateDate(tracked, lockedSlates, [], today);
  assert.equal(blocking, JUNE_21);

  const staged = countStagedHomeProps(tracked, today);
  assert.equal(staged.slateDate, JUNE_22);
  assert.equal(staged.count, 2);
}

// Test 2 — midnight rollover still shows 06/21
{
  const tracked = [
    gradedProp(JUNE_21, { player: "One graded" }),
    makeProp(JUNE_21, "pending", { player: "One pending" }),
    makeProp(JUNE_22, "pending", { homeStaged: true }),
  ];
  const lockedSlates = [makeLockedEntry(JUNE_21)];
  const today = JUNE_22;

  const active = pickActiveResultsSlateDate(tracked, [], today, lockedSlates);
  assert.equal(active, JUNE_21, "midnight carryover keeps prior locked slate");

  const flow = buildCourtEdgeFlowDiagnostics(tracked, [], [], today, lockedSlates);
  assert.equal(flow.activeResultsSlateDate, JUNE_21);
  assert.equal(flow.resultsRule, "active_locked_unresolved");
  assert.equal(flow.priorSlateStillActive, true);
  assert.equal(flow.nextSlateWaitingOnHome, true);
  assert.equal(flow.stagedHomePropCount, 1);
}

// Test 3 — 06/21 completion allows next slate
{
  const tracked = Array.from({ length: 14 }, (_, i) =>
    gradedProp(JUNE_21, { player: `All graded ${i}` })
  );
  const lockedSlates = [makeLockedEntry(JUNE_21)];
  const reports = [makeCompletedReport(JUNE_21)];
  const today = JUNE_22;

  const blocking = getBlockingActiveResultsSlateDate(
    tracked,
    lockedSlates,
    reports,
    today
  );
  assert.equal(blocking, null, "completed slate no longer blocks Results");

  const stagedTracked = [
    ...tracked,
    makeProp(JUNE_22, "pending", { homeStaged: true }),
  ];
  const active = pickActiveResultsSlateDate(stagedTracked, reports, today, [
    makeLockedEntry(JUNE_21, "LAB"),
  ]);
  assert.equal(active, null, "home-staged 06/22 not in Results until lock clears staging");
}

// Test 4 — 06/22 promotion after 06/21 in Lab
{
  const tracked = [
    ...Array.from({ length: 14 }, (_, i) =>
      gradedProp(JUNE_21, { player: `Lab ${i}` })
    ),
    makeProp(JUNE_22, "pending", { player: "Next slate" }),
  ];
  const lockedSlates = [
    makeLockedEntry(JUNE_21, "LAB"),
    makeLockedEntry(JUNE_22, "ACTIVE"),
  ];
  const reports = [makeCompletedReport(JUNE_21)];
  const today = JUNE_22;

  const active = pickActiveResultsSlateDate(tracked, reports, today, lockedSlates);
  assert.equal(active, JUNE_22, "06/22 enters Results after 06/21 in Lab");
}

// Test 5 — locked active slate with missing props still selects slate date
{
  const tracked = [];
  const lockedSlates = [makeLockedEntry(JUNE_21)];
  const today = JUNE_22;

  const active = pickActiveResultsSlateDate(tracked, [], today, lockedSlates);
  assert.equal(
    active,
    JUNE_21,
    "empty runtime still points Results at locked active slate for rehydrate"
  );
}

// Test 6 — stale slates hidden, officialLine immutable check helper
{
  const tracked = [
    makeProp("2026-06-20", "pending"),
    makeProp(JUNE_21, "pending"),
  ];
  const lockedSlates = [makeLockedEntry(JUNE_21)];
  const today = JUNE_22;

  const active = pickActiveResultsSlateDate(tracked, [], today, lockedSlates);
  assert.equal(active, JUNE_21, "stale 06/20 not selected over locked 06/21");

  const unresolved = hasUnresolvedGradingProps([
    gradedProp(JUNE_21, { officialLine: 25.5 }),
  ]);
  assert.equal(unresolved, false, "fully graded prop with officialLine is resolved");
}

// Diagnostics: old stale slates flagged but not active Results
{
  const tracked = [
    makeProp("2026-06-20", "pending"),
    makeProp(JUNE_21, "pending"),
  ];
  const flow = buildCourtEdgeFlowDiagnostics(
    tracked,
    [],
    [],
    JUNE_21,
    [makeLockedEntry(JUNE_21)]
  );
  assert.equal(flow.activeResultsSlateDate, JUNE_21);
  assert.equal(flow.staleUnresolvedCount, 1);
  assert.equal(flow.staleUnresolvedSlates[0], "2026-06-20");
}

// Test 7 — prior unresolved cohort blocks without lock (midnight split guard)
{
  const tracked = [
    makeProp("2026-07-07", "pending", {
      player: "Prior Slate",
      controlledBestSixDisplayTracked: true,
      trackingAdmissionSource: "CONTROLLED_BEST_SIX_DISPLAY",
    }),
    makeProp("2026-07-08", "pending", {
      player: "Calendar Today",
      controlledBestSixDisplayTracked: true,
    }),
  ];
  const today = "2026-07-08";

  const prior = getUnresolvedPriorCohortSlateDates(tracked, [], [], today);
  assert.deepEqual(prior, ["2026-07-07"]);

  const blocking = getBlockingActiveResultsSlateDate(tracked, [], [], today);
  assert.equal(blocking, "2026-07-07", "prior unresolved cohort blocks without lock");

  const active = pickActiveResultsSlateDate(tracked, [], today, []);
  assert.equal(active, "2026-07-07", "Results stays on prior cohort slate");
}

console.log("testActiveResultsSlate: all passed");
