/**
 * WNBA defense V2 + evidence V1 unit tests.
 * Usage: node betbrain-server/scripts/testWnbaDefenseEvidenceV1.js
 */
import assert from "assert";
import {
  buildWnbaOpponentDefenseContext,
  clearWnbaOpponentDefenseCache,
  DEFENSE_V2_VERSION,
} from "../services/wnbaOpponentContextService.js";
import {
  buildCourtEdgePlayerEvidenceV1,
  COURTEDGE_PLAYER_EVIDENCE_VERSION,
} from "../services/courtEdgePlayerEvidenceV1.js";
import {
  buildProviderIdentity,
  scoreNameMatch,
  normalizePersonName,
} from "../services/providerIdentityLayer.js";
import { buildDefenseContextAudit } from "../engines/wnba/wnbaGraduatedDataModeV1.js";
import { PROVIDER_FALLBACK_POLICY } from "../services/providerFallbackPolicy.js";
import { buildCanonicalSealedProp } from "../services/canonicalSealedProp.js";

function testDefenseUnavailableNoFake50() {
  clearWnbaOpponentDefenseCache();
  // Empty opponent → unavailable, never 50
  return buildWnbaOpponentDefenseContext({
    opponentTeam: "",
    league: "WNBA",
  }).then((result) => {
    assert.strictEqual(result.defenseScore, null);
    assert.strictEqual(result.status, "UNAVAILABLE");
    assert.strictEqual(result.defenseAudit.resolvedDefenseScore, null);
    assert.notStrictEqual(result.defenseScore, 50);
    console.log("✓ missing defense is UNAVAILABLE null, not fake 50");
  });
}

function testDefenseAuditDistinguishesNeutral() {
  const missing = buildDefenseContextAudit(
    {
      defenseScore: null,
      status: "UNAVAILABLE",
      source: "unavailable",
      reasons: ["no games"],
    },
    {}
  );
  assert.strictEqual(missing.resolvedDefenseScore, null);
  assert.strictEqual(missing.status, "UNAVAILABLE");

  const calculated = buildDefenseContextAudit(
    {
      defenseScore: 50,
      status: "CALCULATED_NEUTRAL",
      source: "wnba_games_proxy_v2",
      opponentPPG: 82,
      proxyUsed: true,
      available: true,
    },
    {}
  );
  assert.strictEqual(calculated.resolvedDefenseScore, 50);
  assert.strictEqual(calculated.status, "CALCULATED_NEUTRAL");
  assert.strictEqual(calculated.unavailableReason, null);
  console.log("✓ calculated neutral distinguished from missing");
}

function testEvidenceCoverageNotFake100() {
  const evidence = buildCourtEdgePlayerEvidenceV1({
    playerName: "Test Player",
    team: "Seattle Storm",
    opponent: "Las Vegas Aces",
    league: "WNBA",
    last5: [{ points: 18 }, { points: 14 }, { points: 16 }],
    seasonAverage: 15.2,
    matchupGames: [],
    defenseResult: {
      defenseScore: null,
      status: "UNAVAILABLE",
      available: false,
      source: "unavailable",
    },
    prop: { line: 15.5, bookCount: 4 },
    opportunity: { recentMinutes: 28, recentFGA: 12, recentFTA: 3 },
    availabilityGate: { availabilitySourceStatus: "OK", statusLevel: "ACTIVE" },
    wnbaGameContext: { spread: -3.5, total: 162, impliedTeamTotal: 84.25 },
    projection: 16.1,
  });

  assert.strictEqual(evidence.schemaVersion, COURTEDGE_PLAYER_EVIDENCE_VERSION);
  assert.strictEqual(evidence.matchup.unavailableBecauseNoMeetings, true);
  assert.strictEqual(evidence.matchup.matchupAverage, null);
  assert.strictEqual(evidence.opponentContext.defenseScore, null);
  assert.strictEqual(evidence.opponentContext.defenseStatus, "UNAVAILABLE");
  assert.strictEqual(evidence.dataQuality.fakeCompleteCoverage, false);
  assert.ok(evidence.dataQuality.coveragePct < 100);
  assert.ok(evidence.dataQuality.coverageGroups.matchup === false);
  assert.ok(evidence.dataQuality.coverageGroups.opponentDefense === false);
  console.log("✓ evidence coverage honest; zero-match H2H has no fake average");
}

function testEvidenceWithDefenseAndPace() {
  const evidence = buildCourtEdgePlayerEvidenceV1({
    playerName: "Breanna Stewart",
    team: "New York Liberty",
    opponent: "Connecticut Sun",
    league: "WNBA",
    last5: [{ points: 22 }, { points: 19 }, { points: 24 }, { points: 18 }, { points: 21 }],
    seasonAverage: 20.4,
    matchupGames: [
      { points: 25, minutes: 34, fga: 18, fta: 6, date: "2026-06-01" },
      { points: 17, minutes: 31, fga: 14, fta: 4, date: "2026-05-20" },
    ],
    defenseResult: {
      defenseScore: 58,
      status: "CALCULATED",
      available: true,
      source: "wnba_games_proxy_v2",
      opponentPPG: 85.2,
      last5PointsAllowed: 86.0,
      last10PointsAllowed: 84.5,
      paceProxy: 164.2,
      sampleGames: 8,
      confidenceEligible: true,
      quality: { quality: "USABLE", provider: "balldontlie" },
    },
    prop: { line: 19.5, bookCount: 5 },
    opportunity: { recentMinutes: 33, recentFGA: 16, recentFTA: 5 },
    availabilityGate: { availabilitySourceStatus: "OK", statusLevel: "ACTIVE" },
    wnbaGameContext: { spread: -4, total: 168, impliedTeamTotal: 88 },
    projection: 21.2,
  });

  assert.strictEqual(evidence.opponentContext.defenseScore, 58);
  // Scoring totals proxy is never true pace — honest label (not GAME_TOTAL_PROXY rename).
  assert.strictEqual(evidence.opponentContext.paceLabel, "SCORING_ENVIRONMENT_PROXY");
  assert.strictEqual(evidence.opponentContext.paceProxy, 164.2);
  assert.ok(evidence.dataQuality.coverageGroups.opponentDefense);
  assert.strictEqual(evidence.roleAndVolume.fga, 16);
  assert.strictEqual(evidence.roleAndVolume.fta, 5);
  console.log("✓ defense+pace proxy and role volume survive into evidence");
}

function testIdentityRefusesWeakFuzzy() {
  const weak = scoreNameMatch("A. Smith", "Angela Smithsonian");
  assert.strictEqual(weak.allowAttach, false);

  const exact = scoreNameMatch("Breanna Stewart", "Breanna Stewart");
  assert.strictEqual(exact.allowAttach, true);

  const id = buildProviderIdentity({
    playerName: "Breanna Stewart",
    team: "New York Liberty",
    opponent: "Connecticut Sun",
    bdlPlayerId: 12345,
  });
  assert.ok(id.canonicalPlayerId.includes("bdl:"));
  assert.strictEqual(id.attachAllowed, true);
  assert.strictEqual(normalizePersonName("José Jr."), "jose");
  console.log("✓ identity layer refuses weak fuzzy; IDs preferred");
}

function testCanonicalPreservesEvidence() {
  const evidence = buildCourtEdgePlayerEvidenceV1({
    playerName: "Sabrina Ionescu",
    league: "WNBA",
    last5: [{ points: 14 }],
    defenseResult: { defenseScore: null, status: "UNAVAILABLE", available: false },
    prop: { line: 15.5, bookCount: 3 },
  });
  const canonical = buildCanonicalSealedProp({
    player: "Sabrina Ionescu",
    side: "Over",
    line: 15.5,
    slateDate: "2026-07-18",
    courtEdgePlayerEvidence: evidence,
    courtEdgePlayerEvidenceVersion: evidence.schemaVersion,
    providerIdentity: { bdlPlayerId: 99 },
  });
  assert.ok(canonical.courtEdgePlayerEvidence);
  assert.strictEqual(
    canonical.courtEdgePlayerEvidence.schemaVersion,
    COURTEDGE_PLAYER_EVIDENCE_VERSION
  );
  console.log("✓ canonical sealed prop preserves evidence snapshot");
}

function testSportsDataWnbaDisabled() {
  assert.strictEqual(
    PROVIDER_FALLBACK_POLICY.sportsDataWnbaGeneration.enabled,
    false
  );
  assert.strictEqual(PROVIDER_FALLBACK_POLICY.bdlTeamSeasonAverages.enabled, false);
  assert.ok(DEFENSE_V2_VERSION.includes("defense-v2"));
  console.log("✓ SportsData WNBA + BDL team_season_averages remain disabled");
}

async function main() {
  await testDefenseUnavailableNoFake50();
  testDefenseAuditDistinguishesNeutral();
  testEvidenceCoverageNotFake100();
  testEvidenceWithDefenseAndPace();
  testIdentityRefusesWeakFuzzy();
  testCanonicalPreservesEvidence();
  testSportsDataWnbaDisabled();
  console.log("\nAll defense/evidence V1 tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
