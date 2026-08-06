# CourtEdge Aug5 Membership Quarantine — Final V3 Checkpoint Report

**Report:** `COURTEDGE_AUG5_MEMBERSHIP_QUARANTINE_FINAL_V3_CHECKPOINT_V1_REPORT.md`  
**Build:** `courteedge-aug5-membership-quarantine-final-v3-checkpoint-v1`  
**Timezone:** America/Chicago (CT)  
**Prepared:** 2026-08-05 / 2026-08-06 CT  

**Purpose:** Final stable CourtEdge checkpoint before full-roster collection experiment, with August 5 Official membership quarantined (invalidated; prop identities not rewritten).

---

## 35 return fields

| # | Field | Value |
|---|-------|-------|
| 1 | `CHECKPOINT_TAG` | `courteedge-pre-full-roster-experiment-v3` |
| 2 | `CHECKPOINT_BUILD` | `courteedge-pre-full-roster-experiment-v3` |
| 3 | `SERVER_BUILD` | `courteedge-aug5-membership-quarantine-final-v3-checkpoint-v1` |
| 4 | `V3_COMMIT_SHA` | `6726ee88988192e031ad393a65d7721072d025d6` |
| 5 | `CHECKPOINT_BASE_COMMIT` | `6726ee88988192e031ad393a65d7721072d025d6` (self-peel after amend) |
| 6 | `ROLLBACK_BRANCH` | `rollback/courteedge-pre-full-roster-experiment-v3` |
| 7 | `EXPERIMENT_BRANCH` | `experiment/courteedge-full-roster-collection-v1` |
| 8 | `REMOTE_NAME` | `orgin` |
| 9 | `V1_TAG_PEEL` | `bf581a1bcbf65aba508e01cd46ce73e414a445c9` (unchanged) |
| 10 | `V2_TAG_PEEL` | `339f132d585edfd5181919cb957b7aabcacece98` (unchanged) |
| 11 | `FULL_ROSTER_COLLECTION_MODE` | `false` (not enabled) |
| 12 | `HEALTH_BOOT_PHASE` | `ready` |
| 13 | `HEALTH_LIVE` | `true` |
| 14 | `HEALTH_READY` | `true` |
| 15 | `HEALTH_SERVER_BUILD_OK` | `true` (contains `aug5-membership-quarantine`) |
| 16 | `AUG5_MEMBERSHIP_INTEGRITY_STATUS` | `INVALIDATED` |
| 17 | `AUG5_OFFICIAL_RECORD_ELIGIBLE` | `false` |
| 18 | `AUG5_CALIBRATION_ELIGIBLE` | `false` |
| 19 | `AUG5_PROP_COUNT` | `16` (pre-repair identities preserved; not rewritten) |
| 20 | `AUG5_PROPS_REWRITTEN` | `false` |
| 21 | `AUG5_IDENTITIES_UNCHANGED_AFTER_REFRESH` | `true` |
| 22 | `AUG5_INCIDENT_ARCHIVE_PRESENT` | `true` (`backups/incidents/courteedge-aug5-membership-relock-incident-v1`) |
| 23 | `QUARANTINE_V3_TESTS` | `14 passed, 0 failed` |
| 24 | `CLEAR_SIDE_STRONG_EDGE_TESTS` | `17 passed, 0 failed` |
| 25 | `APPLY_AUG5_INVALIDATION` | `ok=true`, propsRewritten=false |
| 26 | `NORMAL_FULL_REFRESH_PROVIDER_CALLS` | `13` |
| 27 | `NORMAL_FULL_REFRESH_REPORTED_CREDIT_COST` | `12` |
| 28 | `NORMAL_WARM_REFRESH_PROVIDER_CALLS` | `12` |
| 29 | `NORMAL_WARM_REFRESH_REPORTED_CREDIT_COST` | `12` |
| 30 | `COLD_REFRESH_WALL_MS` | `111900` (providerUsage.refreshDurationMs `85737`) |
| 31 | `WARM_REFRESH_WALL_MS` | `56374` (providerUsage.refreshDurationMs `33566`; events `fromCache=true` ×1) |
| 32 | `PROVIDER_BASELINE_SCOPE` | `POST /refresh-picks?wait=1&scope=tomorrow&includeNba=false&chainTomorrow=false` (Aug 5 **not** used as clean baseline) |
| 33 | `FEATURE_WEIGHTS_CHANGED` | `false` |
| 34 | `V1_V2_TAGS_MOVED` | `false` (forbidden; peels verified unchanged) |
| 35 | `FINAL_DECISION` | `FULL_ROSTER_IMPLEMENTATION_UNBLOCKED` |

---

## Final decision

# `FULL_ROSTER_IMPLEMENTATION_UNBLOCKED`

All V3 activation gates for implementation prep passed:

1. Aug 5 membership quarantined (`INVALIDATED`); Official/calibration ineligible; prop identities not rewritten.
2. Quarantine suite 14/14 and clear-side strong-edge suite 17/17 green.
3. `/health`: `bootPhase=ready`, `live=true`, `fullRosterCollectionMode=false`, `serverBuild` contains `aug5-membership-quarantine`.
4. Normal tomorrow-scope cold/warm refresh recorded non-null Odds usage headers and credit costs.
5. Aug 5 prop identities unchanged after refresh (count 16; first IDs match pre-refresh).
6. V1/V2 tags left untouched; V3 is additive.

**Still required before enabling the flag:** keep `FULL_ROSTER_COLLECTION_MODE=false` until the experiment is deliberately started on this checkpoint. Startup responsive `/health` still uses `COURTEDGE_SKIP_STARTUP_REHYDRATE=true` for local ops.

---

## Test evidence

| Script | Result |
|--------|--------|
| `scripts/applyAug5MembershipInvalidationV1.js` | ok; 16→16; INVALIDATED; propsRewritten=false |
| `scripts/testAug5MembershipQuarantineV3CheckpointV1.js` | 14 passed, 0 failed |
| `scripts/testClearSideStrongEdgeMembershipPathV1.js` | 17 passed, 0 failed |

Artifacts: `_v3_tests.json`, `_v3_health.json`, `_v3_provider_baseline.json` (runtime; not committed).

---

## Provider baseline (normal membership path)

Aug 5 was **not** used as a clean baseline. Cold then warm full refresh on **tomorrow** scope:

| Metric | Cold | Warm |
|--------|------|------|
| Provider calls | 13 | 12 |
| Reported credit cost | 12 | 12 |
| Cache hits | 0 | 1 (events) |
| Wall ms | 111900 | 56374 |
| usageHeadersAvailable | true | true |
| fullRosterCollectionMode | false | false |

Warm path caches Odds **events** only; point-props/spreads/totals still paid on warm run in this environment.

---

## August 5 quarantine policy

- Status: `INVALIDATED`
- `officialRecordEligible=false`, `calibrationEligible=false`, `diagnosticGradingAllowed=true`
- `retroactiveOfficialCorrectionAllowed=false`
- Intended clear-side reconstruction archived (4 props) under incident backup — **not** written into Official identities
- Incident: `backups/incidents/courteedge-aug5-membership-relock-incident-v1/`

---

## Git / rollback

```bash
git fetch orgin
git checkout rollback/courteedge-pre-full-roster-experiment-v3
# emergency peel:
git checkout courteedge-pre-full-roster-experiment-v3
```

Preserved ancestors:

- V1 `courteedge-pre-full-roster-experiment-v1` → `bf581a1bcbf65aba508e01cd46ce73e414a445c9`
- V2 `courteedge-pre-full-roster-experiment-v2` → `339f132d585edfd5181919cb957b7aabcacece98`

Remote: `orgin` (`https://github.com/King72315/betbrain-server.git`).

---

## Included sources (checkpoint commit)

- `services/slateMembershipIntegrityV1.js` (new)
- `services/slateLockService.js`, `slateRestoreService.js`, `dailySlateReportService.js`, `courtEdgeStateIntegrityV1.js`, `oddsService.js`
- `server.js`, `engines/topProps/courtEdgeFeatureFlagsV1.js`
- `scripts/applyAug5MembershipInvalidationV1.js`, `scripts/testAug5MembershipQuarantineV3CheckpointV1.js`
- Incident archive under `backups/incidents/courteedge-aug5-membership-relock-incident-v1/`
- Integrity-stamped `locked-slates.json` + `slate-snapshots/2026-08-05.json` (identities unchanged)
- This report + related `COURTEDGE_*` checkpoint docs

Excluded: `.env`, large `data/`, poll/tmp JSON dirt, `_v3_*.json` runtime captures, unrelated slate-snapshot churn.
