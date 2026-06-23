# COURTEDGE TOP PROPS + LAB COMBINED FIX REPORT

**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-top-prop-best2-v1`  
**Selector version:** `top-prop-selector-v2-best2`  
**Backup:** `2026-06-23T06-47-17-506Z-pre-courteedge-top-prop-best2-v1`

---

## Safety verification

| Check | Status |
|-------|--------|
| Pre-change backup via `backupService` | ✅ Created |
| 06/21 Lab safe (locked, LAB phase, 14 props) | ✅ `locked-slates.json` — no mutation |
| 06/22 read-only | ✅ Not in active locked registry (archive-only) |
| No `/clear-tracked-props` | ✅ Not invoked |
| No runtime JSON commit | ✅ Code-only commit |

---

## PART 1 — Fix Top Props showing 8

### Root cause

1. **Stale in-memory `picksCache`** — `cacheFresh()` only checked `CACHE_MINUTES`, not selector version. Deploys with `TOP_PROP_LIMIT=2` could still serve an old 8-prop cache until TTL expired.
2. **No server-side clamp** — `/top-props` returned `picksCache.topProps` verbatim with no hard cap.
3. **Frontend displayed full API arrays** — Official + Test sections could render all cached props when cache was stale.

`TOP_PROP_LIMIT` in `config.js` was already `2`; `topPropSelector.js` respected it. The bug was **cache + response + UI safety layers**, not the selector math.

### Fixes

| Layer | Change |
|-------|--------|
| `topPropSelectionAudit.js` | Version bump → `top-prop-selector-v2-best2` (cache bust) |
| `server.js` | `cacheFresh()` invalidates on version mismatch; `clampTopPropsSelection()`; `cachedSelectorVersion` tracking |
| `GET /top-props` | Hard slice to `TOP_PROP_LIMIT`; diagnostics: `topPropLimit`, `hiddenDueToLimit`, `engineHandled`, `topPropSelectorVersion` |
| `GET /diagnostics` | Same diagnostic fields + `topPicksSnapshot` |
| `top-props.tsx` | "Best 2 Props"; Official/Test sections capped at 2 total |
| `PropCard.tsx` | WNBA v2 compact block (existing) + `Top #N` badge |
| `api.ts` | Pass-through new diagnostic fields |

---

## PART 2 — Lab Top Picks Selection Review

### New service: `topPicksSnapshotService.js`

Reference-only snapshot persisted at refresh time:

```json
{
  "slateDate", "topPickRank", "trackedId", "trackedKey", "stablePropKey",
  "selectedAt", "bestPropScore", "selectorVersion", "reasonCodes",
  "scoreBreakdown", "isTopPickReference": true
}
```

| Function | Purpose |
|----------|---------|
| `saveTopPicksSnapshot` | Persist on `refreshAllPicks` |
| `getTopPicksSnapshot` / `getActiveTopPicksSnapshot` | Read active or by-slate |
| `attachGradedResultsToSnapshot` | Merge graded fields by `trackedKey` |
| `buildTopPicksReview` | W-L-P, #1/#2, vs rest of slate, hidden audit |
| `clearActiveTopPicksSnapshot` | After History transition |
| `archiveTopPicksSnapshotToReportMetadata` | Report metadata only |

### Lab integration

- `dailySlateReportService.js` — Section **M** (`topPicksReview`) on report build; snapshot archived in report metadata on final
- `prop-lab.tsx` — **Top Picks Record** section: record, #1/#2, vs rest, hidden candidate audit

---

## PART 3 — No duplicate rule

| Rule | Implementation |
|------|----------------|
| Top 2 reference-only | Snapshot `referenceOnly: true`; never passed to `addTrackedProps` |
| No duplicate tracked entries | `addTrackedProps(picks, { skipTopPickReferences: true })` skips `isTopPickReference` |
| Results badge | `GET /tracked-props` enriches props with `topPickRank` from active snapshot; `PropCard` shows **Top #N** |
| Lab subset only | `topPicksReview.subsetAnalysisOnly: true` — not added to Section A totals |
| History | Snapshot in report metadata; `clearActiveTopPicksSnapshot` on Lab→History rotation |

---

## PART 4 — Cache consistency

- `cachedSelectorVersion` stored on refresh
- `cacheFresh()` returns `false` when `picksCache.topPropSelectorVersion !== TOP_PROP_SELECTOR_VERSION`
- `refreshAllPicks` repopulates selector + snapshot every refresh

---

## PART 5 — Tests

| Script | Result |
|--------|--------|
| `scripts/testTopPropSelector.js` | 12/12 passed |
| `scripts/testTopPicksLifecycle.js` | 8/8 passed |

Coverage: max 2, best score, no duplicate tracked count, Lab no double-count, snapshot reference-only, graded attach, active clear after history.

---

## PART 6 — Deploy prep

- `SERVER_BUILD` → `courteedge-top-prop-best2-v1`
- Code committed and pushed to `origin` on `betbrain-v2-rebuild`

### Post-deploy verification

1. `GET /health` → `serverBuild: courteedge-top-prop-best2-v1`
2. `POST /refresh-picks` (or wait for cache miss)
3. `GET /top-props` → `topProps.length <= 2`, `selectedCount <= 2`, `topPropLimit: 2`
4. `GET /diagnostics` → `topPropSelectorVersion: top-prop-selector-v2-best2`
5. App Top Props screen → max 2 cards (Official + Test)

---

## Files changed

**Server**
- `engines/topProps/topPropSelectionAudit.js`
- `services/topPicksSnapshotService.js` *(new)*
- `services/dailySlateReportService.js`
- `services/trackedPropService.js`
- `server.js`
- `scripts/testTopPropSelector.js`
- `scripts/testTopPicksLifecycle.js` *(new)*

**App**
- `app/(tabs)/top-props.tsx`
- `app/(tabs)/prop-lab.tsx`
- `components/PropCard.tsx`
- `services/api.ts`

**Untouched (per spec):** TennisEdge, other edges, secrets, `.env`, `eas.json`, 06/21 Lab data mutation
