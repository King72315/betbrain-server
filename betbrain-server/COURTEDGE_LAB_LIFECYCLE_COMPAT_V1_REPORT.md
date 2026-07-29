# CourtEdge Lab Lifecycle + Compatibility

**Date (CT):** 2026-07-28 / 2026-07-29  
**SERVER_BUILD:** `courteedge-lab-lifecycle-compat-v2`  
**LAB_V2_BUILD:** `courteedge-lab-lifecycle-compat-v2`  
**labLifecycleCompat:** `courteedge-lab-lifecycle-compat-v2`  
**Branch:** `betbrain-v2-rebuild` · remote `orgin`  
**Prod:** `https://betbrain-server-1.onrender.com`

## Verdict

Sealed-pending dates (e.g. **2026-07-29** with 0/6 grades) were being counted toward three-slate **3/3 freezes**, which emptied Active to `0/3` and parked Jul 29 inside Previous with Jul 20/22. That made Prop Lab show a misleading completed-block win-rate Δ (`prev 26.1 → cur 66.7`) while Active was empty.

**Fix:** freeze only **fully graded** learning-track dates; sealed-pending may sit on-deck in Active but never enter a frozen 3/3. Corrupt frozen blocks that include non-graded members are healed on sync. Incomplete Active comparisons stay **N/A** (never inherit prior-block deltas). **No calibration weight changes.**

---

## Live page report (pre-fix)

From Prop Lab copy report @ Jul 28, 2026 11:28 PM CT:

| Field | Broken value |
| --- | --- |
| Build | `courteedge-results-lab-refresh-v1` |
| Current slate | `2026-07-22` · 4-2-0 (66.7%) |
| Active | `0/3` · none |
| Previous | `2026-07-20, 2026-07-22, 2026-07-29` |
| Win rate Δ | prev 26.1 → cur 66.7 (+40.6) |

Jul 29 live Lab view: **6 props, 0 graded, 6 pending** — must not freeze.

---

## Required outcomes (lifecycle / compat)

| # | Outcome | Status |
|---|---------|--------|
| 1 | Newest completed official is Lab current | **PASS** — `2026-07-22` (Jul 29 pending does not pin Lab) |
| 2 | Lab defaults to newest completed official | **PASS** — floor ≥ `2026-07-20`, newest graded wins |
| 3 | Preserve July 16 as immutable 3-prop | **PASS** — frozen block-2; `/lab/2026-07-16` → 3 props, legacy/uninstrumented |
| 4 | Legacy / uninstrumented flags | **PASS** — slate + prop + `evidenceCoverage` |
| 5 | No inventing engine signals from postgame | **PASS** — missing sealed signals → UNAVAILABLE |
| 6 | Conf/risk from sealed decision packet | **PASS** — `resolveSealedConfidenceRisk` |
| 7 | Engine scoreboard excludes uninstrumented | **PASS** — `instrumentedOnly: true` |
| 8 | Three-slate deltas never null/crash | **PASS** — incomplete → `display: N/A` |
| 9 | All-time split by build/version | **PASS** — `byBuildVersion` / schema / packet |
| 10 | Active six-prop block; Jul 16 not poisoning | **PASS** — Jul 16 stays frozen historical; active = graded Jul 20/22 + sealed-pending Jul 29 on-deck |

---

## Root cause

1. `buildHistoryThreeSlateGroupsV2` admits sealed-pending six-prop dates into `learningDates` (intentional for floor visibility).
2. `syncThreeSlateBlocksV2` froze any 3 dates in `working` regardless of grades.
3. Result: `[2026-07-20, 2026-07-22, 2026-07-29]` became a fake complete Previous block; Active → empty `0/3`.
4. Empty Active fell through to Previous’s completed-vs-prior comparison → UI showed +40.6 while Active looked idle.

---

## Fix

**`services/historyThreeSlateGroupsV2.js`**
- Peel/freeze only when ≥3 **completed** (fully graded) learning dates exist.
- Sealed-pending remain in Active as `pendingSlateDates`; progress uses graded count (`2/3`) when any graded members exist; pending-only floor still shows `1/3`.
- Heal: dissolve non-anchor frozen blocks whose members are not all fully graded.

**`services/courtEdgeLabV2.js`**
- Incomplete Active (dates present) uses Active comparison only → N/A.
- Empty Active after a real 3/3 freeze still exposes Previous’s completed-block comparison (tests 80/94).

**UI / copy report**
- Prop Lab + report builders surface sealed-pending as not freezable.

**Builds**
- `SERVER_BUILD` / `LAB_V2_BUILD` / `labLifecycleCompat` → `courteedge-lab-lifecycle-compat-v2`

**Not touched**
- Best 6 generation, track-all-six, same-team policy, Jul 17 Results rewrite, clear-tracked-props, Calibration Feedback Engine, weight files, inventing engine signals.

---

## Expected membership (post-heal)

```
frozen block-1: [2026-06-21, 2026-06-22, 2026-07-08]
frozen block-2: [2026-07-14, 2026-07-15, 2026-07-16]  ← Jul 16 remains 3-prop
active block-3: completed [2026-07-20, 2026-07-22]  progress 2/3
                pending   [2026-07-29]               (on-deck, not freezable)
Lab current:    2026-07-22
```

When a third on-track slate is **fully graded**, Active freezes to 3/3 and opens a new empty `0/3` (plus any remaining sealed-pending).

---

## Tests

```
npm run test:courtedge-lab-v2
→ 98 passed, 0 failed
```

New cases:
- **97** — two graded + one sealed-pending → Active `2/3`, Jul 29 not in Previous, Δ N/A
- **98** — heal dissolves corrupt frozen `[20,22,29]` pending poison

No weight / calibration-config file changes.

---

## Live verification checklist

Prod: `https://betbrain-server-1.onrender.com`

1. `GET /health` → `serverBuild: courteedge-lab-lifecycle-compat-v2`
2. `GET /courtedge/lab` →
   - `slateDate` / `currentSlate.slateDate` = `2026-07-22` (until a newer slate is fully graded)
   - `activeThreeSlateBlock.progress` = `2/3`
   - `completedSlateDates` includes `2026-07-20`, `2026-07-22`
   - `pendingSlateDates` includes `2026-07-29` (or empty if Jul 29 absent)
   - Previous does **not** include `2026-07-29`
   - `threeSlateComparison.metrics.winRate.available` = false / `display: N/A`
   - `writesLiveWeights` = false
3. `GET /courtedge/lab/2026-07-16` → exactly 3 props; legacy / uninstrumented
4. `GET /courtedge/lab/2026-07-29` → pending OK; not frozen into Previous

### Post-deploy verify (2026-07-28/29 live)

| Check | Result |
| --- | --- |
| `SERVER_BUILD` | `courteedge-lab-lifecycle-compat-v2` |
| Lab current | `2026-07-22` · 4-2-0 · sixProp · evidenceCoverage 100 |
| Active | `2/3` · completed `[2026-07-20, 2026-07-22]` · pending `[2026-07-29]` |
| Previous | `[2026-07-14, 2026-07-15, 2026-07-16]` — Jul 29 **not** included |
| Jul 16 | 3 props · legacy · uninstrumented |
| Win rate Δ (incomplete active) | `available=false` · `display=N/A` |
| Weight writes | `false` |
| Tests | Lab V2 **98/98** |
| Commit | `5a850e0` on `betbrain-v2-rebuild` → `orgin` |
