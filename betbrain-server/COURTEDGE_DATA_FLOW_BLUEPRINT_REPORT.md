# CourtEdge Data Flow Blueprint Report

**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-data-flow-v1`  
**Date:** 2026-06-25  
**Report path:** `betbrain-server/COURTEDGE_DATA_FLOW_BLUEPRINT_REPORT.md`

---

## 1. Full Data-Flow Map

```
Candidate Generation (per game)
  buildTopPicksForGame / WNBA v2 engine
  → game.allGeneratedCandidates (full pool)
  → game.picks (display board, max 4/game)

Quality Gate (WNBA)
  wnbaResultsQualityGate.js → evaluateWnbaTrackingEligibility

Controlled Best 6 (per league)
  controlledBestSixSelector.js → selectControlledBestSixCombined
  → bestSixWNBA, bestSixNBA (max 6/league, diversity caps)

Results Tracking Admission (shared)
  buildControlledTrackingCohort()  ← NEW single entry
  → buildResultsTrackingCohort(bestSix only)
  → addTrackedProps(cohort, { preFilteredCohort: true, skipTopPickReferences: true })

Top Picks (reference only)
  selectTopTwoFromBestSix → topWNBAProps, topNBAProps
  → saveTopPicksSnapshot (referenceOnly: true)

Results Tab
  getTrackedProps + slateResultsSnapshot + cap status panel

Lab
  buildDailySlateReportsFromTrackedProps → daily-slate-reports
  labTrackingInference.ts for legacy LEAN labels
  reads snapshots via buildTopPicksReview / buildBestSixReview

History
  lockSlate → history-archive (once per slate)
  computeSlateRotation → LAB_CURRENT vs ARCHIVED_HISTORY
```

### Slate Lifecycle States

| State | Meaning |
|-------|---------|
| `GENERATED_BOARD` | Board generated, no tracked props yet |
| `TRACKING_ACTIVE` | Best 6 cohort persisted, grading in progress |
| `PARTIALLY_GRADED` | Some props graded, some pending |
| `READY_FOR_LAB` | All props graded, report buildable |
| `LAB_CURRENT` | Current Lab rotation slate |
| `ARCHIVED_HISTORY` | Frozen in history archive |

Implemented in `services/slateLifecycleService.js`, exposed on `/diagnostics` and `/daily-slate-reports`.

---

## 2. Files Inspected / Changed

| File | Action |
|------|--------|
| `services/trackedPropService.js` | Added `buildControlledTrackingCohort()`; diagnostics use it |
| `services/slateLifecycleService.js` | **New** — lifecycle state machine |
| `server.js` | Refactored `refreshAllPicks`, `syncTrackedFromCache`; SERVER_BUILD bump; API fields |
| `scripts/testCourtEdgeDataFlow.js` | **New** — 50 acceptance tests |
| `app/(tabs)/explore.tsx` | Best 6 preview + slate summary on Full Game Board |
| `engines/topProps/controlledBestSixSelector.js` | Inspected (unchanged logic) |
| `services/topPicksSnapshotService.js` | Inspected |
| `services/slateResultsSnapshot.js` | Inspected |
| `services/dailySlateReportService.js` | Inspected |
| `utils/labTrackingInference.ts` | Inspected |
| `app/(tabs)/results.tsx`, `prop-lab.tsx`, `top-props.tsx`, `history.tsx` | Inspected |

---

## 3. Backup Path

```
betbrain-server/backups/2026-06-25T05-03-39-192Z-pre-courteedge-data-flow-v1/
```

Includes: tracked-props.json, daily-slate-reports.json, pick-history.json, pick-analytics.json, locked-slates.json, slate-snapshots/, history-archive/

---

## 4. Root Causes (Historical)

1. **`syncTrackedFromCache` bypass** — Previously used `collectAllGeneratedProps` (board-capped `game.picks`), admitting only ~3–4 props instead of Best 6. Fixed in v2-fix; now centralized via `buildControlledTrackingCohort`.
2. **Duplicate admission paths** — `refreshAllPicks`, cache sync, and diagnostics each reimplemented selector + cohort logic separately.
3. **Top Picks vs Results conflation** — Risk of tracking Top Pick references as separate props; mitigated by `skipTopPickReferences` + reference-only snapshots.

---

## 5. Bypass Paths Fixed

| Path | Before | After |
|------|--------|-------|
| `refreshAllPicks()` | Inline Best 6 + cohort | `buildControlledTrackingCohort()` |
| `syncTrackedFromCache()` | Rebuilt cohort ad hoc | `buildControlledTrackingCohort()` with cached selection |
| `buildTrackingCohortDiagnostics()` | Duplicate selector call | Uses shared cohort builder |
| Results admission via `collectAllGeneratedProps` | Used for display counts only | **Never** used for `addTrackedProps` |

---

## 6. Shared Admission Flow

```javascript
buildControlledTrackingCohort({ gameCards }, options)
  → collectAllGeneratedCandidatesFromGames (full pool)
  → selectControlledBestSixCombined (or passthrough controlledSelection)
  → buildResultsTrackingCohort(bestSixWNBA + bestSixNBA)
  → returns { bestSixWNBA, bestSixNBA, trackingCohort, bestSixSnapshot, audit }
```

Version: `controlled-tracking-cohort-v1`

---

## 7–12. Phase Flows

### Best 6
- Full `allGeneratedCandidates` → quality gate → rank → max 6/league (2/team, 3/game)
- Metadata: `controlledBestSixRank`, `trackingCohortSource`, `controlledBestSixVersion`

### Top Picks
- Top 2/league from Best 6 only (`selectTopTwoFromBestSix`)
- `saveTopPicksSnapshot` with `referenceOnly: true`, `isTopPickReference: true`
- Never duplicated in tracked-props.json

### Results
- `addTrackedProps(trackingCohort, { preFilteredCohort: true })`
- Cap enforcement via `pruneExcessPreCapProps`
- Inline status panel (existing), snapshot via `buildSlateResultsSnapshot`

### Lab
- `buildDailySlateReportsFromTrackedProps` reads tracked props once
- Legacy LEAN → TEST via `labTrackingInference.ts`
- Top Picks / Best 6 reviews attach to report metadata (reference only)

### History
- `lockSlate` → frozen snapshot → history-archive
- `computeSlateRotation` prevents duplicate Lab/History cards
- 06/21 Lab/History bundles read-only (not mutated)

---

## 13. Data Saved at Each Stage

| Stage | Storage | Key Fields |
|-------|---------|------------|
| Board | picksCache / API | games, allGeneratedCandidates, boardCappedProps |
| Best 6 | best-six-snapshots.json | bestSixRank, trackedKey, selectorVersion |
| Top Picks | top-picks-snapshots.json | topPickRank, referenceOnly |
| Results | tracked-props.json | trackingType, controlledBestSixApplied, officialLine |
| Lab | daily-slate-reports.json | sections A–P, slateResultsSnapshot |
| History | history-archive/{date}.json | frozen props, archivedAt |

---

## 14. Duplicate Prevention

- Stable key dedupe in `buildResultsTrackingCohort`
- `addTrackedProps` index by stable + legacy keys
- Shrink guard on locked slates
- Top Pick references skipped (`skipTopPickReferences: true`)
- `preFilteredCohort` + `pruneExcessPreCapProps` enforces Best 6 cap

---

## 15. UI Changes per Tab

| Tab | Change |
|-----|--------|
| Home (index) | No change — links to boards |
| Full Game Board (explore) | **Added** Controlled Best 6 preview + tracked count summary |
| Top Props | Already wired (reference snapshots) |
| Results | Existing inline status + snapshot (unchanged) |
| Lab | Existing legacy labels + Viewing Report (unchanged) |
| History | No duplicate cards (data-layer enforced) |

---

## 16–17. Tests Added / Passed

| Suite | Count | Status |
|-------|-------|--------|
| `testCourtEdgeDataFlow.js` | 50 | ✅ All pass |
| `testControlledBestSix.js` | 29 | ✅ All pass |
| `testTopPropSelector.js` | 14 | ✅ All pass |
| `testTopPicksLifecycle.js` | 10 | ✅ All pass |
| `testResultsTrackingCohort.js` | 13 | ✅ All pass |
| `testWnbaReaderFixes.js` | 18 | ✅ All pass |
| `testWnbaResultsQualityGate.js` | 18 | ✅ All pass |
| `testLabLegacyTrackingLabels.js` | 8 | ✅ All pass |
| `testSlateResultsSnapshot.js` | 4 | ✅ All pass |

**Total: 164 tests across 9 suites — all passing**

---

## 18–21. Safety Confirmations

| Rule | Status |
|------|--------|
| CourtEdge only (no TennisEdge/ChurchEdge/etc.) | ✅ |
| No API keys / .env / secrets committed | ✅ |
| No `/clear-tracked-props` invoked | ✅ |
| 06/21 Lab/History not mutated | ✅ (read-only inference tests verify) |
| No destructive runtime JSON delete | ✅ |
| No duplicate Results/Lab/History props | ✅ enforced in cohort + snapshots |
| Runtime JSON not migrated | ✅ code-only changes |

---

## 22. Build Marker

```
SERVER_BUILD = "courteedge-data-flow-v1"
CONTROLLED_TRACKING_COHORT_VERSION = "controlled-tracking-cohort-v1"
CONTROLLED_BEST_SIX_VERSION = "controlled-best-six-v2-fix"
```

---

## 23. Report Path

`betbrain-server/COURTEDGE_DATA_FLOW_BLUEPRINT_REPORT.md`

---

## 24. Post-Deploy Verification

1. `GET /health` → `serverBuild: courteedge-data-flow-v1`
2. `POST /refresh-picks` → `generatedPropCount` ≤ 12 (6 WNBA + 6 NBA), `controlledTrackingCohortAudit.admissionPath: CONTROLLED_BEST_SIX`
3. `GET /diagnostics` → `slateLifecycle`, `trackingControlledByBestSix: true`, `excessTrackedDueToPreCap: 0`
4. `GET /top-props` → `bestSixSnapshot.referenceOnly: true`
5. `GET /tracked-props` → count matches Best 6 cohort (not board cap)
6. Re-run: `node betbrain-server/scripts/testCourtEdgeDataFlow.js`
7. Optional live: `node betbrain-server/scripts/validateCourtEdgeFlow.js`

---

## API / Diagnostics Fields Added

- `/diagnostics`: `slateLifecycle`, `slateLifecycleStates`, `controlledTrackingCohortVersion`
- `/top-props`: `controlledTrackingCohortVersion`, `bestSixSnapshot`
- `/tracked-props`: `bestSixSnapshot`, `controlledTrackingCohortVersion`
- `/daily-slate-reports`: `slateLifecycle` map
- `/picks` (via refresh): `controlledTrackingCohortAudit`, `controlledTrackingCohortVersion`
