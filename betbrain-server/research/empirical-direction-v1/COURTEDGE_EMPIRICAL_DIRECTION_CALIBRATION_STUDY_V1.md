# CourtEdge Empirical Direction Calibration Study V1

**Study:** `courteedge-empirical-direction-calibration-study-v1`  
**Generated:** 2026-08-09T16:41:36.114Z  
**C2:** unchanged  
**Aug 9:** HOLD — not used  
**Production direction engine:** not wired yet

---

## Purpose

Learn which **pregame** signals separate:

- winning Overs vs losing Overs
- winning Unders vs losing Unders
- and when the correct action is **NO BET**

before building the production flow:

`ALL MARKETS → DATA VALIDITY → DIRECTION (O/U/NO BET) → C2 → LOW/MEDIUM → OFFICIAL`

---

## Frozen Aug 8 completed research dataset

| Item | Value |
|------|-------|
| Source | `research/empirical-safe-prop-v2/aug8-graded/COURTEDGE_AUG8_FROZEN_RESEARCH_GRADED_V1.json` |
| Count | **18** |
| Research record | **8-10** |
| Official (Young/Boston) | **2-0** |
| Freeze pointer | `research/empirical-direction-v1/COURTEDGE_AUG8_COMPLETED_RESEARCH_DATASET_FREEZE_V1.json` |

---

## Study universe (eligible, deduped)

| Cohort | n | W-L | Win rate |
|--------|---|-----|----------|
| OVER | 85 | 51-34 | 0.6 |
| UNDER | 104 | 54-50 | 0.5192 |
| ALL | 189 | | 0.5556 |

**Excluded slates:** 2026-08-05, 2026-08-07, 2026-08-09

**By source:** {"AUG8_FROZEN_RESEARCH_GRADED":18,"V2_EXPANDED_MODEL_READY":57,"V2_REJECTED_GRADED":114}

**Signal richness:** {"FULL_V2_PACKET":18,"REPLAY_V2":57,"PARTIAL":114}

---

## Winning vs losing Overs

### OVER_WIN vs OVER_LOSS feature means

| Feature | Win mean (n) | Loss mean (n) | Δ (win−loss) | Separates |
|---|---|---|---|---|
| directionalEdge | 2.649 (51) | 1.5088 (34) | 1.1402 | DIRECTIONAL |
| fairDirectionalEdge | 3.8649 (37) | 1.7571 (21) | 2.1078 | DIRECTIONAL |
| edge | 4.0632 (19) | 2.5111 (9) | 1.5521 | DIRECTIONAL |
| rawP | 0.8022 (19) | 0.754 (9) | 0.0482 | WEAK |
| reliability | 0.7766 (19) | 0.6987 (9) | 0.0779 | DIRECTIONAL |
| safety | 78.8947 (19) | 73.1111 (9) | 5.7836 | DIRECTIONAL |
| trust | 41.4 (5) | 22 (2) | 19.4 | INSUFFICIENT_N |
| expectedMinutes | 80.6444 (18) | 80.3143 (7) | 0.3301 | MODEST |
| avgMinutesL5 | 29.5765 (34) | 29.5917 (24) | -0.0152 | WEAK |
| roleStability | 72.7778 (18) | 72.5714 (7) | 0.2064 | MODEST |
| marketQuality | 79.8889 (18) | 86 (7) | -6.1111 | DIRECTIONAL |
| bookCount | 2.9318 (44) | 3.5862 (29) | -0.6544 | DIRECTIONAL |
| conflictIndex | 4.9474 (19) | 6.7778 (9) | -1.8304 | DIRECTIONAL |
| majorFailurePathCount | 1 (5) | 1 (2) | 0 | INSUFFICIENT_N |
| expectedFGA | 13.4088 (34) | 12.6333 (24) | 0.7755 | DIRECTIONAL |
| avgPointsL5 | 19.1548 (31) | 14.8421 (19) | 4.3127 | DIRECTIONAL |

### OVER hit rate by directionalEdge

| Range | n | W-L | Win rate |
|---|---|---|---|
| [-99, 0) | 5 | 2-3 | 0.4 |
| [0, 1) | 22 | 9-13 | 0.4091 |
| [1, 1.5) | 8 | 5-3 | 0.625 |
| [1.5, 2.5) | 18 | 10-8 | 0.5556 |
| [2.5, 4) | 18 | 14-4 | 0.7778 |
| [4, 99) | 14 | 11-3 | 0.7857 |

### OVER hit rate by reliability

| Range | n | W-L | Win rate |
|---|---|---|---|
| [0, 0.35) | 6 | 4-2 | 0.6667 |
| [0.35, 0.45) | 0 | 0-0 | — |
| [0.45, 0.55) | 0 | 0-0 | — |
| [0.55, 0.65) | 0 | 0-0 | — |
| [0.65, 0.75) | 3 | 2-1 | 0.6667 |
| [0.75, 1.01) | 19 | 13-6 | 0.6842 |

**Top OVER separators:** marketQuality, safety, avgPointsL5, fairDirectionalEdge, conflictIndex, edge, directionalEdge, expectedFGA, bookCount, reliability

---

## Winning vs losing Unders

### UNDER_WIN vs UNDER_LOSS feature means

| Feature | Win mean (n) | Loss mean (n) | Δ (win−loss) | Separates |
|---|---|---|---|---|
| directionalEdge | 3.5889 (54) | 1.19 (50) | 2.3989 | DIRECTIONAL |
| fairDirectionalEdge | 3.9532 (47) | 1.3176 (34) | 2.6356 | DIRECTIONAL |
| edge | 3.6286 (28) | 1.4263 (19) | 2.2023 | DIRECTIONAL |
| rawP | 0.8292 (28) | 0.7268 (19) | 0.1024 | DIRECTIONAL |
| reliability | 0.7722 (28) | 0.5097 (19) | 0.2625 | DIRECTIONAL |
| safety | 75.9643 (28) | 68.6842 (19) | 7.2801 | DIRECTIONAL |
| trust | 36 (3) | 34.75 (8) | 1.25 | INSUFFICIENT_N |
| expectedMinutes | 90.928 (25) | 66.0889 (18) | 24.8391 | DIRECTIONAL |
| avgMinutesL5 | 28.0622 (45) | 27.075 (32) | 0.9872 | DIRECTIONAL |
| roleStability | 74.64 (25) | 65.2222 (18) | 9.4178 | DIRECTIONAL |
| marketQuality | 59.76 (25) | 88.8889 (18) | -29.1289 | DIRECTIONAL |
| bookCount | 2.2245 (49) | 3.6585 (41) | -1.434 | DIRECTIONAL |
| conflictIndex | 10.1786 (28) | 14.3158 (19) | -4.1372 | DIRECTIONAL |
| majorFailurePathCount | 1.3333 (3) | 1.125 (8) | 0.2083 | INSUFFICIENT_N |
| expectedFGA | 9.6867 (45) | 9.3625 (32) | 0.3242 | MODEST |
| avgPointsL5 | 12.4 (41) | 12 (26) | 0.4 | MODEST |

### UNDER hit rate by directionalEdge

| Range | n | W-L | Win rate |
|---|---|---|---|
| [-99, 0) | 14 | 3-11 | 0.2143 |
| [0, 1) | 19 | 8-11 | 0.4211 |
| [1, 1.5) | 18 | 9-9 | 0.5 |
| [1.5, 2.5) | 19 | 10-9 | 0.5263 |
| [2.5, 4) | 13 | 4-9 | 0.3077 |
| [4, 99) | 21 | 20-1 | 0.9524 |

### UNDER hit rate by reliability

| Range | n | W-L | Win rate |
|---|---|---|---|
| [0, 0.35) | 11 | 3-8 | 0.2727 |
| [0.35, 0.45) | 2 | 1-1 | 0.5 |
| [0.45, 0.55) | 1 | 0-1 | 0 |
| [0.55, 0.65) | 4 | 2-2 | 0.5 |
| [0.65, 0.75) | 1 | 1-0 | 1 |
| [0.75, 1.01) | 28 | 21-7 | 0.75 |

**Top UNDER separators:** marketQuality, expectedMinutes, roleStability, safety, conflictIndex, fairDirectionalEdge, directionalEdge, edge, bookCount, avgMinutesL5, reliability, rawP

---

## Conflict (all sides)

### Hit rate by conflictIndex

| Range | n | W-L | Win rate |
|---|---|---|---|
| [0, 15) | 58 | 40-18 | 0.6897 |
| [15, 25) | 10 | 4-6 | 0.4 |
| [25, 40) | 2 | 0-2 | 0 |
| [40, 60) | 5 | 3-2 | 0.6 |
| [60, 999) | 0 | 0-0 | — |

---

## NO BET rule candidates (empirical, not production)

### NO_BET_WEAK_DIRECTIONAL_EDGE

When |directionalEdge| < 1.0, prefer NO BET unless other strong side evidence agrees.

```json
{
  "overWinRateEdgeLt1": 0.4074,
  "overWinRateEdgeGe2": 0.6757,
  "nLow": 27,
  "nHigh": 37
}
```

### NO_BET_LOW_RELIABILITY

reliability < 0.45 → NO BET candidate; C2 should not see forced weak directions.

```json
{
  "lowRelWinRate": 0.4211,
  "highRelWinRate": 0.7255,
  "nLow": 19,
  "nHigh": 51
}
```

---

## Interim conclusions (study only)

1. **Direction must be decided before C2** — safety/reliability alone do not choose OVER vs UNDER.
2. Use **side-aware directionalEdge** (projection−line for OVER; line−projection for UNDER) as the primary geometric signal.
3. Stratify **Overs and Unders separately** — separators may not be symmetric.
4. **NO BET** is a first-class outcome when edge is weak, conflict is high, or reliability is low.
5. Full V2 packet features (trust, failure paths, minutesStability) are densest on Aug 8; historical rows often rely on `replay.v2` — treat richness strata separately when freezing production weights.
6. **Do not train on Aug 9** until that slate finishes and is explicitly released.

---

## Next steps (explicitly not done here)

1. Freeze direction logic thresholds from this study + any needed Aug 7 graded release
2. Implement production DIRECTION ENGINE (OVER / UNDER / NO BET)
3. Close flood gates: only valid directional predictions enter C2
4. Keep C2 safety/reliability unchanged except as consumer of directed props

## Artifacts

- `research/empirical-direction-v1/COURTEDGE_EMPIRICAL_DIRECTION_STUDY_ROWS_V1.json`
- `research/empirical-direction-v1/COURTEDGE_EMPIRICAL_DIRECTION_STUDY_ANALYSIS_V1.json`
- `research/empirical-direction-v1/COURTEDGE_AUG8_COMPLETED_RESEARCH_DATASET_FREEZE_V1.json`
- `scripts/research/runEmpiricalDirectionCalibrationStudyV1.js`
