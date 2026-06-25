# CourtEdge Lab / History Message Cleanup Report

**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-lab-history-message-cleanup-v1`  
**Date:** 2026-06-25

## Summary

CourtEdge-only cleanup so every user-facing status includes an explicit slate date, Results pending-check messaging is scoped to the active Results slate (never a stale Lab slate), `2026-06-21` is removed from the active Lab rotation when `2026-06-24` is valid, archived `2026-06-21` appears in History, and a safe prod repair path is bundled.

## Goals

| # | Goal | Status |
|---|------|--------|
| 1 | Dated pop-up / status messages | Done |
| 2 | Remove `2026-06-21` from active Lab; archive to History | Repair script + rotation rules |
| 3 | History tab shows archived slates (not `0` when archives exist) | Done |

## Message examples

| Context | Example |
|---------|---------|
| Results pending check | `2026-06-25 slate checked: 0 graded, 5 still pending.` |
| Results graded | `2026-06-25 slate checked: 2 graded, 3 still pending.` |
| Lab already promoted | `2026-06-24 slate has already been moved to Lab.` |
| Archive repair | `2026-06-21 slate archived to History.` |
| Prior slate banner | `Still resolving 2026-06-24 slate. Newer slate remains on board until that slate closes.` |
| Prop Lab empty | `No tracked props for 2026-06-24 slate.` |
| Pick saved (Explore / Top Props) | `2026-06-25 slate: Player Name OVER 18.5` |
| Copy report feedback | `Report copied (2026-06-25)` |
| History metadata error | `2026-06-21 archive metadata found but prop bundle is missing` |

## Files changed (code)

### Client
- `utils/slateMessages.ts` — shared dated message helpers
- `utils/resultsQueue.ts` — `pickResolveCheckMessage`, `computePendingCheckSummary`, `countNewlyGradedPropsOnSlate`
- `utils/slateRotation.ts` — dated prior-slate label export
- `utils/historyArchive.ts` — metadata-only archive entries + error labels
- `utils/reportBuilders.ts` — dated Results / pending-check report lines
- `components/CopyReportButton.tsx` — optional `slateDate` in copy feedback
- `app/(tabs)/results.tsx` — scoped resolve check + dated UI
- `app/(tabs)/history.tsx` — load tracked props + archives; dated empty states
- `app/(tabs)/prop-lab.tsx` — replace vague “this slate” copy
- `app/(tabs)/explore.tsx`, `app/(tabs)/top-props.tsx` — dated save alerts

### Server
- `betbrain-server/server.js` — `SERVER_BUILD`, scoped resolve response, `POST /admin/repair-lab-history-0625`
- `betbrain-server/services/resolveCheckMessageService.js` — server-side dated check messages
- `betbrain-server/services/repairLabHistoryMessages0625Service.js` — wraps `repairSlateRotation0624`
- `betbrain-server/scripts/repairLabHistoryMessages0625.js` — local/runtime repair runner
- `betbrain-server/scripts/testLabHistoryMessageCleanup.js` — 18 regression tests

## Prod repair steps

**Safety:** backs up before write; does not touch `/clear-tracked-props`; preserves `2026-06-25` Results pending and `2026-06-24` data.

### Option A — Admin API (recommended on prod)

```bash
# Dry run first
curl -X POST "$BASE_URL/admin/repair-lab-history-0625" \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"dryRun": true}'

# Apply
curl -X POST "$BASE_URL/admin/repair-lab-history-0625" \
  -H "Content-Type: application/json" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -d '{"confirm": true}'
```

### Option B — On-server script

```bash
node betbrain-server/scripts/repairLabHistoryMessages0625.js
```

### Expected after repair

| Field | Before (broken) | After |
|-------|-----------------|-------|
| `currentLabSlateDate` | `2026-06-21` | `2026-06-24` |
| `historySlateDates` | missing `2026-06-21` | includes `2026-06-21` |
| `2026-06-21` archive `phase` | `LAB` | `ARCHIVED` |
| `activeResultsSlateDate` | `2026-06-25` (unchanged) | `2026-06-25` |

Deploy build: `courteedge-lab-history-message-cleanup-v1`

## Test results

```bash
node betbrain-server/scripts/testLabHistoryMessageCleanup.js
node betbrain-server/scripts/testSlateRotationLifecycle.js
```

Run both after deploy; record pass/fail counts in CI or local terminal.

## Out of scope (unchanged)

- WNBA Decision Intelligence rules
- Prop thresholds / engine tuning
- More/fewer picks logic
- Runtime JSON commits (`tracked-props.json`, archives, etc.)
