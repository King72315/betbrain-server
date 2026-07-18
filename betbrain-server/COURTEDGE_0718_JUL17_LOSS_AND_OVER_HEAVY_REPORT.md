# CourtEdge Report — Jul 17 Data “Loss” + Home Over-Heavy + History Refresh

**Captured:** 2026-07-18 ~08:21–08:30Z (CT morning Jul 18)  
**Prod build:** `courteedge-same-team-opportunity-v2`  
**Controlled Best 6:** `controlled-best-six-same-team-opp-v2`  
**Scope:** Inspection of prod stores + Home board; History UI refresh button added (client only).  
**Not done:** No prod mutation, no grading repair, no Best 6 logic change, no deploy.

---

## Executive summary

1. **Jul 17 props were NOT wiped.** All 6 sealed Official props are still in prod tracked + locked + sealed validation.
2. They **disappeared from Results / Lab / History UI** because they are **stuck ungraded (6 pending / 0 graded)** while rotation moved Results to **07-18** and left Lab on **07-16**. Jul 17 sits in the **stale-unresolved gap**.
3. **Home is Over-heavy (5 Over / 1 Under)** on Today; **Tomorrow Best 6 board is empty** (no TOMORROW rows in display). Side-balance tried to pull Unders in but found **0 eligible minority candidates**. Same-Team V2 demoted teammate Overs but did **not** flip any to Under.
4. **History tab** already had pull-to-refresh; a visible **Refresh History** button was added.

---

## 1. Jul 17 / 2026-07-17 — where the data is

### Still present (not lost from store)

| Location | Status |
|----------|--------|
| tracked-props (includeLegacy) | **6 / 6** exact sealed membership |
| locked-slates registry | Present, `immutableOfficial=true`, phase ACTIVE |
| officialSlate.sealedSlateDates | **Includes 2026-07-17** (6 sealedIds OK) |
| local active-bundles/2026-07-17 | Present |
| local slate-snapshots/2026-07-17.json | Present |

### Exact sealed six (still in tracked, all ungraded)

| # | Player | Side | Line | Conf | Grade |
|---|--------|------|------|------|-------|
| 1 | Nneka Ogwumike | OVER | 16.5 | 65 | null |
| 2 | Dominique Malonga | UNDER | 16.5 | 50 | null |
| 3 | Isabelle Harrison | OVER | 11.5 | 52 | null |
| 4 | Rhyne Howard | UNDER | 19.5 | 58 | null |
| 5 | Kelsey Mitchell | OVER | 22.5 | 69 | null |
| 6 | Naz Hillmon | UNDER | 9.5 | 42 | null |

All: `immutableOfficial=true`, `officialSealedAt=2026-07-17T03:22:17.422Z`.

### Missing from UI / lifecycle surfaces

| Surface | Jul 17? |
|---------|---------|
| Results (active Results slate) | **No** — active is **2026-07-18** |
| Lab | **No** — Lab is **2026-07-16** |
| History archives (prod `/history-archives`) | **No** — archiveCount **0** |
| daily-slate-reports | **No** row for 2026-07-17 |

### Current rotation (CT 2026-07-18)

- **Today / Results:** 2026-07-18 (6 tracked pending)
- **Lab:** 2026-07-16
- **History dates (DSR):** 2026-07-15, 2026-07-14, 2026-07-08, 2026-06-21
- **pendingBySlate[2026-07-17]:** 6
- **staleUnresolvedSlates:** includes 2026-07-17
- **slateLifecycle[2026-07-17]:** `TRACKING_ACTIVE`, locked, gradedCount=0, pendingCount=6

---

## 2. Why Jul 17 “disappeared” (root cause)

### Primary mechanism

**Lifecycle skip + never graded + never archived**  
— **not** a wipe of Official membership from tracked/sealed stores.

Narrative:

1. Jul 17 sealed correctly (FULL_BEST_SIX) with the six above.
2. Games tipped (~2026-07-17T23:30Z). By dump time (~08:21Z Jul 18) games were ~9h past tip.
3. Resolve/grade **never completed** for these six:
   - `status` / `result` / `actualPoints` / `pendingReason` / `gradeBlockReason` / `lastResolveAttempt` all **null**
   - Frozen seal fields still show `isStarted=false`, `minutesUntilStart≈1208` (pregame snapshot freeze) — resolve path never wrote live started/graded state
4. Calendar rolled to **07-18**. Results pointer moved to **today’s** slate (07-18).
5. Lab stayed on **07-16** (completed report exists).
6. Jul 17 became **stale-unresolved**: still in tracked, invisible on Results/Lab/History until graded → report → Lab → History.

### What this is NOT

- Not deleted from tracked
- Not missing from sealed validation
- Not “Home-only” loss of the sealed six (sealed six still in Results cohort store for 07-17)
- Not proven as a provider wipe of those markets (membership IDs intact)

### Why grading likely never stuck

Ranked hypotheses:

1. **Results UI / lifecycle only drives the active Results date (07-18)** — Jul 17 pending does not hold the Results pointer; auto grade may focus active/pending-but-started props and never refreshed frozen `isStarted` on sealed rows.
2. **Resolve never attempted** — no `lastResolveAttempt` / resolve error fields on any of the six.
3. **requireLikelyFinished / not-started gate** — if resolver trusts frozen `isStarted=false`, it may skip finished games.
4. Stats API failure — **low confidence** (no awaiting-stats / fetch-error evidence on these rows).

### Where users “lose” the slate visually

| Tab | What user sees |
|-----|----------------|
| Results | Only 07-18 (active) — Jul 17 hidden |
| Lab | 07-16 — Jul 17 never promoted |
| History | No archive for Jul 17 — never graded/reported |

**Data is orphaned in tracked, not erased.**

---

## 3. Home Today / Tomorrow — Over-heavy inspection

### Capture time board (WNBA Best 6 display)

**Today (bestSixDisplayTodayWNBA): 5 OVER / 1 UNDER**

| Player | Side | Line | Conf | Score | Team |
|--------|------|------|------|-------|------|
| Breanna Stewart | Over | 20.5 | 74 | 83.15 | NY Liberty |
| Kayla McBride | Over | 17.5 | 80 | 80.35 | Minnesota |
| Olivia Miles | Over | 17.5 | 61 | 10.44 | Minnesota |
| Kelsey Mitchell | Over | 23.5 | 55 | 59.60 | Indiana |
| Emily Engstler | Under | 10.5 | 39 | 3.91 | Portland |
| Shakira Austin | Over | 13.5 | 53 | 50.39 | Washington |

**Tomorrow Best 6 display:** **empty** (0 props with `dayBucket=TOMORROW` in `bestSixDisplayWNBA`).  
Games exist for tomorrow on the board, but no Tomorrow Best 6 was selected into display at capture time.

### Why Overs dominate

1. **Candidate / scored pool skew toward Overs** after quality + safety ranking.
2. **Side-balance engine ran** (`applySideBalancePreference`):
   - `majoritySide=OVER`
   - `minoritySide=UNDER`
   - `minorityCandidatesFound=2`
   - `eligibleMinorityCandidates=0`
   - **`sideBalanceNoSwapReason=NO_ELIGIBLE_MINORITY_CANDIDATE`**
   - Target minority quota is **3 Unders** (`SIDE_BALANCE_MINORITY=3`); board stuck at **1 Under** because no Under outside the six cleared the viability + safety-margin bar vs the weakest Over.
3. **Same-Team Opportunity V2** (display path):
   - `primaryKeptOver=3`, `secondaryFlippedUnder=0`, `secondaryDemoted=3`
   - Clusters demoted secondary Overs (Ionescu, etc.) but **did not convert them to Under** when Under did not independently qualify.
   - Net effect: fewer competing Overs capped out, **not** more Unders.
4. Cap hides observed were mostly **Overs** (Salaun, Citron, Reese, Ionescu) + one Under team-cap (Natasha Howard Under) — so the balance fixer had almost nothing eligible to swap in.

### Interpretation

Over-heavy is **expected given current rules + slate evidence**, not a random UI bug:
- Balance wants ≥3 Unders but **refuses unsafe swaps**.
- V2 prefers demoting weak teammate Overs over forcing Unders.
- Result: **5–1 Over skew** when Unders are scarce/weak in the scored pool.

---

## 4. History tab — refresh button

### Before
- Pull-to-refresh (`RefreshControl`) existed.
- No obvious header button (unlike Results “Check Pending”).

### Change made (client only)
**File:** `app/(tabs)/history.tsx`

- Added visible **Refresh History** button in the header card.
- Calls existing `refreshHistory()` (reloads pick history, daily reports, archives, tracked).
- Pull-to-refresh unchanged.

No server / Best 6 / grading changes.

---

## 5. Recommended next actions (not implemented)

### P0 — Rescue Jul 17 (data still recoverable)

1. Force resolve/grade **2026-07-17** Official six (do not trust frozen `isStarted=false`).
2. Build daily slate report for 07-17.
3. Promote 07-17 into Lab (or archive path) so History can show it.
4. Confirm Results pointer rules: pending sealed yesterday should not vanish from all UI surfaces.

### P1 — Lifecycle integrity

1. Stale sealed slates with pending=6 must remain visible (Results hold or “Stale” section).
2. Block Results calendar advance from orphaning ungraded Official membership.
3. Alert when `staleCleanupNeeded` includes a sealed date with 0 grades.

### P2 — Over-heavy transparency (no logic change unless requested)

1. Surface side-balance reason on diagnostics/Home (`NO_ELIGIBLE_MINORITY_CANDIDATE`).
2. Optionally audit why Unders fail `isViableMinorityCandidate` on this slate (out of scope here).

---

## 6. Confirmation checklist

| Item | Result |
|------|--------|
| Jul 17 wiped from tracked? | **No** — 6/6 present |
| Jul 17 sealed? | **Yes** |
| Jul 17 in History? | **No** — never archived |
| Jul 17 in Lab? | **No** |
| Jul 17 in Results UI? | **No** — Results=07-18 |
| Loss type | **Lifecycle orphan / ungraded**, not store wipe |
| Home Over/Under | **5 / 1** Today; Tomorrow Best 6 empty |
| Over-heavy why | No eligible Under swap + V2 kept Overs |
| History refresh button | **Added** |
| Prod mutated? | **No** |
| Best 6 / Top / labels / projections changed? | **No** |

---

## Evidence files (local)

- `betbrain-server/.tmp-0718-health.json`
- `betbrain-server/.tmp-0718-picks.json`
- `betbrain-server/.tmp-0718-tracked-legacy.json`
- `betbrain-server/.tmp-0718-locked.json`
- `betbrain-server/.tmp-0718-dsr.json`
- `betbrain-server/.tmp-0718-diag.json`
- `betbrain-server/.tmp-0718-ha.json`
- `betbrain-server/.tmp-0718-investigation.json`
- `betbrain-server/.tmp-0718-investigation-part2.json`

---

*End of report.*
