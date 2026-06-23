# COURTEDGE TOP PROPS LEAGUE SPLIT REPORT

**Branch:** `betbrain-v2-rebuild`  
**Date:** 2026-06-23  
**SERVER_BUILD:** `courteedge-top-prop-league-split-v1`  
**Selector version:** `top-prop-selector-v3-league-split`

---

## Goal

Top Props = **Best 2 NBA** + **Best 2 WNBA** separately (max 4 combined in `topProps` for backward compatibility). Within each league, the two picks must come from **different player teams**. No forced weak #2.

---

## Backup

| Item | Value |
|------|-------|
| Path | `betbrain-server/backups/2026-06-23T07-49-47-905Z-pre-top-prop-league-split-build/` |
| Reason | `pre-top-prop-league-split-build` |
| Files | tracked-props, daily-slate-reports, pick-history, pick-analytics, locked-slates, slate-snapshots, history-archive |

---

## Lab / 06-21 safety

| Check | Result |
|-------|--------|
| 06/21 Lab bundle | **SAFE** — `lab-bundles/2026-06-21/manifest.json`: 14 props, 5-9-0, 14 graded |
| `/clear-tracked-props` | **NOT called** |
| Runtime JSON commit | **NONE** — code-only commit |
| Lab/History mutation | **NONE** |

---

## Selector change (`topPropSelector.js`)

Per league (NBA / WNBA):

```
allGeneratedCandidates → league scorer → invalid filter → sort by bestPropScore desc
→ pick #1 highest
→ pick #2 highest where normalizeTeamKey(team) ≠ #1 teamKey
→ if no different team: return only #1 + audit noDifferentTeamCandidate
```

### Team key

`pick.teamKey || normalizeTeamKey(pick.team || pick.teamName)`

### New exports

- `selectCombinedTopProps()` — runs NBA + WNBA selectors, combines up to 4
- `normalizeTeamKey()`, `getPickTeamKey()`, `buildTopPickLabel()`

### Audit fields

`hiddenDueToSameTeam`, `hiddenDueToLeagueLimit`, `noDifferentTeamCandidate`, `selectedTeamsByLeague`, `candidateCountByLeague`, `scoredCountByLeague`, `hiddenDueToNoDifferentTeamByLeague`, `topPropTeamDiversityRequired`

### NBA behavior

NBA scoring path unchanged (`nbaTopPropScore` → `getPickScore`). Selection is now per-league with team diversity instead of global mixed pool.

---

## Config (`config.js`)

| Constant | Default |
|----------|---------|
| `NBA_TOP_PROP_LIMIT` | 2 |
| `WNBA_TOP_PROP_LIMIT` | 2 |
| `TOP_PROP_COMBINED_LIMIT` | 4 |

Env: `NBA_TOP_PROP_LIMIT`, `WNBA_TOP_PROP_LIMIT`, `TOP_PROP_COMBINED_LIMIT`

---

## API (`GET /top-props`, `GET /diagnostics`)

New/updated fields:

- `topNBAProps`, `topWNBAProps` (max 2 each, different teams)
- `topNBAOfficialProps`, `topNBATestProps`, `topWNBAOfficialProps`, `topWNBATestProps`
- `topProps` combined max 4
- `nbaTopPropLimit`, `wnbaTopPropLimit`, `topPropTeamDiversityRequired`
- `selectedTeamsByLeague`, `selectedNBA`, `selectedWNBA`
- `hiddenDueToSameTeam`, `hiddenDueToLeagueLimit`, `hiddenDueToNoDifferentTeamByLeague`
- `candidateCountByLeague`, `scoredCountByLeague`

`/tracked-props` attaches `topPickLabel`, `topPickRank`, `topPickLeague` from snapshot meta (reference only).

---

## Snapshot (`topPicksSnapshotService.js`)

Reference-only entries now include:

- `league`, `topPickLabel` (e.g. `Top WNBA #1`)
- `selectedTeamKey`, `trackedKey`, `stablePropKey`
- `referenceOnly: true`

`buildTopPicksReview()` returns:

- `nbaTopPicksReview` — NBA Top Picks Record
- `wnbaTopPicksReview` — WNBA Top Picks Record
- `vsRestOfSlate` — combined subset vs rest

---

## Frontend

| File | Change |
|------|--------|
| `app/(tabs)/top-props.tsx` | Header "Top Props"; NBA + WNBA sections; no audit clutter |
| `components/PropCard.tsx` | `topPickLabel` badge (Top NBA #1, Top WNBA #2) |
| `utils/reportBuilders.ts` | Copy: NBA section + WNBA section |
| `utils/propLabels.ts` | Results badge from `topPickLabel` |
| `app/(tabs)/prop-lab.tsx` | NBA Top Picks Record + WNBA Top Picks Record + vs rest |
| `services/api.ts` | Pass-through league-split top-props fields |

---

## Tests (15 cases)

```bash
node betbrain-server/scripts/testTopPropSelector.js   # 14/14 passed
node betbrain-server/scripts/testTopPicksLifecycle.js # 10/10 passed (covers cases 9–12)
```

| # | Case | Status |
|---|------|--------|
| 1 | WNBA max 2 | ✓ |
| 2 | NBA max 2 | ✓ |
| 3 | WNBA different teams | ✓ |
| 4 | NBA different teams | ✓ |
| 5 | Skip same-team #2, pick next different team | ✓ |
| 6 | No different team → one + `noDifferentTeamCandidate` | ✓ |
| 7 | No Official/Test balancing | ✓ |
| 8 | Leagues separated | ✓ |
| 9 | Top pick does not increase tracked count | ✓ |
| 10 | Results meta references original once | ✓ |
| 11 | Lab review references originals by league | ✓ |
| 12 | History snapshot reference-only | ✓ |
| 13 | Copy includes NBA/WNBA sections only | ✓ |
| 14 | WNBA_V2 metadata preserved | ✓ |
| 15 | NBA path protected | ✓ |

---

## Changed files (code only)

- `betbrain-server/engines/topProps/topPropSelector.js`
- `betbrain-server/engines/topProps/topPropSelectionAudit.js`
- `betbrain-server/config.js`
- `betbrain-server/server.js`
- `betbrain-server/services/topPicksSnapshotService.js`
- `betbrain-server/scripts/testTopPropSelector.js`
- `betbrain-server/scripts/testTopPicksLifecycle.js`
- `app/(tabs)/top-props.tsx`
- `app/(tabs)/prop-lab.tsx`
- `components/PropCard.tsx`
- `services/api.ts`
- `utils/reportBuilders.ts`
- `utils/propLabels.ts`

---

## Post-deploy verification checklist

### `/health` + `/diagnostics`

- `serverBuild`: `courteedge-top-prop-league-split-v1`
- `topPropSelectorVersion`: `top-prop-selector-v3-league-split`
- `nbaTopPropLimit` = 2, `wnbaTopPropLimit` = 2
- `topPropTeamDiversityRequired` = true
- `selectedTeamsByLeague` shows different teams when two selected per league

### `/top-props`

- `topNBAProps.length` ≤ 2, `topWNBAProps.length` ≤ 2
- Two NBA picks → different `selectedTeamKey`
- Two WNBA picks → different `selectedTeamKey`
- `topPicksSnapshot.picks[]` has `trackedKey`, `topPickLabel`, `referenceOnly`

### Top Props tab

- Best 2 NBA Props section
- Best 2 WNBA Props section
- Copy Top Props works (no audit/diagnostics in copy)
- Cards show Top NBA #1/#2, Top WNBA #1/#2 labels

### No duplicate tracking

- Top picks remain snapshot references only
- `addTrackedProps(..., { skipTopPickReferences: true })` unchanged
- Results/Lab/History grade original props once

---

## Not touched

TennisEdge, ChurchEdge, ParentEdge, KingsWayBudget, TradingEdge, `.env`, API keys, Render secrets, `eas.json`, 06/21 Lab data, tracked-props runtime storage (no wipe/clear)
