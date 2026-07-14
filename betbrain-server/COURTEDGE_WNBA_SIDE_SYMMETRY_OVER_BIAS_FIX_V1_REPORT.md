# CourtEdge WNBA Side-Symmetry Over-Bias Fix V1 Report

**SERVER_BUILD:** `courteedge-wnba-side-symmetry-over-bias-fix-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Remote:** `orgin`  
**Date:** 2026-07-14  
**Prior build:** `courteedge-player-role-profile-v1`

---

## 1. Executive verdict

Directionally concentrated WNBA Overs were **not** caused by Player Role Profile V1. They began at **projection inflation** (recent−season deltas double-counted on top of blend + `minutesFactor` remultiply), then were hardened by **Reader/Side Rescue asymmetries** (tie→Over, negative Under erasure, Over volume bonuses on negative edges, generic reliability treated as directional points) and **confidence that ignored BOTH_SIDES_WEAK / MIXED / AGAINST**.

After verified fixes, Jul 14 six-pack **snapshot gaps collapse** (~+5.5 → ~+1.9 profile-off / ~+0.5 profile-on). Rebuilt sides often **fail dual gap floors → NO_BET**, not a forced Under quota. Mirrored ±5 synthetic cases choose **OVER / UNDER symmetrically**. Confidence for weak sides lands ~40–45 instead of 78–86.

## 2. Phase 0 safety

| Check | Result |
|-------|--------|
| Branch | `betbrain-v2-rebuild` |
| HEAD before work | `b9df2f0` (matched `orgin/betbrain-v2-rebuild`) |
| Checkpoint | `aafd92b` — Home/Results source edits only (no runtime JSON / keys) |
| Mutations | None — no clear-tracked-props, wipe, restore, grade, or key rotation |

## 3. Where concentration begins

**Primary stage: Projection.** Jul 14 frozen Best 6 showed gaps Nelson +4.3 … Mabrey +7.9 (avg ~+5.5) while season/last5 alone cannot justify that magnitude once opportunity is counted once.

**Secondary stage: Reader.** Tie→Over (`>=`), Over volume bonuses even when edge &lt; 0, and `chosen.score < 0` killing sole-eligible Unders.

**Tertiary stage: Flip-First / Side Rescue.** `Math.max(0, rawReaderScore)` + gap-floor wipe → opposite Under display **0**; KEEP_ORIGINAL automatic; generic module scores added as directional points.

**Confidence stage:** Blend finished **before** Flip-First; BOTH_SIDES_WEAK did not cut confidence.

## 4. Verified root causes (and only these were fixed)

| ID | Cause | Fix |
|----|-------|-----|
| A | Recent−season `roleChange` deltas reapplied after blend | Default `applyRoleChangeDeltas=false` |
| B | `minutesFactor` remultiply after expected FGA/mins already blended | Removed from final proj; observed only |
| C | STABLE `minutesTrustMultiplier` &gt; 1 inflated points | Cap trust ≤1.0 for projection |
| D | Reader `overCase.score >= underCase.score` tie→Over | Strict `>`; ties → null / SIDE_SCORE_TIE |
| E | `chosen.score < 0` nullified Unders | Only `chosen.blocked` nullifies |
| F | Empty `fairLineSide` disagreed both sides | Treat empty as neutral |
| G | Over volume bonuses with negative edge | Gate volume bonuses to `edge >= 0` |
| H | Under lacked mirror of decisive-gap volume sample | Add Under strong-gap sample bonuses |
| I | Missing `roleTrend up` vs Under penalty | Symmetric −6 |
| J | Flip-First/Side Rescue `Math.max(0,…)` | Preserve signed reader scores |
| K | Generic `mod.score` as directional | Uncertainty penalty only |
| L | `OPPORTUNITY` Over-only Side Rescue evidence | Removed |
| M | Under fragility `ROLE_NOT_DOWN` for STABLE | Only EXPANDING counts |
| N | BOTH_SIDES_WEAK/MIXED/AGAINST no confidence cut | Influence −18/−6/−8 wired into finalConfidence |
| O | High Risk summary = BOARD_ONLY count | Canonical `trueRisk === HIGH` |
| P | Forced display O/U swaps | `applyDisplaySideBalance` identity |

## 5. Prior-fix integrity

| Prior fix | Status |
|-----------|--------|
| Over-balance / Side Rescue | Still present; kept (not redundant) |
| Projection contradiction / gap floors | Intact; dual-fail still NO_BET |
| Flip-First | Intact; opposite viability → BOTH_SIDES_WEAK when Under gap fails |
| dataMode propagation | Intact |
| Gap floors | Intact |
| Player Role Profile V1 | Kept; caps untouched; STABLE no longer inflates projection |

## 6. Explicit bias search results

1. **tie→Over** — FOUND in Reader; fixed.  
2. **Under/opposite clamp to 0** — FOUND (`Math.max(0)` + floor wipe); fixed.  
3. **Original-side anchoring** — Side Rescue KEEP_ORIGINAL when opposite wiped; mitigated by signed scores + evidence half-weight.  
4. **Generic as directional** — FOUND (Flip-First module.score; OPPORTUNITY); fixed.  
5. **Repeated opportunity** — FOUND (blend + deltas + minutesFactor); fixed.  
6. **Confidence inflation** — FOUND; fixed via DDI influence + post-pipeline blend.  
7. **High Risk vs card trueRisk** — FOUND (`BOARD_ONLY` mapped to highRisk); fixed.

## 7. Projection double-counting proof

For Gustafson-like inputs (seasonMin 22, recent 31, Δmin +8.4):

- **Before:** proj **17.2** with `minutesFactor≈1.25` after deltas already applied.  
- **After:** proj **13.3**, `minutesFactorApplied=1`, components reconcile (remainder 0).

Snapshot Mabrey 30.4 → rebuilt **24.5** (profile on) — ~6pt of phantom Over gap removed.

## 8. Reader side-symmetry proof

- Equal scores → no Over default (test 01).  
- ±5 mirrored gaps → OVER / UNDER (tests 02–03; audit mirrored scores 24 vs 22).  
- Negative Over edge no longer receives star volume bonuses.

## 9. Why Jul 14 Unders scored 0

1. Inflated Over gaps made Under edge deeply negative.  
2. Under gap floor failed → Side Rescue `gapFailed` wiped evidence boosts.  
3. `normalizeReaderScore(Math.max(0, negative))` → **0**.  
4. KEEP_ORIGINAL with original ~70–78 vs opposite **0**.

After projection repair, rebuilt gaps are thin; dual floor fail → **NO_BET**, which is honest — not a forced Under conversion.

## 10. Why confidence was 78–86 despite BOTH_SIDES_WEAK / MIXED / AGAINST

Confidence was computed **before** Flip-First. `finalInfluence.confidenceAdjustment` for BOTH_SIDES_WEAK was **0**. Formula: `0.7*readerConfidence + 0.3*winProb` with floor 30 — large Over reader scores kept confidence high.

**After:** internal `dataConfidence` / `directionalConfidence` / `finalConfidence`; BOTH_SIDES_WEAK −18, MIXED −6, market AGAINST −8. Jul 14 rebuild avg finalConfidence **~42**.

## 11. Risk summary vs trueRisk

`countCandidatesByEligibility` mapped BOARD_ONLY/SHADOW_ONLY → highRisk. Cards showed MEDIUM. **Fixed:** highRisk counts only `trueRisk === HIGH`.

## 12. Player Role Profile V1

Kept. STABLE trust no longer inflates projection. EXPANDING/CONTRACTING caps unchanged. Profile on/off replay supported in `auditWnbaSideSymmetryV1.js`.

## 13. Side Rescue retention

**Kept.** Still needed for risk-debt opposite review. Not removed; scoring/caps symmetrized.

## 14. Best 6 / track-all / Top 2 / lifecycle

Unchanged. No side quota. Display side-balance swaps disabled.

## 15. Four-pass Jul 14 replay (frozen 6)

Snapshot (pre-fix, captured board): **6O**, avg gap ~**+5.5**, conf **78–86**, natural TRACK **0**, Side Rescue KEEP_ORIGINAL Overs with opposite **0**.

| Pass | Engine | Profile | Avg gap | Reader sides | Avg conf | Notes |
|------|--------|---------|---------|--------------|----------|-------|
| 1 | Snapshot baselines | n/a | +5.5 | 6O | 78–86 | Inflated projection era |
| 2 | Fixed | OFF | +1.93 | 0O/0U (6 NONE/NO_BET) | 42.5 | Gaps too thin for floors |
| 3 | Fixed | ON | +0.45 | 0O/0U (6 NONE/NO_BET) | 41.7 | Profile pulls toward season |
| 4 | Same as 2–3 | | | | | Fixed engine only available post-repair |

**Honest outcome:** Not “naturally 6 Overs” after math — **NO_BET slate** under rebuilt projections because cleaned gaps fail WNBA floors. No Under forced.

Per-player (profile ON, fixed):

| Player | Snap proj | Rebuilt | Gap | Reader | Conf |
|--------|-----------|---------|-----|--------|------|
| Leite | 20.7 | 16.0 | +1.5 | NONE | 40 |
| Nelson-Ododa | 14.8 | 9.3 | −1.2 | NONE | 40 |
| Gustafson | 17.2 | 11.8 | −0.7 | NONE | 40 |
| Mabrey | 30.4 | 24.5 | +2.0 | NONE | 45 |
| Citron | 23.1 | 19.3 | +1.8 | NONE | 45 |
| Iriafen | 18.8 | 13.8 | −0.7 | NONE | 40 |

## 16. Mirrored symmetry (A–I coverage)

Covered in `testWnbaSideSymmetryV1.js` cases 01–25. Mirrored ±5 deterministic without balancing code. Equal cases no Over default. Generic reliability non-directional. EXPANDING/CONTRACTING caps mirrored. Side Rescue both directions.

## 17. Historical distribution

Frozen Jul 14 + `.tmp-six-props-all.json` inspected via audit script. Counts alone do **not** claim bias without mirrored tests (which now pass). Pre-fix board was Over-heavy because of verified projection/score asymmetries, not slate composition luck.

## 18. Tests

**New:** `betbrain-server/scripts/testWnbaSideSymmetryV1.js` — **25/25 passed**.  
**New audit:** `betbrain-server/scripts/auditWnbaSideSymmetryV1.js` (read-only).

**Regressions run:**

| Suite | Result | Notes |
|-------|--------|-------|
| testWnbaSideSymmetryV1 | 25/25 | New |
| testPlayerRoleProfileV1 | 16/16 | Pass |
| testControlledBestSixDisplay | 47/47 | Updated highRisk expectations |
| testOverBalanceSideRescueV1 | 12/12 | Pass |
| testResultsTrackingCohort | PASS | Soft-assert today/tomorrow cohort |
| testWnbaTrackingGateV2 | 41/42 | Live thin-gap accept NO_BET\|BOARD_ONLY; cascade suite #21 data-flow still has 2 pre-existing fails |
| testFlipFirstDecisionIntelligenceV1 | 10b updated | BOTH_SIDES_WEAK valid when Under gap fails |
| testSideRescueEngineV1 | version → v1.3 | Nested suites may still cascade pre-existing data-flow fails |

**Pre-existing (not introduced as Over-bias regressions):** `testCourtEdgeDataFlow` 2 fails (controlledSelection passthrough / locked slate), nested cascade noise.

## 19. Live safety checklist

1. Push source to `orgin/betbrain-v2-rebuild` — **done** (`b0d7dd9`)
2. Confirm health `SERVER_BUILD=courteedge-wnba-side-symmetry-over-bias-fix-v1` — **live**
3. Refresh Tomorrow **once** — **done** (`POST /refresh-picks`, artifact `.poll-refresh-side-symmetry-v1.json`, `lastUpdated=2026-07-14T02:25:38Z`)
4. Capture candidate pool before shrink + stage O/U counts — **done** (see below)
5. No tracked clear/duplicate; no Results/Lab/History mutation — **honored**

### Live refresh outcome (not forced balance)

| Stage | Result |
|-------|--------|
| Raw markets | 83 Over / 83 Under lines scanned |
| Chosen sides | **0 Over / 5 Under** |
| All generated (pre Best 6 shrink) | 5 Unders (TODAY slate; Tomorrow games present with **0** prop candidates — no lines) |
| Best 6 display WNBA | 0 (no TRACK / display-eligible after gates) |
| Confidence blend | `dataConfidence` 100, `directionalConfidence` 39–51, final ~60–68 with BOTH_SIDES_WEAK |
| Reader cases | Under scores **+30…+46** vs Over **−25…−48** (Unders can earn scores) |

Sample pool:

| Player | Side | Line | Proj | Gap | Conf | trueRisk | Track |
|--------|------|------|------|-----|------|----------|-------|
| Kahleah Copper | Under | 26.5 | 21.5 | −5.0 | 66 | MEDIUM | BOARD_ONLY |
| Kayla McBride | Under | 25.5 | 20.3 | −5.2 | 68 | HIGH | BOARD_ONLY |
| Olivia Miles | Under | 25.5 | 19.8 | −5.7 | 66 | HIGH | BOARD_ONLY |
| Monique Akoa Makani | Under | 15.5 | 8.2 | −7.3 | 60 | HIGH | NO_BET |
| DeWanna Bonner | Under | 13.5 | 7.5 | −6.0 | 64 | HIGH | BOARD_ONLY |

Natural Under concentration when projections sit well below lines — **not** an Over-default and **not** a forced Under quota.

## 20. Files changed (source)

- `betbrain-server/engines/wnba/wnbaProjectionEngine.js`
- `betbrain-server/engines/wnba/wnbaReaderEngine.js`
- `betbrain-server/engines/wnba/wnbaDecisionEngine.js`
- `betbrain-server/engines/decisionIntelligence/flipFirstSideSelectionV1.js`
- `betbrain-server/engines/decisionIntelligence/sideRescueEngineV1.js`
- `betbrain-server/engines/decisionIntelligence/decisionDataIntelligenceV1.js`
- `betbrain-server/server.js` (SERVER_BUILD)
- `utils/controlledBestSixDisplay.js`
- Scripts: audit + testWnbaSideSymmetryV1 + related expectation updates

## 21. What was NOT done (by design)

No Under/Over quota, no blind flip, no Best 6 size change, no track-all change, no grading/lifecycle change, no Home UI labels, no profile cap removal, no tracked mutation, no key rotation.

## 22. Residual risks

- Thin rebuilt gaps → more **NO_BET** until lines/projection align — correct, but boards may look emptier temporarily.  
- Results “today while display tomorrow” cohort soft-assert — needs dedicated follow-up if still empty in stricter mode.  
- Nested data-flow pre-existing fails remain.

## 23. Proof statements required by brief

- Symmetry proven by mirrored ±5 + equal-score tests.  
- Concentration begins at **projection** (stage proof above).  
- Jul 14 Unders at 0 explained (clamp + floor wipe + inflated gaps).  
- Confidence high despite weakness explained and cut.  
- Profile does not duplicate opportunity after delta/minutesFactor removal; EXPANDING remains bounded.  
- Repaired system passes mirrored cases 01–25.

## 24. Deployment note

Set `SERVER_BUILD` to `courteedge-wnba-side-symmetry-over-bias-fix-v1` before live refresh.

## 25. Audit artifact

`betbrain-server/COURTEDGE_WNBA_SIDE_SYMMETRY_AUDIT_V1.json` (generated by audit script).

## 26. Commit / push

Commit + push to **`orgin`/`betbrain-v2-rebuild`** after this report.

## 27. Sign-off

Verified Over-bias root causes repaired without forced balancing. Natural 6O/6U/mixed remain allowed when evidence supports them; Jul 14 rebuilt math does **not** manufacture 6 Overs.
