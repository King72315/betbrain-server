/**
 * Guardrail test: Product Truth display must preserve frozen scores.
 */
import assert from "assert";
import { cardToDisplayPick } from "../services/courtEdgeProductTruthUiCutoverV1.js";

const frozen = {
  canonicalPropId: "WNBA|2026-08-14|test|bridget-carleton|REBOUNDS|4.5",
  player: "Bridget Carleton",
  propType: "REBOUNDS",
  side: "OVER",
  line: 4.5,
  projection: 7.1,
  fairLine: 7.2,
  predictedProbability: 0.71,
  modelWinProbability: 0.6975,
  decisionScoreV2: 0.6975,
  officialRankScore: 0.6975,
  safetyScore: 73,
  risk: "HIGH",
  membership: "OFFICIAL",
};

const pick = cardToDisplayPick(frozen, { slateDateCt: "2026-08-14" });
assert.strictEqual(pick.modelWinProbability, 0.6975);
assert.strictEqual(pick.decisionScoreV2, 0.6975);
assert.strictEqual(pick.frozenScorePreserved, true);
assert.strictEqual(pick.projection, 7.1);
assert.strictEqual(pick.fairLine, 7.2);
assert.strictEqual(pick.line, 4.5);
assert.strictEqual(pick.side, "OVER");
console.log("PASS frozen Product Truth display score preservation");
