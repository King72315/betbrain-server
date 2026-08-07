# EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2 — PRODUCTION ACTIVATION

**Freeze:** `EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2`  
**Status:** PRODUCTION CHAMPION 🔐  
**Activated:** 2026-08-07T20:08:44.956Z  
**Calibration hash:** `11fe26e8ecea79eab6183cc631d4a349f6dd6f9f4290ac70fafbbe9737d5fb14`  
**EMPIRICAL_SAFE_PROP_V2:** true  
**Build:** courteedge-empirical-low-medium-prop-finder-v2

## Locked rules (unchanged)

- LOW = Calibration 2 LOW
- MEDIUM = Calibration 2 MEDIUM
- HIGH = blocked from Official
- No fixed six / no minimum board / no forced sides / no team quotas
- LOW sorted first, MEDIUM second
- Research tracks everything
- V1 continues in shadow (`v1Risk` beside `v2Risk`)
- **Absolutely no tuning after activation**

## Aug 7 pregame gate

**All pregame:** false  
**Odds refresh:** SKIPPED

Not every Aug 7 event is still pregame — Odds refresh BLOCKED to protect prospective integrity

| Game | Commence | Status |
|------|----------|--------|
| ATLANTADREAM vs WASHINGTONMYSTICS | 2026-08-07T23:30:00Z | PREGAME |
| PHOENIXMERCURY vs CONNECTICUTSUN | 2026-08-07T23:30:00Z | PREGAME |
| GOLDENSTATEVALKYRIES vs DALLASWINGS | 2026-08-08T01:30:00Z | PREGAME |
| LASVEGASACES vs INDIANAFEVER | 2026-08-06T23:00:00Z | STARTED_OR_FINAL |
| LOSANGELESSPARKS vs MINNESOTALYNX | 2026-08-07T01:00:00Z | STARTED_OR_FINAL |
| TORONTOTEMPO vs PORTLANDFIRE | 2026-08-07T02:00:00Z | STARTED_OR_FINAL |

## Prospective freeze

- File: `C:\Users\nicho\BetBrain\betbrain-server\research\empirical-safe-prop-v2\prospective-slate-freezes\2026-08-07__2026-08-07T20-08-44-951Z__PROSPECTIVE_FREEZE.json`
- Official: **15** (LOW 6 / MEDIUM 9)
- Research universe: **35** (HIGH 20)

Official board (immutable for this activation freeze):

| Player | Side | Line | V2 | V1 | Rel | Trust | Pathway |
|--------|------|-----:|----|----|----:|------:|---------|
| DeWanna Bonner | OVER | 10.5 | LOW | LOW | 0.9305 | 93 | GENERAL_HIGH_RELIABILITY |
| Paige Bueckers | UNDER | 19.5 | LOW | LOW | 0.9273 | 93 | GENERAL_HIGH_RELIABILITY |
| Arike Ogunbowale | OVER | 14.5 | LOW | LOW | 0.9096 | 91 | GENERAL_HIGH_RELIABILITY |
| Alyssa Thomas | OVER | 15.5 | LOW | LOW | 0.8782 | 84 | GENERAL_HIGH_RELIABILITY |
| Shakira Austin | OVER | 17.5 | LOW | LOW | 0.8585 | 82 | GENERAL_HIGH_RELIABILITY |
| Kelsey Plum | OVER | 18.5 | LOW | LOW | 0.8444 | 81 | GENERAL_HIGH_RELIABILITY |
| Leïla Lacan | UNDER | 12.5 | MEDIUM | MEDIUM | 0.9209 | 92 | GENERAL_HIGH_RELIABILITY |
| Bridget Carleton | OVER | 15.5 | MEDIUM | LOW | 0.8492 | 81 | GENERAL_HIGH_RELIABILITY |
| Marina Mabrey | UNDER | 20.5 | MEDIUM | MEDIUM | 0.8419 | 81 | GENERAL_HIGH_RELIABILITY |
| Aliyah Boston | UNDER | 16.5 | MEDIUM | MEDIUM | 0.8305 | 83 | GENERAL_HIGH_RELIABILITY |
| Maria Conde | OVER | 10.5 | MEDIUM | HIGH | 0.8099 | 78 | GENERAL_HIGH_RELIABILITY |
| Olivia Nelson-Ododa | UNDER | 13.5 | MEDIUM | HIGH | 0.8031 | 78 | GENERAL_HIGH_RELIABILITY |
| Veronica Burton | OVER | 11.5 | MEDIUM | HIGH | 0.7871 | 73 | GENERAL_HIGH_RELIABILITY |
| Naz Hillmon | OVER | 7.5 | MEDIUM | HIGH | 0.6821 | 66 | GENERAL_HIGH_RELIABILITY |
| Sonia Citron | UNDER | 16.5 | MEDIUM | HIGH | 0.6804 | 65 | GENERAL_HIGH_RELIABILITY |

## Experiment discipline

If a LOW loses tonight: **do nothing.**  
If all LOWs win: **do nothing.**  
If MEDIUM goes 2–6: **do nothing.**  

Next scientific focus (later, not tonight): improve MEDIUM recall **without touching LOW**.

## Deploy note

Code default is ON. Render must run this build (or set `EMPIRICAL_SAFE_PROP_V2=true`) for live Home/Results to use Calibration 2.
