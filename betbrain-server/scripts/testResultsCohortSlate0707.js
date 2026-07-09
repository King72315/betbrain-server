/**
 * Split Results cohort slate tests — Jul 07/08 Best 6 realignment.
 * Usage: node betbrain-server/scripts/testResultsCohortSlate0707.js
 */
import assert from "assert";

import {
  buildControlledTrackingCohort,
  buildResultsTrackingCohort,
  resolveResultsCohortSlateDate,
} from "../services/trackedPropService.js";
import { getBlockingActiveResultsSlateDate } from "../services/slateScopeService.js";
import {
  previewSplitResultsCohortRepair,
} from "../services/repairSplitResultsCohortService.js";

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

function makePick(overrides = {}) {
  return {
    player: overrides.player || "Player A",
    team: overrides.team || "teamA",
    opponent: overrides.opponent || "teamB",
    league: overrides.league || "WNBA",
    side: overrides.side || "Over",
    line: overrides.line ?? 10.5,
    stat: "Points",
    commenceTime: overrides.commenceTime || "2026-07-08T23:30:00Z",
    gameDate: overrides.gameDate || "2026-07-08",
    tier: "LEAN",
    trackingType: "OFFICIAL",
    controlledBestSixDisplay: true,
    controlledBestSixRank: overrides.controlledBestSixRank ?? 1,
    ...overrides,
  };
}

console.log("\nResults cohort slate tests\n");

test("resolveResultsCohortSlateDate prefers blocking ACTIVE slate", () => {
  const slate = resolveResultsCohortSlateDate({
    todayLocalDate: "2026-07-08",
    lockedSlates: [{ slateDate: "2026-07-07", phase: "ACTIVE" }],
    trackedProps: [
      { slateDate: "2026-07-07", status: "pending", trackingType: "OFFICIAL" },
    ],
    reports: [],
  });
  assert.strictEqual(slate, "2026-07-07");
});

test("buildResultsTrackingCohort stamps cohortSlateDate on late games", () => {
  const candidates = [
    makePick({ player: "Late Game", commenceTime: "2026-07-08T23:30:00Z" }),
  ];
  const { cohort } = buildResultsTrackingCohort(candidates, {
    trackAllBestSixDisplay: true,
    sourcePool: "CONTROLLED_BEST_SIX_DISPLAY",
    cohortSlateDate: "2026-07-07",
  });
  assert.strictEqual(cohort.length, 1);
  assert.strictEqual(cohort[0].slateDate, "2026-07-07");
  assert.strictEqual(cohort[0].resultsSlateDate, "2026-07-07");
});

test("previewSplitResultsCohortRepair finds split Best 6 props", () => {
  const preview = previewSplitResultsCohortRepair({
    trackedProps: [
      {
        player: "Lexi Held",
        slateDate: "2026-07-07",
        status: "loss",
        controlledBestSixRank: 1,
      },
      {
        player: "Brittney Griner",
        slateDate: "2026-07-08",
        status: "pending",
        controlledBestSixRank: 3,
      },
    ],
    lockedSlates: [
      { slateDate: "2026-07-07", phase: "LAB" },
      { slateDate: "2026-07-08", phase: "ACTIVE" },
    ],
    bestSixSnapshot: { slateDate: "2026-07-07", pickCount: 6 },
  });
  assert.strictEqual(preview.before.cohortTrackedCount, 1);
  assert.strictEqual(preview.before.splitTrackedCount, 1);
  assert.strictEqual(preview.wouldRealign.length, 1);
  assert.strictEqual(preview.wouldRealign[0].player, "Brittney Griner");
});

test("buildControlledTrackingCohort uses blocking slate for cohort date", () => {
  const bundle = buildControlledTrackingCohort(
    {
      gameCards: [
        {
          league: "WNBA",
          picks: [makePick({ player: "Late Game" })],
        },
      ],
    },
    {
      todayLocalDate: "2026-07-08",
      lockedSlates: [{ slateDate: "2026-07-07", phase: "ACTIVE" }],
      trackedProps: [
        { slateDate: "2026-07-07", status: "pending", trackingType: "OFFICIAL" },
      ],
      controlledSelection: {
        bestSixDisplayWNBA: [makePick({ player: "Late Game" })],
        bestSixDisplayNBA: [],
        topProps: [],
      },
    }
  );
  assert.strictEqual(bundle.audit.slateDate, "2026-07-07");
  assert.strictEqual(bundle.trackingCohort[0]?.slateDate, "2026-07-07");
});

test("getBlockingActiveResultsSlateDate finds prior unresolved cohort without lock", () => {
  const blocking = getBlockingActiveResultsSlateDate(
    [
      {
        player: "Brittney Griner",
        slateDate: "2026-07-07",
        resultsSlateDate: "2026-07-07",
        status: "pending",
        controlledBestSixDisplayTracked: true,
        trackingAdmissionSource: "CONTROLLED_BEST_SIX_DISPLAY",
      },
      {
        player: "Flau'jae Johnson",
        slateDate: "2026-07-08",
        status: "pending",
        controlledBestSixDisplayTracked: true,
      },
    ],
    [],
    [],
    "2026-07-08"
  );
  assert.strictEqual(blocking, "2026-07-07");
});

test("resolveResultsCohortSlateDate uses prior unresolved when not locked", () => {
  const slate = resolveResultsCohortSlateDate({
    todayLocalDate: "2026-07-08",
    lockedSlates: [],
    trackedProps: [
      {
        slateDate: "2026-07-07",
        resultsSlateDate: "2026-07-07",
        status: "pending",
        controlledBestSixDisplayTracked: true,
      },
    ],
    reports: [],
  });
  assert.strictEqual(slate, "2026-07-07");
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
