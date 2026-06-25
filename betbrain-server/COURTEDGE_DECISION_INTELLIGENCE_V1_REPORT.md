# CourtEdge Decision Intelligence v1 Report

**Date:** 2026-06-25  
**Branch:** `betbrain-v2-rebuild`  
**Base:** `courteedge-wnba-tracking-gate-v2-live` (15effdb)  
**SERVER_BUILD:** `courteedge-decision-intelligence-v1`  
**Backup:** `betbrain-server/backups/2026-06-25T15-19-16-083Z-pre-decision-intelligence-v1-build`

## Executive Summary

Decision Intelligence v1 unifies prop trust evaluation into one parent brain: **Risk Debt → Risk Repair → True Risk → Track Eligibility → Best 6 → Top Picks → Results**. WNBA wraps Tracking Gate v2 (no duplicated gate logic). NBA uses shared structures with passthrough for now.

## New Module

`betbrain-server/engines/decisionIntelligence/propDecisionIntelligenceV1.js`

**Export:** `evaluatePropDecisionIntelligenceV1(candidate, options)`

Also exports: `applyDecisionIntelligenceToPick`, `buildDecisionIntelligenceReview`, `buildRiskHonestyReview`, `buildUpgradeDemotionReview`, `buildDecisionIntelligenceRetroSimulation`

## Risk Debt

Each prop collects structured debts with `code`, `severity` (LOW/MEDIUM/HIGH/KILL), `reason`, `side`, `repairable`.

| Code | Typical Severity |
|------|------------------|
| WNBA_LIMITED_DATA | MEDIUM |
| UNSTABLE_MINUTES | HIGH |
| VOLATILE_MINUTES | MEDIUM |
| LOW_MINUTES_FLOOR | MEDIUM |
| LOW_FGA | MEDIUM/HIGH |
| LOW_VOLUME_OVER_TRAP | KILL |
| THIN_EDGE | HIGH |
| THIN_NET_EDGE | MEDIUM |
| EFFICIENCY_ONLY_SCORING | KILL |
| ROLE_TREND_CONTRADICTS_SIDE | HIGH |
| PROJECTION_FAIR_LINE_DISAGREE | HIGH |
| LOW_BOOK_COUNT | MEDIUM |
| MISSING_AVAILABILITY / MISSING_OPPONENT_DEFENSE | LOW |

KILL debts are not repairable. 3+ debts usually not repairable unless elite repairs exist.

## Risk Repair

Strong evidence can overcome limited debt:

- ELITE_PROJECTION_GAP (gap ≥ 5)
- ELITE_NET_EDGE (≥ 8)
- ELITE/STRONG_FAIR_LINE_EDGE
- PROJECTION_FAIR_LINE_AGREE
- STRONG_FGA (≥ 9), STRONG_MINUTES (≥ 24)
- STABLE_ROLE, EXPANDING_ROLE_FOR_OVER, CONTRACTING_ROLE_FOR_UNDER
- MULTI_BOOK_COVERAGE, CLEAN_DANGER_STACK

## True Risk

| Grade | Meaning |
|-------|---------|
| LOW | Rare; clean profile, no limited data, stable volume, strong edges |
| MEDIUM | Trackable with real concerns (most WNBA limited-data TRACK props) |
| HIGH | Too dangerous for Results/Top Picks |

**WNBA rule:** `WNBA_LIMITED_DATA` + unstable/volatile minutes → never LOW.

## Track Eligibility

Delegated to Tracking Gate v2, surfaced as `trackEligibility`:

- **TRACK** — Results-eligible (if Best 6 selects)
- **BOARD_ONLY** — Board learning, not tracked
- **SHADOW_ONLY** — Multiple warnings
- **NO_BET** — Hard block

`bestSixEligibility` = TRACK + not HIGH (elite override exception)  
`topPickEligibility` = bestSixEligibility + not HIGH

## Pipeline Wiring

```
data card → reader → wnbaTrackingGateV2
→ evaluatePropDecisionIntelligenceV1
→ controlledBestSixSelector (bestSixEligibility && TRACK)
→ Top Picks (topPickEligibility, no HIGH)
→ trackedPropService (decisionIntelligence saved)
```

**Files changed:**
- `engines/decisionIntelligence/propDecisionIntelligenceV1.js` (new)
- `engines/wnba/wnbaDecisionEngine.js`
- `engines/topProps/controlledBestSixSelector.js` → `controlled-best-six-di-v1`
- `services/trackedPropService.js`
- `services/dailySlateReportService.js`
- `server.js` → SERVER_BUILD
- `components/PropCard.tsx`
- `app/(tabs)/explore.tsx`
- `app/(tabs)/prop-lab.tsx`
- `scripts/testPropDecisionIntelligenceV1.js` (new)
- `scripts/testControlledBestSix.js`, `testCourtEdgeDataFlow.js` (version bump)

## UI Changes

**Board (explore.tsx):** Replaced confusing "Playable" with Board Intelligence summary: Candidates / Trackable / Board Only / No Bet.

**PropCard:** Shows `decisionIntelligence.simpleExplanation`, `trueRisk`, `trackEligibility`.

**Lab (prop-lab.tsx):** New sections S (Decision Intelligence Review), T (Risk Honesty), U (Upgrade/Demotion). Section R retro sim now runs for any fully graded slate.

## 06/25 Example Outcomes

| Player | Prop | Track | True Risk |
|--------|------|-------|-----------|
| Natisha Hiedeman | O15.5 | TRACK | MEDIUM |
| Azzi Fudd | O13.5 | TRACK | MEDIUM |
| Sabrina Ionescu | U17.5 | TRACK | MEDIUM |
| Jessica Shepard | O12.5 | varies | not LOW |
| Dearica Hamby | U15.5 | BOARD_ONLY | MEDIUM/HIGH |
| Ariel Atkins | U10.5 | BOARD_ONLY | MEDIUM |
| NaLyssa Smith | O10.5 | NO_BET/BOARD | HIGH |
| Marine Johannes | U9.5 | BOARD_ONLY | MEDIUM |
| Shakira Austin | U13.5 | not TRACK | HIGH |
| Angel Reese | O13.5 | BOARD_ONLY | MEDIUM |
| Gabby Williams | O16.5 | not TRACK | MEDIUM |
| Rhyne Howard | O18.5 | not TRACK | HIGH |

## Tests

`testPropDecisionIntelligenceV1.js`: **25/25 passed**

Includes regression runs of:
- testWnbaTrackingGateV2.js (40/40)
- testControlledBestSix.js
- testCourtEdgeDataFlow.js (50/50)
- testSlateRotationLifecycle.js

## Safety Confirmations

- No `/clear-tracked-props`
- No 06/21 or 06/24 result rewrites
- Retro simulation report-only (`noMutation: true`)
- No secrets, eas.json, or runtime JSON committed
- Backup created before code changes
