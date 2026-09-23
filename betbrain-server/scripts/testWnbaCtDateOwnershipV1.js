import assert from "node:assert/strict";
import test from "node:test";
import { wnbaEventOwnedBySlate } from "../services/wnbaWinnerSlateBuilderC.js";

test("11:00 PM CT tip stays on the Chicago date when ESPN buckets the next day", () => {
  const tip = "2026-09-27T04:00:00.000Z";
  assert.equal(wnbaEventOwnedBySlate(tip, "2026-09-26"), true);
  assert.equal(wnbaEventOwnedBySlate(tip, "2026-09-27"), false);
});

test("7:00 PM CT tip is not moved to the next Chicago date", () => {
  const tip = "2026-09-24T00:00:00.000Z";
  assert.equal(wnbaEventOwnedBySlate(tip, "2026-09-23"), true);
  assert.equal(wnbaEventOwnedBySlate(tip, "2026-09-24"), false);
});
