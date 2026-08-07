# CourtEdge Probability, Safety & True Low-Risk Architecture V1 Report

**Build:** `courteedge-probability-safety-true-low-risk-architecture-v1`  
**Branch:** `upgrade/courteedge-probability-safety-low-risk-v1`  
**FULL_ROSTER_COLLECTION_MODE:** `false` (unchanged)

---

## A. Checkpoint

| # | Item | Value |
|---|------|-------|
| 1 | Verified pre-upgrade checkpoint | `courteedge-pre-full-roster-experiment-v3` @ `2db183ccb63fe6d07a51f35f2d99686a7b7bc35d` |
| 2 | Upgrade branch | `upgrade/courteedge-probability-safety-low-risk-v1` |
| 3 | Starting commit | `2db183ccb63fe6d07a51f35f2d99686a7b7bc35d` |
| 4 | Ending commit | 481509654731ef41d3fef1440eda9455a6e3f2e7 |

V1 (`bf581a1…`) and V2 (`339f132…`) tags **untouched**.

---

## B. Architecture

### Files created
- `engines/probabilitySafetyV1/versions.js`
- `engines/probabilitySafetyV1/playerMinutesModelV1.js`
- `engines/probabilitySafetyV1/playerRoleStabilityEngineV1.js`
- `engines/probabilitySafetyV1/playerScoringOpportunityModelV1.js`
- `engines/probabilitySafetyV1/playerPointsDistributionEngineV1.js`
- `engines/probabilitySafetyV1/playerPropMarketModelV1.js`
- `engines/probabilitySafetyV1/predictionConflictIndexV1.js`
- `engines/probabilitySafetyV1/propFailurePathEngineV1.js`
- `engines/probabilitySafetyV1/propSafetyEngineV1.js`
- `engines/probabilitySafetyV1/canonicalPlayerForecastPacketV1.js`
- `engines/probabilitySafetyV1/index.js`
- `engines/topProps/probabilitySafetyBoardAdapterV1.js`
- `scripts/testProbabilitySafetyTrueLowRiskArchitectureV1.js`
- `scripts/replayProbabilitySafetyAug4Aug5V1.js`

### Files changed
- `engines/topProps/controlledBestBoardV2.js` — Official path routes through probability/safety (default ON)
- `engines/topProps/courtEdgeFeatureFlagsV1.js` — architecture flags; `TEAM_PAIR_MODE=false`
- `server.js` — `SERVER_BUILD` updated

### Layering (5–18)
```text
PROVIDER DATA → CANONICAL PLAYER PACKET → FORECAST → DISTRIBUTION
→ SIDE EVAL → SAFETY/RISK → MEMBERSHIP → HOME/RESULTS/HISTORY
```

| Engine | Role |
|--------|------|
| Minutes | expectedMinutes, stability 0–100 |
| Role | roleStabilityScore, ROLE_ENVIRONMENT_CHANGED |
| Volume | FGA/FTA/3PA, multi-way vs limited |
| Distribution | Monte Carlo (default 5k; tests 2.5k), P(Over)/P(Under) |
| Market | bookCount, quality 0–100 |
| Conflict | evidence families capped; conflictIndex 0–100 |
| Failure paths | major/moderate paths |
| Blowout sensitivity | player-specific minutes impact |
| Safety | capped family weights + penalties |
| Membership | LOW first, then MEDIUM; HIGH research-only; no `.slice(0,6)` |
| Research universe | dual-side packets; shadow side preserved |

---

## C. LOW / MEDIUM / HIGH

### 19. LOW (all required)
```text
rawWinProbability >= 0.64
SafetyScore >= 78
projectionEdge >= 2.5
projectionFairAgreement = true
minutesStabilityScore >= 75
roleStabilityScore >= 75
marketQualityScore >= 65
availabilityCertaintyScore >= 85
conflictIndex <= 20
supportingEvidenceFamilies >= 4
opposingEvidenceFamilies <= 1
majorFailurePathCount <= 1
bookCount >= 3 (generally)
no LOW hard-blocks
```

### 20. MEDIUM
```text
rawWinProbability >= 0.57
SafetyScore >= 65
projectionEdge >= 2.0
minutes/role stability >= 55
availabilityCertainty >= 70
marketQuality >= 50
conflictIndex <= 35
supportingFamilies >= 3
majorFailurePaths <= 2
fair-line not strongly opposing (>1.0 against)
fragility stack < 2
```

### 21–24
- HIGH = fails MEDIUM → `officialEligible=false`, research eligible  
- HIGH cannot enter Official  
- LOW never force-created  
- MEDIUM cannot bypass its gate  

---

## D. Board policy

| # | Confirmation |
|---|--------------|
| 25 | No fixed six |
| 26 | No minimum count (0 legal) |
| 27 | No side quota |
| 28 | No forced teammate Over/Under |
| 29 | Home = LOW first, then MEDIUM |

---

## E. Credits (Aug 7 today refresh)

| # | Metric | Value |
|---|--------|-------|
| 30–31 | Provider calls | 13 Odds |
| 32 | Reported credit cost | **12** (`x-requests-last` sum; events last=0) |
| 33 | Cache hits (cold) | 0 |
| 34 | Remaining | 16550 used 3450 |

Full-roster research mode **not** enabled — evaluation used existing market payloads; dual-side eval is local Monte Carlo.

---

## F. Historical validation

**Sample:** Diagnostic synthetic/replay packets for Aug 4 fillers + Aug 5 reconstructed four — **small sample; do not overclaim**.

| Bucket | Count | Official eligible |
|--------|-------|-------------------|
| Aug 4 fillers | 4 | **0** (all HIGH) |
| Aug 5 reconstructed | 4 | **0** (all HIGH in replay) |

Probability bins / MAE / multi-slate W-L: **insufficient clean sealed out-of-sample history under this model version** — infrastructure present (`probabilityCalibrationStatus: INSUFFICIENT_SAMPLE`).

---

## G. August 4 regression

All four old fillers → **HIGH / not Official**:

| Player | Side | Line | Risk | Safety | P(win) | Edge |
|--------|------|------|------|--------|--------|------|
| Marina Mabrey | OVER | 18.5 | HIGH | 30 | 0.55 | 0.7 |
| Gabby Williams | OVER | 14.5 | HIGH | 26 | 0.57 | 0.6 |
| Julie Allemand | UNDER | 6.5 | HIGH | 48 | 0.73 | 0.7 |
| Veronica Burton | UNDER | 12.5 | HIGH | 57 | 0.64 | 0.7 |

Forced-fill behavior did **not** return.

---

## H. August 5 diagnostic replay (history not rewritten)

| # | Player | Classification | Why |
|---|--------|----------------|-----|
| 45 | Howard Under 17.5 | **LOW** (diagnostic) | P≈0.95, Safety 89, edge 4.6, conflict 0 — would qualify under new gates |
| 46 | Plum Over 16.5 | **HIGH** | Large edge (5.1) + high P, but **roleStability 52** → fails LOW and MEDIUM — strong edge ≠ low risk |
| 47 | Nneka Under 18.5 | **MEDIUM** | Passes MEDIUM; fails LOW on edge/role |
| 48 | Flau'jae Over 15.5 | **HIGH** | Edge 1.6 below MEDIUM floor; market/books weak |

`august5OfficialHistoryRewritten: false`  
Aug 5 sealed Official record remains invalidated for calibration; this replay is diagnostic only.

---

## I. August 7 final refresh (America/Chicago)

| # | Metric | Value |
|---|--------|-------|
| 49 | Verified slate date | `2026-08-07` CT (`requestedSlateDate`) |
| 50–51 | Valid / research markets | **18** |
| 52 | Dual-side packets | **36** (18×2) |
| 53 | LOW | **0** |
| 54 | MEDIUM | **0** |
| 55 | HIGH | **18** |
| 56 | Official count | **0** |
| 57–58 | Official Over/Under | 0 / 0 |

```text
No LOW Risk props qualified today.
```

This is **success** under the product principle: empty Official board is legal.

Prior Aug 6 sealed board (Boston / Mabrey / Conde) retained and **not** rewritten.

---

## J. August 7 Official props

*(none)*

---

## K. Before / after

| | Before (legacy team-pair / softer risk) | After (probability-safety V1) |
|--|------------------------------------------|-------------------------------|
| Aug 7 Official | N/A (no prior Aug 7 seal) | **0 props** |
| Research | Not separated | 18 HIGH research-only |
| Policy | Variable board but team-pair quotas historically | Unbounded quality-first; HIGH blocked |

Important change: **large projection edges no longer become Official without safety gates**.

---

## L. Strongest rejected (research HIGH)

All 18 Aug 7 markets failed MEDIUM/LOW gates (typical: safety, conflict, edge, books, minutes/role).  
Exact per-player dump: refresh `probabilitySafety.research` / `_ps_aug7_refresh.json`.

---

## M. Tests

| # | Result |
|---|--------|
| 91 | **38 passed** |
| 92 | **0 failed** |
| 93 | Limitations: calibrated probability deferred (`INSUFFICIENT_SAMPLE`); historical W-L under new model not yet large; some candidate packets lack full book/minutes provenance from providers |
| 94 | Aug 7 refresh ~107s; Monte Carlo local; Odds 13 calls / 12 credits |

---

## Acceptance checklist

```text
✓ No fixed six
✓ LOW strict
✓ MEDIUM tighter
✓ HIGH blocked from Official
✓ LOW ranked first (when present)
✓ Empty board legal
✓ Large board legal
✓ No forced Over/Under / team quota
✓ Probability ≠ Safety ≠ Risk
✓ Minutes, role, distribution, families, conflict, failure paths, market, availability, blowout
✓ Research universe preserves rejected
✓ Research ≠ Official record
✓ Credits not burned per-player for Over/Under
✓ Aug 5 not clean calibration
✓ Aug 7 CT refresh completed
✓ Before/after reported
```

---

## Philosophy outcome (Aug 7)

CourtEdge found **zero** props that simultaneously cleared probability, minutes/role stability, market integrity, conflict, and failure-path gates.

**Official board = 0.**

That is the intended product behavior.
