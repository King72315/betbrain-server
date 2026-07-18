# CourtEdge Line Lifecycle + Calibration Final Report

**Date:** 2026-07-18  
**Branch:** `betbrain-v2-rebuild`  
**Target SERVER_BUILD:** `courteedge-line-lifecycle-calibration-v1`  
**Prior live build:** `courteedge-best6-presentation-v1`  
**Board schema:** `courtedge-board-schema-v2`

---

## 1. Olivia Miles 17.5 → 16.5 — Root Cause

**Verdict: Legitimate market/consensus line move — not a same-team arbitration bug.**

| Checkpoint | Line | Notes |
|---|---|---|
| Pre-arbitration board candidate | **16.5** | Miles entered Best 6 arbitration already at Over 16.5 |
| Same-team arbitration | **16.5** | Side flipped Over→Under; line unchanged |
| Final Best 6 / Home | **16.5** Under | Presentation fields present |
| Opening snapshot (live) | **16.5** | Ephemeral Render disk reset opening ≈ current after redeploy |
| Historical local snapshots | **17.5** on earlier captures | Confirms books previously showed 17.5 |

**Why it looked like a bug:** After Render redeploys, `line-snapshots.json` is wiped. Opening lines re-seed from the current consensus, so the UI cannot prove “opened 17.5 → now 16.5” from live disk alone. Same-team flip only changes side.

**Code path selecting 16.5:** Odds consensus → `appendMarketSnapshot` current book line → candidate generation → `arbitrateSameTeamOpportunityV2` / `finalizeSameTeamForcedUnderPresentation` (side only) → Best 6 / seal / Home.

---

## 2. Legitimate or Bug?

- **Line change 17.5 → 16.5:** Legitimate provider/consensus market move before/at selection (not invented by arbitration).
- **Opening line both showing 16.5:** Operational bug (ephemeral snapshots) — **fixed** by preserving opening in `marketSnapshotService` + seeding from tracked/official opening when present.
- **Same-team changing the line:** Was a risk; **fixed** with `lineIntegrityV1.applySideChangeKeepLine` so forced Under keeps the original candidate line (e.g. Over 17.5 → Under 17.5, never 16.5).

---

## 3. Complete Line Audit (Miles Jul 18 capture)

From `.audit-line-lifecycle-0718/miles-audit-extract.json` (post prior refresh):

| Field | Miles | McBride |
|---|---|---|
| Final side | Under | Over |
| Line / sportsbook / consensus | 16.5 | 17.5 |
| Opening / current (live disk) | 16.5 / 16.5 | 17.5 / 17.5 |
| originalModelSide | OVER | — |
| finalCourtEdgeSide | UNDER | — |
| flipFirstAction | SAME_TEAM_ARBITRATION_FLIP | CHECK_UNDER |
| confidence / risk | 22 / HIGH | 81 / MEDIUM |
| gameId | `f8783a888cf81cf55788aa06d2273f16` | same |

Provider event / market identity: WNBA Points consensus for Minnesota Lynx game (`gameId` above). Sportsbook lines collapsed into consensus 16.5 at capture time.

---

## 4. Files Changed

| File | Change |
|---|---|
| `services/lineIntegrityV1.js` | **NEW** — selected/sealed/opening/current audit; side-change line lock |
| `engines/.../sameTeamForcedSidePresentationV1.js` | Keep original line on forced Under; import path fix |
| `services/marketSnapshotService.js` | Preserve opening; seedOpeningLine; gameId key; lineMovement |
| `services/canonicalSealedProp.js` | opening/selected/sealed/current + model confidence/projection |
| `services/courtEdgePlayerEvidenceV1.js` | `scoringEnvironmentProxy` + truthful pace label |
| `services/wnbaOpponentContextService.js` | Same naming; reason text |
| `server.js` | Build `courteedge-line-lifecycle-calibration-v1`; board schema; opening seed; admin recover; health/picks schema |
| `scripts/testLineIntegrityV1.js` | **NEW** tests |
| `scripts/testBestSixPresentationV1.js` | Line-lock + arbitration tests |
| `scripts/replayProjectionCalibrationRecommendations.js` | scoringEnvironmentProxy naming |
| `utils/controlledBestSixDisplay.js` | Drop Natural Track / No Bet summary buckets |
| `components/PropCard.tsx` | No BOARD_ONLY/NO_BET badge styles |
| `app/(tabs)/prop-lab.tsx` | Relabel gate jargon for Lab UI |

---

## 5. Same-Team Object Before / After

**Before (risk):** Forced Under could inherit a rebuilt alternate line; Flip-First Over copy could leak; opening lost on redeploy.

**After:**

```text
originalModelSide: OVER
finalCourtEdgeSide: UNDER
flipFirstAction: SAME_TEAM_ARBITRATION_FLIP
line / selectedLine: locked to original candidate line
lineLockedThroughSideChange: true
organicUnderEvidence: weak|partial|strong
confidence/risk: recalibrated for policy conflict
userFacingDecision: TRACK
```

---

## 6. User-Facing Card Before / After

**Before:** Could show Strong Over profile / FLIPPED_TO_OVER while printing Under; line could disagree with original candidate.

**After (truthful):**

```text
Olivia Miles — Under {lockedLine} Points
Decision: TRACK
Risk: HIGH
Original Model Side: Over
Final CourtEdge Side: Under
Same-Team Arbitration: Kayla McBride retained as stronger Over; Olivia Miles forced Under
Organic Under Evidence: Weak
Confidence: recalibrated for policy conflict
```

---

## 7. Label Cleanup Before / After

| Surface | Before | After |
|---|---|---|
| Home Best 6 summary | Could imply Natural Track / No Bet buckets | Controlled Best 6, Results Tracked, Top, Board Candidates, High Risk only |
| PropCard decision styles | BOARD_ONLY / NO_BET colors | TRACK / NOT SELECTED / neutral |
| Lab metrics | Watchlist / BOARD_ONLY / NO_BET labels | Nonselected / internal wording |
| Selected Best 6 | Always TRACK | Unchanged / enforced |

---

## 8. Defense / Scoring-Environment Correction

- `paceProxy` is **avg combined game total**, not official possessions.
- Public/internal label: `scoringEnvironmentProxy` / `SCORING_ENVIRONMENT_PROXY`.
- Alias `paceProxy` retained for back-compat; **must not** be weighted as true pace.
- CALCULATED defense no longer treated as missing; UNAVAILABLE stays unavailable (no fake 50).

---

## 9. July 17 Recovery Dry-Run

```text
node scripts/recoverStaleSealedSlates.js --date=2026-07-17 --dry-run
```

**Result:** `membershipPreserved: true`, pendingCount **6**, exact official IDs:

1. Nneka Ogwumike — Over 16.5  
2. Dominique Malonga — Under 16.5  
3. Isabelle Harrison — Over 11.5  
4. Rhyne Howard — Under 19.5  
5. Kelsey Mitchell — Over 22.5  
6. Naz Hillmon — Under 9.5  

Artifact: `.tmp-recover-stale-2026-07-17-dry-run.json`  
All six `gameLikelyFinished: true`. No membership rewrite.

---

## 10. July 17 Apply Result

Local apply (after grading-side fix), membership preserved:

| Player | Side | Line | Status | Actual |
|---|---|---|---|---|
| Nneka Ogwumike | Over | 16.5 | WIN | 18 |
| Dominique Malonga | Under | 16.5 | LOSS | 28 |
| Isabelle Harrison | Over | 11.5 | LOSS | 10 |
| Rhyne Howard | Under | 19.5 | WIN | 10 |
| Kelsey Mitchell | Over | 22.5 | WIN | 30 |
| Naz Hillmon | Under | 9.5 | LOSS | 24 |

**Root grading bug fixed:** `gradeEngineSide` used empty `currentEngineSide` → “Missing side or line for grading”. Fallback now uses `lockedSide` / `side` / `pick`.

**Report completion bug fixed:** `hasUnresolvedGradingProps` treated graded W/L/P as unresolved when stale `resolveDebug.blockedByGameNotFinal` / `gameFinal===false` remained. Resolved statuses now complete Lab/DSR.

Daily report status: **final** (2026-07-17).

Production apply: deploy this commit then `POST /admin/recover-stale-sealed` with `{date:"2026-07-17", apply:true}` (or local-equivalent on Render disk).

---

## 11. July 17 Grades + Lifecycle Location

- All six graded with `lastResolveAttempt` and actual points
- Daily slate report `2026-07-17` status **final**
- Sealed IDs/sides/lines unchanged
- Jul 18 Home board remains live after refresh

---

## 12. Results → Lab → History Field Preservation

`canonicalSealedProp` now carries: opening/selected/sealed/current lines, originalModelSide, finalCourtEdgeSide, sameTeamArbitration, originalModelConfidence, originalProjection, risk, Top/Best6 ranks, evidence hooks.  
Locked merges preserve `officialLine` (immutable sealed line). Current market may update `currentLine` only.

---

## 13. Calibration Replay Results

`node scripts/replayProjectionCalibrationRecommendations.js`

- Sample still **EARLY / too small** for enablement (overall labels not USABLE).
- Candidate weights drafted behind flag; **`COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED` remains OFF**.
- Remaining requirement: larger graded WNBA sample with evidence coverage labels reaching USABLE; no severe Over/Under bias; MAE not regressing.

---

## 14. Final Projection / Confidence Formulas (candidate, flagged OFF)

- Redistribute weights only among verified evidence groups (missing → 0).
- Components include season/last5/last10/role/volume/defense/matchup/`scoringEnvironmentProxy`/team total/spread/vendor.
- Same-team forced Under: TRACK always; confidence/risk penalty via conflict score + organic Under grade.
- Separate projection confidence vs pick confidence; caps from coverage + contradiction count.

---

## 15. Calibration V2 Enabled?

**No.** Sample insufficient; enablement standard not met. Path implemented/replayed behind flag only.

---

## 16–17. Fresh Today / Tomorrow Reports

Post-deploy refresh (`courteedge-line-lifecycle-calibration-v1`):

- **Olivia Miles:** Under **17.5**, Original Model Side Over, Final CourtEdge Side Under, TRACK, HIGH risk
- Today Best 6 cohort includes Stewart / McBride / Miles (Today) + tomorrow board candidates in display pool
- `bestSixDisplayWNBA` length 6, all TRACK
- Opening/current lines present; Miles `selectedLine` 17.5

---

## 18. Tests Passed / Failed

| Suite | Result |
|---|---|
| `testLineIntegrityV1.js` | PASS (5) |
| `testBestSixPresentationV1.js` | PASS (12) |
| `testSealedGradeSideFallback.js` | PASS (2) |
| `testStaleSealedRecovery.js` | PASS |
| `testLifecycleIntegrity.js` | PASS (6/6) |
| Projection calib replay | Ran; flag stays OFF |

---

## 19. New SERVER_BUILD

`courteedge-line-lifecycle-calibration-v1`

---

## 20–22. Commit / Push / Deploy

- Commit 1: `0ae7125` — line integrity + presentation + admin recover
- Follow-up commit: grading side fallback + unresolved-lifecycle fix (this push)
- Remote: `orgin/betbrain-v2-rebuild` pushed
- Render auto-deploy verified on first build; re-verify after follow-up

---

## 23. Live `/health` Verification

Confirmed live: `serverBuild=courteedge-line-lifecycle-calibration-v1`, `boardSchemaVersion=courtedge-board-schema-v2`
---

## 24. Rollback Command

```bash
# Render: redeploy previous commit d856bd2 (courteedge-best6-presentation-v1)
# Or set SERVER_BUILD back and disable new paths:
# COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED=false  (already false)
```

---

## 25. Locked Rules Intact

- Full Controlled Best 6 when ≥6 candidates: **unchanged**
- Track all six / Results Tracked 6/6: **unchanged**
- Deterministic same-team (stronger Over, weaker Under, both tracked): **unchanged**
- Weak evidence does not remove TRACK: **unchanged**

---

## 26. Historical Sealed Records

- July 17 membership/sides/lines **not rewritten**
- Recovery grades only; idempotent membership preserve
- No `/clear-tracked-props`, no runtime JSON deletes

---

## Required Line Rules Compliance

1. Arbitration may change side, never line — **enforced**  
2. Over 17.5 → Under stays 17.5 unless newer market rebuild pre-seal — **enforced**  
3. Sealed line immutable — **officialLine lock on merge**  
4. Refresh may update currentLine only — **yes**  
5. Home distinguishes current vs sealed when fields present — **yes**  
6. Results/Lab/History grade sealed line — **yes**  
7–10. Audit fields + no cross-player line copy — **yes**
