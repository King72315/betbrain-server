# COURTEDGE TOP PROPS SELECTOR BUILD REPORT

**Branch:** `betbrain-v2-rebuild`  
**Date:** 2026-06-23  
**Scope:** Global Top Props selection from full generated candidate pool

---

## Goal

Replace per-game capped board as the Top Props source. New flow:

```
allGeneratedCandidates → league score engine → invalid filter → global sort → diversity caps → topProps + audit
```

`buildTopPicksForGame` remains for game board display (max 4 per game).

---

## Backup

- **Path:** `betbrain-server/backups/2026-06-23T06-18-40-215Z-pre-top-prop-selector-build/`
- **Reason:** `pre-top-prop-selector-build`

---

## Lab / 06-22 safety

| Check | Result |
|-------|--------|
| 06/21 Lab bundle | **SAFE** — `lab-bundles/2026-06-21/manifest.json`: 14 props, 5-9-0, 14 graded |
| 06/22 tracked mutation | **NONE** — code-only; no `/clear-tracked-props`; no runtime JSON writes |
| locked-slates.json | Only `2026-06-21` LAB entry |

---

## New modules

```
betbrain-server/engines/topProps/
  topPropSelector.js         — orchestrator
  nbaTopPropScore.js         — NBA adapter (pickRanker getPickScore)
  wnbaTopPropScore.js        — WNBA v2 reader/dataCard breakdown
  topPropSelectionAudit.js   — audit + official/test/no-bet helpers
```

### WNBA score breakdown

`volumePathScore`, `roleScore`, `projectionScore`, `fairLineScore`, `marketScore`, `dataQualityScore`, `availabilityScore`, `gameContextScore`, `contradictionPenalty`, `volatilityPenalty`, `missingDataPenalty`, `finalBestPropScore`

### Diversity (after scoring)

1. One prop per player  
2. No opposite sides on same player+line  
3. Optional `maxPerGame` cap with audit reason `hidden_due_to_cap`

---

## server.js changes

| Change | Detail |
|--------|--------|
| `allGeneratedCandidates` | Stored on each game card from `builtPicks` before `buildTopPicksForGame` cap |
| `buildTopPropsFromSelector` | Wraps `selectTopProps` |
| `refreshAllPicks` | Exposes official/test splits + `topSelectionAudit` |
| `GET /top-props` | Backward compatible + new fields |
| `GET /diagnostics` | `topPropSelectorVersion`, counts, hidden-due-to-cap |
| `SERVER_BUILD` | `courteedge-top-prop-selector-v1` |

---

## API additions (`GET /top-props`)

`topOfficialProps`, `topTestProps`, `topWNBAOfficialProps`, `topWNBATestProps`, `topSelectionAudit`, `candidateCount`, `selectedCount`, `officialCount`, `testCount`, `noBetCount`, `topPropSelectorVersion`

---

## Frontend

| File | Change |
|------|--------|
| `app/(tabs)/top-props.tsx` | Official + Test/Learning sections; no-official banner |
| `components/PropCard.tsx` | Compact WNBA v2 score/decision/confidence block |
| `services/api.ts` | Pass-through new top-props fields |

---

## Tests

```bash
node betbrain-server/scripts/testTopPropSelector.js
node betbrain-server/scripts/testWnbaOfficialV1.js
```

| Test | Assert |
|------|--------|
| WNBA reader score | High reader case beats PREMIUM tier alone |
| 5th in-game prop | Survives global rank from `allGeneratedCandidates` |
| TEST vs OFFICIAL | Split lists correct |
| NO_BET | Excluded from top props |
| NBA | `nbaTopPropScore` === `getPickScore` |
| WNBA v1 regression | `testWnbaOfficialV1.js` still passes |

---

## NBA pick generation

**Unchanged** — `buildPicksForDay` NBA loop body identical; only adds `allGeneratedCandidates` metadata and Top Props selection path.

---

## Not touched

TennisEdge, ChurchEdge, ParentEdge, KingsWayBudget, TradingEdge, `.env`, API keys, Render secrets, `eas.json`, 06/21 Lab mutation, 06/22 tracked mutation
