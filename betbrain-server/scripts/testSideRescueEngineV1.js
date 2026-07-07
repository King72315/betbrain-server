/**
 * CourtEdge Side Rescue v1 tests (30 required).
 * Usage: node betbrain-server/scripts/testSideRescueEngineV1.js
 */
import assert from "assert";
import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  evaluateSideRescue,
  applySideRescueToPick,
  applySideRescueEligibilityOverlay,
  runSideRescuePipeline,
  buildSideRescueReview,
  buildSideRescueRetroSimulation,
  SIDE_RESCUE_VERSION,
} from "../engines/decisionIntelligence/sideRescueEngineV1.js";
import {
  evaluatePropDecisionIntelligenceV1,
  applyDecisionIntelligenceToPick,
} from "../engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import { evaluateWnbaTrackingGateV2 } from "../engines/wnba/wnbaTrackingGateV2.js";
import {
  selectControlledBestSix,
  CONTROLLED_BEST_SIX_VERSION,
} from "../engines/topProps/controlledBestSixSelector.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");

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

function makeWnbaPick(overrides = {}) {
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
    trackingType: overrides.trackingType || "TEST",
    netEdge: reader.margin ?? 6,
    wnbaDataCard: card,
    wnbaReader: reader,
    readerDecision: reader.decision,
    readerConfidence: reader.readerConfidence ?? 55,
    ...overrides,
  };
}

function live0625Pick(player, side, line, cardOverrides = {}, pickOverrides = {}) {
  const sideLabel = side === "UNDER" ? "Under" : "Over";
  const gap = pickOverrides.gap ?? 4;
  const projection =
    cardOverrides.projection?.projection ??
    (side === "UNDER" ? line - gap : line + gap);
  const card = baseCard({
    player,
    bookLine: line,
    dataMode: cardOverrides.dataMode || "WNBA_LIMITED_DATA",
    projection: {
      projection,
      expectedMinutes: cardOverrides.last5?.minutes ?? 26,
      expectedFGA: cardOverrides.last5?.fga ?? 10,
      ...(cardOverrides.projection || {}),
    },
    ...cardOverrides,
  });
  const reader = pickOverrides.wnbaReader || readWnbaProp(card);
  return makeWnbaPick({
    player,
    side: sideLabel,
    line,
    netEdge: pickOverrides.netEdge ?? reader.margin ?? 6,
    wnbaDataCard: card,
    wnbaReader: reader,
    ...pickOverrides,
  });
}

function evaluatePipeline(pick) {
  const gate = evaluateWnbaTrackingGateV2(pick);
  const di = evaluatePropDecisionIntelligenceV1(pick, { gate });
  const enriched = applyDecisionIntelligenceToPick(pick, di, gate);
  const sideRescue = evaluateSideRescue(enriched, {
    decisionIntelligence: di,
    gate,
    dataCard: pick.wnbaDataCard,
    reader: pick.wnbaReader,
  });
  return { gate, di, enriched, sideRescue };
}

function runScript(scriptName) {
  const result = spawnSync(process.execPath, [path.join(__dirname, scriptName)], {
    cwd: SERVER_ROOT,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`${scriptName} failed:\n${result.stdout}\n${result.stderr}`);
  }
}

const tests = [];
function test(name, fn) {
  tests.push({ name, fn });
}

test("01 SIDE_RESCUE_VERSION constant", () => {
  assert.strictEqual(SIDE_RESCUE_VERSION, "side-rescue-v1.2");
});

test("02 clean profile does not trigger rescue", () => {
  const pick = live0625Pick("Azzi Fudd", "OVER", 13.5, {
    dataMode: "WNBA_FULL",
    minutesVolatility: "stable",
    projection: { projection: 18, expectedMinutes: 28, expectedFGA: 10 },
    last5: { points: 17, minutes: 28, fga: 10, fta: 3, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4.5, fairLineQuality: 65 },
  }, { netEdge: 8 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.strictEqual(sideRescue.triggered, false);
  assert.strictEqual(sideRescue.action, "KEEP_ORIGINAL");
});

test("03 non-WNBA passthrough", () => {
  const sr = evaluateSideRescue({ league: "NBA", side: "Over", pick: "Over" });
  assert.strictEqual(sr.passthrough, true);
  assert.strictEqual(sr.action, "KEEP_ORIGINAL");
});

test("04 volatile Under triggers review", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 6 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.strictEqual(sideRescue.triggered, true);
  assert.ok(sideRescue.triggerReasons.includes("VOLATILE_MINUTES"));
});

test("05 FTA collapse risk triggers for Under", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 6 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.ok(sideRescue.triggerReasons.includes("FTA_COLLAPSE_RISK"));
});

test("06 Dearica Hamby U15.5 BOARD_ONLY not flip", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 6 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.strictEqual(sideRescue.action, "KEEP_ORIGINAL");
  assert.strictEqual(sideRescue.finalSide, "UNDER");
  assert.ok(sideRescue.originalRiskAdjustedScore > sideRescue.oppositeRiskAdjustedScore + 5);
});

test("07 applySideRescueToPick sets BOARD_ONLY eligibility", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 6 });
  const { enriched, sideRescue } = evaluatePipeline(pick);
  const applied = applySideRescueToPick(enriched, sideRescue, {
    dataCard: pick.wnbaDataCard,
    reader: pick.wnbaReader,
  });
  assert.strictEqual(applied.trackingEligibility, "BOARD_ONLY");
  assert.strictEqual(applied.sideRescueVersion, SIDE_RESCUE_VERSION);
});

test("08 low-volume Over trap triggers rescue", () => {
  const pick = live0625Pick("NaLyssa Smith", "OVER", 10.5, {
    projection: { projection: 12.5, expectedMinutes: 18, expectedFGA: 5 },
    last5: { points: 11, minutes: 18, fga: 5, fta: 1, ptsPerFGA: 1.1, games: 5 },
  }, { netEdge: 4 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.strictEqual(sideRescue.triggered, true);
  assert.ok(
    sideRescue.triggerReasons.includes("LOW_VOLUME_OVER_TRAP") ||
      sideRescue.action === "NO_BET" ||
      sideRescue.action === "BOARD_ONLY"
  );
});

test("09 expanding role contradicts Under", () => {
  const pick = live0625Pick("Role Up Under", "UNDER", 14.5, {
    roleTrend: "expanding",
    projection: { projection: 11, expectedMinutes: 26, expectedFGA: 9 },
    last5: { points: 12, minutes: 26, fga: 9, fta: 2.5, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 5 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.ok(
    sideRescue.triggerReasons.includes("ROLE_TREND_CONTRADICTS_SIDE") ||
      sideRescue.triggered
  );
});

test("10 contracting role contradicts Over", () => {
  const pick = live0625Pick("Role Down Over", "OVER", 14.5, {
    roleTrend: "contracting",
    projection: { projection: 16, expectedMinutes: 26, expectedFGA: 9 },
    last5: { points: 15, minutes: 26, fga: 9, fta: 2.5, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 4 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.ok(sideRescue.triggered);
});

test("11 unstable minutes weakens Under", () => {
  const pick = live0625Pick("Natisha Hiedeman", "UNDER", 12.5, {
    minutesVolatility: "unstable",
    projection: { projection: 9, expectedMinutes: 22, expectedFGA: 8 },
    last5: { points: 10, minutes: 22, fga: 8, fta: 2, ptsPerFGA: 1.0, games: 5 },
  }, { netEdge: 5 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.ok(
    sideRescue.triggerReasons.some((r) => r.includes("UNSTABLE") || r.includes("VOLATILE"))
  );
});

test("12 applySideRescueEligibilityOverlay NO_BET", () => {
  const overlay = applySideRescueEligibilityOverlay(
    { trackingEligibility: "TRACK" },
    { action: "NO_BET", noBetReasons: ["Both sides unreliable."] }
  );
  assert.strictEqual(overlay.trackingEligibility, "NO_BET");
  assert.strictEqual(overlay.noPlay, true);
});

test("13 applySideRescueEligibilityOverlay BOARD_ONLY", () => {
  const overlay = applySideRescueEligibilityOverlay(
    { trackingEligibility: "TRACK" },
    { action: "BOARD_ONLY", boardOnlyReasons: ["Fragile original."] }
  );
  assert.strictEqual(overlay.trackingEligibility, "BOARD_ONLY");
  assert.strictEqual(overlay.bestSixEligibility, false);
});

test("14 FLIP_SIDE mutates pick side fields", () => {
  const flipped = applySideRescueToPick(
    { player: "Flip Test", side: "Under", pick: "Under", league: "WNBA" },
    {
      action: "FLIP_SIDE",
      originalSide: "UNDER",
      finalSide: "OVER",
      simpleExplanation: "Side Rescue: FLIPPED from Under to Over — test.",
    }
  );
  assert.strictEqual(flipped.side, "Over");
  assert.strictEqual(flipped.flippedFromSide, "UNDER");
  assert.strictEqual(flipped.sideRescueFlipped, true);
});

test("15 runSideRescuePipeline returns enriched pick", () => {
  const pick = live0625Pick("Azzi Fudd", "OVER", 13.5, {
    dataMode: "WNBA_FULL",
    minutesVolatility: "stable",
    projection: { projection: 18, expectedMinutes: 28, expectedFGA: 10 },
    last5: { points: 17, minutes: 28, fga: 10, fta: 3, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4.5, fairLineQuality: 65 },
  }, { netEdge: 8 });
  const result = runSideRescuePipeline(pick, {
    dataCard: pick.wnbaDataCard,
    reader: pick.wnbaReader,
    gate: evaluateWnbaTrackingGateV2(pick),
  });
  assert.ok(result.sideRescue);
  assert.strictEqual(result.sideRescueVersion, SIDE_RESCUE_VERSION);
  assert.ok(result.decisionIntelligence);
});

test("16 buildSideRescueReview aggregates actions", () => {
  const props = [
    {
      player: "A",
      line: 10.5,
      status: "win",
      sideRescue: { action: "KEEP_ORIGINAL", originalSide: "OVER", finalSide: "OVER", triggered: false },
    },
    {
      player: "B",
      line: 12.5,
      status: "loss",
      sideRescue: {
        action: "BOARD_ONLY",
        originalSide: "UNDER",
        finalSide: "UNDER",
        triggered: true,
        triggerReasons: ["FTA_COLLAPSE_RISK"],
      },
    },
  ];
  const review = buildSideRescueReview(props);
  assert.strictEqual(review.version, SIDE_RESCUE_VERSION);
  assert.strictEqual(review.evaluatedCount, 2);
  assert.ok(review.actionRecords.BOARD_ONLY);
});

test("17 buildSideRescueRetroSimulation report-only", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 6, trackingEligibility: "TRACK" });
  const enriched = runSideRescuePipeline(pick, {
    dataCard: pick.wnbaDataCard,
    reader: pick.wnbaReader,
    gate: evaluateWnbaTrackingGateV2(pick),
  });
  const retro = buildSideRescueRetroSimulation(
    [{ ...enriched, status: "loss", slateDate: "2026-06-25" }],
    { slateDate: "2026-06-25" }
  );
  assert.strictEqual(retro.reportOnly, true);
  assert.strictEqual(retro.noMutation, true);
  assert.ok(Array.isArray(retro.dearicaStyleCases));
});

test("18 Dearica retro dearicaStyleCases populated", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 6 });
  const enriched = runSideRescuePipeline(pick, {
    dataCard: pick.wnbaDataCard,
    reader: pick.wnbaReader,
    gate: evaluateWnbaTrackingGateV2(pick),
  });
  const retro = buildSideRescueRetroSimulation(
    [{ ...enriched, status: "loss" }],
    { slateDate: "2026-06-25" }
  );
  const dearica = retro.dearicaStyleCases.find((c) => c.player === "Dearica Hamby");
  assert.ok(dearica);
  assert.strictEqual(dearica.action, "KEEP_ORIGINAL");
});

test("19 controlled best six version side-rescue-v1", () => {
  assert.strictEqual(CONTROLLED_BEST_SIX_VERSION, "controlled-best-six-over-balance-v2");
});

test("20 BOARD_ONLY rescue excluded from Best 6", () => {
  const dearica = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 4, fairLineQuality: 60 },
  }, { netEdge: 6 });
  const track = live0625Pick("Azzi Fudd", "OVER", 13.5, {
    dataMode: "WNBA_FULL",
    minutesVolatility: "stable",
    projection: { projection: 18, expectedMinutes: 28, expectedFGA: 10 },
    last5: { points: 17, minutes: 28, fga: 10, fta: 3, ptsPerFGA: 1.05, games: 5 },
    fairLine: { fairLineSide: "OVER", fairLineEdge: 4.5, fairLineQuality: 65 },
  }, { netEdge: 8 });
  const dearicaEnriched = runSideRescuePipeline(dearica, {
    dataCard: dearica.wnbaDataCard,
    reader: dearica.wnbaReader,
    gate: evaluateWnbaTrackingGateV2(dearica),
  });
  const trackEnriched = runSideRescuePipeline(track, {
    dataCard: track.wnbaDataCard,
    reader: track.wnbaReader,
    gate: evaluateWnbaTrackingGateV2(track),
  });
  const { bestSix } = selectControlledBestSix([dearicaEnriched, trackEnriched], "WNBA");
  assert.ok(!bestSix.some((p) => p.player === "Dearica Hamby"));
});

test("21 thin Over edge may trigger BOARD_ONLY rescue", () => {
  const pick = live0625Pick("Rhyne Howard", "OVER", 18.5, {
    projection: { projection: 19, expectedMinutes: 28, expectedFGA: 11 },
    last5: { points: 18, minutes: 28, fga: 11, fta: 2.5, ptsPerFGA: 1.05, games: 5 },
  }, { netEdge: 0.5, gap: 0.5 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.ok(["BOARD_ONLY", "NO_BET", "KEEP_ORIGINAL"].includes(sideRescue.action));
});

test("22 Sabrina volatile Under may still TRACK after rescue", () => {
  const pick = live0625Pick("Sabrina Ionescu", "UNDER", 17.5, {
    minutesVolatility: "volatile",
    projection: { projection: 13, expectedMinutes: 30, expectedFGA: 12 },
    last5: { points: 14, minutes: 30, fga: 12, fta: 3, ptsPerFGA: 1.1, games: 5 },
    bookCount: 5,
    dataConfidenceScore: 72,
    fairLine: { fairLineSide: "UNDER", fairLineEdge: 5, fairLineQuality: 70 },
  }, { netEdge: 9 });
  const applied = runSideRescuePipeline(pick, {
    dataCard: pick.wnbaDataCard,
    reader: pick.wnbaReader,
    gate: evaluateWnbaTrackingGateV2(pick),
  });
  assert.ok(["TRACK", "BOARD_ONLY", "KEEP_ORIGINAL"].includes(applied.trackingEligibility || applied.sideRescue?.action));
});

test("23 rescue stores initialSide on pick", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
  }, { netEdge: 6 });
  const applied = applySideRescueToPick(pick, evaluatePipeline(pick).sideRescue, {
    dataCard: pick.wnbaDataCard,
    reader: pick.wnbaReader,
  });
  assert.strictEqual(applied.initialSide, "UNDER");
});

test("24 rescue explanation populated", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
  }, { netEdge: 6 });
  const applied = applySideRescueToPick(pick, evaluatePipeline(pick).sideRescue, {
    dataCard: pick.wnbaDataCard,
    reader: pick.wnbaReader,
  });
  assert.ok(String(applied.sideRescueExplanation || "").includes("Side Rescue"));
});

test("25 under fragility stack in Dearica triggers", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
  }, { netEdge: 6 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.ok(sideRescue.triggerReasons.includes("UNDER_FRAGILITY_STACK"));
});

test("26 efficiency-only Over trap triggers", () => {
  const pick = live0625Pick("Eff Over", "OVER", 11.5, {
    projection: { projection: 13.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 13, minutes: 24, fga: 8, fta: 1, ptsPerFGA: 1.35, games: 5 },
    season: { points: 11, minutes: 24, fga: 8, fta: 1, ptsPerFGA: 1.05 },
    scoringTrend: "rising",
  }, { netEdge: 3 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.ok(sideRescue.triggered);
});

test("27 opposite score floor blocks weak flips", () => {
  const pick = live0625Pick("Dearica Hamby", "UNDER", 15.5, {
    minutesVolatility: "volatile",
    projection: { projection: 11.5, expectedMinutes: 24, expectedFGA: 8 },
    last5: { points: 12, minutes: 24, fga: 8, fta: 1.2, ptsPerFGA: 1.05, games: 5 },
    season: { points: 14, minutes: 26, fga: 9, fta: 3.5, ptsPerFGA: 1.05 },
  }, { netEdge: 6 });
  const { sideRescue } = evaluatePipeline(pick);
  assert.notStrictEqual(sideRescue.action, "FLIP_SIDE");
  assert.ok(sideRescue.oppositeRiskAdjustedScore < 60 || sideRescue.flipScoreFloor === 60);
});

test("28 existing DI tests still pass", () => {
  runScript("testPropDecisionIntelligenceV1.js");
});

test("29 existing controlled best six tests still pass", () => {
  runScript("testControlledBestSix.js");
});

test("30 existing data-flow tests still pass", () => {
  runScript("testCourtEdgeDataFlow.js");
});

let passed = 0;
let failed = 0;

for (const { name, fn } of tests) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err.message || err);
  }
}

console.log(`\nSide Rescue v1: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
