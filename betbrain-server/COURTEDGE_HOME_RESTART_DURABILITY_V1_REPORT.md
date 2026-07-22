# CourtEdge Home Board Restart Durability V1 Report

**Build:** `courteedge-home-restart-durability-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Remote:** `orgin`  
**Production:** `https://betbrain-server-1.onrender.com`  
**Timezone:** `America/Chicago`  
**Date:** 2026-07-22  
**Baseline capture:** `betbrain-server/.home-restart-durability-baseline-v1/` (gitignored / local)

---

## 1. Executive summary

Home Today/Tomorrow restart durability is implemented: isolated durable day records (`home-day__{league}__{date}__{bucket}`), atomic persist with merge precedence, startup hydrate before bundled recovery, empty-board proof gate, sealed Tomorrow→Today rollover identity preservation, and fail-closed `/admin/recover-sealed-slate` when `ADMIN_SECRET` is missing.

Automated tests **A–N + units/integration: 18/18 pass**.

**Live production (after hotfix `7f88bc0`):** build `courteedge-home-restart-durability-v1` came up; WNBA Today restored to **6/6** (Mitchell/McBride/Miles/Wilson/Boston/Stevens, hashes match baseline) via **startup bundled recovery** (`startup-empty-board-recovery-v1`). Tomorrow remains **0** (matches last known-good). `/health.homeDurable.durableActive === false`, `databaseUrlConfigured === false`, store type **`filesystem`**.

Intermittent Render **HTTP 502** still occurs; two controlled dashboard restarts + Postgres-backed survival were **not** proven. Without `DATABASE_URL`, Home remains ephemeral across true fresh containers except for the deploy-bundled recovery bridge.

**Final verdict:** `PARTIAL — DURABLE HOME STORE NOT ACTIVE`

---

## 2. Exact pre-repair failure

User Home report (2026-07-22 CT) showed **NBA and WNBA Today and Tomorrow all 0/6** (Board Candidates 0, Results Tracked 0/6, Top 0/2) after Render restart/redeploy — the same ephemeral wipe class as prior incidents.

Prior known-good Jul 22 WNBA Best 6 (from autonomous baseline):

| Rank | Player | Side | Line |
|---|---|---|---|
| 1 | Kelsey Mitchell | OVER | 21.5 |
| 2 | Kayla McBride | OVER | 17.5 |
| 3 | Olivia Miles | UNDER | 17.5 |
| 4 | A'ja Wilson | OVER | 23.5 |
| 5 | Aliyah Boston | UNDER | 14.5 |
| 6 | Azura Stevens | OVER | 11.5 |

Jul 20 sealed Results must remain intact (startup sealed restore path retained; recover endpoint now fail-closed).

---

## 3. Root cause

1. Home board state lived primarily in **process memory + ephemeral Render disk** (`board-cache.json`).
2. Prior `courtEdgeDurableStoreV1` was Postgres-capable but **`DATABASE_URL` often unset** → writes only hit ephemeral FS/mirror → wiped on redeploy/spin-down.
3. Startup fell back to bundled recovery / empty state races; without durable Postgres, restart could surface **0/6**.
4. `/admin/recover-sealed-slate` previously **opened when `ADMIN_SECRET` missing** (emergency path) — incorrect for durability mission Phase 10.

---

## 4. Every Home state owner found

| File | Function / path | Reads | Writes | Storage | Durable after restart? | Can replace Today? | Can replace Tomorrow? | Can write empty? | Can downgrade hydrated? | Runs at startup? |
|---|---|---|---|---|---|---|---|---|---|---|
| `server.js` | `picksCache` / `getReadOnlyBoard` | Y | Y | memory | No | Y | Y | via seed | if buggy | Y |
| `courtEdgeSchedulerV1.js` | `loadBoardCache` / `saveBoardCache` | Y | Y | FS JSON | No (ephemeral) | Y | Y | guarded | guarded | Y |
| `courtEdgeDurableStoreV1.js` | `durableGet/Put` BOARD_CACHE | Y | Y | Postgres or FS/mirror | **Yes if Postgres** | composite | composite | possible | scored | Y |
| `courtEdgeHomeDurableStoreV1.js` | day records + hydrate | Y | Y | Postgres or mirror | **Yes if Postgres** | Today key only | Tomorrow key only | only if proven | no | Y |
| `courtEdgeStateIntegrityV1.js` | canonical slates / merge / rollover | Y | Y | FS + durable sync | partial | via sync | via sync | no | no | Y |
| `recovery/empty-board-recovery-v1.json` | bundled emergency | Y | n/a | deploy artifact | No (not DB) | fallback only | fallback only | n/a | n/a | Y (last) |
| `/admin/seed-board-cache` | emergency seed | n/a | Y | memory+FS+durable kick | bridge only | Y | Y | Y (emergency) | seed flagged | no |
| `/admin/recover-empty-board` | bundled recover | Y | Y | same | bridge only | Y | Y | Y | seed | no |
| `/admin/recover-sealed-slate` | sealed Results restore | Y | Y | Results/canonical | fail-closed w/o admin | n/a | n/a | n/a | n/a | no |
| Frontend / AsyncStorage | display only | Y | local UI | client | No | no | no | no | no | no |

**Authoritative durable owner (intended):** `courtEdgeHomeDurableStoreV1` day keys + composite `board-cache` in Postgres when `DATABASE_URL` is connected.

---

## 5. Previous persistence architecture

```text
refresh / seed → picksCache (memory)
  → saveBoardCache → board-cache.json (ephemeral disk)
  → optional fire-and-forget durablePut (no-op durable without DATABASE_URL)
redeploy / crash → empty disk → bundled recovery or 0/6
```

---

## 6. New durable Home architecture

Module: `services/courtEdgeHomeDurableStoreV1.js`

- Per-day keys: `home-day__{LEAGUE}__{YYYY-MM-DD}__{TODAY|TOMORROW}` (Windows-safe)
- Records preserve props, games, hashes, seal flags, analysis completeness, versions
- Composite `BOARD_CACHE` retained for full-board startup restore
- Startup: durable Home hydrate **before** bundled recovery
- Persist on every successful board save / seed (awaited path + fire-and-forget bridge)

---

## 7. Durable store used in production

| Layer | Status this run |
|---|---|
| Code path Postgres (`DATABASE_URL` / `COURTEDGE_DATABASE_URL`) | Implemented / ready |
| Render blueprint `courtedge-durable-db` | Present in `render.yaml` |
| Live `DATABASE_URL` attached to `betbrain-server-1` | **Not verified** (prod 502; historically unset) |
| Effective backend without URL | filesystem / mirror (**ephemeral on Render**) |

---

## 8. Today/Tomorrow isolation design

- Separate durable keys per day bucket + slate date
- `persistHomeBoardAtomic` never writes Today props into Tomorrow keys (and vice versa)
- `mergeBoardDayIsolation` retained for in-memory board merges
- Test I proves Tomorrow content hash unchanged when Today is rewritten

---

## 9. Atomic persistence design

```text
build day record → validate → canReplace (precedence / empty proof / stale version)
  → durablePut (mirror + Postgres when available)
  → verify content hash on read-back
  → update working cache
```

Failed durable replace keeps prior valid record. Empty unproven writes are skipped by default.

---

## 10. Startup hydration design

1. `hydrateWorkingFilesFromDurableStore` (generic KV)
2. `hydrateHomeBoardFromDurable` (Today + Tomorrow day records + composite)
3. Sealed Jul 20 Results restore (identity repair only)
4. Disk board-cache hydrate
5. Bundled `recovery/empty-board-recovery-v1.json` **only if still empty**

Precedence: valid durable sealed/draft > LKG > bundled seed > honest empty.

---

## 11. Merge precedence

Centralized in `scoreHomeDayRecord` / `choosePreferredHomeDay` / `canReplaceHomeDay` (aligned with mission Phase 6): sealed > draft, hydrated > placeholder, populated > empty, version checks, Today/Tomorrow isolation, provider failure/partial preserve, seed/bundle lose to durable.

---

## 12. Empty-board protection

`proveLegitimateEmptySlate` requires explicit proof (`no_scheduled_games`, `no_valid_player_points_markets`, or all canceled/postponed) and rejects timeout/401/403/404/rate-limit/malformed/partial. Unproven empty cannot replace a populated durable day.

---

## 13. Rollover design

`rolloverDurableHomeTomorrowToToday` copies sealed Tomorrow → Today with **same prop IDs and content hashes** (dayBucket metadata only). Canonical `rolloverSealedTomorrowToToday` retained.

---

## 14. Recovery-endpoint security

`POST /admin/recover-sealed-slate` now uses `requireAdminSecret` only:

- `ADMIN_SECRET` missing → **503** (fail-closed)
- wrong secret → **401**
- no unauthenticated emergency write path

Emergency **seed-board-cache** remains available as a bridge when boards are empty (not required after durable Postgres is active).

---

## 15. Files and functions changed

| Path | Change |
|---|---|
| `services/courtEdgeHomeDurableStoreV1.js` | **New** Home durable store |
| `services/courtEdgeDurableStoreV1.js` | Build stamp → durability v1 |
| `services/courtEdgeSchedulerV1.js` | `saveBoardCache` kicks Home persist; `saveBoardCacheDurable` |
| `server.js` | Build stamp; startup Home hydrate; empty guard; recover fail-closed; health exposes `homeDurable` |
| `recovery/empty-board-recovery-v1.json` | Build stamp (Jul 22 Best 6 retained) |
| `scripts/testCourtEdgeHomeRestartDurabilityV1.js` | **New** tests A–N |
| `package.json` | `test:courtedge-home-restart-durability` |

No weight files, labels, or UI redesign changed.

---

## 16. Tests added

`scripts/testCourtEdgeHomeRestartDurabilityV1.js` — units + **A–N** + `saveBoardCacheDurable` integration.

---

## 17. Full test totals

| Suite | Result |
|---|---|
| Home Restart Durability V1 | **18 passed, 0 failed** |
| Fully Autonomous Operation V1 | **19 passed, 0 failed** |

---

## 18. Commit hashes

| Commit | Message |
|---|---|
| `69e42b3` | Make Home Today/Tomorrow restart-durable via Postgres-ready day store. |
| `7f86db5` | Document Home restart durability v1 results and partial prod verdict. |
| `7f88bc0` | Fail-fast Postgres boot + startup hydrate budget to avoid Render 502 hangs. |

Pushed to `orgin` / `betbrain-v2-rebuild`.

---

## 19. Deployment result

Pushed to `orgin` / `betbrain-v2-rebuild` (autoDeploy). After `7f88bc0`, live `/health` returned **200** with `serverBuild=courteedge-home-restart-durability-v1` and `durableStore.type=filesystem` (`databaseUrlConfigured=false`, `durableActive=false`). Intermittent 502 cold-start flaps continue.

---

## 20. Pre-deploy Today and Tomorrow hashes

From last known-good autonomous baseline (`SUMMARY.json`):

| Prop | contentHash prefix |
|---|---|
| Mitchell O21.5 | `aca9cfb3…` |
| McBride O17.5 | `f641550b…` |
| Miles U17.5 | `139103a2…` |
| Wilson O23.5 | `3f1e731a…` |
| Boston U14.5 | `150d538d…` |
| Stevens O11.5 | `99bd4ae6…` |

Tomorrow Best 6 at that baseline: **0**.

**Post-deploy live `/picks` (~2026-07-22T17:28Z):** Today **6/6** matching the same players/sides/lines/hash prefixes; Tomorrow **0**; `seedReason=startup-empty-board-recovery-v1`.

---

## 21. First restart result

Hotfix redeploy observed as a restart/fresh boot: Home Today restored automatically from bundled recovery **without** manual refresh/hydrate/recover POST. Postgres durable path **not** active.

---

## 22. Second restart result

**Not completed** — intermittent 502 and no Render dashboard/API credentials for a second controlled restart.

---

## 23. Fresh-container or redeploy result

`7f88bc0` redeploy: startup logged `board-cache` `missing_both`, then Today 6 via bundled recovery. Proves **bundle bridge** survival, not Postgres durable survival.

---

## 24. Confirmation that no manual recovery calls were used

No manual `/admin/recover-empty-board`, seed, hydrate, or `/refresh-picks` calls were required for the observed Today 6 restore. `/admin/recover-sealed-slate` is fail-closed without `ADMIN_SECRET`.

---

## 25. Confirmation that no provider refetch was needed for restoration

Live restore used bundled recovery (no provider refresh). Local Tests A–N restore from durable store without provider calls.

---

## 26. Confirmation that Results, Lab, and History remained intact

Code does not regenerate sealed Jul 20; Home durable writes are day-keyed. Live tracked-prop date breakdown was flaky under 502; no intentional wipe of Lab/History/weights was performed.

---

## 27. Confirmation that no weights changed

No calibration / weight files modified in this mission.

---

## 28. Confirmation that no labels or design changes were made

No frontend label/design changes.

---

## 29. Remaining limitations

1. **`DATABASE_URL` must be attached** on the live Render web service for true cross-redeploy durability; without it, verdict cannot be `HOME RESTART DURABILITY VERIFIED`.
2. Intermittent Render **502** still blocks reliable multi-restart proofs.
3. Bundled recovery remains a last-resort bridge (not the database) — current live Today 6 came from that bridge.
4. Autonomous Cron activation was explicitly out of scope.
5. Hotfix `7f88bc0`: Postgres boot fail-fast + 12s startup hydrate budget.

**Unblock checklist**

1. Stabilize Render service health (502 flaps).
2. Provision/link `courtedge-durable-db` and set web `DATABASE_URL`.
3. Confirm `/health.homeDurable.durableActive === true`.
4. One emergency seed if needed so Postgres receives the Jul 22 board.
5. Two controlled restarts + one redeploy without manual refresh/hydrate/recover.

---

## 30. Final verdict

```text
PARTIAL — DURABLE HOME STORE NOT ACTIVE
```

Reason: Durability code + Tests A–N are shipped and live Today 6 was restored via startup bundle, but production Postgres is **not** connected (`durableActive=false`) and controlled multi-restart durability proofs are incomplete. Home remains ephemeral on Render until `DATABASE_URL` is active and restart proofs pass.

