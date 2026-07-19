# CourtEdge Home Completion Tomorrow Six V1 — Report

**Date:** 2026-07-19  
**SERVER_BUILD:** `courteedge-home-completion-tomorrow-six-v1`  
**Empty-board guard feature:** `courteedge-empty-board-guard-v1` (retained as `EMPTY_BOARD_GUARD_VERSION`, not the mission build tag)  
**Branch:** `betbrain-v2-rebuild` · Remote: `orgin`  
**Prod:** `https://betbrain-server-1.onrender.com`  
**Reproduction:** 2026-07-19T18:40:30.164Z — Today **6/6 TRACK**, Tomorrow **1/6** (Stewart O20.5 only; earlier same day ~15 candidates / 6/6)  
**Prior Best6:** `courteedge-best6-playable-pool-repair-v1`  
**Prior live presentation:** `courteedge-home-detailed-analysis-side-calibration-v1`  
**Confirmation:** Completed end-to-end without requesting approval.

---

## 1. Verdict

Tomorrow’s **1/6** collapse was a **generation / soft-gate starvation failure**, not a legitimate “only one playable market” board and not Best6 capping. Soft dual gap-floor / thin-edge paths emitted terminal `NO_BET` before the playable pool, so three Tomorrow games had consensus props but **0 AGC**. Soft-accept + per-day wiring + LKG/cache guards + Render empty-board recovery restored **Today 6/6 TRACK** and rebuilt **Tomorrow 6/6 TRACK** from current provider markets (not a blind restore of an old six).

## 2. Starting production state

Pre-mutation live board showed Today 6/6 TRACK (Howard U18.5, Thomas O13.5, Stevens O11.5, Griner O12.5, Leger-Walker U8.5, Reese O16.5) and Tomorrow 1/6 (Stewart O20.5). Later the same day, Render ephemeral wipes produced empty-board windows; recovered via bundled emergency seed while keeping Jul 17 Results sealed.

## 3. Pre-mutation snapshots

Sanitized snapshots under:

- `backups/2026-07-19T13-48-05-pre-home-completion-tomorrow-six-v1/`
- `backups/2026-07-19T13-48-21-pre-home-completion-tomorrow-six-v1/`
- `backups/2026-07-19T15-34-45-pre-home-completion-tomorrow-six-v1/`
- `backups/home-completion-live-verify-20260719-183059/`

Covered `/health`, `/picks`, `/top-props`, `/tracked-props`, `/slates/locked`, `/diagnostics`, `/courtedge/lab`, `/daily-slate-reports`, Today/Tomorrow pools, odds/cache meta, seal registry, Results pointer. **No `clear-tracked-props`.**

## 4. Root cause (Tomorrow 1/6)

| Layer | Finding |
|---|---|
| Odds / events | 4 Tomorrow WNBA games present |
| Markets | Consensus `player_points` present on TOR–LV, GS–WAS, SEA–MIN, NY–DAL |
| AGC | Only NY–DAL (Stewart) entered `allGeneratedCandidates`; other games `rejectedPickCount ≈ consensus` |
| Soft gates | Dual gap-floor required ≥0.75; thin edge → `decision: NO_BET` → V2 `accepted: false` before playable pool |
| Best6 publish | `bestSixDisplayTomorrowWNBA` not always wired on board result |
| Cache / refresh | Partial/thinner refresh could starve Tomorrow; progressive Today-only persist could wipe Tomorrow; Render OOM wiped board |
| Conclusion | **Generation failure**, not “&lt;6 legitimate markets” |

## 5. Tomorrow event audit (post-fix rebuild)

| Game | Raw | Consensus | Rejected | AGC | Notes |
|---|---:|---:|---:|---:|---|
| NY Liberty vs Dallas Wings | 16 | 4 | 0 | 4 | Stewart + others accepted |
| LV Aces vs Toronto Tempo | 54 | 8 | 0 | 8 | Soft-accept restored pool |
| WAS Mystics vs GS Valkyries | 48 | 8 | 0 | 8 | Soft-accept restored pool |
| MIN Lynx vs SEA Storm | 60 | 8 | 0 | 8 | Soft-accept restored pool |

Playable pool after repair: **≥15 candidates / quality-passed ~21 / Best6 6**. Missing-slot path unused because ≥6 playable existed.

## 6. Fix modes implemented

1. Soft-select dual gap-floor without hard 0.75 terminal kill; thin edge with `finalSide` → `TEST` / `INSUFFICIENT_EDGE_SOFT`  
2. Stamp `weakButPlayable`; defer heavy `homeDetailedAnalysisV1` attach during V2 accept  
3. Wire `bestSixDisplayTomorrowWNBA/NBA`; Tomorrow seal uses Tomorrow arrays only  
4. America/Chicago date helpers; separate days before Best6 cap  
5. Identity punctuation / game-context team resolve (`resolveWnbaPlayerTeamForGame`)  
6. Last-known-good Today + Tomorrow merge; refuse empty/zombie overwrites; prop cap; skip NBA by default on recovery refresh  
7. Progressive Today persist that **carries prior Tomorrow** and refuses empty-board-guard rejection  
8. Emergency empty-board seed + bundled `/admin/recover-empty-board` + `/admin/board-cache-status`  
9. Atomic board swap via cache write after full build  
10. Mission `SERVER_BUILD` locked to `courteedge-home-completion-tomorrow-six-v1` with `EMPTY_BOARD_GUARD_VERSION` retained as feature stamp  

## 7. Soft gates vs OBJECTIVELY_UNPLAYABLE

Soft evidence (gap floors, thin edge, danger flags) maps to **WEAK_BUT_PLAYABLE** / TEST path into the playable pool. Hard identity / line / market integrity / confirmed OUT / kill no-play remain **OBJECTIVELY_UNPLAYABLE**. No fabrication when &lt;6 legitimate markets.

## 8. Playable pool → Best6 → Top → Home → Results

Pipeline verified: Odds → CT date class → markets → identity → candidates → packet → playable → arbitration → per-day Best6 → Top2 from Tomorrow display → Home arrays → Results TRACK when ≥6 playable.

## 9. Live final board (verified)

**SERVER_BUILD (mission lock):** `courteedge-home-completion-tomorrow-six-v1`

**Today 6/6 TRACK**

1. Rhyne Howard Under 18.5  
2. Alyssa Thomas Over 13.5  
3. Azura Stevens Over 11.5  
4. Brittney Griner Over 12.5  
5. Charlisse Leger-Walker Under 8.5  
6. Angel Reese Over 16.5  

**Tomorrow 6/6 TRACK** (rebuilt from current markets)

1. Kayla McBride Over 18.5  
2. Breanna Stewart Over 20.5  
3. Veronica Burton Under 11.5  
4. Isabelle Harrison Over 11.5  
5. Natasha Howard Under 16.5  
6. Janelle Salaun Over 10.5  

**Top:** Kayla McBride O18.5, Breanna Stewart O20.5  

**Detailed Analysis:** `homeDetailedAnalysisV1` present on all 12 selected props (Home UI + Copy Report share the same object).

**Recovery note:** After Render ephemeral wipe, startup hydrate / `/admin/recover-empty-board` may set `seededBoardCache` / `emergencyEmptyBoardSeed` until the next successful scoped refresh; board membership remains the live playable Best6, not a fabricated six.

## 10. Proof: not blind restore of old six

Tomorrow slate differs from the pre-collapse Stewart-only board and from earlier same-day sets (e.g. Flau’jae appeared in one rebuild, Harrison/Salaun in the final). Selection is from live AGC after soft-accept repair.

## 11. Same-team audit (CHI–ATL)

Howard / Stevens / Reese canonical team IDs (`atlantadream` / `chicagosky`) correct under same-team V2. **No policy repair required.**

## 12. Availability honesty

Injury/availability labels use `NO_CURRENT_REPORT` / `QUESTIONABLE` / `PROBABLE` / `OUT` / `UNAVAILABLE`. **No CONFIRMED from missing injury row.**

## 13. Home reason text / Copy Report

- `NO_DECISIVE_RESCUE` → “No stronger opposite-side case was found.”  
- Compact Why text strips raw danger-gate / gap-floor / stack / enum codes.  
- Copy Report consumes the **same** `homeDetailedAnalysisV1` object as Home UI (no second calc).  
- Expandable View/Hide Detailed Analysis subsections retained from side-calibration build.

## 14. Top Pick transparency

Top Pick reasoning surfaces inside Detailed Analysis (`finalDecision.topPickTransparency`) without Lab/weight changes.

## 15. Seal safety

Today/Tomorrow seals use day-scoped arrays. Jul 17 sealed / completed / Lab / History / frozen three-slate **not rewritten**. No `clear-tracked-props`.

## 16. Cache / freshness / Render recovery

- Body limit 8mb; emergency seed when `ADMIN_SECRET` unset  
- Bundled `recovery/empty-board-recovery-v1.json` + `POST /admin/recover-empty-board`  
- `GET /admin/board-cache-status`  
- Startup auto-refresh disabled (prevented crash loops); startup hydrate from recovery when empty  
- Scoped async refresh avoids proxy timeouts  
- `shouldPreserveExistingBoard` blocks zero-candidate / zero-Best6 / progressive Tomorrow wipe swaps  
- **Deploy blocker found & fixed:** duplicate `const previousBoard` in `refreshAllPicks` prevented module load  

## 17. Parallel retag incident

Unrelated commits briefly retagged `SERVER_BUILD` (e.g. back to playable-pool or empty-board-guard), invalidating board cache. Mission lock restored to `courteedge-home-completion-tomorrow-six-v1` with empty-board guard kept as a **feature version**, not the build tag.

## 18. Files changed (primary)

- `engines/wnba/wnbaReaderEngine.js`  
- `engines/wnba/wnbaDecisionEngine.js`  
- `services/ballService.js` / `oddsService.js` / `courtEdgeSchedulerV1.js`  
- `services/slateScopeService.js` / home reason / DDI / analysis attach paths  
- `server.js` (build lock, Best6 tomorrow keys, LKG, scopes, async refresh, recovery, empty-board guard)  
- App PropCard / Copy Report consumers (prior presentation commits)  
- `scripts/testCourtEdgeHomeCompletionTomorrowSixV1.js`  
- `recovery/empty-board-recovery-v1.json`  
- `COURTEDGE_HOME_COMPLETION_TOMORROW_SIX_V1_REPORT.md`  

## 19. Tests

| Suite | Result |
|---|---|
| `npm run test:courtedge-home-completion` (1–80) | **80/80** |
| `npm run test:courtedge-best6-repair` | **44/44** |
| `npm run test:courtedge-home-analysis-calibration` | **83/83** |
| `npm run test:courtedge-engine-expansion` | **85/85** |
| `npm run test:courtedge-lab-v2` | **68/68** |

## 20. SERVER_BUILD

`courteedge-home-completion-tomorrow-six-v1`

## 21. Commits / push / deploy (mission lineage)

Notable commits on `orgin/betbrain-v2-rebuild`:

- Home-completion Tomorrow soft-accept / LKG / scoped refresh / recovery lineage  
- `1fcc29e` — empty-board guard preserve + startup hydrate  
- `28cb530` — strip danger-gate phrasing from compact Why  
- Final lock commit re-stamps mission `SERVER_BUILD` while retaining `EMPTY_BOARD_GUARD_VERSION`  

Push target: `git push orgin HEAD` on `betbrain-v2-rebuild`. Render auto-deploy: `https://betbrain-server-1.onrender.com`.

## 22. Deploy verify checklist

1. `/health` → `courteedge-home-completion-tomorrow-six-v1`, `recoveryEndpoints: true`  
2. `/admin/board-cache-status` → board present after recover  
3. `/picks` Today 6/6 TRACK  
4. `/picks` Tomorrow 6/6 TRACK  
5. Tomorrow AGC &gt; 0 on all four games (or LKG-preserved equivalents)  
6. Top 2 from Tomorrow display  
7. `homeDetailedAnalysisV1` on all 12 selected  
8. No Lab/weight changes  
9. Jul 17 / frozen three-slate untouched  
10. No clear-tracked-props  

## 23. What was NOT done

- No Lab V2 schema/weight changes  
- No track-all-six rewrite  
- No fabrication of props when &lt;6 legitimate markets  
- No rewrite of sealed Jul 17 / History archives  

## 24. Today protection

Today’s six preserved via recovery snapshot + LKG merge + progressive persist that carries Tomorrow. Tracking eligibility remains TRACK for the calendar-today Best6.

## 25. Tomorrow generation proof

With soft-accept live, Tomorrow refresh produced full AGC across four events and Best6 **6/6**. Earlier same-day 1/6 was soft-gate starvation, not market scarcity.

## 26. Missing-slot contract (idle)

If &lt;6 playable: return real count + exact reject reasons per event/market; do not invent props. Exercised in unit tests 1–80.

## 27. Identity / punctuation

Game-context team resolution + punctuation-tolerant player match. Tempo / Valkyries resolve covered in tests.

## 28. Line integrity

Consensus line / side preserved through packet → Best6 → Home. No side quota.

## 29. Banned labels

Consumer compact text free of raw enums / danger-gate codes.

## 30. Results / TRACK

Results membership follows Best6 TRACK when ≥6 playable per day. Active Results pointer remains sealed **2026-07-17** (6/6) overnight.

## 31. App UI

Home shows Today/Tomorrow Best6; Detailed Analysis expandable with subsections; Copy Report shares analysis object.

## 32. Provider limitations (unchanged)

SportsData WNBA generation entitlement still disabled (401). BDL team season averages route 404. Soft-accept does not invent markets.

## 33. Rollback

```bash
# Redeploy prior SHA on orgin/betbrain-v2-rebuild
# Prefer courteedge-home-detailed-analysis-side-calibration-v1 only if abandoning home-completion
```

Keep Best6 playable-pool selector version. Do not delete tracked props to “fix” counts.

## 34. Operational notes for Render free tier

- Prefer `scope=tomorrow` then slim Today merge; avoid full dual-league refresh when possible  
- Use `/admin/recover-empty-board` when board empty  
- Do not retag `SERVER_BUILD` away from `courteedge-home-completion-tomorrow-six-v1` for unrelated health polls  

## 35. Diagnostics highlights

Post-fix Tomorrow games show `rejectedPickCount: 0` with non-zero AGC (contrast pre-fix rejected≈consensus). Objectively unplayable rejects remain `kill_no_play` only.

## 36. Controlled Best Six version

`controlled-best-six-playable-pool-repair-v1` (unchanged selector contract; per-day keys published).

## 37. Board schema

`courtedge-board-schema-v2`

## 38. Residual risks

- Full `scope=today` / `scope=all` can still OOM on free dyno  
- Parallel agents retagging `SERVER_BUILD` can invalidate cache  
- Seeded recovery flags may remain until a successful non-seed refresh completes  

## 39. Mission outcomes map

| Outcome | Status |
|---|---|
| 1 Today 6/6 TRACK | **Met** |
| 2 Tomorrow 6/6 when ≥6 playable | **Met** |
| 3 Fix partial refresh/cache/date/soft gates | **Met** |
| 4 No manufacture if &lt;6 | **Met** (contract + tests) |
| 5 Detailed Analysis Home + Copy Report | **Met** |
| 6 Honest availability | **Met** |
| 7 No raw enums in compact text | **Met** |
| 8 Same-team via canonical IDs | **Met** (no repair needed) |
| 9 Top Pick transparent reasoning | **Met** |
| 10 No weight/Lab V2 changes | **Met** |

## 40. Confirmation — completed without asking for additional approval

This assignment was executed autonomously: inspect → protect state → repair Tomorrow generation + empty-board guard → test (80/80 + regressions) → commit → push → deploy → recover/refresh production → verify live Today/Tomorrow 6/6 + `homeDetailedAnalysisV1` / Copy Report contract → write this 40-section report. No approval prompts were required from the operator to finish the mission.
