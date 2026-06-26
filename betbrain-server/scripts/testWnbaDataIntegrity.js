/**
 * WNBA data integrity audit tests.
 * Usage: node betbrain-server/scripts/testWnbaDataIntegrity.js
 */
import assert from "assert";
import {
  auditWnbaDataIntegrity,
  DATA_INTEGRITY_VERSION,
  summarizeDataIntegrityForDisplay,
} from "../engines/wnba/wnbaDataIntegrityV1.js";

function baseContext(overrides = {}) {
  return {
    playerName: "Test Player",
    playerId: "100",
    team: "chicagosky",
    opponent: "portlandfire",
    last5: [{ points: 12 }, { points: 14 }, { points: 11 }],
    matchupGames: [{ points: 16 }, { points: 18 }],
    matchupAverage: 17,
    seasonAverage: 13.5,
    availabilityGate: {
      availabilityDataMissing: false,
      availabilityRisk: false,
      statusLevel: "ACTIVE",
    },
    defenseResult: { defenseScore: 45, context: {} },
    prop: { bookCount: 4, line: 14.5 },
    playerState: { matchupAverage: 17, seasonPoints: 13.5 },
    ballPlayerResolved: true,
    stablePlayerIdUsed: false,
    ...overrides,
  };
}

function testVersionConstant() {
  assert.strictEqual(DATA_INTEGRITY_VERSION, "wnba-data-integrity-v1");
  console.log("✓ version constant");
}

function testGoodOverall() {
  const audit = auditWnbaDataIntegrity(baseContext());
  assert.strictEqual(audit.overall, "GOOD");
  assert.ok(audit.score >= 82);
  assert.strictEqual(audit.version, DATA_INTEGRITY_VERSION);
  console.log("✓ GOOD overall when complete");
}

function testMissingPlayerIdBad() {
  const audit = auditWnbaDataIntegrity(
    baseContext({
      playerId: "",
      last5: [],
      seasonAverage: 0,
      playerState: {},
      ballPlayerResolved: false,
    })
  );
  assert.ok(["BAD", "PARTIAL"].includes(audit.overall));
  assert.ok(audit.issues.some((i) => i.key === "playerId"));
  console.log("✓ missing player id flagged");
}

function testMatchupMissingIssue() {
  const audit = auditWnbaDataIntegrity(
    baseContext({
      matchupGames: [],
      matchupAverage: null,
      playerState: { matchupAverage: null, seasonPoints: 13.5 },
    })
  );
  const matchup = audit.issues.find((i) => i.key === "matchup");
  assert.ok(matchup);
  assert.ok(matchup.message.includes("No opponent matchup history"));
  assert.strictEqual(matchup.meta.lookupMethod, "games-then-player_stats");
  console.log("✓ missing matchup issue");
}

function testAvailabilitySourceUnavailable() {
  const audit = auditWnbaDataIntegrity(
    baseContext({
      availabilityGate: {
        availabilityDataMissing: true,
        availabilityRisk: true,
        availabilitySourceStatus: "SOURCE_UNAVAILABLE",
        availabilityMessage:
          "WNBA availability feed missing — uncertainty treated as risk",
        statusLevel: "UNKNOWN",
      },
    })
  );
  const avail = audit.issues.find((i) => i.key === "availability");
  assert.ok(avail);
  assert.strictEqual(avail.status, "SOURCE_UNAVAILABLE");
  assert.strictEqual(audit.availability.treatedAsRisk, true);
  console.log("✓ availability SOURCE_UNAVAILABLE");
}

function testTeamAliasMeta() {
  const audit = auditWnbaDataIntegrity(baseContext());
  assert.strictEqual(audit.teams.opponent.teamId, "portlandfire");
  assert.ok(audit.teams.opponent.aliases.includes("por"));
  console.log("✓ team alias metadata");
}

function testStablePlayerResolvedFrom() {
  const audit = auditWnbaDataIntegrity(
    baseContext({ playerId: "528", stablePlayerIdUsed: true })
  );
  assert.strictEqual(audit.player.resolvedFrom, "stable_override");
  assert.strictEqual(audit.player.stableIdUsed, true);
  console.log("✓ stable player resolvedFrom");
}

function testDisplaySummary() {
  const summary = summarizeDataIntegrityForDisplay({ overall: "PARTIAL", score: 71 });
  assert.strictEqual(summary.label, "PARTIAL");
  assert.strictEqual(summary.compact, "Data: PARTIAL");
  console.log("✓ display summary");
}

function testWeakLast5() {
  const audit = auditWnbaDataIntegrity(
    baseContext({ last5: [{ points: 10 }] })
  );
  assert.ok(audit.issues.some((i) => i.key === "last5"));
  console.log("✓ weak last5 flagged");
}

function testOpponentLookupFailed() {
  const audit = auditWnbaDataIntegrity(
    baseContext({ opponent: "UNKNOWNTEAM" })
  );
  assert.ok(
    audit.issues.some(
      (i) => i.key === "opponent" || i.key === "matchup"
    )
  );
  console.log("✓ unknown opponent flagged");
}

function main() {
  testVersionConstant();
  testGoodOverall();
  testMissingPlayerIdBad();
  testMatchupMissingIssue();
  testAvailabilitySourceUnavailable();
  testTeamAliasMeta();
  testStablePlayerResolvedFrom();
  testDisplaySummary();
  testWeakLast5();
  testOpponentLookupFailed();
  console.log("\nAll WNBA data integrity tests passed (10).");
}

main();
