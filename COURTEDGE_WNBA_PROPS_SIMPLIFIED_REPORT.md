# CourtEdge WNBA Props Simplified — Build Report

**Branch:** `betbrain-v2-rebuild`  
**Build:** `courteedge-wnba-props-simplified-v2`  
**Base:** `92e364a`  
**Date:** 2026-06-25

## Summary

v2 fixes the remaining gaps in the WNBA Props simplified experience: default view/report now show **Controlled Best 6 only** (no game board dump, no score ledgers), summary labels match spec, and BOARD_ONLY props like Dearica Hamby are excluded at the selector source — not filtered in the UI.

## Root Cause

| Issue | Root cause |
|-------|------------|
| Report still showed "Top WNBA Props" + Game Board | `explore.tsx` copy handler used `buildLeagueBoardReport`, which always emits `--- Top ${league} Props ---` and `--- Game Board ---` with ledger rows |
| Summary showed "Top Props" / "Playable" | Same legacy report builder `extraContext` keys |
| Full board visible in default copy | Report builder included all `games` regardless of scout mode |
| Dearica in `bestSixWNBA` with DI `BOARD_ONLY` | **Stale `/picks` cache** could serve `bestSixWNBA` built before DI v1; cache only invalidated on `controlledBestSixVersion`, not `decisionIntelligenceVersion`. Secondary: WNBA picks missing `wnbaDataCard`/`wnbaReader` could bypass selector DI gate entirely |
| Score ledger in default cards | `PropCard` `variant="bestSix"` still rendered expandable score ledger |

## Fixes

| File | Change |
|------|--------|
| `utils/controlledBestSixDisplay.js` | Added `buildWnbaControlledBestSixReportText`, `formatControlledBestSixPickLine` |
| `utils/reportBuilders.ts` | Added `buildWnbaControlledBestSixReport` wrapper |
| `app/(tabs)/explore.tsx` | Default copy uses controlled report; scout-only full board in UI unchanged |
| `components/PropCard.tsx` | Removed score ledger from `bestSix` variant |
| `betbrain-server/engines/topProps/controlledBestSixSelector.js` | All WNBA picks require gate inputs + DI TRACK/bestSixEligibility; reject missing inputs |
| `betbrain-server/server.js` | `SERVER_BUILD` bump; cache bust on `decisionIntelligenceVersion`; store DI version on cache; stricter `ensureWnbaGateOnPick` skip guard |
| `betbrain-server/scripts/testControlledBestSixDisplay.js` | Extended to 27 tests |

## Report Structure

### Before (default copy)

```
COURTEDGE PAGE REPORT
...
Visible Summary:
Games shown: N
Top props section: 5
Premium top props: 0
Total playable candidates: 17
...
Main Data:
--- Top WNBA Props ---
[1] Player ... Point Strength Ledger: ...
--- Game Board ---
Game 1: ... Playable: ...
```

### After (default copy)

```
WNBA Props — Controlled Best 6
View: Today
Last updated: ...

--- Summary ---
Controlled Best 6: X/6
Top Picks: Y/2
Board Candidates: N
Board Only: A
No Bet: B

--- Controlled Best 6 ---
[Best #1 · Top WNBA #1] Player ...
  Game: ...
  Prop: Over 25.5 Points
  Confidence: 72% | True Risk: LOW | Decision: TRACK
  Why: ...
```

Scout mode (Full Board tab or Show Full Board) still reveals game cards + full PropCard ledgers in the app. Copy only adds a short scout header when expanded — no game board dump.

## Acceptance Criteria (12/12)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Default list = Controlled Best 6 only | ✅ |
| 2 | Top #1/#2 badges inline only (no separate Top Props section) | ✅ |
| 3 | Summary: Controlled Best 6 X/6, Top Picks Y/2, Board Candidates, Board Only, No Bet | ✅ |
| 4 | No "Playable" label in summary/report | ✅ |
| 5 | Full Game Board hidden in default view | ✅ |
| 6 | No score ledgers in default Best 6 cards | ✅ |
| 7 | Full board only on Full Board tab or Show Full Board | ✅ |
| 8 | Today-only default (no tomorrow mix) | ✅ |
| 9 | Default copy: no `--- Game Board ---` | ✅ |
| 10 | Dearica Hamby BOARD_ONLY excluded from `bestSixWNBA` at selector | ✅ |
| 11 | Cache invalidates on DI version mismatch | ✅ |
| 12 | `testControlledBestSixDisplay.js` — 27 tests | ✅ |

## Tests

```bash
node betbrain-server/scripts/testControlledBestSixDisplay.js
node betbrain-server/scripts/testControlledBestSix.js
node betbrain-server/scripts/testPropDecisionIntelligenceV1.js
```

---

## Best 6 Display vs Results Split (2026-06-26)

**Build:** `courteedge-best-six-display-v1`  
**Selector:** `controlled-best-six-display-v1`

### How it works

| Layer | API field | Admission rule |
|-------|-----------|----------------|
| **Display Best 6** | `bestSixDisplayWNBA` | Top 6 ranked from full board pool (score + diversity caps). Includes BOARD_ONLY, SHADOW_ONLY, and TRACK props that failed Results gates. Each slot carries `resultsAdmissionEligible` + `resultsAdmissionReason`. |
| **Results Best 6** | `bestSixWNBA` | TRACK-only (`trackEligibility === TRACK` && `bestSixEligibility === true`). Unchanged — feeds `buildResultsTrackingCohort` / tracked props. |
| **Top Picks** | `topWNBAProps` | Still selected from TRACK-only Results Best 6 (max 2). |

UI (`explore.tsx`) renders `bestSixDisplayWNBA` (fallback: `bestSixWNBA`). PropCard `bestSix` variant shows a **Not in Results** box when `resultsAdmissionEligible === false`.

### Count bug root cause

Summary and scout per-game counts used **strict string equality** (`=== "TRACK"`) and only tallied Board Only + No Bet. Candidates with `SHADOW_ONLY` (or missing/empty eligibility) were included in **Board Candidates** but not in any visible bucket — e.g. Track 1 + Board Only 10 + No Bet 3 = 14 vs Board Candidates 15.

**Fix:** `countCandidatesByEligibility()` buckets Track / Board Only / No Bet / Shadow Only / Other using normalized `resolveTrackEligibility()`. Summary now shows all buckets so they sum to Board Candidates.

### Files changed

- `betbrain-server/engines/topProps/controlledBestSixSelector.js` — `selectBestSixDisplay`, `bestSixDisplayWNBA`
- `betbrain-server/server.js` — expose display arrays; `SERVER_BUILD` bump
- `utils/controlledBestSixDisplay.js` — summary reconciliation, display pool resolver
- `app/(tabs)/explore.tsx` — display pool + reconciled summary/scout counts
- `components/PropCard.tsx` — Results admission reason on Best 6 cards
- `services/api.ts` — `bestSixDisplayWNBA` typing
- `betbrain-server/scripts/testControlledBestSixDisplay.js` — 31 tests
