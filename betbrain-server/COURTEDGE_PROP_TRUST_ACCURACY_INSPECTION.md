# CourtEdge Prop Trust & Accuracy Inspection

**Date:** 2026-07-07 (Tomorrow slate)  
**Prod:** `https://betbrain-server-1.onrender.com`  
**Payload source:** `GET /picks`, `GET /top-props`, `GET /diagnostics`  
**lastUpdated:** `2026-07-07T01:52:00.351Z`  
**serverBuild:** `courteedge-archive-lab-0621-v1`  
**controlledBestSixVersion:** `controlled-best-six-track-all-v1`  
**activeSlate:** `2026-07-07`

---

## Executive summary

Prod Tomorrow WNBA Controlled Best 6 is **6/6** with **Results Tracked 6/6** (track-all-best-six design: TRACK, BOARD_ONLY, and NO_BET all admit with labels). **NBA Best 6 is 0/6** — no tomorrow NBA candidates passed the display pipeline.

The user-pasted six (Bueckers, Copper, Ayayi, Astier, Fiebich, Jones) **partially matches** prod: four align on decision class; **Jones and Fiebich are board props on DAL–NYL but are not in the scored Best 6**. Prod ranks **Flau'jae Johnson O12.5 TRACK (#2)** and **Dominique Malonga O17.5 BOARD_ONLY (#3)** instead (SEA–LA game). **Copper is Best #4, not Top #2** — Top Picks are Best Six ranks **#1–#2** (Bueckers + Johnson).

Cross-cutting trust gaps are severe and consistent:

| Issue | Severity | Where it shows |
|-------|----------|----------------|
| **FLIP_WARNING collision** while decision stays TRACK | High | Bueckers, Johnson, Malonga |
| **Unstable minutes** on nearly every Best 6 card | High | 5/6 Best 6; still TRACK on 3 |
| **NO_BET / BOARD_ONLY in Results “track all 6”** | Medium (by design) | Astier NO_BET admitted with label; confuses “Results Tracked” semantics |
| **Stale / side-wrong copy** | High | Astier UNDER cites “low volume over trap”; Fiebich eligibility vs copy mismatch |
| **Jones LIMITED_DATA_FLOOR copy** | Medium | Gate reason is correct (`OVER_GAP_…`); UI debt text leads with minutes, not gap floor |
| **NBA 0/6** | Info | No tomorrow NBA slate in pool |
| **dataMode audit vs card mismatch** | Medium | Diagnostics audit `WNBA_FULL_DATA` vs pick `WNBA_LIMITED_DATA` |

---

## User paste vs prod Best 6 (reconciliation)

| User paste | Prod Best 6 rank | Prod decision | Match? |
|------------|------------------|---------------|--------|
| Paige Bueckers O21.5 TRACK | #1 | TRACK | Yes |
| Kahleah Copper O19.5 BOARD_ONLY Top2 | #4 | BOARD_ONLY | Decision yes; **not Top #2** |
| Valeriane Ayayi O13.5 TRACK | #5 | TRACK | Yes |
| Pauline Astier U9.5 NO_BET | #6 | NO_BET | Yes |
| Leonie Fiebich O9.5 NO_BET | — (board only) | NO_BET in quality audit; BOARD_ONLY on some enriched copies | **Not in Best 6** |
| Jonquel Jones O14.5 BOARD_ONLY | — (board only) | BOARD_ONLY | **Not in Best 6** (Malonga #3 instead) |

**Game clusters (user framing):**

- **DAL–NYL:** Bueckers (DAL), Jones, Fiebich, Astier (NYL) = 4 user-listed props. Prod Best 6 includes **2** from this game (Bueckers, Astier).
- **CHI–PHO:** Copper, Ayayi = 2. Both in prod Best 6.

**Prod Best 6 full order:**

| Rank | Player | Game | Decision | Collision label |
|------|--------|------|----------|-----------------|
| 1 | Paige Bueckers O21.5 | DAL–NYL | TRACK | FLIP_WARNING |
| 2 | Flau'jae Johnson O12.5 | SEA–LA | TRACK | FLIP_WARNING |
| 3 | Dominique Malonga O17.5 | SEA–LA | BOARD_ONLY | FLIP_WARNING |
| 4 | Kahleah Copper O19.5 | CHI–PHO | BOARD_ONLY | WARNING |
| 5 | Valeriane Ayayi O13.5 | CHI–PHO | TRACK | WARNING |
| 6 | Pauline Astier U9.5 | DAL–NYL | NO_BET | CLEAR |

**Top Picks (WNBA):** Bueckers (#1) + Johnson (#2) — **not** Copper.

---

## Slate-level diagnostics (`trackingQualityAudit` 2026-07-07)

| Metric | Value |
|--------|-------|
| Generated candidates | 15 |
| Passed quality gate (TRACK cohort) | 4 |
| Board only | 9 |
| NO_BET | 2 |
| Blocked | 2 |
| Official TRACK in cohort | 4 (Bueckers, Ionescu UNDER, Ogunbowale UNDER, Ayayi) |

**Warning frequency (all candidates):** `OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR` ×5, `UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR` ×3, `PARTIAL_DANGER_GATE_STACK` ×10, unstable-minutes debts on most overs.

**NBA:** `bestSixDisplayNBA.length === 0`.

---

## Per-prop inspection

### 1. Paige Bueckers — O21.5 — TRACK (Best #1, Top #1)

**Prod payload highlights**

| Field | Value |
|-------|-------|
| confidence | 82 |
| projection | 25.6 |
| projectionGap (reader) | 4.1 |
| netEdge | 79 |
| trueRisk | MEDIUM |
| dataMode | WNBA_LIMITED_DATA |
| books | 3 |
| minutesRange | 31–38 (range 7) |
| last5 / season | 24.8 / 20.3 |
| gateReason | WNBA_OVER_PASSED_V2_GATE |
| resultsAdmissionEligible | true |

**Flip-first / collision**

- `flipFirstLabels.collision`: **FLIP_WARNING** (score **57** ≥ 45)
- Teammate overs in conflict: **Azzi Fudd**, **Jessica Shepard**
- `recommendation`: **FLIP_TO_UNDER**; `sideImpact`: UNDER
- `impliedTeamTotal`: **null** — collision cannot validate combined demand vs team total

**Role / usage**

- `minutesVolatility`: **unstable** (HIGH debt `UNSTABLE_MINUTES`)
- `roleStability.status`: GOOD (score 71) — **contradiction**: unstable flag vs “GOOD” status
- `usageShare.status`: GOOD (86); expanding role supports Over

**Trust / accuracy gaps**

1. **Decision vs collision:** TRACK despite FLIP_WARNING and flip-to-under recommendation — flip-first DI elevates risk but does not demote Best 6 admission.
2. **Minutes trust:** Unstable minutes + 7-minute range; reader still OFFICIAL 95% with star-line narrative.
3. **Same-team stack:** Three DAL overs on board (Bueckers, Fudd, Shepard); only Bueckers in Best 6 — collision signal is real but uncapped at team level.
4. **dataMode inconsistency:** Quality audit lists `WNBA_FULL_DATA`; card shows `WNBA_LIMITED_DATA` — undermines “Data” badge trust.
5. **Threshold edge:** projectionGap 4.1 vs OVER floor 4.0 — TRACK by **0.1**; fragile.

---

### 2. Kahleah Copper — O19.5 — BOARD_ONLY (Best #4; user cited Top #2)

**Prod payload highlights**

| Field | Value |
|-------|-------|
| confidence | 85 |
| projection | 22.1 |
| projectionGap | 2.6 |
| netEdge | 68 |
| trueRisk | **HIGH** |
| gateReason | **DANGER_STACK_INSUFFICIENT_EDGE** |
| resultsAdmissionEligible | true |

**Flip-first / collision**

- Collision **WARNING** (score 37) with teammate **Ayayi** — combined line demand 33
- Not FLIP_WARNING tier; monitor-only

**Role / usage**

- `minutesVolatility`: **unstable**
- `usageShare.status`: PARTIAL — FGA share **down**; projectionQuality **MIXED**, `sideImpact` UNDER
- `projQ.supportedByUsage`: **false**

**Trust / accuracy gaps**

1. **BOARD_ONLY is correct** — thin gap (2.6 &lt; 4.0 over floor), danger stack, HIGH true risk; reader OFFICIAL overstates vs gate.
2. **Top #2 mismatch:** User expects Copper as Top #2; prod Top #2 is **Johnson** (Best #2). Selector takes ranks 1–2, not “best TRACK only.”
3. **Coupled with Ayayi TRACK:** Same-game Copper BOARD_ONLY + Ayayi TRACK = inconsistent team scoring thesis.
4. **Unstable minutes** again labeled HIGH debt but role score PARTIAL/GREEN-ish paths still feed reader OFFICIAL.

---

### 3. Valeriane Ayayi — O13.5 — TRACK (Best #5)

**Prod payload highlights**

| Field | Value |
|-------|-------|
| confidence | 77 |
| projectionGap | 4.8 |
| netEdge | 67 |
| trueRisk | MEDIUM |
| books | **2** (THIN_MARKET warning in audit) |
| last5 / season | 16.8 / **7.1** (large role inflation) |
| gateReason | WNBA_OVER_PASSED_V2_GATE |

**Flip-first / collision**

- WARNING with Copper; not FLIP tier

**Role / usage**

- `minutesVolatility`: **unstable**
- `hotShootingRisk`: **true**
- `projectionQuality.status`: **MIXED** — hot-game risk, unsupported minutes, market against
- `roleStability.score`: 48 PARTIAL

**Trust / accuracy gaps**

1. **TRACK despite weak projectionQuality (49)** — flip-first says UNDER impact; gate TRACK wins on gap 4.8 alone.
2. **Season vs last5:** 7.1 season → 16.8 last5 on unstable minutes = efficiency / small-sample spike risk underweighted.
3. **Thin market (2 books)** — warning in audit but still TRACK.
4. **Pair with Copper BOARD_ONLY** — user sees one TRACK + one BOARD_ONLY on same team; trust in team cluster is low.

---

### 4. Pauline Astier — U9.5 — NO_BET (Best #6)

**Prod payload highlights**

| Field | Value |
|-------|-------|
| side | **Under** |
| projectionGap (under) | 3.4 |
| netEdge | 84 |
| trueRisk | HIGH |
| gateReason | **DANGER_GATE_STACK_NO_TRACK** |
| dangerGateCount | 4 |
| resultsAdmissionEligible | **true** (track-all-6) |
| resultsDecisionLabel | NO_BET |

**Reader:** OFFICIAL UNDER with strong under case (low minutes, low FGA, contracting role).

**Risk debts:** UNSTABLE_MINUTES, LOW_MINUTES_FLOOR, THIN_EDGE, **LOW_VOLUME_OVER_TRAP** (KILL, side OVER), WEAK_MARKET_QUALITY.

**Trust / accuracy gaps**

1. **Stale copy bug (confirmed):** `simpleExplanation` =  
   `NO_BET — low volume over trap flagged by danger gate.. Not eligible for Results or Top Picks.`  
   Prop is **UNDER**. `pickPrimaryDebtExplanation()` picks highest-severity debt **without filtering by side**, so OVER-only KILL code surfaces on an Under card.
2. **NO_BET in Results Tracked 6/6:** By design (`track-all-best-six-v1`), but copy says “Not eligible for Results” — **direct contradiction** on Results tab.
3. **Reader vs gate:** Reader OFFICIAL UNDER; gate NO_BET from danger stack — user sees strong under narrative + NO_BET badge; intellectually fair but emotionally confusing.
4. **UNDER_GAP warning in audit** (3.4 gap) coexists with under reader pass — floor semantics differ between reader and gate paths.

---

### 5. Leonie Fiebich — O9.5 — NO_BET (user paste; **not** in Best 6)

**Prod board payload**

| Field | Value |
|-------|-------|
| trackingEligibility (audit) | **NO_BET** |
| blockReasons | LOW_VOLUME_OVER_TRAP, EFFICIENCY_ONLY_SCORING_SPIKE |
| projectionGap | 3.5 |
| FGA | 8 |
| minutes | 29.8 |
| reader | OFFICIAL OVER but disagrees: hot shooting, questionable availability |

**Enriched copy inconsistency**

- Some pipeline copies: `track: BOARD_ONLY`, `gateReason: LOW_VOLUME_OVER_TRAP`, `simpleExplanation: NO_BET — low volume over trap…`
- `reason` field on one copy: `"Opposite lacks independent evidence."` (stale / wrong layer)

**Trust / accuracy gaps**

1. **Eligibility drift** between BOARD_ONLY and NO_BET across cache layers — trust in single source of truth is broken.
2. **Correct NO_BET thesis** (low volume + efficiency spike) undermined by mixed labels.
3. **Not in Best 6** despite user expectation — scorer ranked Johnson/Malonga (SEA–LA) higher.
4. DAL–NYL cluster overcrowding: Fiebich competes with Bueckers/Astier/Jones for attention; gate correctly kills Fiebich Over.

---

### 6. Jonquel Jones — O14.5 — BOARD_ONLY (user paste; **not** in Best 6)

**Prod board payload**

| Field | Value |
|-------|-------|
| projectionGap | **3.0** |
| OVER gap floor | **4.0** |
| gateReason | **OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR** |
| trueRisk | HIGH |
| dataMode | WNBA_LIMITED_DATA |
| flip.collision | CLEAR |

**simpleExplanation:**  
`BOARD_ONLY — Over has unstable minutes flagged by danger gate.. OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR`

**Trust / accuracy gaps (Jones “stale copy”)**

1. **Gate code is correct** (`OVER_GAP_…`, not `UNDER_GAP_…`) on prod — if UI showed UNDER variant, likely **cached older payload** or generic “LIMITED_DATA_FLOOR” label without side prefix.
2. **Copy priority issue:** Primary debt text leads with **unstable minutes**; the actual BOARD_ONLY gate is **gap 3.0 &lt; 4.0**. User sees minutes narrative while “LIMITED_DATA_FLOOR” feels buried — reads as stale or misaligned.
3. **Reader OFFICIAL** with gap 3.0 — reader “moderate gap” language doesn’t match strict 4.0 OVER floor in gate v2.
4. **Malonga replaced Jones in Best 6** at #3 — both SEA–LA overs with similar FLIP_WARNING; Malonga higher confidence/score despite same BOARD_ONLY class on gap.

---

### Board props referenced by user but not in Best 6

| Player | Decision | Why not Best 6 |
|--------|----------|----------------|
| Flau'jae Johnson O12.5 | TRACK | **In Best 6 #2** (user omitted) |
| Dominique Malonga O17.5 | BOARD_ONLY | **In Best 6 #3** (user omitted) |
| Jonquel Jones O14.5 | BOARD_ONLY | Scored below Malonga/Johnson; gap floor |
| Leonie Fiebich O9.5 | NO_BET | Kill traps; no Best 6 slot |

---

## Cross-cutting: data gaps

| Gap | Impact |
|-----|--------|
| `impliedTeamTotal` null on collision | FLIP_WARNING cannot validate combined overs vs team total; collision is teammate-name-only |
| `WNBA_FULL_DATA` in audit vs `WNBA_LIMITED_DATA` on cards | Data tier badge and gate floors may disagree |
| Opponent history thin | Bueckers 1 game; Fiebich none — high reader confidence anyway |
| 2-book markets (Ayayi, Astier) | THIN_MARKET warnings; TRACK/NO_BET split inconsistent |
| Missing availability on Fiebich | `availability: UNCERTAIN` in flip labels; still reader OFFICIAL |

---

## Cross-cutting: logic gaps

| Logic | Issue |
|-------|-------|
| **FLIP_WARNING + TRACK** | `sameTeamCollision` score ≥ 45 recommends FLIP_TO_UNDER; `controlledBestSixSelector` still admits TRACK if gate passes |
| **Unstable minutes** | Flagged HIGH debt on 5/6 Best 6; TRACK props (Bueckers, Johnson, Ayayi) still earn OFFICIAL reader + TRACK gate |
| **track-all-6 Results** | All six `resultsAdmissionEligible: true`; NO_BET copy says “not eligible for Results” |
| **Top Picks from Best #1–#2** | BOARD_ONLY at #4 (Copper) never Top Pick unless ranks 1–2 are both BOARD_ONLY |
| **Side-agnostic debt copy** | `pickPrimaryDebtExplanation` ignores `debt.side` → Under props show Over trap text |
| **Eligibility layering** | Fiebich: quality audit NO_BET vs enriched BOARD_ONLY vs simple NO_BET |

---

## Cross-cutting: threshold gaps

| Threshold | Value | Observed failure mode |
|-----------|-------|------------------------|
| `WNBA_LIMITED_OVER_GAP_FLOOR` | 4.0 | Jones 3.0, Copper 2.6, Malonga 3.5 → BOARD_ONLY; Bueckers 4.1 barely passes |
| `WNBA_LIMITED_UNDER_GAP_FLOOR` | 3.5 | Astier under gap 3.4 → warnings; Stewart/Thomas unders BOARD_ONLY at ~2.0 |
| Collision FLIP_WARNING | score ≥ 45 | Bueckers, Johnson, Malonga — no admission demotion |
| Collision WARNING | score ≥ 30 | Copper, Ayayi — paired team overs |
| Danger stack NO_TRACK | count ≥ 4 | Astier → NO_BET |
| `LOW_VOLUME_OVER_TRAP` | KILL | Fiebich, Astier debt list (Astier Under) |

---

## Issues from user paste — verdict

| User issue | Verdict on prod 2026-07-07 |
|------------|------------------------------|
| collision FLIP_WARNING | **Confirmed** on Bueckers (#1), Johnson (#2), Malonga (#3) |
| unstable minutes | **Confirmed** on 5/6 Best 6; TRACK on 3 despite HIGH debt |
| Jones LIMITED_DATA_FLOOR stale copy | **Partially confirmed** — gate uses correct `OVER_GAP_…`; **copy priority** favors minutes over gap floor; UNDER variant not in current payload (cache if seen) |
| NO_BET in Results track-all-6 | **Confirmed by design** — Astier NO_BET admitted; **copy contradicts** (“not eligible for Results”) |
| NBA 0/6 | **Confirmed** — `bestSixDisplayNBA: []` |
| DAL–NYL cluster (4) | **User list = 4 board props**; **Best 6 = 2** from that game |
| CHI–PHO (2) | **Confirmed** — Copper + Ayayi |
| Fiebich / Jones in Best 6 | **Not in prod Best 6** — Johnson + Malonga instead |

---

## Stale-copy bugs (report only — no code changes)

1. **Astier UNDER NO_BET:** `buildSimpleExplanation` + `pickPrimaryDebtExplanation` surface `LOW_VOLUME_OVER_TRAP` (OVER-side KILL) on an Under prop.  
   **Fix direction:** Filter debts by active side before primary debt selection; for NO_BET use `gate.wnbaTrackingReason` when side-mismatched.

2. **Astier / track-all-6:** NO_BET `simpleExplanation` says “Not eligible for Results” while `resultsAdmissionEligible: true`.  
   **Fix direction:** Track-all-aware copy (“Results labeled No Bet” vs hard exclusion).

3. **Fiebich:** `trackingEligibility` BOARD_ONLY vs NO_BET vs `simpleExplanation` NO_BET on different layers.  
   **Fix direction:** Single post-gate eligibility write; align `wnbaTrackingReason` and `decisionIntelligence.trackEligibility`.

4. **Jones:** Not stale gate code on prod; **misleading priority** — minutes debt headline vs `OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR` footnote.  
   **Fix direction:** BOARD_ONLY copy should lead with `gate.wnbaTrackingReason` when `sideGatePassed === false`.

---

## Trust scorecard (Best 6 only)

| Rank | Player | Decision | Data trust | Logic trust | Copy trust | Overall |
|------|--------|----------|------------|-------------|------------|---------|
| 1 | Bueckers | TRACK | Medium | Low (FLIP+unstable) | Medium | **Low–Medium** |
| 2 | Johnson | TRACK | Medium | Low (FLIP+unstable) | Medium | **Low–Medium** |
| 3 | Malonga | BOARD_ONLY | Medium | Low (FLIP+gap) | Medium | **Low** |
| 4 | Copper | BOARD_ONLY | Medium | Medium | Medium | **Medium** |
| 5 | Ayayi | TRACK | Low (thin books, hot shoot) | Low | Medium | **Low** |
| 6 | Astier | NO_BET | Medium | High (gate coherent) | **Poor** | **Low** |

---

## Recommendations (inspection only)

1. **Do not treat TRACK badges on FLIP_WARNING cards as high conviction** without manual same-team review (DAL and SEA clusters).
2. **Treat Results Tracked 6/6 as “6 labeled props”** not “6 official plays” — 2 BOARD_ONLY + 1 NO_BET on this slate.
3. **Ignore Top #2 for Copper** on this refresh; prod Top #2 is Johnson.
4. **Jones / Fiebich:** valid board reads but correctly excluded from Best 6; prefer gate reason over reader OFFICIAL on Jones (gap 3.0 &lt; 4.0).
5. **NBA:** no action on 0/6 until tomorrow NBA candidates exist in `/picks`.
6. **Before next deploy:** fix side-agnostic NO_BET copy and track-all-6 contradictory strings (see stale-copy bugs).

---

## Payload files (local)

| File | Purpose |
|------|---------|
| `.tmp-prod-picks-0707.json` | Full `/picks` |
| `.tmp-prod-top-props-0707.json` | `/top-props` incl. `bestSixDisplayWNBA` |
| `.tmp-prod-diag-0707.json` | `/diagnostics` |
| `.tmp-user-cmd1-out.txt` | Extracted Best 6 slim payloads |

---

*Report only. No code changes applied.*

---

## Fix deployment — `courteedge-trust-accuracy-fixes-v1`

**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-trust-accuracy-fixes-v1`  
**Tests:** 8/8 graduated data mode · 29/29 DI · 16/16 flip-first · 32/32 Best 6 · 41/41 tracking gate — **all green**

### P0 fixes implemented

| # | Issue | Fix |
|---|-------|-----|
| 1 | **dataMode propagation** — card `WNBA_FULL_DATA` vs pick `WNBA_LIMITED_DATA`; wrong 4.0 Over floor | `syncWnbaDataModeOnPick()` wired through gate inputs, DI, Best 6 stack, decision engine; `resolveWnbaGapFloors()` — FULL_DATA stable Over floor **3.5**, LIMITED/volatile Over **4.0** |
| 2 | **Fiebich NO_BET vs BOARD_ONLY mismatch** | Side rescue overlay preserves gate `NO_BET`; DI `trackEligibility` synced to `wnbaTrackingDecision` in `applyDecisionIntelligenceToPick` |
| 3 | **Flip-first on thin gap / efficiency** | `collectMetricsGateProblems()` + `CHECK_UNDER`/`CHECK_OVER` review actions (no auto-flip); collision score ≥30 adds `REVIEW_UNDER` |
| 4 | **Stale copy** | Side-aware `pickPrimaryDebtExplanation()` skips Over-only debts on Under; gate-reason priority for gap-floor BOARD_ONLY; track-all-6 NO_BET copy via `annotateResultsAdmission` |
| 5 | **Same-team collision (P1)** | `sameTeamUsageCollisionV1` broader side normalization; FLIP_WARNING at score ≥30 affects flip-check path |

### Jul 7 props — before (prod) vs after (fixed engine on same payload)

Re-evaluated from `.tmp-prod-picks-0707.json` through full decision stack.

| Player | Decision | dataMode before → after | Key copy / gate change |
|--------|----------|-------------------------|-------------------------|
| **Paige Bueckers** O21.5 | TRACK → TRACK | LIMITED → **FULL** | Gap 4.1 now vs FULL_DATA 3.5 floor (was LIMITED 4.0 framing); unstable minutes still MEDIUM risk |
| **Flau'jae Johnson** O12.5 | TRACK → TRACK | LIMITED → **FULL** | Same dataMode sync; TRACK unchanged |
| **Kahleah Copper** O19.5 | BOARD_ONLY → BOARD_ONLY | LIMITED → **FULL** | Gate reason leads with danger stack; side rescue aligns BOARD_ONLY |
| **Pauline Astier** U9.5 | NO_BET → NO_BET | LIMITED → **FULL** | **Before:** "low volume over trap" on Under + "not eligible for Results". **After:** "unstable minutes" + "Not eligible for Top Picks" (track-all-6 learning pool preserved) |
| **Jonquel Jones** O14.5 | BOARD_ONLY → BOARD_ONLY | LIMITED → **FULL** | **Before:** minutes headline + `OVER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR`. **After:** thin-edge headline + `OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR` (gap 3.0 vs 3.5 FULL floor) |

### Files touched

- `engines/wnba/wnbaGraduatedDataModeV1.js` — gap floors, side-aware debts, sync helper
- `engines/wnba/wnbaGateInputs.js` — `syncWnbaDataModeOnPick`, card FULL honor
- `engines/wnba/wnbaTrackingGateV2.js` — graduated gap floors in `evaluateSideGate`
- `engines/wnba/wnbaDecisionEngine.js` — sync before flip-first
- `engines/decisionIntelligence/propDecisionIntelligenceV1.js` — DI sync, explanations
- `engines/decisionIntelligence/flipFirstSideSelectionV1.js` — thin-gap CHECK actions
- `engines/decisionIntelligence/sideRescueEngineV1.js` — gate NO_BET/BOARD_ONLY preservation
- `engines/decisionIntelligence/sameTeamUsageCollisionV1.js` — collision review threshold
- `engines/topProps/controlledBestSixSelector.js` — stack sync, Results copy
- `server.js` — SERVER_BUILD bump
- Test scripts: `testWnbaGraduatedDataModeV1.js`, `testPropDecisionIntelligenceV1.js`, `testFlipFirstDecisionIntelligenceV1.js`, `testWnbaTrackingGateV2.js`

*Fixes applied 2026-07-07. Deploy to prod required for live `/picks` to reflect changes.*
