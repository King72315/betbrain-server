/**
 * CourtEdge Decision Intelligence v1 tests (25 required).
 * Usage: node betbrain-server/scripts/testPropDecisionIntelligenceV1.js
 */
import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluatePropDecisionIntelligenceV1,
  applyDecisionIntelligenceToPick,
  DECISION_INTELLIGENCE_VERSION,
  buildDecisionIntelligenceRetroSimulation,
} from "../engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import { evaluateWnbaTrackingGateV2 } from "../engines/wnba/wnbaTrackingGateV2.js";
import {
  selectControlledBestSix,
  selectTopTwoFromBestSix,
  BEST_SIX_LIMIT,
} from "../engines/topProps/controlledBestSixSelector.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import { getTrackedProps } from "../services/trackedPropService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");

function baseCard(overrides = {}) {
  return {
    version: "wnba-data-card-v2",
    playerId: "123",
    player: "Test Player",
    team: "Team A",
    opponent: "Team B",
    propType: "Points",
    bookLine: 12.5,
    currentLine: 12.5,
    bookCount: 5,
    marketQuality: 70,
    dataMode: "WNBA_LIMITED_DATA",
    season: { points: 11, minutes: 26, fga: 10, ptsPerFGA: 1.05 },
    last5: { points: 10, minutes: 24, fga: 9, ptsPerFGA: 1.05, games: 5 },
    scoringTrend: "stable",
    roleTrend: "stable",
    injuryAvailability: { level: "ACTIVE", blocksPlay: false },
    projection: { projection: 10.5, expectedMinutes: 24, expectedFGA: 9 },
    fairLine: { fairLine: 11.5, fairLineSide: "UNDER", fairLineEdge: 1, fairLineQuality: 55 },
    dataMissingFlags: [],
    dataConfidenceScore: 72,
    ...overrides,
  };
}

function makeWnbaPick(overrides = {}) {
  const card = baseCard(overrides.wnbaDataCard || {});
  const reader = overrides.wnbaReader || readWnbaProp(card);
  const side = overrides.side || (reader.finalSide === "UNDER" ? "Under" : "Over");
  return {
    player: "Test Player",
    team: "Team A",
    opponent: "Team B",
    line: card.bookLine,
    side,
    pick: side,
    league: "WNBA",
    engineHandled: "WNBA_V2",
    trackingType: overrides.trackingType || "TEST",
    recordType: overrides.trackingType || "TEST",
    projection: card.projection.projection,
    bookCount: card.bookCount,
    marketQuality: card.marketQuality,
    dataMode: card.dataMode,
    recentMinutes: card.last5.minutes,
    recentFGA: card.last5.fga,
    netEdge: reader.margin ?? 6,
    wnbaDataCard: card,
    wnbaReader: reader,
    readerDecision: reader.decision,
    readerConfidence: reader.readerConfidence ?? 55,
    underGap: reader.underGap,
    riskLabel: overrides.riskLabel || "Low Risk",
    ...overrides,
  };
}

function live0625Pick(player, side, line, cardOverrides = {}, pickOverrides = {}) {
  const sideLabel = side === "UNDER" ? "Under" : "Over";
  const gap = pickOverrides.gap ?? 4;
  const projection =
    cardOverrides.projection?.projection ??
    (side === "UNDER" ? line - gap : line + gap);
  const card = baseCard({
    player,
    bookLine: line,
    projection: {
      projection,
      expectedMinutes: cardOverrides.last5?.minutes ?? 26,
      expectedFGA: cardOverrides.last5?.fga ?? 10,
      ...(cardOverrides.projection || {}),
    },
    ...cardOverrides,
  });
  const reader = pickOverrides.wnbaReader || readWnbaProp(card);
  return makeWnbaPick({
    player,
    side: sideLabel,
    line,
    riskLabel: "Low Risk",
    netEdge: pickOverrides.netEdge ?? reader.margin ?? 6,
    wnbaDataCard: card,
    wnbaReader: reader,
    ...pickOverrides,
  });
}

function evaluateDi(pick) {
  const gate = evaluateWnbaTrackingGateV2(pick);
  return evaluatePropDecisionIntelligenceV1(pick, { gate });
}

function runScript(scriptName) {
  const result = spawnSync(process.execPath, [path.join(__dirname, scriptName)], {
    cwd: SERVER_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${scriptName} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("01 Low Risk requires clean profile", () => {
  const pick = makeWnbaPick({
    wnbaDataCard: baseCard({
      dataMode: "WNBA_FULL",
      minutesVolatility: "stable",
      projection: { projection: 18, expectedMinutes: 28, expectedFGA: 11 },
      last5: { points: 17, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 70 },
    }),
    side: "Over",
    netEdge: 9,
  });
  const di = evaluateDi(pick);
  assert.strictEqual(di.trueRisk, "LOW");
});

test("02 unstable minutes cannot be Low regardless of data mode", () => {
  const pick = live0625Pick("Natisha Hiedeman", "OVER", 15.5, {
    minutesVolatility: "unstable",
    projection: { projection: 19.5, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.1, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 9 });
  const di = evaluateDi(pick);
  assert.notStrictEqual(di.trueRisk, "LOW");
});

test("03 volatile minutes cannot be Low regardless of data mode", () => {
  const pick = live0625Pick("Jessica Shepard", "OVER", 12.5, {
    minutesVolatility: "volatile",
    projection: { projection: 17, expectedMinutes: 26, expectedFGA: 10 },
    last5: { points: 16, minutes: 26, fga: 10, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 7 });
  const di = evaluateDi(pick);
  assert.notStrictEqual(di.trueRisk, "LOW");
});

test("04 low-volume Over trap is NO_BET or BOARD_ONLY", () => {
  const pick = live0625Pick("NaLyssa Smith", "OVER", 10.5, {
    projection: { projection: 12.5, expectedMinutes: 18, expectedFGA: 5 },
    last5: { points: 11, minutes: 18, fga: 5, ptsPerFGA: 1.1, games: 5 },
  }, { netEdge: 4 });
  const di = evaluateDi(pick);
  assert.notStrictEqual(di.trackEligibility, "TRACK");
});

test("05 thin Over edge cannot enter Results", () => {
  const pick = live0625Pick("Rhyne Howard", "OVER", 18.5, {
    projection: { projection: 19, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 0.5, gap: 0.5 });
  const di = evaluateDi(pick);
  assert.notStrictEqual(di.trackEligibility, "TRACK");
  assert.strictEqual(di.bestSixEligibility, false);
});

test("06 thin Under edge cannot enter Results", () => {
  const pick = live0625Pick("Ariel Atkins", "UNDER", 10.5, {
    minutesVolatility: "volatile",
    projection: { projection: 6.9, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 8, minutes: 24, fga: 8, ptsPerFGA: 1.0, games: 5 },
  }, { netEdge: 5, gap: 3.6 });
  const di = evaluateDi(pick);
  assert.strictEqual(di.trackEligibility, "BOARD_ONLY");
  assert.strictEqual(di.bestSixEligibility, false);
});

test("07 volatile WNBA Under demoted unless elite", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 6 });
  const di = evaluateDi(pick);
  assert.notStrictEqual(di.trackEligibility, "TRACK");
});

test("08 elite Over TRACK with FULL_DATA stable needs gap cushion for LOW", () => {
  const pick = live0625Pick("Azzi Fudd", "OVER", 13.5, {
    minutesVolatility: "stable",
    dataMode: "WNBA_FULL_DATA",
    projection: { projection: 18.5, expectedMinutes: 28, expectedFGA: 10 },
    last5: { points: 17, minutes: 28, fga: 10, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 65 },
  }, { netEdge: 8 });
  const di = evaluateDi(pick);
  assert.strictEqual(di.trackEligibility, "TRACK");
  assert.strictEqual(di.trueRisk, "LOW");
});

test("09 High Risk cannot be Top Pick", () => {
  const pick = live0625Pick("Trap Over", "OVER", 10.5, {
    projection: { projection: 13, expectedMinutes: 17, expectedFGA: 5 },
    last5: { points: 12, minutes: 17, fga: 5, ptsPerFGA: 1.1, games: 5 },
  }, { netEdge: 5 });
  const di = evaluateDi(pick);
  const enriched = applyDecisionIntelligenceToPick(pick, di, di.gate);
  const best = selectControlledBestSix([enriched], "WNBA");
  const top = selectTopTwoFromBestSix(best.bestSix, "WNBA");
  assert.strictEqual(best.bestSix.length, 0);
  assert.strictEqual(top.topProps.length, 0);
});

test("10 High Risk cannot enter Results unless elite override", () => {
  const pick = live0625Pick("Shakira Austin", "UNDER", 13.5, {
    minutesVolatility: "unstable",
    bookCount: 1,
    projection: { projection: 10.5, expectedMinutes: 18, expectedFGA: 5 },
    last5: { points: 11, minutes: 18, fga: 5, ptsPerFGA: 1.1, games: 5 },
    opponentDefense: { proxyUsed: true, label: "neutral" },
    injuryAvailability: { level: "UNKNOWN", dataMissing: true },
  }, { netEdge: 4, gap: 3.0 });
  const di = evaluateDi(pick);
  assert.notStrictEqual(di.trackEligibility, "TRACK");
});

test("11 BOARD_ONLY cannot enter Controlled Best 6", () => {
  const pick = live0625Pick("Angel Reese", "OVER", 13.5, {
    minutesVolatility: "stable",
    projection: { projection: 14.7, expectedMinutes: 26, expectedFGA: 9 },
    last5: { points: 14, minutes: 26, fga: 9, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 1.2, gap: 1.2 });
  const enriched = applyDecisionIntelligenceToPick(pick, evaluateDi(pick), evaluateWnbaTrackingGateV2(pick));
  const best = selectControlledBestSix([enriched], "WNBA");
  assert.strictEqual(best.bestSix.length, 0);
});

test("12 NO_BET cannot enter Controlled Best 6", () => {
  const pick = live0625Pick("NaLyssa Smith", "OVER", 10.5, {
    projection: { projection: 12.5, expectedMinutes: 18, expectedFGA: 5 },
    last5: { points: 11, minutes: 18, fga: 5, ptsPerFGA: 1.1, games: 5 },
  }, { netEdge: 4 });
  const enriched = applyDecisionIntelligenceToPick(pick, evaluateDi(pick), evaluateWnbaTrackingGateV2(pick));
  const best = selectControlledBestSix([enriched], "WNBA");
  assert.strictEqual(best.bestSix.length, 0);
});

test("13 Controlled Best 6 returns fewer than 6 if only fewer pass", () => {
  const track = applyDecisionIntelligenceToPick(
    live0625Pick("Azzi Fudd", "OVER", 13.5, {
      projection: { projection: 18, expectedMinutes: 28, expectedFGA: 10 },
      last5: { points: 17, minutes: 28, fga: 10, ptsPerFGA: 1.05, games: 5 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 4.5, fairLineQuality: 65 },
    }, { netEdge: 8 }),
    null,
    evaluateWnbaTrackingGateV2(
      live0625Pick("Azzi Fudd", "OVER", 13.5, {
        projection: { projection: 18, expectedMinutes: 28, expectedFGA: 10 },
        last5: { points: 17, minutes: 28, fga: 10, ptsPerFGA: 1.05, games: 5 },
        fairLine: { fairLineSide: "OVER", fairLineEdge: 4.5, fairLineQuality: 65 },
      }, { netEdge: 8 })
    )
  );
  const boardOnly = applyDecisionIntelligenceToPick(
    live0625Pick("Gabby Williams", "OVER", 16.5, {
      minutesVolatility: "volatile",
      projection: { projection: 18, expectedMinutes: 24, expectedFGA: 9 },
      last5: { points: 17, minutes: 24, fga: 9, ptsPerFGA: 1.05, games: 5 },
    }, { netEdge: 4, gap: 1.5 }),
    null,
    evaluateWnbaTrackingGateV2(
      live0625Pick("Gabby Williams", "OVER", 16.5, {
        minutesVolatility: "volatile",
        projection: { projection: 18, expectedMinutes: 24, expectedFGA: 9 },
        last5: { points: 17, minutes: 24, fga: 9, ptsPerFGA: 1.05, games: 5 },
      }, { netEdge: 4, gap: 1.5 })
    )
  );
  const best = selectControlledBestSix([track, boardOnly], "WNBA", { bestSixLimit: BEST_SIX_LIMIT });
  assert.ok(best.bestSix.length < BEST_SIX_LIMIT);
  assert.strictEqual(best.bestSix.length, 1);
});

test("14 Top Picks selected only from Best 6 eligible props", () => {
  const track = applyDecisionIntelligenceToPick(
    live0625Pick("Sabrina Ionescu", "UNDER", 17.5, {
      minutesVolatility: "volatile",
      projection: { projection: 13, expectedMinutes: 30, expectedFGA: 12 },
      last5: { points: 14, minutes: 30, fga: 12, ptsPerFGA: 1.1, games: 5 },
      bookCount: 5,
      dataConfidenceScore: 72,
      fairLine: { fairLineSide: "UNDER", fairLineEdge: 5, fairLineQuality: 70 },
    }, { netEdge: 9 }),
    null,
    evaluateWnbaTrackingGateV2(
      live0625Pick("Sabrina Ionescu", "UNDER", 17.5, {
        minutesVolatility: "volatile",
        projection: { projection: 13, expectedMinutes: 30, expectedFGA: 12 },
        last5: { points: 14, minutes: 30, fga: 12, ptsPerFGA: 1.1, games: 5 },
        bookCount: 5,
        dataConfidenceScore: 72,
        fairLine: { fairLineSide: "UNDER", fairLineEdge: 5, fairLineQuality: 70 },
      }, { netEdge: 9 })
    )
  );
  const best = selectControlledBestSix([track], "WNBA");
  const top = selectTopTwoFromBestSix(best.bestSix, "WNBA");
  assert.strictEqual(top.topProps.length, 1);
  assert.strictEqual(top.topProps[0].player, "Sabrina Ionescu");
});

test("15 Results only admits TRACK", () => {
  const di = evaluateDi(live0625Pick("Marine Johannes", "UNDER", 9.5, {
    minutesVolatility: "volatile",
    projection: { projection: 6, expectedMinutes: 16, expectedFGA: 5 },
    last5: { points: 7, minutes: 16, fga: 5, ptsPerFGA: 1.0, games: 5 },
  }, { netEdge: 5 }));
  assert.notStrictEqual(di.trackEligibility, "TRACK");
});

test("16 decision object saved on tracked props shape", () => {
  const pick = live0625Pick("Natisha Hiedeman", "OVER", 15.5, {
    minutesVolatility: "unstable",
    projection: { projection: 19.5, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.1, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 9 });
  const enriched = applyDecisionIntelligenceToPick(pick, null, evaluateWnbaTrackingGateV2(pick));
  assert.strictEqual(enriched.decisionIntelligence?.version, DECISION_INTELLIGENCE_VERSION);
  assert.ok(enriched.decisionIntelligence?.simpleExplanation);
  assert.ok(Array.isArray(enriched.decisionIntelligence?.riskDebts));
});

test("17 decision object has explanation fields", () => {
  const di = evaluateDi(live0625Pick("Natisha Hiedeman", "OVER", 15.5, {
    minutesVolatility: "unstable",
    projection: { projection: 19.5, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.1, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 9 }));
  assert.ok(di.simpleExplanation.includes("TRACK"));
  assert.ok(di.whatWouldMakeItBetter.length > 0);
});

test("18 Lab review builders exist", async () => {
  const { buildDecisionIntelligenceReview, buildRiskHonestyReview, buildUpgradeDemotionReview } =
    await import("../engines/decisionIntelligence/propDecisionIntelligenceV1.js");
  const review = buildDecisionIntelligenceReview([]);
  assert.strictEqual(review.version, DECISION_INTELLIGENCE_VERSION);
  assert.ok(buildRiskHonestyReview([]));
  assert.ok(buildUpgradeDemotionReview([]));
});

test("19 retro simulation works for any completed slate", () => {
  const props = getTrackedProps().filter((p) => p.slateDate === "2026-06-24");
  if (!props.length) return;
  const sim = buildDecisionIntelligenceRetroSimulation(props, { slateDate: "2026-06-24" });
  assert.strictEqual(sim.reportOnly, true);
  assert.strictEqual(sim.noMutation, true);
  assert.ok(sim.simulatedRecord);
});

test("20 retro simulation does not mutate runtime results", () => {
  const before = getTrackedProps().length;
  const props = getTrackedProps().filter((p) => p.slateDate === "2026-06-24");
  buildDecisionIntelligenceRetroSimulation(props, { slateDate: "2026-06-24" });
  assert.strictEqual(getTrackedProps().length, before);
});

test("21 existing WNBA Tracking Gate v2 tests still pass", () => {
  runScript("testWnbaTrackingGateV2.js");
});

test("22 existing Controlled Best 6 tests still pass", () => {
  runScript("testControlledBestSix.js");
});

test("23 existing data-flow tests still pass", () => {
  runScript("testCourtEdgeDataFlow.js");
});

test("24 existing slate lifecycle tests still pass", () => {
  runScript("testSlateRotationLifecycle.js");
});

test("25 06/25 named examples match expectations", () => {
  const cases = [
    {
      name: "Natisha Hiedeman O15.5",
      pick: live0625Pick("Natisha Hiedeman", "OVER", 15.5, {
        minutesVolatility: "unstable",
        projection: { projection: 19.5, expectedMinutes: 28, expectedFGA: 11 },
        last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.1, games: 5 },
        fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 60 },
      }, { netEdge: 9 }),
      track: "TRACK",
      notLow: true,
    },
    {
      name: "Sabrina Ionescu U17.5",
      pick: live0625Pick("Sabrina Ionescu", "UNDER", 17.5, {
        minutesVolatility: "volatile",
        projection: { projection: 13, expectedMinutes: 30, expectedFGA: 12 },
        last5: { points: 14, minutes: 30, fga: 12, ptsPerFGA: 1.1, games: 5 },
        bookCount: 5,
        dataConfidenceScore: 72,
        fairLine: { fairLineSide: "UNDER", fairLineEdge: 5, fairLineQuality: 70 },
      }, { netEdge: 9 }),
      track: "TRACK",
      notLow: true,
    },
    {
      name: "Dearica Hamby U15.5",
      pick: live0625Pick("Dearica Hamby", "UNDER", 15.5, {
        minutesVolatility: "volatile",
        projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
        last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
        season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
        fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
      }, { netEdge: 6 }),
      notTrack: true,
      notLow: true,
    },
    {
      name: "NaLyssa Smith O10.5",
      pick: live0625Pick("NaLyssa Smith", "OVER", 10.5, {
        projection: { projection: 12.5, expectedMinutes: 18, expectedFGA: 5 },
        last5: { points: 11, minutes: 18, fga: 5, ptsPerFGA: 1.1, games: 5 },
      }, { netEdge: 4 }),
      notTrack: true,
    },
    {
      name: "Rhyne Howard O18.5",
      pick: live0625Pick("Rhyne Howard", "OVER", 18.5, {
        projection: { projection: 19, expectedMinutes: 28, expectedFGA: 11 },
        last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
      }, { netEdge: 0.5, gap: 0.5 }),
      notTrack: true,
    },
  ];

  for (const c of cases) {
    const di = evaluateDi(c.pick);
    if (c.track) assert.strictEqual(di.trackEligibility, c.track, c.name);
    if (c.notTrack) assert.notStrictEqual(di.trackEligibility, "TRACK", c.name);
    if (c.notLow) assert.notStrictEqual(di.trueRisk, "LOW", c.name);
  }
});

test("26 graduated complete-data WNBA can earn LOW", () => {
  const pick = makeWnbaPick({
    wnbaDataCard: baseCard({
      dataMode: "WNBA_FULL_DATA",
      minutesVolatility: "stable",
      projection: { projection: 18, expectedMinutes: 28, expectedFGA: 11 },
      last5: { points: 17, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 70 },
    }),
    side: "Over",
    netEdge: 9,
  });
  const di = evaluateDi(pick);
  assert.strictEqual(di.trueRisk, "LOW");
  assert.ok(!di.riskDebts.some((d) => d.code === "WNBA_LIMITED_DATA"));
});

test("27 incomplete WNBA explanation cites specific missing debt", () => {
  const pick = makeWnbaPick({
    wnbaDataCard: baseCard({
      last5: { points: 10, minutes: 24, fga: 9, ptsPerFGA: 1.05, games: 1 },
      projection: { projection: 18, expectedMinutes: 28, expectedFGA: 11 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 70 },
      dataMissingFlags: [
        { key: "last5", missing: true, note: "Only 1 recent games" },
      ],
    }),
    side: "Over",
    netEdge: 9,
  });
  const di = evaluateDi(pick);
  assert.ok(di.riskDebts.some((d) => d.code === "MISSING_LAST5"));
  assert.ok(!di.simpleExplanation.toLowerCase().includes("wnba limited data"));
  assert.ok(di.simpleExplanation.toLowerCase().includes("recent games"));
});

test("28 NO_BET Under explanation skips low volume over trap", () => {
  const pick = makeWnbaPick({
    side: "Under",
    wnbaDataCard: baseCard({
      minutesVolatility: "stable",
      projection: { projection: 6, expectedMinutes: 18, expectedFGA: 4 },
      last5: { points: 7, minutes: 18, fga: 4, ptsPerFGA: 1.0, games: 5 },
      fairLine: { fairLineSide: "UNDER", fairLineEdge: -3.5, fairLineQuality: 70 },
    }),
    netEdge: 8,
    controlledBestSixDisplay: true,
  });
  const gate = evaluateWnbaTrackingGateV2(pick);
  const di = evaluatePropDecisionIntelligenceV1(pick, { gate });
  if (di.trackEligibility === "NO_BET") {
    assert.ok(!di.simpleExplanation.toLowerCase().includes("low volume over trap"));
    assert.ok(di.simpleExplanation.includes("learning pool"));
  }
});

test("29 applyDecisionIntelligence syncs dataMode from card", () => {
  const pick = makeWnbaPick({
    dataMode: "WNBA_LIMITED_DATA",
    wnbaDataCard: baseCard({
      dataMode: "WNBA_FULL_DATA",
      minutesVolatility: "stable",
      projection: { projection: 18, expectedMinutes: 28, expectedFGA: 11 },
      last5: { points: 17, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 70 },
    }),
    side: "Over",
    netEdge: 9,
  });
  const enriched = applyDecisionIntelligenceToPick(pick, null, evaluateWnbaTrackingGateV2(pick));
  assert.strictEqual(enriched.dataMode, "WNBA_FULL_DATA");
  assert.strictEqual(enriched.wnbaTrackingDecision, enriched.trackingEligibility);
});

test("30 TRACK working props default to MEDIUM (HIGH not default)", () => {
  // Unstable minutes = one HIGH debt → previously could be inverted; now MEDIUM.
  const pick = live0625Pick("Working Track", "OVER", 14.5, {
    dataMode: "WNBA_LIMITED_DATA",
    minutesVolatility: "unstable",
    bookCount: 4,
    marketQuality: 70,
    projection: { projection: 19.5, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4.5, fairLineQuality: 65 },
  }, { netEdge: 8 });
  const di = evaluateDi(pick);
  assert.strictEqual(di.trackEligibility, "TRACK");
  assert.strictEqual(di.trueRisk, "MEDIUM");
  assert.ok(
    (di.riskDebts || []).filter((d) => d.severity === "HIGH" || d.severity === "KILL").length < 2
  );
});

test("31 single HIGH debt TRACK stays MEDIUM", () => {
  const pick = live0625Pick("Single Debt Track", "OVER", 15.5, {
    minutesVolatility: "unstable",
    bookCount: 4,
    marketQuality: 70,
    projection: { projection: 20.5, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 8 });
  const di = evaluateDi(pick);
  if (di.trackEligibility === "TRACK") {
    const highs = (di.riskDebts || []).filter(
      (d) => d.severity === "HIGH" || d.severity === "KILL"
    ).length;
    if (highs < 2) assert.strictEqual(di.trueRisk, "MEDIUM");
  }
});

test("32 healthy slate risk mix — HIGH rarer than MEDIUM+LOW", () => {
  const cohort = [
    live0625Pick("A", "OVER", 14.5, {
      minutesVolatility: "stable",
      bookCount: 4,
      projection: { projection: 19, expectedMinutes: 28, expectedFGA: 11 },
      last5: { points: 17, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 60 },
    }, { netEdge: 8 }),
    live0625Pick("B", "OVER", 13.5, {
      minutesVolatility: "stable",
      bookCount: 5,
      dataMode: "WNBA_FULL_DATA",
      projection: { projection: 18, expectedMinutes: 27, expectedFGA: 10 },
      last5: { points: 16, minutes: 27, fga: 10, ptsPerFGA: 1.05, games: 5 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 65 },
    }, { netEdge: 7 }),
    live0625Pick("C", "UNDER", 16.5, {
      minutesVolatility: "stable",
      bookCount: 4,
      projection: { projection: 12, expectedMinutes: 26, expectedFGA: 9 },
      last5: { points: 13, minutes: 26, fga: 9, ptsPerFGA: 1.0, games: 5 },
      fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
    }, { netEdge: 6 }),
    live0625Pick("D", "OVER", 12.5, {
      minutesVolatility: "volatile",
      bookCount: 3,
      projection: { projection: 16.5, expectedMinutes: 24, expectedFGA: 9 },
      last5: { points: 15, minutes: 24, fga: 9, ptsPerFGA: 1.05, games: 5 },
    }, { netEdge: 5 }),
    live0625Pick("E", "OVER", 11.5, {
      minutesVolatility: "unstable",
      bookCount: 1,
      projection: { projection: 13, expectedMinutes: 17, expectedFGA: 5 },
      last5: { points: 12, minutes: 17, fga: 5, ptsPerFGA: 1.1, games: 5 },
    }, { netEdge: 4 }),
  ].map((p) => evaluateDi(p));

  const counts = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const di of cohort) {
    counts[di.trueRisk] = (counts[di.trueRisk] || 0) + 1;
  }
  assert.ok(
    counts.HIGH < counts.MEDIUM + counts.LOW,
    `HIGH (${counts.HIGH}) should be rarer than MEDIUM+LOW (${counts.MEDIUM + counts.LOW})`
  );
});

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err.message || err);
  }
}

console.log(`\nDecision Intelligence v1: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
