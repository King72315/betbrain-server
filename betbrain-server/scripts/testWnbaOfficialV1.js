/**
 * CourtEdge WNBA v1 official engine unit tests (no prod mutation).
 * Usage: node betbrain-server/scripts/testWnbaOfficialV1.js
 */
import assert from "assert";
import { computeLineMovementAgainstSide } from "../engines/marketIntelligenceEngine.js";
import {
  applyWnbaFairLineOfficialDemotion,
  evaluateWnbaOfficialEligibility,
  evaluateWnbaOfficialGapFloor,
  evaluateWnbaLowRiskOfficialGates,
  isWnbaOfficialEligiblePick,
} from "../engines/wnbaOfficialEngine.js";
import { classifyWnbaInjuryStatus } from "../services/wnbaAvailabilityService.js";

function testLineMovementMatrix() {
  assert.strictEqual(computeLineMovementAgainstSide("OVER", -1), true);
  assert.strictEqual(computeLineMovementAgainstSide("OVER", 1), false);
  assert.strictEqual(computeLineMovementAgainstSide("UNDER", 1), true);
  assert.strictEqual(computeLineMovementAgainstSide("UNDER", -1), false);
}

function testGapFloors() {
  const underFail = evaluateWnbaOfficialGapFloor(
    {
      league: "WNBA",
      line: 18.5,
      projection: 16,
      side: "Under",
      volumeProfile: { wnbaLimitedData: true },
    },
    "UNDER"
  );
  assert.strictEqual(underFail.passes, false);
  assert.strictEqual(underFail.reason, "under_gap_too_small");

  const overPass = evaluateWnbaOfficialGapFloor(
    {
      league: "WNBA",
      line: 14.5,
      projection: 19.5,
      side: "Over",
      volumeProfile: { wnbaLimitedData: true },
    },
    "OVER"
  );
  assert.strictEqual(overPass.passes, true);
  assert.ok(overPass.gap >= 4);
}

function testAvailabilityMapping() {
  assert.strictEqual(classifyWnbaInjuryStatus("Out").level, "OUT");
  assert.strictEqual(classifyWnbaInjuryStatus("Inactive").level, "OUT");
  assert.strictEqual(classifyWnbaInjuryStatus("Doubtful").level, "LIMITED");
  assert.strictEqual(classifyWnbaInjuryStatus("Limited").level, "LIMITED");
  assert.strictEqual(classifyWnbaInjuryStatus("Questionable").level, "QUESTIONABLE");
  assert.strictEqual(classifyWnbaInjuryStatus("Active").level, "ACTIVE");
}

function testFairLineDemotion() {
  const demoted = applyWnbaFairLineOfficialDemotion({
    league: "WNBA",
    dataMode: "WNBA_LIMITED_DATA",
    fairLineSide: "OVER",
  });
  assert.strictEqual(demoted.fairLineBoostSuppressed, true);
  assert.strictEqual(demoted.fairLineSideEffective, "NONE");
}

function testOfficialEligibility() {
  const blocked = evaluateWnbaOfficialEligibility({
    league: "WNBA",
    tier: "PREMIUM",
    side: "Under",
    line: 20,
    projection: 18.5,
    riskLabel: "Low Risk",
    bookCount: 5,
    marketQuality: 60,
    confidence: 78,
    volumeProfile: { wnbaLimitedData: true },
  });
  assert.strictEqual(blocked.eligible, false);

  const lowRiskOneBook = evaluateWnbaLowRiskOfficialGates({
    league: "WNBA",
    riskLabel: "Low Risk",
    bookCount: 1,
  });
  assert.strictEqual(lowRiskOneBook.blocksOfficial, true);
}

function testLabSafetyNonRetroactive() {
  const futurePick = {
    league: "WNBA",
    slateDate: "2026-06-23",
    tier: "PREMIUM",
    line: 20,
    projection: 18.5,
    side: "Under",
    riskLabel: "Low Risk",
    bookCount: 5,
    marketQuality: 60,
    confidence: 78,
    volumeProfile: { wnbaLimitedData: true },
  };
  assert.strictEqual(isWnbaOfficialEligiblePick(futurePick), false);
}

function main() {
  testLineMovementMatrix();
  testGapFloors();
  testAvailabilityMapping();
  testFairLineDemotion();
  testOfficialEligibility();
  testLabSafetyNonRetroactive();
  console.log(
    JSON.stringify({ ok: true, suite: "testWnbaOfficialV1", passed: 6 }, null, 2)
  );
}

main();
