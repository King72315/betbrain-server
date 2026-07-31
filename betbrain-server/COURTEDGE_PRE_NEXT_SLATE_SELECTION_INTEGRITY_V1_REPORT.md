# CourtEdge Pre-Next-Slate Selection Integrity V1

**Date (CT):** 2026-07-30 / 2026-07-31  
**SERVER_BUILD:** `courteedge-pre-next-slate-selection-integrity-v1`  
**CONTROLLED_BEST_SIX_VERSION:** `controlled-best-six-selection-integrity-v1`  
**Integrity module:** `best-six-selection-integrity-v1`  
**Branch:** `betbrain-v2-rebuild` · remote `orgin`

## Verdict

Jul 29/30 postmortem lessons are encoded as **hard Best 6 eligibility gates** that run **before** repair/ranking bonuses. Unsupported same-team forced Unders are **dropped** (not auto-flipped). Historical sealed Official membership for Jul 29 and Jul 30 was **not mutated**. Quality beats filling six slots.

---

## 1. Files changed

| File | Change |
| --- | --- |
| `engines/topProps/bestSixSelectionIntegrityV1.js` | **NEW** — eligibility, arbitration helpers, conflict risk recalibration, simulation |
| `engines/topProps/controlledBestSixSelector.js` | Integrity gate before diversity; admission refuses hard exclusions; version bump |
| `engines/wnba/playerIntelligence/sameTeamOpportunityEngineV2.js` | Drop unsupported forced Unders; organic-only flip; HIGH risk on forced keep |
| `engines/decisionIntelligence/propDecisionIntelligenceV1.js` | `NO_DECISIVE_RESCUE` cannot promote; material conflicts block Low Risk |
| `engines/courtEdgeExpansion/distributionEngine.js` | Explicit `Over hit rate` / `Under hit rate` wording |
| `server.js` | `SERVER_BUILD` bump |
| `scripts/testBestSixSelectionIntegrityV1.js` | **NEW** — acceptance tests 1–10 |
| `scripts/testControlledBestSix.js` | Version + same-team Top-2 test alignment |
| `scripts/testCourtEdgeBestSixPlayablePoolRepairV1.js` | Version string acceptance |

**Not touched:** Lab lifecycle, three-slate blocks, Results grading, sealed Jul 29/30 membership, points-only scope, track-all-six after seal, providers, storage keys.

---

## 2. Exact eligibility / arbitration logic

**Order (matches required implementation order):**

1. Validate core fields / playable pool (existing)
2. Organic side already on candidate
3. Projection edge + Best Prop score (existing scorer, then integrity reads them)
4. **Hard exclusions** (`evaluateBestSixSelectionIntegrity`)
5. Role / volatility / shadow / projectionSanity vetoes (inside integrity)
6. Same-team arbitration (V2): keep primary Over; re-eval secondary as Under; **keep only if independently qualifies**; else **DROP**
7. Dropped secondaries leave a slot for next eligible unique candidate
8. Repair/ranking bonuses only on integrity-accepted props
9. Diversity rank → Best 6 (may be **&lt; 6**)
10. Top 2 from Best 6; forced/unsupported sides blocked from Top Pick
11. Seal path unchanged for already-sealed history

**Hard exclusions (canonical primary reason prefix `REJECTED_BEST_6 — …`):**

- `NO_DECISIVE_RESCUE`
- `BEST_PROP_SCORE_BELOW_50`
- `BEST_PROP_SCORE_BELOW_60` / `BEST_PROP_SCORE_50_59_BLOCKED:…`
- `SUB_FLOOR_UNDER_EDGE` (Under edge &lt; 1.5)
- `THIN_UNDER_LACKS_CORROBORATION` (edge 1.5–3.49 needs ≥2 directional confirms)
- `THIN_UNDER_SHADOW_PASS` / `THIN_UNDER_SHADOW_OVER`
- `UNDER_GAP_BELOW_FLOOR`
- `BOARD_ONLY_UNSTABLE_VOL_ROLE_SANITY` (Morrow four-condition stack)
- `UNSTABLE_VOL_ROLE_STACK` (≥3 of 4 + edge &lt; 3.5)
- `DANGER_STACK_BOARD_ONLY_BLOCK`
- `FORCED_UNDER_SHADOW_OVER`
- `UNSUPPORTED_FORCED_UNDER`
- `NEGATIVE_EDGE_SHADOW_OPPOSES`

**Directional confirmations allowed for thin Unders:** roleVelocity Under, defensiveArchetype Under, distribution Under, matchup shadow Under (not early 1–2 sample only), stable low-volume role Under, shot-volume trend Under.

**Not confirmations:** availability active, neutral market, multi-book, quality-gate object, environment object, repair labels.

---

## 3. Thresholds

| Rule | Value |
| --- | --- |
| Under hard block | edge &lt; **1.5** |
| Under corroboration band | **1.5 – 3.49** (need ≥2 confirms) |
| Under normal | edge ≥ **3.5** |
| Best Prop normal floor | **≥ 60** |
| Best Prop fill band | **50 – 59.99** only if `allowFillCandidates` and no hard conflicts |
| Best Prop hard reject | **&lt; 50** |
| Volatility elevated CV | **≥ 0.55** (Morrow ~0.91) |
| Forced Under risk | **HIGH** when kept |
| Conflict conf haircut | **4 + 3×conflicts** (cap 18), floor conf 35 |
| Material conflict | never **Low Risk** |

---

## 4–6. Before/after simulation (sealed snapshots, read-only)

Simulation applies new rules to **stored** sealed Official props. Live selection recalculates `bestPropScore` via `scoreCandidate`; stored scores can be post-penalty and lower than selection-time.

### July 29 Official Best 6

| # | Sealed (BEFORE) | AFTER | Why |
| --- | --- | --- | --- |
| 1 | Arike Ogunbowale OVER 13.5 | **KEEP** | Clean eligible |
| 2 | Rhyne Howard UNDER 17.5 | **KEEP** | Eligible |
| 3 | Veronica Burton UNDER 12.5 | **REJECT** | Score 50–59 + under-gap floor + shadow opposes / thin Under |
| 4 | Paige Bueckers UNDER 20.5 | **REJECT** | Score &lt;50 + thin/danger/forced issues |
| 5 | Kahleah Copper UNDER 18.5 | **REJECT** | `NO_DECISIVE_RESCUE` + score 5.8 + edge 0.2 |
| 6 | Alyssa Thomas UNDER 13.5 | **REJECT** | Score 0 + unsupported forced Under (organic Over) |

**Would select ~2** (Arike, Rhyne). Copper/Thomas/Burton are the intended preventable failures.

### July 30 Official Best 6

| # | Sealed (BEFORE) | AFTER | Why |
| --- | --- | --- | --- |
| 1 | Kayla McBride OVER 17.5 | **KEEP** | Strong Over remains eligible; conflicts → not Low Risk at recalibration |
| 2 | Aneesah Morrow UNDER 12.5 | **REJECT** | Danger-stack BOARD_ONLY + unstable + high vol + roleVelocity Over |
| 3 | Chelsea Gray OVER 12.5 | REJECT* | Stored score &lt;50 on snapshot (*live scorer would typically clear Gray-type profile — unit Test 6 passes) |
| 4 | Olivia Miles UNDER 17.5 | **REJECT** | Unsupported forced Under / score / thin — Miles win = policy-dependent, not a reason to keep auto-force |
| 5 | Natasha Cloud UNDER 11.5 | **REJECT** | Thin Under / `NO_DECISIVE_RESCUE` / score — 0.5 win does not validate thin Unders |
| 6 | Marina Mabrey UNDER 21.5 | **REJECT** | Snapshot score/`NO_DECISIVE_RESCUE` — decision-path Under still learnable; not a fill license |

**Preventable failure emphasized:** Morrow.

---

## 7. Historical immutability

- No writes to sealed Jul 29/30 Official membership
- `daily-slate-reports` Jul 30 remains **4-2-0** with same six official IDs
- Simulation left `excludedFromOfficialBestSix` **undefined** on original sealed objects
- Lab / three-slate / History untouched

---

## 8. Test results

```
node scripts/testBestSixSelectionIntegrityV1.js
→ 10 passed, 0 failed
```

| # | Case | Result |
| --- | --- | --- |
| 1 | Copper-type | PASS — excluded; repair labels ignored |
| 2 | Thomas-type forced Under | PASS — unsupported |
| 3 | Burton-type shadow PASS | PASS — excluded |
| 4 | Morrow-type danger stack | PASS — cannot promote |
| 5 | McBride-type conflicts | PASS — eligible, not Low Risk |
| 6 | Gray-type clean Over | PASS — eligible |
| 7 | Thin Under + corroboration | PASS — eligible with warning |
| 8 | Insufficient candidates | PASS — short slate, no force |
| 9 | Distribution wording | PASS — Over 20% / Under 80% |
| 10 | Historical immutability sim | PASS |

`testControlledBestSix.js` version assertion updated; Top-2 same-team case aligned with integrity demotion behavior.

---

## 9. Restart / persistence

- `SERVER_BUILD` + `CONTROLLED_BEST_SIX_VERSION` bumped → picks cache rejects stale previous-build packets (existing `cacheFresh` contract)
- Deploy/restart picks up new selector without rewriting sealed history
- Integrity debug attached on candidates as `bestSixSelectionIntegrity` / audit `selectionIntegrity`

---

## 10. Next-slate dry-run

Local tracked/active-bundles: **no 2026-07-31 Official candidates**.  
When the next WNBA slate builds, selection will:

1. Filter through integrity
2. Drop unsupported same-team forced Unders
3. Return **fewer than six** if needed — no BOARD_ONLY / `NO_DECISIVE_RESCUE` fill

---

## Do-not-chase principles preserved

- Gray clean Over → full learning credit (Test 6)
- McBride loss → confidence/risk recalibration only, Over profile not banned (Test 5)
- Miles forced Under win → policy-dependent; auto-force removed
- Cloud 0.5 win → does not validate thin Unders
- Mabrey Under → decision-path learning, not blowout dominance
- Morrow → unstable+vol+role conflict exclusions strengthened
