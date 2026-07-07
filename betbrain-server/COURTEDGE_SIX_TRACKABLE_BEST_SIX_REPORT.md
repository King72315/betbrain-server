# CourtEdge Six-Trackable Best 6 Report

**Date:** 2026-07-07  
**SERVER_BUILD:** `courteedge-six-trackable-best-six-v1`  
**Branch:** `betbrain-v2-rebuild`

## Summary

Removed `BOARD_ONLY` and `SHADOW_ONLY` from Controlled Best 6 display, Results admission labels, and Home summary UI. All six display slots are now **TRACK**-admitted for Results learning. Quality signal is carried by **true risk**, **confidence**, and **risk debts** — not demotion labels.

`NO_BET` remains a hard block at the candidate filter (`noPlay` / reader kill paths). Props that previously landed as `BOARD_ONLY` or `SHADOW_ONLY` on the board are promoted to `TRACK` when selected into Best 6, with `bestSixPromoted` / `promotionReasons` preserved in audit.

## Before / After — Jul 7 prod slate (`.tmp-prod-top-props-0707.json`)

### WNBA Best 6 (before deploy)

| Rank | Player | Decision (before) | True Risk | Confidence |
|------|--------|-------------------|-----------|------------|
| 1 | Paige Bueckers | TRACK | MEDIUM | 82 |
| 2 | Flau'jae Johnson | TRACK | MEDIUM | 73 |
| 3 | Dominique Malonga | **BOARD_ONLY** | HIGH | 80 |
| 4 | Kahleah Copper | **BOARD_ONLY** | HIGH | 85 |
| 5 | Valeriane Ayayi | TRACK | MEDIUM | 77 |
| 6 | Pauline Astier | **NO_BET** | HIGH | 75 |

**Before:** 3/6 natural TRACK, 2 BOARD_ONLY, 1 NO_BET label — Results cohort admitted all 6 but labels split trust signal.

### WNBA Best 6 (after this build)

| Rank | Player | Decision (after) | True Risk | Notes |
|------|--------|------------------|-----------|-------|
| 1 | Paige Bueckers | TRACK | MEDIUM | unchanged |
| 2 | Flau'jae Johnson | TRACK | MEDIUM | unchanged |
| 3 | Dominique Malonga | **TRACK** | HIGH | promoted from BOARD_ONLY |
| 4 | Kahleah Copper | **TRACK** | HIGH | promoted from BOARD_ONLY |
| 5 | Valeriane Ayayi | TRACK | MEDIUM | unchanged |
| 6 | Pauline Astier | **TRACK** | HIGH | promoted from NO_BET (safest fill) |

**After:** 6/6 TRACK, 6/6 Results-trackable. Bueckers and Johnson stay natural TRACK. Malonga/Copper/Astier show TRACK badge with HIGH true risk and prior-gate reasons in the Why line.

### NBA Best 6

| | Before | After |
|---|--------|-------|
| Display count | 0/6 | 6/6 when `nbaGames` have analyzed candidates |
| Root cause (Jul 7) | No NBA games in prod refresh payload | Unchanged when slate empty; fill logic unchanged — NBA passthrough TRACK when candidates exist |

Jul 7 prod had **0 NBA games** in cache — empty NBA tab is expected for that refresh, not a selector regression.

## Implementation

| File | Change |
|------|--------|
| `engines/topProps/controlledBestSixSelector.js` | Safety-score ranking for display; `annotateResultsAdmission` forces TRACK; version `controlled-best-six-six-trackable-v1` |
| `engines/decisionIntelligence/propDecisionIntelligenceV1.js` | `promoteBestSixCohortPick()` — TRACK promotion with audit preservation |
| `services/trackedPropService.js` | Display cohort always TRACK label; simplified `isBestSixDisplayResultsProp` |
| `utils/controlledBestSixDisplay.js` | Removed boardOnly/shadowOnly summary buckets → `highRisk`; report + enrich normalize TRACK |
| `components/LeagueControlledBestSixScreen.tsx` | Summary: High Risk replaces Board Only |
| `components/PropCard.tsx` | Best 6 variant always shows TRACK decision badge |
| `utils/propLabels.ts` | Removed Board Only badge |
| `server.js` | `SERVER_BUILD` → `courteedge-six-trackable-best-six-v1` |

## NO_BET clarification

- **Board pool:** `NO_BET` candidates still counted in summary `noBet` bucket.
- **Best 6 fill:** When a formerly `NO_BET` prop is the safest remaining slot, it is promoted to **TRACK** with **HIGH** true risk for learning — not left as NO_BET label on Home.
- **Hard excludes:** `noPlay`, started games, missing fields, and reader kill traps still never enter the candidate pool.

## Tests

All passing:

- `scripts/testControlledBestSixDisplay.js` — 44/44
- `scripts/testControlledBestSix.js` — 32/32
- `scripts/testResultsTrackingCohort.js` — 17/17
- `scripts/testFlipFirstDecisionIntelligenceV1.js` — updated case 09

## Deploy

Push branch `betbrain-v2-rebuild` and redeploy server. Refresh `/picks` after deploy to bust cache (`controlledBestSixVersion` change).

---

## Top Picks safest-v1 — `courteedge-top-picks-safest-v1`

Top 2 (Top tab + Home badges) now selected by **safety score** across all 6 Best 6 props — not raw Best #1/#2 rank. Team diversity on slot 2 preserved.

### Jul 7 WNBA example

| | Rank-order Top 2 (before) | Safety-score Top 2 (after) |
|---|---------------------------|----------------------------|
| Top #1 | Paige Bueckers (Best #1) | **Flau'jae Johnson** (Best #2) |
| Top #2 | Flau'jae Johnson (Best #2) | **Paige Bueckers** (Best #1) |

Same two players, but **order flips** — Johnson edges Bueckers on safety (200.4 vs 200.0; identical pickScore, Johnson's gate/debt profile scores marginally higher). Ayayi (Best #5) is 3rd-safest; Malonga skipped for Top 2 (same team as Johnson). HIGH-risk promoted slots (Malonga, Copper, Astier) stay out of Top 2.
