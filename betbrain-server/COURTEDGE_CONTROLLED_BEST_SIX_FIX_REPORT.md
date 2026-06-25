# CourtEdge Controlled Best 6 Fix Report

**Date:** 2026-06-24  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-controlled-best-six-v2-fix`  
**Selector version:** `controlled-best-six-v2-fix`

---

## Backup

| Field | Value |
|-------|-------|
| **Path** | `betbrain-server/backups/2026-06-25T04-32-47-671Z-pre-controlled-best-six-v2-fix/` |
| **Reason** | `pre-controlled-best-six-v2-fix` |
| **Files** | tracked-props, locked-slates, daily-slate-reports, pick-history, pick-analytics, history-archive, slate-snapshots |

Prior backup also available: `2026-06-24T18-09-04-723Z-pre-controlled-best-six-v1/`

---

## Root Cause Investigation

### Why 14 WNBA props entered Results (live 2026-06-24)

**Primary root cause: `syncTrackedFromCache()` bypassed Controlled Best 6 admission.**

| Path | Behavior | Cap enforced? |
|------|----------|---------------|
| `refreshAllPicks()` | `allGeneratedCandidates` → `selectControlledBestSixCombined` → `buildResultsTrackingCohort(bestSixCohort)` → `addTrackedProps(..., { preFilteredCohort: true })` | ✅ Yes |
| `syncTrackedFromCache()` (cache hits on `/picks`, `/top-props`) | `collectAllGeneratedProps(games)` → **all board/candidate props** → `addTrackedProps` without cohort flag | ❌ **No** |

On cache hits, every quality-gate `TRACK`-eligible WNBA candidate was admitted to `tracked-props.json`, not just Best 6. With ~14 quality-passed WNBA props on the slate, Results showed 14 tracked (all TEST, 0 Official) — consistent with quality gate passing many TEST reader picks but Best 6 never limiting admission on the cache path.

**Secondary factor: pre-cap runtime data.** Props admitted before Controlled Best Six v1 deployed remained in the active unlocked slate. `addTrackedProps` had no prune step for excess non–Best-6 keys on unlocked slates.

**Not the cause:**
- `controlledBestSixSelector.js` — selector logic was correct (max 6/league, diversity caps).
- `buildResultsTrackingCohort` — correctly filters when given Best 6 input.
- Quality gate `TRACK` — means *eligible for consideration*, not auto-tracked; bug was admission path, not gate semantics.

**Cap code was partially deployed:** `refreshAllPicks` used Best 6; cache-sync path did not.

---

## Fixes Delivered

### PART 1 — Controlled Best 6 tracking admission

- Fixed `syncTrackedFromCache()` to use Best 6 cohort + `buildResultsTrackingCohort` + `preFilteredCohort: true`.
- Added `pruneExcessPreCapProps()` in `addTrackedProps` when `preFilteredCohort: true` — removes non–Best-6 keys from **unlocked** active slates only (locked/archived slates untouched).
- Extended diagnostics: `controlledBestSixVersion`, `controlledBestSixApplied`, `trackingAdmissionSource`, `admittedBeforeBestSixCap`, `bestSixWNBA`/`bestSixNBA` counts, `trackedWNBA`/`trackedNBA` counts, `excessTrackedDueToPreCap`, `qualityGatePassedCountByLeague`, `hiddenDueToBestSixCap`, `blockedByQualityGate`, `boardOnlyCount`, `noBetCount`, `topPropsSource`, `topWNBAPropsSelectedFromBestSix`, `topNBAPropsSelectedFromBestSix`.

### PART 2 — Best 6 selection rules

- Verified/enforced in `controlledBestSixSelector.js`: full pool → quality gate → filter NO_BET/noPlay/started/dupes/opposite → rank by `bestPropScore` → max 6 with diversity (2/team, 3/game preferred).
- Version bumped to `controlled-best-six-v2-fix`; metadata stamped on ranked picks.

### PART 3 — Top Picks from Best 6 only

- Verified existing wire: `selectTopTwoFromBestSix` → `saveTopPicksSnapshot` (reference-only) → never passed to `addTrackedProps`.

### PART 4 — Results UI wording

- Labels: Total/NBA/WNBA tracked, Official, Test/Learning, Reader Official Demoted TEST, Reader Uncertain TEST, Graded, Pending, Awaiting Stats, Record, Win Rate, Best 6 cap status.
- Removed “all tracked = Official” implication.

### PART 5 — Slate Results Snapshot

- New shared utility: `betbrain-server/services/slateResultsSnapshot.js` + `utils/slateResultsSnapshot.ts`.
- Results + Lab: Wins/Losses/Pushes, winning/losing lists sorted by margin, biggest wins/misses, formatted `[WIN/LOSS] Player Side Line Stat — actual X, margin +/-Y`.
- Generated from graded props; no hardcoded data.

### PART 6 — Lab sections

- Controlled Best 6 Performance: records, splits, wins/losses lists (from graded Best 6 picks).
- Top Picks Review unchanged (reference-only).
- Fixed `sectionA.totalOfficialProps` — was `slateProps.length` (caused “Official props: 14” for all-TEST slates); now uses `trackingCalibration.officialCount`.
- “No snapshot found” shown when snapshots missing (no fake data).

### PART 7 — Tracked prop metadata

- `mapPickToTrackedFields` / `normalizeTrackedProp`: `controlledBestSixRank`, `controlledBestSixVersion`, `topPickRank`, `sourcePool`, `trackingAdmissionSource`, quality gate fields.
- Snapshots reference-based; Best 6 / Top Picks snapshots keyed by `trackedKey`.

### PART 8 — History

- `buildHistoryEntries` already archives once via `coveredDates` dedupe.
- `PropCard`: Best 6 badges (`bestSixLabel` / `B6 #n`) on tracked cards; Top Pick badges remain separate references.

---

## Files Changed

| File | Change |
|------|--------|
| `betbrain-server/engines/topProps/controlledBestSixSelector.js` | v2-fix version, metadata on ranked picks |
| `betbrain-server/server.js` | `syncTrackedFromCache` fix, SERVER_BUILD bump, diagnostics |
| `betbrain-server/services/trackedPropService.js` | Cap prune, metadata, diagnostics fields |
| `betbrain-server/services/slateResultsSnapshot.js` | **New** snapshot builder |
| `betbrain-server/services/dailySlateReportService.js` | Fix official count, section P snapshot |
| `betbrain-server/services/topPicksSnapshotService.js` | Best 6 metadata, wins/losses in review |
| `betbrain-server/scripts/testControlledBestSix.js` | Extended tests (29 cases + nested suites) |
| `betbrain-server/scripts/testSlateResultsSnapshot.js` | **New** snapshot tests |
| `app/(tabs)/results.tsx` | Snapshot section, cap status, wording |
| `app/(tabs)/prop-lab.tsx` | Snapshot, Best 6 wins/losses, wording |
| `app/(tabs)/history.tsx` | Tracked label wording |
| `utils/slateResultsSnapshot.ts` | **New** client snapshot utility |
| `utils/reportBuilders.ts` | Official vs Test wording in reports |
| `components/PropCard.tsx` | Best 6 badges |

**Runtime JSON not committed** — `tracked-props.json` will self-heal on next refresh (prune to Best 6 for unlocked active slate).

---

## Test Results

```
node scripts/testSlateResultsSnapshot.js          → 4/4 PASS
node scripts/testControlledBestSix.js             → 29/29 PASS (includes nested):
  testTopPropSelector.js                          → 14/14 PASS
  testTopPicksLifecycle.js                        → 10/10 PASS
  testWnbaReaderFixes.js                          → 18/18 PASS
  testWnbaResultsQualityGate.js                   → 18/18 PASS
  testResultsTrackingCohort.js                    → 13/13 PASS
```

---

## Safety Confirmations

| Rule | Status |
|------|--------|
| Backup before code changes | ✅ `2026-06-25T04-32-47-671Z-pre-controlled-best-six-v2-fix` |
| CourtEdge only | ✅ No TennisEdge/ChurchEdge changes |
| No API keys / .env / secrets | ✅ |
| NO `/clear-tracked-props` | ✅ Not used |
| Do NOT mutate locked 06/21 Lab/History | ✅ Prune skips locked/archived slates |
| No duplicate Results/Lab/History props | ✅ Reference-only top picks; archive dedupe |
| Runtime JSON migrate only if necessary | ✅ Code-only fix; prune on next refresh |
| Runtime JSON not committed | ✅ |

---

## Post-Deploy Verification

1. `GET /health` → `serverBuild: courteedge-controlled-best-six-v2-fix`
2. `GET /diagnostics` → `excessTrackedDueToPreCap`, `bestSixWNBACount ≤ 6`, `trackingAdmissionSource: CONTROLLED_BEST_SIX`
3. Trigger `/picks` refresh → active WNBA tracked count ≤ 6
4. Results UI → Best 6 cap status OK; Slate Results Snapshot when graded
5. Lab → Official count matches actual OFFICIAL props, not total tracked

---

## Expected Live Behavior After Deploy

- **New refreshes:** max 6 WNBA + 6 NBA tracked per active unlocked slate.
- **Cache hits:** no longer inflate tracking via full generated pool.
- **Pre-cap 14 WNBA on active slate:** pruned to 6 on first post-deploy refresh (unlocked slate only).
- **Locked 06/21 and archived slates:** unchanged.
