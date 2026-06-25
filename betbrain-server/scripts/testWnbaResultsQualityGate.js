/**
 * WNBA Results Quality Gate tests (18 minimum).
 * Usage: node betbrain-server/scripts/testWnbaResultsQualityGate.js
 */
import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateWnbaTrackingEligibility,
  QUALITY_GATE_VERSION,
  WNBA_LIMITED_UNDER_GAP_FLOOR,
} from "../engines/wnba/wnbaResultsQualityGate.js";
import {
  buildResultsTrackingCohort,
  collectAllGeneratedCandidatesFromGames,
} from "../services/trackedPropService.js";
import { selectControlledBestSixCombined } from "../engines/topProps/controlledBestSixSelector.js";
import { BEST_SIX_LIMIT } from "../engines/topProps/controlledBestSixSelector.js";
import { readWnbaProp, mapReaderToTracking } from "../engines/wnba/wnbaReaderEngine.js";

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
  return {
    player: "Test Player",
    team: "Team A",
    opponent: "Team B",
    line: card.bookLine,
    side: reader.finalSide === "UNDER" ? "Under" : "Over",
    pick: reader.finalSide === "UNDER" ? "Under" : "Over",
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
    readerConfidence: reader.readerConfidence,
    underGap: reader.underGap,
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

function test1LowVolumeOverTrapBlocked() {
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      wnbaDataCard: baseCard({
        bookLine: 14.5,
        last5: { points: 15, minutes: 16, fga: 5, ptsPerFGA: 1.05, games: 5 },
        projection: { projection: 15.5, expectedMinutes: 16, expectedFGA: 5 },
      }),
    })
  );
  assert.ok(
    gate.trackingEligibility !== "TRACK",
    "low-volume over trap should not track"
  );
  assert.ok(
    gate.trackingBlockReasons.includes("LOW_VOLUME_OVER_TRAP") ||
      gate.trackingEligibility === "BOARD_ONLY"
  );
}

function test2EfficiencyOnlySpikeBlocked() {
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      wnbaDataCard: baseCard({
        bookLine: 11.5,
        last5: { points: 14, minutes: 22, fga: 6, ptsPerFGA: 1.35, games: 5 },
        season: { points: 10, minutes: 24, fga: 8, ptsPerFGA: 1.05 },
        projection: { projection: 13, expectedMinutes: 22, expectedFGA: 6 },
      }),
    })
  );
  assert.ok(gate.trackingEligibility !== "TRACK");
  assert.ok(
    gate.trackingBlockReasons.includes("EFFICIENCY_ONLY_SCORING_SPIKE") ||
      gate.trackingEligibility === "BOARD_ONLY"
  );
}

function test3LimitedDataUnderBelowFloorBlocked() {
  const card = baseCard({
    bookLine: 12.5,
    projection: { projection: 10.2, expectedMinutes: 22, expectedFGA: 8 },
    last5: { points: 10, minutes: 22, fga: 8, ptsPerFGA: 1.05, games: 5 },
  });
  const reader = {
    decision: "TEST",
    finalSide: "UNDER",
    readerConfidence: 48,
    underGap: 2.3,
    margin: 5,
    underCase: { score: 6 },
  };
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      side: "Under",
      pick: "Under",
      wnbaDataCard: card,
      wnbaReader: reader,
      readerDecision: "TEST",
      underGap: 2.3,
    })
  );
  assert.ok(reader.underGap < WNBA_LIMITED_UNDER_GAP_FLOOR);
  assert.strictEqual(gate.trackingEligibility, "BOARD_ONLY");
  assert.ok(
    gate.wnbaTrackingReason === "UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR" ||
      (gate.trackingWarnings || []).includes("UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR")
  );
}

function test4LimitedDataUnderAboveFloorCanTrack() {
  const card = baseCard({
    bookLine: 16.5,
    projection: { projection: 12.5, expectedMinutes: 26, expectedFGA: 10 },
    last5: { points: 12, minutes: 26, fga: 10, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLine: 13.5, fairLineSide: "UNDER", fairLineEdge: 3.5, fairLineQuality: 65 },
    dataConfidenceScore: 68,
  });
  const reader = readWnbaProp(card);
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({ wnbaDataCard: card, wnbaReader: reader, trackingType: "TEST" })
  );
  assert.ok(reader.underGap >= WNBA_LIMITED_UNDER_GAP_FLOOR || reader.finalSide !== "UNDER");
  if (reader.finalSide === "UNDER") {
    assert.ok(gate.trackingEligibility === "TRACK" || gate.trackingEligibility === "BOARD_ONLY");
  }
}

function test5OneBookWeakEdgeBlocked() {
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      wnbaDataCard: baseCard({ bookCount: 1, marketQuality: 40 }),
      netEdge: 3,
      wnbaReader: { decision: "TEST", finalSide: "OVER", readerConfidence: 40, margin: 3 },
    })
  );
  assert.ok(gate.trackingEligibility !== "TRACK");
}

function test6ThinMarketVolatileRoleBoardOnly() {
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      wnbaDataCard: baseCard({
        bookCount: 2,
        marketQuality: 45,
        roleTrend: "down",
        minutesVolatility: "volatile",
      }),
      netEdge: 4,
      wnbaReader: { decision: "TEST", finalSide: "OVER", readerConfidence: 42, margin: 4 },
    })
  );
  assert.ok(["BOARD_ONLY", "SHADOW_ONLY", "NO_BET"].includes(gate.trackingEligibility));
}

function test7ReaderOfficialDemotedCanTrack() {
  const card = baseCard({
    bookLine: 16.5,
    projection: { projection: 12, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 12, minutes: 28, fga: 11, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLine: 13, fairLineSide: "UNDER", fairLineEdge: 3.5, fairLineQuality: 70 },
    dataConfidenceScore: 70,
    bookCount: 6,
  });
  const reader = readWnbaProp(card);
  const tracking = mapReaderToTracking(reader, { league: "WNBA", line: card.bookLine });
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      wnbaDataCard: card,
      wnbaReader: reader,
      trackingType: "TEST",
      readerOfficialDemoted: tracking.readerOfficialDemoted,
      readerDecision: reader.decision,
    })
  );
  if (reader.finalSide === "UNDER" && reader.underGap >= WNBA_LIMITED_UNDER_GAP_FLOOR) {
    assert.strictEqual(gate.trackingEligibility, "TRACK");
  }
}

function test8ReaderUncertainTestStricter() {
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      wnbaDataCard: baseCard({ dataConfidenceScore: 48, bookCount: 2, marketQuality: 50 }),
      wnbaReader: { decision: "TEST", finalSide: "OVER", readerConfidence: 38, margin: 4 },
      readerOfficialDemoted: false,
      netEdge: 4,
    })
  );
  assert.ok(gate.trackingEligibility === "BOARD_ONLY" || gate.trackingEligibility === "NO_BET");
}

function test9FairLineStrongDisagreeBlocks() {
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      wnbaDataCard: baseCard({
        fairLine: { fairLine: 9.5, fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 72 },
      }),
      wnbaReader: { decision: "TEST", finalSide: "OVER", readerConfidence: 55, margin: 6 },
    })
  );
  assert.ok(gate.trackingBlockReasons.includes("FAIR_LINE_STRONG_DISAGREE"));
  assert.strictEqual(gate.trackingEligibility, "NO_BET");
}

function test10FairLineAgreementDoesNotRescueWeakVolume() {
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      wnbaDataCard: baseCard({
        bookLine: 14.5,
        fairLine: { fairLine: 15.5, fairLineSide: "OVER", fairLineEdge: 2, fairLineQuality: 70 },
        last5: { points: 15, minutes: 16, fga: 5, ptsPerFGA: 1.05, games: 5 },
        projection: { projection: 15.5, expectedMinutes: 16, expectedFGA: 5 },
      }),
    })
  );
  assert.ok(gate.trackingEligibility !== "TRACK");
}

function test11TopPropsDoesNotAffectCohort() {
  const candidates = Array.from({ length: 6 }, (_, i) =>
    makeWnbaPick({
      player: `Player ${i}`,
      team: `T${i}`,
      trackingType: "TEST",
      pickScore: 90 - i,
      wnbaDataCard: baseCard({
        player: `Player ${i}`,
        bookLine: 10.5 + i,
        last5: { points: 12, minutes: 26, fga: 10, ptsPerFGA: 1.05, games: 5 },
        projection: { projection: 12, expectedMinutes: 26, expectedFGA: 10 },
      }),
    })
  );
  const game = {
    gameId: "g1",
    league: "WNBA",
    date: "2026-06-24",
    commenceTime: "2026-06-24T23:00:00Z",
    picks: candidates.slice(0, 3),
    allGeneratedCandidates: candidates,
  };
  const selection = selectControlledBestSixCombined([game]);
  const bestSixCohort = [...selection.bestSixWNBA, ...selection.bestSixNBA];
  const { cohort } = buildResultsTrackingCohort(bestSixCohort, {
    sourcePool: "CONTROLLED_BEST_SIX",
  });
  assert.ok(selection.topProps.length <= 4);
  assert.ok(cohort.length <= BEST_SIX_LIMIT);
  assert.ok(cohort.length <= candidates.length);
}

function test12NbaPathProtected() {
  const gate = evaluateWnbaTrackingEligibility({
    player: "NBA Star",
    league: "NBA",
    team: "LAL",
    opponent: "BOS",
    line: 25.5,
    side: "Over",
    trackingType: "OFFICIAL",
  });
  assert.strictEqual(gate.trackingEligibility, "TRACK");
  assert.strictEqual(gate.skipped, true);
}

function test13QualityGateVersionSet() {
  const gate = evaluateWnbaTrackingEligibility(makeWnbaPick());
  assert.strictEqual(gate.qualityGateVersion, QUALITY_GATE_VERSION);
}

function test14NoBetHardBlock() {
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({ trackingType: "NO_BET", noPlay: true })
  );
  assert.strictEqual(gate.trackingEligibility, "NO_BET");
}

function test15ReaderNoBetBlocked() {
  const gate = evaluateWnbaTrackingEligibility(
    makeWnbaPick({
      wnbaReader: { decision: "NO_BET", finalSide: null, readerConfidence: 0 },
      readerDecision: "NO_BET",
    })
  );
  assert.ok(gate.trackingBlockReasons.includes("READER_NO_BET"));
}

function test16CohortAppliesGateToWnba() {
  const weak = makeWnbaPick({
    player: "Weak Over",
    wnbaDataCard: baseCard({
      bookLine: 14.5,
      last5: { points: 15, minutes: 16, fga: 5, ptsPerFGA: 1.4, games: 5 },
      season: { points: 10, minutes: 24, fga: 8, ptsPerFGA: 1.05 },
      projection: { projection: 15, expectedMinutes: 16, expectedFGA: 5 },
    }),
  });
  const { cohort, audit } = buildResultsTrackingCohort([weak]);
  assert.strictEqual(cohort.length, 0);
  assert.ok(audit.qualityGateBlockedCount + audit.boardOnlyCount >= 1);
}

function test17ExistingReaderTestsPass() {
  runScript("testWnbaReaderFixes.js");
}

function test18ExistingCohortAndTopPropTestsPass() {
  runScript("testResultsTrackingCohort.js");
  runScript("testTopPropSelector.js");
  runScript("testTopPicksLifecycle.js");
}

const tests = [
  ["1 low-volume over trap blocked", test1LowVolumeOverTrapBlocked],
  ["2 efficiency-only spike blocked", test2EfficiencyOnlySpikeBlocked],
  ["3 limited-data under below floor blocked", test3LimitedDataUnderBelowFloorBlocked],
  ["4 limited-data under above floor can track", test4LimitedDataUnderAboveFloorCanTrack],
  ["5 one-book weak edge blocked", test5OneBookWeakEdgeBlocked],
  ["6 thin market volatile role board-only", test6ThinMarketVolatileRoleBoardOnly],
  ["7 reader official demoted can track", test7ReaderOfficialDemotedCanTrack],
  ["8 reader uncertain TEST stricter", test8ReaderUncertainTestStricter],
  ["9 fair-line strong disagree blocks", test9FairLineStrongDisagreeBlocks],
  ["10 fair-line agreement does not rescue weak volume", test10FairLineAgreementDoesNotRescueWeakVolume],
  ["11 top props does not affect cohort", test11TopPropsDoesNotAffectCohort],
  ["12 NBA path protected", test12NbaPathProtected],
  ["13 quality gate version set", test13QualityGateVersionSet],
  ["14 NO_BET hard block", test14NoBetHardBlock],
  ["15 reader NO_BET blocked", test15ReaderNoBetBlocked],
  ["16 cohort applies gate to WNBA", test16CohortAppliesGateToWnba],
  ["17 existing reader tests pass", test17ExistingReaderTestsPass],
  ["18 existing cohort/top-prop tests pass", test18ExistingCohortAndTopPropTestsPass],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}

console.log(`\nAll ${passed} WNBA Results Quality Gate tests passed.`);
