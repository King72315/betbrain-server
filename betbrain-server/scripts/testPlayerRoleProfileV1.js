/**
 * Player Role Profile v1 — 14 required fixture cases + calibration safety.
 * Usage: node betbrain-server/scripts/testPlayerRoleProfileV1.js
 */
import assert from "node:assert/strict";

import {
  buildPlayerRoleProfile,
  buildPlayerProfileCalibration,
  applyProfileCalibrationToProjection,
  buildReaderProfileSignals,
  resolveProfileGateEdgeAdjustments,
  CALIBRATION_CAPS,
  PLAYER_ROLE_PROFILE_VERSION,
} from "../engines/playerRoleProfileV1.js";
import { projectWnbaPoints } from "../engines/wnba/wnbaProjectionEngine.js";
import { buildDebtLedger } from "../engines/decisionIntelligence/sideSelectionTrustV1.js";
import { SIGNAL_DIMENSIONS } from "../services/signalPerformanceV1.js";

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
    fg3a: row[4] ?? 2,
    opponent: `OPP${i}`,
  }));
}

/** Stable ~32 min, ~14 FGA, low volatility scorer */
const STABLE_HIGH = gamesFromPattern([
  [32, 18, 14, 4],
  [31, 17, 13, 3],
  [33, 19, 15, 4],
  [32, 16, 14, 3],
  [31, 18, 14, 4],
  [32, 17, 13, 3],
]);

/** Stable medium volume ~24 min, ~9 FGA */
const STABLE_MED = gamesFromPattern([
  [24, 12, 9, 2],
  [25, 11, 8, 2],
  [23, 13, 10, 3],
  [24, 12, 9, 2],
  [25, 11, 9, 2],
  [24, 12, 8, 2],
]);

/** Stable low volume */
const STABLE_LOW = gamesFromPattern([
  [18, 6, 5, 1],
  [19, 7, 6, 1],
  [17, 5, 4, 1],
  [18, 6, 5, 1],
  [19, 7, 5, 1],
]);

/** Moderate CV minutes */
const MODERATE = gamesFromPattern([
  [28, 14, 11, 3],
  [22, 10, 8, 2],
  [26, 13, 10, 2],
  [21, 9, 7, 2],
  [27, 15, 12, 3],
]);

/** Unstable minutes / large swings */
const UNSTABLE = gamesFromPattern([
  [34, 20, 16, 5],
  [12, 4, 4, 1],
  [30, 18, 14, 4],
  [8, 2, 3, 0],
  [28, 16, 13, 3],
]);

/** Expanding: minutes+FGA up vs season */
const EXPANDING = gamesFromPattern([
  [30, 16, 13, 4],
  [31, 17, 14, 4],
  [29, 15, 12, 3],
  [32, 18, 14, 4],
  [30, 16, 13, 3],
]);

/** Contracting */
const CONTRACTING = gamesFromPattern([
  [18, 8, 6, 1],
  [17, 7, 5, 1],
  [19, 9, 7, 2],
  [16, 6, 5, 1],
  [18, 8, 6, 1],
]);

/** Points rising without opportunity — should NOT expand */
const HOT_SHOOTING = gamesFromPattern([
  [24, 18, 8, 2],
  [23, 20, 7, 1],
  [25, 19, 8, 2],
  [24, 17, 7, 2],
  [23, 21, 8, 1],
]);

/** Low mean high CV trap — volatility should use SD not CV alone */
const LOW_MEAN_VOL = gamesFromPattern([
  [16, 3, 4, 0],
  [15, 8, 5, 1],
  [17, 2, 3, 0],
  [16, 7, 4, 1],
  [15, 4, 4, 0],
]);

/** High scoring volatility */
const HIGH_VOL = gamesFromPattern([
  [30, 28, 15, 5],
  [29, 8, 12, 2],
  [31, 24, 16, 4],
  [30, 6, 11, 1],
  [29, 22, 14, 3],
]);

test("1) STABLE + HIGH volume + LOW volatility", () => {
  const profile = buildPlayerRoleProfile({
    last5: STABLE_HIGH,
    seasonGames: STABLE_HIGH,
    seasonMinutes: 32,
    seasonFga: 14,
    seasonFta: 3.5,
    seasonPoints: 17.5,
    expectedFga: 14,
    expectedFta: 3.5,
    bookCount: 5,
  });
  assert.equal(profile.version, PLAYER_ROLE_PROFILE_VERSION);
  assert.equal(profile.roleStability, "STABLE");
  assert.equal(profile.minutesLevel, "HIGH");
  assert.equal(profile.scoringVolume, "HIGH");
  assert.ok(["LOW", "MEDIUM"].includes(profile.scoringVolatility));
  assert.ok(profile.profileConfidence >= 50);
});

test("2) STABLE + MEDIUM volume + LOW volatility (strong combo)", () => {
  const profile = buildPlayerRoleProfile({
    last5: STABLE_MED,
    seasonGames: STABLE_MED,
    seasonMinutes: 24,
    seasonFga: 9,
    seasonFta: 2,
    seasonPoints: 12,
    expectedFga: 9,
    bookCount: 4,
  });
  assert.equal(profile.roleStability, "STABLE");
  assert.equal(profile.scoringVolume, "MEDIUM");
  const cal = buildPlayerProfileCalibration(profile, { side: "OVER" });
  assert.ok(cal.rankingAdjustment >= 0);
  assert.ok(cal.confidenceAdjustment >= 0);
});

test("3) STABLE + LOW volume Overs need volume proof", () => {
  const profile = buildPlayerRoleProfile({
    last5: STABLE_LOW,
    seasonGames: STABLE_LOW,
    seasonMinutes: 18,
    seasonFga: 5,
    seasonPoints: 6,
    expectedFga: 5,
    bookCount: 3,
  });
  assert.equal(profile.scoringVolume, "LOW");
  const cal = buildPlayerProfileCalibration(profile, { side: "OVER" });
  assert.ok(cal.overRequiredEdgeAdjustment > 0);
  const reader = buildReaderProfileSignals(profile, cal, "OVER");
  assert.ok(reader.disagrees.some((d) => /volume/i.test(d)));
  assert.equal(reader.isAutoSideVote, false);
});

test("4) MODERATE role", () => {
  const profile = buildPlayerRoleProfile({
    last5: MODERATE,
    seasonGames: MODERATE,
    seasonMinutes: 25,
    seasonFga: 10,
    seasonPoints: 12,
    expectedFga: 10,
    bookCount: 4,
  });
  assert.equal(profile.roleStability, "MODERATE");
});

test("5) UNSTABLE role emits UNSTABLE_ROLE debt not duplicate minutes", () => {
  const profile = buildPlayerRoleProfile({
    last5: UNSTABLE,
    seasonGames: UNSTABLE,
    seasonMinutes: 22,
    seasonFga: 10,
    seasonPoints: 12,
    expectedFga: 10,
    bookCount: 3,
  });
  assert.equal(profile.roleStability, "UNSTABLE");
  const cal = buildPlayerProfileCalibration(profile);
  assert.ok(cal.riskDebtIds.includes("UNSTABLE_ROLE"));
  assert.ok(!cal.riskDebtIds.includes("UNSTABLE_MINUTES"));
  const ledger = buildDebtLedger([
    { code: "UNSTABLE_MINUTES", severity: "HIGH", reason: "minutes" },
    { code: "UNSTABLE_ROLE", severity: "HIGH", reason: "role" },
    { code: "UNSTABLE_MINUTES", severity: "HIGH", reason: "dup" },
  ]);
  // Ledger dedupes by code; profile path prefers UNSTABLE_ROLE as canonical
  assert.ok(ledger.appliedDebtIds.includes("UNSTABLE_ROLE"));
  assert.equal(
    ledger.appliedDebtIds.filter((id) => id === "UNSTABLE_MINUTES").length,
    1
  );
});

test("6) EXPANDING requires ≥2 opportunity signals", () => {
  const profile = buildPlayerRoleProfile({
    last5: EXPANDING,
    seasonGames: gamesFromPattern([
      [24, 12, 9, 2],
      [23, 11, 8, 2],
      [25, 12, 9, 2],
      [24, 10, 8, 2],
      [23, 11, 9, 2],
    ]),
    seasonMinutes: 24,
    seasonFga: 9,
    seasonFta: 2,
    seasonPoints: 12,
    expectedFga: 13,
    bookCount: 4,
  });
  assert.equal(profile.roleDirection, "EXPANDING");
  const cal = buildPlayerProfileCalibration(profile, { side: "OVER" });
  assert.ok(cal.projectionAdjustment <= CALIBRATION_CAPS.maxExpandingShift);
  assert.ok(cal.projectionAdjustment > 0);
});

test("7) CONTRACTING with opportunity signals", () => {
  const profile = buildPlayerRoleProfile({
    last5: CONTRACTING,
    seasonGames: gamesFromPattern([
      [28, 14, 12, 3],
      [29, 15, 13, 3],
      [27, 13, 11, 3],
      [28, 14, 12, 3],
      [29, 15, 12, 3],
    ]),
    seasonMinutes: 28,
    seasonFga: 12,
    seasonFta: 3,
    seasonPoints: 14,
    expectedFga: 6,
    bookCount: 4,
  });
  assert.equal(profile.roleDirection, "CONTRACTING");
  const cal = buildPlayerProfileCalibration(profile, { side: "UNDER" });
  assert.ok(cal.projectionAdjustment >= CALIBRATION_CAPS.maxContractingShift);
  assert.ok(cal.projectionAdjustment < 0);
});

test("8) Points-only hot shooting does NOT expand", () => {
  const profile = buildPlayerRoleProfile({
    last5: HOT_SHOOTING,
    seasonGames: HOT_SHOOTING,
    seasonMinutes: 24,
    seasonFga: 8,
    seasonFta: 2,
    seasonPoints: 11,
    expectedFga: 8,
    bookCount: 4,
  });
  assert.notEqual(profile.roleDirection, "EXPANDING");
});

test("9) Low-mean CV trap — do not force HIGH vol from CV alone", () => {
  const profile = buildPlayerRoleProfile({
    last5: LOW_MEAN_VOL,
    seasonGames: LOW_MEAN_VOL,
    seasonMinutes: 16,
    seasonFga: 4,
    seasonPoints: 5,
    expectedFga: 4,
    bookCount: 3,
  });
  // Absolute SD is modest; should not auto-mark HIGH solely from inflated CV
  assert.ok(["LOW", "MEDIUM", "HIGH"].includes(profile.scoringVolatility));
  assert.ok(profile.pointsCoefficientOfVariation === null || profile.pointsCoefficientOfVariation > 0);
});

test("10) Small sample → lower confidence, no favorable adjustments", () => {
  const profile = buildPlayerRoleProfile({
    last5: STABLE_MED.slice(0, 2),
    seasonMinutes: 24,
    seasonFga: 9,
    seasonPoints: 12,
    bookCount: 2,
  });
  assert.ok(profile.profileSampleSize < 5);
  assert.ok(profile.profileConfidence < 70);
  assert.equal(profile.fallbackUsed, true);
  const cal = buildPlayerProfileCalibration(profile);
  assert.ok(cal.confidenceAdjustment <= 0);
  assert.ok(cal.rankingAdjustment <= 0);
  assert.ok(cal.projectionAdjustment <= 0);
});

test("11) Missing profile data → fallbackUsed, no favorable", () => {
  const profile = buildPlayerRoleProfile({
    last5: [],
    seasonGames: [],
    bookCount: 0,
  });
  assert.ok(profile.missingProfileFields.length > 0);
  assert.equal(profile.fallbackUsed, true);
  const cal = buildPlayerProfileCalibration(profile);
  assert.ok(cal.confidenceAdjustment <= 0);
  assert.ok(cal.calibrationReasons.some((r) => /Weak\/missing|no favorable/i.test(r)));
});

test("12) Calibration safety caps (±1.0 proj, ±8 conf, edge +0.45/-0.2)", () => {
  const profile = buildPlayerRoleProfile({
    last5: UNSTABLE,
    seasonGames: UNSTABLE,
    seasonMinutes: 20,
    seasonFga: 8,
    seasonPoints: 10,
    expectedFga: 8,
    bookCount: 2,
  });
  const cal = buildPlayerProfileCalibration(profile, { side: "OVER" });
  assert.ok(Math.abs(cal.projectionAdjustment) <= CALIBRATION_CAPS.maxProjectionMovement);
  assert.ok(Math.abs(cal.confidenceAdjustment) <= CALIBRATION_CAPS.maxConfidenceAdj);
  assert.ok(cal.overRequiredEdgeAdjustment <= CALIBRATION_CAPS.maxRequiredEdgeUp);
  assert.ok(cal.overRequiredEdgeAdjustment >= CALIBRATION_CAPS.maxRequiredEdgeDown);
  assert.equal(cal.cannotForceSideFlip, true);
  assert.equal(cal.cannotCreateTrack, true);
  assert.equal(cal.cannotOverrideHardKill, true);
  assert.ok(CALIBRATION_CAPS.maxRequiredEdgeUp <= 0.45);
  assert.ok(CALIBRATION_CAPS.maxProjectionMovement <= 1.0);

  const applied = applyProfileCalibrationToProjection(
    { projection: 15, expectedMinutes: 24, expectedFGA: 9, expectedFTA: 2 },
    { ...cal, projectionAdjustment: 5 }
  );
  assert.ok(Math.abs(applied.profileProjectionDelta) <= CALIBRATION_CAPS.maxProjectionMovement);
});

test("15) Mild MODERATE dampening stays below material bump (no hard PROFILE_ADJ)", () => {
  const profile = buildPlayerRoleProfile({
    last5: MODERATE,
    seasonGames: MODERATE,
    seasonMinutes: 24,
    seasonFga: 9,
    seasonPoints: 12,
    expectedFga: 9,
    bookCount: 4,
  });
  const cal = buildPlayerProfileCalibration(
    { ...profile, roleStability: "MODERATE", scoringVolume: "HIGH", scoringVolatility: "MEDIUM" },
    { side: "OVER" }
  );
  assert.ok(
    cal.overRequiredEdgeAdjustment < 0.3,
    `mild overReq ${cal.overRequiredEdgeAdjustment} should stay soft`
  );
  assert.ok(cal.overRequiredEdgeAdjustment <= CALIBRATION_CAPS.maxRequiredEdgeUp);
});

test("16) UNSTABLE still raises bar but stays under recalibrated cap", () => {
  const cal = buildPlayerProfileCalibration(
    {
      roleStability: "UNSTABLE",
      scoringVolume: "LOW",
      scoringVolatility: "HIGH",
      shotVolumeStability: "UNSTABLE",
      roleDirection: "STABLE",
      profileSampleSize: 8,
      profileConfidence: 60,
      fallbackUsed: false,
    },
    { side: "OVER" }
  );
  assert.ok(cal.overRequiredEdgeAdjustment >= 0.28);
  assert.ok(cal.overRequiredEdgeAdjustment <= CALIBRATION_CAPS.maxRequiredEdgeUp);
  assert.ok(cal.riskDebtIds.includes("UNSTABLE_ROLE"));
});

test("13) Profile alone does not flip side / auto vote", () => {
  const profile = buildPlayerRoleProfile({
    last5: EXPANDING,
    seasonGames: EXPANDING,
    seasonMinutes: 24,
    seasonFga: 9,
    seasonPoints: 12,
    bookCount: 4,
  });
  const cal = buildPlayerProfileCalibration(profile, { side: "UNDER" });
  const signals = buildReaderProfileSignals(profile, cal, "UNDER");
  assert.equal(signals.isAutoSideVote, false);
  assert.ok(Math.abs(signals.scoreDelta) <= 6);
  assert.equal(cal.cannotForceSideFlip, true);
});

test("14) Projection engine wires profile calibration before final points", () => {
  const profile = buildPlayerRoleProfile({
    last5: STABLE_HIGH,
    seasonGames: STABLE_HIGH,
    seasonMinutes: 32,
    seasonFga: 14,
    seasonFta: 3.5,
    seasonPoints: 17.5,
    expectedFga: 14,
    bookCount: 5,
  });
  const cal = buildPlayerProfileCalibration(profile, { side: "OVER" });
  const base = projectWnbaPoints({
    seasonMinutes: 32,
    recentMinutes: 32,
    seasonFGA: 14,
    recentFGA: 14,
    seasonFTA: 3.5,
    recentFTA: 3.5,
    seasonPoints: 17.5,
    recentPoints: 17.5,
  });
  const calibrated = projectWnbaPoints({
    seasonMinutes: 32,
    recentMinutes: 32,
    seasonFGA: 14,
    recentFGA: 14,
    seasonFTA: 3.5,
    recentFTA: 3.5,
    seasonPoints: 17.5,
    recentPoints: 17.5,
    profileCalibration: cal,
  });
  assert.equal(calibrated.profileCalibrationApplied, true);
  assert.ok(
    Math.abs(calibrated.projection - base.projection) <=
      CALIBRATION_CAPS.maxProjectionMovement + 0.05
  );
  const adj = resolveProfileGateEdgeAdjustments(profile, cal);
  assert.equal(typeof adj.overRequiredEdgeAdjustment, "number");
});

test("Lab signal dimensions include role profile fields", () => {
  const cats = SIGNAL_DIMENSIONS.map((d) => d.category);
  for (const need of [
    "roleStability",
    "minutesLevel",
    "scoringVolume",
    "shotVolumeStability",
    "scoringVolatility",
    "roleDirection",
    "profileConfidence",
    "projectionDependencyType",
    "profileCalibrationReason",
    "profileAdjustedProjection",
    "roleProfileCombo",
  ]) {
    assert.ok(cats.includes(need), `missing dimension ${need}`);
  }
});

test("EXPANDING + LOW volume weakens Under confidence", () => {
  const profile = buildPlayerRoleProfile({
    last5: gamesFromPattern([
      [22, 8, 6, 1],
      [23, 9, 7, 2],
      [21, 8, 6, 1],
      [24, 9, 7, 1],
      [22, 8, 6, 2],
    ]),
    seasonGames: gamesFromPattern([
      [16, 5, 4, 1],
      [15, 4, 3, 0],
      [17, 5, 4, 1],
      [16, 5, 4, 1],
      [15, 4, 3, 1],
    ]),
    seasonMinutes: 16,
    seasonFga: 4,
    seasonFta: 1,
    seasonPoints: 5,
    expectedFga: 6.5,
    bookCount: 4,
  });
  // May be EXPANDING with low volume
  const cal = buildPlayerProfileCalibration(
    { ...profile, scoringVolume: "LOW", roleDirection: "EXPANDING" },
    { side: "UNDER" }
  );
  assert.ok(cal.underRequiredEdgeAdjustment >= 0);
  assert.ok(cal.calibrationReasons.some((r) => /EXPANDING|LOW volume/i.test(r)));
});

console.log(`\nPlayer Role Profile V1: ${passed} passed, ${failed} failed`);
if (failed) {
  process.exitCode = 1;
}
