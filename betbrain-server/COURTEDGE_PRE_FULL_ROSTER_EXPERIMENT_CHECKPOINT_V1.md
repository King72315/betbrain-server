# CourtEdge Pre–Full-Roster Experiment Checkpoint V1

**Checkpoint name:** `courteedge-pre-full-roster-experiment-v1`  
**Timezone:** America/Chicago (CT)  
**Created:** 2026-08-05 ~21:55–22:15 CT  
**Purpose:** Immutable rollback point before any Full Roster Collection Mode work.

---

## Identifiers (filled after git ops)

| Item | Value |
|------|-------|
| Main working branch | `betbrain-v2-rebuild` |
| Remote name | `orgin` |
| Previous HEAD (before checkpoint commit) | `3fa90ba182bc981711fef8b649add6372e8e6a1d` |
| Checkpoint commit | `bf581a1bcbf65aba508e01cd46ce73e414a445c9` |
| Annotated tag | `courteedge-pre-full-roster-experiment-v1` |
| Rollback branch | `rollback/courteedge-pre-full-roster-experiment-v1` |
| Experiment branch | `experiment/courteedge-full-roster-collection-v1` |

Branch structure:

```text
rollback/courteedge-pre-full-roster-experiment-v1
                |
                └── experiment/courteedge-full-roster-collection-v1
```

---

## Production / runtime build snapshot

| Field | Value |
|-------|-------|
| Source `SERVER_BUILD` | `courteedge-clear-side-strong-edge-membership-path-v1` |
| Checkpoint label | `courteedge-pre-full-roster-experiment-v1` |
| Local `/health` before restart | Still reported prior process build `courteedge-controlled-board-no-last-valid-garbage-v1` (stale Node process) |
| Local Node | `v24.15.0` |
| Environment | `development` (from health config) |
| Port | `3000` (local) |
| Durable store | filesystem mirror (Postgres not configured) |
| Production deployment commit | **Not assumed identical to local** — verify separately before prod cutover |

Do not treat the pre-restart `/health` build string as the checkpoint source of truth. Source-of-truth is the checkpoint commit + tag.

---

## Feature-flag snapshot

`FULL_ROSTER_COLLECTION_MODE = false` (default; env unset)

Source: `engines/topProps/courtEdgeFeatureFlagsV1.js`

| Flag | Default |
|------|---------|
| FULL_ROSTER_COLLECTION_MODE | **false** |
| TEAM_PAIR_MODE | true |
| SELECTION_INTEGRITY | true |
| DIRECTIONAL_CALIBRATION | true |
| DATE_VERIFICATION | true |
| MEMBERSHIP_LOCKING | true |
| RESULTS_LIFECYCLE | true |
| HISTORY_LIFECYCLE | true |
| PROVIDER_CACHING | true |
| SCHEDULER_REFRESH | true (unless `COURTEDGE_SCHEDULER_ENABLED=false`) |
| NO_TOP_TAB | true |
| NO_BEST_SIX | true |
| NO_LAB_TAB | true |
| NO_LAST_VALID_HARD_BLOCK | true |
| CLEAR_SIDE_STRONG_EDGE_MEMBERSHIP | true |

Full-roster mode is **not** enabled in this checkpoint.

---

## Current selection rules (normal qualified board)

- Valid markets evaluated locally
- Over and Under evaluated independently
- Minimum Official directional edge: **1.5**
- Preferred edge: **3.0** (ranking/safety only)
- No forced team-side fill
- `TEAM_SIDE_LAST_VALID` is diagnostic/ranking only — not a standalone hard block
- `NO_BET`, `BOTH_SIDES_WEAK`, `UNCERTAINTY` block Official membership
- Invalid side flips block membership
- Unsupported high-blowout Overs block membership
- Unconfirmed-availability Overs block membership
- Weak team slots may remain empty (0–4 props per game)

---

## Current UI / lifecycle structure

- No Top tab
- No Best 6 / Best 6 Overall product surface
- No Lab tab
- No global prop cap
- Home ranked safest → riskiest
- Home membership = Results membership
- Completed Results → History directly
- Detailed analysis attached per History prop

---

## Current data structure / paths

| Asset | Path |
|-------|------|
| Tracked props / Results membership | `betbrain-server/tracked-props.json` |
| Slate snapshots | `betbrain-server/slate-snapshots/` |
| Active bundles | `betbrain-server/active-bundles/` |
| Three-slate blocks | `betbrain-server/three-slate-blocks-v2.json` |
| Board cache | `betbrain-server/board-cache.json` (runtime; oversized; not in checkpoint commit) |
| Durable mirror | `betbrain-server/.durable-mirror-v1/` |
| Checkpoint backup | `betbrain-server/backups/courteedge-pre-full-roster-experiment-v1/` |
| Clear-side report | `betbrain-server/COURTEDGE_CLEAR_SIDE_STRONG_EDGE_MEMBERSHIP_PATH_V1_REPORT.md` |

Canonical membership model: `controlled-best-board-v2`  
Canonical prop identity: slateDate + event + team + player + side + line (+ boardSelectionId when stamped)

---

## Provider baseline

No new paid provider calls were made to create this checkpoint.

See: `backups/courteedge-pre-full-roster-experiment-v1/provider-credit-baseline.json`

Use the next normal refresh’s credit/request headers as the delta baseline when enabling full-roster mode later.

---

## Test results (checkpoint gate)

### Required suites — PASS

| Suite | Result |
|-------|--------|
| `testClearSideStrongEdgeMembershipPathV1.js` | 17 passed |
| `testControlledBoardNoLastValidGarbageV1.js` | 16 passed |
| `testControlledBestBoardPairSelectionV2.js` | 15 passed |
| `testControlledBestBoardDateVerificationV1.js` | 15 passed |
| `testCanonicalControlledBoardSealingPathV3.js` | 12 passed |
| `testVariableTeamBoardHomeHistoryLockV1.js` | PASS |
| `testBestSixSelectionIntegrityV1.js` | 10 passed |
| `testDirectionalCalibrationV1.js` | 12 passed |
| `testLifecycleIntegrity.js` | 6/6 passed |
| `testSealedHomeMembershipDisplayV1.js` | 9 passed |
| `testLineIntegrityV1.js` | PASS |
| `testHistoryThreeSlateGroupsV1.js` | 5 passed |

### Known defects intentionally left unchanged

| Suite | Status | Note |
|-------|--------|------|
| `testOfficialSlateLifecycle.js` | FAIL (Best-6 era) | Expects fixed 6-prop draft/seal semantics; product is variable team board. Not a clear-side regression. |
| `testActiveResultsSlate.js` / parts of tracked-props lifecycle | FAIL vs live data dates | Environment/date-bound; not membership-path regressions. |

Historical immutability for sealed Aug 4 snapshot is covered by clear-side / no-LAST_VALID tests (file unchanged).

---

## Active-slate handling

- Do **not** rewrite completed slates for this checkpoint.
- Do **not** convert an active/partially graded slate to full-roster mode.
- Full Roster Collection Mode may begin only on a **future unsealed** slate.
- Preserve current Results/History under normal qualified-board rules.

---

## Data backup

Location: `betbrain-server/backups/courteedge-pre-full-roster-experiment-v1/`  
Manifest: `MANIFEST.json` (SHA-256 per file)  
Checksum verification at creation: **PASS**  
Secrets excluded: `.env`, API keys, tokens (secret-name scan)

---

## Exact rollback steps

1. Disable full-roster: ensure `FULL_ROSTER_COLLECTION_MODE` is unset/false.
2. Stop experimental refresh jobs / disable experiment scheduler toggles.
3. **Preserve** experiment Results, History packets, credit-audit logs, and calibration reports (do not delete).
4. Check out preferred target:
   - `git fetch orgin`
   - `git checkout rollback/courteedge-pre-full-roster-experiment-v1`
   - Emergency: `git checkout courteedge-pre-full-roster-experiment-v1` (annotated tag)
5. Install deps from checkpoint lockfile: `npm ci` (or `npm install` if no lock drift policy).
6. Run checkpoint regression suites listed above (PASS set).
7. Deploy the checkpoint commit to the target environment.
8. Verify `/health`: `serverBuild` = `courteedge-clear-side-strong-edge-membership-path-v1`, `fullRosterCollectionMode` = false.
9. Verify normal qualified-board mode (variable team slots; no Top/Best6/Lab).
10. Verify historical research data still present.
11. Verify provider request behavior vs pre-experiment baseline (no floodgate).

Preferred rollback target: `rollback/courteedge-pre-full-roster-experiment-v1`  
Emergency detached target: tag `courteedge-pre-full-roster-experiment-v1`

---

## Post-rollback data policy

Rolling back **code** must not delete full-roster experiment data. Preserve Results/History/credit audits/reports; disable collection mode; return production to this checkpoint; build upgrades on:

`upgrade/courteedge-post-full-roster-calibration-v1`

---

## Upgrade path after experiment

```text
Stable checkpoint
→ Full-roster experiment branch
→ Collect and analyze results
→ Return to stable checkpoint
→ Apply only proven upgrades on upgrade branch
```

---

## Acceptance checklist

1. Clean checkpoint commit (no secrets) — see verification section  
2. Annotated tag local + remote → same commit  
3. Rollback branch local + remote → same commit  
4. Experiment branch starts at checkpoint commit  
5. Baseline build string in source  
6. `FULL_ROSTER_COLLECTION_MODE = false`  
7. Strong clear-side props may seal; weak fillers excluded; no forced fills  
8. No Top / Best 6 / Lab; Home = Results  
9. Completed slates unchanged by checkpoint ops  
10. Backup manifest + checksums PASS  
11. Local rollback rehearsal: checkout target + run key tests  

---

## Confirmation

- Full-roster mode remains **disabled**.
- Remote verification complete: local commit, annotated tag peel, rollback branch, and experiment branch all resolve to `bf581a1bcbf65aba508e01cd46ce73e414a445c9` on remote `orgin`.
- Rollback rehearsal (key suites on checkpoint HEAD): clear-side 17/17 PASS; home/history lock 16/16 PASS; `FULL_ROSTER_COLLECTION_MODE=false`.
- Aug 4 sealed snapshot unchanged (`propCount: 4`, `lockedAt: 2026-08-04T03:03:13.952Z`).
- Working branch for future experiment work: `experiment/courteedge-full-roster-collection-v1`.
- Rollback branch left untouched at the checkpoint commit.
- Experiment may now begin safely on a **future unsealed** slate only — do not enable full-roster on an active/partial slate.

## Post-push verification log

| Check | Result |
|-------|--------|
| Annotated tag | PASS (`tag` object + peel `bf581a1…`) |
| Remote tag peel | PASS |
| Remote rollback branch | PASS |
| Remote experiment branch | PASS |
| Four-way hash match | PASS |
| Secret scan of commit | PASS (no `.env` / keys) |
| Backup checksums | PASS |
| Unrelated dirty files excluded | PASS (left unstaged) |

