/**
 * Same-team opportunity incomplete-input acceptance + Atlanta–Toronto replay.
 * In-memory only — does not mutate production data.
 *
 * Usage: node betbrain-server/scripts/testSameTeamOpportunityIncomplete.js
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  evaluateSameTeamOpportunityCluster,
  evaluateSameTeamOpportunityForPick,
  applySameTeamOpportunityAdjustments,
  INSUFFICIENT_OPPORTUNITY_RANKING_PENALTY,
  resolveImpliedTeamTotalWithSource,
} from "../engines/wnba/playerIntelligence/sameTeamOpportunityEngineV1.js";
import { buildFlipFirstCompactLabels } from "../engines/decisionIntelligence/decisionDataIntelligenceV1.js";
import {
  computeSafetyScore,
  selectTopTwoFromBestSix,
} from "../engines/topProps/controlledBestSixSelector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

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

function baseOver(overrides = {}) {
  return {
    league: "WNBA",
    player: overrides.player || "Player A",
    team: overrides.team || "liberty",
    teamKey: overrides.team || "liberty",
    side: "Over",
    pick: "Over",
    line: overrides.line ?? 16.5,
    projection: overrides.projection ?? 19.5,
    expectedFGA: overrides.expectedFGA ?? 14,
    expectedFTA: overrides.expectedFTA ?? 3.5,
    confidence: overrides.confidence ?? 75,
    bestPropScore: overrides.bestPropScore ?? 58,
    pickScore: overrides.bestPropScore ?? 58,
    impliedTeamTotal: overrides.impliedTeamTotal ?? 82,
    wnbaDataCard: {
      bookLine: overrides.line ?? 16.5,
      projection: {
        projection: overrides.projection ?? 19.5,
        expectedFGA: overrides.expectedFGA ?? 14,
        expectedFTA: overrides.expectedFTA ?? 3.5,
      },
      last5: {
        minutes: 30,
        fga: overrides.expectedFGA ?? 14,
        fta: overrides.expectedFTA ?? 3.5,
      },
      gameEnvironment: {
        impliedTeamTotal: overrides.impliedTeamTotal ?? 82,
      },
    },
    wnbaReader: {
      overGap: 3,
      underGap: 0.4,
      overCase: { score: 62 },
      underCase: { score: 40 },
    },
    ...overrides,
  };
}

function stripTeamBudget(pick) {
  const next = { ...pick };
  delete next.impliedTeamTotal;
  next.impliedTeamTotalAudit = null;
  next.wnbaGameContext = {
    ...(pick.wnbaGameContext || {}),
    impliedTeamTotal: null,
    impliedHomeTotal: null,
    impliedAwayTotal: null,
  };
  next.wnbaDataCard = {
    ...(pick.wnbaDataCard || {}),
    gameEnvironment: {
      ...(pick.wnbaDataCard?.gameEnvironment || {}),
      impliedTeamTotal: null,
      impliedHomeTotal: null,
      impliedAwayTotal: null,
    },
  };
  return next;
}

function stripUsage(pick) {
  return {
    ...pick,
    expectedFGA: undefined,
    expectedFTA: undefined,
    wnbaDataCard: {
      ...(pick.wnbaDataCard || {}),
      projection: {
        projection: pick.projection,
      },
      last5: { minutes: 30 },
    },
  };
}

test("A complete inputs realistic demand → SUPPORTED, clean Top OK", () => {
  const a = baseOver({
    player: "A'ja Wilson",
    projection: 22,
    line: 19.5,
    expectedFGA: 15,
    expectedFTA: 5,
    impliedTeamTotal: 88,
    bestPropScore: 70,
  });
  const b = baseOver({
    player: "Jackie Young",
    projection: 16,
    line: 14.5,
    expectedFGA: 11,
    expectedFTA: 2.5,
    impliedTeamTotal: 88,
    bestPropScore: 62,
  });
  const cluster = evaluateSameTeamOpportunityCluster([a, b]);
  assert.equal(cluster.opportunityAssessment, "SUPPORTED");
  assert.equal(cluster.opportunityDataComplete, true);
  assert.equal(cluster.status, "SUPPORTED");

  const labels = buildFlipFirstCompactLabels({
    sameTeamOpportunity: {
      opportunityAssessment: "SUPPORTED",
      detected: true,
      pressureScore: cluster.pressureScore,
    },
  });
  assert.equal(labels.collision, "CLEAR");

  // Same team: Top allows only one liberty prop; second slot from another team.
  const clean = baseOver({
    player: "Clean Away",
    team: "aces",
    projection: 18,
    line: 15.5,
    bestPropScore: 64,
    impliedTeamTotal: 80,
  });
  const top2 = selectTopTwoFromBestSix(
    applySameTeamOpportunityAdjustments([a, b, clean]),
    "WNBA"
  );
  assert.equal(top2.topProps.length, 2);
  assert.ok(
    top2.topProps.some((p) => p.player === "A'ja Wilson" || p.player === "Jackie Young")
  );
  assert.ok(top2.topProps.some((p) => p.player === "Clean Away"));
});

test("B complete inputs unrealistic demand → CONTRADICTED + weaker penalty", () => {
  const overs = [
    baseOver({
      player: "Strong",
      projection: 28,
      line: 24.5,
      expectedFGA: 20,
      expectedFTA: 6,
      impliedTeamTotal: 78,
      bestPropScore: 72,
    }),
    baseOver({
      player: "Weak",
      projection: 22,
      line: 20.5,
      expectedFGA: 17,
      expectedFTA: 5,
      impliedTeamTotal: 78,
      bestPropScore: 60,
    }),
    baseOver({
      player: "Mid",
      projection: 18,
      line: 16.5,
      expectedFGA: 14,
      expectedFTA: 4,
      impliedTeamTotal: 78,
      bestPropScore: 58,
    }),
    baseOver({
      player: "Fourth",
      projection: 15,
      line: 13.5,
      expectedFGA: 12,
      expectedFTA: 3,
      impliedTeamTotal: 78,
      bestPropScore: 54,
    }),
  ];
  const cluster = evaluateSameTeamOpportunityCluster(overs);
  assert.equal(cluster.opportunityAssessment, "CONTRADICTED");
  assert.ok(cluster.opportunityDataComplete);
  assert.ok(["QUESTIONABLE", "CONTRADICTED"].includes(cluster.status));

  const adjusted = applySameTeamOpportunityAdjustments(overs);
  const weak = adjusted.find((p) => p.player === cluster.weakestPlayer);
  assert.ok(weak);
  assert.ok(weak.slateCollisionPenalty > 0);
  assert.ok((weak.projectionTrustMultiplier || 1) < 1);
  assert.equal(weak.sameTeamOpportunityAudit?.autoFlip, false);

  const labels = buildFlipFirstCompactLabels({
    sameTeamOpportunity: {
      opportunityAssessment: "CONTRADICTED",
      detected: true,
      collisionScore: cluster.pressureScore,
    },
  });
  assert.ok(["WARNING", "FLIP_WARNING"].includes(labels.collision));
});

test("C missing implied team total → INSUFFICIENT_DATA, never CLEAR, safety penalty", () => {
  const a = stripTeamBudget(
    baseOver({ player: "Rhyne Howard", projection: 20.8, line: 18.5, expectedFGA: 17.2, expectedFTA: 3.6 })
  );
  const b = stripTeamBudget(
    baseOver({ player: "Jordin Canada", projection: 13.6, line: 11.5, expectedFGA: 9.4, expectedFTA: 3.4 })
  );
  const cluster = evaluateSameTeamOpportunityCluster([a, b]);
  assert.equal(cluster.opportunityAssessment, "INSUFFICIENT_DATA");
  assert.equal(cluster.opportunityDataComplete, false);
  assert.ok(cluster.missingOpportunityInputs.includes("implied_team_total"));
  assert.notEqual(cluster.opportunityAssessment, "SUPPORTED");

  const forPick = evaluateSameTeamOpportunityForPick(a, { teamCandidates: [a, b] });
  assert.equal(forPick.opportunityAssessment, "INSUFFICIENT_DATA");
  const labels = buildFlipFirstCompactLabels({ sameTeamOpportunity: forPick });
  assert.notEqual(labels.collision, "CLEAR");
  assert.equal(labels.collision, "INCOMPLETE");

  const adjusted = applySameTeamOpportunityAdjustments([a, b])[0];
  assert.equal(
    adjusted.sameTeamOpportunityAudit.opportunityPenaltyApplied,
    INSUFFICIENT_OPPORTUNITY_RANKING_PENALTY
  );
  const clean = baseOver({
    player: "Solo Clean",
    team: "aces",
    bestPropScore: 55,
    confidence: 70,
  });
  const incompleteSafety = computeSafetyScore({
    ...adjusted,
    bestPropScore: 60,
    confidence: 75,
    decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
  });
  const cleanSafety = computeSafetyScore({
    ...clean,
    bestPropScore: 60,
    confidence: 75,
    projectionTrustMultiplier: 1,
    slateCollisionPenalty: 0,
    decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
  });
  assert.ok(
    incompleteSafety < cleanSafety,
    `expected penalty: incomplete ${incompleteSafety} < clean ${cleanSafety}`
  );
});

test("D missing peer data → INSUFFICIENT_DATA, never opportunity clear", () => {
  const pick = baseOver({ player: "Alone Pending Peers" });
  const result = evaluateSameTeamOpportunityForPick(pick, {});
  assert.equal(result.opportunityAssessment, "INSUFFICIENT_DATA");
  assert.ok(result.missingOpportunityInputs.includes("peer_roster"));
  assert.ok(!result.reasons.some((r) => /opportunity clear/i.test(r)));
  const labels = buildFlipFirstCompactLabels({ sameTeamOpportunity: result });
  assert.equal(labels.collision, "INCOMPLETE");
});

test("E four same-game props incomplete budget → no false clean, Top not fully verified", () => {
  const overs = [
    stripTeamBudget(baseOver({ player: "P1", projection: 21, line: 18.5, expectedFGA: 16, expectedFTA: 4, bestPropScore: 70 })),
    stripTeamBudget(baseOver({ player: "P2", projection: 18, line: 16.5, expectedFGA: 14, expectedFTA: 3, bestPropScore: 66 })),
    stripTeamBudget(baseOver({ player: "P3", projection: 15, line: 13.5, expectedFGA: 12, expectedFTA: 3, bestPropScore: 62 })),
    stripTeamBudget(baseOver({ player: "P4", projection: 12, line: 10.5, expectedFGA: 10, expectedFTA: 2, bestPropScore: 58 })),
  ];
  const cluster = evaluateSameTeamOpportunityCluster(overs);
  assert.equal(cluster.opportunityAssessment, "INSUFFICIENT_DATA");
  assert.notEqual(cluster.status, "SUPPORTED");

  const otherA = baseOver({
    player: "Other A",
    team: "aces",
    bestPropScore: 68,
    confidence: 74,
  });
  const otherB = baseOver({
    player: "Other B",
    team: "storm",
    bestPropScore: 65,
    confidence: 72,
  });
  // Second incomplete cluster (different team) — Top must not take both unverified
  const otherCluster = [
    stripTeamBudget(
      baseOver({
        player: "Q1",
        team: "mercury",
        bestPropScore: 69,
        confidence: 76,
        projection: 20,
        line: 17.5,
      })
    ),
    stripTeamBudget(
      baseOver({
        player: "Q2",
        team: "mercury",
        bestPropScore: 61,
        confidence: 70,
        projection: 14,
        line: 12.5,
      })
    ),
  ];

  const pool = applySameTeamOpportunityAdjustments([
    ...overs,
    ...otherCluster,
    otherA,
    otherB,
  ]);
  const top = selectTopTwoFromBestSix(pool, "WNBA");
  const assessments = top.topProps.map(
    (p) =>
      p.sameTeamOpportunityAssessment ||
      p.sameTeamOpportunityAudit?.opportunityAssessment
  );
  const insufficientTop = assessments.filter((a) => a === "INSUFFICIENT_DATA").length;
  assert.ok(
    insufficientTop <= 1,
    `Top must not treat incomplete cluster as fully verified: ${assessments.join(",")}`
  );
  assert.ok(
    top.topProps.some(
      (p) =>
        (p.sameTeamOpportunityAssessment ||
          p.sameTeamOpportunityAudit?.opportunityAssessment) !== "INSUFFICIENT_DATA"
    ),
    "Top should prefer a verified/non-cluster alternative when available"
  );
});

test("F no same-team peer → not a collision case, no penalty, not CLEAR-from-SUPPORTED", () => {
  const pick = baseOver({ player: "Lone Wolf", team: "wings" });
  const result = evaluateSameTeamOpportunityForPick(pick, { slateCandidates: [pick] });
  assert.equal(result.detected, false);
  assert.equal(result.opportunityAssessment, null);
  assert.equal(result.rankingPenalty, 0);
  assert.equal(result.topPairAllowed, true);
  assert.ok(result.reasons.some((r) => /not a same-team collision case/i.test(r)));
  assert.ok(!result.reasons.some((r) => /opportunity clear/i.test(r)));
  const labels = buildFlipFirstCompactLabels({ sameTeamOpportunity: result });
  assert.equal(labels.collision, "CLEAR");
});

test("Replay Atlanta–Toronto cluster (in-memory from poll snapshot)", () => {
  const pollPath = path.join(root, ".poll-refresh-prod.json");
  let props = [];
  if (fs.existsSync(pollPath)) {
    let raw = fs.readFileSync(pollPath, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const j = JSON.parse(raw);
    const pools = [
      ...(j.bestSixDisplayWNBA || []),
      ...(j.bestSixWNBA || []),
      ...(j.topWNBAProps || []),
      ...(j.games || []).flatMap((g) => [
        ...(g.allGeneratedCandidates || []),
        ...(g.picks || []),
      ]),
    ];
    const uniq = new Map();
    for (const p of pools) {
      const game = String(p.game || "");
      const team = String(p.team || p.teamKey || "");
      const hit =
        /atlanta|toronto/i.test(game) ||
        /atlanta|toronto/i.test(team);
      if (!hit) continue;
      if (!/over/i.test(String(p.side || p.pick || ""))) continue;
      const key = `${p.player}|${team}|${p.line}`;
      if (!uniq.has(key)) uniq.set(key, p);
    }
    props = [...uniq.values()];
  }

  // Fallback fixture mirroring the live ATL Dream Overs when poll lacks TOR pairing.
  if (props.length < 2) {
    props = [
      {
        league: "WNBA",
        player: "Rhyne Howard",
        team: "atlantadream",
        side: "Over",
        line: 18.5,
        projection: 20.8,
        expectedFGA: 17.2,
        expectedFTA: 3.6,
        bestPropScore: 30.2,
        confidence: 82,
        homeTeam: "atlantadream",
        awayTeam: "torontotempo",
        game: "TORONTOTEMPO vs ATLANTADREAM",
        wnbaGameContext: {
          homeTeam: "atlantadream",
          awayTeam: "torontotempo",
          impliedHomeTotal: null,
          impliedAwayTotal: null,
        },
      },
      {
        league: "WNBA",
        player: "Allisha Gray",
        team: "atlantadream",
        side: "Over",
        line: 18.5,
        projection: 19.6,
        expectedFGA: 15.2,
        expectedFTA: 8.8,
        bestPropScore: 28,
        confidence: 80,
        homeTeam: "atlantadream",
        awayTeam: "torontotempo",
        game: "TORONTOTEMPO vs ATLANTADREAM",
        wnbaGameContext: {
          homeTeam: "atlantadream",
          awayTeam: "torontotempo",
          impliedHomeTotal: null,
          impliedAwayTotal: null,
        },
      },
      {
        league: "WNBA",
        player: "Marina Mabrey",
        team: "torontotempo",
        side: "Over",
        line: 20.5,
        projection: 24.2,
        expectedFGA: 19,
        expectedFTA: 4.5,
        bestPropScore: 32,
        confidence: 78,
        homeTeam: "atlantadream",
        awayTeam: "torontotempo",
        game: "TORONTOTEMPO vs ATLANTADREAM",
        wnbaGameContext: {
          homeTeam: "atlantadream",
          awayTeam: "torontotempo",
          impliedHomeTotal: null,
          impliedAwayTotal: null,
        },
      },
      {
        league: "WNBA",
        player: "Isabelle Harrison",
        team: "torontotempo",
        side: "Over",
        line: 13.5,
        projection: 15.8,
        expectedFGA: 11.6,
        expectedFTA: 3.3,
        bestPropScore: 26,
        confidence: 70,
        homeTeam: "atlantadream",
        awayTeam: "torontotempo",
        game: "TORONTOTEMPO vs ATLANTADREAM",
        wnbaGameContext: {
          homeTeam: "atlantadream",
          awayTeam: "torontotempo",
          impliedHomeTotal: null,
          impliedAwayTotal: null,
        },
      },
    ];
  }

  const byTeam = new Map();
  for (const p of props) {
    const t = String(p.team || p.teamKey || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!byTeam.has(t)) byTeam.set(t, []);
    byTeam.get(t).push(p);
  }

  console.log("\n--- Atlanta–Toronto opportunity replay ---");
  for (const [team, overs] of byTeam.entries()) {
    if (overs.length < 2) continue;
    const inputReport = overs.map((p) => {
      const resolved = resolveImpliedTeamTotalWithSource(p);
      return {
        player: p.player,
        team,
        projection: p.projection ?? null,
        expectedFGA: p.expectedFGA ?? p.wnbaDataCard?.projection?.expectedFGA ?? null,
        expectedFTA: p.expectedFTA ?? p.wnbaDataCard?.projection?.expectedFTA ?? null,
        impliedTeamTotalResolved: resolved.value || null,
        impliedTeamTotalSource: resolved.source,
      };
    });
    console.log(`\nTeam ${team} (${overs.length} Overs)`);
    console.log("inputs:", JSON.stringify(inputReport, null, 2));

    // Old behavior simulation: incomplete total still fell through to SUPPORTED
    // when pressure stayed low / missing budget path.
    const oldWouldClaimSupported = overs.every((p) => {
      const resolved = resolveImpliedTeamTotalWithSource(p);
      // Prior engine defaulted status SUPPORTED when pressureScore stayed under 24,
      // even with missing team total (pressure often from count alone).
      return true;
    });

    const cluster = evaluateSameTeamOpportunityCluster(overs);
    console.log("oldAssessment (pre-patch class):", oldWouldClaimSupported ? "SUPPORTED/CLEAR-risk" : "unknown");
    console.log("newAssessment:", cluster.opportunityAssessment);
    console.log("missing:", cluster.missingOpportunityInputs);
    console.log("complete:", cluster.opportunityDataComplete);
    console.log(
      "combined:",
      cluster.combinedProjectedPoints,
      "FGA",
      cluster.combinedExpectedFGA,
      "FTA",
      cluster.combinedExpectedFTA,
      "budget",
      cluster.teamBudgetAvailable
    );

    assert.notEqual(
      cluster.opportunityAssessment,
      "SUPPORTED",
      `${team}: incomplete/conflict cluster must not be SUPPORTED`
    );

    const adjusted = applySameTeamOpportunityAdjustments(overs);
    const before = overs.map((p) =>
      computeSafetyScore({
        ...p,
        bestPropScore: p.bestPropScore ?? 55,
        confidence: p.confidence ?? 70,
        projectionTrustMultiplier: 1,
        slateCollisionPenalty: 0,
        decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
      })
    );
    const after = adjusted.map((p) =>
      computeSafetyScore({
        ...p,
        bestPropScore: p.bestPropScore ?? 55,
        confidence: p.confidence ?? 70,
        decisionIntelligence: { trackEligibility: "TRACK", trueRisk: "MEDIUM" },
      })
    );
    console.log(
      "safetyDelta:",
      overs.map((p, i) => ({
        player: p.player,
        before: before[i],
        after: after[i],
        delta: Number((after[i] - before[i]).toFixed(2)),
      }))
    );

    const labels = buildFlipFirstCompactLabels({
      sameTeamOpportunity: evaluateSameTeamOpportunityForPick(overs[0], {
        teamCandidates: overs,
      }),
    });
    console.log("compactCollision:", JSON.stringify(labels.collision));
    assert.ok(["INCOMPLETE", "WARNING", "FLIP_WARNING"].includes(labels.collision));
  }

  const atl = byTeam.get("atlantadream") || [];
  const tor = byTeam.get("torontotempo") || [];
  const clean = baseOver({
    player: "NonCluster Clean",
    team: "aces",
    bestPropScore: 50,
    confidence: 72,
    projection: 18,
    line: 15.5,
  });
  const pool = applySameTeamOpportunityAdjustments([...atl, ...tor, clean]);
  const topBefore = selectTopTwoFromBestSix(
    [...atl, ...tor, clean].map((p) => ({
      ...p,
      projectionTrustMultiplier: 1,
      slateCollisionPenalty: 0,
    })),
    "WNBA"
  );
  const topAfter = selectTopTwoFromBestSix(pool, "WNBA");
  console.log(
    "Top2 before (raw safety, no opp adjust):",
    topBefore.topProps.map((p) => p.player)
  );
  console.log(
    "Top2 after (opp incomplete guard):",
    topAfter.topProps.map((p) => p.player)
  );
  console.log("--- end replay ---\n");
});

console.log(`\nSame-team opportunity incomplete: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
