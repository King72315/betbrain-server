/**
 * Pre-next-slate Best 6 selection integrity acceptance tests (1–10).
 * Usage: node scripts/testBestSixSelectionIntegrityV1.js
 *
 * Keep imports limited to the integrity module + distribution engine to avoid
 * pulling the full selector graph (circular init hazards).
 */
import assert from "node:assert/strict";
import {
  evaluateBestSixSelectionIntegrity,
  simulateBestSixIntegrityOnProps,
  filterCandidatesForBestSixIntegrity,
  applyConflictConfidenceRiskRecalibration,
  collectMaterialConflicts,
  BEST_SIX_SELECTION_INTEGRITY_VERSION,
  UNDER_EDGE_HARD_BLOCK,
  BEST_PROP_SCORE_NORMAL_FLOOR,
} from "../engines/topProps/bestSixSelectionIntegrityV1.js";
import { evaluateCeilingFloorDistribution } from "../engines/courtEdgeExpansion/distributionEngine.js";

let passed = 0;
let failed = 0;
const failures = [];

function test(num, name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${num}: ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ num, name, err });
    console.error(`FAIL ${num}: ${name} — ${err.message}`);
  }
}

function basePick(overrides = {}) {
  return {
    player: overrides.player || "Test",
    team: overrides.team || "teamA",
    opponent: "teamB",
    league: "WNBA",
    line: overrides.line ?? 12.5,
    side: overrides.side || "Under",
    pick: overrides.side || "Under",
    projection: overrides.projection ?? 11.0,
    fairLine: overrides.fairLine ?? null,
    bestPropScore: overrides.bestPropScore ?? 65,
    confidence: overrides.confidence ?? 55,
    naturalDecision: overrides.naturalDecision || "TRACK",
    naturalGateReason: overrides.naturalGateReason || "",
    wnbaTrackingReason: overrides.wnbaTrackingReason || overrides.naturalGateReason || "",
    roleStability: overrides.roleStability || "STABLE",
    sideRescue: overrides.sideRescue || { action: null },
    courtEdgeEngineSignalsV1: {
      engines: {
        roleVelocity: {
          key: "roleVelocity",
          direction: overrides.roleVelocityDir || null,
          helped: overrides.roleVelocityDir ? true : null,
          reason: overrides.roleReason || "",
        },
        defensiveArchetype: {
          key: "defensiveArchetype",
          direction: overrides.defDir || null,
        },
        distributionProfile: {
          key: "distributionProfile",
          direction: overrides.distDir || null,
        },
        projectionSanity: {
          key: "projectionSanity",
          hurt: overrides.sanityHurt === true,
          confidenceAdjustment: overrides.sanityAdj ?? 0,
          reason: overrides.sanityReason || "",
        },
        volatilityProfile: {
          key: "volatilityProfile",
          coefficientOfVariation: overrides.cv ?? 0.25,
          volatilityTier: overrides.volTier || "LOW",
        },
        availabilityRoster: {
          key: "availabilityRoster",
          helped: true,
          reason: "Player active.",
        },
      },
    },
    matchupEngineV2Shadow: overrides.shadow || null,
    sameTeamArbitrationFlip: overrides.forced === true,
    originalModelSide: overrides.originalModelSide || null,
    organicEvidenceStrength: overrides.organicEvidence || "unknown",
    organicUnderEvidence: overrides.organicUnderEvidence || null,
    independentlyQualifiedUnder: overrides.independentlyQualifiedUnder,
    decisionIntelligence: {
      riskRepairs: overrides.repairs || [],
      trueRisk: overrides.trueRisk || "MEDIUM",
      ...(overrides.di || {}),
    },
    displayWhy: overrides.displayWhy || "",
    ...overrides.extra,
  };
}

// --- Test 1 Copper-type ---
test(1, "Copper-type thin Under + score 5.8 + NO_DECISIVE_RESCUE excluded", () => {
  const pick = basePick({
    player: "Kahleah Copper",
    side: "Under",
    line: 18.5,
    projection: 18.3, // edge 0.2
    bestPropScore: 5.8,
    sideRescue: { action: "NO_DECISIVE_RESCUE" },
    repairs: [{ code: "ELITE_NET_EDGE" }, { code: "MULTI_BOOK_COVERAGE" }],
  });
  const r = evaluateBestSixSelectionIntegrity(pick);
  assert.equal(r.eligible, false);
  assert.ok(r.hardExclusions.includes("NO_DECISIVE_RESCUE"));
  assert.ok(r.hardExclusions.includes("BEST_PROP_SCORE_BELOW_50"));
  assert.ok(r.hardExclusions.includes("SUB_FLOOR_UNDER_EDGE"));
  assert.ok(r.secondaryWarnings.includes("REPAIR_LABELS_IGNORED"));
  // Promotion exclusion is covered by annotateResultsAdmission / promoteBestSixCohortPick
  // in the selector path; unit check here is eligibility-only.
});

// --- Test 2 Thomas-type forced Under ---
test(2, "Thomas-type forced Under dropped (unsupported)", () => {
  const pick = basePick({
    player: "Alyssa Thomas",
    side: "Under",
    line: 13.5,
    projection: 16.0, // above under line
    fairLine: 15.5,
    bestPropScore: 0,
    forced: true,
    originalModelSide: "OVER",
    organicEvidence: "weak",
    organicUnderEvidence: "weak",
    independentlyQualifiedUnder: false,
    shadow: { modelSide: "OVER", sampleProtection: { comparableMatchups: 4 } },
    roleVelocityDir: "OVER",
  });
  const r = evaluateBestSixSelectionIntegrity(pick);
  assert.equal(r.eligible, false);
  assert.ok(
    r.hardExclusions.includes("UNSUPPORTED_FORCED_UNDER") ||
      r.hardExclusions.includes("FORCED_UNDER_SHADOW_OVER") ||
      r.hardExclusions.includes("BEST_PROP_SCORE_BELOW_50")
  );
});

// --- Test 3 Burton-type ---
test(3, "Burton-type sub-floor Under + shadow PASS excluded", () => {
  const pick = basePick({
    player: "Veronica Burton",
    side: "Under",
    line: 12.5,
    projection: 9.9, // edge 2.6
    bestPropScore: 62,
    naturalGateReason: "UNDER_GAP_BELOW_WNBA_FULL_DATA_FLOOR",
    shadow: { modelSide: "PASS", sampleProtection: { comparableMatchups: 3 } },
  });
  const r = evaluateBestSixSelectionIntegrity(pick);
  assert.equal(r.eligible, false);
  assert.ok(
    r.hardExclusions.includes("THIN_UNDER_SHADOW_PASS") ||
      r.hardExclusions.includes("THIN_UNDER_LACKS_CORROBORATION") ||
      r.hardExclusions.includes("UNDER_GAP_BELOW_FLOOR")
  );
});

// --- Test 4 Morrow-type ---
test(4, "Morrow-type danger-stack BOARD_ONLY cannot promote", () => {
  const pick = basePick({
    player: "Aneesah Morrow",
    side: "Under",
    line: 12.5,
    projection: 9.2,
    bestPropScore: 54,
    naturalDecision: "BOARD_ONLY",
    naturalGateReason: "DANGER_STACK_INSUFFICIENT_EDGE",
    roleStability: "UNSTABLE",
    cv: 0.91,
    volTier: "HIGH",
    roleVelocityDir: "OVER",
    roleReason: "Minutes profile unstable. Low recent minutes.",
    sanityHurt: true,
    sanityAdj: -3,
    sanityReason: "Projection not supported by usage share. Projection not supported by stable minutes.",
    displayWhy: "Under has Player role profile is UNSTABLE",
  });
  const r = evaluateBestSixSelectionIntegrity(pick);
  assert.equal(r.eligible, false);
  assert.ok(
    r.hardExclusions.some((h) =>
      /BOARD_ONLY_UNSTABLE|UNSTABLE_VOL|DANGER_STACK_BOARD_ONLY|BEST_PROP_SCORE/.test(h)
    ),
    `got ${r.hardExclusions.join(",")}`
  );
});

// --- Test 5 McBride-type ---
test(5, "McBride-type strong Over keeps side but not Low Risk", () => {
  const pick = basePick({
    player: "Kayla McBride",
    side: "Over",
    line: 17.5,
    projection: 21.7,
    bestPropScore: 78,
    confidence: 72,
    trueRisk: "LOW",
    defDir: "UNDER",
    sanityHurt: true,
    sanityAdj: -3,
    sanityReason: "Strong projection gap. Projection not supported by usage share.",
    distDir: "OVER",
    roleVelocityDir: "OVER",
    cv: 0.24,
    volTier: "LOW",
  });
  const r = evaluateBestSixSelectionIntegrity(pick);
  assert.equal(r.eligible, true, r.primaryReason);
  const recal = applyConflictConfidenceRiskRecalibration({
    ...pick,
    materialConflicts: collectMaterialConflicts(pick),
    decisionIntelligence: { trueRisk: "LOW", finalConfidence: 72 },
  });
  assert.notEqual(String(recal.trueRisk || recal.decisionIntelligence.trueRisk).toUpperCase(), "LOW");
  assert.ok(recal.confidence < 72);
});

// --- Test 6 Gray-type ---
test(6, "Gray-type clean organic Over eligible", () => {
  const pick = basePick({
    player: "Chelsea Gray",
    side: "Over",
    line: 12.5,
    projection: 13.8,
    fairLine: 14,
    bestPropScore: 72,
    distDir: "OVER",
    roleVelocityDir: "OVER",
    cv: 0.25,
    volTier: "LOW",
    roleStability: "STABLE",
  });
  const r = evaluateBestSixSelectionIntegrity(pick);
  assert.equal(r.eligible, true, r.primaryReason);
});

// --- Test 7 Thin Under with strong corroboration ---
test(7, "Thin Under with 2+ corroborations may remain eligible (not Low Risk)", () => {
  const pick = basePick({
    player: "Corroborated Under",
    side: "Under",
    line: 15.5,
    projection: 13.0, // edge 2.5
    bestPropScore: 66,
    roleVelocityDir: "UNDER",
    defDir: "UNDER",
    distDir: "UNDER",
    shadow: { modelSide: "UNDER", sampleProtection: { comparableMatchups: 5 } },
    roleStability: "STABLE",
    cv: 0.28,
    volTier: "LOW",
    displayWhy: "Low FGA supports under. Stable low-volume role.",
  });
  const r = evaluateBestSixSelectionIntegrity(pick);
  assert.equal(r.eligible, true, r.primaryReason);
  assert.ok(r.secondaryWarnings.includes("THIN_UNDER_CORROBORATED"));
});

// --- Test 8 Insufficient candidates ---
test(8, "Insufficient valid candidates returns short slate (no force)", () => {
  const pool = [
    basePick({ player: "A", side: "Over", line: 20, projection: 24, bestPropScore: 70, team: "t1" }),
    basePick({ player: "B", side: "Over", line: 18, projection: 22, bestPropScore: 68, team: "t2" }),
    basePick({
      player: "Copper",
      side: "Under",
      line: 18.5,
      projection: 18.3,
      bestPropScore: 5.8,
      sideRescue: { action: "NO_DECISIVE_RESCUE" },
      team: "t3",
    }),
    basePick({
      player: "Morrow",
      side: "Under",
      line: 12.5,
      projection: 9.2,
      bestPropScore: 40,
      naturalDecision: "BOARD_ONLY",
      naturalGateReason: "DANGER_STACK_INSUFFICIENT_EDGE",
      roleStability: "UNSTABLE",
      cv: 0.91,
      volTier: "HIGH",
      roleVelocityDir: "OVER",
      sanityHurt: true,
      team: "t4",
    }),
    basePick({ player: "C", side: "Over", line: 14, projection: 18, bestPropScore: 71, team: "t5" }),
    basePick({ player: "D", side: "Over", line: 11, projection: 15, bestPropScore: 69, team: "t6" }),
  ];
  const filtered = filterCandidatesForBestSixIntegrity(pool, { allowFillCandidates: false });
  assert.ok(filtered.accepted.length <= 6);
  assert.ok(filtered.accepted.length >= 4);
  assert.ok(!filtered.accepted.some((p) => p.player === "Copper"));
  assert.ok(!filtered.accepted.some((p) => p.player === "Morrow"));
  assert.ok(filtered.rejectedCount >= 2);
  // Quality > fill: never promote hard-excluded to reach 6
  assert.ok(filtered.accepted.every((p) => p.bestSixIntegrityEligible !== false));
});

// --- Test 9 Distribution wording ---
test(9, "Distribution wording labels Over and Under hit rates", () => {
  // Scores 21,10,3,1,8 vs Under 12.5 → Over hits (21 only) = 20%, Under = 80%
  const signal = evaluateCeilingFloorDistribution({
    gameLogs: [21, 10, 3, 1, 8].map((points) => ({ points })),
    last10: [21, 10, 3, 1, 8].map((points) => ({ points })),
    line: 12.5,
  });
  assert.ok(/Over hit rate:\s*20(\.0)?%/i.test(signal.reason), signal.reason);
  assert.ok(/Under hit rate:\s*80(\.0)?%/i.test(signal.reason), signal.reason);
  assert.ok(!/Blended hit rate vs line:\s*20/i.test(signal.reason));
});

// --- Test 10 Historical immutability (simulation only) ---
test(10, "Jul 29/30 simulation rejects weak props without mutating sealed data", () => {
  const jul29 = [
    basePick({
      player: "Kahleah Copper",
      side: "Under",
      line: 18.5,
      projection: 18.3,
      bestPropScore: 5.8,
      sideRescue: { action: "NO_DECISIVE_RESCUE" },
    }),
    basePick({
      player: "Alyssa Thomas",
      side: "Under",
      line: 13.5,
      projection: 16,
      fairLine: 15.5,
      bestPropScore: 0,
      forced: true,
      originalModelSide: "OVER",
      organicEvidence: "weak",
      shadow: { modelSide: "OVER", sampleProtection: { comparableMatchups: 4 } },
    }),
    basePick({
      player: "Veronica Burton",
      side: "Under",
      line: 12.5,
      projection: 9.9,
      bestPropScore: 55,
      naturalGateReason: "UNDER_GAP_BELOW_WNBA_FULL_DATA_FLOOR",
      shadow: { modelSide: "PASS", sampleProtection: { comparableMatchups: 2 } },
    }),
  ];
  const jul30 = [
    basePick({
      player: "Kayla McBride",
      side: "Over",
      line: 17.5,
      projection: 21.7,
      bestPropScore: 78,
      defDir: "UNDER",
      sanityHurt: true,
    }),
    basePick({
      player: "Aneesah Morrow",
      side: "Under",
      line: 12.5,
      projection: 9.2,
      bestPropScore: 54,
      naturalDecision: "BOARD_ONLY",
      naturalGateReason: "DANGER_STACK_INSUFFICIENT_EDGE",
      roleStability: "UNSTABLE",
      cv: 0.91,
      volTier: "HIGH",
      roleVelocityDir: "OVER",
      sanityHurt: true,
      displayWhy: "role profile is UNSTABLE",
    }),
    basePick({
      player: "Chelsea Gray",
      side: "Over",
      line: 12.5,
      projection: 13.8,
      bestPropScore: 72,
      distDir: "OVER",
      roleVelocityDir: "OVER",
    }),
  ];

  const s29 = simulateBestSixIntegrityOnProps(jul29);
  const s30 = simulateBestSixIntegrityOnProps(jul30);

  assert.ok(s29.rejected.some((r) => r.player === "Kahleah Copper"));
  assert.ok(s29.rejected.some((r) => r.player === "Alyssa Thomas"));
  assert.ok(s29.rejected.some((r) => r.player === "Veronica Burton"));
  assert.ok(s30.rejected.some((r) => r.player === "Aneesah Morrow"));
  assert.ok(s30.accepted.some((p) => p.player === "Chelsea Gray"));
  assert.ok(s30.accepted.some((p) => p.player === "Kayla McBride"));

  // Sealed membership not mutated — simulation returns new objects only
  assert.equal(jul29[0].excludedFromOfficialBestSix, undefined);
  assert.equal(BEST_SIX_SELECTION_INTEGRITY_VERSION, "best-six-selection-integrity-v1");
  assert.ok(UNDER_EDGE_HARD_BLOCK === 1.5);
  assert.ok(BEST_PROP_SCORE_NORMAL_FLOOR === 60);
});

console.log("\n==============================");
console.log(`Integrity tests: ${passed} passed, ${failed} failed`);
console.log("==============================");
if (failed > 0) {
  for (const f of failures) console.error(`#${f.num} ${f.name}: ${f.err?.stack || f.err}`);
  process.exit(1);
}
