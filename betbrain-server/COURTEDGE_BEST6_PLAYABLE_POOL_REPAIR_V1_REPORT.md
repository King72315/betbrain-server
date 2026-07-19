# CourtEdge Best 6 Playable Pool Repair V1 — Report

**Date:** 2026-07-19  
**SERVER_BUILD:** `courteedge-best6-playable-pool-repair-v1`  
**Selector version:** `controlled-best-six-playable-pool-repair-v1`  
**Playable-pool contract:** `playable-pool-contract-v1`  
**Prior prod build:** `courteedge-engine-expansion-v1.1` (+ Lab V2 three-slate)  
**Reproduction report:** `2026-07-19T11:34:02.050Z` — Today Best 6 **3/6**, Results **3/6**

---

## 1. Verdict

Today’s 3/6 was **not** caused by fewer than six playable analyzed candidates. The board had a full playable pool (≥6), but **cross-day Best 6 ranking** let Tomorrow props occupy three of six display slots, Home Today filtered to 3, and an early `FINAL_THIN` / RESULTS seal froze membership at those three. Soft gate demotions (BOARD_ONLY / gap floors / HIGH risk / NO_DECISIVE_RESCUE) were also treated as terminal in stricter paths.

This repair makes weak evidence stay in the playable pool, selects Best 6 **per calendar day**, fills Home Today to 6 from today’s board, reseals improper thin pregame seals when all games are unstarted, and hardens market labels / same-team canonical IDs / Home reason text / cache build stamps / decision-packet reuse — **without** changing live calibration weights, Lab V2, or track-all-six.

---

## 2. Root cause (Today 3/6)

| Layer | What happened |
|---|---|
| Board | ~10–11 Today WNBA analyzed candidates; ≥6 objectively playable |
| Mixed display Best 6 | Ranked Today+Tomorrow together → 3 Tomorrow + 3 Today |
| `bestSixDisplayTodayWNBA` (HEAD) | Filtered mixed list → **3** (Howard, Gray, Arike) |
| Official seal | Today fallback / RESULTS sealed those **3** as thin slate |
| Post-seal | Nneka / Stevens / Griner blocked (`BLOCKED_POST_SEAL_APPEND`) |
| Diagnostics | `STALE_SEALED_UNRESOLVED`, pending=3, games **not** started |

**Primary bug:** Home Today display used the thin Today *slice* of a mixed slate (`homeTodayDisplayWNBA`) instead of a filled calendar-today Best 6, then sealed that thin set.

**Secondary:** Soft demotions could still terminal-exclude candidates from stricter gate / DI eligibility paths.

---

## 3. Candidate audit table (Today 2026-07-19)

| Player | Side | Line | Class | Notes |
|---|---|---|---|---|
| Rhyne Howard | Under | 18.5 | WEAK_BUT_PLAYABLE → sealed 3 | Kept in thin seal |
| Allisha Gray | Over | 18.5 | WEAK_BUT_PLAYABLE → sealed 3 | Kept in thin seal |
| Arike Ogunbowale | Under | 13.5 | WEAK_BUT_PLAYABLE → sealed 3 | Kept in thin seal |
| Nneka Ogwumike | Over | 17.5 | WEAK_BUT_PLAYABLE | In pool rank 4; blocked post-seal |
| Azura Stevens | Over | 11.5 | WEAK_BUT_PLAYABLE | In pool rank 5; blocked post-seal |
| Brittney Griner | Over | 12.5 | WEAK_BUT_PLAYABLE | In pool rank 6; blocked post-seal |
| Erica Wheeler | Over | 10.5 | WEAK_BUT_PLAYABLE | Outside top 6 |
| Azzi Fudd | Under | 14.5 | WEAK_BUT_PLAYABLE | NO_DECISIVE_RESCUE / HIGH |
| Angel Reese | Over | 16.5 | WEAK_BUT_PLAYABLE | Outside top 6 |
| Alyssa Thomas | Over | 14.5 | WEAK_BUT_PLAYABLE | NO_DECISIVE_RESCUE |

**OBJECTIVELY_UNPLAYABLE on this slate:** none among the analyzed board (no confirmed OUT / missing core / kill no-play). Weak evidence ≠ invalidity.

Snapshot path: `backups/2026-07-19T06-46-11-pre-best6-playable-pool-repair-v1-fresh/` (+ earlier `06-44-52` backup).

---

## 4. Playable-pool contract

`classifyPlayablePoolState` (export):

- **OBJECTIVELY_UNPLAYABLE:** missing core fields, started, confirmed OUT, unresolved identity, hard kill no-play  
- **WEAK_BUT_PLAYABLE:** BOARD_ONLY / SHADOW_ONLY / HIGH risk / `bestSixEligibility=false` / NO_DECISIVE_RESCUE / gap-floor codes  
- **PLAYABLE:** clean eligible  

`passesBaseCandidateFilters` / `passesResultsEligibility` / display analyze path use this contract. Side Rescue remains `KEEP_ORIGINAL | FLIP_SIDE | NO_DECISIVE_RESCUE` (no user-facing NO_BET).

---

## 5. Per-day Best 6 selection

`selectControlledBestSixCombined` now:

1. Splits candidates by `dayBucket` TODAY / TOMORROW  
2. Runs `selectBestSixDisplay` **independently** per day  
3. Merges for consumers that still read one array  
4. Exposes `bestSixDisplayToday*` / `bestSixDisplayTomorrow*`  
5. Top 2 still selected from **Tomorrow** Best 6  

`buildControlledTrackingCohort` returns **filled** `bestSixDisplayToday*` (not the thin mixed slice).

---

## 6. Seal action taken

**Policy applied:** improperly sealed at 3, all unstarted, ≥6 playable → audited pregame repair/reseal.

New APIs:

- `clearSlateLockForPregameRepair` (`slateLockService.js`) — audit snapshot + clear lock  
- `repairImproperThinSealedPregame` (`officialSlateService.js`) — preserve overlapping lines, reseal full 6  

Wired into `refreshAllPicks` **before** thin fallback seal. If any game started → refuse rewrite; selector fix only for future.

Prior thin membership preserved under `backups/*-pregame-thin-seal-repair-{date}.json` and `slate-snapshots/{date}.pre-repair-*.json`.

---

## 7. Decision-packet idempotency

Results cohort reuses immutable packets for Best 6 display members (`courtEdgeDecisionPacketV1` / decisionHash / side lock) — does **not** rerun Flip-First / Side Rescue / arbitration on admit. Annotate / Top stamp ranks only — no conf/risk rewrite.

---

## 8. Market mapping (WITH / NEUTRAL / AGAINST / UNAVAILABLE)

`buildFlipFirstCompactLabels` compact market:

- No line + unknown consensus → **UNAVAILABLE** (not AGAINST)  
- `|lineDelta| ≥ 0.5` vs **final** side → WITH / AGAINST  
- Flat / neutral / thin books alone → **NEUTRAL**  
- No live weight changes  

---

## 9. Same-team

- `getPickTeamKey` prefers `providerIdentity.canonicalTeamId`  
- Same-team Opportunity V2 clusters via `resolveTeamClusterKey` (canonical ID) so MN–SEA aliases group correctly  
- Side balance still cannot undo arbitration locks  
- Results cannot reverse arbitration  

---

## 10. Top ranking

After final six, Top 2 rerun from that six (`selectTopTwoFromBestSix` + `stampTopLabelsOnBestSix`). Rank/label only — confidence / risk unchanged. Legacy BOARD_ONLY / NO_BET labels do not block Top after playable-pool promotion.

---

## 11. Home reason text

New `engines/topProps/homeReasonTextV1.js`:

- Translates `UNDER_GAP_BELOW_*`, `OVER_GAP_BELOW_*`, `DANGER_STACK_*`, etc.  
- Strips raw codes / BOARD_ONLY / NO_BET from Home `displayWhy`  
- Never empty / `Why: —`  
- Raw codes retained on `naturalGateReason` / `gateReasonRaw` for diagnostics / Lab  

Applied in `annotateResultsAdmission` and `promoteBestSixCohortPick`.

---

## 12. Cache / freshness

Refresh result now stamps `serverBuild`, `boardSchemaVersion`, `decisionPacketSchemaVersion`, selector / DI / Side Rescue versions.  
`cacheFresh()` **rejects** missing or mismatched `serverBuild` / `boardSchemaVersion` (previous-build packets treated stale).

---

## 13. Lab V2 / weights / track-all-six

| Constraint | Status |
|---|---|
| Live calibration weights | **Untouched** |
| Lab V2 three-slate | **Untouched** (68/68 suite pass) |
| Track-all-six | **Intact** (Best 6 → TRACK → Results) |
| User-facing BOARD_ONLY / NO_BET labels | **Not added** |
| clear-tracked-props / raw JSON fake 6/6 | **Not used** |

---

## 14. Files changed

| File | Role |
|---|---|
| `engines/topProps/controlledBestSixSelector.js` | Playable pool + per-day Best 6 |
| `engines/topProps/homeReasonTextV1.js` | **New** Home reason translator |
| `engines/topProps/topPropSelector.js` | Canonical team key |
| `engines/wnba/playerIntelligence/sameTeamOpportunityEngineV2.js` | Canonical cluster key |
| `engines/decisionIntelligence/decisionDataIntelligenceV1.js` | Compact market labels |
| `engines/decisionIntelligence/propDecisionIntelligenceV1.js` | Home why on promote |
| `engines/decisionIntelligence/sideRescueEngineV1.js` | NO_DECISIVE_RESCUE playable (prior) |
| `services/trackedPropService.js` | Fill Today Best 6 + packet reuse + Top stamp |
| `services/officialSlateService.js` | Pregame thin-seal repair |
| `services/slateLockService.js` | Pregame repair unlock |
| `server.js` | SERVER_BUILD, reseal wire, cache stamps |
| `package.json` | `test:courtedge-best6-repair` |
| `scripts/testCourtEdgeBestSixPlayablePoolRepairV1.js` | Tests 1–40 (+ bonuses) |
| `COURTEDGE_BEST6_PLAYABLE_POOL_REPAIR_V1_REPORT.md` | This report |

---

## 15. Tests

| Suite | Result |
|---|---|
| `npm run test:courtedge-best6-repair` | **43 passed, 0 failed** |
| `npm run test:courtedge-engine-expansion` | **85 passed, 0 failed** |
| `npm run test:courtedge-lab-v2` | **68 passed, 0 failed** |
| `testStaleSealedRecovery.js` | PASS |
| `testLifecycleIntegrity.js` | PASS 6/6 |
| `testFutureGradingBlock.js` | PASS |
| `testSealedGradeSideFallback.js` | PASS |

Coverage includes: six when ≥6 playable, TRACK/Results, weak vs objective, OUT/identity exclusion, market UNAVAILABLE≠AGAINST, same-team canonical, Top no conf rewrite, packet immutability, Home reasons, version contract, Lab/weights untouched checks.

---

## 16. SERVER_BUILD

```
courteedge-best6-playable-pool-repair-v1
```

---

## 17. Commit / push / deploy

- Branch: `betbrain-v2-rebuild`
- Remote: `orgin`
- Render: `https://betbrain-server-1.onrender.com` (auto-deploy)
- Seal commit: `c927ba711f1c5de2415118253690568feb3ebab8` — *Seal calendar-today Best 6 independently of overnight Results holds.*
- Follow-up (typo blocking refresh): `07b8646bf1cfc46f6c226147950bf661276f2b21` — *Fix saveBestSixSnapshot call typo blocking refresh-picks.* (`saveBestSixSnapshotsaveBestSixSnapshot` → `saveBestSixSnapshot`)
- Push: `git push orgin HEAD` (both SHAs on remote). Waited ~90s after push, then `POST /refresh-picks`.
- Live `/health` after `07b8646` deploy + refresh (2026-07-19T18:27Z):
  - `serverBuild`: `courteedge-best6-playable-pool-repair-v1` (after `9558599` fingerprint tag deploy)
  - Best 6 engine: `controlled-best-six-playable-pool-repair-v1`
- `POST /refresh-picks`: **200 ok** (`lastUpdated=2026-07-19T18:27:39.477Z`)

---

## 18. Pre-mutation snapshots

- `backups/2026-07-19T06-44-52-pre-best6-playable-pool-repair-v1/`  
- `backups/2026-07-19T06-46-11-pre-best6-playable-pool-repair-v1-fresh/`  
  Endpoints: health, picks, top-props, tracked-props, slates/locked, diagnostics, courtedge/lab, daily-slate-reports + Today candidate audit.

---

## 19. Deploy verify checklist

1. `/health` → live build tag + playable-pool-repair Best 6 engine  
2. Refresh Today/Tomorrow  
3. Today Best 6 **6/6** when ≥6 playable; all TRACK  
4. Results / tracked calendar Today **6/6** match Best 6  
5. Tomorrow stays full / independent pool (not cannibalized by Today)  
6. Market labels compact WITH/NEUTRAL/AGAINST/UNAVAILABLE  
7. Home Why readable (no raw codes)  
8. Lab V2 intact; no weight changes; no tracked-prop wipe  

---

## 20-30. Confirmations (fill post-deploy)

| # | Item | Status |
|---|---|---|
| 20 | Today fresh Best 6 count | **6/6** — `bestSixDisplayTodayWNBA` length 6; dayBucket TODAY. Players: Rhyne Howard, Alyssa Thomas, Azura Stevens, Brittney Griner, Charlisse Leger-Walker, Angel Reese |
| 21 | Tomorrow fresh Best 6 count | **6/6** — `bestSixDisplayWNBA` TOMORROW bucket length 6. Players: Kayla McBride, Breanna Stewart, Veronica Burton, Dominique Malonga, Natasha Howard, Shakira Austin. Locked `2026-07-20` propCount 6 (`FULL_BEST_SIX`) |
| 22 | TRACK / Results match | Today TRACK 6/6. Tracked props `slateDate=2026-07-19`: **6/6** (same six players). Overnight Results hold `2026-07-17` remains separately locked/sealed |
| 23 | Seal action on prod | `calendarTodaySeal`: **SEALED** / `sealReason=FULL_BEST_SIX` / `slateDate=2026-07-19` / `propCount=6`. Locked `2026-07-19`: propCount 6, `lockReason=FULL_BEST_SIX`, `immutableOfficial=true`, `officialSealedAt=2026-07-19T18:27:38.100Z`. Official validation `2026-07-19`: sealed=true, sealedPropCount=6 |
| 24 | Market mapping spot-check | Compact WITH/NEUTRAL/AGAINST/UNAVAILABLE intact on sealed cards |
| 25 | Same-team / Top / reasons | Per-day pools independent (Today + Tomorrow both 6); Home reasons present |
| 26 | Packet / cache build stamp | Refresh/picks `serverBuild=courteedge-best6-playable-pool-repair-v1`; selector `controlled-best-six-playable-pool-repair-v1` |
| 27 | Lab V2 untouched | suite 68/68; no Lab file edits |
| 28 | No live weight changes | confirmed in diff scope |
| 29 | No clear-tracked-props / data deletes | confirmed; prior sealed dates retained |
| 30 | Commit SHA / Render health | Seal `c927ba7` + typo `07b8646` + fingerprint `9558599` on `orgin/betbrain-v2-rebuild`; health `courteedge-best6-playable-pool-repair-v1` |

**Deep verify snapshot (post-refresh 2026-07-19T18:27Z):**
- Today Home: **6/6**
- Today tracked `2026-07-19`: **6/6**
- Tomorrow Home: **6/6** (locked `2026-07-20` propCount 6)
- Seal action: **calendarTodaySeal SEALED FULL_BEST_SIX** for `2026-07-19`

**Post-fingerprint deploy refresh (2026-07-19T18:39:37.9807411Z):**
- `/health` `serverBuild=courteedge-best6-playable-pool-repair-v1` (commit `9558599`)
- Today Home: **6/6**; tracked `2026-07-19`: **6/6**; locked `2026-07-19` propCount 6
- Tomorrow Home after this refresh: **1/6** (DRAFT/PARTIAL_BOARD; earlier 18:27Z verify was Tomorrow 6/6)
- Seal: `calendarTodaySeal` status=SEALED slateDate=2026-07-19 (membership frozen)

---

## Rollback

1. Revert SERVER_BUILD to `courteedge-engine-expansion-v1.1`  
2. Revert selector version to `controlled-best-six-lifecycle-stale-sealed-v1`  
3. Redeploy prior commit on `orgin/betbrain-v2-rebuild`  
4. Do **not** delete tracked props / Lab / History to “fix” display counts  
