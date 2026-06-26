# CourtEdge Quarantine 06/24 Report

**SERVER_BUILD:** `courteedge-quarantine-0624-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Date:** 2026-06-26

## Summary

June 24 (`2026-06-24`) is **quarantined** with reason `INCOMPLETE_PROD_DATA`. It is excluded from Lab rotation, History lists, win-rate rollups, and analytics scope. June 21 remains the archived History slate; Lab stays **empty** until the next genuinely completed slate after repair.

The prior `repairSlateRotation0624` restore/rebuild path is **disabled by default** (`ALLOW_0624_RESTORE` must be `true`).

## How 06/24 Is Excluded

| Layer | Mechanism |
|-------|-----------|
| Code defaults | `DEFAULT_QUARANTINED_SLATE_DATES = ["2026-06-24"]` in `slateScopeService.js` / `utils/slateRotation.ts` |
| Registry | `locked-slates.json` → `quarantinedSlates[]` with `{ slateDate, reason, quarantinedAt }` |
| Rotation | `computeSlateRotation` filters quarantined dates from valid reports, Lab candidates, History, and tracked-prop inference |
| Reports API | `getDailySlateReports()` / `getDailySlateReport()` hide quarantined slates |
| Rollups | `getAnalyticsScopeProps()` skips quarantined completed dates |
| Lifecycle | `QUARANTINED_EXCLUDED` bucket; `classifySlateRotationBucket` → `QUARANTINED_EXCLUDED` |
| UI | History builder skips quarantined dates; Prop Lab shows empty state when no current Lab slate |

## Lab / History After Repair

Expected post-repair rotation (when 06/21 is `ARCHIVED` and no newer valid completed slate exists):

| Field | Expected |
|-------|----------|
| `currentLabSlateDate` | `null` (empty Lab) |
| `historySlateDates` | `["2026-06-21"]` |
| `quarantinedSlateDates` | includes `2026-06-24` |
| `activeResultsSlateDate` | today's slate only (when official props exist) |

## Files Changed

| File | Change |
|------|--------|
| `services/slateScopeService.js` | Quarantine constants, filters, rotation integration |
| `services/slateLockService.js` | `quarantinedSlates` registry + `quarantineSlate()` |
| `services/dailySlateReportService.js` | Filter/hide quarantined reports; `removeDailySlateReport()` |
| `services/trackedPropService.js` | Analytics scope excludes quarantined |
| `services/slateLifecycleService.js` | `QUARANTINED_EXCLUDED` lifecycle |
| `services/repairQuarantine0624AndArchive0621Service.js` | New repair service |
| `scripts/repairQuarantine0624AndArchive0621.js` | CLI repair runner |
| `scripts/testQuarantine0624.js` | 8 quarantine tests |
| `scripts/testSlateRotationLifecycle.js` | Updated dates (06/23 lab candidate) |
| `services/repairSlateRotation0624Service.js` | Gated behind `ALLOW_0624_RESTORE` |
| `server.js` | `SERVER_BUILD`, `POST /admin/repair-quarantine-0624` |
| `utils/slateRotation.ts` | Client mirror of quarantine logic |
| `utils/historyArchive.ts` | History UI filter |
| `services/api.ts` | `quarantinedSlateDates` API fields |
| `app/(tabs)/prop-lab.tsx` | Empty Lab messaging |

## Prod Repair Instructions

**Safety:** Creates backup before any writes. Does **not** call `/clear-tracked-props`. Does **not** mutate graded prop outcomes. Does **not** restore 06/24 data.

### Option A — Render shell

```bash
cd betbrain-server
node scripts/repairQuarantine0624AndArchive0621.js
```

### Option B — Admin endpoint

```bash
curl -X POST "$BASE_URL/admin/repair-quarantine-0624" \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"confirm": true}'
```

Dry-run preview:

```bash
curl -X POST "$BASE_URL/admin/repair-quarantine-0624" \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"dryRun": true}'
```

### Backup path

Repair calls `createBackup("pre-quarantine-0624-archive-0621-v1")`. Backups land in:

`betbrain-server/backups/<timestamp>-pre-quarantine-0624-archive-0621-v1/`

Includes: `tracked-props.json`, `daily-slate-reports.json`, `locked-slates.json`, `history-archive/`, manifest.

## Tests

```bash
node betbrain-server/scripts/testQuarantine0624.js      # 8 passed
node betbrain-server/scripts/testSlateRotationLifecycle.js  # 23 passed
```

## Deprecated Path

`repairSlateRotation0624.js` — restore/rebuild 06/24 requires `ALLOW_0624_RESTORE=true`. Use `repairQuarantine0624AndArchive0621.js` for production instead.
