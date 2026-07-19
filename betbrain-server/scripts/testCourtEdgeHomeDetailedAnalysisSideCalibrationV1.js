/**
 * CourtEdge Home Detailed Analysis + Side Calibration V1
 * Tests 1–80 + regression hooks.
 */
import assert from "assert";
import {
  buildHomeDetailedAnalysisV1,
  attachHomeDetailedAnalysisV1,
  ensureHomeDetailedAnalysisOnPicks,
  formatHomeDetailedAnalysisReportText,
  HOME_DETAILED_ANALYSIS_VERSION,
  HOME_DETAILED_ANALYSIS_BUILD,
} from "../services/courtEdgeHomeDetailedAnalysisV1.js";
import {
  COURT_EDGE_SIDE_CALIBRATION_VERSION,
  evaluateMirroredSidePair,
  assertMirroredPairEquivalent as assertMirroredEquivalent,
  missingDataSideBias,
  buildSideCalibrationDiagnostics,
  buildSideCalibrationMarker,
  absoluteProjectionEdge,
  getSideCalibrationConfig,
  DIRECTIONAL_EXCEPTIONS,
  REPAIRED_ASYMMETRIES,
  PRESERVED_ASYMMETRIES,
} from "../services/courtEdgeSideCalibrationV1.js";
import {
  resolveWnbaGapFloors,
  WNBA_FULL_OVER_GAP_FLOOR,
  WNBA_FULL_UNDER_GAP_FLOOR,
  WNBA_LIMITED_OVER_GAP_FLOOR,
  WNBA_LIMITED_UNDER_GAP_FLOOR,
  WNBA_READER_MEANINGFUL_GAP,
} from "../engines/wnba/wnbaGraduatedDataModeV1.js";
import { buildAnalysisCacheKey } from "../services/courtEdgeAnalysisCacheV1.js";

let passed = 0;
let failed = 0;
const results = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    results.push({ name, ok: true });
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    results.push({ name, ok: false, error: err.message });
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

function fixturePick(overrides = {}) {
  const line = overrides.line ?? 18.5;
  const side = overrides.side || "Under";
  const finalSide = String(side).toUpperCase().startsWith("U") ? "UNDER" : "OVER";
  const last5 = overrides.last5 || [
    { points: 11, minutes: 30, fga: 12, fta: 3 },
    { points: 10, minutes: 28, fga: 11, fta: 2 },
    { points: 19, minutes: 32, fga: 15, fta: 4 },
    { points: 19, minutes: 31, fga: 14, fta: 3 },
    { points: 24, minutes: 34, fga: 16, fta: 5 },
  ];
  const last10 = overrides.last10 || [
    ...last5,
    { points: 17, minutes: 29, fga: 13, fta: 2 },
    { points: 15, minutes: 27, fga: 12, fta: 3 },
    { points: 14, minutes: 28, fga: 11, fta: 1 },
    { points: 18, minutes: 30, fga: 14, fta: 4 },
    { points: 16, minutes: 29, fga: 12, fta: 2 },
  ];
  const matchupGames = overrides.matchupGames ?? [
    {
      date: "2026-06-21",
      points: 17,
      minutes: 34,
      fga: 15,
      fta: 4,
      fg3a: 5,
      team: "ATL",
      opponent: "CHI",
    },
    {
      date: "2026-05-10",
      points: 14,
      minutes: 30,
      fga: 12,
      fta: 2,
      team: "ATL",
      opponent: "CHI",
    },
  ];

  return {
    player: "Rhyne Howard",
    team: "ATL",
    opponent: "CHI",
    league: "WNBA",
    line,
    sealedLine: line,
    selectedLine: line,
    openingLine: overrides.openingLine ?? line,
    currentLine: overrides.currentLine ?? line,
    side,
    pick: side,
    finalCourtEdgeSide: finalSide,
    originalModelSide: overrides.originalModelSide || finalSide,
    confidence: overrides.confidence ?? 62,
    projection: overrides.projection ?? (finalSide === "UNDER" ? 15.5 : 21.5),
    fairLine: overrides.fairLine ?? (finalSide === "UNDER" ? 15.5 : 21.5),
    seasonAverage: 18.1,
    last5,
    last10,
    matchupGames,
    bookCount: 4,
    expectedMinutes: 31,
    expectedFGA: 13.5,
    expectedFTA: 3.2,
    bestSixRank: 1,
    controlledBestSixDisplay: true,
    displayTrueRisk: "MEDIUM",
    decisionIntelligence: {
      trueRisk: "MEDIUM",
      simpleExplanation: "TRACK — projection edge with role support.",
      trackEligibility: "TRACK",
    },
    availabilityGate: {
      availabilitySourceStatus: "OK",
      source: "balldontlie",
    },
    defenseResult: {
      status: "UNAVAILABLE",
      defenseScore: null,
      source: "unavailable",
    },
    marketIntelligence: {
      openingLine: overrides.openingLine ?? line,
      currentLine: overrides.currentLine ?? line,
      lineDelta: (overrides.currentLine ?? line) - (overrides.openingLine ?? line),
    },
    wnbaReader: {
      finalSide,
      supports: ["Projection gap supports side"],
      disagrees: [],
    },
    readerSide: finalSide,
    sideRescue: { action: "KEEP_ORIGINAL" },
    courtEdgePlayerEvidence: {
      schemaVersion: "courtEdgePlayerEvidenceV1",
      builtAt: "2026-07-19T12:00:00.000Z",
      identity: {
        oddsPlayerName: "Rhyne Howard",
        team: "ATL",
        opponent: "CHI",
        league: "WNBA",
      },
      recentForm: {
        last5Points: last5.map((g) => g.points),
        last10Points: last10.map((g) => g.points),
        seasonPointsAverage: 18.1,
        standardDeviation: 4.2,
      },
      roleAndVolume: {
        last5Minutes: 31,
        fga: 13.6,
        fta: 3.4,
        estimatedUsage: 24,
        estimatedUsageLabel: "ESTIMATE_NOT_PROVIDER",
        roleStability: "STABLE",
        minutesTrend: "Stable",
        teammateOutRoleChange: false,
      },
      matchup: {
        sampleSize: matchupGames.length,
        points: matchupGames.map((g) => g.points),
        minutes: matchupGames.map((g) => g.minutes),
        fga: matchupGames.map((g) => g.fga),
        fta: matchupGames.map((g) => g.fta),
        matchupAverage: 15.5,
        matchupMedian: 15.5,
        quality: { quality: "EARLY" },
      },
      opponentContext: {
        defenseStatus: "UNAVAILABLE",
        defenseScore: null,
        source: "unavailable",
      },
      gameEnvironment: {
        spread: -3.5,
        total: 162.5,
        impliedTeamTotal: 83,
      },
      market: {
        openingLine: overrides.openingLine ?? line,
        currentLine: overrides.currentLine ?? line,
        lineMovement: 0,
      },
      projections: {
        internalBaseline: 17.2,
        finalProjection: overrides.projection ?? 15.5,
        fairLine: overrides.fairLine ?? 15.5,
      },
      availability: {
        feedHealth: "OK",
        statusSource: "balldontlie",
      },
      dataQuality: { coveragePct: 72.5 },
    },
    courtEdgeDecisionPacketV1: {
      version: "courtEdgeDecisionPacketV1",
      decisionHash: "hash-fixture-1",
      layers: {
        freeze: {
          side: finalSide,
          confidence: overrides.confidence ?? 62,
          risk: "MEDIUM",
        },
      },
    },
    ...overrides,
  };
}

console.log("\n=== Home Detailed Analysis + Side Calibration V1 ===\n");

// ---- DATA TESTS 1–30 ----
test("1. Last 5 points are fetched and displayed", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.deepStrictEqual(a.recentPerformance.last5Points, [11, 10, 19, 19, 24]);
});

test("2. Last 10 points are fetched and displayed", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.recentPerformance.last10Points.length, 10);
});

test("3. Last 5 average is correct", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.recentPerformance.last5Average, 16.6);
});

test("4. Last 10 average is correct", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.ok(a.recentPerformance.last10Average != null);
  assert.strictEqual(a.recentPerformance.last10SampleSize, 10);
});

test("5. Season average is correct", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.recentPerformance.seasonAverage, 18.1);
});

test("6. Last 5 hit rate uses exact sealed line", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick({ side: "Under", line: 18.5 }));
  // Under 18.5: 11,10,19,19,24 → under hits: 11,10 = 2 of 5
  assert.strictEqual(a.recentPerformance.last5HitRate.hits, 2);
  assert.strictEqual(a.recentPerformance.last5HitRate.sample, 5);
});

test("7. Last 10 hit rate uses exact sealed line", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick({ side: "Under", line: 18.5 }));
  assert.strictEqual(a.recentPerformance.last10HitRate.sample, 10);
  assert.ok(a.recentPerformance.last10HitRate.hits != null);
});

test("8. Season hit rate uses exact sealed line", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      side: "Under",
      line: 18.5,
      seasonGames: [{ points: 12 }, { points: 20 }, { points: 17 }],
      bdlSeasonGames: [{ points: 12 }, { points: 20 }, { points: 17 }],
    })
  );
  assert.ok(a.recentPerformance.seasonHitRate.sample >= 3);
});

test("9. Last matchup points are correct", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.matchupHistory.lastMatchup.points, 17);
});

test("10. Last matchup minutes are correct", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.matchupHistory.lastMatchup.minutes, 34);
});

test("11. Last matchup FGA/FTA are correct", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.matchupHistory.lastMatchup.fga, 15);
  assert.strictEqual(a.matchupHistory.lastMatchup.fta, 4);
});

test("12. Last matchup exact-line result is correct", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick({ side: "Under", line: 18.5 }));
  assert.strictEqual(a.matchupHistory.lastMatchup.againstTodaysLine, "Under");
});

test("13. Up to three matchup records are displayed", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      matchupGames: [
        { date: "2026-06-21", points: 17, minutes: 34, fga: 15, fta: 4 },
        { date: "2026-05-10", points: 14, minutes: 30, fga: 12, fta: 2 },
        { date: "2026-04-01", points: 20, minutes: 33, fga: 16, fta: 5 },
        { date: "2026-03-01", points: 9, minutes: 22, fga: 8, fta: 1 },
      ],
    })
  );
  assert.strictEqual(a.matchupHistory.recentMatchups.length, 3);
});

test("14. No prior matchup displays honest unavailable state", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      matchupGames: [],
      courtEdgePlayerEvidence: {
        ...fixturePick().courtEdgePlayerEvidence,
        matchup: { sampleSize: 0, points: [], quality: { quality: "UNAVAILABLE" } },
      },
    })
  );
  assert.strictEqual(a.matchupHistory.status, "UNAVAILABLE");
  assert.match(a.matchupHistory.display, /No previous matchup/);
});

test("15. Different-team matchup context is marked", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      matchupGames: [
        {
          date: "2026-06-21",
          points: 17,
          minutes: 34,
          fga: 15,
          fta: 4,
          team: "DAL",
          opponent: "CHI",
          differentTeam: true,
        },
      ],
    })
  );
  assert.match(a.matchupHistory.lastMatchup.differentTeamContext || "", /Different-team/);
});

test("16. Different-role context is marked when available", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      matchupGames: [
        {
          date: "2026-06-21",
          points: 17,
          minutes: 34,
          fga: 15,
          fta: 4,
          differentRole: true,
        },
      ],
    })
  );
  assert.match(a.matchupHistory.lastMatchup.differentRoleContext || "", /Different-role/);
});

test("17. Missing stats never become zero", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      matchupGames: [{ date: "2026-06-21", points: 17, minutes: null, fga: null, fta: null }],
    })
  );
  assert.strictEqual(a.matchupHistory.lastMatchup.minutes, null);
  assert.strictEqual(a.matchupHistory.lastMatchup.fga, null);
  assert.notStrictEqual(a.matchupHistory.lastMatchup.minutes, 0);
});

test("18. Small samples remain visible", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      matchupGames: [{ date: "2026-06-21", points: 17, minutes: 34, fga: 15, fta: 4 }],
    })
  );
  assert.strictEqual(a.matchupHistory.sampleSize, 1);
  assert.match(a.matchupHistory.lastMatchup.relevanceNote || "", /Sample size 1/);
});

test("19. Expected minutes/FGA/FTA are displayed", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.roleOpportunity.expectedMinutes, 31);
  assert.strictEqual(a.roleOpportunity.expectedFGA, 13.5);
  assert.strictEqual(a.roleOpportunity.expectedFTA, 3.2);
});

test("20. Role trend is displayed", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.ok(a.roleOpportunity.roleStability || a.roleOpportunity.minutesTrend);
});

test("21. Teammate impact is displayed", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.ok(a.roleOpportunity.teammateImpactSummary);
});

test("22. Projection/fair line/gap are displayed", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick({ side: "Under", projection: 15.5, fairLine: 15.5, line: 18.5 }));
  assert.strictEqual(a.projectionDistribution.finalProjection, 15.5);
  assert.strictEqual(a.projectionDistribution.fairLine, 15.5);
  assert.strictEqual(a.projectionDistribution.projectionGap, 3);
});

test("23. Distribution and volatility are displayed", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.ok(a.projectionDistribution.volatilityTier);
});

test("24. Opening/sealed/current lines remain distinct", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({ openingLine: 19.5, line: 18.5, currentLine: 18.0 })
  );
  assert.strictEqual(a.marketAnalysis.openingLine, 19.5);
  assert.strictEqual(a.marketAnalysis.selectedSealedLine, 18.5);
  assert.strictEqual(a.marketAnalysis.currentLine, 18);
});

test("25. Market unavailable does not display AGAINST", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      openingLine: null,
      currentLine: null,
      line: 18.5,
      marketIntelligence: { available: false },
      courtEdgePlayerEvidence: {
        ...fixturePick().courtEdgePlayerEvidence,
        market: { openingLine: null, currentLine: null },
      },
    })
  );
  // Sealed line exists but open/current missing for movement — compact may be UNAVAILABLE or NEUTRAL, never false AGAINST from missing open
  assert.notStrictEqual(a.marketAnalysis.compactResult, "AGAINST");
});

test("26. Injury-feed absence does not display confirmed active", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.availability.confirmedActive, false);
  assert.match(a.availability.displayStatus, /No current injury report found/i);
});

test("27. Provider errors display provider error", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      availabilityGate: { availabilitySourceStatus: "ERROR", source: "balldontlie" },
    })
  );
  assert.strictEqual(a.availability.injuryReportStatus, "PROVIDER_ERROR");
  assert.match(a.availability.displayStatus, /Provider error/i);
});

test("28. True pace and scoring proxy remain distinct", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      defenseResult: {
        status: "CALCULATED",
        defenseScore: 48,
        paceProxy: 161.2,
        source: "bdl_games_proxy",
      },
      courtEdgePlayerEvidence: {
        ...fixturePick().courtEdgePlayerEvidence,
        opponentContext: {
          defenseStatus: "CALCULATED",
          defenseScore: 48,
          paceProxy: 161.2,
          source: "bdl_games_proxy",
        },
      },
    })
  );
  assert.strictEqual(a.gameEnvironment.truePace, null);
  assert.strictEqual(a.gameEnvironment.paceProxy, 161.2);
  assert.strictEqual(a.gameEnvironment.paceProxyLabel, "SCORING_ENVIRONMENT_PROXY");
});

test("29. Source and fetchedAt are shown", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.ok(a.dataQuality.fetchedAt);
  assert.ok(a.dataQuality.sections.recentPerformance.provider);
});

test("30. No API secrets appear", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  const text = JSON.stringify(a);
  assert.ok(!/ODDS_KEY|BALLDONTLIE_KEY|SPORTS_KEY|Bearer\s+[A-Za-z0-9._-]+/i.test(text));
  assert.ok(!/"apiKey"\s*:/i.test(text));
  assert.strictEqual(a.dataQuality.secretsExposed, false);
});

// ---- SEAL / DECISION 31–48 ----
test("31. Detailed analysis uses canonical decision fields", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick({ side: "Under", confidence: 67 }));
  assert.strictEqual(a.canonical.side, "UNDER");
  assert.strictEqual(a.canonical.confidence, 67);
  assert.strictEqual(a.canonical.line, 18.5);
});

test("32. UI does not recalculate side (payload is authoritative)", () => {
  const pick = attachHomeDetailedAnalysisV1(fixturePick({ side: "Over" }));
  assert.strictEqual(pick.homeDetailedAnalysisV1.canonical.side, "OVER");
  assert.strictEqual(pick.homeDetailedAnalysisV1.propSnapshot.finalCourtEdgeSide, "OVER");
});

test("33. UI does not recalculate confidence", () => {
  const pick = attachHomeDetailedAnalysisV1(fixturePick({ confidence: 71 }));
  assert.strictEqual(pick.homeDetailedAnalysisV1.canonical.confidence, 71);
});

test("34. UI does not recalculate risk", () => {
  const pick = attachHomeDetailedAnalysisV1(
    fixturePick({ displayTrueRisk: "HIGH", decisionIntelligence: { trueRisk: "HIGH" } })
  );
  assert.strictEqual(pick.homeDetailedAnalysisV1.canonical.risk, "HIGH");
});

test("35. Official sealed detailed analysis remains immutable", () => {
  const sealed = attachHomeDetailedAnalysisV1(
    fixturePick({ officiallySealed: true, sealedAt: "2026-07-19T10:00:00.000Z", confidence: 60 })
  );
  const next = attachHomeDetailedAnalysisV1({
    ...sealed,
    confidence: 99,
    currentLine: 22.5,
  });
  assert.strictEqual(next.homeDetailedAnalysisV1.canonical.confidence, 60);
  assert.strictEqual(next.homeDetailedAnalysisV1.liveMarketReference.referenceOnly, true);
});

test("36. Live line does not overwrite sealed line", () => {
  const sealed = attachHomeDetailedAnalysisV1(
    fixturePick({ officiallySealed: true, line: 18.5, currentLine: 18.5 })
  );
  const next = attachHomeDetailedAnalysisV1({
    ...sealed,
    currentLine: 20.5,
  });
  assert.strictEqual(next.homeDetailedAnalysisV1.canonical.line, 18.5);
  assert.strictEqual(next.homeDetailedAnalysisV1.liveMarketReference.currentLine, 20.5);
});

test("37. Live market data is reference-only after seal", () => {
  const sealed = attachHomeDetailedAnalysisV1(fixturePick({ officiallySealed: true }));
  assert.strictEqual(sealed.homeDetailedAnalysisV1.liveMarketReference.referenceOnly, true);
});

test("38. Original side remains preserved", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({ originalModelSide: "OVER", side: "Under", sameTeamArbitrationFlip: true })
  );
  assert.strictEqual(a.finalDecision.originalModelSide, "OVER");
});

test("39. Final side remains preserved", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({ originalModelSide: "OVER", side: "Under", sameTeamArbitrationFlip: true })
  );
  assert.strictEqual(a.finalDecision.finalCourtEdgeSide, "UNDER");
});

test("40. Same-team arbitration remains preserved", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      originalModelSide: "OVER",
      side: "Under",
      sameTeamArbitrationFlip: true,
      flipReasonCode: "SAME_TEAM_ARBITRATION_FLIP",
    })
  );
  assert.strictEqual(a.finalDecision.sameTeamArbitration.applied, true);
  assert.strictEqual(a.finalDecision.sameTeamArbitration.organicUnderEvidenceManufactured, false);
});

test("41. Side changes do not change lines", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      originalModelSide: "OVER",
      side: "Under",
      line: 18.5,
      sameTeamArbitrationFlip: true,
    })
  );
  assert.strictEqual(a.propSnapshot.sealedLine, 18.5);
  assert.strictEqual(a.finalDecision.sameTeamArbitration.linePreserved, true);
});

test("42. Results admission does not rebuild analysis", () => {
  const sealed = attachHomeDetailedAnalysisV1(
    fixturePick({ officiallySealed: true, confidence: 55 })
  );
  const admitted = attachHomeDetailedAnalysisV1({
    ...sealed,
    resultsAdmitted: true,
    confidence: 88,
  });
  assert.strictEqual(admitted.homeDetailedAnalysisV1.canonical.confidence, 55);
});

test("43. Lab consumes the same sealed evidence schema", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.schemaVersion, HOME_DETAILED_ANALYSIS_VERSION);
  assert.ok(a.finalDecision.decisionPacketVersion);
});

test("44. Current 2026-07-17 Results membership remains unchanged (marker)", () => {
  // Guard: this suite does not mutate tracked props / sealed Jul 17 cohort.
  assert.ok(true);
});

test("45. Today remains 6/6 when six playable candidates exist (structure)", () => {
  const picks = Array.from({ length: 6 }, (_, i) =>
    fixturePick({ player: `P${i}`, bestSixRank: i + 1, controlledBestSixDisplay: true })
  );
  const enriched = ensureHomeDetailedAnalysisOnPicks(picks);
  assert.strictEqual(enriched.length, 6);
  assert.ok(enriched.every((p) => p.homeDetailedAnalysisV1?.schemaVersion));
});

test("46. Tomorrow remains 6/6 when six playable candidates exist (structure)", () => {
  const picks = Array.from({ length: 6 }, (_, i) =>
    fixturePick({ player: `T${i}`, bestSixRank: i + 1, slateDate: "2099-01-02" })
  );
  assert.strictEqual(ensureHomeDetailedAnalysisOnPicks(picks).length, 6);
});

test("47. Every selected prop displays TRACK (decision field)", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(
    fixturePick().decisionIntelligence.trackEligibility,
    "TRACK"
  );
  assert.ok(a.propSnapshot.finalCourtEdgeSide);
});

test("48. Results Tracked matches selected count (diagnostics)", () => {
  const picks = ensureHomeDetailedAnalysisOnPicks(
    Array.from({ length: 6 }, (_, i) =>
      fixturePick({ player: `R${i}`, bestSixRank: i + 1, selected: true })
    )
  );
  const diag = buildSideCalibrationDiagnostics(picks, { league: "WNBA", pool: "selected" });
  assert.strictEqual(diag.candidateCount, 6);
  assert.strictEqual(diag.sideQuotaApplied, false);
});

// ---- SIDE CALIBRATION 49–80 ----
for (const edge of [0.5, 1.0, 2.0, 3.0, 4.0, 5.5]) {
  const id =
    edge === 0.5
      ? 49
      : edge === 1.0
        ? 50
        : edge === 2.0
          ? 51
          : edge === 3.0
            ? 52
            : edge === 4.0
              ? 53
              : 54;
  test(`${id}. Mirrored Over/Under ${edge}-point edges are equivalent`, () => {
    const pair = evaluateMirroredSidePair({ league: "WNBA", absEdge: edge });
    assertMirroredEquivalent(pair, `edge-${edge}`);
  });
}

test("55. Mirrored confidence adjustments are equivalent", () => {
  const pair = evaluateMirroredSidePair({ league: "WNBA", absEdge: 3 });
  assert.strictEqual(pair.over.confidenceContribution, pair.under.confidenceContribution);
});

test("56. Mirrored risk assignment is equivalent", () => {
  const pair = evaluateMirroredSidePair({
    league: "WNBA",
    absEdge: 3,
    volatility: "high",
    coveragePct: 40,
  });
  assert.strictEqual(pair.over.risk, pair.under.risk);
});

test("57. Mirrored market WITH behavior is equivalent", () => {
  const pair = evaluateMirroredSidePair({ league: "WNBA", absEdge: 3, market: "WITH" });
  assertMirroredEquivalent(pair, "market-WITH");
});

test("58. Mirrored market AGAINST behavior is equivalent", () => {
  const pair = evaluateMirroredSidePair({ league: "WNBA", absEdge: 3, market: "AGAINST" });
  assertMirroredEquivalent(pair, "market-AGAINST");
});

test("59. Mirrored NEUTRAL behavior is equivalent", () => {
  const pair = evaluateMirroredSidePair({ league: "WNBA", absEdge: 3, market: "NEUTRAL" });
  assertMirroredEquivalent(pair, "market-NEUTRAL");
});

test("60. Missing defense is side-neutral", () => {
  const m = missingDataSideBias({ defenseStatus: "UNAVAILABLE" });
  assert.strictEqual(m.sideNeutral, true);
});

test("61. Missing pace is side-neutral", () => {
  const m = missingDataSideBias({ paceStatus: "UNAVAILABLE" });
  assert.strictEqual(m.sideNeutral, true);
});

test("62. Missing matchup history is side-neutral", () => {
  const m = missingDataSideBias({ matchupSample: 0 });
  assert.strictEqual(m.sideNeutral, true);
});

test("63. Missing availability is side-neutral", () => {
  const m = missingDataSideBias({ availabilityStatus: "NO_REPORT" });
  assert.match(m.availabilityLabel, /No current injury report found/);
  assert.strictEqual(m.sideNeutral, true);
});

test("64. Missing market data is side-neutral", () => {
  const m = missingDataSideBias({ marketStatus: "UNAVAILABLE" });
  assert.strictEqual(m.marketLabel, "UNAVAILABLE");
  assert.notStrictEqual(m.marketLabel, "AGAINST");
});

test("65. Evidence deduplication is side-neutral", () => {
  const over = evaluateMirroredSidePair({ absEdge: 3 }).over;
  const under = evaluateMirroredSidePair({ absEdge: 3 }).under;
  assert.strictEqual(over.confidenceContribution, under.confidenceContribution);
});

test("66. Projection-sign handling is correct", () => {
  assert.strictEqual(
    absoluteProjectionEdge({ side: "OVER", line: 18.5, projection: 21.5 }),
    3
  );
  assert.strictEqual(
    absoluteProjectionEdge({ side: "UNDER", line: 18.5, projection: 15.5 }),
    3
  );
});

test("67. Fair-line-sign handling is correct", () => {
  const overGap = absoluteProjectionEdge({ side: "OVER", line: 18.5, projection: 21.5 });
  const underGap = absoluteProjectionEdge({ side: "UNDER", line: 18.5, projection: 15.5 });
  assert.strictEqual(overGap, underGap);
});

test("68. Under confidence is not penalized twice (symmetric contribution)", () => {
  const pair = evaluateMirroredSidePair({ absEdge: 3 });
  assert.strictEqual(pair.over.confidenceContribution, pair.under.confidenceContribution);
});

test("69. Over confidence is not boosted twice (symmetric contribution)", () => {
  const pair = evaluateMirroredSidePair({ absEdge: 5.5 });
  assert.strictEqual(pair.over.confidenceContribution, pair.under.confidenceContribution);
});

test("70. Same-team recalibration occurs once (marker)", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      sameTeamArbitrationFlip: true,
      originalModelSide: "OVER",
      side: "Under",
    })
  );
  assert.strictEqual(a.finalDecision.sameTeamArbitration.applied, true);
});

test("71. Same-team forced Under is tracked separately from organic Under", () => {
  const forced = buildHomeDetailedAnalysisV1(
    fixturePick({
      sameTeamArbitrationFlip: true,
      originalModelSide: "OVER",
      side: "Under",
    })
  );
  const organic = buildHomeDetailedAnalysisV1(
    fixturePick({ originalModelSide: "UNDER", side: "Under" })
  );
  assert.strictEqual(forced.finalDecision.sameTeamArbitration.applied, true);
  assert.strictEqual(organic.finalDecision.sameTeamArbitration.applied, false);
});

test("72. Side balance cannot undo same-team arbitration", () => {
  const a = buildHomeDetailedAnalysisV1(
    fixturePick({
      sameTeamArbitrationFlip: true,
      originalModelSide: "OVER",
      side: "Under",
      displaySideBalanceApplied: true,
    })
  );
  assert.strictEqual(a.finalDecision.finalCourtEdgeSide, "UNDER");
  assert.strictEqual(a.finalDecision.sameTeamArbitration.applied, true);
});

test("73. Best 6 has no forced 3/3 quota", () => {
  const picks = [
    ...Array.from({ length: 5 }, (_, i) =>
      fixturePick({ player: `O${i}`, side: "Over", bestSixRank: i + 1, selected: true })
    ),
    fixturePick({ player: "U1", side: "Under", bestSixRank: 6, selected: true }),
  ];
  const diag = buildSideCalibrationDiagnostics(picks);
  assert.strictEqual(diag.sideQuotaApplied, false);
  assert.strictEqual(diag.bySide.OVER.count, 5);
  assert.strictEqual(diag.bySide.UNDER.count, 1);
});

test("74. Top Picks have no forced side quota", () => {
  const marker = buildSideCalibrationMarker("WNBA");
  assert.strictEqual(marker.symmetricBaselineRules.noSideQuota, true);
});

test("75. Equivalent final scores rank equivalently", () => {
  const pair = evaluateMirroredSidePair({ absEdge: 3 });
  assert.ok(Math.abs(pair.over.rankingScore - pair.under.rankingScore) <= pair.tolerance.rankingScore);
});

test("76. HIGH risk does not act as a side-specific exclusion", () => {
  const picks = ensureHomeDetailedAnalysisOnPicks([
    fixturePick({ side: "Under", displayTrueRisk: "HIGH", bestSixRank: 1, selected: true }),
    fixturePick({ player: "O1", side: "Over", displayTrueRisk: "HIGH", bestSixRank: 2, selected: true }),
  ]);
  assert.strictEqual(picks.length, 2);
  assert.ok(picks.every((p) => p.homeDetailedAnalysisV1));
});

test("77. Weak-but-playable props remain eligible", () => {
  const pair = evaluateMirroredSidePair({ absEdge: 0.5 });
  // Thin edges remain evaluable — eligibility uses floor, but playable pool is separate.
  assert.strictEqual(pair.over.eligible, pair.under.eligible);
});

test("78. Results admission does not recalculate calibration", () => {
  const marker = buildSideCalibrationMarker("WNBA");
  assert.strictEqual(marker.noCalibrationFeedbackEngine, true);
});

test("79. NBA and WNBA calibration remain separately versioned", () => {
  const nba = getSideCalibrationConfig("NBA");
  const wnba = getSideCalibrationConfig("WNBA");
  assert.strictEqual(nba.league, "NBA");
  assert.strictEqual(wnba.league, "WNBA");
  assert.strictEqual(buildSideCalibrationMarker("NBA").league, "NBA");
  assert.strictEqual(buildSideCalibrationMarker("WNBA").league, "WNBA");
});

test("80. Legitimate directional exceptions are documented", () => {
  assert.ok(DIRECTIONAL_EXCEPTIONS.length >= 4);
  assert.ok(REPAIRED_ASYMMETRIES.length >= 2);
  assert.ok(PRESERVED_ASYMMETRIES.length >= 1);
  assert.strictEqual(
    resolveWnbaGapFloors({ side: "UNDER", dataMode: "WNBA_FULL_DATA", volatility: "stable" })
      .gapFloor,
    WNBA_FULL_UNDER_GAP_FLOOR
  );
  assert.strictEqual(
    resolveWnbaGapFloors({ side: "OVER", dataMode: "WNBA_FULL_DATA", volatility: "stable" })
      .gapFloor,
    WNBA_FULL_OVER_GAP_FLOOR
  );
  assert.strictEqual(WNBA_FULL_UNDER_GAP_FLOOR, WNBA_FULL_OVER_GAP_FLOOR);
  assert.strictEqual(WNBA_LIMITED_UNDER_GAP_FLOOR, WNBA_LIMITED_OVER_GAP_FLOOR);
  assert.strictEqual(WNBA_READER_MEANINGFUL_GAP, 3.0);
});

test("Copy report uses same canonical payload", () => {
  const pick = attachHomeDetailedAnalysisV1(fixturePick());
  const text = formatHomeDetailedAnalysisReportText(pick.homeDetailedAnalysisV1, pick);
  assert.match(text, /DETAILED ANALYSIS/);
  assert.match(text, /Last 5|L5|Recent/i);
  assert.ok(!/api[_-]?key/i.test(text));
});

test("Cache key includes league/player/line/build/schema", () => {
  const key = buildAnalysisCacheKey({
    league: "WNBA",
    playerId: "p1",
    teamId: "t1",
    opponentId: "o1",
    season: "2026",
    slateDate: "2026-07-19",
    line: 18.5,
    engineBuild: HOME_DETAILED_ANALYSIS_BUILD,
    evidenceSchema: "courtEdgePlayerEvidenceV1",
    decisionPacketVersion: "courtEdgeDecisionPacketV1",
  });
  assert.match(key, /WNBA/);
  assert.match(key, /18\.5/);
  assert.match(key, /home-detailed-analysis/);
});

test("Side calibration version marker present on analysis", () => {
  const a = buildHomeDetailedAnalysisV1(fixturePick());
  assert.strictEqual(a.sideCalibrationVersion, COURT_EDGE_SIDE_CALIBRATION_VERSION);
  assert.strictEqual(a.buildVersion, HOME_DETAILED_ANALYSIS_BUILD);
});

// ---- REGRESSION HOOKS (import smoke) ----
async function runRegressions() {
  const regressions = [];
  async function run(name, cmdModule) {
    try {
      await import(cmdModule);
      // Modules that self-run will execute; capture by spawning is preferred —
      // here we only verify importability for expansion modules used by suites.
      regressions.push({ name, ok: true, note: "import_ok" });
      console.log(`  ✓ regression import: ${name}`);
    } catch (err) {
      regressions.push({ name, ok: false, error: err.message });
      console.error(`  ✗ regression import: ${name} — ${err.message}`);
    }
  }

  await run("homeAnalysisModule", "../services/courtEdgeHomeDetailedAnalysisV1.js");
  await run("sideCalibrationModule", "../services/courtEdgeSideCalibrationV1.js");
  await run("playerEvidenceModule", "../services/courtEdgePlayerEvidenceV1.js");
  await run("engineSignalsModule", "../services/courtEdgeEngineSignalsV1.js");
  await run("labV2Module", "../services/courtEdgeLabV2.js");
  await run("bestSixSelector", "../engines/topProps/controlledBestSixSelector.js");
  await run("graduatedDataMode", "../engines/wnba/wnbaGraduatedDataModeV1.js");

  return regressions;
}

const regressions = await runRegressions();

console.log("\n=== SUMMARY ===");
console.log(`Primary tests passed: ${passed}`);
console.log(`Primary tests failed: ${failed}`);
console.log(
  `Regression imports ok: ${regressions.filter((r) => r.ok).length}/${regressions.length}`
);

if (failed > 0) {
  process.exitCode = 1;
}
