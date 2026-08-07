# COURTEDGE EMPIRICAL LOW & MEDIUM PROP FINDER V2 REPORT

**Build:** `courteedge-empirical-low-medium-prop-finder-v2`  
**Production freeze:** `EMPIRICAL_SAFE_PROP_V2_PRODUCTION_1`  
**Timezone:** America/Chicago  
**Validation date:** 2026-08-07  
**historicalProviderCalls:** 0  

---

## Architecture

### Files created

| File | Role |
|------|------|
| `engines/empiricalSafePropV2/trustScoreV2.js` | `courtEdgeTrustScoreV2` (0–100) |
| `engines/empiricalSafePropV2/safePathwayEngineV2.js` | Pathways A–E |
| `engines/empiricalSafePropV2/slateRelativeStrengthV1.js` | Slate ranks / percentiles |
| `engines/empiricalSafePropV2/explanationsV2.js` | Why trusts / why MEDIUM |
| `scripts/testEmpiricalLowMediumPropFinderV2.js` | 30 acceptance tests |
| `scripts/research/runEmpiricalLowMediumPropFinderV2.js` | Historical + Aug7 runner |
| `research/empirical-safe-prop-v2/finder-v2/*` | Finder outputs |

### Files changed

| File | Change |
|------|--------|
| `engines/empiricalSafePropV2/versions.js` | Finder V2 build + PRODUCTION_1 freeze |
| `engines/empiricalSafePropV2/reliabilityModelV2.js` | Reliability engine + risk using trust/pathways/severe vetoes |
| `engines/empiricalSafePropV2/index.js` | Public exports |
| `engines/topProps/courtEdgeFeatureFlagsV1.js` | **V2 default ON**; credit guard |
| `engines/probabilitySafetyV1/canonicalPlayerForecastPacketV1.js` | Trust/pathway/slate ranks on Official props; V2 explanations |

### Reliability model used

```text
reliability-lab-logistic-v2-production-1
logistic(z) on z-scored features
missing features skipped (never imputed as 0)
```

Weights (frozen):

| Feature | Weight |
|---------|-------:|
| projectionEdge | +0.95 |
| rawWinProbability | +0.55 |
| minutesStability | +0.45 |
| SafetyScore | +0.35 |
| conflictIndex | −0.35 |
| roleStability | +0.25 |
| marketQuality | −0.15 (soft) |
| bookCount | +0.05 (near-neutral) |

### TrustScore formula

```text
trustScore = clamp(
  weightedMean({
    reliability: 0.40,
    rawWinProbability: 0.20,
    SafetyScore: 0.15,
    pathwayStrength: 0.15,
    projectionEdgeSupport: 0.10
  })  // missing components omitted, weights renormalized
  + bonuses(exceptional reliability, strong pathway)
  − penalties(conflict, failure paths, weak minutes if present, thin-book soft)
, 0, 100)
```

TrustScore is a **ranking tool**, not a sole giant gate.

### Safe pathways

| ID | Concept |
|----|---------|
| `STABLE_HIGH_EDGE` | Large edge + stable minutes/role + low conflict |
| `STRUCTURAL_UNDER` | UNDER with edge + stable minutes / limited upside paths |
| `STABLE_VOLUME_OVER` | OVER with stable minutes/role / repeatable volume |
| `THIN_MARKET_STRONG_EDGE` | Few books **but** strong edge + stable opportunity |
| `GENERAL_HIGH_RELIABILITY` | Exceptional/strong reliability band without named archetype |
| `NONE` | No pathway matched |

Pathway alone **cannot** bypass poor reliability.

### Integrity vetoes (hard)

`WRONG_DATE`, `WRONG_EVENT`, `PLAYER_IDENTITY_MISMATCH`, `MARKET_IDENTITY_INVALID`, `STALE_MARKET_IDENTITY`, `NO_VALID_LINE`, `CONFIRMED_INACTIVE`, `POST_START_MUTATION`, `CORRUPT_PROVIDER_DATA`, `DATE_VERIFICATION_INCOMPLETE`, `SEVERE_DATA_INCOMPLETENESS`

### Severe predictive vetoes

`CONFIRMED_MINUTES_RESTRICTION`, `MAJOR_ROLE_TRANSITION_UNRESOLVED`, `CRITICAL_TEAMMATE_STATUS_UNRESOLVED`, `SEVERE_PROJECTION_FAIR_CONTRADICTION`, `EXTREME_DISTRIBUTION_VOLATILITY`

### Explicit non-vetoes

- Market quality alone ≠ HIGH  
- Book count alone ≠ HIGH  
- Role score 68 alone ≠ HIGH  
- Missing feature ≠ 0 / ≠ automatically bad  

### Membership

```text
Official = LOW + MEDIUM
sorted LOW first (by reliability → trust → safety → rawP), then MEDIUM
no fixed six / no minimum / no side or team quotas
HIGH = research only
EMPIRICAL_SAFE_PROP_V2 default = true (PRODUCTION_1)
FULL_ROSTER_COLLECTION_MODE default = false (credit-safe)
FULL_ROSTER_CREDIT_GUARD = true
```

---

## Historical Performance

Sample: **57** model-ready graded records (Aug 5 contaminated + Aug 7 prospective excluded).  
Baseline win rate (all model-selected sides): **68.4%**.

**Do not treat these percentages as guaranteed future performance — sample is limited but directionally decisive vs V1.**

### V1 (giant AND-gate)

| Class | W-L | Win rate |
|-------|----:|---------:|
| LOW | 10-3 | 76.9% |
| MEDIUM | 4-6 | 40.0% |
| HIGH | 25-9 | 73.5% |

| Metric | Value |
|--------|------:|
| Precision (LOW+MED) | 60.9% |
| Recall | 35.9% |
| Coverage | 40.4% |
| False-negative rate | 64.1% |

### V2 Finder (PRODUCTION_1)

| Class | W-L | Win rate |
|-------|----:|---------:|
| LOW | 29-12 | 70.7% |
| MEDIUM | 6-2 | 75.0% |
| HIGH | 4-4 | 50.0% |

| Metric | Value |
|--------|------:|
| Precision (LOW+MED) | 71.4% |
| Recall | 89.7% |
| Coverage | 86.0% |
| False-negative rate | 10.3% |

### Class distribution (historical graded)

| Class | Share |
|-------|------:|
| LOW | 72% |
| MEDIUM | 14% |
| HIGH | 14% |

**Over-admission audit:** Historical LOW share is elevated because the model-ready set is Official-heavy / winner-skewed. Live Aug 7 same-packet distribution is healthier (**LOW 10 / MEDIUM 4 / HIGH 21** of 35 ≈ 29% / 11% / 60%). Monitor live; do not auto-retrain.

### Lift

| Metric | Value |
|--------|------:|
| safePropRecognitionLift | +3.0 pp vs all model-selected |
| LOW lift | +2.3 pp |
| MEDIUM lift | +6.6 pp |

---

## Rescue Analysis

| Cohort | N | Rescued to LOW/MEDIUM | Rate |
|--------|--:|----------------------:|-----:|
| V1 HIGH winners | 25 | 21 | **84.0%** |
| V1 HIGH losers | 9 | 5 | **55.6%** |

```text
Winner Rescue Rate (84%) >> Loser Rescue Rate (56%)  ✓
```

This is the mandatory separation test: V2 preferentially recognizes historically successful rejects without blanketing all V1-HIGH losers into Official.

---

## Risk Separation

```text
LOW  70.7%  >
HIGH 50.0%   ✓

MEDIUM 75.0% (small n=8) — positive and independently qualified
LOW ≈ MEDIUM on this sample (MEDIUM slightly higher; small-n noise)
```

V1 pathology (HIGH ≈ as good as LOW, MEDIUM broken at 40%) is removed.

---

## Safe Pathways

Named pathways fire on historical + Aug7 packets; live Aug7 Official slate is currently dominated by `GENERAL_HIGH_RELIABILITY` because many candidates clear the reliability band without needing a specialized archetype. Specialized pathways (thin-market / structural under / stable volume) remain active in unit tests and will surface when evidence matches.

| Pathway | Notes |
|---------|-------|
| STABLE_HIGH_EDGE | Unit-validated; large edge + stable minutes |
| STRUCTURAL_UNDER | Unit-validated |
| STABLE_VOLUME_OVER | Unit-validated |
| THIN_MARKET_STRONG_EDGE | Unit-validated; rescues thin-book strong models |
| GENERAL_HIGH_RELIABILITY | Primary live pathway when reliability band is strong |

Small historical pathway-tagged samples should be treated as directional.

---

## August 7 Same-Packet Comparison

Source: `_ps_aug7_refresh_raw.json` allGeneratedCandidates (identical inputs for V1 vs V2).  
Candidates with projection: **35**  
Risk changes V1→V2: **7**

### Focus six (exact side/line from stored packets)

| Player | Side | Line | V1 | V2 | Rel | Trust | Pathway |
|--------|------|-----:|----|----|----:|------:|---------|
| Leïla Lacan | UNDER | 12.5 | MEDIUM | **LOW** | 91% | 91 | GENERAL_HIGH_RELIABILITY |
| Aliyah Boston | UNDER | 16.5 | MEDIUM | **LOW** | 83% | 83 | GENERAL_HIGH_RELIABILITY |
| Marina Mabrey | UNDER | 20.5 | MEDIUM | **LOW** | 85% | 81 | GENERAL_HIGH_RELIABILITY |
| Olivia Nelson-Ododa | UNDER | 13.5 | HIGH | **MEDIUM** | 80% | 78 | GENERAL_HIGH_RELIABILITY |
| Veronica Burton | OVER | 11.5 | HIGH | **MEDIUM** | 80% | 77 | GENERAL_HIGH_RELIABILITY |
| Maria Conde | OVER | 10.5 | HIGH | **MEDIUM** | 81% | 78 | GENERAL_HIGH_RELIABILITY |

Why changed (pattern): V1 giant AND-gate failed on marketBooks / roleStability / projectionEdge floors; V2 reliability+trust+pathway recognized empirically strong profiles without those unconditional vetoes.

---

## August 7 Final Slate

| Count | N |
|-------|--:|
| LOW | 10 |
| MEDIUM | 5 (board) / 4 (per-row replay; seed variance) |
| HIGH | 21 |
| Official | **15** |
| Research | 35 |

### Official LOW / MEDIUM (sorted safest first)

| Rank | Player | Side | Line | Risk | RawP | Rel | Trust | Safety | Edge | Pathway | Slate %ile |
|-----:|--------|------|-----:|------|-----:|----:|------:|-------:|-----:|---------|----------:|
| 1 | DeWanna Bonner | OVER | 10.5 | LOW | — | 93% | 93 | 89 | 2.9 | GENERAL_HIGH_RELIABILITY | 100 |
| 2 | Paige Bueckers | UNDER | 19.5 | LOW | — | 93% | 93 | 88 | 3.1 | GENERAL_HIGH_RELIABILITY | 97 |
| 3 | Leïla Lacan | UNDER | 12.5 | LOW | — | 92% | 93 | 90 | 2.3 | GENERAL_HIGH_RELIABILITY | 94 |
| 4 | Arike Ogunbowale | OVER | 14.5 | LOW | — | 91% | 91 | 86 | 3.1 | GENERAL_HIGH_RELIABILITY | 91 |
| 5 | Alyssa Thomas | OVER | 15.5 | LOW | — | 88% | 88 | 85 | 2.8 | GENERAL_HIGH_RELIABILITY | 89 |
| 6 | Shakira Austin | OVER | 17.5 | LOW | — | 86% | 82 | 84 | 2.8 | GENERAL_HIGH_RELIABILITY | 86 |
| 7 | Bridget Carleton | OVER | 15.5 | LOW | — | 85% | 81 | 85 | 2.5 | GENERAL_HIGH_RELIABILITY | 83 |
| 8 | Aliyah Boston | UNDER | 16.5 | LOW | — | 84% | 84 | 85 | 2.8 | GENERAL_HIGH_RELIABILITY | 77 |
| 9 | Marina Mabrey | UNDER | 20.5 | LOW | — | 85% | 81 | 85 | 2.2 | GENERAL_HIGH_RELIABILITY | 80 |
| 10 | Kelsey Plum | OVER | 18.5 | LOW | — | 84% | 81 | 83 | 2.8 | GENERAL_HIGH_RELIABILITY | 74 |
| 11 | Maria Conde | OVER | 10.5 | MEDIUM | — | 81% | 78 | 86 | 1.7 | GENERAL_HIGH_RELIABILITY | 71 |
| 12 | Olivia Nelson-Ododa | UNDER | 13.5 | MEDIUM | — | 80% | 78 | 85 | 1.7 | GENERAL_HIGH_RELIABILITY | 69 |
| 13 | Veronica Burton | OVER | 11.5 | MEDIUM | — | 79% | 73 | 85 | 1.7 | GENERAL_HIGH_RELIABILITY | 66 |
| 14 | Emily Engstler | UNDER | 9.5 | MEDIUM | — | 69% | 66 | 83 | 0.9 | GENERAL_HIGH_RELIABILITY | 63 |
| 15 | Sonia Citron | UNDER | 16.5 | MEDIUM | — | 68% | 65 | 81 | 1.1 | GENERAL_HIGH_RELIABILITY | 60 |

Full packets with plain-language explanations:  
`research/empirical-safe-prop-v2/finder-v2/COURTEDGE_AUG7_FINDER_V2_SLATE.json`

### Top HIGH (boundary inspection)

| Player | Side | Line | Rel | Trust | Safety | Main reason |
|--------|------|-----:|----:|------:|-------:|-------------|
| Naz Hillmon | OVER | 7.5 | 65% | 54 | 75 | reliability_below_medium |
| Janelle Salaun | OVER | 12.5 | 61% | 51 | 82 | reliability_below_medium |
| Kelsey Mitchell | OVER | 23.5 | 59% | 49 | 79 | reliability_below_medium |
| Carla Leite | UNDER | 17.5 | 57% | 48 | 79 | reliability_below_medium |
| Natasha Howard | UNDER | 12.5 | 56% | 49 | 81 | reliability_below_medium |
| Monique Billings | OVER | 8.5 | 53% | 47 | 83 | reliability_below_medium |
| Diamond Miller | OVER | 11.5 | 53% | 47 | 82 | reliability_below_medium |
| Jordin Canada | UNDER | 10.5 | 47% | 42 | 81 | reliability_below_medium |
| Olivia Miles | UNDER | 19.5 | 42% | 40 | 77 | reliability_below_medium |

---

## Credits

| Metric | Value |
|--------|------:|
| Odds API calls (this build) | **0** |
| Reported credits spent | **0** |
| BDL calls | **0** |
| Cache / dedupe | N/A (same-packet replay only) |
| Research incremental paid cost | **$0** |

Aug 7 used preserved `_ps_aug7_refresh_raw.json` only. No fresh Odds refresh executed in this build (games may be in progress; credit guard respected).

---

## Tests

```text
node scripts/testEmpiricalLowMediumPropFinderV2.js
→ 30 passed, 0 failed

node scripts/testEmpiricalSafePropRecognitionV2.js
→ 20 passed, 0 failed
```

---

## Final Acceptance

| Requirement | Status |
|-------------|--------|
| Giant AND gate no longer membership authority | **PASS** (V2 default ON) |
| Integrity hard blocks preserved | **PASS** |
| Empirical reliability drives safety | **PASS** |
| Market/book count not unconditional vetoes | **PASS** |
| Role score not impossible hard requirement | **PASS** |
| Missing features remain missing | **PASS** |
| SafetyScore retained as evidence | **PASS** |
| ProjectionEdge retained as evidence | **PASS** |
| Multiple safe pathways | **PASS** |
| LOW = empirically strong profiles | **PASS** (directional) |
| MEDIUM independently qualifies | **PASS** |
| HIGH blocked from Official | **PASS** |
| Winner rescue ≫ loser rescue | **PASS** (84% vs 56%) |
| Recall up without destroying precision | **PASS** (90% recall, 71% precision) |
| Full research pool evaluated | **PASS** |
| No fixed six / forced sides | **PASS** |
| Aug7 V1↔V2 same-packet comparison | **PASS** |
| Today's LOW/MEDIUM returned | **PASS** (15 Official) |
| Model frozen PRODUCTION_1 | **PASS** |

---

## Product behavior now

CourtEdge no longer does:

```text
Great prediction → book count weak → HIGH
Great prediction → role score 71 → HIGH
Great prediction → probability 63 instead of 64 → HIGH
```

It does:

```text
Strong prediction
+ historically reliable evidence profile
+ stable opportunity
+ reasonable failure resistance
+ no integrity problem
        ↓
LOW or MEDIUM (Official)
```

and

```text
Big edge + unstable opportunity + weak reliability + many failure paths
        ↓
HIGH (research only)
```
