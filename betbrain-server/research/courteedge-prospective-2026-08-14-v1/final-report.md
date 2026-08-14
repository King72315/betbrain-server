========================================================
MARIAH → KING — COURTEDGE 8/14 PROSPECTIVE DATA INTEGRITY FINAL
========================================================

BUILD:
courteedge-grade-a-recovery-v3 / homeProductTruthSections=courteedge-home-product-truth-sections-v3

GIT:
branch: feature/courteedge-decision-engine-v2
HEAD: 1d7a6deeca02559454c68c1c74fd0cf0f1a9f8d0
note: prospective freeze hashes under research/courteedge-prospective-2026-08-14-v1/

PROSPECTIVE COHORT ID:
COURTEDGE_V3_PROSPECTIVE_COHORT_2026_08_14_01

PREGAME FREEZE:
Trusted = 15
Best = 10
Full = 50
PTS = 19
REB = 17
AST = 14
Architecture: FULL_STACK_OK / global_quality_v3 / market_weave_OFF
Exported: 2026-08-14T09:20:54.063Z (integrity re-run after Product Truth display fix)

HOME DISPLAY:
Trusted shown = 15
Best shown = 10
Full shown = 50
Missing = []
Duplicates / Extra = []
Mutations = []
homeDisplayAudit.pass = true
homeRankAuthority = global_quality_v3
marketBalancedWeave = false
app-display-durability.pass = true

GRADE PREFLIGHT:
Trusted targets = 15/15 found (missing [])
Best targets = 10/10 found (missing [])
Full targets = 50/50 found (missing [])
preflightPass = true
dryRun = true (no grades written)

EPERM:
PASS

POSTGAME GRADING:
Trusted =
W-L-P = PENDING — games not FINAL
Hit rate = PENDING — games not FINAL

Best =
W-L-P = PENDING — games not FINAL
Hit rate = PENDING — games not FINAL

Full =
W-L-P = PENDING — games not FINAL
Hit rate = PENDING — games not FINAL

POINTS =
W-L-P = PENDING — games not FINAL

REBOUNDS =
W-L-P = PENDING — games not FINAL

ASSISTS =
W-L-P = PENDING — games not FINAL

HIGH RISK TRUSTED =
N = 14
W-L-P = PENDING — games not FINAL

MEDIUM RISK TRUSTED =
N = 1
W-L-P = PENDING — games not FINAL

LOW RISK TRUSTED =
N = 0
W-L-P = PENDING — games not FINAL

SAFETY SPLITS:
Trusted safetyScore buckets (counts only; outcomes PENDING):
70plus = 7
50_69 = 7
under50 = 1

PROBABILITY SPLITS:
Trusted predictedProbability buckets (counts only; outcomes PENDING):
ge60 = 8
55_60 = 1
lt55 = 6

MISS MARGINS:
status = AWAIT_FINALS
note = require FINAL actuals; not computed; see miss-margins.json

IDENTITY INTEGRITY:
Trusted immutable = 15/15 pregame freeze hashed (postgame mutation compare AWAIT_FINALS)
Full immutable = 50/50 pregame freeze hashed (postgame mutation compare AWAIT_FINALS)
PREDICTION VALUES ALTERED after freeze = 0 observed on Home re-audit (mutated [])

HOME → RESULTS:
PASS (results-audit allTrustedPresent=true; officialCount=15; pending 15/15)

RESULTS → LAB:
PASS (lab endpoint 200 for slate 2026-08-14; ok=true)

LAB → HISTORY:
PASS (history-archives endpoint 200; ok=true; count=19)

LOCAL PRODUCT TRUTH:
PASS (homeDisplayAudit.pass=true; durability countsMatch; Product Truth display fix loaded on restarted local API :3000)

RENDER:
status only — not verified this run; do not let Render OOM destroy local evidence
local backup: research/courteedge-prospective-2026-08-14-v1/pre-grade-backup/

8/13 VS 8/14:
NOT identical architecture.
8/13 = PRE-V3 incomplete (Full 45 @ 15/15/15; Official/Trusted complete packet = 0; original Full 26-19; Home weave 5-5; V3 shadow Trusted=0 / Best 5-5 / Full 26-19).
8/14 = V3 FULL_STACK prospective (Trusted 15 / Best 10 / Full 50; PTS 19 / REB 17 / AST 14; weave OFF; global_quality_v3).
Do not treat cross-day W-L as same-system proof. See aug13-vs-aug14-comparison.json.

DATASET EXPORT:
research/courteedge-prospective-2026-08-14-v1/
includes membership-comparison, stat/risk/safety/probability ledgers, miss-margins, grading-integrity, postgame stubs, final-report.md

DATA LOST:
0

PREDICTION VALUES ALTERED:
0

MODEL RETUNES:
NONE

GRADING_OUTCOMES_PENDING:
YES — all games not FINAL; dry-run grading only; postgame files are AWAIT_FINALS stubs pointing at pregame freezes

FINAL VERDICT:
COURTEDGE_2026_08_14_PROSPECTIVE_DATA_INTEGRITY_PASS
(with GRADING_OUTCOMES_PENDING)

========================================================
