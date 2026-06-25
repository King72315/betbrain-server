/**
 * CourtEdge WNBA Controlled Best 6 display helper tests (15 cases).
 * Usage: node betbrain-server/scripts/testControlledBestSixDisplay.js
 */
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(__dirname, "../../utils/controlledBestSixDisplay.js");
const {
  BEST_SIX_LIMIT,
  WNBA_TOP_PICK_LIMIT,
  resolveTrackEligibility,
  resolveTrueRisk,
  resolveDayBucket,
  buildTopPickBadgeMap,
  enrichBestSixForDisplay,
  filterBestSixByDateView,
  buildWnbaControlledSummary,
  shouldShowScoutMode,
  formatDateViewLabel,
  stablePickKey,
} = await import(pathToFileURL(helperPath).href);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${error.message}`);
  }
}

const todayPick = {
  player: "A'ja Wilson",
  team: "LVA",
  line: 25.5,
  side: "Over",
  dayBucket: "TODAY",
  decisionIntelligence: {
    trackEligibility: "TRACK",
    trueRisk: "LOW",
    simpleExplanation: "Strong volume profile",
    riskDebts: [{ label: "Thin edge", detail: "Line moved" }],
    riskRepairs: [{ label: "Recent form", detail: "L5 avg up" }],
  },
};

const tomorrowPick = {
  ...todayPick,
  player: "Caitlin Clark",
  dayBucket: "TOMORROW",
};

test("01 resolveTrackEligibility prefers decisionIntelligence", () => {
  assert.strictEqual(resolveTrackEligibility(todayPick), "TRACK");
  assert.strictEqual(
    resolveTrackEligibility({ wnbaTrackingDecision: "BOARD_ONLY" }),
    "BOARD_ONLY"
  );
});

test("02 resolveTrueRisk reads decisionIntelligence", () => {
  assert.strictEqual(resolveTrueRisk(todayPick), "LOW");
  assert.strictEqual(resolveTrueRisk({ trueRisk: "HIGH" }), "HIGH");
});

test("03 resolveDayBucket handles bucket and label", () => {
  assert.strictEqual(resolveDayBucket({ dayBucket: "TODAY" }), "TODAY");
  assert.strictEqual(resolveDayBucket({ dateLabel: "Tomorrow" }), "TOMORROW");
});

test("04 stablePickKey is deterministic", () => {
  assert.strictEqual(stablePickKey(todayPick), stablePickKey(todayPick));
  assert.notStrictEqual(stablePickKey(todayPick), stablePickKey(tomorrowPick));
});

test("05 buildTopPickBadgeMap assigns Top WNBA labels", () => {
  const map = buildTopPickBadgeMap([
    {
      ...todayPick,
      topPickRank: 1,
      topPickLabel: "Top WNBA #1",
    },
  ]);
  const meta = map.get(stablePickKey(todayPick));
  assert.strictEqual(meta.topPickLabel, "Top WNBA #1");
});

test("06 enrichBestSixForDisplay adds rank and badges", () => {
  const map = buildTopPickBadgeMap([
    { ...todayPick, topPickRank: 1, topPickLabel: "Top WNBA #1" },
  ]);
  const enriched = enrichBestSixForDisplay(
    { ...todayPick, bestSixRank: 2 },
    map,
    1
  );
  assert.strictEqual(enriched.bestSixRank, 2);
  assert.strictEqual(enriched.topPickLabel, "Top WNBA #1");
  assert.strictEqual(enriched.displayTrackEligibility, "TRACK");
  assert.ok(enriched.displayRiskDebts.length > 0);
});

test("07 filterBestSixByDateView filters today only", () => {
  const filtered = filterBestSixByDateView([todayPick, tomorrowPick], "today");
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].player, "A'ja Wilson");
});

test("08 filterBestSixByDateView full_board returns all", () => {
  const filtered = filterBestSixByDateView([todayPick, tomorrowPick], "full_board");
  assert.strictEqual(filtered.length, 2);
});

test("09 buildWnbaControlledSummary counts board candidates", () => {
  const summary = buildWnbaControlledSummary({
    bestSixWNBA: [todayPick],
    topWNBAProps: [{ ...todayPick, topPickRank: 1 }],
    wnbaGames: [
      {
        league: "WNBA",
        dayBucket: "TODAY",
        allGeneratedCandidates: [
          todayPick,
          {
            player: "Board Only",
            decisionIntelligence: { trackEligibility: "BOARD_ONLY" },
            dayBucket: "TODAY",
          },
          {
            player: "No Bet",
            decisionIntelligence: { trackEligibility: "NO_BET" },
            dayBucket: "TODAY",
          },
        ],
      },
    ],
    dateView: "today",
  });
  assert.strictEqual(summary.controlledBestSixTotal, 1);
  assert.strictEqual(summary.topPicks, 1);
  assert.strictEqual(summary.boardCandidates, 3);
  assert.strictEqual(summary.boardOnly, 1);
  assert.strictEqual(summary.noBet, 1);
});

test("10 summary uses Board Candidates label not Playable", () => {
  const summary = buildWnbaControlledSummary({ wnbaGames: [], dateView: "today" });
  assert.ok("boardCandidates" in summary);
  assert.strictEqual(summary.bestSixLimit, BEST_SIX_LIMIT);
  assert.strictEqual(summary.topPickLimit, WNBA_TOP_PICK_LIMIT);
});

test("11 shouldShowScoutMode full_board is true", () => {
  assert.strictEqual(shouldShowScoutMode("full_board", false), true);
});

test("12 shouldShowScoutMode today needs toggle", () => {
  assert.strictEqual(shouldShowScoutMode("today", false), false);
  assert.strictEqual(shouldShowScoutMode("today", true), true);
});

test("13 formatDateViewLabel maps views", () => {
  assert.strictEqual(formatDateViewLabel("today"), "Today");
  assert.strictEqual(formatDateViewLabel("tomorrow"), "Tomorrow");
  assert.strictEqual(formatDateViewLabel("full_board"), "Full Board");
});

test("14 tomorrow summary scopes candidates", () => {
  const summary = buildWnbaControlledSummary({
    bestSixWNBA: [tomorrowPick],
    wnbaGames: [
      {
        league: "WNBA",
        allGeneratedCandidates: [todayPick, tomorrowPick],
      },
    ],
    dateView: "tomorrow",
  });
  assert.strictEqual(summary.controlledBestSixTotal, 1);
  assert.strictEqual(summary.boardCandidates, 1);
});

test("15 enrichBestSixForDisplay falls back to wnbaTrackingReason", () => {
  const enriched = enrichBestSixForDisplay(
    { player: "X", wnbaTrackingReason: "Gate blocked", wnbaTrackingDecision: "NO_BET" },
    new Map(),
    0
  );
  assert.strictEqual(enriched.displayWhy, "Gate blocked");
  assert.strictEqual(enriched.displayTrackEligibility, "NO_BET");
});

console.log(`\nControlled Best Six display: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
