# EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2 — FREEZE + SCORECARD

**Freeze ID:** `EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2`  
**Status:** FROZEN FOR PROSPECTIVE COLLECTION — no Calibration 3, no retuning  
**Odds historicalProviderCalls:** 0  
**Sample:** 171 graded (expanded model-ready)

## Locked

- Reliability coefficients (`reliability-lab-logistic-v2-calibration-2`)
- Trust formula (`trust-score-v2-calibration-2`)
- LOW logic / MEDIUM logic / Pathways
- Conflict treatment / Missingness treatment / Market treatment

Manifest: `EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2_FREEZE.json` (file SHA-256 hashes)

---

## Expanded 171-set — risk bands

| Risk | Count | W-L | Win % | Avg margin |
|------|------:|----:|------:|-----------:|
| LOW | 41 | 34-7 | 82.9% | 1.94 |
| MEDIUM | 50 | 27-23 | 54.0% | 0.38 |
| HIGH | 80 | 36-44 | 45.0% | -0.63 |

**Separation (full sample):** LOW strongest=true; MEDIUM > HIGH=true; HIGH weakest=true

---

## V1 HIGH → V2 transitions (the population V1 could not understand)

| Transition | Count | Wins | Losses | Win rate | Avg margin |
|------------|------:|-----:|-------:|---------:|-----------:|
| V1 HIGH → V2 LOW | 17 | 16 | 1 | 94.1% | 2.32 |
| V1 HIGH → V2 MEDIUM | 38 | 23 | 15 | 60.5% | 0.95 |
| V1 HIGH → V2 HIGH | 80 | 36 | 44 | 45.0% | -0.63 |

---

## Chronological out-of-sample

Train dates: 2026-07-15, 2026-07-16, 2026-07-17, 2026-07-19, 2026-07-20, 2026-07-22, 2026-07-28, 2026-07-29  
Test dates: 2026-07-30, 2026-07-31, 2026-08-01, 2026-08-02, 2026-08-03, 2026-08-06

### Train

| Risk | Count | W-L | Win % | Avg margin |
|------|------:|----:|------:|-----------:|
| LOW | 28 | 22-6 | 78.6% | 2.82 |
| MEDIUM | 38 | 17-21 | 44.7% | 0.47 |
| HIGH | 66 | 30-36 | 45.5% | -0.26 |

### Test (untouched later slates)

| Risk | Count | W-L | Win % | Avg margin |
|------|------:|----:|------:|-----------:|
| LOW | 13 | 12-1 | 92.3% | 0.04 |
| MEDIUM | 12 | 10-2 | 83.3% | 0.08 |
| HIGH | 14 | 6-8 | 42.9% | -2.36 |

**Test separation:** LOW strongest=true; MEDIUM > HIGH=true; ordering={"LOW":0.9230769230769231,"MEDIUM":0.8333333333333334,"HIGH":0.42857142857142855}

---

## Philosophy (frozen)

Prediction finds the side → Reliability recognizes good predictions → LOW = elite → MEDIUM = worthwhile not elite → HIGH = protect.

**Next scientific focus after prospective collection:** MEDIUM recognition recall — without weakening LOW.

**Production:** remains OFF until prospective results confirm the separation on live nights.
