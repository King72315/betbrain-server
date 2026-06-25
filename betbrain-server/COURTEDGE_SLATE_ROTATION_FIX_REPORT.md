# CourtEdge Slate Rotation Fix Report

**SERVER_BUILD:** `courteedge-slate-rotation-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Date:** 2026-06-25  

## Backup

Pre-repair backup (runtime JSON):

`betbrain-server/backups/2026-06-25T18-15-37-671Z-pre-slate-rotation-v1/`

Earlier repair pass also created:

`betbrain-server/backups/2026-06-25T18-13-06-689Z-pre-slate-rotation-v1/`

## Root Cause

1. **06/24 daily report was stale** — stored as `in-progress` with `graded: 0 / pending: 14` while tracked props were largely graded on 06/25.
2. **`isValidDailyReport` excludes past in-progress reports**, so 06/24 vanished from valid rotation input; only 06/21 (final) remained → **06/21 re-selected as current Lab**.
3. **06/21 history archive phase was `LAB` not `ARCHIVED`**, so History UI (`buildArchiveBackedEntries`) returned **0 slates**.
4. **Best Six props lack explicit `OFFICIAL` trackingType** — report `totalOfficialProps` could be 0 even with 14 tracked props, breaking completion detection without `totalTrackedProps` fallback.
5. **Completion follow-ups (06/25 completion pass):**
   - `slateLifecycleService.collectStaleUnresolvedSlateDates` referenced undefined `context` → `/tracked-props` lifecycle classification crashed.
   - `classifyTrackedPropsByLifecycle` passed `context.trackedProps` (always empty) into `computeSlateRotation` instead of the real `trackedProps` array → Lab inference never ran in lifecycle filter.
   - `isPropBlockingLabInference` did not treat `"Final player stats unavailable from source"` as awaiting-stats-only, blocking 06/24 Lab admission while Natasha Mack's row was pending.

## Inspection (10 Questions)

| # | Question | Answer |
|---|----------|--------|
| 1 | Does 06/24 Lab report exist in daily-slate-reports? | **Yes** — entry at `slateDate: 2026-06-24` (rebuilt; still `in-progress` on file until final stat row, but rotation infers Lab from graded props). |
| 2 | Why wasn't 06/24 current Lab? | Stale report filtered out of valid reports; only completed report was 06/21; awaiting-stats pending reason initially blocked prop inference. |
| 3 | If missing, where did it go? | Not missing — present but stale. Confirmed in backups and tracked-props (14 props on 06/24). |
| 4 | Was 06/24 excluded by active Results filter? | **No** — no ACTIVE lock on 06/24; not today's Results slate. |
| 5 | Was 06/24 moved to History incorrectly? | **No** — it was never admitted to Lab/History rotation before the fix. |
| 6 | Did 06/21 re-selected because 06/24 missing? | **Yes** — 06/24 not treated as completed; 06/21 was sole completed valid report. |
| 7 | Why History Slates = 0? | `history-archive/2026-06-21.json` had `phase: "LAB"`; History UI requires `phase: "ARCHIVED"`. |
| 8 | Active/in-progress = 1 but Results unclear? | Lifecycle counted stale 06/24 in-progress report; no 06/25 tracked props → Results empty. |
| 9 | Is 06/25 staged but not admitted? | **No 06/25 tracked props** in store at repair time; admission awaits board/picks refresh. |
| 10 | Results waiting for /picks refresh? | **Yes** — `pickActiveResultsSlateDate` returns today only when official tracked props exist for 06/25. |

## Runtime Repair (minimal touch)

1. Backup via `createBackup('pre-slate-rotation-v1')`
2. Rebuild 06/24 report: `buildDailySlateReportsFromTrackedProps({ slateDate: '2026-06-24', forceRebuild: true })`
3. Archive 06/21: `archiveSlate('2026-06-21')` → `phase: ARCHIVED` in `locked-slates.json` and `history-archive/2026-06-21.json`

**No** `/clear-tracked-props`. **No** data deleted.

## Post-Repair State (local, after code + repair script)

```
currentLabSlateDate: 2026-06-24 (inferred from graded props + awaiting-stats exception)
historySlateDates: [2026-06-21]
activeResultsSlateDate: null (until 06/25 Best 6 admitted)
activeInProgressSlateDates: []
inferredCompletedSlateDates: [2026-06-24]
```

**06/24 status:** 13/14 props graded, 1 awaiting official stat (Natasha Mack — `Final player stats unavailable from source`). Rotation admits 06/24 to Lab via prop inference when only awaiting-stats props remain.

**06/25 Results status:** Not admitted until tracked props exist for `2026-06-25`. When admitted, `activeResultsSlateDate = 2026-06-25`.

## Code Changes

### Lifecycle rotation (server + client)

- `betbrain-server/services/slateScopeService.js` — `computeSlateRotation`, `buildSlateRotationMetadata`, prop inference, archive-aware history, `totalTrackedProps` completion fallback, `isAwaitingStatsPendingReason`
- `utils/slateRotation.ts` — mirrored client rotation logic
- `betbrain-server/services/slateLifecycleService.js` — pass real `trackedProps`/`archives` into rotation; fix `collectStaleUnresolvedSlateDates` context bug
- `betbrain-server/services/dailySlateReportService.js` — `totalOfficialProps: officialCount || slateProps.length`
- `betbrain-server/server.js` — `/daily-slate-reports` exposes rotation metadata; `SERVER_BUILD=courteedge-slate-rotation-v1`

### UI

- `services/api.ts` — return rotation fields from `/daily-slate-reports`
- `app/(tabs)/prop-lab.tsx` — Current Lab vs Viewing Report banners from server rotation
- `app/(tabs)/results.tsx` — active slate empty state with today's date
- `app/(tabs)/history.tsx` — archive-aware rotation
- `utils/historyArchive.ts` — superseded LAB archives visible in History; archive-aware rotation
- `utils/resultsQueue.ts` — rotation uses trackedProps context

### Scripts / tests

- `betbrain-server/scripts/testSlateRotationLifecycle.js` — 21 lifecycle tests (incl. awaiting-stats inference)
- `betbrain-server/scripts/repairSlateRotation0624.js` — backup + rebuild + archive repair
- `betbrain-server/scripts/testTrackedPropsLifecycleFilter.js` — updated for rotation inference semantics
- `betbrain-server/scripts/testCourtEdgeDataFlow.js` — test 25 aligned to LAB_CURRENT inference

## API: GET `/daily-slate-reports`

New fields: `currentLabSlateDate`, `activeResultsSlateDate`, `viewedSlateDate`, `viewingHistorical`, `historySlateDates`, `activeInProgressSlateDates`, `quarantinedLegacySlateDates`, `staleUnresolvedSlateDates`, `lifecycleByDate`, `rotationDecisionDebug`, `serverBuild`.

## Tests

```
node betbrain-server/scripts/testSlateRotationLifecycle.js      → 21 passed, 0 failed
node betbrain-server/scripts/testCleanDataCutoff.js             → all passed
node betbrain-server/scripts/testActiveResultsSlate.js          → all passed
node betbrain-server/scripts/testTrackedPropsLifecycleFilter.js → 17 passed, 0 failed
node betbrain-server/scripts/testCourtEdgeDataFlow.js           → 50 passed, 0 failed
```

## Rotation Rules (enforced)

1. Completed slate in **one** place: Lab **or** History, not Results
2. Active/in-progress → Results only
3. Newest completed non-archived → current Lab (06/24)
4. Older completed → History (06/21)
5. Pre-cutoff 06/14/15 → quarantined
6. Lab = latest completed NOT in History, NOT active Results, NOT quarantined
7. History count = archived + rotated slates (`phase: ARCHIVED`)

## Production Repair

**Yes — required on Render.** Code deploy (`courteedge-slate-rotation-v1`) is live but **runtime JSON was never repaired**. Prod inspection on 2026-06-25:

| Field | Prod (broken) | Expected |
|-------|---------------|----------|
| `currentLabSlateDate` | `2026-06-21` | `2026-06-24` |
| `historySlateDates` | `[]` | `["2026-06-21"]` |
| `activeResultsSlateDate` | `null` | `null` until official Best 6 admitted |
| `activeInProgressSlateDates` | `["2026-06-25"]` | `[]` (phantom in-progress report; no official props) |
| `history-archive/2026-06-21` phase | `LAB` | `ARCHIVED` |
| Tracked props for `2026-06-24` | **0 rows** | 14 rows |
| `daily-slate-reports` for `2026-06-24` | **missing** | rebuilt final/inferred |

### Prod root cause (why Lab still 06/21)

1. **`repairSlateRotation0624.js` never run on Render** — 06/21 archive still `phase: LAB`, not `ARCHIVED`.
2. **06/24 cohort missing entirely on prod** — no tracked props and no daily report; only completed valid report is 06/21 → rotation picks 06/21 as Lab.
3. **06/25 in-progress report exists** but today's 4 tracked props are all `trackingType: TEST` / `WATCHLIST` → not admitted to Results (`activeResultsSlateDate: null`). Pre-fix code still counted the phantom 06/25 report in `activeInProgress` (fixed in this pass).
4. **History UI bug** — `history.tsx` destructured 4 values from 3 `Promise.all` results, so `archives` never loaded client-side (`archiveData` was always `undefined`).

### Render shell steps (in order)

```bash
# 1. Backup (automatic inside script)
cd betbrain-server

# 2. If 06/24 props are missing (prod today), restore from a backup file first:
#    Upload a known-good tracked-props.json slice or full backup to the instance, then:
export RESTORE_0624_PROPS_FROM=/opt/render/project/src/betbrain-server/backups/2026-06-25T18-15-37-671Z-pre-slate-rotation-v1/tracked-props.json

# 3. Run repair (idempotent)
node scripts/repairSlateRotation0624.js

# 4. Verify
node -e "
import { buildSlateRotationMetadata, getTodayLocalDate } from './services/slateScopeService.js';
import { getRawDailySlateReports } from './services/dailySlateReportService.js';
import { getTrackedProps } from './services/trackedPropService.js';
import { getAllHistoryArchives, getLockedSlatesRegistry } from './services/slateLockService.js';
const m = buildSlateRotationMetadata(getRawDailySlateReports(), {
  trackedProps: getTrackedProps(),
  archives: getAllHistoryArchives(),
  lockedSlates: getLockedSlatesRegistry().slates || [],
  today: getTodayLocalDate(),
});
console.log({
  currentLab: m.currentLabSlateDate,
  history: m.historySlateDates,
  activeResults: m.activeResultsSlateDate,
  activeInProgress: m.activeInProgressSlateDates,
});
"
```

**Expected post-repair:** `currentLab: 2026-06-24`, `history: [2026-06-21]`, `activeResults: null`, `activeInProgress: []`.

**If 06/24 props cannot be restored:** archive step still moves 06/21 to History, but Lab remains 06/21 until 06/24 tracked props exist on prod.

### Local repair (verified 2026-06-25)

```
Backup: betbrain-server/backups/2026-06-25T18-51-56-373Z-pre-slate-rotation-v1/
Post-repair: Lab=2026-06-24, History=[2026-06-21], Results=null, inferred=[2026-06-24]
```

## Additional code fixes (this pass)

- `activeInProgressSlateDates` only populated when `activeResultsSlateDate` is admitted (no phantom 06/25 in-progress count).
- `app/(tabs)/history.tsx` — fix `Promise.all` destructuring so archives load; use server `currentLabSlateDate` / `historySlateDates`; pass archive props into `buildHistoryEntries`.
- `utils/historyArchive.ts` — pass `trackedProps` into `computeSlateRotation`.
- `repairSlateRotation0624.js` — optional `RESTORE_0624_PROPS_FROM` for prod missing-cohort recovery.

## Tests (this pass)

```
node betbrain-server/scripts/testSlateRotationLifecycle.js      → 23 passed, 0 failed
node betbrain-server/scripts/testCleanDataCutoff.js             → all passed
node betbrain-server/scripts/testTrackedPropsLifecycleFilter.js → 17 passed, 0 failed
```

## When 06/25 Completes

On board/picks refresh → tracked props for 06/25 → `activeResultsSlateDate = 2026-06-25`. When 06/25 grades final → report build promotes to Lab → `rotateOlderLabArchives` archives 06/24 → 06/24 moves to History.
