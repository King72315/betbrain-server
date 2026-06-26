# CourtEdge 6/26 WNBA Missing-Data Repair Report

**Date:** 2026-06-26  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD (after fixes):** `courteedge-0626-missing-data-repair-v1`  
**Prod SERVER_BUILD (audit source):** `courteedge-data-recovery-v1`  
**Slate:** 2026-06-26 WNBA — **15 board candidates** (3 games)

## Evidence sources

| Source | Result |
|--------|--------|
| `GET https://betbrain-server-1.onrender.com/picks/WNBA` (2026-06-26T05:27:28Z) | 15 candidates, `dataIntegrity` + `dataRecovery` on each |
| `GET /diagnostics` | `todayLocalDate: 2026-06-26`, `ballKeyLoaded: YES` |
| Local live re-audit | Ball API `ECONNRESET` from dev machine — **not used as primary** |
| `betbrain-server/.tmp-cached-integrity-0626.json` | Extracted prod cached integrity per candidate |

## Executive summary

**CourtEdge is not data-blind on core stats for 6/26.** After prod refresh, all 15 candidates have Ball player IDs, 5-game last5, and season averages. The slate is **PARTIAL (score 91)** on every candidate for exactly **two** still-missing fields:

1. **`matchup`** — zero head-to-head games vs **today's opponent** in the **2026 BallDontLie season window** (team aliases resolve; lookup works; source has no meetings).
2. **`availability`** — WNBA injury feed absent (`SOURCE_UNAVAILABLE`); treated as elevated risk on every prop.

Prior integrity/recovery code **misclassified matchup as `FIXABLE_LOOKUP_FAILURE`** and retry attempted recovery 15× with no possible win. **Stable player ID overrides were wrong** for Azura Stevens (`42` → correct `525`) and Sydney Taylor (`528` was **Gabby Williams'** id; correct `67033`).

**New code fixes in this pass** correct stable IDs, stop false-fixable matchup retries, and reclassify empty season head-to-head as `TRUE_SOURCE_UNAVAILABLE`.

---

## Full candidate × missing-field table

| player | team | opponent | missing field | why missing | source attempted | source response | classification | fix made | still missing | if yes why |
|--------|------|----------|---------------|-------------|------------------|-----------------|----------------|----------|---------------|------------|
| Sydney Taylor | chicagosky | portlandfire | matchup | No 2026-season head-to-head vs Portland Fire; aliases resolve (`chicagosky`↔`portlandfire`) | Ball `fetchLast3VsOpponent` bidirectional | 0 games (playerId 67033, last5=5) | TRUE_SOURCE_UNAVAILABLE | Reclassify empty H2H; stop false recovery retry | yes | Expansion opponent / no 2026 meetings in BDL |
| Sydney Taylor | chicagosky | portlandfire | availability | No WNBA injury API wired | Ball `/player_injuries` | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | Uncertainty flagged as risk (v1) | yes | No injury feed in current stack |
| Azura Stevens | chicagosky | portlandfire | matchup | No 2026-season H2H vs Portland Fire; **not** an alias bug (CHI/POR ids resolve) | Ball `fetchLast3VsOpponent` | 0 games (playerId **525**, last5=5, season 9.3) | TRUE_SOURCE_UNAVAILABLE | **Stable id 42→525**; matchup reclassify | yes | King manual history likely cross-team/pre-2026; BDL season filter is 2026 only |
| Azura Stevens | chicagosky | portlandfire | availability | No injury feed | Ball `/player_injuries` | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs alternate injury source |
| Sarah Ashlee Barker | portlandfire | chicagosky | matchup | No 2026 H2H vs Chicago Sky | Ball matchup lookup | 0 games (id 745, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Sarah Ashlee Barker | portlandfire | chicagosky | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Bridget Carleton | portlandfire | chicagosky | matchup | No 2026 H2H vs Chicago Sky | Ball matchup lookup | 0 games (id 562, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Bridget Carleton | portlandfire | chicagosky | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Megan Gustafson | portlandfire | chicagosky | matchup | No 2026 H2H vs Chicago Sky | Ball matchup lookup | 0 games (id 579, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Megan Gustafson | portlandfire | chicagosky | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Shakira Austin | washingtonmystics | connecticutsun | matchup | No 2026 H2H vs Connecticut Sun | Ball matchup lookup | 0 games (id 650, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Shakira Austin | washingtonmystics | connecticutsun | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Michaela Onyenwere | washingtonmystics | connecticutsun | matchup | No 2026 H2H vs Connecticut Sun | Ball matchup lookup | 0 games (id 615, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Michaela Onyenwere | washingtonmystics | connecticutsun | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Olivia Nelson-Ododa | connecticutsun | washingtonmystics | matchup | No 2026 H2H vs Washington Mystics | Ball matchup lookup | 0 games (id 641, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Olivia Nelson-Ododa | connecticutsun | washingtonmystics | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Sonia Citron | washingtonmystics | connecticutsun | matchup | No 2026 H2H vs Connecticut Sun | Ball matchup lookup | 0 games (id 736, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Sonia Citron | washingtonmystics | connecticutsun | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Rhyne Howard | atlantadream | goldenstatevalkyries | matchup | No 2026 H2H vs Golden State Valkyries (expansion) | Ball matchup lookup | 0 games (id 657, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | First-season franchise; no BDL history |
| Rhyne Howard | atlantadream | goldenstatevalkyries | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Allisha Gray | atlantadream | goldenstatevalkyries | matchup | No 2026 H2H vs GSV | Ball matchup lookup | 0 games (id 498, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | Expansion opponent |
| Allisha Gray | atlantadream | goldenstatevalkyries | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Gabby Williams | goldenstatevalkyries | atlantadream | matchup | No 2026 H2H vs Atlanta Dream | Ball matchup lookup | 0 games (id 528, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Gabby Williams | goldenstatevalkyries | atlantadream | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Angel Reese | atlantadream | goldenstatevalkyries | matchup | No 2026 H2H vs GSV | Ball matchup lookup | 0 games (id 721, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | Expansion opponent |
| Angel Reese | atlantadream | goldenstatevalkyries | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Veronica Burton | goldenstatevalkyries | atlantadream | matchup | No 2026 H2H vs Atlanta Dream | Ball matchup lookup | 0 games (id 659, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Veronica Burton | goldenstatevalkyries | atlantadream | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |
| Cecilia Zandalasini | goldenstatevalkyries | atlantadream | matchup | No 2026 H2H vs Atlanta Dream | Ball matchup lookup | 0 games (id 524, last5=5) | TRUE_SOURCE_UNAVAILABLE | Matchup reclassify | yes | No 2026 meetings in BDL |
| Cecilia Zandalasini | goldenstatevalkyries | atlantadream | availability | No injury feed | Ball injuries | `SOURCE_UNAVAILABLE` | NEEDS_FALLBACK_SOURCE | — | yes | Needs fallback source |

### Fields **not** missing on prod (all 15)

| Field | Prod status | Notes |
|-------|-------------|-------|
| playerId | OK | Ball search succeeded on refresh; ids 524–67033 range |
| seasonStats | OK | Season pts populated (e.g. Azura 9.33) |
| last5 | OK | 5 games each |
| team / opponent alias | OK | `wnbaTeamAliasResolver` resolves expansion teams |
| market / books | OK | Props built from odds lines |

---

## Azura Stevens trace (requested)

| Step | Before (bad stable override) | Prod 6/26 refresh | After code fix |
|------|------------------------------|-------------------|----------------|
| Player lookup | Stable `42` when search fails → wrong/empty stats | Ball id **525**, 5 last5 games | Stable **525** |
| vs `portlandfire` matchup | Flagged "No opponent matchup history" | 0 games — **aliases correct** | Classified **TRUE_SOURCE_UNAVAILABLE** (not fixable retry) |
| vs `chicagosky` | N/A (today's opp is POR) | 0 games in 2026 window | Same — cross-team history not in current-season filter |
| Availability | SOURCE_UNAVAILABLE | SOURCE_UNAVAILABLE | NEEDS_FALLBACK_SOURCE |

Root cause for Azura "no matchup" on 6/26: **opponent is Portland Fire; BDL has zero 2026-season meetings**, not a CHI alias failure. Prior v1 fix addressed CHI abbreviation bugs; today's slate opponent is different.

---

## DIRECT ANSWERS

### 1. Which data fields still missing right now?

- **`matchup`** — all 15 candidates (0 head-to-head games vs today's opponent in 2026 BDL season)
- **`availability`** — all 15 candidates (injury feed `SOURCE_UNAVAILABLE`)

### 2. Why still missing?

| Field | Root cause |
|-------|------------|
| matchup | `fetchLast3VsOpponent` runs correctly with resolved team ids; Ball API returns no games vs that opponent in `seasons[]=2026`. Expansion teams (Portland Fire, Golden State Valkyries) amplify this. |
| availability | `wnbaAvailabilityService` depends on Ball `/player_injuries`; feed empty/unavailable → `availabilityDataMissing: true`. |

### 3. Which ones actually fixed (in code)?

| Fix | File |
|-----|------|
| Azura Stevens stable id `42` → `525` | `engines/wnba/wnbaPlayerIdResolver.js` |
| Sydney Taylor stable id `528` (was Gabby Williams) → `67033` | `engines/wnba/wnbaPlayerIdResolver.js` |
| Matchup `repairable: false` when opponent team id resolves | `engines/wnba/wnbaDataIntegrityV1.js` |
| Matchup empty H2H → `TRUE_SOURCE_UNAVAILABLE` (not `FIXABLE_LOOKUP_FAILURE`) | `engines/wnba/wnbaDataRecoveryV1.js` |
| Skip recovery on `WEAK` integrity issues | `engines/wnba/wnbaDataRecoveryV1.js` |
| Build tag bump | `server.js` → `courteedge-0626-missing-data-repair-v1` |

Prior v1 fixes (already on prod): team alias resolver, opponent derivation, playerId propagation, availability-as-risk wording, data recovery wiring.

### 4. Which need live Ball API refresh to verify?

- Deploy new build + **`POST /refresh-picks`** (or wait for cache refresh) to confirm:
  - Stable-id fallback uses **525 / 67033** when search flakes
  - `dataRecovery.fixableFailuresFound` drops for matchup (no false retries)
  - `dataRecovery.classifications.matchup` = `TRUE_SOURCE_UNAVAILABLE`

### 5. Which need fallback source?

- **`availability`** — all 15 props need a WNBA injury/availability feed (ESPN, official WNBA, or paid injury API). Class: `NEEDS_FALLBACK_SOURCE`.

### 6. Which truly unavailable from current sources?

- **`matchup` vs today's opponent** — for this slate, truly empty in Ball 2026 season data (`TRUE_SOURCE_UNAVAILABLE`). Cross-season or pre-franchise history is **not** in current BDL query window.
- **`availability`** — no feed today (`NEEDS_FALLBACK_SOURCE` / functionally unavailable).

### 7. What file/code change fixes each issue?

| Issue | Fix location |
|-------|--------------|
| Wrong stable player ids | `wnbaPlayerIdResolver.js` |
| False-fixable matchup retries | `wnbaDataIntegrityV1.js`, `wnbaDataRecoveryV1.js` |
| Availability gap | New feed integration in `wnbaAvailabilityService.js` (not implemented — needs product decision) |
| Cross-season matchup | Would need `ballService.fetchLast3VsOpponent` multi-season or alternate history source (out of scope; would be `NEEDS_FALLBACK_SOURCE`) |

---

## Eligibility impact (data-caused only)

| Field | Blocks tracking gate? | On 6/26 prod |
|-------|----------------------|--------------|
| availability | **Yes** — `stillBlockingEligibility: ["availability"]` on all 15 | Elevated risk; not a stats blackout |
| matchup | No — reader/DI context | Opponent history panel empty |
| playerId / last5 / season | Would block if missing | **Present** on prod |

DI / Side Rescue / Best 6 outcomes are **not repeated here** — those gates had data sufficient to read sides; 0/6 Best 6 is not explained by missing player stats on this slate.

---

## Backup

`betbrain-server/backups/<timestamp>-pre-0626-missing-data-repair/` — copies of `wnbaPlayerIdResolver.js`, `wnbaDataIntegrityV1.js`, `wnbaDataRecoveryV1.js` before edits.

---

## Tests run (this pass)

| Suite | Result |
|-------|--------|
| `testWnbaDataRecovery.js` | **26 PASS** |
| `testWnbaDataIntegrity.js` | **10 PASS** |
| `testMatchupHistory.js` | **8 PASS** |

---

## Files changed

| File | Change |
|------|--------|
| `engines/wnba/wnbaPlayerIdResolver.js` | Correct stable BDL ids |
| `engines/wnba/wnbaDataIntegrityV1.js` | Matchup repairable only on alias failure |
| `engines/wnba/wnbaDataRecoveryV1.js` | Matchup classification + WEAK skip |
| `server.js` | SERVER_BUILD bump |
| `scripts/testWnbaDataRecovery.js` | Updated Azura id + matchup classification test |
| `scripts/auditWnbaSlate0626MissingData.js` | **New** — slate audit helper |
| `scripts/extractCachedIntegrity0626.js` | **New** — prod cache extractor |
| `scripts/probeAzuraMatchup0626.js` | **New** — Azura probe helper |

---

## Top missing fields (summary)

1. **`availability`** — 15/15 — no injury feed (`NEEDS_FALLBACK_SOURCE`)
2. **`matchup`** — 15/15 — no 2026 head-to-head in Ball API (`TRUE_SOURCE_UNAVAILABLE`)
3. **~~playerId~~** — fixed on prod refresh; stable overrides corrected for offline fallback
4. **~~seasonStats / last5~~** — present on prod after refresh

**Report path:** `betbrain-server/COURTEDGE_0626_MISSING_DATA_REPAIR_REPORT.md`
