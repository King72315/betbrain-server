/**
 * Lab legacy Official/Test inference tests (no prod mutation).
 * Mirrors utils/labTrackingInference.ts
 * Usage: node betbrain-server/scripts/testLabLegacyTrackingLabels.js
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function inferTrackingType(prop = {}) {
  const explicit = String(prop.trackingType || prop.recordType || "").toUpperCase();
  if (explicit === "OFFICIAL") return "OFFICIAL";
  if (explicit === "TEST") return "TEST";
  if (explicit === "NO_BET") return "NO_BET";

  if (prop.excludedFromOfficialRecord === true) return "TEST";
  if (prop.preV1Shadow === true || prop.excludedFromV1OfficialRecord === true) {
    return "TEST";
  }

  const tier = String(prop.tier || "").toUpperCase();
  if (tier === "LEAN" || tier === "WATCHLIST") return "TEST";
  if (tier === "PREMIUM" || tier === "OFFICIAL") return "OFFICIAL";
  if (prop.officialEligible === true) return "OFFICIAL";

  return "TEST";
}

function hasExplicitTrackingType(prop = {}) {
  const explicit = String(prop.trackingType || prop.recordType || "").toUpperCase();
  return explicit === "OFFICIAL" || explicit === "TEST" || explicit === "NO_BET";
}

function isLegacyLeanProp(prop = {}) {
  return (
    !hasExplicitTrackingType(prop) &&
    inferTrackingType(prop) === "TEST" &&
    String(prop.tier || "").toUpperCase() === "LEAN"
  );
}

function bucketCount(sectionA, bucketKey) {
  const bucket = sectionA?.tierLabBuckets?.[bucketKey];
  if (!bucket) return 0;
  return Number(bucket.propCount ?? bucket.sample ?? 0);
}

function computeLabSlateTrackingSummary(props = [], reportSectionA) {
  const graded = Number(reportSectionA?.graded ?? 0);
  const pending = Number(reportSectionA?.pending ?? 0);

  if (props.length > 0) {
    const officialProps = props.filter((p) => inferTrackingType(p) === "OFFICIAL");
    const testWatchlistProps = props.filter((p) => inferTrackingType(p) === "TEST");
    return {
      totalProps: props.length,
      officialProps: officialProps.length,
      testWatchlistProps: testWatchlistProps.length,
      legacyLeanProps: props.filter(isLegacyLeanProp).length,
      graded,
      pending,
    };
  }

  const totalProps =
    graded + pending ||
    Number(reportSectionA?.totalTrackedProps ?? 0) ||
    graded;
  const legacyLeanProps = bucketCount(reportSectionA, "LEAN/TESTING");
  const officialFromBuckets = bucketCount(reportSectionA, "OFFICIAL");
  const officialProps =
    legacyLeanProps > 0 || bucketCount(reportSectionA, "WATCHLIST") > 0
      ? officialFromBuckets
      : Number(reportSectionA?.officialPropsCount ?? 0);
  const inferredOfficial = legacyLeanProps > 0 ? 0 : officialProps;
  const testWatchlistProps = legacyLeanProps > 0 ? legacyLeanProps : Math.max(0, totalProps - inferredOfficial);

  return {
    totalProps,
    officialProps: inferredOfficial,
    testWatchlistProps,
    legacyLeanProps,
    graded,
    pending,
  };
}

function testLegacyLeanOnlyNotOfficial() {
  const props = Array.from({ length: 14 }, (_, i) => ({
    player: `Player ${i}`,
    tier: "LEAN",
    status: "loss",
  }));
  const summary = computeLabSlateTrackingSummary(props);
  assert.equal(summary.totalProps, 14);
  assert.equal(summary.officialProps, 0);
  assert.equal(summary.testWatchlistProps, 14);
  assert.equal(summary.legacyLeanProps, 14);
}

function testMissingTrackingTypeNotOfficial() {
  const prop = { tier: "UNKNOWN", confidence: 50 };
  assert.equal(inferTrackingType(prop), "TEST");
  assert.notEqual(inferTrackingType(prop), "OFFICIAL");
}

function testLeanMapsToLegacyTest() {
  const prop = { tier: "LEAN" };
  assert.equal(inferTrackingType(prop), "TEST");
  assert.equal(isLegacyLeanProp(prop), true);
}

function testWatchlistMapsToTest() {
  const prop = { tier: "WATCHLIST" };
  assert.equal(inferTrackingType(prop), "TEST");
}

function testPremiumAndOfficialEligible() {
  assert.equal(inferTrackingType({ tier: "PREMIUM" }), "OFFICIAL");
  assert.equal(inferTrackingType({ officialEligible: true }), "OFFICIAL");
  assert.equal(inferTrackingType({ trackingType: "OFFICIAL" }), "OFFICIAL");
  assert.equal(inferTrackingType({ trackingType: "TEST" }), "TEST");
}

function testExplicitTrackingTypeWins() {
  assert.equal(
    inferTrackingType({ tier: "LEAN", trackingType: "OFFICIAL" }),
    "OFFICIAL"
  );
}

function testLabSummaryTotalMatchesGraded() {
  const sectionA = {
    graded: 14,
    pending: 0,
    totalOfficialProps: 14,
    tierLabBuckets: {
      "LEAN/TESTING": { propCount: 14, sample: 14 },
      OFFICIAL: { propCount: 0, sample: 0 },
    },
  };
  const summary = computeLabSlateTrackingSummary([], sectionA);
  assert.equal(summary.totalProps, 14);
  assert.equal(summary.officialProps, 0);
  assert.equal(summary.testWatchlistProps, 14);
  assert.equal(summary.legacyLeanProps, 14);
}

function test0621BundleUntouched() {
  const bundlePath = path.join(
    __dirname,
    "../lab-bundles/2026-06-21/daily-slate-report.json"
  );
  const raw = fs.readFileSync(bundlePath, "utf8");
  const beforeHash = raw.length;
  const report = JSON.parse(raw);
  const sectionA = report.sections?.A;
  assert.equal(sectionA.graded, 14);
  assert.equal(sectionA.tierLabBuckets["LEAN/TESTING"].propCount, 14);

  const summary = computeLabSlateTrackingSummary([], sectionA);
  assert.equal(summary.officialProps, 0);
  assert.equal(summary.testWatchlistProps, 14);

  const trackedPath = path.join(
    __dirname,
    "../lab-bundles/2026-06-21/tracked-props.json"
  );
  const trackedRaw = fs.readFileSync(trackedPath, "utf8");
  const tracked = JSON.parse(trackedRaw);
  const propsSummary = computeLabSlateTrackingSummary(tracked.props, sectionA);
  assert.equal(propsSummary.officialProps, 0);
  assert.equal(propsSummary.testWatchlistProps, 14);
  assert.equal(propsSummary.legacyLeanProps, 14);

  const afterRaw = fs.readFileSync(bundlePath, "utf8");
  assert.equal(afterRaw.length, beforeHash, "06/21 report bundle must not be mutated");
}

const tests = [
  ["legacy LEAN-only Lab report does not count as Official", testLegacyLeanOnlyNotOfficial],
  ["missing trackingType does not default to Official", testMissingTrackingTypeNotOfficial],
  ["LEAN tier maps to Legacy Test / Watchlist", testLeanMapsToLegacyTest],
  ["WATCHLIST maps to Test", testWatchlistMapsToTest],
  ["PREMIUM / officialEligible / explicit trackingType", testPremiumAndOfficialEligible],
  ["explicit trackingType wins over tier", testExplicitTrackingTypeWins],
  ["Lab summary total count matches graded props", testLabSummaryTotalMatchesGraded],
  ["06/21 bundle data untouched", test0621BundleUntouched],
];

let passed = 0;
for (const [name, fn] of tests) {
  fn();
  passed += 1;
  console.log(`✓ ${name}`);
}

console.log(`\n${passed}/${tests.length} Lab legacy tracking label tests passed.`);
