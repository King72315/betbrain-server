# CourtEdge Aug5 Membership Quarantine — Final V3 Checkpoint V1 Report

**Build:** `courteedge-aug5-membership-quarantine-final-v3-checkpoint-v1`  
**Final decision:** `FULL_ROSTER_IMPLEMENTATION_UNBLOCKED`  
**Flag remains:** `FULL_ROSTER_COLLECTION_MODE=false` until separate experiment activation

---

## Required returns (1–35)

| # | Item | Value |
|---|------|-------|
| 1 | August 5 original lock timestamp | `2026-08-05T03:08:09.176Z` (`officialSealedAt` `2026-08-05T03:08:08.171Z`) |
| 2 | Wrong relock timestamp | `2026-08-06T03:46:12.962Z` |
| 3 | Four-prop reconstruction timestamp | Dry-run mtime `2026-08-05T06:13:21.759Z` (not an Official seal) |
| 4 | Earliest game start time | `2026-08-05T23:00:00Z` |
| 5 | Valid pre-tip four-prop Official seal? | **No.** Dry-run only; `retroactiveOfficialCorrectionAllowed=false` |
| 6 | Incorrect 16 identities | See incident `side-by-side-identity-comparison.json` / 16-prop snapshot (Best-6 era board including Howard Under **16.5**) |
| 7 | Intended four identities | Howard Under **17.5**; Plum Over 16.5; Nneka Under 18.5; Flau’jae Over 15.5 |
| 8 | Incident-backup location | `C:\Users\nicho\BetBrain\betbrain-server\backups\incidents\courteedge-aug5-membership-relock-incident-v1\` |
| 9 | Incident SHA result | `MANIFEST.json` **PASS** (content files checksummed) |
| 10 | Integrity-invalidation fields | `membershipIntegrityStatus=INVALIDATED`; `officialRecordEligible=false`; `calibrationEligible=false`; `membershipIncidentCode=AUG5_WRONG_BOARD_RELOCK`; `incorrectMembershipCount=16`; `intendedReconstructionCount=4`; `retroactiveOfficialCorrectionAllowed=false`; `diagnosticGradingAllowed=true`; incident path + `invalidatedByBuild` stamped |
| 11 | Official-record exclusion | Aug 5 Official W-L excluded (`officialRecord` empty for clean record; diagnostic grades retained) |
| 12 | Calibration-exclusion | `calibrationEligible=false`; calibration recommendations skipped |
| 13 | Relock root cause | Missing active Aug 5 snapshot → ops copied **pre-repair 16-prop** Best-6 board and re-registered `immutableOfficial` without lineage gates |
| 14 | Relock protection files | `services/slateMembershipIntegrityV1.js`, `slateLockService.js`, `slateRestoreService.js`, `dailySlateReportService.js`, `server.js` (`/slates/locked`, `/history-archives`) |
| 15 | Health startup result | `live=true`, `ready=true`, `rehydrationStatus=ready`, `/health` responsive with `COURTEDGE_SKIP_STARTUP_REHYDRATE=true` |
| 16 | Runtime commit | Tag tip / experiment HEAD: `2db183ccb63fe6d07a51f35f2d99686a7b7bc35d` |
| 17 | Checkpoint base commit | Quarantine body `c71a52e0c42c3f280407f6650dd42fdb7a0ac526`; tag peel `2db183c…` (V3 tip). Runtime vs checkpoint not conflated in `/health` fields |
| 18 | Full-roster flag | `false` |
| 19 | Full cold/partial provider calls | **13** |
| 20 | Full reported credit cost (cold) | **12** (`x-requests-last` sum; events last=0 counted as call with cost 0) |
| 21 | Warm-cache provider calls | **12** (+1 events cache hit) |
| 22 | Warm reported credit cost | **12** |
| 23 | Usage-header capture | **Available** on Odds path via `oddsGet` → `recordPaidApiCall` → refresh `providerUsage` |
| 24 | Normal market count | Point-props requests: 3 events (cold/warm); see baseline `byEndpoint` |
| 25 | Normal dual-side count | Clear-side suite / membership path verified in unit tests (17/17); live tomorrow refresh used normal qualified path |
| 26 | Normal qualified membership count | Tomorrow-scope Official seal path active; Aug 5 **not** used as clean baseline (16 corrupted + invalidated) |
| 27 | Tests | Quarantine **14 passed / 0 failed**; clear-side strong-edge **17 passed / 0 failed** |
| 28 | V3 commit | `2db183ccb63fe6d07a51f35f2d99686a7b7bc35d` |
| 29 | V3 tag | `courteedge-pre-full-roster-experiment-v3` |
| 30 | V3 rollback branch | `rollback/courteedge-pre-full-roster-experiment-v3` |
| 31 | Remote verification | Local tag peel = remote tag^{} = remote rollback = remote experiment = `2db183c…` (`_v3_remote_verify.txt`) |
| 32 | Experiment branch base | `experiment/courteedge-full-roster-collection-v1` @ V3 tip |
| 33 | V1 and V2 untouched | V1 `bf581a1…`; V2 `339f132…` — **unchanged** |
| 34 | Feature weights changed | **No** |
| 35 | Final decision | **`FULL_ROSTER_IMPLEMENTATION_UNBLOCKED`** |

---

## Timeline evidence (no retroactive Official 4-prop)

```text
Original lock (16-prop Best-6)     2026-08-05T03:08:09.176Z
Clear-side dry-run mtime           2026-08-05T06:13:21.759Z  → INTENDED_CLEAR_SIDE_RECONSTRUCTION only
Earliest tip                       2026-08-05T23:00:00Z
Wrong relock (pre-repair restore)  2026-08-06T03:46:12.962Z
```

Original 16-prop lock **was** before tip, but it is the **corrupted / obsolete** membership under quarantine — not replaced by the four-prop dry-run.

---

## Provider baseline (tomorrow scope; FULL_ROSTER=false)

| | Cold / partial | Warm |
|--|----------------|------|
| Provider calls | 13 | 12 |
| Reported Odds credit | 12 | 12 |
| Cache hits | 0 | 1 (events) |
| Wall ms | 111900 | 56374 |
| Headers available | true | true |

Endpoint mix (cold): events 1 (cost 0), point props 3 (cost 3), spreads 6 (cost 6), totals 3 (cost 3).

---

## Hard protection

`STALE_MEMBERSHIP_LINEAGE_RELOCK_BLOCKED` rejects:

- Obsolete Best-6 / high-count unlineaged payloads as **new** Official
- Home display → membership
- Results/tracked rows → lock source
- Immutable Official hash mismatch on restore

---

## Rollback (`orgin`)

```bash
git fetch orgin
git checkout rollback/courteedge-pre-full-roster-experiment-v3
# or: git checkout courteedge-pre-full-roster-experiment-v3
```

V1/V2 preserved:

- `courteedge-pre-full-roster-experiment-v1` → `bf581a1…`
- `courteedge-pre-full-roster-experiment-v2` → `339f132…`

---

## Activation note

Implementation of Full Roster Collection Mode may **begin from this V3 checkpoint**.  
Do **not** set `FULL_ROSTER_COLLECTION_MODE=true` until the separate experiment implementation step deliberately enables it on a future unsealed slate.
