# EMPIRICAL_DIRECTION_V1_PRODUCTION_1 — Freeze

**Status:** PRODUCTION DIRECTION ENGINE FROZEN  
**Frozen at:** 2026-08-09T16:59:51.623Z  
**C2:** unchanged (`EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2`)  
**Aug 9:** HOLD — do not tune after outcomes

## Selected rules (walk-forward winner)

`O2.5_U4_orna_ur0.45_EDGE_OR_REL_MISSING_EDGE`

| Gate | Rule |
|------|------|
| NO BET | directionalEdge < 1.0, or reliability < 0.45 when present |
| OVER | edge ≥ **2.5**, Safety ≥ 65; marketQuality≥85 + books≥4 soft confidence reduction (not veto) |
| UNDER | edge ≥ **4.0**, Safety ≥ 65, reliability ≥ 0.45, role ≥ 60, minutes ≥ 20 |

## Chronological OOS

| Metric | Value |
|--------|-------|
| Record | **43-4** |
| Win rate | 91.5% |
| Coverage | 28.0% |
| NO BET rate | 72.0% |

## Full sample (reference)

| Cohort | Record | WR | Coverage |
|--------|--------|----|----------|
| ALL | 45-8 | 84.9% | 28.0% |
| OVER | 25-7 | 78.1% | 37.6% |
| UNDER | 20-1 | 95.2% | 20.2% |

UNDER edge≥4 cohort is intentionally selective — **do not treat 95% as a future guarantee** (small directed n).

## Flood gates

```
FULL MARKET UNIVERSE
        ↓
integrity validation
        ↓
DIRECTION ENGINE  →  OVER / UNDER  →  C2  →  LOW/MEDIUM  →  OFFICIAL
                 ↘  NO BET / HIGH  →  research only
```

Rejected / NO BET candidates may still be collected silently for learning.

## Hashes

- calibrationHash: `e4355a6e98c3a66f42041e168afcfd8f312acdcf2ff38d05ab3aa3e170736db1`
- See `EMPIRICAL_DIRECTION_V1_PRODUCTION_1_FREEZE.json` for file SHA-256s.

## Flag

`EMPIRICAL_DIRECTION_V1=true` (default ON)
