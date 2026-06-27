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
  HOME_DATE_VIEW,
  filterBestSixByDateView,
  prepareBestSixDisplayCards,
  assertContiguousBestSixRanks,
  buildWnbaControlledSummary,
  shouldShowScoutMode,
  formatDateViewLabel,
  stablePickKey,
  buildWnbaControlledBestSixReportText,
  buildLeagueBestSixBoard,
  buildHomeControlledBestSixReportText,
  resolveLeaguePicksPayload,
  resolveDateScopedDisplayPool,
  selectTopTwoFromDisplayBestSix,
  isResultsPoolTrackProp,
  formatControlledBestSixPickLine,
  countCandidatesByEligibility,
  resolveBestSixDisplayPool,
} = await import(pathToFileURL(helperPath).href);

const selectorPath = path.resolve(
  __dirname,
  "../engines/topProps/controlledBestSixSelector.js"
);
const diPath = path.resolve(
  __dirname,
  "../engines/decisionIntelligence/propDecisionIntelligenceV1.js"
);
const gatePath = path.resolve(__dirname, "../engines/wnba/wnbaTrackingGateV2.js");
const readerPath = path.resolve(__dirname, "../engines/wnba/wnbaReaderEngine.js");

const { selectControlledBestSix, selectBestSixDisplay } = await import(
  pathToFileURL(selectorPath).href
);
const {
  applyDecisionIntelligenceToPick,
  evaluatePropDecisionIntelligenceV1,
} = await import(pathToFileURL(diPath).href);
const { evaluateWnbaTrackingGateV2 } = await import(pathToFileURL(gatePath).href);
const { readWnbaProp } = await import(pathToFileURL(readerPath).href);

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
    { ...todayPick, bestSixRank: 5, controlledBestSixRank: 5 },
    map,
    0
  );
  assert.strictEqual(enriched.bestSixRank, 1);
  assert.strictEqual(enriched.serverBestSixRank, 5);
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
  assert.strictEqual(summary.controlledBestSixTotal, 3);
  assert.strictEqual(summary.boardCandidates, 3);
  assert.strictEqual(summary.track, 1);
  assert.strictEqual(summary.boardOnly, 1);
  assert.strictEqual(summary.noBet, 1);
  assert.strictEqual(summary.topPicks, 2);
  assert.strictEqual(summary.track + summary.boardOnly + summary.noBet, summary.boardCandidates);
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

test("14 tomorrow summary scopes board candidates only", () => {
  const summary = buildWnbaControlledSummary({
    bestSixWNBA: [tomorrowPick],
    bestSixDisplayWNBA: [todayPick, tomorrowPick],
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

function makeDearicaHambyFixture() {
  const card = {
    version: "wnba-data-card-v2",
    player: "Dearica Hamby",
    bookLine: 15.5,
    bookCount: 5,
    marketQuality: 70,
    dataMode: "WNBA_LIMITED_DATA",
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
    dataConfidenceScore: 72,
    dataMissingFlags: [],
    injuryAvailability: { level: "ACTIVE", blocksPlay: false },
  };
  const reader = readWnbaProp(card);
  return {
    player: "Dearica Hamby",
    team: "LAS",
    opponent: "SEA",
    line: 15.5,
    side: "Under",
    pick: "Under",
    league: "WNBA",
    netEdge: 6,
    wnbaDataCard: card,
    wnbaReader: reader,
  };
}

test("16 default report uses Controlled Best 6 section", () => {
  const report = buildWnbaControlledBestSixReportText({
    bestSixCards: [enrichBestSixForDisplay(todayPick, new Map(), 0)],
    summary: buildWnbaControlledSummary({
      bestSixWNBA: [todayPick],
      wnbaGames: [],
      dateView: "today",
    }),
    dateView: "today",
  });
  assert.ok(report.includes("--- Controlled Best 6 ---"));
  assert.ok(!report.includes("--- Top WNBA Props ---"));
});

test("17 default report hides Game Board section", () => {
  const report = buildWnbaControlledBestSixReportText({
    bestSixCards: [],
    summary: buildWnbaControlledSummary({ wnbaGames: [{ league: "WNBA", picks: [] }], dateView: "today" }),
    games: [{ game: "A @ B", picks: [{ player: "X" }] }],
    includeFullBoard: false,
    dateView: "today",
  });
  assert.ok(!report.includes("--- Game Board ---"));
  assert.ok(!report.includes("Point Strength Ledger"));
});

test("18 default report summary has no Playable label", () => {
  const report = buildWnbaControlledBestSixReportText({
    bestSixCards: [],
    summary: buildWnbaControlledSummary({ wnbaGames: [], dateView: "today" }),
    dateView: "today",
  });
  assert.ok(report.includes("Board Candidates:"));
  assert.ok(!/Playable/i.test(report));
});

test("19 default report summary uses Controlled Best 6 X/6", () => {
  const report = buildWnbaControlledBestSixReportText({
    bestSixCards: [todayPick],
    summary: {
      controlledBestSixTotal: 1,
      bestSixLimit: 6,
      topPicks: 1,
      topPickLimit: 2,
      boardCandidates: 3,
      boardOnly: 1,
      noBet: 1,
    },
    dateView: "today",
  });
  assert.ok(report.includes("Controlled Best 6: 1/6"));
  assert.ok(report.includes("Top Picks: 1/2"));
});

test("20 compact pick line excludes score ledger", () => {
  const line = formatControlledBestSixPickLine(
    {
      ...todayPick,
      bestSixRank: 1,
      scoreLedger: [{ label: "Hidden ledger", side: "OVER" }],
    },
    0
  );
  assert.ok(!line.includes("Point Strength Ledger"));
  assert.ok(!line.includes("Hidden ledger"));
});

test("21 Dearica Hamby BOARD_ONLY excluded from Best 6 selector", () => {
  const dearica = makeDearicaHambyFixture();
  const gate = evaluateWnbaTrackingGateV2(dearica);
  const di = evaluatePropDecisionIntelligenceV1(dearica, { gate });
  assert.notStrictEqual(di.trackEligibility, "TRACK");
  const enrichedDearica = applyDecisionIntelligenceToPick(dearica, di, gate);
  const trackPick = applyDecisionIntelligenceToPick(
    todayPick,
    evaluatePropDecisionIntelligenceV1(todayPick, {
      gate: evaluateWnbaTrackingGateV2(todayPick),
    }),
    evaluateWnbaTrackingGateV2(todayPick)
  );
  const { bestSix } = selectControlledBestSix([enrichedDearica, trackPick], "WNBA");
  assert.ok(!bestSix.some((pick) => pick.player === "Dearica Hamby"));
});

test("22 scout-expanded report still omits game board dump", () => {
  const report = buildWnbaControlledBestSixReportText({
    bestSixCards: [],
    summary: buildWnbaControlledSummary({ wnbaGames: [], dateView: "full_board" }),
    games: [{ game: "A @ B", picks: [{ player: "Ledger Player" }] }],
    includeFullBoard: true,
    dateView: "full_board",
  });
  assert.ok(report.includes("Scout Mode"));
  assert.ok(!report.includes("Ledger Player"));
  assert.ok(!report.includes("--- Game Board ---"));
});

test("23 top pick badge appears in compact report line", () => {
  const line = formatControlledBestSixPickLine(
    enrichBestSixForDisplay(
      todayPick,
      buildTopPickBadgeMap([{ ...todayPick, topPickRank: 1, topPickLabel: "Top WNBA #1" }]),
      0
    ),
    0
  );
  assert.ok(line.includes("Top WNBA #1"));
});

test("24 today view report title matches simplified spec", () => {
  const report = buildWnbaControlledBestSixReportText({
    bestSixCards: [],
    summary: buildWnbaControlledSummary({ wnbaGames: [], dateView: "today" }),
    dateView: "today",
  });
  assert.ok(report.startsWith("WNBA Props — Controlled Best 6"));
  assert.ok(report.includes("View: Today"));
});

test("25 WNBA without gate inputs cannot enter Best 6", () => {
  const bare = {
    player: "Bare WNBA",
    team: "T1",
    line: 10.5,
    side: "Over",
    pick: "Over",
    league: "WNBA",
  };
  const { bestSix } = selectControlledBestSix([bare], "WNBA");
  assert.strictEqual(bestSix.length, 0);
});

test("26 shouldShowScoutMode false keeps full board out of default UX", () => {
  assert.strictEqual(shouldShowScoutMode("today", false), false);
});

test("27 acceptance: default report structure has summary then controlled list only", () => {
  const report = buildWnbaControlledBestSixReportText({
    bestSixCards: [enrichBestSixForDisplay(todayPick, new Map(), 0)],
    summary: buildWnbaControlledSummary({
      bestSixWNBA: [todayPick],
      topWNBAProps: [{ ...todayPick, topPickRank: 1 }],
      wnbaGames: [
        {
          league: "WNBA",
          allGeneratedCandidates: [
            todayPick,
            { player: "Board", decisionIntelligence: { trackEligibility: "BOARD_ONLY" } },
          ],
        },
      ],
      dateView: "today",
    }),
    dateView: "today",
  });
  const summaryIndex = report.indexOf("--- Summary ---");
  const listIndex = report.indexOf("--- Controlled Best 6 ---");
  assert.ok(summaryIndex >= 0 && listIndex > summaryIndex);
  assert.ok(!report.includes("--- Game Board ---"));
  assert.ok(!report.includes("Top Props:"));
});

test("28 count reconciliation includes shadow-only bucket", () => {
  const candidates = [
    todayPick,
    {
      player: "Shadow",
      decisionIntelligence: { trackEligibility: "SHADOW_ONLY" },
      dayBucket: "TODAY",
    },
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
  ];
  const counts = countCandidatesByEligibility(candidates);
  assert.strictEqual(counts.track, 1);
  assert.strictEqual(counts.shadowOnly, 1);
  assert.strictEqual(counts.boardOnly, 1);
  assert.strictEqual(counts.noBet, 1);
  assert.strictEqual(
    counts.track + counts.shadowOnly + counts.boardOnly + counts.noBet + counts.other,
    candidates.length
  );
});

test("29 resolveBestSixDisplayPool prefers display array", () => {
  const display = [{ player: "Display" }];
  const results = [{ player: "Results" }];
  assert.strictEqual(resolveBestSixDisplayPool(display, results)[0].player, "Display");
  assert.strictEqual(resolveBestSixDisplayPool([], results)[0].player, "Results");
});

test("30 display Best 6 can exceed TRACK-only Results Best 6", () => {
  const trackPick = applyDecisionIntelligenceToPick(
    todayPick,
    evaluatePropDecisionIntelligenceV1(todayPick, {
      gate: evaluateWnbaTrackingGateV2(todayPick),
    }),
    evaluateWnbaTrackingGateV2(todayPick)
  );
  const boardOnlyPick = {
    ...makeDearicaHambyFixture(),
    netEdge: 8,
    confidence: 80,
  };
  const preparedBoard = applyDecisionIntelligenceToPick(
    boardOnlyPick,
    evaluatePropDecisionIntelligenceV1(boardOnlyPick, {
      gate: evaluateWnbaTrackingGateV2(boardOnlyPick),
    }),
    evaluateWnbaTrackingGateV2(boardOnlyPick)
  );
  const pool = [preparedBoard, trackPick];
  const display = selectBestSixDisplay(pool, "WNBA");
  const results = selectControlledBestSix(pool, "WNBA");
  assert.ok(display.bestSix.length >= results.bestSix.length);
  assert.ok(
    display.bestSix.some((pick) => pick.resultsAdmissionEligible === false)
  );
  assert.ok(results.bestSix.every((pick) => pick.resultsAdmissionEligible !== false));
});

test("31 summary uses display pool for controlled total", () => {
  const summary = buildWnbaControlledSummary({
    bestSixWNBA: [todayPick],
    bestSixDisplayWNBA: [todayPick, tomorrowPick],
    wnbaGames: [],
    dateView: "full_board",
  });
  assert.strictEqual(summary.controlledBestSixTotal, 2);
  assert.strictEqual(summary.controlledBestSixTrack, 1);
});

test("32 acceptance: 15 candidates yield 6 display Best 6 with full brain", () => {
  const makePoolPick = (i, overScore, boardOnly = i > 0) => ({
    player: `Pool${i}`,
    team: `T${i % 6}`,
    opponent: "OPP",
    gameId: `g${i % 5}`,
    line: 10 + i * 0.5,
    side: "Over",
    pick: "Over",
    league: "WNBA",
    netEdge: 10 - i * 0.3,
    confidence: 85 - i,
    wnbaDataCard: boardOnly
      ? {
          bookLine: 10 + i * 0.5,
          dataConfidenceScore: 55,
          projection: { projection: 12 },
          last5: { points: 10, minutes: 20, fga: 6 },
          bookCount: 2,
          marketQuality: 45,
          dataMissingFlags: [],
          roleTrend: "down",
          minutesVolatility: "volatile",
          dataMode: "WNBA_LIMITED_DATA",
        }
      : {
          bookLine: 10 + i * 0.5,
          dataConfidenceScore: 72,
          projection: { projection: 18 },
          last5: { points: 17, minutes: 30, fga: 12 },
          bookCount: 5,
          dataMissingFlags: [],
        },
    wnbaReader: {
      decision: "TEST",
      finalSide: "OVER",
      readerConfidence: boardOnly ? 55 : 68,
      margin: boardOnly ? 4 : 8,
      overCase: { score: overScore },
      underCase: { score: 20 },
    },
  });

  const pool = Array.from({ length: 15 }, (_, i) => makePoolPick(i, 90 - i));
  const display = selectBestSixDisplay(pool, "WNBA");
  const results = selectControlledBestSix(pool, "WNBA");

  assert.strictEqual(display.controlledBestSixDisplayAudit.candidateCount, 15);
  assert.strictEqual(display.bestSix.length, BEST_SIX_LIMIT);
  assert.ok(display.bestSix.every((p) => p.decisionIntelligence?.trueRisk));
  assert.ok(display.bestSix.every((p) => p.sideRescue || p.decisionIntelligence));
  assert.ok(display.bestSix.some((p) => p.resultsAdmissionEligible === false));
  assert.ok(results.bestSix.every((p) => p.decisionIntelligence?.trackEligibility === "TRACK"));
  assert.ok(display.bestSix.length > results.bestSix.length);
});

test("33 prepareBestSixDisplayCards renumbers contiguously after server gaps", () => {
  const cards = prepareBestSixDisplayCards(
    [
      { ...todayPick, controlledBestSixRank: 2, dayBucket: "TODAY" },
      { ...tomorrowPick, controlledBestSixRank: 4, dayBucket: "TOMORROW" },
      {
        ...todayPick,
        player: "Angel Reese",
        controlledBestSixRank: 5,
        dayBucket: "TODAY",
        decisionIntelligence: { trackEligibility: "BOARD_ONLY", trueRisk: "MEDIUM" },
      },
    ],
    new Map()
  );
  const check = assertContiguousBestSixRanks(cards);
  assert.strictEqual(check.ok, true);
  assert.strictEqual(cards[0].bestSixRank, 1);
  assert.strictEqual(cards[1].bestSixRank, 2);
  assert.strictEqual(cards[2].bestSixRank, 3);
  assert.strictEqual(cards[0].serverBestSixRank, 2);
});

test("34 today view scopes controlled total to today picks only", () => {
  const summary = buildWnbaControlledSummary({
    bestSixDisplayWNBA: [todayPick, tomorrowPick],
    bestSixWNBA: [todayPick],
    wnbaGames: [],
    dateView: "today",
  });
  assert.strictEqual(summary.controlledBestSixTotal, 1);
  assert.strictEqual(summary.bestSixHiddenByDateView, 1);
  assert.strictEqual(summary.controlledBestSixTrack, 1);
});

test("35 TRACK pick visible in prepared display cards", () => {
  const cards = prepareBestSixDisplayCards([todayPick], new Map());
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].displayTrackEligibility, "TRACK");
  assert.strictEqual(cards[0].bestSixRank, 1);
});

test("36 HOME_DATE_VIEW is tomorrow for Home tab", () => {
  assert.strictEqual(HOME_DATE_VIEW, "tomorrow");
  const filtered = filterBestSixByDateView([todayPick, tomorrowPick], HOME_DATE_VIEW);
  assert.strictEqual(filtered.length, 1);
  assert.strictEqual(filtered[0].player, "Caitlin Clark");
});

test("37 prepareBestSixDisplayCards respects date filter before rank enrichment", () => {
  const cards = prepareBestSixDisplayCards(
    filterBestSixByDateView([todayPick, tomorrowPick], "tomorrow"),
    new Map(),
    "WNBA"
  );
  assert.strictEqual(cards.length, 1);
  assert.strictEqual(cards[0].bestSixRank, 1);
  assert.strictEqual(cards[0].player, "Caitlin Clark");
});

test("38 buildLeagueBestSixBoard supports NBA league labels", () => {
  const nbaPick = {
    ...tomorrowPick,
    league: "NBA",
    player: "Nikola Jokic",
    decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "LOW" },
  };
  const board = buildLeagueBestSixBoard({
    league: "NBA",
    bestSixDisplay: [nbaPick],
    topProps: [{ ...nbaPick, topPickRank: 1 }],
    dateView: "tomorrow",
  });
  assert.strictEqual(board.league, "NBA");
  assert.strictEqual(board.bestSixCards.length, 1);
  assert.strictEqual(board.bestSixCards[0].bestSixLabel, "Best NBA #1");
  assert.strictEqual(board.bestSixCards[0].topPickLabel, "Top NBA #1");
});

test("39 resolveLeaguePicksPayload maps NBA fields from refresh payload", () => {
  const payload = resolveLeaguePicksPayload(
    {
      nbaGames: [{ league: "NBA", game: "DEN @ LAL" }],
      bestSixNBA: [{ player: "Jokic", league: "NBA" }],
      bestSixDisplayNBA: [{ player: "Jokic", league: "NBA", dayBucket: "TOMORROW" }],
      topNBAProps: [{ player: "Jokic", league: "NBA", topPickRank: 1 }],
    },
    "NBA"
  );
  assert.strictEqual(payload.league, "NBA");
  assert.strictEqual(payload.games.length, 1);
  assert.strictEqual(payload.bestSix.length, 1);
  assert.strictEqual(payload.topProps.length, 1);
});

test("40 home report includes both leagues", () => {
  const report = buildHomeControlledBestSixReportText({
    dateView: HOME_DATE_VIEW,
    wnba: {
      bestSixCards: [],
      summary: { bestSixLimit: 6, topPickLimit: 2 },
      games: [],
    },
    nba: {
      bestSixCards: [],
      summary: { bestSixLimit: 6, topPickLimit: 2 },
      games: [],
    },
  });
  assert.match(report, /CourtEdge Home — Tomorrow Controlled Best 6/);
  assert.match(report, /WNBA Props — Controlled Best 6/);
  assert.match(report, /NBA Props — Controlled Best 6/);
});

test("41 tomorrow display fills to 6 from board candidates", () => {
  const makeTomorrowCandidate = (player, rank, eligibility = "BOARD_ONLY") => ({
    player,
    team: "TST",
    line: 10,
    side: "Over",
    dayBucket: "TOMORROW",
    confidence: 80 - rank,
    controlledBestSixRank: rank,
    decisionIntelligence: { trackEligibility: eligibility, trueRisk: "LOW" },
  });

  const slateDisplay = [1, 2, 3, 4].map((rank) =>
    makeTomorrowCandidate(`Slate ${rank}`, rank, rank <= 2 ? "TRACK" : "BOARD_ONLY")
  );
  slateDisplay.push(
    { ...todayPick, bestSixRank: 5 },
    { ...todayPick, player: "Today Only", bestSixRank: 6 }
  );

  const games = [
    {
      league: "WNBA",
      dayBucket: "TOMORROW",
      allGeneratedCandidates: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((rank) =>
        makeTomorrowCandidate(`Candidate ${rank}`, rank)
      ),
    },
  ];

  const board = buildLeagueBestSixBoard({
    league: "WNBA",
    bestSix: slateDisplay.filter((p) => resolveTrackEligibility(p) === "TRACK").slice(0, 1),
    bestSixDisplay: slateDisplay,
    topProps: [{ ...slateDisplay[0], topPickRank: 1 }],
    games,
    dateView: "tomorrow",
  });

  assert.strictEqual(board.bestSixCards.length, 6);
  assert.strictEqual(board.summary.controlledBestSixTotal, 6);
  assert.strictEqual(board.bestSixCards[0].bestSixRank, 1);
  assert.strictEqual(board.bestSixCards[5].bestSixRank, 6);
});

test("42 Results Track uses Results pool not display Decision TRACK", () => {
  const displayTrackNotResults = {
    ...tomorrowPick,
    player: "DeWanna Bonner",
    decisionIntelligence: {
      trackEligibility: "TRACK",
      bestSixEligibility: false,
      simpleExplanation: "Side rescue demoted",
    },
    resultsAdmissionEligible: false,
  };
  const resultsTrack = {
    ...tomorrowPick,
    player: "Marina Mabrey",
    decisionIntelligence: { trackEligibility: "TRACK", bestSixEligibility: true },
    resultsAdmissionEligible: true,
  };

  const board = buildLeagueBestSixBoard({
    league: "WNBA",
    bestSix: [resultsTrack],
    bestSixDisplay: [resultsTrack, displayTrackNotResults],
    topProps: [{ ...resultsTrack, topPickRank: 1 }],
    games: [
      {
        league: "WNBA",
        dayBucket: "TOMORROW",
        allGeneratedCandidates: [resultsTrack, displayTrackNotResults],
      },
    ],
    dateView: "tomorrow",
  });

  assert.strictEqual(board.summary.controlledBestSixTrack, 1);
  assert.strictEqual(isResultsPoolTrackProp(displayTrackNotResults), false);
  assert.strictEqual(board.bestSixCards[1].resultsAdmissionEligible, false);
});

test("43 top picks count derives from display Best 6 ranks not Results pool", () => {
  const track1 = {
    ...tomorrowPick,
    player: "Marina Mabrey",
    team: "CON",
    decisionIntelligence: { trackEligibility: "TRACK", bestSixEligibility: true },
  };
  const boardOnly2 = {
    ...tomorrowPick,
    player: "Kahleah Copper",
    team: "PHX",
    decisionIntelligence: { trackEligibility: "BOARD_ONLY", bestSixEligibility: true },
  };
  const track3 = {
    ...tomorrowPick,
    player: "DeWanna Bonner",
    team: "IND",
    decisionIntelligence: { trackEligibility: "TRACK", bestSixEligibility: false },
    resultsAdmissionEligible: false,
  };

  const board = buildLeagueBestSixBoard({
    league: "WNBA",
    bestSix: [track1],
    bestSixDisplay: [track1, boardOnly2, track3],
    topProps: [{ ...track1, topPickRank: 1 }],
    dateView: "tomorrow",
  });

  assert.strictEqual(board.summary.topPicks, 2);
  assert.strictEqual(board.bestSixCards.filter((c) => c.topPickRank).length, 2);
  assert.strictEqual(board.bestSixCards[0].topPickLabel, "Top WNBA #1");
  assert.strictEqual(board.bestSixCards[1].topPickLabel, "Top WNBA #2");
  assert.strictEqual(board.bestSixCards[1].player, "Kahleah Copper");
});

test("44 home tomorrow board matches summary row count", () => {
  const games = [
    {
      league: "WNBA",
      dayBucket: "TOMORROW",
      allGeneratedCandidates: Array.from({ length: 11 }, (_, i) => ({
        ...tomorrowPick,
        player: `P${i + 1}`,
        confidence: 90 - i,
        dayBucket: "TOMORROW",
      })),
    },
  ];
  const display = games[0].allGeneratedCandidates.slice(0, 4);

  const board = buildLeagueBestSixBoard({
    league: "WNBA",
    bestSix: display.filter((_, i) => i === 0),
    bestSixDisplay: display,
    games,
    dateView: HOME_DATE_VIEW,
  });

  assert.strictEqual(board.summary.controlledBestSixTotal, board.bestSixCards.length);
  assert.strictEqual(board.bestSixCards.length, 6);
});

console.log(`\nControlled Best Six display: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
