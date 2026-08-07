/**
 * CourtEdge Postgres canonical production store v1.
 * Build: courteedge-render-postgres-production-durability-v1
 *
 * Postgres is production authority for sealed Official / research / Results /
 * locks / model+research freezes. Filesystem is optional mirror only.
 *
 * Does NOT modify EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2 coefficients.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");

export const CANONICAL_STORE_BUILD =
  "courteedge-render-postgres-production-durability-v1";
export const CANONICAL_SCHEMA_VERSION = "001_courtedge_canonical_v1";

/** Ceremony hash (Windows-raw) — identity string for C2 freeze. */
export const C2_CALIBRATION_HASH_CEREMONY =
  "11fe26e8ecea79eab6183cc631d4a349f6dd6f9f4290ac70fafbbe9737d5fb14";
/** LF-canonical digest of the same engine files on Linux/Render. */
export const C2_CALIBRATION_HASH_LF =
  "4f563a9218781f7232094a65eb8ac2c56ba396b000d41e1af9fa49cf8f174da2";

let pool = null;
let poolFailed = false;
let lastError = null;
let migrationsApplied = false;
let schemaChecksum = null;

function resolveDatabaseUrl() {
  return String(
    process.env.COURTEDGE_DATABASE_URL ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      ""
  ).trim();
}

export function isDatabaseUrlConfigured() {
  return resolveDatabaseUrl().length > 0;
}

export function isProductionEnvironment() {
  const nodeEnv = String(process.env.NODE_ENV || "").toLowerCase();
  const env = String(process.env.COURTEDGE_ENVIRONMENT || "").toLowerCase();
  return nodeEnv === "production" || env === "production";
}

export function propIdentity(prop = {}) {
  const eventId = String(prop.eventId || prop.event_id || "").trim();
  const playerId = String(
    prop.playerId || prop.player_id || prop.playerName || prop.player || ""
  )
    .trim()
    .toLowerCase();
  const market = String(prop.marketType || prop.market_type || "player_points")
    .trim()
    .toLowerCase();
  const side = String(prop.side || prop.pick || "")
    .trim()
    .toUpperCase();
  const line = Number(prop.line);
  return [eventId, playerId, market, side, Number.isFinite(line) ? line : ""]
    .join("|")
    .replace(/\s+/g, " ");
}

export function membershipHash(props = []) {
  const ids = props.map(propIdentity).filter(Boolean).sort();
  return crypto.createHash("sha256").update(ids.join("\n")).digest("hex");
}

export function isAcceptedCalibrationHash(hash) {
  const h = String(hash || "").trim().toLowerCase();
  return h === C2_CALIBRATION_HASH_CEREMONY || h === C2_CALIBRATION_HASH_LF;
}

async function ensurePool() {
  const url = resolveDatabaseUrl();
  if (!url) {
    lastError = "DATABASE_URL_not_configured";
    return null;
  }
  if (poolFailed) return null;
  if (pool) return pool;
  try {
    const mod = await import("pg");
    const Pool = mod.default?.Pool || mod.Pool;
    const connectMs = Number(process.env.COURTEDGE_PG_CONNECT_MS || 4000);
    pool = new Pool({
      connectionString: url,
      ssl:
        process.env.COURTEDGE_DATABASE_SSL === "false"
          ? false
          : { rejectUnauthorized: false },
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: Number.isFinite(connectMs) ? connectMs : 4000,
      allowExitOnIdle: true,
    });
    await pool.query("SELECT 1");
    lastError = null;
    return pool;
  } catch (error) {
    lastError = String(error?.message || error);
    poolFailed = true;
    pool = null;
    return null;
  }
}

function migrationChecksum(sql) {
  return crypto.createHash("sha256").update(sql).digest("hex");
}

export async function applyCanonicalMigrations() {
  const p = await ensurePool();
  if (!p) return { ok: false, reason: lastError || "NO_POOL" };

  const file = path.join(MIGRATIONS_DIR, `${CANONICAL_SCHEMA_VERSION}.sql`);
  const sql = fs.readFileSync(file, "utf8");
  const checksum = migrationChecksum(sql);
  schemaChecksum = checksum;

  const client = await p.connect();
  try {
    await client.query("BEGIN");
    await client.query(`
      CREATE TABLE IF NOT EXISTS courtedge_schema_migrations (
        version TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        checksum TEXT,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    const existing = await client.query(
      `SELECT version, checksum FROM courtedge_schema_migrations WHERE version = $1`,
      [CANONICAL_SCHEMA_VERSION]
    );
    if (!existing.rows.length) {
      await client.query(sql);
      await client.query(
        `INSERT INTO courtedge_schema_migrations (version, name, checksum)
         VALUES ($1, $2, $3)`,
        [CANONICAL_SCHEMA_VERSION, "courtedge_canonical_v1", checksum]
      );
    }
    await client.query("COMMIT");
    migrationsApplied = true;
    return { ok: true, version: CANONICAL_SCHEMA_VERSION, checksum };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    lastError = String(error?.message || error);
    return { ok: false, reason: lastError };
  } finally {
    client.release();
  }
}

export async function getCanonicalDurableHealth() {
  const configured = isDatabaseUrlConfigured();
  const started = Date.now();
  const p = configured ? await ensurePool() : null;
  let selectOk = false;
  if (p) {
    try {
      await p.query("SELECT 1");
      selectOk = true;
    } catch (error) {
      lastError = String(error?.message || error);
      selectOk = false;
    }
  }
  const postgresHealthy = configured && selectOk && !poolFailed;

  // If connected, ensure migrations lazily for health probes that run after boot.
  let migration = null;
  if (postgresHealthy && !migrationsApplied) {
    migration = await applyCanonicalMigrations();
  }

  const ready =
    postgresHealthy && (migrationsApplied || migration?.ok === true);

  return {
    build: CANONICAL_STORE_BUILD,
    databaseUrlConfigured: configured,
    postgresHealthy,
    durableBackend: postgresHealthy ? "postgres" : "filesystem",
    durableStoreReady: ready,
    schemaVersion: CANONICAL_SCHEMA_VERSION,
    schemaChecksum: schemaChecksum || migration?.checksum || null,
    migrationsApplied: migrationsApplied || migration?.ok === true,
    lastError: configured ? lastError : "DATABASE_URL_not_configured",
    connectMs: Date.now() - started,
    productionRequiresPostgres: isProductionEnvironment(),
  };
}

function mapOfficialRow(prop, calibrationHash) {
  const identity = propIdentity(prop);
  return {
    event_id: prop.eventId || prop.event_id || null,
    player_id: prop.playerId || prop.player_id || null,
    player_name: prop.player || prop.playerName || prop.player_name || "",
    team: prop.team || null,
    opponent: prop.opponent || null,
    market_type: prop.marketType || prop.market_type || "player_points",
    side: String(prop.side || prop.pick || "").toUpperCase(),
    line: Number(prop.line),
    raw_probability: prop.rawWinProbability ?? prop.raw_probability ?? null,
    reliability_probability:
      prop.reliabilityProbability ?? prop.reliability_probability ?? null,
    trust_score: prop.trustScore ?? prop.trust_score ?? null,
    safety_score: prop.safetyScore ?? prop.SafetyScore ?? null,
    risk: prop.trueRisk || prop.riskLabel || prop.risk || prop.v2Risk || null,
    safe_pathway: prop.safePathway || prop.pathway || null,
    projection: prop.projection ?? prop.projectedPoints ?? null,
    fair_line: prop.fairLine ?? null,
    projection_edge: prop.projectionEdge ?? prop.edge ?? null,
    failure_paths_json: prop.failurePaths || prop.failure_paths || null,
    evidence_json: prop.evidence || prop.evidence_json || null,
    v1_risk: prop.v1Risk || prop.v1_risk || null,
    v2_risk: prop.v2Risk || prop.v2_risk || null,
    model_version: prop.modelVersion || null,
    calibration_hash: calibrationHash,
    tracked_id: prop.trackedId || prop.trackedKey || null,
    prop_identity: identity,
    actual_points: prop.actualPoints ?? prop.actual_points ?? null,
    grade: prop.grade || prop.result || null,
    margin_to_line: prop.marginToLine ?? prop.margin_to_line ?? null,
    graded_at: prop.gradedAt || null,
  };
}

/**
 * Transactional Official seal + research + Results references + lock.
 */
export async function sealCanonicalSlateV1(input = {}) {
  const health = await getCanonicalDurableHealth();
  if (!health.durableStoreReady) {
    return {
      ok: false,
      refreshSuccess: false,
      reason: "PERSISTENCE_FAILED",
      detail: health.lastError || "durableStoreReady=false",
      health,
    };
  }

  const league = String(input.league || "WNBA").toUpperCase();
  const slateDate = String(input.slateDate || input.slate_date_ct || "").trim();
  const dayBucket = String(input.dayBucket || "TODAY").toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(slateDate)) {
    return { ok: false, refreshSuccess: false, reason: "INVALID_SLATE_DATE" };
  }

  // Never retroactively seal Aug 7 as Official from this path unless explicit test fixture.
  if (
    slateDate === "2026-08-07" &&
    input.allowAug7Official !== true &&
    String(input.classification || "CANONICAL") === "CANONICAL"
  ) {
    return {
      ok: false,
      refreshSuccess: false,
      reason: "AUG7_OFFICIAL_SEAL_FORBIDDEN",
      message:
        "Aug 7 may only be stored as RESEARCH_FREEZE; not as live Official",
    };
  }

  const official = Array.isArray(input.officialProps) ? input.officialProps : [];
  const research = Array.isArray(input.researchProps) ? input.researchProps : [];
  const calibrationHash =
    input.calibrationHash || C2_CALIBRATION_HASH_CEREMONY;
  const memHash = membershipHash(official);
  const p = await ensurePool();
  const client = await p.connect();

  try {
    await client.query("BEGIN");

    const slateUpsert = await client.query(
      `
      INSERT INTO courtedge_slates (
        league, slate_date_ct, day_bucket, status,
        canonical_board_version, selection_mode,
        model_version, calibration_version, calibration_hash,
        membership_hash, sealed_at, official_count, research_count,
        is_locked, lock_reason, source_build, source_commit,
        classification, payload_json, updated_at
      ) VALUES (
        $1,$2,$3,'SEALED',
        $4,$5,
        $6,$7,$8,
        $9, NOW(), $10, $11,
        TRUE, $12, $13, $14,
        $15, $16::jsonb, NOW()
      )
      ON CONFLICT (league, slate_date_ct, day_bucket) DO UPDATE SET
        status = 'SEALED',
        calibration_hash = EXCLUDED.calibration_hash,
        membership_hash = EXCLUDED.membership_hash,
        sealed_at = COALESCE(courtedge_slates.sealed_at, NOW()),
        official_count = EXCLUDED.official_count,
        research_count = EXCLUDED.research_count,
        is_locked = TRUE,
        lock_reason = EXCLUDED.lock_reason,
        source_build = EXCLUDED.source_build,
        source_commit = EXCLUDED.source_commit,
        payload_json = EXCLUDED.payload_json,
        updated_at = NOW()
      RETURNING id, membership_hash, official_count, research_count, sealed_at
      `,
      [
        league,
        slateDate,
        dayBucket,
        input.canonicalBoardVersion || CANONICAL_STORE_BUILD,
        input.selectionMode || "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
        input.modelVersion || "EMPIRICAL_SAFE_PROP_V2",
        input.calibrationVersion || "EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2",
        calibrationHash,
        memHash,
        official.length,
        research.length,
        input.lockReason || "OFFICIAL_SEALED",
        input.sourceBuild || CANONICAL_STORE_BUILD,
        input.sourceCommit || process.env.RENDER_GIT_COMMIT || null,
        input.classification || "CANONICAL",
        JSON.stringify(input.payload || {}),
      ]
    );

    const slateId = slateUpsert.rows[0].id;

    // Replace Official membership idempotently for this slate.
    await client.query(`DELETE FROM courtedge_results WHERE slate_id = $1`, [
      slateId,
    ]);
    await client.query(
      `DELETE FROM courtedge_official_props WHERE slate_id = $1`,
      [slateId]
    );
    await client.query(
      `DELETE FROM courtedge_research_props WHERE slate_id = $1`,
      [slateId]
    );

    const officialIds = [];
    for (const prop of official) {
      const row = mapOfficialRow(prop, calibrationHash);
      if (!row.player_name || !row.side || !Number.isFinite(row.line)) continue;
      const inserted = await client.query(
        `
        INSERT INTO courtedge_official_props (
          slate_id, event_id, player_id, player_name, team, opponent,
          market_type, side, line,
          raw_probability, reliability_probability, trust_score, safety_score,
          risk, safe_pathway, projection, fair_line, projection_edge,
          failure_paths_json, evidence_json, v1_risk, v2_risk,
          model_version, calibration_hash, prediction_created_at, sealed_at,
          actual_points, grade, margin_to_line, graded_at,
          tracked_id, prop_identity
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,
          $10,$11,$12,$13,
          $14,$15,$16,$17,$18,
          $19::jsonb,$20::jsonb,$21,$22,
          $23,$24,NOW(),NOW(),
          $25,$26,$27,$28,
          $29,$30
        )
        RETURNING id, prop_identity
        `,
        [
          slateId,
          row.event_id,
          row.player_id,
          row.player_name,
          row.team,
          row.opponent,
          row.market_type,
          row.side,
          row.line,
          row.raw_probability,
          row.reliability_probability,
          row.trust_score,
          row.safety_score,
          row.risk,
          row.safe_pathway,
          row.projection,
          row.fair_line,
          row.projection_edge,
          JSON.stringify(row.failure_paths_json),
          JSON.stringify(row.evidence_json),
          row.v1_risk,
          row.v2_risk,
          row.model_version,
          row.calibration_hash,
          row.actual_points,
          row.grade,
          row.margin_to_line,
          row.graded_at,
          row.tracked_id,
          row.prop_identity,
        ]
      );
      officialIds.push(inserted.rows[0]);
      await client.query(
        `
        INSERT INTO courtedge_results (slate_id, official_prop_id, cohort_status)
        VALUES ($1, $2, 'ACTIVE')
        ON CONFLICT (slate_id, official_prop_id) DO NOTHING
        `,
        [slateId, inserted.rows[0].id]
      );
    }

    for (const prop of research) {
      const row = mapOfficialRow(prop, calibrationHash);
      if (!row.player_name || !row.side || !Number.isFinite(row.line)) continue;
      const selected = officialIds.some(
        (o) => o.prop_identity === row.prop_identity
      );
      await client.query(
        `
        INSERT INTO courtedge_research_props (
          slate_id, event_id, player_id, player_name, team, opponent,
          market_type, side, line,
          raw_probability, reliability_probability, trust_score, safety_score,
          risk, safe_pathway, projection, fair_line, projection_edge,
          failure_paths_json, evidence_json, v1_risk, v2_risk,
          model_version, calibration_hash,
          official_eligible, official_selected, official_rejection_reasons,
          prop_identity
        ) VALUES (
          $1,$2,$3,$4,$5,$6,
          $7,$8,$9,
          $10,$11,$12,$13,
          $14,$15,$16,$17,$18,
          $19::jsonb,$20::jsonb,$21,$22,
          $23,$24,
          $25,$26,$27::jsonb,
          $28
        )
        ON CONFLICT (slate_id, prop_identity) DO UPDATE SET
          risk = EXCLUDED.risk,
          official_selected = EXCLUDED.official_selected
        `,
        [
          slateId,
          row.event_id,
          row.player_id,
          row.player_name,
          row.team,
          row.opponent,
          row.market_type,
          row.side,
          row.line,
          row.raw_probability,
          row.reliability_probability,
          row.trust_score,
          row.safety_score,
          row.risk,
          row.safe_pathway,
          row.projection,
          row.fair_line,
          row.projection_edge,
          JSON.stringify(row.failure_paths_json),
          JSON.stringify(row.evidence_json),
          row.v1_risk,
          row.v2_risk,
          row.model_version,
          row.calibration_hash,
          prop.officialEligible !== false &&
            ["LOW", "MEDIUM"].includes(String(row.risk || "").toUpperCase()),
          selected,
          JSON.stringify(prop.officialRejectionReasons || null),
          row.prop_identity,
        ]
      );
    }

    await client.query(
      `
      INSERT INTO courtedge_slate_locks (
        slate_date_ct, lock_type, league, canonical_membership_hash,
        source_slate_id, reason
      ) VALUES ($1, 'OFFICIAL_SEALED', $2, $3, $4, $5)
      ON CONFLICT (league, slate_date_ct, lock_type) DO UPDATE SET
        canonical_membership_hash = EXCLUDED.canonical_membership_hash,
        source_slate_id = EXCLUDED.source_slate_id,
        reason = EXCLUDED.reason
      `,
      [
        slateDate,
        league,
        memHash,
        slateId,
        input.lockReason || "OFFICIAL_SEALED",
      ]
    );

    await client.query(
      `
      INSERT INTO courtedge_model_freezes (
        model_name, model_version, calibration_name, calibration_hash,
        is_champion, meta_json
      ) VALUES (
        'EMPIRICAL_SAFE_PROP_V2',
        'EMPIRICAL_SAFE_PROP_V2',
        'EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2',
        $1,
        TRUE,
        $2::jsonb
      )
      ON CONFLICT (calibration_name, calibration_hash) DO UPDATE SET
        is_champion = TRUE,
        deactivated_at = NULL
      `,
      [
        calibrationHash,
        JSON.stringify({
          ceremonyHash: C2_CALIBRATION_HASH_CEREMONY,
          lfHash: C2_CALIBRATION_HASH_LF,
        }),
      ]
    );

    // Read-back verification
    const readOfficial = await client.query(
      `SELECT id, prop_identity, side, line, risk, reliability_probability,
              trust_score, calibration_hash
       FROM courtedge_official_props WHERE slate_id = $1 ORDER BY prop_identity`,
      [slateId]
    );
    const readResults = await client.query(
      `SELECT official_prop_id FROM courtedge_results WHERE slate_id = $1`,
      [slateId]
    );
    const readResearch = await client.query(
      `SELECT COUNT(*)::int AS n FROM courtedge_research_props WHERE slate_id = $1`,
      [slateId]
    );

    const writtenIds = officialIds.map((r) => r.prop_identity).sort();
    const readIds = readOfficial.rows.map((r) => r.prop_identity).sort();
    const idsMatch =
      writtenIds.length === readIds.length &&
      writtenIds.every((id, i) => id === readIds[i]);
    const resultsMatch = readResults.rows.length === readOfficial.rows.length;
    const hashMatch = membershipHash(
      readOfficial.rows.map((r) => ({
        eventId: "",
        player: r.prop_identity.split("|")[1],
        side: r.side,
        line: r.line,
        marketType: r.prop_identity.split("|")[2],
        playerId: r.prop_identity.split("|")[1],
        event_id: r.prop_identity.split("|")[0],
      }))
    );

    // Recompute membership from stored identities directly
    const storedMem = crypto
      .createHash("sha256")
      .update(readIds.join("\n"))
      .digest("hex");

    if (!idsMatch || !resultsMatch || storedMem !== memHash) {
      await client.query("ROLLBACK");
      return {
        ok: false,
        refreshSuccess: false,
        reason: "READBACK_MISMATCH",
        writtenCount: writtenIds.length,
        readCount: readIds.length,
        resultsCount: readResults.rows.length,
        membershipHash: memHash,
        storedMembershipHash: storedMem,
      };
    }

    await client.query("COMMIT");
    return {
      ok: true,
      refreshSuccess: true,
      slateId,
      slateDate,
      league,
      dayBucket,
      officialCount: readOfficial.rows.length,
      researchCount: readResearch.rows[0].n,
      resultsCount: readResults.rows.length,
      membershipHash: memHash,
      officialIdentities: readIds,
      calibrationHash,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    lastError = String(error?.message || error);
    return {
      ok: false,
      refreshSuccess: false,
      reason: "PERSISTENCE_FAILED",
      detail: lastError,
    };
  } finally {
    client.release();
  }
}

export async function restoreCanonicalSlateV1({
  slateDate,
  league = "WNBA",
  dayBucket = "TODAY",
} = {}) {
  const health = await getCanonicalDurableHealth();
  if (!health.durableStoreReady) {
    return { ok: false, reason: "PERSISTENCE_FAILED", health };
  }
  const p = await ensurePool();
  const slate = await p.query(
    `
    SELECT * FROM courtedge_slates
    WHERE league = $1 AND slate_date_ct = $2 AND day_bucket = $3
    LIMIT 1
    `,
    [String(league).toUpperCase(), slateDate, String(dayBucket).toUpperCase()]
  );
  if (!slate.rows.length) {
    return { ok: false, reason: "SLATE_NOT_FOUND", slateDate, league, dayBucket };
  }
  const row = slate.rows[0];
  const official = await p.query(
    `SELECT * FROM courtedge_official_props WHERE slate_id = $1 ORDER BY prop_identity`,
    [row.id]
  );
  const research = await p.query(
    `SELECT * FROM courtedge_research_props WHERE slate_id = $1 ORDER BY prop_identity`,
    [row.id]
  );
  const results = await p.query(
    `SELECT * FROM courtedge_results WHERE slate_id = $1`,
    [row.id]
  );
  const locks = await p.query(
    `SELECT * FROM courtedge_slate_locks WHERE league = $1 AND slate_date_ct = $2`,
    [String(league).toUpperCase(), slateDate]
  );

  return {
    ok: true,
    restore: true,
    regenerateBlocked: row.is_locked === true,
    slate: row,
    officialProps: official.rows,
    researchProps: research.rows,
    results: results.rows,
    locks: locks.rows,
    membershipHash: row.membership_hash,
    officialIdentities: official.rows.map((r) => r.prop_identity),
    resultsOfficialIds: results.rows.map((r) => r.official_prop_id),
  };
}

export async function persistResearchFreezeV1(freeze = {}) {
  const health = await getCanonicalDurableHealth();
  if (!health.durableStoreReady) {
    return { ok: false, reason: "PERSISTENCE_FAILED", health };
  }
  const slateDate = String(freeze.slateDate || freeze.slate_date_ct || "").trim();
  if (!slateDate) return { ok: false, reason: "MISSING_SLATE_DATE" };

  const officialRecordEligible =
    freeze.officialRecordEligible === true ? true : false;
  // Aug 7 research freeze must never become Official-eligible.
  const eligible =
    slateDate === "2026-08-07" ? false : officialRecordEligible;

  const p = await ensurePool();
  const freezeTimestamp =
    freeze.freezeTimestamp || freeze.frozenAt || new Date().toISOString();
  const freezeJson = freeze.freezeJson || freeze;
  const freezeHash =
    freeze.freezeHash ||
    crypto
      .createHash("sha256")
      .update(JSON.stringify(freezeJson))
      .digest("hex");

  const result = await p.query(
    `
    INSERT INTO courtedge_research_freezes (
      slate_date_ct, freeze_timestamp, freeze_hash,
      classification_counts, freeze_json, official_record_eligible,
      freeze_type, calibration_hash
    ) VALUES ($1, $2::timestamptz, $3, $4::jsonb, $5::jsonb, $6, $7, $8)
    ON CONFLICT (slate_date_ct, freeze_timestamp, freeze_type) DO UPDATE SET
      freeze_hash = EXCLUDED.freeze_hash,
      freeze_json = EXCLUDED.freeze_json
    RETURNING id, official_record_eligible
    `,
    [
      slateDate,
      freezeTimestamp,
      freezeHash,
      JSON.stringify(freeze.classificationCounts || null),
      JSON.stringify(freezeJson),
      eligible,
      freeze.freezeType || "PROSPECTIVE_RESEARCH_FREEZE",
      freeze.calibrationHash || C2_CALIBRATION_HASH_CEREMONY,
    ]
  );

  await p.query(
    `
    INSERT INTO courtedge_slate_locks (
      slate_date_ct, lock_type, league, canonical_membership_hash, reason
    ) VALUES ($1, 'PROSPECTIVE_RESEARCH_LOCK', $2, $3, $4)
    ON CONFLICT (league, slate_date_ct, lock_type) DO NOTHING
    `,
    [
      slateDate,
      String(freeze.league || "WNBA").toUpperCase(),
      freezeHash,
      "PROSPECTIVE_RESEARCH_FREEZE",
    ]
  );

  return {
    ok: true,
    id: result.rows[0].id,
    officialRecordEligible: result.rows[0].official_record_eligible,
    freezeHash,
  };
}

export async function exportCanonicalDbV1() {
  const health = await getCanonicalDurableHealth();
  if (!health.durableStoreReady) {
    return { ok: false, reason: "PERSISTENCE_FAILED", health };
  }
  const p = await ensurePool();
  const [slates, official, research, locks, models, freezes] =
    await Promise.all([
      p.query(`SELECT * FROM courtedge_slates ORDER BY slate_date_ct`),
      p.query(`SELECT * FROM courtedge_official_props ORDER BY slate_id, id`),
      p.query(`SELECT * FROM courtedge_research_props ORDER BY slate_id, id`),
      p.query(`SELECT * FROM courtedge_slate_locks ORDER BY slate_date_ct`),
      p.query(`SELECT * FROM courtedge_model_freezes ORDER BY id`),
      p.query(`SELECT * FROM courtedge_research_freezes ORDER BY slate_date_ct`),
    ]);
  return {
    ok: true,
    exportVersion: "COURTEDGE_DB_EXPORT_V1",
    exportedAt: new Date().toISOString(),
    slates: slates.rows,
    officialProps: official.rows,
    researchProps: research.rows,
    locks: locks.rows,
    modelFreezes: models.rows,
    researchFreezes: freezes.rows,
  };
}

export async function closeCanonicalPool() {
  if (pool) {
    try {
      await pool.end();
    } catch {
      // ignore
    }
  }
  pool = null;
  poolFailed = false;
  migrationsApplied = false;
}

/** Test helper: reset fail-open latch without process restart. */
export function __resetCanonicalStoreForTests() {
  pool = null;
  poolFailed = false;
  lastError = null;
  migrationsApplied = false;
  schemaChecksum = null;
}
