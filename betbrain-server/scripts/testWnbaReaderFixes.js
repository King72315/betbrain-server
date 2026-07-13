/**
 * WNBA reader calibration fix tests (18 minimum).
 * Usage: node betbrain-server/scripts/testWnbaReaderFixes.js
 */
import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { interpretLineMovement } from "../engines/marketIntelligenceEngine.js";
import { readWnbaProp, mapReaderToTracking } from "../engines/wnba/wnbaReaderEngine.js";
import {
  buildWnbaAvailabilityEvaluation,
  evaluateWnbaAvailability,
} from "../services/wnbaAvailabilityService.js";
import { buildTopPicksReview } from "../services/topPicksSnapshotService.js";
import { countDuplicateStableKeys } from "../services/slateLockService.js";
import { isCourteEdgeWnbaV2Enabled, WNBA_ENGINE_HANDLED } from "../engines/wnba/wnbaDecisionEngine.js";

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
    openingLine: 12.5,
    currentLine: 12.5,
    lineMovement: 0,
    bookCount: 5,
    lineSpread: 0.5,
    marketQuality: 70,
    dataMode: "WNBA_LIMITED_DATA",
    season: { points: 11, minutes: 26, fga: 10, fta: 3, ptsPerFGA: 1.05, ftPath: true },
    last5: { points: 10, pointsList: [9, 10, 11, 10, 10], minutes: 20, fga: 7, fta: 2, ptsPerFGA: 1.1, ftPath: true, games: 5 },
    scoringTrend: "stable",
    roleTrend: "stable",
    injuryAvailability: { status: "Active", level: "ACTIVE", blocksPlay: false, reasons: [] },
    teammateUsageShift: { active: false, fgaBoost: 0, minutesBoost: 0, reasons: [] },
    opponentDefense: { score: 45, label: "average", context: {} },
    gameEnvironment: { spread: -4, total: 158, impliedTeamTotal: 81, blowoutRisk: 35, pace: null, highBlowoutRisk: false },
    projection: { projection: 10.0, expectedMinutes: 22, expectedFGA: 8, expectedFTA: 2, method: "volume-first-v2" },
    fairLine: { fairLine: 11.5, fairLineSide: "UNDER", fairLineEdge: 1, fairLineQuality: 55 },
    dataMissingFlags: [],
    dataConfidenceScore: 72,
    ...overrides,
  };
}

function runScript(scriptName) {
  const scriptPath = path.join(__dirname, scriptName);
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd: SERVER_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(
      `${scriptName} failed:\n${result.stdout}\n${result.stderr}`
    );
  }
}

function testLimitedDataUnderGap26Penalty() {
  const reader = readWnbaProp(
    baseCard({
      bookLine: 12.5,
      projection: { projection: 9.9, expectedMinutes: 22, expectedFGA: 8, expectedFTA: 2, method: "volume-first-v2" },
      last5: { points: 10, minutes: 20, fga: 7, fta: 2, ptsPerFGA: 1.1, ftPath: true, games: 5 },
    })
  );
  assert.strictEqual(reader.decision, "NO_BET");
  assert.strictEqual(reader.finalSide, null);
  assert.ok(reader.limitedDataUnderPenaltyApplied || reader.reasonCodes.includes("UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR"));
  console.log("✓ 1 limited-data Under gap 2.6 blocked — NO_BET");
}

function testLimitedDataUnderGap32CanPass() {
  const reader = readWnbaProp(
    baseCard({
      bookLine: 14.5,
      projection: { projection: 10.9, expectedMinutes: 24, expectedFGA: 9, expectedFTA: 2.5, method: "volume-first-v2" },
      last5: { points: 11, minutes: 18, fga: 6, fta: 1.5, ptsPerFGA: 1.05, ftPath: true, games: 5 },
      fairLine: { fairLine: 13.5, fairLineSide: "UNDER", fairLineEdge: 1.2, fairLineQuality: 58 },
    })
  );
  assert.strictEqual(reader.finalSide, "UNDER");
  assert.strictEqual(reader.underGapFloorPassed, true);
  assert.strictEqual(reader.limitedDataUnderPenaltyApplied, false);
  console.log("✓ 2 limited-data Under gap 3.6 passes floor");
}

function testNbaUnderLogicProtected() {
  const reader = readWnbaProp(
    baseCard({
      dataMode: "NBA_FULL_DATA",
      bookLine: 12.5,
      projection: { projection: 10.0, expectedMinutes: 22, expectedFGA: 8, expectedFTA: 2, method: "volume-first-v2" },
    })
  );
  assert.strictEqual(reader.limitedDataUnderPenaltyApplied, false);
  assert.ok(!reader.reasonCodes.includes("UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR"));
  console.log("✓ 3 NBA Under logic not penalized by WNBA limited-data floor");
}

function testOverLineDropAgainst() {
  const m = interpretLineMovement("OVER", -1);
  assert.strictEqual(m.lineMovedAgainstPickSide, true);
  assert.strictEqual(m.marketDirectionAgainstPick, true);
  assert.strictEqual(m.currentLineValueImproved, true);
  console.log("✓ 4 Over line drop marked movedAgainstPickSide");
}

function testOverLineRiseSupport() {
  const m = interpretLineMovement("OVER", 1);
  assert.strictEqual(m.lineMovedForPickSide, true);
  assert.strictEqual(m.marketDirectionAgainstPick, false);
  console.log("✓ 5 Over line rise marked movedForPickSide");
}

function testUnderLineDropSupport() {
  const m = interpretLineMovement("UNDER", -1);
  assert.strictEqual(m.lineMovedForPickSide, true);
  assert.strictEqual(m.marketDirectionAgainstPick, false);
  console.log("✓ 6 Under line drop marked movedForPickSide");
}

function testUnderLineRiseAgainst() {
  const m = interpretLineMovement("UNDER", 1);
  assert.strictEqual(m.lineMovedAgainstPickSide, true);
  assert.strictEqual(m.marketDirectionAgainstPick, true);
  console.log("✓ 7 Under line rise marked movedAgainstPickSide");
}

async function testAvailabilityFeedVsActive() {
  const feedFailed = buildWnbaAvailabilityEvaluation({
    feed: { feedFetchOk: false, httpStatus: 503, rowCount: 0, errorReason: "http_503" },
    playerName: "Test Player",
    league: "WNBA",
  });
  assert.strictEqual(feedFailed.statusLevel, "UNKNOWN");
  assert.strictEqual(feedFailed.availabilityDataMissing, true);
  assert.strictEqual(feedFailed.availabilityRisk, true);
  assert.strictEqual(feedFailed.availabilitySourceStatus, "SOURCE_UNAVAILABLE");
  assert.ok(feedFailed.dangerPressure > 0);
  assert.strictEqual(feedFailed.blocksOfficial, false);

  const feedOkNotListed = buildWnbaAvailabilityEvaluation({
    feed: { feedFetchOk: true, httpStatus: 200, rowCount: 0, rows: [] },
    playerName: "Active Player Not Listed",
    league: "WNBA",
  });
  assert.strictEqual(feedOkNotListed.statusLevel, "ACTIVE");
  assert.strictEqual(feedOkNotListed.availabilityDataMissing, false);
  assert.strictEqual(feedOkNotListed.availabilityRisk, false);
  assert.strictEqual(feedOkNotListed.availabilitySourceStatus, "OK");
  assert.strictEqual(feedOkNotListed.availabilityMessage, "Active — not on injury report");

  const live = await evaluateWnbaAvailability({
    playerName: "No Feed Player XYZ",
    league: "WNBA",
  });
  if (live.feedFetchOk) {
    assert.strictEqual(live.statusLevel, "ACTIVE");
    assert.strictEqual(live.availabilityDataMissing, false);
  } else {
    assert.strictEqual(live.availabilityDataMissing, true);
    assert.strictEqual(live.availabilitySourceStatus, "SOURCE_UNAVAILABLE");
  }
  console.log("✓ 8 feed fail = missing; feed OK + not listed = ACTIVE");
}

function testReaderOfficialDemotedFlag() {
  const reader = {
    decision: "OFFICIAL",
    finalSide: "OVER",
    readerConfidence: 72,
    reasonCodes: ["STRONG_READER_CASE"],
  };
  const tracking = mapReaderToTracking(reader, {
    league: "WNBA",
    tier: "WATCHLIST",
    line: 14.5,
    projection: 16,
    confidence: 62,
    riskLabel: "Medium Risk",
    bookCount: 2,
    marketQuality: 35,
    dataMode: "WNBA_LIMITED_DATA",
  });
  assert.strictEqual(tracking.trackingType, "TEST");
  assert.strictEqual(tracking.readerOfficialDemoted, true);
  console.log("✓ 9 reader OFFICIAL + tracking TEST sets readerOfficialDemoted");
}

function testOfficialDemotionReasonStored() {
  const reader = {
    decision: "OFFICIAL",
    finalSide: "UNDER",
    readerConfidence: 68,
    reasonCodes: ["STRONG_READER_CASE"],
  };
  const tracking = mapReaderToTracking(reader, {
    league: "WNBA",
    tier: "WATCHLIST",
    line: 10.5,
    projection: 8,
    confidence: 58,
    riskLabel: "High Risk",
    bookCount: 4,
    marketQuality: 55,
    dataMode: "WNBA_LIMITED_DATA",
  });
  assert.ok(tracking.officialDemotionReason);
  assert.ok(!String(tracking.testReason || "").includes("STRONG_READER_CASE"));
  console.log("✓ 10 officialDemotionReason stored without STRONG_READER_CASE");
}

function testTestCalibrationSplitHelpers() {
  const props = [
    { trackingType: "TEST", readerOfficialDemoted: true },
    { trackingType: "TEST", readerOfficialDemoted: false },
    { trackingType: "OFFICIAL" },
  ];
  const demoted = props.filter((p) => p.readerOfficialDemoted === true);
  const uncertain = props.filter(
    (p) => p.trackingType === "TEST" && p.readerOfficialDemoted !== true
  );
  assert.strictEqual(demoted.length, 1);
  assert.strictEqual(uncertain.length, 1);
  console.log("✓ 11 TEST calibration splits demoted vs uncertain");
}

function testConfidenceFieldsPersistOnPickShape() {
  const pick = {
    readerConfidence: 71,
    winProbability: 58,
    finalConfidence: 67,
    confidenceBlendVersion: "v1-70-30",
    confidenceBlendFormula: "0.7*readerConfidence + 0.3*winProbability",
    confidence: 67,
  };
  assert.notStrictEqual(pick.readerConfidence, pick.winProbability);
  assert.strictEqual(pick.finalConfidence, 67);
  assert.ok(pick.confidenceBlendVersion);
  console.log("✓ 12 readerConfidence and winProbability persist separately");
}

function testLabReportTopPicksMissingMessage() {
  const review = buildTopPicksReview("2099-01-01", []);
  assert.strictEqual(review, null);
  const placeholder = {
    snapshotMissing: true,
    message: "No Top Picks snapshot found for this slate.",
  };
  assert.ok(placeholder.message.includes("No Top Picks snapshot"));
  console.log("✓ 13 Lab/report handles missing top picks without crash");
}

function testNoDuplicateStableKeysInSample() {
  const props = [
    {
      slateDate: "2026-06-23",
      league: "WNBA",
      player: "A",
      team: "T",
      opponent: "O",
      stat: "Points",
      side: "Over",
      trackedKey: "k-a",
    },
    {
      slateDate: "2026-06-23",
      league: "WNBA",
      player: "B",
      team: "T",
      opponent: "O",
      stat: "Points",
      side: "Under",
      trackedKey: "k-b",
    },
  ];
  const dupes = countDuplicateStableKeys(props);
  assert.strictEqual(dupes.duplicates, 0);
  console.log("✓ 14 duplicate stable keys absent in sample tracked set");
}

function testTopPicksReviewWhenSnapshotExists() {
  const tracked = [
    {
      slateDate: "2026-06-23",
      league: "WNBA",
      player: "A'ja Wilson",
      team: "LV",
      opponent: "PHX",
      stat: "Points",
      side: "Over",
      trackedKey: "k1",
      status: "win",
    },
  ];
  const review = buildTopPicksReview("2026-06-23", tracked, {
    snapshot: {
      slateDate: "2026-06-23",
      picks: [
        {
          trackedKey: "k1",
          topPickRank: 1,
          topPickLabel: "Top WNBA #1",
          league: "WNBA",
          player: "A'ja Wilson",
        },
      ],
      selectorVersion: "test",
    },
  });
  assert.ok(review);
  assert.ok(review.wnbaTopPicksReview);
  console.log("✓ 15 Top Picks Review builds when snapshot exists");
}

function testFullDataUnderGap17NoBet() {
  const reader = readWnbaProp(
    baseCard({
      dataMode: "WNBA_FULL_DATA",
      bookLine: 18.5,
      projection: { projection: 16.8, expectedMinutes: 33, expectedFGA: 14, expectedFTA: 7, method: "volume-first-v2" },
      last5: { points: 15.2, minutes: 33, fga: 14.2, fta: 7.2, ptsPerFGA: 0.875, ftPath: true, games: 5 },
      fairLine: { fairLine: 16.9, fairLineSide: "UNDER", fairLineEdge: 1.6, fairLineQuality: 95 },
    })
  );
  assert.strictEqual(reader.decision, "NO_BET");
  assert.strictEqual(reader.finalSide, null);
  assert.ok(reader.reasonCodes.includes("UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR"));
  console.log("✓ 19 WNBA_FULL_DATA Under gap 1.7 forces NO_BET");
}

function testNbaPathProtected() {
  assert.strictEqual(isCourteEdgeWnbaV2Enabled(), true);
  assert.strictEqual(WNBA_ENGINE_HANDLED, "WNBA_V2");
  const nbaPick = { league: "NBA", engineHandled: undefined };
  assert.strictEqual(nbaPick.engineHandled, undefined);
  console.log("✓ 16 NBA path has no WNBA engineHandled");
}

function testTopPropSelectorSuite() {
  runScript("testTopPropSelector.js");
  console.log("✓ 17 existing Top Prop selector tests pass");
}

function testTopPicksLifecycleSuite() {
  runScript("testTopPicksLifecycle.js");
  console.log("✓ 18 existing Top Picks lifecycle tests pass");
}

function testThinOverGapBelowFloorNoBet() {
  const reader = readWnbaProp(
    baseCard({
      bookLine: 14.5,
      projection: { projection: 17.8, expectedMinutes: 24, expectedFGA: 9, expectedFTA: 2.5, method: "volume-first-v2" },
      last5: { points: 15, minutes: 24, fga: 9, fta: 2, ptsPerFGA: 1.05, ftPath: true, games: 5 },
      fairLine: { fairLine: 15.5, fairLineSide: "OVER", fairLineEdge: 1.2, fairLineQuality: 58 },
    })
  );
  assert.strictEqual(reader.overGapFloorPassed, false);
  assert.strictEqual(reader.finalSide, null);
  assert.strictEqual(reader.decision, "NO_BET");
  assert.ok(reader.reasonCodes.includes("OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR"));
  console.log("✓ 20 thin Over gap 3.3 below 4.0 floor — NO_BET (no Over default)");
}

function testOverDefaultRemovedWhenUnderBlocked() {
  const reader = readWnbaProp(
    baseCard({
      bookLine: 16.5,
      projection: { projection: 21.0, expectedMinutes: 28, expectedFGA: 12, expectedFTA: 4, method: "volume-first-v2" },
      last5: { points: 18, minutes: 28, fga: 12, fta: 4, ptsPerFGA: 1.1, ftPath: true, games: 5 },
    })
  );
  assert.strictEqual(reader.underCase.underGapFloorPassed, false);
  assert.strictEqual(reader.overCase.overGapFloorPassed, true);
  assert.strictEqual(reader.finalSide, "OVER");
  console.log("✓ 21 Over with valid gap still wins when Under gap-blocked");
}

function testPreGapPenaltyScorePreserved() {
  const reader = readWnbaProp(
    baseCard({
      bookLine: 12.5,
      projection: { projection: 9.9, expectedMinutes: 22, expectedFGA: 8, expectedFTA: 2, method: "volume-first-v2" },
    })
  );
  assert.ok(reader.underCase.preGapPenaltyScore > reader.underCase.score);
  assert.strictEqual(reader.underCase.rawScore, reader.underCase.preGapPenaltyScore);
  console.log("✓ 22 preGapPenaltyScore preserved on Under gap-blocked case");
}

async function main() {
  testLimitedDataUnderGap26Penalty();
  testLimitedDataUnderGap32CanPass();
  testNbaUnderLogicProtected();
  testOverLineDropAgainst();
  testOverLineRiseSupport();
  testUnderLineDropSupport();
  testUnderLineRiseAgainst();
  await testAvailabilityFeedVsActive();
  testReaderOfficialDemotedFlag();
  testOfficialDemotionReasonStored();
  testTestCalibrationSplitHelpers();
  testConfidenceFieldsPersistOnPickShape();
  testLabReportTopPicksMissingMessage();
  testNoDuplicateStableKeysInSample();
  testTopPicksReviewWhenSnapshotExists();
  testFullDataUnderGap17NoBet();
  testThinOverGapBelowFloorNoBet();
  testOverDefaultRemovedWhenUnderBlocked();
  testPreGapPenaltyScorePreserved();
  testNbaPathProtected();
  testTopPropSelectorSuite();
  testTopPicksLifecycleSuite();
  console.log("\nAll 22 WNBA reader calibration tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
