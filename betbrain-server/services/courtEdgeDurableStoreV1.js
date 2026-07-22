/**
 * CourtEdge durable production store v1.
 *
 * Prefer PostgreSQL (DATABASE_URL / COURTEDGE_DATABASE_URL).
 * Always mirror to atomic local JSON for process-local reads and offline tests.
 * Git is never the mutable production database.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

export const DURABLE_STORE_VERSION = "courtedge-durable-store-v1";
export const DURABLE_STORE_BUILD = "courteedge-home-restart-durability-v1";

export const DURABLE_KEYS = Object.freeze({
  BOARD_CACHE: "board-cache",
  SCHEDULER_STATE: "scheduler-state",
  CANONICAL_SLATES: "canonical-slates",
  TRACKED_PROPS: "tracked-props",
  THREE_SLATE_BLOCKS: "three-slate-blocks",
  LIFECYCLE_JOURNAL: "lifecycle-journal",
  STATE_LOCKS: "state-locks",
  IDEMPOTENCY: "idempotency-keys",
  WATCHDOG: "watchdog-state",
  LAB_POINTER: "lab-pointer",
  DAILY_SLATE_REPORTS: "daily-slate-reports",
});

const FILE_MAP = Object.freeze({
  [DURABLE_KEYS.BOARD_CACHE]: "board-cache.json",
  [DURABLE_KEYS.SCHEDULER_STATE]: "courtedge-scheduler-state-v1.json",
  [DURABLE_KEYS.CANONICAL_SLATES]: "canonical-slates-v1.json",
  [DURABLE_KEYS.TRACKED_PROPS]: "tracked-props.json",
  [DURABLE_KEYS.THREE_SLATE_BLOCKS]: "three-slate-blocks-v2.json",
  [DURABLE_KEYS.LIFECYCLE_JOURNAL]: "lifecycle-transition-journal-v1.json",
  [DURABLE_KEYS.STATE_LOCKS]: "state-integrity-locks-v1.json",
  [DURABLE_KEYS.IDEMPOTENCY]: "courtedge-idempotency-v1.json",
  [DURABLE_KEYS.WATCHDOG]: "courtedge-watchdog-state-v1.json",
  [DURABLE_KEYS.LAB_POINTER]: "courtedge-lab-pointer-v1.json",
  [DURABLE_KEYS.DAILY_SLATE_REPORTS]: "daily-slate-reports.json",
});

let pgPool = null;
let pgReady = null;
let pgFailed = false;
let lastDurableWriteAt = null;
let lastDurableError = null;
let lastStartupRecovery = null;
let backendType = null;

function resolveDatabaseUrl() {
  return String(
    process.env.COURTEDGE_DATABASE_URL ||
      process.env.DATABASE_URL ||
      process.env.POSTGRES_URL ||
      ""
  ).trim();
}

function mirrorDir() {
  const custom = String(process.env.COURTEDGE_DURABLE_MIRROR_DIR || "").trim();
  if (custom) return custom;
  return path.join(SERVER_ROOT, ".durable-mirror-v1");
}

function filePathForKey(key) {
  const name = FILE_MAP[key] || `${key}.json`;
  return path.join(SERVER_ROOT, name);
}

function mirrorPathForKey(key) {
  return path.join(mirrorDir(), `${key}.json`);
}

function atomicWriteJson(file, data) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  const bak = `${file}.bak`;
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, bak);
  } catch {
    // ignore
  }
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}

function readJsonSafe(file, fallback = null) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    try {
      const bak = `${file}.bak`;
      if (fs.existsSync(bak)) return JSON.parse(fs.readFileSync(bak, "utf8"));
    } catch {
      // fall through
    }
    return fallback;
  }
}

async function ensurePg() {
  const url = resolveDatabaseUrl();
  if (!url) {
    backendType = "filesystem";
    return null;
  }
  if (pgFailed) {
    backendType = backendType || "filesystem-fallback";
    return null;
  }
  if (pgPool) return pgPool;
  if (pgReady) return pgReady;
  pgReady = (async () => {
    try {
      const mod = await import("pg");
      const Pool = mod.default?.Pool || mod.Pool;
      const connectMs = Number(process.env.COURTEDGE_PG_CONNECT_MS || 5000);
      pgPool = new Pool({
        connectionString: url,
        ssl:
          process.env.COURTEDGE_DATABASE_SSL === "false"
            ? false
            : { rejectUnauthorized: false },
        max: 2,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: Number.isFinite(connectMs) ? connectMs : 5000,
      });
      // Hard ceiling so a bad DATABASE_URL cannot hang Render startup.
      const boot = Promise.all([
        pgPool.query(`
          CREATE TABLE IF NOT EXISTS courtedge_kv (
            key TEXT PRIMARY KEY,
            value JSONB NOT NULL,
            record_version BIGINT NOT NULL DEFAULT 1,
            content_hash TEXT,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `),
        pgPool.query(`
          CREATE TABLE IF NOT EXISTS courtedge_locks (
            lock_key TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            expires_at TIMESTAMPTZ NOT NULL
          );
        `),
        pgPool.query(`
          CREATE TABLE IF NOT EXISTS courtedge_idempotency (
            idempotency_key TEXT PRIMARY KEY,
            result JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
          );
        `),
      ]);
      const timeoutMs = Number(process.env.COURTEDGE_PG_BOOT_MS || 8000);
      await Promise.race([
        boot,
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error(`postgres_boot_timeout_${timeoutMs}ms`)),
            timeoutMs
          )
        ),
      ]);
      backendType = "postgres";
      lastDurableError = null;
      return pgPool;
    } catch (error) {
      lastDurableError = String(error?.message || error);
      backendType = "filesystem-fallback";
      pgFailed = true;
      try {
        if (pgPool) await pgPool.end();
      } catch {
        // ignore
      }
      pgPool = null;
      return null;
    }
  })();
  return pgReady;
}

function hashValue(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(value ?? null))
    .digest("hex");
}

/**
 * Startup precedence (1–15) for competing records.
 * Higher score wins. Never use timestamps alone.
 */
export function scoreDurableRecord(record, options = {}) {
  if (!record || typeof record !== "object") return -1;
  let score = 0;
  const lifecycle = String(record.lifecycle || record.lifecycleState || "").toUpperCase();
  const sealed =
    record.sealed === true ||
    Boolean(record.sealedAt) ||
    lifecycle === "SEALED" ||
    lifecycle === "IN_RESULTS" ||
    lifecycle === "GRADED_COMPLETE" ||
    lifecycle === "IN_LAB" ||
    lifecycle === "IN_HISTORY";
  const graded =
    lifecycle === "GRADED_COMPLETE" ||
    lifecycle === "IN_LAB" ||
    lifecycle === "IN_HISTORY" ||
    Boolean(record.grades) ||
    (Array.isArray(record.props) &&
      record.props.every((p) => p?.result || p?.grade || p?.actualPoints != null));
  const inLab = lifecycle === "IN_LAB" || lifecycle === "IN_HISTORY";
  const hydrated =
    Array.isArray(record.decisionPackets || record.props) &&
    (record.decisionPackets || record.props).some(
      (p) => p?.sealedAnalysis || p?.engineEvidence || p?.contentHash
    );
  const props = record.decisionPackets || record.props || record.games || [];
  const populated = Array.isArray(props) ? props.length : 0;
  const recordVersion = Number(record.recordVersion || record.storeVersion || 0) || 0;
  const completeness = Number(record.completeness || 0) || 0;
  const isSeed = Boolean(record.seededBoardCache || record.emergencyEmptyBoardSeed);
  const isBundle = Boolean(options.fromBundle || record.fromBundle);
  const isEmptyInit = Boolean(options.emptyInit || record.emptyInit);

  // 1 durable completed beats seed
  if (!isSeed && !isBundle) score += 1000;
  // 2 sealed beats draft
  if (sealed) score += 500;
  // 3 graded beats ungraded
  if (graded) score += 300;
  // 4 lab-promoted beats results-only
  if (inLab) score += 200;
  // 5 hydrated beats placeholder
  if (hydrated) score += 150;
  // 6/7 populated values
  score += Math.min(populated, 50) * 2;
  score += completeness * 10;
  // 11 newer validated versions
  score += Math.min(recordVersion, 100);
  // 12 empty init cannot win
  if (isEmptyInit) score -= 5000;
  // 13 bundled recovery cannot beat durable
  if (isBundle) score -= 800;
  // 14 seed may repair missing links only
  if (isSeed) score -= 400;
  return score;
}

export function choosePreferredRecord(a, b, metaA = {}, metaB = {}) {
  if (!a) return b;
  if (!b) return a;
  const sa = scoreDurableRecord(a, metaA);
  const sb = scoreDurableRecord(b, metaB);
  if (sa !== sb) return sa >= sb ? a : b;
  const ha = a.contentHash || a.slateContentHash || "";
  const hb = b.contentHash || b.slateContentHash || "";
  if (ha && hb && ha !== hb) {
    // Prefer higher completeness then record version
    const ca = Number(a.completeness || 0);
    const cb = Number(b.completeness || 0);
    if (ca !== cb) return ca >= cb ? a : b;
    const va = Number(a.recordVersion || 0);
    const vb = Number(b.recordVersion || 0);
    return va >= vb ? a : b;
  }
  return a;
}

export async function getDurableStoreHealth() {
  const urlConfigured = Boolean(resolveDatabaseUrl());
  let pgOk = false;
  let pgError = null;
  if (urlConfigured) {
    try {
      const pool = await ensurePg();
      if (pool) {
        await pool.query("SELECT 1");
        pgOk = true;
      } else {
        pgError = lastDurableError || "pool_unavailable";
      }
    } catch (error) {
      pgError = String(error?.message || error);
      lastDurableError = pgError;
    }
  }
  return {
    ok: pgOk || !urlConfigured,
    durableStoreVersion: DURABLE_STORE_VERSION,
    durableStoreBuild: DURABLE_STORE_BUILD,
    type: pgOk ? "postgres" : urlConfigured ? "filesystem-fallback" : "filesystem",
    databaseUrlConfigured: urlConfigured,
    postgresHealthy: pgOk,
    lastDurableWriteAt,
    lastDurableError: pgError || lastDurableError,
    lastStartupRecovery,
    mirrorDir: mirrorDir(),
  };
}

export function getDurableStoreHealthSync() {
  return {
    ok: true,
    durableStoreVersion: DURABLE_STORE_VERSION,
    durableStoreBuild: DURABLE_STORE_BUILD,
    type: backendType || (resolveDatabaseUrl() ? "postgres-pending" : "filesystem"),
    databaseUrlConfigured: Boolean(resolveDatabaseUrl()),
    postgresHealthy: backendType === "postgres",
    lastDurableWriteAt,
    lastDurableError,
    lastStartupRecovery,
    mirrorDir: mirrorDir(),
  };
}

export async function durableGet(key) {
  const pool = await ensurePg();
  if (pool) {
    try {
      const res = await pool.query(
        "SELECT value, record_version, content_hash, updated_at FROM courtedge_kv WHERE key = $1",
        [key]
      );
      if (res.rows[0]) {
        return {
          ok: true,
          source: "postgres",
          value: res.rows[0].value,
          recordVersion: Number(res.rows[0].record_version) || 1,
          contentHash: res.rows[0].content_hash || null,
          updatedAt: res.rows[0].updated_at || null,
        };
      }
    } catch (error) {
      lastDurableError = String(error?.message || error);
    }
  }
  const mirror = readJsonSafe(mirrorPathForKey(key), null);
  if (mirror != null) {
    return { ok: true, source: "mirror", value: mirror };
  }
  const file = readJsonSafe(filePathForKey(key), null);
  if (file != null) {
    return { ok: true, source: "filesystem", value: file };
  }
  return { ok: false, source: null, value: null };
}

export async function durablePut(key, value, options = {}) {
  const recordVersion = Number(options.recordVersion || 1) || 1;
  const contentHash = options.contentHash || hashValue(value);
  // Always mirror locally first for crash safety / offline.
  try {
    atomicWriteJson(mirrorPathForKey(key), value);
  } catch (error) {
    lastDurableError = String(error?.message || error);
  }
  if (options.writeLocalFile !== false) {
    try {
      atomicWriteJson(filePathForKey(key), value);
    } catch (error) {
      lastDurableError = String(error?.message || error);
    }
  }
  const pool = await ensurePg();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO courtedge_kv (key, value, record_version, content_hash, updated_at)
         VALUES ($1, $2::jsonb, $3, $4, NOW())
         ON CONFLICT (key) DO UPDATE SET
           value = EXCLUDED.value,
           record_version = GREATEST(courtedge_kv.record_version, EXCLUDED.record_version),
           content_hash = EXCLUDED.content_hash,
           updated_at = NOW()
         WHERE courtedge_kv.record_version <= EXCLUDED.record_version
            OR ($5::boolean = true)`,
        [
          key,
          JSON.stringify(value),
          recordVersion,
          contentHash,
          options.force === true,
        ]
      );
      lastDurableWriteAt = new Date().toISOString();
      lastDurableError = null;
      return { ok: true, source: "postgres", contentHash, recordVersion };
    } catch (error) {
      lastDurableError = String(error?.message || error);
      return {
        ok: true,
        source: "filesystem-fallback",
        contentHash,
        recordVersion,
        warning: lastDurableError,
      };
    }
  }
  lastDurableWriteAt = new Date().toISOString();
  return {
    ok: true,
    source: backendType || "filesystem",
    contentHash,
    recordVersion,
  };
}

export async function durableGetIdempotent(idempotencyKey) {
  const pool = await ensurePg();
  if (pool) {
    try {
      const res = await pool.query(
        "SELECT result FROM courtedge_idempotency WHERE idempotency_key = $1",
        [idempotencyKey]
      );
      if (res.rows[0]) return { ok: true, hit: true, result: res.rows[0].result };
    } catch (error) {
      lastDurableError = String(error?.message || error);
    }
  }
  const file = readJsonSafe(filePathForKey(DURABLE_KEYS.IDEMPOTENCY), { keys: {} });
  const hit = file?.keys?.[idempotencyKey];
  if (hit) return { ok: true, hit: true, result: hit };
  return { ok: true, hit: false, result: null };
}

export async function durablePutIdempotent(idempotencyKey, result) {
  const pool = await ensurePg();
  if (pool) {
    try {
      await pool.query(
        `INSERT INTO courtedge_idempotency (idempotency_key, result, created_at)
         VALUES ($1, $2::jsonb, NOW())
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [idempotencyKey, JSON.stringify(result)]
      );
    } catch (error) {
      lastDurableError = String(error?.message || error);
    }
  }
  const file = readJsonSafe(filePathForKey(DURABLE_KEYS.IDEMPOTENCY), { keys: {} });
  if (!file.keys) file.keys = {};
  if (!file.keys[idempotencyKey]) {
    file.keys[idempotencyKey] = result;
    atomicWriteJson(filePathForKey(DURABLE_KEYS.IDEMPOTENCY), file);
    try {
      atomicWriteJson(mirrorPathForKey(DURABLE_KEYS.IDEMPOTENCY), file);
    } catch {
      // ignore
    }
  }
  return { ok: true };
}

export async function withDurableLock(lockKey, fn, options = {}) {
  const owner = options.owner || `pid-${process.pid}`;
  const ttlMs = Number(options.ttlMs || 20 * 60 * 1000);
  const pool = await ensurePg();
  if (pool) {
    const expires = new Date(Date.now() + ttlMs).toISOString();
    try {
      await pool.query(`DELETE FROM courtedge_locks WHERE expires_at < NOW()`);
      const existing = await pool.query(
        "SELECT owner, expires_at FROM courtedge_locks WHERE lock_key = $1",
        [lockKey]
      );
      if (existing.rows[0] && existing.rows[0].owner !== owner) {
        return { ok: false, reason: "lock_held", result: null };
      }
      await pool.query(
        `INSERT INTO courtedge_locks (lock_key, owner, acquired_at, expires_at)
         VALUES ($1, $2, NOW(), $3::timestamptz)
         ON CONFLICT (lock_key) DO UPDATE SET
           owner = EXCLUDED.owner,
           acquired_at = NOW(),
           expires_at = EXCLUDED.expires_at`,
        [lockKey, owner, expires]
      );
      try {
        const result = await fn();
        return { ok: true, result };
      } finally {
        await pool.query(
          "DELETE FROM courtedge_locks WHERE lock_key = $1 AND owner = $2",
          [lockKey, owner]
        );
      }
    } catch (error) {
      lastDurableError = String(error?.message || error);
      // fall through to file lock
    }
  }
  // File lock fallback (restart-aware via expiresAt)
  const locksPath = filePathForKey(DURABLE_KEYS.STATE_LOCKS);
  const locks = readJsonSafe(locksPath, { locks: {} });
  if (!locks.locks) locks.locks = {};
  const now = Date.now();
  const held = locks.locks[lockKey];
  if (held && held.owner !== owner && Date.parse(held.expiresAt || 0) > now) {
    return { ok: false, reason: "lock_held", result: null };
  }
  locks.locks[lockKey] = {
    owner,
    acquiredAt: new Date().toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
  };
  atomicWriteJson(locksPath, locks);
  try {
    const result = await fn();
    return { ok: true, result };
  } finally {
    const latest = readJsonSafe(locksPath, { locks: {} });
    if (latest.locks?.[lockKey]?.owner === owner) {
      delete latest.locks[lockKey];
      atomicWriteJson(locksPath, latest);
    }
  }
}

/**
 * Hydrate local working files from durable Postgres on startup.
 * Precedence: durable completed > local seed/bundle.
 */
export async function hydrateWorkingFilesFromDurableStore(options = {}) {
  const keys = options.keys || Object.values(DURABLE_KEYS);
  const actions = [];
  const pool = await ensurePg();
  for (const key of keys) {
    const remote = await durableGet(key);
    const localPath = filePathForKey(key);
    const local = readJsonSafe(localPath, null);
    if (!remote.ok || remote.value == null) {
      if (local != null && pool) {
        await durablePut(key, local, { recordVersion: 1 });
        actions.push({ key, action: "seeded_remote_from_local" });
      } else {
        actions.push({ key, action: "missing_both" });
      }
      continue;
    }
    const preferred = choosePreferredRecord(remote.value, local, {
      fromBundle: remote.source === "filesystem" && options.treatLocalAsBundle,
    }, {
      fromBundle: options.treatLocalAsBundle,
      emptyInit: local == null,
    });
    if (preferred === remote.value) {
      atomicWriteJson(localPath, remote.value);
      try {
        atomicWriteJson(mirrorPathForKey(key), remote.value);
      } catch {
        // ignore
      }
      actions.push({
        key,
        action: "restored_from_durable",
        source: remote.source,
      });
    } else {
      await durablePut(key, local, {
        recordVersion: Number(local?.recordVersion || 2) || 2,
      });
      actions.push({ key, action: "kept_local_newer", source: "local" });
    }
  }
  lastStartupRecovery = {
    at: new Date().toISOString(),
    actions,
    backend: backendType || (pool ? "postgres" : "filesystem"),
  };
  return lastStartupRecovery;
}

export function syncKeyToDurableFireAndForget(key, value, options = {}) {
  Promise.resolve()
    .then(() => durablePut(key, value, options))
    .catch((error) => {
      lastDurableError = String(error?.message || error);
    });
}

export function resetDurableStoreForTests() {
  pgPool = null;
  pgReady = null;
  pgFailed = false;
  lastDurableWriteAt = null;
  lastDurableError = null;
  lastStartupRecovery = null;
  backendType = null;
}
