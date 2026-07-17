# CourtEdge Full Inspection + Jul 16 Rescue Report
Generated: 2026-07-16 (CT evening)  
Server build shipped: `courteedge-persist-rescue-v1`  
Branch: `betbrain-v2-rebuild`  
Prod: https://betbrain-server-1.onrender.com

---

## 1. Executive verdict

Three Results props for slate **2026-07-16** (Carleton / Citron / Austin) were never durably sealed. They lived only as Home/Results **display tracking**. When Render wiped ephemeral runtime files (`locked-slates.json`, board cache, snapshots), they disappeared and could not be rebuilt because Today Best 6 never entered the Official seal path.

They have been **reconstructed, graded 0-3, and shipped in repo durability bundles** so startup rehydrate + tracked freeze restore them. Persistence bugs that caused daily loss are fixed in this build.

---

## 2. Missing Jul 16 props (found + graded)

Source of truth for identity: Home UI paste (`lastUpdated: 2026-07-17T00:34:29.265Z`) in prior session transcript.  
No structured store (snapshot / lock / tracked) ever contained these exact lines — only the UI board.

| # | Player | Side / Line | Game | Actual (POR @ WAS box) | Grade | Margin |
|---|--------|-------------|------|-------------------------|-------|--------|
| 1 | Bridget Carleton | Over 8.5 | POR Fire @ WAS Mystics | 6 | **LOSS** | -2.5 |
| 2 | Sonia Citron | Over 12.5 | same | 8 | **LOSS** | -4.5 |
| 3 | Shakira Austin | Under 17.5 | same | 19 | **LOSS** | -1.5 |

Game score context: POR 75, WAS 56.

### Stable keys restored
- `20260716-wnba-bridgetcarleton-portlandfire-washingtonmystics-points-over`
- `20260716-wnba-soniacitron-washingtonmystics-portlandfire-points-over`
- `20260716-wnba-shakiraaustin-washingtonmystics-portlandfire-points-under`

### Official prop IDs
- `2026-07-16|WNBA|bridgetcarleton|portlandfire|washingtonmystics|points|OVER|8.5`
- `2026-07-16|WNBA|soniacitron|washingtonmystics|portlandfire|points|OVER|12.5`
- `2026-07-16|WNBA|shakiraaustin|washingtonmystics|portlandfire|points|UNDER|17.5`

Record: **0-3-0** (thin Official slate, FINAL_THIN).

Also restored / locked for Lab durability:
- **2026-07-15** Official 6 graded **3-3** (Thornton L, Boston L, Mitchell L, Malonga W, McBride W, Howard W)

---

## 3. Prod state before fix (inspected)

| Surface | State |
|---------|--------|
| `/health` serverBuild | `courteedge-reader-gate-align-v1` |
| `/picks` | Empty — “No saved board yet” |
| `/slates/locked` | `slates: []` |
| `/tracked-props` | 30 props; **no 2026-07-16**; Jul 15 still **pending** on prod |
| `/daily-slate-reports` | Lab pointer stuck on **2026-07-14**; Results `null`; History 07-08 / 06-21 |

Conclusion: lock registry + board cache wiped; Jul 15 grades not on prod disk; Jul 16 never persisted.

---

## 4. Root causes of daily prop/data loss

### A. Today Best 6 never sealed (PRIMARY for Jul 16)
`sealTomorrowOfficialSlates` only processes **TOMORROW** dayBucket props.  
Today Results only via `inheritTodayResultsFromSealedSlate` (yesterday’s sealed Tomorrow).  
A thin Today board (3 props) that never existed as yesterday’s Tomorrow seal was display-tracked only → wiped with registry/board.

### B. Seal wrote snapshot/registry but did not freeze into `tracked-props.json`
`lockSlate` / `sealOfficialSlate` persisted snapshot + registry. Tracked store only got membership if `addTrackedProps` ran **before** lock. Post-seal inserts are blocked. Snapshot-only seals disappear when registry is wiped even if tracked somehow lingered inconsistently.

### C. Render ephemeral disk
Runtime JSON (`locked-slates.json`, `board-cache.json`, many `slate-snapshots/*`) is not durable across redeploy/restart unless committed or restored from catalogs.

### D. Unauthenticated `POST /clear-tracked-props`
Anyone could wipe the tracked store. Now requires `x-admin-secret` + `confirm: true`.

### E. Startup rehydrate incomplete
Catalogs only covered 06-21 lab + 07-08 active. Empty registry with recent official tracked rows did not rebuild locks.

---

## 5. Fixes shipped (`courteedge-persist-rescue-v1`)

1. **`sealTodayFallbackOfficialSlate`** — if Today inherit fails and Today board has props (window closed), seal as `FINAL_THIN_SLATE_TODAY_FALLBACK`, then promote to Results. Admit to tracked **before** lock.
2. **`applySlateLockFreeze` after every successful Tomorrow/Today seal** in `refreshAllPicks`.
3. **`rehydrateLocksFromTrackedProps`** on startup — rebuild locks from official/`slateLocked` tracked rows (last 21 days) when registry missing.
4. **Lab/Active durability bundles**
   - `lab-bundles/2026-07-15/` (Lab catalog)
   - `lab-bundles/2026-07-16/` (Active catalog while recent)
   - `slate-snapshots/2026-07-15.json`, `2026-07-16.json`
5. **`tracked-props.json`** updated with Jul 15 grades + Jul 16 graded trio (33 props).
6. **`POST /admin/runtime-state-import`** — merge-only rescue import (admin + confirm/dryRun).
7. **`POST /clear-tracked-props`** — admin + confirm required.
8. Rescue payload file: `betbrain-server/.rescue-0716-runtime-import.json`

Flow intentionally unchanged except: Today thin boards that would otherwise vanish now seal like FINAL_THIN Tomorrow. No new UI labels.

---

## 6. Full CourtEdge surface inspection (data flow)

### Home (Controlled Best 6)
- Reads `/picks` (board cache) + display Best 6 / Today / Tomorrow buckets.
- Before: empty board after wipe.
- After deploy + refresh: Tomorrow can seal; Today thin seals if inherit fails.
- Results Tracked count must come from locked/sealed cohort, not ephemeral display alone.

### Results
- Active Results slate = sealed Official for today (or overnight hold yesterday).
- Grades via `POST /resolve-tracked-props` (grade-only; membership frozen).
- Jul 16 restored already graded → appear as completed Results/Lab per rotation (today vs next CT day).

### Lab
- Uses `/daily-slate-reports` + tracked analytics; Lab slate is newest completed Official.
- Before: Lab stuck on 07-14 with 07-15 pending / unlocked.
- After: 07-15 lab bundle + graded tracked; 07-16 graded thin Official.

### History
- Archives + older reports; 06-21 / 07-08 still present in store.
- No deletes performed.

### Endpoints checked / hardened
| Endpoint | Finding | Fix |
|----------|---------|-----|
| GET /health | Build lag | New build tag |
| GET /picks | Empty board | Refresh + preserve board; seal path |
| GET /slates/locked | Empty | Rehydrate + bundles + import |
| GET /tracked-props | Missing Jul 16; Jul 15 pending | Committed rescue props |
| GET /daily-slate-reports | Wrong Lab/Results pointers | Locks + grades restore rotation inputs |
| POST /resolve-tracked-props | Unauth OK; grades only | Jul 16 pre-graded |
| POST /clear-tracked-props | **Unauth wipe** | Admin + confirm |
| POST /admin/runtime-state-import | New | Merge-only rescue |

### Buttons / tabs (behavioral contract — no UI redesign)
- Home Today / Tomorrow toggles: unchanged.
- Refresh: now seals Today fallback when needed; freezes sealed props into tracked.
- Results Check / Resolve: grade-only on sealed membership.
- Lab rebuild / report build: must not rewrite sealed lines/sides.
- History: read-only archives.

---

## 7. Verification checklist (post-deploy)

1. `/health` → `serverBuild: courteedge-persist-rescue-v1`
2. `/tracked-props?includeLegacy=true` → includes Jul 15 (6 graded) + Jul 16 (3 LOSS)
3. `/slates/locked` → includes `2026-07-15` and `2026-07-16`
4. `/daily-slate-reports` → Lab on 07-15 (or 07-16 once CT day rolls and rotation advances); Results not empty while Jul 16 is active day
5. Home Refresh → board returns; no wipe of Official membership
6. Confirm `POST /clear-tracked-props` without admin → 401/503

Optional (if ADMIN_SECRET set on Render):
```
POST /admin/runtime-state-import
Header: x-admin-secret: <secret>
Body: contents of .rescue-0716-runtime-import.json
```

Then:
```
POST /build-daily-slate-reports
POST /picks/refresh   (or scheduler refresh)
```

---

## 8. Files changed

- `betbrain-server/server.js`
- `betbrain-server/services/officialSlateService.js` (`sealTodayFallbackOfficialSlate`)
- `betbrain-server/services/slateRestoreService.js` (catalogs + `rehydrateLocksFromTrackedProps`)
- `betbrain-server/services/runtimeStateImportService.js` (new)
- `betbrain-server/tracked-props.json`
- `betbrain-server/lab-bundles/2026-07-15/**`
- `betbrain-server/lab-bundles/2026-07-16/**`
- `betbrain-server/slate-snapshots/2026-07-15.json`
- `betbrain-server/slate-snapshots/2026-07-16.json`
- `betbrain-server/.rescue-0716-runtime-import.json` (local rescue payload)

Tests: `scripts/testOfficialSlateLifecycle.js` → **13/13 PASS**

---

## 9. What was NOT changed

- Reader / Tracking Gate floors (prior build)
- Main UX flow / labels / tabs layout
- No mass delete of Lab/History
- No `lifecycleRepair` on prod (known wipe risk)

---

## 10. Remaining operational risk

Render free disk is still ephemeral. Durability now depends on:
1. Committed `tracked-props.json` + lab/active bundles + snapshots
2. Startup rehydrate + tracked lock rebuild
3. Today fallback seal so thin Today boards become Official before wipe

Long-term: attach a **persistent disk** on Render for `tracked-props.json`, `locked-slates.json`, `slate-snapshots/`, `board-cache.json`, `history-archive/`.

---

END OF REPORT
