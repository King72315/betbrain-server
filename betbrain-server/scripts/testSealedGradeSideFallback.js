/**
 * Prove sealed grading uses lockedSide when currentEngineSide is missing.
 * Usage: node scripts/testSealedGradeSideFallback.js
 */
import assert from "node:assert/strict";
import { gradePointsPick } from "../services/resultService.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err) {
    console.error(`FAIL: ${name}`);
    throw err;
  }
}

test("gradePointsPick uses lockedSide when side overwritten undefined", () => {
  const graded = gradePointsPick(
    {
      player: "Nneka Ogwumike",
      lockedSide: "OVER",
      side: undefined,
      pick: undefined,
      officialLine: 16.5,
      line: 16.5,
    },
    { points: 20, date: "2026-07-17" }
  );
  assert.equal(graded.status, "win");
  assert.equal(graded.actualPoints, 20);
  assert.equal(graded.pendingReason, null);
});

test("Under lockedSide grades correctly", () => {
  const graded = gradePointsPick(
    {
      player: "Naz Hillmon",
      lockedSide: "UNDER",
      officialLine: 9.5,
    },
    { points: 6, date: "2026-07-17" }
  );
  assert.equal(graded.status, "win");
});

console.log("\nAll sealed grade side fallback tests passed.");
