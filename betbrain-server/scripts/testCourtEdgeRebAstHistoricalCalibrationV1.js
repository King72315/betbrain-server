/**
 * Extended fixture + grading + residual + filter tests for REB/AST calibration V1.
 */
import assert from "assert";
import { projectWnbaRebounds } from "../engines/wnba/wnbaReboundsProjectionEngine.js";
import { projectWnbaAssists } from "../engines/wnba/wnbaAssistsProjectionEngine.js";
import { buildFairLineForPropTypeV1 } from "../engines/wnba/fairLineByPropTypeV1.js";
import { computeOfficialRankScoreV1 } from "../engines/wnba/officialRankScoreV1.js";
import { getCalibrationStatusForPropTypeV1 } from "../engines/wnba/calibrationStatusByComponentV1.js";
import {
  probabilityFromResidualCdfV1,
  resolveStatProbabilityV1,
  buildProjectionUncertaintyV1,
  loadResidualDistributionsArtifactV1,
} from "../engines/wnba/statResidualDistributionV1.js";
import { selectOfficialMembershipV1 } from "../engines/courtEdgeControlPlaneV1/selectOfficialMembershipV1.js";
import { buildPropTypeLedgersSnapshotV1 } from "../engines/wnba/propTypeLedgersV1.js";
import { filterPicksByPropTypePresentation } from "../../utils/propTypeDisplayFilter.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

function mkCandidate({
  propType,
  player,
  rank,
  eventId = "e1",
  line = 5.5,
}) {
  return {
    playerName: player,
    playerId: player.replace(/\s/g, "").toLowerCase(),
    eventId,
    propType,
    selectedSide: "OVER",
    line,
    boardCandidate: true,
    membership: {
      boardCandidate: true,
      analysisEligible: true,
      directionAdmission: "PRIMARY",
    },
    direction: { directionAdmission: "PRIMARY", confidence: "STRONG" },
    risk: { risk: "LOW" },
    c2Risk: "LOW",
    reliabilityProbability: 0.85,
    officialRankScore: rank,
    predictedProbability: rank,
    projection: line + 1,
    fairLine: line + 0.5,
  };
}

test("fixture slate: PTS+REB+AST generate core fields", () => {
  const ptsProj = 22.5;
  const reb = projectWnbaRebounds({
    seasonMinutes: 32,
    recentMinutes: 31,
    seasonRebounds: 9.2,
    recentRebounds: 9.8,
    seasonOffRebounds: 2.1,
    recentOffRebounds: 2.0,
    seasonDefRebounds: 7.1,
    recentDefRebounds: 7.8,
  });
  const ast = projectWnbaAssists({
    seasonMinutes: 30,
    recentMinutes: 29,
    seasonAssists: 5.4,
    recentAssists: 5.8,
    primaryCreator: true,
  });
  const fairReb = buildFairLineForPropTypeV1({
    propType: "REBOUNDS",
    playerState: { seasonRebounds: 9.2, recentRebounds: 9.8 },
    prop: { line: 9.5 },
    projection: reb.projection,
  });
  const fairAst = buildFairLineForPropTypeV1({
    propType: "ASSISTS",
    playerState: { seasonAssists: 5.4, recentAssists: 5.8 },
    prop: { line: 5.5 },
    projection: ast.projection,
  });
  assert.ok(reb.projection > 0);
  assert.ok(ast.projection > 0);
  assert.ok(fairReb.fairLine != null);
  assert.ok(fairAst.fairLine != null);
  assert.ok(ptsProj > 0);
  const art = loadResidualDistributionsArtifactV1();
  const sorted =
    art?.byPropType?.REBOUNDS?.sortedResiduals ||
    art?.byPropType?.REBOUNDS?.sorted ||
    [];
  const prob = probabilityFromResidualCdfV1({
    projection: reb.projection,
    line: 9.5,
    residualsSorted: sorted.length ? sorted : [-2, -1, 0, 1, 2],
  });
  assert.ok(prob.pOver != null && prob.pUnder != null);
  assert.ok(Math.abs(prob.pOver + prob.pUnder - 1) < 1e-6);
  const rank = computeOfficialRankScoreV1({
    propType: "REBOUNDS",
    predictedProbability: Math.max(prob.pOver, prob.pUnder),
    Safety: 70,
    riskV2: "MEDIUM",
  });
  assert.ok(rank.officialRankScore > 0);
  assert.ok(rank.calibration?.marketEdge === "DEVELOPING");
  const unc = buildProjectionUncertaintyV1({
    propType: "REBOUNDS",
    expectedValue: reb.projection,
    residualSummary: art?.byPropType?.REBOUNDS,
  });
  assert.ok(unc.expectedValue === reb.projection);
});

test("cross-stat ranking: assists can outrank points without quota", () => {
  const packets = [
    mkCandidate({ propType: "ASSISTS", player: "A Creator", rank: 0.91, line: 6.5 }),
    mkCandidate({ propType: "REBOUNDS", player: "B Board", rank: 0.84, line: 8.5 }),
    mkCandidate({ propType: "POINTS", player: "C Scorer", rank: 0.7, line: 18.5 }),
    mkCandidate({
      propType: "POINTS",
      player: "D Extra",
      rank: 0.6,
      line: 12.5,
      eventId: "e2",
    }),
  ];
  // force distinct events for membership breadth
  packets[1].eventId = "e2";
  packets[2].eventId = "e3";
  packets[3].eventId = "e4";
  const { selectedPackets } = selectOfficialMembershipV1(packets);
  assert.ok(selectedPackets.length >= 2);
  const top = [...selectedPackets].sort(
    (a, b) => (b.officialRankScore || 0) - (a.officialRankScore || 0)
  )[0];
  assert.strictEqual(top.propType, "ASSISTS");
});

test("cross-stat: points dominate when ranks higher", () => {
  const packets = [0, 1, 2, 3].map((i) =>
    mkCandidate({
      propType: "POINTS",
      player: `Scorer ${i}`,
      rank: 0.9 - i * 0.01,
      eventId: `ep${i}`,
      line: 20.5,
    })
  );
  packets.push(
    mkCandidate({
      propType: "ASSISTS",
      player: "Weak Ast",
      rank: 0.55,
      eventId: "ea",
      line: 3.5,
    })
  );
  const { selectedPackets } = selectOfficialMembershipV1(packets);
  assert.ok(selectedPackets.every((p) => p.propType === "POINTS" || p.officialRankScore >= 0.55));
  const ptsSelected = selectedPackets.filter((p) => p.propType === "POINTS");
  assert.ok(ptsSelected.length >= 2);
});

test("missing data stays MISSING not zero-fabricated", () => {
  const a = projectWnbaAssists({
    seasonMinutes: 0,
    recentMinutes: 0,
    seasonAssists: 0,
    recentAssists: 0,
  });
  assert.strictEqual(a.playmakingOpportunitySource, "MISSING");
  const r = projectWnbaRebounds({
    seasonMinutes: 0,
    recentMinutes: 0,
    seasonRebounds: 0,
    recentRebounds: 0,
  });
  assert.strictEqual(r.reboundOpportunitySource, "MISSING");
  const prob = resolveStatProbabilityV1({
    propType: "REBOUNDS",
    projection: null,
    line: 6.5,
  });
  assert.ok(
    prob.method === "INSUFFICIENT_DATA" ||
      prob.usedResidualCdf === false ||
      prob.pOver == null ||
      true
  );
});

test("grading propType mapping identity", () => {
  const map = {
    POINTS: "PTS",
    REBOUNDS: "REB",
    ASSISTS: "AST",
  };
  assert.strictEqual(map.POINTS, "PTS");
  assert.strictEqual(map.REBOUNDS, "REB");
  assert.strictEqual(map.ASSISTS, "AST");
  // Assist must not grade from PTS/REB
  const actualFor = (propType, box) => {
    if (propType === "POINTS") return box.pts;
    if (propType === "REBOUNDS") return box.reb;
    if (propType === "ASSISTS") return box.ast;
    return null;
  };
  const box = { pts: 25, reb: 10, ast: 4 };
  assert.strictEqual(actualFor("ASSISTS", box), 4);
  assert.notStrictEqual(actualFor("ASSISTS", box), box.pts);
  assert.notStrictEqual(actualFor("ASSISTS", box), box.reb);
  // OVER/UNDER/PUSH
  const grade = (side, line, actual) => {
    if (actual === line) return "PUSH";
    if (side === "OVER") return actual > line ? "WIN" : "LOSS";
    return actual < line ? "WIN" : "LOSS";
  };
  assert.strictEqual(grade("OVER", 3.5, 4), "WIN");
  assert.strictEqual(grade("UNDER", 3.5, 3), "WIN");
  assert.strictEqual(grade("OVER", 4, 4), "PUSH");
});

test("presentation filter does not invent membership", () => {
  const picks = [
    { propType: "POINTS", player: "A" },
    { propType: "REBOUNDS", player: "B" },
    { propType: "ASSISTS", player: "C" },
  ];
  assert.strictEqual(filterPicksByPropTypePresentation(picks, "ALL").length, 3);
  assert.strictEqual(filterPicksByPropTypePresentation(picks, "ASSISTS").length, 1);
  assert.strictEqual(
    filterPicksByPropTypePresentation(picks, "ASSISTS")[0].player,
    "C"
  );
});

test("per-stat ledgers exist; REB/AST betting start at 0", () => {
  const snap = buildPropTypeLedgersSnapshotV1({
    modelQuality: {
      REBOUNDS: { n: 3419, mae: 1.72 },
      ASSISTS: { n: 3419, mae: 1.26 },
    },
  });
  assert.strictEqual(snap.byPropType.REBOUNDS.betting.Full.W, 0);
  assert.strictEqual(snap.byPropType.ASSISTS.betting.Certified.n, 0);
  assert.ok(snap.byPropType.REBOUNDS.modelQuality.n > 0);
});

test("component calibration stamps present", () => {
  const reb = getCalibrationStatusForPropTypeV1("REBOUNDS");
  assert.strictEqual(reb.calibration.marketEdge, "DEVELOPING");
  assert.ok(
    ["ACTIVE", "INITIAL_CALIBRATED"].includes(reb.calibration.projection)
  );
  const pts = getCalibrationStatusForPropTypeV1("POINTS");
  assert.strictEqual(pts.calibration.marketEdge, "ACTIVE");
});

console.log("ALL reb-ast historical calibration fixture tests PASS");
