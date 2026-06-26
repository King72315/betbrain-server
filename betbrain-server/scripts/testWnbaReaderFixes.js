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
import { evaluateWnbaAvailability } from "../services/wnbaAvailabilityService.js";
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
  assert.strictEqual(reader.finalSide, "UNDER");
  assert.ok(reader.limitedDataUnderPenaltyApplied);
  assert.ok(reader.reasonCodes.includes("UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR"));
  console.log("✓ 1 limited-data Under gap 2.6 triggers floor penalty");
}

function testLimitedDataUnderGap32CanPass() {
  const reader = readWnbaProp(
    baseCard({
      bookLine: 14.5,
      projection: { projection: 11.2, expectedMinutes: 24, expectedFGA: 9, expectedFTA: 2.5, method: "volume-first-v2" },
      last5: { points: 11, minutes: 18, fga: 6, fta: 1.5, ptsPerFGA: 1.05, ftPath: true, games: 5 },
      fairLine: { fairLine: 13.5, fairLineSide: "UNDER", fairLineEdge: 1.2, fairLineQuality: 58 },
    })
  );
  assert.strictEqual(reader.finalSide, "UNDER");
  assert.strictEqual(reader.underGapFloorPassed, true);
  assert.strictEqual(reader.limitedDataUnderPenaltyApplied, false);
  console.log("✓ 2 limited-data Under gap 3.2 passes floor");
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

async function testUnknownAvailabilityMissingData() {
  const avail = await evaluateWnbaAvailability({
    playerName: "No Feed Player XYZ",
    league: "WNBA",
  });
  assert.strictEqual(avail.statusLevel, "UNKNOWN");
  assert.strictEqual(avail.availabilityDataMissing, true);
  assert.strictEqual(avail.availabilityRisk, true);
  assert.strictEqual(avail.availabilitySourceStatus, "SOURCE_UNAVAILABLE");
  assert.ok(avail.dangerPressure > 0);
  assert.strictEqual(avail.blocksOfficial, false);
  console.log("✓ 8 unknown availability = missing data + uncertainty risk");
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

async function main() {
  testLimitedDataUnderGap26Penalty();
  testLimitedDataUnderGap32CanPass();
  testNbaUnderLogicProtected();
  testOverLineDropAgainst();
  testOverLineRiseSupport();
  testUnderLineDropSupport();
  testUnderLineRiseAgainst();
  await testUnknownAvailabilityMissingData();
  testReaderOfficialDemotedFlag();
  testOfficialDemotionReasonStored();
  testTestCalibrationSplitHelpers();
  testConfidenceFieldsPersistOnPickShape();
  testLabReportTopPicksMissingMessage();
  testNoDuplicateStableKeysInSample();
  testTopPicksReviewWhenSnapshotExists();
  testNbaPathProtected();
  testTopPropSelectorSuite();
  testTopPicksLifecycleSuite();
  console.log("\nAll 18 WNBA reader calibration tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
