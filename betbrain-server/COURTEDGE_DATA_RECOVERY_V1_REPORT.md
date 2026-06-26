# CourtEdge Data Recovery v1 Report

**Date:** 2026-06-26  
**Branch:** `betbrain-v2-rebuild` (base `cac7249` data-integrity-v1)  
**SERVER_BUILD:** `courteedge-data-recovery-v1`

## Backup

- **Runtime:** `betbrain-server/backups/<timestamp>-pre-courteedge-data-recovery-v1-build`
- **Reason:** `pre-courteedge-data-recovery-v1-build`

## 6/26 12:05 AM CT snapshot — why 0/6 Best 6

**Observed (user snapshot):** 15 Board Candidates · 0 Best 6 · 0 Top Picks · 11 Board Only · 3 No Bet

| Metric | Count | Meaning |
|--------|-------|---------|
| Board Candidates | 15 | Reader produced a side (not NO_BET / not started) |
| Board Only | 11 | Passed reader but DI / Side Rescue / gate blocked Best 6 |
| No Bet | 3 | Reader or gate returned NO_BET before Best 6 |
| Best 6 | 0 | No candidate cleared full chain: integrity → reader → gate → DI → Side Rescue → Best 6 caps |

### Verdict: **primarily WEAK SLATE, with residual DATA-BLIND risk**

- **11/15 board candidates** reached the board but failed **Decision Intelligence** or **Side Rescue** (`bestSixEligibility !== true`, `trackEligibility !== TRACK`, or `sideRescue.action === BOARD_ONLY`). This is a **weak-slate / elevated-risk** pattern — data was present enough to read a side, but trust gates correctly withheld Best 6.
- **3/15** were **NO_BET** at reader or gate — thin edges, traps, or missing side support.
- **Recovery layer** targets the remaining **data-blind** cases: missing player id, alias mismatch, empty stats cache, matchup lookup failures. These do **not** lower DI/Side Rescue thresholds.

### Per-stage blocking (rejection chain)

Use live diagnostics after deploy + refresh:

```http
GET /debug/data-integrity?date=2026-06-26&league=WNBA&includeRecovery=true
```

Per-player with recovery:

```http
GET /debug/data-integrity?player=Azura%20Stevens&team=chicagosky&opponent=portlandfire&includeRecovery=true
```

Local fixture replay (`node betbrain-server/scripts/analyzeWnbaSlate0626.js`) confirms chain ordering: **dataIntegrity → reader → trackingGate → decisionIntelligence → sideRescue → Best 6**.

## New module

| Module | Purpose |
|--------|---------|
| `engines/wnba/wnbaDataRecoveryV1.js` | Classify + attempt recovery after integrity audit |
| `services/wnbaSlateRejectionAnalysis.js` | Slate-level rejection chain + 0/6 explanation |

## Recovery classifications

| Class | When |
|-------|------|
| `FIXABLE_PLAYER_ID_FAILURE` | Stable Ball ID override available |
| `FIXABLE_ALIAS_FAILURE` | Team/opponent alias not resolved |
| `FIXABLE_LOOKUP_FAILURE` | Ball search / stats fetch retry |
| `FIXABLE_CACHE_FAILURE` | Stale empty stats cache |
| `FIXABLE_DATE_RANGE_FAILURE` | Player id ok but zero games in season window |
| `FIXABLE_PARSER_FAILURE` | Normalized stat shape repair (reserved) |
| `NEEDS_FALLBACK_SOURCE` | Availability / defense alternate feed |
| `TRUE_SOURCE_UNAVAILABLE` | Market lines, irrecoverable feeds |

## `dataRecovery` object (on `dataIntegrity`)

- `attempted`, `recoveredFields`, `unrecoveredFields`, `trueUnavailableFields`
- `fallbackSourcesUsed`, `fixableFailuresFound`, `fixableFailuresResolved`
- `stillBlockingEligibility`, `wouldEligibilityImproveAfterRecovery`
- `dataRecoveryVersion`: `wnba-data-recovery-v1`

## Wiring

| Location | Change |
|----------|--------|
| `wnbaPlayerPropDataCard.js` | Runs recovery after integrity; merges recovered stats/id |
| `ballService.js` | `bustBallCachesForPlayer` for cache-bust retry |
| `server.js` | `dataRecoveryVersion` cache bust; `SERVER_BUILD` bump |
| `GET /debug/data-integrity` | `includeRecovery=true`, `date=YYYY-MM-DD` slate chain |

## Before / after recovery (local, Azura Stevens stable-id path)

| Field | Before recovery | After recovery (no API key) |
|-------|-----------------|------------------------------|
| `playerId` | empty | `42` via stable override |
| `fixableFailuresFound` | 1+ | 1 |
| `fixableFailuresResolved` | 0 | 1 (playerId) |
| Stats (last5/matchup) | empty | Still blocked without Ball API key → `FIXABLE_CACHE_FAILURE` / date range |

With live Ball API key + refresh, expect additional recovery on season avg, last5, bidirectional matchup.

## Fixable vs true unavailable (framework counts)

| Type | Source |
|------|--------|
| Fixable found | Sum of `dataRecovery.fixableFailuresFound` across slate candidates |
| Fixable resolved | Sum of `dataRecovery.fixableFailuresResolved` |
| True unavailable | Sum of `trueUnavailableFields` (market, irrecoverable feeds) |

Slate endpoint exposes aggregates: `fixableFailuresFound`, `fixableFailuresResolved`, `trueUnavailableCount`, `dataBlindVsWeakSlate`.

## Tests run

| Suite | Count | Result |
|-------|-------|--------|
| `testWnbaDataRecovery.js` | 26 | PASS |
| `testWnbaDataIntegrity.js` | 10 | PASS |
| `testSideRescueEngineV1.js` | 30 | PASS |
| `testPropDecisionIntelligenceV1.js` | 25 | PASS |
| `testControlledBestSix.js` | 29 | PASS |
| `testCourtEdgeDataFlow.js` | 50 | PASS |
| `testWnbaDataCard.js` | 6 | PASS |

## Safety

- No `/clear-tracked-props`
- No runtime JSON committed
- Side Rescue / DI thresholds unchanged
- Graded results not rewritten
