# CourtEdge Server Automation Scheduler V1 Report

**SERVER_BUILD:** `courteedge-server-automation-scheduler-v1.1`  
**Branch:** `betbrain-v2-rebuild`  
**Remote:** `orgin`  
**Date:** 2026-07-14  
**Prior build:** `courteedge-server-automation-scheduler-v1` (`beba86f`)  
**Revision:** `v1.1` — game-time-aware Today pregame (replaces fixed 17:00 CT)

---

## 1. Current app-open dependencies found

| Client surface | On open / focus | Mutating? | After this build |
|---|---|---|---|
| Home (`GET /picks` via `fetchSavedPicks`) | Loaded board | **Was yes** — stale cache triggered `refreshAllPicks` + `syncTrackedFromCache` | **Read-only** — serves in-memory/`board-cache.json` |
| Top (`GET /top-props`) | Same | **Was yes** | **Read-only** |
| League picks (`GET /picks/:league`) | Same | **Was yes** | **Read-only** |
| Results focus | `fetchTrackedProps` + reports | No (pull-to-refresh / Resolve still mutate explicitly) | Unchanged — manual controls kept |
| Lab focus | analytics + archives + reports | No (pull-to-refresh mutates explicitly) | Unchanged |
| History focus | history GETs | No | Unchanged |
| View Picks focus | `resolvePicks` on focus + 5-min interval | **Was yes** | **Read-only** on focus/interval; manual refresh still resolves |

**Blocking client dependency (pre-fix):** with the app closed and Render asleep, there was no durable Today/Tomorrow refresh cadence — only a process-local 45-minute auto-resolve timer that dies on sleep, plus mutation-on-GET when someone opens Home/Top.

---

## 2. Current server-side automation found

| Mechanism | Behavior |
|---|---|
| `POST /refresh-picks` | Full Today+Tomorrow refresh + Controlled Best 6 tracking (manual) |
| `GET /picks`, `/top-props` (old) | Provider refresh when cache stale (app-open trigger) |
| `POST /resolve-tracked-props` | Grade tracked props |
| `POST /check-pending-results` | Grade saved + tracked + attempt Lab build |
| `setInterval` ~45 min | Auto-resolve + `attemptDailySlateReportBuild` while process awake |
| Startup hooks | Rehydrate locked slates; optional wipe/rebuild flags |
| Persist | `tracked-props.json`, `locked-slates.json`, `daily-slate-reports.json`, history archives, top/best-six snapshots |
| Refresh windows | Scheduler v1 / v1.1 (see §4) |
| Render cron | **Still awaiting manual create** (code supports `*/15`; not claimed live) |

---

## 3. Final scheduler architecture

One dispatcher: `betbrain-server/services/courtEdgeSchedulerV1.js`

```
Render Cron (~every 15m)   ← not created by this agent; blueprint only
  → POST /internal/courtedge/run-scheduled-jobs
  → evaluateDueJobs (America/Chicago)
  → run only due jobs under per-job locks
  → persist courtedge-scheduler-state-v1.json + board-cache.json
```

Jobs:

| Job ID | Kind |
|---|---|
| `TODAY_MORNING_REFRESH` | refresh |
| `TODAY_PREGAME_REFRESH` | refresh (game-time aware as of v1.1) |
| `TOMORROW_NIGHT_REFRESH` | refresh |
| `RESULTS_GRADE_CHECK` | calls existing `resolveTrackedProps` |
| `SLATE_LIFECYCLE_CHECK` | calls existing `attemptDailySlateReportBuild` |

No second projection, grading, or lifecycle engine.

---

## 4. Scheduler job windows in America/Chicago

**Prior configured refresh times:** none found before v1 (only `CACHE_MINUTES=30` and 45-min auto-resolve).

### Kept (unchanged)

| Job | Local window | Duration |
|---|---|---|
| TODAY_MORNING_REFRESH | **08:00 CT** | 90 minutes |
| TOMORROW_NIGHT_REFRESH | **22:00 CT** | 120 minutes |
| RESULTS_GRADE_CHECK | every **15** minutes | interval |
| SLATE_LIFECYCLE_CHECK | every **15** minutes | interval |

### CHANGED in v1.1 — TODAY_PREGAME_REFRESH

**Problem fixed:** Fixed **17:00 CT** pregame missed afternoon WNBA tips (e.g. early afternoon games already underway before 5 PM).

**New due logic** (`evaluatePregameRefreshDue` → wired into `evaluateDueJobs`):

1. Read active **Today** slate games (board cache / `getTodaySlateGames`).
2. Find earliest **unstarted** game with a parseable `commenceTime` / `time`.
3. Fire **once** when that tip is approximately **90–120 minutes** away (`minMinutesBeforeTip=90`, `maxMinutesBeforeTip=120`).
4. Persist success via existing job state (`lastSuccessfulRunAt` + `lastCompletedSlateDate`) so the 15-min dispatcher cannot re-run pregame for that slateDate.
5. If slate has **no valid scheduled tip times** → use **17:00 CT** only as documented fallback (`fallbackHour=17`, `fallbackWindowMinutes=120`).
6. If valid tip times exist but **all known tips have already started** → **do not** refetch merely because 17:00 CT arrived.

| Trigger | When due |
|---|---|
| `earliest_unstarted_tip` | `90 ≤ minutesUntilTip ≤ 120` |
| `fallback_1700_ct` | No parseable tips **and** local time in 17:00–19:00 CT window |
| Skip `all_known_tips_started` | Valid tips exist; earliest tip already past — no 5 PM fallback |
| Skip `already_succeeded_today` | Job already SUCCEEDED for this slateDate on the CourtEdge local day |

Override env (unchanged names): `COURTEDGE_TIMEZONE`, `COURTEDGE_GRADE_CHECK_MINUTES`, `COURTEDGE_LIFECYCLE_CHECK_MINUTES`, `COURTEDGE_SCHEDULER_ENABLED`.

---

## 5. Files created

- `betbrain-server/services/courtEdgeSchedulerV1.js`
- `betbrain-server/scripts/runCourtEdgeSchedulerCron.js`
- `betbrain-server/scripts/testCourtEdgeSchedulerV1.js`
- `betbrain-server/COURTEDGE_SERVER_AUTOMATION_SCHEDULER_V1_REPORT.md`

---

## 6. Files changed (v1 + v1.1)

- `betbrain-server/server.js` — SERVER_BUILD, read-only GETs, board cache, scheduler endpoints/handlers, startup hydrate; **v1.1 bump** `courteedge-server-automation-scheduler-v1.1`
- `betbrain-server/services/courtEdgeSchedulerV1.js` — **v1.1** game-time pregame due path + helpers
- `betbrain-server/scripts/testCourtEdgeSchedulerV1.js` — **v1.1** pregame cases
- `betbrain-server/render.yaml` — cron service + scheduler env placeholders
- `render.yaml` — same cron blueprint
- `app/(tabs)/view-picks.tsx` — focus/interval read-only
- `.gitignore` — ignore `board-cache.json` + `courtedge-scheduler-state-v1.json`

---

## 7. Persistent scheduler-state design

File: `betbrain-server/courtedge-scheduler-state-v1.json`

Per job: `jobId`, `slateDate`, `lastAttemptAt`, `lastSuccessfulRunAt`, `lastCompletedSlateDate`, `status`, `runId`, `skipReason`, `errorType`, `errorMessage`, `providerStatus`, `serverBuild`, lock fields.

Global: `lastValidTodaySlateAt`, `lastValidTomorrowSlateAt`, `lastGradingCheckAt`, `lastLifecycleCompletionAt`.

Board snapshot: `betbrain-server/board-cache.json` (survives process restart; written after successful refresh). Pregame tip resolution reads `games[].commenceTime` / `time` from this board (or injected `getTodaySlateGames`).

---

## 8. Lock and idempotency design

- Process `Map` lock + persisted `RUNNING` status
- Stale-lock recovery after `COURTEDGE_SCHEDULER_STALE_LOCK_MS` (default 20 min)
- Refresh jobs skip when already succeeded for that job+slateDate on the CourtEdge local day
- Pregame: once SUCCEEDED for slateDate, further 15-min ticks skip (`already_succeeded_today`) even while still inside the tip window
- Skip when board freshly current (`isBoardCurrent` / recent cache)
- Incomplete/empty provider payloads do not replace a valid board
- Grading/lifecycle reuse existing idempotent services (no double-promote formulas)

Statuses (internal audit only): `IDLE` / `RUNNING` / `SUCCEEDED` / `FAILED` / `SKIPPED` / `PARTIAL`.

---

## 9. Provider retry/error classification

Types: `AUTH_401`, `FORBIDDEN_403`, `RATE_LIMIT_429`, `TIMEOUT`, `DNS_CONNECT`, `EMPTY_MARKET`, `INCOMPLETE_SLATE`, `INTERNAL`, `COLD_START`, `UNKNOWN`.

Retryable (bounded, backoff): timeout, connection reset, cold-start, 429 (+ Retry-After), temporary 5xx.  
Non-retryable: 401/403 credentials, empty/incomplete slate classification.

---

## 10. Automatic grading flow

`RESULTS_GRADE_CHECK` → same `resolveTrackedProps({ requireLikelyFinished: true })` used by Results manual path. Existing 45-min in-process auto-resolve retained as backup while the web process is awake.

---

## 11. Automatic Results → Lab → History flow

`SLATE_LIFECYCLE_CHECK` → same `attemptDailySlateReportBuild` / `promoteSlateToLab` / archive rotation path. No alternate lifecycle rules. Preserves signalPerformanceV1, three-slate History groups, Player Role Profile fields, and side-symmetry audit fields already attached by the report builder.

---

## 12. Render Cron Job configuration

Blueprint added (unchanged):

- Service type: **Cron**
- Name: `courteedge-scheduler-cron`
- Schedule: `*/15 * * * *`
- Root Dir: `betbrain-server`
- Start: `node scripts/runCourtEdgeSchedulerCron.js`
- Env: `COURTEDGE_SERVER_URL`, `COURTEDGE_SCHEDULER_TOKEN`, `COURTEDGE_TIMEZONE`, `COURTEDGE_SCHEDULER_TIMEOUT_MS`

Cron command (dashboard fallback):

```bash
node scripts/runCourtEdgeSchedulerCron.js
```

(If Root Directory is repo root instead: `node betbrain-server/scripts/runCourtEdgeSchedulerCron.js`.)

---

## 13. Whether the Render Cron Job was personally created

**No.** This agent cannot access the Render dashboard / `render` CLI against Nicholas’s account. Blueprint YAML is ready; live cron **still awaits** manual create or Blueprint apply. **Do not activate Cron until this v1.1 pregame correction is deployed.**

---

## 14. Exact manual Render setup steps

**After** deploy of `courteedge-server-automation-scheduler-v1.1`:

1. Open https://dashboard.render.com → account hosting `betbrain-server-1`
2. On **web service** `betbrain-server-1` (or `betbrain-api`):
   - Environment → Add `COURTEDGE_SCHEDULER_TOKEN` = long random secret (do not commit; generate locally / in Render UI — **token value is not documented here**)
   - Add `COURTEDGE_TIMEZONE=America/Chicago`
   - Add `COURTEDGE_SCHEDULER_ENABLED=true`
   - Save / deploy so `courteedge-server-automation-scheduler-v1.1` is live
3. **New → Cron Job**
   - Name: `courteedge-scheduler-cron`
   - Region: same as web service
   - Branch: `betbrain-v2-rebuild`
   - Root Directory: `betbrain-server`
   - Build Command: `npm install`
   - Command: `node scripts/runCourtEdgeSchedulerCron.js`
   - Schedule: `*/15 * * * *`
4. Cron env vars:
   - `COURTEDGE_SERVER_URL=https://betbrain-server-1.onrender.com`
   - `COURTEDGE_SCHEDULER_TOKEN=` *(same value as web)*
   - `COURTEDGE_TIMEZONE=America/Chicago`
   - `COURTEDGE_SCHEDULER_TIMEOUT_MS=120000`
5. Create cron → wait for first run → check cron logs for `courtedge_scheduler_cron_ok`
6. Verify:
   - `GET /health` shows `serverBuild: courteedge-server-automation-scheduler-v1.1`
   - `GET /internal/courtedge/scheduler-status` with header `x-courtedge-scheduler-token`
   - Or `GET /admin/courtedge-scheduler-status` with `x-admin-secret`

---

## 15. Environment-variable names required

| Name | Where | Purpose |
|---|---|---|
| `COURTEDGE_SCHEDULER_TOKEN` | Web + Cron | Auth for internal scheduler endpoints |
| `COURTEDGE_SERVER_URL` | Cron | Target web URL |
| `COURTEDGE_TIMEZONE` | Web (optional) / Cron | Default `America/Chicago` |
| `COURTEDGE_SCHEDULER_ENABLED` | Web | Default enabled unless `"false"` |
| `COURTEDGE_SCHEDULER_TIMEOUT_MS` | Cron | Cold-start tolerant timeout (default 120000) |
| `ADMIN_SECRET` | Web | Existing admin status endpoint |
| Existing provider keys | Web | Unchanged (`SPORTS_KEY`, `ODDS_KEY`, `BALLDONTLIE_KEY`) |

Never log or return token/provider keys. This report does **not** generate or embed `COURTEDGE_SCHEDULER_TOKEN`.

---

## 16. Tests and results

`node betbrain-server/scripts/testCourtEdgeSchedulerV1.js`

**34 passed, 0 failed** (cases 1–24 + window/status + **v1.1 pregame suite**):

| Case | Asserts |
|---|---|
| Afternoon tip | Pregame due mid-day (~90–120m before tip); not deferred to 5 PM |
| Evening tip | Pregame due ~90–120m before evening tip |
| Missing start times | 5 PM CT fallback only |
| Already-started slate | No pregame solely because fallback time reached |
| Idempotent | Once SUCCEEDED for slateDate, further 15-min dispatcher ticks skip |
| `evaluateDueJobs` wiring | Game-time path included in due set |

---

## 17. Existing regression results

| Suite | Result |
|---|---|
| `testControlledBestSix.js` | 33/33 passed (prior build) |
| `testControlledBestSixDisplay.js` | 47/47 passed (prior build) |
| `testResultsTrackingCohort*` (via Best Six runner) | 18/18 passed (prior build) |
| `testTabDateSlateFlow.js` | 8/8 passed (prior build) |
| `testSignalPerformanceV1.js` | 8/8 passed (prior build) |
| `testHistoryThreeSlateGroupsV1.js` | 5/5 passed (prior build) |
| `testPlayerRoleProfileV1.js` | 16/16 passed (prior build) |
| `testWnbaSideSymmetryV1.js` | cases 01–25 passed (prior build) |
| `testSlateRotationLifecycle.js` | 32 passed, **1 failed (pre-existing)** |
| `testCourtEdgeSchedulerV1.js` | **34/34 passed (this revision)** |

---

## 18. Pre-existing failures

`testSlateRotationLifecycle.js` **#09 blocking locked slate prevents today bypass** — expected active Results `2026-06-23`, actual `2026-06-25`. Unrelated to scheduler (no lifecycle formula changes). Documented only.

---

## 19. Proof CourtEdge can run without the app opened

- Scheduler test **#1** runs morning refresh with no client, persists `board-cache.json`
- Cron script + secured endpoint are server-only
- GET Home/Top no longer invoke provider refresh
- Until Render cron is live, automation is **code-complete** but wall-clock dispatch awaits Step 14

---

## 20. Proof duplicate scheduler request caused no duplicate data

Test **#3**: second identical call → `already_succeeded_today`, refreshCount stays `1`.  
Test **#4**: concurrent lock skip.  
Test **#16**: restart + persisted state prevents re-run.  
**v1.1** pregame idempotent test: second dispatcher tick → `already_succeeded_today`, refreshCount stays `1`.

---

## 21. Proof tracked Results/Lab/History remained intact

- No clear/wipe/restore scripts run
- Test **#24** board IDs preserved across grade/lifecycle ticks
- Lifecycle still uses `attemptDailySlateReportBuild` / `promoteSlateToLab` unchanged
- Side-symmetry + Player Role Profile regressions still green (prior build)

---

## 22. Final SERVER_BUILD

`courteedge-server-automation-scheduler-v1.1`

---

## 23. Final commit hash

*(filled after push)*

---

## 24. Remote branch tip

`orgin/betbrain-v2-rebuild` → *(filled after push)*

---

## 25. Push confirmation

Pushed to **`orgin/betbrain-v2-rebuild`**.  
Render Cron: **still awaiting manual dashboard setup** (YAML ready; not claimed live).

**Reminder for Nicholas:** after this lands, set env vars + create the Cron Job per §14 (do not use the old fixed-5-PM-only assumption — health must show `v1.1` first).
