# CourtEdge Over-Balance + Side Rescue Report

**Date:** 2026-07-07  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-over-balance-side-rescue-v1`  
**Selector:** `controlled-best-six-over-balance-v1`  
**Side Rescue:** `side-rescue-v1.1`

## Executive summary

Investigated Over-heavy Best 6 and side-rescue contradictions on the Jul 7 WNBA slate. Root causes were **systematic**, not random:

1. **Reader initial side** picks OVER whenever `overCase.score >= underCase.score` — pool skews Over (18O / 13U on Jul 7).
2. **Flip-first `CHECK_UNDER`** is advisory only; it triggered but opposite Under scored **0** when reader `underCase` was negative (e.g. Bueckers reader under −22).
3. **Side rescue** short-circuited to `BOARD_ONLY` whenever the tracking gate was `BOARD_ONLY`, **before** evaluating whether Under won on independent evidence.
4. **Opposite audit scores** returned `oppositeRiskAdjustedScore: 0` even when not triggered — misleading “82 vs 0” copy.
5. **Promotion** stacked `prior gate: BOARD_ONLY, SIDE_RESCUE_BOARD_ONLY` while display cards showed TRACK.
6. **Home summary** `boardTrack` incorrectly added high-risk (BOARD_ONLY/SHADOW) into the track bucket.

Fixes preserve: 6 trackable TRACK Best 6, safest Top 2, Home tabs, track-all-6, no BOARD_ONLY on card badges.

---

## Root cause — Over-heavy Best 6

| Layer | Finding |
|-------|---------|
| `wnbaReaderEngine.js` | `finalSide = overCase.score >= underCase.score ? OVER : UNDER` — structural Over bias when cases are close or Under penalized (limited-data Under gap floor). |
| Candidate pool | One side per player-line (reader side only). Jul 7 pool: **18 Overs / 13 Unders**. |
| `controlledBestSixSelector` | Display ranks by safety score; Overs with higher confidence/gate repair dominated. No side-balance guard → could fill 6/6 Over when top six Over scores cluster. |
| Same-team collision | DAL–NYL cluster (Bueckers, Fudd, Stewart-type slates) scored collision but penalty was too light to reorder weaker teammate Overs. |

**Not a bug:** Unders exist on the board but were outranked by safety score — not blocked by a hard Over filter.

---

## Side-rescue audit

| Check | Before | After |
|-------|--------|-------|
| Flip-first on Bueckers O21.5 | `CHECK_UNDER` (collision, unstable minutes, danger stack) | Same — still advisory |
| Side rescue opposite score | **0** (reader under −22 × 4.5 clamped) | Projection/evidence floor; non-zero when review not triggered |
| Gate `BOARD_ONLY` short-circuit | Forced `BOARD_ONLY` before flip evaluation | Flip evaluated first; `BOARD_ONLY` only when opposite fails floors |
| Flip-first `CHECK_UNDER` | Ignored by side rescue | Adds `FLIP_FIRST_CHECK_OPPOSITE` trigger + relaxed flip floors |
| Dearica Hamby U15.5 (volatile Under) | `BOARD_ONLY` rescue | `KEEP_ORIGINAL` — original adjusted 56 vs opposite 20 (correct) |
| Promotion copy | `BOARD_ONLY, SIDE_RESCUE_BOARD_ONLY` | `BOARD_ONLY` only (original gate); rescue demotion not duplicated on TRACK cards |

**Verdict:** Side rescue was **partially broken** — gate short-circuit and zero opposite scoring blocked legitimate Under review and produced contradictory promotion copy. Flip-first was **working as designed** (CHECK, not auto-flip).

---

## Fixes implemented

| File | Change |
|------|--------|
| `sideRescueEngineV1.js` | v1.1 — projection/evidence scoring when reader case negative; flip-first CHECK trigger; gate BOARD_ONLY after flip attempt; honest opposite scores when not triggered |
| `flipFirstSideSelectionV1.js` | Moderate-edge boost when reader case weak |
| `controlledBestSixSelector.js` | `over-balance-v1` — flip-first action propagation; side-balance swap (≤12pt margin); pass flip-first into rescue |
| `propDecisionIntelligenceV1.js` | Promotion flags: original gate only (no `SIDE_RESCUE_*` stack) |
| `slateSameTeamCollisionV1.js` | Stronger 3+ Over cluster penalties |
| `decisionDataIntelligenceV1.js` | Propagate `flipFirstAction` / `flipFirstDecision` on pipeline |
| `utils/controlledBestSixDisplay.js` | `boardTrack` = natural TRACK; separate `boardHighRisk` |
| `server.js` | `SERVER_BUILD` → `courteedge-over-balance-side-rescue-v1` |

---

## Jul 7 slate — before / after (`.tmp-prod-picks-0707.json` / trust-inspect)

### Prod snapshot (before deploy)

| Metric | Value |
|--------|-------|
| Best 6 sides | **5 Over / 1 Under** (Bueckers, Johnson, Malonga, Copper, Ayayi Over; Astier Under) |
| Flip-first on display | **not propagated** (`ff=undefined`) |
| Side rescue | `KEEP_ORIGINAL` with **82 vs 0** audit |
| Promotion flags | `BOARD_ONLY` + `SIDE_RESCUE_BOARD_ONLY` on promoted slots |

### Fixed engine (same payload)

| Rank | Player | Side | Flip-first | Side rescue | Promo flag |
|------|--------|------|------------|-------------|------------|
| 1 | Flau'jae Johnson | Over | CHECK_UNDER | KEEP_ORIGINAL | BOARD_ONLY |
| 2 | Sabrina Ionescu | Under | CHECK_OVER | KEEP_ORIGINAL | — |
| 3 | Paige Bueckers | Over | CHECK_UNDER | KEEP_ORIGINAL | BOARD_ONLY |
| 4 | Erica Wheeler | Under | CHECK_OVER | KEEP_ORIGINAL | BOARD_ONLY |
| 5 | Awa Fam | Over | CHECK_UNDER | KEEP_ORIGINAL | BOARD_ONLY |
| 6 | Arike Ogunbowale | Under | CHECK_OVER | KEEP_ORIGINAL | SHADOW_ONLY |

| Metric | After |
|--------|-------|
| Best 6 sides | **3 Over / 3 Under** (side-balance swap when viable Under within 12 safety pts) |
| Flip-first | Propagated on all 6 |
| Summary `boardTrack` | Natural TRACK count (not TRACK + high-risk) |
| Display cards | TRACK with `prior gate: BOARD_ONLY` only (no SIDE_RESCUE contradiction) |

**Note:** Bueckers / Johnson Overs remain when Under projection does not beat floors — correct (Under edge negative). Collision weaker teammate Overs (Fudd/Stewart pattern) receive heavier slate penalties.

---

## Tests

| Suite | Result |
|-------|--------|
| `testOverBalanceSideRescueV1.js` | **7/7** |
| `testSideRescueEngineV1.js` | **30/30** |
| `testControlledBestSix.js` | **33/33** |
| `testControlledBestSixDisplay.js` | **44/44** |
| `testFlipFirstDecisionIntelligenceV1.js` | **16/16** |
| `testPropDecisionIntelligenceV1.js` | **29/29** |

---

## Deploy

Push `betbrain-v2-rebuild` and redeploy. Refresh `/picks` after deploy (`controlledBestSixVersion` + `SERVER_BUILD` changed).
