# CourtEdge Pre-Activation Checkpoint Hardening Audit V1

**Audit window:** 2026-08-05 ~22:10 CT → 2026-08-06 ~04:00 UTC  
**Final checkpoint decision:** `V2_CHECKPOINT_REQUIRED`  
**Full Roster may begin?** **No**

---

## 1. Existing checkpoint identity (V1 — preserved)

| Item | Value |
|------|-------|
| Commit | `bf581a1bcbf65aba508e01cd46ce73e414a445c9` |
| Tag | `courteedge-pre-full-roster-experiment-v1` (annotated; **not moved / not retagged**) |
| Rollback branch | `rollback/courteedge-pre-full-roster-experiment-v1` |
| Experiment branch | `experiment/courteedge-full-roster-collection-v1` |
| Expected source build | `courteedge-clear-side-strong-edge-membership-path-v1` |
| Full-roster flag | `false` (never enabled during audit) |
| Remote name | **`orgin`** (actual configured remote) |

Remote URL: `https://github.com/King72315/betbrain-server.git`

---

## 2. Excluded-source audit

### 2.1 `sameTeamOpportunityEngineV2.js` — **REQUIRED BASELINE SOURCE**

| Field | Finding |
|-------|---------|
| Path | `engines/wnba/playerIntelligence/sameTeamOpportunityEngineV2.js` |
| Git status at V1 audit | Modified vs V1 commit |
| Diff summary | Secondary same-team Overs **demoted** instead of **forced Under flip** |
| Build (V2 / intended) | `courteedge-team-balanced-board-no-forced-under-v1` |
| Build (V1 commit) | Still flips secondaries to Under when “organic” |
| Runtime imports | `controlledBestSixSelector.js` → `applySameTeamOpportunityV2Layer` (Official selection path) |
| Used by V1 commit? | Yes — **old forced-Under behavior** |
| Dirty changes affect | **Side selection, team-side arbitration, ranking/confidence/risk packaging** |
| Classification | **Required baseline source** |

### 2.2 `slateScopeService.js` — **REQUIRED BASELINE SOURCE**

Prefer Official sealed membership for Home Today display. Affects Home–Results equality surface.

### 2.3 `slateLockService.js` + `directionalCalibrationObservationV1.js`

History calibration observation fields. Classification: **Required baseline source** for current History lifecycle shape (included in V2).

### 2.4 Frontend / display dirt

Preserved under `backups/wip-unrelated-dirt-pre-v2/`. Classification: **Unrelated work**.

### 2.5 Runtime JSON / fixtures / reports

Classification: **Runtime-only artifact** — must not mix into Full Roster implementation commits.

### 2.6 `.env`

Must not be committed. V2 deletes tracked `.env` from the tree going forward.

---

## 3. `sameTeamOpportunityEngineV2.js` determination

**V1 is not a complete behavioral checkpoint** for the current qualified-board policy.

- Import: Official board selection calls `applySameTeamOpportunityV2Layer`.
- V1 can emit `SECONDARY_UNDER` / forced flip.
- V2 emits `SECONDARY_DEMOTED` / `NO_FORCED_SAME_TEAM_UNDER`.

---

## 4. Clean / stashed experiment worktree

| Action | Result |
|--------|--------|
| Unrelated tracked dirt | Copied to `backups/wip-unrelated-dirt-pre-v2/` then restored where possible |
| Experiment branch | Advanced to V2 `339f132…`; later docs commit `aa119c9…` |
| Live dirt during hardening | Runtime JSON (`tracked-props.json`, slate snapshots, `locked-slates.json`, `daily-slate-reports.json`), uncommitted `server.js` ops patch (startup health window + `COURTEDGE_SKIP_STARTUP_REHYDRATE`), large untracked audit/tmp trees |
| Handling | Do **not** fold runtime mutations or frontend dirt into Full Roster implementation; stash/move before feature commits |

`FULL_ROSTER_COLLECTION_MODE` remains **false** in source and live `/health`.

---

## 5. Server process restart result

1. Stopped stale `:3000` listener.
2. Started `node server.js` with:
   - `COURTEDGE_SKIP_STARTUP_REHYDRATE=true` (avoids sync rehydrate starving the event loop)
   - `COURTEDGE_STARTUP_HEALTH_WINDOW_MS=500`
   - Uncommitted ops patch on `server.js`: yield + health window before rehydrate; optional skip env
3. Boot reached `bootPhase=ready`; `SERVER_BUILD: courteedge-clear-side-strong-edge-membership-path-v1`.
4. Single listener on port 3000 confirmed via live `/health`.

Without skip, sync `rehydrateLockedSlatesOnStartup()` still blocks the event loop after listen (known ops defect).

---

## 6. `/health` build and commit

Live capture: `_audit_health.json`

| Field | Value |
|-------|-------|
| `serverBuild` | `courteedge-clear-side-strong-edge-membership-path-v1` |
| `checkpointBuild` | `courteedge-pre-full-roster-experiment-v2` |
| `buildCommit` | `aa119c9d142e93ec7dc825f155e8a96c2597daf3` (docs commit **on top of** V2) |
| `buildBranch` | `experiment/courteedge-full-roster-collection-v1` |
| Environment | `development` |
| Port | `3000` |
| `processId` | `3248` |
| `serverStartedAt` | `2026-08-06T03:30:29.321Z` |
| `fullRosterCollectionMode` | `false` |
| `bootPhase` | `ready` |

V2 tag peel remains `339f132d585edfd5181919cb957b7aabcacece98`. V1 tag peel remains `bf581a1…`.

---

## 7. Full-roster flag state

**`FULL_ROSTER_COLLECTION_MODE = false`**

- Source defaults: `_audit_flags.txt`
- Live `/health`: `fullRosterCollectionMode: false`
- **Not enabled** during this audit

---

## 8. Normal membership regression

| Suite | Result |
|-------|--------|
| `testClearSideStrongEdgeMembershipPathV1.js` | 17 passed |
| `testControlledBoardNoLastValidGarbageV1.js` | 16 passed |
| `testSameTeamOpportunityV2.js` (no-forced-Under) | Passed |

Confirms (on source/tests): strong clear-side may qualify; weak fillers excluded; empty slots allowed; `LAST_VALID` not standalone hard block; `NO_BET` / `BOTH_SIDES_WEAK` / edge &lt; 1.5 still block; no forced same-team Under.

Fixture dry-run: `_dryrun_clear_side_strong_edge_membership_path_v1_aug5.json` (Official intended: Howard Under **17.5**, Plum Over 16.5, Nneka Under 18.5, Flau'jae Over 15.5).

---

## 9–12. Provider credit baseline

### Prior partial (events-only)

Artifact: `_provider_baseline_v2.json`

| Metric | Cold/partial | Warm |
|--------|--------------|------|
| Duration | 696 ms | 0 ms |
| Paid Odds events calls | **1** | **0** |
| `x-requests-used` | **2277** | n/a |
| `x-requests-remaining` | **17723** | n/a |
| `x-requests-last` | **0** | n/a |
| Events | 4 | 4 (cache) |

### Full normal refresh (tomorrow scope, after Aug 5 lock)

Artifact: `_audit_provider_refresh_full.json`, `_audit_provider_usage_headers.json`

| Metric | Cold/partial | Warm |
|--------|--------------|------|
| Duration | **70489 ms** | **57815 ms** |
| HTTP | 200 ok | 200 ok |
| Games | 4 (1 today / 3 tomorrow) | same |
| Candidates | today 4 / tomorrow 17 | same |
| Selected tomorrow WNBA | 3 | 3 |
| Refresh response `usageHeaders` | `{}` | `{}` |

**Odds credit headers were not available on the refresh response or console.** In-process `recordPaidApiCall` is not dumped without an authenticated internal endpoint. Therefore:

| Baseline key | Value |
|--------------|-------|
| `NORMAL_REFRESH_COLD_OR_PARTIAL_CACHE_COST` | **null** (headers missing for full refresh); events-only paid cost documented above as partial |
| `NORMAL_REFRESH_WARM_CACHE_COST` | **null** (headers missing); warm was ~18% faster (57.8s vs 70.5s) |

Console proxy (BallDontLie URL lines only; Odds success path does not log URLs):

| | Cold | Warm |
|-|------|------|
| BDL logged HTTP | 114 | 102 |
| BDL player/stats cache hits logged | 104 | 154 |
| SportsData | startup 401 only (disabled in policy) | — |
| Odds `x-requests-*` | **not observed** | **not observed** |

**Do not treat duration or BDL console counts as Odds credit cost.**

---

## 13. Backup checksum result

Path: `C:\Users\nicho\BetBrain\betbrain-server\backups\courteedge-pre-full-roster-experiment-v1`

| Check | Result |
|-------|--------|
| Directory exists | Yes |
| `MANIFEST.json` | Yes |
| Rehash | **39/39 PASS**, fail=0, missing=0 |
| Secrets in verify pass | 0 hits |
| Artifact | `_audit_backup.json` |

---

## 14. Backup durability result

| Check | Result |
|-------|--------|
| Absolute path (not temp-only) | `...\betbrain-server\backups\courteedge-pre-full-roster-experiment-v1` |
| Survives normal cache cleanup | Yes (under `backups/`, not temp/cache dirs) |
| Modified by experiment code | Audit did not rewrite backup payloads; rehash read-only |
| Disk free (earlier audit) | ~189 GB free on C: |
| Uploaded to Git | No (intentional) |

---

## 15. Actual Git remote name

```text
orgin	https://github.com/King72315/betbrain-server.git (fetch)
orgin	https://github.com/King72315/betbrain-server.git (push)
```

Use **`orgin`** in all rollback instructions. Do not rename unless intentionally fixed later.

---

## 16. Known-test-failure classification

| Test / issue | Failure / note | Classification | Affects Full Roster? |
|--------------|----------------|----------------|----------------------|
| `testOfficialSlateLifecycle` (Best-6 6/6) | Fixed Best-6 sealing | **Obsolete test** | No if unused for Official V2 path |
| Old same-team “ALWAYS flip Under” | Asserted forced Under | **Obsolete** — replaced in V2 | Would hide forced-fill regression |
| Live-date Results / tracked-props asserts | Date-bound vs live files | **Environment/date-dependent** | Only if production Results filter diverges |
| Startup `/health` hang without skip | Event-loop starve on rehydrate | **Known baseline defect** (ops) | Blocks safe activation ops |
| Refresh mutates sealed snapshot metadata SHA | `MEMBERSHIP_PRESERVED_SHA_METADATA_DRIFT` | **Known baseline defect** | Historical mutation risk for byte-identity seals |
| Live Aug 5 Official = 16-prop pre-repair vs clear-side 4 | Membership conflict | **Active production / state defect** for Results membership | **Yes — activation stop** |

No membership-unit-suite failure remained after V2 same-team test updates; **live Aug 5 seal state is a critical stop**.

---

## 17. Confirmation no completed slate changed

| Slate | Finding |
|-------|---------|
| Aug 4 Official prop IDs | Unchanged through lock + refresh |
| Aug 4 snapshot SHA | **Drifted** (metadata/`officialSeal` envelope during alreadySealed admit) |
| Aug 5 | Audit **re-registered** immutable lock from **pre-repair 16-prop** snapshot to allow a safe refresh. That board **does not match** clear-side intended Official (4 props; Howard line 17.5 vs 16.5). No sealed clear-side 4-prop artifact found to restore (`_audit_aug5_restore_attempt.json`). |
| Aug 6 | Tomorrow slate sealed during cold refresh (3 props) — **new** future slate, not Aug 4/5 rewrite of Official IDs |

**Cannot confirm** “no completed slate changed” for Aug 5 relative to the intended clear-side Official board. Prop **IDs** of the pre-repair seal were preserved through refresh; **intended** clear-side membership was never present as a sealed artifact in this workspace.

---

## 18. Confirmation no feature weights changed

No prediction/calibration feature-weight changes in this audit. Ops-only: `/health` metadata, Odds header logging (V2), startup health window / optional rehydrate skip (uncommitted local patch).

---

## 19. Final checkpoint decision

# `V2_CHECKPOINT_REQUIRED`

### Why V1 failed

Excluded dirty sources — especially `sameTeamOpportunityEngineV2.js` — change Official arbitration vs the intended no-forced-Under board. V1 tag must stay at `bf581a1…`.

### V2 created (V1 untouched)

| Item | Value |
|------|-------|
| V2 commit | `339f132d585edfd5181919cb957b7aabcacece98` |
| V2 tag | `courteedge-pre-full-roster-experiment-v2` |
| V2 rollback | `rollback/courteedge-pre-full-roster-experiment-v2` |
| Docs | `COURTEDGE_PRE_FULL_ROSTER_EXPERIMENT_CHECKPOINT_V2.md` |

### Why activation is still blocked after V2

V2 exists, but verification gates for “V2 verified / Full Roster may begin” are **not** met:

1. Live `/health` `buildCommit` is docs HEAD `aa119c9…`, not V2 peel `339f132…` (and local uncommitted `server.js` ops patch).
2. Full refresh Odds **credit headers missing** → cold/warm **cost baselines null** for paid Odds.
3. **Active Aug 5 membership conflict** (16-prop Best-6-era seal vs clear-side 4-prop intended Official) — activation stop condition (membership / Results integrity).
4. Sealed snapshot **SHA metadata drift** on Aug 4/5 during alreadySealed refresh path.
5. Startup rehydrate still requires skip env for responsive `/health`.

---

## 20. Whether Full Roster implementation may begin

**No.**

`FULL_ROSTER_COLLECTION_MODE` must stay **false**.

Activation remains blocked until:

1. Aug 5 Official Results membership is reconciled to the intended clear-side sealed board (or an explicit approved sealed artifact), without inventing props from dry-run alone.
2. Server runs from verified V2 (or successor) commit with matching `/health` `buildCommit` / `serverBuild` / `fullRosterCollectionMode=false`.
3. One controlled normal refresh records **actual** provider usage headers → non-null `NORMAL_REFRESH_COLD_OR_PARTIAL_CACHE_COST` and `NORMAL_REFRESH_WARM_CACHE_COST`.
4. Sealed-slate admit path no longer mutates completed Official membership (and ideally not seal metadata SHA without cause).
5. No remaining active critical failures: membership corruption, Home/Results divergence, date contamination, duplicate tracking, historical mutation, provider-credit multiplication.

---

## Rollback commands (remote `orgin`)

```bash
git fetch orgin
git checkout rollback/courteedge-pre-full-roster-experiment-v2
# emergency peel: git checkout courteedge-pre-full-roster-experiment-v2
# V1 preserved: courteedge-pre-full-roster-experiment-v1 @ bf581a1…
```

---

## Evidence artifacts

| File | Purpose |
|------|---------|
| `_audit_health.json` | Live `/health` |
| `_audit_git.txt` | Remotes, tags, HEAD |
| `_audit_flags.txt` | Full-roster flag source check |
| `_audit_backup.json` | Backup rehash 39/39 |
| `_provider_baseline_v2.json` | Odds events cold/warm headers |
| `_audit_provider_refresh_full.json` | Tomorrow-scope cold/warm refresh |
| `_audit_provider_usage_headers.json` | Header-missing + BDL console proxy |
| `_audit_aug5_lock.json` | Pre-repair Aug 5 lock for refresh safety |
| `_audit_aug5_membership_conflict.json` | 16 vs 4 Official conflict |
| `_audit_aug5_restore_attempt.json` | No clear-side sealed artifact found |
| `_audit_sealed_immutable_after_refresh.json` | SHA drift + membership ID preserve |
