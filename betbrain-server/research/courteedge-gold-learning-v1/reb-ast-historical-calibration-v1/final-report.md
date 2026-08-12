# CourtEdge REB/AST Historical Calibration V1 — Final Report

## Marker

`COURTEDGE_REB_AST_HISTORICAL_CALIBRATION_V1_PASS`

## Git

| Item | Value |
|------|-------|
| Starting HEAD | `6895f75` (PRA multistat) |
| Checkpoint | `courteedge-pre-reb-ast-historical-calibration-v1` → `4433cb4` |
| Feature branch | `feature/courteedge-reb-ast-historical-calibration-v1` |
| Ending HEAD | `edaa821` |
| Commit | Calibrate REB/AST from historical ESPN replay without Odds refresh. |
| Odds API refresh | **Not run** (intentional) |

## Historical data

Source: ESPN public WNBA box scores (`espn-player-game-logs-v1.json`), 2026-05-16 → 2026-08-11.

- Odds historicalProviderCalls: **0**
- ESPN research fetches: **314**
- Player-game rows: **4441**

### REBOUNDS / ASSISTS replay tiers (shared chronological rows)

| Tier | N |
|------|---|
| GOLD | 3419 |
| SILVER | 390 |
| FORENSIC | 202 |
| EXCLUDED | 430 |

Primary calibration cohort: **GOLD only** (n=3419). Leak-free: L5/L10/season use only games **before** target date.

## Projection calibration

### REBOUNDS (GOLD)

| Metric | Value |
|--------|-------|
| N | 3419 |
| MAE | 1.72 |
| Median AE | 1.30 |
| Signed bias | −0.068 |
| RMSE | 2.30 |

### ASSISTS (GOLD)

| Metric | Value |
|--------|-------|
| N | 3419 |
| MAE | 1.26 |
| Median AE | 0.90 |
| Signed bias | −0.017 |
| RMSE | 1.71 |

## Residual distributions

Distinct per propType (never reuse Points variance).

| | REB | AST |
|--|-----|-----|
| mean residual | ~−0.07 | ~−0.02 |
| MAE | 1.72 | 1.26 |
| std | 2.30 | 1.71 |
| P10 | −2.6 | −1.8 |
| P90 | +2.9 | +2.1 |

## Probability

Method: **empirical residual CDF**

```text
actual ≈ projection + residual
pOver  = P(projection + r > line) over historical residuals
```

Provenance stamp: `probabilityCalibrationSource = HISTORICAL_STAT_RESIDUAL_V1`

Not market-calibrated. Sportsbook edge remains DEVELOPING.

## Safety

Environment-only factors (minutes stability, starter, variance, completeness).

Historical absolute-MAE quintile test: **weak / non-monotonic** on this ESPN-only feature set (`higherSafetyLowerError = false`).

Status: **INITIAL_CALIBRATED** (not ACTIVE) — weights informed by history, discrimination vs absolute error still limited without teammate/pace richness.

## RiskV2

Same `riskV2` owner; prop-type failure factors underneath.

Validated on **relative MAE** (absolute MAE is volume-dominated).

REBOUNDS relativeMae: LOW 0.41 < MEDIUM 0.65 < HIGH 0.78 → ordered.

ASSISTS relativeMae: LOW 0.48 ≤ HIGH 0.61 → directionally ordered.

Status: **INITIAL_CALIBRATED**

## Fair line

Season-primary fair vs recent-rate projection.

Projection↔fair correlation ≈ **0.989** → `DISTINCT_ENOUGH` (flagged earlier when ~0.999).

## Feature ablation

Offline proxies (season-prior vs full). Deltas small; teammate/pace families sparse in ESPN-only dump — reported with sample limitation. Do not remove core minutes/form from tiny ablation deltas alone.

## Feature ownership

Registry audit PASS (FGA / reboundShare / assistRate roles correct).

## Calibration status

### POINTS
projection/residual/safety/risk/probability/marketEdge = **ACTIVE**; officialRankScoreStatus = **CALIBRATED**

### REBOUNDS
| Component | Status |
|-----------|--------|
| projection | ACTIVE |
| residualDistribution | ACTIVE |
| safety | INITIAL_CALIBRATED |
| risk | INITIAL_CALIBRATED |
| probability | INITIAL_CALIBRATED |
| marketEdge | **DEVELOPING** |
| officialRankScoreStatus | INITIAL_CALIBRATED |

### ASSISTS
Same pattern as REBOUNDS.

No “new market −5” penalty. No quotas.

## UI

Home filters: **ALL | POINTS | REBOUNDS | ASSISTS** (presentation only; membership unchanged).

## Ledgers

Per-stat Full / Best Available / Certified structures present.

REB/AST **betting** ledgers start at **0** (no synthetic W-L).

Model-quality ledgers hold projection N/MAE/bias/RMSE.

## Tests

- `npm run test:courtedge-pra-multistat` — PASS
- `npm run test:courtedge-reb-ast-calib` — PASS

## Architecture

Authority map + DAG audits: **PASS** (one owner per decision; no Probability↔Safety cycles).

POINTS mean calibration gated to POINTS only.

## Remaining limitations (genuine)

1. **marketEdge** requires prospective sportsbook freezes + grades (not available historically for REB/AST lines).
2. Safety absolute-error discrimination is weak on ESPN-only environment features.
3. Teammate competition / pace / opponent FG% sparse offline — live BDL context will enrich later.
4. Fair line still correlated with projection (~0.99) because both use season/recent RPG/APG; processes are intentionally different recipes but not orthogonal signals.
5. Live Odds API refresh intentionally deferred — home checklist remains.

## Home-ready checklist

1. checkout `feature/courteedge-reb-ast-historical-calibration-v1`
2. confirm clean working tree
3. start server/app
4. run exactly **ONE** clean WNBA refresh
5. capture provider credit headers
6. verify candidate counts: POINTS / REBOUNDS / ASSISTS
7. verify non-null projections
8. inspect mixed Official board
9. freeze slate
10. later grade all markets
