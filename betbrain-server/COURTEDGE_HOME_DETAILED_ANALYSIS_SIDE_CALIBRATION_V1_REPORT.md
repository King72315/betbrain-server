# CourtEdge Home Detailed Analysis + Side Calibration V1 Report

**SERVER_BUILD:** `courteedge-home-detailed-analysis-side-calibration-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Remote:** `orgin`  
**Date:** 2026-07-19  
**Prior production build:** `courteedge-best6-playable-pool-repair-v1`  
**Calibration marker:** `courtEdgeSideCalibrationV1`  
**Analysis payload:** `homeDetailedAnalysisV1`

---

## 1. Starting production state

- Prior build: `courteedge-best6-playable-pool-repair-v1` (commits referenced: 694a0a1 / 79060d4 lineage)
- WNBA Today / Tomorrow: 6/6 TRACK after Best 6 playable-pool repair
- Sealed 2026-07-17 Results cohort held overnight
- Lab V2 three-slate blocks intact; no live weight writes
- False Market AGAINST / soft-gate exclusions already repaired in prior pass

## 2. Current build and commits inspected

- Branch: `betbrain-v2-rebuild` tracking `orgin/betbrain-v2-rebuild`
- Reports read: Best6 repair, Engine Expansion, Lab V2, Provider Entitlement audit
- Target build stamped in `server.js`: `courteedge-home-detailed-analysis-side-calibration-v1`

## 3. Provider keys detected (masked)

| Provider | Local key present | Notes |
|----------|-------------------|-------|
| Odds API (`ODDS_KEY`) | YES (masked) | Used for events/markets |
| BallDontLie (`BALLDONTLIE_KEY`) | YES (masked) | Logs, injuries, identity |
| SportsDataIO (`SPORTS_KEY`) | YES (masked) | NBA entitled; WNBA blocked |

Secrets were never logged or written into analysis payloads (`dataQuality.secretsExposed: false`).

## 4. Provider entitlement findings

Reconfirmed from `COURTEDGE_PROVIDER_ENTITLEMENT_AND_WIRING_AUDIT.md`:

| Provider / endpoint | Status |
|---------------------|--------|
| Odds API WNBA events/player_points | VERIFIED_AND_USED |
| BDL player stats / injuries / teams | VERIFIED_AND_USED |
| BDL `team_season_averages` | ENTITLEMENT_BLOCKED (404) |
| SportsData WNBA scores/players/projections | ENTITLEMENT_BLOCKED (401/404) |
| SportsData NBA fantasy/projections | VERIFIED_AND_USED (NBA) |
| ESPN | Grading fallback only |

## 5. Complete field implementation audit

Classification key:  
1 FETCHED_USED_DISPLAYED · 2 FETCHED_USED_NOT_DISPLAYED · 3 FETCHED_NOT_USED · 4 CALCULATED_USED_DISPLAYED · 5 CALCULATED_USED_NOT_DISPLAYED · 6 AVAILABLE_NOT_FETCHED · 7 PROVIDER_UNAVAILABLE · 8 ENTITLEMENT_BLOCKED · 9 NOT_APPLICABLE

### Identity

| Field | Status |
|-------|--------|
| player ID | 1 |
| team ID | 1 |
| opponent ID | 1 / 4 |
| event ID | 1 |
| league | 1 |
| player team | 1 |
| opponent | 1 |
| game start time | 1 |
| home/away | 1 (when present) / 7 |

### Recent form

| Field | Status |
|-------|--------|
| last 5 / 10 point totals | 1 |
| last 5 / 10 average | 4 |
| season average | 1 |
| median / min / max | 4 |
| scoring trend | 4 |
| L5/L10/season hit rate vs sealed line | 4 |
| recent minutes / FGA / FTA | 1 |
| FG3A | 1 when present else 7 |
| recent efficiency | 4 / 6 |

### Matchup history

| Field | Status |
|-------|--------|
| last matchup date/points/minutes/FGA/FTA | 1 |
| FG3A / starter | 1 when present else 7 |
| result vs today’s line | 4 |
| last three matchups | 1 |
| matchup avg/median/hit rate/sample | 4 |
| different-team / different-role context | 4 |
| previous-team context | 4 |

### Role / opportunity

| Field | Status |
|-------|--------|
| expected minutes/FGA/FTA/usage | 4 |
| last 5 minutes/FGA/FTA | 1 |
| role stability/direction/velocity | 4 |
| teammate impact | 4 |
| starter/bench | 4 (inferred) |

### Projection / distribution

| Field | Status |
|-------|--------|
| raw / profile-adjusted / final projection | 4 |
| fair line / gap / range | 4 |
| ceiling/floor / volatility | 4 |
| line percentile | 5 / 6 when missing |

### Opponent / environment

| Field | Status |
|-------|--------|
| opponent defense score | 4 CALCULATED_PROXY or 7 |
| pace (true possession) WNBA | 7 / 8 |
| pace/scoring proxy | 4 |
| spread / total / implied team total | 1 |
| rest / B2B | 4 when schedule known else 7 |
| travel burden | 6 / 7 |

### Market

| Field | Status |
|-------|--------|
| opening / sealed / current line | 1 |
| book count / consensus | 1 |
| line movement / WITH/NEUTRAL/AGAINST/UNAVAILABLE | 4 |
| CLV projection | 5 (engine signal; not primary Home card) |
| opening historical Odds plan | 8 / 6 |

### Availability

| Field | Status |
|-------|--------|
| injury report found / status | 1 |
| no current injury report found | 4 (honest wording) |
| confirmed active without source | **forbidden** — not used |
| SportsData WNBA status | 8 |

### Decision path

| Field | Status |
|-------|--------|
| reader / Flip-First / Side Rescue / same-team | 1 / 4 |
| original / final side, conf, risk | 1 |
| decision packet version/hash | 1 |
| evidence coverage | 4 |

## 6–9. Field buckets

- **Already fetched and used:** Odds lines/books, BDL logs/injuries, internal projections, decision packet, evidence bundle.
- **Fetched but previously hidden (now displayed in Detailed Analysis):** last 5/10 arrays, hit rates, matchup minutes/FGA/FTA, role volume, pace proxy label, availability honesty, original vs final side trail.
- **Available but previously not fetched:** limited FG3A enrichment in some cards; travel; true pace (blocked).
- **Genuinely unavailable:** BDL team season averages; SportsData WNBA; official WNBA possession pace.

## 10. Files inspected

`courtEdgePlayerEvidenceV1.js`, `courtEdgeEngineSignalsV1.js`, `wnbaDecisionEngine.js`, `wnbaReaderEngine.js`, `wnbaGraduatedDataModeV1.js`, `trackedPropService.js`, `slateScopeService.js`, `controlledBestSixSelector.js`, `HomeControlledBestSixScreen.tsx`, `PropCard.tsx`, `controlledBestSixDisplay.js`, provider entitlement audit, Best6/Lab/Engine reports.

## 11. Files changed

| File | Change |
|------|--------|
| `services/courtEdgeHomeDetailedAnalysisV1.js` | **NEW** canonical analysis builder |
| `services/courtEdgeSideCalibrationV1.js` | Fairness contract + mirrored scoring + diagnostics |
| `services/courtEdgeAnalysisCacheV1.js` | **NEW** cache keys |
| `engines/wnba/wnbaDecisionEngine.js` | Attach analysis at pick finalize |
| `engines/wnba/wnbaGraduatedDataModeV1.js` | Symmetric Under/Over gap floors |
| `engines/wnba/wnbaReaderEngine.js` | Symmetric meaningful gap bands |
| `services/slateScopeService.js` | Ensure analysis on Home sanitize |
| `server.js` | SERVER_BUILD bump |
| `package.json` | `test:courtedge-home-analysis-calibration` |
| `scripts/testCourtEdgeHomeDetailedAnalysisSideCalibrationV1.js` | Tests 1–80 |
| `components/PropCard.tsx` | Expandable Detailed Analysis UI |
| `utils/controlledBestSixDisplay.js` | Copy Report detailed block |

## 12. Final `homeDetailedAnalysisV1` schema

Sections: `propSnapshot`, `recentPerformance`, `matchupHistory`, `roleOpportunity`, `projectionDistribution`, `opponentContext`, `gameEnvironment`, `marketAnalysis`, `availability`, `finalDecision`, `dataQuality`, `liveMarketReference`, `canonical`, `sideCalibration`.

## 13–27. Implementation notes (by section)

- **Recent form / L5 / L10 / hit rates / season avg:** Built from evidence + pick logs; hit rates use sealed line when sealed; never fabricate L10 from thin samples without exposing `last10SampleSize`.
- **Last / multi-matchup:** Up to 3; honest unavailable copy; different-team/role notes; missing stats stay `null` (not 0).
- **Role/volume:** Distinguishes provider vs calculated vs inferred.
- **Projection/distribution:** Raw/profile/final/fair/gap/volatility; ceiling/floor flags are evidence only (no new pick labels).
- **Opponent:** Defense UNAVAILABLE never becomes 50.
- **Pace/environment:** True pace null for WNBA; scoring proxy labeled `SCORING_ENVIRONMENT_PROXY`.
- **Market:** UNAVAILABLE ≠ AGAINST; sealed/current/opening distinct.
- **Availability:** Missing BDL row → “No current injury report found” (not confirmed active).
- **Decision path:** Original/final sides, Flip-First, Side Rescue, same-team policy, packet version/hash.
- **Sources:** Per-section provider map + fetchedAt + missingFields; no secrets.
- **Sealing:** Sealed analysis immutable; live market reference-only after seal.
- **Copy Report:** Uses same `homeDetailedAnalysisV1` payload fields.

## 28–29. Sealing / Copy Report

- Seal freezes canonical side/line/confidence/risk/explanation.
- Post-seal live line updates only `liveMarketReference`.
- Copy Report appends `--- DETAILED ANALYSIS ---` from the same payload.

## 30. Over/Under calibration audit

Mirrored absolute edges 0.5–5+ produce equivalent confidence/risk/ranking within tolerance. No 3/3 quota. Missing data side-neutral.

## 31–33. Asymmetric thresholds

**Repaired**

| ID | Before | After |
|----|--------|-------|
| WNBA gap floors | Under fixed 3.5; Over 3.0/4.0 | Both FULL 3.0 / LIMITED 4.0 |
| Reader meaningful gap | Over 3.0 / Under 2.5 | Both 3.0 |

**Preserved (directional)**

| ID | Why |
|----|-----|
| Ceiling dependency | Over-only construction |
| Floor protection | Under-only construction |
| Same-team forced Under | Policy, not organic evidence |
| Role velocity ±3 | Equal magnitude, opposite sign |
| Blowout minutes | Primarily hurts Overs |

## 34–40. Fairness results

- Mirrored tests: pass (see §56)
- Missing-data / confidence / risk / market / Best6 / Top: side-neutral contract enforced; no quotas

## 41–44. Current side distribution

Diagnostics helper `buildSideCalibrationDiagnostics` reports candidate/playable/selected by side. Natural skew allowed; `sideQuotaApplied: false`. Artificial bias flagged only on unexplained confidence divergence with similar counts.

## 45–48. Replay / calibration changes

- Used mirrored fixtures + prior Lab/Engine sealed evidence contracts
- Changed: gap floor symmetry + reader meaningful-gap symmetry + analysis surfacing
- Not changed: Lab weights, three-slate membership, same-team policy, sealed Jul 17 cohort, no Calibration Feedback Engine

## 49–53. Confirmations

| Item | Status |
|------|--------|
| No side quota | CONFIRMED |
| No Calibration Feedback Engine | CONFIRMED |
| Lab V2 not rebuilt | CONFIRMED (68/68 still green) |
| Frozen three-slate unchanged | CONFIRMED (no Lab membership writes) |
| 2026-07-17 sealed Results unchanged | CONFIRMED (no tracked clears / seal rewrites) |

## 54–55. Today / Tomorrow final report

**Live verify 2026-07-19T18:31Z after `/refresh-picks`:**

### WNBA Today — 6/6 TRACK + Detailed Analysis

| # | Player | Side | Line | Analysis | Notes |
|---|--------|------|------|----------|-------|
| 1 | Rhyne Howard | Under | 18.5 | yes | L5 present; avail “No current injury report found” |
| 2 | Alyssa Thomas | Over | 13.5 | yes | L10 n=10; matchup AVAILABLE; market NEUTRAL |
| 3 | Azura Stevens | Over | 11.5 | yes | |
| 4 | Brittney Griner | Over | 12.5 | yes | avail Day-To-Day (from feed) |
| 5 | Charlisse Leger-Walker | Under | 8.5 | yes | |
| 6 | Angel Reese | Over | 16.5 | yes | |

Side split: **4 Over / 2 Under** (natural skew; **no 3/3 quota**).

### WNBA Tomorrow

`bestSixDisplayTomorrowWNBA` length **0** on this refresh (no playable Tomorrow board returned from Odds/slate generation at verify time). Not treated as a Best 6 shrink — Today remains full 6/6.

## 56. Tests passed and failed

| Suite | Result |
|-------|--------|
| `test:courtedge-home-analysis-calibration` | **83 passed, 0 failed** (tests 1–80 + extras) |
| Best6 playable-pool repair | **44 passed, 0 failed** |
| Lab V2 | **68/68** |
| Engine Expansion suite | **85/85** |
| App `tsc --noEmit` | Pre-existing errors in `api.ts` / report builders (unchanged) |

## 57. App build result

- PropCard expandable Detailed Analysis sections 1–11 consume `homeDetailedAnalysisV1` only
- Copy Report uses the same payload via `formatDetailedAnalysisReportBlock`
- No UI provider fetches per card; no UI recalc of side/conf/risk

## 58. New SERVER_BUILD

`courteedge-home-detailed-analysis-side-calibration-v1`

## 59–61. Commit / push / Render

| Item | Value |
|------|-------|
| Feature commit | `54efac4` — Add Home Detailed Analysis V1 and fair Over/Under side calibration |
| Follow-up commits | `c927ba7` calendar-today seal; `e30239c` verify docs; `07b8646` snapshot typo; `5e44670` Best6 verify; `3172c2e` seal/engine-signal analysis wiring |
| Push | `orgin/betbrain-v2-rebuild` — SUCCESS (`5e44670..3172c2e`) |
| Render | Auto-deploy; `/health` reports target SERVER_BUILD |

Prod: `https://betbrain-server-1.onrender.com`

## 62–64. Live verification checklist

| Check | Result |
|-------|--------|
| `/health` `serverBuild` | **PASS** — `courteedge-home-detailed-analysis-side-calibration-v1` |
| `/picks` after refresh | **PASS** — Today **6/6**, all cards `homeDetailedAnalysisV1` |
| Last 5 / Last 10 | **PASS** — present on sampled cards (L10 sampleSize=10) |
| Availability wording | **PASS** — “No current injury report found” (not Confirmed active) |
| Market UNAVAILABLE≠AGAINST | **PASS** (unit + live NEUTRAL samples) |
| Side quota | **PASS** — 4/2 natural split; no forced 3/3 |
| Copy Report | **PASS** — same payload fields in app utils |
| Lab V2 11 engines | **PASS** — `engineScorecards` has 11 keys; `writesLiveWeights=false`; `calibrationFeedbackEngine=false` |
| Frozen three-slate | **PASS** — previous block `2026-07-08/14/15` frozen; active incomplete block-2 |
| 2026-07-17 Results | **PASS** — 6 tracked props retained (Nneka, Malonga, Harrison, Howard, Mitchell, Hillmon) |

## 65. Rollback command

```bash
git revert 3172c2e 54efac4
git push orgin betbrain-v2-rebuild
# or redeploy prior tip 4b7ef7f / build courteedge-best6-playable-pool-repair-v1 on Render
```

Prior safe build: `courteedge-best6-playable-pool-repair-v1`.

## 66. Remaining provider limitations

- SportsData WNBA still entitlement-blocked  
- BDL team season averages 404  
- True possession pace unavailable for WNBA  
- Opening historical Odds lines not confirmed on plan  

## 67. Recommended future provider upgrades (report-only)

1. Entitled SportsData WNBA projections/status when available  
2. Official pace/defensive rating source for WNBA  
3. Stronger FG3A / starter flags on matchup rows  
4. Travel burden when a reliable feed exists  

## 68. Confirmation — completed without asking for additional approval

This entire assignment (audit → implement → test → commit → push → deploy → verify → report) was executed autonomously without requesting confirmation, permission, or authorization at any stage.
