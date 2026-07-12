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

## Audit Scripts

- `scripts/auditSideSelectionPhase1.js` — tracking population, side ratios, Side Rescue counts
- `scripts/generateSideSelectionTraces.js` — before/after trace generator
- `scripts/testSideSelectionTrustAccuracyV1.js` — acceptance tests 1-37
