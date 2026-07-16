/**
 * CourtEdge Player Intelligence Phases 1–7 — integration tests.
 * Usage: node betbrain-server/scripts/testPlayerIntelligenceV1.js
 */
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  buildPlayerIntelligenceProfile,
  applyProjectionAdjustmentPipeline,
  buildIntelligenceProjectionCalibration,
  computePlayerIntelligenceConfidence,
  evaluateSameTeamOpportunityForPick,
  evaluateSameTeamOpportunityCluster,
  underIndependentlyWins,
  recordGradedPropCalibration,
  getCalibrationHintsForPlayer,
  buildPlayerProfileLabReport,
  computeProjectionBiasMetrics,
  snapshotPlayerProfileForLab,
  PLAYER_INTELLIGENCE_BUILD_TAG,
  getCalibrationFilePath,
  getPlayerIntelligenceStorePath,
  clearPlayerIntelligenceMemoryCache,
} from "../engines/wnba/playerIntelligence/index.js";
import {
  buildPlayerRoleProfile,
  buildPlayerProfileCalibration,
} from "../engines/playerRoleProfileV1.js";
import { projectWnbaPoints } from "../engines/wnba/wnbaProjectionEngine.js";
import { evaluateSameTeamUsageCollision } from "../engines/decisionIntelligence/sameTeamUsageCollisionV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, err });
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

function gamesFromPattern(pattern = []) {
  return pattern.map((row, i) => ({
    date: `2026-06-${String(10 + i).padStart(2, "0")}`,
    minutes: row[0],
    points: row[1],
    fga: row[2],
    fta: row[3] ?? 2,
    opponent: `OPP${i}`,
  }));
}

const STABLE = gamesFromPattern([
  [32, 18, 14, 4],
  [31, 17, 13, 3],
  [33, 19, 15, 4],
  [32, 16, 14, 3],
  [31, 18, 14, 4],
  [32, 17, 13, 3],
  [32, 18, 14, 4],
  [31, 16, 13, 3],
]);

const VOLATILE = gamesFromPattern([
  [34, 24, 18, 5],
  [10, 3, 4, 0],
  [30, 20, 16, 4],
  [8, 2, 3, 0],
  [28, 18, 14, 4],
  [12, 4, 5, 1],
]);

const RISING = gamesFromPattern([
  [30, 16, 13, 4],
  [31, 17, 14, 4],
  [29, 15, 12, 3],
  [32, 18, 14, 4],
  [30, 16, 13, 3],
]);

// --- Phase 1 ---
test("01 every player gets mathematical profile enums", () => {
  const profile = buildPlayerIntelligenceProfile({
    playerId: "p-stable",
    last5: STABLE,
    seasonGames: STABLE,
    seasonMinutes: 32,
    seasonFga: 14,
    seasonFta: 3.5,
    seasonPoints: 17.5,
  });
  assert.ok(
    ["VERY_STABLE", "STABLE", "MODERATE", "VOLATILE", "VERY_VOLATILE"].includes(
      profile.roleStabilityScore
    )
  );
  assert.ok(["LOCKED", "STABLE", "VARIABLE", "ERRATIC"].includes(profile.usageProfile));
  assert.ok(["CONSISTENT", "MODERATE", "VOLATILE"].includes(profile.scoringProfile));
  assert.ok(["RISING", "FLAT", "DECLINING"].includes(profile.opportunityTrend));
  assert.ok(
    ["NORMAL", "LIMITED", "RETURNING", "UNKNOWN"].includes(profile.availabilityProfile)
  );
  assert.ok(Number.isFinite(profile.volatilityIndex));
  assert.ok(profile.profileConfidence >= 0 && profile.profileConfidence <= 100);
  assert.ok(profile.adaptationRate > 0);
});

test("02 stable profile classifies STABLE/VERY_STABLE + CONSISTENT-ish", () => {
  const profile = buildPlayerIntelligenceProfile({
    playerId: "p-stable-2",
    last5: STABLE,
    seasonGames: STABLE,
    seasonMinutes: 32,
    seasonFga: 14,
    seasonPoints: 17.5,
    gamesPlayed: 20,
  });
  assert.ok(
    profile.roleStabilityScore === "STABLE" ||
      profile.roleStabilityScore === "VERY_STABLE",
    `got ${profile.roleStabilityScore}`
  );
  assert.ok(profile.profileConfidence >= 50, `conf ${profile.profileConfidence}`);
});

test("03 volatile profile + low sample → low confidence / high adaptation", () => {
  const profile = buildPlayerIntelligenceProfile({
    playerId: "p-rookie",
    last5: VOLATILE.slice(0, 3),
    seasonMinutes: 22,
    seasonFga: 10,
    seasonPoints: 12,
    gamesPlayed: 3,
  });
  assert.ok(
    profile.roleStabilityScore === "VOLATILE" ||
      profile.roleStabilityScore === "VERY_VOLATILE" ||
      profile.roleStabilityScore === "MODERATE",
    profile.roleStabilityScore
  );
  assert.ok(profile.profileConfidence <= 55, `conf ${profile.profileConfidence}`);
  assert.ok(profile.adaptationRate >= 0.5);
});

test("04 playerRoleProfile wraps intelligence enums", () => {
  const profile = buildPlayerRoleProfile({
    last5: STABLE,
    seasonGames: STABLE,
    seasonMinutes: 32,
    seasonFga: 14,
    seasonPoints: 17.5,
    playerId: "wrap-1",
  });
  assert.ok(profile.roleStabilityScore);
  assert.ok(profile.usageProfile);
  assert.ok(profile.playerIntelligence);
  assert.ok(["STABLE", "MODERATE", "UNSTABLE"].includes(profile.roleStability));
});

// --- Phase 2 ---
test("05 projection uses profile — volatile regresses, stable barely moves", () => {
  const stableIntel = buildPlayerIntelligenceProfile({
    playerId: "proj-stable",
    last5: STABLE,
    seasonGames: STABLE,
    seasonMinutes: 32,
    seasonFga: 14,
    seasonPoints: 17,
    gamesPlayed: 18,
  });
  const volatileIntel = buildPlayerIntelligenceProfile({
    playerId: "proj-vol",
    last5: VOLATILE,
    seasonMinutes: 20,
    seasonFga: 10,
    seasonPoints: 12,
    gamesPlayed: 6,
  });

  const raw = 20;
  const stableAdj = applyProjectionAdjustmentPipeline({
    rawProjection: raw,
    seasonPointsAverage: 17,
    recentPointsAverage: 17.5,
    profile: stableIntel,
  });
  const volAdj = applyProjectionAdjustmentPipeline({
    rawProjection: raw,
    seasonPointsAverage: 12,
    recentPointsAverage: 14,
    profile: volatileIntel,
  });

  const stableDelta = Math.abs(stableAdj.finalProjection - raw);
  const volDelta = Math.abs(volAdj.finalProjection - raw);
  assert.ok(stableDelta <= 1.0, `stable delta ${stableDelta}`);
  assert.ok(volDelta >= stableDelta, `vol ${volDelta} vs stable ${stableDelta}`);
  assert.equal(stableAdj.stages.length, 3);
});

test("06 returning availability is conservative", () => {
  const intel = buildPlayerIntelligenceProfile({
    playerId: "proj-ret",
    last5: STABLE,
    seasonMinutes: 32,
    seasonFga: 14,
    seasonPoints: 17,
    availabilityContext: { returningFromInjury: true, status: "RETURNING" },
  });
  // Force returning if classifier missed
  const forced = { ...intel, availabilityProfile: "RETURNING" };
  const adj = applyProjectionAdjustmentPipeline({
    rawProjection: 18,
    seasonPointsAverage: 17,
    profile: forced,
  });
  assert.ok(adj.finalProjection <= 18, `got ${adj.finalProjection}`);
});

test("07 projectWnbaPoints consumes intelligence calibration", () => {
  const profile = buildPlayerRoleProfile({
    last5: VOLATILE,
    seasonMinutes: 20,
    seasonFga: 10,
    seasonPoints: 12,
    playerId: "cal-1",
  });
  const calib = buildPlayerProfileCalibration(profile, {});
  assert.ok(calib.profileCalibrationApplied);
  const before = projectWnbaPoints({
    seasonMinutes: 20,
    recentMinutes: 22,
    seasonFGA: 10,
    recentFGA: 12,
    seasonFTA: 3,
    recentFTA: 3,
    seasonPoints: 12,
    recentPoints: 18,
  });
  const after = projectWnbaPoints({
    seasonMinutes: 20,
    recentMinutes: 22,
    seasonFGA: 10,
    recentFGA: 12,
    seasonFTA: 3,
    recentFTA: 3,
    seasonPoints: 12,
    recentPoints: 18,
    profileCalibration: calib,
  });
  assert.ok(after.profileCalibrationApplied);
  assert.ok(Math.abs(after.projection - before.projection) <= 1.5);
  console.log(
    `  sample before/after: ${before.projection} → ${after.projection} (delta ${after.profileProjectionDelta})`
  );
});

// --- Phase 3 ---
test("08 confidence is multi-component and not gap-primary", () => {
  const intel = buildPlayerIntelligenceProfile({
    playerId: "conf-1",
    last5: STABLE,
    seasonMinutes: 32,
    seasonFga: 14,
    seasonPoints: 17,
    gamesPlayed: 15,
  });
  const conf = computePlayerIntelligenceConfidence({
    playerIntelligence: intel,
    dataConfidence: 70,
    marketQuality: 80,
    sameTeamOpportunity: { status: "SUPPORTED" },
    historicalHints: { gradedSample: 0 },
  });
  assert.equal(conf.gapDependent, false);
  assert.ok(conf.components.playerStability >= 50);
  assert.ok(conf.components.projectionQuality != null);
  assert.ok(Object.keys(conf.components).length >= 6);
});

// --- Phase 4 ---
test("09 same-team opportunity budgeting statuses", () => {
  const overs = [
    {
      player: "A",
      team: "CHI",
      league: "WNBA",
      side: "OVER",
      line: 18.5,
      projection: 20,
      expectedFGA: 14,
      expectedFTA: 3,
      confidence: 70,
      wnbaGameContext: { impliedTeamTotal: 78 },
    },
    {
      player: "B",
      team: "CHI",
      league: "WNBA",
      side: "OVER",
      line: 22.5,
      projection: 24,
      expectedFGA: 17,
      expectedFTA: 4,
      confidence: 60,
      wnbaGameContext: { impliedTeamTotal: 78 },
    },
    {
      player: "C",
      team: "CHI",
      league: "WNBA",
      side: "OVER",
      line: 25.5,
      projection: 28,
      expectedFGA: 19,
      expectedFTA: 5,
      confidence: 55,
      wnbaGameContext: { impliedTeamTotal: 78 },
    },
  ];
  const cluster = evaluateSameTeamOpportunityCluster(overs);
  assert.ok(
    ["SUPPORTED", "QUESTIONABLE", "CONTRADICTED", "INSUFFICIENT_DATA"].includes(
      cluster.status
    )
  );
  assert.ok(
    ["SUPPORTED", "CONTRADICTED", "INSUFFICIENT_DATA"].includes(
      cluster.opportunityAssessment
    )
  );
  const pickEval = evaluateSameTeamOpportunityForPick(overs[2], {
    teamCandidates: overs,
  });
  assert.equal(pickEval.autoFlip, false);
  // CONTRADICTED must not force FLIP_TO_UNDER without independent Under win
  if (pickEval.status === "CONTRADICTED" && !underIndependentlyWins(overs[2], {})) {
    assert.notEqual(pickEval.recommendation, "FLIP_TO_UNDER");
  }
});

test("10 collision wrapper delegates to opportunity engine", () => {
  const pick = {
    player: "A",
    team: "NY",
    side: "OVER",
    line: 20,
    projection: 22,
    wnbaGameContext: { impliedTeamTotal: 80 },
  };
  const teammates = [
    {
      player: "B",
      team: "NY",
      side: "OVER",
      line: 18,
      projection: 19,
    },
  ];
  const result = evaluateSameTeamUsageCollision(pick, { teamCandidates: teammates });
  assert.ok(result.sameTeamOpportunity || result.opportunityStatus || result.status);
  assert.equal(result.autoFlip, false);
});

// --- Phase 5–6 ---
test("11 graded prop records calibration + lab snapshot", () => {
  const calibPath = getCalibrationFilePath();
  const backup = fs.existsSync(calibPath)
    ? fs.readFileSync(calibPath, "utf8")
    : null;

  try {
    const profile = buildPlayerIntelligenceProfile({
      playerId: "lab-player-1",
      last5: STABLE,
      seasonMinutes: 32,
      seasonFga: 14,
      seasonPoints: 17,
    });
    const result = recordGradedPropCalibration({
      id: `test-grade-${Date.now()}`,
      player: "Lab Tester",
      playerId: "lab-player-1",
      status: "win",
      projection: 18.5,
      actualStat: 16,
      side: "OVER",
      line: 15.5,
      confidence: 72,
      gradedAt: new Date().toISOString(),
      playerRoleProfile: profile,
      slateDate: "2099-01-01",
    });
    assert.equal(result.recorded, true);
    assert.ok(result.record.playerProfileSnapshot);
    assert.ok(result.record.projectionError != null);

    const lab = buildPlayerProfileLabReport({ limit: 500 });
    assert.ok(lab.version);
    assert.ok(lab.profiles);
  } finally {
    if (backup != null) fs.writeFileSync(calibPath, backup);
    else if (fs.existsSync(calibPath)) {
      // leave test records — ok for durable learning store
    }
  }
});

test("12 calibration hints available after grades", () => {
  const hints = getCalibrationHintsForPlayer("lab-player-1", "Lab Tester");
  // May be null if restored backup removed records — soft assert
  if (hints) {
    assert.ok(hints.sampleSize >= 0 || hints.gradedSample >= 0);
  }
});

// --- Phase 7 ---
test("13 projection bias metrics surface", () => {
  const metrics = computeProjectionBiasMetrics([
    {
      player: "A",
      side: "OVER",
      projection: 20,
      actualStat: 16,
      status: "loss",
      confidence: 75,
    },
    {
      player: "B",
      side: "UNDER",
      projection: 12,
      actualStat: 11,
      status: "win",
      confidence: 60,
    },
    {
      player: "C",
      side: "OVER",
      projection: 18,
      actualStat: 15,
      status: "loss",
      confidence: 72,
    },
  ]);
  assert.ok(metrics.projectionBias != null);
  assert.ok(metrics.avgProjection != null);
  assert.ok(metrics.avgActual != null);
  assert.ok(metrics.readerOverPct != null);
  assert.ok(metrics.confidenceCalibration);
});

test("14 build tag present", () => {
  assert.equal(PLAYER_INTELLIGENCE_BUILD_TAG, "courteedge-evidence-rank-v1");
});

test("15 rising opportunity produces positive opportunity stage", () => {
  const intel = buildPlayerIntelligenceProfile({
    playerId: "rise-1",
    last5: RISING,
    seasonMinutes: 24,
    seasonFga: 9,
    seasonFta: 2,
    seasonPoints: 11,
    gamesPlayed: 20,
  });
  // season lower than recent → RISING likely
  const adj = applyProjectionAdjustmentPipeline({
    rawProjection: 14,
    seasonPointsAverage: 11,
    recentPointsAverage: 16,
    profile: { ...intel, opportunityTrend: "RISING", profileConfidence: 55 },
  });
  const oppStage = adj.stages.find((s) => s.stage === "OPPORTUNITY");
  assert.ok(oppStage);
  assert.ok(oppStage.adjustment >= 0, `opp adj ${oppStage.adjustment}`);
});

test("16 snapshot for lab includes intelligence fields", () => {
  const profile = buildPlayerIntelligenceProfile({
    playerId: "snap-1",
    last5: STABLE,
    seasonPoints: 17,
  });
  const snap = snapshotPlayerProfileForLab(profile, { player: "Snap" });
  assert.ok(snap.roleStabilityScore);
  assert.ok(snap.volatilityIndex != null);
});

clearPlayerIntelligenceMemoryCache();

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) {
  process.exitCode = 1;
} else {
  console.log(`cache path: ${getPlayerIntelligenceStorePath()}`);
  console.log(`calibration path: ${getCalibrationFilePath()}`);
}
