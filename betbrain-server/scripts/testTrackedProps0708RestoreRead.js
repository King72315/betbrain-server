/**
 * Regression: restored 2026-07-08 Results cohort + legacy June rows must not 500
 * on GET /tracked-props or GET /diagnostics read paths.
 *
 * Uses active-bundles/2026-07-08 (5 props) + June 14/15 legacy rows (19 props).
 *
 * Usage: node betbrain-server/scripts/testTrackedProps0708RestoreRead.js
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  classifyTrackedPropsByLifecycle,
  buildTrackedPropsLifecycleDiagnostics,
} from "../services/slateLifecycleService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const SLATE_0708 = "2026-07-08";
const TODAY = "2026-07-10";
const EXPECTED_TOTAL = 24;
const EXPECTED_0708 = 5;
const EXPECTED_LEGACY = 19;

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

function asTrackedPropsArray(stored) {
  if (Array.isArray(stored)) return stored;
  if (Array.isArray(stored?.props)) return stored.props;
  return [];
}

function loadJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8"));
}

function buildRestoreFixture() {
  const bundle0708 = asTrackedPropsArray(
    loadJson("active-bundles/2026-07-08/tracked-props.json")
  );
  const legacyAll = asTrackedPropsArray(
    loadJson(
      "safe-backups/pre-0622-v1-reslate-2026-06-22T08-15-56-917Z/tracked-props.json"
    )
  );
  const legacyJune = legacyAll.filter((prop) =>
    ["2026-06-14", "2026-06-15"].includes(String(prop.slateDate || ""))
  );
  const lockedEntry = loadJson("active-bundles/2026-07-08/locked-slate-entry.json");

  assert.equal(bundle0708.length, EXPECTED_0708, "0708 bundle prop count");
  assert.equal(legacyJune.length, EXPECTED_LEGACY, "legacy June prop count");

  return {
    combined: [...legacyJune, ...bundle0708],
    lockedEntry,
    bundle0708,
  };
}

function simulateTrackedPropsResponse(trackedProps, { includeLegacy = false } = {}) {
  const lockedSlates = [buildRestoreFixture().lockedEntry];
  const classification = classifyTrackedPropsByLifecycle(trackedProps, {
    reports: [],
    archives: [],
    lockedSlates,
    quarantinedSlates: [],
    today: TODAY,
  });

  const sourceProps = includeLegacy
    ? asTrackedPropsArray(trackedProps)
    : classification.activeResultsProps;

  return {
    ok: true,
    props: sourceProps,
    count: sourceProps.length,
    trackedStoreTotalCount: classification.trackedStoreTotalCount,
    activeResultsTrackedCount: classification.activeResultsTrackedCount,
    activeResultsSlateDate: classification.activeResultsSlateDate,
    lifecycle: includeLegacy
      ? {
          trackedCountsBySlateDate: classification.trackedCountsBySlateDate,
        }
      : undefined,
  };
}

function simulateDiagnosticsResponse(trackedProps) {
  const lockedEntry = buildRestoreFixture().lockedEntry;
  const classification = classifyTrackedPropsByLifecycle(trackedProps, {
    reports: [],
    archives: [],
    lockedSlates: [lockedEntry],
    quarantinedSlates: [],
    today: TODAY,
  });
  const trackedPropsLifecycle = buildTrackedPropsLifecycleDiagnostics(classification);

  return {
    ok: true,
    lockedSlates: [lockedEntry],
    ...trackedPropsLifecycle,
  };
}

console.log("\n0708 restore read regression tests\n");

test("fixture combines 19 legacy June + 5 restored 07/08 props", () => {
  const { combined } = buildRestoreFixture();
  assert.equal(combined.length, EXPECTED_TOTAL);
});

test("GET /tracked-props default returns five 07/08 active results props", () => {
  const { combined } = buildRestoreFixture();
  const response = simulateTrackedPropsResponse(combined);
  assert.equal(response.count, EXPECTED_0708);
  assert.equal(response.activeResultsSlateDate, SLATE_0708);
  assert.ok(
    response.props.every((prop) => String(prop.slateDate) === SLATE_0708),
    "all default props are 07/08"
  );
});

test("GET /tracked-props?includeLegacy=true returns 24 stored props without crash", () => {
  const { combined } = buildRestoreFixture();
  const response = simulateTrackedPropsResponse({ props: combined }, { includeLegacy: true });
  assert.equal(response.count, EXPECTED_TOTAL);
  assert.equal(response.trackedStoreTotalCount, EXPECTED_TOTAL);
  assert.equal(response.lifecycle.trackedCountsBySlateDate[SLATE_0708], EXPECTED_0708);
});

test("envelope-shaped tracked store ({ props: [...] }) classifies without crash", () => {
  const { combined, lockedEntry } = buildRestoreFixture();
  assert.doesNotThrow(() =>
    classifyTrackedPropsByLifecycle(
      { props: combined },
      {
        reports: [],
        archives: [],
        lockedSlates: [lockedEntry],
        today: TODAY,
      }
    )
  );
});

test("GET /diagnostics reports 07/08 tracked count = 5 and store total = 24", () => {
  const { combined } = buildRestoreFixture();
  const response = simulateDiagnosticsResponse(combined);
  assert.equal(response.trackedStoreTotalCount, EXPECTED_TOTAL);
  assert.equal(response.activeResultsTrackedCount, EXPECTED_0708);
  assert.equal(response.trackedCountsBySlateDate[SLATE_0708], EXPECTED_0708);
  assert.equal(response.activeResultsSlateDate, SLATE_0708);
});

test("locked slate 07/08 remains ACTIVE with propCount 5", () => {
  const { lockedEntry } = buildRestoreFixture();
  assert.equal(lockedEntry.slateDate, SLATE_0708);
  assert.equal(lockedEntry.phase, "ACTIVE");
  assert.equal(lockedEntry.propCount, EXPECTED_0708);
});

console.log(`\nResults: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
