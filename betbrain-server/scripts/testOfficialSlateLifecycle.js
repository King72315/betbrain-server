/**
 * Official Slate immutable lifecycle regressions.
 *
 * Covers: partial-board sealing, thin-slate finalization, date rollover,
 * Results grade-only, Lab/History immutability, existing-data migration.
 *
 * Usage: node betbrain-server/scripts/testOfficialSlateLifecycle.js
 */
import assert from "assert";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  buildOfficialPropId,
  freezeOfficialProp,
  sealOfficialSlate,
  sealTomorrowOfficialSlates,
  getOfficialSlate,
  getOfficialSlateDraft,
  isOfficialSlateSealed,
  validateOfficialSlateLifecycle,
  resolveResultsPropsFromOfficialSlate,
  promoteSealedSlateToResults,
  inheritTodayResultsFromSealedSlate,
  migrateExistingOfficialSlate,
  OFFICIAL_SEAL_STATUS,
  OFFICIAL_LIFECYCLE_STAGE,
  OFFICIAL_SLATE_VERSION,
} from "../services/officialSlateService.js";
import {
  buildOfficialLearningRecord,
  buildOfficialLearningRecords,
  buildOfficialLabDailySummary,
} from "../services/officialLearningRecordBuilder.js";
import { appendMissingPropsToLockedSnapshot } from "../services/slateLockService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");
const SNAP_DIR = path.join(SERVER_ROOT, "slate-snapshots");
const REGISTRY = path.join(SERVER_ROOT, "locked-slates.json");
const DRAFT_FILE = path.join(SERVER_ROOT, "official-slate-drafts.json");

const TEST_DATE = "2099-12-31";
const TEST_PARTIAL = "2099-12-30";
const TEST_THIN = "2099-12-29";
const TEST_ROLLOVER = "2099-12-28";
const TEST_GRADE = "2099-12-27";
const TEST_LAB = "2099-12-26";
const TEST_HISTORY = "2099-12-25";
const MIGRATE_DATE = "2026-07-15";

const ALL_TEST_DATES = [
  TEST_DATE,
  TEST_PARTIAL,
  TEST_THIN,
  TEST_ROLLOVER,
  TEST_GRADE,
  TEST_LAB,
  TEST_HISTORY,
];

function makePick(overrides = {}) {
  const slateDate = overrides.slateDate || TEST_DATE;
  return {
    player: overrides.player || "Test Player",
    team: overrides.team || "TeamA",
    opponent: overrides.opponent || "TeamB",
    line: overrides.line ?? 14.5,
    side: overrides.side || "Over",
    pick: overrides.side || overrides.pick || "Over",
    league: "WNBA",
    confidence: overrides.confidence ?? 62,
    projectedPoints: overrides.projectedPoints ?? 16.2,
    slateDate,
    dayBucket: overrides.dayBucket || "TOMORROW",
    dateLabel: overrides.dateLabel || "Tomorrow",
    bestSixRank: overrides.bestSixRank || 1,
    decisionIntelligence: {
      trackEligibility: "BOARD_ONLY",
      trueRisk: "MEDIUM",
      bestSixPromoted: true,
      naturalDecision: "BOARD_ONLY",
    },
    wnbaReader: { finalSide: "Over", overGap: 1.6, thinGap: true },
    sideRescue: { action: "KEEP" },
    ...overrides,
  };
}

function makeSix(slateDate, prefix = "Seal Player") {
  return Array.from({ length: 6 }, (_, i) =>
    makePick({
      player: `${prefix} ${i + 1}`,
      team: `T${i + 1}`,
      line: 10.5 + i,
      bestSixRank: i + 1,
      confidence: 60 + i,
      projectedPoints: 12 + i,
      slateDate,
    })
  );
}

function cleanupDate(date) {
  const snap = path.join(SNAP_DIR, `${date}.json`);
  if (fs.existsSync(snap)) fs.unlinkSync(snap);
  if (fs.existsSync(REGISTRY)) {
    const reg = JSON.parse(fs.readFileSync(REGISTRY, "utf8"));
    reg.slates = (reg.slates || []).filter((s) => s.slateDate !== date);
    fs.writeFileSync(REGISTRY, JSON.stringify(reg, null, 2));
  }
  if (fs.existsSync(DRAFT_FILE)) {
    const drafts = JSON.parse(fs.readFileSync(DRAFT_FILE, "utf8"));
    if (drafts.drafts?.[date]) {
      delete drafts.drafts[date];
      fs.writeFileSync(DRAFT_FILE, JSON.stringify(drafts, null, 2));
    }
  }
}

function cleanupAllTestSlates() {
  for (const date of ALL_TEST_DATES) cleanupDate(date);
}

function stablePregameHash(records = []) {
  const payload = (records || []).map((r) => ({
    officialPropId: r.officialPropId,
    pregameSnapshot: r.pregameSnapshot,
  }));
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function testOfficialPropIdStable() {
  const pick = makePick({ player: "A", line: 10.5, side: "Under" });
  const a = buildOfficialPropId(pick, TEST_DATE);
  const b = buildOfficialPropId({ ...pick, confidence: 99 }, TEST_DATE);
  assert.strictEqual(a, b, "ID must ignore confidence regenerations");
  assert.ok(a.includes(TEST_DATE));
}

/** Partial-board sealing: 1/6 stays DRAFT; later 6/6 seals; no early 1-prop seal. */
/** Display Best 6 often omits slateDate — still must DRAFT (not skip). */
function testTomorrowMissingSlateDateStillDrafts() {
  cleanupDate("2099-12-30");
  const today = "2099-12-29";
  const five = Array.from({ length: 5 }, (_, i) =>
    makePick({
      player: `NoDate ${i + 1}`,
      team: `ND${i + 1}`,
      line: 12 + i,
      bestSixRank: i + 1,
      dayBucket: "TOMORROW",
      dateLabel: "Tomorrow",
      slateDate: "", // omitted on purpose
    })
  );
  // Remove empty slateDate key entirely (matches prod display props).
  for (const p of five) delete p.slateDate;

  const result = sealTomorrowOfficialSlates(five, {
    todayLocalDate: today,
    serverBuild: "test",
  });
  assert.strictEqual(result.sealedCount, 0);
  assert.strictEqual(result.draftCount, 1);
  assert.ok(result.results[0]);
  assert.strictEqual(result.results[0].status, OFFICIAL_SEAL_STATUS.DRAFT);
  assert.strictEqual(result.results[0].propCount, 5);
  assert.strictEqual(result.results[0].slateDate, "2099-12-30");
  assert.ok(!isOfficialSlateSealed("2099-12-30"));
  cleanupDate("2099-12-30");
}

function testPartialBoardDoesNotSeal() {
  cleanupDate(TEST_PARTIAL);
  const today = "2099-12-29"; // window still open for TEST_PARTIAL

  const one = [
    makePick({
      player: "Only One",
      slateDate: TEST_PARTIAL,
      bestSixRank: 1,
    }),
  ];

  const early = sealTomorrowOfficialSlates(one, {
    todayLocalDate: today,
    serverBuild: "test",
  });
  assert.strictEqual(early.sealedCount, 0);
  assert.ok(!isOfficialSlateSealed(TEST_PARTIAL), "1/6 must not seal");
  const draft = getOfficialSlateDraft(TEST_PARTIAL);
  assert.ok(draft, "draft should exist");
  assert.strictEqual(draft.status, OFFICIAL_SEAL_STATUS.DRAFT);
  assert.strictEqual(draft.controlledBestSixCount, 1);

  const direct = sealOfficialSlate(one, {
    slateDate: TEST_PARTIAL,
    todayLocalDate: today,
  });
  assert.strictEqual(direct.sealed, false);
  assert.strictEqual(direct.status, OFFICIAL_SEAL_STATUS.DRAFT);
  assert.ok(!isOfficialSlateSealed(TEST_PARTIAL));

  const six = makeSix(TEST_PARTIAL, "Full Board");
  const late = sealTomorrowOfficialSlates(six, {
    todayLocalDate: today,
    serverBuild: "test",
  });
  assert.ok(late.sealedCount >= 1);
  assert.ok(isOfficialSlateSealed(TEST_PARTIAL));
  const sealed = getOfficialSlate(TEST_PARTIAL);
  assert.strictEqual(sealed.propCount, 6);
  assert.ok(sealed.props.every((p) => String(p.player).startsWith("Full Board")));
  assert.ok(!sealed.props.some((p) => p.player === "Only One"));
  assert.strictEqual(sealed.sealReason, "FULL_BEST_SIX");
}

/** Thin-slate: window closed with 5 → seal FINAL_THIN_SLATE; later refresh cannot replace. */
function testThinSlateFinalization() {
  cleanupDate(TEST_THIN);
  const five = Array.from({ length: 5 }, (_, i) =>
    makePick({
      player: `Thin ${i + 1}`,
      team: `Th${i + 1}`,
      line: 11 + i,
      bestSixRank: i + 1,
      slateDate: TEST_THIN,
    })
  );

  const early = sealOfficialSlate(five, {
    slateDate: TEST_THIN,
    todayLocalDate: "2099-12-28",
    generationWindowClosed: false,
  });
  assert.strictEqual(early.status, OFFICIAL_SEAL_STATUS.DRAFT);
  assert.ok(!isOfficialSlateSealed(TEST_THIN));

  const sealed = sealOfficialSlate(five, {
    slateDate: TEST_THIN,
    todayLocalDate: "2099-12-28",
    generationWindowClosed: true,
  });
  assert.ok(sealed.sealed);
  assert.strictEqual(sealed.propCount, 5);
  assert.strictEqual(sealed.sealReason, "FINAL_THIN_SLATE");
  const ids = getOfficialSlate(TEST_THIN).officialPropIds.slice().sort();

  const sixAttempt = makeSix(TEST_THIN, "Intruder");
  const again = sealOfficialSlate(sixAttempt, {
    slateDate: TEST_THIN,
    generationWindowClosed: true,
  });
  assert.ok(again.alreadySealed);
  const ids2 = getOfficialSlate(TEST_THIN).officialPropIds.slice().sort();
  assert.deepStrictEqual(ids2, ids);
  assert.strictEqual(getOfficialSlate(TEST_THIN).propCount, 5);
}

/** Date rollover: sealed Tomorrow → Results same IDs; Today refresh cannot reseal. */
function testDateRolloverInheritsSealed() {
  cleanupDate(TEST_ROLLOVER);
  const six = makeSix(TEST_ROLLOVER, "Rollover");
  const seal = sealOfficialSlate(six, {
    slateDate: TEST_ROLLOVER,
    todayLocalDate: "2099-12-27",
  });
  assert.ok(seal.sealed);
  const ids = seal.officialPropIds.slice().sort();

  const promoted = promoteSealedSlateToResults(TEST_ROLLOVER);
  assert.ok(promoted.ok && promoted.inherited);
  assert.strictEqual(promoted.lifecycleStage, OFFICIAL_LIFECYCLE_STAGE.RESULTS);
  assert.deepStrictEqual(promoted.officialPropIds.slice().sort(), ids);

  const inherited = inheritTodayResultsFromSealedSlate(TEST_ROLLOVER);
  assert.ok(inherited.ok);
  assert.strictEqual(inherited.resealed, false);

  const fakeTodayBoard = makeSix(TEST_ROLLOVER, "Fresh Today");
  const resealAttempt = sealOfficialSlate(fakeTodayBoard, {
    slateDate: TEST_ROLLOVER,
    reason: "results_best_six_finalize",
  });
  assert.ok(resealAttempt.alreadySealed);
  const after = getOfficialSlate(TEST_ROLLOVER);
  assert.deepStrictEqual(after.officialPropIds.slice().sort(), ids);
  assert.ok(after.props.every((p) => String(p.player).startsWith("Rollover")));

  const resolved = resolveResultsPropsFromOfficialSlate(TEST_ROLLOVER, fakeTodayBoard);
  assert.strictEqual(resolved.source, "OFFICIAL_SEALED_SLATE");
  assert.deepStrictEqual(
    resolved.props.map((p) => p.officialPropId).sort(),
    ids
  );
}

/** Results grade-only: membership frozen; grades stick through refresh/restart. */
function testResultsGradeOnly() {
  cleanupDate(TEST_GRADE);
  const six = makeSix(TEST_GRADE, "Grade");
  sealOfficialSlate(six, { slateDate: TEST_GRADE, todayLocalDate: "2099-12-26" });
  promoteSealedSlateToResults(TEST_GRADE);

  const snapPath = path.join(SNAP_DIR, `${TEST_GRADE}.json`);
  const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  snap.props = snap.props.map((p, i) => {
    if (i >= 2) return { ...p, status: "pending" };
    return {
      ...p,
      status: i === 0 ? "win" : "loss",
      result: i === 0 ? "WIN" : "LOSS",
      actualStat: i === 0 ? 20 : 8,
      gradedAt: "2099-12-27T20:00:00.000Z",
      resultMargin: i === 0 ? 5 : -2,
    };
  });
  fs.writeFileSync(snapPath, JSON.stringify(snap, null, 2));

  const before = getOfficialSlate(TEST_GRADE);
  assert.strictEqual(before.propCount, 6);
  const graded = before.props.filter(
    (p) => p.status === "win" || p.status === "loss"
  );
  assert.strictEqual(graded.length, 2);

  // Refresh / restart simulation: reseal attempt + append blocked.
  sealOfficialSlate(makeSix(TEST_GRADE, "Restart"), {
    slateDate: TEST_GRADE,
  });
  const append = appendMissingPropsToLockedSnapshot(TEST_GRADE, [
    makePick({ player: "Append Intruder", slateDate: TEST_GRADE, line: 99.5 }),
  ]);
  assert.ok(append.blockedByOfficialSeal || append.skipped);
  assert.strictEqual(append.appended || 0, 0);

  const after = getOfficialSlate(TEST_GRADE);
  assert.strictEqual(after.propCount, 6);
  assert.strictEqual(
    after.props.filter((p) => p.status === "win" || p.status === "loss").length,
    2
  );
  assert.strictEqual(
    after.props.filter((p) => !p.status || p.status === "pending").length,
    4
  );
  assert.ok(after.props.every((p) => String(p.player).startsWith("Grade")));
}

/** Lab immutability: rebuild does not change cohort / line / side / projection / confidence. */
function testLabPregameImmutability() {
  cleanupDate(TEST_LAB);
  const six = makeSix(TEST_LAB, "Lab");
  sealOfficialSlate(six, { slateDate: TEST_LAB, todayLocalDate: "2099-12-25" });
  const props = getOfficialSlate(TEST_LAB).props.map((p, i) => ({
    ...p,
    status: "win",
    result: "WIN",
    actualStat: 18 + i,
    resultMargin: 2,
  }));

  const first = buildOfficialLearningRecords(props);
  assert.strictEqual(first.length, 6);
  assert.ok(first.every((r) => r.pregameSnapshot));
  assert.ok(first.every((r) => r.postgameLearning));

  const pregameHash1 = stablePregameHash(first);
  const cohort1 = first.map((r) => r.officialPropId).sort();

  // Rebuild with different actuals / analysis — pregame must not change.
  const rebuiltProps = props.map((p, i) => ({
    ...p,
    actualStat: 99,
    calibrationLesson: `lesson-${i}`,
    missType: "volume_profile_miss",
    confidence: 1, // should not rewrite pregame confidence
    projectedPoints: 0.1,
    line: 0.5,
  }));
  const second = buildOfficialLearningRecords(rebuiltProps);
  const pregameHash2 = stablePregameHash(second);
  assert.strictEqual(pregameHash2, pregameHash1);
  assert.deepStrictEqual(
    second.map((r) => r.officialPropId).sort(),
    cohort1
  );
  for (let i = 0; i < first.length; i++) {
    assert.strictEqual(second[i].pregameSnapshot.line, first[i].pregameSnapshot.line);
    assert.strictEqual(second[i].pregameSnapshot.side, first[i].pregameSnapshot.side);
    assert.strictEqual(
      second[i].pregameSnapshot.projection,
      first[i].pregameSnapshot.projection
    );
    assert.strictEqual(
      second[i].pregameSnapshot.confidence,
      first[i].pregameSnapshot.confidence
    );
  }
  assert.ok(second.every((r) => r.postgameLearning.actualPoints === 99));
}

/** History immutability: prior Lab payload hash unchanged after refresh/rebuild. */
function testHistoryPayloadHashStable() {
  cleanupDate(TEST_HISTORY);
  const six = makeSix(TEST_HISTORY, "Hist");
  sealOfficialSlate(six, { slateDate: TEST_HISTORY, todayLocalDate: "2099-12-24" });
  const graded = getOfficialSlate(TEST_HISTORY).props.map((p, i) => ({
    ...p,
    status: i % 2 === 0 ? "win" : "loss",
    result: i % 2 === 0 ? "WIN" : "LOSS",
    actualStat: 15 + i,
  }));
  const labRecords = buildOfficialLearningRecords(graded);
  const historyPayload = {
    slateDate: TEST_HISTORY,
    officialPropIds: labRecords.map((r) => r.officialPropId),
    pregameSnapshots: labRecords.map((r) => r.pregameSnapshot),
  };
  const hash1 = crypto
    .createHash("sha256")
    .update(JSON.stringify(historyPayload))
    .digest("hex");

  // Simulate new slate entering Lab + rebuild of prior History.
  const rebuilt = buildOfficialLearningRecords(
    graded.map((p) => ({
      ...p,
      actualStat: 50,
      calibrationLesson: "new analysis",
    }))
  );
  const historyPayload2 = {
    slateDate: TEST_HISTORY,
    officialPropIds: rebuilt.map((r) => r.officialPropId),
    pregameSnapshots: rebuilt.map((r) => r.pregameSnapshot),
  };
  const hash2 = crypto
    .createHash("sha256")
    .update(JSON.stringify(historyPayload2))
    .digest("hex");
  assert.strictEqual(hash2, hash1);

  // Refresh cannot replace sealed membership feeding History.
  sealOfficialSlate(makeSix(TEST_HISTORY, "Replace"), {
    slateDate: TEST_HISTORY,
  });
  const still = getOfficialSlate(TEST_HISTORY);
  assert.ok(still.props.every((p) => String(p.player).startsWith("Hist")));
}

/** Existing Jul. 15 migration: no delete/replace; stamp IDs; idempotent. */
function testExistingDataMigrationJul15() {
  const snapPath = path.join(SNAP_DIR, `${MIGRATE_DATE}.json`);
  assert.ok(fs.existsSync(snapPath), "Jul 15 snapshot must exist for migration test");
  const before = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  const beforeProps = (before.props || []).map((p) => ({
    player: p.player,
    line: p.officialLine ?? p.line ?? p.pickLine,
    side: p.lockedSide || p.side || p.pick,
    status: p.status || null,
    result: p.result || null,
    gradedAt: p.gradedAt || null,
    actualStat: p.actualStat ?? p.actualPoints ?? null,
  }));
  assert.ok(beforeProps.length >= 1, "Jul 15 should have props");

  const mig1 = migrateExistingOfficialSlate(MIGRATE_DATE);
  assert.ok(mig1.ok, mig1.message);
  const after1 = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  assert.strictEqual(after1.props.length, before.props.length);
  for (let i = 0; i < beforeProps.length; i++) {
    const p = after1.props[i];
    assert.strictEqual(p.player, beforeProps[i].player);
    assert.strictEqual(
      Number(p.officialLine ?? p.line ?? p.pickLine),
      Number(beforeProps[i].line)
    );
    assert.strictEqual(
      String(p.lockedSide || p.side || p.pick || "").toUpperCase().startsWith("O")
        ? "OVER"
        : String(p.lockedSide || p.side || p.pick || "").toUpperCase().startsWith("U")
          ? "UNDER"
          : String(p.lockedSide || p.side || p.pick || ""),
      String(beforeProps[i].side || "").toUpperCase().startsWith("O")
        ? "OVER"
        : String(beforeProps[i].side || "").toUpperCase().startsWith("U")
          ? "UNDER"
          : String(beforeProps[i].side || "")
    );
    assert.strictEqual(p.status || null, beforeProps[i].status);
    assert.strictEqual(p.result || null, beforeProps[i].result);
    assert.strictEqual(p.gradedAt || null, beforeProps[i].gradedAt);
    assert.ok(p.officialPropId, "officialPropId must be stamped");
  }

  const mig2 = migrateExistingOfficialSlate(MIGRATE_DATE);
  assert.ok(mig2.ok);
  assert.ok(mig2.alreadyMigrated || mig2.stampedOfficialPropIds === 0);
  const after2 = JSON.parse(fs.readFileSync(snapPath, "utf8"));
  assert.strictEqual(after2.props.length, after1.props.length);
  assert.deepStrictEqual(
    after2.props.map((p) => p.officialPropId),
    after1.props.map((p) => p.officialPropId)
  );
}

function testSealOnceNeverRegenerates() {
  cleanupDate(TEST_DATE);
  const first = makeSix(TEST_DATE, "Seal Player");
  const seal1 = sealOfficialSlate(first, {
    slateDate: TEST_DATE,
    todayLocalDate: "2099-12-30",
    serverBuild: "test",
  });
  assert.ok(seal1.ok && seal1.sealed);
  assert.strictEqual(seal1.propCount, 6);
  const ids1 = getOfficialSlate(TEST_DATE).officialPropIds.slice().sort();

  const swapped = makeSix(TEST_DATE, "REPLACED");
  const seal2 = sealOfficialSlate(swapped, {
    slateDate: TEST_DATE,
    reason: "test_reseal_attempt",
  });
  assert.ok(seal2.alreadySealed);
  assert.deepStrictEqual(
    getOfficialSlate(TEST_DATE).officialPropIds.slice().sort(),
    ids1
  );
}

function testLifecycleValidationSameIds() {
  assert.ok(isOfficialSlateSealed(TEST_DATE));
  const sealed = getOfficialSlate(TEST_DATE);
  const tracked = sealed.props.map((p) => ({ ...p }));
  const ok = validateOfficialSlateLifecycle(TEST_DATE, { trackedProps: tracked });
  assert.ok(ok.ok, JSON.stringify(ok.failures));

  const mutated = tracked.map((p, i) =>
    i === 0 ? { ...p, player: "MUTATED NAME", confidence: 1 } : p
  );
  const bad = validateOfficialSlateLifecycle(TEST_DATE, {
    trackedProps: mutated,
    strictConfidence: true,
  });
  assert.ok(!bad.ok);
  assert.ok(bad.failures.some((f) => f.code === "IDENTITY_MUTATION"));
}

function testFreezePreservesEngineOutputs() {
  const pick = makePick({
    player: "Freeze Me",
    decisionIntelligence: { trackEligibility: "BOARD_ONLY", trueRisk: "HIGH" },
    wnbaReader: { finalSide: "Under", score: 44 },
  });
  const frozen = freezeOfficialProp(pick, { slateDate: TEST_DATE });
  assert.ok(frozen.officialPropId);
  assert.ok(frozen.pregameSnapshot);
  assert.strictEqual(frozen.pregameSnapshot.risk, "HIGH");
  assert.strictEqual(frozen.immutableOfficial, true);
  assert.strictEqual(OFFICIAL_SLATE_VERSION.includes("immutable"), true);
}

function testLearningRecordsEnrichment() {
  const props = getOfficialSlate(TEST_DATE).props.map((p, i) => ({
    ...p,
    status: i === 0 ? "win" : "loss",
    result: i === 0 ? "WIN" : "LOSS",
    actualStat: i === 0 ? 20 : 10,
    resultMargin: i === 0 ? 5 : -0.5,
  }));
  const records = buildOfficialLearningRecords(props);
  assert.strictEqual(records.length, 6);
  assert.ok(records[0].pregameSnapshot);
  assert.ok(records[0].postgameLearning);
  const summary = buildOfficialLabDailySummary(records, { slateDate: TEST_DATE });
  assert.strictEqual(summary.overallRecord.wins, 1);
  assert.strictEqual(summary.overallRecord.losses, 5);
}

const tests = [
  ["1 official prop id stable", testOfficialPropIdStable],
  ["1b missing slateDate Tomorrow still DRAFTs", testTomorrowMissingSlateDateStillDrafts],
  ["2 partial-board sealing stays DRAFT until 6/6", testPartialBoardDoesNotSeal],
  ["3 thin-slate FINAL_THIN_SLATE seals 5 only", testThinSlateFinalization],
  ["4 date rollover inherits sealed Tomorrow → Results", testDateRolloverInheritsSealed],
  ["5 Results grade-only membership + grades sticky", testResultsGradeOnly],
  ["6 Lab pregame snapshot immutable on rebuild", testLabPregameImmutability],
  ["7 History payload hash immutable", testHistoryPayloadHashStable],
  ["8 existing Jul.15 migration idempotent no wipe", testExistingDataMigrationJul15],
  ["9 seal once — refresh cannot replace membership", testSealOnceNeverRegenerates],
  ["10 lifecycle validation catches identity mutation", testLifecycleValidationSameIds],
  ["11 freeze preserves pregame engine outputs", testFreezePreservesEngineOutputs],
  ["12 Lab learning records enrich sealed props", testLearningRecordsEnrichment],
];

let passed = 0;
try {
  cleanupAllTestSlates();
  for (const [name, fn] of tests) {
    fn();
    passed += 1;
    console.log(`PASS: ${name}`);
  }
} finally {
  cleanupAllTestSlates();
}

console.log(`\nAll ${passed}/${tests.length} Official Slate lifecycle tests passed.`);
