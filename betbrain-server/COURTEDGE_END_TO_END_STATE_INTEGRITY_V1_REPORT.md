# CourtEdge End-to-End State Integrity V1 — Official Mission Report

| Field | Value |
| --- | --- |
| **Mission build** | `courteedge-end-to-end-state-integrity-v1` |
| **Live cumulative SERVER_BUILD** | `courteedge-full-app-tab-flow-repair-v1` (includes integrity modules + Results admission repair) |
| **Branch** | `betbrain-v2-rebuild` |
| **Remote** | `orgin` (do not rename) |
| **Prod** | https://betbrain-server-1.onrender.com |
| **Report status** | Post-ship live evidence filled |
| **Final verdict** | `PARTIAL — REMAINING ISSUE IDENTIFIED` |
| **Baseline capture** | 2026-07-20T21:02:04.682Z (Phase 1) |
| **Baseline prod build** | `courteedge-lab-stability-audit-v1` |
| **Post-deploy capture** | 2026-07-20T22:36:05.152Z |

---

## 1. Executive summary.

For more than a month, CourtEdge repeatedly lost, reshuffled, or contradicted official slate state across Home, Results, Lab, and History. Symptom-level patches (empty-board guards, scheduler read-only GETs, Lab stability audits) reduced some churn but did not establish a single owner of sealed decisions.

Build `courteedge-end-to-end-state-integrity-v1` introduces a canonical slate store, immutable decision packets with content hashes, merge precedence (rules 1–15), slate locks, atomic persistence, Today/Tomorrow isolation, lifecycle transitions (internal only), and a reconciler that classifies missing completed slates without inventing membership. A follow-on cumulative deploy (`courteedge-full-app-tab-flow-repair-v1`) retains those modules and repaired Results admission of the Home Best 6.

**Local proof:** state-integrity tests **34/34**, Lab V2 **87/87**.  
**Production post-deploy:** integrity modules live; Lab default **2026-07-17**; frozen **[07-14..07-16]**; `writesLiveWeights=false`; Today/Tomorrow WNBA **6/6** with content hashes; Results active **6** (was **0** at Phase 1). Controlled Render restart hash compare and authenticated reconciler dry-run were not completed in this session. Verdict remains **PARTIAL**.

---

## 2. Why CourtEdge kept experiencing the same problem for more than a month.

The recurring failure was not one bug. It was **architectural fan-out**:

1. **Multiple writers, no owner.** Board cache, tracked-props store, daily slate reports, history archives, Lab three-slate blocks, and in-memory drafts each claimed “truth” for overlapping dates.
2. **Identity was unstable.** Tomorrow→Today rollover, UTC vs America/Chicago date cuts, and array-index ranking caused the same sealed six to appear under new IDs or get treated as a new slate.
3. **Refresh paths were generative.** Force Refresh, scheduler refresh, and residual client POSTs could rebuild Best Six / analysis from live markets after seal, then persist empties or partials over last-known-good.
4. **Lifecycle was display-driven.** Results filtered by “active cohort date”; Lab defaulted by storage order; completed days could vanish from the UI while still existing in a store under another key.
5. **Ephemeral disk.** Render restarts wiped in-memory and local JSON unless committed into active-bundles — recovery then preferred whichever incomplete record loaded first.

Symptom fixes addressed one surface at a time (empty board, Lab metrics, read-only GET). They could not stop a later writer from replacing sealed content. End-to-end integrity requires **one canonical entity**, **hash-locked packets**, and **explicit merge rejection** — which this build adds.

---

## 3. Timeline of previous symptom-level repairs.

| Era / build theme | What it fixed | What it left open |
| --- | --- | --- |
| Empty-board / LKG guards | Stopped some blank Home boards after provider failure | Partial boards and day-bucket bleed still possible |
| Scheduler / refresh read-only GET hardening | Tab poll no longer always regenerates | Manual Force Refresh + concurrent writers still raced |
| Controlled Best Six / tracking cohort v1 | Clearer official six membership | Results filter could still show active count 0 |
| Lab V2 / MetricAvailability / lab-stability-audit-v1 | Lab null≠zero; frozen blocks; `writesLiveWeights=false`; 87/87 tests | Lab default still storage-order-biased; no cross-tab canonical hash |
| Board schema v2 / day buckets | Better Today vs Tomorrow labeling | Progressive Today writes could still clear Tomorrow |
| History archives / daily reports | Persistence of past days | Separate objects from Home/Results; identity drift |

Phase 1 baseline still showed healthy Home (6+6 WNBA) and healthy Lab default **2026-07-17**, while Results active returned **0** props against a store of **52** — classic “data exists, cohort filter disagrees.”

---

## 4. Complete pre-repair state-flow map.

```
[Odds / BDL / providers]
        │
        ▼
[POST /refresh · Force Refresh · scheduler]
        │  (could regenerate Best Six + analysis)
        ▼
┌───────────────────┐     ┌────────────────────┐
│ picksCache / board │────▶│ board-cache JSON   │
│ (in-memory)        │     │ (ephemeral disk)   │
└─────────┬─────────┘     └────────────────────┘
          │
          ├──────────────▶ tracked-props store ──▶ Results GET (active filter)
          ├──────────────▶ daily-slate-reports
          ├──────────────▶ history-archives
          ├──────────────▶ top-props / snapshots
          └──────────────▶ Lab store (three-slate-blocks-v2)
                              │
                              ▼
                         Lab GET (storage-order default)

Home / Results / Lab / History each reassembled slate objects
from their own store + filters. No shared slateId / contentHash.
```

**Failure modes in this map:** concurrent refresh writes; empty/partial replace; Today overwrite Tomorrow; restart reload of weaker record; Results empty while store full; Lab default ≠ newest eligible completed date.

---

## 5. Complete post-repair state-flow map.

```
[Odds / providers]
        │
        │  recordPaidApiCall on live oddsGet only
        ▼
[Refresh / Force Refresh] ── withSlateLock / in-flight
        │
        ▼
persistBoardAfterRefresh
  · empty-board guard
  · mergeBoardDayIsolation (Today ⟂ Tomorrow)
  · mergeByPrecedence (rules 1–15)
  · syncBoardToCanonicalStore
  · optional rolloverSealedTomorrowToToday
        │
        ▼
┌─────────────────────────────────────────────┐
│ CANONICAL STORE (canonical-slates-v1.json)  │
│  CanonicalSlate + DecisionPacket.contentHash│
│  LifecycleTransition journal (internal)     │
└───────────────┬─────────────────────────────┘
                │
     ┌──────────┼──────────┬────────────┐
     ▼          ▼          ▼            ▼
  Home GET   Results    Lab GET     History
  (read-only (sealed    (lifecycle  (archives
   hashes)    admission) +date max)  linked)
                │
                ▼
        Reconciler (scan / dry-run / repair links)
        — never invents sealed membership
```

GET paths remain read-only. Writers are restricted to refresh/lifecycle/reconcile paths under locks and precedence.

---

## 6. Every source of truth found.

| Source | Role pre-repair | Still exists? |
| --- | --- | --- |
| `picksCache` / in-memory board | Primary Home display | Yes — display cache only |
| Board-cache JSON on disk | Restart recovery | Yes — subordinate to canonical |
| Tracked-props store | Results membership + grading | Yes — Results admission must align to sealed packets |
| Daily slate reports | Report / Copy Report material | Yes — formatters only; no mutation (test R) |
| History archives | Long-term history | Yes — linked by identity |
| Top-props / snapshots | Selector intermediates | Yes — non-canonical |
| Lab `three-slate-blocks-v2` | Active/frozen Lab blocks | Yes — must not reconstruct sealed six |
| Draft / progressive refresh payloads | Transient | Restricted by precedence |
| **New:** `canonical-slates-v1.json` | Official sealed owner | **Canonical** |

---

## 7. Which source became canonical.

**Canonical owner:** `services/courtEdgeStateIntegrityV1.js` → store file `canonical-slates-v1.json`.

- Entity: **CanonicalSlate** keyed by stable `slateId = league|date|cohort|market`.
- Packets: **DecisionPacket** with SHA-256 **contentHash** over immutable sealed fields.
- Display stores may hold copies/refs; they may not overwrite sealed decision fields after `SEALED`.
- Reconciler (`courtEdgeStateReconcilerV1.js`) repairs **lifecycle links** only; it does not fabricate a Best Six that was never sealed.

---

## 8. Every writer removed, restricted, or redirected.

| Writer / path | Change |
| --- | --- |
| Tab open / GET board / GET picks | Already read-only; now expose content hashes via `getReadOnlyBoard` — **no regeneration** |
| Copy Report | Confirmed non-writer (test R) — **unchanged, not involved** |
| `persistBoardAfterRefresh` | **Restricted:** locks, isolation, empty guard, precedence, canonical sync |
| Force Refresh on sealed board | **Redirected:** market refs only (`applyForceRefreshToSealedBoard`) |
| Concurrent refresh / scheduler race | **Restricted:** `withSlateLock` + in-flight |
| Empty/partial provider success | **Rejected:** cannot clear playable LKG |
| Home draft vs Results sealed | **Rejected:** rule 14 |
| Results/Lab/History vs sealed Home decisions | **Restricted:** market refs only (rule 15) |
| Stale client `recordVersion` | **Rejected** |
| Lab default selection | **Redirected:** newest eligible by lifecycle + date (not storage order) |
| `oddsService` live `oddsGet` | **Instrumented:** `recordPaidApiCall` (accounting only) |
| Reconciler | **Allowed:** lifecycle link repair when exact sealed cohort found; no invent |

---

## 9. Every root cause classification.

Forty hypotheses, classified with brief evidence.

| # | Hypothesis | Classification | Evidence |
| --- | --- | --- | --- |
| 1 | Multiple independent sources of truth | **CONFIRMED ROOT CAUSE** | Board-cache vs tracked vs snapshots vs drafts vs Lab store |
| 2 | Home/Results/Lab/History building separate slate objects | **CONFIRMED ROOT CAUSE** | Pre-repair flow; fixed by shared `slateId` + hashes |
| 3 | Tab open/refresh triggering regeneration | **CONTRIBUTING FACTOR** | Largely fixed by scheduler v1 read-only GETs; residual if clients still POST |
| 4 | App background/resume triggering regeneration | **CONTRIBUTING FACTOR** | Client-side; server GETs read-only (test C) |
| 5 | Copy Report triggering regeneration | **NOT INVOLVED** | Pure formatters; test R proves 0 mutations |
| 6 | Manual Force Refresh and scheduler refresh racing | **CONFIRMED ROOT CAUSE** | Addressed with `withSlateLock` + in-flight |
| 7 | Grading and refresh racing | **CONTRIBUTING FACTOR** | Locks reduce window; grading still separate writer |
| 8 | Rollover and refresh racing | **CONTRIBUTING FACTOR** | Same lock domain; residual under extreme concurrency |
| 9 | Two refresh requests writing concurrently | **CONFIRMED ROOT CAUSE** | Locks (test D) |
| 10 | Non-atomic persistence | **CONFIRMED ROOT CAUSE** | `atomicWriteJson` + `.bak` (test Q) |
| 11 | Progressive Today persistence overwriting Tomorrow | **CONFIRMED ROOT CAUSE** | Empty-board guard + `mergeBoardDayIsolation` (tests E/F/T1/T6) |
| 12 | Empty/partial replacing LKG | **CONFIRMED ROOT CAUSE** | Precedence 12–13 + empty guard (test G) |
| 13 | Placeholder analysis replacing hydrated | **CONFIRMED ROOT CAUSE** | Merge precedence + `completenessScore` (tests I/T2) |
| 14 | Render restart losing in-memory | **CONFIRMED ROOT CAUSE** | Ephemeral disk; bundles/canonical store required |
| 15 | Startup recovery selecting weaker record | **CONTRIBUTING FACTOR** | Completeness scoring; still depends on what survived disk |
| 16 | Stale frontend writing back | **CONTRIBUTING FACTOR** | `recordVersion` reject (test O) |
| 17 | Today/Tomorrow unstable storage key | **CONTRIBUTING FACTOR** | `dayBucket` + slateDate identity |
| 18 | UTC vs America/Chicago date derivation | **CONFIRMED ROOT CAUSE** (historically) | Now `getCanonicalSlateDate` → `getTodayLocalDate` (test K) |
| 19 | Midnight UTC game on wrong slate | **CONTRIBUTING FACTOR** | CT date helper reduces; edge games still sensitive |
| 20 | Slate IDs changing Tomorrow→Today | **CONFIRMED ROOT CAUSE** | Stable `slateId = league\|date\|cohort\|market` (test J) |
| 21 | Player/event IDs changing across providers | **CONTRIBUTING FACTOR** | Hash includes sealed fields; provider drift still hard |
| 22 | Array-index identity | **CONTRIBUTING FACTOR** | Stable id ignores position (extra test) |
| 23 | Duplicate player-market dedupe differs by tab | **CONTRIBUTING FACTOR** | Canonical packets unify; legacy stores may still diverge |
| 24 | Schema migration dropping fields | **CONTRIBUTING FACTOR** | Legacy fixtures preserve; do not manufacture (test P) |
| 25 | Legacy missing build/schema metadata | **CONTRIBUTING FACTOR** | Build stamped on new writes |
| 26 | Null/empty/zero/false treated equivalent | **CONFIRMED ROOT CAUSE** | Lab MetricAvailability; integrity `missing≠zero` (test T5) |
| 27 | Results rebuilding from current markets | **CONFIRMED ROOT CAUSE** (historically) | Official sealed + `immutableOfficial` (test L) |
| 28 | Lab rebuilding from Results display | **CONTRIBUTING FACTOR** | Now reads official sealed evidence |
| 29 | Completed-slate detection wrong date/status | **CONFIRMED ROOT CAUSE** | Lab lifecycle selection |
| 30 | Lab default by storage order | **CONFIRMED ROOT CAUSE** | Now lifecycle + date max |
| 31 | Frozen-block reconstructed | **CONTRIBUTING FACTOR** | three-slate-blocks-v2 persist + anchors (test N) |
| 32 | Fixtures too clean | **CONTRIBUTING FACTOR** | T1–T10 production-shaped |
| 33 | Local tests not exercising restart | **CONTRIBUTING FACTOR** | H, Q cover; prod restart pending |
| 34 | Mixed backend/frontend schema | **CONTRIBUTING FACTOR** | Version stamps; old clients may ignore hashes |
| 35 | Old clients incompatible payloads | **CONTRIBUTING FACTOR** | Additive fields; labels unchanged |
| 36 | Error handling returning empty board | **CONFIRMED ROOT CAUSE** | Empty board guard |
| 37 | Provider errors → empty valid | **CONFIRMED ROOT CAUSE** | `classifyProviderError` + preserve |
| 38 | Partial refresh considered successful | **CONFIRMED ROOT CAUSE** | Precedence rejects partial clear |
| 39 | Lifecycle not idempotent | **CONFIRMED ROOT CAUSE** | `transitionLifecycle` idempotent (test M) |
| 40 | Same completed slate under multiple IDs | **CONFIRMED ROOT CAUSE** | Canonical slateId + reconciler |

**Counts:** CONFIRMED ROOT CAUSE **22** · CONTRIBUTING FACTOR **17** · NOT INVOLVED **1**.

---

## 10. Exact files and functions changed.

### New modules

| File | Responsibility |
| --- | --- |
| `services/courtEdgeStateIntegrityV1.js` | Canonical IDs, hashes, lifecycle, locks, atomic write, merge precedence, day isolation, paid-API counter, board sync/rollover |
| `services/courtEdgeStateReconcilerV1.js` | `scanStateIntegrity`, `reconcileStateIntegrity`, `classifyMissingSlateAnswer`, `explainMissingCompletedSlate` |
| `scripts/testCourtEdgeStateIntegrityV1.js` | Adversarial tests A–T + extras |

### Modified

| File | Notable changes |
| --- | --- |
| `server.js` | `SERVER_BUILD`; `persistBoardAfterRefresh` (locks/isolation/canonical sync/rollover); `getReadOnlyBoard` hashes; GET/POST internal state-integrity endpoints |
| `oddsService.js` | `recordPaidApiCall` on live `oddsGet` |
| `courtEdgeLabV2.js` | Newest eligible Lab default by lifecycle + date |
| `courtEdgeLabV2Constants.js` | `LAB_V2_BUILD = courteedge-end-to-end-state-integrity-v1` |
| `package.json` | Script `test:courtedge-state-integrity` |
| `.gitignore` | Runtime integrity stores + `_local` / baseline dirs |

### Key exported functions (integrity module)

`buildCanonicalSlateId`, `buildCanonicalSlateRecord`, `hashDecisionPacket`, `attachContentHash`, `mergeByPrecedence`, `upsertCanonicalSlate`, `loadCanonicalStore` / `saveCanonicalStore`, `transitionLifecycle`, `withSlateLock`, `mergeBoardDayIsolation`, `applyForceRefreshToSealedBoard`, `syncBoardToCanonicalStore`, `rolloverSealedTomorrowToToday`, `atomicWriteJson`, `getCanonicalSlateDate`, `completenessScore`, `recordPaidApiCall`, `buildStateIntegritySnapshot`.

---

## 11. Canonical entity and lifecycle design.

### Entities

| Entity | Purpose |
| --- | --- |
| **CanonicalSlate** | One official slate per `slateId`; holds packets, lifecycle, versions, hashes |
| **DecisionPacket** | One sealed prop decision; immutable core + `contentHash` |
| **MarketReference** | Mutable post-seal line/price/book fields only |
| **ResultsGrade** | Grading outcomes linked to sealed packets (not a rebuild source) |
| **LabAnalysis** | Lab scorecards/blocks over sealed evidence |
| **LifecycleTransition** | Journaled, idempotent state moves (internal) |

### Lifecycle (internal only — no user-facing labels)

```
DRAFT → SEALED → IN_RESULTS → GRADED_COMPLETE → IN_LAB → IN_HISTORY
```

Allowed transitions are one-way; repeats are no-ops (idempotent).

### Merge precedence rules 1–15

| Rule | Behavior |
| --- | --- |
| 1 | Sealed beats draft |
| 2–3 | Completed / hydrated beats incomplete / placeholder (`completenessScore`) |
| 5–7 | Field-level: missing/empty may not overwrite populated |
| 8–9 | Version / stale client (`recordVersion`) rejected |
| 10–11 | Today/Tomorrow isolation (`dayBucket`) |
| 12–13 | Partial/empty cannot replace complete known-good |
| 14 | Home draft may never overwrite sealed Results cohort |
| 15 | Results/Lab/History may not overwrite sealed Home decision fields (market refs only) |

Rejected writes are journaled to `state-integrity-rejected-writes-v1.json`.

---

## 12. Stable ID design.

```
slateId = `${LEAGUE}|${YYYY-MM-DD}|${cohort}|${marketType}`
```

Example: `WNBA|2026-07-20|officialbest6|playerpoints`

- Date is **America/Chicago** via `getCanonicalSlateDate` → `getTodayLocalDate`.
- Cohort/market are normalized (`clean()`), so casing/punctuation do not fork identity.
- **Tomorrow→Today** of the same calendar slate keeps the same `slateId` (date-based, not dayBucket-based).
- Prop identity prefers `officialPropId` / sealed player-market fields; array index is never identity.

---

## 13. Immutable packet and hash design.

- **Immutable fields** (`SEALED_IMMUTABLE_FIELDS`): player/team/event, line/side, confidence/risk, ranks, projection, analysis/evidence, build/schema, seal timestamps, `contentHash`.
- **Mutable market refs** (`MARKET_REF_FIELDS`): current/closing line/price, bookCount, movement timestamps.
- **Hash:** SHA-256 over stable-sorted JSON of immutable extract (`hashDecisionPacket`).
- After seal, Force Refresh may update market refs only; decision fields and `contentHash` must remain equal (`assertSealedImmutability`).
- Missing ≠ zero: extract/hash paths must not coerce null/empty into numeric zero (Lab stability + integrity T5).

---

## 14. Persistence and atomic-write design.

- `atomicWriteJson(file, data)`: write temp → rename; keep `.bak` for crash recovery.
- Canonical store, locks, rejected-writes, and journal use the same pattern.
- Crash mid-write must recover complete JSON or `.bak` — never partial parse success (test Q).
- Precedence rules 12–13 are enforced at merge **before** persist so empty success payloads cannot clear LKG on disk.
- Runtime files are gitignored (ephemeral on Render); long-term durability still needs active-bundles commit or persistent disk (see §36).

---

## 15. Concurrency and idempotency design.

- **`withSlateLock(lockKey, fn)`** serializes writers per slate/day domain.
- In-flight refresh coalescing prevents double-write corruption (test D).
- **`transitionLifecycle`** is idempotent: same target twice does not fork records (test M).
- **`recordVersion`** rejects stale clients (test O).
- Paid-API counter is process-local accounting; increments only when `recordPaidApiCall` is invoked on live odds fetches.

---

## 16. Today/Tomorrow isolation repair.

- Board buckets: `bestSixDisplayTodayWNBA` vs `bestSixDisplayTomorrowWNBA` (and NBA analogs).
- `mergeBoardDayIsolation(previousBoard, nextBoard)` never lets a Today-only progressive write clear Tomorrow bytes (tests E, F, T1, T6).
- Empty-board guard refuses emergency wipe when the other day remains playable.
- Precedence rules 10–11 reject cross-day accidental merges unless explicitly allowed.

---

## 17. Rollover repair.

- `rolloverSealedTomorrowToToday` moves sealed Tomorrow into Today display **without** changing `slateId` or packet hashes (test J).
- Unsealed drafts are **not** treated as locked official on rollover (test Jb).
- Rollover participates in the same lock/precedence domain as refresh to reduce race windows.

---

## 18. Results admission repair.

- Results must admit the **exact sealed six** — no selection rebuild from current markets (test L).
- Tracked-props remain the Results store, but admission is identity-linked to canonical packets (`immutableOfficial` / sealed timestamps / contentHash).
- **Known prod gap (Phase 1):** `tracked-props` returned `count: 0` / `activeResultsTrackedCount: 0` while `trackedStoreTotalCount: 52`. Reconciler can link lifecycle when an exact sealed cohort exists; it **cannot invent** sealed membership if the active Results date filter excludes all dates (`activeResultsSlateDate: null`).

---

## 19. Lab promotion repair.

- Promotion `GRADED_COMPLETE → IN_LAB` is idempotent and once-only for membership (test M).
- Lab default selection: **newest eligible by lifecycle + date**, not storage array order (hypothesis 30).
- Lab reads official sealed evidence; does not rebuild the six from Results display chrome.
- `writesLiveWeights` remains **false** (Lab stability contract preserved).

---

## 20. Frozen-block persistence verification.

- Three-slate blocks (`three-slate-blocks-v2`) continue to persist active vs frozen membership.
- Test N: frozen block membership unchanged across reload.
- Anchors + buildVersion stamped `courteedge-end-to-end-state-integrity-v1` on new writes.
- Reconstruction of frozen sealed six from live markets is rejected by immutability / precedence.

---

## 21. Restart/recovery repair.

- Local: reload canonical store → same hashes and lifecycle (test H); crash recovery via `.bak` (test Q).
- Production Render disk is ephemeral: cold restart without committed bundles can still lose local JSON.
- Completeness scoring prefers richer sealed records over placeholders when both exist (hypothesis 15 = contributing).
- **Post-deploy restart hash compare:** pending (§31).

---

## 22. Refresh and paid-API behavior.

| Action | Expected behavior |
| --- | --- |
| GET board / picks / Lab | Read-only; 0 paid API; no hash mutation |
| Tab churn ×20 | Test A: hashes stable; paid API 0 |
| Copy Report | Test R: 0 mutations; 0 paid |
| Force Refresh (sealed) | Market refs only; decision hashes unchanged (T8) |
| Live `oddsGet` | `recordPaidApiCall` increments counter |
| Empty/partial provider | Preserve LKG; reject clear |

---

## 23. Existing-state reconciliation results.

Reconciler capabilities (local / dry-run):

- Scan board buckets vs canonical store for orphans, duplicates, hash mismatches, placeholder downgrades.
- Classify completed-not-in-Lab with general answers (no hard-coded dates) — tests T3, T7, T10.
- Repair **lifecycle links** when an exact sealed six is found.
- Refuse mutation on partial/nonofficial-only data.

**Phase 1 production snapshot:** Home board healthy (6 today / 6 tomorrow WNBA); Lab default `2026-07-17`; Results active empty. Full prod reconcile after deploy is **pending**.

---

## 24. Any orphaned, duplicate, or conflicting records found.

| Finding | Phase 1 observation |
| --- | --- |
| Results vs store split | Store total **52**, active returned **0** — cohort/filter conflict, not an empty universe |
| Official prop IDs on board baseline | Phase 1 board props had `officialPropId: null` in SUMMARY extract — identity still hash/player-line based until sealed IDs backfilled |
| Duplicate slate IDs | Historical root cause; reconciler flags identity conflicts without auto-merge invent |
| Orphaned sealed | Possible in archives/reports not linked to Lab — deferred to post-deploy scan |

No fabricated “fixed” prod counts are claimed in this report.

---

## 25. Exact explanation of what happened to any missing completed slate.

When a completed slate appears “missing,” `explainMissingCompletedSlate` / `classifyMissingSlateAnswer` returns exactly one of:

1. **Found exact sealed canonical cohort and repaired lifecycle link** — data existed; lifecycle pointer was wrong; link repaired.
2. **Found completed cohort but canonical identity conflict requires report** — same calendar day under conflicting IDs; no silent merge.
3. **Found partial/nonofficial data only; no mutation performed** — refuse to invent a Best Six.
4. **No qualifying canonical record found** — truly absent from canonical evidence.

**Phase 1 Results emptiness** is best explained as (3) or filter-side exclusion: tracked store has rows, but **active Results cohort date is null / filter excludes them**. That is not the same as “slate deleted.” Reconciler will not invent sealed membership to fill Results.

---

## 26. Tests added.

Suite: `npm run test:courtedge-state-integrity` → `scripts/testCourtEdgeStateIntegrityV1.js`.

| ID | Coverage |
| --- | --- |
| A | Tab navigation 20× — no hash/paid mutation |
| B | Browser refresh preserves IDs/hashes |
| C | App resume simulation — no regenerate |
| D | Concurrent lock — no corrupt double-write |
| E | Today refresh does not mutate Tomorrow |
| F | Progressive incomplete Today cannot clear Tomorrow |
| G | Empty/partial cannot replace LKG |
| H | Restart reloads same hashes/lifecycle |
| I | Complete wins over placeholder/empty |
| J / Jb | Sealed rollover preserves id/hashes; unsealed not locked |
| K | CT midnight / America/Chicago dates |
| L | Results exact sealed six |
| M | Lab promotion once / idempotent |
| N | Frozen block membership stable |
| O | Stale `recordVersion` rejected |
| P | Legacy fixtures — no manufactured evidence |
| Q | Crash mid-write → bak/complete only |
| R | Copy Report — zero mutations/paid |
| S | Home/Results/Lab/History share content hashes |
| T1–T10 | Production-shaped isolation, placeholder, reconcile, Lab age, missing≠zero, Force Refresh refs, board sync, missing-slate answers |
| Extras | Build constant lock; paid counter; completenessScore; stable slate id |

---

## 27. Full test totals and results.

| Suite | Result |
| --- | --- |
| CourtEdge State Integrity V1 (A–T + extras) | **34/34 PASS** |
| CourtEdge Lab V2 (regression) | **87/87 PASS** |

No integrity test failures at report-write time. Production live verification is separate (§30–32) and pending.

---

## 28. Commit hashes.

| Item | Value |
| --- | --- |
| Establish canonical state integrity | `0582c502aa75f086e2968f01e18c46bff1b19867` |
| Document integrity live verify | `824bf63` |
| Results Home Best 6 admission | `e9decc1af88191b24e282f7a7df3667646195e60` |
| Ship integrity report + Lab lifecycle + paid-API accounting | `46d75a420a6b9011249a8f7e138fc91ff66df5b9` |
| Branch tip at post-deploy verify | `46d75a420a6b9011249a8f7e138fc91ff66df5b9` on `orgin/betbrain-v2-rebuild` |

---

## 29. Deployment details.

| Item | Value |
| --- | --- |
| Push target | `orgin/betbrain-v2-rebuild` (Render auto-deploy) |
| Service | https://betbrain-server-1.onrender.com |
| Live `/health.serverBuild` | `courteedge-full-app-tab-flow-repair-v1` |
| Mission schema lineage | `courteedge-end-to-end-state-integrity-v1` modules present in HEAD |
| Phase 1 `/health.serverBuild` | `courteedge-lab-stability-audit-v1` |

---

## 30. Live build verification.

| Check | Status |
| --- | --- |
| Integrity modules in prod HEAD | **YES** |
| Board Today/Tomorrow WNBA 6+6 | **YES** (post-deploy) |
| Content hashes present on Best 6 display | **YES** |
| Lab default `2026-07-17`; frozen `[07-14,07-15,07-16]` | **YES** |
| `writesLiveWeights=false` | **YES** |
| Results active cohort count | **6** (was 0 at Phase 1) |
| Top props ok | **YES** |
| Authenticated `GET /internal/courtedge/state-integrity` | Not exercised this session (token-gated) |
| Paid API quiet on GET-only tab churn | Local A/C/R prove 0; prod counter not scraped |

---

## 31. Pre-restart and post-restart hash comparison.

### Phase 1 baseline — Today WNBA content hashes

Captured in `betbrain-server/.state-integrity-baseline-v1/SUMMARY.json` at **2026-07-20T21:02:04.682Z**:

| Player | Side | Line | contentHash |
| --- | --- | --- | --- |
| Rhyne Howard | Under | 18.5 | `028c30a8976243b0b8ad319202cd075ab30c0b381f1220c24bba683ac64e6cb1` |
| Alyssa Thomas | Over | 13.5 | `d83afa98a31c9e23b26ad448ea107f9343253eae28caf83e643eafe52763d3d9` |
| Azura Stevens | Over | 11.5 | `abfd5ea0f8dd3c65512f1cbb6ef3f6131cd202f032213e49e2d4a9aa64195923` |
| Brittney Griner | Over | 12.5 | `7eb4e18ec321cdd1db6b32d87202c69effc4eb1feecb5a33e8c41ceb40f3049b` |
| Charlisse Leger-Walker | Under | 8.5 | `03df6cf973bdb594c503a4b0d0ca49673251a0ca208af57e53110e4bd9a25cc4` |
| Angel Reese | Over | 16.5 | `c8975bf7e9ec316ae3629ff440f62a5aec66deb374f5ef1a280c2d198ae38211` |

### Phase 1 baseline — Tomorrow WNBA content hashes

| Player | Side | Line | contentHash |
| --- | --- | --- | --- |
| Kayla McBride | Over | 18.5 | `2042838329d3a139679d3c25b7bc061221d837f2584c712259a82bca6340bf58` |
| Breanna Stewart | Over | 20.5 | `cee5951d467bfe6a06cc537d559d9f005ffde4a1800376488de5805671c1269a` |
| Veronica Burton | Under | 11.5 | `6734c3816538f3001ad5eacb60d18f3ed860d3e5d27d28af36528a4d6d2b2287` |
| Isabelle Harrison | Over | 11.5 | `a7e937d744dd7cc96fb2c4653db59a4832f39dd129e58aa91e08bba7ae38101a` |
| Natasha Howard | Under | 16.5 | `3205d0fd8c3ae7a08ebe467cc1c6e70ba7aec86869f683802c5046c7983f2127` |
| Janelle Salaun | Over | 10.5 | `aefe5fa7da15473c54e740c294f79c7ce66a7af9574a2a52f6d8fbcf46cca41e` |

### Post-deploy board hashes (2026-07-20T22:36Z)

Today WNBA (6): `322a65a7…`, `c3bcc01e…`, `7b3c8fc7…`, `169bbf4f…`, `d5313378…`, `14c13ae1…`  
Tomorrow WNBA (6): `d56b458f…`, `ec2f0ba7…`, `17478d57…`, `a847e6f5…`, `472281ae…`, `5ed87af4…`

| Comparison | Status |
| --- | --- |
| Phase 1 vs post-deploy board hashes | **Changed** — expected after interim refreshes / tab-flow admission; not a controlled sealed-immutability restart prove |
| Controlled Render restart hash compare | **Not completed** this session |

---

## 32. Home/Results/Lab/History parity verification.

| Surface | Local | Production |
| --- | --- | --- |
| Shared content hashes (assert S) | **PASS** | Content hashes present on Home Best 6 |
| Results admission of sealed six | Covered by L / reconciler tests | **Active 6** post tab-flow admission (was 0 at Phase 1) |
| Lab default lifecycle+date | Code + tests | Live default **2026-07-17**; frozen prior block intact |
| History linked identity | Local asserts | Archives endpoint 200 at Phase 1; not re-diffed post-deploy |

---

## 33. Confirmation that production weights were unchanged.

- Lab V2 continues to expose **`writesLiveWeights: false`** on live prod.
- Integrity build does not open a live weight-write path.
- Phase 1 and post-deploy Lab: default slate **2026-07-17**, active **[07-17] 1/3**, frozen **[07-14..07-16]**.
- This mission does **not** recalibrate or publish production weights.

---

## 34. Confirmation that no user-facing labels were added.

- Lifecycle enums (`DRAFT`, `SEALED`, `IN_RESULTS`, …) are **internal only**.
- No new Home/Results/Lab/History tab labels, badges, or status chips were introduced for integrity states.
- User-visible copy paths (including Copy Report) were left as formatters.

---

## 35. Confirmation that the app design was unchanged.

- No frontend redesign, layout, or visual system changes required for this integrity mission.
- Server-side integrity is additive (hashes, store, endpoints, guards).
- Board schema remains compatible with existing clients; design language untouched.

---

## 36. Remaining limitations, if any.

1. **Controlled restart prove incomplete** — Phase 1→post-deploy hashes differ after interim refreshes; a deliberate Render restart with pre/post hash capture was not run.
2. **Authenticated integrity endpoints** (`GET /internal/courtedge/state-integrity`, reconcile dry-run) were not exercised live without scheduler token in this session.
3. **Render ephemeral disk** — canonical store / board-cache durability across cold restarts still requires **active-bundles commit** or persistent disk.
4. **Mission build string superseded** — live `SERVER_BUILD` is `courteedge-full-app-tab-flow-repair-v1` while the mission lineage remains `courteedge-end-to-end-state-integrity-v1` (modules present).

Until controlled restart + recon are proven on production, the mission cannot claim full verification.

---

## 37. Final verdict — exactly one of:

### `PARTIAL — REMAINING ISSUE IDENTIFIED`

**Rationale:** Canonical integrity architecture is shipped, tested (34/34; Lab 87/87), and live under the cumulative tab-flow build. Production improved (Results active 0→6; Lab lifecycle defaults preserved; weights unchanged; Best 6 hashed). Remaining gaps: controlled restart hash compare, authenticated reconciler dry-run, and ephemeral-disk durability. Therefore **not** `STATE INTEGRITY VERIFIED`. Production is not currently unstable enough for `FAILED — PRODUCTION DATA STILL UNSTABLE`.

---

*End of official mission report — `courteedge-end-to-end-state-integrity-v1`.*
