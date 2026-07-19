# CourtEdge Engine Expansion V1 — Delivery Report

**Date:** 2026-07-18
**Module:** `engines/courtEdgeExpansion/` (11 signal engines + static calibration + orchestrator)
**Service wiring:** `services/courtEdgeEngineSignalsV1.js`
**SERVER_BUILD:** `courteedge-engine-expansion-v1`
**Schema build:** `courteedge-engine-expansion-v1`
**Feature flag:** `COURTEDGE_ENGINE_EXPANSION_V1_ENABLED` (default **ON**)

This report documents exactly what was built, exactly what data backs it, and exactly what is still gated behind provider entitlements that are not available on the current keys. Nothing in this report is aspirational — every claim is traceable to a file, a test, or an explicit "not available" state in the code itself.

---

## 1. Current engine/pipeline audit

Before this build, the WNBA/NBA decision pipeline (`engines/wnba/wnbaDecisionEngine.js`, `server.js` NBA prop builder) already produced a pick (side, line, confidence) from:

- `courtEdgePlayerEvidenceV1` (provider evidence bundle — Odds/BDL/SportsData fields, `services/courtEdgePlayerEvidenceV1.js`)
- `wnbaOpponentContextService` (defense/pace V2 proxy from BDL games, honest `UNAVAILABLE` when no real sample)
- `providerIdentityLayer` / `providerFallbackPolicy` (ID-first cross-provider joins, explicit fallback matrix)
- Side Rescue, same-team arbitration, side-balance, Controlled Best 6 selection, seal/lock, Results tracking (all pre-existing, untouched by this build — see §26, §27, §38)

What was **missing** before this build: there was no dedicated, auditable, per-signal "second opinion" layer that could independently score role trend, distribution/volatility, defensive matchup, true pace, rest/fatigue, teammate impact, availability, line movement/CLV, and projection sanity — each with its own honesty rules, sample-size shrinkage, and a way to prove none of them silently fabricate a vote when data is missing. That is the gap this build closes: **11 engines + evidence-deduplication + static calibration**, wired in as an additive confidence/risk adjustment layer that never touches side or line.

## 2. Files and functions inspected

Inspected prior to and during this build (read in full, not sampled):

| File | Purpose inspected |
|---|---|
| `engines/courtEdgeExpansion/*.js` (15 files) | Every engine, `shared.js` helpers, `calibrationV1.js`, `orchestratorV1.js`, `index.js` exports |
| `services/courtEdgeEngineSignalsV1.js` | Service-layer `buildContextFromPick`, `attachCourtEdgeEngineSignals`, `applyEngineSignalAdjustments`, `isEngineExpansionEnabled` |
| `config.js` | `CONFIG.COURTEDGE_ENGINE_EXPANSION_V1_ENABLED`, `checkConfig()` |
| `server.js` | `SERVER_BUILD` constant, NBA prop-builder wiring (~line 2203–2234), `/health` and `/diagnostics` shape, `ENGINE_LOAD_FLAGS`, `CONTROLLED_BEST_SIX_VERSION`, `TRACKING_MODE` |
| `engines/wnba/wnbaDecisionEngine.js` | WNBA wiring block (~line 41–45, 682–743), availability-OUT pre-seal rejection |
| `services/canonicalSealedProp.js` | `buildCanonicalSealedProp` — `courtEdgeEngineSignalsV1` / `courtEdgeEngineSignalsVersion` pass-through (~line 169–182) |
| `services/lineIntegrityV1.js` | `resolveSelectedLine`, `buildLineAuditFields`, `applySideChangeKeepLine`, `assertLineUnchanged` (pre-existing; exercised by new tests, never modified) |
| `engines/wnba/playerIntelligence/sameTeamForcedSidePresentationV1.js` | Same-team arbitration's use of `applyEngineSignalAdjustments` (~line 13, 320–349) |
| `scripts/testCourtEdgeEngineExpansionV1.js` | 75-case unit-test suite |
| `scripts/smokeCourtEdgeEngineExpansionV1.js` | End-to-end smoke test (no network) |
| `scripts/replayCourtEdgeEngineExpansionV1.js` | Read-only historical replay/analysis tool |
| `test-fixtures/engine-expansion-v1/*.json` (4 fixtures) | `game-logs-rich.json`, `line-movement.json`, `pace-incomplete.json`, `same-team.json` |
| `COURTEDGE_PROVIDER_ENTITLEMENT_AND_WIRING_AUDIT.md` | Prior (2026-07-18) live-probe entitlement matrix, reused for §9 and the provider section below |
| `services/trackedPropService.js`, `engines/topProps/controlledBestSixSelector.js`, `engines/wnba/wnbaTrackingGateV2.js` | Confirmed `TRACKING_MODE`, `CONTROLLED_BEST_SIX_VERSION`, tracking-gate constants untouched |

## 3. Files changed

**New files (this build):**

```
engines/courtEdgeExpansion/index.js
engines/courtEdgeExpansion/shared.js
engines/courtEdgeExpansion/calibrationV1.js
engines/courtEdgeExpansion/orchestratorV1.js
engines/courtEdgeExpansion/availabilityRosterEngine.js
engines/courtEdgeExpansion/roleVelocityEngine.js
engines/courtEdgeExpansion/distributionEngine.js
engines/courtEdgeExpansion/volatilityEngine.js
engines/courtEdgeExpansion/teammateImpactEngine.js
engines/courtEdgeExpansion/restFatigueEngine.js
engines/courtEdgeExpansion/pacePossessionEngine.js
engines/courtEdgeExpansion/defensiveArchetypeEngine.js
engines/courtEdgeExpansion/lineMovementClvEngine.js
engines/courtEdgeExpansion/projectionSanityEngine.js
engines/courtEdgeExpansion/evidenceDeduplicationEngine.js
services/courtEdgeEngineSignalsV1.js
scripts/testCourtEdgeEngineExpansionV1.js
scripts/smokeCourtEdgeEngineExpansionV1.js
scripts/replayCourtEdgeEngineExpansionV1.js
test-fixtures/engine-expansion-v1/game-logs-rich.json
test-fixtures/engine-expansion-v1/line-movement.json
test-fixtures/engine-expansion-v1/pace-incomplete.json
test-fixtures/engine-expansion-v1/same-team.json
```

**Modified files:**

| File | Change |
|---|---|
| `config.js` | Added `COURTEDGE_ENGINE_EXPANSION_V1_ENABLED` flag (default ON) + `checkConfig()` field `courteEdgeEngineExpansionV1` |
| `server.js` | `SERVER_BUILD` bumped to `"courteedge-engine-expansion-v1"`; imported `attachCourtEdgeEngineSignals` / `applyEngineSignalAdjustments` / `isEngineExpansionEnabled`; wired into the NBA prop-builder loop (guarded by `isEngineExpansionEnabled() && !bestPick.courtEdgeEngineSignalsV1`) |
| `engines/wnba/wnbaDecisionEngine.js` | Imported the same three service functions + `AVAILABILITY_STATE`; wired into the WNBA decision path pre-seal, including a hard pre-seal rejection when the engine's own availability evidence resolves to `OUT` |
| `services/canonicalSealedProp.js` | `buildCanonicalSealedProp` now copies `courtEdgeEngineSignalsV1` / `courtEdgeEngineSignalsVersion` onto the canonical sealed record so Lab/History never has to rebuild it |
| `engines/wnba/playerIntelligence/sameTeamForcedSidePresentationV1.js` | Same-team arbitration now re-applies `applyEngineSignalAdjustments` on the arbitrated signals object instead of discarding engine signals when the side is forced |

No files were deleted. No sealed/tracked/history JSON artifacts were touched by this change set (see §37).

## 4. New `courtEdgeEngineSignalsV1` schema

Produced by `buildCourtEdgeEngineSignalsV1()` in `engines/courtEdgeExpansion/orchestratorV1.js`. Top-level shape:

```js
{
  version: "courtEdgeEngineSignalsV1",          // ENGINE_EXPANSION_VERSION
  schemaBuild: "courteedge-engine-expansion-v1", // SCHEMA_BUILD
  enabled: true | false,
  league: "NBA" | "WNBA",
  playerId, teamId, opponentId, gameId,
  generatedAt, dataCapturedAt,

  // Product-facing top-level aliases (same object references as engines.*)
  lineMovement, projectionSanity, availabilityRoster,
  distributionProfile, volatilityProfile, defensiveArchetype,
  roleVelocity, pacePossession, restFatigue, teammateImpact,

  evidenceDeduplication: { version, league, ledger[], groups{}, totals{} },

  engines: {
    availabilityRoster, roleVelocity, distribution, volatility,
    teammateImpact, restFatigue, pacePossession,
    scoringEnvironmentProxy,   // store-only reference, never a vote
    defensiveArchetype, lineMovementClv, projectionSanity
  },

  aggregation: {
    originalOverSupport, originalUnderSupport,
    organicModelSide: "OVER" | "UNDER" | "NEUTRAL",
    organicModelConfidence,
    independentEvidenceGroups, usedSignalContributions,
    suppressedDuplicateContributions, contradictionCount,
    evidenceCoverage: { availableEngineCount, votingEngineCount, totalEngineCount, coveragePct },
    projectionConfidence, pickConfidence,
    finalRisk, netSignal, overWeight, underWeight,
    confidenceAdjustment, riskAdjustment
  }
}
```

When the flag is off (and `force` isn't set), the shell is `{ enabled: false, engines: {}, evidenceDeduplication: null, aggregation: null, reason: "COURTEDGE_ENGINE_EXPANSION_V1_ENABLED is false" }` — never a partially-built object.

Every individual engine signal (`engines.*`) extends the common `baseEngineSignal()` template from `shared.js`:

```js
{
  engine, available, source, sourceIds, fetchedAt, sampleSize,
  quality: "UNAVAILABLE"|"EARLY"|"DEVELOPING"|"USABLE"|"STRONG",
  stale, error, fallbackUsed,
  rawValues: {...},                 // every input actually used, for audit
  normalizedSignal,                  // -1..1, 0 if engine does not vote
  overContribution, underContribution,
  confidenceAdjustment, riskAdjustment: "REDUCE"|"NEUTRAL"|"MONITOR"|"ELEVATE",
  reason, units,
  ...engineSpecificFields
}
```

## 5. New static NBA calibration configuration

`COURTEDGE_ENGINE_CALIBRATION_V1.NBA` in `engines/courtEdgeExpansion/calibrationV1.js`:

| Engine | Group | Weight | Confidence cap | Risk cap |
|---|---|---|---|---|
| availabilityRosterEngine | AVAILABILITY_AND_TEAMMATE | 1.0 | 8 | 12 |
| teammateImpactEngine | AVAILABILITY_AND_TEAMMATE | 0.6 | 5 | 8 |
| roleVelocityEngine | ROLE_AND_VOLUME | 0.85 | 6 | 8 |
| distributionEngine | DISTRIBUTION_AND_VOLATILITY | 0.7 | 5 | 7 |
| volatilityEngine | DISTRIBUTION_AND_VOLATILITY | 0.45 | 4 | 8 |
| projectionSanityEngine | PROJECTION | 0.8 | 6 | 6 |
| defensiveArchetypeEngine | OPPONENT_AND_MATCHUP | 0.6 | 5 | 6 |
| pacePossessionEngine | GAME_ENVIRONMENT | 0.55 | 4 | 6 |
| lineMovementClvEngine | MARKET | 0.9 | 6 | 8 |
| restFatigueEngine | REST_AND_FATIGUE | 0.5 | 4 | 6 |

Group caps (confidence / risk): ROLE_AND_VOLUME 6/8, DISTRIBUTION_AND_VOLATILITY 5/8, PROJECTION 6/6, OPPONENT_AND_MATCHUP 5/6, MARKET 6/8, AVAILABILITY_AND_TEAMMATE 8/12, GAME_ENVIRONMENT 4/6, REST_AND_FATIGUE 4/6.

**Total confidence cap: ±18. Total risk-score cap: 6.** Rationale documented in-file: NBA's 82-game season and deep historical box scores make it the baseline; WNBA is trimmed from it (§6), not the other way around.

## 6. New static WNBA calibration configuration

`COURTEDGE_ENGINE_CALIBRATION_V1.WNBA`, same file:

| Engine | Group | Weight | Confidence cap | Risk cap |
|---|---|---|---|---|
| availabilityRosterEngine | AVAILABILITY_AND_TEAMMATE | 1.0 | 8 | 12 |
| teammateImpactEngine | AVAILABILITY_AND_TEAMMATE | 0.55 | 5 | 8 |
| roleVelocityEngine | ROLE_AND_VOLUME | 0.75 | 5 | 7 |
| distributionEngine | DISTRIBUTION_AND_VOLATILITY | 0.6 | 4 | 6 |
| volatilityEngine | DISTRIBUTION_AND_VOLATILITY | 0.4 | 4 | 7 |
| projectionSanityEngine | PROJECTION | 0.7 | 5 | 5 |
| defensiveArchetypeEngine | OPPONENT_AND_MATCHUP | 0.5 | 4 | 5 |
| pacePossessionEngine | GAME_ENVIRONMENT | 0.45 | 3 | 5 |
| lineMovementClvEngine | MARKET | 0.9 | 6 | 8 |
| restFatigueEngine | REST_AND_FATIGUE | 0.45 | 4 | 6 |

Group caps: ROLE_AND_VOLUME 5/7, DISTRIBUTION_AND_VOLATILITY 4/7, PROJECTION 5/5, OPPONENT_AND_MATCHUP 4/5, MARKET 6/8, AVAILABILITY_AND_TEAMMATE 8/12, GAME_ENVIRONMENT 3/5, REST_AND_FATIGUE 4/6.

**Total confidence cap: ±16. Total risk-score cap: 6.** Weights are trimmed roughly 10–20% versus NBA (e.g. roleVelocity 0.85→0.75, distribution 0.7→0.6, projectionSanity 0.8→0.7, defensiveArchetype 0.6→0.5, pacePossession 0.55→0.45) to reflect WNBA's shorter season and thinner box-score history. `lineMovementClvEngine` and `availabilityRosterEngine` are held identical across leagues — market pricing and injury-status semantics don't change by league.

`getCalibration(league)` defaults to NBA for any unrecognized league string, never throws.

## 7. Exact implementation for all 11 engines

All 11 live in `engines/courtEdgeExpansion/`. Summary of what each one actually computes (full formulas in §12–§14):

1. **`availabilityRosterEngine.js`** — 7-step evidence priority (injury feed → game status → recent participation → schedule gap [informational only] → prop market → roster → provider health). Never treats a schedule gap or a provider failure as evidence of "out." Casts no Over/Under vote — confidence/risk only.
2. **`roleVelocityEngine.js`** — L3/L5/L10 OLS slopes on minutes, FGA, FTA, points, and an estimated usage proxy (`FGA + 0.44×FTA`); classifies one-game blip vs sustained role change; emits exactly one combined `ROLE_AND_VOLUME` vote.
3. **`distributionEngine.js`** — season / L10 / role-window point distributions (percentiles, hit rate vs line, average margin); blends windows by priority × sample-shrinkage; season and role windows always reported separately.
4. **`volatilityEngine.js`** — stdev, coefficient of variation (league-specific CV baseline), MAD, IQR, boom/bust rates, recent-vs-season trend. Never casts a directional vote (`normalizedSignal` fixed at 0); only widens risk / reduces confidence.
5. **`teammateImpactEngine.js`** — with/without splits for verified-OUT/DOUBTFUL teammates only, gated on a resolvable per-game `teammatesActive` flag; requires ≥2 without-teammate games; shrinks small samples toward zero.
6. **`restFatigueEngine.js`** — back-to-back / 3-in-4 / 4-in-6 / OT hangover / minutes-load-spike scoring from `teamGameDates`; travel is always reported `travelAvailable:false` (no geodata available in context). Never votes.
7. **`pacePossessionEngine.js`** — true per-game possessions (`FGA + 0.44×FTA − OREB + TOV`) extrapolated to full-game rate, only when all four inputs exist for a game; `scoringEnvironmentProxy` stored for reference but never conflated with true pace.
8. **`defensiveArchetypeEngine.js`** — volume-only archetype tier (PRIMARY_SCORER / SECONDARY_SCORER / ROLE_PLAYER / LIMITED_ROLE) from minutes/FGA/FTA — position is never fabricated when absent; opponent-vs-archetype comparison only trusted with ≥3 real box scores.
9. **`lineMovementClvEngine.js`** — reads opening/selected/sealed/current lines and prices as-is (never rewritten); separates directional movement from closing-line value; classifies market reliability from book count + dispersion.
10. **`projectionSanityEngine.js`** — flags a projection when it requires an "unsupported ceiling outcome" (exceeds recent history + stdev with no role/volume/environment support); never removes the prop, only adjusts confidence/risk.
11. **`evidenceDeduplicationEngine.js`** *(not a vote-casting engine — the aggregator)* — groups the other 10 by calibration group, applies same-direction diminishing weights (`[1, 0.6, 0.35, 0.2, 0.1]`), applies per-engine/per-group/overall caps, and produces the audit ledger (see §10).

`scoringEnvironmentProxy` is packaged by the orchestrator itself (`buildScoringEnvironmentProxyRecord`, not a standalone file) as a 12th, store-only entry in `engines.*` — flagged `storeOnly: true`, `normalizedSignal: 0` always, so it can never be mistaken for a vote.

## 8. Provider fields used by each engine

| Engine | Fields consumed (from `ctx`) |
|---|---|
| availabilityRosterEngine | `injuryRow`, `availabilityStatus`, `injuryFeedOk`, `propMarketActive`, `scheduleGapDays`, `providerHealth`, `gameLogs[].minutes`, `rosterStatus` |
| roleVelocityEngine | `gameLogs[].minutes/min`, `.fga`, `.fta`, `.points/pts` |
| distributionEngine | `gameLogs[].points/pts`, `roleGames`, `last10`, `line` |
| volatilityEngine | `gameLogs[].points/pts`, `league` |
| teammateImpactEngine | `teammateStatuses[]` (`status`, `verified`, `playerId`/`name`), `gameLogs[].teammatesActive`, `.points/pts` |
| restFatigueEngine | `teamGameDates[]`, `previousOt`, `gameLogs[].minutes/min` |
| pacePossessionEngine | `gameLogs[].fga/fta/oreb/tov`, `.minutes/min`, `league`, `scoringEnvironmentProxy` |
| defensiveArchetypeEngine | `gameLogs[].minutes/min/fga/fta/threePA`, `archetypeComparables[]`, `opponentDefenseContext`, `position`/`playerPosition`, `seasonAverage` |
| lineMovementClvEngine | `openingLine`, `selectedLine`, `sealedLine`, `currentLine`/`line`, `openingOverPrice`/`openingUnderPrice`, `currentOverPrice`/`currentUnderPrice`, `bookCount`, `lineDispersion`, `organicModelSide`, `finalSide` |
| projectionSanityEngine | `projection`, `vendorProjection`, `gameLogs`, `roleGames`, `last10`, `line`, `impliedTeamTotal`, `spread`, `blowoutRisk`, `scoringEnvironmentProxy`, `seasonAverage` |
| scoringEnvironmentProxy (store-only) | `scoringEnvironmentProxy`, `sourceIds`, `fetchedAt` |

The service layer (`services/courtEdgeEngineSignalsV1.js` → `buildContextFromPick`) maps these onto the pick object's fields (e.g. `pick.wnbaDataCard.bookLine`, `pick.last10`, `pick.injuryRow`), letting an explicit `ctxOverrides` argument win field-by-field over cached pick data.

## 9. Provider limitations and fallbacks (CRITICAL — honest about keys)

**None of the 11 engines call any HTTP provider directly.** They are pure functions over whatever `ctx` the caller (server.js / wnbaDecisionEngine.js) already assembled from upstream provider data. This means the *real* provider limitations for this feature are inherited from what upstream data is actually available — see the dedicated **"Implemented vs left out due to provider keys/entitlements"** section below for the full, current entitlement matrix.

The relevant consequences inside the engines themselves:

- **`defensiveArchetypeEngine`** never receives a true opponent PPG-allowed/pace baseline (BDL `team_season_averages` is 404 for both leagues — see below), so it only ever produces a comparable-opponent signal when `ctx.archetypeComparables` (a real box-score sample, ≥3 games) or `ctx.opponentDefenseContext` (the honest BDL-games proxy) is supplied. With neither, it returns `available:false` — it does **not** fabricate a defensive rating.
- **`pacePossessionEngine`** never receives a league-official pace/possessions figure (also unavailable on current entitlements) — it computes true pace *only* from complete `FGA/FTA/OREB/TOV` box-score rows already present in `gameLogs`, and keeps `scoringEnvironmentProxy` (e.g. an implied-total-based estimate) strictly separate, store-only, never blended into the pace number.
- **`projectionSanityEngine`**'s `vendorProjection` field is only populated when SportsData's NBA `PlayerGameProjectionStatsByDate` (authorized, 200) is available; for WNBA there is currently no authorized vendor-projection source, so `vendorProjection` is `null` and the corresponding sanity check silently skips (no fabricated gap).
- **`availabilityRosterEngine`**'s only structured injury source is BDL `player_injuries` (WNBA, 200/authorized) — SportsData's WNBA player/status feeds are 401 and are never called.

## 10. Evidence-deduplication group design

`evaluateEvidenceDeduplication()` in `evidenceDeduplicationEngine.js`:

1. Every engine is assigned to exactly one of 8 groups in `calibrationV1.js` (`ROLE_AND_VOLUME`, `DISTRIBUTION_AND_VOLATILITY`, `PROJECTION`, `OPPONENT_AND_MATCHUP`, `MARKET`, `AVAILABILITY_AND_TEAMMATE`, `GAME_ENVIRONMENT`, `REST_AND_FATIGUE`) — grouping correlated evidence (e.g. distribution + volatility both describe "how spread out are results") so it can't double-count.
2. Within each group, same-direction (same-sign `weightedSignal`) entries are ranked by `|weightedSignal|` descending and multiplied by a diminishing series `[1, 0.6, 0.35, 0.2, 0.1]` — only the strongest same-direction signal keeps full weight; each additional corroborating signal counts for less.
3. Each group's deduped confidence sum is clamped to that group's `confidenceCap`/`riskCap` (from calibration).
4. Risk is tracked as an ordinal (REDUCE=-1, NEUTRAL=0, MONITOR=1, ELEVATE=2) per engine, summed per group, capped at ELEVATE (2) per group regardless of how many engines in that group say ELEVATE.
5. Totals across all groups are clamped again to the league's `totalConfidenceCap` (±18 NBA / ±16 WNBA) and `totalRiskScoreCap` (6, both leagues).
6. The full **ledger** (every engine, included/excluded, raw vs deduped signal, cap-applied flags) is returned untouched alongside the totals — nothing is thrown away, so any adjustment is traceable back to which engines fired and which were suppressed as duplicates. Unit test **#37** proves this function never mutates the engine signals it reads.

## 11. Runtime execution order

Fixed order inside `buildCourtEdgeEngineSignalsV1()` (`orchestratorV1.js`, module-header-documented, never reordered dynamically):

```
1. availabilityRosterEngine
2. roleVelocityEngine
3. distributionEngine (ceiling/floor)
4. volatilityEngine
5. teammateImpactEngine
6. restFatigueEngine
7. pacePossessionEngine (true pace)
8. scoringEnvironmentProxy (store-only, packaged inline — never a vote)
9. defensiveArchetypeEngine
10. lineMovementClvEngine
11. projectionSanityEngine
   → evaluateEvidenceDeduplication(ctx, engineSignals)
   → buildAggregation(evidenceDeduplication)
```

Service-layer order (`services/courtEdgeEngineSignalsV1.js`): `buildContextFromPick()` → `buildCourtEdgeEngineSignalsV1()` (`attachCourtEdgeEngineSignals`) → `applyEngineSignalAdjustments()`. Callers (`wnbaDecisionEngine.js`, `server.js`) always call `attachCourtEdgeEngineSignals` then `applyEngineSignalAdjustments` in that order, immediately before `finalizeCanonicalDecision` / seal.

## 12. Signal scoring formulas

- **roleVelocity**: OLS slope (`slopeLinear`) per window (L3/L5/L10) on minutes/FGA/FTA/points/usage-proxy; window lean = weighted sum of `clamp(slope/scale, -1, 1) × metricWeight` (minutes 0.35, FGA 0.25, usage-proxy 0.2, points 0.2); windows combined with weights `{L3: .2–.35, L5: .35, L10: .3–.45}` depending on whether a sustained change is detected; final signal × `sampleShrinkage(L10 sample, fullAt=8)`; one-game blips damped ×0.3.
- **distribution**: `blendedHitRate = Σ(hitRate_w × priority_w × max(shrink_w,0.15)) / Σweight`; `normalizedSignal = clamp((blendedHitRate − 0.5) × 2, -1, 1)`, then scaled again by `(0.4 + 0.6×overallShrink)`.
- **volatility**: `CV = stdev/mean`; tier = HIGH/MODERATE/LOW against league baseline (`{NBA: moderate .35/high .55, WNBA: moderate .4/high .6}`); `normalizedSignal` fixed at 0 (never votes).
- **teammateImpact**: `weightedDelta = Σ(delta_t × shrink_t)/Σshrink_t` across resolvable teammates; `normalizedSignal = clamp(weightedDelta/8, -1, 1)` (an 8-point swing ≈ full-strength signal).
- **pacePossession**: `possessions = FGA + 0.44×FTA − OREB + TOV`; per-game rate extrapolated to full regulation minutes (48 NBA / 40 WNBA); `normalizedSignal = clamp((recentRate−seasonRate)/seasonRate, -1, 1) × sampleShrinkage(n, 10)`.
- **defensiveArchetype**: `normalizedSignal = clamp((avgPointsAllowedToArchetype − seasonAvg)/max(seasonAvg,4) × comparableShrink, -1, 1)` (or ×0.6 when only the lower-confidence `opponentDefenseContext` path is used).
- **lineMovementClv**: `leanFromLine = clamp(lineDelta/2, -1, 1)`; `leanFromPrice = clamp((overProbShift−underProbShift)×4, -1, 1)`; `normalizedSignal = weighted average (line 0.65, price 0.35 when both present)`.
- **projectionSanity**: `relativeGap = clamp((projection−referenceAvg)/max(referenceAvg,4), -1, 1)`; `normalizedSignal = relativeGap × shrink × (0.3 if ceiling-outcome unsupported else 1)`.
- **availabilityRoster / restFatigue**: fixed `normalizedSignal = 0` — these are confidence/risk-only engines by design (see §7).

## 13. Confidence adjustment formulas

Each engine computes its own raw `confidenceAdjustment` (documented per-engine in §7/§12 source), always clamped to a small per-engine range (e.g. availability OUT = −12, DOUBTFUL = −8, QUESTIONABLE = −4; volatility HIGH = −5, MODERATE = −2; role sustained change = `round(5×shrink)×sign`; projection unsupported ceiling = `−round(6×shrink)`; line-movement-against-final-side = −6/−4/−2 by reliability tier).

The evidence-deduplication engine then re-weights: `weightedConfidenceAdjustment = rawConfidenceAdjustment × qualityMultiplier(quality) × (0.75 if fallbackUsed else 1)`, applies the same-direction diminishing series within a group, clamps the group sum to `groupCap.confidenceCap`, sums across groups, and clamps the grand total to the league's `totalConfidenceCap` (±18 NBA / ±16 WNBA). `qualityMultiplier`: STRONG=1, USABLE=0.8, DEVELOPING=0.5, EARLY=0.25, UNAVAILABLE=0.

The service layer (`applyEngineSignalAdjustments`) applies this **already-capped** total directly to `pick.confidence`: `nextConfidence = clamp(round(priorConfidence + confidenceAdjustment), 5, 97)`. Side and line are never touched.

## 14. Risk adjustment formulas

Each engine emits one of `REDUCE | NEUTRAL | MONITOR | ELEVATE`. The dedup engine maps these to an ordinal (`-1/0/1/2`), sums per group, clamps each group's sum to `[-1, 2]` (ELEVATE is the ceiling per group regardless of stacking), sums across groups, clamps the grand total to `[-1, calibration.totalRiskScoreCap]` (6 for both leagues), then maps the final ordinal back to a label (`≥2 → ELEVATE`, `≥1 → MONITOR`, `≤-1 → REDUCE`, else `NEUTRAL`).

The service layer combines this with any pre-existing `pick.courtEdgeRiskAdjustment` by taking the **more severe** of the two on the same ordinal scale (`Math.max` of indices) — engine-expansion risk can only escalate an existing risk label, never silently downgrade one set by an upstream gate.

## 15. Same-team integration proof

`engines/wnba/playerIntelligence/sameTeamForcedSidePresentationV1.js` (line 13, 320–349) imports `applyEngineSignalAdjustments` directly. When same-team arbitration force-flips a pick's presented side, it:

1. Preserves the *raw* `courtEdgeEngineSignalsV1.aggregation` object (does not discard or regenerate it).
2. Adds a `sameTeamArbitration` audit block (`reason: "SAME_TEAM_ARBITRATION_FLIP"`, `originalModelSide`, `finalSide`, `conflictScore`) alongside the existing engine aggregation — never merged into it or hidden.
3. Applies an *additional* confidence penalty (`−8` or `−4` depending on `conflictScore`) on top of the engine's own capped adjustment — explicitly commented "never invent Under evidence."
4. Re-runs `applyEngineSignalAdjustments` on this composite object so the final `confidence`/`courtEdgeRiskAdjustment` fields stay consistent with the (now-annotated) signals, rather than being computed twice from different sources.

Unit tests **#56, #57** (`testCourtEdgeEngineExpansionV1.js`) directly assert that a same-team flip keeps the line unchanged (`assertLineUnchanged(...).ok === true`) and that `courtEdgeEngineSignalsV1` survives object-identity-wise (`flipped.courtEdgeEngineSignalsV1 === pick.courtEdgeEngineSignalsV1`) through `applySideChangeKeepLine`.

## 16. Line-integrity proof

`services/lineIntegrityV1.js` (pre-existing infrastructure, unmodified by this build) is exercised directly by the new test suite:

- **#51–53**: `applySideChangeKeepLine` preserves `line`/`selectedLine`/`sportsbookLine` through a forced side change; sets `lineLockedThroughSideChange: true`.
- **#58–60**: `attachCourtEdgeEngineSignals` + `applyEngineSignalAdjustments` never change `pick.line` (`21.5` in, `21.5` out) or `pick.side`/`pick.pick` regardless of what the engines compute.
- **#61**: `attachCourtEdgeEngineSignals` does not mutate its input pick object at all (`JSON.stringify` before/after equality).
- **#65**: `sealedLine`/`selectedLine`/`officialLine` all survive `buildCanonicalSealedProp` unchanged after engine signals are attached.

`lineMovementClvEngine.js` itself is explicitly documented to "NEVER rewrite or 'correct' a line — every stage of the line lifecycle is reported verbatim in `rawValues`." It only *reads* `openingLine/selectedLine/sealedLine/currentLine`; it has no write path back onto the pick.

## 17. NBA parity results using fixtures/replay

Fixture-based parity (no live NBA slate was active on the probe date — see the entitlement matrix below, "NBA events: 200, Authorized: yes, Rows: 0 — offseason empty on probe date"):

- Unit tests **#31** (`leagueRegulationMinutes("NBA") === 48`) and the full 75-case suite run engines under `league: "NBA"` contexts (e.g. test #21, #40) and confirm identical code paths execute for NBA as for WNBA — same engines, same shared helpers, only the calibration weights/caps differ (§5 vs §6) and `leagueRegulationMinutes` (48 vs 40).
- `smokeCourtEdgeEngineExpansionV1.js`'s ragged-fixture battery includes an explicit `{ league: "NBA" }` empty-context case and a `{ league: "NBA", openingLine: 10, currentLine: 10 }` flat-line case — both must complete without throwing and produce a well-formed bundle.
- `replayCourtEdgeEngineExpansionV1.js` defaults any prop missing an explicit `league` to `"WNBA"` (its stated fallback) but will use `prop.league` verbatim when present, so it is NBA-capable once NBA sealed/tracked history exists on disk.

**No live NBA game-log/box-score parity run has been executed as part of this delivery** — the NBA season was inactive on the probe date used for the provider audit (§9 / provider section), so there is no live NBA slate to replay against yet. This is marked **PENDING DEPLOY VERIFY**: re-run `scripts/replayCourtEdgeEngineExpansionV1.js` against `daily-slate-reports.json` / `tracked-props.json` once NBA games are on the live board, and compare `engines.*.available` counts and `aggregation.organicSide` distribution against the equivalent WNBA replay.

## 18. WNBA live verification results

**PENDING DEPLOY VERIFY.** This report is written pre-deploy (no commit hash yet — see §32). The engine expansion is wired into `wnbaDecisionEngine.js` and exercises correctly against fixtures (§17, §28), but no live WNBA slate has been generated against the deployed build yet.

**Verification plan once deployed:**
1. Confirm `/health` reports `serverBuild: "courteedge-engine-expansion-v1"` and `config.courteEdgeEngineExpansionV1: true` (see §35 placeholder).
2. Trigger (or wait for) a live WNBA refresh; pull one generated pick's `courtEdgeEngineSignalsV1` via `/diagnostics` or the tracked-props endpoint.
3. Confirm `engines.*.available` reflects real WNBA game-log/injury/line data (not all-unavailable), `evidenceDeduplication.totals.coveragePct` is non-zero, and `aggregation.organicSide` is one of `OVER/UNDER/NEUTRAL` (never a forbidden UI token — see test #71–75).
4. Confirm the pick's `side`/`line`/`pick` are byte-identical to what they would have been with the flag off (spot-check against a `force:false` rebuild) — the engine layer must only move `confidence`/`courtEdgeRiskAdjustment`.

## 19. Historical replay comparison

`scripts/replayCourtEdgeEngineExpansionV1.js` is a read-only dry-run tool that: loads any of `test-fixtures/engine-expansion-v1/{same-team,game-logs-rich}.json`, `daily-slate-reports.json`, `pick-history.json`, `tracked-props.json`, or `history-archive/*.json` if present on disk; rebuilds `courtEdgeEngineSignalsV1` for each prop found (`force: true`); prints a before/after summary (`available`/`voting` engine counts, `organicSide`, `confidenceAdjustment`); and **asserts** (aborts with a non-zero exit) if rebuilding ever mutates a prior sealed signals object it read (`JSON.stringify` snapshot compared before/after).

No archives are written by this script — it is explicitly commented "NEVER writes or mutates archives." This delivery ran it against the fixture-only path (no local sealed/history JSON existed on this session's disk snapshot at edit time); the historical-archive comparison against real sealed picks is part of the same **PENDING DEPLOY VERIFY** plan as §18 — run it again post-deploy once real `tracked-props.json` / `daily-slate-reports.json` content exists for the new build.

## 20. Known failure examples before/after

Concrete before/after behaviors proven by unit tests (these are the specific failure modes the engine set was built to catch or avoid):

| Failure mode | Before (no engine layer) | After (this build) |
|---|---|---|
| Projection assumes an unsupported career-high | No sanity check existed on `projection` vs history | `projectionSanityEngine` flags `projectionRequiresCeilingOutcome: true` and applies `confidenceAdjustment < 0` + `riskAdjustment: ELEVATE` (test #8) |
| Market moves hard against the final side | No CLV/line-movement check fed into confidence | `lineMovementClvEngine` detects `marketMovedAgainstFinal: true` and reduces confidence (tests #1, smoke test #4) |
| Missing box-score field silently treated as 0 (fake pace) | Pace/possessions could be computed with a guessed 0 for a missing stat | `pacePossessionEngine` returns `truePaceAvailable:false`, `normalizedSignal:0` whenever FGA/FTA/OREB/TOV aren't all present (tests #33, #34, smoke test #3) |
| Unrelated teammate injury credited as a "boost" | No verification that an injured teammate was actually relevant/resolvable | `teammateImpactEngine` requires `verified !== false` status AND a resolvable per-game with/without split (≥2 games); an unverified or unresolvable injury returns `available:false` (tests #47, #50) |
| Schedule gap or provider outage treated as "player is out" | Ambiguous availability states could conflate "no data" with "confirmed out" | `availabilityRosterEngine` explicitly reports `STATUS_UNAVAILABLE` / `PROVIDER_ERROR` as distinct states, with `scheduleGapIsInactivityEvidence: false` and `providerFailureIsOutEvidence: false` asserted directly (tests #14, #15, #16) |
| Same-team forced flip silently discarding organic model evidence | Prior implementations risked losing the engine signal object on a forced flip | `sameTeamForcedSidePresentationV1.js` now preserves and re-annotates the signals object rather than dropping it (tests #56, #57) |

## 21. Fresh Today Controlled Best 6

**PENDING DEPLOY VERIFY.** No fresh Today Best 6 has been generated against the deployed build yet — deployment has not occurred (see §32–§35 placeholders). Do not treat any Best-6 card shown before deploy as reflecting this build.

**Verification plan:** once deployed and a `/refresh` (or scheduled refresh) has run, pull the Today board (`GET /picks` or the board's `topProps` for `slateDate = today`), confirm each of the 6 selected props carries `courtEdgeEngineSignalsV1.enabled === true` and a non-null `aggregation`, and record the 6 player/prop/line/side/confidence rows here.

## 22. Fresh Tomorrow Controlled Best 6

**PENDING DEPLOY VERIFY.** Same status and plan as §21, applied to the Tomorrow slate (`Controlled Best Six` selector, `CONTROLLED_BEST_SIX_VERSION = "controlled-best-six-lifecycle-stale-sealed-v1"`, unchanged by this build — see §26/§38). Record the 6 rows here once the Tomorrow slate seals post-deploy.

## 23. Proof all six selected props are TRACK

**PENDING DEPLOY VERIFY for a live slate** — but the underlying mechanism is unchanged by this build and was independently confirmed intact: `TRACKING_MODE = "ALL_GENERATED_PROPS"` in `services/trackedPropService.js` was not touched by any file in §3, and the Controlled Best 6 selector (`engines/topProps/controlledBestSixSelector.js`) that feeds the tracked-props cohort is likewise untouched. The engine-expansion tests (§28, tests #54, #63–#68) explicitly build mock Best-6-shaped candidates (`controlledBestSixRank`, `bestSixEligibility`) carrying `courtEdgeEngineSignalsV1` and confirm the object survives seal (`buildCanonicalSealedProp`) without altering `line`/eligibility fields — i.e. attaching engine signals cannot cause a prop to fall out of the TRACK cohort. Live confirmation (all 6 rows showing `trackingStatus/label: TRACK`) is part of the §21/§22 post-deploy verification pass.

## 24. Proof Results Tracked is 6/6

**PENDING DEPLOY VERIFY.** Same reasoning as §23: the tracking-cohort membership logic (`controlled-tracking-cohort-v3-today-best-six-full`, per `.tmp-testrun-testFlipFirstDecisionIntelligenceV1.js.txt`/prior audits) is not part of the files changed in §3, and none of the engine-expansion code paths remove a pick from tracking — `services/courtEdgeEngineSignalsV1.js` is explicitly commented "never removes a pick from tracking — that stays the responsibility of upstream gates." The only new pre-seal rejection path added is `wnbaDecisionEngine.js`'s `AVAILABILITY_STATE.OUT` short-circuit (§7 item 1, §29), which rejects a candidate *before* it is selected into Best 6 in the first place — it cannot cause a selected 6th prop to later drop out of Results. Live 6/6 confirmation is part of the post-deploy verification pass in §21/§22.

## 25. Proof no extra user-facing labels

Unit tests **#71–#75** assert directly against a `FORBIDDEN_UI = /BOARD_ONLY|NO_BET|SHADOW_ONLY|READER_UNCERTAIN/` regex across every engine's `reason` string and the aggregation's `organicSide`:

- **#71**: no engine reason contains `BOARD_ONLY`.
- **#72**: no engine reason contains `NO_BET`.
- **#73**: no engine reason contains `SHADOW_ONLY`.
- **#74**: `aggregation.organicSide` is strictly one of `OVER | UNDER | NEUTRAL` — never a gate-eligibility code.
- **#75**: across a combined fixture (line movement + availability + rest/fatigue all active at once), no engine reason contains any forbidden token.

All 5 passed in the persisted test run (§28). This module introduces zero new user-facing label vocabulary — its output vocabulary is confidence/risk/quality tiers (`REDUCE/NEUTRAL/MONITOR/ELEVATE`, `UNAVAILABLE/EARLY/DEVELOPING/USABLE/STRONG`) consumed internally by `applyEngineSignalAdjustments`, not rendered as new board badges.

## 26. Proof Lab was not rebuilt

No file under any Lab-related path (`services/*Lab*`, Lab wipe/restore endpoints, `controlled-tracking-cohort` builders) appears in §3's changed-file list. `server.js`'s Lab-wipe endpoint (`"Lab wipe dry-run complete" / "Lab wipe applied"`, ~line 4811) and its `serverBuild` echo were not modified beyond the pre-existing `SERVER_BUILD` constant reference (which every endpoint already echoes verbatim — bumping that one constant is not a Lab rebuild). `canonicalSealedProp.js`'s docstring ("Lab/History must consume this object rather than rebuilding from Board fields") is unchanged; this build only *adds* two pass-through fields (`courtEdgeEngineSignalsV1`, `courtEdgeEngineSignalsVersion`) to the existing canonical object — it does not touch how Lab reads or reconstructs anything.

## 27. Proof no Calibration Feedback Engine

`engines/courtEdgeExpansion/calibrationV1.js`'s header states explicitly: *"Static, conservative weights only. No auto-tuning, no historical replay feedback loop lives here."* Confirmed by inspection:

- `COURTEDGE_ENGINE_CALIBRATION_V1` (both `NBA` and `WNBA` blocks) is declared with `Object.freeze()` at every level — weights/caps are compile-time constants, not runtime-mutable state.
- No file in `engines/courtEdgeExpansion/` reads from or writes to any historical-results, Lab-learning, or signal-performance store. `evaluateEvidenceDeduplication` and `buildCourtEdgeEngineSignalsV1` take only the current `ctx` and the static calibration table as inputs — there is no feedback edge from outcomes back into weights.
- `CONFIG.COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED` (a *separate*, pre-existing flag referenced only in a code comment as "the pattern" for any future reviewed rollout) remains `false` by default and was not changed by this build (confirmed unchanged in `config.js`, §5/§6 above only added the new `COURTEDGE_ENGINE_EXPANSION_V1_ENABLED` flag).
- `replayCourtEdgeEngineExpansionV1.js` is read-only "analysis only" per its own header — it never writes weights, and there is no code path from that script back into `calibrationV1.js`.

## 28. Tests passed and failed

**Engine-expansion-specific suite** (`node scripts/testCourtEdgeEngineExpansionV1.js`, fixture-only, no live keys) — persisted run in `.tmp-testrun-testCourtEdgeEngineExpansionV1.js.txt`:

```
75 passed, 0 failed
```

Covering: line movement (1–6), projection sanity (7–10), availability (11–16), distribution/volatility (17–21), defensive archetype (22–26), role velocity (27–30), pace (31–36), deduplication (37–40), rest/fatigue (41–45), teammate impact (46–50), Best 6/same-team/line-integrity (51–62), lifecycle (63–70), UI labels (71–75).

`scripts/smokeCourtEdgeEngineExpansionV1.js` (empty-ctx honesty, rich-fixture availability, pace-with-missing-OREB, line-movement-against-final-side, ragged-fixture no-throw battery, service-layer round-trip, flag-boolean check) was inspected line-by-line and its assertions match the same invariants proven by the 75-case suite above; it is designed to run with zero network dependency identically to the main suite.

**Repo-wide related suites also inspected** (persisted `.tmp-testrun-*.txt` artifacts, none touched by this build):

| Suite | Result |
|---|---|
| `testLineIntegrityV1.js` | All passed |
| `testStaleSealedRecovery.js` | All passed |
| `testOfficialSlateLifecycle.js` | 13/13 passed |
| `testPlayerRoleProfileV1.js` | 18/18 passed |
| `testWnbaDefenseEvidenceV1.js` | 1 failure (`SCORING_ENVIRONMENT_PROXY` vs expected `GAME_TOTAL_PROXY` label) — pre-existing, unrelated |
| `testSideRescueEngineV1.js` | 45 passed, 5 failed — pre-existing, unrelated |
| `testFlipFirstDecisionIntelligenceV1.js` | 32 passed, 1 failed (later run: 14 passed, 4 failed) — pre-existing, unrelated |

See §29 for why these pre-existing failures are unrelated to this delivery.

## 29. Explanation of unrelated failures

None of the failures below are in files touched by this build (§3), and none involve `engines/courtEdgeExpansion/` or `services/courtEdgeEngineSignalsV1.js`:

- **`testWnbaDefenseEvidenceV1.js`** — asserts a label string `'GAME_TOTAL_PROXY'` that a *different*, earlier build (`courtEdgePlayerEvidenceV1` / defense-V2 work) renamed to `'SCORING_ENVIRONMENT_PROXY'` at some point after that test was written. This is a stale test-fixture expectation in an unrelated evidence-bundle module, not a regression from this delivery — this build only *reads* `ctx.scoringEnvironmentProxy` as an opaque number (§7 item 7) and never asserts or depends on its label string.
- **`testSideRescueEngineV1.js`** (45/50) — failures are version-string mismatches (`'controlled-tracking-cohort-v3-today-best-six-full'` vs an older expected `'...v2-track-all-best-six'`), a passthrough-count mismatch, and a team-diversity assertion — all in `controlledBestSixSelector.js` / `trackedPropService.js`, none of which are in §3's changed-file list. These reflect that selector's version string having moved forward since that test file was last updated, unrelated to engine-expansion work.
- **`testFlipFirstDecisionIntelligenceV1.js`** — failure is a hardcoded date-string mismatch (`'2026-06-25'` actual vs `'2026-06-23'` expected in a slate-locking test) — a stale fixture date in a prior feature's test file, not touched by this build.

All three failing suites pre-date this delivery and were already present in the persisted `.tmp-testrun-*.txt` artifacts inspected during audit (i.e., they were not introduced by anything in §3). **Recommendation:** track these as separate cleanup tickets against `wnbaDefenseEvidenceV1`, `controlledBestSixSelector`/`trackedPropService`, and the Flip-First slate-lock test fixture respectively — out of scope for this engine-expansion delivery.

## 30. New SERVER_BUILD

```js
const SERVER_BUILD = "courteedge-engine-expansion-v1";
```

`server.js`, line 304. Echoed verbatim on every existing endpoint that already reports `serverBuild` (`/health`, `/diagnostics`, `/refresh`, `/picks`, `/top-props`, scheduler/backup/restore endpoints, etc. — over 25 call sites, none of which needed individual changes since they all reference the single constant).

## 31. Feature-flag/config status

| Flag | Default | Set by this build? |
|---|---|---|
| `COURTEDGE_ENGINE_EXPANSION_V1_ENABLED` | **ON** (`!== "false"`) | Yes — new flag added in `config.js`, this build |
| `COURTEDGE_EVIDENCE_V1_ENABLED` | ON | No — pre-existing |
| `COURTEDGE_WNBA_DEFENSE_V2_ENABLED` | ON | No — pre-existing |
| `COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED` | **OFF** | No — pre-existing, stays OFF (401 on current key, §9) |
| `COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED` | **OFF** | No — pre-existing, stays OFF (no feedback loop, §27) |

`checkConfig()` (`config.js`) now includes `courteEdgeEngineExpansionV1: CONFIG.COURTEDGE_ENGINE_EXPANSION_V1_ENABLED`, surfaced on `/health` and `/diagnostics` via the existing `config: checkConfig()` field. No `.env` values were modified by this build — the flag defaults ON purely from the `!== "false"` check, matching the "safe default ON, additive" pattern used by every other CourtEdge flag in this file.

## 32. Commit hash

**`COMMIT_HASH_PENDING`** — to be filled in by the parent agent after this change set is committed.

## 33. Push status

**PENDING** — not pushed. To be filled in by the parent agent after `git push`.

## 34. Render deployment status

**PENDING** — no deploy has been triggered as part of this delivery. To be filled in by the parent agent after Render deploy completes (deploy ID / status / timestamp).

## 35. Live `/health` result

**PENDING** — capture after deploy. Expected shape once live (based on `server.js` lines 2727–2744, unchanged endpoint logic, new constant value only):

```json
{
  "ok": true,
  "message": "CourtEdge backend running",
  "serverBuild": "courteedge-engine-expansion-v1",
  "boardSchemaVersion": "courtedge-board-schema-v2",
  "engines": { "...": "ENGINE_LOAD_FLAGS, unchanged by this build" },
  "config": { "...": "checkConfig() output, includes courteEdgeEngineExpansionV1: true" },
  "providerPolicy": { "...": "unchanged" },
  "time": "<ISO timestamp at request time>"
}
```

Parent agent: run `curl <prod-url>/health` post-deploy and paste the real response here in place of this placeholder.

## 36. Rollback command

The feature is flag-gated and additive, so rollback has two independent levels:

**Level 1 — instant, no redeploy (preferred):** set the environment variable `COURTEDGE_ENGINE_EXPANSION_V1_ENABLED=false` on the Render service and restart. Every engine-expansion call site (`server.js`, `wnbaDecisionEngine.js`) is guarded by `isEngineExpansionEnabled()`, so this immediately reverts to the disabled shell (`{ enabled:false, engines:{}, aggregation:null }`) everywhere, with zero effect on side/line/tracking logic, which never depended on this module.

**Level 2 — full code rollback (if needed):**
```bash
git revert <commit-hash-from-§32>
git push
```
or, to hard-reset to the immediately prior commit (only if the revert commit itself is unwanted and the branch has not been shared/rebased by others):
```bash
git reset --hard <prior-commit-hash>
git push --force-with-lease
```
Either path is safe because no sealed/tracked/history JSON was mutated by this build (§37) — rollback only removes code, never data.

## 37. Confirmation no tracked/historical records deleted/rewritten

Confirmed by direct inspection:

- **No file in §3** touches any persisted JSON store (`tracked-props.json`, `daily-slate-reports.json`, `history-archives.json`, `slates-locked.json`, etc.) or any backup/restore/wipe code path.
- `replayCourtEdgeEngineExpansionV1.js` is explicitly read-only: it loads candidate JSON files (`tryReadJson`), and its own comment header states *"NEVER writes or mutates archives."* It additionally **self-verifies** this at runtime — for every prop with a pre-existing `courtEdgeEngineSignalsV1`, it snapshots that object with `JSON.stringify` before rebuilding, rebuilds, and re-compares; if the prior object changed at all, the script logs `"ERROR: prior sealed signals object was mutated — aborting"` and sets a non-zero exit code.
- Unit tests **#61** (`attachCourtEdgeEngineSignals does not mutate input`) and **#64** (`replay rebuild does not mutate sealed archive object`) directly assert byte-for-byte (`JSON.stringify`) equality of a pick/archive object before and after engine-signal attachment/rebuild.
- `services/courtEdgeEngineSignalsV1.js` functions are pure — `attachCourtEdgeEngineSignals` returns `{ ...pick, courtEdgeEngineSignalsV1: signals, ... }` (a new object via spread), never mutating the input `pick` in place.
- No `--apply` recovery flag, Lab wipe, or backup/restore endpoint was invoked or modified as part of this delivery.

## 38. Confirmation six-man slates / track-all-six / same-team intact

- **`TRACKING_MODE = "ALL_GENERATED_PROPS"`** (`services/trackedPropService.js`, line 90) — not present in §3's changed-file list, confirmed unchanged.
- **`CONTROLLED_BEST_SIX_VERSION = "controlled-best-six-lifecycle-stale-sealed-v1"`** (`engines/topProps/controlledBestSixSelector.js`, line 47) — not present in §3's changed-file list, confirmed unchanged. This is the selector that produces the 6-prop slates referenced in §21–§24.
- **`WNBA_TRACKING_GATE_VERSION = "wnba-tracking-gate-v2-live"`** (`engines/wnba/wnbaTrackingGateV2.js`) — not present in §3's changed-file list, confirmed unchanged.
- **Same-team arbitration** (`engines/wnba/playerIntelligence/sameTeamForcedSidePresentationV1.js`, `SAME_TEAM_FORCED_SIDE_PRESENTATION_VERSION = "same-team-forced-side-presentation-v1"`) — the *version constant itself* is unchanged; the only edit was making it correctly re-invoke `applyEngineSignalAdjustments` on its own composite signals object instead of dropping engine signals on a forced flip (§15). This is additive integration, not a behavioral rewrite of the arbitration logic itself (conflict scoring, `SAME_TEAM_ARBITRATION_FLIP` reason code, and the forced-Under presentation rule are all untouched).
- Line-integrity guarantees for six-man slates and same-team flips are proven end-to-end by tests **#51–#62** (§16), all passing.

---

## Implemented vs left out due to provider keys/entitlements

This is the same entitlement matrix from `COURTEDGE_PROVIDER_ENTITLEMENT_AND_WIRING_AUDIT.md` (live-probed 2026-07-18, `scripts/probeProviderEntitlements.js`, fixtures in `test-fixtures/provider-entitlements/`), restated here because it governs exactly what the CourtEdge Engine Expansion V1 engines can and cannot see:

### Unavailable — scaffolded honest, not wired

| Provider path | HTTP result | Consequence for this build |
|---|---|---|
| **BallDontLie `team_season_averages`** (both NBA & WNBA) | **404** — unauthorized on current plan | `defensiveArchetypeEngine` and `pacePossessionEngine` never receive a league-official team-season baseline. Both engines scaffold this as **`available:false`** whenever no box-score comparable sample or explicit `opponentDefenseContext` is supplied — they never substitute a fabricated 50/neutral value. |
| **SportsDataIO WNBA scores/Teams** | **401** — not authorized | Not used for WNBA generation at all. `COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED` stays OFF. |
| **SportsDataIO WNBA scores/Players** | **401** — not authorized | Same as above — no WNBA player status/box data from SportsData. |
| **SportsDataIO NBA `TeamSeasonStats`** | **401** — not authorized | NBA-side team season baseline also unavailable; `defensiveArchetypeEngine`/`pacePossessionEngine` fall back to the same box-score-only comparable path for NBA as for WNBA. |
| **SportsDataIO WNBA stats/Players, WNBA projections** | 404 — dead paths | Confirmed dead on probe; not called. |
| **BDL `/injuries` alt path** | 404 — dead path | Confirmed dead on probe; the primary `player_injuries` endpoint (200) is used instead. |

### Partially available — probe caveat

- **Live Odds/BDL re-probe from the build host during this session partially failed on TLS** (network egress restrictions in this drafting environment). This does **not** invalidate the entitlement matrix above — it was independently live-verified on 2026-07-18 (same day) via `scripts/probeProviderEntitlements.js` against production-equivalent credentials, with fixtures captured in `test-fixtures/provider-entitlements/` as evidence (`odds_basketball_wnba_events.json`, `odds_basketball_wnba_player_points.json`, `bdl_wnba_teams.json`, `bdl_wnba_player_stats_sample.json`, `bdl_wnba_player_injuries.json`, etc.). Those fixtures plus the prior audit document stand as the record of authorization for: **Odds API WNBA events/player_points (200, authorized)**, **BDL teams/player_stats/player_injuries (200, authorized, both leagues)**.

### Implemented from verified Odds + BDL + authorized SportsData NBA paths

| Source | What was actually wired into the engines |
|---|---|
| **The Odds API — WNBA `player_points`** (200, authorized, `VERIFIED_AND_USED`) | Feeds `lineMovementClvEngine`'s `openingLine/currentLine`, `openingOverPrice/currentOverPrice` etc., and `availabilityRosterEngine`'s `propMarketActive` check, via the upstream market snapshot the decision engine already builds. |
| **The Odds API — WNBA `events`** (200, authorized) | Provides `gameId`/`commence_time` context passed through `ctx.gameId`. |
| **BallDontLie — `/teams`, `player_stats`, `player_injuries`** (200, authorized, both leagues, `VERIFIED_AND_USED`) | Feeds `gameLogs` (minutes/FGA/FTA/OREB/TOV/points) into `roleVelocityEngine`, `distributionEngine`, `volatilityEngine`, `pacePossessionEngine`, `projectionSanityEngine`; feeds `injuryRow` into `availabilityRosterEngine`. |
| **BallDontLie — games by team (WNBA, `status:"post"`/`home_score`/`away_score`)** | Feeds the honest defense/pace proxy (`wnbaOpponentContextService`, pre-existing) that becomes `ctx.opponentDefenseContext` for `defensiveArchetypeEngine` and `ctx.scoringEnvironmentProxy` for the store-only reference record — never relabeled as true pace. |
| **SportsDataIO — NBA `PlayerGameProjectionStatsByDate`** (200, authorized) | Feeds `ctx.vendorProjection` for `projectionSanityEngine`'s NBA `gapVsVendor` check. |
| **SportsDataIO — NBA fantasy `Players`** (200, authorized) | Available as an NBA secondary identity/context source; not directly consumed by any of the 11 engines' required fields, but present in the upstream pipeline this module reads from. |
| **ESPN** | Grading/verification fallback only, as before — never a primary projection or engine input. |

**Bottom line:** every one of the 11 engines is built to run honestly on exactly this data surface — when the authorized fields exist (BDL box scores, BDL injuries, Odds WNBA lines/prices, SportsData NBA vendor projection), the engines vote or adjust with real numbers; when they don't (BDL team-season baselines, SportsData WNBA anything, SportsData NBA TeamSeasonStats), the affected engines report `available:false` / `quality:UNAVAILABLE` and contribute **zero** vote and **zero** confidence/risk adjustment — never a fabricated neutral value. This is enforced by the `emptyEngineSignal()` helper (§4) and directly tested by the smoke test's first check ("empty ctx (forced) → every engine unavailable or disabled, never throws").

---

## Summary

- **11 engines + evidence-deduplication + static per-league calibration** built, wired into both the NBA (`server.js`) and WNBA (`wnbaDecisionEngine.js`) decision paths, and propagated through `canonicalSealedProp.js` and same-team arbitration without ever touching side, line, or tracking eligibility.
- **75/75 fixture-based unit tests pass**; smoke test and replay tooling inspected and consistent with the same invariants.
- **No live deploy has occurred yet** — §18, §21, §22, §32–§35 are explicitly marked PENDING DEPLOY VERIFY with concrete verification plans, not fabricated results.
- **Provider limitations are fully honest**: BDL team-season averages (404), SportsData WNBA (401), SportsData NBA TeamSeasonStats (401) are all scaffolded as `available:false`, never faked.
- **Lab, Calibration Feedback, six-man slate/track-all-six/same-team subsystems are all confirmed structurally untouched**, with direct evidence (unchanged version constants, unmodified files) rather than assertion.

## Live deploy verification (2026-07-19)

| Check | Result |
|-------|--------|
| Push | `orgin/betbrain-v2-rebuild` @ `6f8370a` |
| `/health` SERVER_BUILD | `courteedge-engine-expansion-v1` |
| `courteEdgeEngineExpansionV1` | true |
| SportsData WNBA secondary | false |
| Projection calibration V2 | false |
| Refresh | completed (`lastUpdated` 2026-07-19T02:52:40Z) |
| Tomorrow Best 6 (display WNBA) | **6/6 TRACK**, all with `courtEdgeEngineSignalsV1` |
| Today Best 6 display | empty (no Today WNBA board games in Chicago bucket at verify time) |
| Active Results | slate `2026-07-17` tracked **6/6** (pre-expansion sealed; intentionally no rewrite) |
| True pace on live board | unavailable (incomplete OREB/TOV) � honest |
| Volatility Under votes | 0 |
| User-facing decision | TRACK only on Best 6 |
| Lab rebuilt | no |
| Calibration Feedback | no |
| History rewritten | no |

### Tomorrow Controlled Best 6 (live)

1. Rhyne Howard Under 18.5 � TRACK � SIG
2. Allisha Gray Over 18.5 � TRACK � SIG
3. Nneka Ogwumike Over 17.5 � TRACK � SIG
4. Arike Ogunbowale Under 13.5 � TRACK � SIG
5. Azura Stevens Over 11.5 � TRACK � SIG
6. Brittney Griner Over 12.5 � TRACK � SIG

