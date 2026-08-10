# CourtEdge Aug 9 Prospective Closed-Gate Funnel V1

**Slate:** 2026-08-09 (WNBA, CT)  
**Mode:** Prospective closed gate (`EMPIRICAL_DIRECTION_V1` + C2)  
**Generated:** 2026-08-09T17:18:57.449Z  
**Constraints:** No direction-threshold or C2 changes. Single Odds refresh only. No Aug 9 outcomes used for training.

## Gate confirmation

- `/health` `featureFlags.EMPIRICAL_DIRECTION_V1`: **true**
- Champion: `EMPIRICAL_SAFE_PROP_V2_CALIBRATION_2`
- Direction freeze on packets: `EMPIRICAL_DIRECTION_V1_PRODUCTION_1`
- HIGH blocked from Official: true

## Odds refresh (one call)

`POST /refresh-picks?wait=1&scope=today&includeNba=false&chainTomorrow=false`

| Metric | Value |
|---|---|
| Reported credit cost | **12** |
| Provider calls | 12 |
| Cache hits / misses | 1 / 12 |
| Raw response | `_aug9_refresh_raw.json` |

### Credits by endpoint

| Endpoint | Requests | Credits |
|---|---:|---:|
| FETCH ODDS EVENTS (WNBA) | 0 | 0 |
| FETCH POINT PROPS (WNBA) | 3 | 3 |
| FETCH GAME SPREADS (WNBA) | 6 | 6 |
| FETCH GAME TOTALS (WNBA) | 3 | 3 |

## Frozen research packet

- **Path:** `research/empirical-safe-prop-v2/frozen-research-packets/2026-08-09__LATEST.json`
- **Frozen at:** 2026-08-09T17:16:38.803Z
- **Build:** courteedge-empirical-low-medium-prop-finder-v2
- **packetCount:** 18

## Admission funnel

| Stage | Count |
|---|---:|
| Markets scanned (`filterAudit.totalScanned`) | 35 |
| Raw lines (`pipeline.rawLines`) | 322 |
| Research packets (`packetCount`) | **18** |
| Direction NO_BET | 13 |
| Direction OVER | 5 |
| Direction UNDER | 0 |
| C2 risk LOW | 0 |
| C2 risk MEDIUM | 3 |
| C2 risk HIGH | 15 |
| **Official (`officialEligible=true`)** | **3** |
| Directed HIGH (research-only) | 2 |

Definition of Official: LOW/MEDIUM C2 risk **and** passed EMPIRICAL_DIRECTION_V1 (packet `officialEligible`).

## Official props

| Player | Side | Line | Risk | Dir conf | Dir reason | Proj | Edge | rawP | Rel | Safety | Pathway |
|---|---|---:|---|---|---|---:|---:|---:|---:|---:|---|
| DeWanna Bonner | OVER | 9.5 | MEDIUM | STANDARD | OVER_PASS_MARKET_CONFLICT_SOFT | 13 | 3.5 | 0.9064 | 0.8578 | 74 | NONE |
| Shakira Austin | OVER | 17.5 | MEDIUM | STANDARD | OVER_PASS_MARKET_CONFLICT_SOFT | 21 | 3.5 | 0.7772 | 0.7369 | 69 | GENERAL_HIGH_RELIABILITY |
| Dearica Hamby | OVER | 12.5 | MEDIUM | STANDARD | OVER_PASS_MARKET_CONFLICT_SOFT | 17.3 | 4.8 | 0.9202 | 0.8984 | 72 | NONE |

## Directed but HIGH (research-only)

| Player | Side | Line | Risk | Dir conf | Dir reason | Proj | Edge | rawP | Rel | Safety | Pathway |
|---|---|---:|---|---|---|---:|---:|---:|---:|---:|---|
| Courtney Williams | OVER | 12.5 | HIGH | WEAK | OVER_PASS_MARKET_CONFLICT_SOFT | 15.2 | 2.7 | 0.8112 | 0.6339 | 67 | NONE |
| Olivia Miles | OVER | 19.5 | HIGH | WEAK | OVER_PASS_MARKET_CONFLICT_SOFT | 22 | 2.5 | 0.7004 | 0.5043 | 65 | NONE |

## NO_BET reasons histogram

| Reason | Count |
|---|---:|
| WEAK_EDGE | 7 |
| UNDER_EDGE_BELOW_MIN | 3 |
| OVER_EDGE_BELOW_MIN | 2 |
| LOW_RELIABILITY | 1 |

## Notes

- Packet top-level `officialCount` field is 0; `researchUniverse.Official` is 3. Funnel Official count follows per-packet `officialEligible`.
- Refresh `topWNBAOfficialProps` length was 0 (display seal may lag / differ); admission report is packet-authoritative.
- This is a **prospective** freeze — do not rewrite after outcomes.
