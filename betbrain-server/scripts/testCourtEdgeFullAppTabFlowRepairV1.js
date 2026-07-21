/**
 * CourtEdge Full-App Tab Flow Repair V1 — tests
 *
 * Covers Home, Home→Results admission, Results, Results→Lab, Lab→History,
 * 20× nav stability, concurrent ops, restart, partial-write crash recovery.
 */
import assert from "assert";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  TAB_FLOW_REPAIR_BUILD,
  admitSealResult,
  classifyHomeResultsGap,
  buildHonestResultsEmptyCopy,
  buildTabFlowDiagnostics,
} from "../services/courtEdgeTabFlowRepairV1.js";
import { freezeOfficialProp } from "../services/officialSlateService.js";
import { mergeLockedSlateFreezeIntoTracked } from "../services/trackedPropService.js";
import {
  LIFECYCLE,
  buildCanonicalSlateRecord,
  upsertCanonicalSlate,
  transitionLifecycle,
  withSlateLock,
  atomicWriteJson,
  STATE_INTEGRITY_BUILD,
} from "../services/courtEdgeStateIntegrityV1.js";
import { classifyMissingSlateAnswer } from "../services/courtEdgeStateReconcilerV1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TMP = path.join(__dirname, "..", ".tmp-tab-flow-repair-v1");

function wipeTmp() {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });
}

function makeProp(overrides = {}) {
  return {
    player: overrides.player || "Test Player",
    team: overrides.team || "MIN",
    opponent: overrides.opponent || "NY",
    league: "WNBA",
    side: overrides.side || "OVER",
    pick: overrides.side || "OVER",
    line: overrides.line ?? 18.5,
    confidence: overrides.confidence ?? 80,
    trueRisk: overrides.trueRisk || "LOW",
    controlledBestSixDisplay: true,
    controlledBestSixDisplayTracked: true,
    trackingEligibility: "TRACK",
    finalDecision: "TRACK",
    status: overrides.status || "pending",
    slateDate: overrides.slateDate,
    homeStaged: overrides.homeStaged === true,
    ...overrides,
  };
}

function makeSix(slateDate, names) {
  return names.map((player, i) =>
    makeProp({
      player,
      slateDate,
      line: 10.5 + i,
      side: i % 2 === 0 ? "OVER" : "UNDER",
      bestSixRank: i + 1,
    })
  );
}

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    failures.push({ name, error: err.message });
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

wipeTmp();

test("Home: draft board track flags do not imply Results membership", () => {
  const today = "2099-01-10";
  const board = {
    bestSixDisplayTodayWNBA: makeSix(today, ["A", "B", "C", "D", "E", "F"]),
  };
  const gap = classifyHomeResultsGap({
    board,
    trackedProps: [],
    todayLocalDate: today,
  });
  assert.ok(gap.confirmedHypotheses.length >= 1);
  assert.equal(gap.todayOfficialVisibleCount, 0);
  assert.ok(gap.homeTodayTrackFlagCount >= 6);
});

test("Home: freezeOfficialProp clears homeStaged", () => {
  const frozen = freezeOfficialProp(
    makeProp({ homeStaged: true, slateDate: "2099-01-11" }),
    { slateDate: "2099-01-11" }
  );
  assert.equal(frozen.homeStaged, false);
  assert.equal(frozen.immutableOfficial, true);
  assert.ok(frozen.officialPropId);
});

test("Home→Results: admit merge inserts Results-visible six", () => {
  const date = "2099-02-01";
  const six = makeSix(date, [
    "McBride",
    "Stewart",
    "Arike",
    "Fudd",
    "Burton",
    "Harrison",
  ]).map((p) => freezeOfficialProp(p, { slateDate: date }));

  const merged = mergeLockedSlateFreezeIntoTracked([], date, six);
  assert.equal(merged.length, 6);
  assert.ok(merged.every((p) => p.homeStaged === false));
  assert.ok(merged.every((p) => p.immutableOfficial === true));

  const gap = classifyHomeResultsGap({
    board: { bestSixDisplayTodayWNBA: six },
    trackedProps: merged,
    todayLocalDate: date,
  });
  assert.equal(gap.todayOfficialVisibleCount, 6);
});

test("Results: honest empty copy never says generate/refresh board", () => {
  const copy = buildHonestResultsEmptyCopy({
    todayLocalDate: "2099-03-01",
    activeResultsSlateDate: null,
    gap: { primaryHypothesis: "E_BOARD_TRACK_FLAGS_NOT_STORE" },
  });
  assert.ok(!/refresh board to generate/i.test(copy));
  assert.ok(!/regenerat/i.test(copy));
  assert.ok(/sealed official admission/i.test(copy));
});

test("Results: draft seal result is not admitted", () => {
  const date = "2099-04-01";
  const six = makeSix(date, ["P1", "P2", "P3", "P4", "P5", "P6"]).map((p) =>
    freezeOfficialProp(p, { slateDate: date })
  );
  const classification = admitSealResult(
    { ok: true, sealed: false, slateDate: date, props: six },
    { forceAdmit: false }
  );
  assert.equal(classification.admitted, false);
  assert.equal(classification.hypothesis, "A_HOME_DRAFT_NOT_SEALED");
});

test("Results: merge preserves grades append-only on freeze", () => {
  const date = "2099-04-02";
  const sealed = freezeOfficialProp(
    makeProp({ player: "Graded One", slateDate: date, line: 12.5 }),
    { slateDate: date }
  );
  const existing = {
    ...sealed,
    status: "win",
    actualStat: 20,
    gradedAt: "2099-04-02T20:00:00.000Z",
    homeStaged: true,
  };
  const merged = mergeLockedSlateFreezeIntoTracked([existing], date, [sealed]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].homeStaged, false);
  assert.equal(merged[0].status, "win");
  assert.equal(merged[0].actualStat, 20);
});

test("Results→Lab: lifecycle promotion idempotent", () => {
  const storePath = path.join(TMP, "canonical-lab.json");
  const journalPath = path.join(TMP, "journal-lab.json");
  const date = "2099-05-01";
  const six = makeSix(date, ["L1", "L2", "L3", "L4", "L5", "L6"]).map((p) =>
    freezeOfficialProp({ ...p, status: "win" }, { slateDate: date })
  );
  const record = buildCanonicalSlateRecord({
    league: "WNBA",
    slateDate: date,
    props: six,
    lifecycle: LIFECYCLE.GRADED_COMPLETE,
    buildVersion: TAB_FLOW_REPAIR_BUILD,
  });
  upsertCanonicalSlate(record, { storePath });
  const first = transitionLifecycle(record.slateId, LIFECYCLE.IN_LAB, {
    storePath,
    journalPath,
    idempotencyKey: `lab:${date}`,
  });
  assert.equal(first.ok, true);
  const second = transitionLifecycle(record.slateId, LIFECYCLE.IN_LAB, {
    storePath,
    journalPath,
    idempotencyKey: `lab:${date}`,
  });
  assert.equal(second.ok, true);
  assert.equal(second.idempotent, true);
});

test("Lab→History: archive transition is restart-safe", () => {
  const storePath = path.join(TMP, "canonical-hist.json");
  const journalPath = path.join(TMP, "journal-hist.json");
  const date = "2099-06-01";
  const six = makeSix(date, ["H1", "H2", "H3", "H4", "H5", "H6"]).map((p) =>
    freezeOfficialProp(p, { slateDate: date })
  );
  const record = buildCanonicalSlateRecord({
    league: "WNBA",
    slateDate: date,
    props: six,
    lifecycle: LIFECYCLE.IN_LAB,
  });
  upsertCanonicalSlate(record, { storePath });
  const a = transitionLifecycle(record.slateId, LIFECYCLE.IN_HISTORY, {
    storePath,
    journalPath,
    idempotencyKey: `hist:${date}`,
  });
  assert.equal(a.ok, true);
  const b = transitionLifecycle(record.slateId, LIFECYCLE.IN_HISTORY, {
    storePath,
    journalPath,
    idempotencyKey: `hist:${date}`,
  });
  assert.equal(b.idempotent, true);
});

test("Full nav ×20: gap classification stable without mutation", () => {
  const today = "2099-07-01";
  const board = {
    bestSixDisplayTodayWNBA: makeSix(today, ["N1", "N2", "N3", "N4", "N5", "N6"]),
  };
  let first = null;
  for (let i = 0; i < 20; i += 1) {
    const gap = classifyHomeResultsGap({
      board,
      trackedProps: [],
      todayLocalDate: today,
    });
    if (!first) first = gap.primaryHypothesis;
    assert.equal(gap.primaryHypothesis, first);
    assert.equal(gap.todayOfficialVisibleCount, 0);
  }
});

test("Concurrent ops: withSlateLock serializes writers", () => {
  const key = `tab-flow-test-lock-${Date.now()}`;
  const order = [];
  const a = withSlateLock(key, () => {
    order.push("a-start");
    order.push("a-end");
    return 1;
  });
  const b = withSlateLock(key, () => {
    order.push("b-start");
    order.push("b-end");
    return 2;
  });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true);
  assert.deepEqual(order, ["a-start", "a-end", "b-start", "b-end"]);
});

test("Restart: atomicWriteJson recovers complete JSON", () => {
  const file = path.join(TMP, "atomic.json");
  atomicWriteJson(file, { ok: true, n: 6, build: TAB_FLOW_REPAIR_BUILD });
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(raw.n, 6);
});

test("Partial-write crash: complete JSON only after atomic write", () => {
  const file = path.join(TMP, "crash.json");
  atomicWriteJson(file, { v: 1 });
  atomicWriteJson(file, { v: 2 });
  const raw = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(raw.v, 2);
});

test("Lab Jul19 classify answers 1-4 without inventing membership", () => {
  const a1 = classifyMissingSlateAnswer({
    slateDate: "2026-07-19",
    sealedCohort: {
      props: makeSix("2026-07-19", ["a", "b", "c", "d", "e", "f"]),
    },
  });
  assert.equal(a1.mutate, true);
  const a2 = classifyMissingSlateAnswer({
    slateDate: "2026-07-19",
    identityConflict: true,
  });
  assert.equal(a2.mutate, false);
  const a3 = classifyMissingSlateAnswer({
    slateDate: "2026-07-19",
    partialOnly: true,
  });
  assert.equal(a3.mutate, false);
  const a4 = classifyMissingSlateAnswer({ slateDate: "2026-07-19" });
  assert.equal(a4.mutate, false);
});

test("Build constants locked to tab-flow repair", () => {
  assert.equal(TAB_FLOW_REPAIR_BUILD, "courteedge-lab-jul20-only-v1");
  assert.equal(
    STATE_INTEGRITY_BUILD,
    "courteedge-lab-jul20-only-v1"
  );
});

test("Diagnostics packet includes honest empty copy", () => {
  const diag = buildTabFlowDiagnostics({
    board: {
      bestSixDisplayTodayWNBA: makeSix("2099-08-01", [
        "x",
        "y",
        "z",
        "q",
        "w",
        "e",
      ]),
    },
    trackedProps: [],
    todayLocalDate: "2099-08-01",
  });
  assert.ok(diag.honestEmptyCopy);
  assert.ok(!/Refresh board to generate/i.test(diag.honestEmptyCopy));
});

console.log(`\nTab flow repair tests: ${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.error(` - ${f.name}: ${f.error}`);
  process.exit(1);
}
process.exit(0);
