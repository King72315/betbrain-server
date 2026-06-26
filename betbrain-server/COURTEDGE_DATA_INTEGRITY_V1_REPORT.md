# CourtEdge Data Integrity v1 Report

**Date:** 2026-06-26  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-data-integrity-v1`

## Backup

- **Runtime:** `betbrain-server/backups/2026-06-26T04-46-29-882Z-pre-courteedge-data-integrity-v1-build`
- **Reason:** `pre-courteedge-data-integrity-v1-build`

## Root causes

1. **Team alias mismatch** — Odds/slate teams use canonical keys (`chicagosky`, `portlandfire`, `CHI`, `POR`) while Ball matchup filtering used raw `clean(opponent)` string equality on per-game opponent labels. Abbreviations and no-space uppercase forms (`PORTLANDFIRE`, `CHICAGOSKY`) did not always match.
2. **Opponent derivation fallback** — When a player's BDL team object did not match home/away keys, `normalizeStat` defaulted opponent to `home`, tagging historical games with the wrong opponent id.
3. **Player id not propagated** — WNBA `playerState.playerId` came from SportsData/fantasy maps (empty for WNBA) even when Ball search succeeded, breaking availability lookup and data-card flags.
4. **Availability wording / risk** — Missing injury feed was flagged as `availabilityDataMissing` but explicitly labeled "not treated as risk" and `availabilityRisk: false`, hiding uncertainty from reader/DI/Side Rescue.
5. **Stale cache** — No `dataIntegrityVersion` cache bust; picks retained old missing flags until full refresh.

## Azura Stevens — before / after

| Field | Before | After |
|-------|--------|-------|
| Opponent lookup | `clean("CHI")` → `chi` ≠ `chicagosky` in stats | `resolveWnbaTeamId("CHI")` → `chicagosky` bidirectional match |
| Matchup games vs CHI | 0 (false "No opponent matchup history") | Historical games where `opponentTeamId === chicagosky` included |
| `playerId` | Often empty on pick/`playerState` | Ball id + stable override (`wnbaPlayerIdResolver`) propagated |
| Availability flag | "not treated as risk" | `SOURCE_UNAVAILABLE` — uncertainty treated as risk |
| `dataIntegrity.overall` | n/a | `GOOD` / `PARTIAL` based on resolved fields |

## Alias resolver fix

New module: `engines/wnba/wnbaTeamAliasResolver.js`

- Canonical ids: `portlandfire`, `chicagosky`, …
- Accepts: display names, no-space uppercase, abbreviations (`POR`, `CHI`)
- `teamsMatch()` used in `ballService.fetchLast3VsOpponent` and `server.getOpponentFromGame`

## New modules

| Module | Purpose |
|--------|---------|
| `engines/wnba/wnbaTeamAliasResolver.js` | Canonical WNBA team ids + alias matching |
| `engines/wnba/wnbaPlayerIdResolver.js` | Stable overrides (Azura Stevens, Sydney Taylor) |
| `engines/wnba/wnbaDataIntegrityV1.js` | Per-candidate `dataIntegrity` audit object |

## API

| Endpoint | Auth | Purpose |
|----------|------|---------|
| `GET /debug/data-integrity?player=&team=&opponent=` | None | Live per-candidate audit |
| `GET /admin/data-integrity-audit` | `x-admin-secret` | Audit + optional `pickKey` cache lookup |

## `dataIntegrity` object (on `wnbaDataCard` + picks)

- `version` / `dataIntegrityVersion`: `wnba-data-integrity-v1`
- `overall`: `GOOD` | `PARTIAL` | `BAD`
- `score`, `issues[]`, `player`, `teams`, `matchup`, `availability`
- UI compact: `dataIntegrityCompact` → `Data: GOOD/PARTIAL/BAD`

## Tests run

| Suite | Count | Result |
|-------|-------|--------|
| `testWnbaTeamAliasResolver.js` | 8 | PASS |
| `testWnbaDataIntegrity.js` | 10 | PASS |
| `testMatchupHistory.js` | 8 | PASS |
| `testWnbaDataCard.js` | 6 | PASS |
| `testWnbaReaderFixes.js` | 18 | PASS |
| `testWnbaOfficialV1.js` | 6 | PASS |
| `testWnbaResultsQualityGate.js` | 18 | PASS |
| `testWnbaTrackingGateV2.js` | 40 | PASS |
| `testPropDecisionIntelligenceV1.js` | 25 | PASS |
| `testSideRescueEngineV1.js` | 30 | PASS |
| **New integrity suites subtotal** | **26** | **PASS** |

## Safety

- No `/clear-tracked-props`
- No runtime JSON committed
- Side Rescue thresholds unchanged
- Graded results not rewritten
