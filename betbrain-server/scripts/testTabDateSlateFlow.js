/**
 * King's tab date/slate flow — in-memory rotation + display tests.
 * Usage: node betbrain-server/scripts/testTabDateSlateFlow.js
 */
import assert from "node:assert/strict";

import {
  buildLeagueBestSixBoard,
  filterPicksByDateView,
  HOME_DATE_VIEW,
  TOP_DATE_VIEW,
  resolveHomeControlledDateView,
  resolveTopControlledDateView,
} from "../../utils/controlledBestSixDisplay.js";
import {
  computeSlateRotation,
  isTodayResultsCohortOpen,
  pickActiveResultsSlateDate,
} from "../services/slateScopeService.js";

const TODAY = "2026-07-10";
const YESTERDAY = "2026-07-09";

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

function makeProp(slateDate, status = "pending", extra = {}) {
  const normalized = String(status || "pending").toLowerCase();
  const gradedStat = normalized === "loss" ? 8 : 12;
  return {
    player: extra.player || "Flow Test Player",
    slateDate,
    status,
    league: "WNBA",
    line: 10,
    actualStat: ["win", "loss", "push"].includes(normalized) ? gradedStat : undefined,
    result: ["win", "loss", "push"].includes(normalized) ? gradedStat : undefined,
    controlledBestSixDisplayTracked: true,
    trackingAdmissionSource: "CONTROLLED_BEST_SIX_DISPLAY",
    resolveDebug: ["win", "loss", "push"].includes(normalized)
      ? { gameFinal: true }
      : undefined,
    ...extra,
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

console.log("\nTab Date/Slate Flow — King's spec\n");

test("Home date view is tomorrow-only", () => {
  assert.equal(resolveHomeControlledDateView(), HOME_DATE_VIEW);
  assert.equal(HOME_DATE_VIEW, "tomorrow");
});

test("Top date view is tomorrow-only", () => {
  assert.equal(resolveTopControlledDateView(), TOP_DATE_VIEW);
});

test("Home board scopes to tomorrow bucket", () => {
  const tomorrowPick = {
    player: "Tomorrow Pick",
    dayBucket: "TOMORROW",
    league: "WNBA",
    decisionIntelligence: { trackEligibility: "TRACK" },
    controlledBestSixDisplay: true,
  };
  const todayPick = {
    ...tomorrowPick,
    player: "Today Pick",
    dayBucket: "TODAY",
  };
  const board = buildLeagueBestSixBoard({
    league: "WNBA",
    bestSixDisplay: [todayPick, tomorrowPick],
    games: [
      { league: "WNBA", dayBucket: "TODAY", allGeneratedCandidates: [todayPick] },
      { league: "WNBA", dayBucket: "TOMORROW", allGeneratedCandidates: [tomorrowPick] },
    ],
    dateView: HOME_DATE_VIEW,
  });
  assert.equal(board.bestSixCards.length, 1);
  assert.equal(board.bestSixCards[0].player, "Tomorrow Pick");
});

test("Top props filter keeps tomorrow picks only", () => {
  const picks = [
    { player: "Today", dayBucket: "TODAY" },
    { player: "Tomorrow", dayBucket: "TOMORROW" },
  ];
  const filtered = filterPicksByDateView(picks, TOP_DATE_VIEW);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].player, "Tomorrow");
});

test("Results shows today cohort while grading is open", () => {
  const tracked = [
    makeProp(TODAY, "pending", { player: "Open 1" }),
    makeProp(TODAY, "pending", { player: "Open 2" }),
    makeProp(YESTERDAY, "win", { player: "Yesterday graded" }),
  ];
  const locked = [{ slateDate: TODAY, phase: "ACTIVE", lockedAt: "x" }];
  const active = pickActiveResultsSlateDate(tracked, [], TODAY, locked);
  assert.equal(active, TODAY);
  assert.equal(isTodayResultsCohortOpen(tracked, TODAY), true);
});

test("Lab stays on yesterday while today's Results cohort is open", () => {
  const tracked = [
    makeProp(TODAY, "pending", { player: "Open 1" }),
    makeProp(YESTERDAY, "win", { player: "Y1" }),
    makeProp(YESTERDAY, "loss", { player: "Y2" }),
  ];
  const reports = [makeCompletedReport(YESTERDAY, 2)];
  const locked = [{ slateDate: TODAY, phase: "ACTIVE", lockedAt: "x" }];
  const rotation = computeSlateRotation(reports, {
    trackedProps: tracked,
    lockedSlates: locked,
    today: TODAY,
  });
  assert.equal(rotation.activeResultsSlateDate, TODAY);
  assert.equal(rotation.currentLabSlateDate, YESTERDAY);
});

test("Results clears today after full grade; today promotes to Lab", () => {
  const tracked = [
    makeProp(TODAY, "win", { player: "G1" }),
    makeProp(TODAY, "loss", { player: "G2" }),
    makeProp(YESTERDAY, "win", { player: "Y1" }),
    makeProp(YESTERDAY, "loss", { player: "Y2" }),
  ];
  const reports = [makeCompletedReport(YESTERDAY, 2)];
  const locked = [{ slateDate: TODAY, phase: "ACTIVE", lockedAt: "x" }];
  const active = pickActiveResultsSlateDate(tracked, reports, TODAY, locked);
  assert.equal(active, null);
  assert.equal(isTodayResultsCohortOpen(tracked, TODAY), false);

  const rotation = computeSlateRotation(reports, {
    trackedProps: tracked,
    lockedSlates: locked.map((entry) => ({ ...entry, phase: "LAB" })),
    today: TODAY,
  });
  assert.equal(rotation.currentLabSlateDate, TODAY);
  assert.ok(rotation.historySlates.some((report) => report.slateDate === YESTERDAY));
});

test("History holds archived slates after Lab rotation", () => {
  const reports = [makeCompletedReport(TODAY, 2), makeCompletedReport(YESTERDAY, 2)];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  assert.equal(rotation.currentLabSlateDate, TODAY);
  assert.ok(rotation.historySlateDates.includes(YESTERDAY));
  assert.ok(!rotation.historySlateDates.includes(TODAY));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
