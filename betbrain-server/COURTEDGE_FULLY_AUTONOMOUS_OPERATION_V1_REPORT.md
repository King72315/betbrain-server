# CourtEdge Fully Autonomous Production Operation V1 Report

**Build:** `courteedge-fully-autonomous-operation-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Remote:** `orgin`  
**Production:** `https://betbrain-server-1.onrender.com`  
**Timezone:** `America/Chicago`  
**Baseline capture:** `betbrain-server/.fully-autonomous-baseline-v1/` (gitignored)  
**Date:** 2026-07-22

---

## 1. Executive summary

CourtEdge autonomous operation infrastructure is implemented and shipped: durable Postgres-capable store with filesystem/mirror fallback, 15-minute in-process scheduler heartbeat + Render Cron blueprint, integrity watchdog with proven-link repairs, enriched protected scheduler/status diagnostics, startup durable hydrate with precedence scoring (rules 1–15), and production-shaped automated tests (19/19 autonomous + prior suites green).

**Live Render Cron Job creation, `COURTEDGE_SCHEDULER_TOKEN` confirmation, Postgres provisioning, and two controlled restart hash proofs could not be completed from this agent** (no Render API key / dashboard credentials). In-process heartbeat will run while the web dyno is awake after deploy, but free-tier sleep still requires an external Cron.

**Final verdict:** `PARTIAL — SCHEDULER INFRASTRUCTURE NOT ACTIVE`

---

## 2. Previous manual dependencies

| Dependency | Effect before this build |
|---|---|
| Opening Home / Focus | Historically could trigger stale-cache provider refresh |
| Manual `POST /refresh-picks` | Required to discover markets / seal board |
| Manual `POST /resolve-tracked-props` | Required to grade Results |
| Opening Results / Lab | Often used to “kick” lifecycle |
| Render redeploy | Ephemeral disk wiped `board-cache.json` / runtime JSON |
| No live Cron | Scheduler code existed (`courtEdgeSchedulerV1`) but Cron was never created |

---

## 3. Pre-repair production baseline

Captured read-only (no refresh/grade/repair) at **2026-07-22T07:20:47.156Z**:

| Field | Value |
|---|---|
| Production build | `courteedge-home-analysis-hydrate-v1` |
| Today CT | `2026-07-22` |
| Tomorrow CT | `2026-07-23` |
| Today WNBA Best 6 | **6/6** sealed |
| Tomorrow WNBA Best 6 | **0** |
| Results tracked | **6** (slate `2026-07-22`, unresolved) |
| Lab current | `2026-07-20` |
| Active block | `[2026-07-20, 2026-07-22]` |
| Frozen block | `[2026-07-14, 2026-07-15, 2026-07-16]` |
| `writesLiveWeights` | `false` |
| Scheduler admin status | **503** (`ADMIN_SECRET` not configured) |
| Durable store | Filesystem / ephemeral (no `DATABASE_URL`) |
| Last scheduler heartbeat | Unknown (token-gated; not publicly readable) |

### Official Today props (hashes abbreviated)

| Rank | Player | Side | Line | Conf | Risk | Hash prefix |
|---|---|---|---|---|---|---|
| 1 | Kelsey Mitchell | OVER | 21.5 | 82 | MEDIUM | `aca9cfb3…` |
| 2 | Kayla McBride | OVER | 17.5 | 86 | LOW | `f641550b…` |
| 3 | Olivia Miles | UNDER | 17.5 | 76 | HIGH | `139103a2…` |
| 4 | A'ja Wilson | OVER | 23.5 | 58 | HIGH | `3f1e731a…` |
| 5 | Aliyah Boston | UNDER | 14.5 | 46 | HIGH | `150d538d…` |
| 6 | Azura Stevens | OVER | 11.5 | 72 | MEDIUM | `99bd4ae6…` |

Full prop IDs + hashes: `.fully-autonomous-baseline-v1/SUMMARY.json`.

---

## 4. Complete old workflow

```text
App open / Force Refresh
  → provider refresh
  → board build / Best 6
  → seal (sometimes)
  → manual Results admission gaps
  → open Results → resolve
  → open Lab → promote
  → History via report builder
Redeploy → ephemeral wipe → seed/bundle recovery → manual refresh again
```

---

## 5. Complete autonomous workflow

```text
Render Cron */15  OR  in-process 15m heartbeat
  → POST /internal/courtedge/run-scheduled-jobs
  → evaluateDueJobs (America/Chicago)
  → TODAY_MORNING_REFRESH (~08:00 CT)
  → TODAY_PREGAME_REFRESH (90–120m before tip / 17:00 fallback)
  → TOMORROW_NIGHT_REFRESH (~22:00 / 10:00 PM CT)
  → RESULTS_GRADE_CHECK (every 15m)
  → SLATE_LIFECYCLE_CHECK (Lab promote + History rule)
  → integrity watchdog (proven-link repairs only)
  → durablePut (Postgres when DATABASE_URL set; else mirror+FS)
Startup
  → hydrateWorkingFilesFromDurableStore (precedence 1–15)
  → tab-flow admission recovery
  → startup heartbeat (~20s)
Frontend tabs
  → read-only views of server canonical data
```

---

## 6. Canonical source-of-truth design

| Concern | Owner |
|---|---|
| Official sealed packets | `canonical-slates-v1` via `courtEdgeStateIntegrityV1` |
| Home board display | `board-cache` read model (day-isolated merge) |
| Results cohort | `tracked-props` admitted from sealed six |
| Lab / three-slate | Lab V2 + `three-slate-blocks-v2` |
| History | Existing archive / daily slate report path |
| Scheduler job state | `courtedge-scheduler-state-v1` |
| Locks / idempotency | durable locks + idempotency keys |

Other stores are caches / indexes / compatibility views. They must not independently rebuild official props.

---

## 7. Durable-store architecture

Module: `services/courtEdgeDurableStoreV1.js`

- **Preferred backend:** PostgreSQL (`DATABASE_URL` / `COURTEDGE_DATABASE_URL`)
- Tables: `courtedge_kv`, `courtedge_locks`, `courtedge_idempotency`
- **Always mirrors** to `.durable-mirror-v1/` + local JSON working files
- `scoreDurableRecord` / `choosePreferredRecord` encode startup precedence 1–15
- Fire-and-forget sync from board / scheduler / canonical / tracked writers

---

## 8. Durable store used in production

| At baseline | Filesystem / ephemeral Render disk |
|---|---|
| After this deploy (code) | Postgres **if** `DATABASE_URL` wired; else filesystem-fallback |
| Blueprint | `courtedge-durable-db` (`basic-256mb`) in `render.yaml` |

**Not yet verified live** — agent lacks Render credentials to create the database and attach `DATABASE_URL`.

---

## 9. Scheduler architecture

Existing dispatcher `courtEdgeSchedulerV1` enhanced:

- Heartbeat fields + durable health on status
- Watchdog hook after each dispatcher run
- Success timestamps keyed to dispatcher `now` (fixes Chicago idempotency)
- In-process 15-minute heartbeat in `server.js` (complements Cron)
- Cron runner unchanged: `scripts/runCourtEdgeSchedulerCron.js`

---

## 10. Exact Render service configuration

Blueprint (`betbrain-server/render.yaml` + root `render.yaml`):

| Service | Type | Schedule / start |
|---|---|---|
| `betbrain-api` | web | `npm start` (rootDir `betbrain-server`) |
| `courtedge-scheduler-cron` | cron | `*/15 * * * *` → `node scripts/runCourtEdgeSchedulerCron.js` |
| `courtedge-durable-db` | database | `basic-256mb` |

Web env (non-secret): `COURTEDGE_TIMEZONE=America/Chicago`, `COURTEDGE_SCHEDULER_ENABLED=true`, `DATABASE_URL` from DB.

---

## 11. Environment variables used (secrets redacted)

| Variable | Value |
|---|---|
| `COURTEDGE_SCHEDULER_TOKEN` | `<redacted — set in Render dashboard; never commit>` |
| `COURTEDGE_TIMEZONE` | `America/Chicago` |
| `COURTEDGE_SCHEDULER_ENABLED` | `true` |
| `COURTEDGE_SERVER_URL` | `https://betbrain-server-1.onrender.com` |
| `DATABASE_URL` | `<from Render Postgres — not yet attached>` |
| `ADMIN_SECRET` | `<optional; currently unset on prod → admin status 503>` |

---

## 12. Morning refresh automation

`TODAY_MORNING_REFRESH` — **08:00 CT**, 90-minute window. Confirms Today schedule, builds/updates unsealed draft, hydrates analysis, **preserves sealed** Today, isolates Tomorrow.

---

## 13. Pregame refresh and sealing automation

`TODAY_PREGAME_REFRESH` — game-time aware **90–120 minutes** before earliest unstarted tip; **17:00 CT fallback** only when tip times missing. Seal + Results admission via existing official slate + tab-flow admit path; watchdog recovers missing admission exactly once.

---

## 14. Tomorrow refresh automation

`TOMORROW_NIGHT_REFRESH` — **22:00 CT (10:00 PM CT)**, 120-minute window. Builds Tomorrow draft; must not alter Today (day-isolation merge).

---

## 15. Results admission automation

`admitSealedPropsToResults` / tab-flow board admission + watchdog `SEALED_MISSING_RESULTS_ADMISSION` repair. `Results Tracked: 6/6` only after exact six admitted.

---

## 16. Grading automation

`RESULTS_GRADE_CHECK` every 15 minutes → `resolveTrackedProps({ requireLikelyFinished: true })`. Appends grades only; sealed fields immutable. Also retained 45-minute in-process auto-resolve while awake.

---

## 17. Lab promotion automation

`SLATE_LIFECYCLE_CHECK` → `attemptDailySlateReportBuild`. Watchdog repairs `GRADED_MISSING_LAB_PROMOTION` by re-invoking lifecycle. `writesLiveWeights` remains **false**.

---

## 18. Active-block automation

Existing Lab V2 three-slate learning-track rules (floor `2026-07-20`) unchanged. Lifecycle check + startup recovery restore proven membership only.

---

## 19. History automation

Existing Lab→History archival rule via daily slate report / `archiveCompletedSlateIdempotent`. No new archival policy.

---

## 20. Date and rollover handling

Central helper: `getTodayLocalDate` / `getCourtEdgeLocalParts` (`America/Chicago`). Rollover preserves sealed Tomorrow prop IDs, lines, sides, hashes (`rolloverSealedTomorrowToToday`). Tests cover UTC midnight CT shift and CT midnight boundary.

---

## 21. Recovery and watchdog behavior

`courtEdgeIntegrityWatchdogV1` on each heartbeat detects empty Home despite markets, missing Results admission, prop ID mismatch, ungraded completed games, missing Lab promotion, stale heartbeat, durable write failures, placeholder analysis. Repairs **only** proven admission/promotion links.

---

## 22. Idempotency and locking

- Per-job process + persisted RUNNING locks (stale recovery)
- `already_succeeded_today` skip for refresh jobs
- Durable locks: `withDurableLock` (Postgres or file TTL)
- Idempotency keys: `durablePutIdempotent` / `durableGetIdempotent`  
  Examples: `WNBA:<DATE>:MORNING_REFRESH`, `:SEAL`, `:RESULTS_ADMISSION`, `:LAB_PROMOTION`

---

## 23. Read-only tab verification

Server `GET /picks` serves `getReadOnlyBoard()` when valid cache exists. Scheduler status / integrity remain internal/token-gated. Copy Report continues to use existing screen payload paths (no new labels). Force Refresh remains explicit admin/manual action (`POST /refresh-picks`), not tab-open.

Local contract test: tab-open simulation → zero generation calls.

---

## 24. Provider-call verification

Paid API counter (`getPaidApiCallCount`) exposed on scheduler-status / state-integrity. Read-only GETs must not increment generation when board is valid. Live no-login provider-call count **not measured** without active Cron token access.

---

## 25. Files and functions changed

| File | Change |
|---|---|
| `services/courtEdgeDurableStoreV1.js` | **NEW** durable KV / locks / precedence |
| `services/courtEdgeIntegrityWatchdogV1.js` | **NEW** heartbeat integrity watchdog |
| `services/courtEdgeSchedulerV1.js` | durable sync, status enrichment, `now`-based success stamps, watchdog return |
| `services/courtEdgeStateIntegrityV1.js` | durable sync on canonical save; build bump |
| `services/trackedPropService.js` | durable sync on tracked write |
| `services/courtEdgeLabV2Constants.js` | build bump |
| `services/courtEdgeTabFlowRepairV1.js` | build bump |
| `server.js` | build bump; durable startup; heartbeat; watchdog handlers; enriched status |
| `scripts/testCourtEdgeFullyAutonomousOperationV1.js` | **NEW** tests |
| `scripts/testCourtEdgeSchedulerV1.js` | (unchanged logic; passes after stamp fix) |
| `scripts/testCourtEdgeStateIntegrityV1.js` | build assert update |
| `scripts/testCourtEdgeFullAppTabFlowRepairV1.js` | build assert update |
| `package.json` / lock | `pg` dependency + test script |
| `render.yaml` (root + server) | Postgres + env wiring |
| `.gitignore` | durable mirror / baseline ignores |

---

## 26. Tests added

`npm run test:courtedge-fully-autonomous` → `scripts/testCourtEdgeFullyAutonomousOperationV1.js`

Covers: Chicago due windows, idempotent heartbeats, grading/lifecycle without app, durable locks, Tomorrow→Today identity, UTC/CT midnight, mirror durability, idempotency keys, precedence, hydrate, watchdog repairs, lifecycle hash identity, read-only contract.

---

## 27. Full test totals

| Suite | Result |
|---|---|
| Fully autonomous V1 | **19/19 PASS** |
| Scheduler V1 | **36/36 PASS** |
| State integrity V1 | **34/34 PASS** |
| Tab-flow repair V1 | **15/15 PASS** |
| Lab V2 | **96/96 PASS** |

---

## 28. Commit hashes

Recorded at ship time in §29 after `git push orgin`.

---

## 29. Deployment details

- Auto-deploy expected on push to `betbrain-v2-rebuild` for Render web service `betbrain-server-1`.
- Cron + Postgres require dashboard/Blueprint apply (see §38).

---

## 30. Scheduler heartbeat proof

**Not verified live.** Protected `GET /internal/courtedge/scheduler-status` requires `COURTEDGE_SCHEDULER_TOKEN`. Admin mirror requires `ADMIN_SECRET` (unset → 503). No agent access to token or Render Cron logs.

After Nicholas sets token + Cron, proof command:

```bash
curl -s -H "x-courtedge-scheduler-token: $COURTEDGE_SCHEDULER_TOKEN" \
  https://betbrain-server-1.onrender.com/internal/courtedge/scheduler-status
```

Expect recent `lastHeartbeatAt` / `lastDispatcherAt` within ~15–20 minutes while awake.

---

## 31. First controlled restart result

**Not performed** — Render restart API/dashboard unavailable to this agent.

---

## 32. Second controlled restart result

**Not performed** — same blocker.

---

## 33. Full no-login slate-cycle proof

**Not completed.** Observing a full Tomorrow→Today→seal→admit→grade→Lab cycle without manual POSTs requires live Cron + durable store + multi-hour observation window. Code paths exist; live cycle not proven.

---

## 34. Pre-restart and post-restart hash comparisons

**Not available** (restarts not executed). Baseline Today hashes captured in `.fully-autonomous-baseline-v1/SUMMARY.json` for future compare:

`aca9cfb3…`, `f641550b…`, `139103a2…`, `3f1e731a…`, `150d538d…`, `99bd4ae6…`

---

## 35. Confirmation that no production weights changed

`writesLiveWeights=false` at baseline and in Lab V2 builder. No Calibration Feedback Engine. No weight file writes in this build.

---

## 36. Confirmation that no new labels were added

No new user-facing labels. Internal enums (`SEALED`, watchdog codes, durable keys) remain internal / diagnostic only.

---

## 37. Confirmation that the app design was unchanged

No frontend redesign, navigation, typography, or branding changes in this mission.

---

## 38. Remaining limitations

1. **Render Cron Job not confirmed created** on the live account.
2. **`COURTEDGE_SCHEDULER_TOKEN` not verifiable** from this agent (must match on web + cron).
3. **Postgres `courtedge-durable-db` not provisioned/attached** — without it, official state remains at risk on ephemeral disk (`FAILED` durability risk until DB is live).
4. Free web plan **sleeps** — in-process heartbeat alone is insufficient; Cron must wake the service.
5. `ADMIN_SECRET` unset → admin scheduler status 503.
6. Tomorrow board was empty at baseline — autonomous Tomorrow refresh must run tonight’s window after Cron is live.

### One-time Render dashboard steps (Nicholas)

1. Open Render → Blueprint or service `betbrain-server-1`.
2. Create PostgreSQL `courtedge-durable-db` (or apply Blueprint databases section) and link `DATABASE_URL` to the web service.
3. Set web env:
   - `COURTEDGE_SCHEDULER_TOKEN=<generate a long random secret>`
   - `COURTEDGE_TIMEZONE=America/Chicago`
   - `COURTEDGE_SCHEDULER_ENABLED=true`
4. Create Cron Job `courtedge-scheduler-cron`:
   - Schedule: `*/15 * * * *`
   - Root Dir: `betbrain-server`
   - Command: `node scripts/runCourtEdgeSchedulerCron.js`
   - Same `COURTEDGE_SCHEDULER_TOKEN` + `COURTEDGE_SERVER_URL=https://betbrain-server-1.onrender.com` + `COURTEDGE_TIMEZONE=America/Chicago`
5. Deploy / restart web once after env+DB attach.
6. Confirm `scheduler-status` shows a fresh heartbeat.
7. Perform two manual restarts; compare Today prop content hashes to baseline.

---

## 39. Final verdict

```text
PARTIAL — SCHEDULER INFRASTRUCTURE NOT ACTIVE
```

**Rationale:** Autonomous operation code, durable store, watchdog, heartbeat, tests, and Blueprint are complete and pushed. Live production Cron activation, Postgres durability attachment, no-login full slate-cycle observation, and two controlled restart hash proofs were blocked by missing Render credentials. Per mission rules, this cannot be claimed `FULLY AUTONOMOUS OPERATION VERIFIED` from local tests or code alone.

---

*End of official mission report — `courteedge-fully-autonomous-operation-v1`.*
