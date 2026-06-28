# CourtEdge Track-All-Best-6 v1 Report

**SERVER_BUILD:** `courteedge-track-all-best-six-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Selector version:** `controlled-best-six-track-all-v1`  
**Cohort version:** `controlled-tracking-cohort-v2-track-all-best-six`

## Root cause

Home showed **Controlled Best 6 6/6** but **Results Track 1/6** because Results admission used two stacked TRACK-only gates:

1. **`buildControlledTrackingCohort()`** fed the TRACK-gated Results pool (`bestSixWNBA` / `bestSixNBA` from `selectControlledBestSix`) instead of the display pool (`bestSixDisplayWNBA` / `bestSixDisplayNBA`).
2. **`buildResultsTrackingCohort()`** skipped any WNBA pick where `trackingEligibility !== "TRACK"`.
3. **`annotateResultsAdmission()`** set `resultsAdmissionEligible: false` for BOARD_ONLY / NO_BET display picks.
4. **Client summary** counted only TRACK-admitted props via `isResultsPoolTrackProp`.

BOARD_ONLY and NO_BET props appeared on Home cards (with warning labels) but were excluded from `/tracked-props`, Lab, and History.

## Before / after

| Surface | Before | After |
|---------|--------|-------|
| Home Controlled Best 6 | 6/6 display | 6/6 display (unchanged) |
| Home Results Track summary | 1/6 (TRACK only) | 6/6 (all display Best 6) |
| `/tracked-props` cohort source | TRACK-gated Best 6 | Display Best 6 |
| BOARD_ONLY in Results | Excluded | Tracked, labeled |
| NO_BET eligibility in Results | Excluded | Tracked, labeled |
| Top Picks | Top 2 from display Best 6 | Unchanged |
| Reader TEST demotion | TRACK → OFFICIAL fix preserved | Preserved |

## Files changed

| File | Change |
|------|--------|
| `betbrain-server/services/trackedPropService.js` | Display cohort admission; `isBestSixDisplayResultsProp`; skip TRACK gate when `trackAllBestSixDisplay`; version bumps |
| `betbrain-server/engines/topProps/controlledBestSixSelector.js` | All display Best 6 `resultsAdmissionEligible: true`; `resultsDecisionLabel`; version bump |
| `betbrain-server/server.js` | `SERVER_BUILD` → `courteedge-track-all-best-six-v1` |
| `utils/controlledBestSixDisplay.js` | Summary counts all scoped display Best 6; report label **Results Tracked** |
| `utils/propLabels.ts` | Decision badges (Track / Board Only / No Bet) on Results cards |
| `components/HomeControlledBestSixScreen.tsx` | Copy + **Results Tracked** metric |
| `components/LeagueControlledBestSixScreen.tsx` | Copy + **Results Tracked** metric |
| Test scripts | Updated expectations + new cohort tests |

## Preserved

- Home Tomorrow Controlled Best 6
- NBA / WNBA separation
- Results → Lab → History rotation
- 06/24 quarantine exclusion
- Flip-first DI fields
- Board Only / No Bet warning labels on Home cards
- Top Picks (top 2 from display Best 6)
- No new prop markets
- No `/clear-tracked-props`, no runtime JSON commits, no secrets

## Acceptance tests (10)

| # | Test | Result |
|---|------|--------|
| 1 | Best 6 display → all Results tracked | PASS (`testControlledCohortUsesDisplayBestSix`) |
| 2 | BOARD_ONLY tracked | PASS (`testBoardOnlyDisplayBestSixTracked`) |
| 3 | NO_BET tracked | PASS (`testNoBetEligibilityDisplayBestSixTracked`) |
| 4 | Labels preserved | PASS (`resultsDecisionLabel` + `propLabels` badges) |
| 5 | Results shows 6 when Best 6 has 6 | PASS (summary `controlledBestSixTrack === scopedTotal`) |
| 6 | Lab receives all 6 after grading | PASS (lifecycle / official record via `isOfficialResultsProp`) |
| 7 | History archives all 6 after rotation | PASS (`testSlateRotationLifecycle` 24/24) |
| 8 | No extra markets | PASS (no market changes) |
| 9 | No runtime JSON committed | PASS |
| 10 | No clear-tracked-props | PASS |

## Top Picks follow-up (courteedge-top-picks-from-display-best-six-v1)

**Problem:** After track-all-best-six, Results held all 6 display props but Top tab still filtered by `topPickEligibility` / TRACK — skipping BOARD_ONLY Best #1/#2 and showing fewer than 2 picks.

**Fix:** `selectTopTwoFromBestSix` and `selectTopTwoFromDisplayBestSix` now take Best Six ranks #1–#2 (team diversity on slot 2 only). `TOP_PICKS_SOURCE_POOL` → `CONTROLLED_BEST_SIX_DISPLAY`.

- `testResultsTrackingCohort.js` — 17/17
- `testControlledBestSix.js` — 31/31
- `testControlledBestSixDisplay.js` — 44/44
- `testCourtEdgeDataFlow.js` — 50/50
- `testActiveResultsSlate.js` — all passed
- `testSlateRotationLifecycle.js` — 24/24
