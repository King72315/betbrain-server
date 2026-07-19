/**
 * CourtEdge Engine Expansion V1 — smoke test.
 * Usage: node betbrain-server/scripts/smokeCourtEdgeEngineExpansionV1.js
 *
 * Exercises the consolidated orchestrator (engines/courtEdgeExpansion/orchestratorV1.js)
 * and the service-layer attach/apply helpers (services/courtEdgeEngineSignalsV1.js)
 * end to end. Does not hit any network/API — pure in-memory fixtures.
 */
import assert from "assert";
import {
  buildCourtEdgeEngineSignalsV1,
  ENGINE_EXPANSION_VERSION,
  SCHEMA_BUILD,
} from "../engines/courtEdgeExpansion/orchestratorV1.js";
import {
  attachCourtEdgeEngineSignals,
  applyEngineSignalAdjustments,
  isEngineExpansionEnabled,
} from "../services/courtEdgeEngineSignalsV1.js";

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL: ${name}`);
    console.error(err?.stack || err);
  }
}

function gameLog({ points, minutes, fga, fta, oreb, tov } = {}) {
  return { points, minutes, fga, fta, oreb, tov };
}

// ---------------------------------------------------------------------------
// 1. Forced build with empty ctx — every engine should honestly report
//    unavailable (or the whole bundle disabled), never a fabricated vote.
// ---------------------------------------------------------------------------
check("empty ctx (forced) -> every engine unavailable or disabled, never throws", () => {
  const result = buildCourtEdgeEngineSignalsV1({}, { force: true });
  assert.strictEqual(result.version, ENGINE_EXPANSION_VERSION);
  assert.strictEqual(result.schemaBuild, SCHEMA_BUILD);
  assert.strictEqual(result.enabled, true);

  const engineKeys = Object.keys(result.engines);
  assert.ok(engineKeys.length >= 10, "expected all orchestrator engines present");

  for (const key of engineKeys) {
    const signal = result.engines[key];
    if (signal.storeOnly) continue; // scoringEnvironmentProxy is reference-only
    assert.strictEqual(
      signal.available,
      false,
      `${key} should be unavailable with no context data`
    );
    assert.strictEqual(signal.normalizedSignal, 0, `${key} must cast no vote`);
    assert.strictEqual(signal.overContribution, 0, `${key} overContribution must be 0`);
    assert.strictEqual(signal.underContribution, 0, `${key} underContribution must be 0`);
  }

  assert.strictEqual(result.aggregation.organicSide, "NEUTRAL");

  // Product top-level keys mirror engines bag
  assert.ok(result.generatedAt);
  assert.strictEqual(result.lineMovement, result.engines.lineMovementClv);
  assert.strictEqual(result.projectionSanity, result.engines.projectionSanity);
  assert.strictEqual(result.availabilityRoster, result.engines.availabilityRoster);
  assert.strictEqual(result.distributionProfile, result.engines.distribution);
  assert.strictEqual(result.volatilityProfile, result.engines.volatility);
  assert.strictEqual(result.defensiveArchetype, result.engines.defensiveArchetype);
  assert.strictEqual(result.roleVelocity, result.engines.roleVelocity);
  assert.strictEqual(result.pacePossession, result.engines.pacePossession);
  assert.strictEqual(result.restFatigue, result.engines.restFatigue);
  assert.strictEqual(result.teammateImpact, result.engines.teammateImpact);
});

check("empty ctx without force respects disabled flag", () => {
  const result = buildCourtEdgeEngineSignalsV1({}, { force: false });
  // Either the flag is on (real run) or off (disabled shell) — both are
  // valid outcomes; the important thing is it never throws and is well-formed.
  assert.ok(typeof result.enabled === "boolean");
  if (!result.enabled) {
    assert.deepStrictEqual(result.engines, {});
    assert.strictEqual(result.evidenceDeduplication, null);
    assert.strictEqual(result.aggregation, null);
  }
});

// ---------------------------------------------------------------------------
// 2. Rich WNBA fixture with full game logs — distribution/volatility/role
//    should all be available with real numbers.
// ---------------------------------------------------------------------------
const richGameLogs = [
  gameLog({ points: 22, minutes: 32, fga: 15, fta: 4, oreb: 1, tov: 3 }),
  gameLog({ points: 18, minutes: 30, fga: 13, fta: 3, oreb: 2, tov: 2 }),
  gameLog({ points: 25, minutes: 34, fga: 16, fta: 5, oreb: 1, tov: 4 }),
  gameLog({ points: 15, minutes: 28, fga: 11, fta: 2, oreb: 2, tov: 2 }),
  gameLog({ points: 20, minutes: 31, fga: 14, fta: 4, oreb: 1, tov: 3 }),
  gameLog({ points: 19, minutes: 29, fga: 12, fta: 3, oreb: 2, tov: 3 }),
  gameLog({ points: 23, minutes: 33, fga: 15, fta: 5, oreb: 1, tov: 2 }),
  gameLog({ points: 17, minutes: 27, fga: 12, fta: 2, oreb: 2, tov: 3 }),
  gameLog({ points: 21, minutes: 30, fga: 14, fta: 4, oreb: 1, tov: 2 }),
  gameLog({ points: 16, minutes: 26, fga: 11, fta: 3, oreb: 2, tov: 3 }),
  gameLog({ points: 24, minutes: 32, fga: 16, fta: 4, oreb: 1, tov: 2 }),
  gameLog({ points: 19, minutes: 29, fga: 13, fta: 3, oreb: 2, tov: 3 }),
];

check("rich WNBA fixture -> distribution/volatility/role engines available", () => {
  const result = buildCourtEdgeEngineSignalsV1(
    {
      league: "WNBA",
      gameLogs: richGameLogs,
      seasonAverage: 19.9,
      line: 19.5,
      projection: 20,
    },
    { force: true }
  );

  assert.strictEqual(result.engines.distribution.available, true);
  assert.ok(result.engines.distribution.rawValues.season.sampleSize >= 10);
  assert.strictEqual(result.engines.volatility.available, true);
  assert.strictEqual(result.engines.roleVelocity.available, true);
  assert.strictEqual(result.engines.projectionSanity.available, true);
  // Product top-level + engines bag
  assert.strictEqual(result.distributionProfile.available, true);
  assert.strictEqual(result.volatilityProfile.available, true);
  assert.strictEqual(result.roleVelocity.available, true);
  assert.strictEqual(result.projectionSanity.available, true);
  assert.strictEqual(result.distributionProfile, result.engines.distribution);
  assert.strictEqual(result.volatilityProfile, result.engines.volatility);
  assert.strictEqual(result.projectionSanity, result.engines.projectionSanity);
});

// ---------------------------------------------------------------------------
// 3. True pace with a missing OREB field on every game -> unavailable, never
//    a fabricated pace number.
// ---------------------------------------------------------------------------
check("pace engine with missing OREB -> truePaceAvailable:false", () => {
  const incompleteBoxGames = richGameLogs.map((g) => {
    const { oreb, ...rest } = g;
    return rest; // strip OREB entirely
  });

  const result = buildCourtEdgeEngineSignalsV1(
    {
      league: "WNBA",
      gameLogs: incompleteBoxGames,
    },
    { force: true }
  );

  assert.strictEqual(result.engines.pacePossession.available, false);
  assert.strictEqual(result.pacePossession.available, false);
  assert.strictEqual(result.pacePossession, result.engines.pacePossession);
  assert.strictEqual(result.engines.pacePossession.truePaceAvailable, false);
  assert.strictEqual(result.engines.pacePossession.normalizedSignal, 0);
});

// ---------------------------------------------------------------------------
// 4. Line movement: pick is Over, line fell (opening -> current) -> the
//    movement should be classified as moving AGAINST the Over side.
// ---------------------------------------------------------------------------
check("line movement: Over pick + falling line -> against Over direction", () => {
  const result = buildCourtEdgeEngineSignalsV1(
    {
      league: "WNBA",
      openingLine: 21.5,
      currentLine: 19.5, // fell 2 points
      organicModelSide: "OVER",
      finalSide: "OVER",
      bookCount: 6,
    },
    { force: true }
  );

  const lineMovement = result.engines.lineMovementClv;
  assert.strictEqual(result.lineMovement, lineMovement);
  assert.strictEqual(lineMovement.available, true);
  assert.strictEqual(result.lineMovement.available, true);
  assert.strictEqual(lineMovement.movement, "DOWN");
  assert.strictEqual(lineMovement.marketMovedAgainstFinal, true);
  assert.strictEqual(lineMovement.marketMovedTowardFinal, false);
  assert.ok(
    lineMovement.confidenceAdjustment < 0,
    "market moving against the final side should never raise confidence"
  );
});

// ---------------------------------------------------------------------------
// 5. Full pipeline never throws across a battery of ragged/partial fixtures,
//    and the service-layer attach/apply helpers round-trip cleanly on a pick.
// ---------------------------------------------------------------------------
const raggedFixtures = [
  {},
  { league: "NBA" },
  { league: "WNBA", gameLogs: [gameLog({ points: 10 })] },
  { league: "WNBA", gameLogs: richGameLogs, line: null, projection: undefined },
  { league: "WNBA", teammateStatuses: [{ name: "X", status: "OUT", verified: true }] },
  { league: "WNBA", archetypeComparables: [{ points: 12 }, { points: 14 }] },
  { league: "NBA", openingLine: 10, currentLine: 10 }, // flat line
  { league: "WNBA", providerHealth: { ok: false, status: "ERROR" } },
];

check("does not throw across ragged/partial ctx fixtures", () => {
  for (const ctx of raggedFixtures) {
    const result = buildCourtEdgeEngineSignalsV1(ctx, { force: true });
    assert.ok(result.version);
    assert.ok(result.engines);
    assert.ok(result.generatedAt);
    assert.ok(result.lineMovement);
    assert.ok(result.projectionSanity);
  }
});

check("service layer attach/apply round-trips a pick without mutating input", () => {
  const pick = {
    league: "WNBA",
    side: "Over",
    pick: "Over",
    confidence: 60,
    gameLogs: richGameLogs,
    line: 19.5,
    projection: 20,
    openingLine: 21,
    currentLine: 19.5,
  };
  const pickSnapshotBefore = JSON.stringify(pick);

  const attached = attachCourtEdgeEngineSignals(pick, { force: true });
  assert.strictEqual(JSON.stringify(pick), pickSnapshotBefore, "input pick must not be mutated");
  assert.ok(attached.courtEdgeEngineSignalsV1);
  assert.strictEqual(attached.courtEdgeEngineSignals, attached.courtEdgeEngineSignalsV1);

  const adjusted = applyEngineSignalAdjustments(attached);
  assert.ok(adjusted.courtEdgeEngineSignalsV1);
  assert.strictEqual(adjusted.courtEdgeEngineSignals, adjusted.courtEdgeEngineSignalsV1);
  assert.strictEqual(adjusted.side, "Over", "side must never be changed by engine signals");
  assert.strictEqual(adjusted.pick, "Over", "pick must never be changed by engine signals");
  assert.strictEqual(adjusted.line, 19.5, "line must never be changed by engine signals");
  assert.ok(Number.isFinite(adjusted.confidence));
});

check("isEngineExpansionEnabled reflects CONFIG flag as a boolean", () => {
  assert.ok(typeof isEngineExpansionEnabled() === "boolean");
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exitCode = 1;
}
