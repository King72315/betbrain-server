# CourtEdge Clear-Side Strong-Edge Membership Path V1

**Build:** `courteedge-clear-side-strong-edge-membership-path-v1`  
**Mode:** Membership qualification and confidence-packaging repair  
**Scope:** August 5 unsealed reconstruction + future unsealed WNBA points boards  
**Date:** 2026-08-05

---

## 1. Root cause

Circular over-filtering:

1. Soft packaging treated **missing** `bestPropScore` / `pickScore` as `0` → universal `LOW_BEST_PROP_SCORE`.
2. Soft packaging treated bridged projection-quality **MIXED** + usage-advisory text / `confidenceAdjustment <= -3` as `PROJECTION_SANITY_WEAK` via `questionsUsage`.
3. Soft penalties demoted **every** dual-side candidate to `TEAM_SIDE_LAST_VALID`.
4. Membership quality **hard-rejected** `TEAM_SIDE_LAST_VALID` as a standalone gate.

Result: 46 dual-side evaluations → 0 Official props, even when directional edge, fair line, and side packets were strong.

---

## 2. Why 46/46 scored below 50

Not a weight bug and not a true 0–100 score collapse.

- Dual-side membership scored `allGeneratedCandidates` rows that often lacked `pickScore` / `bestPropScore`.
- `resolveBestPropScore()` defaulted missing → **0**.
- Soft gate: `score < 50` → `LOW_BEST_PROP_SCORE` on **every** packet.
- Board-capped rows that *did* have scores used an **inflated** scale (~200–500), which is not a 0–100 floor — but the empty-board path was driven by the **missing→0** path, not by compressing strong props below 50.

Required invariant restored: a strong complete WNBA prop can score above 50; missing score is **not** treated as low.

---

## 3. Why 46/46 received projection-sanity weak

False universal trigger in soft packaging:

- DDI projection quality often returns **MIXED** with reason “Projection not supported by usage share.”
- Legacy bridge maps MIXED → `confidenceAdjustment = -3`.
- `resolveProjectionSanity().questionsUsage` was true when reason matched `/usage|minutes|not supported/i` **or** `confidenceAdjustment <= -3`.
- Soft penalties used `questionsUsage` as `PROJECTION_SANITY_WEAK`.

Aligned packets (e.g. Plum Over +5.1 with fair line agree) were incorrectly flagged WEAK.

---

## 4. Exact formula defects found

| Defect | Location | Fix |
|--------|----------|-----|
| Missing score → 0 → `<50` soft hard-cascade | `collectSoftPenalties` + `resolveBestPropScore` | `auditBestPropScore`: missing ≠ low; inflated scale ≠ below-50 floor |
| MIXED usage advisory → WEAK | `resolveProjectionSanity` + soft penalties | `resolveProjectionSanityLevel` STRONG/MIXED/WEAK; soft WEAK only on genuine WEAK / ceiling / directional conflict |
| `TEAM_SIDE_LAST_VALID` standalone hard reject | `evaluateOfficialMembershipQuality` | Removed as hard block; ranking/diagnostic only |
| `BOARD_ONLY` treated like hard reject via soft cascade | soft + membership | BOARD_ONLY soft ranking only; membership hard-rejects `NO_BET` only |
| Dual-side shared sanity | soft path | Side-isolated sanity level on Over/Under packets |
| Under-only selection crash | `selectTeamSidePair` | Null-safe when no qualified Over |

**Not changed:** prediction / calibration weights, edge floor 1.5, market/availability/blowout/side-integrity hard blocks.

---

## 5. Files changed

- `engines/topProps/controlledBoardMembershipQualityV1.js`
- `engines/topProps/controlledBestBoardV2.js`
- `engines/topProps/bestSixSelectionIntegrityV1.js`
- `engines/topProps/controlledBestBoardCanonicalV3.js`
- `server.js` (`SERVER_BUILD`)
- `scripts/testClearSideStrongEdgeMembershipPathV1.js` (new)
- `scripts/dryRunClearSideStrongEdgeAug5V1.js` (new)
- `scripts/testControlledBoardNoLastValidGarbageV1.js` (updated assertions)
- `scripts/testControlledBestBoardPairSelectionV2.js` (updated build tag / score behavior)

---

## 6. Before / after score distribution (Aug 5 dry run)

Dual-side soft evaluations (both sides counted):

| Metric | Before (legacy packaging) | After (repaired) |
|--------|---------------------------|------------------|
| `LOW_BEST_PROP_SCORE` flags | 66 / 66 side-evals | **0** |
| Missing score treated as low | Yes | **No** |

Strong complete packets with `bestPropScore` ≥ 50 or inflated `pickScore` no longer receive a universal low-score flag.

---

## 7. Before / after projection-sanity distribution

| Metric | Before | After |
|--------|--------|-------|
| Soft `PROJECTION_SANITY_WEAK` (all side-evals) | 66 / 66 via `questionsUsage` | 55 / 66 — almost all remaining WEAK are **wrong-side** packets (directional conflict) |
| Focus strong-edge **aligned** sides (Plum O, Howard U, Burrell U, Nneka U, Hiedeman O, Flau’jae O) | WEAK | **MIXED** (not WEAK) |

---

## 8. Removal of `LAST_VALID` as standalone hard block

- `TEAM_SIDE_LAST_VALID` may still appear as a soft ranking tier.
- It **cannot** make an invalid candidate valid.
- It **cannot** independently make a valid candidate invalid.
- Empty-slot reasons no longer surface `TEAM_SIDE_LAST_VALID` alone.

---

## 9. Evidence-based gates preserved

Still hard-reject:

- `NATURAL_NO_BET`
- `BOTH_SIDES_WEAK`
- `UNCERTAINTY`
- `EDGE_BELOW_MEMBERSHIP_FLOOR` (&lt; 1.5)
- `BLOWOUT_OVER_HARD_BLOCK`
- `UNCONFIRMED_AVAILABILITY_OVER_BLOCK`
- `ORIGINAL_SIDE_MISMATCH_NO_VALID_FLIP`
- `SEALED_SIDE_PACKET_MISMATCH`
- `LOW_VOLUME_WITHOUT_UNDER_EDGE`
- `UNDER_PROJECTION_ABOVE_LINE` / fair-line under conflicts
- Market sanity / wrong date / wrong event / invalid identity / inactive / malformed line

Added explicit evidence check: fair line must support selected side (or documented stronger evidence).

---

## 10. August 4 regression results

Reconstructed membership (file **not** rewritten):

| Prop | Result | Evidence blocks |
|------|--------|-----------------|
| Marina Mabrey Over 18.5 | Rejected | Blowout 77 + unconfirmed Day-to-Day |
| Gabby Williams Over 14.5 | Rejected | Edge below floor / no valid Over flip / both-sides weak / uncertainty |
| Julie Allemand Under 6.5 | Rejected | `NO_BET` + projection above line / low-volume |
| Veronica Burton Under 12.5 | Rejected | `BOTH_SIDES_WEAK` (sealed flipFirst) |

Official reconstructed count: **0**. Snapshot `2026-08-04.json` unchanged (`propCount: 4`, `lockedAt` preserved).

---

## 11. August 5 raw-market dry run

Source: `_tmp_picks.json` raw candidates (not old sealed labels).  
Artifact: `_dryrun_clear_side_strong_edge_membership_path_v1_aug5.json`

| Metric | Value |
|--------|-------|
| Candidate markets (deduped) | 33 |
| Dual-side evaluations | 46 |
| Rejected only by old `LAST_VALID` | 0 (no longer a hard path) |
| Rejected by real evidence blocks | 40 |
| Newly qualified sides | 6 |
| Final Official | **4** |
| Overs / Unders | 2 / 2 |
| Games represented | 3 |
| Home count | 4 |
| Results count | 4 |

---

## 12. Newly qualified props

1. Kelsey Plum Over 16.5 — edge 5.1  
2. Rhyne Howard Under 17.5 — edge 4.6  
3. Rae Burrell Under 16.5 — edge 2.4  
4. Nneka Ogwumike Under 18.5 — edge 2.4  
5. Natisha Hiedeman Over 16.5 — edge 2.2  
6. Flau’jae Johnson Over 15.5 — edge 1.6  

---

## 13. Selected Official props

1. **Rhyne Howard** Under 17.5 (Atlanta) — edge 4.6  
2. **Kelsey Plum** Over 16.5 (Phoenix) — edge 5.1  
3. **Nneka Ogwumike** Under 18.5 (Los Angeles) — edge 2.4  
4. **Flau’jae Johnson** Over 15.5 (Seattle) — edge 1.6  

Qualified but not selected (team slot lost to stronger same-side teammate / no pair complement):

- Natisha Hiedeman Over 16.5 (Seattle — Flau’jae selected)
- Rae Burrell Under (LA — Nneka selected)

---

## 14. Empty slots and reasons

| Team | Result |
|------|--------|
| Dallas Wings | Empty — no side ≥ 1.5 membership edge |
| Washington Mystics | Empty — no side ≥ 1.5 membership edge |
| New York Liberty | Empty — no qualified evidence-based side |
| Chicago Sky | Empty — no qualified evidence-based side |
| Atlanta / Phoenix / Seattle / LA | Partial boards (1 prop each) — opposite team slot empty when no second qualified distinct-player side |

No forced fills.

---

## 15. Dallas–Washington result

Edges remain ~0.2–0.8. **No Official props.** Floor stayed at 1.5. Empty slots accepted.

---

## 16. Tests passed and failed

| Suite | Result |
|-------|--------|
| `testClearSideStrongEdgeMembershipPathV1.js` (Tests 1–15 + weights) | **17 passed, 0 failed** |
| `testControlledBoardNoLastValidGarbageV1.js` | **16 passed, 0 failed** |
| `testControlledBestBoardPairSelectionV2.js` | **15 passed, 0 failed** |

All listed acceptance tests 1–15: **PASS**.

---

## 17–19. Home / Results / Over-Under counts

- Home Official: **4**
- Results membership: **4** (identity equal)
- Overs: **2** / Unders: **2**

---

## 20. Confirmation — no forced fills

Empty slots remain empty when evidence fails. No `TEAM_SIDE_LAST_VALID` force-seal. Variable board size 0–4 per game preserved.

---

## 21. Confirmation — no prediction weights changed

`CALIBRATION_WEIGHTS` unchanged (`OVER_PROJECTION_EDGE_FACTOR` 0.85, `UNDER_PROJECTION_EDGE_FACTOR` 1.03, `MAX_ABS_SCORE_DELTA` 22). No broad signal-weight edits.

---

## 22. Confirmation — no completed slate rewritten

August 4 sealed snapshot untouched. August 5 had no sealed Official snapshot to rewrite (prior empty / deleted reconstruction path). Dry run is evaluation-only.

---

## Final principle check

Neither extreme applied:

- Did **not** seal every weak team-side filler.
- Did **not** reject every candidate for universal soft warnings.

Strong-edge, clear-side, valid-market props now have a path to Official membership. Weak, ambiguous, invalid, or forced-side props leave the slot empty.
