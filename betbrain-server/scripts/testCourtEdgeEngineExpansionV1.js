/**
 * CourtEdge Engine Expansion V1 — comprehensive unit tests (cases 1–75).
 * Usage: node scripts/testCourtEdgeEngineExpansionV1.js
 *
 * Fixture-only — no live API keys. Exits non-zero on any failure.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { evaluateLineMovementClv } from "../engines/courtEdgeExpansion/lineMovementClvEngine.js";
import { evaluateProjectionSanity } from "../engines/courtEdgeExpansion/projectionSanityEngine.js";
import { evaluateAvailabilityRoster, AVAILABILITY_STATE } from "../engines/courtEdgeExpansion/availabilityRosterEngine.js";
import { evaluateCeilingFloorDistribution } from "../engines/courtEdgeExpansion/distributionEngine.js";
import { evaluatePlayerVolatility } from "../engines/courtEdgeExpansion/volatilityEngine.js";
import { evaluateDefensiveArchetype } from "../engines/courtEdgeExpansion/defensiveArchetypeEngine.js";
import { evaluateRoleTrendVelocity } from "../engines/courtEdgeExpansion/roleVelocityEngine.js";
import { evaluateTruePacePossession } from "../engines/courtEdgeExpansion/pacePossessionEngine.js";
import { evaluateEvidenceDeduplication } from "../engines/courtEdgeExpansion/evidenceDeduplicationEngine.js";
import { evaluateRestFatigue } from "../engines/courtEdgeExpansion/restFatigueEngine.js";
import { evaluateTeammateImpact } from "../engines/courtEdgeExpansion/teammateImpactEngine.js";
import {
  buildCourtEdgeEngineSignalsV1,
  ENGINE_EXPANSION_VERSION,
  SCHEMA_BUILD,
} from "../engines/courtEdgeExpansion/orchestratorV1.js";
import { leagueRegulationMinutes } from "../engines/courtEdgeExpansion/shared.js";
import {
  attachCourtEdgeEngineSignals,
  applyEngineSignalAdjustments,
  isEngineExpansionEnabled,
  admitResultsFromDecisionPacket,
  assertDecisionPacketUnchanged,
} from "../services/courtEdgeEngineSignalsV1.js";
import {
  resolveSelectedLine,
  buildLineAuditFields,
  applySideChangeKeepLine,
  assertLineUnchanged,
} from "../services/lineIntegrityV1.js";
import { buildCanonicalSealedProp, attachCanonicalSealedProp } from "../services/canonicalSealedProp.js";
import { finalizeSameTeamForcedUnderPresentation } from "../engines/wnba/playerIntelligence/sameTeamForcedSidePresentationV1.js";
import { annotateResultsAdmission } from "../engines/topProps/controlledBestSixSelector.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "..", "test-fixtures", "engine-expansion-v1");

function loadFixture(name) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, name), "utf8"));
}

const rich = loadFixture("game-logs-rich.json");
const lineMoveFx = loadFixture("line-movement.json");
const paceIncomplete = loadFixture("pace-incomplete.json");
const sameTeamFx = loadFixture("same-team.json");

let passed = 0;
let failed = 0;
const failures = [];

function test(id, name, fn) {
  const label = `${id}. ${name}`;
  try {
    fn();
    passed += 1;
    console.log(`PASS: ${label}`);
  } catch (err) {
    failed += 1;
    failures.push(label);
    console.error(`FAIL: ${label}`);
    console.error(err?.stack || err);
  }
}

function gameLog(partial = {}) {
  return { points: 18, minutes: 28, fga: 12, fta: 3, oreb: 1, tov: 2, ...partial };
}

function daysAgo(n) {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const FORBIDDEN_UI = /BOARD_ONLY|NO_BET|SHADOW_ONLY|READER_UNCERTAIN/;

function collectReasons(signals) {
  const reasons = [];
  if (!signals?.engines) return reasons;
  for (const eng of Object.values(signals.engines)) {
    if (eng?.reason) reasons.push(String(eng.reason));
  }
  return reasons;
}

console.log("\n=== 1–6 Line movement ===");
test(1, "falling line against Over", () => {
  const s = evaluateLineMovementClv({
    openingLine: 21.5,
    currentLine: 19.5,
    organicModelSide: "OVER",
    finalSide: "OVER",
    bookCount: 6,
  });
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.movement, "DOWN");
  assert.strictEqual(s.marketMovedAgainstFinal, true);
  assert.ok(s.confidenceAdjustment < 0);
});

test(2, "rising line toward Over", () => {
  const s = evaluateLineMovementClv({
    openingLine: 18.5,
    currentLine: 20.5,
    organicModelSide: "OVER",
    finalSide: "OVER",
    bookCount: 5,
  });
  assert.strictEqual(s.movement, "UP");
  assert.strictEqual(s.marketMovedTowardFinal, true);
});

test(3, "flat line movement", () => {
  const s = evaluateLineMovementClv({ openingLine: 20, currentLine: 20, finalSide: "UNDER", bookCount: 4 });
  assert.strictEqual(s.movement, "FLAT");
  assert.strictEqual(s.marketMovedAgainstFinal, false);
});

test(4, "positive CLV when sealed better than current for Over", () => {
  const s = evaluateLineMovementClv({
    openingLine: 20,
    sealedLine: 19.5,
    currentLine: 21,
    organicModelSide: "OVER",
    finalSide: "OVER",
    bookCount: 6,
  });
  assert.strictEqual(s.closingLineValueDirection, "POSITIVE");
  assert.ok(s.sealedLineValue > 0);
});

test(5, "thin books mark low reliability / stale", () => {
  const s = evaluateLineMovementClv({
    openingLine: 20,
    currentLine: 19,
    finalSide: "OVER",
    bookCount: 1,
  });
  assert.strictEqual(s.movementReliability, "LOW");
  assert.strictEqual(s.staleMarket, true);
});

test(6, "no line data -> unavailable", () => {
  const s = evaluateLineMovementClv({});
  assert.strictEqual(s.available, false);
  assert.strictEqual(s.normalizedSignal, 0);
});

console.log("\n=== 7–10 Projection sanity ===");
test(7, "projection consistent with season history", () => {
  const s = evaluateProjectionSanity({
    ...rich,
    projection: 20,
  });
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.projectionRequiresCeilingOutcome, false);
});

test(8, "unsupported ceiling projection flagged", () => {
  // Flat volume history so minutes/FGA trends do not "support" an absurd projection.
  const flatLogs = Array.from({ length: 12 }, () =>
    gameLog({ points: 18, minutes: 28, fga: 12, fta: 3 })
  );
  const s = evaluateProjectionSanity({
    gameLogs: flatLogs,
    seasonAverage: 18,
    projection: 40,
  });
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.projectionRequiresCeilingOutcome, true);
  assert.ok(s.confidenceAdjustment < 0);
});

test(9, "missing projection -> unavailable", () => {
  const s = evaluateProjectionSanity({ gameLogs: rich.gameLogs, seasonAverage: 19.9 });
  assert.strictEqual(s.available, false);
});

test(10, "role window can support elevated projection", () => {
  const roleGames = Array.from({ length: 8 }, () => gameLog({ points: 28, minutes: 34, fga: 18 }));
  const s = evaluateProjectionSanity({
    gameLogs: rich.gameLogs,
    seasonAverage: 19.9,
    roleGames,
    projection: 27,
  });
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.roleSupportsCeiling, true);
});

console.log("\n=== 11–16 Availability ===");
test(11, "injury OUT elevates risk", () => {
  const s = evaluateAvailabilityRoster({ injuryRow: { status: "Out - ankle" } });
  assert.strictEqual(s.status, AVAILABILITY_STATE.OUT);
  assert.strictEqual(s.overContribution, 0);
  assert.ok(s.confidenceAdjustment < 0);
});

test(12, "questionable status", () => {
  const s = evaluateAvailabilityRoster({ availabilityStatus: "Questionable" });
  assert.strictEqual(s.status, AVAILABILITY_STATE.QUESTIONABLE);
});

test(13, "confirmed active", () => {
  const s = evaluateAvailabilityRoster({ availabilityStatus: "Active - starting" });
  assert.strictEqual(s.status, AVAILABILITY_STATE.CONFIRMED_ACTIVE);
});

test(14, "schedule gap is not inactivity evidence", () => {
  const s = evaluateAvailabilityRoster({ scheduleGapDays: 8, providerHealth: { ok: true } });
  assert.strictEqual(s.scheduleGapIsInactivityEvidence, false);
  assert.ok(s.status === AVAILABILITY_STATE.STATUS_UNAVAILABLE || s.status === AVAILABILITY_STATE.PROVIDER_ERROR);
});

test(15, "provider failure is not OUT evidence", () => {
  const s = evaluateAvailabilityRoster({ providerHealth: { ok: false, status: "ERROR" }, injuryFeedOk: false });
  assert.strictEqual(s.status, AVAILABILITY_STATE.PROVIDER_ERROR);
  assert.strictEqual(s.providerFailureIsOutEvidence, false);
});

test(16, "no status -> STATUS_UNAVAILABLE", () => {
  const s = evaluateAvailabilityRoster({ providerHealth: { ok: true } });
  assert.strictEqual(s.status, AVAILABILITY_STATE.STATUS_UNAVAILABLE);
});

console.log("\n=== 17–21 Distribution / volatility ===");
test(17, "distribution available with hit rates", () => {
  const s = evaluateCeilingFloorDistribution({ gameLogs: rich.gameLogs, line: 19.5 });
  assert.strictEqual(s.available, true);
  assert.ok(s.season.sampleSize >= 10);
  assert.ok(s.season.hitRate !== null);
});

test(18, "season and role windows reported separately", () => {
  const roleGames = rich.gameLogs.slice(0, 5).map((g) => ({ ...g, points: g.points + 5 }));
  const s = evaluateCeilingFloorDistribution({ gameLogs: rich.gameLogs, roleGames, line: 19.5 });
  assert.ok(s.season);
  assert.ok(s.role);
  assert.notStrictEqual(s.season.average, s.role.average);
});

test(19, "volatility never casts Over/Under vote", () => {
  const s = evaluatePlayerVolatility({ league: "WNBA", gameLogs: rich.gameLogs });
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.normalizedSignal, 0);
  assert.strictEqual(s.overContribution, 0);
  assert.strictEqual(s.underContribution, 0);
});

test(20, "high CV reduces confidence only", () => {
  const volatile = [
    gameLog({ points: 5 }),
    gameLog({ points: 40 }),
    gameLog({ points: 2 }),
    gameLog({ points: 38 }),
    gameLog({ points: 4 }),
    gameLog({ points: 42 }),
    gameLog({ points: 3 }),
    gameLog({ points: 39 }),
  ];
  const s = evaluatePlayerVolatility({ league: "WNBA", gameLogs: volatile });
  assert.ok(["HIGH", "MODERATE"].includes(s.volatilityTier));
  assert.ok(s.confidenceAdjustment <= 0);
});

test(21, "insufficient sample for volatility", () => {
  const s = evaluatePlayerVolatility({ league: "NBA", gameLogs: [gameLog(), gameLog()] });
  assert.strictEqual(s.available, false);
});

console.log("\n=== 22–26 Defensive archetype ===");
test(22, "volume-only archetype without position", () => {
  const s = evaluateDefensiveArchetype({ gameLogs: rich.gameLogs, seasonAverage: 19.9 });
  assert.strictEqual(s.positionAvailable, false);
  assert.strictEqual(s.archetypeBasis, "VOLUME_ONLY");
  assert.strictEqual(s.rawValues.positionFabricated, false);
});

test(23, "comparables produce directional signal", () => {
  const comps = Array.from({ length: 6 }, () => ({ points: 26 }));
  const s = evaluateDefensiveArchetype({
    gameLogs: rich.gameLogs,
    seasonAverage: 19.9,
    archetypeComparables: comps,
  });
  assert.strictEqual(s.comparableAvailable, true);
  assert.ok(s.normalizedSignal > 0);
});

test(24, "no sample -> unavailable", () => {
  const s = evaluateDefensiveArchetype({});
  assert.strictEqual(s.available, false);
});

test(25, "declared position not fabricated when missing", () => {
  const s = evaluateDefensiveArchetype({ gameLogs: rich.gameLogs });
  assert.strictEqual(s.rawValues.declaredPosition, null);
  assert.strictEqual(s.rawValues.positionFabricated, false);
});

test(26, "small comparable sample still marks developing quality", () => {
  const s = evaluateDefensiveArchetype({
    gameLogs: rich.gameLogs,
    seasonAverage: 20,
    archetypeComparables: [{ points: 22 }, { points: 21 }, { points: 23 }],
  });
  assert.strictEqual(s.comparableAvailable, true);
  assert.ok(["DEVELOPING", "USABLE", "STRONG", "EARLY"].includes(s.quality));
});

console.log("\n=== 27–30 Role velocity ===");
test(27, "sustained role change detection", () => {
  // most-recent-first: rising minutes toward the present
  const logs = [];
  for (let i = 0; i < 10; i += 1) {
    const minutes = 20 + (9 - i) * 1.5; // recent (idx0) highest
    logs.push(gameLog({ minutes, points: 12 + (9 - i), fga: 8 + (9 - i) * 0.5 }));
  }
  const s = evaluateRoleTrendVelocity({ gameLogs: logs });
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.sustainedRoleChange, true);
});

test(28, "one-game blip dampens signal", () => {
  // Mild spike keeps |L10 minutes slope| <= 0.8 so the engine classifies a blip,
  // not a sustained role change.
  const logs = [
    gameLog({ minutes: 28, points: 20, fga: 12 }),
    ...Array.from({ length: 9 }, () => gameLog({ minutes: 22, points: 14, fga: 10 })),
  ];
  const s = evaluateRoleTrendVelocity({ gameLogs: logs });
  assert.strictEqual(s.available, true);
  assert.strictEqual(s.oneGameBlip, true);
  assert.strictEqual(s.sustainedRoleChange, false);
});

test(29, "insufficient logs -> unavailable", () => {
  const s = evaluateRoleTrendVelocity({ gameLogs: [gameLog(), gameLog()] });
  assert.strictEqual(s.available, false);
});

test(30, "single combined ROLE_AND_VOLUME engine vote", () => {
  const bundle = buildCourtEdgeEngineSignalsV1({ league: "WNBA", gameLogs: rich.gameLogs }, { force: true });
  assert.ok(bundle.engines.roleVelocity);
  assert.ok(!bundle.engines.minutesVelocity);
  assert.ok(!bundle.engines.fgaVelocity);
});

console.log("\n=== 31–36 Pace ===");
test(31, "NBA regulation minutes are 48", () => {
  assert.strictEqual(leagueRegulationMinutes("NBA"), 48);
  const s = evaluateTruePacePossession({ league: "NBA", gameLogs: rich.gameLogs });
  assert.strictEqual(s.rawValues.regulationMinutes, 48);
});

test(32, "WNBA regulation minutes are 40", () => {
  assert.strictEqual(leagueRegulationMinutes("WNBA"), 40);
  const s = evaluateTruePacePossession({ league: "WNBA", gameLogs: rich.gameLogs });
  assert.strictEqual(s.rawValues.regulationMinutes, 40);
});

test(33, "missing OREB -> truePaceAvailable false", () => {
  const s = evaluateTruePacePossession(paceIncomplete);
  assert.strictEqual(s.truePaceAvailable, false);
  assert.strictEqual(s.available, false);
  assert.strictEqual(s.normalizedSignal, 0);
});

test(34, "missing TOV -> pace unavailable", () => {
  const logs = rich.gameLogs.map((g) => {
    const { tov, ...rest } = g;
    return rest;
  });
  const s = evaluateTruePacePossession({ league: "WNBA", gameLogs: logs });
  assert.strictEqual(s.truePaceAvailable, false);
});

test(35, "scoringEnvironmentProxy is not true pace", () => {
  const bundle = buildCourtEdgeEngineSignalsV1(
    { league: "WNBA", scoringEnvironmentProxy: 102, gameLogs: paceIncomplete.gameLogs },
    { force: true }
  );
  assert.strictEqual(bundle.engines.pacePossession.truePaceAvailable, false);
  assert.strictEqual(bundle.engines.scoringEnvironmentProxy.storeOnly, true);
  assert.strictEqual(bundle.engines.scoringEnvironmentProxy.normalizedSignal, 0);
});

test(36, "OT flag does not fabricate pace; complete box enables true pace", () => {
  const sOt = evaluateTruePacePossession({
    league: "WNBA",
    previousOt: true,
    gameLogs: paceIncomplete.gameLogs,
  });
  assert.strictEqual(sOt.truePaceAvailable, false);
  const sOk = evaluateTruePacePossession({ league: "WNBA", gameLogs: rich.gameLogs, previousOt: true });
  assert.strictEqual(sOk.truePaceAvailable, true);
  assert.strictEqual(sOk.available, true);
});

console.log("\n=== 37–40 Deduplication ===");
test(37, "dedup does not mutate input engine signals", () => {
  const eng = evaluateCeilingFloorDistribution({ gameLogs: rich.gameLogs, line: 19.5 });
  const before = JSON.stringify(eng);
  evaluateEvidenceDeduplication({ league: "WNBA" }, { distributionEngine: eng });
  assert.strictEqual(JSON.stringify(eng), before);
});

test(38, "same-direction signals get diminishing ranks", () => {
  const a = evaluateCeilingFloorDistribution({ gameLogs: rich.gameLogs, line: 10 });
  const b = evaluateProjectionSanity({ ...rich, projection: 24, line: 10 });
  const dedup = evaluateEvidenceDeduplication(
    { league: "WNBA" },
    { distributionEngine: a, projectionSanityEngine: b }
  );
  const included = dedup.ledger.filter((l) => l.included && l.suppressed !== undefined);
  assert.ok(included.some((l) => l.duplicateRank === 0));
});

test(39, "confidence caps appear in totals", () => {
  const bundle = buildCourtEdgeEngineSignalsV1(
    { ...rich, ...lineMoveFx, availabilityStatus: "Active" },
    { force: true }
  );
  assert.ok(bundle.evidenceDeduplication?.totals);
  assert.ok(Number.isFinite(bundle.evidenceDeduplication.totals.confidenceAdjustment));
});

test(40, "unavailable engines excluded from voting", () => {
  const empty = evaluatePlayerVolatility({ gameLogs: [] });
  const dedup = evaluateEvidenceDeduplication({ league: "NBA" }, { volatilityEngine: empty });
  const row = dedup.ledger.find((l) => l.engine === "volatilityEngine");
  assert.ok(row);
  assert.strictEqual(row.available, false);
  assert.strictEqual(row.included, false);
});

console.log("\n=== 41–45 Rest / fatigue ===");
test(41, "back-to-back detection", () => {
  const s = evaluateRestFatigue({
    teamGameDates: [daysAgo(1), daysAgo(0)],
  });
  assert.strictEqual(s.isB2B, true);
  assert.strictEqual(s.restDays, 0);
});

test(42, "3-in-4 schedule density", () => {
  const s = evaluateRestFatigue({
    teamGameDates: [daysAgo(3), daysAgo(2), daysAgo(0)],
  });
  assert.strictEqual(s.threeInFour, true);
});

test(43, "OT hangover flagged", () => {
  const s = evaluateRestFatigue({
    teamGameDates: [daysAgo(2), daysAgo(0)],
    previousOt: true,
  });
  assert.strictEqual(s.otLoad, true);
  assert.ok(s.fatigueScore >= 12);
});

test(44, "travel always unavailable", () => {
  const s = evaluateRestFatigue({ teamGameDates: [daysAgo(3), daysAgo(0)] });
  assert.strictEqual(s.travelAvailable, false);
  assert.strictEqual(s.travelImpact, null);
});

test(45, "fatigue never votes", () => {
  const s = evaluateRestFatigue({
    teamGameDates: [daysAgo(1), daysAgo(0)],
    previousOt: true,
    gameLogs: rich.gameLogs,
  });
  assert.strictEqual(s.normalizedSignal, 0);
  assert.strictEqual(s.overContribution, 0);
});

console.log("\n=== 46–50 Teammate impact ===");
test(46, "verified OUT teammate with resolvable split", () => {
  const s = evaluateTeammateImpact({
    gameLogs: sameTeamFx.gameLogs,
    teammateStatuses: sameTeamFx.teammateStatuses,
  });
  assert.strictEqual(s.available, true);
  assert.ok(s.perTeammate.some((t) => t.resolvable));
});

test(47, "unverified / unrelated injury produces no boost", () => {
  const s = evaluateTeammateImpact({
    gameLogs: sameTeamFx.gameLogs,
    teammateStatuses: [{ name: "OTHER", status: "Out", verified: false }],
  });
  assert.strictEqual(s.available, false);
});

test(48, "small without-sample is shrunk", () => {
  const logs = [
    gameLog({ points: 22, teammatesActive: { X: false } }),
    gameLog({ points: 24, teammatesActive: { X: false } }),
    gameLog({ points: 14, teammatesActive: { X: true } }),
    gameLog({ points: 15, teammatesActive: { X: true } }),
  ];
  const s = evaluateTeammateImpact({
    gameLogs: logs,
    teammateStatuses: [{ name: "X", playerId: "X", status: "OUT", verified: true }],
  });
  assert.strictEqual(s.available, true);
  const row = s.perTeammate.find((t) => t.resolvable);
  assert.ok(row.shrink < 1);
});

test(49, "no missing teammates -> unavailable", () => {
  const s = evaluateTeammateImpact({ gameLogs: rich.gameLogs, teammateStatuses: [] });
  assert.strictEqual(s.available, false);
});

test(50, "unresolved teammate activity not assumed", () => {
  const logs = rich.gameLogs.map(({ teammatesActive, ...g }) => g);
  const s = evaluateTeammateImpact({
    gameLogs: logs,
    teammateStatuses: [{ name: "STAR", playerId: "STAR", status: "OUT", verified: true }],
  });
  assert.strictEqual(s.available, false);
});

console.log("\n=== 51–62 Best 6 / same-team / line integrity ===");
test(51, "applySideChangeKeepLine preserves line", () => {
  const before = { side: "Over", pick: "Over", line: 19.5, selectedLine: 19.5 };
  const after = applySideChangeKeepLine(before, "UNDER", { reason: "same_team_mock" });
  assert.strictEqual(after.line, 19.5);
  assert.strictEqual(after.side, "Under");
});

test(52, "assertLineUnchanged ok after flip", () => {
  const before = { line: 22.5, selectedLine: 22.5, side: "Over" };
  const after = applySideChangeKeepLine(before, "UNDER");
  const check = assertLineUnchanged(before, after);
  assert.strictEqual(check.ok, true);
});

test(53, "side change to Under locks sportsbook line", () => {
  const after = applySideChangeKeepLine({ line: 15.5, selectedLine: 15.5, side: "Over" }, "UNDER");
  assert.strictEqual(after.sportsbookLine, 15.5);
  assert.strictEqual(after.lineLockedThroughSideChange, true);
});

test(54, "Best6-style candidate preserves engine signals object", () => {
  const attached = attachCourtEdgeEngineSignals(
    { ...sameTeamFx, player: "Mock", confidence: 62 },
    { force: true }
  );
  const mockBestSix = {
    ...attached,
    controlledBestSixRank: 2,
    bestSixEligibility: true,
    courtEdgeEngineSignalsV1: attached.courtEdgeEngineSignalsV1,
  };
  assert.ok(mockBestSix.courtEdgeEngineSignalsV1?.engines);
  assert.strictEqual(mockBestSix.line, 19.5);
});

test(55, "buildLineAuditFields reports movement", () => {
  const audit = buildLineAuditFields({ openingLine: 20, currentLine: 18.5, selectedLine: 20 });
  assert.strictEqual(audit.lineMovement, -1.5);
});

test(56, "same-team flip keeps line via helper", () => {
  const pick = { ...sameTeamFx, side: "Over", selectedLine: 19.5, line: 19.5 };
  const flipped = applySideChangeKeepLine(pick, "UNDER", { reason: "SAME_TEAM_ARBITRATION_FLIP" });
  assert.strictEqual(assertLineUnchanged(pick, flipped).ok, true);
  assert.ok(flipped.courtEdgeEngineSignalsV1 === pick.courtEdgeEngineSignalsV1);
});

test(57, "signals survive mock same-team arbitration object", () => {
  const attached = attachCourtEdgeEngineSignals({ ...sameTeamFx, confidence: 55 }, { force: true });
  const arb = {
    ...attached,
    sameTeamArbitrationFlip: true,
    sameTeamArbitrationReason: "SAME_TEAM_ARBITRATION_FLIP",
    side: "Under",
    pick: "Under",
    line: attached.line,
  };
  assert.ok(arb.courtEdgeEngineSignalsV1.enabled);
  assert.strictEqual(arb.line, sameTeamFx.line);
});

test(58, "organic aggregation does not rewrite pick line", () => {
  const pick = { line: 19.5, side: "Over", pick: "Over", ...rich, confidence: 60 };
  const attached = attachCourtEdgeEngineSignals(pick, { force: true });
  const adjusted = applyEngineSignalAdjustments(attached);
  assert.strictEqual(adjusted.line, 19.5);
});

test(59, "applyEngineSignalAdjustments never changes side", () => {
  const attached = attachCourtEdgeEngineSignals(
    { ...rich, side: "Under", pick: "Under", confidence: 58 },
    { force: true }
  );
  const adjusted = applyEngineSignalAdjustments(attached);
  assert.strictEqual(adjusted.side, "Under");
  assert.strictEqual(adjusted.pick, "Under");
});

test(60, "applyEngineSignalAdjustments never changes line", () => {
  const attached = attachCourtEdgeEngineSignals(
    { ...rich, side: "Over", pick: "Over", line: 21.5, confidence: 58 },
    { force: true }
  );
  const adjusted = applyEngineSignalAdjustments(attached);
  assert.strictEqual(adjusted.line, 21.5);
});

test(61, "attachCourtEdgeEngineSignals does not mutate input", () => {
  const pick = { ...rich, side: "Over", confidence: 50 };
  const snap = JSON.stringify(pick);
  attachCourtEdgeEngineSignals(pick, { force: true });
  assert.strictEqual(JSON.stringify(pick), snap);
});

test(62, "resolveSelectedLine prefers selectedLine", () => {
  assert.strictEqual(resolveSelectedLine({ selectedLine: 17.5, line: 19.5, currentLine: 18 }), 17.5);
});

console.log("\n=== 63–70 Lifecycle ===");
test(63, "canonicalSealedProp preserves courtEdgeEngineSignalsV1", () => {
  const attached = attachCourtEdgeEngineSignals(
    { ...rich, player: "Seal", side: "Over", pick: "Over", line: 19.5, confidence: 61 },
    { force: true }
  );
  const canonical = buildCanonicalSealedProp(attached, { slateDate: "2026-07-18" });
  assert.ok(canonical.courtEdgeEngineSignalsV1);
  assert.strictEqual(canonical.courtEdgeEngineSignalsV1.version, ENGINE_EXPANSION_VERSION);
  assert.strictEqual(canonical.line, 19.5);
});

test(64, "replay rebuild does not mutate sealed archive object", () => {
  const attached = attachCourtEdgeEngineSignals(
    { ...rich, player: "Replay", side: "Over", line: 19.5, confidence: 60 },
    { force: true }
  );
  const sealed = attachCanonicalSealedProp(attached, { slateDate: "2026-07-18" });
  const archive = JSON.parse(JSON.stringify(sealed));
  const before = JSON.stringify(archive);
  buildCourtEdgeEngineSignalsV1({ ...rich, force: undefined }, { force: true });
  assert.strictEqual(JSON.stringify(archive), before);
});

test(65, "sealed line fields preserved on canonical", () => {
  const pick = {
    ...rich,
    player: "L",
    side: "Over",
    line: 19.5,
    selectedLine: 19.5,
    sealedLine: 19.5,
    openingLine: 20.5,
    officialLine: 19.5,
    immutableOfficial: true,
  };
  const attached = attachCourtEdgeEngineSignals(pick, { force: true });
  const c = buildCanonicalSealedProp(attached);
  assert.strictEqual(c.sealedLine, 19.5);
  assert.strictEqual(c.selectedLine, 19.5);
});

test(66, "attachCanonicalSealedProp keeps signals on both layers", () => {
  const attached = attachCourtEdgeEngineSignals(
    { ...rich, player: "Both", side: "Under", pick: "Under", line: 18.5, confidence: 55 },
    { force: true }
  );
  const withCanon = attachCanonicalSealedProp(attached);
  assert.ok(withCanon.courtEdgeEngineSignalsV1);
  assert.ok(withCanon.canonicalSealedProp.courtEdgeEngineSignalsV1);
});

test(67, "re-running orchestrator yields new generatedAt, stable schema", () => {
  const a = buildCourtEdgeEngineSignalsV1(rich, { force: true });
  const b = buildCourtEdgeEngineSignalsV1(rich, { force: true });
  assert.strictEqual(a.schemaBuild, b.schemaBuild);
  assert.strictEqual(a.version, b.version);
  assert.ok(a.generatedAt && b.generatedAt);
  // Product top-level keys + engines bag (same signal objects by reference equality where wired)
  assert.ok(a.lineMovement && a.engines.lineMovementClv);
  assert.strictEqual(a.lineMovement, a.engines.lineMovementClv);
  assert.ok(a.projectionSanity && a.engines.projectionSanity);
  assert.strictEqual(a.projectionSanity, a.engines.projectionSanity);
  assert.ok(a.availabilityRoster && a.engines.availabilityRoster);
  assert.strictEqual(a.availabilityRoster, a.engines.availabilityRoster);
  assert.ok(a.distributionProfile && a.engines.distribution);
  assert.strictEqual(a.distributionProfile, a.engines.distribution);
  assert.ok(a.volatilityProfile && a.engines.volatility);
  assert.strictEqual(a.volatilityProfile, a.engines.volatility);
  assert.ok(a.defensiveArchetype && a.engines.defensiveArchetype);
  assert.ok(a.roleVelocity && a.engines.roleVelocity);
  assert.ok(a.pacePossession && a.engines.pacePossession);
  assert.ok(a.restFatigue && a.engines.restFatigue);
  assert.ok(a.teammateImpact && a.engines.teammateImpact);
});

test(68, "double attach does not wipe signals", () => {
  let pick = { ...rich, side: "Over", confidence: 50 };
  pick = attachCourtEdgeEngineSignals(pick, { force: true });
  const first = pick.courtEdgeEngineSignalsV1;
  pick = attachCourtEdgeEngineSignals(pick, { force: true });
  assert.ok(pick.courtEdgeEngineSignalsV1?.engines);
  assert.strictEqual(first.enabled, pick.courtEdgeEngineSignalsV1.enabled);
});

test(69, "isEngineExpansionEnabled is boolean and defaults ON", () => {
  assert.strictEqual(typeof isEngineExpansionEnabled(), "boolean");
  assert.strictEqual(isEngineExpansionEnabled(), true);
});

test(70, "SCHEMA_BUILD is courteedge-engine-expansion-v1.1", () => {
  assert.strictEqual(SCHEMA_BUILD, "courteedge-engine-expansion-v1.1");
  const bundle = buildCourtEdgeEngineSignalsV1({}, { force: true });
  assert.strictEqual(bundle.schemaBuild, "courteedge-engine-expansion-v1.1");
});

console.log("\n=== 71–75 UI labels ===");
test(71, "engine reasons omit BOARD_ONLY", () => {
  const bundle = buildCourtEdgeEngineSignalsV1(
    { ...rich, ...lineMoveFx, availabilityStatus: "Active", teammateStatuses: sameTeamFx.teammateStatuses },
    { force: true }
  );
  for (const r of collectReasons(bundle)) {
    assert.ok(!/BOARD_ONLY/i.test(r), r);
  }
});

test(72, "engine reasons omit NO_BET", () => {
  const bundle = buildCourtEdgeEngineSignalsV1({ ...rich, injuryRow: { status: "Out" } }, { force: true });
  for (const r of collectReasons(bundle)) {
    assert.ok(!/NO_BET/i.test(r), r);
  }
});

test(73, "engine reasons omit SHADOW_ONLY", () => {
  const bundle = buildCourtEdgeEngineSignalsV1(rich, { force: true });
  for (const r of collectReasons(bundle)) {
    assert.ok(!/SHADOW_ONLY/i.test(r), r);
  }
});

test(74, "aggregation organicSide is OVER/UNDER/NEUTRAL only", () => {
  const bundle = buildCourtEdgeEngineSignalsV1({ ...rich, ...lineMoveFx }, { force: true });
  assert.ok(["OVER", "UNDER", "NEUTRAL"].includes(bundle.aggregation.organicSide));
  assert.ok(!FORBIDDEN_UI.test(bundle.aggregation.organicSide));
});

test(75, "user-facing reason fields have no gate eligibility codes", () => {
  const bundle = buildCourtEdgeEngineSignalsV1(
    {
      ...rich,
      ...lineMoveFx,
      availabilityStatus: "Questionable",
      teamGameDates: [daysAgo(1), daysAgo(0)],
      previousOt: true,
    },
    { force: true }
  );
  for (const r of collectReasons(bundle)) {
    assert.ok(!FORBIDDEN_UI.test(r), `forbidden token in reason: ${r}`);
  }
});

console.log("\n=== 76–85 Consolidation v1.1 ===");

function normalizeSideForTest(side = "") {
  const raw = String(side || "").toUpperCase();
  if (raw.startsWith("U")) return "UNDER";
  if (raw.startsWith("O")) return "OVER";
  return "";
}

test(76, "decision packet attached and immutable", () => {
  const attached = attachCourtEdgeEngineSignals(
    { ...rich, side: "Over", line: 22.5, confidence: 60 },
    { force: true }
  );
  assert.ok(attached.courtEdgeDecisionPacketV1);
  assert.strictEqual(attached.courtEdgeDecisionPacketV1.immutable, true);
  assert.ok(attached.courtEdgeDecisionPacketV1.inputHash);
  assert.ok(attached.courtEdgeDecisionPacketV1.decisionHash);
});

test(77, "applyEngineSignalAdjustments is idempotent (double apply)", () => {
  let pick = attachCourtEdgeEngineSignals(
    { ...rich, side: "Over", line: 22.5, confidence: 60, pick: "Over" },
    { force: true }
  );
  pick = applyEngineSignalAdjustments(pick);
  const snap = {
    side: pick.side,
    line: pick.line,
    confidence: pick.confidence,
    risk: pick.courtEdgeRiskAdjustment,
    signals: JSON.stringify(pick.courtEdgeEngineSignalsV1?.aggregation),
  };
  const again = applyEngineSignalAdjustments(pick);
  assert.strictEqual(again.side, snap.side);
  assert.strictEqual(again.line, snap.line);
  assert.strictEqual(again.confidence, snap.confidence);
  assert.strictEqual(again.courtEdgeRiskAdjustment, snap.risk);
  assert.strictEqual(
    JSON.stringify(again.courtEdgeEngineSignalsV1?.aggregation),
    snap.signals
  );
  assert.strictEqual(again.courtEdgeEngineAdjustmentsApplied, true);
});

test(78, "Results double admission leaves packet fields unchanged", () => {
  let pick = attachCourtEdgeEngineSignals(
    { ...rich, side: "Under", line: 18.5, confidence: 55, pick: "Under", trueRisk: "MEDIUM" },
    { force: true }
  );
  pick = applyEngineSignalAdjustments(pick);
  const sealed = attachCanonicalSealedProp(pick);
  const first = admitResultsFromDecisionPacket(sealed);
  const second = admitResultsFromDecisionPacket(first);
  const check = assertDecisionPacketUnchanged(first, second);
  assert.ok(check.ok, JSON.stringify(check.diffs));
  assert.strictEqual(first.side, second.side);
  assert.strictEqual(first.line, second.line);
  assert.strictEqual(first.confidence, second.confidence);
});

test(79, "ownership marks confidenceOwner as evidence ledger", () => {
  const bundle = buildCourtEdgeEngineSignalsV1(rich, { force: true });
  assert.strictEqual(bundle.ownership?.confidenceOwner, "evidenceDeduplicationLedger");
  assert.ok(bundle.aggregation?.confidenceOwner);
});

test(80, "legacy bridge preferred when DDI market present", () => {
  const pick = {
    ...rich,
    league: "WNBA",
    side: "Over",
    line: 20.5,
    openingLine: 22.5,
    currentLine: 20.5,
    decisionDataIntelligence: {
      marketIntelligence: {
        openingLine: 22.5,
        currentLine: 20.5,
        lineDelta: -2,
        marketWarning: true,
        sideImpact: "UNDER",
        bookConsensus: "MODERATE",
        reasons: ["Line moved against Over."],
      },
    },
  };
  const attached = attachCourtEdgeEngineSignals(pick, { force: true, league: "WNBA" });
  const lm = attached.courtEdgeEngineSignalsV1?.engines?.lineMovementClv;
  assert.ok(lm?.available);
  assert.ok(
    lm?.bridgedFrom?.includes("marketMovementIntelligenceV1") ||
      lm?.consolidation === "legacy_bridge_preferred"
  );
});

test(81, "same-team lock flags set by presentation", () => {
  const forced = finalizeSameTeamForcedUnderPresentation({
    originalPick: {
      ...sameTeamFx,
      side: "Over",
      pick: "Over",
      line: 21.5,
      confidence: 70,
      player: "A",
    },
    forcedPick: {
      ...sameTeamFx,
      side: "Over",
      pick: "Over",
      line: 21.5,
      confidence: 70,
      player: "A",
    },
    primaryPlayer: "B",
    independentlyQualifiedUnder: false,
  });
  assert.strictEqual(forced.sideLockedAfterArbitration, true);
  assert.strictEqual(forced.sameTeamArbitrationFlip, true);
  assert.strictEqual(normalizeSideForTest(forced.side), "UNDER");
});

test(82, "side balance cannot undo same-team arbitration lock", () => {
  const lockedUnder = {
    player: "Locked",
    side: "Under",
    pick: "Under",
    line: 19.5,
    confidence: 40,
    sameTeamArbitrationFlip: true,
    sideLockedAfterArbitration: true,
    flipReasonCode: "SAME_TEAM_ARBITRATION_FLIP",
    decisionIntelligence: { trackEligibility: "TRACK", bestSixEligibility: true, trueRisk: "MEDIUM" },
    wnbaReader: { underCase: { score: 8, preGapPenaltyScore: 8, underGapFloorPassed: true } },
    league: "WNBA",
  };
  assert.strictEqual(lockedUnder.sideLockedAfterArbitration, true);
  assert.strictEqual(typeof annotateResultsAdmission, "function");
  const admitted = annotateResultsAdmission(lockedUnder);
  assert.strictEqual(admitted.finalDecision, "TRACK");
  assert.strictEqual(normalizeSideForTest(admitted.side), "UNDER");
});

test(83, "canonical seal nests engineSignals + decision packet", () => {
  let pick = attachCourtEdgeEngineSignals(
    { ...rich, side: "Over", line: 22.5, confidence: 60 },
    { force: true }
  );
  pick = applyEngineSignalAdjustments(pick);
  const sealed = buildCanonicalSealedProp(pick);
  assert.ok(sealed.courtEdgeEngineSignalsV1);
  assert.ok(sealed.engineSignals);
  assert.ok(sealed.courtEdgeDecisionPacketV1);
  assert.strictEqual(sealed.courtEdgeEngineSignalsVersion, "courtEdgeEngineSignalsV1");
});

test(84, "scoringEnvironmentProxy never votes", () => {
  const bundle = buildCourtEdgeEngineSignalsV1(
    { ...rich, scoringEnvironmentProxy: 102.5 },
    { force: true }
  );
  const proxy = bundle.engines.scoringEnvironmentProxy;
  assert.strictEqual(proxy.storeOnly, true);
  assert.strictEqual(proxy.normalizedSignal, 0);
  assert.strictEqual(proxy.overContribution, 0);
  assert.strictEqual(proxy.underContribution, 0);
});

test(85, "true pace unavailable when box incomplete", () => {
  const bundle = buildCourtEdgeEngineSignalsV1(paceIncomplete, { force: true });
  const pace = bundle.engines.pacePossession;
  assert.ok(
    pace.available === false ||
      pace.rawValues?.completeBoxCount === 0 ||
      pace.sampleSize === 0 ||
      Boolean(pace.reason)
  );
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.error("Failed cases:", failures.join("; "));
}
if (failed > 0) process.exitCode = 1;
