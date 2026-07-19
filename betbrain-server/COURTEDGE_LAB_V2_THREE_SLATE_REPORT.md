# CourtEdge Lab V2 + Three-Slate — Consolidation Report

**Date:** 2026-07-18  
**SERVER_BUILD:** `courteedge-lab-v2-three-slate-v1`  
**Lab schema:** `courtEdgeLabV2`  
**Three-slate version:** `history-three-slate-groups-v2`  
**Prior production build:** `courteedge-engine-expansion-v1.1`  
**Branch:** `betbrain-v2-rebuild` · remote `orgin`

## Verdict

Consumer Prop Lab is rebuilt as one authoritative learning/calibration system. Server aggregates sealed evidence into `courtEdgeLabV2` once; Prop Lab UI and copy report consume the same payload. Three-slate blocks are non-overlapping and frozen. Lab is analysis-only — no live weight writes, no Calibration Feedback Engine, no Best 6 / TRACK / seal mutations.

---

## 1. Current Lab root-cause and clutter audit

**Root causes**
- Engine Expansion V1.1 sealed `courtEdgeEngineSignalsV1` + `courtEdgeDecisionPacketV1`, but consumer Lab never rendered them.
- Daily reports mixed legacy gate/TEST/PREMIUM sections with official Best 6 learning.
- Three-slate grouping existed (V1) but Lab did not show active progress / full comparison metrics.
- Copy report and screen did not share one Lab calculation.

**Clutter removed/merged from consumer Lab**
- Tracked Slate Summary with legacy/nonselected/test categories
- WNBA v2 Gate / Loss Review (standalone)
- Upgrade/Demotion Review
- Side Rescue / Decision Intelligence Retro Simulation (standalone)
- Reader Official Demoted TEST / Reader Uncertain TEST
- PREMIUM/PLAYABLE / Legacy Calibration / raw gate counts
- Duplicated risk/projection sections and pre-expansion Engine Scorecard

Useful signal content is merged into Decision-Path Accuracy, Engine Expansion Scoreboard, Projection/Confidence/Risk, Miss/Win Diagnosis, and Raw Signal Explorer.

---

## 2. Existing files/services inspected

- `app/(tabs)/prop-lab.tsx`
- `utils/reportBuilders.ts`, `services/api.ts`
- `services/historyThreeSlateGroupsV1.js`
- `services/dailySlateReportService.js`, `officialLearningRecordBuilder.js`
- `services/labAggregateBreakdown.js`, `labLearningEnrichmentService.js`, `labMeasuredFields.js`
- `services/courtEdgeEngineSignalsV1.js`, `engines/courtEdgeExpansion/*`
- `COURTEDGE_ENGINE_EXPANSION_V1_REPORT.md`
- `server.js` Lab/history/daily-report routes
- Local `tracked-props.json` (legacy seals without expansion → unavailable, not fabricated)

---

## 3. Files changed

**New**
- `betbrain-server/services/courtEdgeLabV2.js`
- `betbrain-server/services/courtEdgeLabV2Helpers.js`
- `betbrain-server/services/courtEdgeLabV2Constants.js`
- `betbrain-server/services/historyThreeSlateGroupsV2.js`
- `betbrain-server/scripts/testCourtEdgeLabV2.js`
- `betbrain-server/data/three-slate-groups-v2.json` (runtime membership store)
- `betbrain-server/COURTEDGE_LAB_V2_THREE_SLATE_REPORT.md`

**Modified**
- `betbrain-server/server.js` — `SERVER_BUILD`, `/courtedge/lab`, Lab V2 on daily reports / history
- `betbrain-server/services/dailySlateReportService.js` — attach `report.labV2`
- `betbrain-server/package.json` — `test:courtedge-lab-v2`
- `app/(tabs)/prop-lab.tsx` — full Lab V2 screen order
- `services/api.ts` — `fetchCourtEdgeLabV2`, labV2 on daily reports
- `utils/reportBuilders.ts` — `buildPropLabV2Report`

---

## 4. Final Lab V2 schema

```
courtEdgeLabV2: {
  version, generatedAt, buildVersion,
  currentSlate,
  activeThreeSlateBlock,
  previousThreeSlateBlock,
  threeSlateComparison,
  overallSummary,
  officialBestSixResults,
  perPropPackets,
  engineScorecards,
  decisionPathAnalysis,
  projectionCalibration,
  confidenceCalibration,
  riskCalibration,
  marketLineAnalysis,
  roleVolumeAnalysis,
  opponentGameContextAnalysis,
  sameTeamAnalysis,
  outcomeDiagnosis,
  adjustmentReview,
  rawSignalExplorer,
  allTimeContext,
  threeSlateGroups, meta,
  analysisOnly, writesLiveWeights, calibrationFeedbackEngine
}
```

Authoritative endpoints:
- `GET /courtedge/lab`
- `GET /courtedge/lab/:slateDate`
- `report.labV2` on daily slate report build
- Also embedded on `GET /daily-slate-reports`

---

## 5. Final Prop Lab screen order

1. Current Completed Slate Summary  
2. Three-Slate Improvement Block  
3. Official Best 6 Results  
4. Per-Prop Learning Packets (5 layers)  
5. Engine Expansion Scoreboard (11 engines)  
6. Decision-Path Accuracy  
7. Projection and Fair-Line Calibration  
8. Confidence and Risk Honesty  
9. Market and Line Performance  
10. Role / Volume / Distribution / Volatility  
11. Opponent and Game Context  
12. Miss and Win Diagnosis  
13. Adjustment Review (manual only)  
14. Raw Signal Explorer (paginated)  
15. All-Time Context  

---

## 6. Daily overall summary design

Official Best 6 only: slate date, league coverage, props, graded/pending, W-L-P, win rate/accuracy, avg margin, projection error / |error|, CLV, Top / Over / Under / NBA / WNBA. No legacy/TEST/BOARD_ONLY/NO_BET counts.

---

## 7–10. Three-slate grouping, membership, comparison

- Non-overlapping blocks: A-B-C then D-E-F  
- Persist frozen membership in `data/three-slate-groups-v2.json`  
- Active progress `1/3`, `2/3`, `3/3 — Block Complete`  
- On third complete: freeze, compare to previous frozen, archive for History, next slate starts new block  
- Never regroup frozen membership  
- Lab + History share `buildHistoryThreeSlateGroupsV2`  
- Comparison includes W-L-P, win rate, margins, projection errors, CLV, Over/Under, NBA/WNBA, risk, Top/non-Top, organic vs same-team, Flip-First, Side Rescue, per-engine directional/coverage deltas  

---

## 11–13. Engine scoreboard + attribution

Always show all 11 engines. Separate **directional** vs **calibration** performance.

**Directional:** aligned+won→helped; aligned+lost→hurt; opposed+won→hurt; opposed+lost→helped; unavailable/zero→neutral (not a directional loss).

**Calibration:** confidence/risk adjustments vs outcome honesty; volatility/fatigue/dedup are calibration-oriented, not automatic Under votes.

---

## 14. Per-prop learning packet design

Five layers: Freeze → Pregame Engine Evidence (11) → Decision Path → Postgame Truth → Diagnosis. Freeze never rewritten by diagnosis.

---

## 15–22. Calibration / market / role / opponent / same-team / diagnosis designs

Implemented as scoped blocks (`currentSlate` / `activeThreeSlateBlock` / `previousThreeSlateBlock`) with NBA/WNBA kept separate. Unavailable defense is not neutral 50. True pace ≠ scoringEnvironmentProxy.

---

## 23–24. Adjustment review + Raw Signal Explorer

Manual suggestions only (`appliesAutomatically: false`, `writesLiveWeights: false`, `calibrationFeedbackEngine: false`). Raw explorer paginated; small samples never hidden behind “needs more data.”

---

## 25. Legacy sections removed or merged

See §1. Underlying sealed/learning data preserved.

---

## 26–27. Backfill / old-record compatibility

Pre-expansion records remain readable; expansion fields marked unavailable; no fabrication; pregameSnapshot not mutated; aggregates/diagnosis may refresh on rebuild.

---

## 28. Tests

```
npm run test:courtedge-lab-v2
→ 68 passed, 0 failed (cases 1–67 + calibration helper)

npm run test:courtedge-engine-expansion
→ 85 passed, 0 failed

node scripts/testHistoryThreeSlateGroupsV1.js
→ 5 passed, 0 failed
```

---

## 29. App build

Prop Lab screen rewritten to consume Lab V2 (`app/(tabs)/prop-lab.tsx`). Copy report via `buildPropLabV2Report` (same `courtEdgeLabV2` payload). Minor TS API alignment: `requireLikelyFinished` / `forceRebuild` / `CopyReportButton.getReportText`.

---

## 30–33. SERVER_BUILD / commit / push / Render

| Item | Value |
|---|---|
| SERVER_BUILD | `courteedge-lab-v2-three-slate-v1` |
| Implementation commit | `213d1ce` |
| Deploy doc commit | `c64fa2d` |
| Push | `orgin/betbrain-v2-rebuild` |
| Render | live — auto-deploy from branch |

---

## 34–35. Live verification checklist

1. `/health` → `serverBuild: courteedge-lab-v2-three-slate-v1` ✅  
2. `GET /courtedge/lab` → `labV2.version=courtEdgeLabV2`, **11 engines**, `writesLiveWeights=false` ✅  
3. Prop Lab sections 1–15 consume Lab V2; banned labels excluded from consumer payload ✅  
4. Copy report uses same `labV2` payload as screen ✅  
5. History three-slate membership via shared V2 builder ✅  
6. No historical sealed deletes/rewrites ✅  

---

## 36. Rollback

```
git revert 213d1ce
# or redeploy prior build
SERVER_BUILD=courteedge-engine-expansion-v1.1
```

---

## 37–42. Confirmations

| Confirmation | Status |
|---|---|
| 37. No live weights changed | **YES** — Lab analysis-only |
| 38. No Calibration Feedback Engine | **YES** |
| 39. No extra pick classifications | **YES** — banned list enforced |
| 40. Three-slate rule intact | **YES** — V2 frozen non-overlapping |
| 41. Full Best 6 + track-all-six unchanged | **YES** |
| 42. No sealed/history deletes or rewrites | **YES** — consume sealed only |

---

## Deploy proof (2026-07-19 UTC)

| Check | Result |
|---|---|
| `/health` serverBuild | `courteedge-lab-v2-three-slate-v1` |
| `GET /courtedge/lab` | ok · `labV2Build=courteedge-lab-v2-three-slate-v1` |
| Engines on scoreboard | **11/11** |
| writesLiveWeights | `false` |
| calibrationFeedbackEngine | `false` |
| Active block (live) | `2026-07-16` (1/3 progress on next after prior freeze) |
| Previous block (live) | `2026-07-08`, `2026-07-14`, `2026-07-15` |
| Local Lab V2 suite | **68/68** |
| Engine expansion suite | **85/85** |
| History three-slate V1 suite | **5/5** |
