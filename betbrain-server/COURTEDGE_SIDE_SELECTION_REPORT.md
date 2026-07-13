# CourtEdge Side Selection Trust & Accuracy Report

**Date:** 2026-07-12  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-side-selection-trust-v1`  
**Module:** `side-selection-trust-v1`

## Executive Summary

Implemented canonical side-selection audit bundle, honest Over/Under evidence preservation, thin-gap flip standardization (no relaxed margin), debt ledger deduplication, Best 6 natural-decision preservation, Lab counterfactual learning fields, and side-balance viability audit — without changing the main WNBA pipeline order or user-facing risk labels.

**Pipeline preserved:** Reader → Flip-First → Tracking Gate → DI → Side Rescue → Controlled Best 6 → Home/Top → Results → Lab → History

---

## Phase 1 — Inspection Findings

### A. Tracking Population (2026-07-08 active bundle)

| Field | Value |
|-------|-------|
| `trackingMode` | `ALL_GENERATED_PROPS` |
| `generatedCandidateCount` | 5 |
| `displayBestSixCount` | 5 |
| `naturalTrackCount` | 1 |
| `promotedTrackCount` | 0 |
| `persistedResultsCount` | 5 |

**Persisted prop IDs:** Flau'jae Johnson O12.5, Bridget Carleton O, Carla Leite O, Allisha Gray U, Dominique Malonga U

**Interpretation:** Results persists the **Display Best 6 cohort** (track-all-6 learning), not natural TRACK-only. `TRACKING_MODE=ALL_GENERATED_PROPS` remains active. Lab must use `naturalDecision` (not promoted `trackEligibility`) for gate-quality analysis.

### B. Reader Side Ratio by Slate

| slateDate | reader O/U | postFlip O/U | board O/U | bestSix O/U | Over W-L-P | Under W-L-P |
|-----------|------------|--------------|-----------|-------------|------------|-------------|
| 2026-07-08 | 0/0* | 0/0* | 3/2 | n/a† | 1-0-0 | 1-1-0 |
| 2026-06-21 | 0/0* | 0/0* | 4/10 | n/a† | 1-3-0 | 4-6-0 |

\* Archived props lack `wnbaReader.finalSide` fields — reader counts unavailable on locked snapshots.  
† Best-six rank fields not present on 07-08 archive; board side counts used.

**Bias assessment:** 06-21 archive is Under-heavy at board level (10U/4O). 07-08 is 3O/2U. Jul-11 live slate (per prior audit) was 10 Over candidates / 1 Under in pool → 5O/1U Best 6 — bias originates in **Reader/projection construction**, not Side Rescue or Best 6 ranking. Side balance correctly reports `NO_ELIGIBLE_MINORITY_CANDIDATE` when only one viable Under exists.

### C. Side Rescue Usefulness (07-08 bundle)

| Metric | Count |
|--------|-------|
| `sideRescueReviewCount` | 5 |
| `sideRescueKeptOriginalCount` | 5 |
| `sideRescueChangedSideCount` | 0 |
| `sideRescueReversedFlipFirstCount` | 0 |
| `beneficialFlips` | 0 |
| `harmfulFlips` | 0 |
| `missedBeneficialFlips` | 0 |

**Conclusion:** Side Rescue reviewed all 5 persisted props but changed zero sides on 07-08. Not removed — now measurable via `sideSelectionBundle.sideRescueAction` and Lab counterfactual fields.

---

## Phase 2-14 — Implementation Summary

### New Module

`engines/decisionIntelligence/sideSelectionTrustV1.js`

- Canonical `sideSelectionBundle` per prop
- `readerSide` immutable; `currentSide` / `finalSide` / `naturalDecision` separated
- `sideStrength` internal only (no UI label)
- Honest `sideEvidence` (raw/adjusted/eligible/blockReasons/notScoredReason)
- `debtLedger` with `uniqueDebtCount`, `duplicateDebtReferences`, `appliedDebtIds`
- `stageDecisionTrace`, `sideReviewCount`, `stageDisagreementCount`
- `projectionDependency` audit (internal)
- `buildCounterfactualSideLearning()` for Lab research rows

### Key Changes

| File | Change |
|------|--------|
| `flipFirstSideSelectionV1.js` | Removed thin-gap relaxed margin; standard margin 8; `BOTH_SIDES_WEAK` on under-gap floor fail; independent evidence categories |
| `wnbaReaderEngine.js` | Preserve raw Under scores when gap floor fails; `eligible`/`blockReasons` on side cases |
| `wnbaGraduatedDataModeV1.js` | Added `resolveWnbaGapFloor()` authoritative wrapper |
| `wnbaDecisionEngine.js` | `finalizeCanonicalDecision()` at end of pipeline |
| `controlledBestSixSelector.js` | Reuse canonical bundle; preserve `naturalDecision` on promotion; side-balance audit fields; `decisionRecomputed` audit |
| `propDecisionIntelligenceV1.js` | `naturalDecision` on promotion; debt ledger on DI output |
| `signalPerformanceV1.js` | Counterfactual fields in Lab raw records |
| `server.js` | `SERVER_BUILD=courteedge-side-selection-trust-v1` |

### Gap Floor Matrix (unchanged thresholds)

| Side | Mode | Floor |
|------|------|-------|
| Over | LIMITED or volatile | 4.0 |
| Over | FULL + stable (retro) | 3.5 |
| Under | all | 3.5 |

---

## Before/After Traces

### Jackie Young O16.5

| Stage | Before | After |
|-------|--------|-------|
| readerSide | OVER | OVER (immutable) |
| flipFirstAction | — | KEPT_ORIGINAL |
| finalSide | OVER | OVER |
| Over evidence | score clamped | raw 51, gap 4.9, eligible |
| Under evidence | score → -1 | raw -33 preserved, eligible false, blockReason UNDER_GAP |

### Dominique Malonga U16.5

| Stage | Before | After |
|-------|--------|-------|
| readerSide | UNDER | UNDER |
| flipFirstAction | — | KEPT_ORIGINAL |
| finalSide | UNDER | UNDER |
| Under evidence | — | raw 11, gap 4.1, eligible |
| naturalDecision | blurred with promotion | preserved separately from display TRACK |

### Thin-gap BOTH_SIDES_WEAK

- Line 18.5, proj 16.8, volatile minutes
- `flipMarginUsed: 8` (standard, not relaxed 6)
- `flipFirstAction: BOTH_SIDES_WEAK`
- Under raw score 6 preserved, `eligible: false`

### Successful Flip (efficiency-only Over trap)

- readerSide: OVER → `flipFirstAction: FLIPPED_TO_UNDER`
- Independent evidence: usage down, market against, efficiency-only scoring
- `readerSide` remains OVER for audit; `finalSide: UNDER`

---

## Tests

`scripts/testSideSelectionTrustAccuracyV1.js` — **37/37 cases pass**

Regression suites:

| Suite | Result |
|-------|--------|
| testWnbaReaderFixes.js | PASS |
| testFlipFirstDecisionIntelligenceV1.js | 14/17 pass (3 nested data-flow baseline failures pre-existing) |
| testWnbaTrackingGateV2.js | 41/42 (nested chain) |
| testPropDecisionIntelligenceV1.js | 27/29 (nested chain) |
| testSideRescueEngineV1.js | 28/30 (nested chain) |
| testControlledBestSix.js | PASS |
| testControlledBestSixDisplay.js | PASS |
| testResultsTrackingCohort.js | PASS |
| testSignalPerformanceV1.js | PASS |
| testHistoryThreeSlateGroupsV1.js | PASS |
| testSlateRotationLifecycle.js | PASS |
| testTabDateSlateFlow.js | PASS |

**Pre-existing baseline failures (not introduced):** `testCourtEdgeDataFlow.js` cases 05, 18, 47 (slate date fixture `2026-07-08` vs `2026-06-24`).

---

## Intentionally Unchanged

- WNBA Reader as first side vote
- Stage order and Side Rescue existence
- Best 6 size (6) and track-all-6 learning
- HIGH/MEDIUM/LOW risk UI labels
- Gap threshold values (4.0 Over limited, 3.5 Under)
- Production tracked-props.json (not mutated)
- Home/Top tomorrow-only behavior
- No deploy

---

## Jul 13 2026 — Reader Over-Default & Gap-Floor Symmetry Fix

**Date:** 2026-07-13  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-reader-side-balance-v1`

### Prod Inspection (Jul 13 CT, before fix)

| Stage | All WNBA | Tomorrow |
|-------|----------|----------|
| Reader | 12O/1U | 7O/0U |
| Post-flip | 12O/1U | 7O/0U |
| bestSixDisplayWNBA | 5O/1U (full slate) | 3O/0U |
| Under eligible (reader) | 1/13 | — |
| Under gap-blocked | 12/13 | — |

Side balance audit: `NO_ELIGIBLE_MINORITY_CANDIDATE` — only 1 viable Under in pool.

### Root Cause

1. **Reader defaulted `finalSide = "OVER"`** before side comparison — when Under was gap-ineligible, Over won by default even with thin projection gap.
2. **Asymmetric gap floors in Reader** — Under gap < 3.5 blocked eligibility + −14 penalty; Over had no equivalent `resolveWnbaGapFloor()` enforcement in `scoreVolumePath`.
3. **Flip-First used post-penalty Under scores** — opposite-side review scored penalized Under cases, suppressing viable flips (`CHECK_UNDER` on all 5 Over Best 6 picks, zero flips).

Bias introduced at **Reader**, not Side Rescue or Best 6 ranking. Side balance correctly refused artificial swaps.

### Changes

| File | Fix |
|------|-----|
| `wnbaReaderEngine.js` | Symmetric Over gap floor via `resolveWnbaGapFloor()`; `preGapPenaltyScore` preserved; removed Over default; `BOTH_SIDES_GAP_FLOOR_FAIL` when neither side eligible |
| `flipFirstSideSelectionV1.js` | Opposite-side scoring uses `preGapPenaltyScore` for honest Under review |
| `sideSelectionTrustV1.js` | Over gap floor in `buildSideEvidenceFromCase` |
| `testWnbaReaderFixes.js` | +3 tests (thin Over NO_BET, valid Over wins, preGapPenalty preserved) |
| `server.js` | `SERVER_BUILD=courteedge-reader-side-balance-v1` |

### Simulated Impact (prod boardCapped, local re-read)

| | Reader O/U/NO_BET |
|--|--|
| Before | 12O/1U/0N |
| After | 7O/1U/5N |

5 thin-gap Overs correctly demoted to NO_BET. Under pool unchanged (1 viable Under — projections genuinely favor Over on most props).

### Tests

| Suite | Result |
|-------|--------|
| testWnbaReaderFixes.js | **22/22 PASS** |
| testSideSelectionTrustAccuracyV1.js | **37/37 PASS** (core) |
| testFlipFirstDecisionIntelligenceV1.js | 12/17 (5 nested baseline failures pre-existing) |

### Prod After Refresh (Jul 13, `courteedge-reader-side-balance-v1`)

| Stage | All WNBA | Tomorrow Best 6 |
|-------|----------|-----------------|
| Reader (before) | 12O/1U | 7O/0U |
| Reader (after) | 7O/1U | 6O/0U |
| bestSixDisplay (before) | 5O/1U | 3O/0U |
| bestSixDisplay (after) | 5O/1U | 4O/0U |

Thin-gap Over (Olivia Miles O edge 3.6) dropped from Best 6. Side balance still `NO_ELIGIBLE_MINORITY_CANDIDATE` — only 1 Under passes 3.5 gap floor on slate (Naz Hillmon U). Remaining Over-heavy pool is projection-driven, not Reader default bias.

**Commit:** `aea55f1`

---

## Jul 13 2026 — Gate Demotion, Honest Opposite Scores & Flip-First Viability

**Date:** 2026-07-13  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-side-selection-gate-v1`

### Prod Inspection (Jul 13 07:18Z, before this fix)

Home Tomorrow Best 6: **6O/0U** — all `CHECK_UNDER` + `KEEP_ORIGINAL`, Side Rescue `78 vs 8` or `78 vs 0`, natural gate `BOARD_ONLY` / `OVER_UNSTABLE_THIN_BOOK` on 5/6 picks.

| Prop | Flip-First | Side Rescue | Natural Gate |
|------|------------|-------------|--------------|
| Marina Mabrey O22.5 | CHECK_UNDER | 78 vs 8 | BOARD_ONLY / OVER_UNSTABLE_THIN_BOOK |
| Sonia Citron O17.5 | CHECK_UNDER | 78 vs 0 | BOARD_ONLY / OVER_UNSTABLE_THIN_BOOK |
| Kiki Iriafen O14.5 | CHECK_UNDER | 78 vs 0 | BOARD_ONLY / OVER_UNSTABLE_THIN_BOOK |
| Olivia Nelson-Ododa O10.5 | CHECK_UNDER | 74 vs 8 | BOARD_ONLY / DANGER_GATE_STACK |
| Carla Leite O14.5 | CHECK_UNDER | 70 vs 8 | BOARD_ONLY / OVER_UNSTABLE_THIN_BOOK |
| Megan Gustafson O12.5 | CHECK_UNDER | 70 vs 8 | BOARD_ONLY / OVER_UNSTABLE_THIN_BOOK |

Side balance: `NO_ELIGIBLE_MINORITY_CANDIDATE` (0 viable Unders in tomorrow pool).

### Root Cause

1. **Display Best 6 ranked unstable thin-book Overs above safer BOARD_ONLY picks** — `OVER_UNSTABLE_THIN_BOOK` props kept high safety scores despite natural `bestSixEligibility: false`; promotion to TRACK for learning masked gate quality in ranking.
2. **Side Rescue inflated opposite audit to 8** via evidence floor when Under failed gap floor — violated evidence-preservation spec (`78 vs 8` when Under `underGapFloorPassed: false`).
3. **Flip-First emitted `CHECK_UNDER` when opposite Under was not gap-viable** (`preGapPenaltyScore < 0`, `underGapFloorPassed: false`) — misleading review label.
4. **Naz Hillmon U excluded from Tomorrow view correctly** — she is on **TODAY** slate (`dayBucket: TODAY`), not tomorrow. Only viable Under on full slate; not eligible for tomorrow Best 6.
5. **6O/0U vs prior 4O/0U** — prod refresh after reader fix admitted more tomorrow Overs (6 reader-eligible vs 4); all tomorrow props remain BOARD_ONLY with zero gap-viable Unders.

### Changes

| File | Fix |
|------|-----|
| `controlledBestSixSelector.js` | Gate-reason demotion penalties (`OVER_UNSTABLE_THIN_BOOK` −110); viable-minority candidate check uses reader pre-gap + gap floor; version `controlled-best-six-over-balance-v3` |
| `flipFirstSideSelectionV1.js` | `oppositeSideViable()` — `BOTH_SIDES_WEAK` when opposite fails gap floor / negative pre-gap |
| `sideRescueEngineV1.js` | Opposite scoring uses `preGapPenaltyScore`; no evidence-floor inflation when gap floor fails; version `side-rescue-v1.3` |
| `testOverBalanceSideRescueV1.js` | +3 regression tests (gate demotion, BOTH_SIDES_WEAK, honest opposite) |
| `server.js` | `SERVER_BUILD=courteedge-side-selection-gate-v1` |

### Simulated Tomorrow Best 6 (prod boardCapped, fresh pipeline)

| | Before (07:18Z prod) | After (local re-pipeline) |
|--|--|--|
| O/U | 6O/0U | 6O/0U |
| #1 rank | Marina Mabrey (thin-book) | Olivia Nelson-Ododa (danger-stack, not thin-book) |
| Flip-First | CHECK_UNDER (all) | BOTH_SIDES_WEAK (all) |
| Side Rescue opposite | 8 or 0 (inflated) | 0 (honest — Under gap-ineligible) |
| Side balance | NO_ELIGIBLE_MINORITY_CANDIDATE | NO_ELIGIBLE_MINORITY_CANDIDATE |

**Props reordered:** unstable thin-book Overs (Mabrey, Citron, Iriafen, Leite, Gustafson) demoted below Nelson-Ododa. No artificial Under swaps — tomorrow pool has **0** gap-viable Unders.

### Tests

| Suite | Result |
|-------|--------|
| testOverBalanceSideRescueV1.js | **12/12 PASS** |
| testSideSelectionTrustAccuracyV1.js | **37/37 PASS** |
| testWnbaReaderFixes.js | **22/22 PASS** |

**Commit:** `8b2ad0a` — pushed to `orgin/betbrain-v2-rebuild`. Prod `/refresh-picks` run after push; Render deploy required for `courteedge-side-selection-gate-v1` to take effect (refresh response still showed prior `CHECK_UNDER` / `78 vs 8` bundle).

---

## Audit Scripts

- `scripts/auditSideSelectionPhase1.js` — tracking population, side ratios, Side Rescue counts
- `scripts/generateSideSelectionTraces.js` — before/after trace generator
- `scripts/testSideSelectionTrustAccuracyV1.js` — acceptance tests 1-37
