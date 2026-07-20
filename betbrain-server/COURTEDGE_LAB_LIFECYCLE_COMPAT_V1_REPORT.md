# CourtEdge Lab Lifecycle + Compatibility V1

**Date:** 2026-07-20  
**SERVER_BUILD:** `courteedge-lab-lifecycle-compat-v1`  
**LAB_V2_BUILD:** `courteedge-lab-lifecycle-compat-v1`  
**Branch:** `betbrain-v2-rebuild` · remote `orgin`  
**Prod:** `https://betbrain-server-1.onrender.com`

## Verdict

Lab lifecycle/compat repair is complete. Lab defaults to the newest completed official six-prop slate (**2026-07-17**). July 16 remains an immutable **3-prop** historical slate inside frozen block-2. Uninstrumented/legacy flags are explicit. Engine scoreboards exclude uninstrumented sealed-evidence gaps (no fabrication). Three-slate deltas never surface bare nulls. All-time metrics split by build / evidence schema / decision-packet version. **No calibration weight changes.**

> **July 19 note:** No completed official `2026-07-19` slate exists in local or prior live stores. The newest completed official six-prop slate is **2026-07-17** (3W-3L, immutable). When a sealed July 19 six-prop slate is ready, existing promotion + six-prop learning rules will admit it as active block slate 2/3.

---

## Required outcomes

| # | Outcome | Status |
|---|---------|--------|
| 1 | Promote completed newest six-prop into Lab | **PASS** — Lab current = `2026-07-17` (6 official props) |
| 2 | Lab defaults to newest completed official | **PASS** — rotation + `resolveNewestCompletedOfficialSlateDate` |
| 3 | Preserve July 16 as immutable 3-prop | **PASS** — `propCount: 3`, frozen in block-2, not rewritten |
| 4 | Legacy / uninstrumented flags | **PASS** — slate + prop + block flags + `evidenceCoverage` |
| 5 | No inventing engine signals from postgame | **PASS** — missing sealed signals → UNAVAILABLE |
| 6 | Conf/risk from sealed decision packet | **PASS** — `resolveSealedConfidenceRisk` / packet `finalConfidence`/`finalRisk`/`trueRisk` |
| 7 | Engine scoreboard excludes uninstrumented | **PASS** — `instrumentedOnly: true` primary scoreboards |
| 8 | Three-slate deltas never null/crash | **PASS** — `deltaMetric.display` = `N/A` / `pending` |
| 9 | All-time split by build/version | **PASS** — `byBuildVersion` / `byEvidenceSchema` / `byDecisionPacketVersion` |
| 10 | New active six-prop block; Jul 16 not poisoning | **PASS** — active=`[2026-07-17]` 1/3; previous=`[07-14,07-15,07-16]` frozen |

---

## Root causes fixed

1. **`immutableOfficial` ignored when `trackingType: "TEST"`** — July 17's six official props were dropped from Lab (`props: 0`) despite `immutableOfficial: true`.
2. **Lab current slate fell back to three-slate active tail** — stuck on July 16; now uses slate rotation / newest completed official.
3. **`propsByDateFromSources` collapsed props with missing `officialPropId`** — `undefined === undefined` dedupe left July 15 at 1 prop.
4. **No slate/block-level uninstrumented rollup** — added `legacy` / `uninstrumented` / `evidenceCoverage` / `sixProp`.
5. **Engine scoreboards mixed eras** — primary scoreboards are instrumented-only; all-time split by build/schema/packet.
6. **Null deltas** — `deltaMetric` always returns `display`/`label` (`N/A` or `pending`).

---

## Files changed

**Server**
- `server.js` — `SERVER_BUILD=courteedge-lab-lifecycle-compat-v1`; Lab routes pass `currentLabSlateDate`
- `services/courtEdgeLabV2.js` — newest-slate resolver; instrumentation flags; all-time era splits; instrumented scoreboards
- `services/courtEdgeLabV2Helpers.js` — official recognition; sealed conf/risk; classify instrumentation; delta display; instrumented-only scorecards
- `services/courtEdgeLabV2Constants.js` — build tag + learning min props + schema constants
- `services/historyThreeSlateGroupsV2.js` — six-prop learning track; chronological freeze bootstrap; prop dedupe key; legacy dates
- `scripts/testCourtEdgeLabV2.js` — cases 69–76 (+ updated 26/29)

**App**
- `app/(tabs)/prop-lab.tsx` — instrumentation banners; N/A deltas; conf/risk source; all-time era rows; engine segregation note

**Not touched**
- Best 6 generation, track-all-six, same-team policy, Jul 17 Results rewrite, clear-tracked-props, Calibration Feedback Engine, weight files

---

## Three-slate membership (post-fix)

```
frozen block-1: [2026-06-21, 2026-06-22, 2026-07-08]
frozen block-2: [2026-07-14, 2026-07-15, 2026-07-16]   ← Jul 16 remains 3-prop
active block-3: [2026-07-17]  progress 1/3              ← new six-prop learning track
```

July 16 is historical/legacy (`thinOfficial`, `uninstrumented`) and does **not** enter the new active six-prop block.

---

## Tests

```
npm run test:courtedge-lab-v2
→ 76 passed, 0 failed
```

No weight / calibration-config file changes in this ship.

---

## Live verification checklist

Prod base: `https://betbrain-server-1.onrender.com`

1. `GET /health` → `serverBuild: courteedge-lab-lifecycle-compat-v1`
2. Startup rehydrates graded `lab-bundles/2026-07-17` (3-3-0) over ungraded TEST shells
3. `GET /courtedge/lab` →
   - `labV2.slateDate` / `currentSlate.slateDate` = newest completed official (expect `2026-07-17` until Jul 19 exists)
   - `currentSlate.sixProp: true`
   - `currentSlate.uninstrumented` / `legacy` honest when no sealed `courtEdgeEngineSignalsV1`
   - `activeThreeSlateBlock.slateDates` starts new six-prop block (Jul 17+)
   - previous/frozen still contains Jul 16 as 3-prop historical
   - engine scoreboard `instrumentedOnly: true`, sampleSize 0 while uninstrumented
   - deltas expose `display: "N/A"` (never bare null crash)
   - `allTimeContext.byBuildVersion` / `byEvidenceSchema` present
4. `GET /courtedge/lab/2026-07-16` → exactly 3 official props; immutable; legacy/thin flags

### Hotfix lineage
- `e14d6b7` — lifecycle/compat ship
- `43b8fbb` — import `computeSlateRotation` on Lab routes
- `81a40c1` — graded Jul 17 lab-bundle + ungraded-shell force restore + three-slate heal

---

## Autonomy trail

Inspect → implement → test (76/76) → commit → push `orgin/betbrain-v2-rebuild` → Render auto-deploy → live `/courtedge/lab` verify.
