/**
 * Market-Balanced V2 Home Weave V1 — deterministic tests A–E + Model % orientation.
 * Usage: node scripts/testCourtEdgeHomeMarketWeaveV1.js
 */
import assert from "node:assert/strict";
import {
  selectHomeBoardMarketWeaveV1,
  resolveProvenPropType,
  MAX_HOME_PROPS,
} from "../services/courtEdgeHomeMarketWeaveV1.js";
import { scoreCandidateV2 } from "../services/courtEdgeDecisionEngineV2.js";

function mk(propType, scorePct, opts = {}) {
  const score = scorePct / 100;
  return {
    playerName: opts.player || `${propType.slice(0, 3)}${scorePct}`,
    player: opts.player || `${propType.slice(0, 3)}${scorePct}`,
    propType,
    canonicalPropType: propType,
    side: opts.side || "OVER",
    selectedSide: opts.side || "OVER",
    line: opts.line ?? 10.5,
    projection: opts.projection ?? null,
    modelWinProbability: score,
    decisionScoreV2: score,
    canonicalPropId:
      opts.canonicalPropId ||
      `test|2026-08-13|g1|${opts.player || `${propType}_${scorePct}`}|${propType}|${opts.side || "OVER"}|${opts.line ?? 10.5}`,
  };
}

function labels(selected) {
  return selected.map((p) => {
    const pct = Math.round(Number(p.modelWinProbability) * 100);
    const prefix =
      p.propType === "POINTS" ? "PTS" : p.propType === "REBOUNDS" ? "REB" : "AST";
    return `${prefix}${pct}`;
  });
}

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

check("TEST A — NORMAL 3-MARKET", () => {
  const pool = [
    mk("POINTS", 64),
    mk("POINTS", 61),
    mk("POINTS", 58),
    mk("POINTS", 55),
    mk("REBOUNDS", 62),
    mk("REBOUNDS", 59),
    mk("REBOUNDS", 56),
    mk("ASSISTS", 60),
    mk("ASSISTS", 57),
    mk("ASSISTS", 54),
  ];
  const sel = selectHomeBoardMarketWeaveV1(pool);
  assert.deepEqual(labels(sel.selectedPackets), [
    "PTS64",
    "REB62",
    "AST60",
    "PTS61",
    "REB59",
    "AST57",
    "PTS58",
    "REB56",
    "AST54",
    "PTS55",
  ]);
  assert.equal(sel.selectedPackets.length, 10);
  assert.deepEqual(sel.marketOrder, ["POINTS", "REBOUNDS", "ASSISTS"]);
  assert.equal(sel.selectedPackets[2].marketRank, 1);
  assert.equal(sel.selectedPackets[2].homeWeaveRank, 3);
  assert.equal(sel.selectedPackets[2].propType, "ASSISTS");
});

check("TEST B — ASSISTS TOP BUCKET", () => {
  const pool = [
    mk("ASSISTS", 68),
    mk("ASSISTS", 60),
    mk("ASSISTS", 55),
    mk("POINTS", 65),
    mk("POINTS", 62),
    mk("POINTS", 58),
    mk("REBOUNDS", 63),
    mk("REBOUNDS", 59),
    mk("REBOUNDS", 54),
  ];
  const sel = selectHomeBoardMarketWeaveV1(pool);
  assert.deepEqual(labels(sel.selectedPackets), [
    "AST68",
    "PTS65",
    "REB63",
    "AST60",
    "PTS62",
    "REB59",
    "AST55",
    "PTS58",
    "REB54",
  ]);
  assert.deepEqual(sel.marketOrder, ["ASSISTS", "POINTS", "REBOUNDS"]);
  assert.ok(sel.selectedPackets.length < MAX_HOME_PROPS);
});

check("TEST C — SHORT REBOUND BUCKET", () => {
  const pool = [
    mk("POINTS", 65),
    mk("POINTS", 62),
    mk("POINTS", 59),
    mk("POINTS", 56),
    mk("POINTS", 53),
    mk("REBOUNDS", 63),
    mk("ASSISTS", 61),
    mk("ASSISTS", 58),
    mk("ASSISTS", 55),
    mk("ASSISTS", 52),
  ];
  const sel = selectHomeBoardMarketWeaveV1(pool);
  assert.deepEqual(labels(sel.selectedPackets), [
    "PTS65",
    "REB63",
    "AST61",
    "PTS62",
    "AST58",
    "PTS59",
    "AST55",
    "PTS56",
    "AST52",
    "PTS53",
  ]);
  assert.equal(sel.byMarketSelected.REBOUNDS, 1);
});

check("TEST D — ONE MARKET ONLY", () => {
  const pool = [80, 75, 70, 65, 60, 55, 50, 45].map((p) => mk("POINTS", p));
  const sel = selectHomeBoardMarketWeaveV1(pool);
  assert.equal(sel.selectedPackets.length, 8);
  assert.ok(sel.selectedPackets.every((p) => p.propType === "POINTS"));
  assert.deepEqual(sel.marketOrder, ["POINTS"]);
  assert.equal(sel.byMarketSelected.REBOUNDS, 0);
  assert.equal(sel.byMarketSelected.ASSISTS, 0);
});

check("TEST E — PROP IDENTITY (no cross-propType collapse)", () => {
  const player = "Test Player";
  const pool = [
    mk("POINTS", 60, { player, side: "OVER", line: 17.5 }),
    mk("REBOUNDS", 58, { player, side: "UNDER", line: 3.5 }),
    mk("ASSISTS", 56, { player, side: "OVER", line: 4.5 }),
  ];
  const sel = selectHomeBoardMarketWeaveV1(pool);
  assert.equal(sel.selectedPackets.length, 3);
  const types = new Set(sel.selectedPackets.map((p) => p.propType));
  assert.deepEqual([...types].sort(), ["ASSISTS", "POINTS", "REBOUNDS"]);
  assert.equal(
    sel.identityProblems.filter((x) => x.reason === "UNPROVEN_PROPTYPE").length,
    0
  );
});

check("UNPROVEN PROPTYPE excluded (never default POINTS)", () => {
  const pool = [
    mk("POINTS", 70),
    {
      playerName: "Mystery",
      side: "OVER",
      line: 5.5,
      modelWinProbability: 0.99,
      decisionScoreV2: 0.99,
      // no propType
    },
  ];
  const sel = selectHomeBoardMarketWeaveV1(pool);
  assert.equal(resolveProvenPropType(pool[1]), null);
  assert.equal(sel.selectedPackets.length, 1);
  assert.ok(sel.identityProblems.some((x) => x.reason === "UNPROVEN_PROPTYPE"));
});

check("MODEL % ORIENTATION — OVER = P(OVER)", () => {
  const over = scoreCandidateV2({
    propType: "POINTS",
    selectedSide: "OVER",
    side: "OVER",
    line: 12.5,
    projection: 16.0,
  });
  const underSameGap = scoreCandidateV2({
    propType: "POINTS",
    selectedSide: "UNDER",
    side: "UNDER",
    line: 12.5,
    projection: 9.0, // same signed gap magnitude as OVER above
  });
  assert.ok(over.modelWinProbability > 0.5, "OVER favored when proj >> line");
  assert.ok(
    underSameGap.modelWinProbability > 0.5,
    "UNDER favored when proj << line"
  );
  // Opposite side on the OVER-favored row would be weaker:
  const underWrong = scoreCandidateV2({
    propType: "POINTS",
    selectedSide: "UNDER",
    side: "UNDER",
    line: 12.5,
    projection: 16.0,
  });
  assert.ok(
    underWrong.modelWinProbability < over.modelWinProbability,
    "Model must be P(selected side), not raw P(OVER) for UNDER"
  );
});

check("MODEL % ORIENTATION — UNDER display uses selected-side prob", () => {
  // Clear UNDER edge: projection well below line → Model = P(UNDER), not P(OVER).
  const under = scoreCandidateV2({
    propType: "POINTS",
    selectedSide: "UNDER",
    side: "UNDER",
    line: 18.5,
    projection: 12.0,
  });
  const overOnSame = scoreCandidateV2({
    propType: "POINTS",
    selectedSide: "OVER",
    side: "OVER",
    line: 18.5,
    projection: 12.0,
  });
  assert.ok(
    under.modelWinProbability > 0.5,
    `UNDER modelWinProbability should be P(UNDER), got ${under.modelWinProbability}`
  );
  assert.ok(
    overOnSame.modelWinProbability < 0.5,
    `OVER on same row should be P(OVER) < 0.5, got ${overOnSame.modelWinProbability}`
  );
  assert.ok(
    Math.abs(under.modelWinProbability + overOnSame.modelWinProbability - 1) < 0.15 ||
      under.modelWinProbability > overOnSame.modelWinProbability,
    "Selected-side orientation must not display raw P(OVER) for UNDER"
  );
  assert.equal(under.decisionScoreV2, under.modelWinProbability);
});

check("MAX 10 / NO MINIMUM", () => {
  const few = [mk("POINTS", 60), mk("REBOUNDS", 59)];
  const fewSel = selectHomeBoardMarketWeaveV1(few);
  assert.equal(fewSel.selectedPackets.length, 2);
  assert.equal(fewSel.officialBoardMin, 0);
  assert.equal(fewSel.homeBoardMax, 10);
});

if (failed) {
  console.error(`\n${failed} test(s) failed`);
  process.exit(1);
}
console.log("\nALL Home market weave tests PASS");
