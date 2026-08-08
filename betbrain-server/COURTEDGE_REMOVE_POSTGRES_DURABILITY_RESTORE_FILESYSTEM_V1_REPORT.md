# COURTEDGE_REMOVE_POSTGRES_DURABILITY_RESTORE_FILESYSTEM_V1_REPORT

Build: `courteedge-remove-postgres-durability-restore-filesystem-v1`  
Live `serverBuild`: `courteedge-filesystem-production-restored-v1`  
Checkpoint tag: `courteedge-pre-remove-postgres-durability-v1` @ `94f576b`  
Rollback branch: `rollback/courteedge-pre-remove-postgres-durability-v1`

## Removed

- `services/courtEdgePostgres/canonicalStoreV1.js`
- `services/courtEdgePostgres/migrations/001_courtedge_canonical_v1.sql`
- `scripts/migrateCourtEdgeFilesystemToPostgresV1.js`
- `scripts/testCourtEdgePostgresDurabilityV1.js`
- Postgres refresh seal / fail-on-DB path in `server.js`
- Canonical Postgres startup migrate/restore/freeze-to-DB block
- `POST/GET /admin/postgres-durability-probe` and `2099-01-15` fixture
- `/health` / `/ready` Postgres readiness gates and `POSTGRES_PRIMARY` / `FILESYSTEM_FALLBACK` authority switching
- Blueprint `DATABASE_URL` `fromDatabase` wiring and `databases:` section from `betbrain-server/render.yaml` and root `render.yaml`
- Accidental Postgres activation in `courtEdgeDurableStoreV1` unless `COURTEDGE_ALLOW_POSTGRES_DURABLE=true`

## Preserved

- C2 champion `EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2`
- Ceremony hash `11fe26e8ecea79eab6183cc631d4a349f6dd6f9f4290ac70fafbbe9737d5fb14` (LF accepted `4f563a92…`)
- LOW/MEDIUM Official, HIGH research-only rules (engine untouched)
- Research packet filesystem persistence
- Scheduler (no Postgres dependency)
- Startup health fix (`bootPhase`, deferred hydrate, yields, Render-safe `/health`)
- Aug 7 prospective lock (`PROSPECTIVE_SLATE_LOCKED`) and freeze `frozenAt=2026-08-07T20:08:44.951Z` `immutable=true`
- Blueprint service name `betbrain-api` unchanged (no rename / no new service)

## Health (live)

```text
serverBuild=courteedge-filesystem-production-restored-v1
ready=true
persistenceMode=FILESYSTEM_PRIMARY
durableBackend=filesystem
championModel=EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2
calibrationHash=11fe26e8ecea79eab6183cc631d4a349f6dd6f9f4290ac70fafbbe9737d5fb14
/ready HTTP 200
```

## Tests

Script: `scripts/testCourtEdgeFilesystemProductionRestoredV1.js`

| Result | Count |
|--------|-------|
| PASS | 7 |
| FAIL | 0 |

Covered: no DATABASE_URL boot path, FILESYSTEM_PRIMARY source, render.yaml clean, Postgres files gone, durable store ignores stray DATABASE_URL, C2 hash, Aug7 lock/freeze, deterministic C2 packet rescore identity.

Local startup: health 200, ready 200, FILESYSTEM_PRIMARY, C2 active.  
Live: postgres durability probe routes absent (404). No Aug 7 refresh performed.

## Deploy

- Commit: `f58ea0e`
- Branches: `upgrade/courteedge-empirical-safe-prop-v2`, `betbrain-v2-rebuild`
- Checkpoint tag: `courteedge-pre-remove-postgres-durability-v1` @ `94f576b`
- Live runtimeCommit: `f58ea0ee812462f2822bf8f860d66d6222348511`

## Verdict

`COURTEDGE_FILESYSTEM_PRODUCTION_RESTORED_PASS`
