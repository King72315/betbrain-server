# COURTEDGE_RENDER_PERSISTENCE_AUDIT_V1

Build target: `courteedge-render-postgres-production-durability-v1`  
Audit date: 2026-08-07 (America/Chicago)  
Production host: `https://betbrain-server-1.onrender.com`  
Live commit at audit: `fd142e6`

## Executive finding

Production is healthy on Calibration 2, but **serving state is not durable**.

Live `/health` at audit:

| Field | Value |
|-------|-------|
| `durableStore.type` | `filesystem` |
| `databaseUrlConfigured` | **false** |
| `postgresHealthy` | **false** |
| `homeDurable.durableActive` | **false** |
| `homeDurable.lastHomeHydrate.todayCount` | **0** |

`render.yaml` declares Postgres `courtedge-durable-db` and wires `DATABASE_URL` to Blueprint service name **`betbrain-api`**. The live service is **`betbrain-server-1`**. Blueprint DB linkage is therefore not applied to the running instance (or was never synced). No Render persistent disk is configured.

Result after deploy/restart: empty Home / tracked / Results until a legal refresh rebuilds state — and Aug 7 refresh is intentionally locked.

## Root cause (short)

1. **Ephemeral filesystem is still production authority** when Postgres is not connected.
2. **`DATABASE_URL` is not configured on the live Render web service** (`databaseUrlConfigured=false`).
3. Critical stores (`locked-slates.json`, `slate-snapshots/`, `history-archive/`) were never in the Postgres KV map.
4. Aug 7 was never sealed as a live Official slate; prospective freeze ≠ Home membership.

## Environment audit

| Question | Answer |
|----------|--------|
| `DATABASE_URL` configured on live service? | **No** |
| Postgres client in app? | Yes (`pg` + `courtEdgeDurableStoreV1.js`) |
| Postgres reachable from live? | **No** (not configured) |
| Persistent Render disk? | **No** (`render.yaml` has no `disk:`) |
| Filesystem path for runtime state? | `betbrain-server/*.json`, `slate-snapshots/`, `history-archive/`, `active-bundles/`, `research/...` |
| What disappears after deploy? | All uncommitted runtime JSON/dirs on the instance |

## Storage inventory

| Path / key | Purpose | Authoritative before | Mirror? | Startup dep? | Disappears on Render? |
|------------|---------|----------------------|---------|---------------|------------------------|
| `tracked-props.json` / KV `tracked-props` | Official/Results rows + grades | Local FS; PG if synced | Yes when PG | Yes | Local yes; PG recover if synced |
| `locked-slates.json` | Lock registry / phases | **FS only** | No | Yes | **Yes — critical gap** |
| `board-cache.json` / KV `board-cache` | Home board LKG | Local; PG if synced | Yes | Yes | Local yes |
| `home-day__*` KV | Today/Tomorrow Home | PG when healthy | Mirror dir | Yes | Survives only with PG |
| `slate-snapshots/` | Seal-time Official snapshot | **FS only** | No | Yes | **Yes** |
| `history-archive/` | Graded archives | **FS only** | No | Soft | **Yes** |
| `active-bundles/` | Git-shipped recovery | Recovery source | No | Fallback | Uncommitted yes; committed survive |
| `daily-slate-reports.json` | Lab/Results reports | FS; weak PG | Mapped, no write sync | Soft | Yes |
| `courtedge-scheduler-state-v1.json` | Scheduler | PG if synced | Yes | Yes | Local yes |
| `canonical-slates-v1.json` | Canonical store | PG if synced | Yes | Yes | Local yes |
| Research packets / prospective freezes | Research immutables | FS / git | No | Soft | Runtime yes; git survive |
| `calibration2ChampionLock.json` | C2 champion identity | Repo artifact | No | Soft | No (in deploy) |
| Model coefficients (`empiricalSafePropV2/*`) | C2 freeze | Code | N/A | N/A | No |

## Existing Postgres surface (pre-mission)

Tables created by `courtEdgeDurableStoreV1` when URL present:

- `courtedge_kv` (opaque JSON blobs)
- `courtedge_locks`
- `courtedge_idempotency`

This is **not** a canonical slate membership schema. It cannot guarantee Official/Results/History relational integrity or transactional seal.

## Calibration identity (do not change model)

| Item | Value |
|------|-------|
| Champion | `EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2` |
| Ceremony hash (Windows-raw) | `11fe26e8ecea79eab6183cc631d4a349f6dd6f9f4290ac70fafbbe9737d5fb14` |
| LF-canonical hash (Render) | `4f563a9218781f7232094a65eb8ac2c56ba396b000d41e1af9fa49cf8f174da2` |
| Meaning | Same engine bytes; newline normalization only |

Mission must **not** modify C2 coefficients / thresholds. Hash reporting may expose both; coefficients stay frozen.

## August 7

- In `prospectiveLockedSlateDates` → regenerate/Odds refresh blocked.
- No live Official membership was sealed for Aug 7.
- Prospective research freeze may be stored as `RESEARCH_FREEZE` / `official_record_eligible=false` only.

## Required infrastructure action (human / dashboard)

Live service `betbrain-server-1` must receive:

```text
DATABASE_URL=<connection string from courtedge-durable-db>
```

Options:

1. Render Dashboard → `betbrain-server-1` → Environment → Link Database `courtedge-durable-db`, or paste Internal Database URL.
2. Or sync Blueprint so the web service that actually runs production includes `fromDatabase: courtedge-durable-db`.

Until that is done, application code cannot make Postgres healthy in production.

## Mission direction after audit

1. Add versioned relational schema (slates, official/research props, locks, model/research freezes).
2. Make Postgres required for production Official seal / durable readiness.
3. Restore/serve from Postgres; keep regenerate locks separate from restore.
4. Filesystem becomes optional mirror only.
5. One-time FS→PG migrator (dry-run default); no Aug 7 Official retroactive seal.
