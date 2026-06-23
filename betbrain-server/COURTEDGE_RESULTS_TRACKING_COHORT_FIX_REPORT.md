# CourtEdge Results Tracking Cohort Fix Report

**Date:** 2026-06-23  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-results-tracking-cohort-v1`

## Safety

| Check | Result |
|-------|--------|
| Pre-fix backup | `betbrain-server/safe-backups/pre-results-tracking-cohort-2026-06-23T18-28-42-882Z` |
| 06/21 Lab safe | ✅ 14 props, 14 graded, 5-9-0, report `final` |
| `/clear-tracked-props` | ❌ Not called |
| History/Lab mutation | ❌ None |

## Root Cause

Results tracked only **3 props** for 2026-06-23 (Fiebich, Gray, Talbot) because `refreshAllPicks()` fed `addTrackedProps()` from `collectAllGeneratedProps(games)`, which reads **`game.picks`** — the **display board capped at 4 props per game** by `buildTopPicksForGame()`.

The full engine output lives in **`game.allGeneratedCandidates`** (all `builtPicks` before the board cap). Top Props selector already reads from `allGeneratedCandidates`; Results tracking did not.

Secondary factors (not the primary cap issue):
- WNBA `isTrackablePick()` still applies official tier gates for non-TEST picks when using the old path
- `enrichPickFromGameCard()` ignored per-pick `isStarted` when game was not started

## Fix

### New pipeline (`trackedPropService.js`)

```
allGeneratedCandidates → buildResultsTrackingCohort → addTrackedProps(cohort, { preFilteredCohort: true })
```

**`buildResultsTrackingCohort(candidates)`** eligibility:
- Has player, team, opponent, line
- Game not started
- Decision `OFFICIAL` or `TEST` (not `NO_BET`, not invalid)
- Not `noPlay` (TEST exempt from trustable gate)
- No exact duplicate, no opposite-side conflict on same player+line
- Stable-key dedupe keeps highest score
- TEST picks get `excludedFromOfficialRecord: true`

**Separate from Top Props** — no top-2 limit, no team-diversity cap.

**`addTrackedProps`** accepts `preFilteredCohort: true` to skip re-filtering through narrow `isTrackablePick()` gates.

### `refreshAllPicks()` (`server.js`)

- Collects from `collectAllGeneratedCandidatesFromGames(games)`
- Builds cohort + audit
- Tracks cohort (not board-capped picks)
- Exposes `boardCappedPropCount` vs `generatedPropCount` for comparison

### Diagnostics (`GET /diagnostics`)

New fields:
- `trackingCohort`, `trackingAudit`
- `generatedCandidatesBySlate`, `eligibleTrackingCandidatesBySlate`
- `trackedPropsBySlate`, `notTrackedReasonsBySlate`
- `topPropsAreReferenceOnly`, `topPropsDidNotAffectTracking`
- `trackingCohortVersion`, `officialTrackedCount`, `testTrackedCount`
- `todayLocalDate`, `activeResultsSlateDate`

### Results UI

- **Total Tracked Props** / **Official Props** / **Test / Learning Props** (no longer labels all queue props as Official)
- Slate cards show official vs test breakdown
- Copy report updated with same wording

## Changed Files

| File | Change |
|------|--------|
| `betbrain-server/services/trackedPropService.js` | Cohort builder, candidate collector, diagnostics, `preFilteredCohort` |
| `betbrain-server/server.js` | Wire cohort pipeline, diagnostics, SERVER_BUILD bump |
| `app/(tabs)/results.tsx` | Tracked/Official/Test summary labels |
| `utils/resultsQueue.ts` | `summarizeTrackingTypeCounts`, active slate counts |
| `utils/reportBuilders.ts` | Copy report tracked/official/test wording |
| `betbrain-server/scripts/testResultsTrackingCohort.js` | 13 unit tests |
| `betbrain-server/scripts/createPreResultsTrackingCohortBackup.js` | Pre-fix backup script |

## Tests

```text
node betbrain-server/scripts/testResultsTrackingCohort.js  → 13/13 PASS
node betbrain-server/scripts/testTopPropSelector.js       → 14/14 PASS
```

Covers all 12 user-requested cases plus stable-key and board-cap proof.

## Pre-Deploy Prod Baseline (2026-06-23)

| Endpoint | Observation |
|----------|-------------|
| `/tracked-props` | 3 props on 2026-06-23 (Fiebich, Gray, Talbot) |
| `/diagnostics` | `serverBuild: courteedge-top-prop-league-split-v1` |
| `/top-props` | Best 2 NBA + Best 2 WNBA spotlight working |

## Post-Deploy Verification Checklist

After Render deploy:

1. `GET /health` → `serverBuild: courteedge-results-tracking-cohort-v1`
2. `POST /refresh-picks` (or wait for cache refresh)
3. `GET /diagnostics` → `trackingCohortVersion: results-tracking-cohort-v1`, `eligibleTrackingCandidatesBySlate["2026-06-23"]` >> 3
4. `GET /tracked-props` → active slate cohort matches eligible count (not capped at board size)
5. `GET /top-props` → still max 2 NBA + 2 WNBA (unchanged)
6. Results app → Total Tracked > Official + Test breakdown; Top Pick badges on originals only

## Philosophy

**Top Props** = spotlight (best 2 per league, reference-only).  
**Results** = full eligible slate cohort for learning and grading.  
These pipelines are now fully separated.
