/**
 * CourtEdge slate rotation lifecycle tests (23 cases).
 * Usage: node betbrain-server/scripts/testSlateRotationLifecycle.js
 */
import assert from "node:assert/strict";

import {
  buildSlateRotationMetadata,
  computeSlateRotation,
  isCompletedSlate,
  pickActiveResultsSlateDate,
} from "../services/slateScopeService.js";

const TODAY = "2026-06-25";

const LAB_CANDIDATE_DATE = "2026-06-23";

function makeCompletedReport(slateDate, graded = 6) {
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
        graded,
        totalOfficialProps: graded,
      },
    },
  };
}

function makeInProgressReport(slateDate, pending = 3) {
  return {
    slateDate,
    status: "in-progress",
    reportStatus: "in-progress",
    sections: {
      A: {
        reportStatus: "in-progress",
        pending,
        awaitingStats: 0,
        graded: 6 - pending,
        totalOfficialProps: 6,
      },
    },
  };
}

function makeProp(slateDate, status = "win", extra = {}) {
  return {
    player: "Test Player",
    slateDate,
    status,
    league: "WNBA",
    tier: "LEAN",
    line: 10,
    actualStat: 12,
    result: 12,
    ...extra,
  };
}

function makeArchive(slateDate, phase = "ARCHIVED") {
  return {
    slateDate,
    phase,
    props: [makeProp(slateDate, "win")],
    report: makeCompletedReport(slateDate),
  };
}

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

console.log("\nSlate Rotation Lifecycle — 23 tests\n");

test("01 newest completed slate becomes current Lab", () => {
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  assert.equal(rotation.currentLabSlateDate, LAB_CANDIDATE_DATE);
});

test("02 older completed slate moves to history", () => {
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  assert.ok(rotation.historySlates.some((r) => r.slateDate === "2026-06-21"));
});

test("03 ARCHIVED phase archive counts in historySlateDates", () => {
  const archives = [makeArchive("2026-06-21", "ARCHIVED")];
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE)];
  const rotation = computeSlateRotation(reports, { archives, today: TODAY });
  assert.ok(rotation.historySlateDates.includes("2026-06-21"));
});

test("04 ARCHIVED slate excluded from current Lab", () => {
  const archives = [makeArchive("2026-06-21", "ARCHIVED")];
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, { archives, today: TODAY });
  assert.equal(rotation.currentLabSlateDate, LAB_CANDIDATE_DATE);
  assert.ok(!rotation.historySlates.some((r) => r.slateDate === "2026-06-21" && rotation.currentLabSlateDate === "2026-06-21"));
});

test("05 active Results slate excluded from Lab", () => {
  const reports = [makeInProgressReport("2026-06-25"), makeCompletedReport(LAB_CANDIDATE_DATE)];
  const tracked = [makeProp("2026-06-25", "pending")];
  const locked = [{ slateDate: "2026-06-25", phase: "ACTIVE", lockedAt: "x" }];
  const rotation = computeSlateRotation(reports, {
    trackedProps: tracked,
    lockedSlates: locked,
    today: TODAY,
  });
  assert.equal(rotation.activeResultsSlateDate, "2026-06-25");
  assert.equal(rotation.currentLabSlateDate, LAB_CANDIDATE_DATE);
});

test("06 stale past in-progress report inferred from graded props", () => {
  const reports = [makeInProgressReport(LAB_CANDIDATE_DATE, 14), makeCompletedReport("2026-06-21")];
  const tracked = Array.from({ length: 6 }, (_, i) =>
    makeProp(LAB_CANDIDATE_DATE, i % 2 === 0 ? "win" : "loss", { player: `P${i}` })
  );
  const rotation = computeSlateRotation(reports, { trackedProps: tracked, today: TODAY });
  assert.equal(rotation.currentLabSlateDate, LAB_CANDIDATE_DATE);
  assert.ok(rotation.inferredCompletedSlateDates.includes(LAB_CANDIDATE_DATE));
});

test("07 pre-cutoff slates quarantined", () => {
  const reports = [makeCompletedReport("2026-06-14")];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  assert.equal(rotation.currentLabSlateDate, null);
  assert.ok(rotation.quarantinedLegacySlateDates.includes("2026-06-14"));
});

test("08 today props without lock still admit Results", () => {
  const tracked = [makeProp("2026-06-25", "pending")];
  const active = pickActiveResultsSlateDate(tracked, [], TODAY, []);
  assert.equal(active, "2026-06-25");
});

test("09 blocking locked slate prevents today bypass", () => {
  const tracked = [
    makeProp(LAB_CANDIDATE_DATE, "pending"),
    makeProp("2026-06-25", "pending"),
  ];
  const locked = [{ slateDate: LAB_CANDIDATE_DATE, phase: "ACTIVE", lockedAt: "x" }];
  const active = pickActiveResultsSlateDate(tracked, [], TODAY, locked);
  assert.equal(active, LAB_CANDIDATE_DATE);
});

test("10 completed slate not in Results active list", () => {
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE)];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  assert.equal(rotation.activeResults.length, 0);
});

test("11 history count matches archived + rotated slates", () => {
  const archives = [makeArchive("2026-06-21", "ARCHIVED")];
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, { archives, today: TODAY });
  assert.ok(rotation.historySlateDates.length >= 1);
});

test("12 viewingHistorical true when viewed date differs from Lab", () => {
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, {
    today: TODAY,
    viewedSlateDate: "2026-06-21",
  });
  assert.equal(rotation.viewingHistorical, true);
});

test("13 lifecycle metadata exposes rotationDecisionDebug", () => {
  const meta = buildSlateRotationMetadata([makeCompletedReport(LAB_CANDIDATE_DATE)], {
    today: TODAY,
  });
  assert.ok(meta.rotationDecisionDebug);
  assert.equal(meta.rotationDecisionDebug.currentLabSlateDate, LAB_CANDIDATE_DATE);
});

test("14 lifecycleByDate marks LAB_CURRENT", () => {
  const meta = buildSlateRotationMetadata([makeCompletedReport(LAB_CANDIDATE_DATE)], {
    today: TODAY,
  });
  assert.equal(meta.lifecycleByDate[LAB_CANDIDATE_DATE], "LAB_CURRENT");
});

test("15 lifecycleByDate marks ACTIVE_RESULTS for today slate", () => {
  const tracked = [makeProp("2026-06-25", "pending")];
  const meta = buildSlateRotationMetadata([], {
    trackedProps: tracked,
    today: TODAY,
  });
  assert.equal(meta.lifecycleByDate["2026-06-25"], "ACTIVE_RESULTS");
});

test("16 totalTrackedProps fallback completes Best Six slate reports", () => {
  const report = {
    slateDate: LAB_CANDIDATE_DATE,
    status: "final",
    reportStatus: "final",
    frozen: true,
    sections: {
      A: {
        reportStatus: "final",
        pending: 0,
        awaitingStats: 0,
        graded: 6,
        totalOfficialProps: 0,
        totalTrackedProps: 6,
      },
    },
  };
  assert.equal(isCompletedSlate(report), true);
});

test("17 newer completed slate becomes Lab when archive is LAB phase", () => {
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE), makeCompletedReport("2026-06-21")];
  const archives = [makeArchive("2026-06-21", "LAB")];
  const rotation = computeSlateRotation(reports, { archives, today: TODAY });
  assert.equal(rotation.currentLabSlateDate, LAB_CANDIDATE_DATE);
});

test("18 activeInProgress includes today when admitted", () => {
  const tracked = [makeProp("2026-06-25", "pending")];
  const rotation = computeSlateRotation([], { trackedProps: tracked, today: TODAY });
  assert.ok(rotation.activeInProgressSlateDates.includes("2026-06-25"));
});

test("19 no duplicate Lab and History placement", () => {
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  assert.equal(rotation.currentLabSlateDate, LAB_CANDIDATE_DATE);
  assert.ok(
    !rotation.historySlates.some((r) => r.slateDate === rotation.currentLabSlateDate)
  );
});

test("20 stale unresolved excludes fully graded inferred slate", () => {
  const reports = [makeInProgressReport(LAB_CANDIDATE_DATE, 6)];
  const tracked = [makeProp(LAB_CANDIDATE_DATE, "win"), makeProp(LAB_CANDIDATE_DATE, "loss")];
  const meta = buildSlateRotationMetadata(reports, { trackedProps: tracked, today: TODAY });
  assert.ok(!meta.staleUnresolvedSlateDates.includes(LAB_CANDIDATE_DATE));
});

test("21 awaiting-stats-only pending still infers Lab slate", () => {
  const reports = [makeInProgressReport(LAB_CANDIDATE_DATE, 1), makeCompletedReport("2026-06-21")];
  const tracked = [
    ...Array.from({ length: 13 }, (_, i) =>
      makeProp(LAB_CANDIDATE_DATE, i % 2 === 0 ? "win" : "loss", { player: `P${i}` })
    ),
    makeProp(LAB_CANDIDATE_DATE, "pending", {
      player: "Awaiting Stats",
      pendingReason: "Final player stats unavailable from source",
    }),
  ];
  const rotation = computeSlateRotation(reports, { trackedProps: tracked, today: TODAY });
  assert.equal(rotation.currentLabSlateDate, LAB_CANDIDATE_DATE);
  assert.ok(rotation.inferredCompletedSlateDates.includes(LAB_CANDIDATE_DATE));
});

test("22 no activeInProgress when Results slate not admitted", () => {
  const reports = [makeInProgressReport("2026-06-25"), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  assert.deepEqual(rotation.activeInProgressSlateDates, []);
  assert.equal(rotation.activeResults.length, 0);
});

test("23 TEST-only today props do not admit Results slate", () => {
  const tracked = [
    makeProp("2026-06-25", "pending", { trackingType: "TEST", tier: "WATCHLIST" }),
  ];
  const reports = [makeInProgressReport("2026-06-25"), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, { trackedProps: tracked, today: TODAY });
  assert.equal(rotation.activeResultsSlateDate, null);
  assert.deepEqual(rotation.activeInProgressSlateDates, []);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
