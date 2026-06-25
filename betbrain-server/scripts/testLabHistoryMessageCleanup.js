/**
 * CourtEdge Lab/History message cleanup tests (18 cases).
 * Usage: node betbrain-server/scripts/testLabHistoryMessageCleanup.js
 */
import assert from "node:assert/strict";

import {
  buildResolveCheckMessage,
  countNewlyGradedPropsOnSlate,
  formatSlateArchivedMessage,
  formatSlateMessageDate,
  formatSlateMovedToLabMessage,
} from "../services/resolveCheckMessageService.js";
import { computeSlateRotation } from "../services/slateScopeService.js";
import { repairLabHistoryMessages0625 } from "../services/repairLabHistoryMessages0625Service.js";

const TODAY = "2026-06-25";

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
  return {
    id: `${slateDate}-${extra.player || "P1"}`,
    player: extra.player || "Test Player",
    slateDate,
    status,
    league: "WNBA",
    ...extra,
  };
}

function makeArchive(slateDate, phase = "ARCHIVED", withProps = true) {
  return {
    slateDate,
    phase,
    props: withProps ? [makeProp(slateDate, "win")] : [],
    report: makeCompletedReport(slateDate),
  };
}

function buildHistoryEntryFromArchive(archive) {
  if (!archive?.slateDate) return null;
  const hasProps = Array.isArray(archive.props) && archive.props.length > 0;
  const hasReport = Boolean(archive.report);
  if (!hasProps && !hasReport) return null;
  if (!hasProps && hasReport) {
    return {
      slateDate: archive.slateDate,
      metadataOnly: true,
      emptyLabel: `${archive.slateDate} archive metadata found but prop bundle is missing`,
    };
  }
  return { slateDate: archive.slateDate, metadataOnly: false, picks: archive.props };
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

console.log("\nLab/History Message Cleanup — 18 tests\n");

test("01 formatSlateMessageDate keeps ISO date", () => {
  assert.equal(formatSlateMessageDate("2026-06-25"), "2026-06-25");
});

test("02 moved-to-Lab message includes slate date", () => {
  assert.equal(
    formatSlateMovedToLabMessage("2026-06-24"),
    "2026-06-24 slate has already been moved to Lab."
  );
});

test("03 archived message includes slate date", () => {
  assert.equal(
    formatSlateArchivedMessage("2026-06-21"),
    "2026-06-21 slate archived to History."
  );
});

test("04 active slate pending check message is dated", () => {
  const message = buildResolveCheckMessage({
    activeResultsSlateDate: "2026-06-25",
    afterProps: [
      makeProp("2026-06-25", "pending", { player: "A" }),
      makeProp("2026-06-25", "pending", { player: "B" }),
      makeProp("2026-06-25", "pending", { player: "C" }),
      makeProp("2026-06-25", "pending", { player: "D" }),
      makeProp("2026-06-25", "pending", { player: "E" }),
    ],
    gradedCountForActiveSlate: 0,
  });
  assert.equal(message.message, "2026-06-25 slate checked: 0 graded, 5 still pending.");
});

test("05 active 06/25 check never says moved to Lab when Lab is 06/24", () => {
  const message = buildResolveCheckMessage({
    activeResultsSlateDate: "2026-06-25",
    afterProps: [makeProp("2026-06-25", "pending")],
    rotation: { currentLabSlateDate: "2026-06-24" },
    gradedCountForActiveSlate: 0,
  });
  assert.ok(!message.message.toLowerCase().includes("moved to lab"));
  assert.match(message.message, /2026-06-25 slate checked/);
});

test("06 graded count message is scoped to active slate", () => {
  const before = [makeProp("2026-06-25", "pending", { player: "A" })];
  const after = [makeProp("2026-06-25", "win", { player: "A" })];
  const graded = countNewlyGradedPropsOnSlate(after, before, "2026-06-25");
  const message = buildResolveCheckMessage({
    activeResultsSlateDate: "2026-06-25",
    beforeProps: before,
    afterProps: after,
    gradedCountForActiveSlate: graded,
  });
  assert.equal(graded, 1);
  assert.equal(message.message, "2026-06-25 slate checked: 1 graded.");
});

test("07 cross-slate global graded count does not change active message", () => {
  const message = buildResolveCheckMessage({
    activeResultsSlateDate: "2026-06-25",
    afterProps: [makeProp("2026-06-25", "pending"), makeProp("2026-06-24", "win")],
    gradedCountForActiveSlate: 0,
  });
  assert.equal(message.message, "2026-06-25 slate checked: 0 graded, 1 still pending.");
});

test("08 promoted active slate uses dated moved-to-Lab warning", () => {
  const reports = [makeCompletedReport("2026-06-24")];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  const message = buildResolveCheckMessage({
    activeResultsSlateDate: "2026-06-24",
    beforeProps: [makeProp("2026-06-24", "win")],
    afterProps: [],
    rotation,
    reports,
    gradedCountForActiveSlate: 0,
  });
  assert.equal(message.message, "2026-06-24 slate has already been moved to Lab.");
});

test("09 archived 06/21 excluded from current Lab when 06/24 exists", () => {
  const archives = [makeArchive("2026-06-21", "ARCHIVED")];
  const reports = [makeCompletedReport("2026-06-24"), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, { archives, today: TODAY });
  assert.equal(rotation.currentLabSlateDate, "2026-06-24");
  assert.ok(rotation.historySlateDates.includes("2026-06-21"));
});

test("10 06/21 without archive must not beat 06/24 for Lab", () => {
  const reports = [makeCompletedReport("2026-06-24"), makeCompletedReport("2026-06-21")];
  const rotation = computeSlateRotation(reports, { today: TODAY });
  assert.equal(rotation.currentLabSlateDate, "2026-06-24");
});

test("11 history archive entry builds from props bundle", () => {
  const entry = buildHistoryEntryFromArchive(makeArchive("2026-06-21", "ARCHIVED", true));
  assert.equal(entry.slateDate, "2026-06-21");
  assert.equal(entry.metadataOnly, false);
  assert.equal(entry.picks.length, 1);
});

test("12 metadata-only archive surfaces missing-prop error label", () => {
  const entry = buildHistoryEntryFromArchive(makeArchive("2026-06-21", "ARCHIVED", false));
  assert.equal(entry.metadataOnly, true);
  assert.match(entry.emptyLabel, /2026-06-21 archive metadata found but prop bundle is missing/);
});

test("13 empty archive without report is ignored", () => {
  const entry = buildHistoryEntryFromArchive({
    slateDate: "2026-06-21",
    phase: "ARCHIVED",
    props: [],
    report: null,
  });
  assert.equal(entry, null);
});

test("14 active Results slate stays out of Lab while pending", () => {
  const reports = [makeCompletedReport("2026-06-24"), { slateDate: "2026-06-25", status: "in-progress" }];
  const tracked = [makeProp("2026-06-25", "pending")];
  const locked = [{ slateDate: "2026-06-25", phase: "ACTIVE", lockedAt: "x" }];
  const rotation = computeSlateRotation(reports, {
    trackedProps: tracked,
    lockedSlates: locked,
    today: TODAY,
  });
  assert.equal(rotation.activeResultsSlateDate, "2026-06-25");
  assert.equal(rotation.currentLabSlateDate, "2026-06-24");
});

test("15 countNewlyGradedPropsOnSlate ignores other slates", () => {
  const before = [makeProp("2026-06-25", "pending"), makeProp("2026-06-24", "pending")];
  const after = [makeProp("2026-06-25", "win"), makeProp("2026-06-24", "win")];
  assert.equal(countNewlyGradedPropsOnSlate(after, before, "2026-06-25"), 1);
});

test("16 all-graded active slate message is dated", () => {
  const message = buildResolveCheckMessage({
    activeResultsSlateDate: "2026-06-25",
    afterProps: [makeProp("2026-06-25", "win"), makeProp("2026-06-25", "loss")],
    gradedCountForActiveSlate: 0,
  });
  assert.equal(message.message, "2026-06-25 slate checked: all 2 props already graded.");
});

test("17 repair dry-run exposes target Lab and archive dates", () => {
  const result = repairLabHistoryMessages0625({ dryRun: true });
  assert.equal(result.dryRun, true);
  assert.equal(result.archiveDate, "2026-06-21");
  assert.equal(result.targetLabDate, "2026-06-24");
  assert.ok(result.meta);
});

test("18 repair dry-run keeps 06/25 out of forced Lab swap", () => {
  const result = repairLabHistoryMessages0625({ dryRun: true });
  assert.notEqual(result.targetLabDate, "2026-06-25");
  assert.notEqual(result.archiveDate, "2026-06-25");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
