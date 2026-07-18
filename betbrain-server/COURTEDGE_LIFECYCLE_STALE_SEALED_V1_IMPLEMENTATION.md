# CourtEdge Implementation Report — Lifecycle Stale-Sealed v1

**Branch:** `betbrain-v2-rebuild`  
**SERVER_BUILD:** `courteedge-lifecycle-stale-sealed-v1`  
**CONTROLLED_BEST_SIX_VERSION:** `controlled-best-six-lifecycle-stale-sealed-v1`  
**Date:** 2026-07-18  

## Root causes (by area)

### Grading
- Resolve never stamped `lastResolveAttempt` when blocked/not ready → Jul 17 showed all-null resolve fields.
- Frozen `isStarted=false` confused operators; readiness already used `commenceTime`, but attempts were silent.
- Scheduler graded without surfacing stale sealed diagnostics.

### Lifecycle
- Results pointer advanced to Jul 18 while Jul 17 remained sealed+pending.
- `getBlockingActiveResultsSlateDate` only blocked today/yesterday rollover; older sealed pending could orphan.
- Lab stayed on Jul 16; Jul 17 never got daily report → never Lab/History.
- UI only showed active Results date → sealed six looked “lost” (still in tracked).

### Selector
- Final Best 6 rows could retain BOARD_ONLY/NO_BET as user-facing decision labels.
- Top assignment could consider rejected decisions.

### Same-team arbitration
- V2 demoted weaker teammate Overs (`DEMOTE_KEEP_OVER`) instead of deterministic Under flip.
- Required Under to independently qualify before flipping.

### Persistence
- Render ephemeral disk risk remains (documented earlier); recovery script + rehydrate remain required.
- Jul 17 membership itself was intact (not wiped).

### Lab analytics
- All-time scope depended only on completed DSR/archives → could show 0-0 when graded sealed props existed but report/archive missing.
- League could be blank on legacy rows.

### Provider / BDL legacy
- See `COURTEDGE_BDL_DEPENDENCY_INVENTORY.md` — stale wording/neutral defaults still present in some paths; inventory created; no silent BDL primary claim when inactive.

---

## Files changed (high level)

- `engines/wnba/playerIntelligence/sameTeamOpportunityEngineV2.js` — deterministic `SAME_TEAM_ARBITRATION_FLIP`
- `engines/topProps/controlledBestSixSelector.js` — TRACK final decision; Top rejects NO_BET/BOARD_ONLY; version bump
- `services/trackedPropService.js` — resolve attempt stamps; slateDateFilter; analytics scope safety net
- `services/resultService.js` — grading block `reason`
- `services/slateScopeService.js` — sealed pending blocks Results advance beyond yesterday
- `services/officialSlateService.js` — canonical sealed prop on freeze; TRACK/league
- `services/canonicalSealedProp.js` — **new**
- `services/staleSealedRecoveryService.js` — **new**
- `scripts/recoverStaleSealedSlates.js` — **new**
- `scripts/rebuildLabAnalytics.js` — **new**
- `scripts/testStaleSealedRecovery.js` — **new**
- `scripts/testSameTeamOpportunityV2.js` — policy flip assertions
- `fixtures/stale-sealed-2026-07-17.json` — **new**
- `server.js` — SERVER_BUILD; diagnostics; scheduler stale diagnostics
- `app/(tabs)/history.tsx` — Refresh History button (prior turn)
- `COURTEDGE_BDL_DEPENDENCY_INVENTORY.md` — **new**
- Version asserts updated in Controlled Best 6 related tests

---

## Before / after

| Behavior | Before | After |
|----------|--------|-------|
| Same-team weaker Over | Demote keep Over | Always flip Under + `SAME_TEAM_ARBITRATION_FLIP` |
| Best 6 final decision | Could show BOARD_ONLY/NO_BET | Forced TRACK on admitted rows |
| Resolve miss | All null attempt fields | Always stamps lastResolveAttempt + error/nextAction |
| Sealed pending older than yesterday | Could orphan off Results | Blocks active Results pointer until resolved |
| Diagnostics | No sealed-zero-attempt warning | `staleSealedLifecycle` + warning codes |
| Lab all-time 0-0 | Possible with missing DSR | Includes graded sealed Official props |
| Jul 17 recovery | Manual/ad-hoc | `recoverStaleSealedSlates.js --dry-run/--apply` |

---

## Canonical prop schema

`services/canonicalSealedProp.js` → `buildCanonicalSealedProp` / attached as `canonicalSealedProp` on freeze.

Includes: officialPropId, slate IDs, identity, side/line, projection, confidence, risk, TRACK decision, Best 6/Top, same-team flip, Side Rescue, signals, volume, dataMode, providerHealth, reasons, commenceTime, grading + lifecycle fields, pregameSnapshot.

---

## Recovery dry-run (Jul 17)

Command:
```bash
cd betbrain-server
node scripts/recoverStaleSealedSlates.js --date=2026-07-17 --dry-run
```

Result: discovers 6 sealed pending; plans GRADE + BUILD_REPORT_IF_COMPLETE; **no writes**; `membershipPreserved=true`.  
Artifact: `.tmp-recover-2026-07-17-dry-run.json`

**Do not run `--apply` on production while connectivity is unstable.**

Production apply (later, after backup):
```bash
node scripts/recoverStaleSealedSlates.js --date=2026-07-17 --dry-run
# verify plan
node scripts/recoverStaleSealedSlates.js --date=2026-07-17 --apply
```

---

## Analytics rebuild dry-run

```bash
node scripts/rebuildLabAnalytics.js --dry-run
```
Wrote `.tmp-rebuild-lab-analytics-dry-run.json`.

---

## Tests run

| Suite | Result |
|-------|--------|
| testSameTeamOpportunityV2 | PASS |
| testStaleSealedRecovery | PASS |
| testControlledBestSix | PASS |
| recover dry-run Jul 17 | PASS |
| rebuildLabAnalytics dry-run | PASS |
| testOverBalanceSideRescueV1 / testSideRescueEngineV1 / testFlipFirst / testCourtEdgeDataFlow | Some pre-existing failures (cohort version / unrelated asserts) |

---

## Production mutation / deploy

- **No production apply run**
- **No deploy**
- **No tracked props cleared**
- **Jul 17 sealed membership not rewritten**

---

## Exact later commands

```bash
# 1) Push (when internet works)
cd C:\Users\nicho\BetBrain
git push -u orgin HEAD

# 2) Deploy Render (autoDeploy on branch) or manual deploy from dashboard

# 3) Verify health
curl.exe -sS --max-time 30 https://betbrain-server-1.onrender.com/health

# 4) Dry-run recovery on server (Render shell) OR locally against restored snapshot
node scripts/recoverStaleSealedSlates.js --date=2026-07-17 --dry-run

# 5) Apply only after backup + dry-run review
node scripts/recoverStaleSealedSlates.js --date=2026-07-17 --apply

# 6) Verify
# - /diagnostics staleSealedLifecycle
# - /tracked-props includes Jul 17 graded
# - /daily-slate-reports has 2026-07-17
# - Lab shows Jul 17; prior Lab rotated to History
```

---

## Verification checklist

1. `serverBuild` = `courteedge-lifecycle-stale-sealed-v1`
2. Jul 17 still 6 officialPropIds unchanged
3. After apply: grades + lastResolveAttempt present
4. Daily report exists for 2026-07-17
5. Lab pointer moves appropriately; History gains archive
6. Home Best 6 final Decision TRACK only
7. Same-team secondary shows Under + SAME_TEAM_ARBITRATION_FLIP
8. Lab all-time ≠ 0-0 when graded sealed props exist
9. Diagnostics lists staleUnresolved + sealedPendingCountByDate
10. No sealed props deleted

---

## Confirmation

No sealed props or historical records were deleted in this work. Jul 17 membership was not changed. Production was not mutated.
