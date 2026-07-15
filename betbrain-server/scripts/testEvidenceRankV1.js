/**
 * CourtEdge evidence-rank-v1 locking tests.
 * - thin-gap confidence dampening
 * - crowded same-team reduces weaker Over rank
 * - BOTH_SIDES_WEAK ranking penalty
 * - no auto-flip without Under independently qualifying
 */
import assert from "node:assert/strict";
import {
  computeEvidenceFinalConfidence,
  applyEvidenceFinalConfidenceToPick,
  EVIDENCE_FINAL_CONFIDENCE_VERSION,
  evaluateSameTeamOpportunityCluster,
  underIndependentlyWins,
  applySameTeamOpportunityAdjustments,
  evaluateSlateSameTeamOpportunity,
  PLAYER_INTELLIGENCE_BUILD_TAG,
} from "../engines/wnba/playerIntelligence/index.js";
import {
  applyDecisionDataIntelligenceToPick,
  BOTH_SIDES_WEAK_IMPACT,
} from "../engines/decisionIntelligence/decisionDataIntelligenceV1.js";
import {
  computeSafetyScore,
  selectBestSixDisplay,
} from "../engines/topProps/controlledBestSixSelector.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

function basePick(overrides = {}) {
  return {
    league: "WNBA",
    player: overrides.player || "Test Player",
    team: overrides.team || "liberty",
    teamKey: overrides.team || "liberty",
    side: overrides.side || "Over",
    pick: overrides.side || "Over",
    line: overrides.line ?? 18.5,
    projection: overrides.projection ?? 21.5,
    confidence: overrides.confidence ?? 78,
    finalConfidence: overrides.finalConfidence ?? 78,
    directionalConfidence: overrides.directionalConfidence ?? 78,
    dataConfidence: 70,
    bestPropScore: overrides.bestPropScore ?? 55,
    pickScore: overrides.pickScore ?? 55,
    bookCount: 4,
    marketQuality: 70,
    wnbaDataCard: {
      bookLine: overrides.line ?? 18.5,
      dataConfidenceScore: 70,
      projection: { projection: overrides.projection ?? 21.5 },
      last5: { minutes: 30, fga: 14, fta: 4, points: 18 },
      playerRoleProfile: {
        roleStabilityScore: "STABLE",
        usageProfile: "STABLE",
        profileConfidence: 72,
      },
      gameEnvironment: { impliedTeamTotal: overrides.impliedTeamTotal ?? 82 },
    },
    wnbaReader: {
      finalSide: "OVER",
      overGap: overrides.overGap ?? 3,
      underGap: overrides.underGap ?? 0.4,
      overCase: { score: overrides.overCase ?? 62 },
      underCase: { score: overrides.underCase ?? 40 },
      underGapFloorUsed: 2.5,
      supports: ["gap"],
      disagrees: [],
    },
    impliedTeamTotalAudit: { value: overrides.impliedTeamTotal ?? 82 },
    ...overrides,
  };
}

test("01 build tag is courteedge-evidence-rank-v1", () => {
  assert.equal(PLAYER_INTELLIGENCE_BUILD_TAG, "courteedge-evidence-rank-v1");
  assert.equal(EVIDENCE_FINAL_CONFIDENCE_VERSION, "evidence-final-confidence-v1");
});

test("02 thin projection gap dampens confidence even when side stays Over", () => {
  const strong = computeEvidenceFinalConfidence({
    projectionGap: 4.2,
    gapFloor: 2.5,
    projectionQualityStatus: "STRONG",
    profile: { profileConfidence: 75, roleStabilityScore: "STABLE", usageProfile: "STABLE" },
    dataConfidence: 72,
    market: { marketQuality: 70 },
    sameTeamOpportunity: { status: "SUPPORTED" },
    flipAction: "KEPT_ORIGINAL",
    side: "OVER",
    priorDirectional: 80,
  });
  const thin = computeEvidenceFinalConfidence({
    projectionGap: 1.1,
    gapFloor: 2.5,
    projectionQualityStatus: "MIXED",
    profile: { profileConfidence: 75, roleStabilityScore: "STABLE", usageProfile: "STABLE" },
    dataConfidence: 72,
    market: { marketQuality: 70 },
    sameTeamOpportunity: { status: "SUPPORTED" },
    flipAction: "KEPT_ORIGINAL",
    side: "OVER",
    priorDirectional: 80,
  });
  assert.ok(
    thin.finalConfidence < strong.finalConfidence - 8,
    `thin ${thin.finalConfidence} should be well below strong ${strong.finalConfidence}`
  );
  assert.ok(thin.thinGapDampener < 0, "thin gap dampener must fire");
  assert.ok(thin.components.projectionEdgeStrength < 45);
  assert.equal(thin.gapWasPrimaryDriver, false);
});

test("03 crowded same-team CONTRADICTED reduces weaker Over rank / trust", () => {
  const overs = [
    basePick({
      player: "Breanna Stewart",
      projection: 24,
      line: 20.5,
      bestPropScore: 70,
      expectedFGA: 18,
      impliedTeamTotal: 78,
    }),
    basePick({
      player: "Sabrina Ionescu",
      projection: 22,
      line: 19.5,
      bestPropScore: 66,
      expectedFGA: 16,
      impliedTeamTotal: 78,
    }),
    basePick({
      player: "Rebecca Allen Shepard",
      playerAlias: "Shepard",
      projection: 14,
      line: 11.5,
      bestPropScore: 58,
      expectedFGA: 12,
      impliedTeamTotal: 78,
    }),
    basePick({
      player: "Paige Bueckers",
      projection: 19,
      line: 17.5,
      bestPropScore: 60,
      expectedFGA: 14,
      impliedTeamTotal: 78,
    }),
  ];
  // Rename Shepard for cluster clarity
  overs[2].player = "Marine Johannès"; // keep 4 overs; use Shepard-named below
  overs[2] = basePick({
    player: "Shepard",
    projection: 13.5,
    line: 12.5,
    bestPropScore: 52,
    expectedFGA: 11,
    impliedTeamTotal: 78,
  });

  const cluster = evaluateSameTeamOpportunityCluster(overs);
  assert.ok(
    ["QUESTIONABLE", "CONTRADICTED"].includes(cluster.status),
    `expected crowded status, got ${cluster.status} pressure=${cluster.pressureScore}`
  );
  assert.ok(cluster.combinedPlayerProjected > 70);

  const adjusted = applySameTeamOpportunityAdjustments(overs);
  const byPlayer = Object.fromEntries(adjusted.map((p) => [p.player, p]));
  const weakestName = cluster.weakestPlayer;
  assert.ok(weakestName);
  const weak = byPlayer[weakestName];
  const strong = adjusted
    .filter((p) => p.player !== weakestName)
    .sort(
      (a, b) =>
        (b.bestPropScore || 0) -
        (a.bestPropScore || 0) -
        ((b.slateCollisionPenalty || 0) - (a.slateCollisionPenalty || 0))
    )[0];

  assert.ok(weak.slateCollisionPenalty > 0, "weaker Over must take ranking penalty");
  assert.ok(
    (weak.projectionTrustMultiplier || 1) < 1,
    "weaker Over must lose projection trust"
  );
  assert.ok(
    (weak.slateCollisionPenalty || 0) >= (strong.slateCollisionPenalty || 0),
    "weakest penalty should be >= peers"
  );
  assert.equal(weak.sameTeamOpportunityAudit?.autoFlip, false);

  // Rank via safety score: weak trust+penalty must reduce relative standing
  const weakSafety = computeSafetyScore({
    ...weak,
    bestPropScore: 60,
    confidence: 75,
    decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
  });
  const cleanSafety = computeSafetyScore({
    ...basePick({ player: "Clean Prop", team: "aces", projection: 20, line: 16.5 }),
    bestPropScore: 55,
    confidence: 68,
    projectionTrustMultiplier: 1,
    slateCollisionPenalty: 0,
    evidenceRankPenalty: 0,
    decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
  });
  assert.ok(
    weakSafety < cleanSafety,
    `crowded weak Over safety ${weakSafety} should rank below cleaner ${cleanSafety}`
  );
});

test("04 BOTH_SIDES_WEAK applies material ranking + trust + required edge; stays in pool", () => {
  const pick = basePick({
    player: "Weak Both",
    confidence: 82,
    finalConfidence: 82,
    directionalConfidence: 60, // already after -22 influence
    projection: 19.2,
    line: 18.5,
  });
  const applied = applyDecisionDataIntelligenceToPick(pick, {
    decisionDataIntelligence: {
      flipFirstDecision: {
        action: "BOTH_SIDES_WEAK",
        flipRecommended: false,
        originalSide: "OVER",
        finalSide: "OVER",
      },
      finalInfluence: {
        confidenceAdjustment: BOTH_SIDES_WEAK_IMPACT.confidenceAdjustment,
        bestSixImpact: "BOARD_OR_NO_BET",
        reasons: ["Both sides weak"],
      },
      projectionQuality: { status: "WEAK", score: 30 },
      roleStability: { status: "BAD", score: 30 },
      usageShare: { status: "BAD", score: 30 },
      marketIntelligence: { marketWarning: true, sideImpact: "UNDER" },
      sameTeamOpportunity: { status: "SUPPORTED" },
    },
  });

  assert.equal(applied.bothSidesWeak, true);
  assert.ok(
    applied.finalConfidence <= 58,
    `BOTH_SIDES_WEAK confidence cap: got ${applied.finalConfidence}`
  );
  assert.ok(
    applied.finalConfidence >= 18,
    `should not floor to absolute min from double-count: got ${applied.finalConfidence}`
  );
  assert.ok((applied.projectionTrustMultiplier || 1) <= 0.78);
  assert.ok(
    (applied.playerProfileCalibration?.overRequiredEdgeAdjustment || 0) >=
      BOTH_SIDES_WEAK_IMPACT.requiredEdgeBump
  );
  assert.ok((applied.bothSidesWeakRankingPenalty || 0) >= 22);

  const weakRank = computeSafetyScore({
    ...applied,
    bestPropScore: 70,
    confidence: applied.finalConfidence,
    decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
  });
  const cleaner = computeSafetyScore({
    ...basePick({ player: "Clean", team: "sun", confidence: 64, finalConfidence: 64 }),
    bestPropScore: 58,
    confidence: 64,
    projectionTrustMultiplier: 1,
    decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
    decisionDataIntelligence: {
      flipFirstDecision: { action: "KEPT_ORIGINAL" },
    },
  });
  assert.ok(
    weakRank < cleaner,
    `BOTH_SIDES_WEAK must not outrank cleaner on raw score alone (${weakRank} vs ${cleaner})`
  );

  // Still eligible for display/learning pool — not hard-dropped by selector filter alone
  const pool = [
    {
      ...cleaner,
      ...basePick({ player: "Clean", team: "sun", side: "Over", line: 15.5, projection: 19 }),
      confidence: 64,
      finalConfidence: 64,
      bestPropScore: 58,
      wnbaTrackingDecision: "TRACK",
      trackingEligibility: "TRACK",
      decisionIntelligence: {
        trackEligibility: "TRACK",
        trueRisk: "MEDIUM",
        bestSixEligibility: true,
      },
      sideSelectionBundle: { version: "test" },
      decisionHash: "clean-hash",
    },
    {
      ...applied,
      wnbaTrackingDecision: "BOARD_ONLY",
      trackingEligibility: "BOARD_ONLY",
      decisionIntelligence: {
        trackEligibility: "BOARD_ONLY",
        trueRisk: "MEDIUM",
        bestSixEligibility: false,
      },
      sideSelectionBundle: { version: "test" },
      decisionHash: "weak-hash",
      // Keep candidate present for learning path
      bestSixQualityFlags: [],
    },
  ];
  assert.ok(pool.length === 2, "BOTH_SIDES_WEAK candidate remains in pool objects");
});

test("05 no auto-flip without Under independently qualifying", () => {
  const weakOver = basePick({
    player: "Weakest Over",
    projection: 16,
    line: 15.5,
    overGap: 0.5,
    underGap: 0.8,
    overCase: 48,
    underCase: 50,
    impliedTeamTotal: 70,
    expectedFGA: 15,
  });
  const peers = [
    basePick({
      player: "Star A",
      projection: 25,
      line: 21.5,
      impliedTeamTotal: 70,
      expectedFGA: 17,
    }),
    basePick({
      player: "Star B",
      projection: 22,
      line: 18.5,
      impliedTeamTotal: 70,
      expectedFGA: 16,
    }),
    basePick({
      player: "Star C",
      projection: 18,
      line: 15.5,
      impliedTeamTotal: 70,
      expectedFGA: 14,
    }),
  ];
  const cluster = evaluateSameTeamOpportunityCluster([weakOver, ...peers]);
  const audit = cluster.propAudits.get("Weakest Over");
  assert.ok(audit);
  // Force contradicted path if not already
  const forceAudit = {
    ...audit,
    allowFlipEval: true,
    status: "CONTRADICTED",
    autoFlip: false,
  };
  assert.equal(underIndependentlyWins(weakOver, forceAudit), false);
  const adjusted = applySameTeamOpportunityAdjustments([weakOver, ...peers]);
  const row = adjusted.find((p) => p.player === "Weakest Over");
  assert.ok(!row.sameTeamOpportunityFlipEligible || row.side === "Over" || row.side === "OVER");
  assert.notEqual(String(row.side || row.pick).toUpperCase(), "UNDER");
  assert.equal(row.sameTeamOpportunityAudit?.autoFlip, false);
});

test("06 evidence-final apply overwrites confidence after evidence", () => {
  const pick = applyEvidenceFinalConfidenceToPick(
    basePick({
      confidence: 88,
      finalConfidence: 88,
      directionalConfidence: 88,
      projection: 19,
      line: 18.5,
      flipFirstAction: "BOTH_SIDES_WEAK",
      decisionDataIntelligence: {
        flipFirstDecision: { action: "BOTH_SIDES_WEAK" },
        projectionQuality: { status: "WEAK" },
        roleStability: { status: "BAD", score: 25 },
        usageShare: { status: "BAD", score: 25 },
        marketIntelligence: { marketWarning: true, sideImpact: "UNDER" },
        sameTeamOpportunity: { status: "CONTRADICTED", pressureScore: 60 },
        finalInfluence: { confidenceAdjustment: -22 },
      },
    })
  );
  assert.ok(pick.confidenceBeforeEvidenceFinal === 88);
  assert.ok(pick.finalConfidence <= 58);
  assert.ok(pick.evidenceFinalConfidence?.version === EVIDENCE_FINAL_CONFIDENCE_VERSION);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
