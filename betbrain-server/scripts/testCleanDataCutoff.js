import assert from "node:assert/strict";

import {
  buildCourtEdgeFlowDiagnostics,
  computeSlateRotation,
  filterCompletedDailyReports,
  filterValidDailyReports,
  pickActiveResultsSlateDate,
} from "../services/slateScopeService.js";
import { getAnalyticsScopeProps } from "../services/trackedPropService.js";

const TODAY = "2026-06-21";

function makeProp(slateDate, status = "pending", extra = {}) {
  return {
    player: "Test Player",
    slateDate,
    status,
    league: "WNBA",
    line: 10,
    ...extra,
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
        graded: 5,
        totalOfficialProps: 5,
        wins: 3,
        losses: 2,
        pushes: 0,
      },
    },
  };
}

function makeInProgressReport(slateDate) {
  return {
    slateDate,
    status: "in-progress",
    reportStatus: "in-progress",
    sections: {
      A: {
        reportStatus: "in-progress",
        pending: 3,
        awaitingStats: 0,
        graded: 2,
        totalOfficialProps: 5,
        wins: 1,
        losses: 1,
        pushes: 0,
      },
    },
  };
}

console.log("testCleanDataCutoff: pre-cutoff completed reports ignored");

{
  const today = "2026-06-20";
  const rawReports = [
    makeCompletedReport("2026-06-14"),
    makeCompletedReport("2026-06-15"),
    makeInProgressReport("2026-06-20"),
  ];
  const tracked = [
    makeProp("2026-06-14", "win", { actualStat: 12, result: "win" }),
    makeProp("2026-06-15", "win", { actualStat: 12, result: "win" }),
    makeProp("2026-06-20", "pending"),
  ];

  const flow = buildCourtEdgeFlowDiagnostics(tracked, rawReports, [], today);
  assert.equal(flow.rawReportCount, 3);
  assert.equal(flow.ignoredPreCutoffReportCount, 2);
  assert.equal(flow.validCleanReportCount, 1);
  assert.equal(flow.completedCleanReportCount, 0);
  assert.equal(flow.completedReportCount, 0);
  assert.equal(flow.currentLabSlateDate, null);
  assert.equal(flow.historySlateCount, 0);
  assert.equal(
    getAnalyticsScopeProps(tracked, rawReports, []).length,
    0,
    "analytics scope excludes pre-cutoff and in-progress"
  );
}

console.log("testCleanDataCutoff: clean completed slate becomes current Lab");

{
  const today = "2026-06-21";
  const rawReports = [makeCompletedReport("2026-06-20")];
  const tracked = [makeProp("2026-06-20", "win", { actualStat: 12, result: "win" })];
  const rotation = computeSlateRotation(rawReports);
  const flow = buildCourtEdgeFlowDiagnostics(tracked, rawReports, [], today);

  assert.equal(rotation.currentLabSlateDate, "2026-06-20");
  assert.equal(flow.currentLabSlateDate, "2026-06-20");
  assert.equal(flow.completedCleanReportCount, 1);
  assert.equal(
    getAnalyticsScopeProps(tracked, rawReports, []).length,
    1,
    "completed clean slate props count in analytics"
  );
}

console.log("testCleanDataCutoff: active locked slate blocks today-only bypass");

{
  const tracked = [makeProp("2026-06-20", "pending"), makeProp("2026-06-21", "pending")];
  const rawReports = [makeInProgressReport("2026-06-20")];
  const lockedSlates = [
    {
      slateDate: "2026-06-21",
      phase: "ACTIVE",
      lockedAt: "2026-06-21T12:00:00.000Z",
    },
  ];
  const active = pickActiveResultsSlateDate(tracked, rawReports, TODAY, lockedSlates);
  const flow = buildCourtEdgeFlowDiagnostics(
    tracked,
    rawReports,
    [],
    TODAY,
    lockedSlates
  );

  assert.equal(active, "2026-06-21");
  assert.equal(flow.activeResultsSlateDate, "2026-06-21");
  assert.equal(flow.resultsRule, "active_locked_unresolved");
  assert.equal(flow.priorSlateStillActive, false);
  assert.equal(flow.staleUnresolvedCount, 1);
  assert.equal(flow.staleCleanupNeeded, true);
}

console.log("testCleanDataCutoff: history rotation excludes pre-cutoff");

{
  const rawReports = [
    makeCompletedReport("2026-06-20"),
    makeCompletedReport("2026-06-19"),
    makeCompletedReport("2026-06-14"),
  ];
  const rotation = computeSlateRotation(rawReports);
  assert.equal(rotation.currentLabSlateDate, "2026-06-20");
  assert.equal(rotation.historySlates.length, 1);
  assert.equal(rotation.historySlates[0].slateDate, "2026-06-19");
  assert.equal(
    rotation.historySlates.some((report) => report.slateDate === "2026-06-14"),
    false
  );
}

console.log("testCleanDataCutoff: analytics scope test");

{
  const rawReports = [
    makeCompletedReport("2026-06-20"),
    makeInProgressReport("2026-06-21"),
    makeCompletedReport("2026-06-15"),
  ];
  const tracked = [
    makeProp("2026-06-20", "win", { actualStat: 12, result: "win" }),
    makeProp("2026-06-21", "pending"),
    makeProp("2026-06-15", "win", { actualStat: 12, result: "win" }),
  ];
  const archives = [
    {
      slateDate: "2026-06-19",
      phase: "ARCHIVED",
      props: [makeProp("2026-06-19", "win", { actualStat: 11, result: "win" })],
      report: makeCompletedReport("2026-06-19"),
    },
  ];

  const scoped = getAnalyticsScopeProps(tracked, rawReports, archives);
  const scopedDates = [...new Set(scoped.map((prop) => prop.slateDate))].sort();

  assert.deepEqual(scopedDates, ["2026-06-19", "2026-06-20"]);
  assert.equal(filterCompletedDailyReports(rawReports, TODAY).length, 1);
  assert.equal(filterValidDailyReports(rawReports, TODAY).length, 2);
}

console.log("testCleanDataCutoff: all passed");
