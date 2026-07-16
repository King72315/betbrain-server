/**
 * Player role identity + confidence recalibration smoke tests.
 */
import assert from "node:assert/strict";
import {
  buildPlayerRoleIdentity,
  classifySideEvidenceClass,
  computeEvidenceFinalConfidence,
} from "../engines/wnba/playerIntelligence/index.js";
import {
  buildFlipFirstCompactLabels,
  BOTH_SIDES_WEAK_IMPACT,
} from "../engines/decisionIntelligence/decisionDataIntelligenceV1.js";

let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`PASS ${name}`);
}

test("stable starter identity leans Over with projection shift", () => {
  const id = buildPlayerRoleIdentity({
    roleStabilityScore: "STABLE",
    usageProfile: "LOCKED",
    minutesLevel: "HIGH",
    scoringVolume: "HIGH",
    opportunityTrend: "FLAT",
    profileConfidence: 80,
    recentMinutesAverage: 32,
  });
  assert.equal(id.identity, "STABLE_STARTER");
  assert.equal(id.sideBias, "OVER");
  assert.ok(id.projectionShift > 0);
});

test("minutes-dependent does not mint Under from weak Over alone", () => {
  const id = buildPlayerRoleIdentity({
    roleStabilityScore: "VOLATILE",
    usageProfile: "ERRATIC",
    minutesLevel: "MEDIUM",
    scoringVolume: "MEDIUM",
    opportunityTrend: "FLAT",
    profileConfidence: 40,
    volatilityIndex: 75,
  });
  assert.equal(id.identity, "MINUTES_DEPENDENT");
  assert.equal(id.lackOfOverEvidenceIsNotUnderEdge, true);
  const cls = classifySideEvidenceClass({
    side: "UNDER",
    identity: id,
    overCaseScore: 40,
    underCaseScore: 48,
    underGap: 1.2,
    gapFloor: 2.5,
  });
  assert.equal(cls.sideEvidenceClass, "UNCERTAINTY");
});

test("TRACK floor and softer BOTH_SIDES_WEAK cap", () => {
  assert.equal(BOTH_SIDES_WEAK_IMPACT.confidenceAdjustment, -10);
  const result = computeEvidenceFinalConfidence({
    projectionGap: 2.8,
    gapFloor: 2.5,
    projectionQualityStatus: "MIXED",
    profile: { profileConfidence: 70, roleStabilityScore: "STABLE", usageProfile: "STABLE" },
    dataConfidence: 68,
    market: { marketQuality: 65 },
    sameTeamOpportunity: { status: "SUPPORTED" },
    flipAction: "BOTH_SIDES_WEAK",
    side: "OVER",
    priorDirectional: 62,
    trackEligibility: "TRACK",
    roleIdentityFloor: 48,
    riskDebtIds: ["UNSTABLE_ROLE"],
  });
  assert.ok(result.finalConfidence <= 70);
  assert.ok(result.finalConfidence >= 42, `got ${result.finalConfidence}`);
  assert.ok(result.finalConfidence >= 28);
});

test("collision labels are never blank", () => {
  assert.equal(
    buildFlipFirstCompactLabels({
      sameTeamOpportunity: { opportunityAssessment: "INSUFFICIENT_DATA" },
    }).collision,
    "INCOMPLETE"
  );
  assert.equal(
    buildFlipFirstCompactLabels({ sameTeamOpportunity: { detected: false } }).collision,
    "CLEAR"
  );
  assert.equal(
    buildFlipFirstCompactLabels({
      sameTeamOpportunity: { opportunityAssessment: "SUPPORTED" },
    }).collision,
    "CLEAR"
  );
});

console.log(`\n${passed}/4 identity+confidence tests passed`);
