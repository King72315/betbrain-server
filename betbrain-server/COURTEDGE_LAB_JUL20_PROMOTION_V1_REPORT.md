# CourtEdge Lab Jul 20 Promotion V1 Report

| Field | Value |
| --- | --- |
| **Date (CT)** | 2026-07-21 |
| **Build** | `courteedge-lab-jul20-promotion-v2` |
| **Prod** | https://betbrain-server-1.onrender.com |
| **Timezone** | America/Chicago |

## Verdict

Jul 20 official Best 6 was sealed in Results, graded via `POST /resolve-tracked-props`, and promoted to Lab default **2026-07-20**. A three-slate membership bug then left active as `1/3 [07-20]` after incorrectly freezing Jul 17 with legacy dates; fixed and redeployed so active becomes **`2/3 [07-17, 07-20]`** with frozen **`[07-14, 07-15, 07-16]`** immutable. `writesLiveWeights` remains **false**.

## Steps executed

1. **Verified Results cohort** — `GET /tracked-props` returned sealed official six for `2026-07-20` (Howard U18.5, Thomas O13.5, Stevens O11.5, Griner O12.5, Leger-Walker U8.5, Reese O16.5).
2. **Graded** — `POST /resolve-tracked-props` graded the slate (`4-2-0`, 6/6 decided). Daily report `2026-07-20` status `final`, pending `0`.
3. **Promoted** — lifecycle linked Lab default to `2026-07-20` (Results active cleared; History retains Jul 17). No date hardcode; newest eligible completed official became Lab default.
4. **Observed block bug** — Lab showed Jul 20 Official Best 6 with grades/conf/risk, but active three-slate was wrongly `1/3 [07-20]` and a non-anchor frozen block `[06-22, 07-08, 07-17]` had stolen Jul 17.
5. **Code fix (v1→v2)** — `syncThreeSlateBlocksV2` no longer bootstrap-freezes learning-track dates into legacy chunks when an early anchor date is missing; heals corrupt mixed frozen blocks on sync. v2 also keeps historical-anchor member dates (e.g. `2026-06-22`) out of the post-anchor six-prop learning track even when propCount ≥ 6, so active stays `[07-17, 07-20]` instead of a fake `[06-22, 07-17, 07-20]` 3/3.
6. **Engines** — Jul 20 sealed props lack `courtEdgeEngineSignalsV1`; scoreboard stays honest **UNINSTRUMENTED / N/A** (no fabricate). Same posture as Jul 17.

## Deploy note

Render ephemeral disk dropped in-memory grades on v1 deploy; Jul 20 sealed six survived in tracked props. Re-ran `POST /resolve-tracked-props` after deploy to restore grades/promotion before verifying v2 membership heal.

## Expected live after deploy

| Surface | Expected |
| --- | --- |
| `GET /courtedge/lab` → `labV2.slateDate` | `2026-07-20` |
| Official Best 6 | 6 graded (record `4-2-0`) with conf/risk/sealed fields |
| Active three-slate | `2/3` · `[2026-07-17, 2026-07-20]` |
| Frozen | includes `[2026-07-14, 2026-07-15, 2026-07-16]` only (no 06-22 mix) |
| `writesLiveWeights` | `false` |
| Engine scoreboard | N/A / uninstrumented when no sealed signals |

## Live verify (2026-07-21 CT, post v2 deploy)

`VERIFY_OK` on https://betbrain-server-1.onrender.com:

- build `courteedge-lab-jul20-promotion-v2`
- Lab default `2026-07-20`, Official Best 6 graded `4-2-0`
- active `2/3` `[2026-07-17, 2026-07-20]`
- frozen `[2026-07-14, 2026-07-15, 2026-07-16]`
- engines UNINSTRUMENTED / N/A
- `writesLiveWeights: false`

## Files changed

- `services/historyThreeSlateGroupsV2.js` — learning-track bootstrap guard + corrupt-mix heal
- `services/courtEdgeLabV2Constants.js` — `LAB_V2_BUILD`
- `server.js` / integrity + tab-flow build stamps
- `scripts/testCourtEdgeLabV2.js` — cases 88–90

## Non-goals honored

- Did not rewrite Jul 17 sealed props
- Did not inject Jul 19
- Did not change weights / Calibration Feedback
- Did not invent engine signals postgame
