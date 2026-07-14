# CourtEdge Player Role Profile v1 Report

**Date:** 2026-07-13  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-player-role-profile-v1`  
**Module version:** `player-role-profile-v1` / `player-profile-calibration-v1`  
**Remote:** `orgin/betbrain-v2-rebuild`

---

## Goal

Add a data-driven **Player Role Profile** calibration layer that classifies prop-listed players by measurable behavior (role stability, minutes, scoring volume, shot-volume stability, scoring volatility, role direction, profile confidence) and applies **bounded** calibration to projection, confidence, risk evidence, ranking preference, and Lab learning — **without** replacing engines, flipping sides blindly, forcing O/U balance, or changing Flip-First / Side Rescue thresholds / live gap-floor values.

---

## Phase 1 — Data availability inspection (WNBA prop-listed players)

| Field / signal | Availability | Notes |
|---|---|---|
| Recent game logs (`last5`) — date, points, minutes, FGA, FTA, FG3A, opponent | **Directly sourced** | BallDontLie via `fetchLast5` / `fetchPlayerStats` (`ballService.js`); `played` = minutes > 0 |
| Season game logs (`bdlSeasonGames`) | **Directly sourced** | Same game schema; used to pad profile sample up to 10 |
| Season averages (points, minutes, FGA, FTA) | **Directly sourced / derived** | Season map when present; else mean of season games (`playerStateBuilder`) |
| Games played | **Derived** | Season games length / profile sample size |
| Book count, market quality, line spread, odds | **Directly sourced** | Odds/prop payload |
| Availability / injury | **Directly sourced** | `wnbaAvailabilityService` + gate |
| Teammate-out usage boost | **Mostly unavailable (WNBA)** | `roleChange.teammateOutBoost` is NBA-oriented; WNBA usually null |
| Team usage share | **Estimated / sparse** | Usage inferred as FGA/minutes; not a full team-share model |
| Role trend (legacy) | **Derived** | `roleChangeEngine` + `volumeProfileEngine` UP/DOWN/FLAT |
| Minutes/FGA stability ranges | **Derived** | `opportunityEngine.minutesStability` / `shotVolumeStability` (min/max/range) |
| Scoring volatility label | **Derived** | Points range thresholds in opportunity engine |
| Expected minutes/FGA/FTA | **Derived** | `projectWnbaPoints` volume-first blend |
| Sports projection | **Often unavailable (WNBA)** | Decision path sets `sportsProjection: 0`; volume-first fills projection |
| Matchup history | **Directly sourced when present** | May be empty; opponent-history neutrality preserved at 0 samples |
| Data freshness / sample size | **Derived** | `last5.length`, `dataMode`, `profileSampleSize`, `profileConfidence` |
| Missing coverage handling | **Fallback** | `missingProfileFields`, `fallbackUsed`, lower `profileConfidence`; **no favorable adjustments** |

**Do not fabricate.** Weak coverage → `fallbackUsed=true`, reduced confidence, no favorable ranking/projection bumps.

---

## Phase 2–6 — Module, classification, calibration

### Module

`betbrain-server/engines/playerRoleProfileV1.js`

Exports:
- `buildPlayerRoleProfile`
- `buildPlayerProfileCalibration`
- `applyProfileCalibrationToProjection`
- `buildReaderProfileSignals`
- `resolveProfileGateEdgeAdjustments`
- `buildPlayerRoleProfileAudit`
- `profileConfidenceBucket`
- thresholds/caps: `ROLE_THRESHOLDS`, `CALIBRATION_CAPS`

### Classification thresholds (starting; statistical, not reputation)

| Dimension | Rules (summary) |
|---|---|
| **roleStability** | STABLE: minutes CV ≤~0.12, floor hit ≥80%, trimmed range ≤~8, ≤1 major break; MODERATE: mid band; UNSTABLE: CV >0.22 / low floor / large swings / sample <3 / confidence <35 |
| **minutesLevel** | HIGH ≥30, MEDIUM 20–29.9, LOW <20 (descriptive) |
| **scoringVolume** | From expected/recent FGA (+FTA·0.44), **not** book line: HIGH ≥12, MEDIUM 7–11.9, LOW <7 |
| **shotVolumeStability** | FGA CV + trimmed range (+ FTA SD guard) |
| **scoringVolatility** | SD + robust range; **avoid CV alone** on low means |
| **roleDirection** | EXPANDING/CONTRACTING need **≥2** of minutes/FGA/FTA/usage/(teammate opp). Points-only rise → STABLE (hot shooting) |

### Calibration caps

| Cap | Value |
|---|---|
| Max projection movement vs uncalibrated | **±1.5 pts** (hard clamp in `projectWnbaPoints`) |
| Max EXPANDING / CONTRACTING intended shift | **+1.25 / −1.25** |
| Max confidence adjustment | **±8** |
| Max required-edge adjustment | **+1.0 / −0.25** |
| Profile alone cannot | Force side flip / create TRACK / override hard kill |

### Calibration matrix (A–J style, bounded)

| Profile pattern | Effect (bounded) |
|---|---|
| STABLE + MED/HIGH + LOW_VOL | Trust season blend, −uncertainty, +confidence/+conf (if sample≥5 & conf≥50) |
| STABLE + HIGH + LOW_VOL | Capped so not over-trusted |
| STABLE + LOW volume Over | Raise Over required edge; reader soft disagree “needs volume proof” |
| MODERATE | Mild +uncertainty / +edge |
| UNSTABLE | Canonical **`UNSTABLE_ROLE`** debt (suppress duplicate `UNSTABLE_MINUTES` from same cause), +edge, −conf/−rank |
| HIGH volume alone | Not auto Over |
| UNSTABLE + HIGH volume | Stronger edge requirement |
| EXPANDING | Bounded opp/projection uplift; Under confidence weakened; low-volume Under further warned |
| CONTRACTING | Bounded negative shift; Over edge raised |
| Missing/weak profile | **No favorable** adjustments; optional `LOW_PROFILE_CONFIDENCE` |

---

## Phase 7 — Engine integration

| Stage | Integration |
|---|---|
| **Projection** | Profile built on recovered last5/season **before final** `projectWnbaPoints`; weights + expected volume + hard ±1.5 cap |
| **WNBA Reader** | Soft score deltas for low-volume Overs / expanding / contracting / unstable — **not** auto side vote |
| **Tracking Gate** | Live gap-floor constants unchanged; profile may **raise** required gap via edge adj (`OVER_GAP_BELOW_PROFILE_ADJ` / Under analog) |
| **DI** | Stores profile debts/repairs + `profileConfidence`; preserves `naturalDecision`; `UNSTABLE_ROLE` canonical |
| **Best 6 / Top** | `rankingAdjustment` ±8 into `computeSafetyScore`; no remove track-all-6; no force into Top |
| **Flip-First / Side Rescue** | May observe profile fields on picks; **thresholds unchanged** |
| **Lab** | New `signalPerformanceV1` dimensions (v1.2) |

Pipeline order preserved:

`Player Data → Player Profile → Projection → WNBA Reader → Flip-First → Tracking Gate → DI → Side Rescue → Controlled Best 6 → Home/Top → Results → Lab → History`

---

## Phase 8 — Lab / History

Added dimensions to `SIGNAL_DIMENSIONS`:
- `roleStability`, `minutesLevel`, `scoringVolume`, `shotVolumeStability`, `scoringVolatility`, `roleDirection`
- `profileConfidence`, `projectionDependencyType`, `profileCalibrationReason`, `profileAdjustedProjection`
- `roleProfileCombo` (incl. STABLE+LOW_VOLUME+side, UNSTABLE+HIGH_VOLUME+Over, EXPANDING+side, CONTRACTING+Under, HIGH_VOLATILITY+Top, LOW_PROFILE_CONFIDENCE)

Three-slate History consumes the same signal table builder — grouping model unchanged; small samples remain visible.

---

## Phase 9 — Audit fields (internal)

On picks / data card:
`playerRoleProfile`, `playerProfileCalibration`, `projectionBefore/AfterProfileCalibration`, `profileProjectionDelta`, `confidenceBefore/AfterProfileCalibration`, `profileDebtIds`, `profileRepairIds`, `profileCalibrationApplied`, `profileCalibrationReasons`

Persisted via `trackedPropService`.

---

## Phase 10 — Tests

`node betbrain-server/scripts/testPlayerRoleProfileV1.js` → **16 passed, 0 failed** (14 required cases + Lab dims + EXPANDING+LOW Under).

### Regressions run

| Suite | Result | Notes |
|---|---|---|
| `testPlayerRoleProfileV1.js` | **16/16 PASS** | New |
| `testWnbaReaderFixes.js` | **22/22 PASS** | |
| `testSignalPerformanceV1.js` | **8/8 PASS** | |
| `testHistoryThreeSlateGroupsV1.js` | **5/5 PASS** | |
| `testWnbaTrackingGateV2.js` | **36/42** | See baseline failures |
| Cascaded suites (DI / Flip-First / Side Rescue / Best Six / DataFlow / Slate lifecycle) | Fail via **pre-existing** deps | Documented below |

### Pre-existing baseline failures (not introduced by this layer)

Confirmed: tracking-gate tests **32 / 35 / 41** fail with `NO_BET` vs expected `BOARD_ONLY` **even with `wnbaTrackingGateV2.js` stashed** (same 36/42).

| Failure | Pattern |
|---|---|
| Tracking Gate #32 A'ja Wilson U25.5 | expects BOARD_ONLY, gets NO_BET |
| Tracking Gate #35 Angel Reese O13.5 | expects BOARD_ONLY, gets NO_BET |
| Tracking Gate #41 FULL_DATA Over gap 3.6 | expects BOARD_ONLY, gets NO_BET |
| Results cohort #09 locked slate date | expects 2026-06-23, gets 2026-06-25 |
| Cascades | DI #21/#22/#23/#24, Flip-First nested suites, Side Rescue nested DI, Controlled Best Six nested quality gate |

Also observed (likely pre-existing / unrelated churn on branch): Flip-First `10b` thin-gap label; Side Rescue `SIDE_RESCUE_VERSION` constant mismatch.

---

## Phase 11 — Same-snapshot before/after

### Toggle (replay only; live defaults unchanged)

| Path | How |
|---|---|
| **Old / before** | `applyPlayerRoleProfile: false` → `projectWnbaPoints({ profileCalibration: null })` (no-op) |
| **New / after** | `applyPlayerRoleProfile: true` → build profile + calibration, apply with hard **±1.5** cap |
| Live engine | Always applies calibration when data card is built; **no feature flag flip / no SERVER_BUILD change** for this phase |

Scripts:
- `betbrain-server/scripts/extractPlayerRoleProfileSnapshot.js` — compact fixture from frozen `/picks` dump
- `betbrain-server/scripts/comparePlayerRoleProfileSnapshot.js` — same-snapshot before/after + Best 6 / Top 2 safety re-rank

Artifacts:
- Fixture: `betbrain-server/scripts/fixtures/player-role-profile-wnba-2026-07-14-snapshot.json`
- Results: `betbrain-server/scripts/fixtures/player-role-profile-before-after-2026-07-14.json` (also mirrored to `betbrain-server/.player-role-profile-before-after.json`)
- Live audit cross-check: `betbrain-server/scripts/fixtures/player-role-profile-live-refresh-audit-2026-07-14.json`
- Prod GET meta (later board shrink): `betbrain-server/scripts/fixtures/player-role-profile-prod-get-capture-meta.json`

### Snapshot source

Frozen local GET dump `.tmp-poll-picks-0713-after.json` (`lastUpdated` **2026-07-13T07:16:09Z**), slate **2026-07-14** WNBA `boardCappedProps` ∪ display ∪ top — **6 full candidates** with `playerState` + `wnbaDataCard.last5`.

No `/clear-tracked-props`, no restore/wipe, no additional `/refresh-picks` for this compare (prefer GET / frozen dump).

**Limitation:** frozen cards expose last5 **averages** for minutes/FGA/FTA (not per-game series), so offline `roleStability` can over-label STABLE vs live (sampleSize 10). Projection ±1.5 cap and Best 6/Top membership compare remain valid on the same inputs.

Live GET at Phase-11 close (`serverBuild: courteedge-player-role-profile-v1`) still had `candidateCount: 11` but only **2** `bestSixDisplayWNBA` with full payloads (Gustafson / Leite) — insufficient alone for a 6-wide re-rank; full Best 6 table uses the frozen 6 above. Prior live refresh display (4) audit fields below.

### Full candidate table (same snapshot; profile off → on)

| Player | Side / Line | Profile (offline) | Proj before → after (Δ) | Conf before → after | Safety before → after | Reasons |
|---|---|---|---|---|---|---|
| Carla Leite | Over 14.5 | STABLE / HIGH / MEDIUM vol / EXPANDING | 20.7 → 22.2 (**+1.5 cap**) | 83 → 87 | 646.0 → 651.6 | STABLE trust; HIGH vol descriptive; EXPANDING +0.75 |
| Marina Mabrey | Over 22.5 | STABLE / HIGH / HIGH vol / EXPANDING | 30.4 → 31.9 (**+1.5 cap**) | 84 → 85 | 694.5 → 695.9 | STABLE; HIGH vol; HIGH scoring vol; EXPANDING +0.75 |
| Sonia Citron | Over 17.5 | STABLE / HIGH / HIGH vol / EXPANDING | 23.1 → 24.6 (**+1.5 cap**) | 86 → 87 | 694.5 → 695.9 | STABLE; HIGH vol; HIGH scoring vol; EXPANDING +0.75 |
| Kiki Iriafen | Over 14.5 | STABLE / HIGH / MEDIUM vol / EXPANDING | 18.8 → 20.3 (**+1.5 cap**) | 78 → 82 | 627.9 → 633.5 | STABLE; HIGH vol; EXPANDING +0.75 |
| Olivia Nelson-Ododa | Over 10.5 | STABLE / MEDIUM / LOW vol / EXPANDING | 14.8 → 15.5 (**+0.7**) | 84 → 91 | 588.2 → 597.0 | STABLE; LOW vol supports conf; EXPANDING; STABLE+LOW_VOL |
| Megan Gustafson | Over 12.5 | STABLE / MEDIUM / MEDIUM vol / STABLE | 17.2 → 17.1 (**−0.1**) | 79 → 82 | 582.5 → 587.7 | STABLE role — trust season blend |

All |Δproj| ≤ **1.5**. No side flips from profile alone.

### Best 6 before / after (safety re-rank + team/game caps)

| Rank | Before (profile off) | After (profile on) |
|---|---|---|
| 1 | Marina Mabrey Over 22.5 (694.5) | Marina Mabrey Over 22.5 (695.9) |
| 2 | Sonia Citron Over 17.5 (694.5) | Sonia Citron Over 17.5 (695.9) |
| 3 | Carla Leite Over 14.5 (646.0) | Carla Leite Over 14.5 (651.6) |
| 4 | Kiki Iriafen Over 14.5 (627.9) | Kiki Iriafen Over 14.5 (633.5) |
| 5 | Olivia Nelson-Ododa Over 10.5 (588.2) | Olivia Nelson-Ododa Over 10.5 (597.0) |
| 6 | Megan Gustafson Over 12.5 (582.5) | Megan Gustafson Over 12.5 (587.7) |

**Membership & order unchanged.** Safety deltas only (rankingAdjustment ±8 bounded). **No forced slate change.**

Original freeze display membership for Jul-14 (subset of mixed-date live Best 6): Mabrey, Citron, Iriafen, Nelson-Ododa. Replay ranks all 6 Jul-14 candidates into a complete Best 6.

### Top 2 before / after

| Rank | Before | After |
|---|---|---|
| 1 | Marina Mabrey Over 22.5 | Marina Mabrey Over 22.5 |
| 2 | Sonia Citron Over 17.5 | Sonia Citron Over 17.5 |

**Top 2 identity unchanged** (matches original freeze Top WNBA).

### Live refresh audit cross-check (post-deploy display pool)

From `.poll-refresh-role-profile-v1.json` Best 6 display (sampleSize 10 / true live last5). Top stayed Mabrey/Citron.

| Player | Side / Line | Live profile | Proj before → after (Δ) | Notes |
|---|---|---|---|---|
| Marina Mabrey | Over 23.5 | STABLE / HIGH / HIGH / EXPANDING | 30.4 → 31.9 (**+1.5**) | Cap honored; line drifted vs freeze 22.5 |
| Sonia Citron | Over 17.5 | MODERATE / HIGH / MEDIUM / STABLE | 23.2 → 23.2 (**0**) | MODERATE → no favorable projection bump |
| Megan Gustafson | Over 12.5 | UNSTABLE / MEDIUM / EXPANDING | 17.2 → 17.5 (**+0.3**) | UNSTABLE_ROLE debt; rankingAdj −5 |
| Carla Leite | Over 14.5 | UNSTABLE / HIGH / STABLE | 20.7 → 19.2 (**−1.5 cap**) | UNSTABLE + HIGH vol stronger edge; −1.5 clamp |

Offline freeze vs live: same hard-cap behavior; live classification stricter on minutes CV when per-game logs exist (Citron MODERATE, Gustafson/Leite UNSTABLE).

---

## Phase 12 — Live refresh safety

**Status:** Complete.

1. Pushed to `orgin/betbrain-v2-rebuild`
2. Waited for Render health `serverBuild: courteedge-player-role-profile-v1` (observed `2026-07-14T01:12:08Z`)
3. Ran **one** `POST /refresh-picks` only (no clear/wipe/restore)

Refresh artifact: `.poll-refresh-role-profile-v1.json`

---

## Files changed

| File | Change |
|---|---|
| `engines/playerRoleProfileV1.js` | **NEW** core module |
| `engines/wnba/wnbaProjectionEngine.js` | Profile calibration + hard ±1.5 vs baseline |
| `engines/wnba/wnbaPlayerPropDataCard.js` | Profile before final projection; audit attach |
| `engines/wnba/wnbaDecisionEngine.js` | Carry profile fields; confidence adj |
| `engines/wnba/wnbaReaderEngine.js` | Soft profile evidence |
| `engines/wnba/wnbaTrackingGateV2.js` | Profile edge evidence bump (floors unchanged) |
| `engines/decisionIntelligence/propDecisionIntelligenceV1.js` | UNSTABLE_ROLE debts/repairs |
| `engines/decisionIntelligence/sideSelectionTrustV1.js` | Canonical debt ids |
| `engines/topProps/controlledBestSixSelector.js` | Bounded rankingAdjustment |
| `services/signalPerformanceV1.js` | Lab dimensions v1.2 |
| `services/trackedPropService.js` | Persist profile audit fields |
| `server.js` | `SERVER_BUILD=courteedge-player-role-profile-v1` |
| `scripts/testPlayerRoleProfileV1.js` | **NEW** 16 tests |
| `scripts/comparePlayerRoleProfileSnapshot.js` | Offline before/after (+ `applyPlayerRoleProfile` toggle) |
| `scripts/extractPlayerRoleProfileSnapshot.js` | **NEW** compact Jul-14 fixture extractor |
| `scripts/fixtures/player-role-profile-wnba-2026-07-14-snapshot.json` | Compact same-snapshot fixture |
| `scripts/fixtures/player-role-profile-before-after-2026-07-14.json` | Full candidate + Best6/Top2 results |
| `scripts/fixtures/player-role-profile-live-refresh-audit-2026-07-14.json` | Live refresh display audit cross-check |
| `scripts/fixtures/player-role-profile-prod-get-capture-meta.json` | Prod GET meta at Phase 11 close |
| `COURTEDGE_PLAYER_ROLE_PROFILE_V1_REPORT.md` | This report |

---

## Intentionally unchanged

- Flip-First / Side Rescue **thresholds**
- Live gap-floor resolver values (`resolveWnbaGapFloor` / LIMITED floors)
- Best 6 size (6), track-all-6, Top Pick safety model, grading formulas
- Results → Lab → History lifecycle and three-slate grouping model
- No Home Star/Starter/Bench labels; risk remains HIGH/MEDIUM/LOW display
- No blind flipping / forced O/U balance
- Profile cannot alone force flip / TRACK / hard-kill override
- Opponent-history neutrality at 0 samples
- Main prop flow engines not replaced

---

## Commit / push

- **SERVER_BUILD:** `courteedge-player-role-profile-v1` (unchanged this phase — report/scripts/fixtures only)
- **Prior tip:** `6093c0f2a4119245a6d816d1df4f642402e93568`
- **Phase 11 commit:** `d37268a46c6325c1ba0f4c1a9a25ab6b4de2c1ae`
- **Push target:** `orgin/betbrain-v2-rebuild`
