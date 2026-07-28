# CourtEdge Refresh OOM Split V1

| Field | Value |
| --- | --- |
| **Date (CT)** | 2026-07-27 |
| **Build** | `courteedge-refresh-oom-split-v2` |
| **Prod** | https://betbrain-server-1.onrender.com |

## Symptom

Backend returned intermittent **HTTP 502** (Render Bad Gateway). `/health` could die for ~2 minutes after `POST /refresh-picks` (default `scope=all`). Clients saw network/backend failures; Home stayed empty (`No saved board yet`).

## Root cause

Free-tier (~512MB) OOM while building **Today + Tomorrow** in one refresh heap. Process kill → proxy 502. Past-only bundled recovery is correctly skipped, so empty Home had no safe fallback without a surviving refresh.

## Fix

1. Split `scope=all` into sequential **today → pause/GC → tomorrow** legs (async and sync paths).
2. Yield between games in `buildPicksForDay`; slim large game-log / matchup arrays on picks.
3. Cap games/day (default 6), props/game (6), and cache season/last5/matchup fetches per player within a day build.
4. Add `POST /refresh` alias → same background refresh kick.
5. Build bump: `courteedge-refresh-oom-split-v2`.

## Verify

- `/health` stays up during/after refresh
- `POST /refresh-picks` returns `splitLegs: true` for scope=all
- `GET /refresh-picks/status` completes without killing the dyno
