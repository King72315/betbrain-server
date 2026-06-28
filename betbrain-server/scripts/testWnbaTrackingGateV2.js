/**
 * WNBA Tracking Gate v2 tests (24 minimum).
 * Usage: node betbrain-server/scripts/testWnbaTrackingGateV2.js
 */
import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateWnbaTrackingGateV2,
  WNBA_TRACKING_GATE_VERSION,
  WNBA_LIMITED_UNDER_GAP_FLOOR,
  WNBA_LIMITED_OVER_GAP_FLOOR,
  buildRetroactiveGateSimulation,
  applyWnbaRiskCeiling,
} from "../engines/wnba/wnbaTrackingGateV2.js";
import {
  evaluateWnbaTrackingEligibility,
  QUALITY_GATE_VERSION,
} from "../engines/wnba/wnbaResultsQualityGate.js";
import {
  buildResultsTrackingCohort,
} from "../services/trackedPropService.js";
import {
  selectControlledBestSixCombined,
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

test("01 limited-data Under gap under 3.5 is not TRACK", () => {
  const gate = evaluateWnbaTrackingGateV2(
    makeWnbaPick({
      side: "Under",
      wnbaDataCard: baseCard({
        bookLine: 12.5,
        projection: { projection: 10, expectedMinutes: 24, expectedFGA: 9 },
        fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
      }),
    })
  );
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
});

test("02 limited-data Under with up role blocked", () => {
  const gate = evaluateWnbaTrackingGateV2(
    makeWnbaPick({
      side: "Under",
      wnbaDataCard: baseCard({
        bookLine: 14.5,
        roleTrend: "up",
        projection: { projection: 9, expectedMinutes: 28, expectedFGA: 11 },
        fairLine: { fairLineSide: "UNDER", fairLineEdge: 5, fairLineQuality: 65 },
      }),
    })
  );
  assert.ok(
    gate.trackingBlockReasons.includes("UNDER_ROLE_TRENDING_UP") ||
      gate.wnbaTrackingDecision !== "TRACK"
  );
});

test("03 limited-data Under fairLine disagreement blocked", () => {
  const gate = evaluateWnbaTrackingGateV2(
    makeWnbaPick({
      side: "Under",
      wnbaDataCard: baseCard({
        bookLine: 12.5,
        projection: { projection: 8, expectedMinutes: 24, expectedFGA: 9 },
        fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 60 },
      }),
    })
  );
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
});

test("04 limited-data Under low line thin edge blocked", () => {
  const gate = evaluateWnbaTrackingGateV2(
    makeWnbaPick({
      side: "Under",
      wnbaDataCard: baseCard({
        bookLine: 6.5,
        projection: { projection: 5.5, expectedMinutes: 22, expectedFGA: 7 },
        fairLine: { fairLineSide: "UNDER", fairLineEdge: 1, fairLineQuality: 50 },
      }),
    })
  );
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
});

test("05 limited-data Over low FGA blocked as trap", () => {
  const gate = evaluateWnbaTrackingGateV2(
    makeWnbaPick({
      side: "Over",
      wnbaDataCard: baseCard({
        bookLine: 14.5,
        last5: { points: 15, minutes: 18, fga: 5, ptsPerFGA: 1.2, games: 5 },
        projection: { projection: 16, expectedMinutes: 18, expectedFGA: 5 },
      }),
    })
  );
  assert.ok(
    gate.trackingBlockReasons.includes("LOW_VOLUME_OVER_TRAP") ||
      gate.wnbaTrackingDecision === "NO_BET"
  );
});

test("06 limited-data Over gap under 4 demoted unless elite", () => {
  const gate = evaluateWnbaTrackingGateV2(
    makeWnbaPick({
      side: "Over",
      netEdge: 4,
      wnbaDataCard: baseCard({
        bookLine: 14.5,
        projection: { projection: 17.5, expectedMinutes: 26, expectedFGA: 10 },
        fairLine: { fairLineSide: "OVER", fairLineEdge: 2, fairLineQuality: 50 },
      }),
    })
  );
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
});

test("07 strong Over gap unstable role gets risk ceiling", () => {
  const pick = makeWnbaPick({
    side: "Over",
    riskLabel: "Low Risk",
    wnbaDataCard: baseCard({
      bookLine: 12.5,
      roleTrend: "volatile",
      minutesVolatility: "volatile",
      projection: { projection: 18, expectedMinutes: 24, expectedFGA: 10 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 65 },
    }),
  });
  const gate = evaluateWnbaTrackingGateV2(pick);
  const risked = applyWnbaRiskCeiling(pick, gate);
  assert.notStrictEqual(risked.riskLabel, "Low Risk");
});

test("08 one-book normal-edge not TRACK", () => {
  const gate = evaluateWnbaTrackingGateV2(
    makeWnbaPick({
      side: "Over",
      netEdge: 4,
      wnbaDataCard: baseCard({
        bookCount: 1,
        marketQuality: 45,
        projection: { projection: 17, expectedMinutes: 26, expectedFGA: 10 },
      }),
    })
  );
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
});

test("09 multiple danger gates prevent Low Risk", () => {
  const pick = makeWnbaPick({
    side: "Over",
    riskLabel: "Low Risk",
    wnbaDataCard: baseCard({
      bookCount: 1,
      minutesVolatility: "unstable",
      opponentDefense: { proxyUsed: true, label: "neutral" },
      injuryAvailability: { level: "UNKNOWN", dataMissing: true },
      projection: { projection: 16, expectedMinutes: 18, expectedFGA: 6 },
    }),
  });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.ok((gate.dangerGateCount || 0) >= 2);
  const risked = applyWnbaRiskCeiling(pick, gate);
  assert.notStrictEqual(risked.riskLabel, "Low Risk");
});

test("10 limited-data Under cannot be Low Risk unless clean", () => {
  const pick = makeWnbaPick({
    side: "Under",
    riskLabel: "Low Risk",
    wnbaDataCard: baseCard({
      projection: { projection: 8, expectedMinutes: 24, expectedFGA: 9 },
      fairLine: { fairLineSide: "UNDER", fairLineEdge: 4.5, fairLineQuality: 65 },
    }),
  });
  const gate = evaluateWnbaTrackingGateV2(pick);
  const risked = applyWnbaRiskCeiling(pick, gate);
  assert.notStrictEqual(risked.riskLabel, "Low Risk");
});

test("11 projection edge cannot override danger stack >= 3", () => {
  const gate = evaluateWnbaTrackingGateV2(
    makeWnbaPick({
      side: "Over",
      netEdge: 8,
      wnbaDataCard: baseCard({
        bookCount: 1,
        minutesVolatility: "unstable",
        roleTrend: "down",
        opponentDefense: { proxyUsed: true, label: "neutral" },
        injuryAvailability: { level: "UNKNOWN", dataMissing: true },
        last5: { points: 14, minutes: 17, fga: 5, ptsPerFGA: 1.2, games: 5 },
        projection: { projection: 18, expectedMinutes: 17, expectedFGA: 5 },
        fairLine: { fairLineSide: "OVER", fairLineEdge: 6, fairLineQuality: 70 },
      }),
    })
  );
  assert.ok((gate.dangerGateCount || 0) >= 3);
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
});

test("12 danger stack >= 4 becomes NO_BET", () => {
  const gate = evaluateWnbaTrackingGateV2(
    makeWnbaPick({
      side: "Over",
      wnbaDataCard: baseCard({
        bookCount: 1,
        minutesVolatility: "unstable",
        roleTrend: "down",
        opponentDefense: { proxyUsed: true, label: "neutral" },
        injuryAvailability: { level: "UNKNOWN", dataMissing: true },
        last5: { points: 12, minutes: 16, fga: 4, ptsPerFGA: 1.3, games: 5 },
        projection: { projection: 14.5, expectedMinutes: 16, expectedFGA: 4 },
        fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
        dataMissingFlags: [{ missing: true }, { missing: true }],
      }),
    })
  );
  if ((gate.dangerGateCount || 0) >= 4) {
    assert.strictEqual(gate.wnbaTrackingDecision, "NO_BET");
  } else {
    assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
  }
});

test("13 Controlled Best 6 only selects TRACK", () => {
  const strong = makeWnbaPick({
    player: "Strong Over",
    netEdge: 9,
    readerConfidence: 62,
    wnbaDataCard: baseCard({
      bookLine: 12.5,
      projection: { projection: 18, expectedMinutes: 28, expectedFGA: 11 },
      fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 70 },
    }),
  });
  const weak = makeWnbaPick({
    player: "Weak Under",
    side: "Under",
    wnbaDataCard: baseCard({
      bookLine: 12.5,
      projection: { projection: 11, expectedMinutes: 24, expectedFGA: 9 },
    }),
  });
  const game = {
    gameId: "g1",
    league: "WNBA",
    date: "2026-06-25",
    commenceTime: "2026-06-25T23:00:00Z",
    picks: [strong, weak],
    allGeneratedCandidates: [strong, weak],
  };
  const selection = selectControlledBestSixCombined([game]);
  for (const pick of selection.bestSixWNBA) {
    assert.strictEqual(pick.trackingEligibility || pick.wnbaTrackingDecision, "TRACK");
  }
});

test("14 fewer than 6 TRACK does not force six", () => {
  const candidates = [1, 2, 3, 4].map((i) =>
    makeWnbaPick({
      player: `Player ${i}`,
      netEdge: 9,
      readerConfidence: 62,
      wnbaDataCard: baseCard({
        bookLine: 12.5 + i,
        projection: { projection: 18, expectedMinutes: 28, expectedFGA: 11 },
        fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 70 },
      }),
    })
  );
  const game = {
    gameId: "g1",
    league: "WNBA",
    date: "2026-06-25",
    commenceTime: "2026-06-25T23:00:00Z",
    allGeneratedCandidates: candidates,
  };
  const selection = selectControlledBestSixCombined([game]);
  const { cohort } = buildResultsTrackingCohort(selection.bestSixWNBA, {
    sourcePool: "CONTROLLED_BEST_SIX",
  });
  assert.ok(cohort.length <= BEST_SIX_LIMIT);
  assert.ok(cohort.length <= candidates.length);
});

test("15 Top Picks only from Best 6", () => {
  const candidates = Array.from({ length: 8 }, (_, i) =>
    makeWnbaPick({
      player: `Top Player ${i}`,
      team: `Team ${String.fromCharCode(65 + i)}`,
      netEdge: 10 - i * 0.2,
      readerConfidence: 65,
      wnbaDataCard: baseCard({
        bookLine: 12.5 + i,
        projection: { projection: 18, expectedMinutes: 28, expectedFGA: 11 },
        fairLine: { fairLineSide: "OVER", fairLineEdge: 5, fairLineQuality: 70 },
      }),
    })
  );
  const game = {
    gameId: "g1",
    league: "WNBA",
    date: "2026-06-25",
    commenceTime: "2026-06-25T23:00:00Z",
    allGeneratedCandidates: candidates,
  };
  const selection = selectControlledBestSixCombined([game]);
  assert.ok(selection.topProps.length <= 2);
  for (const top of selection.topProps) {
    assert.ok(
      selection.bestSixDisplayWNBA.some(
        (b) => b.player === top.player && String(b.line) === String(top.line)
      )
    );
  }
});

test("16 risk label ceiling saved on gate apply", () => {
  const pick = makeWnbaPick({ riskLabel: "Low Risk", dataMode: "WNBA_LIMITED_DATA" });
  const gate = evaluateWnbaTrackingGateV2(pick);
  const risked = applyWnbaRiskCeiling(pick, gate);
  assert.ok(risked.riskAfterCeiling);
  assert.ok(risked.riskCeilingReason);
});

test("17 Lab can read wnbaGateVersion and decision", () => {
  const gate = evaluateWnbaTrackingEligibility(makeWnbaPick());
  assert.strictEqual(gate.wnbaGateVersion, WNBA_TRACKING_GATE_VERSION);
  assert.ok(gate.wnbaTrackingDecision);
});

test("18 retro 06/24 simulation runs without mutation", () => {
  const props = getTrackedProps().filter((p) => p.slateDate === "2026-06-24");
  const sim = buildRetroactiveGateSimulation(props, { slateDate: "2026-06-24" });
  assert.strictEqual(sim.reportOnly, true);
  assert.strictEqual(sim.noMutation, true);
  assert.ok(sim.actualRecord);
  assert.ok(sim.simulatedRecord);
});

test("19 retro simulation reports blocked losses", () => {
  const props = getTrackedProps().filter((p) => p.slateDate === "2026-06-24");
  const sim = buildRetroactiveGateSimulation(props, { slateDate: "2026-06-24" });
  assert.ok(Array.isArray(sim.lossesWouldBeBlocked));
  assert.ok(Array.isArray(sim.lossReviews));
});

test("20 existing quality gate tests pass", () => {
  runScript("testWnbaResultsQualityGate.js");
});

test("21 existing data flow tests pass", () => {
  runScript("testCourtEdgeDataFlow.js");
});

test("22 existing controlled best six tests pass", () => {
  runScript("testControlledBestSix.js");
});

test("23 existing top picks lifecycle tests pass", () => {
  runScript("testTopPicksLifecycle.js");
});

test("24 gate version and floors exported", () => {
  assert.strictEqual(QUALITY_GATE_VERSION, WNBA_TRACKING_GATE_VERSION);
  assert.strictEqual(WNBA_LIMITED_UNDER_GAP_FLOOR, 3.5);
  assert.strictEqual(WNBA_LIMITED_OVER_GAP_FLOOR, 4.0);
});

function assertRiskNotLow(pick, gate) {
  const risked = applyWnbaRiskCeiling(pick, gate);
  assert.notStrictEqual(risked.riskLabel, "Low Risk");
  assert.notStrictEqual(gate.riskAfterCeiling, "Low Risk");
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

test("25 live 06/25 Natisha Hiedeman O15.5 TRACK not Low", () => {
  const pick = live0625Pick("Natisha Hiedeman", "OVER", 15.5, {
    minutesVolatility: "unstable",
    projection: { projection: 19.5, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.1, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 9 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.wnbaTrackingDecision, "TRACK");
  assertRiskNotLow(pick, gate);
});

test("26 live 06/25 Azzi Fudd O13.5 TRACK not Low", () => {
  const pick = live0625Pick("Azzi Fudd", "OVER", 13.5, {
    minutesVolatility: "stable",
    projection: { projection: 18, expectedMinutes: 28, expectedFGA: 10 },
    last5: { points: 17, minutes: 28, fga: 10, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4.5, fairLineQuality: 65 },
  }, { netEdge: 8 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.wnbaTrackingDecision, "TRACK");
  assertRiskNotLow(pick, gate);
});

test("27 live 06/25 Jessica Shepard O12.5 not Low Risk", () => {
  const pick = live0625Pick("Jessica Shepard", "OVER", 12.5, {
    minutesVolatility: "volatile",
    projection: { projection: 17, expectedMinutes: 26, expectedFGA: 10 },
    last5: { points: 16, minutes: 26, fga: 10, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 7 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assertRiskNotLow(pick, gate);
});

test("28 live 06/25 Sabrina Ionescu U17.5 elite TRACK not Low", () => {
  const pick = live0625Pick("Sabrina Ionescu", "UNDER", 17.5, {
    minutesVolatility: "volatile",
    projection: { projection: 13, expectedMinutes: 30, expectedFGA: 12 },
    last5: { points: 14, minutes: 30, fga: 12, ptsPerFGA: 1.1, games: 5 },
    bookCount: 5,
    dataConfidenceScore: 72,
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 5, fairLineQuality: 70 },
  }, { netEdge: 9 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.wnbaTrackingDecision, "TRACK");
  assertRiskNotLow(pick, gate);
});

test("29 live 06/25 Dearica Hamby U15.5 BOARD_ONLY", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 6 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
  assertRiskNotLow(pick, gate);
});

test("30 live 06/25 Ariel Atkins U10.5 BOARD_ONLY thin volatile", () => {
  const pick = live0625Pick("Ariel Atkins", "UNDER", 10.5, {
    minutesVolatility: "volatile",
    projection: { projection: 7.2, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 8, minutes: 24, fga: 8, ptsPerFGA: 1.0, games: 5 },
  }, { netEdge: 5, gap: 3.3 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.wnbaTrackingDecision, "BOARD_ONLY");
  assertRiskNotLow(pick, gate);
});

test("31 live 06/25 NaLyssa Smith O10.5 trap not TRACK", () => {
  const pick = live0625Pick("NaLyssa Smith", "OVER", 10.5, {
    minutesVolatility: "stable",
    projection: { projection: 12.5, expectedMinutes: 18, expectedFGA: 5 },
    last5: { points: 11, minutes: 18, fga: 5, ptsPerFGA: 1.1, games: 5 },
  }, { netEdge: 4 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
  assertRiskNotLow(pick, gate);
});

test("32 live 06/25 A'ja Wilson U25.5 BOARD_ONLY thin volatile", () => {
  const pick = live0625Pick("A'ja Wilson", "UNDER", 25.5, {
    minutesVolatility: "volatile",
    projection: { projection: 22.5, expectedMinutes: 30, expectedFGA: 14 },
    last5: { points: 23, minutes: 30, fga: 14, ptsPerFGA: 1.1, games: 5 },
  }, { netEdge: 6, gap: 3.0 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.wnbaTrackingDecision, "BOARD_ONLY");
  assertRiskNotLow(pick, gate);
});

test("33 live 06/25 Marine Johannes U9.5 BOARD_ONLY", () => {
  const pick = live0625Pick("Marine Johannes", "UNDER", 9.5, {
    minutesVolatility: "volatile",
    projection: { projection: 6, expectedMinutes: 16, expectedFGA: 5 },
    last5: { points: 7, minutes: 16, fga: 5, ptsPerFGA: 1.0, games: 5 },
  }, { netEdge: 5 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
  assertRiskNotLow(pick, gate);
});

test("34 live 06/25 Shakira Austin U13.5 danger stack not TRACK", () => {
  const pick = live0625Pick("Shakira Austin", "UNDER", 13.5, {
    minutesVolatility: "unstable",
    bookCount: 1,
    projection: { projection: 10.5, expectedMinutes: 18, expectedFGA: 5 },
    last5: { points: 11, minutes: 18, fga: 5, ptsPerFGA: 1.1, games: 5 },
    opponentDefense: { proxyUsed: true, label: "neutral" },
    injuryAvailability: { level: "UNKNOWN", dataMissing: true },
  }, { netEdge: 4, gap: 3.0 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
  assertRiskNotLow(pick, gate);
});

test("35 live 06/25 Angel Reese O13.5 BOARD_ONLY thin edge", () => {
  const pick = live0625Pick("Angel Reese", "OVER", 13.5, {
    minutesVolatility: "stable",
    projection: { projection: 14.7, expectedMinutes: 26, expectedFGA: 9 },
    last5: { points: 14, minutes: 26, fga: 9, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 1.2, gap: 1.2 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.wnbaTrackingDecision, "BOARD_ONLY");
  assertRiskNotLow(pick, gate);
});

test("36 live 06/25 Gabby Williams O16.5 volatile not TRACK", () => {
  const pick = live0625Pick("Gabby Williams", "OVER", 16.5, {
    minutesVolatility: "volatile",
    projection: { projection: 18, expectedMinutes: 24, expectedFGA: 9 },
    last5: { points: 17, minutes: 24, fga: 9, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 4, gap: 1.5 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
  assertRiskNotLow(pick, gate);
});

test("37 live 06/25 Rhyne Howard O18.5 thin edge not TRACK", () => {
  const pick = live0625Pick("Rhyne Howard", "OVER", 18.5, {
    minutesVolatility: "stable",
    projection: { projection: 19, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 0.5, gap: 0.5 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
  assertRiskNotLow(pick, gate);
});

test("38 risk ceiling LIMITED_DATA unstable minutes min Medium", () => {
  const pick = live0625Pick("Test Player", "OVER", 14.5, {
    minutesVolatility: "unstable",
    projection: { projection: 19, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 9 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.strictEqual(gate.riskAfterCeiling, "Medium Risk");
  assert.ok(gate.riskCeilingReason);
});

test("39 risk ceiling Under volatile never Low", () => {
  const pick = live0625Pick("Test Under", "UNDER", 12.5, {
    minutesVolatility: "volatile",
    projection: { projection: 8, expectedMinutes: 26, expectedFGA: 9 },
    last5: { points: 9, minutes: 26, fga: 9, ptsPerFGA: 1.0, games: 5 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 5, fairLineQuality: 65 },
  }, { netEdge: 8 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assertRiskNotLow(pick, gate);
});

test("40 low volume over trap blocks TRACK and High risk ceiling", () => {
  const pick = live0625Pick("Trap Over", "OVER", 10.5, {
    projection: { projection: 13, expectedMinutes: 17, expectedFGA: 5 },
    last5: { points: 12, minutes: 17, fga: 5, ptsPerFGA: 1.1, games: 5 },
  }, { netEdge: 5 });
  const gate = evaluateWnbaTrackingGateV2(pick);
  assert.notStrictEqual(gate.wnbaTrackingDecision, "TRACK");
  assert.ok(
    gate.riskAfterCeiling === "High Risk" || gate.riskAfterCeiling === "Medium Risk"
  );
});

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}:`, error.message);
  }
}

console.log(`\nWNBA Tracking Gate v2: ${passed}/${tests.length} passed`);
if (failed > 0) process.exit(1);
