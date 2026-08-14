/**
 * CourtEdge Grade-A Recovery V3 control-plane regression tests.
 */
import assert from "assert";
import {
  buildHomeProductTruthSectionsV3,
  hasCompleteTrustedPacketV3,
  HOME_PRODUCT_TRUTH_SECTIONS_BUILD,
} from "../services/courtEdgeHomeProductTruthSectionsV3.js";
import {
  selectOfficialMembershipV2,
  selectHomeBoardCrossMarketV2,
  trainDecisionEngineV2,
} from "../services/courtEdgeDecisionEngineV2.js";
import { buildDecisionCorpusV2 } from "../services/courtEdgeDecisionCorpusV2.js";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

const corpus = buildDecisionCorpusV2({ persist: false });
const engine = trainDecisionEngineV2({ corpus });

function pkt(partial) {
  return {
    fairLine: 10,
    safetyScore: 0.65,
    risk: "MEDIUM",
    projection: 11,
    line: 10.5,
    selectedSide: "OVER",
    propType: "POINTS",
    boardCandidate: true,
    modelWinProbability: 0.62,
    decisionScoreV2: 0.62,
    ...partial,
  };
}

test("sections build separates Trusted / Best Available / Full", () => {
  const trusted = [pkt({ player: "T1", propType: "ASSISTS", decisionScoreV2: 0.8 })];
  const full = [
    ...trusted,
    pkt({ player: "B1", propType: "POINTS", decisionScoreV2: 0.7 }),
    pkt({ player: "B2", propType: "REBOUNDS", decisionScoreV2: 0.69 }),
  ];
  const sec = buildHomeProductTruthSectionsV3({ trusted, full, bestAvailableDisplayMax: 10 });
  assert.strictEqual(sec.build, HOME_PRODUCT_TRUTH_SECTIONS_BUILD);
  assert.strictEqual(sec.marketBalancedWeave, false);
  assert.strictEqual(sec.forcedHomeVolume, false);
  assert.strictEqual(sec.trustedCount, 1);
  assert.strictEqual(sec.bestAvailableCount, 2);
  assert.strictEqual(sec.fullCount, 3);
  assert.ok(sec.bestAvailable.every((p) => p.player !== "T1"));
});

test("Trusted may equal zero", () => {
  const full = [
    pkt({ player: "A", decisionScoreV2: 0.6 }),
    pkt({ player: "B", decisionScoreV2: 0.55 }),
  ];
  const sec = buildHomeProductTruthSectionsV3({ trusted: [], full });
  assert.strictEqual(sec.trustedCount, 0);
  assert.ok(sec.bestAvailableCount >= 1);
});

test("six Assists may occupy Best Available top if deserved — no weave", () => {
  const full = Array.from({ length: 6 }, (_, i) =>
    pkt({
      player: `Ast${i}`,
      propType: "ASSISTS",
      decisionScoreV2: 0.9 - i * 0.01,
    })
  ).concat([
    pkt({ player: "PtsLow", propType: "POINTS", decisionScoreV2: 0.5 }),
  ]);
  const sec = buildHomeProductTruthSectionsV3({
    trusted: [],
    full,
    bestAvailableDisplayMax: 6,
  });
  assert.strictEqual(sec.bestAvailable.length, 6);
  assert.ok(sec.bestAvailable.every((p) => p.propType === "ASSISTS"));
  assert.strictEqual(sec.bestAvailableByMarket.POINTS, 0);
});

test("incomplete packet fails Trusted gate", () => {
  const gate = hasCompleteTrustedPacketV3({
    propType: "POINTS",
    side: "OVER",
    line: 7.5,
    projection: null,
    fairLine: null,
    modelWinProbability: 0.89,
  });
  assert.strictEqual(gate.ok, false);
  assert.ok(
    gate.reasons.includes("MISSING_PROJECTION") ||
      gate.reasons.includes("MISSING_FAIR_LINE") ||
      gate.reasons.includes("MISSING_SAFETY"),
    JSON.stringify(gate.reasons)
  );
});

test("Official selector rejects incomplete packets", () => {
  const mem = selectOfficialMembershipV2(
    [
      {
        playerName: "Incomplete",
        propType: "POINTS",
        selectedSide: "OVER",
        line: 10.5,
        projection: 12,
        boardCandidate: true,
        rawWinProbability: 0.7,
      },
      pkt({
        playerName: "Complete",
        propType: "POINTS",
        selectedSide: "OVER",
        line: 9.5,
        projection: 14,
        rawWinProbability: 0.68,
      }),
    ],
    { engine, qualityProbFloor: 0.4 }
  );
  assert.ok(mem.selectedPackets.every((p) => p.playerName === "Complete"));
});

test("cross-market helper no longer round-robin balances", () => {
  const packets = Array.from({ length: 6 }, (_, i) =>
    pkt({
      playerName: `Ast${i}`,
      propType: "ASSISTS",
      selectedSide: "UNDER",
      line: 3.5 + i * 0.5,
      projection: 2.5,
      fairLine: 3,
      decisionScoreV2: 0.8 - i * 0.01,
      modelWinProbability: 0.8 - i * 0.01,
    })
  );
  const sel = selectHomeBoardCrossMarketV2(packets, {
    maxBoard: 6,
    trustIncomingScores: true,
  });
  assert.strictEqual(sel.marketBalancedWeave, false);
  assert.strictEqual(sel.boardSizePolicy, "GLOBAL_QUALITY_NO_STAT_WEAVE_V3");
  assert.strictEqual(sel.byMarketSelected.ASSISTS, 6);
  assert.strictEqual(sel.byMarketSelected.POINTS, 0);
});

test("odds-only regenerate blocked without diagnostic env", () => {
  const script = path.join(__dirname, "regenerateMultiStatHomeSlate.js");
  const r = spawnSync(process.execPath, [script, "2099-01-01"], {
    env: { ...process.env, COURTEDGE_ALLOW_ODDS_ONLY_DIAGNOSTIC: "" },
    encoding: "utf8",
  });
  assert.notStrictEqual(r.status, 0);
  const out = String(r.stdout || "") + String(r.stderr || "");
  assert.ok(out.includes("ODDS_ONLY_REGENERATE_BLOCKED_FROM_PRODUCTION"));
});

console.log("\nCourtEdge Grade-A Recovery V3 control-plane tests done");
