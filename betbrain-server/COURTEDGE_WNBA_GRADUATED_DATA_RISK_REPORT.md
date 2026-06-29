# CourtEdge WNBA Graduated Data Risk v1

**SERVER_BUILD:** `courteedge-wnba-graduated-data-risk-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Module:** `wnbaGraduatedDataModeV1.js` (`wnba-graduated-data-mode-v1`)

## Summary

Replaced league-wide `WNBA_LIMITED_DATA` risk debt with per-prop graduated coverage. Props with complete core fields (`playerId`, `seasonStats`, `last5`, `minutes`, `fga`, `market`) earn `WNBA_FULL_DATA` and can reach true **LOW** risk when the rest of the profile is clean. Missing fields surface as specific `MISSING_*` debts instead of a blanket limited-data penalty.

## Changes

| Area | Before | After |
|------|--------|-------|
| `playerStateBuilder` / `volumeProfileEngine` / `wnbaPlayerPropDataCard` | All WNBA → `WNBA_LIMITED_DATA` | `resolveWnbaGraduatedDataMode()` per prop |
| `propDecisionIntelligenceV1` | Unconditional `WNBA_LIMITED_DATA` debt; blocked all WNBA from LOW | `collectWnbaDataCoverageDebts()`; `hasMaterialDataCoverageGaps()` gates LOW |
| `wnbaTrackingGateV2` | Blanket LOW ceiling for every WNBA limited-data prop | LOW ceiling only for core data gaps / volatile limited-data combos |
| `volumeDangerGatesEngine` | Blanket `wnba_limited_data` gate | Removed — gaps expressed via `MISSING_*` debts |
| Gap floors 3.5 / 4.0 | Limited-data only | Preserved for all WNBA tracking gates |
| `PropCard.tsx` | `WNBA Limited Data` only | Added `WNBA Full Data` label |

## Jessica Shepard O12.5 (06/25 fixture)

| Field | Before (blanket limited) | After (graduated v1) |
|-------|--------------------------|----------------------|
| `dataMode` | `WNBA_LIMITED_DATA` | `WNBA_FULL_DATA` |
| Primary risk debt | `WNBA_LIMITED_DATA` | `VOLATILE_MINUTES` |
| `trueRisk` | `MEDIUM` (capped by limited data) | `HIGH` (volatile minutes) |
| `riskAfterCeiling` | `Medium Risk` (`WNBA_LIMITED_DATA_MIN_MEDIUM`) | `Medium Risk` (`DANGER_GATE_BLOCKS_LOW`) |
| Explanation lead | "wnba limited data" | "volatile minutes flagged by danger gate" |
| Low Risk possible? | No (blanket WNBA limited ceiling) | No (volatile minutes — correct behavior) |

Complete-data WNBA props with stable profiles (e.g. Azzi Fudd O13.5 fixture) can now earn **Low Risk** when edge and fair-line criteria are met.

## Tests

| Suite | Result |
|-------|--------|
| `testWnbaGraduatedDataModeV1.js` | 4/4 pass |
| `testWnbaTrackingGateV2.js` | 40/40 pass |
| `testPropDecisionIntelligenceV1.js` | 27/27 pass |
| `testControlledBestSix.js` | 32/32 pass |
| `testWnbaResultsQualityGate.js` | 18/18 pass (via gate suite) |

New coverage:
- Complete-data WNBA → LOW possible (`testPropDecisionIntelligenceV1` #26)
- Incomplete data → specific `MISSING_*` in explanation (#27)
- Graduated mode unit tests (`testWnbaGraduatedDataModeV1.js`)

## Preserved

- WNBA gap floors 3.5 (Under) / 4.0 (Over)
- All tracking gate danger stacks, NO_BET rules, Best 6 / Top Picks eligibility
- No changes to markets, `clear-tracked-props`, runtime JSON, or secrets
