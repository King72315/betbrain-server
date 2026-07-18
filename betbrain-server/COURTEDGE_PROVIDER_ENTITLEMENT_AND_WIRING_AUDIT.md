# CourtEdge Provider Entitlement And Wiring Audit

**Date:** 2026-07-18  
**Branch:** `betbrain-v2-rebuild`  
**Probe script:** `scripts/probeProviderEntitlements.js`  
**Fixtures:** `test-fixtures/provider-entitlements/`  
**Summary JSON:** `.tmp-provider-entitlement-probe.json`

## Phase 0 baseline

| Check | Result |
|--------|--------|
| Branch | `betbrain-v2-rebuild` |
| Prior SERVER_BUILD | `courteedge-lifecycle-stale-sealed-v1` |
| Lifecycle commits | Present (`2dbceae`, `1d06567`) |
| Keys in `.env` | Not modified |
| Sealed Jul 17 | Not cleared / not rewritten |
| Prod recovery `--apply` | Not run |

## Key loaded (stage 1)

| Provider | Local | Prod `/health` |
|----------|-------|----------------|
| ODDS_KEY | YES | YES |
| BALLDONTLIE_KEY | YES | YES |
| SPORTS_KEY | YES | YES |

A loaded key is **not** proof of entitlement.

## Entitlement matrix (stages 2–4)

### A. The Odds API

| Endpoint | HTTP | Authorized | Rows | Used in generation | Notes |
|----------|------|------------|------|--------------------|-------|
| NBA events | 200 | yes | 0 | yes (when season active) | Offseason empty on probe date |
| NBA player_points | skipped | — | — | yes | No event id |
| WNBA events | 200 | yes | 5 | yes | commence_time, teams, event id |
| WNBA player_points | 200 | yes | books present | **VERIFIED_AND_USED** | Over/Under prices, bookmakers |

**Opening historical lines:** Not confirmed on current plan → keep internal market snapshots.

### B. BallDontLie

| Endpoint | League | HTTP | Authorized | Rows | Generation use |
|----------|--------|------|------------|------|----------------|
| /teams | WNBA | 200 | yes | 35 | identity / defense proxy |
| /teams | NBA | 200 | yes | 45 | identity |
| team_season_averages | WNBA | **404** | **no** | — | **UNAUTHORIZED / UNAVAILABLE** — do not wire |
| players search | WNBA | 200 | yes | 1+ | identity |
| player_stats | WNBA | 200 | yes | sample 5 | form / minutes / FGA / FTA |
| player_injuries | WNBA | 200 | yes | 25 | availability |
| /injuries alt | WNBA | 404 | no | — | dead path |
| games by team | WNBA | 200* | yes | finals | **defense/pace proxy** |

\*Verified via live probe. BDL WNBA games use `status: "post"` and `home_score`/`away_score` (not NBA-style `final` / `home_team_score`). Defense V2 normalizes both shapes.

**WNBA team season averages for PPG allowed / pace / ratings:** **Not available** (404).  
Derive defense from recent final games only, labeled as proxy.

### C. SportsDataIO

| Endpoint | HTTP | Authorized | Scrambled? | Generation use |
|----------|------|------------|------------|----------------|
| WNBA scores/Teams | **401** | **no** | n/a | **Do not enable** |
| WNBA scores/Players | **401** | **no** | n/a | **Do not enable** |
| WNBA stats/Players | 404 | no | n/a | dead |
| WNBA projections paths | 404 | no | n/a | dead |
| NBA fantasy Players | 200 | yes | no | NBA secondary OK |
| NBA PlayerGameProjectionStatsByDate | 200 | yes | empty slate OK | NBA vendor projection |
| NBA TeamSeasonStats | **401** | **no** | n/a | unavailable |

**Verdict:** `COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED` must stay **false**.

### D. ESPN

Grading / verification fallback only. Not used as primary projection engine.

## Pipeline field map (high-signal)

| Field | Classification |
|-------|----------------|
| Odds event id / commence / line / books | VERIFIED_AND_USED |
| BDL player id / game logs / season avg | VERIFIED_AND_USED |
| BDL injuries | VERIFIED_AND_USED |
| BDL team_season_averages | UNAUTHORIZED (404) |
| SportsData WNBA anything | UNAUTHORIZED (401) |
| SportsData NBA fantasy projections | VERIFIED_AND_USED (NBA) |
| WNBA defenseScore default 50 | **DEAD_PATH removed** → UNAVAILABLE or CALCULATED |
| WNBA pace official | UNAVAILABLE |
| WNBA pace game-total proxy | DERIVABLE → wired as `paceProxy` |
| Player-vs-opponent logs | PARTIALLY_WIRED (BDL filter; zero sample = null) |
| Evidence bundle | NEW → `courtEdgePlayerEvidenceV1` |
| Identity cross-provider | NEW → `provider-identity-v1` |

### Silent defaults previously found

| Symptom | Fix |
|---------|-----|
| `defenseScore: 50` + source default | null + `status: UNAVAILABLE` |
| Calculated score equals 50 | `CALCULATED_NEUTRAL` (valid data) |
| Reader Under vote from missing defense | Skipped when unavailable |
| Graduated audit forcing resolved 50 | resolved null when unavailable |
| Coverage implying complete | Evidence `coveragePct` / `fakeCompleteCoverage: false` |

## Safe implementations shipped

1. `wnbaOpponentContextService` — defense V2 games proxy, no fake 50  
2. `courtEdgePlayerEvidenceV1` — versioned evidence on WNBA v2 picks + canonical seal  
3. `providerIdentityLayer` — ID-first joins; refuse weak fuzzy  
4. `providerFallbackPolicy` — explicit priority matrix  
5. Feature flags in `config.js` (see below)  
6. Diagnostics `/health` + `/diagnostics` providerHealth  
7. Fixtures + probe script + replay dry-run (analysis only)

## Feature flags

| Flag | Default | Recommended after deploy |
|------|---------|--------------------------|
| `COURTEDGE_EVIDENCE_V1_ENABLED` | ON | ON |
| `COURTEDGE_WNBA_DEFENSE_V2_ENABLED` | ON | ON |
| `COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED` | OFF | OFF until 200 entitlement |
| `COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED` | OFF | OFF until replay review |

## Projection weights

**Not changed in production.** Calibration V2 flag remains off. Replay script packages evidence honesty only.

## What was not wired (intentionally)

- SportsData WNBA generation  
- BDL `team_season_averages`  
- Automatic live weight changes  
- Jul 17 recovery `--apply`  
- Sealed history rewrites  

## SERVER_BUILD

`courteedge-evidence-defense-v1`
