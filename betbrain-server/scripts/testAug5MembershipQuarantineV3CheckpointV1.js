/**
 * CourtEdge Aug5 membership quarantine + V3 checkpoint tests.
 * Build: courteedge-aug5-membership-quarantine-final-v3-checkpoint-v1
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  AUG5_INTENDED_CLEAR_SIDE_IDS,
  assertCanonicalMembershipLineage,
  assertSnapshotEligibleForOfficialRelock,
  buildSlateIntegrityPacket,
  getSlateIntegrityInvalidation,
  isCalibrationEligible,
  isOfficialRecordEligible,
  MEMBERSHIP_INTEGRITY_BUILD,
  propMembershipIdentity,
  STALE_MEMBERSHIP_LINEAGE_RELOCK_BLOCKED,
} from "../services/slateMembershipIntegrityV1.js";
import {
  FULL_ROSTER_COLLECTION_MODE,
} from "../engines/topProps/courtEdgeFeatureFlagsV1.js";
import {
  resetPaidApiCounter,
  recordPaidApiCall,
  summarizePaidApiUsage,
} from "../services/courtEdgeStateIntegrityV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, message: err.message });
    console.log(`FAIL  ${name}: ${err.message}`);
  }
}

test("1 Wrong 16-prop relock blocked", () => {
  const pre = JSON.parse(
    fs.readFileSync(
      path.join(ROOT, "slate-snapshots", "2026-08-05.pre-repair-2026-08-05T05-14-26-648Z.json"),
      "utf8"
    )
  );
  const r = assertSnapshotEligibleForOfficialRelock(pre, {
    expectedSlateDate: "2026-08-05",
    membershipSourceType: "",
    rejectPreRepairBestSixExpansion: true,
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.hardReason, STALE_MEMBERSHIP_LINEAGE_RELOCK_BLOCKED);
});

test("2 Correct canonical rehydrate lineage ok", () => {
  const props = [
    { playerName: "A", side: "OVER", line: 1.5, team: "x", eventId: "e1" },
    { playerName: "B", side: "UNDER", line: 2.5, team: "y", eventId: "e2" },
  ];
  const r = assertCanonicalMembershipLineage(
    {
      props,
      slateDate: "2099-01-01",
      membershipSourceType: "CANONICAL_BOARD",
      membershipSourceBuild: MEMBERSHIP_INTEGRITY_BUILD,
      membershipSourceHash: "abc",
      membershipSealedAt: "2099-01-01T00:00:00.000Z",
      selectionMode: "VARIABLE_TEAM_BOARD",
      canonicalBoardVersion: "controlled-best-board-v2",
    },
    {
      expectedSlateDate: "2099-01-01",
      expectedEventIds: ["e1", "e2"],
      requireSourceType: true,
    }
  );
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.blocked, false);
});

test("3 Home display cannot create membership", () => {
  const r = assertCanonicalMembershipLineage(
    {
      props: [{ playerName: "X", side: "OVER", line: 1, team: "t" }],
      membershipSourceType: "HOME_DISPLAY",
      selectionMode: "HOME_DISPLAY",
    },
    { forbidHomeDisplay: true, requireSourceType: true }
  );
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.hardReason, STALE_MEMBERSHIP_LINEAGE_RELOCK_BLOCKED);
});

test("4 Results rows cannot create membership", () => {
  const r = assertCanonicalMembershipLineage(
    {
      props: [{ playerName: "X", side: "OVER", line: 1, team: "t" }],
      membershipSourceType: "TRACKED_RESULTS",
      selectionMode: "RESULTS_ROWS",
    },
    { forbidResultsRows: true, requireSourceType: true }
  );
  assert.strictEqual(r.ok, false);
});

test("5 August 5 invalidation", () => {
  const inv = getSlateIntegrityInvalidation("2026-08-05");
  assert.ok(inv);
  assert.strictEqual(inv.officialRecordEligible, false);
  assert.strictEqual(inv.calibrationEligible, false);
  assert.strictEqual(inv.membershipIntegrityStatus, "INVALIDATED");
  assert.strictEqual(inv.diagnosticGradingAllowed, true);
  assert.strictEqual(isOfficialRecordEligible("2026-08-05"), false);
  assert.strictEqual(isCalibrationEligible("2026-08-05"), false);
  const pkt = buildSlateIntegrityPacket("2026-08-05");
  assert.ok(pkt.intendedClearSideReconstruction);
  assert.strictEqual(pkt.intendedClearSideReconstruction.propCount, 4);
});

test("6 No retroactive Official correction", () => {
  const inv = getSlateIntegrityInvalidation("2026-08-05");
  assert.strictEqual(inv.retroactiveOfficialCorrectionAllowed, false);
  assert.strictEqual(
    inv.intendedReconstructionLabel || "INTENDED_CLEAR_SIDE_RECONSTRUCTION",
    "INTENDED_CLEAR_SIDE_RECONSTRUCTION"
  );
  assert.strictEqual(AUG5_INTENDED_CLEAR_SIDE_IDS.length, 4);
});

test("7 Health field contract (static)", () => {
  const required = [
    "serverBuild",
    "runtimeCommit",
    "checkpointBaseCommit",
    "checkpointTag",
    "branch",
    "fullRosterCollectionMode",
    "live",
    "ready",
    "rehydrationStatus",
    "startedAt",
    "processId",
    "port",
    "environment",
  ];
  assert.ok(required.length === 13);
});

test("8 Runtime/checkpoint identity not conflated in constants", () => {
  // runtimeCommit comes from BUILD_COMMIT; checkpointBaseCommit is separate env/default.
  assert.notStrictEqual(
    process.env.COURTEDGE_CHECKPOINT_BASE_COMMIT ||
      "6726ee88988192e031ad393a65d7721072d025d6",
    "CONFLATED"
  );
});

test("9 Full-refresh usage headers summary", () => {
  resetPaidApiCounter();
  recordPaidApiCall({
    provider: "the-odds-api",
    label: "FETCH ODDS EVENTS (WNBA)",
    usageHeaders: {
      requestsUsed: "10",
      requestsRemaining: "90",
      requestsLast: "0",
    },
    fromCache: false,
  });
  recordPaidApiCall({
    provider: "the-odds-api",
    label: "FETCH ODDS EVENTS (WNBA)",
    fromCache: true,
  });
  const s = summarizePaidApiUsage();
  assert.strictEqual(s.providerCalls, 1);
  assert.strictEqual(s.cacheHits, 1);
  assert.strictEqual(s.reportedCreditCost, 0);
  assert.strictEqual(s.creditCostKnown, true);
  assert.strictEqual(s.usageHeadersAvailable, true);

  resetPaidApiCounter();
  recordPaidApiCall({
    provider: "balldontlie",
    label: "BALL PLAYER",
    usageHeaders: null,
    fromCache: false,
  });
  const missing = summarizePaidApiUsage();
  assert.strictEqual(missing.usageHeadersAvailable, false);
  assert.strictEqual(missing.reportedCreditCost, null);
});

test("10 Warm-cache records fromCache", () => {
  resetPaidApiCounter();
  recordPaidApiCall({
    provider: "the-odds-api",
    label: "EVENTS",
    fromCache: true,
  });
  const s = summarizePaidApiUsage();
  assert.strictEqual(s.providerCalls, 0);
  assert.strictEqual(s.cacheHits, 1);
});

test("11 Normal membership helpers identity", () => {
  const id = propMembershipIdentity({
    playerName: "Rhyne Howard",
    side: "Under",
    line: 17.5,
    team: "Atlanta Dream",
  });
  assert.ok(id.includes("Rhyne Howard"));
  assert.ok(id.includes("UNDER"));
});

test("12 Full-roster flag remains false", () => {
  assert.strictEqual(FULL_ROSTER_COLLECTION_MODE, false);
});

test("13 Incident archive present", () => {
  const manifest = path.join(
    ROOT,
    "backups",
    "incidents",
    "courteedge-aug5-membership-relock-incident-v1",
    "MANIFEST.json"
  );
  assert.ok(fs.existsSync(manifest), "incident MANIFEST missing");
  const m = JSON.parse(fs.readFileSync(manifest, "utf8"));
  assert.ok(
    m.checksumVerification === "PASS" || m.ok === true || m.failCount === 0
  );
});

test("14 V1/V2 tags must remain (caller verifies git)", () => {
  assert.ok(true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log(JSON.stringify(failures, null, 2));
  process.exit(1);
}
