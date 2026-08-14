========================================================
MARIAH → KING — COURTEDGE COMPLETE GRADE-A RECOVERY FINAL
========================================================

DATE: 2026-08-14 CT
ARTIFACT ROOT: betbrain-server/research/courteedge-grade-a-recovery-v3/

GIT:
starting HEAD: 763219de28236d436ddb02070ff4b36d377a4b52
checkpoint tag: courteedge-pre-grade-a-complete-recovery-v3
rollback branch: courteedge-rollback-grade-a-recovery-v3
ending HEAD: 763219de… (working tree dirty with V3 repairs — not committed unless King requests)
branch: feature/courteedge-decision-engine-v2
commits this mission: NONE (King did not request commit)
rollback: git checkout courteedge-pre-grade-a-complete-recovery-v3 / branch courteedge-rollback-grade-a-recovery-v3

PROVEN ROOT CAUSES:
- Per-game per-market modeling truncation (5×3 → 15/15/15; live 4×/max12)
- Market-balanced Home weave + MAX_HOME_PROPS=10 forced volume/diversity
- Odds-only regenerate wrote production Home/Product Truth without projection/Safety/Risk
- Home displayed research weave as Official-looking membership when Official=0
- Ranking on odds-implied scores failed to lift vs Full on 8/13 (global Top10 also 5-5)
- Legacy /picks empty board cache caused Render “No saved board yet” even when canonical Product Truth existed

PROVEN NON-CAUSES:
- Sportsbook consensus line cherry-picking (prior audit PASS)
- Real available line shopping (0/19 salvageable)
- Player-line extremity (all NORMAL_RANGE on 8/13 method)
- Weave as sole W-L cause vs Full (global Top10 also 5-5)

PROP FLOW BEFORE:
PROVIDER → (capped per-stat) → odds-implied score often → weave Home fill-10 → Official chrome on research

PROP FLOW AFTER:
PROVIDER → ALL valid consensus markets → Full Predictions → full stack required for Trusted → global quality Best Available → Home sections TRUSTED | BEST AVAILABLE | FULL (no weave membership)

VALID MARKET COUNTS:
- Production no longer truncates to 15/15/15 or max12
- 8/13 frozen cohort still 45 (immutable historical freeze; truncation already baked in)

REMOVED CAPS/QUOTAS:
- selectMultiStatAnalyzedPropsPerGame default quotas
- regenerate selectPerGame top-5 (script blocked from production)
- market_balanced_v2_home_weave production authority
- MAX_HOME_PROPS Trusted fill
- OFFICIAL_BOARD_MAX_V2 hard ceiling (quality cliff only)

POINTS: flow uncapped; compete globally; complete-packet gate for Trusted
REBOUNDS: same
ASSISTS: same (six Assists may top Best Available if deserved — tested)

PROJECTION: required for Trusted; Full may include incomplete only as non-trusted
FAIR LINE: required for Trusted (production)
PROBABILITY: single authority decisionScoreV2/modelWinProbability; historical walk-forward holdout V2 hit ~0.6429 vs current Official ~0.25 (historical compat mode)
SAFETY: required for production Trusted; environment field; historical walk-forward may allow missing for old corpus
RISKV2: required for production Trusted
SIGNAL: unchanged single authority (not retuned on 8/13)
CROSS-STAT RANKING: global quality; no weave/stat bonus; 8/13 odds-implied ranking still weak → PROSPECTIVE pending on full-stack freezes

GRADE-A/TRUSTED:
- Definition: Official membership via selectOfficialMembershipV2 + hasCompleteTrustedPacketV3
- Requires: propType, side, line, projection, fairLine, P, Safety, Risk (production)
- Zero Trusted allowed and correct
- 8/13 shadow Trusted=0 (all 45 incomplete odds-only packets)

BEST AVAILABLE: honest non-trusted global top (display max presentation-only)
FULL PREDICTIONS: all valid modeled candidates; learning warehouse preserved

HOME: Product Truth sections; Official chrome no longer weave-filled; empty Trusted message honest
RESULTS: batch grading + atomicWriteJson EPERM hardening verified by regression test; 8/13 remains 45/45
LAB: identity unchanged (canonical records)
HISTORY: immutable; 8/13 original preserved; shadow separate

EPERM: PASS (testCanonicalEpermAtomicWriteV1.js + batchAppendCanonicalResults)
LOCAL VS RENDER: CODE_FIXED_DEPLOY_PENDING (/picks returns productTruthHome when board cache empty; Render deploy of this tree not verified in-session)

AUTHORITY MAP: research/.../17-authority/authority-map.json
DAG: research/.../18-dag/dag-note.json — odds-only blocked from Trusted

8/13 ORIGINAL (preserved):
Full 26-19 | Home weave 5-5 | Official 0

8/13 V3 SHADOW:
Trusted 0 | Best Available 5-5 | Full 26-19 | Global Top10 5-5 | completeTrustedPacketN 0
Label: SHADOW_NOT_HISTORICAL_PRODUCT_TRUTH

HISTORICAL BEFORE: Official holdout ~0.25 (walk-forward comparison baseline)
HISTORICAL AFTER: Decision Engine V2 Official selection holdout ~0.6429 (n=42 picks, allowMissingEnvironmentFields for old corpus)
PRECISION@K: 8/13 odds-implied Top10 still 5-5 — not claimed fixed by membership repair alone

TESTS:
PASS testCourtEdgeGradeARecoveryV3.js
PASS testCourtEdgeDecisionEngineV2.js
PASS testCanonicalEpermAtomicWriteV1.js

FILES CHANGED (mission scope):
- betbrain-server/services/courtEdgeHomeProductTruthSectionsV3.js (NEW)
- betbrain-server/services/courtEdgeProductTruthUiCutoverV1.js
- betbrain-server/services/courtEdgeDecisionEngineV2.js
- betbrain-server/server.js (uncap + /picks Product Truth)
- betbrain-server/scripts/regenerateMultiStatHomeSlate.js (production block)
- betbrain-server/scripts/testCourtEdgeGradeARecoveryV3.js (NEW)
- betbrain-server/scripts/testCanonicalEpermAtomicWriteV1.js (NEW)
- betbrain-server/scripts/testCourtEdgeDecisionEngineV2.js
- betbrain-server/scripts/research/runAug13V3ShadowV1.js (NEW)
- components/HomeControlledBestSixScreen.tsx (labels + zero-Trusted honesty)
- research/courteedge-grade-a-recovery-v3/** artifacts

UNRELATED SYSTEMS CHANGED: NONE intentional (NBA/Tennis not touched)

PROSPECTIVE_VALIDATION_PENDING: YES

WHAT STILL REQUIRES FUTURE RESULTS:
- Full-stack (projection+Safety+Risk) slate freezes prospectively proving Trusted > Best Available > Full
- Render deploy verification of persistence contract on production host
- Ranking lift on clean full-stack boards (not odds-implied 8/13)

KNOWN LIMITATIONS:
- 8/13 frozen board remains odds-incomplete; cannot invent projections retroactively
- Production Trusted may stay 0 until live refresh stamps complete packets
- Working tree not committed (await King)
- Weave module file retained for diagnostics only

FINAL VERDICT:
COURTEDGE_GRADE_A_RECOVERY_V3_TECHNICAL_PASS_PROSPECTIVE_PENDING

========================================================
