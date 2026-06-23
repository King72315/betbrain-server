# COURTEDGE WNBA ENGINE BUILD REPORT

**Branch:** `betbrain-v2-rebuild`  
**Date:** 2026-06-23  
**Scope:** CourtEdge WNBA v2 engine only — NBA path untouched

---

## Phase 1 — Inspection Summary

### Shared NBA/WNBA code (before split)

| Module | Role | WNBA touch |
|--------|------|------------|
| `server.js` `buildPicksForDay` | Main pick pipeline | WNBA used same `compareOverUnderRisk` + v1 `sideSelectionEngine` branch |
| `winProbabilityEngine.js` | Over/Under probability | Shared |
| `riskComparisonEngine.js` | Side risk scoring | Shared (WNBA now bypassed when v2 on) |
| `fairLineEngine.js` | Fair line model | Shared — used inside v2 data card |
| `sideSelectionEngine.js` | WNBA v1 side/tracking | Legacy path when `COURTEDGE_WNBA_V2=false` |
| `playerStateBuilder.js` | Player state card | Shared |
| `ballService.js` | BDL stats + `findBallPlayer` | WNBA uses WNBA API base |
| `wnbaOfficialEngine.js` | Official eligibility gates | Still applied post-v2 for tracking |

### Split plan implemented

```
betbrain-server/engines/wnba/
  wnbaPlayerPropDataCard.js   — buildWnbaPlayerPropDataCard(pick, context)
  wnbaReaderEngine.js         — readWnbaProp(dataCard) → side + OFFICIAL/TEST/NO_BET
  wnbaProjectionEngine.js     — projectWnbaPoints() volume-first
  wnbaDecisionEngine.js       — evaluateWnbaPropDecision() orchestrator
```

**Routing:** `league === "WNBA" && isCourteEdgeWnbaV2Enabled()` → `evaluateWnbaPropDecision()` then `continue` (skips shared riskComparison path). NBA loop body unchanged.

**Philosophy:** Reader decides via data volume path, role, fair line disagreement, and `dataConfidenceScore` — not by blocking LEAN/WATCHLIST tiers.

---

## Phase 2–6 — Implementation

- **Data card:** playerId from `findBallPlayer`, market lines, season/last5 volume stats, role/injury/defense/game environment, `dataMissingFlags[]`, honest `dataConfidenceScore`
- **Reader:** volume path (low-line 5.5 context), role stability, hot-shooting vs volume scoring, fair line agree/disagree, market movement, teammate usage, environment
- **Projection:** `expectedMinutes × FGA/FTA efficiency` blended with season/recent anchors
- **Wire:** `engineHandled: "WNBA_V2"` on picks; config `COURTEDGE_WNBA_V2` (default on)

---

## Backup

- **Path:** `betbrain-server/backups/2026-06-23T05-59-59-613Z-pre-wnba-v2-engine-build/`
- **Reason:** `pre-wnba-v2-engine-build`
- **Files:** tracked-props, daily-slate-reports, pick-history, pick-analytics, locked-slates, slate-snapshots, history-archive

---

## Lab / 06-22 safety

| Check | Result |
|-------|--------|
| 06/21 Lab bundle | **SAFE** — `lab-bundles/2026-06-21/manifest.json`: 14 props, 5-9-0, 14 graded |
| 06/22 runtime mutation | **NONE** — code-only changes; no tracked-props/locked-slates writes |
| Local tracked-props 06/21 | 0 props (empty local slate; prod bundle frozen separately) |

---

## Changed files (code only)

| File | Change |
|------|--------|
| `engines/wnba/wnbaProjectionEngine.js` | **NEW** |
| `engines/wnba/wnbaPlayerPropDataCard.js` | **NEW** |
| `engines/wnba/wnbaReaderEngine.js` | **NEW** |
| `engines/wnba/wnbaDecisionEngine.js` | **NEW** |
| `server.js` | WNBA v2 branch + import (NBA block unchanged) |
| `config.js` | `COURTEDGE_WNBA_V2` flag |
| `scripts/testWnbaDataCard.js` | **NEW** |
| `COURTEDGE_WNBA_ENGINE_BUILD_REPORT.md` | **NEW** |

---

## Test results

Run: `node betbrain-server/scripts/testWnbaDataCard.js`

```
✓ volume-first projection
✓ low-line Over 5.5
✓ role rising case
✓ fair-line disagreement → TEST/NO_BET
✓ missing playerId lowers confidence
✓ NBA pick shape has no engineHandled (WNBA-only field)
All WNBA v2 data card tests passed.
```

Also: `node betbrain-server/scripts/testWnbaOfficialV1.js` — 6/6 passed (v1 regression).

## NBA behavior touched

**No** — NBA logic path in `buildPicksForDay` is identical. Proof:

1. WNBA v2 branch is guarded: `if (league === "WNBA" && isCourteEdgeWnbaV2Enabled()) { ... continue; }`
2. All existing NBA code (`compareOverUnderRisk`, `getTier`, etc.) runs only when guard is false (i.e. `league !== "WNBA"`)
3. Unit test asserts NBA picks have no `engineHandled` field

To disable v2 and restore legacy WNBA path: `COURTEDGE_WNBA_V2=false`
