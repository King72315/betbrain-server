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

Automated tests **A–N + units/integration: 18/18 pass**. Prior autonomous suite **19/19 pass**.

**Production could not complete restart verification in this run:** Render returned continuous **HTTP 502** (`x-render-routing: dynamic-paid-error`) so live restore, two controlled restarts, and fresh-container proofs against prod were blocked. `DATABASE_URL` was not confirmed connected on the live service (same class of failure as prior autonomous ops: filesystem/ephemeral without Postgres).

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

(Filled at commit time — see git log on `betbrain-v2-rebuild` for `courteedge-home-restart-durability-v1`.)

---

## 19. Deployment result

Push to `orgin` / `betbrain-v2-rebuild` triggers Render autoDeploy. **Live health remained HTTP 502** during this mission (`dynamic-paid-error`), so deploy completion and post-deploy board restore could not be confirmed from the agent.

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

Tomorrow Best 6 at that baseline: **0** (no Tomorrow cohort to hash).

Live pre-deploy capture on this run: **unavailable (502)**.

---

## 21. First restart result

**Not executed** — production unreachable (502).

---

## 22. Second restart result

**Not executed** — production unreachable (502).

---

## 23. Fresh-container or redeploy result

**Not executed** against live Render. Local Test D simulates fresh container restore from durable mirror and **passes**.

---

## 24. Confirmation that no manual recovery calls were used

No successful live recovery/seed/refresh calls were possible (502). Code paths no longer require recover-sealed for normal Home restart once Postgres is active. Emergency seed remains a bridge only.

---

## 25. Confirmation that no provider refetch was needed for restoration

Local durability tests restore from durable store **without provider calls**. Live confirmation blocked by 502.

---

## 26. Confirmation that Results, Lab, and History remained intact

No live mutation verified (502). Code does not regenerate sealed Jul 20; startup sealed restore is identity-preserving; Home durable writes are day-keyed and do not wipe Lab/History stores.

---

## 27. Confirmation that no weights changed

No calibration / weight files modified in this mission.

---

## 28. Confirmation that no labels or design changes were made

No frontend label/design changes.

---

## 29. Remaining limitations

1. **`DATABASE_URL` must be attached** on the live Render web service for true cross-redeploy durability; without it, verdict cannot be `HOME RESTART DURABILITY VERIFIED`.
2. Live Render **502 / dynamic-paid-error** blocked restore + restart proofs in this run — account/service plan issue may need dashboard attention.
3. Bundled recovery remains a last-resort bridge (not the database).
4. Autonomous Cron activation was explicitly out of scope for this mission.

**Unblock checklist**

1. Fix Render service health (resolve 502 / plan routing error).
2. Provision/link `courtedge-durable-db` and set web `DATABASE_URL`.
3. Deploy this build; confirm `/health.homeDurable.durableActive === true`.
4. Emergency-seed Jul 22 Best 6 once if still empty, which then **persists to Postgres**.
5. Perform two controlled restarts + one redeploy without manual refresh/hydrate/recover.

---

## 30. Final verdict

```text
PARTIAL — DURABLE HOME STORE NOT ACTIVE
```

Reason: Home durability code and tests are complete, but production Postgres was not confirmed active and live restart verification could not run (Render 502). Home state remains ephemeral on Render until `DATABASE_URL` is connected and restart proofs succeed.
