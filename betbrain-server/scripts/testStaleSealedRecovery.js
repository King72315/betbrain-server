/**
 * Unit tests for stale sealed-slate recovery helpers (in-memory fixtures only).
 * Does NOT write tracked-props or call recover apply against real stores.
 *
 * Usage: node scripts/testStaleSealedRecovery.js
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  listStaleSealedUnresolvedSlateDates,
  stampResolveAttempt,
  buildStaleSealedLifecycleDiagnostics,
  recoverStaleSealedSlates,
} from "../services/staleSealedRecoveryService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FIXTURE_PATH = path.join(__dirname, "..", "fixtures", "stale-sealed-2026-07-17.json");

const FIXED_NOW = new Date("2026-07-18T12:00:00Z");
const TODAY = "2026-07-18";
const SLATE = "2026-07-17";

function loadFixtureProps() {
  const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
  const props = (raw.props || []).map((p) => ({ ...p }));
  assert.strictEqual(props.length, 6, "fixture must have 6 sealed props");
  for (const p of props) {
    assert.ok(p.commenceTime, p.player + " missing commenceTime");
    assert.ok(
      new Date(p.commenceTime).getTime() < FIXED_NOW.getTime(),
      p.player + " commenceTime must be before fixed now"
    );
    assert.strictEqual(p.status, null);
    assert.strictEqual(p.lastResolveAttempt, null);
    assert.strictEqual(p.immutableOfficial, true);
  }
  return props;
}

async function main() {
  const trackedProps = loadFixtureProps();

  const discovered = listStaleSealedUnresolvedSlateDates({
    todayLocalDate: TODAY,
    trackedProps,
    lockedSlates: [
      {
        slateDate: SLATE,
        phase: "ACTIVE",
        immutableOfficial: true,
        propCount: 6,
      },
    ],
    reports: [],
  });

  const dates = discovered.map((d) => d.slateDate);
  assert.ok(
    dates.includes(SLATE),
    "expected discovery to find " + SLATE + ", got " + JSON.stringify(dates)
  );
  console.log(
    "PASS discovery finds",
    SLATE,
    "pending=",
    discovered.find((d) => d.slateDate === SLATE)?.pendingCount
  );

  const stamped = stampResolveAttempt(trackedProps[0], {
    at: FIXED_NOW.toISOString(),
    error: "test_stamp",
    provider: "fixture",
  });
  assert.ok(stamped.lastResolveAttempt, "lastResolveAttempt must be set");
  assert.strictEqual(stamped.lastResolveAttempt, FIXED_NOW.toISOString());
  assert.strictEqual(stamped.player, trackedProps[0].player);
  console.log("PASS stampResolveAttempt sets lastResolveAttempt");

  const diag = buildStaleSealedLifecycleDiagnostics({
    todayLocalDate: TODAY,
    trackedProps,
    lockedSlates: [
      { slateDate: SLATE, phase: "ACTIVE", immutableOfficial: true, propCount: 6 },
    ],
    reports: [],
  });
  assert.strictEqual(
    diag.warning,
    "SEALED_SLATE_ZERO_RESOLVE_ATTEMPTS",
    "expected SEALED_SLATE_ZERO_RESOLVE_ATTEMPTS, got " + diag.warning
  );
  console.log("PASS diagnostics warning SEALED_SLATE_ZERO_RESOLVE_ATTEMPTS");

  const plan = await recoverStaleSealedSlates({
    slateDate: SLATE,
    todayLocalDate: TODAY,
    trackedProps,
    lockedSlates: [
      { slateDate: SLATE, phase: "ACTIVE", immutableOfficial: true, propCount: 6 },
    ],
    reports: [],
    dryRun: true,
    apply: false,
    now: FIXED_NOW,
  });
  assert.strictEqual(plan.membershipPreserved, true);
  assert.ok(plan.dryRun !== false);
  assert.notStrictEqual(plan.apply, true);
  console.log("PASS recoverStaleSealedSlates dry-run membershipPreserved=true", {
    discoveredCount: plan.discoveredCount,
    actions: plan.actions?.map((a) => a.type),
  });

  console.log("\nAll stale-sealed recovery tests passed.");
}

main().catch((err) => {
  console.error("FAIL", err);
  process.exit(1);
});
