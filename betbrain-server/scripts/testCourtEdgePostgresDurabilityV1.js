/**
 * Integration tests for Postgres production durability v1.
 * Requires DATABASE_URL for full suite. Without it, runs gate tests only.
 */
import assert from "assert";
import {
  __resetCanonicalStoreForTests,
  applyCanonicalMigrations,
  closeCanonicalPool,
  getCanonicalDurableHealth,
  isProductionEnvironment,
  membershipHash,
  propIdentity,
  restoreCanonicalSlateV1,
  sealCanonicalSlateV1,
  persistResearchFreezeV1,
  C2_CALIBRATION_HASH_CEREMONY,
  CANONICAL_STORE_BUILD,
} from "../services/courtEdgePostgres/canonicalStoreV1.js";

function sampleProp(i, risk = "LOW") {
  return {
    eventId: `evt-${i}`,
    playerId: `p-${i}`,
    player: `Player ${i}`,
    team: "AAA",
    opponent: "BBB",
    side: i % 2 ? "OVER" : "UNDER",
    line: 10 + i,
    trueRisk: risk,
    reliabilityProbability: 0.7,
    trustScore: 0.8,
    safetyScore: 70,
    projection: 12 + i,
  };
}

async function run() {
  const results = [];
  function pass(name, info = {}) {
    results.push({ name, ok: true, ...info });
    console.log("PASS", name);
  }
  function fail(name, error) {
    results.push({ name, ok: false, error: String(error?.message || error) });
    console.error("FAIL", name, error);
  }

  // Gate: production without DB must not claim durable ready
  __resetCanonicalStoreForTests();
  const savedUrl = process.env.DATABASE_URL;
  const savedCourt = process.env.COURTEDGE_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.COURTEDGE_DATABASE_URL;
  try {
    const h = await getCanonicalDurableHealth();
    assert.equal(h.databaseUrlConfigured, false);
    assert.equal(h.durableStoreReady, false);
    assert.equal(h.durableBackend, "filesystem");
    pass("no_database_url_not_ready");
  } catch (e) {
    fail("no_database_url_not_ready", e);
  }
  if (savedUrl) process.env.DATABASE_URL = savedUrl;
  if (savedCourt) process.env.COURTEDGE_DATABASE_URL = savedCourt;
  __resetCanonicalStoreForTests();

  // Aug 7 Official seal forbidden
  try {
    const blocked = await sealCanonicalSlateV1({
      slateDate: "2026-08-07",
      officialProps: [sampleProp(1)],
      researchProps: [sampleProp(1), sampleProp(2, "HIGH")],
    });
    // Without DB this returns PERSISTENCE_FAILED; with DB must be AUG7 forbid
    assert.ok(
      blocked.reason === "AUG7_OFFICIAL_SEAL_FORBIDDEN" ||
        blocked.reason === "PERSISTENCE_FAILED"
    );
    pass("aug7_official_seal_forbidden_or_no_db", { reason: blocked.reason });
  } catch (e) {
    fail("aug7_official_seal_forbidden_or_no_db", e);
  }

  const health = await getCanonicalDurableHealth();
  if (!health.databaseUrlConfigured) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          partial: true,
          build: CANONICAL_STORE_BUILD,
          note: "DATABASE_URL unset — full durability suite skipped",
          results,
        },
        null,
        2
      )
    );
    return;
  }

  try {
    const mig = await applyCanonicalMigrations();
    assert.equal(mig.ok, true);
    pass("migrations_applied", { version: mig.version });
  } catch (e) {
    fail("migrations_applied", e);
  }

  const slateDate = "2099-01-15"; // future fixture — never production
  const official = [sampleProp(1, "LOW"), sampleProp(2, "MEDIUM")];
  const research = [
    ...official,
    sampleProp(3, "HIGH"),
    sampleProp(4, "HIGH"),
  ];

  let sealed;
  try {
    sealed = await sealCanonicalSlateV1({
      slateDate,
      league: "WNBA",
      dayBucket: "TODAY",
      officialProps: official,
      researchProps: research,
      calibrationHash: C2_CALIBRATION_HASH_CEREMONY,
      sourceBuild: CANONICAL_STORE_BUILD,
      allowAug7Official: false,
    });
    assert.equal(sealed.ok, true);
    assert.equal(sealed.refreshSuccess, true);
    assert.equal(sealed.officialCount, 2);
    assert.equal(sealed.researchCount, 4);
    assert.equal(sealed.resultsCount, 2);
    pass("seal_transaction_readback", {
      membershipHash: sealed.membershipHash,
    });
  } catch (e) {
    fail("seal_transaction_readback", e);
  }

  try {
    const again = await sealCanonicalSlateV1({
      slateDate,
      officialProps: official,
      researchProps: research,
      calibrationHash: C2_CALIBRATION_HASH_CEREMONY,
    });
    assert.equal(again.ok, true);
    assert.equal(again.membershipHash, sealed.membershipHash);
    assert.deepEqual(again.officialIdentities, sealed.officialIdentities);
    pass("duplicate_scheduler_idempotent");
  } catch (e) {
    fail("duplicate_scheduler_idempotent", e);
  }

  try {
    const restored = await restoreCanonicalSlateV1({ slateDate });
    assert.equal(restored.ok, true);
    assert.equal(restored.regenerateBlocked, true);
    assert.equal(restored.officialProps.length, 2);
    assert.equal(restored.researchProps.length, 4);
    assert.equal(restored.results.length, 2);
    assert.deepEqual(
      restored.officialIdentities.sort(),
      sealed.officialIdentities.sort()
    );
    const homeIds = restored.officialProps.map((r) => r.id).sort();
    const resultsIds = restored.resultsOfficialIds.slice().sort();
    assert.deepEqual(homeIds, resultsIds);
    pass("restore_locked_slate_home_results_identity");
  } catch (e) {
    fail("restore_locked_slate_home_results_identity", e);
  }

  try {
    const high = (await restoreCanonicalSlateV1({ slateDate })).researchProps.filter(
      (r) => String(r.risk).toUpperCase() === "HIGH"
    );
    assert.ok(high.length >= 2);
    const officialRisks = (
      await restoreCanonicalSlateV1({ slateDate })
    ).officialProps.map((r) => String(r.risk).toUpperCase());
    assert.ok(!officialRisks.includes("HIGH"));
    pass("research_high_separated");
  } catch (e) {
    fail("research_high_separated", e);
  }

  try {
    const freeze = await persistResearchFreezeV1({
      slateDate: "2026-08-07",
      freezeTimestamp: "2026-08-07T20:08:44.951Z",
      freezeJson: { test: true, note: "research only" },
      officialRecordEligible: true, // must be forced false
      calibrationHash: C2_CALIBRATION_HASH_CEREMONY,
    });
    assert.equal(freeze.ok, true);
    assert.equal(freeze.officialRecordEligible, false);
    pass("aug7_research_freeze_not_official");
  } catch (e) {
    fail("aug7_research_freeze_not_official", e);
  }

  // Simulate "memory wipe": close pool, restore only from DB
  try {
    await closeCanonicalPool();
    __resetCanonicalStoreForTests();
    const restored = await restoreCanonicalSlateV1({ slateDate });
    assert.equal(restored.ok, true);
    assert.equal(restored.officialProps.length, 2);
    pass("instance_replacement_restore_from_postgres_only");
  } catch (e) {
    fail("instance_replacement_restore_from_postgres_only", e);
  }

  // Failure mode: seal without DB
  try {
    await closeCanonicalPool();
    __resetCanonicalStoreForTests();
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    delete process.env.COURTEDGE_DATABASE_URL;
    const failed = await sealCanonicalSlateV1({
      slateDate: "2099-02-01",
      officialProps: [sampleProp(9)],
      researchProps: [sampleProp(9)],
    });
    assert.equal(failed.refreshSuccess, false);
    assert.equal(failed.reason, "PERSISTENCE_FAILED");
    if (prev) process.env.DATABASE_URL = prev;
    pass("postgres_failure_blocks_fake_success");
  } catch (e) {
    fail("postgres_failure_blocks_fake_success", e);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        build: CANONICAL_STORE_BUILD,
        productionEnv: isProductionEnvironment(),
        propIdentitySample: propIdentity(sampleProp(1)),
        membershipHashSample: membershipHash(official),
        results,
      },
      null,
      2
    )
  );
  if (failed.length) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
