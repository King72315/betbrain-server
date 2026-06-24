# CourtEdge WNBA Results Quality Gate Report

**Date:** 2026-06-24  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-wnba-results-quality-gate-v1`

## Backup

- **Path:** `betbrain-server/backups/2026-06-24T06-21-47-098Z-pre-wnba-results-quality-gate-v1`
- **Reason:** `pre-wnba-results-quality-gate-v1`

## Safety confirmations

| Check | Status |
|-------|--------|
| `/clear-tracked-props` used | No |
| 06/21 Lab mutated | No (`final`, `frozen`, `locked`) |
| 06/21 History mutated | No |
| Secrets / `.env` / `eas.json` touched | No |
| NBA scoring path changed | No (WNBA-only quality gate) |
| Runtime JSON migrated | No (code-only deploy) |

## Root cause — why 06/23 tracked 10 weak WNBA props (4-6-0)

`buildResultsTrackingCohort` (v1) admitted any WNBA pick with `trackingType` OFFICIAL or TEST after basic dedupe/field checks. It did **not** re-evaluate:

- WNBA_LIMITED_DATA Under gap floor (3.0)
- Low-volume / efficiency-only Over traps
- Fair-line strong disagreement
- Thin one-book markets with weak edge
- Missing-data stacks (limited data + neutral defense + thin market + volatile minutes)

The reader engine (`wnbaReaderEngine.js`) already penalized many of these at decision time (demoting to TEST or NO_BET), but `mapReaderToTracking` still produced TEST picks with `trustable: true`, and the cohort builder tracked all TEST/OFFICIAL candidates blindly. Result: ~10 limited-data WNBA props entered Results; Lab graded 4-6 with missing/limited data as the dominant loss pattern.

## What was built

### New module: `engines/wnba/wnbaResultsQualityGate.js`

`evaluateWnbaTrackingEligibility(pick, dataCard, reader)` returns:

- `trackingEligibility`: `TRACK` | `BOARD_ONLY` | `SHADOW_ONLY` | `NO_BET`
- `trackingBlockReasons[]`, `trackingWarnings[]`
- `qualityGateScore`, `qualityGateVersion`
- `keyMetrics` (projectionGap, fairLineEdge, bookCount, minutes, FGA, etc.)

**Hard blocks (12):**

1. NO_BET / noPlay  
2. Started game (cohort pre-check)  
3. Missing required fields (cohort pre-check)  
4. Dupe / opposite-side (cohort builder)  
5. WNBA_LIMITED_DATA Under gap &lt; 3.0  
6. Fair line strong disagree  
7. Low-volume Over trap  
8. Efficiency-only scoring spike  
9. Role/minutes instability without cushion  
10. One-book + weak edge  
11. Missing data stack + thin edge  
12. readerDecision NO_BET / AVOID / PASS  

**Soft demotions:** `BOARD_ONLY` or `SHADOW_ONLY` — visible on board, not tracked.

Gate applies only when `wnbaDataCard` or `wnbaReader` is present (real WNBA v2 picks). NBA and legacy picks pass through unchanged.

### Wiring

| File | Change |
|------|--------|
| `services/trackedPropService.js` | Quality gate after dedupe; `TRACKING_COHORT_VERSION` → `results-tracking-cohort-v2-quality-gate`; `trackingQualityAudit` per slate |
| `server.js` | `SERVER_BUILD` bump; `/diagnostics` exposes `trackingQualityAudit` |
| `services/dailySlateReportService.js` | Section N — quality gate performance |
| `utils/resultsQueue.ts` | Split counts: Official / Demoted TEST / Uncertain TEST |
| `app/(tabs)/results.tsx` | Results UI labels aligned to split |
| `app/(tabs)/prop-lab.tsx` | Quality gate performance section |
| `scripts/testWnbaResultsQualityGate.js` | 18 tests |

## Tests run

```
node betbrain-server/scripts/testWnbaResultsQualityGate.js   — 18/18 PASS
  (includes testWnbaReaderFixes, testResultsTrackingCohort,
   testTopPropSelector, testTopPicksLifecycle)
```

## Live verification expectations

After deploy / refresh:

- `/health` → `serverBuild: courteedge-wnba-results-quality-gate-v1`
- `/diagnostics` → `trackingQualityAudit.bySlate[]` with candidate audit arrays
- `/wnba-picks` → full board still visible (board-only candidates not hidden)
- `/tracked-props` → fewer, cleaner WNBA tracked props on future slates
- Results page → Official / Reader Official Demoted TEST / Reader Uncertain TEST counts
- Lab report Section N → quality gate performance on next build

## Remaining data gaps

Quality gate cannot fix props already persisted in `tracked-props.json` for 06/23 — those grades stand. Gate filters **new** cohort admissions on refresh. Full benefit appears on the next WNBA slate refresh cycle.
