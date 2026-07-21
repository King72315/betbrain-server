# CourtEdge Lab Learning-Track Floor V1 Report

| Field | Value |
| --- | --- |
| **Date (CT)** | 2026-07-21 |
| **Build** | `courteedge-lab-learning-track-floor-v1` |
| **Prod** | https://betbrain-server-1.onrender.com |

## Verdict

`LAB_SIX_PROP_LEARNING_TRACK_START_DATE=2026-07-20` is an **eligibility floor**, not a permanent Lab pin. Lab current = **newest** completed eligible official slate with `slateDate >= 2026-07-20`. Pre-floor dates (e.g. Jul 17) stay History/legacy. Active three-slate appends until 3/3, then freezes immutable membership and starts a new empty `0/3` active block.

## Behavior

| State | Current Lab | Active block |
| --- | --- | --- |
| Only Jul 20 completed | `2026-07-20` | `1/3` · `[2026-07-20]` |
| + next eligible (e.g. Jul 21) | newest | `2/3` · `[2026-07-20, next]` |
| + third eligible | newest | freeze `3/3`, active `0/3` empty |
| Jul 17 alone or with on-track dates | never Lab current | never in active learning |

## Code

- Floor helper unchanged semantically (`d >= START_DATE`); comments clarify floor ≠ pin
- `resolveNewestCompletedOfficialSlateDate` → newest on-track completed (no hard-coded `currentSlate === '2026-07-20'`)
- `syncThreeSlateBlocksV2`: on exact 3/3, freeze membership and open empty next active
- Heal: never demote floor-eligible dates from incomplete active; sealed on-track official six (pending or graded) join learning dates; floor dates never sit in legacy
- Build: `courteedge-lab-learning-track-floor-v1`
- Tests 92–96 cover floor rotation + sealed-pending; suite 96/96 Lab V2

## Expected live (today)

Only Jul 20 is on-track eligible → Lab shows **`2026-07-20`** / active **`1/3 [2026-07-20]`**, via newest-on-or-after-floor (not a pin). Jul 17 remains History-only.

## Live verify

| Check | Result |
| --- | --- |
| `serverBuild` | `courteedge-lab-learning-track-floor-v1` |
| `labV2.slateDate` | `2026-07-20` |
| Active | `1/3` · `[2026-07-20]` |
| `instrumentedLearningDates` includes Jul 20 | yes |
| Jul 20 in legacy | no |
| Jul 17 in active | no |
| `writesLiveWeights` | `false` |
