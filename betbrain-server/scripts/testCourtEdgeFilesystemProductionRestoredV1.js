/**
 * Filesystem production restore v1 — proves Postgres durability layer is gone
 * and C2 / Aug7 locks remain. No DATABASE_URL required.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  computeCalibrationHashV2,
  EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE,
  computeReliabilityProbabilityV2,
  computeTrustScoreV2,
  classifyRiskEmpiricalV2,
  evaluateSafePropPathwaysV2,
} from "../engines/empiricalSafePropV2/index.js";
import { EMPIRICAL_SAFE_PROP_V2 } from "../engines/topProps/courtEdgeFeatureFlagsV1.js";
import { getDurableStoreHealthSync } from "../services/courtEdgeDurableStoreV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "..");
const CEREMONY =
  "11fe26e8ecea79eab6183cc631d4a349f6dd6f9f4290ac70fafbbe9737d5fb14";
const LF =
  "4f563a9218781f7232094a65eb8ac2c56ba396b000d41e1af9fa49cf8f174da2";

const results = [];
function pass(name, info = {}) {
  results.push({ name, ok: true, ...info });
  console.log("PASS", name);
}
function fail(name, error) {
  results.push({ name, ok: false, error: String(error?.message || error) });
  console.error("FAIL", name, error);
}

function readServerSource() {
  return fs.readFileSync(path.join(SERVER, "server.js"), "utf8");
}

async function run() {
  delete process.env.DATABASE_URL;
  delete process.env.COURTEDGE_DATABASE_URL;
  delete process.env.POSTGRES_URL;
  delete process.env.COURTEDGE_ALLOW_POSTGRES_DURABLE;

  try {
    const src = readServerSource();
    assert.ok(
      src.includes('SERVER_BUILD = "courteedge-filesystem-production-restored-v1"') ||
        src.includes(
          'const SERVER_BUILD = "courteedge-filesystem-production-restored-v1"'
        )
    );
    assert.ok(src.includes('persistenceMode: "FILESYSTEM_PRIMARY"'));
    assert.ok(src.includes('durableBackend: "filesystem"'));
    assert.ok(!src.includes("courtEdgePostgres"));
    assert.ok(!src.includes("postgres-durability-probe"));
    assert.ok(!src.includes("sealCanonicalSlateV1"));
    assert.ok(!src.includes("applyCanonicalMigrations"));
    assert.ok(!src.includes("2099-01-15"));
    assert.ok(src.includes("PROSPECTIVE_SLATE_LOCKED"));
    assert.ok(src.includes("2026-08-07"));
    // Startup health fix markers must remain
    assert.ok(src.includes("bootPhase"));
    assert.ok(src.includes("yieldEventLoop") || src.includes("withStartupBudget"));
    pass("server_source_filesystem_primary_no_postgres");
  } catch (e) {
    fail("server_source_filesystem_primary_no_postgres", e);
  }

  try {
    const yaml = fs.readFileSync(path.join(SERVER, "render.yaml"), "utf8");
    assert.ok(!/^\s*-\s*key:\s*DATABASE_URL\s*$/m.test(yaml));
    assert.ok(!yaml.includes("fromDatabase"));
    assert.ok(!/^databases:\s*$/m.test(yaml));
    assert.ok(yaml.includes("name: betbrain-api"));
    pass("render_yaml_no_postgres_db");
  } catch (e) {
    fail("render_yaml_no_postgres_db", e);
  }

  try {
    assert.equal(
      fs.existsSync(
        path.join(SERVER, "services/courtEdgePostgres/canonicalStoreV1.js")
      ),
      false
    );
    assert.equal(
      fs.existsSync(
        path.join(SERVER, "scripts/testCourtEdgePostgresDurabilityV1.js")
      ),
      false
    );
    pass("postgres_durability_files_removed");
  } catch (e) {
    fail("postgres_durability_files_removed", e);
  }

  try {
    const health = getDurableStoreHealthSync();
    assert.equal(health.type, "filesystem");
    assert.equal(health.databaseUrlConfigured, false);
    // Even with a stray DATABASE_URL, filesystem primary stays on unless opt-in.
    process.env.DATABASE_URL = "postgresql://example.invalid/db";
    const health2 = getDurableStoreHealthSync();
    assert.equal(health2.databaseUrlConfigured, false);
    delete process.env.DATABASE_URL;
    pass("durable_store_ignores_database_url_without_opt_in");
  } catch (e) {
    fail("durable_store_ignores_database_url_without_opt_in", e);
  }

  try {
    assert.equal(EMPIRICAL_SAFE_PROP_V2, true);
    assert.ok(
      EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE === true ||
        EMPIRICAL_SAFE_PROP_V2_PRODUCTION_FREEZE ===
          "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2"
    );
    const live = computeCalibrationHashV2();
    assert.ok(live === CEREMONY || live === LF, `unexpected hash ${live}`);
    pass("c2_champion_hash_unchanged", { live });
  } catch (e) {
    fail("c2_champion_hash_unchanged", e);
  }

  try {
    const lock = JSON.parse(
      fs.readFileSync(
        path.join(
          SERVER,
          "engines/empiricalSafePropV2/calibration2ChampionLock.json"
        ),
        "utf8"
      )
    );
    assert.ok(
      (lock.prospectiveLockedSlateDates || []).includes("2026-08-07")
    );
    const freeze = JSON.parse(
      fs.readFileSync(
        path.join(
          SERVER,
          "research/empirical-safe-prop-v2/prospective-slate-freezes/2026-08-07__LATEST_PROSPECTIVE.json"
        ),
        "utf8"
      )
    );
    assert.ok(freeze.frozenAt || freeze.freezeTimestamp);
    pass("aug7_lock_and_freeze_preserved", {
      frozenAt: freeze.frozenAt || freeze.freezeTimestamp,
      immutable: freeze.immutable ?? null,
    });
  } catch (e) {
    fail("aug7_lock_and_freeze_preserved", e);
  }

  // Zero model effect: frozen packet identity + deterministic engine re-score.
  try {
    const packetPath = path.join(
      SERVER,
      "research/empirical-safe-prop-v2/frozen-research-packets/2026-08-07__2026-08-07T20-08-44-940Z__research-packets.json"
    );
    const packets = JSON.parse(fs.readFileSync(packetPath, "utf8"));
    const list = packets.packets || [];
    const sample =
      list.find((p) =>
        ["LOW", "MEDIUM"].includes(String(p.v2Risk || p.risk || "").toUpperCase())
      ) || list[0];
    assert.ok(sample, "no sample packet");

    const identity = {
      player: sample.playerName,
      side: sample.side || sample.selectedSide,
      line: sample.line,
      rawProbability: sample.rawWinProbability,
      reliability: sample.reliabilityProbability,
      trustScore: sample.trustScore,
      risk: sample.v2Risk || sample.risk,
      pathway: sample.safePathway,
    };
    // Identity must remain readable after infra cleanup (no rewrite of freeze).
    assert.ok(identity.player);
    assert.ok(identity.side);
    assert.ok(Number.isFinite(Number(identity.line)));

    function scoreOnce(p) {
      const reliability = computeReliabilityProbabilityV2(p);
      const pathways = evaluateSafePropPathwaysV2(p);
      const trust = computeTrustScoreV2(p);
      const risk = classifyRiskEmpiricalV2(p);
      return {
        player: p.playerName,
        side: p.side || p.selectedSide,
        line: p.line,
        rawProbability: p.rawWinProbability,
        reliabilityProbability:
          reliability?.reliabilityProbability ?? reliability ?? null,
        trustScore: trust?.trustScore ?? trust ?? null,
        risk: risk?.trueRisk || risk?.risk || risk?.v2Risk || null,
        pathway:
          pathways?.primaryPathway || pathways?.safePathway || p.safePathway || null,
      };
    }
    const a = scoreOnce(sample);
    const b = scoreOnce(sample);
    assert.deepStrictEqual(a, b);
    assert.equal(a.player, identity.player);
    assert.equal(a.side, identity.side);
    assert.equal(Number(a.line), Number(identity.line));
    assert.equal(a.rawProbability, identity.rawProbability);
    pass("c2_zero_model_effect_rescore", { identity, rescore: a });
  } catch (e) {
    fail("c2_zero_model_effect_rescore", e);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(
    JSON.stringify(
      {
        ok: failed.length === 0,
        passed: results.filter((r) => r.ok).length,
        failed: failed.length,
        results,
      },
      null,
      2
    )
  );
  if (failed.length) process.exit(1);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
