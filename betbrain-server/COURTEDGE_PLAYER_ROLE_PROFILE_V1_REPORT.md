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

Script: `betbrain-server/scripts/comparePlayerRoleProfileSnapshot.js`  
Output: `betbrain-server/.player-role-profile-before-after.json`

**Tomorrow full WNBA slate:** no frozen full-candidate snapshot was available locally without calling live refresh / fabricating data. Replay used the best available frozen Top props payload (`.tmp-poll-picks-0713-after.json`) — **2 WNBA Top candidates** only.

| Player | Side / Line | Profile | Proj before → after (Δ) | Conf before → after | Notes |
|---|---|---|---|---|---|
| Marina Mabrey | Over 22.5 | STABLE / HIGH / HIGH vol / EXPANDING | 30.4 → 31.9 (**+1.5 cap**) | 84 → 85 | Hard ±1.5 honored |
| Sonia Citron | Over 17.5 | STABLE / HIGH / HIGH vol / EXPANDING | 23.1 → 24.6 (**+1.5 cap**) | 86 → 87 | Hard ±1.5 honored |

**Best 6 / Top 2:** Without a full tomorrow candidate pool freeze, Best 6 membership cannot be responsibly re-ranked offline. Top-2 identity in this truncated snapshot did not change; only bounded projection/confidence/safety deltas applied. **No forced slate change.**

---

## Phase 12 — Live refresh safety

**Status at report time:** Code + unit tests + offline same-snapshot compare complete.  
**Next (post commit/push + health `SERVER_BUILD=courteedge-player-role-profile-v1`):** one `POST /refresh-picks` for Tomorrow Home/Top only.  
**Forbidden:** `/clear-tracked-props`, wipe/restore prod JSON, duplicate tracks, grade edits, multiple refreshes.

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
| `scripts/comparePlayerRoleProfileSnapshot.js` | **NEW** offline before/after |
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

- **SERVER_BUILD:** `courteedge-player-role-profile-v1`
- **Commit hash:** `4eec9918dd7a36fa6484774773d522da16f66b7b`
- **Push target:** `orgin/betbrain-v2-rebuild`
