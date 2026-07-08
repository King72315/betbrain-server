# CourtEdge Lab Wipe — No Restore

**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-lab-wipe-v1`  
**Date:** 2026-07-08  

## Intent

Clear stuck Lab (`2026-06-21` LAB-phase archives) **without** restoring old Lab data from snapshots. Accept loss of legacy Lab content so incoming Results → Lab can land cleanly.

## What was implemented

| Area | Change |
|------|--------|
| `resetLabArchivesService.js` | Backup → delete LAB-phase archives → remove LAB registry rows → remove 06/21 report → quarantine `LAB_WIPED_NO_RESTORE`. **No snapshot rebuild into Lab/History.** |
| `scripts/resetLabNoRestore.js` | Render-shell runner |
| `slateLockService.js` | `clearLabPhaseArchiveFiles`, `clearLabPhaseRegistryEntries` |
| `slateRestoreService.js` | Block `mode: lab` restore for `2026-06-21` |
| `server.js` | `POST /admin/reset-lab-no-restore`; startup `COURTEDGE_LAB_WIPE_V1`; `SERVER_BUILD=courteedge-lab-wipe-v1` |
| `render.yaml` | `COURTEDGE_LAB_WIPE_V1=true`, `COURTEDGE_HISTORY_REBUILD_V1=false` |
| `prop-lab.tsx` | Empty state: waiting for next graded Results slate |
| `services/api.ts` | `resetLabNoRestore()` client helper |
| Tests 31–33 | Empty Lab after wipe + quarantine; ARCHIVED History kept; Results preserved |

## What is wiped

- History-archive files with `phase: LAB` (e.g. 06/21)
- `locked-slates.json` registry rows with `phase: LAB`
- Daily slate report row for wiped dates (default `2026-06-21`)
- Quarantine entry so graded 06/21 tracked props cannot re-infer as Lab

## What is preserved

- Tracked props store (including any 07/07+ Results cohort) — **no** `/clear-tracked-props`
- ACTIVE Results registry rows
- ARCHIVED history-archive bundles (if any)
- Home / Top / NBA–WNBA paths untouched

## Prod apply

After deploy of `courteedge-lab-wipe-v1`:

```bash
# Render shell
cd betbrain-server
node scripts/resetLabNoRestore.js --dry-run
node scripts/resetLabNoRestore.js
```

Or admin:

```bash
curl -X POST "$API/admin/reset-lab-no-restore" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": true}'

curl -X POST "$API/admin/reset-lab-no-restore" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"confirm": true}'
```

Startup also runs wipe when `COURTEDGE_LAB_WIPE_V1=true` (set in `render.yaml` for first deploy).

### Empty Lab confirmation

```bash
curl -sS "$API/daily-slate-reports" | jq '{currentLabSlateDate,historySlateDates,activeResultsSlateDate,serverBuild}'
curl -sS "$API/history-archives" | jq '[.archives[]|{slateDate,phase,propCount}]'
curl -sS "$API/diagnostics" | jq '{currentLabSlateDate,historySlateDates,activeResultsSlateDate,trackedCountsBySlateDate,lastBackup}'
```

Expect:

- `currentLabSlateDate: null`
- `historySlateDates`: ARCHIVED-only or `[]`
- No LAB-phase archives
- 07/07+ tracked counts unchanged if Results cohort exists

### After healthy wipe

Set `COURTEDGE_LAB_WIPE_V1=false` on Render (idempotent but should not stay forever).  
**Do not** run `restore-official-slate` with `mode: "lab"` for 06/21 (blocked server-side).

## Soft risks

- 06/21 graded tracked props remain in store but are quarantined from Lab/History rotation.
- Leaving wipe env flag on forever re-runs quarantine on each boot (safe but noisy).
- New graded Results still need `final` report + resolve before Lab promotion.
