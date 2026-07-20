# CourtEdge Lab Stability Audit and Unavailable-Value Repair V1

**Date:** 2026-07-20  
**SERVER_BUILD:** `courteedge-lab-stability-audit-v1`  
**LAB_V2_BUILD:** `courteedge-lab-stability-audit-v1`  
**Branch:** `betbrain-v2-rebuild` · remote `orgin`  
**Prod:** `https://betbrain-server-1.onrender.com`  
**Prior:** `courteedge-lab-lifecycle-compat-v1` (76/76) → this build (86/86)

## 1. Executive summary

Lab unavailable-value defects are repaired end-to-end. Measured zeros stay zeros; missing evidence stays typed `MetricAvailability` with reasons (`UNINSTRUMENTED`, `INSUFFICIENT_COMPATIBLE_SLATES`, `MISSING_CLOSING_LINE`, `NO_ELIGIBLE_EVIDENCE`, …) and is formatted as `N/A` only at the presentation boundary. Live Prop Lab / Copy Report no longer emit raw `null`, false CLV `0` from live `currentLine`, or `—%` on engine rows. Lifecycle membership from the prior compat ship is preserved: default slate **2026-07-17** (6 props, 3-3-0), active **[2026-07-17] 1/3**, frozen previous **[2026-07-14, 2026-07-15, 2026-07-16]**, `writesLiveWeights=false`. **No weight or Calibration Feedback changes.**

## 2. Exact root causes found

1. **Copy Report / delta stringification** — `buildPropLabV2Report` interpolated `previous`/`current`/`difference` even when null → `Win rate Δ: prev null → cur null (null)`.
2. **False CLV zero** — `buildLabPropRecord` treated live `prop.currentLine` as closing evidence, so sealed≈current fabricated CLV `0`.
3. **Engine `—%`** — Copy Report did `` `${coveragePct ?? "—"}%` ``; screen used `—` via formatters without a shared availability contract.
4. **Incomplete-block deltas treated as numeric** — comparisons ran without a three-slate completeness gate (`INSUFFICIENT_COMPATIBLE_SLATES`).
5. **Self-comparison at 3/3** — when a complete active block was also appended to `frozenBlocks`, comparison used the last frozen entry (= itself).
6. **`record` field collision** — `enrichBlock` spread `buildRecordStats()` onto the block; the W-L-P string `record` overwrote the stats object, so `compareRecords(current.record || …)` read metrics from a string → `NO_ELIGIBLE_EVIDENCE`.

## 3. Why Lab needed repeated repairs (not one isolated bug)

Repeated issues came from **stacked contracts**: lifecycle selection, schema/era classification, persistence anchors, aggregate math, and two presentation surfaces (screen + Copy Report) evolved separately. Missing values were coerced at different layers (`|| 0`, `?? "—" + "%"`, stringifying null). Each prior ship fixed one slice; this audit adds a durable measured-vs-unavailable contract and regression fixtures A–I so the next lifecycle change cannot reintroduce consumer-facing lies.

## 4. Source-of-truth map

| Concern | Canonical owner | Presentation |
|--------|-----------------|--------------|
| Official prop membership | sealed Results / `immutableOfficial` + `isOfficialBestSixProp` | Lab lists |
| Default Lab slate | `resolveNewestCompletedOfficialSlateDate` in `courtEdgeLabV2.js` | Prop Lab header |
| Three-slate membership | `historyThreeSlateGroupsV2.js` store + `HISTORICAL_THREE_SLATE_ANCHORS` | active/previous blocks |
| Instrumentation | `classifyPropInstrumentation` / `classifySlateInstrumentation` | banners + scoreboards |
| Aggregates (W-L, CLV, engines) | `buildRecordStats`, `buildAllEngineScorecards`, `buildCompatibleDeltaMetric` | formatters |
| GET `/courtedge/lab` | `buildCourtEdgeLabV2` | JSON payload |
| Screen | `app/(tabs)/prop-lab.tsx` + `utils/labMetricFormat.ts` | UI |
| Copy Report | `utils/reportBuilders.ts` `buildPropLabV2Report` | clipboard text |

**One semantic payload** (`courtEdgeLabV2`); two formatters sharing `MetricAvailability` rules. No independent win-rate/CLV recalculation in the UI.

## 5. Lifecycle flow map

```
sealed Results cohort (graded official)
  → collectCompletedOfficialSlateDates
  → classifySlateInstrumentation (six-prop vs thin/legacy)
  → syncThreeSlateBlocksV2 (anchors + learningDates)
  → enrichBlock / buildRichComparison (gated deltas)
  → buildCourtEdgeLabV2
  → GET /courtedge/lab
  → Prop Lab screen + Copy Report (format only)
```

## 6. Schema / build compatibility map

| Class | Derivation | Lab treatment |
|-------|------------|---------------|
| Legacy / pre-expansion | no `courtEdgeEngineSignalsV1` | visible raw; excluded from instrumented scoreboards |
| Engine Expansion | sealed signals present | eligible for engine math |
| Uninstrumented slate | `instrumentedCount === 0` | `UNINSTRUMENTED` coverage/dir/CLV |
| Thin official (e.g. Jul 16) | propCount &lt; 6 | historical/legacy; not six-prop learning |
| Six-prop learning | propCount ≥ 6 | active track membership |
| Fully instrumented | all props sealed signals | scoreboard denominators |

Date fallback only when metadata absent (documented in prior compat report); classification prefers sealed evidence fields.

## 7. Missing-value and zero-value audit

| Path | Before | After |
|------|--------|-------|
| CLV via `currentLine` | false `0` | `MISSING_CLOSING_LINE` / `UNINSTRUMENTED` |
| Measured CLV `0` | could be confused with missing | `available:true, value:0` → `0.0` |
| Win-rate Δ at 1/3 | null stringified | `INSUFFICIENT_COMPATIBLE_SLATES` → `N/A` + note |
| Engine cov/dir no eligible | `—%` | `cov N/A · dir N/A` |
| Empty instrumented set | ambiguous 0/0/0 | `noEligibleEvidence` + exclusion counts |

## 8. Persistence / restart findings

- Store: `three-slate-blocks-v2.json` + anchors `[07-14,07-15,07-16]`.
- Restart simulation (Fixture G): default slate, frozen previous, active 1/3, unavailable metrics survive; no fabricated zero; no duplicate dates.
- Reset helper hardened against Windows `EPERM`/`ENOENT` on unlink during tests.

## 9. Screen vs Copy Report findings

Both consume the same `labV2` object. Shared presentation helpers:
- Server: `labMetricAvailability.js`
- App: `utils/labMetricFormat.ts`

Fixture H asserts parity (slate, W-L-P, blocks, CLV N/A, delta N/A, no raw null/`—%`).

## 10. Files changed

**Server**
- `services/labMetricAvailability.js` (new)
- `services/courtEdgeLabV2Helpers.js`
- `services/courtEdgeLabV2.js`
- `services/courtEdgeLabV2Constants.js`
- `services/historyThreeSlateGroupsV2.js`
- `scripts/testCourtEdgeLabV2.js`
- `server.js`
- `COURTEDGE_LAB_STABILITY_AUDIT_V1_REPORT.md` (this file)

**App**
- `app/(tabs)/prop-lab.tsx`
- `utils/labMetricFormat.ts` (new)
- `utils/reportBuilders.ts`

## 11. Functions changed (primary)

- `buildLabPropRecord` — CLV MetricAvailability; no `currentLine` as close
- `buildRecordStats` — `avgClvMetric`, `winRateMetric`, measured-only averages
- `buildAllEngineScorecards` / `emptyEngineCard` — coverage/dir availability + eligible counts
- `compareRecords` / `buildCompatibleDeltaMetric` — official three-slate gate
- `buildRichComparison` / `enrichBlock` — completeness gate; `recordStats`; no self-compare
- `deltaMetric` → `deltaMetricAvailability`
- `buildPropLabV2Report` / Prop Lab formatters — N/A presentation

## 12. New data contracts

```ts
type MetricAvailability =
  | { available: true; value: number; reason: null }
  | { available: false; value: null; reason: UNAVAILABLE_REASON };
```

Reasons include: `UNINSTRUMENTED`, `INSUFFICIENT_COMPATIBLE_SLATES`, `MISSING_OPENING_LINE`, `MISSING_CLOSING_LINE`, `MISSING_PROJECTION`, `MISSING_MARKET_SNAPSHOT`, `LEGACY_SCHEMA`, `NO_ELIGIBLE_EVIDENCE`, `NOT_APPLICABLE`, `INVALID_VALUE`, `INCOMPATIBLE_BUILD_ERA`.

Engine cards expose `instrumentedEligibleCount`, `uninstrumentedExcludedCount`, `coverage`, `directionalAccuracyMetric`, `noEligibleEvidence`.

## 13. Tests added

Fixtures A–I as cases **77–85**, plus helper case **86** (MetricAvailability). Existing 1–76 retained.

## 14. Complete test results

```
npm run test:courtedge-lab-v2
→ 86 passed, 0 failed
```

## 15. Commit hashes

_Filled after ship — see git log on `betbrain-v2-rebuild`._

## 16. Deployment result

_Filled after Render deploy of `courteedge-lab-stability-audit-v1`._

## 17. Live endpoint verification

_Filled after `GET /health` + `GET /courtedge/lab`._

## 18. Live screen / Copy Report verification

Expected consumer wording (equivalent OK):

```
Current slate: 2026-07-17 · 3-3-0 (50%)
Active three-slate: 1/3 · 2026-07-17
Previous block: 2026-07-14 · 2026-07-15 · 2026-07-16
|proj err| N/A
CLV N/A
Win rate Δ: N/A
Comparison available after 3 compatible completed slates.
cov N/A · dir N/A   (not —%)
```

## 19. Remaining limitations

- Jul 17 remains uninstrumented until a future sealed expansion slate ships signals — by design, not fabricated.
- Jul 19 still absent until an official sealed Results six-prop cohort exists.
- Cross-era win-rate deltas become available only when both blocks are complete 3/3 with graded denominators; engine deltas additionally require instrumented eligible counts.
- Frontend Expo client must be rebuilt/published separately for UI formatter changes; API payload is already self-describing for any client that reads `*Metric` fields.

## 20. Weights confirmation

**Confirmed:** no production weight files changed; `writesLiveWeights=false`; `calibrationFeedbackEngine=false`; no Calibration Feedback Engine created; adjustment suggestions remain manual-only.

---

## Required audit questions (evidence)

### 1. How many sources of truth?

**Answer:** One semantic builder (`buildCourtEdgeLabV2` + three-slate V2 store). Lifecycle membership is owned by `historyThreeSlateGroupsV2.js`. Presentation is dual (screen + Copy Report) but must not recalculate. Persisted snapshots/bundles are inputs, not alternate math.

### 2. Where missing → 0/50/false/%/delta incorrectly?

- CLV: `currentLine` fallback in `buildLabPropRecord` (fixed).
- Copy Report: null interpolation + `—%` (fixed).
- Deltas: ungated incomplete blocks + `record` string collision (fixed).
- Engine cards: attaching `%` to nullish coverage (fixed).

### 3. Why wrong slate previously; repaired selector?

Prior: Lab fell back to three-slate active tail / ignored `immutableOfficial` under `TEST` (compat V1). Now: `resolveNewestCompletedOfficialSlateDate` prefers newest completed official (verified tests 70, 77, 85).

### 4. Legacy classification model

`classifyPropInstrumentation` / `classifySlateInstrumentation` from sealed signals + prop counts; thin Jul 16 → legacy; six-prop → learning eligibility.

### 5. Can legacy contaminate engine scoreboards?

**No** for primary boards (`instrumentedOnly: true`, `filterInstrumentedRecords`). Raw explorer still shows legacy rows. Fixture E.

### 6. Frozen blocks immutable?

Yes — store + `HISTORICAL_THREE_SLATE_ANCHORS`. Fixture F. Active appends until 3; Jul 17 not moved into previous.

### 7. Restart/recovery alter semantics?

Simulated restart Fixture G: semantics preserved; unavailable stays unavailable; no zero injection.

### 8. Copy Report same semantic payload?

Yes — `buildPropLabV2Report({ labV2 })` formats the same object. Fixture H + shared formatters.

---

## Confirmed / Contributing / Not involved

| Factor | Classification | Evidence |
|--------|----------------|----------|
| Legacy schema debt | **Confirmed root cause** | Uninstrumented Jul 17; missing sealed close/signals → false zeros / empty scoreboards |
| Missing build metadata | **Contributing factor** | Era splits help, but Jul 17 lacks sealed expansion metadata |
| Multiple sources of truth | **Confirmed root cause** | Screen vs Copy Report independent formatting; `record` object/string collision |
| Serialization defaults | **Contributing factor** | null JSON fields stringified in Copy Report |
| Frontend formatting | **Confirmed root cause** | `—` / `%` attachment without availability |
| Copy Report formatting | **Confirmed root cause** | Defect 1 & 3 live output |
| Lifecycle selection | **Not involved** (this ship) | Already repaired in compat V1; preserved |
| Frozen-block logic | **Contributing factor** | Self-compare at trailing 3/3; anchors otherwise sound |
| Restart persistence | **Not involved** as primary defect | Restart preserves; not the null/CLV/% bugs |
| Insufficient fixtures | **Confirmed root cause** | Prior suite lacked A–I unavailable/zero/parity cases |

---

## Autonomy trail

Inspect → implement MetricAvailability + formatters → tests 86/86 → commit → push `orgin` → Render deploy → live verify → this report.
