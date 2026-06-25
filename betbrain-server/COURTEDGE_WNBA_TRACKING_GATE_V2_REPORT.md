# CourtEdge WNBA Tracking Gate v2 Report

**Date:** 2026-06-25  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-wnba-tracking-gate-v2`

## Backup

- **Path:** `betbrain-server/backups/2026-06-25T19-33-47-193Z-pre-wnba-tracking-gate-v2`
- **Reason:** `pre-wnba-tracking-gate-v2`

## Safety confirmations

| Check | Status |
|-------|--------|
| `/clear-tracked-props` used | No |
| 06/21 Lab mutated | No |
| 06/24 historical results rewritten | No |
| Secrets / `.env` / `eas.json` touched | No |
| Runtime JSON committed | No |
| NBA scoring path changed | No |

## Root cause — 06/24 loss patterns

CourtEdge tracked 14 WNBA_LIMITED_DATA TEST props into Results. Unders went 0-4, Low Risk mislabeled at 1-4. Thin projection gaps, unstable volume, and missing-data stacks were not strong enough to demote props before tracking.

## Gate rules implemented (v2)

### Core module: `engines/wnba/wnbaTrackingGateV2.js`

**Outcomes:** `TRACK` | `BOARD_ONLY` | `SHADOW_ONLY` | `NO_BET`

### WNBA_LIMITED_DATA — Under (stricter)

- `projectionGap` ≥ **3.5** (was 3.0)
- `fairLineEdge` ≥ **3.5** when fair line supports Under
- Role must not be UP/expanding
- Low line (≤7.5) + thin edge → block
- Unstable/volatile minutes → block
- Thin market (bookCount < 2, netEdge < 7) → block

### WNBA_LIMITED_DATA — Over

- `projectionGap` ≥ **4.0** (elite profile exception when netEdge ≥ 8, data ≥ 65, books ≥ 3)
- `fairLineEdge` ≥ **3.5** unless elite
- FGA ≥ **9** (low-volume Over trap block below)
- Minutes ≥ **24** unless gap ≥ 5
- Unstable role without expanding trend + gap < 5 → block
- One-book + netEdge < 7 → block

### dangerGateStack

| Count | Effect |
|-------|--------|
| ≥ 2 | No Low Risk; extra edge required to TRACK |
| ≥ 3 | BOARD_ONLY unless elite edge + clean role |
| ≥ 4 | NO_BET |

Stack flags: `unstableMinutes`, `volatileMinutes`, `lowVolumeOverTrap`, `lowMinutesFloor`, `oneBookMarket`, `missingOpponentDefense`, `missingAvailability`, `roleTrendContradiction`, `projectionFairLineDisagreement`, `thinGap`, `underFragility`

### Risk ceilings

- WNBA_LIMITED_DATA → minimum **Medium Risk**
- Any danger gate → blocks Low Risk
- Under + limited data → minimum Medium
- bookCount < 4 → blocks Low Risk
- danger stack ≥ 3 → High Risk ceiling

## Wiring

| File | Change |
|------|--------|
| `engines/wnba/wnbaTrackingGateV2.js` | New v2 gate + retro simulation |
| `engines/wnba/wnbaGateInputs.js` | Shared input resolution |
| `engines/wnba/wnbaResultsQualityGate.js` | Delegates to v2 |
| `engines/wnba/wnbaDecisionEngine.js` | Risk ceiling after gate |
| `services/trackedPropService.js` | PART 11 gate fields on tracked props |
| `services/dailySlateReportService.js` | Sections N/Q/R — Gate Review + retro sim |
| `server.js` | SERVER_BUILD bump |
| `app/(tabs)/prop-lab.tsx` | WNBA v2 Gate Review + Loss Review + Retro sim UI |
| `components/PropCard.tsx` | Gate decision + risk-after-ceiling |
| `scripts/testWnbaTrackingGateV2.js` | 24 tests |

## Retroactive 06/24 simulation (report-only)

Hydrated from tracked-prop snapshots (no historical mutation):

| Metric | Actual | Simulated v2 |
|--------|--------|--------------|
| Tracked | 14 | 3 |
| Record | 6-7-0 | 1-2-0 |
| Losses blocked | — | 5 |
| Wins kept | — | 1 |
| Wins blocked | — | 5 |

**Losses that v2 would block:** Lexi Held Under 8.5, Michaela Onyenwere Over 8.5, Gabriela Jaquez Under 9.5, Cecilia Zandalasini Under 8.5, Rhyne Howard Over 17.5

**Assessment:** Gate is aggressive on 06/24 snapshot data — blocks most thin-gap props including several winners. Future slates with full `wnbaDataCard` at decision time will have richer volume/role signals. Primary value: stops the worst Under/thin-gap profiles from entering Results going forward.

## Tests

```
node betbrain-server/scripts/testWnbaTrackingGateV2.js — 24/24 PASS
  (includes testWnbaResultsQualityGate, testCourtEdgeDataFlow,
   testControlledBestSix, testTopPicksLifecycle)
```

## Live expectations

- `/health` → `serverBuild: courteedge-wnba-tracking-gate-v2`
- Full WNBA board still visible
- Results / Best 6 only admits `TRACK` candidates
- Lab Section N/Q/R show gate review + 06/24 retro simulation on rebuild
