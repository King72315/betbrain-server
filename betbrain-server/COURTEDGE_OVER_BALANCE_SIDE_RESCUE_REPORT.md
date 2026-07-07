# CourtEdge Over-Balance + Side Rescue Report

**Date:** 2026-07-07  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-over-balance-side-rescue-v2`  
**Selector:** `controlled-best-six-over-balance-v2`  
**Side Rescue:** `side-rescue-v1.2`

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
| `utils/controlledBestSixDisplay.js` | `boardTrack` = natural TRACK; separate `boardHighRisk`; **client-side `applyDisplaySideBalance`** after tomorrow date scoping; summary labels "Natural Track (board)" |
| `server.js` | `SERVER_BUILD` → `courteedge-over-balance-side-rescue-v2` |

### v2 follow-up (post-d0e9970 prod paste still 5O/1U)

| Issue | Root cause | Fix |
|-------|------------|-----|
| Prod still **5O/1U** at 04:45Z | **Stale deploy + cached picks** on Render; v1 server fix never reached prod `/picks` | Bump `SERVER_BUILD` + `controlledBestSixVersion`; redeploy + `/refresh-picks` |
| Home tomorrow still Over-heavy after v1 | **Client bug** — `buildLeagueBestSixBoard` / `resolveDateScopedDisplayPool` re-filled Best 6 from board candidates **without** side balance | `applyDisplaySideBalance` runs after date scoping on Home tomorrow view |
| Side balance stopped at **4O/2U** | `minMinority=2` treats 2 Unders as satisfied (max 4 Overs allowed) | Raised to `minMinority=3` → targets **3O/3U** when viable Unders within margin |
| **"78 vs 0"** keep reasons | Reader `underCase` negative → audit score clamped to 0 even when evidence exists | `side-rescue-v1.2`: `auditOppositeDisplayScore` + `formatKeepOriginalReason` uses projection/evidence floor |
| Summary **Board Track: 0** | Old label counted only natural TRACK; promoted TRACK cards looked like "board track" bucket | Split `boardOnly` / `shadowOnly` / `highRisk`; UI label → **Natural Track** |
| Side-balance swap threshold too tight | Trigger at `limit-1` (5/6) + single swap | Multi-iteration swap at `limit-2`, margin **24**, up to 3 minority picks |

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

### v2 fixed engine — same Jul 7 slate

| View | Before (prod paste) | After v2 |
|------|---------------------|----------|
| Server `full_board` Best 6 | 5O / 1U | **3O / 3U** |
| Home **tomorrow** display | 5O / 1U (client re-fill, no balance) | **3O / 3U** |
| Side rescue keep reason | `82 vs 0` on CHECK_UNDER Overs | Evidence-based opposite score (non-zero when review ran) |
| Summary buckets | Board Only 10, Shadow 2, Board Track 0 | Board Only / Shadow / Natural Track reconciled to six-trackable model |

---

## Tests

| Suite | Result |
|-------|--------|
| `testOverBalanceSideRescueV1.js` | **9/9** (incl. tomorrow >=2 Unders, <=4 Overs) |
| `testSideRescueEngineV1.js` | **30/30** |
| `testControlledBestSix.js` | **33/33** |
| `testControlledBestSixDisplay.js` | **44/44** |
| `testFlipFirstDecisionIntelligenceV1.js` | **16/16** |
| `testPropDecisionIntelligenceV1.js` | **29/29** |

---

## Deploy

Push `betbrain-v2-rebuild` and redeploy. After deploy call `POST /refresh-picks` (or wait for cron). Verify `/picks` returns `serverBuild: courteedge-over-balance-side-rescue-v2`, `sideRescue.version: side-rescue-v1.2`, and Home tomorrow Best 6 is **3O/3U** on Jul 7 slate.
