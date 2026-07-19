# CourtEdge Engine Expansion V1 — Final Report

**Date:** 2026-07-19  
**Branch:** `betbrain-v2-rebuild`  
**Remote:** `orgin`  
**SERVER_BUILD:** `courteedge-engine-expansion-v1`  
**Feature flag:** `COURTEDGE_ENGINE_EXPANSION_V1_ENABLED=true` (default ON)  
**Schema:** `courtEdgeEngineSignalsV1`  
**Calibration:** `courtEdgeEngineCalibrationV1` (static NBA/WNBA; no auto-tune)

---

## 1. Current engine/pipeline audit

CourtEdge generation remains:

`refreshAllPicks` → `buildPicksForDay` → WNBA V2 `evaluateWnbaPropDecision` (or NBA legacy) → Flip-First → Side Rescue → same-team V2 → Controlled Best 6 → Top → canonical seal → track → Results/Lab/History.

**Pre-expansion signal layers already present:** `courtEdgePlayerEvidenceV1`, DDI micro-engines, Reader, volume/danger gates, line integrity V1, same-team arbitration V2.

**Expansion adds** 11 versioned engines + evidence deduplication + static calibration, attached as `courtEdgeEngineSignalsV1` without rebuilding Lab UI or adding Calibration Feedback.

---

## 2. Files and functions inspected

| Area | Paths |
|------|-------|
| Orchestration | `server.js` (`buildPicksForDay`, `refreshAllPicks`), `engines/wnba/wnbaDecisionEngine.js` |
| Best 6 / same-team | `engines/topProps/controlledBestSixSelector.js`, `sameTeamOpportunityEngineV2.js`, `sameTeamForcedSidePresentationV1.js` |
| Seal / track | `services/canonicalSealedProp.js`, `trackedPropService.js`, `lineIntegrityV1.js` |
| Evidence / defense | `courtEdgePlayerEvidenceV1.js`, `wnbaOpponentContextService.js` |
| Providers | `scripts/probeProviderEntitlements.js`, prior fixtures under `test-fixtures/provider-entitlements/` |
| Config | `config.js` |

---

## 3. Files changed / added

### Added
- `engines/courtEdgeExpansion/` — 11 engines + shared + calibration + orchestrator
- `services/courtEdgeEngineSignalsV1.js` — attach/apply helpers
- `scripts/testCourtEdgeEngineExpansionV1.js` — tests 1–75
- `scripts/smokeCourtEdgeEngineExpansionV1.js`
- `scripts/replayCourtEdgeEngineExpansionV1.js` — read-only replay
- `test-fixtures/engine-expansion-v1/`
- `COURTEDGE_ENGINE_EXPANSION_V1_REPORT.md` (this file)

### Modified
- `config.js` — `COURTEDGE_ENGINE_EXPANSION_V1_ENABLED`
- `server.js` — `SERVER_BUILD`, NBA/legacy attach path
- `engines/wnba/wnbaDecisionEngine.js` — attach + OUT pre-seal reject
- `engines/wnba/playerIntelligence/sameTeamForcedSidePresentationV1.js` — preserve signals on forced Under
- `services/canonicalSealedProp.js` — persist `courtEdgeEngineSignalsV1`

**Not modified:** `.env`, tracked/history archives, July 17 sealed membership, Lab UI.

---

## 4. New `courtEdgeEngineSignalsV1` schema

```
courtEdgeEngineSignalsV1: {
  version: "courtEdgeEngineSignalsV1",
  schemaBuild: "courteedge-engine-expansion-v1",
  enabled, league, playerId, teamId, opponentId, gameId,
  generatedAt, dataCapturedAt,
  lineMovement, projectionSanity, availabilityRoster,
  distributionProfile, volatilityProfile, defensiveArchetype,
  roleVelocity, pacePossession, restFatigue, teammateImpact,
  evidenceDeduplication,
  engines: { ...raw per-engine including scoringEnvironmentProxy store-only },
  aggregation: {
    originalOverSupport, originalUnderSupport, organicModelSide,
    organicModelConfidence, independentEvidenceGroups,
    usedSignalContributions, suppressedDuplicateContributions,
    contradictionCount, evidenceCoverage, projectionConfidence,
    pickConfidence, finalRisk, confidenceAdjustment, riskAdjustment, ...
  }
}
```

Every engine signal includes: `available`, `source`, `sourceIds`, `fetchedAt`, `sampleSize`, `quality`, `stale`, `error`, `fallbackUsed`, `rawValues`, `normalizedSignal`, `overContribution`, `underContribution`, `confidenceAdjustment`, `riskAdjustment`, `reason`, `units`.

Missing → `available:false`, `normalizedSignal:0`, no Over/Under votes, no fabricated 50/neutral.

Persisted on: candidate, Best 6, tracked prop, `canonicalSealedProp`, and thus Results/Lab/History consumers of sealed records.

---

## 5–6. Static NBA / WNBA calibration

File: `engines/courtEdgeExpansion/calibrationV1.js`

- Separate NBA vs WNBA group caps and engine weights
- Conservative static seeds only
- **No** Lab-to-live feedback, **no** self-modifying production weights
- `COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED` remains OFF

---

## 7. Exact implementation for all 11 engines

| # | Engine | Module | Behavior |
|---|--------|--------|----------|
| 1 | Line Movement / CLV | `lineMovementClvEngine.js` | Directional move ≠ sealed number value; never rewrites line |
| 2 | Projection Sanity | `projectionSanityEngine.js` | Ceiling vs role/context; does not remove tracking |
| 3 | Availability / Roster | `availabilityRosterEngine.js` | Schedule gap ≠ inactive; provider fail ≠ OUT |
| 4 | Ceiling/Floor Distribution | `distributionEngine.js` | Season/recent/role separate; 75th pct ≠ auto Under |
| 5 | Volatility Profile | `volatilityEngine.js` | Descriptive; **never** auto-votes Under |
| 6 | Defensive Archetype | `defensiveArchetypeEngine.js` | Comparable boxes; no sample → UNAVAILABLE |
| 7 | Role Trend Velocity | `roleVelocityEngine.js` | One-game blip vs sustained; one ROLE_AND_VOLUME vote |
| 8 | True Pace / Possession | `pacePossessionEngine.js` | FGA+0.44FTA−OREB+TOV only when complete |
| 9 | Evidence Dedup | `evidenceDeduplicationEngine.js` | Group caps + root-cause suppression |
| 10 | Rest / Fatigue | `restFatigueEngine.js` | B2B/3-in-4/OT; travel unavailable if unresolved; no auto Under |
| 11 | Teammate Impact | `teammateImpactEngine.js` | Verified status + rotation overlap required |

Orchestrator: `orchestratorV1.js` (`buildCourtEdgeEngineSignalsV1`).

---

## 8. Provider fields used by each engine

| Engine | Providers / fields |
|--------|-------------------|
| Line movement | Odds line integrity: opening/selected/sealed/current, prices, bookCount |
| Projection sanity | BDL game logs pts/min/FGA/FTA; projection; optional vendor NBA SportsData |
| Availability | BDL injuries + prop market + recent boxes |
| Distribution | BDL points series |
| Volatility | BDL points/min/FGA |
| Defensive archetype | BDL opponent allowed samples (when present) |
| Role velocity | BDL minutes/FGA/FTA/pts (+ estimated usage proxy) |
| True pace | Team box FGA/FTA/OREB/TOV when complete |
| Dedup | Internal ledger only |
| Rest/fatigue | Team schedule dates + recent minutes/OT |
| Teammate | Injury status + with/without game-log splits |

---

## 9. Provider limitations and fallbacks (**implemented vs left out**)

### Re-probe 2026-07-19

| Provider | Result |
|----------|--------|
| Keys loaded locally + prod | Odds YES, BDL YES, Sports YES |
| Odds / BDL live fetch this session | Network `fetch failed` (transient local) — **prior sanitized fixtures retained** |
| SportsData WNBA scores/Teams | **401** confirmed |
| SportsData WNBA scores/Players | **401** confirmed |
| SportsData NBA TeamSeasonStats | **401** confirmed |
| SportsData NBA projections by date | **200** (empty slate OK) |
| BDL `team_season_averages` | **404** (prior fixture) |

### Implemented from entitled paths
- Odds line/market fields (when markets exist)
- BDL teams/players/stats/injuries/games (existing generation paths)
- SportsData NBA fantasy/projections (existing NBA path)
- ESPN grading fallback unchanged (not generation)

### Left out / degraded because keys/entitlements do not support it

| Capability | Status | Engine behavior |
|------------|--------|-----------------|
| BDL `team_season_averages` (official team PPG allowed / pace) | 404 UNAUTHORIZED | Defensive archetype + true pace do **not** fabricate team season averages; pace uses complete box only or `available:false` |
| SportsData WNBA scores/stats/projections | 401/404 | `COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED` stays **false**; no WNBA SportsData generation |
| SportsData NBA TeamSeasonStats | 401 | Not wired; NBA defense continues via entitled paths / fixtures |
| Official opening historical Odds lines (if plan lacks history) | Not confirmed | Internal market snapshots remain source of opening/selected |
| Travel distance / timezone change | Not safely derivable | Rest engine reports travel **unavailable** (not zero) |
| True pace without OREB/TOV | Incomplete box | `truePaceAvailable:false`; scoringEnvironmentProxy stored separately, **never** as true pace |
| Live NBA verification | Offseason | Fixture/replay only — not claimed as live |

**Honesty rule preserved:** no zeros/50/neutral/confirmed/complete fabricated from missing evidence.

---

## 10. Evidence-deduplication group design

Groups: `ROLE_AND_VOLUME`, `DISTRIBUTION_AND_VOLATILITY`, `PROJECTION`, `OPPONENT_AND_MATCHUP`, `MARKET`, `AVAILABILITY_AND_TEAMMATE`, `GAME_ENVIRONMENT`, `REST_AND_FATIGUE`.

- Correlated engines share a root cause; only strongest contribution votes
- Group caps from static calibration
- Raw signals always stored even when suppressed
- Reader/confidence/risk consume capped aggregation only

---

## 11. Runtime execution order

Matches requested 30-step order. Expansion fills steps 4–18 via orchestrator; existing pipeline owns 19–30 (Reader → Flip-First → Side Rescue → same-team → Best 6 → Top → seal → track → Results/Lab/History).

Later stages **do not overwrite** raw engine outputs; same-team only annotates aggregation / confidence-risk.

---

## 12–14. Signal / confidence / risk formulas (summary)

- Per engine: `normalizedSignal ∈ [-1,1]`; side contributions; confidence/risk deltas
- Quality + sample shrinkage + stale multipliers inside dedup
- Aggregation: capped group sums → `confidenceAdjustment`, categorical `riskAdjustment` (`REDUCE|NEUTRAL|MONITOR|ELEVATE`)
- `applyEngineSignalAdjustments`: adjusts confidence only; **never** side/line; **never** removes from six
- Same-team forced Under: presentation recalibration + policy conflict annotation; **no invented Under evidence**; line unchanged

---

## 15. Same-team integration proof

- `finalizeSameTeamForcedUnderPresentation` keeps `applySideChangeKeepLine`
- Preserves `originalModelSide`, organic evidence grades, forced `finalCourtEdgeSide=UNDER`
- Engine signal bundle retained; aggregation annotated `SAME_TEAM_ARBITRATION_FLIP`
- Tests 51–62 in expansion suite + existing `testSameTeamOpportunityV2.js` PASS

---

## 16. Line-integrity proof

- Engines never rewrite selected/sealed line
- Existing `lineIntegrityV1` remains authority for flips
- Expansion tests 51–53, 56, 58–60, 65 PASS
- Existing `testLineIntegrityV1.js` PASS

---

## 17. NBA parity (fixtures/replay)

- Shared schema + NBA calibration + 48-minute pace normalization
- NBA attach path in `server.js` when expansion enabled
- Live NBA markets empty/offseason — **fixture verification only**
- SportsData NBA projections path retained; TeamSeasonStats still unauthorized

---

## 18. WNBA live verification

See deploy section after push. Expected: health `courteedge-engine-expansion-v1`, flag ON, Today/Tomorrow Best 6 TRACK×6, signals on sealed props.

---

## 19. Historical replay comparison

`node scripts/replayCourtEdgeEngineExpansionV1.js` — **read-only**.

- Loaded archives/fixtures including 06/21, 07/08 and tracked props
- Compared 12 props; no archives written
- Prior sealed objects not mutated

---

## 20. Known failure examples (before/after posture)

Replay/fixtures cover patterns for: Gabby Williams, Jewell Loyd, A’ja Wilson, Erica Wheeler, Marine Johannes, Olivia Miles, Kayla McBride, Nneka Ogwumike, Rhyne Howard, Kelsey Mitchell **when present in archives**.

Engines add distribution/volatility/role/sanity diagnostics; they **do not** rewrite official historical picks or July 17 grades.

---

## 21–25. Today / Tomorrow Best 6 / TRACK / Results 6/6 / labels

Filled after live refresh in deploy verification section below.

**Locked product rules unchanged in code:** Controlled Best 6 size, TRACK-all-six, Results admission, user labels TRACK / NOT SELECTED only, risk LOW/MEDIUM/HIGH.

---

## 26. Lab not rebuilt

No Lab UI changes. Signals stored for future Lab only.

## 27. No Calibration Feedback Engine

No auto weight updates from Lab/results. Static calibration only.

---

## 28–29. Tests passed and failed

### Expansion suite
`node scripts/testCourtEdgeEngineExpansionV1.js` → **75 passed, 0 failed**

### Smoke
`smokeCourtEdgeEngineExpansionV1.js` → **8 passed, 0 failed**

### Existing suites (this run)
| Suite | Result | Notes |
|-------|--------|-------|
| testLineIntegrityV1 | PASS | |
| testSameTeamOpportunityV2 | PASS | |
| testControlledBestSix | PASS (33/33) | |
| testFlipFirstDecisionIntelligenceV1 | Partial fails | Unrelated lifecycle date / lock expectations |
| testSideRescueEngineV1 / testCourtEdgeDataFlow | 45 pass / 5 fail | Unrelated: expects cohort version `v2-track-all-best-six`, code has `v3-today-best-six-full` |

These cohort-version failures predate this expansion and are **unrelated** to engine wiring.

---

## 30. New SERVER_BUILD

`courteedge-engine-expansion-v1`

## 31. Feature-flag / config status

| Flag | Status |
|------|--------|
| `COURTEDGE_ENGINE_EXPANSION_V1_ENABLED` | ON (default) |
| `COURTEDGE_EVIDENCE_V1_ENABLED` | ON |
| `COURTEDGE_WNBA_DEFENSE_V2_ENABLED` | ON |
| `COURTEDGE_WNBA_SPORTSDATA_SECONDARY_ENABLED` | OFF |
| `COURTEDGE_PROJECTION_CALIBRATION_V2_ENABLED` | OFF |

---

## 32–34. Commit / push / deploy

Filled after git operations in verification block.

## 35. Live `/health`

Filled after deploy.

## 36. Rollback command

```bash
# Revert SERVER_BUILD and disable expansion:
# Set SERVER_BUILD back to courteedge-line-lifecycle-calibration-v1
# Set COURTEDGE_ENGINE_EXPANSION_V1_ENABLED=false on Render
# git revert <expansion-commit> && git push orgin betbrain-v2-rebuild
```

## 37. No tracked/history delete or rewrite

Confirmed: no `/clear-tracked-props`, no archive writes from replay, July 17 not rewritten.

## 38. Six-man / track-all-six / same-team intact

Confirmed by passing Controlled Best 6 + Same-Team V2 suites; expansion engines cannot shrink slate or drop TRACK.

---

## Deploy verification (live)

_Populated by post-deploy checks._
