# CourtEdge WNBA Reader Calibration Fix Report

**Date:** 2026-06-24  
**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-wnba-reader-calibration-v1`

## Backup

- **Path:** `betbrain-server/backups/2026-06-24T06-05-24-271Z-pre-wnba-reader-calibration-v1`
- **Reason:** `pre-wnba-reader-calibration-v1`
- **Copied:** tracked-props, daily-slate-reports, pick-history, pick-analytics, locked-slates, slate-snapshots, history-archive

## Safety confirmations

| Check | Status |
|-------|--------|
| `/clear-tracked-props` used | No |
| 06/21 Lab mutated | No (read-only inspection) |
| 06/21 History mutated | No |
| Secrets / `.env` / `eas.json` touched | No |
| NBA scoring path changed | No (WNBA-only engine changes) |
| Runtime JSON committed | No |

## Files inspected

- `betbrain-server/daily-slate-reports.json` (06/21 + 06/23 slates)
- `betbrain-server/tracked-props.json`
- `betbrain-server/engines/wnba/wnbaReaderEngine.js`
- `betbrain-server/engines/wnba/wnbaDecisionEngine.js`
- `betbrain-server/engines/marketIntelligenceEngine.js`
- `betbrain-server/services/wnbaAvailabilityService.js`
- `betbrain-server/services/trackedPropService.js`
- `betbrain-server/services/dailySlateReportService.js`
- `betbrain-server/services/topPicksSnapshotService.js`
- `app/(tabs)/results.tsx`
- `app/(tabs)/prop-lab.tsx`

## Root causes found

1. **Thin WNBA limited-data Unders** — `scoreVolumePath` had no Under gap floor; 1.7–2.6 gaps could still score through.
2. **Line movement wording** — market direction and line-value improvement were conflated.
3. **Availability unknown** — missing injury feed created fake `dangerReasons` / risk pressure.
4. **Reader vs tracking mismatch** — `readerDecision: OFFICIAL` + `trackingType: TEST` not labeled (`readerOfficialDemoted`).
5. **testReason pollution** — `STRONG_READER_CASE` appeared in TEST reasons.
6. **Confidence blend opaque** — `winProbability` overwritten by blended `finalConfidence`.
7. **Lab calibration buckets** — TEST demoted vs uncertain not split in UI/reports.
8. **Top Picks Review** — missing snapshot returned `null` section (no user message).

## Files changed

| File | Change |
|------|--------|
| `engines/marketIntelligenceEngine.js` | `interpretLineMovement()` + export fields on market intel |
| `engines/wnba/wnbaReaderEngine.js` | Under gap floor, line movement, demotion mapping, testReason fix |
| `engines/wnba/wnbaDecisionEngine.js` | Separate confidence fields, `finalizeWnbaPickTracking()` |
| `engines/wnba/wnbaPlayerPropDataCard.js` | `dataMode`, availability flags, line bucket audit fields |
| `engines/wnbaOfficialEngine.js` | Preserve `winProbability`; LIMITED blocks official |
| `services/wnbaAvailabilityService.js` | Unknown feed = missing data, not risk |
| `services/trackedPropService.js` | Persist calibration/tracking fields on tracked props |
| `services/dailySlateReportService.js` | Tracking calibration split + Top Picks missing placeholder |
| `server.js` | `SERVER_BUILD` bump + diagnostics calibration block |
| `app/(tabs)/prop-lab.tsx` | Tracked/Official/Test split, demoted vs uncertain TEST, Top Picks message |
| `utils/resultsQueue.ts` | `isReaderOfficialDemotedProp`, `isReaderUncertainTestProp` |
| `scripts/testWnbaReaderFixes.js` | **New** — 18 calibration tests |
| `scripts/testWnbaOfficialV1.js` | Doubtful → LIMITED expectation |

## Fixes applied (10 areas)

1. **WNBA limited-data Under gap floor (~3.0)** — penalty + `UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR` reason code; audit fields on reader/pick/tracked.
2. **Line movement direction** — side-aware `interpretLineMovement` with separate value vs market-direction fields.
3. **WNBA availability unknown** — `availabilityDataMissing`, `availabilityRisk: false`, `WNBA_AVAILABILITY_FEED_MISSING` flag.
4. **readerOfficialDemoted** — stored when reader OFFICIAL but tracking TEST; demotion reasons separated.
5. **testReason semantics** — `readerOutcome`, `trackingReason`, `officialDemotionReason`; no `STRONG_READER_CASE` in TEST reasons.
6. **Confidence fields** — `readerConfidence`, `winProbability`, `finalConfidence`, blend version/formula persisted.
7. **Results + Lab labeling** — Lab shows Total/Official/Test + Reader Official Demoted / Reader Uncertain TEST buckets.
8. **Top Picks Review** — section always renders; shows “No Top Picks snapshot found for this slate.” when missing.
9. **Duplicate safety** — verified existing stable-key / top-picks reference-only logic (no code change required).
10. **Line bucket audit** — `lineToRecentAvgRatio`, `lineToSeasonAvgRatio`, `absoluteLineBucket`, `playerContextLineBucket` on data card/pick.

## Tests run

| Suite | Result |
|-------|--------|
| `testWnbaReaderFixes.js` (18 tests) | **PASS** |
| `testWnbaDataCard.js` | **PASS** |
| `testWnbaOfficialV1.js` | **PASS** |
| `testTopPropSelector.js` | **PASS** |
| `testTopPicksLifecycle.js` | **PASS** |
| `testResultsTrackingCohort.js` | **PASS** |
| `testCourtEdgeOS.js` | **PASS** |
| `testCleanDataCutoff.js` | **PASS** |
| `testActiveResultsSlate.js` | **PASS** |
| `testCompleteFlow.js` | **PASS** (local server) |
| Other `test*.js` scripts | **PASS** (after official v1 test update) |

## Live endpoint expectations (post-deploy)

- `/health` → `serverBuild: courteedge-wnba-reader-calibration-v1`
- `/diagnostics` → `wnbaReaderCalibration` block with demoted/uncertain counts
- `/top-props` → unchanged NBA/WNBA sections
- `/tracked-props` → new picks carry separate confidence + demotion fields

## Remaining gaps (next pass)

- Re-score existing 06/23 tracked props only if King wants backfill (not done — no runtime mutation).
- Validate blend weights (`v1-70-30`) against graded outcomes in Lab after next slate.
- Player-context line buckets are audit-only; threshold rewrite deferred.
