/**
 * Over-balance + side-rescue regression tests.
 * Usage: node betbrain-server/scripts/testOverBalanceSideRescueV1.js
 */
import assert from "assert";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { evaluateSideRescue } from "../engines/decisionIntelligence/sideRescueEngineV1.js";
import { evaluateFlipFirstSideSelection } from "../engines/decisionIntelligence/flipFirstSideSelectionV1.js";
import {
  selectControlledBestSixCombined,
  CONTROLLED_BEST_SIX_VERSION,
  computeSafetyScore,
} from "../engines/topProps/controlledBestSixSelector.js";
import { collectAllGeneratedCandidates } from "../engines/topProps/topPropSelector.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import { promoteBestSixCohortPick } from "../engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import { buildLeagueControlledSummary, buildLeagueBestSixBoard, resolveLeaguePicksPayload } from "../../utils/controlledBestSixDisplay.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..", "..");

function baseCard(overrides = {}) {
  return {
    version: "wnba-data-card-v2",
    playerId: "123",
    player: "Test Player",
    team: "Team A",
    opponent: "Team B",
    propType: "Points",
    bookLine: 12.5,
    currentLine: 12.5,
    bookCount: 5,
    marketQuality: 70,
    dataMode: "WNBA_FULL",
    season: { points: 11, minutes: 26, fga: 10, fta: 3, ptsPerFGA: 1.05 },
    last5: { points: 10, minutes: 24, fga: 9, fta: 3, ptsPerFGA: 1.05, games: 5 },
    scoringTrend: "stable",
    roleTrend: "stable",
    minutesVolatility: "stable",
    injuryAvailability: { level: "ACTIVE", blocksPlay: false },
    projection: { projection: 10.5, expectedMinutes: 24, expectedFGA: 9 },
    fairLine: { fairLine: 11.5, fairLineSide: "UNDER", fairLineEdge: 1, fairLineQuality: 55 },
    dataMissingFlags: [],
    dataConfidenceScore: 72,
    ...overrides,
  };
}

function makePick(overrides = {}) {
  const card = baseCard(overrides.wnbaDataCard || {});
  const reader = overrides.wnbaReader || readWnbaProp(card);
  const side = overrides.side || (reader.finalSide === "UNDER" ? "Under" : "Over");
  return {
    player: card.player || "Test Player",
    team: "Team A",
    opponent: "Team B",
    line: card.bookLine,
    side,
    pick: side,
    league: "WNBA",
    engineHandled: "WNBA_V2",
    netEdge: reader.margin ?? 6,
    wnbaDataCard: card,
    wnbaReader: reader,
    ...overrides,
  };
}

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ok ${name}`);
  } catch (error) {
    console.error(`  FAIL ${name}`);
    throw error;
  }
}

test("01 opposite score is not zero when rescue not triggered", () => {
  const pick = makePick();
  const sr = evaluateSideRescue(pick, { originalSide: "OVER" });
  assert.strictEqual(sr.triggered, false);
  assert.ok(sr.oppositeRiskAdjustedScore > 0, "expected non-zero opposite audit score");
});

test("02 flip-first CHECK_UNDER triggers rescue review", () => {
  const pick = makePick({
    wnbaDataCard: baseCard({
      player: "Collision Over",
      bookLine: 18.5,
      projection: { projection: 22.5, expectedMinutes: 30, expectedFGA: 12 },
      last5: { points: 21, minutes: 30, fga: 12, fta: 4, ptsPerFGA: 1.1, games: 5 },
      roleTrend: "down",
    }),
  });
  const ff = evaluateFlipFirstSideSelection(pick, { originalSide: "OVER" });
  const sr = evaluateSideRescue(pick, {
    originalSide: "OVER",
    flipFirstDecision: ff,
  });
  assert.ok(
    sr.triggerReasons.includes("FLIP_FIRST_CHECK_OPPOSITE") || sr.triggered,
    "flip-first check should trigger rescue review"
  );
  assert.ok(sr.oppositeSideScore >= 0);
});

test("03 promotion does not duplicate SIDE_RESCUE_BOARD_ONLY flag", () => {
  const promoted = promoteBestSixCohortPick({
    decisionIntelligence: { trackEligibility: "BOARD_ONLY", trueRisk: "HIGH" },
    sideRescue: { action: "BOARD_ONLY" },
    wnbaTrackingDecision: "BOARD_ONLY",
  });
  assert.deepStrictEqual(promoted.bestSixQualityFlags, ["BOARD_ONLY"]);
  assert.ok(!promoted.bestSixQualityFlags.includes("SIDE_RESCUE_BOARD_ONLY"));
});

test("04 controlled selector version bumped", () => {
  assert.strictEqual(CONTROLLED_BEST_SIX_VERSION, "controlled-best-six-lifecycle-stale-sealed-v1");
});

test("05 Jul 7 trust-inspect slate exposes flip-first on best six", () => {
  const raw = JSON.parse(readFileSync(path.join(ROOT, ".tmp-trust-inspect-wnba.json"), "utf8"));
  const result = selectControlledBestSixCombined(raw.games || []);
  const best6 = result.bestSixDisplayWNBA || [];
  assert.ok(best6.length >= 1);
  const withFlip = best6.filter((p) => p.flipFirstAction || p.flipFirstDecision?.action);
  assert.ok(withFlip.length >= 1, "flip-first action should propagate to display picks");
});

test("06 Jul 7 slate is not all overs when unders are viable", () => {
  const raw = JSON.parse(readFileSync(path.join(ROOT, ".tmp-trust-inspect-wnba.json"), "utf8"));
  const result = selectControlledBestSixCombined(raw.games || []);
  const best6 = result.bestSixDisplayWNBA || [];
  const unders = best6.filter((p) => String(p.side || "").toUpperCase().startsWith("U"));
  assert.ok(unders.length >= 1, `expected at least one Under in Best 6, got ${unders.length}`);
});

test("07 summary boardTrack counts natural TRACK only", () => {
  const raw = JSON.parse(readFileSync(path.join(ROOT, ".tmp-trust-inspect-wnba.json"), "utf8"));
  const summary = buildLeagueControlledSummary({
    league: "WNBA",
    games: raw.games,
    bestSixDisplay: [],
    dateView: "full_board",
  });
  assert.ok(summary.boardTrack <= summary.boardCandidates);
  assert.ok(summary.highRisk >= 0);
});

test("08 keep reason avoids inflated opposite when gap floor fails", () => {
  const pick = makePick({
    wnbaDataCard: baseCard({
      player: "Audit Over",
      bookLine: 18.5,
      projection: { projection: 22, expectedMinutes: 28, expectedFGA: 11 },
      last5: { points: 20, minutes: 28, fga: 11, fta: 3, ptsPerFGA: 1.05, games: 5 },
      season: { points: 12, minutes: 26, fga: 9, fta: 3, ptsPerFGA: 1.05 },
    }),
  });
  const sr = evaluateSideRescue(pick, { originalSide: "OVER", flipFirstDecision: { action: "CHECK_UNDER" } });
  assert.ok(sr.triggered);
  const keep = (sr.keepReasons || [])[0] || "";
  assert.ok(!keep.includes("vs 8)"), `unexpected inflated opposite audit score: ${keep}`);
});

test("09 tomorrow view balances unders in display board", () => {
  const raw = JSON.parse(readFileSync(path.join(ROOT, ".tmp-trust-inspect-wnba.json"), "utf8"));
  const result = selectControlledBestSixCombined(raw.games || []);
  const payload = resolveLeaguePicksPayload(
    { ...raw, bestSixDisplayWNBA: result.bestSixDisplayWNBA, bestSixWNBA: result.bestSixWNBA },
    "WNBA"
  );
  const board = buildLeagueBestSixBoard({ ...payload, dateView: "tomorrow" });
  const unders = board.bestSixCards.filter((p) =>
    String(p.side || "").toUpperCase().startsWith("U")
  );
  assert.ok(unders.length >= 2, `tomorrow Best 6 should include >=2 Unders, got ${unders.length}`);
  const overs = board.bestSixCards.length - unders.length;
  assert.ok(overs <= 4, `tomorrow Best 6 should not exceed 4 Overs, got ${overs}`);
});

test("10 unstable thin-book overs rank below danger-stack overs", () => {
  const thinBook = {
    player: "Thin Book Over",
    league: "WNBA",
    wnbaTrackingReason: "OVER_UNSTABLE_THIN_BOOK",
    decisionIntelligence: { trackEligibility: "BOARD_ONLY", trueRisk: "MEDIUM" },
    bestPropScore: 70,
    confidence: 60,
  };
  const dangerStack = {
    player: "Danger Stack Over",
    league: "WNBA",
    wnbaTrackingReason: "DANGER_GATE_STACK_BOARD_ONLY",
    decisionIntelligence: { trackEligibility: "BOARD_ONLY", trueRisk: "MEDIUM" },
    bestPropScore: 68,
    confidence: 58,
  };
  assert.ok(
    computeSafetyScore(dangerStack) > computeSafetyScore(thinBook),
    "danger-stack board pick should outrank unstable thin-book over"
  );
});

test("11 flip-first uses BOTH_SIDES_WEAK when opposite under fails gap floor", () => {
  const pick = makePick({
    wnbaDataCard: baseCard({
      player: "Gap Fail Over",
      bookLine: 18.5,
      minutesVolatility: "unstable",
      bookCount: 1,
      projection: { projection: 20.5, expectedMinutes: 24, expectedFGA: 9 },
      last5: { points: 19, minutes: 22, fga: 8, fta: 2, ptsPerFGA: 1.05, games: 5 },
      roleTrend: "stable",
    }),
  });
  const ff = evaluateFlipFirstSideSelection(pick, { originalSide: "OVER" });
  assert.strictEqual(ff.action, "BOTH_SIDES_WEAK");
});

test("12 side rescue does not inflate opposite when under gap floor fails", () => {
  const pick = makePick({
    wnbaDataCard: baseCard({
      player: "Rescue Gap Fail",
      bookLine: 18.5,
      projection: { projection: 20.5, expectedMinutes: 24, expectedFGA: 9 },
      last5: { points: 19, minutes: 22, fga: 8, fta: 2, ptsPerFGA: 1.05, games: 5 },
      season: { points: 12, minutes: 24, fga: 8, fta: 2, ptsPerFGA: 1.05 },
    }),
  });
  const sr = evaluateSideRescue(pick, {
    originalSide: "OVER",
    flipFirstDecision: { action: "BOTH_SIDES_WEAK" },
  });
  assert.ok(sr.oppositeRiskAdjustedScore <= sr.originalRiskAdjustedScore);
  const keep = (sr.keepReasons || [])[0] || "";
  assert.ok(!keep.includes("vs 8)"), `unexpected inflated opposite score: ${keep}`);
});

console.log(`\nOver-balance side-rescue: ${passed}/${passed} passed`);
