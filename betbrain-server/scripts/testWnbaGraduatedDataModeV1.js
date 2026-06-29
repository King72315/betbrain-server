/**
 * WNBA graduated data mode v1 tests.
 * Usage: node betbrain-server/scripts/testWnbaGraduatedDataModeV1.js
 */
import assert from "assert";
import {
  resolveWnbaGraduatedDataMode,
  collectWnbaDataCoverageDebts,
  pickPrimaryDebtExplanation,
  WNBA_GRADUATED_DATA_MODE_VERSION,
} from "../engines/wnba/wnbaGraduatedDataModeV1.js";

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err.message || err);
    process.exitCode = 1;
  }
}

test("version exported", () => {
  assert.strictEqual(WNBA_GRADUATED_DATA_MODE_VERSION, "wnba-graduated-data-mode-v1");
});

test("complete core coverage → WNBA_FULL_DATA", () => {
  const mode = resolveWnbaGraduatedDataMode({
    league: "WNBA",
    playerId: "574",
    last5Count: 5,
    seasonPoints: 14,
    recentMinutes: 26,
    seasonMinutes: 25,
    recentFGA: 10,
    seasonFGA: 9,
    bookCount: 4,
    projection: 15,
  });
  assert.strictEqual(mode, "WNBA_FULL_DATA");
});

test("missing last5 → WNBA_LIMITED_DATA + MISSING_LAST5 debt", () => {
  const flags = [
    { key: "playerId", missing: false },
    { key: "seasonStats", missing: false },
    { key: "last5", missing: true, note: "Only 1 recent games" },
    { key: "minutes", missing: false },
    { key: "fga", missing: false },
    { key: "market", missing: false },
  ];
  const mode = resolveWnbaGraduatedDataMode({ league: "WNBA", dataMissingFlags: flags });
  assert.strictEqual(mode, "WNBA_LIMITED_DATA");
  const debts = collectWnbaDataCoverageDebts(
    { dataMissingFlags: flags.filter((f) => f.missing) },
    {}
  );
  assert.ok(debts.some((d) => d.code === "MISSING_LAST5"));
  assert.ok(!pickPrimaryDebtExplanation(debts).includes("wnba limited"));
});

test("NBA league returns NBA_FULL_DATA", () => {
  assert.strictEqual(resolveWnbaGraduatedDataMode({ league: "NBA" }), "NBA_FULL_DATA");
});

if (process.exitCode) {
  console.log("\nGraduated data mode tests failed");
} else {
  console.log("\nGraduated data mode tests passed");
}
