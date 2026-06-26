# CourtEdge Matchup Lookup Fix Report

**Date:** 2026-06-26  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-matchup-lookup-v1`

## Problem

Azura Stevens (`chicagosky` vs `portlandfire`, 6/26 slate) was classified `TRUE_SOURCE_UNAVAILABLE` for matchup history. Official WNBA 2026 games exist:

| Date | Matchup | Azura Stevens |
|------|---------|---------------|
| 2026-05-09 | Chicago Sky vs Portland Fire | May have DNP |
| 2026-06-24 | Portland Fire vs Chicago Sky | 11 pts (WNBA official) |

Root cause: matchup relied on **season-wide `player_stats` + local opponent filter**, which returned zero rows for this case. The correct Ball flow is **games-first**, then **`player_stats` by `game_ids[]`**. Using `team_ids[]=OPPONENT` on `player_stats` is wrong — stat rows are keyed to the **player's team** (Chicago), not Portland.

## Ball URL / Params — Before vs After

### Before (broken / incomplete)

| Step | URL pattern |
|------|-------------|
| Season stats | `GET /wnba/v1/player_stats?player_ids[]=525&seasons[]=2026&per_page=100` |
| Matchup filter | Local filter on `opponentTeamId` from normalized season rows |
| Anti-pattern (never use) | `GET /wnba/v1/player_stats?player_ids[]=525&team_ids[]=<PORTLAND_BDL_ID>&seasons[]=2026` |

No `/games` probe ran before classifying empty matchup as source-unavailable.

### After (fixed — `games-then-player_stats`)

| Step | URL pattern |
|------|-------------|
| 1. Resolve Ball numeric team IDs | `GET /wnba/v1/teams` (cached map via `resolveBallApiTeamId`) |
| 2. Player-team games | `GET /wnba/v1/games?team_ids[]=<CHICAGO_BDL_ID>&seasons[]=2026&start_date=2026-01-01&end_date=2026-06-25&per_page=100` |
| 3. Local filter | Games where home/visitor is CHI + POR (both directions) |
| 4. Player stats | `GET /wnba/v1/player_stats?player_ids[]=525&game_ids[]=<id1>&game_ids[]=<id2>&per_page=100` |
| **Not used** | `team_ids[]` on `player_stats` for opponent |

## New Matchup Classifications

| Class | Meaning |
|-------|---------|
| `PLAYER_H2H_EXISTS` | Games + player stat rows found |
| `WRONG_QUERY_KEY_SUSPECTED` | Legacy season filter empty but `game_ids` stats exist |
| `MATCHUP_GAMES_EXIST` | Team games found, filtering in progress |
| `PLAYER_DID_NOT_PLAY_IN_MATCHUP` | Matched games exist, no player stat row (e.g. May 9 DNP) |
| `BALL_GAME_LOOKUP_EMPTY` | `/games` returned no CHI/POR meetings |
| `BALL_PLAYER_STATS_EMPTY` | Games matched, stats fetch empty |
| `FALLBACK_WNBA_MATCHUP_REQUIRED` | Ball team ID map or probe incomplete |
| `TRUE_NO_PLAYER_H2H` | Games exist, player never logged a stat vs opponent |

Recovery no longer auto-maps empty matchup → `TRUE_SOURCE_UNAVAILABLE` without games probe.

## Code Changes

| File | Change |
|------|--------|
| `engines/wnba/wnbaMatchupLookupV1.js` | **NEW** — URL builders, game filter, probe classifications |
| `services/ballService.js` | `probeWnbaMatchupLookup`, games-first `fetchLast3VsOpponent` (WNBA) |
| `engines/wnba/wnbaDataIntegrityV1.js` | Matchup probe metadata, `games-then-player_stats` method |
| `engines/wnba/wnbaDataRecoveryV1.js` | Probe-driven matchup recovery classes; `TRUE_NO_PLAYER_H2H` |
| `server.js` | `SERVER_BUILD` bump; pass `playerTeam`; run probe in integrity audit |
| `scripts/probeAzuraMatchup0626.js` | Full before/after URL + probe output |
| `scripts/testMatchupHistory.js` | 14 tests — URL shape, June 24 filter, classifications |
| `scripts/testWnbaDataRecovery.js` | Updated matchup classification tests (28 pass) |

## Tests

```
node betbrain-server/scripts/testMatchupHistory.js     → 14 PASS
node betbrain-server/scripts/testWnbaDataRecovery.js   → 28 PASS
node betbrain-server/scripts/testWnbaDataIntegrity.js  → 10 PASS
```

Key assertions:

- Fixed `player_stats` URL uses `game_ids[]`, **not** opponent `team_ids[]`
- June 24 Portland/Chicago game passes `filterWnbaGamesVsOpponent`
- Azura player id `525` + June 24 game id shape validated

## Azura Probe

Run: `node betbrain-server/scripts/probeAzuraMatchup0626.js`

Expected when Ball API reachable:

- `matchedGames` includes `2026-06-24` POR/CHI
- `vsPortlandFire` includes June 24 with ~11 pts
- `classification`: `PLAYER_H2H_EXISTS` or `WRONG_QUERY_KEY_SUSPECTED` (if legacy was empty)

**Note:** Live probe from CI/sandbox hit `ECONNRESET` on Ball API during this build; unit tests cover URL logic and game filtering offline.

## Azura Stevens Specific

- Stable Ball ID: **525** (`wnbaPlayerIdResolver.js`)
- Player team for 6/26 slate: **chicagosky**
- Opponent: **portlandfire**
- June 24 game should surface in matchup history for 6/26 prop cutoff
