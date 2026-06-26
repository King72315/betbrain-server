# CourtEdge Side Rescue v1 Report

**Date:** 2026-06-25  
**Branch:** `betbrain-v2-rebuild`  
**Base:** `courteedge-decision-intelligence-v1`  
**SERVER_BUILD:** `courteedge-side-rescue-v1`  
**Backup:** `betbrain-server/backups/2026-06-26T04-09-20-583Z-pre-side-rescue-v1-build`

## Executive Summary

Side Rescue v1 adds a second-direction review after Decision Intelligence when risk debt challenges the initial side. It can **KEEP_ORIGINAL**, **FLIP_SIDE**, demote to **BOARD_ONLY**, or block with **NO_BET**. WNBA pipeline order:

```
data card → reader → tracking gate v2 → decision intelligence v1 → side rescue v1 → best 6 / results
```

## New Module

`betbrain-server/engines/decisionIntelligence/sideRescueEngineV1.js`

**Version:** `side-rescue-v1`

**Exports:**
- `evaluateSideRescue(candidate, options)`
- `applySideRescueToPick(pick, sideRescue, options)`
- `applySideRescueEligibilityOverlay(pick, sideRescue)`
- `runSideRescuePipeline(pick, options)`
- `buildSideRescueReview(slateProps)`
- `buildSideRescueRetroSimulation(props, options)`

## Rules Summary

| Action | When |
|--------|------|
| **KEEP_ORIGINAL** | No meaningful risk debt, or original side survives risk-adjusted scoring |
| **FLIP_SIDE** | Opposite score ≥ 60, margin ≥ 10 (7 if thin edge), ≥ 2 independent evidence, no opposite kill debts, no major contradiction |
| **BOARD_ONLY** | Original fragile (KILL/HIGH debt, under fragility) but opposite did not earn flip |
| **NO_BET** | Both sides chaotic with low confidence data |

### Under triggers
- FTA collapse vs season (rebound risk)
- Volatile/unstable minutes
- Expanding role contradicts Under
- Under fragility stack (3+ factors: limited data, volatility, FTA risk, thin gap, danger stack, etc.)

### Over triggers
- Low-volume Over trap (KILL)
- Efficiency-only scoring spike (KILL)
- Contracting role contradicts Over

### Flip guards
- Opposite kill debts block flip (e.g. low-volume Over trap on opposite)
- Fair-line / projection major contradiction blocks flip
- Post-flip: re-run gate + DI on flipped side (in `runSideRescuePipeline`)

## Dearica Hamby Retro (06/25 U15.5)

| Field | Value |
|-------|-------|
| Original side | UNDER |
| Action | BOARD_ONLY |
| Triggered | Yes |
| Reasons | WNBA_LIMITED_DATA, VOLATILE_MINUTES, FTA_COLLAPSE_RISK, UNDER_FRAGILITY_STACK |
| Final side | UNDER (not flipped — opposite lacked independent evidence) |
| Tracking | BOARD_ONLY (excluded from Results / Best 6) |

## Integration Points

| File | Change |
|------|--------|
| `wnbaDecisionEngine.js` | Side rescue after DI in WNBA decision path |
| `controlledBestSixSelector.js` | `controlled-best-six-side-rescue-v1`; rescue before Best 6 admission |
| `trackedPropService.js` | Rescue in WNBA tracking gate; serialize sideRescue fields |
| `topPicksSnapshotService.js` | Snapshot sideRescue metadata |
| `dailySlateReportService.js` | Sections V (Review) and W (Retro Simulation) |
| `server.js` | `sideRescueVersion` in cache invalidation + picks payload |
| `utils/controlledBestSixDisplay.js` | Display rescue status on Best 6 cards |
| `components/PropCard.tsx` | Best Six variant shows rescue action/explanation |
| `app/(tabs)/results.tsx` | "Flipped from Over/Under" note |
| `app/(tabs)/prop-lab.tsx` | Side Rescue Review + Retro Simulation sections |

## Tests

`betbrain-server/scripts/testSideRescueEngineV1.js` — 30 acceptance tests

Also run: `testPropDecisionIntelligenceV1.js`, `testControlledBestSix.js`, `testControlledBestSixDisplay.js`, `testCourtEdgeDataFlow.js`, `testSlateRotationLifecycle.js`

## Controlled Best Six Version

`CONTROLLED_BEST_SIX_VERSION` = `controlled-best-six-side-rescue-v1`
