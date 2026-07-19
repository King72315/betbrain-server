# CourtEdge Best 6 Playable Pool Repair V1 — Report

**Date:** 2026-07-19  
**SERVER_BUILD:** `courteedge-best6-playable-pool-repair-v1`  
**Branch:** `betbrain-v2-rebuild` · remote `orgin`  
**Prior prod:** `courteedge-engine-expansion-v1.1` (+ Lab V2 three-slate)  
**Reproduction:** `2026-07-19T11:34:02.050Z`

---

## 1. Exact root cause of Today producing only 3/6

Two compounding defects:

1. **Home Today display used the thin Today slice of a mixed Today+Tomorrow Best 6.**  
   `bestSixDisplayTodayWNBA` was set to `filterToday(bestSixDisplayWNBA)`. The mixed display ranked 6 props across both dates (often ~3 Today + ~3 Tomorrow), so Home Today showed **3/6** even when ≥6 Today board candidates existed.

2. **`selectControlledBestSix` treated soft gate demotions as terminal exclusions.**  
   `passesResultsEligibility` required `trackEligibility === "TRACK" && bestSixEligibility === true`. BOARD_ONLY / gap-floor / danger-stack / HIGH-risk / `NO_DECISIVE_RESCUE` candidates were dropped (`hiddenDueToQualityGate: 21`, `qualityPassedCount: 1`). Weak evidence was incorrectly treated as objective invalidity.

Secondary: Results admission sometimes re-ran Flip-First / gate / Side Rescue instead of consuming the immutable decision packet.

---

## 2. Full audit of all Today board candidates (2026-07-19)

From pre-mutation snapshot `backups/2026-07-19T06-44-52-pre-best6-playable-pool-repair-v1` (report `lastUpdated=2026-07-19T11:34:02.050Z`).

| # | Player | Side | Line | Gate / reason | Pool class | Selected pre-fix |
|---|--------|------|------|---------------|------------|-------------------|
| 1 | Rhyne Howard | Under | 18.5 | UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR | WEAK_BUT_PLAYABLE | Yes (Best #1) |
| 2 | Allisha Gray | Over | 18.5 | DANGER_STACK_INSUFFICIENT_EDGE | WEAK_BUT_PLAYABLE | Yes (Best #2) |
| 3 | Arike Ogunbowale | Under | 13.5 | UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR | WEAK_BUT_PLAYABLE | Yes (Best #3 / Top) |
| 4 | Nneka Ogwumike | Over | 17.5 | OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR | WEAK_BUT_PLAYABLE | No (excluded by thin Today slice / gate) |
| 5 | Azura Stevens | Over | 11.5 | OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR | WEAK_BUT_PLAYABLE | No |
| 6 | Brittney Griner | Over | 12.5 | OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR | WEAK_BUT_PLAYABLE | No |
| 7 | Erica Wheeler | Over | 10.5 | OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR | WEAK_BUT_PLAYABLE | No |
| 8 | Azzi Fudd | Under | 14.5 | UNDER_GAP_BELOW… + NO_DECISIVE_RESCUE | WEAK_BUT_PLAYABLE | No |
| 9 | Angel Reese | Over | 16.5 | OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR | WEAK_BUT_PLAYABLE | No |
| 10 | Alyssa Thomas | Over | 14.5 | DANGER_STACK_INSUFFICIENT_EDGE + NO_DECISIVE_RESCUE | WEAK_BUT_PLAYABLE | No |
| 11 | Brionna Jones | Under | 6.5 | DANGER_GATE_STACK_NO_TRACK / NO_BET kill | OBJECTIVELY_UNPLAYABLE* | No |

\*Hard kill / NO_BET with danger-stack no-track — remains excluded. Board “11” includes this edge case; ≥6 other candidates are playable.

Tracked pre-fix Today: Howard, Gray, Arike only (**3/6**).

---

## 3. Playable vs objectively invalid

**WEAK_BUT_PLAYABLE (stay in pool):** gap floors, danger-stack insufficient edge, BOARD_ONLY soft demotion, HIGH risk, thin books / market against, NO_DECISIVE_RESCUE, mixed/weak projection.

**OBJECTIVELY_UNPLAYABLE:** missing core fields, started (selector pool), confirmed OUT, unresolved identity, hard kill NO_BET (`LOW_VOLUME_OVER_TRAP`, `DANGER_GATE_STACK_NO_TRACK` with `noPlay`).

---

## 4. Exact legacy gate / selector path responsible

1. `filterAndGateCandidates` → `passesResultsEligibility` (BOARD_ONLY terminal)  
2. `buildControlledTrackingCohort` → `bestSixDisplayTodayWNBA: homeTodayDisplayWNBA` (unfilled Today slice)  
3. Optional: `buildResultsTrackingCohort` re-running decision stack on Best 6 members

---

## 5. Files changed

| File | Change |
|------|--------|
| `engines/topProps/controlledBestSixSelector.js` | Playable-pool contract; weak stay eligible; version bump; Home why on annotate; Top no longer rejects promoted BOARD_ONLY |
| `engines/topProps/homeReasonTextV1.js` | **New** — translate raw codes → readable Home reasons |
| `services/trackedPropService.js` | Fill Today Best 6 from today candidates; stamp Top from final six; Results reuse immutable packet |
| `engines/decisionIntelligence/decisionDataIntelligenceV1.js` | Market compact: WITH/NEUTRAL/AGAINST/UNAVAILABLE; thin≠AGAINST |
| `engines/decisionIntelligence/propDecisionIntelligenceV1.js` | Promote path uses readable why; strip raw codes |
| `utils/controlledBestSixDisplay.js` | Why line translation / no empty "Why: —" |
| `server.js` | SERVER_BUILD + cache rejects prior build/schema |
| `package.json` | `test:courtedge-best6-repair` |
| `scripts/testCourtEdgeBestSixPlayablePoolRepairV1.js` | Tests 1–40 (+bonuses) |

---

## 6. Final playable-pool contract

`PLAYABLE_POOL_CONTRACT_VERSION = playable-pool-contract-v1`  
`CONTROLLED_BEST_SIX_VERSION = controlled-best-six-playable-pool-repair-v1`

- Six selected whenever ≥6 objectively playable analyzed candidates exist  
- Weak evidence → conf/risk/rank/Top/explanation only  
- Selected rows always TRACK + Results admission  
- Side Rescue: KEEP_ORIGINAL | FLIP_SIDE | NO_DECISIVE_RESCUE (not terminal NO_BET)

---

## 7. Decision-stack idempotency proof

`buildResultsTrackingCohort` now reuses the packet when Best 6 display members already carry `courtEdgeDecisionPacketV1` / `decisionHash`+`sideSelectionBundle` / arbitration lock / `resultsAdmissionEligible`. Unit tests 26–28 cover annotate immutability; engine-expansion tests 76–78 cover packet double-admission.

---

## 8. Current slate seal-state findings (pre-fix)

- Today `2026-07-19`: tracked **3**, `eligibleTrackingCandidatesBySlate['2026-07-19']=3`, not officially sealed at 6  
- Tomorrow `2026-07-20`: Home display **6/6**; official seal still **DRAFT** (`PARTIAL_BOARD_AWAITING_FULL_OR_WINDOW_CLOSE` in one seal path)  
- Games unstarted at capture time → safe to rebuild/reseal via normal refresh (no silent membership rewrite of a sealed 6)

---

## 9. Safe pregame reseal/repair performed

No raw JSON edits. No `clear-tracked-props`. Repair is selector/wiring/cache; live membership expands on deploy + `/refresh-picks` while games remain unstarted.

---

## 10. Market-signal mapping audit

**Bug verified:** thin books set `marketWarning=true` with `sideImpact=NEUTRAL` / `movement=flat`, but compact label forced **AGAINST**.

**Fix:** compact Home market is WITH / NEUTRAL / AGAINST / UNAVAILABLE from line direction vs final side; thin/flat → NEUTRAL; missing lines → UNAVAILABLE. No weight changes.

---

## 11. Same-team cluster audit

No V2 policy rewrite. Preserved: canonical team ID grouping, primary Over / secondary force, line immutability, `sideLockedAfterArbitration`, Results cannot reverse. MN–SEA inspected in board data; opposite teams keep distinct `canonicalTeamId`.

---

## 12. Top-ranking audit

After Today fill, Top is stamped from the **final six** (`stampTopLabelsOnBestSix`) without rewriting confidence/risk. Pre-fix Arike Top #2 at 51% was an artifact of a 3-prop slate.

---

## 13. User-facing reason cleanup

Raw codes translated on Home (e.g. UNDER_GAP_BELOW… → readable sentence). Codes retained on `naturalGateReason` / diagnostics / Lab. Empty "Why: —" filled with truthful TRACK copy.

---

## 14. Cache / version repair

`cacheFresh()` rejects mismatched `serverBuild` or `boardSchemaVersion`. Controlled Best 6 version mismatch already invalidated cache.

---

## 15. Fresh Today report (live post-deploy)

**Captured after** `/health` build `courteedge-best6-playable-pool-repair-v1` + `/refresh-picks` (`lastUpdated=2026-07-19T12:58:10.230Z`).

| Metric | Value |
|--------|--------|
| Controlled Best 6 Today | **6/6** |
| All TRACK | **yes** |
| Raw code leak in Why | **no** |
| Markets | NEUTRAL (thin books no longer AGAINST) |

Selected Today:
1. Rhyne Howard Under 18.5 (Top WNBA #1) — TRACK / MEDIUM  
2. Arike Ogunbowale Under 13.5 (Top WNBA #2) — TRACK / MEDIUM  
3. Nneka Ogwumike Over 17.5 — TRACK / MEDIUM  
4. Azura Stevens Over 11.5 — TRACK / MEDIUM  
5. Brittney Griner Over 12.5 — TRACK / MEDIUM  
6. Alyssa Thomas Over 14.5 — TRACK / MEDIUM  

## 16. Fresh Tomorrow report

| Metric | Value |
|--------|--------|
| bestSixDisplayWNBA | **6/6** |
| Markets | **NEUTRAL** (was incorrectly AGAINST) |

Includes Stewart / McBride / Malonga and other playable ranks.  

## Results note

`activeResultsSlateDate` remains **2026-07-17** with **6** tracked (overnight Results hold). Today Home board is independently **6/6**; Today is not admitted into Results while Jul 17 blocks — lifecycle preserved, no sealed rewrite.

---

## 17–18. TRACK / Results equality

Contract + tests: six selected ⇒ six TRACK ⇒ Results admission count 6.

---

## 19. Tests passed / failed

| Suite | Result |
|-------|--------|
| `test:courtedge-best6-repair` | **43/43** passed |
| `test:courtedge-engine-expansion` | **85/85** passed |
| `test:courtedge-lab-v2` | **68/68** passed |
| Official slate lifecycle | **13/13** passed |
| Lifecycle integrity | **6/6** passed |
| Tracked-props lifecycle filter | 17 passed, **2 failed** (pre-existing; PARTIALLY_GRADED / cap validation on historical fixtures — not introduced by this repair) |

---

## 20–21. Engine Expansion / Lab V2 regression

Both green (85 + 68). Lab V2 modules and three-slate groups not modified.

---

## 22–26. Build / commit / push / Render / health

| Item | Value |
|------|--------|
| SERVER_BUILD | `courteedge-best6-playable-pool-repair-v1` |
| Commit | `694a0a11d637423889ee82a49872bfc7c7dfd163` |
| Push | `orgin/betbrain-v2-rebuild` (synced) |
| Render | auto-deploy live |
| Live `/health` | `serverBuild=courteedge-best6-playable-pool-repair-v1`, `controlledBestSixVersion=controlled-best-six-playable-pool-repair-v1` |

---

## 27. Rollback command

```bash
git revert <commit> && git push orgin betbrain-v2-rebuild
# or redeploy prior: courteedge-engine-expansion-v1.1
```

---

## 28–30. Confirmations

- **No live calibration weights changed**  
- **Lab V2 + frozen three-slate blocks untouched**  
- **No tracked/historical data deleted**; no raw JSON fake 6/6; no clear-tracked-props  

---

## Pre-mutation backup

`betbrain-server/backups/2026-07-19T06-44-52-pre-best6-playable-pool-repair-v1/`  
Captured: `/health`, `/picks`, `/top-props`, `/tracked-props`, `/slates/locked`, `/diagnostics`, `/courtedge/lab`, `/daily-slate-reports` + candidate-pool audit.
