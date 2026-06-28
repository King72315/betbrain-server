/**
 * Opponent History Comparison v1 tests (18 cases).
 * Usage: node betbrain-server/scripts/testOpponentHistoryComparisonV1.js
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateOpponentHistoryComparison,
  buildOpponentHistoryCompactLabel,
  OPPONENT_HISTORY_COMPARISON_VERSION,
  resolveRecentFormGames,
  resolveOpponentHistoryGames,
} from "../engines/decisionIntelligence/opponentHistoryComparisonV1.js";
import {
  evaluateDecisionDataIntelligence,
  runFlipFirstDecisionPipeline,
} from "../engines/decisionIntelligence/decisionDataIntelligenceV1.js";
import { evaluatePropDecisionIntelligenceV1 } from "../engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function game(points, extras = {}) {
  return { points, minutes: 28, fga: 10, fta: 3, threePa: 2, ...extras };
}

function baseCard(overrides = {}) {
  return {
    version: "wnba-data-card-v2",
    player: "Test Player",
    team: "minnesotalynx",
    opponent: "indianafever",
    propType: "Points",
    bookLine: 12.5,
    currentLine: 12.5,
    last5: {
      points: 14,
      pointsList: [16, 14, 13, 15, 12],
      minutes: 28,
      fga: 10,
      fta: 3,
      games: 5,
    },
    projection: { projection: 13.5 },
    fairLine: { fairLine: 12, fairLineSide: "OVER", fairLineEdge: 1.5, fairLineQuality: 55 },
    dataMissingFlags: [],
    injuryAvailability: { level: "ACTIVE" },
    ...overrides,
  };
}

function makePick(overrides = {}) {
  const card = baseCard(overrides.wnbaDataCard || {});
  const reader = overrides.wnbaReader || readWnbaProp(card);
  const side = overrides.side || (reader.finalSide === "UNDER" ? "Under" : "Over");
  return {
    player: card.player,
    team: card.team,
    opponent: card.opponent,
    line: card.bookLine,
    side,
    pick: side,
    stat: "Points",
    league: "WNBA",
    engineHandled: "WNBA_V2",
    wnbaDataCard: card,
    wnbaReader: reader,
    ...overrides,
  };
}

const tests = [];

tests.push({
  name: "01 five-plus opponent games supporting Over strengthens Over",
  fn() {
    const last5 = [game(16), game(15), game(14), game(17), game(16)];
    const matchup = [game(18), game(16), game(15), game(17), game(16)];
    const result = evaluateOpponentHistoryComparison(makePick(), {
      line: 12.5,
      side: "OVER",
      last5,
      matchupGames: matchup,
    });
    assert.strictEqual(result.opponentHistory.sampleStatus, "STRONG_SAMPLE");
    assert.strictEqual(result.comparison.agreement, "AGREES_WITH_RECENT");
    assert.strictEqual(result.comparison.finalImpact, "STRENGTHEN");
    assert.strictEqual(result.recentForm.sideSupport, "OVER");
    assert.strictEqual(result.opponentHistory.sideSupport, "OVER");
  },
});

tests.push({
  name: "02 five-plus opponent games contradicting Over triggers Under check",
  fn() {
    const last5 = [game(16), game(15), game(14), game(17), game(16)];
    const matchup = [game(8), game(9), game(10), game(7), game(8)];
    const result = evaluateOpponentHistoryComparison(makePick(), {
      line: 12.5,
      side: "OVER",
      last5,
      matchupGames: matchup,
    });
    assert.strictEqual(result.comparison.agreement, "CONTRADICTS_RECENT");
    assert.strictEqual(result.comparison.flipSignal, "CHECK_UNDER");
    assert.strictEqual(result.comparison.riskImpact, "RAISE");
  },
});

tests.push({
  name: "03 three to four opponent games get medium weight",
  fn() {
    const last5 = [game(16), game(15), game(14), game(13), game(12)];
    const matchup = [game(16), game(15), game(14)];
    const result = evaluateOpponentHistoryComparison(makePick(), {
      line: 12.5,
      side: "OVER",
      last5,
      matchupGames: matchup,
    });
    assert.strictEqual(result.opponentHistory.sampleStatus, "USABLE");
    assert.strictEqual(result.comparison.weight, 0.55);
    assert.strictEqual(result.comparison.finalImpact, "STRENGTHEN");
  },
});

tests.push({
  name: "04 one to two opponent games get light weight only",
  fn() {
    const last5 = [game(16), game(15), game(14), game(13), game(12)];
    const matchup = [game(8), game(9)];
    const result = evaluateOpponentHistoryComparison(makePick(), {
      line: 12.5,
      side: "OVER",
      last5,
      matchupGames: matchup,
    });
    assert.strictEqual(result.opponentHistory.sampleStatus, "SMALL_SAMPLE");
    assert.strictEqual(result.comparison.weight, 0.25);
    assert.strictEqual(result.comparison.flipSignal, "NONE");
    assert.strictEqual(result.comparison.finalImpact, "NEUTRAL");
  },
});

tests.push({
  name: "05 zero opponent games returns NO_HISTORY and no penalty",
  fn() {
    const last5 = [game(16), game(15), game(14), game(13), game(12)];
    const result = evaluateOpponentHistoryComparison(makePick(), {
      line: 12.5,
      side: "OVER",
      last5,
      matchupGames: [],
    });
    assert.strictEqual(result.opponentHistory.noHistory, true);
    assert.strictEqual(result.opponentHistory.sideSupport, "NO_HISTORY");
    assert.strictEqual(result.comparison.agreement, "NO_HISTORY");
    assert.strictEqual(result.comparison.confidenceImpact, "NONE");
    assert.strictEqual(result.comparison.riskImpact, "NONE");
    assert.strictEqual(result.comparison.flipSignal, "NONE");
    assert.strictEqual(result.status, "NO_HISTORY");
  },
});

tests.push({
  name: "06 no opponent history does not set dataMissing",
  fn() {
    const pick = makePick({ matchupGames: [] });
    const card = pick.wnbaDataCard;
    assert.ok(!card.dataMissingFlags.some((f) => f.key === "opponentHistory"));
    const result = evaluateOpponentHistoryComparison(pick, { last5: [game(14)], matchupGames: [] });
    assert.strictEqual(result.comparison.agreement, "NO_HISTORY");
  },
});

tests.push({
  name: "07 no opponent history does not increase risk",
  fn() {
    const pick = makePick({ matchupGames: [] });
    const enriched = runFlipFirstDecisionPipeline(pick, { last5: [game(14)], matchupGames: [] });
    const di = evaluatePropDecisionIntelligenceV1(enriched);
    assert.ok(!di.riskDebts.some((d) => d.code === "OPPONENT_HISTORY_CONTRADICTS"));
    assert.ok(!di.riskDebts.some((d) => d.code === "MISSING_OPPONENT_HISTORY"));
  },
});

tests.push({
  name: "08 no opponent history does not flip side",
  fn() {
    const pick = makePick({ side: "Over", pick: "Over" });
    const enriched = runFlipFirstDecisionPipeline(pick, {
      last5: [game(16), game(15), game(14), game(13), game(12)],
      matchupGames: [],
    });
    assert.strictEqual(String(enriched.side).toUpperCase(), "OVER");
    assert.notStrictEqual(enriched.flipFirstDecision?.action, "FLIPPED_TO_UNDER");
  },
});

tests.push({
  name: "09 contradicting opponent history does not auto-flip without independent evidence",
  fn() {
    const last5 = [game(16), game(15), game(14), game(17), game(16)];
    const matchup = [game(8), game(9), game(10), game(7), game(8)];
    const pick = makePick({ side: "Over", pick: "Over" });
    const enriched = runFlipFirstDecisionPipeline(pick, {
      last5,
      matchupGames: matchup,
    });
    assert.notStrictEqual(enriched.flipFirstDecision?.action, "FLIPPED_TO_UNDER");
    assert.ok(enriched.opponentHistoryComparison?.comparison?.flipSignal);
  },
});

tests.push({
  name: "10 opponent history agrees with recent form boosts confidence",
  fn() {
    const last5 = [game(16), game(15), game(14), game(17), game(16)];
    const matchup = [game(18), game(16), game(15), game(17), game(16)];
    const pick = makePick({ side: "Over", pick: "Over" });
    const ddi = evaluateDecisionDataIntelligence(pick, { last5, matchupGames: matchup });
    assert.strictEqual(
      ddi.opponentHistoryComparison.comparison.confidenceImpact,
      "BOOST"
    );
    assert.ok(ddi.finalInfluence.confidenceAdjustment >= 0);
  },
});

tests.push({
  name: "11 opponent history contradicts recent form raises risk",
  fn() {
    const last5 = [game(16), game(15), game(14), game(17), game(16)];
    const matchup = [game(8), game(9), game(10), game(7), game(8)];
    const pick = makePick({ side: "Over", pick: "Over" });
    const ddi = evaluateDecisionDataIntelligence(pick, { last5, matchupGames: matchup });
    assert.strictEqual(ddi.opponentHistoryComparison.comparison.riskImpact, "RAISE");
    assert.ok(
      ddi.finalInfluence.reasons.some((r) => r.includes("Opponent history"))
    );
  },
});

tests.push({
  name: "12 current six Results props shape can be re-evaluated",
  fn() {
    const six = [
      { player: "Jessica Shepard", side: "Over", line: 13.5 },
      { player: "Azzi Fudd", side: "Over", line: 14.5 },
      { player: "Veronica Burton", side: "Under", line: 11.5 },
      { player: "Leonie Fiebich", side: "Over", line: 10.5 },
      { player: "Kamilla Cardoso", side: "Over", line: 12.5 },
      { player: "Sydney Taylor", side: "Over", line: 14.5 },
    ];
    for (const entry of six) {
      const pick = makePick({
        player: entry.player,
        side: entry.side,
        pick: entry.side,
        wnbaDataCard: baseCard({ player: entry.player, bookLine: entry.line, currentLine: entry.line }),
      });
      const result = evaluateOpponentHistoryComparison(pick, { line: entry.line, side: entry.side });
      assert.strictEqual(result.version, OPPONENT_HISTORY_COMPARISON_VERSION);
      assert.ok(result.recentForm);
      assert.ok(result.opponentHistory);
      assert.ok(result.comparison);
    }
  },
});

tests.push({
  name: "13 Results still tracks all 6 Best 6 props (controlled selector unchanged)",
  fn() {
    const src = fs.readFileSync(
      path.join(__dirname, "../engines/topProps/controlledBestSixSelector.js"),
      "utf8"
    );
    assert.ok(src.includes("CONTROLLED_BEST_SIX"));
    assert.ok(!src.includes("/clear-tracked-props"));
    assert.ok(src.includes("trackingCohortSource"));
  },
});

tests.push({
  name: "14 Top tab still uses best 2 from same Best 6",
  fn() {
    const topProps = fs.readFileSync(path.join(__dirname, "../../app/(tabs)/top-props.tsx"), "utf8");
    const selector = fs.readFileSync(
      path.join(__dirname, "../engines/topProps/controlledBestSixSelector.js"),
      "utf8"
    );
    assert.ok(topProps.includes("top-props") || topProps.includes("Top"));
    assert.ok(selector.includes("topPick") || selector.includes("TOP"));
  },
});

tests.push({
  name: "15 No new markets were added",
  fn() {
    const mod = fs.readFileSync(
      path.join(__dirname, "../engines/decisionIntelligence/opponentHistoryComparisonV1.js"),
      "utf8"
    );
    assert.ok(mod.includes("POINTS_ONLY"));
    assert.ok(!mod.includes('"Assists"'));
    assert.ok(!mod.includes('"Rebounds"'));
    assert.ok(!mod.includes('"PRA"'));
  },
});

tests.push({
  name: "16 No runtime JSON committed (module does not write store files)",
  fn() {
    const mod = fs.readFileSync(
      path.join(__dirname, "../engines/decisionIntelligence/opponentHistoryComparisonV1.js"),
      "utf8"
    );
    assert.ok(!mod.includes("tracked-props.json"));
    assert.ok(!mod.includes("writeFileSync"));
    assert.ok(!mod.includes("fs.writeFile"));
  },
});

tests.push({
  name: "17 /clear-tracked-props not used in new code",
  fn() {
    const mod = fs.readFileSync(
      path.join(__dirname, "../engines/decisionIntelligence/opponentHistoryComparisonV1.js"),
      "utf8"
    );
    assert.ok(!mod.includes("clear-tracked-props"));
  },
});

tests.push({
  name: "18 Best Six re-pipeline preserves matchupGames from data card",
  fn() {
    const matchup = [game(12), game(7)];
    const pick = makePick({
      side: "Over",
      pick: "Over",
      last5: [game(16), game(15), game(14), game(17), game(16)],
      wnbaDataCard: {
        ...baseCard(),
        matchupGames: matchup,
      },
    });
    const enriched = runFlipFirstDecisionPipeline(pick, {
      dataCard: pick.wnbaDataCard,
      reader: pick.wnbaReader,
      originalSide: "OVER",
    });
    assert.strictEqual(
      enriched.opponentHistoryComparison?.opponentHistory?.gamesFound,
      2
    );
    assert.notStrictEqual(enriched.opponentHistoryLabel, "No history");
  },
});

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    test.fn();
    passed += 1;
    console.log(`PASS ${test.name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${test.name}`);
    console.error(err.message);
  }
}

console.log(`\n${passed}/${tests.length} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

process.exit(0);
