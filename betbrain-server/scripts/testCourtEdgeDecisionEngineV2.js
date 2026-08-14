/**
 * Decision Engine V2 acceptance tests.
 */
import assert from "assert";
import {
  selectOfficialMembershipV2,
  trainDecisionEngineV2,
  walkForwardValidateV2,
  autopsyAug12V2,
  scoreCandidateV2,
  DECISION_ENGINE_V2_BUILD,
  isDecisionEngineV2LiveEnabled,
} from "../services/courtEdgeDecisionEngineV2.js";
import { buildDecisionCorpusV2 } from "../services/courtEdgeDecisionCorpusV2.js";
import { selectOfficialMembershipV1 } from "../engines/courtEdgeControlPlaneV1/selectOfficialMembershipV1.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const corpus = buildDecisionCorpusV2({ persist: false });
const engine = trainDecisionEngineV2({ corpus });

test("corpus has graded PTS and residual priors for REB/AST", () => {
  assert.ok(corpus.gradedCount >= 100, `graded=${corpus.gradedCount}`);
  assert.ok(corpus.gradedByPropType.POINTS >= 50);
  assert.ok(corpus.residualPriors.REBOUNDS?.rmse);
  assert.ok(corpus.residualPriors.ASSISTS?.rmse);
});

test("stat models are separate — no cross-stat borrow", () => {
  assert.notStrictEqual(
    engine.statModels.POINTS.residualStd,
    engine.statModels.REBOUNDS.residualStd
  );
  assert.notStrictEqual(
    engine.statModels.REBOUNDS.residualStd,
    engine.statModels.ASSISTS.residualStd
  );
});

function completeTrustedFixture(row) {
  return {
    fairLine: row.fairLine ?? row.projection ?? row.line,
    safetyScore: row.safetyScore ?? 0.7,
    risk: row.risk ?? { risk: "MEDIUM" },
    ...row,
  };
}

test("no minimum board — single strong candidate returns 1", () => {
  const one = selectOfficialMembershipV2(
    [
      completeTrustedFixture({
        playerName: "Strong Player",
        propType: "POINTS",
        selectedSide: "OVER",
        line: 10.5,
        projection: 16.5,
        boardCandidate: true,
        rawWinProbability: 0.72,
        risk: { risk: "HIGH" },
      }),
    ],
    { engine, qualityProbFloor: 0.4 }
  );
  assert.strictEqual(one.officialBoardMin, 0);
  assert.strictEqual(one.highFillCount, 0);
  assert.strictEqual(one.officialCount, 1);
  assert.strictEqual(one.boardSizePolicy, "QUALITY_RANK_NO_MINIMUM");
});

test("never forces fill to 2 with weak second candidate", () => {
  const mem = selectOfficialMembershipV2(
    [
      completeTrustedFixture({
        playerName: "A",
        propType: "POINTS",
        selectedSide: "OVER",
        line: 10.5,
        projection: 17,
        boardCandidate: true,
        rawWinProbability: 0.7,
      }),
      completeTrustedFixture({
        playerName: "B",
        propType: "POINTS",
        selectedSide: "OVER",
        line: 12.5,
        projection: 12.6,
        boardCandidate: true,
        rawWinProbability: 0.51,
      }),
    ],
    { engine, qualityProbFloor: 0.58 }
  );
  assert.ok(mem.officialCount <= 1, `count=${mem.officialCount}`);
  assert.notStrictEqual(mem.highPolicy, "MINIMUM_2_FILL_ONLY");
});

test("labels do not promote membership", () => {
  const mem = selectOfficialMembershipV2(
    [
      completeTrustedFixture({
        playerName: "Weak Premium",
        propType: "POINTS",
        selectedSide: "OVER",
        line: 20.5,
        projection: 20.6,
        boardCandidate: true,
        tier: "PREMIUM",
        membership: { directionAdmission: "PRIMARY" },
        risk: { risk: "LOW" },
        rawWinProbability: 0.51,
      }),
      completeTrustedFixture({
        playerName: "Strong Research",
        propType: "POINTS",
        selectedSide: "OVER",
        line: 8.5,
        projection: 14.5,
        boardCandidate: true,
        tier: "WATCHLIST",
        membership: { directionAdmission: "BEST_GUESS" },
        risk: { risk: "HIGH" },
        rawWinProbability: 0.66,
      }),
    ],
    { engine, qualityProbFloor: 0.5 }
  );
  assert.ok(mem.officialCount >= 1);
  assert.strictEqual(mem.selectedPackets[0].playerName, "Strong Research");
});

test("incomplete odds-only packet cannot become Trusted", () => {
  const mem = selectOfficialMembershipV2(
    [
      {
        playerName: "Odds Only",
        propType: "ASSISTS",
        selectedSide: "OVER",
        line: 3.5,
        projection: null,
        fairLine: null,
        boardCandidate: true,
        rawWinProbability: 0.89,
      },
      completeTrustedFixture({
        playerName: "Complete",
        propType: "POINTS",
        selectedSide: "UNDER",
        line: 8.5,
        projection: 7.2,
        boardCandidate: true,
        rawWinProbability: 0.62,
      }),
    ],
    { engine, qualityProbFloor: 0.4 }
  );
  assert.ok(
    mem.selectedPackets.every((p) => p.playerName !== "Odds Only"),
    "odds-only must not be Official"
  );
});

test("normalized strength differs by residual scale", () => {
  const pts = scoreCandidateV2(
    {
      propType: "POINTS",
      selectedSide: "OVER",
      line: 10,
      projection: 13,
    },
    engine
  );
  const reb = scoreCandidateV2(
    {
      propType: "REBOUNDS",
      selectedSide: "OVER",
      line: 10,
      projection: 13,
    },
    engine
  );
  assert.ok(
    reb.normalizedProjectionStrength > pts.normalizedProjectionStrength,
    `reb=${reb.normalizedProjectionStrength} pts=${pts.normalizedProjectionStrength}`
  );
});

test("walk-forward holdout beats current selector", () => {
  const v = walkForwardValidateV2({ corpus });
  assert.strictEqual(v.ok, true);
  assert.strictEqual(v.pass, true, JSON.stringify(v.boardComparison));
  assert.ok(v.topKHitRates.decisionEngineV2.top6 != null);
});

test("Aug12 autopsy exposes pregame-only analysis", () => {
  const a = autopsyAug12V2({ corpus });
  assert.ok(a.oldOfficialRanking.length >= 2);
  assert.ok(a.v2Ranking.length >= 2);
  assert.ok(a.winnersLeftBehind.length >= 1);
  const collierReb = a.losersSelectedAnalysis.find(
    (x) => x.propType === "REBOUNDS"
  );
  assert.ok(collierReb);
  assert.ok(
    (collierReb.strongerPregameWinnersLeftBehind || []).length >= 1 ||
      collierReb.v2Signals.modelWinProbability < 0.55
  );
});

test("production selector uses V2 when force flag set", () => {
  const mem = selectOfficialMembershipV1(
    [
      {
        playerName: "X",
        propType: "POINTS",
        selectedSide: "OVER",
        line: 9.5,
        projection: 14,
        boardCandidate: true,
        membership: { directionAdmission: "PRIMARY", boardCandidate: true },
        risk: { risk: "HIGH" },
        direction: { directionAdmission: "PRIMARY", confidence: "STANDARD" },
      },
    ],
    { forceDecisionEngineV2: true }
  );
  assert.ok(String(mem.decisionAuthority || "").includes("decision-engine-v2"));
  assert.strictEqual(mem.officialBoardMin, 0);
});

test("live gate readable", () => {
  assert.strictEqual(typeof isDecisionEngineV2LiveEnabled(), "boolean");
  assert.ok(DECISION_ENGINE_V2_BUILD.includes("decision-engine-v2"));
});

if (process.exitCode) {
  console.error("Decision Engine V2 tests FAILED");
  process.exit(1);
}
console.log("Decision Engine V2 tests PASSED");
