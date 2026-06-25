# CourtEdge WNBA Props Simplified — Build Report

**Branch:** `betbrain-v2-rebuild`  
**Build:** `courteedge-wnba-props-simplified-v1` (frontend-only; no server.js change required — `/picks` already exposes `bestSixWNBA`)  
**Date:** 2026-06-25

## Summary

Simplified the WNBA Props screen (`explore.tsx`) to default to **Controlled Best 6** only (max 6 TRACK props per day). Full game board, all candidates, score ledgers, and mixed-day clutter are collapsed behind **Show Full Board** / **Full Board** scout mode.

## Layout (Default — Today)

```
┌─────────────────────────────────────┐
│ WNBA Props                          │
│ Controlled Best 6                   │
│ Date: <today local>                 │
├─────────────────────────────────────┤
│ [Today] [Tomorrow] [Full Board]     │
├─────────────────────────────────────┤
│ Summary                             │
│ Controlled Best 6  X/6              │
│ Top Picks  Y/2                      │
│ Board Candidates  N                 │
│ Board Only  A · No Bet  B           │
├─────────────────────────────────────┤
│ Best 6 cards (rank, player, game,   │
│ prop, confidence, true risk,        │
│ decision, why, risk debt/repair)    │
│ Top WNBA #1/#2 badges inline        │
├─────────────────────────────────────┤
│ [Show Full Board]  ← collapsed      │
└─────────────────────────────────────┘
```

**Scout mode** (Full Board tab or Show Full Board): WNBA game cards, all generated candidates, full PropCard with expandable score ledger.

## Files Changed

| File | Change |
|------|--------|
| `app/(tabs)/explore.tsx` | Rewritten — WNBA Controlled Best 6 default UI |
| `app/(tabs)/wnba.tsx` | Re-exports `explore` for Home → WNBA Props route |
| `components/PropCard.tsx` | Added `variant="bestSix"` compact card + ledger expand |
| `utils/controlledBestSixDisplay.js` | Shared display helpers (filter, summary, badges) |
| `services/api.ts` | Extended `/picks` normalization with `bestSixWNBA`, `topWNBAProps` |
| `betbrain-server/scripts/testControlledBestSixDisplay.js` | 15 helper tests |

## Data Source

- `GET /picks` → `bestSixWNBA`, `topWNBAProps`, `wnbaGames`
- `decisionIntelligence` fields: `trackEligibility`, `trueRisk`, `simpleExplanation`, `riskDebts`, `riskRepairs`
- Top WNBA #1/#2 badges merged from `topWNBAProps` via `buildTopPickBadgeMap` (badges only — no top-props.tsx duplication)

## Acceptance Criteria (15/15)

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Header reads **WNBA Props — Controlled Best 6** | ✅ |
| 2 | Date defaults to **today** (local slate date) | ✅ |
| 3 | Summary shows Controlled Best 6 X/max 6, Top Picks 2, **Board Candidates** (not Playable), Board Only, No Bet | ✅ |
| 4 | Main list = Best 6 cards only in default view | ✅ |
| 5 | Cards show Rank, Player, Team/game, Prop, Confidence, True Risk, Decision | ✅ |
| 6 | Cards show Why, Risk Debt, Risk Repair from `decisionIntelligence` | ✅ |
| 7 | Top WNBA #1/#2 badges inline on Best 6 cards (no separate Top Props section) | ✅ |
| 8 | Score ledger hidden in default; expandable on Best 6 card | ✅ |
| 9 | Full game board + all candidates hidden by default | ✅ |
| 10 | Tomorrow not mixed into Today default view | ✅ |
| 11 | **Show Full Board** / Scout Mode reveals full board | ✅ |
| 12 | Date toggle: **Today \| Tomorrow \| Full Board** | ✅ |
| 13 | Data from `bestSixWNBA` API field | ✅ |
| 14 | `testControlledBestSixDisplay.js` — 15 tests | ✅ |
| 15 | No engine/threshold/runtime JSON changes | ✅ |

## Tests

```bash
node betbrain-server/scripts/testControlledBestSixDisplay.js
```

## Out of Scope (confirmed)

- No engine/threshold changes
- No runtime JSON, secrets, or `/clear-tracked-props`
- No duplication of `top-props.tsx` selection logic
