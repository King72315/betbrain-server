# CourtEdge Lab V2 + Three-Slate Rule — Consolidation Report

**Date:** 2026-07-18  
**SERVER_BUILD:** `courteedge-lab-v2-three-slate-v1`  
**Prior production build:** `courteedge-engine-expansion-v1.1`  
**Branch:** `betbrain-v2-rebuild`  
**Remote:** `orgin`

---

## 1. Current Lab root-cause and clutter audit

The consumer Prop Lab mixed legacy tracking categories (LEAN/WATCHLIST/TEST), gate/loss reviews, retro simulations, and an Engine Scorecard that did **not** render Engine Expansion V1 signals. Sealed `courtEdgeEngineSignalsV1` / `courtEdgeDecisionPacketV1` existed on props but were not organized into a single analysis payload. Three-slate grouping lived only in History (`historyThreeSlateGroupsV1`) and was not a primary Lab calibration view.

## 2. Existing files/services inspected

- `services/dailySlateReportService.js`, `officialLearningRecordBuilder.js`, `labLearningEnrichmentService.js`, `labMeasuredFields.js`
- `services/historyThreeSlateGroupsV1.js`, `signalPerformanceV1.js`
- `services/courtEdgeEngineSignalsV1.js`, `engines/courtEdgeExpansion/*`
- `server.js` daily-slate / history-archives routes
- `app/(tabs)/prop-lab.tsx`, `utils/reportBuilders.ts`, `services/api.ts`
- `COURTEDGE_ENGINE_EXPANSION_V1_REPORT.md`

## 3. Files changed

| Path | Role |
|---|---|
| `betbrain-server/services/courtEdgeLabV2.js` | Authoritative Lab V2 aggregator |
| `betbrain-server/services/courtEdgeLabV2Helpers.js` | Sealed extraction, attribution, scorecards |
| `betbrain-server/services/courtEdgeLabV2Constants.js` | Version, 11 engines, banned labels |
| `betbrain-server/services/historyThreeSlateGroupsV2.js` | Persistent non-overlapping 3-slate blocks |
| `betbrain-server/scripts/testCourtEdgeLabV2.js` | Tests 1–68 |
| `betbrain-server/package.json` | `test:courtedge-lab-v2` |
| `betbrain-server/server.js` | `SERVER_BUILD`, `/courtedge/lab`, Lab V2 on reports |
| `betbrain-server/services/dailySlateReportService.js` | Attach `report.labV2` |
| `app/(tabs)/prop-lab.tsx` | 15-section Lab V2 UI |
| `services/api.ts` | `fetchCourtEdgeLabV2` |
| `utils/reportBuilders.ts` | `buildPropLabV2Report` |
| `betbrain-server/COURTEDGE_LAB_V2_THREE_SLATE_REPORT.md` | This report |

## 4. Final Lab V2 schema

```
courtEdgeLabV2: {
  version, generatedAt, buildVersion, bannedLabels,
  analysisOnly, writesLiveWeights, calibrationFeedbackEngine,
  currentSlate, activeThreeSlateBlock, previousThreeSlateBlock, threeSlateComparison,
  overallSummary, officialBestSixResults, perPropPackets,
  engineScorecards, decisionPathAnalysis, projectionCalibration,
  confidenceCalibration, riskCalibration, marketLineAnalysis,
  roleVolumeAnalysis, opponentGameContextAnalysis, sameTeamAnalysis,
  outcomeDiagnosis, adjustmentReview, rawSignalExplorer, allTimeContext,
  threeSlateGroups, meta
}
```

One calculation shared by `GET /courtedge/lab`, `GET /courtedge/lab/:slateDate`, `report.labV2`, and the copy report.

## 5. Final Prop Lab screen order

1. Current Completed Slate Summary  
2. Three-Slate Improvement Block  
3. Official Best 6 Results  
4. Per-Prop Learning Packets (5 layers)  
5. Engine Expansion Scoreboard (all 11)  
6. Decision-Path Accuracy  
7. Projection and Fair-Line Calibration  
8. Confidence and Risk Honesty  
9. Market and Line Performance  
10. Role/Volume/Distribution/Volatility  
11. Opponent and Game Context  
12. Miss and Win Diagnosis  
13. Adjustment Review (manual only)  
14. Raw Signal Explorer  
15. All-Time Context  

## 6. Daily overall summary design

Official Best 6 only: W-L-P, win rate/accuracy, margins, projection error, CLV, Top/Over/Under/NBA/WNBA. No legacy/test/nonselected clutter.

## 7. Three-slate grouping design

Non-overlapping chronological blocks (A-B-C then D-E-F). Persisted in `three-slate-blocks-v2.json`. Frozen membership never regrouped. Lab and History use `buildHistoryThreeSlateGroupsV2`.

## 8–10. Block membership and comparison

- Active block shows 1/3, 2/3, or 3/3 (complete block remains active until the next slate starts).  
- Previous block = last frozen block distinct from active.  
- Comparison includes W-L-P, win rate, accuracy, margins, projection errors, CLV, Over/Under, NBA/WNBA, risk, Top, organic vs same-team, Flip-First/Side Rescue, and per-engine deltas — not win rate alone.

## 11–13. Engine Expansion scoreboard + attribution

**Eleven engines always visible:** lineMovementClv, projectionSanity, availabilityRoster, distribution, volatility, defensiveArchetype, roleVelocity, pacePossession, evidenceDeduplication, restFatigue, teammateImpact.

**Directional:** aligned+win→helped; aligned+loss→hurt; opposed+win→hurt; opposed+loss→helped; unavailable/zero→neutral (not a directional loss).

**Calibration:** confidence/risk adjustments evaluated separately; volatility/fatigue never treated as automatic Under votes.

## 14. Per-prop learning packet design

Layers: Freeze → Pregame Engine Evidence (11) → Decision Path → Postgame Truth → Diagnosis. Freeze uses sealed pregame values; diagnosis never rewrites freeze.

## 15–22. Calibration / market / role / opponent / same-team / diagnosis

NBA and WNBA always separate. Confidence buckets 0–39…80+. Risk LOW/MEDIUM/HIGH only. Market WITH/AGAINST/NEUTRAL and CLV kept distinct. Role/volume/distribution/volatility scored without double-counting. True pace ≠ scoringEnvironmentProxy; unavailable defense ≠ neutral 50. Same-team forced props analyzed separately. Wins and losses both diagnosed.

## 23–24. Adjustment review + Raw Signal Explorer

Manual suggestions only (`writesLiveWeights: false`, `calibrationFeedbackEngine: false`, `appliesAutomatically: false`). Raw explorer paginated; small samples never hidden behind “needs more data.”

## 25. Legacy sections removed/merged

Tracked Slate Summary clutter, Gate/Loss Review, Upgrade/Demotion, Retro simulations, Reader TEST sections, PREMIUM/PLAYABLE calibration, legacy scorecard — removed from consumer Lab; useful signals merged into Decision-Path, Engine Scoreboard, Projection/Risk, Diagnosis, Raw Explorer.

## 26–27. Backfill / old-record compatibility

Pre-expansion records remain readable; expansion fields marked unavailable; no fabricated signals; pregameSnapshot never mutated.

## 28. Tests

```
npm run test:courtedge-lab-v2
→ 68 passed, 0 failed

npm run test:courtedge-engine-expansion
→ 85 passed, 0 failed

node scripts/testHistoryThreeSlateGroupsV1.js
→ 5 passed, 0 failed
```

## 29. App build

Prop Lab screen rewritten to consume `fetchCourtEdgeLabV2`; copy report uses `buildPropLabV2Report` on the same payload.

## 30. New SERVER_BUILD

`courteedge-lab-v2-three-slate-v1`

## 31–33. Commit / push / Render

See final message after deploy verification.

## 34–35. Live verification checklist

1. `/health` → `serverBuild: courteedge-lab-v2-three-slate-v1`  
2. `GET /courtedge/lab` returns `labV2` with 11 engine scorecards  
3. Prop Lab shows sections 1–15; no banned pick labels  
4. Copy report metrics match screen payload  
5. History three-slate membership matches Lab  

## 36. Rollback

```
git revert <commit>
git push orgin betbrain-v2-rebuild
```

Or redeploy prior commit `e440023` (`courteedge-engine-expansion-v1.1`).

## 37–42. Confirmations

| Rule | Status |
|---|---|
| No live weight writes | Confirmed (`writesLiveWeights: false`) |
| No Calibration Feedback Engine | Confirmed |
| No extra pick classifications | Confirmed (bannedLabels enforced; UI clean) |
| Three-slate rule intact | Confirmed (non-overlapping, frozen membership) |
| Best 6 / track-all-six unchanged | Confirmed (analysis-only Lab) |
| No sealed/history deletes | Confirmed (aggregates only; no mutate pregameSnapshot) |

---

## Locked product rules (unchanged)

Controlled Best 6, track-all-six, Results 6/6, TRACK display, LOW/MEDIUM/HIGH, same-team arbitration, sealed lines, Home selection — **not modified**.
