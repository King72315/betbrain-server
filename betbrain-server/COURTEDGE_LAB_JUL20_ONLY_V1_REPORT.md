# CourtEdge Lab Jul 20-only V1 Report

| Field | Value |
| --- | --- |
| **Date (CT)** | 2026-07-21 |
| **Build** | `courteedge-lab-jul20-only-v1` |
| **Prod** | https://betbrain-server-1.onrender.com |

## Verdict

Lab learning track now starts at **2026-07-20**. **2026-07-17** is History-only (not Lab current, not in active three-slate). Active learning block is **`1/3 · [2026-07-20]`**. Jul 17 graded archive data is preserved (`phase: ARCHIVED`). Weights unchanged (`writesLiveWeights: false`).

## Root cause

After Render disk wipe, Jul 20 sealed props sat in Results as ungraded while Jul 17 history-archive remained `phase: "LAB"`. Rotation excluded Jul 20 (active Results) and fell back to Jul 17 as Lab default. Three-slate learning also treated Jul 17 as a six-prop learning member (`2/3 [07-17, 07-20]`).

## Code fix

- `LAB_SIX_PROP_LEARNING_TRACK_START_DATE = "2026-07-20"`
- Pre-track dates excluded from Lab candidates / learning dates
- Lab default prefers on-track completed (props + DSR) over History-only Jul 17
- Build bump: `courteedge-lab-jul20-only-v1`

## Expected live

| Surface | Expected |
| --- | --- |
| `labV2.slateDate` / `currentSlate` | `2026-07-20` |
| Official Best 6 | Howard, Thomas, Stevens, Griner, Leger-Walker, Reese · `4-2-0` |
| Active three-slate | `1/3` · `[2026-07-20]` |
| Jul 17 | not current / not in active learning block |
| `writesLiveWeights` | `false` |
