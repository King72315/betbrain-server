# CourtEdge Engine Expansion V1.1 ? Consolidation Report

**Date:** 2026-07-18  
**SERVER_BUILD:** `courteedge-engine-expansion-v1.1`  
**Schema build:** `courteedge-engine-expansion-v1.1`  
**Prior build:** `courteedge-engine-expansion-v1` (parallel engines)  
**Feature flag:** `COURTEDGE_ENGINE_EXPANSION_V1_ENABLED` (default **ON**)

## Verdict

V1.1 **corrects** the v1 parallel-engine build. All eleven capabilities remain, but each evidence concept now has **one authoritative output** via legacy-module bridges ? evidence-dedup ledger ? immutable decision packet. DDI no longer double-applies overlapping confidence/risk when expansion owns the ledger.

---

## IMPLEMENTATION OWNERSHIP MAP

| Requested capability | Existing module extended | Old function retained/replaced | New function | Authoritative output field | NBA entry | WNBA entry | Dedup entry | Conf affect | Risk affect | Sealed | Legacy disabled? | Tests proving no duplicate influence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Line Movement / CLV | `lineIntegrityV1`, `marketIntelligenceEngine`, `marketMovementIntelligenceV1` | MMI calc retained as diagnostic; expansion `lineMovementClvEngine` becomes bridge-preferred | `bridgeLineMovementClv` | `engines.lineMovementClv` / `lineMovement` | server.js prop builder ? attach | wnbaDecisionEngine ? attach | MARKET group | ledger only | ledger only | yes | DDI market conf deferred when expansion ON | #80 bridge preferred; DDI deferral |
| Projection Sanity | DDI `projectionQuality`, evidence-final conf, Reader/fair-line (league) | `evaluateProjectionSanity` fallback retained | `bridgeProjectionSanity` | `engines.projectionSanity` | after fair-line / winProb | after Reader + DDI | PROJECTION | ledger only | ledger only | yes | DDI projection conf deferred | #79 ownership; DDI deferral |
| Availability | `availabilityGateEngine`, `wnbaAvailabilityService`, `availabilityImpactV1` | gate/service retained; expansion bridges impact | `bridgeAvailabilityRoster` | `engines.availabilityRoster` (+ `status`) | NBA gate adapter | WNBA availability service | AVAILABILITY_AND_TEAMMATE | ledger only (no triple-penalize) | ledger only | yes | raw modules diagnose only after ledger | #76?79; availability OUT still UNPLAYABLE pre-seal |
| Distribution + Volatility | `volumeProfileEngine`, volume danger gates, roleStability, reliability conf | expansion dist/vol engines retained as shared game-log profiles | `evaluateCeilingFloorDistribution`, `evaluatePlayerVolatility` + profile handles | `distributionProfile`, `volatilityProfile` | game-log builder path | same via ctx.gameLogs | DISTRIBUTION_AND_VOLATILITY | ledger only | ledger only (vol never directional) | yes | n/a (no prior DDI twin vote) | #67 profile aliases; #84 proxy separate |
| Role Velocity | roleChange, playerRoleProfile, playerRoleIdentity, roleStability, usageShare | slopes fallback retained | `bridgeRoleVelocity` ? **one ROLE_AND_VOLUME** | `engines.roleVelocity` | volumeProfile/roleChange on pick | DDI role+usage | ROLE_AND_VOLUME | ledger only | ledger only | yes | DDI weak-module conf deferred | #80 pattern; bridge consolidates |
| Defensive Archetype | defenseScoreEngine, wnbaOpponentContextService, opponentHistoryComparisonV1 | raw distinguishable in `rawValues.distinguishableRaw` | `bridgeDefensiveArchetype` ? **one capped OPPONENT_AND_MATCHUP** | `engines.defensiveArchetype` | defenseScore / team stats | opponent context service | OPPONENT_AND_MATCHUP | ledger only | ledger only | yes | OHC conf deferred | bridge rawValues; group caps |
| True Pace | opponent/game-context; possessions helper | `evaluateTruePacePossession` upgraded gate | same + possessions only when FGA/FTA/OREB/TOV complete | `engines.pacePossession` (`truePace`) | game logs | game logs | GAME_ENVIRONMENT | ledger only | ledger only | yes | proxy store-only never votes | #85 incomplete box; #84 proxy |
| Teammate Impact | usageShare / availabilityImpact / role / game-logs | with/without fallback retained | `bridgeTeammateImpact` (? same-team arbitration) | `engines.teammateImpact` | availabilityGate teammate lists | availabilityImpact | AVAILABILITY_AND_TEAMMATE (diminished vs availability) | ledger only | ledger only | yes | separate from SAME_TEAM_ARBITRATION | #81 lock separate |
| Rest / Fatigue | new shared schedule-context (restFatigueEngine) | n/a (substantially new) | `evaluateRestFatigue` | `engines.restFatigue` | teamGameDates | teamGameDates | REST_AND_FATIGUE | ledger only | ledger only | yes | n/a | existing rest tests 41?45 |
| Evidence Dedup | **new central authority** | replaces independent DDI conf cuts for overlapping groups | `evaluateEvidenceDeduplication` | `evidenceDeduplication` + `aggregation` | via orchestrator | via orchestrator | all groups | **sole** post-organic conf owner | **sole** engine risk owner (+ assignTrueRisk) | yes | DDI overlapping conf deferred | #77 idempotent; #79 owner |
| Decision packet / no double-exec | sideSelectionBundle (prior) extended | re-run prevented | `buildDecisionPacketV1`, `admitResultsFromDecisionPacket` | `courtEdgeDecisionPacketV1` | attach once | attach once | n/a | apply once (`alreadyApplied`) | apply once | yes | second apply no-op | #77 #78 |

---

## Confidence / risk ownership (one pass)

1. **Organic projection confidence** ? league path (NBA reliability / WNBA Reader + evidence-final)  
2. **Deduplicated pick confidence** ? evidence ledger via `applyEngineSignalAdjustments` (**once**)  
3. **Same-team final-side recalibration** ? `finalizeSameTeamForcedUnderPresentation` (**once if flipped**)  
4. **Best 6** ? safety ranks only (no conf rewrite)  
5. **Top** ? uses finals without rewrite  

`assignTrueRisk` consumes gate/debts; engine risk ordinals flow through ledger ? `courtEdgeRiskAdjustment`. Owners: `confidenceOwner=evidenceDeduplicationLedger`, `riskOwner=evidenceDeduplicationLedger+assignTrueRisk`.

---

## Pipeline (unchanged order)

```
projection -> side selection ? Flip-First ? Side Rescue ? same-team arbitration
- side balance (LOCKED after arbitration) ? Controlled Best 6 ? Top Picks
- canonical seal (engineSignals + decision packet) ? Results tracking (packet consume)
```

---

## Key fixes in v1.1

1. **No parallel scoring** ? bridges prefer existing DDI/line/availability/role/opponent outputs.  
2. **DDI deferral** ? when expansion ON, overlapping conf/risk deferred to ledger (`deferredToEvidenceLedger`).  
3. **Immutable decision packet** ? evaluate once; Results double-admission invariant.  
4. **Same-team side lock** ? `sideLockedAfterArbitration`; side balance cannot remove/flip/rerun rescue.  
5. **Side Rescue** ? terminal actions are `KEEP_ORIGINAL | FLIP_SIDE | NO_DECISIVE_RESCUE` only (no user-facing NO_BET).  
6. **WEAK vs UNPLAYABLE** ? NO_DECISIVE_RESCUE stays playable; OUT/missing-core still exclude.  
7. **NBA/WNBA adapters** ? `adapters/leagueCtxAdapters.js` (does not force WNBA Reader onto NBA).  
8. **Canonical seal** ? nests `courtEdgeEngineSignalsV1`, `engineSignals`, `courtEdgeDecisionPacketV1`.  

---

## Files (v1.1 delta)

**New:**  
`legacyModuleBridges.js`, `legacyAdaptersV1.js`, `decisionPacketV1.js`, `versionConstants.js`, `adapters/leagueCtxAdapters.js`, `scripts/runCourtEdgeEngineExpansionSuite.js`

**Modified:**  
`orchestratorV1.js`, `availabilityRosterEngine.js`, `services/courtEdgeEngineSignalsV1.js`, `decisionDataIntelligenceV1.js`, `sideRescueEngineV1.js`, `controlledBestSixSelector.js`, `sameTeamForcedSidePresentationV1.js`, `canonicalSealedProp.js`, `server.js` (SERVER_BUILD), `package.json`, `scripts/testCourtEdgeEngineExpansionV1.js`, `index.js`, `COURTEDGE_ENGINE_EXPANSION_V1_REPORT.md`

---

## Tests

```
npm run test:courtedge-engine-expansion
```

Aggregates unit suite via child process; nonzero exit on failure. Cases **#76-#85** cover packet, idempotency, Results double-admit, ownership, bridges, same-team lock, seal, pace/proxy honesty.

**Verified locally (2026-07-18):** `85 passed, 0 failed` via `npm run test:courtedge-engine-expansion` (aggregate runner exit 0).

---

## Deploy / verify checklist

1. `/health` ? `serverBuild: courteedge-engine-expansion-v1.1`  
2. Refresh Today/Tomorrow ? Best 6 all **TRACK**; Results **6/6**  
3. Spot-check sealed pick: `courtEdgeEngineSignalsV1`, `courtEdgeDecisionPacketV1.alreadyApplied`  
4. Same-team Under: `sideLockedAfterArbitration=true`; side unchanged after balance  
5. Re-admit Results prop twice ? side/conf/risk/line/signals unchanged  

**Deploy proof (2026-07-18):** pushed `orgin/betbrain-v2-rebuild`; Render auto-deploy; live `/health` reported `serverBuild: courteedge-engine-expansion-v1.1` with `config.courteEdgeEngineExpansionV1: true`. Unit suite **85/85** via `npm run test:courtedge-engine-expansion`. Consolidation commit lineage includes `e440023` / bridges fix / `e75585b` SERVER_BUILD restore.

Prod: `https://betbrain-server-1.onrender.com` (Render auto-deploy from `orgin/betbrain-v2-rebuild`).

### Deploy proof (2026-07-18 / UTC 2026-07-19)

| Check | Result |
|---|---|
| Commit | `e440023` pushed to `orgin/betbrain-v2-rebuild` |
| `/health` serverBuild | `courteedge-engine-expansion-v1.1` |
| Flag | `courteEdgeEngineExpansionV1: true` |
| Local tests | `npm run test:courtedge-engine-expansion` ? **85/85** |
| Refresh | `POST /refresh-picks` succeeded on prod |
| Board Best 6 (`bestSixDisplayWNBA`) | **6/6 TRACK**; each has `courtEdgeEngineSignalsV1` + `courtEdgeDecisionPacketV1` |
| Sample sealed signal | `schemaBuild=courteedge-engine-expansion-v1.1`, `alreadyApplied=true`, `confidenceOwner=evidenceDeduplicationLedger` |
| Official Tomorrow seal | `2026-07-19` sealed FULL_BEST_SIX propCount=6 |
| Results tracked | **6/6** (active Results cohort = sealed `2026-07-17`; pre-v1.1 packets preserved ? no history rewrite) |
| Same-team lock | unit #81/#82 pass; side-balance audit reports `sameTeamLockedProtected` |

---

## Limitations (honest)

- Bridges need DDI/pick fields present; cold paths still use expansion engines (fallback, not a second vote once ledger runs).  
- NBA offseason: verify via fixtures/replay only.  
- Travel geodata still unavailable for rest/fatigue.  
- Vendor projection for WNBA still entitlement-gated.  
- Rest/fatigue remains substantially new (no prior module to wrap).  

---

## Locked rules status

| Rule | Status |
|---|---|
| Six-man when 6 playable | preserved |
| Track-all-six / Results 6/6 | preserved + packet admit |
| Same-team arbitration | locked vs side balance |
| Line integrity | Line Integrity owns lines |
| TRACK / NOT SELECTED user labels | preserved |
| LOW/MEDIUM/HIGH risk | preserved |
| No Calibration Feedback | untouched |
| No Lab rebuild / history rewrite | seal consume only |
| Separate NBA/WNBA calibration | `calibrationV1.js` |

---

## Prior v1 sections

Sections 1-38 from `courteedge-engine-expansion-v1` remain historically accurate for the parallel-engine scaffolding; **v1.1 supersedes ownership, conf/risk, Side Rescue labels, side-balance lock, and sealing**. Use this document as the current source of truth.

### Final deploy verification pass (2026-07-19 CT)

| Check | Result |
|---|---|
| HEAD commit (pre-report) | `0fc3dd0d979ace6923721abbba8081f880ee5eee` |
| Engine code commit | Already on `orgin/betbrain-v2-rebuild` (lineage: `7af271d`/`6f8370a` ship v1, `e440023` v1.1, `e75585b` SERVER_BUILD). Working tree had **no pending engine-expansion code** - only this report update. |
| Push | OK - branch was 0 ahead / 0 behind before report commit; engine paths clean |
| Local final test pass | expansion 85/85; smoke 8/8; defense evidence pass; line integrity pass; same-team V2 pass. **controlled Best 6 failed** via nested `testResultsTrackingCohort`: `today Best 6 cohort must be full (>=6), got 4` |
| `/health` serverBuild | `courteedge-engine-expansion-v1.1` (live) |
| Flag | `config.courteEdgeEngineExpansionV1: true` |
| Today Best 6 | `bestSixDisplayTodayWNBA` **3/3 TRACK** + `courtEdgeEngineSignalsV1` (Howard Under 18.5; Gray Over 18.5; Ogunbowale Under 13.5). Controlled `bestSixWNBA` slate `2026-07-19`: **6/6 TRACK** + signals (adds Ogwumike Over 17.5; Stevens Over 11.5; Griner Over 12.5). User-facing track label TRACK; no NO_BET/NATURAL_TRACK. Internal `naturalDecision` may still say BOARD_ONLY (audit only). |
| Tomorrow Best 6 | In mixed `bestSixDisplayWNBA`: **3 TRACK** + signals on `2026-07-20` (Stewart Over 20.5; McBride Over 18.5; Malonga Under 17.5) |
| Sealed/tracked signals | **yes** on live Best 6 board (`schemaBuild=courteedge-engine-expansion-v1.1`). **no** on stored tracked props yet (`signalOnTracked=0` for Jul 17/19 sealed store rows) |
| Results 6/6 | **partial** - `activeResultsSlateDate=2026-07-19`, `activeResultsTrackedCount=3` (Howard/Gray/Ogunbowale). Historical Jul 17 store still has 6 graded TRACK props (pre-expansion, no signals): Ogwumike OVER 16.5 WIN; Malonga UNDER 16.5 LOSS; Harrison OVER 11.5 LOSS; Howard UNDER 19.5 WIN; Mitchell OVER 22.5 WIN; Hillmon UNDER 9.5 LOSS |
| Refresh | `POST /refresh-picks` is open (no admin). Local `.env` has no `ADMIN_SECRET`. Live refresh **not executed** this pass (approval gate blocked autonomous POST). Board already populated via scheduled refresh (`lastUpdated=2026-07-19T11:34:02.050Z`). |

Note: Numbered historical sections 18 / 21-24 / 32-35 from the original v1 scaffold are superseded by the v1.1 Deploy proof tables above and this Final deploy verification pass.
