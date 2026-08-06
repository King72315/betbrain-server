# CourtEdge Pre–Full-Roster Experiment Checkpoint V2

**Checkpoint name:** `courteedge-pre-full-roster-experiment-v2`  
**Why V2:** V1 omitted dirty runtime sources that affect qualified-board behavior, especially `sameTeamOpportunityEngineV2.js` (no-forced-Under arbitration) and Home sealed-membership preference in `slateScopeService.js`.  
**V1 preserved unchanged:** tag `courteedge-pre-full-roster-experiment-v1` @ `bf581a1bcbf65aba508e01cd46ce73e414a445c9`

| Item | Value |
|------|-------|
| Parent / previous checkpoint | V1 `bf581a1…` |
| V2 commit | `339f132d585edfd5181919cb957b7aabcacece98` |
| Annotated tag | `courteedge-pre-full-roster-experiment-v2` |
| Rollback branch | `rollback/courteedge-pre-full-roster-experiment-v2` |
| Experiment branch | `experiment/courteedge-full-roster-collection-v1` (repointed to V2) |
| Source build | `courteedge-clear-side-strong-edge-membership-path-v1` |
| Full-roster flag | `false` |
| Remote | `orgin` (actual configured name) |

## Included beyond V1

- `engines/wnba/playerIntelligence/sameTeamOpportunityEngineV2.js` — demote secondary Overs; **no forced Under flips**
- `services/slateScopeService.js` — prefer Official sealed membership on Home Today
- `services/slateLockService.js` + `directionalCalibrationObservationV1.js` — History calibration observation fields
- `/health` fields: `buildCommit`, `buildBranch`, `serverStartedAt`, `processId`, `checkpointBuild=v2`
- Odds paid-call accounting captures The Odds API usage headers (no membership/weight changes)

## Rollback

```bash
git fetch orgin
git checkout rollback/courteedge-pre-full-roster-experiment-v2
# emergency: git checkout courteedge-pre-full-roster-experiment-v2
```

Do not enable `FULL_ROSTER_COLLECTION_MODE` on this checkpoint.
