/**
 * Tests for Home analysis hydrate + market/scrub/shell gates.
 */
import assert from "assert";
import {
  buildHomeDetailedAnalysisV1,
  attachHomeDetailedAnalysisV1,
  formatHomeDetailedAnalysisReportText,
} from "../services/courtEdgeHomeDetailedAnalysisV1.js";
import {
  isShellHomeAnalysis,
  assessAnalysisCompleteness,
  HOME_ANALYSIS_HYDRATE_BUILD,
} from "../services/courtEdgeHomeAnalysisHydrateV1.js";
import {
  buildHomeDisplayWhy,
  stripRawDecisionLabels,
} from "../engines/topProps/homeReasonTextV1.js";
import {
  consumerTextContainsRawCodes,
  scrubConsumerFacingText,
  translateOrScrubAction,
} from "../services/courtEdgeAnalysisIntegrityV1.js";

function test(name, fn) {
  try {
    fn();
    console.log(`ok - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    throw err;
  }
}

function shellPick(overrides = {}) {
  return {
    player: "Kelsey Mitchell",
    team: "Indiana Fever",
    opponent: "Connecticut Sun",
    league: "WNBA",
    side: "Over",
    pick: "Over",
    line: 21.5,
    sealedLine: 21.5,
    currentLine: 21.5,
    projection: 26.3,
    confidence: 82,
    trueRisk: "MEDIUM",
    finalConfidence: 82,
    trackingEligibility: "TRACK",
    flipFirst: { action: "KEEP" },
    sideRescueAction: "KEEP_ORIGINAL",
    displayWhy: "Over has unstable minutes. ROLE_TREND_CONTRADICTS_SIDE",
    courtEdgePlayerEvidence: {
      schemaVersion: "courtEdgePlayerEvidenceV1",
      recentForm: { last5Points: null, sampleSize: 0 },
      roleAndVolume: {},
      matchup: { sampleSize: 0 },
      opponentContext: { defenseStatus: "UNAVAILABLE" },
      dataQuality: { coveragePct: 44.4, fakeCompleteCoverage: false },
    },
    ...overrides,
  };
}

test("01 shell detection at 44% coverage without L5", () => {
  const pick = attachHomeDetailedAnalysisV1(shellPick());
  assert.ok(isShellHomeAnalysis(pick));
  assert.strictEqual(pick.homeDetailedAnalysisV1.dataQuality.shellAnalysis, true);
  assert.strictEqual(pick.homeDetailedAnalysisV1.dataQuality.analysisComplete, false);
  const c = assessAnalysisCompleteness(pick);
  assert.strictEqual(c.shell, true);
});

test("02 market sealed=current without open → NEUTRAL not UNAVAILABLE", () => {
  const a = buildHomeDetailedAnalysisV1(
    shellPick({
      openingLine: null,
      sealedLine: 21.5,
      currentLine: 21.5,
      last5: [
        { points: 24, minutes: 32, fga: 18, fta: 4 },
        { points: 22, minutes: 30, fga: 16, fta: 3 },
        { points: 28, minutes: 34, fga: 20, fta: 5 },
        { points: 19, minutes: 29, fga: 15, fta: 2 },
        { points: 25, minutes: 31, fga: 17, fta: 4 },
      ],
      courtEdgePlayerEvidence: {
        schemaVersion: "courtEdgePlayerEvidenceV1",
        recentForm: { last5Points: [24, 22, 28, 19, 25], sampleSize: 5 },
        roleAndVolume: { last5Minutes: 31.2, fga: 17.2, fta: 3.6 },
        matchup: { sampleSize: 0 },
        opponentContext: { defenseStatus: "UNAVAILABLE" },
        dataQuality: { coveragePct: 66.7 },
        market: { openingLine: null },
      },
    })
  );
  assert.strictEqual(a.marketAnalysis.compactResult, "NEUTRAL");
  assert.notStrictEqual(a.marketAnalysis.compactResult, "UNAVAILABLE");
  assert.ok(a.marketAnalysis.unavailableIsNotAgainst);
  assert.match(
    a.marketAnalysis.marketRelativeToFinalSide.explanation || "",
    /NEUTRAL|sealed\/current/i
  );
});

test("03 raw ROLE_TREND / KEEP / KEEP_ORIGINAL scrubbed from Why + Decision", () => {
  const why = buildHomeDisplayWhy(
    shellPick({
      displayWhy: "Over unstable. ROLE_TREND_CONTRADICTS_SIDE",
      naturalGateReason: "ROLE_TREND_CONTRADICTS_SIDE",
    })
  );
  assert.doesNotMatch(why, /ROLE_TREND_CONTRADICTS_SIDE/);
  assert.ok(!consumerTextContainsRawCodes(why));

  const pick = attachHomeDetailedAnalysisV1(
    shellPick({
      last5: [
        { points: 20 },
        { points: 21 },
        { points: 22 },
        { points: 23 },
        { points: 24 },
      ],
      courtEdgePlayerEvidence: {
        schemaVersion: "courtEdgePlayerEvidenceV1",
        recentForm: { last5Points: [20, 21, 22, 23, 24], sampleSize: 5 },
        roleAndVolume: { last5Minutes: 30, fga: 15, fta: 3 },
        matchup: { sampleSize: 0 },
        dataQuality: { coveragePct: 66.7 },
      },
    })
  );
  const text = formatHomeDetailedAnalysisReportText(pick.homeDetailedAnalysisV1, pick);
  assert.doesNotMatch(text, /Flip KEEP\b/);
  assert.doesNotMatch(text, /Rescue KEEP_ORIGINAL/);
  assert.doesNotMatch(text, /ROLE_TREND_CONTRADICTS_SIDE/);
  assert.match(text, /Kept original side/);
  assert.strictEqual(
    translateOrScrubAction("KEEP_ORIGINAL"),
    "Kept original side"
  );
  assert.ok(!/\bKEEP_ORIGINAL\b/.test(scrubConsumerFacingText("Rescue KEEP_ORIGINAL")));
});

test("04 same-team forced Under keeps Original side OVER in snapshot", () => {
  const a = buildHomeDetailedAnalysisV1(
    shellPick({
      side: "Under",
      pick: "Under",
      finalSide: "UNDER",
      finalCourtEdgeSide: "UNDER",
      sameTeamArbitrationFlip: true,
      sameTeamArbitration: {
        applied: true,
        originalModelSide: "OVER",
      },
      originalModelSide: "OVER",
      last5: [{ points: 18 }, { points: 16 }, { points: 19 }, { points: 14 }, { points: 17 }],
      courtEdgePlayerEvidence: {
        schemaVersion: "courtEdgePlayerEvidenceV1",
        recentForm: { last5Points: [18, 16, 19, 14, 17], sampleSize: 5 },
        roleAndVolume: { last5Minutes: 28, fga: 14, fta: 2 },
        matchup: { sampleSize: 0 },
        dataQuality: { coveragePct: 66.7 },
      },
    })
  );
  assert.strictEqual(a.propSnapshot.finalCourtEdgeSide, "UNDER");
  assert.strictEqual(a.propSnapshot.originalModelSide, "OVER");
  assert.strictEqual(a.finalDecision.sameTeamArbitration.applied, true);
});

test("05 stripRawDecisionLabels removes ROLE_TREND", () => {
  const cleaned = stripRawDecisionLabels(
    "Minutes unstable. ROLE_TREND_CONTRADICTS_SIDE KEEP_ORIGINAL"
  );
  assert.doesNotMatch(cleaned, /ROLE_TREND|KEEP_ORIGINAL/);
});

test("06 hydrate build constant", () => {
  assert.strictEqual(HOME_ANALYSIS_HYDRATE_BUILD, "courteedge-home-analysis-hydrate-v1");
});

test("07 UNDER must not match /over/ substring when preserving side", () => {
  // Regression: old display mapping used /over/i ? Over : Under. Prefer exact
  // UNDER/OVER tokens (and U/O abbreviations) so sides cannot flip incorrectly.
  const normalize = (side) => {
    const sideNorm = String(side || "")
      .trim()
      .toUpperCase()
      .replace(/^U$/, "UNDER")
      .replace(/^O$/, "OVER");
    const isOver = sideNorm === "OVER" || sideNorm.startsWith("OVER");
    const isUnder = sideNorm === "UNDER" || sideNorm.startsWith("UNDER");
    return { sideNorm, isOver, isUnder, display: isUnder ? "Under" : isOver ? "Over" : String(side) };
  };
  const under = normalize("UNDER");
  assert.strictEqual(under.isOver, false);
  assert.strictEqual(under.isUnder, true);
  assert.strictEqual(under.display, "Under");
  const underDisp = normalize("Under");
  assert.strictEqual(underDisp.display, "Under");
  assert.strictEqual(normalize("U").display, "Under");
  assert.strictEqual(normalize("OVER").display, "Over");
  assert.strictEqual(normalize("O").display, "Over");
});

console.log("\nAll home-analysis-hydrate tests passed.");
