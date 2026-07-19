# CourtEdge Empty Board Guard V1

**Date:** 2026-07-19  
**SERVER_BUILD:** `courteedge-empty-board-guard-v1`  
**Branch:** `betbrain-v2-rebuild`  
**Prod:** `https://betbrain-server-1.onrender.com`

## Symptom

Home report showed all zeros (NBA/WNBA Today+Tomorrow 0/6, 0 board candidates) after boards had been live earlier the same day under `courteedge-home-completion-tomorrow-six-v1`.

## Root cause

1. **Render restart wiped ephemeral board cache** (`/picks` → “No saved board yet”, `emptyForEmergencySeed=true`, `lastRefreshTime=null`).
2. **Startup intentionally did not auto-refresh** (prior OOM/restart-loop mitigation) and **did not hydrate from bundled recovery**.
3. **Progressive Today persist could atomically wipe Tomorrow** mid-refresh by writing a Today-only snapshot (`bestSixDisplayTomorrow*=[]`, `tomorrowCandidateCount=0`).
4. Soft-accept / LKG only helped when a previous board still existed — after a cold empty cache there was nothing to preserve.

NBA 0/6 with no games is expected (offseason). WNBA empty while markets exist was the regression.

## Fix

- Strengthened `shouldPreserveExistingBoard` to block:
  - zero-candidate swaps over LKG (≥6 playable)
  - zero Best6 display swaps over LKG (≥6 display)
  - total Today wipe (mirrors Tomorrow wipe guard)
  - progressive persist that drops LKG Tomorrow
- Progressive Today persist now **carries prior Tomorrow games + Best6** and refuses writes rejected by the empty-board guard.
- Refresh now merges **LKG Today and Tomorrow**, and refuses empty/zombie provider results when LKG had playable candidates/Best6.
- **Startup** loads `recovery/empty-board-recovery-v1.json` when the board cache is empty (no auto-refresh loop).
- Bundled recovery updated to live **WNBA Today 6 / Tomorrow 6** snapshot (AGC sum 28).
- `SERVER_BUILD` → `courteedge-empty-board-guard-v1`.

## Sealed Results

Jul 17 sealed Results left untouched. No `clear-tracked-props`. No Lab/weight changes.

## Verify

- Unit: `testCourtEdgeHomeCompletionTomorrowSixV1.js` — 80/80
- Live (pre-deploy recovery + post-deploy): WNBA Today 6/6, Tomorrow 6/6
- NBA 0 OK when no games

## Ops

- Body-less: `POST /admin/recover-empty-board`
- Refresh: `POST /refresh-picks?wait=1&scope=all`
- Status: `GET /admin/board-cache-status`
