# COURTEDGE CONTROLLED BEST SIX REPORT

**Branch:** `betbrain-v2-rebuild`  
**Date:** 2026-06-24  
**SERVER_BUILD:** `courteedge-controlled-best-six-v1`

---

## Goal

Replace uncontrolled full-board Results tracking with a TennisEdge-style controlled cap:

```
allGeneratedCandidates
→ quality gate (WNBA wnbaResultsQualityGate)
→ rank per league by bestPropScore
→ controlledBestSixWNBA (max 6) + controlledBestSixNBA (max 6)
→ Results tracks Best 6 only
→ Top 2 WNBA/NBA from Best 6 only (team diversity)
```

---

## Backup

- **Path:** `betbrain-server/backups/2026-06-24T18-09-04-723Z-pre-controlled-best-six-v1/`
- **Reason:** `pre-controlled-best-six-v1`

---

## Lab / 06-21 safety

| Check | Result |
|-------|--------|
| 06/21 Lab bundle | **SAFE** — read-only; no Lab/History mutation |
| `/clear-tracked-props` | **NOT USED** |
| Runtime JSON migration | **NONE** — code-only deploy; existing tracked props untouched at build time |
| NBA pick generation | **PROTECTED** — NBA scoring path unchanged (`nbaTopPropScore` / `getPickScore`) |
| TennisEdge / other projects | **NOT TOUCHED** |

---

## New module

`betbrain-server/engines/topProps/controlledBestSixSelector.js`

| Export | Role |
|--------|------|
| `selectControlledBestSix(candidates, league, options)` | Filter → quality gate → score → Best 6 with diversity |
| `selectTopTwoFromBestSix(bestSix, league, options)` | Top 2 from Best 6 with team diversity |
| `selectControlledBestSixCombined(gameCards, options)` | Full orchestrator for refresh/API |

**Version:** `controlled-best-six-v1`

### Best 6 cap rules

1. Full `allGeneratedCandidates` per league (not per-game board cap)
2. WNBA quality gate: only `TRACK` eligibility passes
3. Exclude: NO_BET, noPlay, started, missing fields, duplicate player, opposite side
4. Rank by `bestPropScore`
5. Select up to 6 with diversity:
   - max 2 per player team
   - max 3 per game
   - prefer score quality; allow fewer than 6 if slate is thin

### Top 2 rules

- Selected only from league Best 6
- Different player teams when possible
- If no different-team #2 exists: return only #1 + `noDifferentTeamCandidate` audit

### Audit fields

`hiddenDueToBestSixCap`, `hiddenDueToTeamCap`, `hiddenDueToGameCap`, `hiddenDueToQualityGate`, `candidateCountByLeague`, `qualityPassedCountByLeague`, `selectedBestSixTeamsByLeague`, `selectedTopTeamsByLeague`

---

## Files changed

| File | Change |
|------|--------|
| `engines/topProps/controlledBestSixSelector.js` | **New** selector module |
| `server.js` | Wire Best 6 flow, API fields, diagnostics, `SERVER_BUILD` |
| `services/trackedPropService.js` | Cohort diagnostics use Best 6; `TRACKING_COHORT_VERSION` bump |
| `services/topPicksSnapshotService.js` | `sourcePool: CONTROLLED_BEST_SIX`, Best 6 snapshots + Lab review |
| `services/dailySlateReportService.js` | Section O: Controlled Best 6 Performance |
| `scripts/testControlledBestSix.js` | **New** — 22 tests |
| `scripts/testResultsTrackingCohort.js` | Updated for controlled cohort |
| `scripts/testWnbaResultsQualityGate.js` | Updated cohort test |
| `app/(tabs)/top-props.tsx` | “Selected from controlled Best 6” subtitle |
| `app/(tabs)/results.tsx` | NBA/WNBA tracked counts + cohort label |
| `app/(tabs)/prop-lab.tsx` | Controlled Best 6 Performance section |
| `services/api.ts` | Pass-through Best 6 API fields |

---

## API (`GET /top-props`, `/diagnostics`)

- `bestSixWNBA`, `bestSixNBA`
- `topWNBAProps`, `topNBAProps`, `topProps` (max 4 compat)
- `topPropsSource: "CONTROLLED_BEST_SIX"`
- `topWNBAPropsSelectedFromBestSix`, `topNBAPropsSelectedFromBestSix`
- `bestSixCountByLeague`, `qualityPassedCountByLeague`
- `hiddenDueToBestSixCap`, `hiddenDueToTeamCap`, `hiddenDueToGameCap`, `hiddenDueToQualityGate`
- `controlledBestSixVersion`, `bestSixSnapshot`

---

## Duplicate grading prevention

- Results tracks **Best 6 originals only** (max 6 per league)
- Top 2 are **reference-only** (`isTopPickReference`, `referenceOnly`) — not added as separate tracked props
- `addTrackedProps` uses `skipTopPickReferences: true`
- Snapshots store `trackedKey` references to original props
- Lab Top Picks Review is `subsetAnalysisOnly: true`

---

## Tests run

```bash
node betbrain-server/scripts/testControlledBestSix.js   # 22/22 PASS
node betbrain-server/scripts/testResultsTrackingCohort.js   # 13/13 PASS
node betbrain-server/scripts/testTopPropSelector.js   # 14/14 PASS
node betbrain-server/scripts/testTopPicksLifecycle.js   # 10/10 PASS
node betbrain-server/scripts/testWnbaReaderFixes.js   # 18/18 PASS
node betbrain-server/scripts/testWnbaResultsQualityGate.js   # 18/18 PASS
```

---

## Live verification expectations

1. `GET /health` → `serverBuild: courteedge-controlled-best-six-v1`
2. `GET /diagnostics` → `controlledBestSixVersion`, `trackingControlledByBestSix: true`
3. `GET /top-props` → `bestSixWNBA.length <= 6`, `bestSixNBA.length <= 6`, top props from Best 6
4. `GET /tracked-props` → controlled Best 6 per active league/slate (not full board)
5. Top Props tab: Best 2 per league with controlled Best 6 subtitle
6. Lab: Controlled Best 6 Performance + Top Picks Review sections
7. No duplicate props in Results/Lab/History

---

## Not touched

TennisEdge, ChurchEdge, ParentEdge, KingsWayBudget, TradingEdge, `.env`, API keys, Render secrets, `eas.json`, 06/21 Lab/History data
