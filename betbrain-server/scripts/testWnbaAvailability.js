/**
 * WNBA availability ACTIVE fix unit tests (no prod mutation).
 * Usage: node betbrain-server/scripts/testWnbaAvailability.js
 */
import assert from "assert";
import {
  AVAILABILITY_SERVICE_VERSION,
  buildWnbaAvailabilityEvaluation,
  classifyWnbaInjuryStatus,
  resetWnbaInjuryCacheForTests,
} from "../services/wnbaAvailabilityService.js";
import { resolveQualityGateInputs } from "../engines/wnba/wnbaGateInputs.js";

function okFeed(rows = []) {
  return { feedFetchOk: true, httpStatus: 200, rowCount: rows.length, rows };
}

function failFeed(errorReason = "http_503", httpStatus = 503) {
  return { feedFetchOk: false, httpStatus, rowCount: 0, errorReason, rows: [] };
}

function testServiceVersion() {
  assert.strictEqual(AVAILABILITY_SERVICE_VERSION, "wnba-availability-active-v1");
}

function testFeedOkNotListedIsActive() {
  const result = buildWnbaAvailabilityEvaluation({
    feed: okFeed([]),
    playerId: "99999",
    playerName: "Healthy Player",
    league: "WNBA",
  });
  assert.strictEqual(result.statusLevel, "ACTIVE");
  assert.strictEqual(result.availabilityStatus, "ACTIVE");
  assert.strictEqual(result.availabilityDataMissing, false);
  assert.strictEqual(result.availabilityRisk, false);
  assert.strictEqual(result.availabilitySourceStatus, "OK");
  assert.strictEqual(result.availabilityMessage, "Active — not on injury report");
  assert.strictEqual(result.dangerPressure, 0);
  assert.strictEqual(result.blocksOfficial, false);
  assert.strictEqual(result.source, AVAILABILITY_SERVICE_VERSION);
}

function testFeedFailIsSourceUnavailable() {
  const result = buildWnbaAvailabilityEvaluation({
    feed: failFeed("http_503", 503),
    playerName: "Any Player",
    league: "WNBA",
  });
  assert.strictEqual(result.statusLevel, "UNKNOWN");
  assert.strictEqual(result.availabilityDataMissing, true);
  assert.strictEqual(result.availabilityRisk, true);
  assert.strictEqual(result.availabilitySourceStatus, "SOURCE_UNAVAILABLE");
  assert.ok(result.availabilityMessage.includes("feed missing"));
  assert.strictEqual(result.feedFetchOk, false);
  assert.strictEqual(result.feedHttpStatus, 503);
  assert.strictEqual(result.feedErrorReason, "http_503");
}

function testDayToDayIsQuestionable() {
  assert.strictEqual(classifyWnbaInjuryStatus("Day-To-Day").level, "QUESTIONABLE");
  assert.strictEqual(classifyWnbaInjuryStatus("day to day").level, "QUESTIONABLE");

  const result = buildWnbaAvailabilityEvaluation({
    feed: okFeed([
      {
        player: { id: 42, first_name: "Test", last_name: "Player" },
        status: "Day-To-Day",
      },
    ]),
    playerId: "42",
    playerName: "Test Player",
    league: "WNBA",
  });
  assert.strictEqual(result.statusLevel, "QUESTIONABLE");
  assert.strictEqual(result.availabilityDataMissing, false);
  assert.strictEqual(result.availabilitySourceStatus, "OK");
  assert.strictEqual(result.blocksOfficial, true);
  assert.strictEqual(result.officialCapTier, "WATCHLIST");
}

function testOutBlocksOfficial() {
  const result = buildWnbaAvailabilityEvaluation({
    feed: okFeed([
      {
        player: { id: 7, first_name: "Injured", last_name: "Star" },
        status: "Out",
      },
    ]),
    playerId: "7",
    playerName: "Injured Star",
    league: "WNBA",
  });
  assert.strictEqual(result.statusLevel, "OUT");
  assert.strictEqual(result.noPlay, true);
  assert.strictEqual(result.blocksOfficial, true);
  assert.strictEqual(result.availabilityDataMissing, false);
}

function testUnknownStatusNotFeedMissing() {
  const result = buildWnbaAvailabilityEvaluation({
    feed: okFeed([
      {
        player: { id: 55, first_name: "Odd", last_name: "Status" },
        status: "Resting (coach decision)",
      },
    ]),
    playerId: "55",
    playerName: "Odd Status",
    league: "WNBA",
  });
  assert.strictEqual(result.statusLevel, "UNKNOWN");
  assert.strictEqual(result.availabilityDataMissing, false);
  assert.strictEqual(result.availabilitySourceStatus, "OK");
  assert.strictEqual(result.availabilityRisk, true);
}

function testGateInputsNoUnknownInference() {
  const inferred = resolveQualityGateInputs({
    league: "WNBA",
    wnbaDataCard: {
      injuryAvailability: { level: "UNKNOWN" },
    },
  });
  assert.strictEqual(inferred.availabilityDataMissing, false);

  const explicit = resolveQualityGateInputs({
    league: "WNBA",
    availabilityDataMissing: true,
    wnbaDataCard: {
      injuryAvailability: { level: "ACTIVE" },
    },
  });
  assert.strictEqual(explicit.availabilityDataMissing, true);

  const cardFlag = resolveQualityGateInputs({
    league: "WNBA",
    wnbaDataCard: {
      injuryAvailability: { level: "UNKNOWN", availabilityDataMissing: true },
    },
  });
  assert.strictEqual(cardFlag.availabilityDataMissing, true);
}

function testNonWnbaNotApplicable() {
  const result = buildWnbaAvailabilityEvaluation({
    feed: okFeed([]),
    playerName: "NBA Player",
    league: "NBA",
  });
  assert.strictEqual(result.applicable, false);
}

function main() {
  resetWnbaInjuryCacheForTests();
  testServiceVersion();
  testFeedOkNotListedIsActive();
  testFeedFailIsSourceUnavailable();
  testDayToDayIsQuestionable();
  testOutBlocksOfficial();
  testUnknownStatusNotFeedMissing();
  testGateInputsNoUnknownInference();
  testNonWnbaNotApplicable();
  console.log(
    JSON.stringify({ ok: true, suite: "testWnbaAvailability", passed: 8 }, null, 2)
  );
}

main();
