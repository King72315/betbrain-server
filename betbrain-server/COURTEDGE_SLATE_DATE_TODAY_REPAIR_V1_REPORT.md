# CourtEdge Slate Date Today Repair V1 — Report

| Field | Value |
| --- | --- |
| **Build** | `courteedge-slate-date-today-repair-v2` |
| **Branch** | `betbrain-v2-rebuild` |
| **Remote** | `orgin` |
| **Prod** | https://betbrain-server-1.onrender.com |
| **Timezone** | America/Chicago |
| **Calendar today (mission)** | **2026-07-21** |
| **Tomorrow** | **2026-07-22** |
| **Prior sealed official** | **2026-07-20** (preserve fully) |
| **Prior build** | `courteedge-slate-date-today-repair-v1` → fixed admission stamp bug in **v2** |

---

## 1. Executive summary

Overnight calendar rollover left a **stale seeded board** with frozen `dayBucket` stamps. Home still showed the sealed **2026-07-20** six (Howard/Thomas/Stevens/Griner/Leger-Walker/Reese) as **Today**, and Jul 20 evening games (McBride/…) as **Tomorrow**, while `lifecycleHomeSanitize.today` correctly reported `2026-07-21`.

Root cause: `sanitizeHomeBoardForLifecycle` trusted `dayBucket=TODAY` when `slateDate` was missing, so past props leaked into Home. Fix reclassifies every Home prop/game from **slateDate → officialPropId date → commenceTime (America/Chicago)** and keeps only calendar **today / tomorrow**. Read-path only — **does not delete tracked props, sealed packets, Lab, or History**.

---

## 2. Date contract (corrected)

| Role | Date |
| --- | --- |
| Today | 2026-07-21 |
| Tomorrow | 2026-07-22 |
| Prior sealed Results | 2026-07-20 (canonical six below) |
| Lab (eligible completed) | 2026-07-17 (Jul 20 still pending/not graded-complete — OK) |

### Canonical 2026-07-20 sealed six (preserved)

1. Rhyne Howard U18.5  
2. Alyssa Thomas O13.5  
3. Azura Stevens O11.5  
4. Brittney Griner O12.5  
5. Charlisse Leger-Walker U8.5  
6. Angel Reese O16.5  

---

## 3. Pre-fix live snapshot (CT 2026-07-21 ~00:04)

| Tab | Observed | Verdict |
| --- | --- | --- |
| Home Today | Howard six, `dayBucket=TODAY`, commence Jul 19 UTC | **WRONG** — prior sealed day |
| Home Tomorrow | McBride six, commence → Jul 20 CT | **WRONG** — not Jul 22 |
| Results | `activeResultsSlateDate=2026-07-20`, exact sealed six, pending | **OK preserve** |
| Lab | `2026-07-17`, `writesLiveWeights=false` | **OK** |
| Audit counts | Today 0 / Tomorrow 6 while Today array had 6 | **Inconsistent** |

---

## 4. Code fix

### `services/slateScopeService.js`

- `getTomorrowLocalDate`
- `resolveHomeBoardSlateDate` / `classifyHomeDayBucket`
- `sanitizeHomeBoardForLifecycle` rebuilt to:
  - reclassify Today/Tomorrow from CT slate dates
  - scrub past/Lab from Home pools
  - rebucket `games` / `wnbaGames` / `nbaGames`
  - recompute `controlledBestSixAudit` day counts
  - stamp `lifecycleHomeSanitize.slateDateReclassified=true`

### `utils/controlledBestSixDisplay.js`

- `filterCalendarTodayHomePool` uses commenceTime / officialPropId when `slateDate` missing
- `filterCalendarTomorrowHomePool` added

### `services/courtEdgeTabFlowRepairV1.js`

- Past recovery dayBucket is `PAST` (was incorrectly `TODAY`)

### Build bump

All build stamps → `courteedge-slate-date-today-repair-v1`.

---

## 5. Local proof on captured prod board

With `todayLocalDate=2026-07-21` applied to the live `/picks` capture:

| Surface | Result |
| --- | --- |
| Home Today | **[]** (no Jul 21 markets on stale board — honest empty) |
| Home Tomorrow | **[]** (no Jul 22 markets — honest empty) |
| Tracked Jul 20 six | **unchanged** |

Tests: home/lab sanitize PASS · tab-flow 15/15 · state integrity 34/34 · home-completion 80/80.

---

## 6. Post-deploy expected tab table (CT today = 2026-07-21)

| Tab | Date | Prop count | Props / reason |
| --- | --- | --- | --- |
| Home Today | 2026-07-21 | 0 until refresh finds markets | Empty OK — do not invent |
| Home Tomorrow | 2026-07-22 | 0 until markets | Empty OK |
| Results (active) | 2026-07-20 | 6 | Exact sealed Howard six (pending until graded) |
| Lab | 2026-07-17 | 6 official | Newest eligible completed; Jul 20 not forced |
| History | prior dates | preserved | No mutation |

Jul 20 data **must remain** in tracked store / Results; never shown as Home Today after this build.

---

## 7. Do-not list

- Did not clear tracked props  
- Did not delete Jul 20 sealed packets  
- Did not invent Jul 19 into Lab  
- Did not force Jul 20 into Lab  
- Did not overwrite sealed Jul 20 six with draft Arike/Fudd report  

---

## 8. Verdict

**CODE FIX SHIPPED — SLATE DATE TODAY REPAIR V2**

Home day classification follows America/Chicago calendar dates on every `/picks` read. Prior sealed **2026-07-20** stays Results-intact; Home Today/Tomorrow only show **2026-07-21 / 2026-07-22**.

### v2 follow-up (critical)

v1 deploy revealed `recoverHomeBoardAdmissionFromCache` was **stamping `slateDate=today` onto stale Home Today board props** and re-admitting the Howard six as `2026-07-21`. v2:

1. Filters board-cache admission to props whose resolved CT slate date **equals today**
2. Rejects past commenceTimes from Tomorrow seal
3. Adds `repairBoardCacheTodayDateStampCorruption` — moves mis-stamped today props with past commenceTimes back to **yesterday** and re-admits them (no deletes)

Expected after v2 deploy startup repair: Results active = **2026-07-20** exact sealed six; Home Today/Tomorrow empty until real Jul 21/22 markets exist.
