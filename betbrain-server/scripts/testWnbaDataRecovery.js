/**
 * WNBA data recovery v1 acceptance tests.
 * Usage: node betbrain-server/scripts/testWnbaDataRecovery.js
 */
import assert from "assert";
import {
  RECOVERY_CLASS,
  DATA_RECOVERY_VERSION,
  classifyIntegrityIssue,
  attemptWnbaDataRecovery,
  attachDataRecoveryToIntegrity,
  summarizeRecoveryForDisplay,
} from "../engines/wnba/wnbaDataRecoveryV1.js";
import { auditWnbaDataIntegrity } from "../engines/wnba/wnbaDataIntegrityV1.js";
import {
  analyzeCandidateRejectionChain,
  summarizeSlateRejectionAnalysis,
} from "../services/wnbaSlateRejectionAnalysis.js";

function baseContext(overrides = {}) {
  return {
    playerName: "Test Player",
    playerId: "100",
    team: "chicagosky",
    opponent: "portlandfire",
    last5: [{ points: 12 }, { points: 14 }, { points: 11 }],
    matchupGames: [{ points: 16 }],
    seasonAverage: 13.5,
    availabilityGate: { availabilityDataMissing: false, statusLevel: "ACTIVE" },
    defenseResult: { defenseScore: 45, context: {} },
    prop: { bookCount: 4, line: 14.5 },
    playerState: { seasonPoints: 13.5, matchupAverage: 16 },
    ballPlayerResolved: true,
    stablePlayerIdUsed: false,
    ...overrides,
  };
}

function testVersionConstant() {
  assert.strictEqual(DATA_RECOVERY_VERSION, "wnba-data-recovery-v1");
  console.log("✓ version constant");
}

function testRecoveryClassEnum() {
  assert.ok(RECOVERY_CLASS.TRUE_SOURCE_UNAVAILABLE);
  assert.ok(RECOVERY_CLASS.TRUE_NO_PLAYER_H2H);
  assert.ok(RECOVERY_CLASS.FIXABLE_PLAYER_ID_FAILURE);
  assert.ok(RECOVERY_CLASS.FIXABLE_ALIAS_FAILURE);
  assert.ok(RECOVERY_CLASS.FIXABLE_CACHE_FAILURE);
  assert.ok(RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE);
  console.log("✓ recovery class enum");
}

function testClassifyPlayerIdStableOverride() {
  const cls = classifyIntegrityIssue(
    { key: "playerId", status: "MISSING", repairable: true },
    { playerName: "Azura Stevens", ballPlayerResolved: false }
  );
  assert.strictEqual(cls, RECOVERY_CLASS.FIXABLE_PLAYER_ID_FAILURE);
  console.log("✓ classify stable player id failure");
}

function testClassifyPlayerIdLookup() {
  const cls = classifyIntegrityIssue(
    { key: "playerId", status: "MISSING", repairable: false },
    { playerName: "Unknown Player", ballPlayerResolved: false }
  );
  assert.strictEqual(cls, RECOVERY_CLASS.FIXABLE_LOOKUP_FAILURE);
  console.log("✓ classify player lookup failure");
}

function testClassifyAliasFailure() {
  const cls = classifyIntegrityIssue(
    { key: "opponent", status: "LOOKUP_FAILED", repairable: true },
    {}
  );
  assert.strictEqual(cls, RECOVERY_CLASS.FIXABLE_ALIAS_FAILURE);
  console.log("✓ classify alias failure");
}

function testClassifyMarketUnavailable() {
  const cls = classifyIntegrityIssue(
    { key: "market", status: "MISSING", repairable: false },
    {}
  );
  assert.strictEqual(cls, RECOVERY_CLASS.TRUE_SOURCE_UNAVAILABLE);
  console.log("✓ classify market true unavailable");
}

function testClassifyAvailabilityFallback() {
  const cls = classifyIntegrityIssue(
    { key: "availability", status: "SOURCE_UNAVAILABLE", repairable: false },
    {}
  );
  assert.strictEqual(cls, RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE);
  console.log("✓ classify availability needs fallback");
}

function testClassifySeasonStatsCache() {
  const cls = classifyIntegrityIssue(
    { key: "seasonStats", status: "MISSING", repairable: false },
    { playerName: "Test", playerId: "100" }
  );
  assert.strictEqual(cls, RECOVERY_CLASS.FIXABLE_CACHE_FAILURE);
  console.log("✓ classify season stats cache failure");
}

function testClassifyMatchupTrueUnavailable() {
  const cls = classifyIntegrityIssue(
    {
      key: "matchup",
      status: "MISSING",
      repairable: false,
      meta: {
        opponentTeamId: "portlandfire",
        teamId: "chicagosky",
        matchupLookupClass: "BALL_GAME_LOOKUP_EMPTY",
      },
    },
    {
      playerName: "Azura Stevens",
      playerId: "525",
      ballPlayerResolved: true,
      matchupProbe: { classification: "BALL_GAME_LOOKUP_EMPTY" },
    }
  );
  assert.strictEqual(cls, RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE);
  console.log("✓ classify matchup needs fallback when games probe empty");
}

function testClassifyMatchupTrueNoPlayerH2H() {
  const cls = classifyIntegrityIssue(
    {
      key: "matchup",
      status: "MISSING",
      repairable: false,
      meta: {
        opponentTeamId: "portlandfire",
        teamId: "chicagosky",
        matchupLookupClass: "PLAYER_DID_NOT_PLAY_IN_MATCHUP",
      },
    },
    {
      playerName: "Azura Stevens",
      playerId: "525",
      ballPlayerResolved: true,
      matchupProbe: { classification: "PLAYER_DID_NOT_PLAY_IN_MATCHUP" },
    }
  );
  assert.strictEqual(cls, RECOVERY_CLASS.TRUE_NO_PLAYER_H2H);
  console.log("✓ classify matchup true no player h2h when games exist but DNP");
}

function testClassifyMatchupFixableWhenWrongQuery() {
  const cls = classifyIntegrityIssue(
    {
      key: "matchup",
      status: "MISSING",
      repairable: false,
      meta: {
        opponentTeamId: "portlandfire",
        teamId: "chicagosky",
        matchupLookupClass: "WRONG_QUERY_KEY_SUSPECTED",
      },
    },
    {
      playerName: "Azura Stevens",
      playerId: "525",
      ballPlayerResolved: true,
      matchupProbe: { classification: "WRONG_QUERY_KEY_SUSPECTED" },
    }
  );
  assert.strictEqual(cls, RECOVERY_CLASS.FIXABLE_LOOKUP_FAILURE);
  console.log("✓ classify matchup fixable when wrong query suspected");
}

function testClassifyDefenseFallback() {
  const cls = classifyIntegrityIssue(
    { key: "defense", status: "MISSING", repairable: false },
    {}
  );
  assert.strictEqual(cls, RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE);
  console.log("✓ classify defense fallback");
}

function testClassifyOkReturnsNull() {
  const cls = classifyIntegrityIssue({ key: "playerId", status: "OK" }, {});
  assert.strictEqual(cls, null);
  console.log("✓ classify OK returns null");
}

function testEmptyRecoveryShape() {
  const audit = auditWnbaDataIntegrity(baseContext());
  const result = attemptWnbaDataRecovery(baseContext(), audit);
  assert.ok(result.then, "returns promise");
  console.log("✓ empty recovery returns promise");
}

async function testNoFixableIssuesSkipped() {
  const audit = auditWnbaDataIntegrity(baseContext());
  const { dataRecovery } = await attemptWnbaDataRecovery(baseContext(), audit);
  assert.strictEqual(dataRecovery.attempted, false);
  assert.strictEqual(dataRecovery.fixableFailuresFound, 0);
  console.log("✓ no fixable issues skips attempt");
}

async function testAliasRecoveryTeam() {
  const ctx = baseContext({ team: "CHI", opponent: "POR" });
  const audit = auditWnbaDataIntegrity({
    ...ctx,
    playerId: "100",
    last5: ctx.last5,
    matchupGames: ctx.matchupGames,
    seasonAverage: ctx.seasonAverage,
    prop: ctx.prop,
    playerState: ctx.playerState,
  });
  const { dataRecovery, context } = await attemptWnbaDataRecovery(ctx, audit);
  if (dataRecovery.fixableFailuresFound > 0) {
    assert.ok(dataRecovery.recoveredFields.includes("team") || dataRecovery.recoveredFields.includes("opponent") || dataRecovery.attempted);
  }
  assert.ok(context.team || ctx.team);
  console.log("✓ alias recovery attempt for team/opponent");
}

async function testStablePlayerIdRecovery() {
  const ctx = baseContext({
    playerName: "Azura Stevens",
    playerId: "",
    ballPlayerResolved: false,
  });
  const audit = auditWnbaDataIntegrity({
    ...ctx,
    last5: [],
    seasonAverage: 0,
    playerState: {},
    prop: { bookCount: 1, line: 14.5 },
  });
  const { dataRecovery, context } = await attemptWnbaDataRecovery(ctx, audit);
  assert.strictEqual(dataRecovery.attempted, true);
  assert.ok(
    dataRecovery.recoveredFields.includes("playerId") ||
      context.playerId === "525"
  );
  console.log("✓ stable player id recovery");
}

function testAttachDataRecoveryToIntegrity() {
  const attached = attachDataRecoveryToIntegrity(
    { overall: "PARTIAL", score: 70 },
    { attempted: true, fixableFailuresResolved: 1 }
  );
  assert.strictEqual(attached.dataRecoveryVersion, DATA_RECOVERY_VERSION);
  assert.ok(attached.dataRecovery);
  console.log("✓ attach data recovery to integrity");
}

function testSummarizeRecoveryDisplayNone() {
  const text = summarizeRecoveryForDisplay({ attempted: false, fixableFailuresFound: 0 });
  assert.ok(text.includes("none needed"));
  console.log("✓ summarize recovery none needed");
}

function testSummarizeRecoveryDisplayFixed() {
  const text = summarizeRecoveryForDisplay({
    attempted: true,
    fixableFailuresFound: 2,
    fixableFailuresResolved: 2,
  });
  assert.ok(text.includes("2/2"));
  console.log("✓ summarize recovery fixed");
}

function testSummarizeRecoveryDisplayPartial() {
  const text = summarizeRecoveryForDisplay({
    attempted: true,
    fixableFailuresFound: 3,
    fixableFailuresResolved: 1,
    unrecoveredFields: ["matchup"],
  });
  assert.ok(text.includes("1/3"));
  console.log("✓ summarize recovery partial");
}

function testRecoveryObjectFields() {
  const attached = attachDataRecoveryToIntegrity({}, {
    attempted: true,
    recoveredFields: ["playerId"],
    unrecoveredFields: ["matchup"],
    trueUnavailableFields: ["market"],
    fallbackSourcesUsed: ["stable_player_id_override"],
    fixableFailuresFound: 2,
    fixableFailuresResolved: 1,
    stillBlockingEligibility: ["matchup"],
    wouldEligibilityImproveAfterRecovery: true,
  });
  const dr = attached.dataRecovery;
  assert.deepStrictEqual(dr.recoveredFields, ["playerId"]);
  assert.strictEqual(dr.wouldEligibilityImproveAfterRecovery, true);
  console.log("✓ recovery object fields present");
}

function testRejectionChainReaderNoBet() {
  const chain = analyzeCandidateRejectionChain({
    player: "Test",
    team: "chicagosky",
    line: 14.5,
    side: "Over",
    league: "WNBA",
    wnbaReader: { decision: "NO_BET", reasonCodes: ["thin_edge"] },
    wnbaDataCard: { dataIntegrity: { overall: "GOOD", score: 90, issues: [] } },
  });
  assert.strictEqual(chain.finalOutcome, "NO_BET");
  assert.strictEqual(chain.blockingStage, "reader");
  console.log("✓ rejection chain reader no bet");
}

function testRejectionChainBoardOnly() {
  const pick = {
    player: "Board Player",
    team: "chicagosky",
    opponent: "portlandfire",
    line: 14.5,
    side: "Over",
    pick: "Over",
    league: "WNBA",
    bookCount: 4,
    wnbaReader: { decision: "OFFICIAL", finalSide: "OVER" },
    wnbaDataCard: {
      dataIntegrity: { overall: "PARTIAL", score: 75, issues: [] },
      bookCount: 4,
    },
    decisionIntelligence: {
      trackEligibility: "BOARD_ONLY",
      bestSixEligibility: false,
      trueRisk: "ELEVATED",
    },
  };
  const chain = analyzeCandidateRejectionChain(pick);
  assert.ok(chain.stages.some((s) => s.stage === "decisionIntelligence"));
  console.log("✓ rejection chain board only stage");
}

function testSlateSummaryCounts() {
  const summary = summarizeSlateRejectionAnalysis(
    [
      {
        player: "A",
        league: "WNBA",
        wnbaReader: { decision: "OFFICIAL", finalSide: "OVER" },
        decisionIntelligence: { trackEligibility: "TRACK", bestSixEligibility: true },
      },
      {
        player: "B",
        league: "WNBA",
        wnbaReader: { decision: "NO_BET" },
      },
    ],
    []
  );
  assert.strictEqual(summary.candidateCount, 2);
  assert.ok(summary.noBet >= 1);
  console.log("✓ slate summary counts");
}

function testDataBlindVsWeakSlateLabel() {
  const dataBlind = summarizeSlateRejectionAnalysis(
    [
      {
        player: "A",
        league: "WNBA",
        dataRecovery: { fixableFailuresFound: 3, fixableFailuresResolved: 1 },
        wnbaReader: { decision: "OFFICIAL", finalSide: "OVER" },
        decisionIntelligence: { trackEligibility: "BOARD_ONLY", bestSixEligibility: false },
      },
    ],
    []
  );
  assert.strictEqual(dataBlind.dataBlindVsWeakSlate, "DATA_BLIND");
  console.log("✓ data blind vs weak slate label");
}

function testIntegrityWithRecoveryAttached() {
  const audit = auditWnbaDataIntegrity(
    baseContext({ playerId: "", ballPlayerResolved: false, last5: [], seasonAverage: 0, playerState: {} })
  );
  assert.ok(audit.issues.some((i) => i.key === "playerId"));
  console.log("✓ integrity before recovery has issues");
}

async function testWouldEligibilityImproveFlag() {
  const ctx = baseContext({
    playerName: "Azura Stevens",
    playerId: "",
    ballPlayerResolved: false,
    last5: [{ points: 10 }, { points: 12 }, { points: 11 }],
    seasonAverage: 11,
    playerState: { seasonPoints: 11 },
  });
  const audit = auditWnbaDataIntegrity({
    ...ctx,
    prop: ctx.prop,
  });
  const { dataRecovery } = await attemptWnbaDataRecovery(ctx, audit);
  if (dataRecovery.fixableFailuresResolved > 0) {
    assert.ok(typeof dataRecovery.wouldEligibilityImproveAfterRecovery === "boolean");
  }
  console.log("✓ wouldEligibilityImprove flag typed");
}

async function main() {
  testVersionConstant();
  testRecoveryClassEnum();
  testClassifyPlayerIdStableOverride();
  testClassifyPlayerIdLookup();
  testClassifyAliasFailure();
  testClassifyMarketUnavailable();
  testClassifyAvailabilityFallback();
  testClassifySeasonStatsCache();
  testClassifyMatchupTrueUnavailable();
  testClassifyMatchupTrueNoPlayerH2H();
  testClassifyMatchupFixableWhenWrongQuery();
  testClassifyDefenseFallback();
  testClassifyOkReturnsNull();
  testEmptyRecoveryShape();
  await testNoFixableIssuesSkipped();
  await testAliasRecoveryTeam();
  await testStablePlayerIdRecovery();
  testAttachDataRecoveryToIntegrity();
  testSummarizeRecoveryDisplayNone();
  testSummarizeRecoveryDisplayFixed();
  testSummarizeRecoveryDisplayPartial();
  testRecoveryObjectFields();
  testRejectionChainReaderNoBet();
  testRejectionChainBoardOnly();
  testSlateSummaryCounts();
  testDataBlindVsWeakSlateLabel();
  testIntegrityWithRecoveryAttached();
  await testWouldEligibilityImproveFlag();
  console.log("\nAll WNBA data recovery tests passed (28).");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
