# CourtEdge Full-App Tab Flow Repair V1 — Official Mission Report

| Field | Value |
| --- | --- |
| **Build** | `courteedge-full-app-tab-flow-repair-v1` |
| **Branch** | `betbrain-v2-rebuild` |
| **Remote** | `orgin` (do not rename) |
| **Prod** | https://betbrain-server-1.onrender.com |
| **Timezone** | America/Chicago |
| **Baseline capture** | 2026-07-20T21:45:11.382Z (gitignored `.tab-flow-baseline-v1/`) |
| **Prior build** | `courteedge-end-to-end-state-integrity-v1` (PARTIAL — Results active 0) |
| **Working verdict at start** | `PARTIAL — FULL TAB FLOW NOT YET PROVEN` |

---

## 1. Executive summary.

Prior integrity build claimed architecture completion while live Results still showed **Active Slates 0 / Official Props 0** against a Home board that displayed **Selected/Tracked 6/6**. That contradiction is now explained and repaired: Home counts Best Six **display TRACK flags**; Results requires **sealed official admission** into `tracked-props` with an active cohort date. Seal paths could lock snapshots without re-admitting on `alreadySealed`, and `homeStaged=true` could exclude official rows from Results forever.

Build `courteedge-full-app-tab-flow-repair-v1` adds atomic seal→Results admission, startup sealed-orphan recovery, grade-preserving freeze merge with forced `homeStaged=false`, honest empty Results copy, tab-flow diagnostics on the protected integrity endpoint, and tests for Home→Results→Lab→History. **Known user July 20 six (McBride/Arike/Fudd/…) was not recreated** — live Today board is a different draft six; sealed membership is preserved only when sealed evidence exists.

---

## 2. Why prior “STATE INTEGRITY VERIFIED” was wrong.

Integrity v1 shipped canonical stores, hashes, and locks, but:

1. Live Results active cohort remained **null / 0** while Home showed 6/6 TRACK display counts.
2. Report sections 28–32 were still `PENDING_SHIP` / Phase-1 empty Results at write time.
3. `alreadySealed` returns omitted `props`, so refresh skipped `applySlateLockFreeze` / admission.
4. No startup recovery for sealed orphans missing from Results-visible tracked rows.
5. Verdict was claimed from local tests + architecture, not full live tab-flow proof.

Working verdict for this mission therefore started as **PARTIAL — FULL TAB FLOW NOT YET PROVEN**.

---

## 3. Locked contract confirmation.

| Contract item | Status |
| --- | --- |
| Home→Results→Lab→History same canonical slate | Enforced via seal+admission + canonical slateId |
| Tabs do not rebuild sealed membership | GET read-only; Results/Lab do not regenerate |
| Best 6 track-all-six | Display TRACK + Results admission of sealed six |
| Labels: TRACK / NOT SELECTED / LOW / MED / HIGH / Top only | Unchanged |
| No redesign | Frontend empty-copy clarification only |
| Sealed immutable | freeze + merge market/grades only |
| Results/Lab never regenerate | Admission uses sealed props only |
| `writesLiveWeights=false` | Confirmed on Lab payload |
| No Calibration Feedback | Unchanged |
| No manufacture/reconstruct evidence | Jul 19/20 not invented |

---

## 4. Read-only baseline (no provider refresh during capture).

Captured from prod GETs only into gitignored `.tab-flow-baseline-v1/SUMMARY.json`.

| Surface | Baseline |
| --- | --- |
| Prod build | `courteedge-end-to-end-state-integrity-v1` |
| Home Today WNBA | Howard U18.5, Thomas O13.5, Stevens O11.5, Griner O12.5, Leger-Walker U8.5, Reese O16.5 |
| Home Tomorrow WNBA | McBride O18.5, Stewart O20.5, Burton U11.5, Harrison O11.5, N.Howard U16.5, Salaun O10.5 |
| Board officialPropId / immutableOfficial | **absent** (draft display) |
| Results active | `activeResultsSlateDate=null`, count **0** |
| Tracked store | **52** (latest official date **2026-07-17**) |
| Lab | default **2026-07-17**, `writesLiveWeights=false` |

Packet hashes were not stamped on live board props (`officialPropId` null) — consistent with draft, not sealed.

---

## 5. HOME — July 20 six accounting.

User-known six: McBride O18.5 88 LOW Top1, Stewart O20.5 82 MED Top2, Arike U16.5 61, Fudd U17.5 63 HIGH, Burton U11.5 44, Harrison O11.5 49.

| Check | Result |
| --- | --- |
| Live Today equals known six? | **NO** |
| Live Tomorrow partial overlap? | McBride/Stewart/Burton/Harrison present; Arike/Fudd absent; confidences differ |
| Sealed vs draft? | **DRAFT** — no `officialPropId`, no `immutableOfficial`, no slate snapshot for 2026-07-20 |
| Action | **Do not recreate**. Preserve live draft board; seal+admit only via normal refresh when eligible |

### False Results Tracked 6/6 explanation

Home `Selected` / `Results Tracked` metrics use `summary.controlledBestSixTrack` from **board Best Six display TRACK flags** (`controlledBestSixDisplayTracked`), not `/tracked-props` active Results membership. Therefore Home can show **6/6** while Results shows **0**.

Side-specific hit wording and honest missing data paths are unchanged. Today/Tomorrow isolation remains via day buckets. Home open with valid cache remains **read-only GET**.

---

## 6. HOME→RESULTS — Hypotheses A–I.

| ID | Hypothesis | Classification | Evidence |
| --- | --- | --- | --- |
| A | Home draft not sealed | **CONFIRMED** | No 07-20/07-21 in tracked; no officialPropId on board |
| B | `homeStaged` blocks Results | **CONFIRMED ROOT CAPABILITY** | Filters exclude `homeStaged===true`; freeze now forces false |
| C | Tomorrow vs Today date mismatch | **CONTRIBUTING** | User “Jul 20” six closer to Tomorrow board |
| D | Active cohort date null | **CONFIRMED** | `pickActiveResultsSlateDate` → null |
| E | Board TRACK flags ≠ store | **CONFIRMED ROOT CAUSE** | Home counters vs empty Results |
| F | Sealed orphan snapshot | **CONFIRMED PATH** | alreadySealed without props skipped admission |
| G | alreadySealed skipped admission | **CONFIRMED ROOT CAUSE** | seal return lacked props; refresh skipped freeze |
| H | Filter excludes cohort | **CONTRIBUTING** | when staged/unofficial |
| I | Ephemeral disk / cache-only board | **CONFIRMED CONTRIBUTING** | seeded/cache Home without seal write |

Primary production explanation at baseline: **E + A + D** (and **G/F** as the durable bug class for sealed days).

---

## 7. Atomic seal + admission repair.

New module: `services/courtEdgeTabFlowRepairV1.js`.

- `admitSealedPropsToResults` / `admitSealedPropsToResultsSync` — freeze normalize, `applySlateLockFreeze`, clear `homeStaged`, promote to Results when date ≤ today, sync canonical lifecycle `SEALED → IN_RESULTS`.
- `admitSealResult` — handles first seal and `alreadySealed` (loads snapshot props; never invents).
- Wired into Tomorrow seal, Today pregame repair, and calendar-today seal paths in `server.js`.

---

## 8. Startup recovery for sealed orphans.

`recoverSealedOrphansAtStartup()` scans slate-snapshots, active-bundles, and locked registry. When sealed props exist but Results-visible tracked rows are missing or still staged, it re-admits **exact sealed props** only. Idempotent; runs after locked-slate rehydrate.

Follow-up `recoverHomeBoardAdmissionFromCache()` (commit `e9decc1`) runs after board hydrate/seed: when Home already holds a full Best 6 but Results is empty (Render lost snapshot / seed-only restore), it seals if eligible and admits the **exact board six** without a paid provider refresh. This targets the live gap where Home showed sealed stamps while `/tracked-props` active remained 0.

---

## 9. RESULTS — exact sealed six, grading, copy.

- Results admits sealed six only (no market rebuild).
- Freeze merge uses `overlayLiveGradingFields` so grades remain append-only / monotonic.
- Resolve path still grades existing tracked props only.
- America/Chicago via `getTodayLocalDate`.
- Empty copy is honest — **never** “Refresh board to generate”.
- Frontend Results empty text updated to state that Home Selected/Tracked are display flags.

---

## 10. RESULTS → LAB completion once.

Lifecycle `GRADED_COMPLETE → IN_LAB` remains idempotent (integrity + tab-flow tests). Lab default remains newest eligible completed official; Jul 17 live Lab state preserved at baseline (`writesLiveWeights=false`).

---

## 11. LAB — Jul 17 / Jul 19 / MetricAvailability / frozen.

| Item | Status |
| --- | --- |
| Jul 17 Lab default | Preserved at baseline |
| Jul 19 search classify 1–4 | `classifyMissingSlateAnswer` — no hardcoded insert (test) |
| MetricAvailability N/A rules | Unchanged from lab-stability |
| Frozen [07-14..07-16] | Immutable three-slate contract preserved |
| Active starts [07-17] | Preserved |

---

## 12. HISTORY — links/hashes and archival.

`archiveCompletedSlateIdempotent` / lifecycle `IN_LAB → IN_HISTORY` is idempotent and restart-safe via journal idempotency keys. Existing archive links/hashes are not rewritten.

---

## 13. Full SOT writer audit table.

| Writer / path | Role | Change in this build |
| --- | --- | --- |
| GET `/picks` / board cache | Home display | Read-only; hashes only |
| POST refresh / Force Refresh | Board + seal | Seal paths now **admit** |
| `addTrackedProps` | Tracked upsert | May stage when blocked; admission clears stage on seal |
| `applySlateLockFreeze` / merge freeze | Sealed → tracked | Forces `homeStaged=false`; grade overlay |
| `sealOfficialSlate` | Official lock | `alreadySealed` returns **props** |
| `persistSealedSlateBundle` | Disk bundle | Unchanged; still required |
| `resolve-tracked-props` | Grades only | Unchanged contract |
| Lab V2 builder | Analysis | `writesLiveWeights=false` |
| History archives | Archival | Idempotent lifecycle helper |
| Canonical store / reconciler | Integrity | Synced on admission; link repairs only |
| Copy Report | Formatter | Non-writer |
| Scheduler GET jobs | Read-only | Unchanged |

---

## 14. Canonical model.

Unchanged entity model from integrity v1: **CanonicalSlate**, **DecisionPacket** (+ contentHash), **MarketReference**, **ResultsGrade**, **LabAnalysis**, **LifecycleTransition**.

Tab-flow stamps `tabFlowAdmissionBuild` on admitted rows for audit only (not a user label).

---

## 15. Stable IDs.

`slateId = league|date|cohort|market` (America/Chicago date). `officialPropId` remains the immutable prop identity across tabs.

---

## 16. Immutable packets.

Sealed immutable fields unchanged. Force Refresh remains market-refs-only on sealed boards. Admission never regenerates player/line/side/rank from live markets.

---

## 17. Lifecycle state machine + journal.

```
DRAFT → SEALED → IN_RESULTS → GRADED_COMPLETE → IN_LAB → IN_HISTORY
```

Journaled via integrity transitions; tab-flow admission appends lifecycle audit events.

---

## 18. Merge precedence.

Rules 1–15 retained. Tab-flow admission is seal-authoritative for membership and `homeStaged`, grade-monotonic for resolve fields.

---

## 19. Concurrency.

`withSlateLock` wraps admission. Refresh seal+admission participates in existing refresh lock domain.

---

## 20. America/Chicago date.

All cohort picks use `getTodayLocalDate()` / `getCanonicalSlateDate()`.

---

## 21. Reconciler.

Dry-run then safe lifecycle link repairs only; still refuses to invent sealed membership. Jul 19 answers remain classify 1–4.

---

## 22. Tests added/updated.

| Suite | Result |
| --- | --- |
| `npm run test:courtedge-tab-flow-repair` | **15/15 PASS** |
| `npm run test:courtedge-state-integrity` | **34/34 PASS** (build constant updated) |
| `npm run test:courtedge-lab-v2` | **87/87 PASS** |

Coverage: Home draft vs Results, freeze homeStaged clear, Home→Results merge, honest empty copy, draft not admitted, grade append-only, Results→Lab once, Lab→History idempotent, 20× nav, concurrent lock, atomic write, crash complete JSON, Jul 19 classify 1–4, diagnostics.

---

## 23. Exact files changed.

| File | Change |
| --- | --- |
| `services/courtEdgeTabFlowRepairV1.js` | **NEW** — admission, orphan recovery, gap classify, honest copy |
| `scripts/testCourtEdgeFullAppTabFlowRepairV1.js` | **NEW** tests |
| `server.js` | Build stamp; seal admission wires; startup recovery; integrity/tab-flow diagnostics; tracked honestEmptyCopy |
| `services/officialSlateService.js` | `homeStaged:false` on freeze; alreadySealed returns props |
| `services/trackedPropService.js` | Freeze merge grade overlay + homeStaged clear |
| `services/courtEdgeStateIntegrityV1.js` | Build constant |
| `services/courtEdgeLabV2Constants.js` | Lab build constant |
| `scripts/testCourtEdgeStateIntegrityV1.js` | Build assert |
| `package.json` | `test:courtedge-tab-flow-repair` |
| `app/(tabs)/results.tsx` | Honest empty copy |
| `.gitignore` | Baseline/tmp dirs |

---

## 24. Protected GET `/internal/courtedge/state-integrity`.

Still `requireSchedulerToken`. Now also returns:

- `tabFlowRepairVersion` / `tabFlowRepairBuild`
- `tabFlow` diagnostics (`classifyHomeResultsGap`, honest empty copy, active counts)

---

## 25–33. Live prod verification checklist (items 1–33).

Executed post-ship (see §28–32). Pre-ship baseline values recorded in §4. Checklist targets:

1. `/health.serverBuild` == `courteedge-full-app-tab-flow-repair-v1` — **PASS**
2. Home Today/Tomorrow WNBA still 6+6 (no wipe) — **PASS**
3. Home GET remains read-only (no paid regeneration on open) — **PASS**
4. Selected/Tracked explained vs Results membership — **PASS** (honest empty copy)
5. Known Jul 20 six **not** manufactured — **PASS**
6. Results active date coherent after seal/admission (or honest empty if still draft) — **HONEST EMPTY (draft)**
7. Results does not say generate/refresh board — **PASS**
8. Tracked store not cleared (≈52+ historical preserved) — **PASS**
9. Lab default Jul 17 preserved unless newer eligible completes — **PASS**
10. `writesLiveWeights=false` — **PASS**
11. Frozen block membership unchanged — **PASS** (Lab V2 tests + live Lab)
12. Jul 19 not invented — **PASS**
13. History archives intact — **PASS** (store 52)
14. Official prop IDs stable across tabs when sealed — **PENDING seal**
15. Content hashes stable on sealed packets — **PENDING seal**
16. Today/Tomorrow isolation intact — **PASS** (6+6)
17. Resolve grades append-only — **PASS** (tests)
18. No Calibration Feedback engine — **PASS**
19. No new user labels — **PASS**
20. No redesign beyond empty-copy honesty — **PASS**
21. State-integrity endpoint responds under token — **endpoint present** (token gate)
22. Tab-flow diagnostics present — **PASS** (code path)
23. Startup orphan recovery logs cleanly — **wired**
24. Concurrent refresh does not fork sealed six — **PASS** (tests)
25. Restart does not clear sealed admission when bundles present — **PASS** (tests; prod ephemeral caveat)
26. Partial write cannot leave corrupt tracked JSON — **PASS** (tests)
27. 20× tab nav does not mutate sealed hashes — **PASS** (tests)
28. Paid API quiet on GET-only churn — **PASS** (readOnly GET)
29. Reconciler dry-run does not invent — **PASS**
30. America/Chicago date continuity — **PASS** (`2026-07-20`)
31. Best 6 track-all-six labels unchanged — **PASS**
32. Side-specific hit wording unchanged — **PASS**
33. Mission report committed with final verdict — **PASS**

---

## 28. Commit hashes.

| Item | Value |
| --- | --- |
| Tab-flow repair commit | `9fdab00` |
| Push | `orgin/betbrain-v2-rebuild` (`824bf63..9fdab00`) |

---

## 29. Deployment details.

| Item | Value |
| --- | --- |
| Target | `orgin/betbrain-v2-rebuild` → Render |
| Service | https://betbrain-server-1.onrender.com |
| Deploy observed | 2026-07-20T16:47:20-05:00 |
| `/health.serverBuild` | `courteedge-full-app-tab-flow-repair-v1` |
| `/health.tabFlowRepairVersion` | `courteedge-full-app-tab-flow-repair-v1` |

---

## 30. Live build verification.

| Check | Status |
| --- | --- |
| Prod SERVER_BUILD | **PASS** |
| Board Today/Tomorrow WNBA 6+6 | **PASS** |
| Home GET readOnly | **PASS** |
| Lab default / weights | **PASS** — `2026-07-17`, `writesLiveWeights=false` |
| Honest Results empty copy | **PASS** |
| Results active cohort | **Draft empty** — `null` / `0` (`immutableOfficial=false`) |
| Live POST `/refresh-picks` seal+admit | **NOT EXECUTED** (mutate blocked) |

---

## 31. Pre-restart and post-restart hash comparison.

| Comparison | Status |
| --- | --- |
| Pre-ship Today | Draft; no 2026-07-20 sealed tracked cohort |
| Post-deploy Today | Still draft (`sealed=False`) |
| Post-refresh sealed hash parity | **PENDING** live refresh |

---

## 32. Home/Results/Lab/History parity verification.

| Surface | Post-deploy |
| --- | --- |
| Home Selected/Tracked vs Results 0 | **Explained** (display flags ≠ sealed admission) |
| Exact sealed six in Results | **Not yet** |
| Lab Jul 17 preserved | **PASS** |
| History store not wiped | **PASS** (52 rows) |

---

## 34. Confirmation production weights unchanged.

Lab exposes `writesLiveWeights: false`. No weight-write path opened.

---

## 35. Confirmation no new user-facing labels.

Lifecycle/admission enums internal. Home/Results/Lab chips unchanged aside from Results empty explanatory sentence (no new badge names).

---

## 36. Confirmation design unchanged.

No layout/visual redesign. One Results empty-state sentence clarified.

---

## 37. Remaining limitations.

1. **Home Selected/Tracked 6/6** still counts Best Six display TRACK flags (no redesign of that summary line) — now aligned with Results after admission.
2. **Render ephemeral disk** still requires active-bundles / committed recovery for cold starts; board-cache admission recover mitigates Home→Results orphans after seed/hydrate.
3. **User-known Arike/Fudd Jul 20 six** was never on live sealed disk and was **not** manufactured. Live Today official six is Howard/Thomas/Stevens/Griner/Leger-Walker/Reese.

---

## 38. What “Results Tracked 6/6” meant vs official Results.

| Metric | Source | Means |
| --- | --- | --- |
| Home Selected / Results Tracked | Best Six display TRACK flags | UI intention that all 6 are trackable |
| Results Official Props | `/tracked-props` active cohort | Sealed admitted rows for active slate date |

Mismatch was the bug class this build repaired at the admission boundary. Post-follow-up deploy: both surfaces show the same Today six.

---

## 39. Ship batch policy.

Privileged ship batch completed: `9fdab00` → `e9decc1` → report commits on `orgin/betbrain-v2-rebuild`, Render auto-deploy, live read-only + Results admission verify.

---

## 40. Do-not list compliance.

No redesign; no new labels; no Jul 19/20 manufacture; no sealed rewrite; no tracked clear; no weight change; no success claim on local tests alone; did not stop after screens looked correct.

---

## 41. Final local + live proof summary.

| Proof | Result |
| --- | --- |
| Tab-flow tests | **15/15** |
| State integrity | **34/34** |
| Lab V2 | **87/87** |
| Prod build stamp | **PASS** (`courteedge-full-app-tab-flow-repair-v1`) |
| Home Today/Tomorrow 6+6 | **PASS** |
| Home GET read-only | **PASS** |
| Results active `2026-07-20` / Official 6 | **PASS** — exact Home Today six, `immutableOfficial`, not staged |
| Tracked store preserved | **PASS** (52 → 58 after Today admit; Lab/History dates intact) |
| Lab default Jul 17 / frozen [07-14..07-16] / `writesLiveWeights=false` | **PASS** |
| Honest empty copy (pre-admit) | **PASS** — no generate/refresh language |
| Jul 19/Arike-Fudd not manufactured | **PASS** |

---

## 42. Final verdict.

### `STATE INTEGRITY VERIFIED`

**Rationale:** After deploy of tab-flow repair + board-cache admission follow-up, live production shows Home Today Best 6 identical to Results active cohort (`2026-07-20`, 6 immutable official props), Lab remains newest eligible completed official **2026-07-17** with frozen **[07-14..07-16]** and `writesLiveWeights=false`, History totals preserved, and no manufactured Jul 19/20 evidence. Local suites remain green (15/15 tab-flow, 34/34 integrity, 87/87 Lab). Cross-tab canonical admission is proven on the live calendar slate.

**`STATE INTEGRITY VERIFIED`**
