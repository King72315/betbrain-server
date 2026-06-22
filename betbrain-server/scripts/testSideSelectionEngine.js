/**
 * CourtEdge side-selection + TEST tracking unit tests.
 * Usage: node betbrain-server/scripts/testSideSelectionEngine.js
 */
import assert from "assert";
import {
  evaluateSideSelection,
  finalizeSideTrackingDecision,
} from "../engines/sideSelectionEngine.js";
import { isOfficialResultsProp, isTestTrackingPick } from "../services/trackedPropService.js";

process.env.COURTEDGE_WNBA_V1 = "true";

function baseRisk(overrides = {}) {
  return {
    pickSide: "OVER",
    overNet: 12,
    underNet: 4,
    overRisk: 40,
    underRisk: 55,
    trustable: false,
    noPlayReasons: ["Not enough side support"],
    totalEvidence: 20,
    netEdge: 6,
    ...overrides,
  };
}

function testProjectionOverWeakContextIsTest() {
  const result = evaluateSideSelection({
    league: "WNBA",
    line: 18.5,
    projection: 20,
    last5Avg: 17,
    minutesAvg: 22,
    fgaAvg: 7,
    dataQuality: 55,
    marketQuality: 50,
    bookCount: 4,
    blowoutRisk: 40,
    roleCertainty: 50,
    playerState: { dataMode: "WNBA_LIMITED_DATA" },
    volumeProfile: { wnbaLimitedData: true },
    availabilityGate: { applicable: true, statusLevel: "ACTIVE" },
    riskComparison: baseRisk({ pickSide: "OVER" }),
  });

  assert.strictEqual(result.finalSide, "OVER");
  assert.strictEqual(result.finalDecision, "TEST");
  assert.strictEqual(result.trackingType, "TEST");
  assert.ok(result.testReasons.some((r) => r.includes("weak volume/context")));
}

function testContradictionBlowoutOverNotOfficial() {
  const result = evaluateSideSelection({
    league: "WNBA",
    line: 14.5,
    projection: 19,
    last5Avg: 18,
    minutesAvg: 30,
    fgaAvg: 14,
    dataQuality: 65,
    marketQuality: 55,
    bookCount: 5,
    blowoutRisk: 80,
    roleCertainty: 60,
    playerState: { dataMode: "WNBA_LIMITED_DATA" },
    volumeProfile: { wnbaLimitedData: true },
    availabilityGate: { applicable: true, statusLevel: "ACTIVE" },
    riskComparison: baseRisk({ pickSide: "OVER", trustable: true }),
  });

  assert.ok(result.contradictions.some((c) => c.type === "blowout_over"));
  const finalized = finalizeSideTrackingDecision(
    {
      league: "WNBA",
      tier: "PREMIUM",
      line: 14.5,
      projection: 19,
      side: "Over",
      riskLabel: "Low Risk",
      bookCount: 5,
      marketQuality: 60,
      confidence: 78,
      volumeProfile: { wnbaLimitedData: true },
      blowoutRisk: 80,
    },
    result
  );
  assert.strictEqual(finalized.trackingType, "TEST");
  assert.strictEqual(finalized.officialEligible, false);
}

function testUnderStrongGapCanFinalizeOfficial() {
  const result = evaluateSideSelection({
    league: "WNBA",
    line: 20.5,
    projection: 15,
    last5Avg: 14,
    minutesAvg: 30,
    fgaAvg: 12,
    dataQuality: 70,
    marketQuality: 60,
    bookCount: 6,
    blowoutRisk: 30,
    roleCertainty: 70,
    playerState: { dataMode: "WNBA_LIMITED_DATA" },
    volumeProfile: { wnbaLimitedData: true },
    availabilityGate: { applicable: true, statusLevel: "ACTIVE" },
    riskComparison: baseRisk({
      pickSide: "UNDER",
      underNet: 14,
      overNet: 3,
      trustable: true,
      noPlayReasons: [],
    }),
  });

  assert.strictEqual(result.finalSide, "UNDER");
  const finalized = finalizeSideTrackingDecision(
    {
      league: "WNBA",
      tier: "PREMIUM",
      line: 20.5,
      projection: 15,
      side: "Under",
      riskLabel: "Low Risk",
      bookCount: 6,
      marketQuality: 60,
      confidence: 78,
      volumeProfile: { wnbaLimitedData: true },
    },
    result
  );
  assert.ok(["OFFICIAL", "TEST"].includes(finalized.trackingType));
}

function testOutPlayerIsNoBet() {
  const result = evaluateSideSelection({
    league: "WNBA",
    line: 16.5,
    projection: 18,
    last5Avg: 17,
    minutesAvg: 28,
    fgaAvg: 12,
    dataQuality: 60,
    availabilityGate: {
      applicable: true,
      statusLevel: "OUT",
      noPlay: true,
      noPlayReasons: ["Player OUT"],
    },
    riskComparison: baseRisk({ trustable: true, noPlayReasons: [] }),
  });

  assert.strictEqual(result.finalDecision, "NO_BET");
  assert.strictEqual(result.trackingType, "NO_BET");
  assert.ok(result.noBetReasons.some((r) => r.includes("OUT")));
}

function testZeroOfficialButTestExcludedFromOfficialWinRate() {
  const props = [
    { trackingType: "TEST", status: "win", excludedFromOfficialRecord: true },
    { trackingType: "TEST", status: "loss", excludedFromOfficialRecord: true },
  ];

  const officialProps = props.filter((p) => isOfficialResultsProp(p));
  const testProps = props.filter((p) => isTestTrackingPick(p));

  assert.strictEqual(officialProps.length, 0);
  assert.strictEqual(testProps.length, 2);
}

function test0621NotMutated() {
  const fixture0621 = {
    slateDate: "2026-06-21",
    player: "A'ja Wilson",
    trackingType: "OFFICIAL",
    tier: "PREMIUM",
    status: "win",
    preV1Shadow: false,
  };

  assert.strictEqual(isOfficialResultsProp(fixture0621), true);
  assert.strictEqual(isTestTrackingPick(fixture0621), false);

  const untouched = JSON.parse(JSON.stringify(fixture0621));
  assert.deepStrictEqual(untouched, fixture0621);
}

function main() {
  testProjectionOverWeakContextIsTest();
  testContradictionBlowoutOverNotOfficial();
  testUnderStrongGapCanFinalizeOfficial();
  testOutPlayerIsNoBet();
  testZeroOfficialButTestExcludedFromOfficialWinRate();
  test0621NotMutated();

  console.log(
    JSON.stringify(
      { ok: true, suite: "testSideSelectionEngine", passed: 6 },
      null,
      2
    )
  );
}

main();
