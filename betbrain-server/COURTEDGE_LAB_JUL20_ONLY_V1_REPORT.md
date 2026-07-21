# CourtEdge Lab Jul 20 Only V1 Report

| Field | Value |
| --- | --- |
| **Date (CT)** | 2026-07-21 |
| **Build** | `courteedge-lab-jul20-only-v1` |
| **Prod** | https://betbrain-server-1.onrender.com |
| **Timezone** | America/Chicago |

## Verdict

Lab learning track now starts at **2026-07-20**. **2026-07-17** is History-only (archived graded data retained) and never Lab `currentSlate` / never active three-slate learning membership. Active block is **`1/3 · [2026-07-20]`**. `writesLiveWeights` remains **false**.

## Root cause (why live still showed Jul 17)

1. Render ephemeral disk wiped Jul 20 grades after prior deploy → Jul 20 stayed Results-pending.
2. Lab default / three-slate learning still treated Jul 17 as the first six-prop learning slate, so Lab stayed on **2026-07-17** (`3-3-0`) with active `1/3 [07-17]`.

## Fix

- `LAB_SIX_PROP_LEARNING_TRACK_START_DATE = "2026-07-20"` + `isLabSixPropLearningTrackDate()`
- Lab default prefers on-track completed **or sealed-pending** dates; never resurrects pre-track History dates
- Rotation: pre-track completed dates force into History; never `currentLabSlateDate`
- Three-slate learning membership excludes pre-track dates (Jul 17 demoted to legacy)
- Persist store: active `[2026-07-20]`, demoted/legacy includes `2026-07-17`
- History archive `2026-07-17` phase **ARCHIVED** (grades preserved)

## Expected live after deploy

| Surface | Expected |
| --- | --- |
| `GET /courtedge/lab` → `labV2.slateDate` | `2026-07-20` |
| Official Best 6 | Howard, Thomas, Stevens, Griner, Leger-Walker, Reese |
| Active three-slate | `1/3` · `[2026-07-20]` |
| Jul 17 in Lab current/active | **no** |
| Frozen | `[2026-07-14, 2026-07-15, 2026-07-16]` |
| `writesLiveWeights` | `false` |

## Post-deploy ops

Re-run `POST /resolve-tracked-props` if Jul 20 grades were wiped again, then confirm graded record (target `4-2-0` or current).

## Non-goals honored

- Did not clear tracked props
- Did not delete Jul 20 sealed/graded data
- Did not inject Jul 19
- Did not change Home/Tomorrow boards
- Did not change weights / Calibration Feedback
