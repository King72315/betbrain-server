# CourtEdge Same-Team Opportunity Engine V2 — Implementation Report

**Build:** `courteedge-same-team-opportunity-v2`  
**Selector:** `controlled-best-six-same-team-opp-v2`  
**Engine:** `same-team-opportunity-v2`  
**Status:** All phases implemented

---

## Goal

When multiple high-scoring teammates project Over, CourtEdge resolves the conflict **before Best 6 / Top 2** by choosing the primary Over and independently evaluating secondary scorers as Under candidates.

This is a **decision engine**, not a warning layer. No UI labels. No lifecycle / Results / Lab / History / Home layout changes.

---

## Phases

### Phase 1 — Detect scoring conflicts
`isMeaningfulScorer()` + cluster by `team + game`:
- Points props only
- Same game, same team
- Currently Over
- Meaningful scorers (minutes floor / not pure BENCH_MICROWAVE bench)

Single qualifying scorer → no arbitration.

### Phase 2 — Rank Over cases
`computeOpportunityStrengthScore()` from **existing** fields only:
- Projection gap, expected minutes / FGA / FTA
- Usage / same-team scoring share
- Role identity, recent + season form
- Market agreement, Reader over-case, confidence

### Phase 3 — Choose primary scorer
Highest Opportunity Strength Score stays **PRIMARY_OVER** (small ranking boost).

### Phase 4 — Re-evaluate secondary as Under
`reevaluatePropAsUnderCandidate()` runs the full stack with `initialSide = UNDER`:
Flip-First → Tracking Gate → Decision Intelligence → Side Rescue → finalize  
(as if originally generated Under — no fabricated evidence)

### Phase 5 — Final decision
- Under qualifies independently → keep as **SECONDARY_UNDER**
- Under fails → keep Over but **SECONDARY_DEMOTED** (heavy ranking penalty, blocked from Top 2 equality)
- Never force Under

---

## Wiring

Insertion point: `applySlateCollisionLayer` in `controlledBestSixSelector.js`  
Order: V1 slate collision adjustments → **V2 arbitration** → score → Best 6 diversity → Top 2

Top 2 explicitly skips `SECONDARY_DEMOTED` / `topPickBlockedBySameTeamOpportunityV2`.

---

## Files

| File | Change |
|------|--------|
| `engines/wnba/playerIntelligence/sameTeamOpportunityEngineV2.js` | **New** — full V2 engine |
| `engines/wnba/playerIntelligence/index.js` | Export V2 |
| `engines/topProps/controlledBestSixSelector.js` | Wire layer + Top 2 demotion guard + version bump |
| `server.js` | `SERVER_BUILD = courteedge-same-team-opportunity-v2` |
| `scripts/testSameTeamOpportunityV2.js` | Acceptance tests |

---

## Acceptance tests (all PASS)

1. Two high scorers, one stronger → primary Over; secondary Under or demoted  
2. Three high scorers → strongest Over; others independently evaluated  
3. Failed Under not forced; demoted Over loses Top priority  
4. Single scorer → unchanged  
5. Bench non-meaningful peer → no conflict cluster  
6. Lifecycle untouched (selector-only path)

Also green: Controlled Best 6 (33), Evidence Rank, Same-Team V1 incomplete suite.

---

## Example (Mitchell / Hiedeman)

```
Kelsey Mitchell  → PRIMARY_OVER   (higher Opportunity Strength)
Natisha Hiedeman → SECONDARY_UNDER (if Under qualifies)
                 → or SECONDARY_DEMOTED Over (if Under fails; not Best 6 peer)
```

Best 6 / Top 2 built only after arbitration completes.
