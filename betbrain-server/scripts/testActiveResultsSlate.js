import assert from "node:assert/strict";

import {
  pickActiveResultsSlateDate,
  buildCourtEdgeFlowDiagnostics,
} from "../services/slateScopeService.js";

const TODAY = "2026-06-21";

function makeProp(slateDate, status = "pending", extra = {}) {
  return {
    player: "Test Player",
    slateDate,
    status,
    league: "WNBA",
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

console.log("testActiveResultsSlate: today-only Results slate selection");

{
  const tracked = [
    makeProp("2026-06-20", "pending"),
    makeProp("2026-06-21", "pending"),
  ];
  const reports = [];
  const active = pickActiveResultsSlateDate(tracked, reports, TODAY);
  assert.equal(active, "2026-06-21", "should pick today even when prior slate unresolved");
}

{
  const tracked = [makeProp("2026-06-20", "pending")];
  const active = pickActiveResultsSlateDate(tracked, [], TODAY);
  assert.equal(active, null, "no today props means empty Results");
}

{
  const tracked = [makeProp("2026-06-20", "win", { actualStat: 18, result: "win" })];
  const reports = [makeCompletedReport("2026-06-20")];
  const active = pickActiveResultsSlateDate(tracked, reports, TODAY);
  assert.equal(active, null, "prior slate alone does not appear in Results");
}

{
  const tracked = [makeProp("2026-06-22", "pending")];
  const active = pickActiveResultsSlateDate(tracked, [], TODAY);
  assert.equal(active, null, "future slate excluded");
}

{
  const tracked = [makeProp("2026-06-18", "pending")];
  const active = pickActiveResultsSlateDate(tracked, [], TODAY);
  assert.equal(active, null, "pre-cutoff slate excluded");
}

{
  const tracked = [
    makeProp("2026-06-19", "pending"),
    makeProp("2026-06-21", "pending"),
  ];
  const reports = [makeCompletedReport("2026-06-19")];
  const active = pickActiveResultsSlateDate(tracked, reports, TODAY);
  assert.equal(active, "2026-06-21", "today props only — skip stale prior slate");
}

{
  const flow = buildCourtEdgeFlowDiagnostics(
    [makeProp("2026-06-20", "pending"), makeProp("2026-06-21", "pending")],
    [],
    [],
    TODAY
  );
  assert.equal(flow.activeResultsSlateDate, "2026-06-21");
  assert.equal(flow.resultsRule, "today_only");
  assert.equal(flow.priorSlateStillActive, false);
  assert.equal(flow.staleUnresolvedCount, 1);
  assert.deepEqual(flow.staleUnresolvedSlates, ["2026-06-20"]);
  assert.equal(flow.staleCleanupNeeded, true);
}

console.log("testActiveResultsSlate: all passed");
