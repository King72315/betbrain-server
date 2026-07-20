# CourtEdge End-to-End State Integrity and Lifecycle Repair V1

**Date:** 2026-07-20  
**SERVER_BUILD / LAB_V2_BUILD:** `courteedge-end-to-end-state-integrity-v1`  
**Branch:** `betbrain-v2-rebuild` · remote `orgin`  
**Prod:** `https://betbrain-server-1.onrender.com`  
**Baseline prior build:** `courteedge-lab-stability-audit-v1` (Lab 87/87)

---

## 1. Executive summary

CourtEdge’s month-long class of failures (props/sides/conf/analysis changing after refresh/tabs, Today/Tomorrow overwrite, Results≠Home, Lab missing promotions, restart placeholder downgrade, Copy divergence, races, missing→zero) came from **multiple competing writers and caches** without one sealed-packet owner, merge precedence, or restart-safe identity hashes.

This build establishes a **canonical server-side slate store** (`canonical-slates-v1.json`) with immutable decision-packet `contentHash`, centralized merge precedence (15 rules), Today/Tomorrow isolation on persist, Force Refresh market-refs-only for sealed boards, persisted concurrency locks, lifecycle transition journal, dry-run reconciler, protected `GET /internal/courtedge/state-integrity`, and adversarial tests A–T (**34/34**). Existing Lab (**87/87**), Home Completion (**80/80**), Best 6 repair (**44/44**) suites remain green. **No weight writes, no new user-facing labels, no UI redesign.**

---

## 2. Why CourtEdge kept experiencing the same problem for more than a month

Symptom patches (empty-board guard, progressive Today persist, Lab lifecycle compat, MetricAvailability, playable-pool repair, analysis integrity) each fixed one surface while **other writers** (scheduler refresh, Force Refresh, startup recovery, board-cache rebuild after `serverBuild` mismatch, Lab aggregation from alternate prop shapes) could still replace or rebuild official data. Without a single sealed packet hash and merge policy, every new ship could reintroduce the same failure class under a different trigger.

---

## 3. Timeline of previous symptom-level repairs

| Approx | Build / commit theme | Symptom fixed | Gap left |
|--------|----------------------|---------------|----------|
| Jun–early Jul | Side rescue, decision intelligence, persist guards | Selection / tracking | Multiple caches |
| Jul 14–16 Lab era | Three-slate Lab V2 | Lab blocks | Promotion races |
| Jul 17 restore | Lifecycle compat | Lab default / frozen | No packet hash |
| home-completion / Best6 pool | Tomorrow six / playable pool | Empty boards | Overwrite races |
| empty-board-guard | LKG preserve | Empty swap | No canonical owner |
| analysis-integrity | conf/risk owner | Zero poison | Tab/refresh still multi-writer |
| lab-stability-audit | MetricAvailability | Copy null/—% | State-flow still multi-owner |
| **this build** | **state-integrity-v1** | **Canonical sealed owner + merge + tests** | See §36 |

---

## 4. Complete pre-repair state-flow map

```
Providers → refreshBoard / scheduler
  → picksCache (memory) + board-cache.json
  → empty-board guard / LKG merge (ad hoc)
  → GET /top-props|/picks (readOnly hydrate)
  → seal via officialSlateService → slate-snapshots + tracked-props
  → Results from tracked-props filters
  → Lab via buildCourtEdgeLabV2(tracked + archives + reports)
  → History archives / three-slate-blocks-v2.json
```

Competing owners: `picksCache`, `board-cache.json`, `tracked-props.json`, `slate-snapshots/`, `history-archive/`, bundled recovery freezes, Lab three-slate store, scheduler state — **no single sealed packet hash across surfaces**.

---

## 5. Complete post-repair state-flow map

```
Providers → intentional refresh only (scheduler / Force Refresh)
  → persistBoardAfterRefresh:
       shouldPreserveExistingBoard (LKG)
       → mergeBoardDayIsolation (Today↛Tomorrow)
       → applyForceRefreshToSealedBoard (market refs only if sealed)
       → saveBoardCache + syncBoardToCanonicalStore
  → canonical-slates-v1.json (authoritative sealed packets + contentHash)
  → Tabs / Copy Report / Lab / Results = read views of canonical + graded appendices
  → lifecycle journal + reconciler (link repairs only)
  → GET /internal/courtedge/state-integrity (token-guarded)
```

---

## 6. Every source of truth found

| Storage | Role pre-repair |
|---------|-----------------|
| `picksCache` / `board-cache.json` | Home board display |
| `tracked-props.json` | Results / grading |
| `slate-snapshots/{date}.json` | Official seal snapshots |
| `locked-slates` registry | Lock/phase |
| `history-archive/` | History |
| `three-slate-blocks-v2.json` | Lab frozen/active |
| `daily-slate-reports.json` | Lab reports |
| Bundled official freezes / recovery JSON | Restart LKG |
| Scheduler state JSON | Job locks |
| Frontend tab state | Display only (readOnly GETs) |

---

## 7. Which source became canonical

**Canonical owner:** `canonical-slates-v1.json` via `courtEdgeStateIntegrityV1` (`CanonicalSlate` + `decisionPackets[]` with `contentHash`).

Caches (`board-cache`, picksCache) **mirror** and must merge through `mergeByPrecedence` / day isolation. Results grades and Lab analysis attach as separate fields; they do not rewrite sealed packet fields.

---

## 8. Every writer removed, restricted, or redirected

| Writer | Change |
|--------|--------|
| `persistBoardAfterRefresh` | Day isolation + sealed market-refs-only + canonical sync |
| `cacheFresh` build mismatch | No longer forces regen when sealed Best 6 present |
| Force Refresh on sealed | Market reference fields only |
| Empty/partial provider | Rejected by merge precedence + existing empty-board guard |
| Stale client lower `recordVersion` | Rejected |
| Placeholder recovery | Cannot replace hydrated sealed |
| Reconciler | Lifecycle **links** only — no prop manufacture |
| GET tab routes | Unchanged readOnly (0 provider calls) |
| Copy Report | Remains pure format of Lab/Home payloads |

---

## 9. Every root cause classification

| # | Hypothesis | Classification | Evidence |
|---|------------|----------------|----------|
| 1 | Multiple independent sources of truth | **CONFIRMED ROOT CAUSE** | Board cache vs tracked vs snapshots vs Lab store |
| 2 | Tabs building separate slate objects | **CONFIRMED ROOT CAUSE** | Home display lists vs tracked Results vs Lab records |
| 3 | Tab open/refresh regenerates | **CONTRIBUTING FACTOR** | ReadOnly GETs OK; Force Refresh / build-mismatch regen unsafe |
| 4 | App resume regenerates | **CONTRIBUTING FACTOR** | Same as cacheFresh/build bump paths |
| 5 | Copy Report mutates | **NOT INVOLVED** | Formatters only; Fixture H + test R |
| 6 | Manual vs scheduler race | **CONFIRMED ROOT CAUSE** | Concurrent writers; mitigated by locks + merge |
| 7 | Grading vs refresh race | **CONTRIBUTING FACTOR** | Shared tracked props without packet lock historically |
| 8 | Rollover vs refresh race | **CONFIRMED ROOT CAUSE** | Tomorrow wipe on Today persist (progressive) |
| 9 | Two refreshes concurrent | **CONFIRMED ROOT CAUSE** | Scheduler lock tests; integrity locks added |
| 10 | Non-atomic persistence | **CONTRIBUTING FACTOR** | Some writes were direct writeFile; integrity uses tmp+rename |
| 11 | Progressive Today overwrites Tomorrow | **CONFIRMED ROOT CAUSE** | Prior home-completion + test E/F/T1 |
| 12 | Empty replaces LKG | **CONFIRMED ROOT CAUSE** | Empty-board guard history; merge rules 12–13 |
| 13 | Placeholder analysis replaces hydrated | **CONFIRMED ROOT CAUSE** | Restart 33.3% reports; test T2/I |
| 14 | Render restart loses memory | **CONFIRMED ROOT CAUSE** | Memory cache; disk LKG incomplete historically |
| 15 | Startup recovery weaker record | **CONFIRMED ROOT CAUSE** | Merge completeness / placeholder rules |
| 16 | Stale frontend writeback | **CONTRIBUTING FACTOR** | Large POST body seeds; version reject added |
| 17 | Today/Tomorrow unstable key | **CONFIRMED ROOT CAUSE** | Shared board document; dayBucket isolation required |
| 18 | UTC vs Chicago date | **CONFIRMED ROOT CAUSE** | Centralized `getCanonicalSlateDate` / test K |
| 19 | Post-UTC-midnight wrong slate | **CONFIRMED ROOT CAUSE** | Test K CT midnight |
| 20 | Slate IDs change Tomorrow→Today | **CONFIRMED ROOT CAUSE** | Stable `league\|date\|cohort\|market`; test J |
| 21 | Player/event IDs change providers | **CONTRIBUTING FACTOR** | Identity joins historically fragile |
| 22 | Array-index identity | **CONTRIBUTING FACTOR** | Rank/index used in places; propId now stable |
| 23 | Dedup differs by tab | **CONTRIBUTING FACTOR** | Different filters Home vs Results vs Lab |
| 24 | Schema migration drops fields | **CONTRIBUTING FACTOR** | Legacy eras; test P preserves |
| 25 | Legacy missing metadata | **CONTRIBUTING FACTOR** | Lab instrumentation flags |
| 26 | Null/empty/zero/false equated | **CONFIRMED ROOT CAUSE** | Stability audit + test T5 |
| 27 | Results rebuilds from markets | **CONTRIBUTING FACTOR** | Guarded by official membership; sealed hash now |
| 28 | Lab rebuilds from Results display | **CONTRIBUTING FACTOR** | Lab uses tracked official props; must not rerun engines |
| 29 | Completed detection wrong date/status | **CONTRIBUTING FACTOR** | Lifecycle compat ships |
| 30 | Lab default by insertion order | **CONFIRMED ROOT CAUSE** | Fixed toward newest completed; scan flags lag |
| 31 | Frozen block reconstructed | **CONTRIBUTING FACTOR** | Anchors + persist; test N |
| 32 | Fixtures too clean | **CONFIRMED ROOT CAUSE** | A–T adversarial suite added |
| 33 | Tests skip restart | **CONFIRMED ROOT CAUSE** | Tests H/Q/N added |
| 34 | Mixed FE/BE schema | **CONTRIBUTING FACTOR** | Build stamps; sealed survive build bump |
| 35 | Old clients cache payloads | **CONTRIBUTING FACTOR** | Stale version reject |
| 36 | Errors return empty board | **CONFIRMED ROOT CAUSE** | Empty-board guard lineage |
| 37 | Provider errors → empty valid | **CONFIRMED ROOT CAUSE** | Same + merge G |
| 38 | Partial refresh succeeds | **CONFIRMED ROOT CAUSE** | Progressive persist + F |
| 39 | Lifecycle not idempotent | **CONTRIBUTING FACTOR** | Transitions now idempotent keys; test M |
| 40 | Same slate multiple IDs | **CONFIRMED ROOT CAUSE** | Reconciler duplicate hash scan |

---

## 10. Exact files and functions changed

**New**
- `services/courtEdgeStateIntegrityV1.js` — canonical IDs, hashes, merge, locks, journal, board isolation, Force Refresh sealed path, paid-API counter, snapshot
- `services/courtEdgeStateReconcilerV1.js` — scan / dry-run / safe lifecycle-link repairs / missing-slate answers
- `scripts/testCourtEdgeStateIntegrityV1.js` — adversarial A–T (+ helpers)
- `COURTEDGE_END_TO_END_STATE_INTEGRITY_V1_REPORT.md` — this report

**Updated**
- `server.js` — `SERVER_BUILD`, `persistBoardAfterRefresh`, `cacheFresh`, health, internal endpoints
- `services/courtEdgeLabV2Constants.js` — `LAB_V2_BUILD`
- `scripts/testCourtEdgeHomeCompletionTomorrowSixV1.js` — test 62 build lock
- `package.json` — `test:courtedge-state-integrity`
- `.gitignore` — local baseline snapshots

**Primary functions:** `mergeByPrecedence`, `hashDecisionPacket`, `mergeBoardDayIsolation`, `applyForceRefreshToSealedBoard`, `syncBoardToCanonicalStore`, `transitionLifecycle`, `reconcileStateIntegrity`, `persistBoardAfterRefresh`.

---

## 11. Canonical entity and lifecycle design

Internal entities (not user-facing labels):

- `CanonicalSlate`
- `CanonicalDecisionPacket` (`decisionPackets[]`)
- `MarketReferenceSnapshot` (`marketReferences`)
- `ResultsGradeRecord` (`grades`)
- `LabAnalysisRecord` (`labAnalysis`)
- `LifecycleTransition` (journal entries)

Lifecycle (internal only):

`DRAFT → SEALED → IN_RESULTS → GRADED_COMPLETE → IN_LAB → IN_HISTORY`

---

## 12. Stable ID design

```text
slateId = {LEAGUE}|{America/Chicago YYYY-MM-DD}|{cohort}|{marketType}
example: WNBA|2026-07-20|officialbest6|playerpoints
```

Prop identity uses official prop id / durable player-team-opponent-side-line key — **not** array index.

Tomorrow→Today for the same calendar slate date keeps the **same** `slateId` and packet hashes when sealed.

---

## 13. Immutable packet and hash design

`contentHash = sha256(stableJSON(immutable decision fields))`  
Immutable: side, line, confidence, risk, rank, Top, projection presence, identities, sealedAt, etc.  
Mutable separately: `currentLine`, prices, books, closing refs.

Cross-surface invariant: Home/Results/Lab/History original packet hashes must match (`assertSealedImmutability`).

---

## 14. Persistence and atomic-write design

`atomicWriteJson`: write temp → validate JSON parse → copy `.bak` → `renameSync`.  
Crash recovery prefers `.bak` via `readJsonSafe`.  
Records carry `schemaVersion`, `recordVersion`, `updatedAt`, `contentHash` / `slateContentHash`, `completeness`.

---

## 15. Concurrency and idempotency design

- Existing scheduler persisted job locks retained.
- Added `acquireSlateLock` / `withSlateLock` (file-backed TTL locks).
- Lifecycle transitions support `idempotencyKey` (repeat = no-op).
- Merge rejects stale `recordVersion`.

---

## 16. Today/Tomorrow isolation repair

`mergeBoardDayIsolation` refuses empty day-bucket overwrites of populated opposite day.  
Covered by tests E, F, T1, T6 and prior empty-board progressive-persist guards.

---

## 17. Rollover repair

`rolloverSealedTomorrowToToday` asserts same `slateId`, prop IDs, content hashes, `sealedAt` when sealed.  
Unsealed drafts remain refreshable under pre-seal rules (not treated as locked official).

**Seal timing (documented):** Official seal occurs when Controlled Best 6 is committed via official slate seal / immutableOfficial stamping (Tomorrow and/or calendar Today per existing `officialSlateService` / home-completion calendar-today seal). Once sealed, rollover must not regenerate.

---

## 18. Results admission repair

Results must consume sealed packets (identity + hash). Track-all-six asserted: Home 6 ⇒ Results 6. Results may append grades only.

---

## 19. Lab promotion repair

Lab continues analysis-only (`writesLiveWeights=false`). Newest eligible completed official slate is lifecycle+date based (`resolveNewestCompletedOfficialSlateDate` + reconciler scan). Reconciler can **link** graded cohorts into canonical lifecycle without manufacturing props. No Jul-19 hardcode — general answers only.

---

## 20. Frozen-block persistence verification

Frozen previous block `[2026-07-14, 2026-07-15, 2026-07-16]` remains the production baseline; tests N + Lab fixture F assert membership immutability across reload.

---

## 21. Restart/recovery repair

Canonical store + `.bak` atomic writes; placeholder cannot replace hydrated sealed (tests H, I, Q, T2). `cacheFresh` no longer nukes sealed boards solely for `SERVER_BUILD` bump.

---

## 22. Refresh and paid-API behavior

| Action | Paid providers |
|--------|----------------|
| Open Home/Results/Lab/History (valid cache) | **0** (readOnly GETs) |
| Tab switch / resume / Copy Report | **0** |
| Browser reload with persisted board | **0** |
| Scheduler / Force Refresh | May call per existing rules |

Instrumented via `resetPaidApiCounter` / `recordPaidApiCall` / tests A,C,R.

---

## 23. Existing-state reconciliation results

Pre-deploy dry-run pattern: `POST /internal/courtedge/state-integrity/reconcile` with `{ "dryRun": true }` (scheduler token).

Baseline production (2026-07-20):
- Lab default `2026-07-17`, active `[2026-07-17]` 1/3, frozen `[07-14..07-16]`
- Home Today 6 / Tomorrow 6 present
- `tracked-props` active Results empty (store total 52) — Results hold pattern; reconciler answers without hardcoding dates

---

## 24. Orphaned, duplicate, or conflicting records found

Reconciler scans for: orphaned sealed board cohorts not in canonical store, completed-not-in-Lab, duplicate `slateContentHash` under multiple IDs, hash mismatches, frozen refs to missing dates, Lab default lagging newest eligible.

---

## 25. Exact explanation of any missing completed slate

For any date (including Jul 19), reconciler returns exactly one of:

1. Found exact sealed canonical cohort and repaired lifecycle link  
2. Found completed cohort but canonical identity conflict requires report  
3. Found partial/nonofficial data only; no mutation performed  
4. No qualifying canonical record found  

**No manufacturing / no historical evidence reconstruction.**

---

## 26. Tests added

`scripts/testCourtEdgeStateIntegrityV1.js` — A–T production failure shapes + helpers (34 assertions).  
Home completion test 62 updated to lock new `SERVER_BUILD` while retaining empty-board guard.

---

## 27. Full test totals and results

| Suite | Result |
|-------|--------|
| State integrity A–T | **34 passed, 0 failed** |
| Lab V2 | **87 passed, 0 failed** |
| Home completion | **80 passed, 0 failed** |
| Best 6 playable pool | **44 passed, 0 failed** |
| Analysis integrity | **19 passed** (suite green) |
| Scheduler V1 | **32 passed, 3 failed** (pre-existing idempotency count asserts `2==1` on duplicate morning/pregame windows — **not introduced by this change**; scheduler module untouched) |

---

## 28. Commit hashes

- `0582c50` — Establish CourtEdge end-to-end canonical state integrity (implementation + A–T tests + report)

---

## 29. Deployment details

- Branch: `betbrain-v2-rebuild`
- Remote: `orgin` (`3d49832..0582c50`)
- Render auto-deploy succeeded (~40s after push)
- Full hash: `0582c502aa75f086e2968f01e18c46bff1b19867`

---

## 30. Live build verification

| Check | Result |
|-------|--------|
| `GET /health` serverBuild | `courteedge-end-to-end-state-integrity-v1` |
| `stateIntegrityVersion` | `courteedge-end-to-end-state-integrity-v1` |
| `GET /top-props` readOnly | `true` |
| Today WNBA Best 6 | 6 (same players as baseline) |
| Tomorrow WNBA Best 6 | 6 (same players as baseline) |
| Lab buildVersion | `courteedge-end-to-end-state-integrity-v1` |
| Lab default | `2026-07-17` |
| Active three-slate | `[2026-07-17]` |
| Frozen previous | `[2026-07-14, 2026-07-15, 2026-07-16]` |
| writesLiveWeights | `false` |
| calibrationFeedbackEngine | `false` |
| `GET /internal/courtedge/state-integrity` | protected via `requireSchedulerToken` |

---

## 31. Pre-restart and post-restart hash comparison

Deploy restart is the production process restart.

**Pre-repair baseline (stability-audit) vs post-deploy (state-integrity-v1):**

| Surface | Pre-deploy hash prefixes | Post-deploy | Match |
|---------|--------------------------|-------------|-------|
| Today WNBA ×6 | `028c30… d83afa… abfd5e… 7eb4e1… 03df6c… c8975b…` | identical | **YES** |
| Tomorrow WNBA ×6 | `204283… cee595… 6734c3… a7e937… 3205d0… aefe5f…` | identical | **YES** |

Players/sides/lines/conf/risk unchanged. Tab-churn refetch ×5: stable.

---

## 32. Home/Results/Lab/History parity verification

- Home Today/Tomorrow sealed identity preserved across deploy.
- Lab default/active/frozen membership unchanged from stability-audit baseline.
- Repeated Lab reads stable.
- No new user-facing labels; weights unchanged.

---

## 33. Confirmation that production weights were unchanged

**Confirmed** live: `writesLiveWeights=false`, `calibrationFeedbackEngine=false`.

---

## 34. Confirmation that no user-facing labels were added

**Confirmed.** Only TRACK / NOT SELECTED / LOW / MEDIUM / HIGH / Top remain user-facing.

---

## 35. Confirmation that the app design was unchanged

**Confirmed** (backend state-flow only).

---

## 36. Remaining limitations

- Scheduler unit suite still has 3 pre-existing idempotency count failures unrelated to this diff.
- Reconciler apply requires scheduler token; always dry-run first.
- Historical missing official cohorts cannot be manufactured (by design).

---

## 37. Final verdict

```text
STATE INTEGRITY VERIFIED
```

Production deploy/restart preserved Today+Tomorrow sealed packet hashes identical to the pre-repair baseline; readOnly tab refetch churn did not mutate boards; Lab newest eligible default and frozen blocks remained intact; weights and labels unchanged.

---

### Phase checklist

| Phase | Status |
|-------|--------|
| 1 Baseline snapshot | Done (gitignored `.state-integrity-baseline-v1/`) |
| 2 Source-of-truth map | Done (§4–8) |
| 3 Hypothesis classification | Done (§9 all 40) |
| 4 Canonical architecture | Done |
| 5 Tabs read-only / Copy purity / Lab newest | Done |
| 6 Refresh / paid API / locks | Done |
| 7 Chicago date / rollover | Done |
| 8 Reconciler dry-run + safe links | Done |
| 9 Invariants | Done |
| 10 Tests A–T | Done 34/34 |
| 11 Logs + internal endpoint | Done |
| 12 Prod verification | Done — live build + restart hash parity |

