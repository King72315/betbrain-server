# Direction V2 Rescue Study 1

**Status:** STUDY ONLY — V1 PRODUCTION_1 remains Official Direction authority  
**Generated:** 2026-08-10T10:18:59.502Z  
**Universe:** n=189 (same Direction V1 study rows)

## Architecture under test

```text
PRIMARY GATE (O2.5 / U4, missing ≠ clear-pass)
        ↓ fail
NEAR-MISS?
        ↓ yes
RESCUE ENGINE (fair-line + reliability + structural corroboration)
        ↓
PRIMARY | RESCUE | NO BET   (separately tagged)
```

## V1 (production rules, labeled-side accept)

| Slice | Directed | W-L | Win% | Coverage |
|------:|--------:|----:|-----:|---------:|
| ALL | 53 | 45-8 | 84.9% | 28.0% |
| OVER | 32 | 25-7 | 78.1% | 37.6% |
| UNDER | 21 | 20-1 | 95.2% | 20.2% |

## V2 overall (primary + rescue)

| Slice | Directed | W-L | Win% | Coverage |
|------:|--------:|----:|-----:|---------:|
| ALL | 20 | 17-3 | 85.0% | 10.6% |
| OVER | 10 | 7-3 | 70.0% | 11.8% |
| UNDER | 10 | 10-0 | 100.0% | 9.6% |

## V2 by admission class (critical)

| Class | Directed | W-L | Win% |
|------|--------:|----:|-----:|
| PRIMARY | 20 | 17-3 | 85.0% |
| RESCUE | 0 | 0-0 | n/a |
| OVER PRIMARY | 10 | 7-3 | 70.0% |
| UNDER PRIMARY | 10 | 10-0 | 100.0% |
| OVER RESCUE | 0 | 0-0 | n/a |
| UNDER RESCUE | 0 | 0-0 | n/a |

## Near-miss pools (why rescue stayed closed)

| Pool | n | W-L | Rescued (strict) |
|------|--:|----:|-----------------:|
| UNDER edge 2.5–4.0 | 13 | 4-9 | 0 |
| OVER edge 1.75–2.5 | 7 | 2-5 | 0 |
| OVER market-conflict demand | 8 | 7-1 | 0 |

UNDER 2.5–4 is a bad band in this sample — rescue refusing it is a feature, not a bug.

## Sensitivity: null failure-path inventory as 0

Some historical rows lack `majorFailurePathCount`. Strict mode blocks those from rescue.

| Mode | Directed | W-L | RESCUE W-L |
|------|--------:|----:|-----------:|
| Strict (null ≠ 0) | 20 | 17-3 | 0-0 |
| Sensitivity (null→0) | 32 | 24-8 | 7-5 |

## Missing ≠ safe

Rows where V1 primary would pass but V2 primary blocks for missing structural evidence: **11**

## Kill-switch

If RESCUE W-L is poor prospectively:

```text
DIRECTION_V2_RESCUE_ENABLED=false
```

Primary O2.5 / U4 gates remain untouched.

## Shadow (no Official authority)

```text
DIRECTION_V2_SHADOW=true
```

Packets gain `directionV2Shadow` with `admission` / `rescuePathway`; Official still uses V1.

## Next

1. Inspect rescue / near-miss rows in the JSON
2. Shadow V2 on live full-feature packets (failure paths present)
3. Promote only if RESCUE precision holds chronologically / prospectively
