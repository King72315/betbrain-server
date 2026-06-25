# CourtEdge Active Results Lifecycle Filter

**SERVER_BUILD:** `courteedge-active-results-filter-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Date:** 2026-06-25

## Root cause

1. **`GET /tracked-props` returned the full `tracked-props.json` store** with no lifecycle filter. Prod retained 33 legacy WNBA props across `2026-06-14`, `2026-06-15`, and `2026-06-21` while the active Results queue should expose at most the current locked/unresolved slate (≤6 per league).

2. **`excessTrackedDueToPreCap` was computed against the wrong cohort.** `buildTrackingCohortDiagnostics` counted props on `todayLocalDate` (or an optional query `slateDate`) instead of the **active Results slate** from `pickActiveResultsSlateDate`. When the blocking slate was `2026-06-21` but today was later, cap math saw 0 active props → `excessTrackedDueToPreCap: 0` despite 33 stored legacy props.

3. **`bestSixSnapshot` null on `/tracked-props`** is expected when no refresh snapshot exists for the current slate; unrelated to the legacy store leak. The primary user-facing bug was unfiltered props in Results.

## Fix (read-time, non-destructive)

- Added `classifyTrackedPropsByLifecycle()` in `slateLifecycleService.js`.
- **`GET /tracked-props`** default: `activeResultsProps` only (`trackedPropsReturnedMode: active_results_only`).
- **`?includeLegacy=true`**: all stored props + per-prop `trackedLifecycleState` + category counts (debug).
- **`GET /diagnostics`**: lifecycle counts, cap status on active Results only, `allStoredPropsExceedCapButExcluded`.
- **No `tracked-props.json` mutation** — legacy props remain classified in place; locked `2026-06-21` Lab/History bundles untouched.

## Backup

**No runtime JSON backup required** — this deploy uses read-time filtering only. No migration was run locally or on prod data files.

If a future tag/migration is needed, use `betbrain-server/backups/` via `createBackup` before any write.

## Classification of prod legacy slates (expected after deploy)

| Slate | Expected bucket | Notes |
|-------|-----------------|-------|
| `2026-06-14` | `QUARANTINED_LEGACY` | Before `CLEAN_DATA_CUTOFF` (`2026-06-19`); stored but hidden from Results |
| `2026-06-15` | `QUARANTINED_LEGACY` | Same pre-cutoff quarantine |
| `2026-06-21` | `LAB_CURRENT` or `ARCHIVED_HISTORY` | Completed Lab slate; excluded from active Results; **locked snapshot/archive not mutated** |

Active Results after deploy should show **only** props on the current blocking/active slate (typically ≤6 WNBA + ≤6 NBA).

## Files changed

| File | Change |
|------|--------|
| `betbrain-server/services/slateLifecycleService.js` | `classifyTrackedPropsByLifecycle`, `buildTrackedPropsLifecycleDiagnostics`, `TRACKED_PROP_LIFECYCLE` |
| `betbrain-server/services/trackedPropService.js` | Cap diagnostics use `activeResultsProps` when provided |
| `betbrain-server/server.js` | `/tracked-props`, `/diagnostics`, `SERVER_BUILD` bump |
| `betbrain-server/scripts/testTrackedPropsLifecycleFilter.js` | 17 acceptance tests (new) |
| `app/(tabs)/results.tsx` | Empty state copy for filtered active Results |
| `app/(tabs)/prop-lab.tsx` | Archives/reports only — no `/tracked-props` dependency |
| `app/(tabs)/history.tsx` | Archives/reports only — no `/tracked-props` dependency |

## Tests

```text
node betbrain-server/scripts/testTrackedPropsLifecycleFilter.js  → 17 passed, 0 failed
node betbrain-server/scripts/testCourtEdgeDataFlow.js           → 50 passed, 0 failed
```

## Post-deploy verification

1. Confirm build: `GET /diagnostics` → `serverBuild: courteedge-active-results-filter-v1`
2. Active Results cap: `GET /tracked-props` → `count ≤ 12`, `trackedPropsReturnedMode: active_results_only`
3. Legacy hidden: same endpoint → no `2026-06-14` / `2026-06-15` / `2026-06-21` props in default response
4. Debug store: `GET /tracked-props?includeLegacy=true` → `trackedStoreTotalCount: 33` (or current store size) with lifecycle breakdown
5. Diagnostics: `trackedStoreTotalCount`, `activeResultsTrackedCount`, `legacyStoredTrackedCount`, `allStoredPropsExceedCapButExcluded: true` when legacy store exceeds cap but active cohort does not
6. Lab/History intact: `GET /history-archives/2026-06-21` and `GET /daily-slate-reports` unchanged
7. App Results tab: shows active slate only or “No active Results slate” empty state

## Prod deploy note

**No prod `tracked-props.json` commit or migration required.** Deploy server + app only. Legacy rows remain on disk for Lab/History archives and `?includeLegacy=true` diagnostics.
