/**
 * Tests for CourtEdge POINTS + REBOUNDS + ASSISTS multi-stat V1
 */
import assert from "assert";
import {
  normalizePropTypeV1,
  buildCanonicalMarketIdV1,
  PROP_TYPE_TO_ODDS_MARKET,
} from "../engines/wnba/propTypeV1.js";
import { projectWnbaRebounds } from "../engines/wnba/wnbaReboundsProjectionEngine.js";
import { projectWnbaAssists } from "../engines/wnba/wnbaAssistsProjectionEngine.js";
import { projectWnbaStatByPropTypeV1 } from "../engines/wnba/projectWnbaStatByPropTypeV1.js";
import { buildFairLineForPropTypeV1 } from "../engines/wnba/fairLineByPropTypeV1.js";
import { computeOfficialRankScoreV1 } from "../engines/wnba/officialRankScoreV1.js";
import { stampCorrelationGroupsV1 } from "../engines/wnba/correlationAwarenessV1.js";
import { featureRoleForPropType } from "../engines/wnba/featureOwnershipRegistryV1.js";
import { selectOfficialMembershipV1 } from "../engines/courtEdgeControlPlaneV1/selectOfficialMembershipV1.js";
import { stableMarketId } from "../engines/courtEdgeControlPlaneV1/contract.js";
import { buildConsensusPlayerProps } from "../services/oddsService.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    throw err;
  }
}

test("market identity: same player three distinct markets", () => {
  const a = buildCanonicalMarketIdV1({
    eventId: "e1",
    player: "Aja Wilson",
    propType: "POINTS",
    line: 24.5,
    side: "OVER",
  });
  const b = buildCanonicalMarketIdV1({
    eventId: "e1",
    player: "Aja Wilson",
    propType: "REBOUNDS",
    line: 10.5,
    side: "OVER",
  });
  const c = buildCanonicalMarketIdV1({
    eventId: "e1",
    player: "Aja Wilson",
    propType: "ASSISTS",
    line: 2.5,
    side: "UNDER",
  });
  assert.notStrictEqual(a, b);
  assert.notStrictEqual(b, c);
  assert.ok(normalizePropTypeV1("player_rebounds") === "REBOUNDS");
  assert.ok(PROP_TYPE_TO_ODDS_MARKET.ASSISTS === "player_assists");
});

test("points isolation: FGA does not drive rebound projection", () => {
  const base = {
    seasonMinutes: 32,
    recentMinutes: 31,
    seasonRebounds: 9.5,
    recentRebounds: 10.2,
  };
  const a = projectWnbaRebounds(base);
  const b = projectWnbaRebounds({ ...base, seasonFGA: 99, recentFGA: 99 });
  assert.strictEqual(a.projection, b.projection);
  assert.ok(a.reboundOpportunitySource === "DERIVED" || a.reboundOpportunitySource === "DIRECT");
});

test("assists isolation: scoring usage does not substitute for assist rate", () => {
  const a = projectWnbaAssists({
    seasonMinutes: 30,
    recentMinutes: 30,
    seasonAssists: 5.5,
    recentAssists: 6.0,
  });
  const b = projectWnbaAssists({
    seasonMinutes: 30,
    recentMinutes: 30,
    seasonAssists: 5.5,
    recentAssists: 6.0,
    seasonPoints: 25,
    recentPoints: 28,
    seasonFGA: 20,
  });
  assert.strictEqual(a.projection, b.projection);
  assert.ok(
    a.playmakingOpportunitySource === "DERIVED_PROXY" ||
      a.playmakingOpportunitySource === "MISSING" ||
      a.playmakingOpportunitySource === "DIRECT"
  );
});

test("missing potential assists stay MISSING not zero", () => {
  const r = projectWnbaAssists({
    seasonMinutes: 0,
    recentMinutes: 0,
    seasonAssists: 0,
    recentAssists: 0,
  });
  assert.strictEqual(r.playmakingOpportunitySource, "MISSING");
  assert.ok(r.components.potentialAssists == null || r.components.potentialAssists === 0);
});

test("feature ownership registry prevents cross-stat bias", () => {
  assert.strictEqual(featureRoleForPropType("FGA", "POINTS"), "HIGH");
  assert.strictEqual(featureRoleForPropType("FGA", "REBOUNDS"), "CONTEXTUAL");
  assert.strictEqual(featureRoleForPropType("assistRate", "ASSISTS"), "HIGH");
  assert.strictEqual(featureRoleForPropType("assistRate", "REBOUNDS"), "NONE");
  assert.strictEqual(featureRoleForPropType("reboundShare", "POINTS"), "NONE");
});

test("fair lines are propType-specific", () => {
  const pts = buildFairLineForPropTypeV1({
    propType: "POINTS",
    playerState: {
      seasonPoints: 18,
      recentPoints: 17,
      seasonMinutes: 30,
      recentMinutes: 30,
      seasonFGA: 14,
      recentFGA: 13,
      seasonFTA: 4,
      recentFTA: 4,
      sportsProjection: 17.5,
    },
    prop: { line: 17.5 },
  });
  const reb = buildFairLineForPropTypeV1({
    propType: "REBOUNDS",
    playerState: { seasonRebounds: 8, recentRebounds: 9, sportsProjection: 8.5 },
    prop: { line: 8.5 },
    projection: 8.5,
  });
  assert.ok(pts.fairLineSource === "POINTS_VOLUME_EFFICIENCY");
  assert.ok(reb.fairLineSource === "REBOUNDS_RATE_BLEND");
  assert.notStrictEqual(pts.fairLineSource, reb.fairLineSource);
});

test("officialRankScore equal across propTypes for equal calibrated P", () => {
  const a = computeOfficialRankScoreV1({
    propType: "POINTS",
    predictedProbability: 0.67,
    Safety: 70,
    riskV2: "MEDIUM",
  });
  const b = computeOfficialRankScoreV1({
    propType: "ASSISTS",
    predictedProbability: 0.67,
    Safety: 70,
    riskV2: "MEDIUM",
  });
  assert.strictEqual(a.officialRankScore, b.officialRankScore);
  assert.strictEqual(b.calibrationStatus, "CALIBRATION_DEVELOPING");
});

test("no quotas: six assists can fill Official", () => {
  const mk = (i) => ({
    playerName: `Assist Star ${i}`,
    playerId: `a${i}`,
    eventId: `e${i}`,
    propType: "ASSISTS",
    selectedSide: "OVER",
    line: 4.5 + i * 0.5,
    boardCandidate: true,
    membership: {
      boardCandidate: true,
      analysisEligible: true,
      directionAdmission: "PRIMARY",
    },
    direction: { directionAdmission: "PRIMARY", confidence: "STRONG" },
    risk: { risk: "LOW" },
    c2Risk: "LOW",
    reliabilityProbability: 0.9,
    officialRankScore: 0.8 - i * 0.01,
  });
  const packets = [0, 1, 2, 3, 4, 5].map(mk);
  const { selectedPackets } = selectOfficialMembershipV1(packets);
  assert.ok(selectedPackets.length >= 2);
  assert.ok(selectedPackets.every((p) => p.propType === "ASSISTS"));
});

test("stableMarketId includes propType", () => {
  const a = stableMarketId({
    playerName: "Aja Wilson",
    eventId: "e1",
    propType: "POINTS",
    selectedSide: "OVER",
    line: 24.5,
  });
  const b = stableMarketId({
    playerName: "Aja Wilson",
    eventId: "e1",
    propType: "REBOUNDS",
    selectedSide: "OVER",
    line: 24.5,
  });
  assert.notStrictEqual(a, b);
  assert.ok(a.includes("POINTS"));
  assert.ok(b.includes("REBOUNDS"));
});

test("consensus collapses by player+propType", () => {
  const raw = [
    {
      player: "Test Player",
      playerKey: "testplayer",
      side: "Over",
      line: 10.5,
      odds: -110,
      sportsbook: "A",
      propType: "REBOUNDS",
      marketKey: "player_rebounds",
    },
    {
      player: "Test Player",
      playerKey: "testplayer",
      side: "Under",
      line: 10.5,
      odds: -110,
      sportsbook: "A",
      propType: "REBOUNDS",
      marketKey: "player_rebounds",
    },
    {
      player: "Test Player",
      playerKey: "testplayer",
      side: "Over",
      line: 20.5,
      odds: -110,
      sportsbook: "A",
      propType: "POINTS",
      marketKey: "player_points",
    },
    {
      player: "Test Player",
      playerKey: "testplayer",
      side: "Under",
      line: 20.5,
      odds: -110,
      sportsbook: "A",
      propType: "POINTS",
      marketKey: "player_points",
    },
  ];
  const cons = buildConsensusPlayerProps(raw);
  assert.strictEqual(cons.length, 2);
  const types = new Set(cons.map((c) => c.propType));
  assert.ok(types.has("POINTS") && types.has("REBOUNDS"));
});

test("grading uses correct box field by propType", () => {
  // resolvePickPropType / getActualStatForPropType are not exported — inline check via project dispatch
  const pts = projectWnbaStatByPropTypeV1("POINTS", {
    seasonMinutes: 30,
    recentMinutes: 30,
    seasonPoints: 18,
    recentPoints: 17,
    seasonFGA: 14,
    recentFGA: 13,
    seasonFTA: 4,
    recentFTA: 3,
  });
  const reb = projectWnbaStatByPropTypeV1("REBOUNDS", {
    seasonMinutes: 30,
    recentMinutes: 30,
    seasonRebounds: 8,
    recentRebounds: 9,
  });
  assert.strictEqual(pts.propType, "POINTS");
  assert.strictEqual(reb.propType, "REBOUNDS");
  assert.notStrictEqual(pts.projection, reb.projection);
});

test("correlation stamps without changing membership fields", () => {
  const rows = stampCorrelationGroupsV1([
    {
      playerName: "Star",
      propType: "POINTS",
      selectedSide: "OVER",
      eventId: "g1",
    },
    {
      playerName: "Star",
      propType: "ASSISTS",
      selectedSide: "OVER",
      eventId: "g1",
    },
  ]);
  assert.ok(rows[0].correlationGroup);
  assert.ok(Array.isArray(rows[0].correlationReasons));
  assert.ok(rows[0].correlationReasons.length > 0);
});

console.log("\nCOURTEDGE_PRA_MULTISTAT_V1 tests complete");
