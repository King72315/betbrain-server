/**
 * WNBA graduated data mode v1 tests.
 * Usage: node betbrain-server/scripts/testWnbaGraduatedDataModeV1.js
 */
import assert from "assert";
import {
  resolveWnbaGraduatedDataMode,
  collectWnbaDataCoverageDebts,
  pickPrimaryDebtExplanation,
  resolveWnbaGapFloors,
  WNBA_GRADUATED_DATA_MODE_VERSION,
} from "../engines/wnba/wnbaGraduatedDataModeV1.js";
import { syncWnbaDataModeOnPick } from "../engines/wnba/wnbaGateInputs.js";

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

test("live FULL_DATA stable Over gap floor stays 4.0", () => {
  const floors = resolveWnbaGapFloors({
    side: "OVER",
    dataMode: "WNBA_FULL_DATA",
    volatility: "stable",
  });
  assert.strictEqual(floors.gapFloor, 4);
  assert.strictEqual(floors.scenario, "live");
  assert.strictEqual(floors.retroFullDataStableFloor, 3.5);
});

test("retro FULL_DATA stable Over gap floor is 3.5", () => {
  const floors = resolveWnbaGapFloors(
    {
      side: "OVER",
      dataMode: "WNBA_FULL_DATA",
      volatility: "stable",
    },
    { scenario: "retro_full_data_stable" }
  );
  assert.strictEqual(floors.gapFloor, 3.5);
  assert.strictEqual(floors.reasonCode, "OVER_GAP_BELOW_WNBA_FULL_DATA_FLOOR");
});

test("LIMITED_DATA Over gap floor stays 4.0", () => {
  const floors = resolveWnbaGapFloors({
    side: "OVER",
    dataMode: "WNBA_LIMITED_DATA",
    volatility: "stable",
  });
  assert.strictEqual(floors.gapFloor, 4);
});

test("UNDER explanation skips Over-only debts", () => {
  const debts = [
    { code: "LOW_VOLUME_OVER_TRAP", severity: "KILL", reason: "low volume over trap flagged by danger gate." },
    { code: "THIN_EDGE", severity: "HIGH", reason: "Projection edge (3.2) is thin for WNBA UNDER." },
  ];
  const text = pickPrimaryDebtExplanation(debts, { side: "UNDER" });
  assert.ok(!text.includes("low volume over trap"));
  assert.ok(text.includes("thin"));
});

test("syncWnbaDataModeOnPick propagates card FULL to pick", () => {
  const synced = syncWnbaDataModeOnPick(
    {
      dataMode: "WNBA_LIMITED_DATA",
      playerState: { dataMode: "WNBA_LIMITED_DATA" },
      volumeProfile: { dataMode: "WNBA_LIMITED_DATA", wnbaLimitedData: true },
    },
    {
      dataMode: "WNBA_FULL_DATA",
      dataMissingFlags: [],
      dataAvailabilityFlags: {
        hasLast5: true,
        hasSeasonStats: true,
        hasSeasonMinutes: true,
        hasSeasonFGA: true,
        hasMarketData: true,
        league: "WNBA",
      },
      playerId: "67109",
      last5: { games: 5, points: 15, minutes: 28, fga: 10 },
      season: { points: 13, minutes: 28, fga: 10 },
      bookCount: 4,
      projection: { projection: 17 },
    }
  );
  assert.strictEqual(synced.dataMode, "WNBA_FULL_DATA");
  assert.strictEqual(synced.playerState.dataMode, "WNBA_FULL_DATA");
  assert.strictEqual(synced.volumeProfile.wnbaLimitedData, false);
});

if (process.exitCode) {
  console.log("\nGraduated data mode tests failed");
} else {
  console.log("\nGraduated data mode tests passed");
}
