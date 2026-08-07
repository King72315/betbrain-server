# COURTEDGE EMPIRICAL SAFE-PROP V2 — CALIBRATION_2 REPORT

**Build:** `courteedge-empirical-low-medium-prop-finder-v2`  
**Freeze:** `EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2`  
**Status:** Not production. Architecture kept; calibration in progress.  
**Odds historicalProviderCalls:** 0  
**ESPN research box-score fetches:** used only to join actual points for recovered rejects  

---

## Verdict (matches your call)

| Area | Status |
|------|--------|
| Prediction recognition architecture | ✅ Kept |
| Missing-data handling | ✅ Kept |
| Market/book/role soft (not hard veto) | ✅ Kept |
| Ability to rescue good V1-HIGH predictions | ✅ Still present, sharper |
| LOW/MEDIUM calibration | ⚠️ Improved, still not “done” |
| Historical recovery ingest | ✅ Completed this pass |
| Aug7 “10 LOW” as proven low risk | ❌ Treated as V2 candidates only |
| Production activation | ❌ Reverted to default **OFF** |

---

## 1. Historical recovery — done

Mariah’s unused pools were ingested and graded:

| Source | Role |
|--------|------|
| `.durable-mirror-v1/home-day__*` (+ root twins) | allGenerated + Official; TOMORROW → date+1 |
| `freeze-2026-07-15-*` | slim + before-evidence |
| Jul19 audits / picks dumps | audit rows + projection backfill |
| Sibling Jul20/21 `picks.json` captures | allGenerated |
| Aug3 autopsy registry | rejected with outcomes |
| Local archives/tracked | actuals |
| ESPN public box scores | actuals for non-Official players (not Odds) |

### Yield

| Metric | Prior V2 | After recovery |
|--------|--------:|---------------:|
| Unique graded rejected | ~6 | **126** |
| Rejected W / L | — | **64 / 62** |
| Expanded model-ready graded | 57 | **171** (57 base + 114 net new) |

Artifacts:

- `research/empirical-safe-prop-v2/exports/COURTEDGE_RECOVERED_REJECTED_GRADED_V2.json`
- `research/empirical-safe-prop-v2/exports/COURTEDGE_ESPN_ACTUALS_INDEX_V2.json`
- `research/empirical-safe-prop-v2/exports/COURTEDGE_EMPIRICAL_SAFE_PROP_MODEL_READY_V2_EXPANDED.json`
- `scripts/research/recoverRejectedCandidatePoolsV2.js`
- `scripts/research/fetchEspnActualsForRecoveryV2.js`

---

## 2. Selective LOW second stage

Recognition and LOW are no longer the same decision.

1. **Stage 1 — recognition (MEDIUM+):** serious consideration (reliability / trust / pathway floors).
2. **Stage 2 — selective LOW:** among recognized only — higher reliability (0.84), trust (80), tighter conflict/fails, Safety floor, missing-feature cap, pathway-or-exceptional requirement.

No return to the giant AND-gate. Market/book/role alone still cannot force HIGH.

Production flag: `EMPIRICAL_SAFE_PROP_V2` default **`false`**. Research runners set it explicitly.

---

## 3. Validation after recovery + CALIBRATION_2

Sample: **171** graded (expanded). Baseline WR ≈ 56.7%.

### Detector (LOW+MEDIUM as “qualified”)

| | V1 | V2 CALIBRATION_2 | Prior V2 (n=57) |
|--|---:|---------------:|----------------:|
| Precision | 61.1% | **67.0%** | 71.4% |
| Recall | 22.7% | **62.9%** | 89.7% |
| FNR | 77.3% | **37.1%** | 10.3% |
| Coverage | 21.1% | **53.2%** | 86% |

### Risk bands (historical)

| Band | W-L | Win rate | Share of sample |
|------|----:|--------:|----------------:|
| LOW | **34-7** | **82.9%** | **24%** (was 72%) |
| MEDIUM | 27-23 | 54.0% | 29% |
| HIGH | 36-44 | 45.0% | **47%** (was 14%) |

This is the middle: not 0 qualified, not “almost everything LOW/MEDIUM.”

### Rescue (V1-HIGH → V2 LOW/MEDIUM)

| | Prior V2 | CALIBRATION_2 |
|--|--------:|--------------:|
| Winner rescue | 84% | **52%** (39/75) |
| Loser rescue | 56% | **26.7%** (16/60) |
| Separation (W−L) | 28pp | **25.3pp** |

**Selective LOW rescue only (among V1-HIGH):**

| | Rate |
|--|-----:|
| Winner → V2 LOW | **21.3%** (16/75) |
| Loser → V2 LOW | **1.7%** (1/60) |

Loser rescue is now in the ~20–35% example band. Winner rescue is lower than the ~75–85% example — tradeoff for stopping over-trust. Next tuning should raise winner rescue **without** pushing loser rescue back above ~35%.

---

## 4. August 7 — candidates, not proven LOW

Same-packet Official under CALIBRATION_2 (**15** props):

**LOW (7)** — treat as V2 candidates, not proven actual low risk:

- Bonner, Bueckers, Arike, Alyssa Thomas, Austin, Boston, Plum

**MEDIUM (8)** — recognized / serious consideration:

- Lacan, Carleton, Mabrey, Conde, Nelson-Ododa, Burton, Engstler, Citron

Vs prior over-trusting freeze: **10 LOW → 7 LOW**, with more of the slate in MEDIUM/HIGH. Still a large swing vs V1’s 0 Official — keep under shadow until more graded nights confirm LOW WR.

Focus six: Lacan/Boston/Mabrey recognized (Boston Official LOW; Lacan/Mabrey MEDIUM); Nelson-Ododa/Burton/Conde → MEDIUM (rescued from V1 HIGH).

---

## 5. What is still not done

1. Winner rescue still below the aspirational 75–85% band (on purpose for now).
2. MEDIUM band WR (~54%) is only near baseline — recognition may still be a bit wide.
3. Production remains **off**; do not declare Aug7 LOWs “actual low risk.”
4. Full raw-line universe still not archived (board/allGenerated scale only).

---

## 6. Recommended next correction (not a redesign)

Keep this architecture. Next pass should:

1. Tune **MEDIUM recognition** to lift winner rescue toward ~70%+ while holding loser rescue ≤ ~35%.
2. Keep **LOW** as the sharp second stage (current LOW W-L 34-7 / loser→LOW 1.7% is the right shape).
3. Accumulate more graded nights under shadow before flipping the production default.
