# CourtEdge Lab Signal Learning v1 Report

**Date:** 2026-07-08  
**SERVER_BUILD:** `courteedge-lab-signal-learning-v1`  
**Branch:** `betbrain-v2-rebuild`

## Goal

Evaluate signal performance every **3 completed slates** instead of reacting daily. Per-slate signal tables in Prop Lab; 3-slate grouped blocks in History with block-to-block comparison notes.

## Server Changes

| File | Change |
|------|--------|
| `betbrain-server/services/signalPerformanceV1.js` | **NEW** — per-slate signal performance table (25 signal dimensions), helped/hurt/neutral classification, raw records preserved |
| `betbrain-server/services/historyThreeSlateGroupsV1.js` | **NEW** — group ARCHIVED slates into blocks of 3, aggregate W-L-P, risk/O-U breakdowns, top helpers/hurters, comparison vs prior block |
| `betbrain-server/services/dailySlateReportService.js` | Attach `signalPerformance` + section `X` on Lab report build |
| `betbrain-server/server.js` | `SERVER_BUILD` bump; expose `historyThreeSlateGroups` on `/daily-slate-reports` and `/history-archives` |

## Client Changes

| File | Change |
|------|--------|
| `utils/signalPerformance.ts` | **NEW** — impact labels, record formatting, report accessors |
| `app/(tabs)/prop-lab.tsx` | Signal Performance table section (all signals, small-sample visible) |
| `app/(tabs)/history.tsx` | 3-slate group cards with comparison notes |
| `services/api.ts` | Pass through `historyThreeSlateGroups` payloads |

## Signal Dimensions (per row)

`projectionEdgeBucket`, `fairLineEdge`, `confidenceBucket`, `trueRiskBucket`, `sideOU`, `tier`, `dataMode`, `minutesStability`, `usage`, `market`, `availability`, `opponentDefense`, `impliedTeamTotal`, `sameTeamCollision`, `flipFirst`, `sideRescue`, `gapFloor`, `dangerGate`, `supportDangerGap`, `recentForm`, `seasonAvg`, `homeAway`, `restTravel`, `pace`, `bookCount`, `marketQuality`

## Helped / Hurt / Neutral Thresholds

- **Helped:** win rate ≥ 60%, OR win rate ≥ 55% with positive avg margin
- **Hurt:** win rate ≤ 40%, OR win rate ≤ 45% with negative avg margin
- **Neutral:** otherwise
- **Small sample:** < 3 decided props — row still shown with `smallSampleNote`

## Example Output Structure

### Per-slate `signalPerformance` (on daily report)

```json
{
  "version": "signal-performance-v1",
  "slateDate": "2026-06-21",
  "propCount": 14,
  "rowCount": 42,
  "thresholds": { "helpedWinRate": 55, "hurtWinRate": 45, "smallSampleThreshold": 3 },
  "rows": [
    {
      "signalCategory": "trueRiskBucket",
      "value": "LOW",
      "n": 8,
      "wins": 5,
      "losses": 2,
      "pushes": 1,
      "record": "5-2-1",
      "winRate": 71.4,
      "avgMargin": 1.8,
      "avgConfidence": 61.2,
      "smallSample": false,
      "impactStatus": "helped",
      "rawRecords": [{ "player": "...", "status": "win", "resultMargin": 3 }]
    }
  ],
  "summary": {
    "helped": [],
    "hurt": [],
    "neutral": [],
    "smallSampleCount": 12
  }
}
```

### `historyThreeSlateGroups` (on `/history-archives`)

```json
{
  "version": "history-three-slate-groups-v1",
  "groupSize": 3,
  "archivedSlateCount": 6,
  "groupCount": 2,
  "groups": [
    {
      "groupId": "block-2",
      "slateDates": ["2026-06-22", "2026-06-23", "2026-06-24"],
      "record": "12-6-0",
      "winRate": 66.7,
      "avgMargin": 1.4,
      "riskBucketBreakdown": { "LOW": { "record": "8-3-0", "winRate": 72.7 } },
      "sideBreakdown": { "Over": { "record": "7-4-0" }, "Under": { "record": "5-2-0" } },
      "topSignalHelpers": [{ "signal": "trueRiskBucket → LOW", "record": "8-2-0", "winRate": 80 }],
      "topSignalHurters": [],
      "comparison": {
        "hasPrevious": true,
        "winRateDelta": 5.2,
        "notes": ["Win rate improved +5.2% vs prior block."]
      }
    }
  ]
}
```

## Tests

```bash
node betbrain-server/scripts/testSignalPerformanceV1.js
node betbrain-server/scripts/testHistoryThreeSlateGroupsV1.js
node betbrain-server/scripts/testSlateRotationLifecycle.js
```

## Unchanged (per scope)

- Prop generation, pick selection, grading rules
- Results/Lab/History rotation logic
- Best 6 tracking, Top Picks selection
- UI layout beyond new signal tables / group cards
