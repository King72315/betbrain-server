/**
 * CourtEdge 06/24 quarantine tests.
 * Usage: node betbrain-server/scripts/testQuarantine0624.js
 */
import assert from "node:assert/strict";

import {
  computeSlateRotation,
  filterOutQuarantinedReports,
  isQuarantinedSlateDate,
} from "../services/slateScopeService.js";
import { getAnalyticsScopeProps } from "../services/trackedPropService.js";
import { repairQuarantine0624AndArchive0621 } from "../services/repairQuarantine0624AndArchive0621Service.js";

const TODAY = "2026-06-26";
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

function makeArchive(slateDate, phase = "ARCHIVED") {
  return {
    slateDate,
    phase,
    props: [{ player: "P", slateDate, status: "win", league: "WNBA" }],
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

console.log("\nQuarantine 06/24 — 8 tests\n");

test("01 06/24 is quarantined by default", () => {
  assert.equal(isQuarantinedSlateDate("2026-06-24"), true);
  assert.equal(isQuarantinedSlateDate("2026-06-23"), false);
});

test("02 06/24 excluded from Lab candidates", () => {
  const reports = [makeCompletedReport("2026-06-24")];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  assert.equal(rotation.currentLabSlateDate, null);
  assert.ok(rotation.quarantinedSlateDates.includes("2026-06-24"));
});

test("03 06/24 excluded from History", () => {
  const reports = [makeCompletedReport("2026-06-24"), makeCompletedReport("2026-06-21")];
  const archives = [makeArchive("2026-06-21", "ARCHIVED")];
  const rotation = computeSlateRotation(reports, { archives, today: TODAY });
  assert.ok(rotation.historySlateDates.includes("2026-06-21"));
  assert.ok(!rotation.historySlateDates.includes("2026-06-24"));
});

test("04 non-quarantined slate still becomes Lab", () => {
  const reports = [makeCompletedReport(LAB_CANDIDATE_DATE), makeCompletedReport("2026-06-21")];
  const archives = [makeArchive("2026-06-21", "ARCHIVED")];
  const rotation = computeSlateRotation(reports, { archives, today: TODAY });
  assert.equal(rotation.currentLabSlateDate, LAB_CANDIDATE_DATE);
});

test("05 quarantined reports filtered from rollups list", () => {
  const reports = [makeCompletedReport("2026-06-24"), makeCompletedReport("2026-06-21")];
  const filtered = filterOutQuarantinedReports(reports);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].slateDate, "2026-06-21");
});

test("06 analytics scope excludes quarantined completed slate", () => {
  const tracked = [
    { player: "A", slateDate: "2026-06-24", status: "win", league: "WNBA" },
    { player: "B", slateDate: "2026-06-21", status: "win", league: "WNBA" },
  ];
  const reports = [makeCompletedReport("2026-06-24"), makeCompletedReport("2026-06-21")];
  const scoped = getAnalyticsScopeProps(tracked, reports, []);
  assert.ok(scoped.every((prop) => prop.slateDate !== "2026-06-24"));
});

test("07 repair dry-run is idempotent metadata shape", () => {
  const result = repairQuarantine0624AndArchive0621({ dryRun: true });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.ok(result.meta);
  assert.ok(Array.isArray(result.meta.quarantinedSlateDates));
});

test("08 archived 06/21 with empty Lab when 06/24 quarantined", () => {
  const reports = [makeCompletedReport("2026-06-21")];
  const archives = [makeArchive("2026-06-21", "ARCHIVED")];
  const rotation = computeSlateRotation(reports, { archives, today: TODAY });
  assert.equal(rotation.currentLabSlateDate, null);
  assert.ok(rotation.historySlateDates.includes("2026-06-21"));
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
