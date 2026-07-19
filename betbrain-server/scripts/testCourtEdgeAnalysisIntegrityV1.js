/**
 * CourtEdge Analysis Integrity V1 — focused repair tests.
 */
import assert from "assert";
import {
  ANALYSIS_INTEGRITY_BUILD,
  ANALYSIS_INTEGRITY_VERSION,
  CANONICAL_DECISION_DISPLAY_OWNER,
  buildTopPickTransparency,
  consumerTextContainsRawCodes,
  ensureValidPlayerEvidence,
  measuredNum,
  nonNegativeVolume,
  normalizePersonName,
  rebuildPlayerEvidenceFromPick,
  resolveCanonicalDecisionFields,
  roundConfidence,
  roundStat,
  scrubConsumerFacingText,
  syncCanonicalDecisionOntoPick,
  validatePlayerEvidencePacket,
} from "../services/courtEdgeAnalysisIntegrityV1.js";
import {
  attachHomeDetailedAnalysisV1,
  buildHomeDetailedAnalysisV1,
  formatHomeDetailedAnalysisReportText,
  HOME_DETAILED_ANALYSIS_BUILD,
} from "../services/courtEdgeHomeDetailedAnalysisV1.js";
import { buildHomeDisplayWhy } from "../engines/topProps/homeReasonTextV1.js";

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  ✗ ${name}`);
    console.error(`    ${err.message}`);
  }
}

function basePick(overrides = {}) {
  return {
    player: "Rhyne Howard",
    team: "ATL",
    opponent: "CHI",
    league: "WNBA",
    line: 18.5,
    sealedLine: 18.5,
    selectedLine: 18.5,
    openingLine: 18.5,
    currentLine: 18.5,
    side: "Under",
    pick: "Under",
    finalCourtEdgeSide: "UNDER",
    confidence: 66.4,
    finalConfidence: 66.4,
    displayTrueRisk: "MEDIUM",
    trueRisk: "MEDIUM",
    riskLabel: "High Risk",
    decisionIntelligence: {
      trueRisk: "MEDIUM",
      trackEligibility: "TRACK",
      simpleExplanation: "Projection edge supports Under.",
    },
    projection: 15.55,
    fairLine: 15.5,
    expectedMinutes: 31.2,
    expectedFGA: 13.4,
    expectedFTA: 3.1,
    last5: [
      { points: 11, minutes: 30, fga: 12, fta: 3 },
      { points: 10, minutes: 28, fga: 11, fta: 2 },
      { points: 19, minutes: 32, fga: 15, fta: 4 },
      { points: 19, minutes: 31, fga: 14, fta: 3 },
      { points: 24, minutes: 34, fga: 16, fta: 5 },
    ],
    matchupGames: [
      { date: "2026-06-21", points: 17, minutes: 34, fga: 15, fta: 4 },
      { date: "2026-05-10", points: 14, minutes: 30, fga: 12, fta: 2 },
      { date: "2026-04-02", points: 12, minutes: 28, fga: 11, fta: 1 },
    ],
    courtEdgeDecisionPacketV1: {
      version: "courtEdgeDecisionPacketV1",
      finalConfidence: 66.4,
      confidence: 66.4,
      trueRisk: "MEDIUM",
      side: "UNDER",
      line: 18.5,
      decisionHash: "abc123",
    },
    ...overrides,
  };
}

console.log("\nCourtEdge Analysis Integrity V1\n");

test("01 integrity build stamped on analysis", () => {
  assert.strictEqual(HOME_DETAILED_ANALYSIS_BUILD, ANALYSIS_INTEGRITY_BUILD);
  assert.strictEqual(ANALYSIS_INTEGRITY_VERSION, "courtEdgeAnalysisIntegrityV1");
});

test("02 single conf/risk owner documented", () => {
  assert.match(CANONICAL_DECISION_DISPLAY_OWNER, /finalConfidence|decisionPacket/i);
  assert.match(CANONICAL_DECISION_DISPLAY_OWNER, /trueRisk|displayTrueRisk/i);
});

test("03 packet wins over conflicting riskLabel", () => {
  const fields = resolveCanonicalDecisionFields(
    basePick({ riskLabel: "High Risk", displayTrueRisk: null, trueRisk: null })
  );
  assert.strictEqual(fields.finalRisk, "MEDIUM");
  assert.strictEqual(fields.finalConfidence, 66);
  assert.match(String(fields.source), /decisionPacket|decision_packet/i);
});

test("04 attach syncs conf/risk across trails", () => {
  const pick = attachHomeDetailedAnalysisV1(
    basePick({ riskLabel: "High Risk", displayTrueRisk: null })
  );
  assert.strictEqual(pick.confidence, 66);
  assert.strictEqual(pick.finalConfidence, 66);
  assert.strictEqual(pick.displayTrueRisk, "MEDIUM");
  assert.strictEqual(pick.trueRisk, "MEDIUM");
  assert.strictEqual(pick.homeDetailedAnalysisV1.canonical.confidence, 66);
  assert.strictEqual(pick.homeDetailedAnalysisV1.canonical.risk, "MEDIUM");
  assert.strictEqual(pick.homeDetailedAnalysisV1.finalDecision.finalConfidence, 66);
  assert.strictEqual(pick.homeDetailedAnalysisV1.propSnapshot.confidence, 66);
  assert.strictEqual(pick.riskLabel, "Medium Risk");
});

test("05 sealed canonical beats live pick drift", () => {
  const sealed = attachHomeDetailedAnalysisV1(
    basePick({ officiallySealed: true, sealedAt: "2026-07-19T10:00:00.000Z" })
  );
  const next = attachHomeDetailedAnalysisV1({
    ...sealed,
    confidence: 99,
    finalConfidence: 99,
    displayTrueRisk: "HIGH",
    courtEdgeDecisionPacketV1: {
      ...sealed.courtEdgeDecisionPacketV1,
      finalConfidence: 99,
      trueRisk: "HIGH",
    },
  });
  assert.strictEqual(next.homeDetailedAnalysisV1.canonical.confidence, 66);
  assert.strictEqual(next.confidence, 66);
  assert.strictEqual(next.displayTrueRisk, "MEDIUM");
});

test("06 missing fields stay null not zero", () => {
  const a = buildHomeDetailedAnalysisV1(
    basePick({
      expectedMinutes: null,
      expectedFGA: undefined,
      expectedFTA: "",
      last5: [],
      matchupGames: [],
      projection: null,
      courtEdgePlayerEvidence: {
        schemaVersion: "courtEdgePlayerEvidenceV1",
        recentForm: { last5Points: null },
        roleAndVolume: {},
        matchup: { sampleSize: 0, points: [] },
        opponentContext: { defenseStatus: "UNAVAILABLE", defenseScore: null },
        dataQuality: { coveragePct: 20 },
      },
    })
  );
  assert.strictEqual(a.roleOpportunity.expectedMinutes, null);
  assert.strictEqual(a.roleOpportunity.expectedFGA, null);
  assert.strictEqual(a.roleOpportunity.expectedFTA, null);
  assert.strictEqual(a.recentPerformance.last5Average, null);
  assert.strictEqual(a.projectionDistribution.finalProjection, null);
  assert.strictEqual(a.matchupHistory.status, "UNAVAILABLE");
  assert.notStrictEqual(a.roleOpportunity.expectedMinutes, 0);
  assert.notStrictEqual(a.recentPerformance.last5Average, 0);
});

test("07 Lacan accented name normalizes for identity join", () => {
  assert.strictEqual(normalizePersonName("Leïla Lacan"), "leila lacan");
  assert.strictEqual(normalizePersonName("Leila Lacan"), "leila lacan");
});

test("08 Lacan invalid evidence packet rejected and rebuilt", () => {
  const corrupt = {
    player: "Leïla Lacan",
    team: "LAS",
    opponent: "SEA",
    league: "WNBA",
    line: 9.5,
    side: "Over",
    confidence: 55,
    last5: [
      { points: 12, minutes: 24, fga: 10, fta: 2 },
      { points: 8, minutes: 22, fga: 9, fta: 1 },
      { points: 14, minutes: 26, fga: 11, fta: 3 },
      { points: 7, minutes: 20, fga: 8, fta: 2 },
      { points: 11, minutes: 25, fga: 10, fta: 2 },
    ],
    courtEdgePlayerEvidence: {
      schemaVersion: "courtEdgePlayerEvidenceV1",
      identity: { oddsPlayerName: "Wrong Player" },
      recentForm: { last5Points: [0, 0, 0, 0, 0], sampleSize: 5 },
      roleAndVolume: { last5Minutes: -5, fga: 0, fta: 0 },
      dataQuality: { coveragePct: 90, fakeCompleteCoverage: true },
      matchup: { sampleSize: 0 },
    },
  };
  const check = validatePlayerEvidencePacket(corrupt.courtEdgePlayerEvidence, corrupt);
  assert.strictEqual(check.shouldRebuild, true);
  assert.ok(check.issues.includes("identity_name_mismatch"));
  assert.ok(check.issues.includes("zero_poison_points"));

  const fixed = ensureValidPlayerEvidence(corrupt);
  assert.ok(fixed.evidenceIntegrityV1?.rebuilt || fixed.evidenceIntegrity?.action);
  const identityName =
    fixed.courtEdgePlayerEvidence?.identity?.oddsPlayerName ||
    fixed.courtEdgePlayerEvidence?.identity?.playerName ||
    fixed.player;
  assert.strictEqual(normalizePersonName(identityName), "leila lacan");
  const pts = fixed.courtEdgePlayerEvidence?.recentForm?.last5Points || [];
  assert.ok(pts.length >= 3);
  assert.ok(!pts.every((v) => v === 0));
});

test("09 negative volume marked unavailable", () => {
  const neg = nonNegativeVolume(-3.2);
  assert.strictEqual(neg.value, null);
  assert.strictEqual(neg.status, "INVALID_NEGATIVE");
  const a = buildHomeDetailedAnalysisV1(
    basePick({
      expectedMinutes: -4,
      courtEdgePlayerEvidence: {
        schemaVersion: "courtEdgePlayerEvidenceV1",
        recentForm: { last5Points: [10, 11, 12, 13, 14] },
        roleAndVolume: { last5Minutes: -4, fga: -1, fta: 2 },
        matchup: { sampleSize: 0 },
        opponentContext: { defenseStatus: "UNAVAILABLE" },
        dataQuality: { coveragePct: 40 },
      },
    })
  );
  assert.strictEqual(a.roleOpportunity.expectedMinutes, null);
  assert.strictEqual(a.roleOpportunity.last5Minutes, null);
  assert.strictEqual(a.roleOpportunity.last5FGA, null);
});

test("10 raw codes stripped from compact why and copy", () => {
  const why = buildHomeDisplayWhy({
    displayWhy: "BOARD_ONLY — DANGER_GATE_STACK_BOARD_ONLY NO_DECISIVE_RESCUE",
    naturalGateReason: "DANGER_GATE_STACK_BOARD_ONLY",
    decisionIntelligence: { trueRisk: "MEDIUM" },
    side: "Under",
  });
  assert.ok(!consumerTextContainsRawCodes(why));
  assert.doesNotMatch(why, /BOARD_ONLY|DANGER_GATE|NO_DECISIVE/);

  const pick = attachHomeDetailedAnalysisV1(
    basePick({
      displayWhy: "UNDER_GAP_BELOW_WNBA_LIMITED_DATA_FLOOR flagged by danger gate.",
      sideRescueAction: "NO_DECISIVE_RESCUE",
      topPickRank: 1,
    })
  );
  const text = formatHomeDetailedAnalysisReportText(pick.homeDetailedAnalysisV1, pick);
  assert.doesNotMatch(text, /UNDER_GAP_BELOW|DANGER_GATE|BOARD_ONLY|NO_DECISIVE_RESCUE/);
  assert.match(text, /No stronger opposite-side case/i);
});

test("11 displayed numbers are rounded", () => {
  const pick = attachHomeDetailedAnalysisV1(
    basePick({
      confidence: 66.44,
      projection: 15.555,
      fairLine: 15.555,
      courtEdgeDecisionPacketV1: {
        version: "courtEdgeDecisionPacketV1",
        finalConfidence: 66.44,
        trueRisk: "MEDIUM",
        side: "UNDER",
        line: 18.5,
      },
    })
  );
  const a = pick.homeDetailedAnalysisV1;
  assert.strictEqual(a.canonical.confidence, 66);
  assert.strictEqual(a.projectionDistribution.finalProjection, 15.6);
  assert.strictEqual(roundConfidence(66.44), 66);
  assert.strictEqual(roundStat(15.555), 15.6);
});

test("12 matchup history up to 3 complete rows", () => {
  const a = buildHomeDetailedAnalysisV1(basePick());
  assert.strictEqual(a.matchupHistory.recentMatchups.length, 3);
  for (const row of a.matchupHistory.recentMatchups) {
    assert.ok(row.points !== undefined);
    assert.ok(row.minutes !== undefined);
    assert.ok(row.fga !== undefined);
    assert.ok(row.fta !== undefined);
    assert.ok(row.againstTodaysLine);
  }
  const text = formatHomeDetailedAnalysisReportText(a, basePick());
  assert.match(text, /Matchup 1:/);
  assert.match(text, /Matchup 2:/);
  assert.match(text, /Matchup 3:/);
});

test("13 market unavailable is not against", () => {
  const a = buildHomeDetailedAnalysisV1(
    basePick({
      openingLine: null,
      currentLine: null,
      marketIntelligence: { available: false },
    })
  );
  assert.strictEqual(a.marketAnalysis.compactResult, "UNAVAILABLE");
  assert.notStrictEqual(a.marketAnalysis.compactResult, "AGAINST");
  assert.match(a.marketAnalysis.marketRelativeToFinalSide.explanation, /not treated as AGAINST/i);
  assert.strictEqual(a.marketAnalysis.unavailableIsNotAgainst, true);
});

test("14 Top transparency without rewriting conf/risk", () => {
  const pick = attachHomeDetailedAnalysisV1(
    basePick({
      topPickRank: 1,
      topPickSafetyScore: 80,
      topPickNextScore: 74,
      topPickReason: "Leads board on edge and risk.",
      wnbaReader: { supports: ["Stable minutes"], disagrees: ["Thin books"] },
    })
  );
  const top = pick.homeDetailedAnalysisV1.finalDecision.topPickTransparency;
  assert.ok(top);
  assert.strictEqual(top.rank, 1);
  assert.ok(top.scoreVsNext);
  assert.strictEqual(top.scoreVsNext.margin, 6);
  assert.strictEqual(pick.homeDetailedAnalysisV1.canonical.confidence, 66);
  assert.strictEqual(pick.confidence, 66);
  const built = buildTopPickTransparency(pick, { finalConfidence: 66 });
  assert.strictEqual(built.rank, 1);
});

test("15 measuredNum never invents zero", () => {
  assert.strictEqual(measuredNum(undefined), null);
  assert.strictEqual(measuredNum(null), null);
  assert.strictEqual(measuredNum(""), null);
  assert.strictEqual(measuredNum("abc"), null);
  assert.strictEqual(measuredNum(0), 0);
});

test("16 rebuild evidence from pick last5", () => {
  const rebuilt = rebuildPlayerEvidenceFromPick(
    basePick({ player: "Leïla Lacan", courtEdgePlayerEvidence: null })
  );
  assert.ok((rebuilt.recentForm?.last5Points || []).length >= 3);
  assert.strictEqual(
    normalizePersonName(rebuilt.identity?.oddsPlayerName || "Leïla Lacan"),
    "leila lacan"
  );
});

test("17 scrubConsumerFacingText cleans gate language", () => {
  const cleaned = scrubConsumerFacingText(
    "BOARD_ONLY — flagged by danger gate. UNDER_GAP_BELOW_WNBA_FULL_DATA_FLOOR"
  );
  assert.doesNotMatch(cleaned, /BOARD_ONLY|UNDER_GAP|danger gate/i);
});

test("18 syncCanonicalDecisionOntoPick aligns riskLabel", () => {
  const synced = syncCanonicalDecisionOntoPick(
    basePick({ riskLabel: "High Risk" }),
    { finalConfidence: 70, finalRisk: "LOW", source: "test" }
  );
  assert.strictEqual(synced.riskLabel, "Low Risk");
  assert.strictEqual(synced.displayTrueRisk, "LOW");
  assert.strictEqual(synced.confidence, 70);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
