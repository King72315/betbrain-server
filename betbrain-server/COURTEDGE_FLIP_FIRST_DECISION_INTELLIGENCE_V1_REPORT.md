# CourtEdge Flip-First Decision Intelligence v1 Report

**Date:** 2026-06-27  
**Branch:** `betbrain-v2-rebuild`  
**Checkpoint:** `b715e20` — checkpoint before flip-first decision intelligence upgrade  
**SERVER_BUILD:** `courteedge-flip-first-decision-intelligence-v1`

## Executive Summary

Flip-First Decision Intelligence v1 teaches CourtEdge **how to use data** to choose the better side before downgrade/block. When the original Reader side has problems, the system scores the opposite side with independent evidence. Board Only / No Bet only when **both** sides fail or data is too unreliable.

**Core rule:** Do not block before checking the opposite side. Flip only when opposite is stronger — not because original is bad.

## Pipeline (Before → After)

### Before
```
data card → reader → tracking gate → decision intelligence → side rescue → best 6
```

### After
```
data integrity → data recovery → projection/fair line → reader (initial side)
→ decision data intelligence → flip-first side selection
→ tracking gate → decision intelligence → side rescue (confirmation)
→ best 6 ranking → results admission (TRACK-only)
```

Side Rescue remains after Decision Intelligence as a **confirmation layer** — flip-first handles early side comparison on raw data signals; Side Rescue handles risk-debt-triggered second review.

## New Modules

| File | Version | Role |
|------|---------|------|
| `decisionDataIntelligenceV1.js` | `flip-first-decision-data-intelligence-v1` | Orchestrator + `finalInfluence` |
| `flipFirstSideSelectionV1.js` | `flip-first-side-selection-v1` | Opposite-side scoring + flip guards |
| `roleStabilityIntelligenceV1.js` | `role-stability-intelligence-v1` | Minutes/FGA/hot-shooting stability |
| `usageShareIntelligenceV1.js` | `usage-share-intelligence-v1` | FGA/minutes/FTA trend share |
| `sameTeamUsageCollisionV1.js` | `same-team-usage-collision-v1` | Same-team Over demand vs implied total |
| `marketMovementIntelligenceV1.js` | `market-movement-intelligence-v1` | Line movement + edge shrink |
| `availabilityImpactV1.js` | `availability-impact-v1` | Player/teammate availability side effects |

## Phase 1 — Data Source Audit

| Source | WNBA | NBA | Status | Used For | Gap / Fallback |
|--------|------|-----|--------|----------|----------------|
| Ball Don't Lie API (`ballService`) | ✓ | ✓ | **Used** | last5, season stats, matchup | Player ID resolver + recovery fallback |
| Odds API (`oddsService`) | ✓ | ✓ | **Used** | lines, book count, consensus | Thin books → stale line flag |
| SportsData.io (`sportsDataService`) | partial | ✓ | **Partial** | NBA projections, season | WNBA limited on plan |
| WNBA stats (`wnbaStatsService`) | ✓ | — | **Used** | grading fallback | Not in live decision path |
| Fantasy WNBA (`fantasyWnbaService`) | ✓ | — | **Unused** | — | Available for usage enrichment later |
| WNBA availability (`wnbaAvailabilityService`) | ✓ | — | **Partial** | injury level | Missing → uncertainty, not auto-block |
| Market snapshots (`marketSnapshotService`) | ✓ | ✓ | **Used** | opening line, line delta | Required for movement intelligence |
| Volume profile (`volumeProfileEngine`) | ✓ | ✓ | **Used** | role trend, efficiency warning | Wired into role stability |
| Opportunity (`opportunityEngine`) | ✓ | ✓ | **Used** | role certainty, minutes stability | Wired into usage share |
| Role change (`roleChangeEngine`) | ✓ | ✓ | **Used** | FGA/minutes trends | Wired into usage share |
| Defense (`defenseScoreEngine`) | ✓ | ✓ | **Partial** | opponent proxy | Neutral proxy flagged |
| Play-by-play / rotation | — | — | **Unavailable** | — | Not on current API plan |
| Shot-location profile | — | — | **Unavailable** | — | Not wired |
| Other prop markets (REB/AST/3PM/PRA) | partial | partial | **Unused** | — | Available in odds feed; deferred to v2 role signals |
| Team implied total / game total | partial | partial | **Partial** | same-team collision | From `wnbaGameContext` when present |
| Matchup history (`wnbaMatchupLookupV1`) | ✓ | — | **Used** | data card integrity | Not yet in flip scoring |
| Data integrity v1 | ✓ | — | **Used** | upstream gate | Pre-flip-first |
| Data recovery v1 | ✓ | — | **Used** | fallback stats | Pre-flip-first |

## Phase 2 — Best-Use Map

| Data field | Best use | Over impact | Under impact | Flip trigger | Risk effect | Results admission |
|------------|----------|-------------|--------------|--------------|-------------|-------------------|
| Minutes trend UP + FGA UP | Usage confirmation | Supports | Weakens | Usage hurts Over → check Under | Monitor if volatile | No auto-block |
| Minutes volatile/unstable | Spike path | Supports if expanding | Weakens | Under fragile → check Over | Elevate risk | TRACK only if repaired |
| Line moved up (Over) | Edge shrink check | Weakens at higher number | Strengthens | Edge negative at new line | Market warning | No force TRACK |
| Line moved down (Under) | Edge shrink check | Strengthens | Weakens | Same, inverted | Market warning | No force TRACK |
| Same-team dual Overs | Collision demand | Weakens weaker Over | Strengthens flip candidate | Combined demand > implied total | Elevate | Board Only bias |
| Teammate OUT (high usage) | Usage boost | Supports | Weakens | Boost insufficient → check Under | Monitor | No auto-block |
| Availability UNKNOWN | Uncertainty | Hurts thin Overs more | Hurts fragile Unders more | Compare sides | Elevate | Uncertainty ≠ block |
| Hot-game efficiency spike | Line inflation | Weakens | Strengthens | No FGA support on Over | Hot-game flag | Board Only bias |
| Fair line disagrees | Independent check | Blocks blind flip | Blocks blind flip | Major contradiction guard | High | Block flip |
| Book count ≤ 2 | Market quality | Weakens both | Weakens both | Stale line suspected | Elevate | Strict admission |
| Role expanding | Side alignment | Supports | Contradicts | Role vs side mismatch | HIGH debt | Side Rescue layer |
| Projection gap ≥ 4 | Quality anchor | Supports Over | Supports Under | Thin gap → opposite review | Repair path | TRACK if gate passes |

## Integration Points

| File | Change |
|------|--------|
| `wnbaDecisionEngine.js` | Flip-first pipeline after reader, before gate/DI |
| `controlledBestSixSelector.js` | `controlled-best-six-flip-first-v1`; slate context for collision |
| `trackedPropService.js` | Flip-first in WNBA tracking gate; serialize DDI fields |
| `server.js` | SERVER_BUILD + cache invalidation for DDI version |
| `components/PropCard.tsx` | Compact flip-first labels on Best 6 cards |
| `utils/controlledBestSixDisplay.js` | Flip-first labels in display + report lines |

## UI Changes (Compact Labels)

Best 6 cards now show:
- **Usage:** GOOD / PARTIAL / BAD
- **Collision:** CLEAR / WARNING / FLIP_WARNING
- **Market:** FAVORABLE / NEUTRAL / AGAINST / FLIP_SIGNAL
- **Availability:** CONFIRMED / UNCERTAIN / OUT
- **Proj Q:** STRONG / MIXED / WEAK
- **Flip:** KEPT_ORIGINAL / FLIPPED_TO_OVER / FLIPPED_TO_UNDER / BOTH_SIDES_WEAK

Full `decisionDataIntelligence` object available in scout/debug payloads.

## Phase 7 — Replay Cases (Before → After)

| Case | Old side | New behavior | Flip? | Admission |
|------|----------|--------------|-------|-----------|
| Marina Mabrey O22.5→O26 (edge shrink) | Over | Market flags edge shrink; Under reviewed if gap thin | Maybe | TRACK if gate passes |
| Natisha Hiedeman O14.5 | Over | Same-team collision with Malonga detected | No (strong Over) | TRACK |
| Dominique Malonga O17.5 | Over | Collision pressure on combined Seattle demand | Flip candidate if weaker | Board Only if collision high |
| Seattle same-team overs | Multiple Overs | Collision module evaluates combined demand | Weaker Over → Under review | No force TRACK |
| DeWanna Bonner TRACK display vs Results | Over | Display Best 6 shows TRACK; Results still TRACK-only filter | No | Display ≠ Results pool |
| Kelsey Mitchell high-risk | Over | Multiple weak signals → elevated risk, no blind block | Review Under first | Board Only |
| Azura Stevens matchup | Under | Matchup in integrity; flip-first uses role/market | Case-by-case | Gate decides |
| 06/24 quarantined slate | — | **Unchanged** — quarantine registry still excludes | — | Excluded |

## Tests

`betbrain-server/scripts/testFlipFirstDecisionIntelligenceV1.js` — **15/15 passed**

Includes regression runs:
- `testControlledBestSix.js`
- `testSideRescueEngineV1.js`
- `testPropDecisionIntelligenceV1.js`
- `testCourtEdgeDataFlow.js`
- `testSlateRotationLifecycle.js`

## Preserved Behaviors

- Results → Lab → History rotation
- Home Tomorrow Best 6 (NBA + WNBA separate)
- Results TRACK-only admission
- Board Only / No Bet visible in Best 6 display
- Top Picks from display Best 6 ranking
- 06/24 quarantined slate excluded

## Safety Confirmations

- No `/clear-tracked-props` used
- No runtime JSON committed
- No `.env`, `eas.json`, or secrets touched
- No forced additional TRACK props

## Wired vs Not Wired

**Wired:** volume profile, role change, opportunity scores, market snapshots, availability gate, fair line, projection gap, same-team slate context, book count, line movement interpretation.

**Not wired (v2 candidates):** play-by-play rotation, shot-location profile, other prop markets as role signals (REB/AST/3PM/PRA), fantasy WNBA usage feed, full team implied total when game context missing.

## Post-deploy fix (2026-06-27) — Results pending empty

**Root cause:** TRACK-admitted Best 6 props were stored with `trackingType: TEST` and `excludedFromOfficialRecord: true` (reader v1 demotion), so `isOfficialResultsProp` excluded them from `/tracked-props` active filter → `activeResultsSlateDate: null` → Results tab empty despite TRACK cohort on `/picks`.

**Fix:** `isTrackAdmittedResultsProp()` + `resolveResultsTrackingRecordType()` in `trackedPropService.js` — TRACK eligibility promotes to OFFICIAL Results record; plain TEST without TRACK unchanged.

**SERVER_BUILD:** `courteedge-results-track-admission-fix-v1`
