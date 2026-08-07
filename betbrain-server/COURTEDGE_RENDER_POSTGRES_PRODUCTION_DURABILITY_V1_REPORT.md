# COURTEDGE_RENDER_POSTGRES_PRODUCTION_DURABILITY_V1_REPORT

Build: `courteedge-render-postgres-production-durability-v1`  
Model freeze: `EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2` (coefficients **unchanged**)  
Ceremony calibration hash: `11fe26e8ecea79eab6183cc631d4a349f6dd6f9f4290ac70fafbbe9737d5fb14`  
LF-canonical hash (same bytes): `4f563a9218781f7232094a65eb8ac2c56ba396b000d41e1af9fa49cf8f174da2`

## Verdict

```text
COURTEDGE_RENDER_POSTGRES_DURABILITY_BLOCKED
```

**Blocker:** Live Render service `betbrain-server-1` still has `databaseUrlConfigured=false`. Application code, schema, seal/restore, migrator, and tests are shipped, but production cannot become Postgres-authoritative until `DATABASE_URL` is linked.

---

## A. Root cause

1. **Why state vanished:** Render instance filesystem is ephemeral; after deploy/restart, runtime JSON starts empty. No Postgres connection meant nothing durable to restore.
2. **Ephemeral FS authoritative?** **Yes** on live (`durableStore.type=filesystem`).
3. **Persistent disk?** **No** in `render.yaml`.
4. **`DATABASE_URL` before?** Declared in Blueprint for service name `betbrain-api`, **not present** on live `betbrain-server-1`.
5. **Postgres reachable before?** **No** (`postgresHealthy=false`).

See also: `COURTEDGE_RENDER_PERSISTENCE_AUDIT_V1.md`.

---

## B. Storage audit

Documented in audit file. Critical FS-only gaps before this mission: `locked-slates.json`, `slate-snapshots/`, `history-archive/`.

**After this mission (when DB linked):**

| Domain | Authority |
|--------|-----------|
| Official / research / Results / locks / model+research freezes | **Postgres canonical tables** |
| KV board/tracked/scheduler | Existing `courtedge_kv` (still useful) |
| Local JSON | Optional mirror / export / forensics |

---

## C. Postgres

| Item | Status |
|------|--------|
| Provider | Render Postgres `courtedge-durable-db` (Blueprint) |
| Connection health (live) | **Not connected** |
| Tables | Migration `001_courtedge_canonical_v1`: `courtedge_slates`, `courtedge_official_props`, `courtedge_research_props`, `courtedge_results`, `courtedge_slate_locks`, `courtedge_model_freezes`, `courtedge_research_freezes`, `courtedge_schema_migrations` (+ existing KV tables) |
| Indexes | date/status/event/player/grade/risk/calibration + unique identities |
| Migration version | `001_courtedge_canonical_v1` |
| Schema checksum | Computed at apply time (SHA-256 of SQL file) |

### Required human step

Render Dashboard → **betbrain-server-1** → Environment → **Link Database** `courtedge-durable-db`  
(or paste Internal Database URL as `DATABASE_URL`) → Manual Deploy / restart.

---

## D. Migration

Tool: `scripts/migrateCourtEdgeFilesystemToPostgresV1.js` (`DRY_RUN=true` default).

- Skips Aug 5 as `QUARANTINED`
- Skips Aug 7 Official (research freeze path only)
- Historical Official import only when `DRY_RUN=false` and DB ready

Full import counts: **pending until DATABASE_URL is live**.

---

## E. Serving architecture (intended)

| Surface | Source |
|---------|--------|
| Home | Restore sealed Official from Postgres; board cache is mirror |
| Results | `courtedge_results` → Official prop IDs |
| History | Sealed/COMPLETE slates in Postgres |
| Research | `courtedge_research_props` + research freezes |
| Locks | `courtedge_slate_locks` (REGENERATE blocked ≠ RESTORE blocked) |
| Model freeze | `courtedge_model_freezes` + repo champion lock |

---

## F. Startup

- `/health` remains sync / fail-open (no await on Postgres)
- `/ready` awaits canonical durable health (503 if prod without Postgres)
- Startup: KV hydrate → canonical migrate → restore today → optional Aug 7 research freeze persist
- **No Odds refresh** on deploy; Aug 7 regenerate still locked

---

## G. C2 verification

| Check | Status |
|-------|--------|
| V2 enabled | Yes (flag default / env) |
| Champion | `EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2` |
| Calibration hash identity | Ceremony `11fe26e8…` exposed on `/health` |
| Coefficients / LOW / MEDIUM / HIGH rules | **Not modified** (hashed engine files untouched) |
| HIGH blocked from Official | Yes |
| No fixed six | Yes (C2 path) |

---

## H. Durability tests

`scripts/testCourtEdgePostgresDurabilityV1.js`

| Test | Without DATABASE_URL | With DATABASE_URL |
|------|----------------------|-------------------|
| No URL → not ready | PASS | PASS |
| Aug 7 Official seal forbidden | PASS (or PERSISTENCE_FAILED) | PASS |
| Seal + read-back | skipped | runs |
| Idempotent reseal | skipped | runs |
| Restore + Home/Results IDs | skipped | runs |
| HIGH research separation | skipped | runs |
| Aug 7 research freeze not Official | skipped | runs |
| Instance replacement restore | skipped | runs |
| Postgres failure blocks fake success | skipped | runs |

---

## I. August 7

| Check | Status |
|-------|--------|
| No Odds refresh | Enforced (`PROSPECTIVE_SLATE_LOCKED`) |
| No retroactive Official | `AUG7_OFFICIAL_SEAL_FORBIDDEN` |
| Research freeze preserved | Startup persists to `courtedge_research_freezes` when DB ready |
| `official_record_eligible` | **false** |

---

## J. Live Render (pre-link)

| Field | Value |
|-------|-------|
| Deploy commit (prior) | `fd142e6` (pre-durability) / this report’s commit after push |
| `databaseUrlConfigured` | **false** (blocker) |
| `postgresHealthy` | **false** |
| `durableBackend` | filesystem |
| Model identity | C2 live |

After linking DB and deploying this build, expected `/ready`:

```text
ready=true
databaseUrlConfigured=true
postgresHealthy=true
durableBackend=postgres
championModel=EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2
calibrationHash=11fe26e8ecea79eab6183cc631d4a349f6dd6f9f4290ac70fafbbe9737d5fb14
```

---

## Code delivered

- `services/courtEdgePostgres/migrations/001_courtedge_canonical_v1.sql`
- `services/courtEdgePostgres/canonicalStoreV1.js` (seal / restore / research freeze / export / health)
- `scripts/migrateCourtEdgeFilesystemToPostgresV1.js`
- `scripts/testCourtEdgePostgresDurabilityV1.js`
- `server.js` — build id, `/ready`, startup migrate/restore, refresh seal path
- `render.yaml` — notes + `COURTEDGE_ALLOW_FS_PROD=false`
- Audit + this report

## Acceptance checklist (current)

```text
✓ C2 unchanged
✓ Ceremony hash identity retained (11fe26e8…)
✓ Schema + transactional seal + read-back implemented
✓ Production readiness gate implemented
✓ Aug 7 Official forbidden; research-only path implemented
✓ No Aug 7 Odds refresh
✗ Live Postgres not connected → not production authority yet
✗ Full restart/filesystem-wipe proofs pending DATABASE_URL
✗ Historical migration execute pending DATABASE_URL
```

```text
COURTEDGE_RENDER_POSTGRES_DURABILITY_BLOCKED
```
