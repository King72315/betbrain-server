# CourtEdge WNBA Tracking Gate v2 Report

**Date:** 2026-06-25  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-wnba-tracking-gate-v2-live`

## Backup

- **Path:** `betbrain-server/backups/2026-06-25T19-33-47-193Z-pre-wnba-tracking-gate-v2`
- **Reason:** `pre-wnba-tracking-gate-v2`
- **Live calibration backup:** `betbrain-server/backups/2026-06-25T19-45-10-207Z-pre-wnba-tracking-gate-v2-live-0625`

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
- Low line (≤7.5) + thin edge → BOARD_ONLY
- Unstable/volatile minutes → BOARD_ONLY (elite edge override for large gaps)
- Thin market (bookCount < 2, netEdge < 7) → BOARD_ONLY

### WNBA_LIMITED_DATA — Over

- `projectionGap` ≥ **4.0** (elite profile exception when netEdge ≥ 8, data ≥ 65, books ≥ 3)
- `fairLineEdge` ≥ **3.5** unless elite
- FGA ≥ **9** (low-volume Over trap block below)
- Minutes ≥ **24** unless gap ≥ 5
- Unstable role without expanding trend + gap < 4 → BOARD_ONLY
- One-book + netEdge < 7 → BOARD_ONLY

### dangerGateStack

| Count | Effect |
|-------|--------|
| ≥ 2 | No Low Risk; extra edge required to TRACK |
| ≥ 3 | BOARD_ONLY unless elite edge + clean role |
| ≥ 4 | NO_BET |

Stack flags: `unstableMinutes`, `volatileMinutes`, `lowVolumeOverTrap`, `lowMinutesFloor`, `ftaCollapse`, `efficiencyOnlyScoring`, `oneBookMarket`, `missingOpponentDefense`, `missingAvailability`, `roleTrendContradiction`, `projectionFairLineDisagreement`, `thinGap`, `underFragility`

### Risk ceilings

- WNBA_LIMITED_DATA → minimum **Medium Risk**
- LIMITED_DATA + volatile/unstable minutes → minimum **Medium Risk**
- Under + any volatility → not Low Risk
- Low minutes floor → not Low Risk
- Low volume over trap → not Low Risk, min **High Risk**
- Efficiency-only scoring → not Low Risk
- Elite edge allows TRACK but does **not** erase risk ceiling

## Wiring

| File | Change |
|------|--------|
| `engines/wnba/wnbaTrackingGateV2.js` | v2-live gate tightening + boardOnlyReasons split |
| `engines/wnba/wnbaGateInputs.js` | Shared input resolution |
| `engines/wnba/wnbaResultsQualityGate.js` | Delegates to v2 |
| `engines/wnba/wnbaDecisionEngine.js` | Risk ceiling after gate |
| `engines/topProps/controlledBestSixSelector.js` | Risk ceiling on gated picks |
| `services/trackedPropService.js` | Gate fields on tracked props |
| `server.js` | `ensureWnbaGateOnGames`, SERVER_BUILD bump |
| `components/PropCard.tsx` | Gate decision + risk-after-ceiling + reason |
| `app/(tabs)/explore.tsx` | Best 6 gate/risk preview |
| `scripts/testWnbaTrackingGateV2.js` | 40 tests incl. 06/25 live cases |

## Live 06/25 calibration evidence

Board props from LIVE 06/25 slate used as named acceptance cases. Thin-gap Unders demoted to **BOARD_ONLY** (not hard NO_BET) so board visibility remains while Results blocks tracking.

| Player | Prop | Expected TRACK | Expected Risk |
|--------|------|----------------|---------------|
| Natisha Hiedeman | O15.5 | TRACK | Medium+ (LIMITED_DATA + unstable) |
| Azzi Fudd | O13.5 | TRACK | Medium+ |
| Jessica Shepard | O12.5 | may TRACK | not Low |
| Sabrina Ionescu | U17.5 | TRACK (elite edge) | not Low |
| Dearica Hamby | U15.5 | BOARD_ONLY | Medium/High |
| Ariel Atkins | U10.5 | BOARD_ONLY | not Low |
| NaLyssa Smith | O10.5 | NO_BET/BOARD_ONLY | High (trap) |
| A'ja Wilson | U25.5 | BOARD_ONLY | not Low |
| Marine Johannes | U9.5 | BOARD_ONLY | not Low |
| Shakira Austin | U13.5 | NO_BET/BOARD_ONLY | not Low |
| Angel Reese | O13.5 | BOARD_ONLY | not Low |
| Gabby Williams | O16.5 | not TRACK | not Low |
| Rhyne Howard | O18.5 | NO_BET/BOARD_ONLY | not Low |

### v2-live rule changes

- **boardOnlyReasons** vs **blockReasons**: thin-gap Unders/Overs → BOARD_ONLY; traps, fair-line hard disagree, efficiency-only spike → NO_BET
- **hasEliteEdgeOverride**: volatile Under with netEdge ≥ 8 + gap ≥ 3.5 can TRACK (Sabrina pattern) but risk ceiling still applies
- **FTA collapse** added to danger stack for Under fragility (Hamby pattern)
- **Board pipeline**: `ensureWnbaGateOnGames()` re-applies gate + risk ceiling on all WNBA picks before Best 6 selection
- **UI**: PropCard + explore show `wnbaTrackingDecision`, `wnbaTrackingReason`, `riskAfterCeiling`

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
node betbrain-server/scripts/testWnbaTrackingGateV2.js — 40/40 PASS
  (includes testWnbaResultsQualityGate, testCourtEdgeDataFlow,
   testControlledBestSix, testTopPicksLifecycle)
testWnbaResultsQualityGate.js — 18/18
testControlledBestSix.js — 29/29
testWnbaReaderFixes.js — 18/18
testWnbaOfficialV1.js — 6/6
```

## Live expectations

- `/health` → `serverBuild: courteedge-wnba-tracking-gate-v2-live`
- Full WNBA board still visible
- Results / Best 6 only admits `TRACK` candidates
- Board UI shows gate decision + risk-after-ceiling before tracking
- Lab Section N/Q/R show gate review + 06/24 retro simulation on rebuild
