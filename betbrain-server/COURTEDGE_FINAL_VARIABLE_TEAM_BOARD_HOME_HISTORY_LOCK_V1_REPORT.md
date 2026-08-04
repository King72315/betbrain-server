# CourtEdge — Final Variable Team Board + Home-to-History Lifecycle Lock V1

**Build:** `courteedge-final-variable-team-board-home-history-lock-v1`  
**Mode:** STRUCTURAL IMPLEMENTATION ONLY  
**Date:** 2026-08-04  

## 1. Files changed

### Server (`betbrain-server`)

| File | Change |
|------|--------|
| `engines/topProps/variableTeamBoardHomeHistoryLockV1.js` | **NEW** — canonical identity, duplicate guard, safety ranking, Home summary, mutation/build locks, strip legacy surfaces |
| `engines/topProps/controlledBestBoardCanonicalV3.js` | Seal build → lock V1; safety-rank selectedProps; empty Top/Best6; duplicate check; WNBA always variable |
| `engines/topProps/controlledBestBoardV2.js` | Remove Top/Best6 Overall emission (`TOP_PICKS_LIMIT=0`); stamp board for canonical safety sort |
| `services/officialSlateService.js` | Duplicate membership block; sort by safetyRank; force variable WNBA; lifecycle comment Home→Results→History |
| `services/slateLockService.js` | `promoteCompletedResultsToHistory`; `promoteSlateToLab` → History shim; History props get `historyDetail` (former Lab fields) |
| `services/courtEdgeStateIntegrityV1.js` | `GRADED_COMPLETE` → `IN_HISTORY` (Lab kept only as historical-readable transition) |
| `services/dailySlateReportService.js` | Comment: final reports go Results→History via shim |
| `server.js` | `SERVER_BUILD` = lock V1 |
| `scripts/testVariableTeamBoardHomeHistoryLockV1.js` | **NEW** acceptance tests 1–15 + dry run |
| `scripts/testCanonicalControlledBoardSealingPathV3.js` | Updated for removed Top/Best6/Lab packet fields |

### App (`BetBrain` Expo)

| File | Change |
|------|--------|
| `app/(tabs)/_layout.tsx` | Top + Lab tabs `href: null` (hidden); nav = Home / Results / History |
| `components/HomeControlledBestSixScreen.tsx` | Summary without `/6`, Top, Best 6 View; copy = Results→History |
| `utils/controlledBestSixDisplay.js` | Summary: overs/unders, `bestSixOverallCount=0`, `topPicks=0`, variable board |

## 2. Old Top / Best 6 / Lab paths found

- `app/(tabs)/top-props.tsx`, `prop-lab.tsx` (screens remain but hidden from nav)
- `engines/topProps/controlledBestSixSelector.js` (`BEST_SIX_LIMIT`, `selectTopTwoFromBestSix`)
- `services/trackedPropService.js` residual Best Six naming (V2 pass-through gated)
- `services/slateLockService.js` former `promoteSlateToLab` (now History shim)
- `services/dailySlateReportService.js` / `rotateStaleLabArchives`
- `services/courtEdgeLabV2.js`, `GET /courtedge/lab*`
- Client `selectTopTwoFromDisplayBestSix` (no longer surfaced in Home summary)

## 3. Paths removed or disabled

| Path | Status |
|------|--------|
| Top tab navigation | **Disabled** (`href: null`) |
| Lab tab navigation | **Disabled** (`href: null`) |
| Active `topPicks` / `bestSixOverall` in canonical packet | **Emptied** (`[]`) |
| Lab promotion as lifecycle stage | **Bypassed** → direct History |
| Six-row Official membership cap (WNBA) | **Disabled** via `shouldUseVariableBoardSeal` |
| Home summary Top Picks / Best 6 View / `X/6` | **Removed** |

## 4. Final navigation structure

```
Home → Results → History
```

Hidden (not in tab bar): Top, Lab, Saved, Explore, NBA, WNBA, Settings.

## 5. Final Home payload

Canonical source: `controlledBestBoard.selectedProps` (= `selectionBuildId`-stamped, safety-ranked).

Summary fields:

- Controlled Best Board count (variable)
- Results Tracked `N/N`
- Overs / Unders
- Date verification
- Board version / selectionBuildId
- `variableBoardSize: true`, `noGlobalCap: true`

No Top Picks, Best 6 Overall, or Lab links.

## 6. Final Results payload

Exact Official membership only. Denominator = Official count (`12/12`, `20/20`, never default `X/6`). Grades/actuals update only after seal.

## 7. Final History payload

Completed slate archives with `phase: ARCHIVED`, `labStageSkipped: true`, `lifecyclePath: HOME_RESULTS_HISTORY`.  
Each prop includes `historyDetail` (identity, result, pregame model, signal analysis, postgame) — former Lab data attached per prop.

## 8. Canonical membership source

```
controlledBestBoard.selectedProps
  == officialMembership
  == Home board
  == Results tracked set
```

Built by V2 pair selection → V3/lock packet (`buildCanonicalControlledBoardPacket`).

## 9. Variable-count behavior

| Games | Expected props (full markets) |
|------:|------------------------------:|
| 1 | 4 |
| 2 | 8 |
| 3 | 12 |
| 5 | 20 |

No global min/max. Empty slots only for hard market/date failures.

## 10. Safety-ranking behavior

`applySafetyRanking` / `computeCanonicalSafetyScore` (existing evidence only — confidence, risk, projection margin, market quality, books, stability, conflicts, blowout risk).  
Primary Home order: `canonicalSafetyScore DESC` → unique `safetyRank` 1…N.

## 11. Team Over/Under behavior

Unchanged pair rules: `MAX_OVERS_PER_TEAM=1`, `MAX_UNDERS_PER_TEAM=1`, `MAX_PROPS_PER_TEAM=2`, distinct players, organic sides only (`sideChanged/forcedSide/autoFlip = false`).

## 12. Duplicate protection

`canonicalPropIdentity` + `assertNoDuplicateMembership` → `DUPLICATE_BOARD_MEMBERSHIP` blocks Official draft write.

## 13. Build-ID locking

`selectionBuildId` stamped on packet; seal mismatch → `STALE_SELECTION_BUILD`.

## 14. Direct Results-to-History lifecycle

```
Home board → Official seal → Results grading → History archive
```

`promoteSlateToLab` retained as shim calling `promoteCompletedResultsToHistory`.

## 15. Former Lab data on historical props

`historyDetail` envelope on each archived prop (`labDataAttachedToProp: true`).

## 16. Tests passed and failed

| Suite | Result |
|-------|--------|
| `testVariableTeamBoardHomeHistoryLockV1.js` | **16/16 PASS** |
| `testCanonicalControlledBoardSealingPathV3.js` | **12/12 PASS** |

## 17–21. Dry run (3 games)

Synthetic CT slate `2099-01-15` (does not touch live Jul/Aug archives):

| Metric | Value |
|--------|------:|
| Home count | 12 |
| Official count | 12 |
| Results count | 12 |
| Overs | 6 |
| Unders | 6 |
| Safety ranks | 1…12 |

## 22–25. Confirmations

| Requirement | Status |
|-------------|--------|
| No Top tab (active nav) | **Yes** |
| No Best 6 (active membership/UI) | **Yes** |
| No Lab tab (active nav) | **Yes** |
| No global prop cap | **Yes** |

## 26. Historical immutability

No Jul 29–Aug 3 (or other completed) slate membership/grades rewritten. Tests use `2099-01-15` synthetic dates only. Old Lab-era archives remain readable.

## 27. Prediction weights

**Unchanged.** No edits to projection formulas, signal weights, confidence/risk calculators, side scoring, pair scoring, market thresholds, injury/defense/pace/blowout logic, provider keys, or refresh schedule.

## 28. Live/completed slate rewrite

**None.** Structural code + synthetic tests only. Production Render still needs Manual Deploy of this build.

---

## Final product contract (locked)

```
Verified games
  → Best organic Over + best organic Under from each team
  → Full board ranked safest → riskiest on Home
  → Exact same full board Official + Results
  → Completed slate → History
  → Detailed analysis attached to each historical prop
```

There is no Top tab.  
There is no Best 6.  
There is no global cap.  
There is no Lab tab.  
There is one canonical board membership.
