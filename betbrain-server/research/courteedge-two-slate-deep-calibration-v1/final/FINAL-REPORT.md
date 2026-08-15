# CourtEdge Two-Slate Deep Calibration V1 — Final Report

**Verdict:** `COURTEDGE_TWO_SLATE_DEEP_CALIBRATION_V1_TECHNICAL_PASS_PROSPECTIVE_PENDING`

**Product Truth mutated:** NO  
**Unrelated systems changed:** NONE

---

## GIT

| Item | Value |
|------|-------|
| Starting HEAD | `2f59e941d4f7463baab2d782688aa90168ad4189` |
| Checkpoint tag | `courteedge-pre-two-slate-deep-calibration-v1` |
| Rollback branch | `courteedge-rollback-two-slate-deep-calibration-v1` |
| Working branch | `feature/courteedge-decision-engine-v2` |
| Ending state | pending commit of calibration diffs |

---

## 8/13 (PRE-V3 incomplete stack)

| Slice | Record |
|-------|--------|
| Full | 26-19 (57.8%) |
| PTS | 7-8 |
| REB | 10-5 |
| AST | 9-6 |
| OVER | 10-9 |
| UNDER | 16-10 |
| Home weave | 5-5 |
| Official | 0 |

Not identical architecture to 8/14 — forensic only.

---

## 8/14 (V3 full stack) — IMMUTABLE PRODUCT TRUTH

| Slice | W-L-P | Hit |
|-------|-------|-----|
| **Full** | **24-26-0** | 48.0% |
| PTS | 6-13-0 | 31.6% |
| REB | 9-8-0 | 52.9% |
| AST | 9-5-0 | 64.3% |
| OVER | 10-16-0 | 38.5% |
| UNDER | 14-10-0 | 58.3% |
| **Trusted** | **7-8-0** | 46.7% |
| **Best** | **3-7-0** | 30.0% |

Trusted: 15/15 OVER · Best: 10/10 POINTS OVER · Full sides: 26 OVER / 24 UNDER

---

## PROVEN ROOT CAUSES

1. **REB/AST `projectionBias` poison** — thin bet-corpus means (+2.1 / +4.3) overrode gold residual priors (~0). `correctedProjection` jumped (e.g. AST 1.7→6), inverting UNDER `signedGap`. `decisionScoreV2` collapsed to ~0.31 while `predictedProbability` stayed ~0.75.
2. **Trusted/Best ranked by poisoned `decisionScoreV2`** — Overs occupied top ranks → all-Over Trusted/Best despite balanced Full.
3. **No soft shared-failure / HIGH+Safety demotion** — 14/15 Trusted HIGH; multi-prop same-player clusters admitted independently.

## PROVEN NON-CAUSES

- Market weave / per-stat caps / line shopping / frozen field mutation
- “Overs are bad” historically (OVER ~55% vs UNDER ~50.5% on graded corpus)
- Automatic HIGH Risk ban (winners also mostly HIGH)

---

## PRODUCTION CHANGES (minimal)

1. `fitStatProjectionModels` — prefer gold REB/AST residual prior bias when corpus sample &lt;100 (`prior-preferred-sparse-corpus`)
2. Cap `qualityProbFloor` at **0.58**
3. Soft Trusted exposure penalties (continuous; **no quotas**): same-player, same-game, side concentration, HIGH + Safety&lt;70 demotion

### Files

- `services/courtEdgeDecisionEngineV2.js`
- `decision-engine-v2-model.json` (retrained)
- `scripts/testCourtEdgeDecisionEngineV2.js`
- `scripts/research/runTwoSlateDeepCalibrationCounterfactualV1.js`
- `research/courteedge-two-slate-deep-calibration-v1/**`

---

## 8/14 SHADOW AFTER (not Product Truth)

| Metric | Before | After (shadow) |
|--------|--------|----------------|
| Trusted N | 15 | 4 |
| Trusted sides | 15 OVER / 0 UNDER | 3 OVER / 1 UNDER |
| Trusted W-L | 7-8 | 3-1 |
| Top15 sides | 15/0 | 6 OVER / 9 UNDER |
| Top10 hit | anti-lift | **70%** vs Full 48% |
| Mean Under decisionScore | 0.383 | **0.548** |
| Mean Over decisionScore | 0.572 | **0.554** |

Alanna AST UNDER repro: corrected 6.0→**1.68**, P 0.31→**0.60**

---

## TESTS

`node scripts/testCourtEdgeDecisionEngineV2.js` — **PASSED**  
(includes sparse-prior bias + soft exposure + walk-forward)

---

## WHAT REQUIRES MORE FUTURE GAMES

- POINTS corpus bias ~+1.9 (no gold PTS warehouse yet)
- Soft exposure magnitude tuning across prospective cohorts
- Best Available diversification on freshly ingested scores

---

## FINAL VERDICT

**COURTEDGE_TWO_SLATE_DEEP_CALIBRATION_V1_TECHNICAL_PASS_PROSPECTIVE_PENDING**

Machine repaired for future freezes. Original 8/13 and 8/14 Product Truth untouched. Next slates are prospective calibration cohorts.
