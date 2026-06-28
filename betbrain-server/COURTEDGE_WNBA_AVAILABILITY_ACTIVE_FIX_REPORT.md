# CourtEdge WNBA Availability ACTIVE Fix Report

**Date:** 2026-06-28  
**Branch:** `betbrain-v2-rebuild`  
**Build:** `courteedge-wnba-availability-active-v1`  
**Service version:** `wnba-availability-active-v1`  
**Prior investigation:** ff41c17c

## Problem

Players absent from the BDL WNBA injury feed were classified as `UNKNOWN` with `availabilityDataMissing: true`, treating healthy unlisted players as if the availability source were missing. `Day-To-Day` statuses were not mapped to `QUESTIONABLE`. Gate inputs also inferred missing availability from any `UNKNOWN` level on the card.

## Root cause

`evaluateWnbaAvailability` conflated **feed fetch failure** with **no matching injury row**. When the feed returned successfully but a player had no injury entry, the service returned `UNKNOWN` + `SOURCE_UNAVAILABLE` instead of `ACTIVE`.

## Fix summary

### `services/wnbaAvailabilityService.js`

| Scenario | Before | After |
|---|---|---|
| Feed OK, player not on injury report | `UNKNOWN`, data missing | `ACTIVE`, `availabilityDataMissing: false`, message: "Active — not on injury report" |
| Feed fetch fails | Often silent fallback / ambiguous | `UNKNOWN`, `SOURCE_UNAVAILABLE`, explicit `feedFetchOk` / `httpStatus` / `errorReason` |
| `Day-To-Day` status | `UNKNOWN` | `QUESTIONABLE` |
| Targeted lookup | Full feed only | `player_ids[]` param when `playerId` provided |

New exports: `fetchWnbaInjuryFeed`, `buildWnbaAvailabilityEvaluation`, `resetWnbaInjuryCacheForTests`, `AVAILABILITY_SERVICE_VERSION`.

### `engines/wnba/wnbaGateInputs.js`

Removed broad inference:

```js
// removed: (availability.level === "UNKNOWN" && availability.availabilityDataMissing !== false)
```

`availabilityDataMissing` is now set only from explicit `pick.availabilityDataMissing` or `availability.availabilityDataMissing`.

### `server.js`

`SERVER_BUILD` → `courteedge-wnba-availability-active-v1`

## Tests

| Suite | Change |
|---|---|
| `scripts/testWnbaAvailability.js` | **New** — 8 unit tests for feed OK/fail, Day-To-Day, gate inputs |
| `scripts/testWnbaReaderFixes.js` #8 | Feed fail = missing; feed OK + not listed = ACTIVE |
| `scripts/testWnbaOfficialV1.js` | Day-To-Day → QUESTIONABLE assertions |

Run:

```bash
node betbrain-server/scripts/testWnbaAvailability.js
node betbrain-server/scripts/testWnbaOfficialV1.js
node betbrain-server/scripts/testWnbaReaderFixes.js
```

## Expected production impact

- Healthy WNBA players not on the injury report no longer trigger `missingAvailability` danger gates.
- True feed outages still surface as `SOURCE_UNAVAILABLE` with uncertainty risk.
- `Day-To-Day` players correctly cap at WATCHLIST instead of ambiguous unknown-missing.

## Out of scope

- No `/clear-tracked-props` or runtime JSON mutations.
- No retroactive pick rewrites.
