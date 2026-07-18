/**
 * Line integrity: side may change; line must not.
 * Usage: node scripts/testLineIntegrityV1.js
 */
import assert from "node:assert/strict";
import {
  applySideChangeKeepLine,
  assertLineUnchanged,
  buildLineAuditFields,
  resolveSelectedLine,
} from "../services/lineIntegrityV1.js";
import { finalizeSameTeamForcedUnderPresentation } from "../engines/wnba/playerIntelligence/sameTeamForcedSidePresentationV1.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

test("resolveSelectedLine prefers selected/official over current", () => {
  assert.equal(
    resolveSelectedLine({ selectedLine: 17.5, currentLine: 16.5, line: 16.5 }),
    17.5
  );
});

test("applySideChangeKeepLine locks 17.5 when forcing Under", () => {
  const before = {
    player: "Olivia Miles",
    side: "Over",
    line: 17.5,
    sportsbookLine: 17.5,
    selectedLine: 17.5,
    currentLine: 16.5,
  };
  const after = applySideChangeKeepLine(before, "UNDER", {
    reason: "SAME_TEAM_ARBITRATION_FLIP",
  });
  assert.equal(after.line, 17.5);
  assert.equal(after.selectedLine, 17.5);
  assert.equal(String(after.side).toLowerCase(), "under");
  assert.equal(after.lineLockedThroughSideChange, true);
  assert.equal(assertLineUnchanged(before, after).ok, true);
});

test("buildLineAuditFields separates opening/current/sealed", () => {
  const fields = buildLineAuditFields({
    openingLine: 17.5,
    selectedLine: 17.5,
    sealedLine: 17.5,
    currentLine: 16.5,
    immutableOfficial: true,
    officialSealedAt: "2026-07-17T12:00:00.000Z",
  });
  assert.equal(fields.openingLine, 17.5);
  assert.equal(fields.selectedLine, 17.5);
  assert.equal(fields.sealedLine, 17.5);
  assert.equal(fields.currentLine, 16.5);
  assert.equal(fields.lineMovement, -1);
});

test("forced presentation prefers original 17.5 over alternate 16.5", () => {
  const original = {
    player: "Olivia Miles",
    side: "Over",
    line: 17.5,
    sportsbookLine: 17.5,
    selectedLine: 17.5,
    confidence: 68,
    projection: 21,
    wnbaReader: { overCase: { score: 22 }, underCase: { score: 5 } },
  };
  const forced = finalizeSameTeamForcedUnderPresentation({
    originalPick: original,
    forcedPick: {
      ...original,
      side: "Under",
      line: 16.5,
      sportsbookLine: 16.5,
      currentLine: 16.5,
    },
    primaryPlayer: "Kayla McBride",
  });
  assert.equal(forced.line, 17.5);
  assert.equal(forced.selectedLine, 17.5);
  assert.equal(forced.originalModelSide, "OVER");
  assert.equal(forced.finalCourtEdgeSide, "UNDER");
});

test("sealed line fields remain present after audit rebuild", () => {
  const sealed = buildLineAuditFields({
    line: 16.5,
    sealedLine: 16.5,
    officialLine: 16.5,
    immutableOfficial: true,
    sealedAt: "2026-07-17T18:00:00.000Z",
    openingLine: 16.5,
    currentLine: 15.5,
  });
  assert.equal(sealed.sealedLine, 16.5);
  assert.equal(sealed.officialLine, 16.5);
  // Refresh may move currentLine; sealed stays.
  const refreshed = buildLineAuditFields({
    ...sealed,
    currentLine: 15.5,
    line: sealed.sealedLine,
    selectedLine: sealed.sealedLine,
  });
  assert.equal(refreshed.sealedLine, 16.5);
  assert.equal(refreshed.currentLine, 15.5);
});

console.log("\nAll line integrity V1 tests passed.");
