# CourtEdge BallDontLie (BDL) Dependency Inventory

Brief classification of BallDontLie / `ballService` / BDL call sites under `betbrain-server` (grep: BallDontLie, balldontlie, ballService, BDL).

## Primary client

| Path | Role |
|------|------|
| `services/ballService.js` | **Core BDL client** — NBA `/v1` + WNBA `/wnba/v1` bases, auth key, player search / stats fetch helpers |

## Grading / results (critical path)

| Path | Classification |
|------|----------------|
| `services/resultService.js` | **Hard dependency** — imports `fetchPlayerStats` from ballService; grades Official props via BDL box scores |
| `services/gameFinalVerificationService.js` | **Hard dependency** — BDL games endpoint to confirm finals before grading |
| `services/trackedPropService.js` | **Indirect** — resolve/grading path uses result/final checks; comments + Lab copy mention BDL primary |

## WNBA projection / board data

| Path | Classification |
|------|----------------|
| `services/wnbaStatsService.js` | **Hard** — WNBA season/stats via BDL |
| `services/wnbaAvailabilityService.js` | **Hard** — injury OUT/INACTIVE from BDL |
| `services/wnbaOpponentContextService.js` | **Hard** — opponent recent games / points allowed |
| `engines/wnba/wnbaPlayerPropDataCard.js` | **Hard** — `findBallPlayer` + playerId integrity |
| `engines/wnba/wnbaPlayerIdResolver.js` | **Support** — stable BDL WNBA player_id overrides |
| `engines/wnba/wnbaDataRecoveryV1.js` | **Hard** — recovery attempts labeled balldontlie / stable_override |
| `engines/wnba/wnbaDataIntegrityV1.js` | **Gate** — flags missing BallDontLie player id |
| `engines/wnba/wnbaGraduatedDataModeV1.js` | **Gate** — graduated mode when BDL id missing |
| `engines/wnba/wnbaMatchupLookupV1.js` | **Hard** — direct WNBA BDL base URL |
| `engines/defenseScoreEngine.js` | **Hard** — WNBA `team_season_averages` |

## Reporting / Lab copy (non-fetch)

| Path | Classification |
|------|----------------|
| `services/dailySlateReportService.js` | **Metadata** — primaryStatSource string = BDL |
| `services/engineReportCardService.js` | **Metadata** — same primaryStatSource note |

## Scripts / probes (ops, not runtime board)

| Path | Classification |
|------|----------------|
| `scripts/auditWnbaSlate0626MissingData.js` | Audit via ballService |
| `scripts/evaluateOpponentHistorySixProps.js` | Offline eval via ballService |
| `scripts/probeAzuraMatchup0626.js` | Probe via ballService |
| `scripts/testWnbaDataSources.js` | Live BDL endpoint smoke tests |
| `scripts/testGameFinalGradingGuard.js` | Fixtures labeled source BallDontLie |
| `scripts/testOliviaResolve.js` | Fixture source BallDontLie |
| `scripts/testWnbaDataCard.js` / `testWnbaTrackingGateV2.js` | Missing-playerId BDL notes |

## Summary

- **Must-have for grading:** `ballService` + `resultService` + `gameFinalVerificationService`.
- **Must-have for WNBA board quality:** `wnbaStatsService`, availability, opponent context, player id resolver/data card/integrity/recovery.
- **Not a SportsData substitute in copy:** daily reports / report cards assert BDL as primary stat source.
- **No prod HTTP mutations** are implied by this inventory; it is a dependency map only.
