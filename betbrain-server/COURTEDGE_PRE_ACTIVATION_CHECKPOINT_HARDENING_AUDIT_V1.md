# CourtEdge Pre-Activation Checkpoint Hardening Audit V1

**Audit time:** 2026-08-05 ~22:10–22:30 CT (America/Chicago)  
**Final checkpoint decision:** `V2_CHECKPOINT_REQUIRED`

---

## 1. Existing checkpoint identity (V1 — preserved)

| Item | Value |
|------|-------|
| Commit | `bf581a1bcbf65aba508e01cd46ce73e414a445c9` |
| Tag | `courteedge-pre-full-roster-experiment-v1` (annotated; **not moved**) |
| Rollback branch | `rollback/courteedge-pre-full-roster-experiment-v1` |
| Experiment branch (at V1 creation) | `experiment/courteedge-full-roster-collection-v1` |
| Expected source build | `courteedge-clear-side-strong-edge-membership-path-v1` |
| Full-roster flag | `false` |
| Remote name | **`orgin`** (actual configured remote; not a doc typo) |

Remote URL: `https://github.com/King72315/betbrain-server.git`

---

## 2. Excluded-source audit

### 2.1 `sameTeamOpportunityEngineV2.js` — **REQUIRED BASELINE SOURCE**

| Field | Finding |
|-------|---------|
| Path | `betbrain-server/engines/wnba/playerIntelligence/sameTeamOpportunityEngineV2.js` |
| Git status at audit | Modified vs V1 commit |
| Diff summary | ~118 lines removed / ~23 added: secondary same-team Overs **demoted** instead of **forced Under flip** |
| Build string (dirty / V2) | `courteedge-team-balanced-board-no-forced-under-v1` |
| Build string (V1 commit) | `courteedge-same-team-arbitration-integrity-v1` (still flips secondaries to Under when “organic”) |
| Runtime imports | `controlledBestSixSelector.js` → `applySameTeamOpportunityV2Layer` (Official board selection path); also `engines/wnba/playerIntelligence/index.js` |
| Used by V1 checkpoint commit? | Yes — **committed old forced-Under behavior** |
| Dirty changes affect | **Side selection, team-side arbitration, ranking/confidence/risk packaging** (demotion penalties). Not date verification, not provider requests directly. Membership quality gates still apply after arbitration. |
| Classification | **Required baseline source** — excluded dirty work meant V1 did **not** reproduce the intended no-forced-fill qualified board |

### 2.2 `slateScopeService.js` — **REQUIRED BASELINE SOURCE**

| Field | Finding |
|-------|---------|
| Diff | Prefer Official sealed membership for Home Today display lists |
| Runtime | `server.js` `/picks` sanitize path; tracked-prop lifecycle |
| Affects | Home membership presentation / Home–Results equality surface |
| Classification | **Required baseline source** |

### 2.3 `slateLockService.js` + `directionalCalibrationObservationV1.js`

| Field | Finding |
|-------|---------|
| Diff | Calibration observation fields on Results→History promotion |
| Runtime | History promote path |
| Affects | History packet metadata (calibration), not Official membership selection |
| Classification | **Required baseline source** for current History lifecycle shape (V2 includes both; observation module was previously untracked) |

### 2.4 Frontend / display dirt (restored to HEAD; copies preserved)

Paths included: `components/*`, `utils/controlledBestSixDisplay.js`, `services/api.ts`, `app/(tabs)/settings.tsx`, assorted display tests.

| Classification | **Unrelated / UI work** for API membership checkpoint (preserved under `backups/wip-unrelated-dirt-pre-v2/`) |

### 2.5 Runtime JSON / fixtures / reports

`tracked-props.json`, slate snapshots, pick analytics, provider entitlement fixtures, old reports.

| Classification | **Runtime-only artifact** / historical data mutations — restored to HEAD; WIP copies preserved |

### 2.6 `.env`

Tracked historically in V1 tree; must not be in experiment commits. V2 commit **deletes** `betbrain-server/.env` from the git tree going forward. Local file remains on disk. **Do not treat historical presence of `.env` in older commits as acceptable.**

---

## 3. `sameTeamOpportunityEngineV2.js` determination

**V1 is not a complete behavioral checkpoint** for the current qualified-board policy.

Evidence:

- Import: `engines/topProps/controlledBestSixSelector.js` calls `applySameTeamOpportunityV2Layer` before Official board assembly.
- V1 committed code can emit `SECONDARY_UNDER` / `SAME_TEAM_ARBITRATION_FLIP`.
- Working-tree / V2 code emits `SECONDARY_DEMOTED` / `NO_FORCED_SAME_TEAM_UNDER` and never force-flips side.

---

## 4. Clean / stashed experiment worktree

| Action | Result |
|--------|--------|
| Unrelated tracked dirt | Copied to `betbrain-server/backups/wip-unrelated-dirt-pre-v2/` then restored via `git checkout HEAD -- …` |
| Stash of runtime JSON | Failed once (`does not match index`); WIP copy approach used instead |
| Remaining noise | Root `?? .poll-*` / `.audit-*` untracked diagnostics (ignored for commits); local `.env` untracked after V2 delete |
| Experiment branch | Advanced to V2 commit `339f132…` |

---

## 5–7. Server restart, `/health`, full-roster flag

### Restart

- Stopped stale listener PID on `:3000`.
- Started `node server.js` from experiment branch at V2.
- Process logged: `SERVER_BUILD: courteedge-clear-side-strong-edge-membership-path-v1`.
- Sync `rehydrateLockedSlatesOnStartup()` then starved the event loop; **`/health` timed out** (curl exit 28) for >60s while port remained in Listen.

This matches the in-code warning around `server.js` listen/hydrate ordering (event-loop block during large slate rehydrate).

### Offline source verification (substitutes while `/health` blocked)

```json
{
  "FULL_ROSTER_COLLECTION_MODE": false,
  "MEMBERSHIP_QUALITY_BUILD": "courteedge-clear-side-strong-edge-membership-path-v1",
  "SAME_TEAM_OPPORTUNITY_V2_BUILD": "courteedge-team-balanced-board-no-forced-under-v1",
  "commit": "339f132d585edfd5181919cb957b7aabcacece98"
}
```

### Full-roster flag

**`FULL_ROSTER_COLLECTION_MODE = false`** (confirmed; not enabled during audit).

**Activation gate:** live `/health` buildCommit/process metadata was **not** confirmed because the endpoint did not respond.

---

## 8. Normal membership regression

| Suite | Result |
|-------|--------|
| `testClearSideStrongEdgeMembershipPathV1.js` | 17 passed |
| `testControlledBoardNoLastValidGarbageV1.js` | 16 passed |
| `testSameTeamOpportunityV2.js` (updated for no-forced-Under) | All passed |

Confirms: strong clear-side may qualify; weak fillers excluded; empty slots allowed; `LAST_VALID` not standalone block; `NO_BET` / `BOTH_SIDES_WEAK` / edge &lt; 1.5 still block; no forced Under via same-team V2.

Aug 4 sealed snapshot left immutable in tests; no completed-slate rewrite performed for this audit’s dry-run logic.

---

## 9–12. Provider credit baseline

**Limitation:** Full `POST /refresh-picks` could not be measured while `/health`/event loop was blocked.

**Executed instead:** isolated The Odds API WNBA **events** fetch (paid accounting + usage headers), cold then warm.

Artifact: `betbrain-server/_provider_baseline_v2.json`

### `NORMAL_REFRESH_COLD_OR_PARTIAL_CACHE_COST` (events only)

| Field | Value |
|-------|-------|
| Duration | 696 ms |
| Paid calls | **1** |
| Provider | `the-odds-api` |
| Label | `FETCH ODDS EVENTS (WNBA)` |
| `x-requests-used` | **2277** |
| `x-requests-remaining` | **17723** |
| `x-requests-last` | **0** (header value as returned) |
| Events returned | 4 |

### `NORMAL_REFRESH_WARM_CACHE_COST` (events only)

| Field | Value |
|-------|-------|
| Duration | 0 ms |
| Paid calls | **0** |
| Calls | `[]` (in-process event cache hit) |

**Not measured in this audit:** full board refresh player-market fanout, BDL/SportsData credits, candidate/Official counts from a complete refresh.

Treat events baseline as **partial**. A full refresh baseline remains required before Full Roster activation.

---

## 13–14. Backup durability

| Field | Value |
|-------|-------|
| Absolute path | `C:\Users\nicho\BetBrain\betbrain-server\backups\courteedge-pre-full-roster-experiment-v1` |
| Exists | Yes |
| Manifest | `MANIFEST.json` |
| Recheck | **ok=38, fail=0, missing=0, secretHits=0** |
| Create-time checksum | PASS |
| Temporary-only? | No (under repo `backups/`, not temp) |
| Disk free (C:) | ~189 GB free |
| Experiment modification | Audit did not rewrite backup payloads |

Large `data/` copies remain intentionally **uncommitted**.

---

## 15. Actual Git remote name

```text
orgin  https://github.com/King72315/betbrain-server.git (fetch)
orgin  https://github.com/King72315/betbrain-server.git (push)
```

Use **`orgin`** in rollback instructions (do not rename unless intentionally fixed later).

---

## 16. Known-test-failure classification

| Test | Failure / note | Classification | Affects Full Roster? |
|------|----------------|----------------|----------------------|
| `testOfficialSlateLifecycle` (Best-6 6/6 draft/seal) | Asserts fixed Best-6 sealing | **Obsolete test** vs variable team board | No (if unused for Official V2 path) |
| `testSameTeamOpportunityV2` old “ALWAYS flip Under” | Asserted forced Under | **Obsolete test** — **replaced** in V2 to assert demotion | Would have hidden forced-fill regression |
| `testActiveResultsSlate` / tracked-props live-date asserts | Date-bound vs live files | **Environment/date-dependent failure** | Only if production Results filter diverges — not membership selection |
| Startup `/health` hang during rehydrate | Event-loop starve | **Known baseline defect** (ops) | Blocks safe activation ops / credit measurement |

No membership-critical suite failure remained after V2 same-team test updates.

---

## 17. Completed slates

No intentional rewrite of Aug 4 / Aug 5 completed Official membership as part of this audit.  
Note: a prior server start log line reported reclaiming oversized `daily-slate-reports.json` to an empty array (ops side effect unrelated to membership seals). Aug 4 snapshot lock remained `skip_already_locked` in rehydrate logs.

---

## 18. Feature weights

No prediction/calibration weight changes in this audit. Odds header accounting and health metadata only.

---

## 19. Final checkpoint decision

# `V2_CHECKPOINT_REQUIRED`

### Why

V1 omitted dirty runtime sources that change Official board arbitration and Home sealed-membership presentation—especially `sameTeamOpportunityEngineV2.js`.

### V2 created (V1 tag untouched)

| Item | Value |
|------|-------|
| V2 commit | `339f132d585edfd5181919cb957b7aabcacece98` |
| V2 tag | `courteedge-pre-full-roster-experiment-v2` |
| V2 rollback | `rollback/courteedge-pre-full-roster-experiment-v2` |
| Experiment branch | `experiment/courteedge-full-roster-collection-v1` → V2 |
| Remote verify | experiment, rollback V2, tag V2 peel = `339f132…`; V1 tag peel still `bf581a1…` |

Docs: `COURTEDGE_PRE_FULL_ROSTER_EXPERIMENT_CHECKPOINT_V2.md`

---

## 20. May Full Roster implementation begin?

**No — activation remains blocked.**

Reasons:

1. Live `/health` did not return checkpoint metadata (event-loop block).
2. Full normal-mode refresh credit baseline was **not** captured (events-only partial baseline only).
3. `FULL_ROSTER_COLLECTION_MODE` must stay **false** until those ops gates pass on V2.

### Required before activation

1. Restart V2 with startup rehydrate that does not starve `/health` (or wait until hydrate finishes and confirm `/health`).
2. Confirm `/health`: `serverBuild`, `buildCommit=339f132…`, `fullRosterCollectionMode=false`.
3. Run one controlled normal `POST /refresh-picks?wait=1` and record full provider header/cost matrix (cold/partial vs warm).
4. Re-confirm membership regressions on that running process.

---

## Rollback commands (actual remote name `orgin`)

```bash
git fetch orgin
git checkout rollback/courteedge-pre-full-roster-experiment-v2
# emergency: git checkout courteedge-pre-full-roster-experiment-v2
# V1 preserved: courteedge-pre-full-roster-experiment-v1 @ bf581a1…
```
