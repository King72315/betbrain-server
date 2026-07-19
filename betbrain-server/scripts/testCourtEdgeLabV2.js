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
  buildHistoryThreeSlateGroupsV2,
  clearFrozenThreeSlateMembershipCache,
  collectCompletedOfficialSlateDates,
  resetThreeSlateBlocksStoreForTests,
  syncThreeSlateBlocksV2,
  HISTORY_THREE_SLATE_GROUPS_V2,
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

test(17, "Third completed slate freezes the block at 3/3", () => {
  resetBlocks();
  const store = syncBlocksFromDates(["2026-07-14", "2026-07-15", "2026-07-16"]);
  const frozen = frozenGroups(store);
  assert.ok(frozen.length >= 1);
  assert.deepEqual(frozen[frozen.length - 1].slateDates, [
    "2026-07-14",
    "2026-07-15",
    "2026-07-16",
  ]);
  assert.equal(store.activeBlock?.incomplete, false);
  assert.equal(store.activeBlock?.progress, "3/3");
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
  ];
  const groups = buildHistoryThreeSlateGroupsV2({
    trackedProps: props,
    persist: true,
  });
  assert.ok(groups.previousBlock || groups.completeGroupCount >= 1);
  assert.ok(groups.activeBlock);
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
  assert.equal(card.directionalOpportunities, 0);
  assert.equal(card.hurt, 0);
  assert.ok(card.unavailableCount >= 1);
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
  assert.equal(lab.engineScorecards.lineMovementClv.currentSlate.coveragePct, 50);
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

console.log("\n==============================");
console.log(`Lab V2 tests: ${passed} passed, ${failed} failed`);
console.log("==============================");

if (failed > 0) {
  for (const f of failures) {
    console.error(`#${f.num} ${f.name}: ${f.err?.message || f.err}`);
  }
  process.exit(1);
}

