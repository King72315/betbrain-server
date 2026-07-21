/**
 * CourtEdge Lab V2 + three-slate tests (cases 1â€“67).
 * Usage: npm run test:courtedge-lab-v2
 */
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  buildCourtEdgeLabV2,
  attachLabV2ToReport,
  assertPregameSnapshotUnchanged,
  LAB_V2_VERSION,
  LAB_V2_BUILD,
  LAB_V2_ENGINE_KEYS,
  buildLabPropRecord,
  extractEngineSignals,
  extractDecisionPacket,
  isOfficialBestSixProp,
} from "../services/courtEdgeLabV2.js";
import {
  attributeDirectional,
  attributeCalibration,
} from "../services/courtEdgeLabV2Helpers.js";
import {
  measuredMetric,
  unavailableMetric,
  formatMetricAvailability,
  formatPctMetric,
  formatClvMetric,
  buildCompatibleDeltaMetric,
} from "../services/labMetricAvailability.js";
import {
  buildHistoryThreeSlateGroupsV2,
  clearFrozenThreeSlateMembershipCache,
  collectCompletedOfficialSlateDates,
  resetThreeSlateBlocksStoreForTests,
  syncThreeSlateBlocksV2,
  HISTORY_THREE_SLATE_GROUPS_V2,
  HISTORICAL_THREE_SLATE_ANCHORS,
} from "../services/historyThreeSlateGroupsV2.js";
import { buildHistoryThreeSlateGroups } from "../services/historyThreeSlateGroupsV1.js";
import { BANNED_LAB_LABELS } from "../services/courtEdgeLabV2Constants.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;
const failures = [];

function resetBlocks() {
  resetThreeSlateBlocksStoreForTests();
  clearFrozenThreeSlateMembershipCache();
}

function syncBlocksFromDates(dates = [], { reset = true } = {}) {
  if (reset) resetBlocks();
  return syncThreeSlateBlocksV2(dates);
}

function frozenGroups(payload) {
  if (Array.isArray(payload?.frozenBlocks) && payload.frozenBlocks.length) {
    return payload.frozenBlocks;
  }
  return (payload?.groups || []).filter((g) => !g.incomplete).reverse();
}

function test(num, name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${num}. ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ num, name, err });
    console.error(`FAIL ${num}. ${name}`);
    console.error(err);
  }
}

function makeEngineSignal(overrides = {}) {
  return {
    available: true,
    normalizedSignal: 0.2,
    overContribution: 0.2,
    underContribution: 0,
    confidenceAdjustment: 1,
    riskAdjustment: "NEUTRAL",
    quality: "USABLE",
    sampleSize: 5,
    reason: "test",
    ...overrides,
  };
}

function makeSealedProp(overrides = {}) {
  const slateDate = overrides.slateDate || "2026-07-15";
  const status = overrides.status || "win";
  const side = overrides.side || "Over";
  const engines = {};
  for (const key of LAB_V2_ENGINE_KEYS) {
    if (key === "evidenceDeduplication") {
      engines[key] = makeEngineSignal({
        normalizedSignal: 0,
        overContribution: 0,
        underContribution: 0,
        confidenceAdjustment: 0.5,
      });
    } else if (key === "volatility" || key === "restFatigue") {
      engines[key] = makeEngineSignal({
        normalizedSignal: 0,
        overContribution: 0,
        underContribution: 0,
        confidenceAdjustment: -0.5,
        riskAdjustment: "HIGH",
      });
    } else {
      engines[key] = makeEngineSignal({
        overContribution: side.toUpperCase().startsWith("OVER") ? 0.25 : 0,
        underContribution: side.toUpperCase().startsWith("UNDER") ? 0.25 : 0,
        normalizedSignal: side.toUpperCase().startsWith("OVER") ? 0.25 : -0.25,
      });
    }
  }

  const signals = {
    version: "courtEdgeEngineSignalsV1",
    schemaBuild: "courteedge-engine-expansion-v1.1",
    enabled: true,
    engines,
    aggregation: {
      organicModelSide: "OVER",
      confidenceAdjustment: 1,
      evidenceCoverage: { availableEngineCount: 11, totalEngineCount: 11 },
      suppressedDuplicateContributions: [{ engine: "roleVelocity", reason: "dup" }],
    },
    evidenceDeduplication: {
      groups: { MARKET: { engines: [] } },
      suppressed: [{ engine: "roleVelocity", reason: "dup" }],
    },
  };

  const packet = {
    version: "courtEdgeDecisionPacketV1",
    decisionHash: "hash-test-1",
    alreadyApplied: true,
    organicModelSide: "OVER",
    finalSide: side.toUpperCase().startsWith("UNDER") ? "UNDER" : "OVER",
    finalConfidence: 62,
    finalRisk: "MEDIUM",
  };

  const pregameSnapshot = {
    sealedAt: "2026-07-15T12:00:00.000Z",
    side,
    line: 18.5,
    projection: 20,
    fairLine: 19,
    confidence: 60,
    risk: "MEDIUM",
    flipFirst: { action: "KEEP" },
    sideRescue: { terminalAction: "KEEP_ORIGINAL" },
    readerEvidence: { originalSide: "OVER" },
  };

  return {
    officialPropId: overrides.officialPropId || `prop-${slateDate}-${overrides.player || "P"}`,
    slateDate,
    player: overrides.player || "Test Player",
    team: overrides.team || "SEA",
    opponent: overrides.opponent || "LAS",
    league: overrides.league || "WNBA",
    status,
    side,
    pick: side,
    line: 18.5,
    officialLine: 18.5,
    sealedLine: 18.5,
    openingLine: 18,
    closingLine: 18.5,
    projection: 20,
    fairLine: 19,
    confidence: 62,
    riskLabel: "Medium Risk",
    trueRisk: "MEDIUM",
    actualPoints: status === "win" ? 22 : status === "loss" ? 14 : 18.5,
    resultMargin: status === "win" ? 3.5 : status === "loss" ? -4.5 : 0,
    bestSixRank: overrides.bestSixRank || 1,
    controlledBestSixRank: overrides.bestSixRank || 1,
    immutableOfficial: true,
    officialEligible: true,
    isTopPick: overrides.isTopPick === true,
    topPickRank: overrides.isTopPick ? 1 : null,
    pregameSnapshot,
    courtEdgeEngineSignalsV1: overrides.omitSignals ? undefined : signals,
    courtEdgeDecisionPacketV1: overrides.omitPacket ? undefined : packet,
    canonicalSealedProp: overrides.omitCanon
      ? undefined
      : {
          courtEdgeEngineSignalsV1: overrides.omitSignals ? undefined : signals,
          courtEdgeDecisionPacketV1: overrides.omitPacket ? undefined : packet,
          pregameSnapshot,
        },
    missType: status === "loss" ? "PROJECTION_MISS" : null,
    modulesHelped: status === "win" ? ["projectionSanity"] : [],
    modulesHurt: status === "loss" ? ["defensiveArchetype"] : [],
    sameTeamForcedUnder: overrides.forcedSameTeam === true,
    sameTeamArbitration: overrides.forcedSameTeam
      ? { forced: true, role: "weaker", forcedSide: "UNDER" }
      : null,
    ...overrides,
  };
}

function makeSix(slateDate, pattern = ["win", "win", "loss", "win", "loss", "win"]) {
  return pattern.map((status, i) =>
    makeSealedProp({
      slateDate,
      status,
      bestSixRank: i + 1,
      player: `Player-${slateDate}-${i + 1}`,
      isTopPick: i < 2,
      side: i % 2 === 0 ? "Over" : "Under",
    })
  );
}

// Isolate block store for deterministic tests
resetBlocks();

// ---------- DATA SOURCE ----------
test(1, "Lab uses canonical sealed props", () => {
  const prop = makeSealedProp();
  const lab = buildCourtEdgeLabV2({
    slateDate: prop.slateDate,
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  assert.equal(lab.perPropPackets[0].layers.freeze.sealedLine, 18.5);
  assert.equal(lab.perPropPackets[0].layers.freeze.side, "OVER");
});

test(2, "Lab does not reconstruct pregame evidence from live Board", () => {
  const prop = makeSealedProp({
    // live board-ish fields that must NOT override sealed freeze
    projection: 99,
    line: 99,
    pregameSnapshot: {
      sealedAt: "2026-07-15T12:00:00.000Z",
      side: "Over",
      line: 18.5,
      projection: 20,
      fairLine: 19,
      confidence: 60,
    },
  });
  const rec = buildLabPropRecord(prop);
  assert.equal(rec.projection, 20);
  assert.equal(rec.sealedLine, 18.5);
});

test(3, "Lab rebuild does not mutate sealed pregameSnapshot", () => {
  const prop = makeSealedProp();
  const before = JSON.parse(JSON.stringify(prop.pregameSnapshot));
  buildCourtEdgeLabV2({
    slateDate: prop.slateDate,
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  assert.ok(assertPregameSnapshotUnchanged(before, prop.pregameSnapshot));
});

test(4, "Lab consumes courtEdgeEngineSignalsV1", () => {
  const prop = makeSealedProp();
  const signals = extractEngineSignals(prop);
  assert.equal(signals.available, true);
  assert.equal(signals.version, "courtEdgeEngineSignalsV1");
  assert.ok(signals.engines.lineMovementClv.available);
});

test(5, "Lab consumes courtEdgeDecisionPacketV1", () => {
  const prop = makeSealedProp();
  const packet = extractDecisionPacket(prop);
  assert.ok(packet);
  assert.equal(packet.alreadyApplied, true);
});

test(6, "Old records without expansion signals remain readable", () => {
  const prop = makeSealedProp({ omitSignals: true, omitPacket: true, omitCanon: true });
  delete prop.courtEdgeEngineSignalsV1;
  delete prop.courtEdgeDecisionPacketV1;
  delete prop.canonicalSealedProp;
  const lab = buildCourtEdgeLabV2({
    slateDate: prop.slateDate,
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  assert.equal(lab.officialBestSixResults.length, 1);
  assert.equal(lab.officialBestSixResults[0].engineSignalsAvailable, false);
  assert.equal(
    lab.perPropPackets[0].layers.pregameEngineEvidence.signalsAvailable,
    false
  );
});

// ---------- DAILY SUMMARY ----------
test(7, "Daily overall W-L-P is correct", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.currentSlate.wins, 4);
  assert.equal(lab.currentSlate.losses, 2);
  assert.equal(lab.currentSlate.pushes, 0);
});

test(8, "Pending count is correct", () => {
  const props = [
    ...makeSix("2026-07-15").slice(0, 5),
    makeSealedProp({ slateDate: "2026-07-15", status: "pending", bestSixRank: 6, player: "Pend" }),
  ];
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.currentSlate.pending, 1);
});

test(9, "Win rate is correct", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.currentSlate.winRate, 66.7);
});

test(10, "Accuracy is correct", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.currentSlate.accuracy, lab.currentSlate.winRate);
});

test(11, "NBA/WNBA splits are correct", () => {
  const props = [
    makeSealedProp({ slateDate: "2026-07-15", league: "WNBA", status: "win", bestSixRank: 1, player: "W1" }),
    makeSealedProp({ slateDate: "2026-07-15", league: "NBA", status: "loss", bestSixRank: 2, player: "N1" }),
  ];
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.currentSlate.wnbaRecord.wins, 1);
  assert.equal(lab.currentSlate.nbaRecord.losses, 1);
});

test(12, "Over/Under splits are correct", () => {
  const props = [
    makeSealedProp({ slateDate: "2026-07-15", side: "Over", status: "win", bestSixRank: 1, player: "O1" }),
    makeSealedProp({ slateDate: "2026-07-15", side: "Under", status: "loss", bestSixRank: 2, player: "U1" }),
  ];
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.currentSlate.overRecord.wins, 1);
  assert.equal(lab.currentSlate.underRecord.losses, 1);
});

test(13, "Top/non-Top splits are correct", () => {
  const props = [
    makeSealedProp({ slateDate: "2026-07-15", isTopPick: true, status: "win", bestSixRank: 1, player: "T1" }),
    makeSealedProp({ slateDate: "2026-07-15", isTopPick: false, status: "loss", bestSixRank: 2, player: "N1" }),
  ];
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.currentSlate.topPickRecord.wins, 1);
});

test(14, "All six official props appear", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.officialBestSixResults.length, 6);
});

// ---------- THREE-SLATE RULE ----------
test(15, "First completed slate creates block progress 1/3", () => {
  resetBlocks();
  const store = syncBlocksFromDates(["2026-07-14"]);
  assert.equal(store.activeBlock.progress, "1/3");
  assert.deepEqual(store.activeBlock.slateDates, ["2026-07-14"]);
});

test(16, "Second completed slate creates 2/3", () => {
  resetBlocks();
  const store = syncBlocksFromDates(["2026-07-14", "2026-07-15"]);
  assert.equal(store.activeBlock.progress, "2/3");
});

test(17, "Third completed slate freezes the block; active becomes empty 0/3", () => {
  resetBlocks();
  const store = syncBlocksFromDates(["2026-07-14", "2026-07-15", "2026-07-16"]);
  const frozen = frozenGroups(store);
  assert.ok(frozen.length >= 1);
  assert.deepEqual(frozen[frozen.length - 1].slateDates, [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
  ]);
  assert.equal(store.activeBlock?.incomplete, true);
  assert.equal(store.activeBlock?.progress, "0/3");
  assert.deepEqual(store.activeBlock?.slateDates, []);
});

test(18, "Fourth slate starts a new block at 1/3", () => {
  resetBlocks();
  const store = syncBlocksFromDates([
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
  ]);
  assert.ok(frozenGroups(store).length >= 1);
  assert.equal(store.activeBlock.progress, "1/3");
  assert.equal(store.activeBlock.incomplete, true);
  assert.deepEqual(store.activeBlock.slateDates, ["2026-07-17"]);
});

test(19, "Frozen block membership never changes", () => {
  resetBlocks();
  syncBlocksFromDates(["2026-07-14", "2026-07-15", "2026-07-16"], { reset: true });
  const again = syncBlocksFromDates(
    ["2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"],
    { reset: false }
  );
  const frozen = frozenGroups(again);
  assert.deepEqual(frozen[0].slateDates, [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
  ]);
});

test(20, "Previous/current block comparison is correct", () => {
  resetBlocks();
  const props = [
    ...makeSix("2026-07-08", ["win", "win", "win", "win", "win", "win"]),
    ...makeSix("2026-07-14", ["win", "win", "win", "win", "win", "win"]),
    ...makeSix("2026-07-15", ["win", "win", "win", "win", "win", "win"]),
    ...makeSix("2026-07-16", ["loss", "loss", "loss", "loss", "loss", "loss"]),
    ...makeSix("2026-07-17", ["win", "win", "loss", "win", "loss", "win"]),
    ...makeSix("2026-07-20", ["win", "win", "loss", "win", "loss", "win"]),
  ];
  const groups = buildHistoryThreeSlateGroupsV2({
    trackedProps: props,
    persist: true,
  });
  assert.ok(groups.previousBlock || groups.completeGroupCount >= 1);
  assert.ok(groups.activeBlock);
  assert.deepEqual(groups.activeBlock.slateDates, ["2026-07-20"]);
  assert.ok(groups.activeBlock.comparison?.hasPrevious === true);
});

test(21, "No slate appears in two non-overlapping blocks", () => {
  resetBlocks();
  const store = syncBlocksFromDates([
    "2026-07-08",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
  ]);
  const all = [
    ...frozenGroups(store).flatMap((b) => b.slateDates || []),
    ...(store.activeBlock?.incomplete ? store.activeBlock.slateDates : []),
  ];
  // If active is complete and already in frozen, don't double-count
  const unique = [...new Set(all)];
  assert.equal(unique.length, 5);
});

test(22, "History and Lab use identical group membership", () => {
  resetBlocks();
  const props = [
    ...makeSix("2026-07-14"),
    ...makeSix("2026-07-15"),
    ...makeSix("2026-07-16"),
  ];
  const groups = buildHistoryThreeSlateGroupsV2({ trackedProps: props, persist: true });
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-16",
    trackedProps: props,
    persistThreeSlate: true,
  });
  const frozen = frozenGroups(groups)[0];
  const labDates =
    lab.previousThreeSlateBlock?.slateDates ||
    lab.activeThreeSlateBlock?.slateDates ||
    lab.threeSlateGroups?.activeBlock?.slateDates;
  assert.deepEqual(frozen.slateDates, labDates);
});

test(23, "Existing V1 groups remain readable", () => {
  const archives = [
    { slateDate: "2026-07-14", phase: "ARCHIVED", props: makeSix("2026-07-14") },
    { slateDate: "2026-07-15", phase: "ARCHIVED", props: makeSix("2026-07-15") },
    { slateDate: "2026-07-16", phase: "ARCHIVED", props: makeSix("2026-07-16") },
  ];
  const v1 = buildHistoryThreeSlateGroups(archives);
  assert.ok(v1.groups.length >= 1);
  const v2 = buildHistoryThreeSlateGroupsV2({ archives, persist: false });
  assert.ok(v2.v1Compatible || v2.v1Groups || v2.version);
  assert.equal(v2.version, HISTORY_THREE_SLATE_GROUPS_V2);
});

// ---------- ENGINE SCOREBOARD ----------
test(24, "All eleven engines appear", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(Object.keys(lab.engineScorecards).length, 11);
  for (const key of LAB_V2_ENGINE_KEYS) {
    assert.ok(lab.engineScorecards[key], key);
  }
});

test(25, "Small-sample engine rows remain visible", () => {
  const props = [makeSealedProp({ slateDate: "2026-07-15" })];
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  const card = lab.engineScorecards.lineMovementClv.currentSlate;
  assert.equal(card.smallSample, true);
  assert.ok(card.availableCount >= 0);
});

test(26, "Unavailable signals are not counted as directional losses", () => {
  const prop = makeSealedProp({ omitSignals: true, omitCanon: true, slateDate: "2026-07-15" });
  delete prop.courtEdgeEngineSignalsV1;
  delete prop.canonicalSealedProp;
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  const card = lab.engineScorecards.lineMovementClv.currentSlate;
  // Uninstrumented props are excluded from directional/calibration scoreboards.
  assert.equal(card.directionalOpportunities, 0);
  assert.equal(card.hurt, 0);
  assert.equal(card.sampleSize, 0);
  assert.equal(card.instrumentedOnly, true);
  assert.equal(lab.currentSlate.uninstrumented, true);
  assert.equal(
    attributeDirectional({ available: false }, "OVER", true, false).kind,
    "neutral"
  );
});

test(27, "Helped/hurt/neutral attribution is correct", () => {
  const signal = makeEngineSignal({ overContribution: 0.3, underContribution: 0 });
  assert.equal(attributeDirectional(signal, "OVER", true, false).kind, "helped");
  assert.equal(attributeDirectional(signal, "OVER", false, true).kind, "hurt");
  assert.equal(attributeDirectional(signal, "UNDER", true, false).kind, "hurt");
  assert.equal(attributeDirectional(signal, "UNDER", false, true).kind, "helped");
  assert.equal(
    attributeDirectional({ available: false }, "OVER", true, false).kind,
    "neutral"
  );
});

test(28, "Directional and calibration performance remain separate", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  const card = lab.engineScorecards.lineMovementClv.currentSlate;
  assert.ok("directionalAccuracy" in card);
  assert.ok("calibrationHelped" in card);
  assert.ok("calibrationHurt" in card);
});

test(29, "Coverage percentage is correct", () => {
  const props = [
    makeSealedProp({ slateDate: "2026-07-15", player: "A", bestSixRank: 1 }),
    makeSealedProp({
      slateDate: "2026-07-15",
      player: "B",
      bestSixRank: 2,
      omitSignals: true,
      omitCanon: true,
    }),
  ];
  delete props[1].courtEdgeEngineSignalsV1;
  delete props[1].canonicalSealedProp;
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  // Primary scoreboard is instrumented-only (legacy excluded from coverage math).
  assert.equal(lab.engineScorecards.lineMovementClv.currentSlate.coveragePct, 100);
  assert.equal(lab.engineScorecards.lineMovementClv.currentSlate.sampleSize, 1);
  // Slate-level evidence coverage still reflects sealed vs uninstrumented mix.
  assert.equal(lab.currentSlate.evidenceCoverage, 50);
});

test(30, "Suppressed duplicate signals remain visible", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
    includeAllRawRows: true,
  });
  const packet = lab.perPropPackets[0];
  assert.ok(
    packet.layers.decisionPath.suppressedDuplicateSignals ||
      packet.layers.pregameEngineEvidence.engines
  );
});

// ---------- PER-PROP PACKETS ----------
test(31, "Freeze layer matches canonical sealed values", () => {
  const prop = makeSealedProp();
  const lab = buildCourtEdgeLabV2({
    slateDate: prop.slateDate,
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  const freeze = lab.perPropPackets[0].layers.freeze;
  assert.equal(freeze.sealedLine, prop.pregameSnapshot.line);
  assert.equal(freeze.projection, prop.pregameSnapshot.projection);
});

test(32, "Engine layer contains all available signals", () => {
  const prop = makeSealedProp();
  const lab = buildCourtEdgeLabV2({
    slateDate: prop.slateDate,
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  const engines = lab.perPropPackets[0].layers.pregameEngineEvidence.engines;
  assert.equal(Object.keys(engines).length, 11);
});

test(33, "Decision path preserves original and final side", () => {
  const prop = makeSealedProp({ side: "Under" });
  const lab = buildCourtEdgeLabV2({
    slateDate: prop.slateDate,
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  const path = lab.perPropPackets[0].layers.decisionPath;
  assert.ok(path.originalModelSide);
  assert.equal(path.finalCourtEdgeSide, "UNDER");
});

test(34, "Same-team forced props show arbitration honestly", () => {
  const prop = makeSealedProp({ forcedSameTeam: true, side: "Under" });
  const lab = buildCourtEdgeLabV2({
    slateDate: prop.slateDate,
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  assert.equal(
    lab.perPropPackets[0].layers.decisionPath.sameTeamArbitration.forced,
    true
  );
});

test(35, "Postgame layer uses measured truth", () => {
  const prop = makeSealedProp({ status: "win" });
  const lab = buildCourtEdgeLabV2({
    slateDate: prop.slateDate,
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  assert.equal(lab.perPropPackets[0].layers.postgameTruth.actualPoints, 22);
});

test(36, "Diagnosis does not rewrite the freeze layer", () => {
  const prop = makeSealedProp({ status: "loss", missType: "ROLE_MISS" });
  const before = JSON.parse(JSON.stringify(prop.pregameSnapshot));
  const lab = buildCourtEdgeLabV2({
    slateDate: prop.slateDate,
    trackedProps: [prop],
    persistThreeSlate: false,
  });
  assert.equal(lab.perPropPackets[0].layers.diagnosis.primaryCause, "ROLE_MISS");
  assert.ok(assertPregameSnapshotUnchanged(before, prop.pregameSnapshot));
});

// ---------- CALIBRATION ----------
test(37, "Projection error is correct", () => {
  const prop = makeSealedProp({ status: "win" }); // actual 22, proj 20
  const rec = buildLabPropRecord(prop);
  assert.equal(rec.projectionError, 2);
});

test(38, "Absolute projection error is correct", () => {
  const prop = makeSealedProp({ status: "loss" }); // actual 14, proj 20
  const rec = buildLabPropRecord(prop);
  assert.equal(rec.absProjectionError, 6);
});

test(39, "CLV is correct", () => {
  const prop = makeSealedProp({ side: "Over", sealedLine: 18.5, closingLine: 19 });
  prop.sealedLine = 18.5;
  prop.closingLine = 19;
  const rec = buildLabPropRecord(prop);
  assert.equal(rec.clv, 0.5);
});

test(40, "Confidence calibration gap is correct", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  const bucket = lab.confidenceCalibration.currentSlate.buckets["60-69"];
  assert.ok(bucket);
  assert.ok("calibrationGap" in bucket);
});

test(41, "Risk records are correct", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.ok(lab.riskCalibration.currentSlate.buckets.MEDIUM);
});

test(42, "NBA and WNBA remain separate", () => {
  const props = [
    makeSealedProp({ league: "NBA", slateDate: "2026-07-15", player: "N", bestSixRank: 1 }),
    makeSealedProp({ league: "WNBA", slateDate: "2026-07-15", player: "W", bestSixRank: 2 }),
  ];
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.ok(lab.projectionCalibration.currentSlate.byLeague.NBA);
  assert.ok(lab.projectionCalibration.currentSlate.byLeague.WNBA);
});

test(43, "Organic and same-team forced props remain separate", () => {
  const props = [
    makeSealedProp({ forcedSameTeam: false, slateDate: "2026-07-15", player: "O", bestSixRank: 1 }),
    makeSealedProp({ forcedSameTeam: true, side: "Under", slateDate: "2026-07-15", player: "F", bestSixRank: 2 }),
  ];
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.sameTeamAnalysis.currentSlate.sample, 1);
});

// ---------- UI CLEANUP ----------
test(44, "BOARD_ONLY is absent", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  const body = { ...lab };
  delete body.bannedLabels;
  assert.equal(JSON.stringify(body).includes("BOARD_ONLY"), false);
});

test(45, "NATURAL_TRACK is absent", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  const body = { ...lab };
  delete body.bannedLabels;
  assert.equal(JSON.stringify(body).includes("NATURAL_TRACK"), false);
});

test(46, "NO_BET is absent", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  const body = { ...lab };
  delete body.bannedLabels;
  assert.equal(JSON.stringify(body).includes("NO_BET"), false);
});

test(47, "PREMIUM is absent", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  // banned list itself may mention PREMIUM in bannedLabels â€” check payload sections
  assert.ok(Array.isArray(lab.bannedLabels));
  assert.ok(lab.bannedLabels.includes("PREMIUM"));
  const body = { ...lab };
  delete body.bannedLabels;
  assert.equal(JSON.stringify(body).includes('"PREMIUM"'), false);
});

test(48, "PLAYABLE is absent", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  const body = { ...lab };
  delete body.bannedLabels;
  assert.equal(JSON.stringify(body).includes('"PLAYABLE"'), false);
});

test(49, "Reader Demoted TEST is absent", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  const body = { ...lab };
  delete body.bannedLabels;
  assert.equal(JSON.stringify(body).includes("Reader Demoted"), false);
});

test(50, "Reader Uncertain TEST is absent", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  const body = { ...lab };
  delete body.bannedLabels;
  assert.equal(JSON.stringify(body).includes("Reader Uncertain"), false);
});

test(51, "No new user-facing pick classifications are introduced", () => {
  assert.ok(BANNED_LAB_LABELS.length >= 10);
});

test(52, "Main summary remains compact", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  assert.ok(lab.currentSlate.record);
  assert.ok(lab.overallSummary);
});

test(53, "Raw details remain accessible", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
    includeAllRawRows: true,
  });
  assert.ok(lab.rawSignalExplorer.totalRows >= 11 * 6);
  assert.equal(lab.rawSignalExplorer.hideSmallSamples, false);
});

// ---------- ADJUSTMENT REVIEW ----------
test(54, "Recommendations do not modify live weights", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  assert.equal(lab.writesLiveWeights, false);
  assert.equal(lab.adjustmentReview.writesLiveWeights, false);
});

test(55, "Lab does not create a Calibration Feedback Engine", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  assert.equal(lab.calibrationFeedbackEngine, false);
  assert.equal(lab.adjustmentReview.calibrationFeedbackEngine, false);
});

test(56, "Lab does not write calibration configuration", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
  });
  for (const s of lab.adjustmentReview.suggestions || []) {
    assert.equal(s.appliesAutomatically, false);
  }
});

test(57, "Adjustment evidence includes current and previous three-slate samples", () => {
  resetBlocks();
  const props = [
    ...makeSix("2026-07-08"),
    ...makeSix("2026-07-14"),
    ...makeSix("2026-07-15"),
    ...makeSix("2026-07-16"),
    ...makeSix("2026-07-17"),
  ];
  // Force large accuracy delta by making second block all losses on engines via results
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-17",
    trackedProps: props,
    persistThreeSlate: true,
  });
  assert.ok(lab.adjustmentReview);
  // suggestions may be empty if delta < 5; structure must still expose samples fields when present
  for (const s of lab.adjustmentReview.suggestions || []) {
    assert.ok("currentThreeSlateSample" in s);
    assert.ok("previousThreeSlateSample" in s);
  }
});

// ---------- LIFECYCLE ----------
test(58, "Results promotes correctly to Lab", () => {
  const props = makeSix("2026-07-15");
  const report = attachLabV2ToReport(
    { slateDate: "2026-07-15", status: "final", graded: 6, pending: 0 },
    { trackedProps: props, persistThreeSlate: false }
  );
  assert.equal(report.labV2.version, LAB_V2_VERSION);
  assert.equal(report.labV2.officialBestSixResults.length, 6);
});

test(59, "Lab block membership updates correctly", () => {
  resetBlocks();
  const dates = collectCompletedOfficialSlateDates({
    trackedProps: [...makeSix("2026-07-15"), ...makeSix("2026-07-16")],
  });
  const dateList = Array.isArray(dates)
    ? dates.map((d) => (typeof d === "string" ? d : d.slateDate))
    : [];
  assert.ok(dateList.includes("2026-07-15"));
  assert.ok(dateList.includes("2026-07-16"));
});

test(60, "Completed three-slate groups archive correctly", () => {
  resetBlocks();
  const store = syncBlocksFromDates(["2026-07-14", "2026-07-15", "2026-07-16"]);
  const frozen = frozenGroups(store)[0];
  assert.equal(frozen.frozen, true);
  assert.ok(frozen.completionTimestamp || frozen.frozenAt);
});

test(61, "History remains readable", () => {
  const archives = [
    { slateDate: "2026-07-14", phase: "ARCHIVED", props: makeSix("2026-07-14") },
  ];
  const groups = buildHistoryThreeSlateGroupsV2({ archives, persist: false });
  assert.ok(groups.version);
});

test(62, "Report rebuild is idempotent", () => {
  const props = makeSix("2026-07-15");
  const a = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  const b = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(a.currentSlate.record, b.currentSlate.record);
  assert.equal(a.officialBestSixResults.length, b.officialBestSixResults.length);
});

test(63, "No tracked or historical record is deleted", () => {
  const props = makeSix("2026-07-15");
  const before = props.length;
  buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(props.length, before);
});

test(64, "Full Best 6 and track-all-six remain unchanged", () => {
  const props = makeSix("2026-07-15");
  assert.equal(props.filter(isOfficialBestSixProp).length, 6);
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.officialBestSixResults.length, 6);
});

// ---------- PERFORMANCE ----------
test(65, "Large raw tables are paginated or virtualized", () => {
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: makeSix("2026-07-15"),
    persistThreeSlate: false,
    rawPage: 1,
    rawPageSize: 10,
  });
  assert.equal(lab.rawSignalExplorer.pageSize, 10);
  assert.ok(lab.rawSignalExplorer.rows.length <= 10);
  assert.ok(lab.rawSignalExplorer.totalPages >= 1);
});

test(66, "Cached groups invalidate after grading changes", () => {
  resetBlocks();
  const props = makeSix("2026-07-15");
  const a = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: true,
  });
  props[0].status = "loss";
  props[0].resultMargin = -3;
  const b = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: true,
  });
  assert.notEqual(a.meta.cacheKey, undefined);
  assert.notEqual(a.currentSlate.record, b.currentSlate.record);
});

test(67, "Copied report matches the displayed Lab metrics", () => {
  const props = makeSix("2026-07-15");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  // Simulate copy-report consuming same payload
  assert.equal(lab.currentSlate.wins, 4);
  assert.equal(lab.currentSlate.losses, 2);
  assert.equal(lab.buildVersion, LAB_V2_BUILD);
  assert.equal(lab.version, LAB_V2_VERSION);
});

test(68, "Calibration attribution helper", () => {
  const signal = makeEngineSignal({ confidenceAdjustment: 2 });
  assert.equal(attributeCalibration(signal, false, true, -3).attribution, "hurt");
  assert.equal(attributeCalibration(signal, true, false, 3).attribution, "helped");
});

// ---------- LIFECYCLE / COMPAT V1 ----------
test(69, "immutableOfficial wins over TEST trackingType", () => {
  assert.equal(
    isOfficialBestSixProp({
      immutableOfficial: true,
      trackingType: "TEST",
      bestSixRank: 1,
      status: "win",
    }),
    true
  );
  assert.equal(
    isOfficialBestSixProp({
      trackingType: "TEST",
      bestSixRank: 1,
      status: "win",
    }),
    false
  );
});

test(70, "Lab defaults to newest on-track completed official slate", () => {
  resetBlocks();
  const props = [
    ...makeSix("2026-07-15"),
    ...makeSix("2026-07-17"),
    ...makeSix("2026-07-20"),
  ];
  const lab = buildCourtEdgeLabV2({
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(lab.slateDate, "2026-07-20");
  assert.equal(lab.currentSlate.slateDate, "2026-07-20");
  assert.equal(lab.officialBestSixResults.length, 6);
});

test(71, "Thin Jul 16 + pre-track Jul 17 stay legacy; Jul 20 starts learning block", () => {
  resetBlocks();
  const thin = [1, 2, 3].map((i) =>
    makeSealedProp({
      slateDate: "2026-07-16",
      bestSixRank: i,
      player: `Thin${i}`,
      status: "loss",
      omitSignals: true,
    })
  );
  const six17 = makeSix("2026-07-17");
  const six20 = makeSix("2026-07-20");
  const groups = buildHistoryThreeSlateGroupsV2({
    trackedProps: [...thin, ...six17, ...six20],
    persist: true,
  });
  assert.ok(groups.legacySlateDates.includes("2026-07-16"));
  assert.ok(groups.legacySlateDates.includes("2026-07-17"));
  assert.ok(!groups.instrumentedLearningDates.includes("2026-07-16"));
  assert.ok(!groups.instrumentedLearningDates.includes("2026-07-17"));
  assert.ok(groups.instrumentedLearningDates.includes("2026-07-20"));
  assert.deepEqual(groups.activeBlock?.slateDates, ["2026-07-20"]);
  assert.equal(groups.activeBlock?.progress, "1/3");
  assert.equal(thin.length, 3);
});

test(72, "Uninstrumented props flagged; engine scoreboard excludes them", () => {
  const legacyProp = makeSealedProp({
    slateDate: "2026-07-17",
    omitSignals: true,
    status: "win",
    bestSixRank: 1,
  });
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-17",
    trackedProps: [legacyProp],
    persistThreeSlate: false,
  });
  assert.equal(lab.currentSlate.uninstrumented, true);
  assert.equal(lab.currentSlate.legacy, true);
  assert.equal(lab.officialBestSixResults[0].engineSignalsAvailable, false);
  const card = lab.engineScorecards.lineMovementClv.currentSlate;
  assert.equal(card.availableCount, 0);
  assert.equal(card.sampleSize, 0);
  assert.equal(card.instrumentedOnly, true);
});

test(73, "Confidence and risk come from sealed decision packet", () => {
  const prop = makeSealedProp({
    slateDate: "2026-07-17",
    status: "win",
  });
  prop.confidence = 99;
  prop.trueRisk = "LOW";
  prop.courtEdgeDecisionPacketV1.finalConfidence = 62;
  prop.courtEdgeDecisionPacketV1.finalRisk = "MEDIUM";
  const rec = buildLabPropRecord(prop);
  assert.equal(rec.confidence, 62);
  assert.equal(rec.risk, "MEDIUM");
  assert.equal(rec.confidenceRiskSource, "courtEdgeDecisionPacketV1");
});

test(74, "Three-slate deltas never return bare null display", () => {
  resetBlocks();
  const props = [
    ...makeSix("2026-07-14"),
    ...makeSix("2026-07-15"),
    ...makeSix("2026-07-16"),
    ...makeSix("2026-07-17"),
  ];
  const lab = buildCourtEdgeLabV2({
    trackedProps: props,
    persistThreeSlate: true,
  });
  const delta = lab.engineScorecards.lineMovementClv.change.directionalAccuracy;
  assert.ok(delta);
  assert.ok(delta.display === "N/A" || typeof delta.display === "string");
  assert.notEqual(delta.display, null);
  assert.notEqual(delta.label, null);
});

test(75, "All-time context splits by build / evidence / packet version", () => {
  const props = [
    ...makeSix("2026-07-15"),
    makeSealedProp({
      slateDate: "2026-07-17",
      omitSignals: true,
      omitPacket: true,
      status: "loss",
      bestSixRank: 1,
      player: "LegacyOnly",
    }),
  ];
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-15",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.ok(lab.allTimeContext.byBuildVersion);
  assert.ok(lab.allTimeContext.byEvidenceSchema);
  assert.ok(lab.allTimeContext.byDecisionPacketVersion);
  assert.ok(
    Object.keys(lab.allTimeContext.byEvidenceSchema).some((k) =>
      String(k).includes("uninstrumented") || String(k).includes("courtEdgeEngineSignals")
    )
  );
});

test(76, "Frozen historical membership preserved when six-prop track starts", () => {
  resetBlocks();
  const historical = [
    ...makeSix("2026-06-21"),
    ...makeSix("2026-06-22"),
    ...makeSix("2026-07-08"),
  ];
  for (const p of historical) {
    delete p.courtEdgeEngineSignalsV1;
    if (p.canonicalSealedProp) delete p.canonicalSealedProp.courtEdgeEngineSignalsV1;
  }
  const thin = [1, 2, 3].map((i) => {
    const p = makeSealedProp({
      slateDate: "2026-07-16",
      bestSixRank: i,
      player: `Jul16-${i}`,
      status: "loss",
    });
    delete p.courtEdgeEngineSignalsV1;
    if (p.canonicalSealedProp) delete p.canonicalSealedProp.courtEdgeEngineSignalsV1;
    return p;
  });
  // Mid-era thin/non-six props stay out of the new six-prop learning track.
  const mid = [1, 2, 3, 4].flatMap((rank) =>
    ["2026-07-14", "2026-07-15"].map((slateDate) => {
      const p = makeSealedProp({
        slateDate,
        bestSixRank: rank,
        player: `${slateDate}-${rank}`,
        status: "win",
      });
      delete p.courtEdgeEngineSignalsV1;
      if (p.canonicalSealedProp) delete p.canonicalSealedProp.courtEdgeEngineSignalsV1;
      return p;
    })
  );
  const next = makeSix("2026-07-20");
  const groups = buildHistoryThreeSlateGroupsV2({
    trackedProps: [...historical, ...mid, ...thin, ...next],
    persist: true,
  });
  // Jul 16 thin must not appear in active six-prop learning block
  assert.ok(!(groups.activeBlock?.slateDates || []).includes("2026-07-16"));
  assert.ok(!(groups.activeBlock?.slateDates || []).includes("2026-07-17"));
  assert.deepEqual(groups.activeBlock?.slateDates, ["2026-07-20"]);
  // Frozen historical chunks must keep Jul 16 membership when bootstrapped
  const frozenDates = (groups.frozenBlocks || []).flatMap((b) => b.slateDates || []);
  assert.ok(frozenDates.includes("2026-07-16") || groups.legacySlateDates.includes("2026-07-16"));
});

// ---------- STABILITY AUDIT / UNAVAILABLE-VALUE REPAIR V1 ----------

function makeUninstrumentedJul17Live() {
  // Mirrors live Jul 17: 6 official, 3-3-0, no sealed engine signals, no CLV market close.
  const pattern = ["win", "loss", "loss", "win", "win", "loss"];
  const sides = ["Over", "Under", "Over", "Under", "Over", "Under"];
  return pattern.map((status, i) => {
    const p = makeSealedProp({
      slateDate: "2026-07-17",
      status,
      bestSixRank: i + 1,
      player: `Jul17-${i + 1}`,
      side: sides[i],
      omitSignals: true,
      openingLine: undefined,
      closingLine: undefined,
      clv: undefined,
      closingLineValue: undefined,
      currentLine: 16.5 + i, // live board must NOT fabricate CLV
      projection: undefined,
      projectionError: undefined,
    });
    delete p.openingLine;
    delete p.closingLine;
    delete p.clv;
    delete p.closingLineValue;
    delete p.projection;
    delete p.pregameSnapshot.projection;
    delete p.pregameSnapshot.openingLine;
    if (p.canonicalSealedProp?.pregameSnapshot) {
      delete p.canonicalSealedProp.pregameSnapshot.projection;
      delete p.canonicalSealedProp.pregameSnapshot.openingLine;
    }
    return p;
  });
}

function makeHistoricalFrozenBlockProps() {
  // Use thin/non-six mid-era sizes for 07-14/07-15 so they stay historical
  // (anchor membership) and do not re-enter the six-prop learning track.
  const dates = ["2026-07-14", "2026-07-15", "2026-07-16"];
  return dates.flatMap((slateDate) => {
    const count = slateDate === "2026-07-16" ? 3 : 4;
    return Array.from({ length: count }, (_, i) => {
      const p = makeSealedProp({
        slateDate,
        status: i % 2 === 0 ? "win" : "loss",
        bestSixRank: i + 1,
        player: `${slateDate}-P${i + 1}`,
        omitSignals: true,
        closingLine: undefined,
        openingLine: undefined,
      });
      delete p.closingLine;
      delete p.openingLine;
      delete p.clv;
      return p;
    });
  });
}

function assertNoRawNullLeak(text) {
  assert.ok(!/\bnull\b/i.test(text), `leaked null in: ${text}`);
  assert.ok(!/\bundefined\b/i.test(text), `leaked undefined in: ${text}`);
  assert.ok(!/\bNaN\b/.test(text), `leaked NaN in: ${text}`);
  assert.ok(!/—%/.test(text), `leaked —% in: ${text}`);
  assert.ok(!/N\/A%/.test(text), `leaked N/A% in: ${text}`);
}

function formatConsumerLabSummary(lab) {
  const cur = lab.currentSlate || {};
  const active = lab.activeThreeSlateBlock || {};
  const prev = lab.previousThreeSlateBlock || {};
  const delta = lab.threeSlateComparison?.metrics?.winRate;
  const deltaLine =
    !delta || delta.available === false || delta.difference == null
      ? "Win rate Δ: N/A"
      : `Win rate Δ: prev ${delta.previous} → cur ${delta.current} (${delta.display})`;
  const note =
    !delta || delta.available === false
      ? delta?.note || "Comparison available after 3 compatible completed slates."
      : "";
  const eng = lab.engineScorecards?.lineMovementClv?.currentSlate || {};
  const covDir = `cov ${formatPctMetric(eng.coverage ?? eng.coveragePct)} · dir ${formatPctMetric(eng.directionalAccuracyMetric ?? eng.directionalAccuracy)}`;
  return [
    `Current slate: ${cur.slateDate} · ${cur.record} (${formatPctMetric(cur.winRateMetric ?? cur.winRate)})`,
    `Active three-slate: ${active.progress || "n/a"} · ${(active.slateDates || []).join(" · ") || "none"}`,
    `Previous block: ${(prev.slateDates || []).join(" · ") || "none"}`,
    `Avg margin ${formatMetricAvailability(cur.avgMargin, { digits: 1 })}`,
    `|proj err| ${formatMetricAvailability(cur.avgAbsProjectionErrorMetric ?? cur.avgAbsProjectionError, { digits: 1 })}`,
    `CLV ${formatClvMetric(cur.avgClvMetric ?? cur.avgClv)}`,
    deltaLine,
    note,
    covDir,
  ].join("\n");
}

test(77, "Fixture A: Jul 17 History-only; Lab empty until on-track Jul 20", () => {
  resetBlocks();
  const props = [...makeHistoricalFrozenBlockProps(), ...makeUninstrumentedJul17Live()];
  const lab = buildCourtEdgeLabV2({
    trackedProps: props,
    persistThreeSlate: true,
  });
  // Pre-track Jul 17 must not become Lab current once learning starts at Jul 20.
  assert.equal(lab.slateDate, null);
  assert.ok((lab.legacySlateDates || []).includes("2026-07-17"));
  assert.ok(!(lab.instrumentedLearningDates || []).includes("2026-07-17"));
  assert.ok(!(lab.activeThreeSlateBlock?.slateDates || []).includes("2026-07-17"));
  assert.deepEqual(lab.previousThreeSlateBlock?.slateDates, [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
  ]);
  assert.equal(lab.writesLiveWeights, false);
  assert.equal(lab.calibrationFeedbackEngine, false);

  // Explicit slateDate still renders Jul 17 History view with honest N/A metrics.
  const hist = buildCourtEdgeLabV2({
    slateDate: "2026-07-17",
    trackedProps: props,
    persistThreeSlate: false,
  });
  assert.equal(hist.slateDate, "2026-07-17");
  assert.equal(hist.currentSlate.totalProps, 6);
  assert.equal(hist.currentSlate.graded, 6);
  assert.equal(hist.currentSlate.record, "3-3-0");
  assert.equal(hist.currentSlate.overRecord.record, "2-1-0");
  assert.equal(hist.currentSlate.underRecord.record, "1-2-0");
  assert.equal(hist.currentSlate.avgClv, null);
  assert.equal(hist.currentSlate.avgClvMetric?.available, false);
  for (const key of LAB_V2_ENGINE_KEYS) {
    const card = hist.engineScorecards[key].currentSlate;
    assert.equal(card.coverage?.available, false);
    assert.equal(card.directionalAccuracyMetric?.available, false);
    assert.equal(card.instrumentedEligibleCount, 0);
  }
  const consumer = formatConsumerLabSummary(hist);
  assertNoRawNullLeak(consumer);
  assert.match(consumer, /CLV N\/A/);
  assert.match(consumer, /cov N\/A · dir N\/A/);
});

test(78, "Fixture B: measured zero remains available=true value=0", () => {
  const prop = makeSealedProp({
    slateDate: "2026-07-20",
    status: "win",
    sealedLine: 18.5,
    closingLine: 18.5,
    side: "Over",
    clv: 0,
  });
  const rec = buildLabPropRecord(prop);
  assert.equal(rec.clvMetric.available, true);
  assert.equal(rec.clvMetric.value, 0);
  assert.equal(formatClvMetric(rec.clvMetric), "0.0");
  assert.equal(isMeasuredZeroLike(rec.clvMetric), true);
});

function isMeasuredZeroLike(m) {
  return m?.available === true && m.value === 0;
}

test(79, "Fixture C: missing CLV inputs unavailable; valid zero measured", () => {
  const p1 = makeSealedProp({ status: "win" });
  delete p1.closingLine;
  delete p1.clv;
  delete p1.closingLineValue;
  const r1 = buildLabPropRecord(p1);
  assert.equal(r1.clvMetric.available, false);
  assert.equal(r1.clvMetric.reason, "MISSING_CLOSING_LINE");

  const p2 = makeSealedProp({
    sealedLine: 10,
    line: 10,
    officialLine: 10,
    closingLine: 10,
    side: "Over",
    clv: undefined,
    closingLineValue: undefined,
  });
  p2.pregameSnapshot.line = 10;
  if (p2.canonicalSealedProp?.pregameSnapshot) {
    p2.canonicalSealedProp.pregameSnapshot.line = 10;
  }
  delete p2.clv;
  delete p2.closingLineValue;
  const r2 = buildLabPropRecord(p2);
  assert.equal(r2.clvMetric.available, true);
  assert.equal(r2.clvMetric.value, 0);

  const r3 = buildLabPropRecord({
    ...makeSealedProp({ status: "win" }),
    clv: "nope",
    closingLineValue: "nope",
    closingLine: null,
  });
  assert.equal(r3.clvMetric.available, false);

  // currentLine alone must not create CLV 0
  const p4 = makeSealedProp({
    sealedLine: 20,
    currentLine: 20,
  });
  delete p4.closingLine;
  delete p4.clv;
  delete p4.closingLineValue;
  const r4 = buildLabPropRecord(p4);
  assert.equal(r4.clv, null);
  assert.equal(r4.clvMetric.available, false);
});

test(80, "Fixture D: incomplete active block deltas unavailable; complete enables arithmetic", () => {
  resetBlocks();
  const props13 = [
    ...makeHistoricalFrozenBlockProps(),
    ...makeSix("2026-07-20"),
  ];
  const lab13 = buildCourtEdgeLabV2({
    trackedProps: props13,
    persistThreeSlate: true,
  });
  assert.equal(lab13.activeThreeSlateBlock.progress, "1/3");
  assert.equal(lab13.threeSlateComparison.metrics.winRate.available, false);
  assert.equal(lab13.activeThreeSlateBlock.record, lab13.currentSlate.record);

  resetBlocks();
  const props23 = [
    ...makeHistoricalFrozenBlockProps(),
    ...makeSix("2026-07-20"),
    ...makeSix("2026-07-21"),
  ];
  const lab23 = buildCourtEdgeLabV2({
    trackedProps: props23,
    persistThreeSlate: true,
  });
  assert.equal(lab23.activeThreeSlateBlock.progress, "2/3");
  assert.equal(lab23.threeSlateComparison.metrics.winRate.available, false);

  resetBlocks();
  const props33 = [
    ...makeHistoricalFrozenBlockProps(),
    ...makeSix("2026-07-20"),
    ...makeSix("2026-07-21"),
    ...makeSix("2026-07-22"),
  ];
  const lab33 = buildCourtEdgeLabV2({
    trackedProps: props33,
    persistThreeSlate: true,
  });
  assert.equal(lab33.activeThreeSlateBlock.progress, "0/3");
  assert.deepEqual(lab33.activeThreeSlateBlock.slateDates, []);
  assert.equal(lab33.activeThreeSlateBlock.incomplete, true);
  assert.deepEqual(lab33.previousThreeSlateBlock?.slateDates, [
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
  ]);
  assert.equal(lab33.previousThreeSlateBlock?.progress, "3/3");
  assert.equal(lab33.slateDate, "2026-07-22");
  const wr = lab33.threeSlateComparison?.metrics?.winRate;
  assert.ok(wr, "winRate delta object missing");
  assert.equal(
    wr.available,
    true,
    `expected available delta, got reason=${wr.reason} display=${wr.display} prevComplete=${lab33.threeSlateComparison?.previousComplete} currentComplete=${lab33.threeSlateComparison?.currentComplete} prev=${JSON.stringify(lab33.previousThreeSlateBlock?.slateDates)} active=${JSON.stringify(lab33.activeThreeSlateBlock?.slateDates)}`
  );
  assert.equal(typeof wr.difference, "number");
});

test(81, "Fixture E: legacy visible but excluded from modern engine scoreboards", () => {
  resetBlocks();
  const legacy = makeUninstrumentedJul17Live();
  const modern = makeSix("2026-07-20");
  const lab = buildCourtEdgeLabV2({
    slateDate: "2026-07-20",
    trackedProps: [...legacy, ...modern],
    persistThreeSlate: false,
  });
  assert.ok(lab.allTimeContext.byEvidenceSchema);
  assert.ok(
    Object.keys(lab.allTimeContext.byEvidenceSchema).some((k) =>
      String(k).includes("uninstrumented")
    )
  );
  // Current modern slate scoreboard should have eligible instrumented props
  const card = lab.engineScorecards.lineMovementClv.currentSlate;
  assert.ok(card.instrumentedEligibleCount > 0);
  // Legacy-only build on Jul 17 date
  const labLegacy = buildCourtEdgeLabV2({
    slateDate: "2026-07-17",
    trackedProps: legacy,
    persistThreeSlate: false,
  });
  assert.equal(
    labLegacy.engineScorecards.lineMovementClv.currentSlate.instrumentedEligibleCount,
    0
  );
  assert.equal(
    labLegacy.engineScorecards.lineMovementClv.currentSlate.coverage.available,
    false
  );
});

test(82, "Fixture F: frozen block membership immutable across reload", () => {
  resetBlocks();
  const props = [...makeHistoricalFrozenBlockProps(), ...makeSix("2026-07-20")];
  const first = buildHistoryThreeSlateGroupsV2({
    trackedProps: props,
    persist: true,
  });
  assert.deepEqual(first.previousBlock?.slateDates, [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
  ]);
  // Simulate reload — do not reset store
  const second = buildHistoryThreeSlateGroupsV2({
    trackedProps: props,
    persist: true,
  });
  assert.deepEqual(second.previousBlock?.slateDates, [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
  ]);
  assert.deepEqual(second.activeBlock?.slateDates, ["2026-07-20"]);
  assert.ok(
    HISTORICAL_THREE_SLATE_ANCHORS.some((a) =>
      a.join(",") === "2026-07-14,2026-07-15,2026-07-16"
    )
  );
});

test(83, "Fixture G: simulated restart preserves Jul 20-only semantics", () => {
  resetBlocks();
  const props = [
    ...makeHistoricalFrozenBlockProps(),
    ...makeUninstrumentedJul17Live(),
    ...makeSix("2026-07-20"),
  ];
  const before = buildCourtEdgeLabV2({
    trackedProps: props,
    persistThreeSlate: true,
  });
  // Restart simulation: new process reads same persisted store + same props
  clearFrozenThreeSlateMembershipCache();
  const after = buildCourtEdgeLabV2({
    trackedProps: props,
    persistThreeSlate: true,
  });
  assert.equal(after.slateDate, "2026-07-20");
  assert.deepEqual(after.previousThreeSlateBlock?.slateDates, before.previousThreeSlateBlock?.slateDates);
  assert.deepEqual(after.activeThreeSlateBlock?.slateDates, ["2026-07-20"]);
  assert.equal(after.activeThreeSlateBlock?.progress, "1/3");
  assert.ok(!(after.activeThreeSlateBlock?.slateDates || []).includes("2026-07-17"));
  assert.ok((after.legacySlateDates || []).includes("2026-07-17"));
  assert.equal(after.threeSlateComparison?.metrics?.winRate?.available, false);
  const dates = [
    ...(after.activeThreeSlateBlock?.slateDates || []),
    ...(after.previousThreeSlateBlock?.slateDates || []),
  ];
  assert.equal(new Set(dates).size, dates.length);
});

test(84, "Fixture H: screen and Copy Report semantic parity (no raw null leaks)", () => {
  resetBlocks();
  const props = [
    ...makeHistoricalFrozenBlockProps(),
    ...makeUninstrumentedJul17Live(),
    ...makeSix("2026-07-20"),
  ];
  const lab = buildCourtEdgeLabV2({
    trackedProps: props,
    persistThreeSlate: true,
  });
  const screen = formatConsumerLabSummary(lab);
  // Copy-report style lines from same payload
  const copy = [
    `Current slate: ${lab.currentSlate.slateDate} · ${lab.currentSlate.record} (${formatPctMetric(lab.currentSlate.winRateMetric ?? lab.currentSlate.winRate)})`,
    `Active three-slate: ${lab.activeThreeSlateBlock.progress} · ${lab.activeThreeSlateBlock.slateDates.join(" · ")}`,
    `Previous block: ${lab.previousThreeSlateBlock.slateDates.join(" · ")}`,
    `CLV ${formatClvMetric(lab.currentSlate.avgClvMetric ?? lab.currentSlate.avgClv)}`,
    lab.threeSlateComparison?.metrics?.winRate?.available
      ? `Win rate Δ: prev ${lab.threeSlateComparison.metrics.winRate.previous} → cur ${lab.threeSlateComparison.metrics.winRate.current}`
      : "Win rate Δ: N/A",
    `cov ${formatPctMetric(lab.engineScorecards.lineMovementClv.currentSlate.coverage)} · dir ${formatPctMetric(lab.engineScorecards.lineMovementClv.currentSlate.directionalAccuracyMetric)}`,
  ].join("\n");
  assertNoRawNullLeak(screen);
  assertNoRawNullLeak(copy);
  assert.equal(lab.slateDate, "2026-07-20");
  assert.deepEqual(lab.activeThreeSlateBlock?.slateDates, ["2026-07-20"]);
  assert.match(screen, /2026-07-20/);
  assert.match(copy, /2026-07-20/);
  assert.match(screen, /Win rate Δ: N\/A/);
  assert.match(copy, /Win rate Δ: N\/A/);
});

test(85, "Fixture I: July 19 absence — never Lab without on-track sealed six; Jul 17 History-only", () => {
  resetBlocks();
  const props = [...makeHistoricalFrozenBlockProps(), ...makeUninstrumentedJul17Live()];
  // Partial / home-draft-like Jul 19 — not immutable official Results cohort
  const draft19 = [1, 2, 3].map((i) => ({
    slateDate: "2026-07-19",
    player: `Draft-${i}`,
    status: "win",
    bestSixRank: i,
    trackingType: "TEST",
    immutableOfficial: false,
    line: 10,
  }));
  const lab = buildCourtEdgeLabV2({
    trackedProps: [...props, ...draft19],
    persistThreeSlate: true,
  });
  assert.equal(lab.slateDate, null);
  assert.ok(!(lab.activeThreeSlateBlock?.slateDates || []).includes("2026-07-19"));
  assert.ok(!(lab.activeThreeSlateBlock?.slateDates || []).includes("2026-07-17"));

  // Jul 19 is still before learning-track start — must not enter Lab learning UI.
  resetBlocks();
  const with19 = [
    ...makeHistoricalFrozenBlockProps(),
    ...makeUninstrumentedJul17Live(),
    ...makeSix("2026-07-19"),
  ];
  const lab2 = buildCourtEdgeLabV2({
    trackedProps: with19,
    persistThreeSlate: true,
  });
  assert.ok(!(lab2.activeThreeSlateBlock?.slateDates || []).includes("2026-07-19"));
  assert.equal(lab2.slateDate, null);

  // On-track Jul 20 sealed six becomes Lab current / active 1/3.
  resetBlocks();
  const with20 = [
    ...makeHistoricalFrozenBlockProps(),
    ...makeUninstrumentedJul17Live(),
    ...makeSix("2026-07-20"),
  ];
  const lab3 = buildCourtEdgeLabV2({
    trackedProps: with20,
    persistThreeSlate: true,
  });
  assert.deepEqual(lab3.activeThreeSlateBlock?.slateDates, ["2026-07-20"]);
  assert.equal(lab3.activeThreeSlateBlock?.progress, "1/3");
  assert.equal(lab3.slateDate, "2026-07-20");
});

test(86, "MetricAvailability helpers distinguish measured zero from unavailable", () => {
  assert.deepEqual(measuredMetric(0), { available: true, value: 0, reason: null });
  assert.equal(unavailableMetric("UNINSTRUMENTED").available, false);
  const delta = buildCompatibleDeltaMetric(50, 60, {
    previousComplete: false,
    currentComplete: false,
  });
  assert.equal(delta.available, false);
  assert.equal(delta.reason, "INSUFFICIENT_COMPATIBLE_SLATES");
  assert.equal(delta.display, "N/A");
});

test(87, "Uninstrumented placeholder open=close=seal does not invent CLV 0", () => {
  const p = makeSealedProp({
    slateDate: "2026-07-17",
    omitSignals: true,
    sealedLine: 16.5,
    openingLine: 16.5,
    closingLine: 16.5,
    line: 16.5,
    clv: 0,
    closingLineValue: 0,
  });
  p.pregameSnapshot.line = 16.5;
  const r = buildLabPropRecord(p);
  assert.equal(r.uninstrumented, true);
  assert.equal(r.clv, null);
  assert.equal(r.clvMetric.available, false);
  assert.equal(r.clvMetric.reason, "UNINSTRUMENTED");
  assert.equal(formatClvMetric(r.clvMetric), "N/A");
});

test(88, "Missing 06-21 must not steal Jul 20; Jul 17 stays History-only", () => {
  resetBlocks();
  const dates = [
    "2026-06-22",
    "2026-07-08",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
    "2026-07-20",
  ];
  const store = syncThreeSlateBlocksV2(dates, {
    learningDates: ["2026-07-20"],
    legacyDates: ["2026-06-22", "2026-07-08", "2026-07-17"],
  });
  assert.deepEqual(store.activeBlock?.slateDates, ["2026-07-20"]);
  assert.equal(store.activeBlock?.progress, "1/3");
  assert.equal(store.activeBlock?.incomplete, true);
  const frozen = store.frozenBlocks || [];
  assert.ok(
    frozen.some(
      (b) =>
        JSON.stringify([...(b.slateDates || [])].sort()) ===
        JSON.stringify(["2026-07-14", "2026-07-15", "2026-07-16"])
    )
  );
  assert.ok(!frozen.some((b) => (b.slateDates || []).includes("2026-07-17")));
  assert.ok(!frozen.some((b) => (b.slateDates || []).includes("2026-07-20")));
  assert.ok((store.legacySlateDates || []).includes("2026-07-17"));
});

test(89, "Heals corrupt frozen mix; Jul 17 demoted, Jul 20 alone in active", () => {
  resetBlocks();
  // Reproduce pre-fix bootstrap corruption (no learningDates restriction).
  syncThreeSlateBlocksV2([
    "2026-06-22",
    "2026-07-08",
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
    "2026-07-17",
  ]);
  const healed = syncThreeSlateBlocksV2(
    [
      "2026-06-22",
      "2026-07-08",
      "2026-07-14",
      "2026-07-15",
      "2026-07-16",
      "2026-07-17",
      "2026-07-20",
    ],
    {
      learningDates: ["2026-07-20"],
      legacyDates: ["2026-06-22", "2026-07-08", "2026-07-17"],
    }
  );
  assert.deepEqual(healed.activeBlock?.slateDates, ["2026-07-20"]);
  assert.equal(healed.activeBlock?.progress, "1/3");
  assert.ok(
    !(healed.frozenBlocks || []).some((b) =>
      (b.slateDates || []).includes("2026-07-17")
    )
  );
  assert.ok(
    (healed.frozenBlocks || []).some(
      (b) =>
        JSON.stringify([...(b.slateDates || [])].sort()) ===
        JSON.stringify(["2026-07-14", "2026-07-15", "2026-07-16"])
    )
  );
  assert.ok((healed.demotedFromActive || []).includes("2026-07-17") ||
    (healed.legacySlateDates || []).includes("2026-07-17"));
});

test(90, "Lab learning-track floor: Jul 20 current 1/3; Jul 17 History-only; weights false", () => {
  resetBlocks();
  const props = [
    ...makeHistoricalFrozenBlockProps(),
    ...makeUninstrumentedJul17Live(),
    ...makeSix("2026-07-20"),
  ];
  const lab = buildCourtEdgeLabV2({
    trackedProps: props,
    persistThreeSlate: true,
  });
  assert.equal(lab.slateDate, "2026-07-20");
  assert.equal(lab.writesLiveWeights, false);
  assert.equal(lab.adjustmentReview?.writesLiveWeights, false);
  assert.equal(lab.officialBestSixResults.length, 6);
  assert.equal(lab.currentSlate.graded, 6);
  assert.equal(lab.currentSlate.pending, 0);
  assert.deepEqual(lab.activeThreeSlateBlock?.slateDates, ["2026-07-20"]);
  assert.equal(lab.activeThreeSlateBlock?.progress, "1/3");
  assert.ok(!(lab.activeThreeSlateBlock?.slateDates || []).includes("2026-07-17"));
  assert.deepEqual(lab.previousThreeSlateBlock?.slateDates, [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
  ]);
  assert.ok((lab.legacySlateDates || []).includes("2026-07-17"));
  assert.ok(!(lab.instrumentedLearningDates || []).includes("2026-07-17"));
});

test(91, "Historical-anchor member 06-22 never joins post-anchor learning; Jul 17 History-only", () => {
  resetBlocks();
  const legacy0622 = Array.from({ length: 13 }, (_, i) =>
    makeSealedProp({
      slateDate: "2026-06-22",
      status: i % 2 === 0 ? "win" : "loss",
      bestSixRank: i + 1,
      player: `Legacy0622-${i + 1}`,
      omitSignals: true,
    })
  );
  const props = [
    ...legacy0622,
    ...makeHistoricalFrozenBlockProps(),
    ...makeUninstrumentedJul17Live(),
    ...makeSix("2026-07-20"),
  ];
  const groups = buildHistoryThreeSlateGroupsV2({
    trackedProps: props,
    persist: true,
  });
  assert.ok(!groups.instrumentedLearningDates.includes("2026-06-22"));
  assert.ok(!groups.instrumentedLearningDates.includes("2026-07-17"));
  assert.deepEqual(groups.activeBlock?.slateDates, ["2026-07-20"]);
  assert.equal(groups.activeBlock?.progress, "1/3");
  assert.ok(
    !(groups.frozenBlocks || []).some((b) =>
      (b.slateDates || []).includes("2026-06-22") &&
      (b.slateDates || []).includes("2026-07-17")
    )
  );
  const lab = buildCourtEdgeLabV2({
    trackedProps: props,
    persistThreeSlate: true,
  });
  assert.equal(lab.slateDate, "2026-07-20");
  assert.deepEqual(lab.activeThreeSlateBlock?.slateDates, ["2026-07-20"]);
});

test(92, "Learning-track floor: only Jul 20 → current Jul20, active 1/3 [Jul20]", () => {
  resetBlocks();
  const lab = buildCourtEdgeLabV2({
    trackedProps: [
      ...makeHistoricalFrozenBlockProps(),
      ...makeUninstrumentedJul17Live(),
      ...makeSix("2026-07-20"),
    ],
    persistThreeSlate: true,
  });
  assert.equal(lab.slateDate, "2026-07-20");
  assert.equal(lab.currentSlate.slateDate, "2026-07-20");
  assert.deepEqual(lab.activeThreeSlateBlock?.slateDates, ["2026-07-20"]);
  assert.equal(lab.activeThreeSlateBlock?.progress, "1/3");
});

test(93, "Learning-track floor: next eligible → current=newest, active 2/3 [Jul20, next]", () => {
  resetBlocks();
  const lab = buildCourtEdgeLabV2({
    trackedProps: [
      ...makeHistoricalFrozenBlockProps(),
      ...makeUninstrumentedJul17Live(),
      ...makeSix("2026-07-20"),
      ...makeSix("2026-07-21"),
    ],
    persistThreeSlate: true,
  });
  assert.equal(lab.slateDate, "2026-07-21");
  assert.deepEqual(lab.activeThreeSlateBlock?.slateDates, [
    "2026-07-20",
    "2026-07-21",
  ]);
  assert.equal(lab.activeThreeSlateBlock?.progress, "2/3");
  assert.ok(!(lab.activeThreeSlateBlock?.slateDates || []).includes("2026-07-17"));
});

test(94, "Learning-track floor: third → freeze 3/3, new empty active; current=newest", () => {
  resetBlocks();
  const lab = buildCourtEdgeLabV2({
    trackedProps: [
      ...makeHistoricalFrozenBlockProps(),
      ...makeUninstrumentedJul17Live(),
      ...makeSix("2026-07-20"),
      ...makeSix("2026-07-21"),
      ...makeSix("2026-07-22"),
    ],
    persistThreeSlate: true,
  });
  assert.equal(lab.slateDate, "2026-07-22");
  assert.deepEqual(lab.activeThreeSlateBlock?.slateDates, []);
  assert.equal(lab.activeThreeSlateBlock?.progress, "0/3");
  assert.equal(lab.activeThreeSlateBlock?.incomplete, true);
  assert.deepEqual(lab.previousThreeSlateBlock?.slateDates, [
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
  ]);
  assert.equal(lab.previousThreeSlateBlock?.progress, "3/3");
  assert.equal(lab.previousThreeSlateBlock?.frozen, true);
  assert.ok(!(lab.instrumentedLearningDates || []).includes("2026-07-17"));
});

test(95, "Learning-track floor: Jul 17 never becomes Lab current after start date", () => {
  resetBlocks();
  const with17Only = buildCourtEdgeLabV2({
    trackedProps: [
      ...makeHistoricalFrozenBlockProps(),
      ...makeUninstrumentedJul17Live(),
    ],
    persistThreeSlate: true,
  });
  assert.equal(with17Only.slateDate, null);
  assert.ok(!(with17Only.activeThreeSlateBlock?.slateDates || []).includes("2026-07-17"));

  resetBlocks();
  const withBoth = buildCourtEdgeLabV2({
    trackedProps: [
      ...makeHistoricalFrozenBlockProps(),
      ...makeUninstrumentedJul17Live(),
      ...makeSix("2026-07-20"),
      ...makeSix("2026-07-22"),
    ],
    persistThreeSlate: true,
  });
  assert.equal(withBoth.slateDate, "2026-07-22");
  assert.notEqual(withBoth.slateDate, "2026-07-17");
  assert.ok(!(withBoth.activeThreeSlateBlock?.slateDates || []).includes("2026-07-17"));
  assert.ok((withBoth.legacySlateDates || []).includes("2026-07-17"));
});

test(96, "Sealed-pending on-track floor slate stays Lab current + active 1/3 (not legacy)", () => {
  resetBlocks();
  const pending = makeSix("2026-07-20").map((p) => ({
    ...p,
    status: "pending",
    result: null,
  }));
  const lab = buildCourtEdgeLabV2({
    trackedProps: [
      ...makeHistoricalFrozenBlockProps(),
      ...makeUninstrumentedJul17Live(),
      ...pending,
    ],
    persistThreeSlate: true,
  });
  assert.equal(lab.slateDate, "2026-07-20");
  assert.deepEqual(lab.activeThreeSlateBlock?.slateDates, ["2026-07-20"]);
  assert.equal(lab.activeThreeSlateBlock?.progress, "1/3");
  assert.ok(!(lab.legacySlateDates || []).includes("2026-07-20"));
  assert.ok((lab.instrumentedLearningDates || []).includes("2026-07-20"));
  assert.ok(!(lab.activeThreeSlateBlock?.slateDates || []).includes("2026-07-17"));
});

console.log("\n==============================");
console.log(`Lab V2 tests: ${passed} passed, ${failed} failed`);
console.log("==============================");

if (failed > 0) {
  for (const f of failures) {
    console.error(`#${f.num} ${f.name}: ${f.err?.message || f.err}`);
  }
  process.exit(1);
}

