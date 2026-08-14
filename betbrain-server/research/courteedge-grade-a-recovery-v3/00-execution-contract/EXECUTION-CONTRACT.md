========================================================
MARIAH → KING — COURTEDGE COMPLETE RECOVERY EXECUTION CONTRACT
========================================================

DATE: 2026-08-14 CT
MISSION: CourtEdge Complete Grade-A Recovery + Prop-Flow Rebuild V3
OWNER: King
IMPLEMENTATION: Mariah
AI CEO DIRECTION: Embedded in mission prompt (continuous execution; no round-stop)

STARTING GIT (pre-change):
BRANCH: feature/courteedge-decision-engine-v2
HEAD: 763219de28236d436ddb02070ff4b36d377a4b52
WORKING TREE: DIRTY (prior session + product files; recovery work will be isolated via checkpoint tag + scoped commits)

ROLLBACK MARKER (to create before production edits):
Tag/branch: courteedge-pre-grade-a-complete-recovery-v3

ARTIFACT ROOT:
betbrain-server/research/courteedge-grade-a-recovery-v3/

========================================================
1. EVERY PROVEN ISSUE BEING REPAIRED
========================================================

P1. Hidden per-stat / per-game modeling truncation
    - regenerateMultiStatHomeSlate.js selectPerGame() top-5 → artificial 15/15/15
    - server.js selectMultiStatAnalyzedPropsPerGame(perMarket:4, maxTotal:12)
    - Repair: all VALID consensus markets flow into Full Predictions; rejection reasons stamped

P2. Market-balanced Home weave as production membership authority
    - courtEdgeHomeMarketWeaveV1 + homeRankAuthority market_balanced_v2_home_weave
    - Repair: demote weave from production membership; global quality ranking only

P3. Forced Home fill MAX_HOME_PROPS = 10
    - Repair: Trusted membership never volume-filled; 0 Trusted allowed

P4. Odds-only regenerate writing production Product Truth
    - projection/Safety/Risk null on 8/13 path
    - Repair: odds-only path DIAGNOSTIC ONLY; cannot write Trusted/Home Product Truth

P5. Incomplete canonical packet reaching “Home as if trusted”
    - Repair: production Trusted requires full stack packet; incomplete rows non-trusted diagnostic only

P6. Home product-truth contradiction (Official=0 but Home shows 10 research as trusted-looking)
    - Repair: explicit TRUSTED / BEST AVAILABLE / FULL sections; Best Available ≠ Trusted

P7. Ranking failed to add lift on 8/13 (global Top10 also 5-5)
    - Repair: validate/rebuild officialRankScore for expected trustworthiness (not odds-implied P alone)
    - Recalibrate only on clean full-stack historical data — not one-slate overfit to 8/13

P8. Windows EPERM grading persistence (partially fixed)
    - Repair: harden + automated concurrent-reader regression; keep batch slate write

P9. Local vs Render “No saved board yet” persistence mismatch
    - Repair: persistence contract only (canonical Product Truth as Home authority / align read-write)

========================================================
2. EVERY AREA BEING AUDITED (EVEN IF NO CODE CHANGE)
========================================================

- Prop-flow before/after (provider → History)
- Authority map (one writer per canonical field)
- DAG / feedback-loop circles
- Cross-stat rank fairness (PTS/REB/AST)
- Probability calibration (chronological; no confidenceV3)
- Safety environment independence
- RiskV2 failure-exposure independence
- Signal STRONG/MODERATE/WEAK
- Grade-A qualification empirics (may remain empty)
- 8/13 immutable original + V3 SHADOW counterfactual
- Winner control group vs loss forensics
- Market-line integrity (already PASS — preserve, no rewrite)
- Results / Lab / History identity continuity
- Home filters presentation-only
- Prospective ledger instrumentation

========================================================
3. EVERY PRODUCTION CHANGE CURRENTLY EXPECTED
========================================================

EXPECTED (if code confirms forensics — already largely confirmed):

1. Remove production authority of per-stat/per-game truncation that forces 15/15/15 (and live 4×/max12 quota behavior for Full Predictions).
2. Remove market_balanced_v2_home_weave as production Home membership authority (keep module only as diagnostic/research if useful).
3. Remove forced Trusted/Home fill-to-10.
4. Gate odds-only regenerate so it cannot write production Product Truth / Trusted.
5. Require full canonical model packet for Trusted (projection, fairLine, P, Safety, RiskV2 present).
6. Rebuild Home Product Truth sections: TRUSTED | BEST AVAILABLE | FULL PREDICTIONS.
7. Validate/adjust global cross-stat ranking inputs so score = expected trustworthiness (evidence-backed; no 8/13 overfit).
8. Complete EPERM atomic grading hardening + regression test.
9. Resolve Local/Render board persistence contract (Product Truth / board cache alignment).
10. Minimal Home product-truth labeling/navigation fixes only where tied to this flow.

CONDITIONAL (only with historical/chronological evidence):
- predictedProbability internal calibration adjustments under existing authority
- Safety / RiskV2 feature weighting fixes if circular or belief-dominated
- Grade-A threshold empirics for Official/Trusted membership

========================================================
4. EVERYTHING THAT WILL NOT BE TOUCHED
========================================================

- NBA systems / NBA rebuild
- TennisEdge / Tennis in CourtEdge
- Stat / team / side quotas or forced Grade-A volume
- confidenceV3 / SafetyV3 / RiskV3 / rescue engine / second side brain
- Legacy Best6 restored as authority
- Player-specific hacks
- Rewriting completed W-L or original 8/13 freezes
- Unnecessary provider credit spend / consensus line rewrite (PASS preserved)
- Unrelated UI redesign
- Unrelated providers / business logic

========================================================
5. CHECKPOINTS / ROLLBACK STRATEGY
========================================================

BEFORE production edits:
- Tag: courteedge-pre-grade-a-complete-recovery-v3 @ current HEAD
- Branch rollback pointer: same tag
- Artifact snapshot under 01-checkpoint/
- Preserve immutable 8/13 freezes under research + data/home-freeze

AFTER each meaningful production slice:
- before/after artifacts in numbered research folders
- scoped commits on feature/courteedge-decision-engine-v2 (or recovery sub-branch if tree too dirty)
- rollback = git checkout tag / revert commits

NEVER: rewrite historical grades; force-push main; skip hooks without King

========================================================
6. TEST PLAN
========================================================

Minimum gates (mission Phase 32):
1–3. PTS/REB/AST end-to-end
4–6. All valid markets → Full; no 15-cap; no per-stat production quota
7–8. No market-balanced membership weave; no forced Trusted count
9–11. Trusted may be 0; six Assists or six Points may top if deserved
12–16. projection/fair/P/Safety/Risk requirements on Trusted
17–21. one side, one rank, correct grading, no identity collisions
22–26. Home no rerank; filters presentation-only; Results freeze; Lab identity; History immutable
27–29. EPERM regression; atomic grading; Local/Render contract
30–31. market side-neutral; no future leakage
32–34. PTS/REB/AST historical regression
35–37. Grade-A zero-case; weak slate 0 Trusted; Full still grades everything

Scripts to run/extend:
- testCourtEdgeHomeMarketWeaveV1.js → update expectations (weave demoted)
- testCourtEdgePraMultistatV1.js
- testCourtEdgeDecisionEngineV2.js
- testSealedHomeMembershipDisplayV1.js
- new: testCourtEdgeGradeARecoveryV3.js (caps/weave/trusted-zero/packet gates)
- new: testCanonicalEpermAtomicWriteV1.js

========================================================
7. HISTORICAL VALIDATION PLAN
========================================================

- Use largest trustworthy WNBA historical corpus available (REB/AST gold ~3419; Points gold program)
- Chronological / walk-forward where possible
- Metrics: W-L, hit%, Brier, MAE, Precision@K for Full / Best Available / Trusted
- Winner vs loser control groups for every ranking/calibration change
- Do NOT optimize to perfect 8/13 W-L
- Target pattern prospectively: Full < Best Available < Trusted (never manufactured retrospectively)

========================================================
8. HOME / RESULTS / LAB / HISTORY FLOW PLAN
========================================================

HOME:
- Read canonical Product Truth only
- Sections: TRUSTED (Official/Grade-A), BEST AVAILABLE (honest non-trusted top quality), FULL PREDICTIONS
- Filters ALL/PTS/REB/AST = presentation only
- League selector NBA|WNBA remains; no Tennis tab; no alternate WNBA bottom authority

RESULTS:
- Grade exact frozen predictions; batch atomic write; identity preserved

LAB:
- Same graded identity; analysis only; no Product Truth rewrite

HISTORY:
- Immutable completed truth; shadow/counterfactual separate under research/

========================================================
9. GRADE-A TRUST PLAN
========================================================

Grade-A = product expression of existing canonical Official/Trusted membership — NOT a new brain.

Minimum requirements (empirically gated; zero OK):
clean identity, consensus line, complete projection+fair, calibrated P, stable minutes/role/availability,
acceptable residual profile, sufficient Safety, acceptable RiskV2, no major projection/fair conflict,
data completeness, cross-stat rank evidence, historical support for qualification.

If evidence cannot justify thresholds yet → Trusted stays empty by design.

========================================================
10. LOCAL / RENDER PLAN
========================================================

Audit only persistence:
deployed HEAD, env, storage path, board cache vs canonical store, date keys, read/write routes.

Known symptom: /picks returns “No saved board yet” when legacy board cache empty even if canonical has rows.

Fix direction: make Product Truth /home the Home authority (or seed board from canonical) so Local and Render share the same contract.

No model formula changes for this item.

========================================================
11. EXPECTED FINAL STATE
========================================================

TECHNICAL MACHINE:
- All valid markets → Full Predictions
- No 15/15/15 production cap
- No market-balanced membership weave
- No forced Trusted volume
- Full stack required for Trusted
- Odds-only cannot own Product Truth
- One authority per decision field
- Home shows Trusted=0 honestly when empty
- Results/Lab/History identity-aligned
- EPERM-safe grading
- Local/Render persistence aligned or explicitly documented
- Prospective ledgers ready

8/13 ORIGINAL: preserved unchanged (26-19 Full / 5-5 Home / Official 0)
8/13 V3: SHADOW only under research/

FINAL VERDICT TARGET (most likely):
COURTEDGE_GRADE_A_RECOVERY_V3_TECHNICAL_PASS_PROSPECTIVE_PENDING

(unless a currently fixable gate remains → FAIL)

========================================================
CONTINUOUS EXECUTION NOTICE
========================================================

After this contract is delivered to King, Mariah continues immediately through audit → repair → test → validation → final report without waiting for further relays, unless a genuine King blocker appears.

========================================================
