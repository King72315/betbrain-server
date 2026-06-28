# CourtEdge Opponent History Comparison v1 Report

**Date:** 2026-06-28  
**Branch:** `betbrain-v2-rebuild`  
**Build:** `courteedge-opponent-history-comparison-v1`  
**Module version:** `opponent-history-comparison-v1`

## Root cause / reason for adding

Matchup history existed in Ball API lookups (`wnbaMatchupLookupV1`, `ballService`) but was **not compared against recent form** in flip-first Decision Intelligence. Recent last-5 scoring and opponent-specific history were evaluated separately, so a hot recent Over could pass without checking whether the player historically struggles vs today's opponent.

This mirrors the prior availability fix principle: **absent opponent history must not create fake penalties** (unlike the old availability UNKNOWN bug).

## Files changed

| File | Change |
|---|---|
| `engines/decisionIntelligence/opponentHistoryComparisonV1.js` | **NEW** — comparison module |
| `engines/decisionIntelligence/decisionDataIntelligenceV1.js` | Integrate before flip-first; labels + finalInfluence |
| `engines/decisionIntelligence/flipFirstSideSelectionV1.js` | Weighted opponent-history scoring + flip-check trigger |
| `engines/decisionIntelligence/propDecisionIntelligenceV1.js` | Risk debt/repair from agree/contradict |
| `engines/wnba/wnbaDecisionEngine.js` | Pass `last5` / `matchupGames` into DI pipeline |
| `services/ballService.js` | Optional `maxGames` (up to 5) on WNBA matchup fetch |
| `services/trackedPropService.js` | Persist `opponentHistoryComparison` fields |
| `server.js` | `SERVER_BUILD` marker |
| `components/PropCard.tsx` | Compact "Opponent History:" line |
| `scripts/testOpponentHistoryComparisonV1.js` | **NEW** — 17 tests |
| `scripts/evaluateOpponentHistorySixProps.js` | **NEW** — before/after re-eval script |

## Integration point

Pipeline order (as requested):

```
Data Integrity → Recovery → projection → Reader → DDI modules
  → Opponent History Comparison   ← NEW (inside evaluateDecisionDataIntelligence, before flip-first)
  → Flip-First Side Selection
  → Decision Intelligence (risk truth)
  → Side Rescue
  → Best 6 → Results tracking
```

Hook: `evaluateDecisionDataIntelligence()` runs `evaluateOpponentHistoryComparison()` after usage/availability modules and **before** `evaluateFlipFirstSideSelection()`.

Data sources: `pick.last5`, `pick.matchupGames`, card `last5.pointsList`, data-recovery `matchupProbe.matchupGames` (games-first Ball flow, up to 5).

## No-history behavior (exact)

When `opponentGamesCount === 0`:

- `opponentHistory.sampleStatus` = `NONE`
- `opponentHistory.sideSupport` = `NO_HISTORY`
- `opponentHistory.noHistory` = `true`
- `comparison.agreement` = `NO_HISTORY`
- `confidenceImpact` / `riskImpact` / `flipSignal` = `NONE`
- **No** downgrade, block, flip, missing-data flag, or risk debt
- UI label: **"No opponent history"** / `No history`

## Sample-size weighting

| Games vs opponent | Status | Weight | Behavior |
|---|---|---|---|
| 5+ | `STRONG_SAMPLE` | 1.0 | Full confidence/risk/flip-check influence |
| 3–4 | `USABLE` | 0.55 | Medium weight; flip-check only, no hard flip alone |
| 1–2 | `SMALL_SAMPLE` | 0.25 | Context only; no flip signal |
| 0 | `NONE` / `NO_HISTORY` | 0 | Neutral — no penalty |

## Before/after — current 6 Results props

Re-evaluated via `node betbrain-server/scripts/evaluateOpponentHistorySixProps.js` (local run without Ball API key — opponent games require live Ball key on Render).

| Player | Side | Side flip? | Opp games | Recent L5 avg | Opp hist avg | Comparison | Label |
|---|---|---|---|---|---|---|---|
| Jessica Shepard | Over 13.5 | No | 0 | —* | — | no history | No history |
| Azzi Fudd | Over 14.5 | No | 0 | — | — | no history | No history |
| Veronica Burton | Under 11.5 | No | 0 | — | — | no history | No history |
| Leonie Fiebich | Over 10.5 | No | 0 | — | — | no history | No history |
| Kamilla Cardoso | Over 12.5 | No | 0 | — | — | no history | No history |
| Sydney Taylor | Over 14.5 | No | 0 | — | — | no history | No history |

\*Local eval lacked `BALLDONTLIE_KEY`; on Render with key loaded, last-5 and opponent history populate from `probeWnbaMatchupLookup` + `player_stats` by `game_ids[]`.

### Summary

- **Strengthened:** 0 (no agree samples in local no-key run)
- **Weakened:** 0 (no contradict samples in local no-key run)
- **Flipped:** 0
- **Top 2 changed:** No
- **Best 6 order changed:** No

All six props retained original sides. With live Ball data, props with 5+ agreeing/contradicting opponent samples may show confidence/risk adjustments without auto-flip unless flip-first independent evidence exists.

## Tests

```bash
node betbrain-server/scripts/testOpponentHistoryComparisonV1.js
```

**Result:** 17/17 passed

Cases cover: strong/medium/small/no sample, NO_HISTORY neutrality, no dataMissing/risk/flip penalty, contradict flip-check without auto-flip, confidence boost, risk raise, six-prop shape, Best 6/Top 2 preservation, points-only guard, no runtime JSON / no clear-tracked-props.

## Confirmations

| Item | Status |
|---|---|
| No new markets (assists/rebounds/PRA/threes) | ✓ Points-only guard |
| Secrets / .env untouched | ✓ |
| Runtime JSON not committed | ✓ |
| `/clear-tracked-props` not used | ✓ |
| Home Tomorrow Best 6 preserved | ✓ |
| Results tracks all 6 | ✓ |
| Top 2 from same Best 6 | ✓ |
| NBA/WNBA separation | ✓ |
| Flip-first DI preserved | ✓ |
| WNBA availability ACTIVE fix preserved | ✓ |

## UI

PropCard compact line examples:

- `Opponent History: Supports Over, 3 games used`
- `Opponent History: Contradicts Over, 5 games used`
- `Opponent History: Small sample, 2 games used`
- `Opponent History: No history`

Best 6 cards also show `Opp Hist` in flip-first metric row.

## Deploy note

After push, Render `/health` should report `serverBuild: "courteedge-opponent-history-comparison-v1"`. Re-run `evaluateOpponentHistorySixProps.js` on Render (with Ball key) for populated before/after stats on pending slates.
