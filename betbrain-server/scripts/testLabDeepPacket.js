/**
 * Lab deep packet + aggregate breakdown tests.
 */
import assert from "node:assert/strict";
import { buildCompletePregameSnapshot } from "../services/pregameSnapshotBuilder.js";
import {
  buildOfficialLearningRecord,
  attachOfficialLearningToReport,
} from "../services/officialLearningRecordBuilder.js";
import { buildPostgameTruth } from "../services/labLearningEnrichmentService.js";
import { buildLabAggregateBreakdown } from "../services/labAggregateBreakdown.js";

function testCompletePregameSnapshot() {
  const snap = buildCompletePregameSnapshot(
    {
      player: "Test Player",
      team: "dream",
      opponent: "tempo",
      league: "WNBA",
      side: "Over",
      line: 18.5,
      projection: 21,
      rawProjection: 22,
      profileAdjustedProjection: 21,
      confidence: 80,
      expectedMinutes: 30,
      expectedFGA: 14,
      expectedFTA: 4,
      bestSixRank: 2,
      topPickRank: 1,
      decisionIntelligence: { trueRisk: "MEDIUM", trackEligibility: "TRACK" },
      serverBuild: "test-build",
    },
    { slateDate: "2026-07-16", sealedAt: "2026-07-16T12:00:00.000Z" }
  );
  assert.equal(snap.player, "Test Player");
  assert.equal(snap.rank, 2);
  assert.equal(snap.isTopPick, true);
  assert.equal(snap.rawProjection, 22);
  assert.ok(snap.officialPropId);
  assert.ok(snap.sealedAt);
}

function testPostgameUnavailableNotZero() {
  const truth = buildPostgameTruth({
    status: "loss",
    line: 18.5,
    side: "Over",
    pendingReason: "awaiting box score",
  });
  assert.equal(truth.actualFGA, null);
  assert.equal(truth.measuredFields.actualFGA.unavailable, true);
  assert.equal(truth.measuredFields.actualFGA.value, null);
}

function testLearningPacketFourLayers() {
  const rec = buildOfficialLearningRecord({
    player: "Lab Player",
    team: "dream",
    league: "WNBA",
    slateDate: "2026-07-16",
    status: "loss",
    result: "LOSS",
    side: "Over",
    line: 18.5,
    actualStat: 12,
    actualMinutes: 22,
    actualFGA: 7,
    expectedMinutes: 31,
    expectedFGA: 13,
    confidence: 78,
    projection: 20.8,
    resultMargin: -6.5,
    decisionIntelligence: { trueRisk: "MEDIUM", trackEligibility: "TRACK" },
    officialSealedAt: "2026-07-16T12:00:00.000Z",
    pregameSnapshot: buildCompletePregameSnapshot(
      {
        player: "Lab Player",
        team: "dream",
        league: "WNBA",
        side: "Over",
        line: 18.5,
        projection: 20.8,
        expectedMinutes: 31,
        expectedFGA: 13,
        confidence: 78,
      },
      { slateDate: "2026-07-16", sealedAt: "2026-07-16T12:00:00.000Z" }
    ),
  });
  assert.ok(rec.learningPacket.pregame);
  assert.ok(rec.learningPacket.postgame);
  assert.ok(rec.learningPacket.diagnosis);
  assert.equal(rec.learningPacket.diagnosis.missType, "OPPORTUNITY_MISS");
  assert.equal(rec.learningPacket.diagnosis.missSubtype, "MINUTES_AND_VOLUME_CUT");
}

function testAggregateBreakdown() {
  const records = [
    buildOfficialLearningRecord({
      player: "A",
      league: "WNBA",
      slateDate: "2026-07-16",
      status: "win",
      result: "WIN",
      side: "Over",
      line: 10,
      actualStat: 14,
      confidence: 75,
      topPickRank: 1,
      decisionIntelligence: { trueRisk: "LOW", trackEligibility: "TRACK" },
      officialSealedAt: "x",
      pregameSnapshot: buildCompletePregameSnapshot(
        { player: "A", side: "Over", line: 10, confidence: 75, topPickRank: 1 },
        { slateDate: "2026-07-16", sealedAt: "x" }
      ),
    }),
    buildOfficialLearningRecord({
      player: "B",
      league: "WNBA",
      slateDate: "2026-07-16",
      status: "loss",
      result: "LOSS",
      side: "Under",
      line: 15,
      actualStat: 18,
      confidence: 70,
      decisionIntelligence: { trueRisk: "HIGH", trackEligibility: "TRACK" },
      officialSealedAt: "x",
      pregameSnapshot: buildCompletePregameSnapshot(
        { player: "B", side: "Under", line: 15, confidence: 70 },
        { slateDate: "2026-07-16", sealedAt: "x" }
      ),
    }),
  ];
  const agg = buildLabAggregateBreakdown(records);
  assert.ok(agg.dimensionIndex.side?.length >= 2);
  assert.ok(agg.dimensionIndex.pool?.length >= 1);
  const report = attachOfficialLearningToReport({ slateDate: "2026-07-16" }, records.map((r) => ({
    ...r,
    status: r.outcome?.won ? "win" : "loss",
    player: r.player,
    league: "WNBA",
    slateDate: "2026-07-16",
    pregameSnapshot: r.pregameSnapshot,
    actualStat: r.projection?.actual,
    resultMargin: r.outcome?.margin,
  })));
  assert.ok(report.labAggregateBreakdown);
}

for (const [name, fn] of [
  ["complete pregame snapshot", testCompletePregameSnapshot],
  ["postgame unavailable not zero", testPostgameUnavailableNotZero],
  ["learning packet four layers", testLearningPacketFourLayers],
  ["aggregate breakdown", testAggregateBreakdown],
]) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}
console.log("All lab deep packet tests passed.");
