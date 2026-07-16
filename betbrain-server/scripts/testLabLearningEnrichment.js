/**
 * Lab learning enrichment tests.
 * Usage: node betbrain-server/scripts/testLabLearningEnrichment.js
 */
import assert from "assert";
import {
  classifyPropMiss,
  attributeModules,
  enrichGradedPropForLab,
  buildPostgameTruth,
  buildLabCounterfactual,
  LAB_LEARNING_VERSION,
} from "../services/labLearningEnrichmentService.js";
import { buildOfficialLearningRecord } from "../services/officialLearningRecordBuilder.js";
import { freezeOfficialProp } from "../services/officialSlateService.js";

function baseProp(overrides = {}) {
  const frozen = freezeOfficialProp(
    {
      player: "Test Player",
      team: "TeamA",
      opponent: "TeamB",
      league: "WNBA",
      line: 18.5,
      side: "Over",
      pick: "Over",
      confidence: 70,
      projectedPoints: 21,
      expectedMinutes: 29,
      expectedFGA: 14,
      expectedFTA: 4,
      openingLine: 18.5,
      decisionIntelligence: {
        trackEligibility: "TRACK",
        trueRisk: "MEDIUM",
        naturalDecision: "TRACK",
        simpleExplanation: "Recent form supports over",
      },
      wnbaReader: { finalSide: "Over", overGap: 2.5, thinGap: false },
      sideRescue: { action: "KEEP" },
      playerRoleProfile: { profileType: "PRIMARY_SCORER" },
      slateDate: "2099-01-01",
      ...overrides,
    },
    { slateDate: "2099-01-01", serverBuild: "test" }
  );
  return frozen;
}

function testMinutesCutMiss() {
  const prop = {
    ...baseProp(),
    status: "loss",
    result: "LOSS",
    actualStat: 12,
    resultMargin: -6.5,
    latestLine: 18.5,
    actualMinutes: 20,
    actualFGA: 11,
    expectedMinutes: 29,
    expectedFGA: 14,
    pregameSnapshot: {
      ...baseProp().pregameSnapshot,
      expectedMinutes: 29,
      expectedFGA: 14,
    },
  };
  const miss = classifyPropMiss(prop);
  assert.strictEqual(miss.missType, "OPPORTUNITY_MISS");
  assert.strictEqual(miss.missSubtype, "MINUTES_CUT");
  assert.ok(String(miss.calibrationLesson).includes("29"));
  assert.ok(String(miss.calibrationLesson).includes("20"));
}

function testColdShootingMiss() {
  const prop = {
    ...baseProp(),
    status: "loss",
    result: "LOSS",
    actualStat: 14,
    resultMargin: -4.5,
    latestLine: 18.5,
    actualMinutes: 28,
    actualFGA: 14,
    pregameSnapshot: {
      ...baseProp().pregameSnapshot,
      expectedMinutes: 29,
      expectedFGA: 14,
    },
  };
  const miss = classifyPropMiss(prop);
  assert.strictEqual(miss.missType, "EFFICIENCY_VARIANCE");
  assert.strictEqual(miss.missSubtype, "COLD_SHOOTING");
}

function testSteamAgainstSide() {
  const prop = {
    ...baseProp(),
    status: "loss",
    result: "LOSS",
    actualStat: 16,
    resultMargin: -2.5,
    latestLine: 16.5, // closed 2 points against Over (line fell)
    actualMinutes: 30,
    actualFGA: 16,
    officialLine: 18.5,
    lockLine: 18.5,
    pregameSnapshot: {
      ...baseProp().pregameSnapshot,
      expectedMinutes: 29,
      expectedFGA: 14,
      line: 18.5,
      side: "OVER",
    },
  };
  const truth = buildPostgameTruth(prop);
  assert.ok(
    truth.closingLineValue != null && truth.closingLineValue <= -1,
    `expected negative CLV, got ${truth.closingLineValue}`
  );
  const miss = classifyPropMiss(prop, truth);
  assert.strictEqual(miss.missType, "MARKET_MISS");
  assert.strictEqual(miss.missSubtype, "STEAM_AGAINST_SIDE");
}

function testModuleAttributionNotBlanket() {
  const prop = enrichGradedPropForLab({
    ...baseProp(),
    status: "loss",
    result: "LOSS",
    actualStat: 12,
    resultMargin: -6.5,
    actualMinutes: 20,
    actualFGA: 9,
    latestLine: 18.5,
    sideRescue: { action: "KEEP" },
    pregameSnapshot: {
      ...baseProp().pregameSnapshot,
      expectedMinutes: 29,
      expectedFGA: 14,
      sideRescue: { action: "KEEP" },
    },
  });
  assert.ok(prop.modulesHurt.includes("PROJECTION_VOLUME") || prop.modulesHurt.length >= 1);
  assert.ok(prop.modulesNeutral.includes("SIDE_RESCUE"));
  assert.ok(!prop.modulesHurt.includes("SIDE_RESCUE"));
  assert.ok(prop.missType);
  assert.ok(prop.calibrationLesson);
  assert.strictEqual(prop.labLearningVersion, LAB_LEARNING_VERSION);
}

function testCounterfactual() {
  const prop = {
    ...baseProp(),
    status: "loss",
    result: "LOSS",
    actualStat: 10,
    officialLine: 18.5,
    lockedSide: "OVER",
  };
  const cf = buildLabCounterfactual(prop);
  assert.strictEqual(cf.selectedSideResult, false);
  assert.strictEqual(cf.oppositeSideResult, true);
  assert.strictEqual(cf.noPlayPreferable, false);
}

function testLearningRecordPacket() {
  const prop = enrichGradedPropForLab({
    ...baseProp(),
    status: "loss",
    result: "LOSS",
    actualStat: 12,
    actualMinutes: 20,
    actualFGA: 9,
    resultMargin: -6.5,
    latestLine: 18.5,
  });
  const rec = buildOfficialLearningRecord(prop);
  assert.ok(rec.pregameSnapshot);
  assert.ok(rec.postgameLearning);
  assert.ok(rec.learningPacket?.pregame);
  assert.ok(rec.learningPacket?.postgame);
  assert.strictEqual(rec.learningPacket.postgame.actualMinutes, 20);
  assert.ok(rec.calibration.modulesNeutral?.includes("SIDE_RESCUE") || rec.calibration.modulesHurt);
  // Pregame immutability: rebuild with different analysis must keep line/side/projection
  const rec2 = buildOfficialLearningRecord({
    ...prop,
    confidence: 1,
    projectedPoints: 0,
    line: 0.5,
  });
  assert.strictEqual(rec2.pregameSnapshot.line, rec.pregameSnapshot.line);
  assert.strictEqual(rec2.pregameSnapshot.side, rec.pregameSnapshot.side);
  assert.strictEqual(rec2.pregameSnapshot.projection, rec.pregameSnapshot.projection);
}

function testModuleAttribution() {
  const mods = attributeModules({
    ...baseProp(),
    status: "win",
    result: "WIN",
    actualStat: 25,
    actualMinutes: 32,
    actualFGA: 16,
  });
  assert.ok(Array.isArray(mods.modulesHelped));
  assert.ok(Array.isArray(mods.modulesHurt));
  assert.ok(Array.isArray(mods.modulesNeutral));
  assert.ok(mods.modulesNeutral.includes("SIDE_RESCUE"));
}

const tests = [
  ["1 minutes-cut → OPPORTUNITY_MISS/MINUTES_CUT", testMinutesCutMiss],
  ["2 cold shooting → EFFICIENCY_VARIANCE", testColdShootingMiss],
  ["3 CLV / steam fields populate", testSteamAgainstSide],
  ["4 module attribution skips non-influencing rescue", testModuleAttributionNotBlanket],
  ["5 counterfactual opposite side", testCounterfactual],
  ["6 learning packet + pregame immutability", testLearningRecordPacket],
  ["7 module lists always present", testModuleAttribution],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`PASS: ${name}`);
}
console.log(`\nAll ${passed}/${tests.length} Lab learning enrichment tests passed.`);
