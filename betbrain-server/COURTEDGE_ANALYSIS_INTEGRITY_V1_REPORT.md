# CourtEdge Analysis Integrity V1 Report

**SERVER_BUILD:** `courteedge-analysis-integrity-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Remote:** `orgin`  
**Date:** 2026-07-19  
**Prior builds:** `courteedge-empty-board-guard-v1`, `courteedge-home-completion-tomorrow-six-v1`, `courteedge-home-detailed-analysis-side-calibration-v1`

---

## Scope

Focused repair after full slates + evidence hydration were restored. **No changes** to live calibration weights, Best 6 selection rules, Lab V2 / three-slate, sealed Jul 17 rewrite, clear-tracked-props, or side quotas.

## Single confidence / risk owner

**Owner (documented in code):**  
`courtEdgeDecisionPacketV1.finalConfidence|trueRisk → pick.finalConfidence|displayTrueRisk (sealed)`  
with sealed `homeDetailedAnalysisV1.canonical` winning once sealed.

| Surface | Source |
|---------|--------|
| Home compact card | `canonical.confidence` / `canonical.risk` (synced onto `pick.confidence` + `displayTrueRisk`) |
| Detailed Analysis | `canonical` + `finalDecision.finalConfidence/finalRisk` |
| Copy Report | Same analysis payload fields |
| Top ranking display | Same conf/risk; transparency adds score-vs-next / supports / concerns only |

Competing trails (`riskLabel`, `winProbability`) no longer drive consumer display. `attachHomeDetailedAnalysisV1` stamps the same values onto pick + analysis.

## Zero-default poisoning

- Missing minutes / FGA / FTA / hit rates / defense / pace stay `null` + `UNAVAILABLE` wrappers.
- `nonNegativeVolume` / `measuredField` reject synthetic zeros when sample is empty.
- Evidence `sanitizeEvidencePacket` scrubs zero-poison role/projection fields.

## Leïla Lacan / accented identity

- `normalizePersonName` / `normalizePlayerJoinKey` fold accents (Leïla → leila).
- Invalid packets (identity mismatch, all-zero L5, negative volume, fake-complete coverage) are **rejected and rebuilt** via `rejectOrRebuildEvidencePacket`.
- Rebuild forces `oddsPlayerName` from pick player so accented names do not keep a wrong join identity.

## Negative volume

Expected/actual minutes, FGA, FTA, usage: negatives → `null` / `INVALID_NEGATIVE` / display “Unavailable”.

## Raw codes / gate language

Consumer Home Why + Copy Report scrub `BOARD_ONLY`, `NO_DECISIVE_RESCUE`, `UNDER_GAP_BELOW_*`, `DANGER_STACK_*`, “danger gate”, “gap floor”, etc. Readable sentences only. Raw codes remain in diagnostics / Lab.

## Rounding

- Confidence % → integer  
- Stats / lines / gaps / averages → 1 decimal  
- Hit-rate fractions → 3 decimals  

## Matchup history

Up to **last 3** matchups with points / minutes / FGA / FTA / line result. Real sample only; no zero padding. UI + Copy Report list Matchup 1..N.

## Market + Top transparency

- Market: `WITH` / `NEUTRAL` / `AGAINST` / `UNAVAILABLE` with explanation; opening / sealed / current distinct; **UNAVAILABLE ≠ AGAINST**.
- Top: rank, reason, score-vs-next margin, supports/concerns; **does not rewrite** conf/risk.

## Files changed

| File | Role |
|------|------|
| `services/courtEdgeAnalysisIntegrityV1.js` | **NEW** owner + validate/rebuild + rounding + Top transparency |
| `services/courtEdgeHomeDetailedAnalysisV1.js` | Wire integrity; matchups; scrub; sync trails |
| `engines/topProps/homeReasonTextV1.js` | Broader code scrub / translations |
| `components/PropCard.tsx` | Canonical conf/risk; full matchup list; rounding |
| `utils/controlledBestSixDisplay.js` | Copy Report conf/risk + matchups + scrub |
| `server.js` | `SERVER_BUILD` → `courteedge-analysis-integrity-v1` |
| `package.json` | `test:courtedge-analysis-integrity` |
| `scripts/testCourtEdgeAnalysisIntegrityV1.js` | **NEW** 18 tests |
| `scripts/testCourtEdgeHomeDetailedAnalysisSideCalibrationV1.js` | Packet-owns-risk assertions |
| `scripts/testCourtEdgeHomeCompletionTomorrowSixV1.js` | SERVER_BUILD lock |

## Tests

| Suite | Result |
|-------|--------|
| `test:courtedge-analysis-integrity` | **18/18** |
| `test:courtedge-home-analysis-calibration` | **84/84** (+7 regression imports) |
| `test:courtedge-home-completion` | **80/80** |
| `test:courtedge-best6-repair` | **44/44** |

## Deploy / verify

1. Push `betbrain-v2-rebuild` → `orgin`
2. Wait for Render deploy of `courteedge-analysis-integrity-v1`
3. `POST /refresh-picks?wait=1&scope=all`
4. Spot-check Best 6: conf === analysis.canonical.confidence; risk === analysis.canonical.risk; no raw codes in Why/Copy; matchups ≤3; market UNAVAILABLE not AGAINST
5. If Lacan (or any accented name) is on slate: evidence packet valid or rebuilt; no zero-poison / negative volume display

## Confirmations

| Constraint | Status |
|------------|--------|
| No live weight writes | CONFIRMED |
| No Best 6 rule changes | CONFIRMED |
| No Lab V2 / three-slate changes | CONFIRMED |
| No sealed Jul 17 rewrite | CONFIRMED |
| No clear-tracked-props | CONFIRMED |
| No side quotas | CONFIRMED |
