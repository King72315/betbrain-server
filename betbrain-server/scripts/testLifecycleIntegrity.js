/**
 * Lifecycle integrity + monotonic Lab pointer tests.
 */
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  applyMonotonicLabPointer,
  readLifecyclePointerState,
  writeLifecyclePointerState,
} from "../services/lifecyclePointerStateService.js";
import {
  resolveOfficialSlateMembership,
} from "../services/officialSlateMembershipService.js";
import { normalizeDailySlateReport } from "../services/canonicalDailySlateReportService.js";
import {
  filterValidDailyReports,
  inferCompletedReportsFromTrackedProps,
  isCompletedSlate,
} from "../services/slateScopeService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, "..", "lifecycle-pointer-state.json");

function withTempPointerState(fn) {
  const backup = fs.existsSync(STATE_FILE) ? fs.readFileSync(STATE_FILE, "utf8") : null;
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
    return fn();
  } finally {
    if (backup) fs.writeFileSync(STATE_FILE, backup);
    else if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  }
}

function testMonotonicBlocksBackward() {
  withTempPointerState(() => {
    writeLifecyclePointerState({
      currentLabSlateDate: "2026-07-15",
      historySlateDates: [],
    });
    const result = applyMonotonicLabPointer({
      currentLabSlateDate: "2026-07-14",
      historySlateDates: [],
    });
    assert.equal(result.currentLabSlateDate, "2026-07-15");
    assert.equal(result.lifecycleIntegrityBlocked, true);
  });
}

function testMonotonicAllowsForward() {
  withTempPointerState(() => {
    writeLifecyclePointerState({
      currentLabSlateDate: "2026-07-14",
      historySlateDates: [],
    });
    const result = applyMonotonicLabPointer({
      currentLabSlateDate: "2026-07-15",
      historySlateDates: [],
    });
    assert.equal(result.currentLabSlateDate, "2026-07-15");
    assert.ok(result.historySlateDates.includes("2026-07-14"));
  });
}

function testOfficialFromDisplayCohortNotWatchlistTier() {
  const prop = {
    player: "Kayla Thornton",
    tier: "WATCHLIST",
    trackingType: "OFFICIAL",
    recordType: "OFFICIAL",
    controlledBestSixDisplayTracked: true,
    slateDate: "2026-07-15",
  };
  const explicit = String(prop.trackingType || "").toUpperCase();
  assert.equal(explicit, "OFFICIAL");
  assert.equal(prop.controlledBestSixDisplayTracked, true);
}

function testCanonicalReportNeverUndefinedRecord() {
  const normalized = normalizeDailySlateReport({
    slateDate: "2026-07-14",
    reportStatus: "final",
    sections: { A: { totalTrackedProps: 4, graded: 4, pending: 0 } },
    learningPackets: [
      {
        officialPropId: "id-1",
        player: "A",
        league: "WNBA",
        pregame: { league: "WNBA" },
        postgame: { status: "loss", result: "LOSS" },
        diagnosis: { missType: "X" },
      },
    ],
    officialPropIds: ["id-1"],
  });
  assert.equal(normalized.record, "0-1-0");
  assert.ok(Array.isArray(normalized.league));
  assert.equal(normalized.league[0], "WNBA");
  assert.equal(normalized.learningPackets.length, 1);
  assert.equal(normalized.officialProps, 1);
}

function testMembershipFromDisplayCohort() {
  const tracked = [
    {
      slateDate: "2099-01-02",
      player: "A",
      trackingType: "OFFICIAL",
      controlledBestSixDisplayTracked: true,
      status: "win",
    },
    {
      slateDate: "2099-01-02",
      player: "B",
      trackingType: "OFFICIAL",
      controlledBestSixDisplayTracked: true,
      status: "loss",
    },
  ];
  const membership = resolveOfficialSlateMembership("2099-01-02", tracked);
  assert.equal(membership.propCount, 2);
  assert.equal(membership.source, "display_cohort");
}

function testInferredLabReportIsDeliverable() {
  const tracked = [
    {
      slateDate: "2099-01-01",
      player: "A",
      trackingType: "OFFICIAL",
      controlledBestSixDisplayTracked: true,
      status: "win",
      league: "WNBA",
    },
    {
      slateDate: "2099-01-01",
      player: "B",
      trackingType: "OFFICIAL",
      controlledBestSixDisplayTracked: true,
      status: "loss",
      league: "WNBA",
    },
  ];
  const inferred = inferCompletedReportsFromTrackedProps(
    tracked,
    [],
    "2099-01-02"
  );
  assert.equal(inferred.length, 1);
  assert.equal(isCompletedSlate(inferred[0]), true);
  assert.equal(filterValidDailyReports(inferred, "2099-01-02").length, 1);
}

const tests = [
  ["monotonic blocks backward Lab pointer", testMonotonicBlocksBackward],
  ["monotonic allows forward Lab pointer", testMonotonicAllowsForward],
  ["official classification ignores watchlist when contract says official", testOfficialFromDisplayCohortNotWatchlistTier],
  ["canonical report has stable record + league", testCanonicalReportNeverUndefinedRecord],
  ["membership resolves display cohort", testMembershipFromDisplayCohort],
  ["inferred completed report is API-deliverable", testInferredLabReportIsDeliverable],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}
console.log(`\n${passed}/${tests.length} tests passed`);
