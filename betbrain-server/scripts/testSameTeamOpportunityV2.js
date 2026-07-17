/**
 * Acceptance tests — CourtEdge Same-Team Opportunity Engine V2
 */
import assert from "node:assert/strict";
import {
  isMeaningfulScorer,
  computeOpportunityStrengthScore,
  underCandidateQualifies,
  arbitrateSameTeamOpportunityV2,
  SAME_TEAM_OPPORTUNITY_V2_VERSION,
} from "../engines/wnba/playerIntelligence/sameTeamOpportunityEngineV2.js";
import {
  selectControlledBestSix,
  selectTopTwoFromBestSix,
  CONTROLLED_BEST_SIX_VERSION,
} from "../engines/topProps/controlledBestSixSelector.js";

function basePick(overrides = {}) {
  const line = overrides.line ?? 18.5;
  const projection = overrides.projection ?? line + 3;
  const side = overrides.side || "Over";
  return {
    league: "WNBA",
    player: "Player",
    team: "indianafever",
    opponent: "seattlestorm",
    gameId: "game-ind-sea",
    gameLabel: "IND @ SEA",
    stat: "Points",
    side,
    pick: side,
    line,
    projection,
    overGap: projection - line,
    underGap: line - projection,
    expectedMinutes: 30,
    expectedFGA: 14,
    expectedFTA: 4,
    confidence: 62,
    marketQuality: 70,
    fairLineSide: "Over",
    bestPropScore: 70,
    pickScore: 70,
    trackingEligibility: "TRACK",
    wnbaTrackingDecision: "TRACK",
    wnbaDataCard: {
      projection: {
        projection,
        expectedMinutes: 30,
        expectedFGA: 14,
        expectedFTA: 4,
      },
      last5: { points: projection, minutes: 30, fga: 14, fta: 4 },
      season: { points: projection - 1 },
      bookLine: line,
    },
    wnbaReader: {
      overGap: projection - line,
      underGap: line - projection,
      overCase: { score: 18 },
      underCase: { score: 6 },
      finalSide: String(side).toUpperCase(),
    },
    wnbaGameContext: {
      impliedTeamTotal: 82,
      playerTeam: "indianafever",
    },
    impliedTeamTotal: 82,
    playerRoleIdentity: { identity: "VOLUME_SCORER" },
    decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
    // Minimal gate inputs so applyWnbaDecisionStack paths don't hard-fail in isolation.
    dataMode: "FULL",
    ...overrides,
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

test("version tags present", () => {
  assert.ok(SAME_TEAM_OPPORTUNITY_V2_VERSION.includes("v2"));
  assert.ok(CONTROLLED_BEST_SIX_VERSION.includes("same-team-opp-v2"));
});

test("single scorer → no arbitration change", () => {
  const only = basePick({ player: "Solo Star", projection: 22, line: 18.5 });
  const { candidates, audit } = arbitrateSameTeamOpportunityV2([only]);
  assert.equal(candidates[0].side, "Over");
  assert.equal(audit.clusters.length, 0);
  assert.ok(!candidates[0].sameTeamOpportunityV2);
});

test("two scorers → stronger stays Over, weaker can become Under when evidence supports", () => {
  const mitchell = basePick({
    player: "Kelsey Mitchell",
    projection: 25.5,
    line: 22.5,
    overGap: 3,
    expectedMinutes: 34,
    expectedFGA: 18,
    confidence: 72,
    wnbaReader: {
      overGap: 3,
      underGap: -3,
      overCase: { score: 22 },
      underCase: { score: 4 },
      finalSide: "OVER",
    },
    wnbaDataCard: {
      projection: { projection: 25.5, expectedMinutes: 34, expectedFGA: 18, expectedFTA: 5 },
      last5: { points: 26, minutes: 34, fga: 18, fta: 5 },
      season: { points: 24 },
      bookLine: 22.5,
    },
  });
  const hiedeman = basePick({
    player: "Natisha Hiedeman",
    projection: 12.2,
    line: 11.5,
    overGap: 0.7,
    expectedMinutes: 24,
    expectedFGA: 8,
    confidence: 55,
    // Under case already stronger on reader — independent Under path.
    wnbaReader: {
      overGap: 0.7,
      underGap: 2.4,
      overCase: { score: 8 },
      underCase: { score: 16 },
      finalSide: "OVER",
    },
    wnbaDataCard: {
      projection: { projection: 12.2, expectedMinutes: 24, expectedFGA: 8, expectedFTA: 2 },
      last5: { points: 9, minutes: 24, fga: 8, fta: 2 },
      season: { points: 10 },
      bookLine: 11.5,
    },
    playerRoleIdentity: { identity: "MINUTES_DEPENDENT" },
  });

  assert.ok(isMeaningfulScorer(mitchell));
  assert.ok(isMeaningfulScorer(hiedeman));
  const mScore = computeOpportunityStrengthScore(mitchell, { teamTotal: 82 });
  const hScore = computeOpportunityStrengthScore(hiedeman, { teamTotal: 82 });
  assert.ok(
    mScore.opportunityStrengthScore > hScore.opportunityStrengthScore,
    `expected Mitchell stronger (${mScore.opportunityStrengthScore} > ${hScore.opportunityStrengthScore})`
  );

  const { candidates, audit } = arbitrateSameTeamOpportunityV2([mitchell, hiedeman]);
  assert.equal(audit.clusters.length, 1);
  assert.equal(audit.clusters[0].primaryPlayer, "Kelsey Mitchell");

  const m = candidates.find((p) => p.player === "Kelsey Mitchell");
  const h = candidates.find((p) => p.player === "Natisha Hiedeman");
  assert.equal(String(m.side || m.pick).toLowerCase(), "over");
  assert.equal(m.sameTeamOpportunityV2.role, "PRIMARY_OVER");

  // Weaker either flips to qualifying Under or is demoted Over — never equal primary.
  assert.ok(
    h.sameTeamOpportunityV2.role === "SECONDARY_UNDER" ||
      h.sameTeamOpportunityV2.role === "SECONDARY_DEMOTED"
  );
  if (h.sameTeamOpportunityV2.role === "SECONDARY_UNDER") {
    assert.equal(String(h.side || h.pick).toLowerCase(), "under");
    assert.equal(audit.secondaryFlippedUnder, 1);
  } else {
    assert.equal(h.sameTeamOpportunityV2Demoted, true);
    assert.ok(numScore(m) > numScore(h));
  }
});

function numScore(p) {
  return Number(p.bestPropScore || p.pickScore || 0);
}

test("three scorers → strongest Over; others independently Under-eval or demote", () => {
  const a = basePick({
    player: "Star A",
    projection: 24,
    line: 20.5,
    expectedMinutes: 33,
    expectedFGA: 17,
    confidence: 70,
  });
  const b = basePick({
    player: "Star B",
    projection: 16,
    line: 14.5,
    expectedMinutes: 28,
    expectedFGA: 12,
    confidence: 60,
    playerRoleIdentity: { identity: "EFFICIENCY_SCORER" },
  });
  const c = basePick({
    player: "Star C",
    projection: 11.5,
    line: 10.5,
    expectedMinutes: 22,
    expectedFGA: 7,
    confidence: 52,
    playerRoleIdentity: { identity: "EMERGING_ROLE" },
  });

  const { candidates, audit } = arbitrateSameTeamOpportunityV2([a, b, c]);
  assert.equal(audit.clusters.length, 1);
  assert.equal(audit.clusters[0].primaryPlayer, "Star A");
  assert.equal(audit.clusters[0].secondaries.length, 2);

  const primary = candidates.find((p) => p.player === "Star A");
  assert.equal(primary.sameTeamOpportunityV2.role, "PRIMARY_OVER");
  for (const name of ["Star B", "Star C"]) {
    const row = candidates.find((p) => p.player === name);
    assert.ok(
      ["SECONDARY_UNDER", "SECONDARY_DEMOTED"].includes(row.sameTeamOpportunityV2.role)
    );
  }
});

test("failed Under is not forced — demoted Over loses Top priority", () => {
  const strong = basePick({
    player: "Primary",
    projection: 23,
    line: 19.5,
    expectedMinutes: 34,
    expectedFGA: 16,
    confidence: 74,
  });
  // Over-leaning reader so Under should fail independent qualify after re-eval.
  const weak = basePick({
    player: "Secondary",
    projection: 15.5,
    line: 14.5,
    overGap: 1,
    underGap: 0.2,
    expectedMinutes: 26,
    expectedFGA: 10,
    confidence: 58,
    wnbaReader: {
      overGap: 1,
      underGap: 0.2,
      overCase: { score: 14 },
      underCase: { score: 5 },
      finalSide: "OVER",
    },
    wnbaDataCard: {
      projection: { projection: 15.5, expectedMinutes: 26, expectedFGA: 10, expectedFTA: 2 },
      last5: { points: 16, minutes: 26, fga: 10, fta: 2 },
      season: { points: 15 },
      bookLine: 14.5,
    },
    playerRoleIdentity: { identity: "MINUTES_DEPENDENT" },
  });

  const { candidates } = arbitrateSameTeamOpportunityV2([strong, weak]);
  const secondary = candidates.find((p) => p.player === "Secondary");
  assert.equal(secondary.sameTeamOpportunityV2.role, "SECONDARY_DEMOTED");
  assert.equal(String(secondary.side).toLowerCase(), "over");
  assert.equal(secondary.topPickBlockedBySameTeamOpportunityV2, true);
  assert.equal(underCandidateQualifies(secondary), false);

  const best = selectControlledBestSix(candidates, "WNBA");
  const top = selectTopTwoFromBestSix(best.bestSix, "WNBA");
  assert.ok(!(top.topProps || []).some((p) => p.player === "Secondary"));
  assert.ok(
    (top.audit?.hiddenDueToSameTeamOpportunityV2 || 0) >= 1 ||
      !(best.bestSix || []).some((p) => p.player === "Secondary") ||
      (best.bestSix || []).every(
        (p) => p.player !== "Secondary" || p.sameTeamOpportunityV2Demoted === true
      )
  );
});

test("bench role below minutes floor is not a meaningful conflict peer", () => {
  const starter = basePick({
    player: "Starter",
    projection: 20,
    line: 17.5,
    expectedMinutes: 32,
  });
  const bench = basePick({
    player: "Bench",
    projection: 9.5,
    line: 8.5,
    expectedMinutes: 12,
    playerRoleIdentity: { identity: "BENCH_MICROWAVE" },
    wnbaDataCard: {
      projection: { projection: 9.5, expectedMinutes: 12, expectedFGA: 5, expectedFTA: 1 },
      last5: { points: 8, minutes: 12, fga: 5, fta: 1 },
      season: { points: 7 },
      bookLine: 8.5,
    },
  });
  assert.equal(isMeaningfulScorer(bench), false);
  const { audit } = arbitrateSameTeamOpportunityV2([starter, bench]);
  assert.equal(audit.clusters.length, 0);
});

console.log("\nAll Same-Team Opportunity V2 acceptance tests passed.");
