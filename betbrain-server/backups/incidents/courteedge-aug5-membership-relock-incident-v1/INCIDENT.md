# Incident: CourteEdge Aug 5 membership relock (v1)

**Incident ID:** `courteedge-aug5-membership-relock-incident-v1`  
**Slate date:** `2026-08-05`  
**Archive path:** `backups/incidents/courteedge-aug5-membership-relock-incident-v1/`  
**Classification:** Immutable forensic archive (copies only; originals not deleted)

## Summary

On 2026-08-05 the slate was originally locked as a **16-prop Best-6 / full controlled best board**. After a repair window left the active Aug 5 snapshot missing, a **wrong relock** on 2026-08-06 restored membership from the **pre-repair** 16-prop snapshot. Separately, a **four-prop clear-side Official reconstruction** exists only as a **dry-run artifact** (`INTENDED_CLEAR_SIDE_RECONSTRUCTION`) — it was never a pre-tip Official seal.

## Timeline (UTC)

| Event | Timestamp | Notes |
| --- | --- | --- |
| Original Official seal (snapshot) | `2026-08-05T03:08:08.171Z` | `officialSealedAt` on lock registry entry |
| Original lock | `2026-08-05T03:08:09.176Z` | `lockedAt`; reason `FULL_CONTROLLED_BEST_BOARD`; **propCount 16**; Best-6 / full controlled best board |
| Pre-repair snapshot file | `2026-08-05T05:14:26.648Z` (filename stamp) | `2026-08-05.pre-repair-2026-08-05T05-14-26-648Z.json` |
| Intended clear-side dry-run mtime | `2026-08-05T06:13:21.759Z` | `_dryrun_clear_side_strong_edge_membership_path_v1_aug5.json` — **not** a pre-tip Official seal |
| Earliest tip | `2026-08-05T23:00:00Z` | First tip / commence boundary for the slate day |
| Wrong relock applied | `2026-08-06T03:46:12.962Z` | `_audit_aug5_lock.json` `at`; copied pre-repair bytes → `slate-snapshots/2026-08-05.json` and re-registered immutableOfficial with original lockedAt metadata |

## What went wrong

1. **Active Aug 5 snapshot was missing** when the 2026-08-06 registry repair ran (`before.aug5_active.exists: false` in lock audit).
2. The repair **copied pre-repair 16-prop membership** into `slate-snapshots/2026-08-05.json` and marked `immutableOfficial: true`, preserving the **incorrect** 16-prop board rather than the intended clear-side four-prop Official set.
3. Conflict audit (`_audit_aug5_membership_conflict.json`) verdict: **NO_MATCH** — 16 re-locked IDs vs 4 intended Official IDs (exact intersection size **3**; one intended line differs: Rhyne Howard Under **17.5** vs re-locked Under **16.5**).

## Four-prop board is INTENDED_CLEAR_SIDE_RECONSTRUCTION only

- Source: dry-run `_dryrun_clear_side_strong_edge_membership_path_v1_aug5.json` (archived as `intended-clear-side-reconstruction.json`).
- Evidence it is **not** a sealed Official board:
  - Dry-run file mtime `2026-08-05T06:13:21.759Z` is **after** original lock but **before** earliest tip `2026-08-05T23:00:00Z` — reconstruction candidate only.
  - No pre-tip Official seal of the four-prop set was applied to the live snapshot/registry as the authoritative Official membership.
  - Label for this archive: **`INTENDED_CLEAR_SIDE_RECONSTRUCTION`**.

## Identity comparison (16 vs 4)

See `side-by-side-identity-comparison.json`.

- Incorrect 16-prop IDs: from re-locked / pre-repair membership.
- Intended 4-prop IDs: Flau'jae Johnson OVER 15.5, Kelsey Plum OVER 16.5, Nneka Ogwumike UNDER 18.5, Rhyne Howard UNDER 17.5.

## Artifacts in this directory

| File | Role |
| --- | --- |
| `incorrect-16-prop-membership.json` | Copy of `slate-snapshots/2026-08-05.json` (16-prop re-locked board) |
| `pre-repair-snapshot.json` | Copy of `slate-snapshots/2026-08-05.pre-repair-*.json` |
| `intended-clear-side-reconstruction.json` | Copy of dry-run clear-side path |
| `lock-metadata.json` | Extract of `locked-slates.json` entry for `2026-08-05` |
| `_audit_aug5_lock.json` | Relock application audit |
| `_audit_aug5_membership_conflict.json` | 16 vs 4 identity conflict audit |
| `_audit_aug5_restore_attempt.json` | Restore attempt audit |
| `tracked-results-aug5-snapshot.json` | Extract from `tracked-props.json` where `slateDate===2026-08-05` |
| `side-by-side-identity-comparison.json` | Structured 16 vs 4 comparison |
| `MANIFEST.json` | SHA-256 checksums + verification |

## Missing / notable gaps

- **`active-bundles/2026-08-05` was missing** at archive time (directory not present under `active-bundles/`).
- **`tracked-props.json` contained zero props with `slateDate===2026-08-05`** at extraction (dates jump 2026-08-04 → 2026-08-06). Empty extract preserved intentionally.

## Secrets

This archive intentionally contains **no secrets** (no API keys, tokens, credentials, or `.env` material). Only slate/membership JSON and audit metadata.

## Git note

See repo-root `_v3_git_preflight.txt` for HEAD, V1/V2 tag object IDs, remotes, and branch. Tags were **not** modified; nothing was pushed.
