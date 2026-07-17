# CourtEdge Persist Guard v2 — Residual Risk Closure
Generated: 2026-07-16 (CT) after re-inspection  
Build: `courteedge-persist-guard-v2`

## Re-inspection finding

After persist-rescue-v1:
- Jul 15 / Jul 16 Official props remained graded + locked (good).
- Board emptied again after redeploy (ephemeral `board-cache.json`) — expected until refresh.
- Jul 17 Tomorrow seal from earlier refresh was **lost on redeploy** because it was never committed to git / no bundle catalog.

## Remaining risks closed in this build

| Risk | Fix |
|------|-----|
| Unauthenticated `/admin/restore` + `/admin/backup` | Require `x-admin-secret`; full restore also needs `forceFullReplace: true` |
| Lab startup overwrite of live Jul 15 | Restore props only when `propCount === 0`; otherwise metadata-only repair |
| Empty refresh mutating tracked | Skip seals/`addTrackedProps` when odds return empty and prior board exists |
| `writeTrackedProps` full replace wipe | Default **merge-only**; shrink of sealed/locked dates blocked |
| `replaceTrackedPropsForSlate` on sealed | Grade-merge only unless `allowOfficialReplace: true` |
| `persistResolvedTrackedProps` drop sealed | Preserves sealed/locked rows omitted from resolve payload |
| `clear-tracked-props` | Still admin+confirm; also refuses sealed/locked unless `force: true` |
| Lock rebuild from display churn | Only `immutableOfficial` / `officialPropId` / `OFFICIAL` / `slateLocked` |
| No rescue for newly sealed dates | `persistSealedSlateBundle` writes `active-bundles/{date}` after every seal; startup discovers bundles |
| Env lab wipe | Blocked unless `COURTEDGE_ALLOW_DESTRUCTIVE_STARTUP=true` |

## Still true (ops, not code bug)

Render free disk is ephemeral. Durability of a newly sealed slate across redeploy requires either:
1. Bundle written under `active-bundles/` **and committed/pushed**, or
2. Persistent disk for runtime JSON.

This build writes the bundle on seal so the next commit captures it; tracked merge + startup rehydrate recover when bundles ship with the deploy.

## Hotfix v2.1

`mergeLockedSlateFreezeIntoTracked` previously only updated existing tracked rows.
Sealed Tomorrow/Today Official props that were not already in `tracked-props.json`
never got inserted — locks/snapshots existed, but `/tracked-props` omitted them
(seen live for 2026-07-17).

Fix: freeze merge now **inserts** missing sealed props with `slateLocked` +
`immutableOfficial`.
