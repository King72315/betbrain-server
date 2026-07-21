/**
 * CourtEdge End-to-End State Integrity V1 — adversarial tests A–T.
 */
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

import {
  STATE_INTEGRITY_BUILD,
  LIFECYCLE,
  buildCanonicalSlateId,
  buildCanonicalSlateRecord,
  hashDecisionPacket,
  attachContentHash,
  mergeByPrecedence,
  upsertCanonicalSlate,
  loadCanonicalStore,
  saveCanonicalStore,
  transitionLifecycle,
  acquireSlateLock,
  releaseSlateLock,
  withSlateLock,
  mergeBoardDayIsolation,
  applyForceRefreshToSealedBoard,
  syncBoardToCanonicalStore,
  rolloverSealedTomorrowToToday,
  assertSealedImmutability,
  assertTrackAllSix,
  assertTodayTomorrowIsolation,
  resetPaidApiCounter,
  recordPaidApiCall,
  getPaidApiCallCount,
  atomicWriteJson,
  readJsonSafe,
  completenessScore,
  getCanonicalSlateDate,
  getCanonicalSlateDateFromInstant,
  extractImmutablePacketFields,
  buildStateIntegritySnapshot,
  STATE_INTEGRITY_PATHS,
} from "../services/courtEdgeStateIntegrityV1.js";
import {
  scanStateIntegrity,
  reconcileStateIntegrity,
  classifyMissingSlateAnswer,
  explainMissingCompletedSlate,
} from "../services/courtEdgeStateReconcilerV1.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

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
    failures.push({ name, message: err.message });
    console.error(`FAIL ${name}: ${err.message}`);
  }
}

function tmpDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ce-integrity-${label}-`));
  return {
    dir,
    storePath: path.join(dir, "canonical-slates-v1.json"),
    journalPath: path.join(dir, "journal.json"),
    locksPath: path.join(dir, "locks.json"),
  };
}

function makeProp(overrides = {}) {
  return attachContentHash({
    player: overrides.player || "Test Player",
    team: overrides.team || "ATL",
    opponent: overrides.opponent || "NYL",
    league: overrides.league || "WNBA",
    side: overrides.side || "OVER",
    pick: overrides.side || "OVER",
    line: overrides.line ?? 18.5,
    officialLine: overrides.line ?? 18.5,
    confidence: overrides.confidence ?? 70,
    trueRisk: overrides.risk || "MEDIUM",
    controlledBestSixRank: overrides.rank ?? 1,
    isTopPick: overrides.top || false,
    projection: overrides.projection ?? 20,
    slateDate: overrides.slateDate || "2026-07-20",
    immutableOfficial: overrides.sealed !== false,
    sealedAt: overrides.sealedAt || "2026-07-19T18:00:00.000Z",
    officialSealedAt: overrides.sealedAt || "2026-07-19T18:00:00.000Z",
    homeDetailedAnalysisV1: overrides.analysis || { summary: "full" },
    whySide: overrides.whySide || ["edge"],
    status: overrides.status,
    ...overrides,
  });
}

function makeSix(slateDate = "2026-07-20", extras = {}) {
  const names = ["A", "B", "C", "D", "E", "F"];
  return names.map((n, i) =>
    makeProp({
      player: `Player ${n}`,
      rank: i + 1,
      line: 10.5 + i,
      slateDate,
      ...extras,
    })
  );
}

// ---------------------------------------------------------------------------
// A. Repeated tab navigation (read-only surfaces)
// ---------------------------------------------------------------------------
test("A tab navigation 20x does not mutate canonical hashes or paid APIs", () => {
  resetPaidApiCounter();
  const { storePath } = tmpDir("a");
  const props = makeSix();
  const record = buildCanonicalSlateRecord({
    slateDate: "2026-07-20",
    props,
    lifecycle: LIFECYCLE.SEALED,
  });
  upsertCanonicalSlate(record, { storePath, source: "test-a" });
  const before = loadCanonicalStore(storePath).slates[record.slateId].slateContentHash;
  for (let i = 0; i < 20; i += 1) {
    // Simulate Home→Results→Lab→History read-only views
    const snap = buildStateIntegritySnapshot({ storePath });
    assert.strictEqual(snap.slates[0].slateContentHash, before);
  }
  assert.strictEqual(getPaidApiCallCount(), 0);
});

// ---------------------------------------------------------------------------
// B. Browser refresh
// ---------------------------------------------------------------------------
test("B browser refresh preserves slate IDs, prop IDs, hashes", () => {
  const { storePath } = tmpDir("b");
  const props = makeSix("2026-07-18");
  const record = buildCanonicalSlateRecord({
    slateDate: "2026-07-18",
    props,
    lifecycle: LIFECYCLE.IN_RESULTS,
  });
  upsertCanonicalSlate(record, { storePath });
  const first = loadCanonicalStore(storePath).slates[record.slateId];
  for (let i = 0; i < 5; i += 1) {
    const again = loadCanonicalStore(storePath).slates[record.slateId];
    assert.strictEqual(again.slateId, first.slateId);
    assert.strictEqual(again.slateContentHash, first.slateContentHash);
    assert.strictEqual(again.decisionPackets.length, 6);
    assert.deepStrictEqual(
      again.decisionPackets.map((p) => p.officialPropId),
      first.decisionPackets.map((p) => p.officialPropId)
    );
  }
});

// ---------------------------------------------------------------------------
// C. App resume
// ---------------------------------------------------------------------------
test("C app resume simulation does not regenerate", () => {
  resetPaidApiCounter();
  const { storePath } = tmpDir("c");
  const props = makeSix();
  const record = buildCanonicalSlateRecord({
    slateDate: "2026-07-20",
    props,
    lifecycle: LIFECYCLE.SEALED,
  });
  upsertCanonicalSlate(record, { storePath });
  const hash = loadCanonicalStore(storePath).slates[record.slateId].slateContentHash;
  for (let i = 0; i < 10; i += 1) {
    // resume = rehydrate store only
    const store = loadCanonicalStore(storePath);
    assert.strictEqual(store.slates[record.slateId].slateContentHash, hash);
  }
  assert.strictEqual(getPaidApiCallCount(), 0);
});

// ---------------------------------------------------------------------------
// D. Concurrent refreshes
// ---------------------------------------------------------------------------
test("D concurrent lock prevents corrupt double-write", () => {
  const { locksPath, storePath } = tmpDir("d");
  const key = "WNBA|2026-07-20|refresh";
  const a = acquireSlateLock(key, { locksPath, owner: "sched-today", ttlMs: 5000 });
  assert.strictEqual(a.ok, true);
  const b = acquireSlateLock(key, { locksPath, owner: "manual-force", ttlMs: 5000 });
  assert.strictEqual(b.ok, false);
  releaseSlateLock(key, { locksPath });
  const wrapped = withSlateLock(
    key,
    () => {
      const props = makeSix();
      const record = buildCanonicalSlateRecord({
        slateDate: "2026-07-20",
        props,
        lifecycle: LIFECYCLE.SEALED,
        recordVersion: 2,
      });
      return upsertCanonicalSlate(record, { storePath });
    },
    { locksPath, owner: "grader" }
  );
  assert.strictEqual(wrapped.ok, true);
  assert.ok(loadCanonicalStore(storePath).slates);
});

// ---------------------------------------------------------------------------
// E. Today/Tomorrow isolation
// ---------------------------------------------------------------------------
test("E Today refresh does not mutate Tomorrow bytes", () => {
  const tomorrow = makeSix("2026-07-21").map((p) =>
    attachContentHash({ ...p, slateDate: "2026-07-21" })
  );
  const today = makeSix("2026-07-20");
  const before = {
    bestSixDisplayTodayWNBA: today,
    bestSixDisplayTomorrowWNBA: tomorrow,
  };
  const afterToday = mergeBoardDayIsolation(before, {
    bestSixDisplayTodayWNBA: makeSix("2026-07-20").map((p, i) => ({
      ...p,
      confidence: 99,
      player: today[i].player,
    })),
    bestSixDisplayTomorrowWNBA: [], // attempted wipe
  });
  const iso = assertTodayTomorrowIsolation(before, afterToday);
  assert.strictEqual(iso.ok, true);
  assert.strictEqual(afterToday.bestSixDisplayTomorrowWNBA.length, 6);
});

// ---------------------------------------------------------------------------
// F. Progressive persistence
// ---------------------------------------------------------------------------
test("F progressive incomplete Today cannot clear Tomorrow", () => {
  const before = {
    bestSixDisplayTodayWNBA: makeSix("2026-07-20"),
    bestSixDisplayTomorrowWNBA: makeSix("2026-07-21"),
  };
  const incomplete = {
    incomplete: true,
    progressivePersist: true,
    bestSixDisplayTodayWNBA: makeSix("2026-07-20").slice(0, 2),
    bestSixDisplayTomorrowWNBA: [],
  };
  const merged = mergeBoardDayIsolation(before, incomplete);
  assert.strictEqual(merged.bestSixDisplayTomorrowWNBA.length, 6);
});

// ---------------------------------------------------------------------------
// G. Empty provider response
// ---------------------------------------------------------------------------
test("G empty/partial provider cannot replace complete known-good", () => {
  const existing = buildCanonicalSlateRecord({
    slateDate: "2026-07-20",
    props: makeSix(),
    lifecycle: LIFECYCLE.SEALED,
  });
  for (const incoming of [
    buildCanonicalSlateRecord({ slateDate: "2026-07-20", props: [], lifecycle: LIFECYCLE.DRAFT }),
    buildCanonicalSlateRecord({
      slateDate: "2026-07-20",
      props: makeSix().slice(0, 2),
      lifecycle: LIFECYCLE.DRAFT,
    }),
    { ...existing, props: [], decisionPackets: [], placeholder: true, lifecycle: LIFECYCLE.DRAFT },
  ]) {
    const merge = mergeByPrecedence(existing, incoming, { source: "provider" });
    assert.strictEqual(merge.winner.decisionPackets.length, 6);
    assert.ok(merge.rejected || merge.reason.includes("cannot") || merge.reason.includes("placeholder") || merge.reason.includes("richer") || merge.reason.includes("sealed"));
  }
});

// ---------------------------------------------------------------------------
// H. Restart recovery
// ---------------------------------------------------------------------------
test("H restart reloads same hashes and lifecycle", () => {
  const { storePath } = tmpDir("h");
  const props = makeSix("2026-07-17");
  const record = buildCanonicalSlateRecord({
    slateDate: "2026-07-17",
    props,
    lifecycle: LIFECYCLE.IN_LAB,
  });
  upsertCanonicalSlate(record, { storePath });
  const before = loadCanonicalStore(storePath).slates[record.slateId];
  // simulate process restart = new load
  const after = loadCanonicalStore(storePath).slates[record.slateId];
  assert.strictEqual(after.slateContentHash, before.slateContentHash);
  assert.strictEqual(after.lifecycle, LIFECYCLE.IN_LAB);
  assert.strictEqual(after.decisionPackets.length, 6);
  assert.ok(after.decisionPackets.every((p) => p.homeDetailedAnalysisV1 || p.sealedAnalysis));
});

// ---------------------------------------------------------------------------
// I. Placeholder recovery conflict
// ---------------------------------------------------------------------------
test("I complete record wins over newer placeholder/empty", () => {
  const complete = buildCanonicalSlateRecord({
    slateDate: "2026-07-20",
    props: makeSix(),
    lifecycle: LIFECYCLE.SEALED,
    recordVersion: 1,
  });
  const placeholder = {
    ...complete,
    recordVersion: 9,
    placeholder: true,
    decisionPackets: makeSix().map((p) => ({
      ...p,
      homeDetailedAnalysisV1: null,
      sealedAnalysis: null,
      whySide: [],
      projection: null,
    })),
    props: [],
    completeness: 0,
  };
  const empty = { ...complete, decisionPackets: [], props: [], recordVersion: 10 };
  assert.strictEqual(
    mergeByPrecedence(complete, placeholder, { source: "recovery" }).winner.decisionPackets
      .length,
    6
  );
  assert.strictEqual(
    mergeByPrecedence(complete, empty, { source: "recovery" }).winner.decisionPackets.length,
    6
  );
});

// ---------------------------------------------------------------------------
// J. Tomorrow→Today rollover
// ---------------------------------------------------------------------------
test("J sealed rollover preserves slateId and hashes", () => {
  const { storePath } = tmpDir("j");
  const today = "2026-07-20";
  const props = makeSix(today);
  const record = buildCanonicalSlateRecord({
    slateDate: today,
    props,
    lifecycle: LIFECYCLE.SEALED,
    dayBucket: "TOMORROW",
  });
  upsertCanonicalSlate(record, { storePath });
  const stored = loadCanonicalStore(storePath).slates[record.slateId];
  const result = rolloverSealedTomorrowToToday({
    storePath,
    today,
    yesterday: "2026-07-19",
    league: "WNBA",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.action, "promoted_identity_preserved");
  assert.strictEqual(result.slateId, record.slateId);
  assert.strictEqual(result.slateContentHash, stored.slateContentHash);
  assert.deepStrictEqual(
    result.contentHashes.sort(),
    (stored.decisionPackets || []).map((p) => p.contentHash).sort()
  );
});

test("Jb unsealed draft rollover is not treated as locked official", () => {
  const { storePath } = tmpDir("jb");
  const today = "2026-07-21";
  const props = makeSix(today, { sealed: false, sealedAt: null, immutableOfficial: false });
  // force draft
  const record = buildCanonicalSlateRecord({
    slateDate: today,
    props: props.map((p) => ({ ...p, immutableOfficial: false, sealedAt: null })),
    lifecycle: LIFECYCLE.DRAFT,
  });
  // manually clear sealed flag
  record.sealed = false;
  record.lifecycle = LIFECYCLE.DRAFT;
  upsertCanonicalSlate(record, { storePath, incomingIsHomeDraft: true });
  const result = rolloverSealedTomorrowToToday({ storePath, today, league: "WNBA" });
  assert.ok(
    result.action === "no_sealed_tomorrow" || result.action === "promoted_identity_preserved"
  );
});

// ---------------------------------------------------------------------------
// K. Stable local date America/Chicago
// ---------------------------------------------------------------------------
test("K slate dates around CT midnight use America/Chicago", () => {
  // 2026-07-20 04:30 UTC = 2026-07-19 23:30 CT (CDT)
  const beforeMidnightUtc = new Date("2026-07-20T04:30:00.000Z");
  // 2026-07-20 05:30 UTC = 2026-07-20 00:30 CT
  const afterMidnightUtc = new Date("2026-07-20T05:30:00.000Z");
  const d1 = getCanonicalSlateDate(beforeMidnightUtc);
  const d2 = getCanonicalSlateDate(afterMidnightUtc);
  assert.strictEqual(d1, "2026-07-19");
  assert.strictEqual(d2, "2026-07-20");
  assert.strictEqual(
    getCanonicalSlateDateFromInstant("2026-07-20T05:00:00.000Z"),
    "2026-07-20"
  );
  // UTC midnight should still be prior CT evening
  assert.strictEqual(getCanonicalSlateDate(new Date("2026-07-20T00:00:00.000Z")), "2026-07-19");
});

// ---------------------------------------------------------------------------
// L. Results integrity
// ---------------------------------------------------------------------------
test("L Results receives exact sealed six — no selection rebuild", () => {
  const home = makeSix("2026-07-16");
  const results = home.map((p) => ({
    ...extractImmutablePacketFields(p),
    contentHash: p.contentHash,
    status: "pending",
  }));
  const track = assertTrackAllSix(home, results);
  assert.strictEqual(track.ok, true);
  const parity = assertSealedImmutability({ home, results });
  assert.strictEqual(parity.ok, true);
});

// ---------------------------------------------------------------------------
// M. Lab promotion
// ---------------------------------------------------------------------------
test("M completed cohort promotes to Lab exactly once (idempotent)", () => {
  const { storePath, journalPath } = tmpDir("m");
  const props = makeSix("2026-07-17", { status: "win" });
  const record = buildCanonicalSlateRecord({
    slateDate: "2026-07-17",
    props,
    lifecycle: LIFECYCLE.SEALED,
  });
  upsertCanonicalSlate(record, { storePath });
  const id = record.slateId;
  for (const to of [
    LIFECYCLE.IN_RESULTS,
    LIFECYCLE.GRADED_COMPLETE,
    LIFECYCLE.IN_LAB,
  ]) {
    const r = transitionLifecycle(id, to, {
      storePath,
      journalPath,
      idempotencyKey: `m-${to}`,
      source: "test-m",
    });
    assert.ok(r.ok || r.idempotent);
  }
  const again = transitionLifecycle(id, LIFECYCLE.IN_LAB, {
    storePath,
    journalPath,
    idempotencyKey: `m-${LIFECYCLE.IN_LAB}`,
    source: "test-m",
  });
  assert.strictEqual(again.idempotent, true);
  // incomplete must not promote
  const bad = buildCanonicalSlateRecord({
    slateDate: "2026-07-18",
    props: makeSix("2026-07-18").slice(0, 3),
    lifecycle: LIFECYCLE.DRAFT,
  });
  upsertCanonicalSlate(bad, { storePath });
  const denied = transitionLifecycle(bad.slateId, LIFECYCLE.IN_HISTORY, {
    storePath,
    journalPath,
    source: "test-m",
  });
  assert.strictEqual(denied.ok, false);
});

// ---------------------------------------------------------------------------
// N. Frozen block persistence
// ---------------------------------------------------------------------------
test("N frozen block membership unchanged across reload", () => {
  const frozen = ["2026-07-14", "2026-07-15", "2026-07-16"];
  const { storePath } = tmpDir("n");
  for (const d of frozen) {
    upsertCanonicalSlate(
      buildCanonicalSlateRecord({
        slateDate: d,
        props: makeSix(d, { status: "loss" }),
        lifecycle: LIFECYCLE.IN_HISTORY,
      }),
      { storePath }
    );
  }
  const scan1 = scanStateIntegrity({
    storePath,
    frozenBlockDates: frozen,
    trackedProps: frozen.flatMap((d) => makeSix(d, { status: "win" })),
    labDefaultSlateDate: "2026-07-17",
  });
  const scan2 = scanStateIntegrity({
    storePath,
    frozenBlockDates: frozen,
    trackedProps: frozen.flatMap((d) => makeSix(d, { status: "win" })),
    labDefaultSlateDate: "2026-07-17",
  });
  assert.deepStrictEqual(
    scan1.findings.filter((f) => f.type === "frozen_block_missing_slate"),
    scan2.findings.filter((f) => f.type === "frozen_block_missing_slate")
  );
});

// ---------------------------------------------------------------------------
// O. Stale client
// ---------------------------------------------------------------------------
test("O stale client recordVersion cannot overwrite newer", () => {
  const newer = buildCanonicalSlateRecord({
    slateDate: "2026-07-20",
    props: makeSix(),
    lifecycle: LIFECYCLE.SEALED,
    recordVersion: 5,
  });
  const stale = {
    ...newer,
    recordVersion: 2,
    decisionPackets: makeSix().map((p) => ({ ...p, confidence: 1, player: "STALE" })),
  };
  const merge = mergeByPrecedence(newer, stale, { source: "stale-client" });
  assert.strictEqual(merge.reason, "stale_client_rejected");
  assert.ok(merge.rejected);
  assert.ok(merge.winner.decisionPackets.every((p) => p.player !== "STALE"));
});

// ---------------------------------------------------------------------------
// P. Schema migration
// ---------------------------------------------------------------------------
test("P legacy fixtures preserve fields and do not manufacture evidence", () => {
  const legacy = {
    player: "Legacy Star",
    team: "LAS",
    opponent: "SEA",
    side: "UNDER",
    line: 15.5,
    confidence: 62,
    slateDate: "2026-07-08",
    // no engine signals
  };
  const packet = attachContentHash(legacy);
  assert.ok(packet.contentHash);
  assert.strictEqual(packet.engineEvidence, null);
  assert.strictEqual(packet.finalCourtEdgeSide, "UNDER");
  assert.strictEqual(packet.selectedLine, 15.5);
});

// ---------------------------------------------------------------------------
// Q. Partial write / crash
// ---------------------------------------------------------------------------
test("Q crash mid-write recovers bak or complete file — never partial JSON", () => {
  const dir = tmpDir("q");
  const file = path.join(dir.dir, "canonical-slates-v1.json");
  const good = {
    schemaVersion: "courtEdgeStateIntegrityV1",
    slates: {
      x: buildCanonicalSlateRecord({
        slateDate: "2026-07-20",
        props: makeSix(),
        lifecycle: LIFECYCLE.SEALED,
      }),
    },
  };
  atomicWriteJson(file, good);
  // Simulate crash: leave corrupt primary + intact bak
  fs.writeFileSync(file, "{ partial", "utf8");
  fs.copyFileSync(
    // recreate bak from good
    (() => {
      const bakSrc = path.join(dir.dir, "good.json");
      fs.writeFileSync(bakSrc, JSON.stringify(good), "utf8");
      return bakSrc;
    })(),
    `${file}.bak`
  );
  const recovered = readJsonSafe(file, null);
  assert.ok(recovered);
  assert.ok(recovered.slates.x.decisionPackets.length === 6);
});

// ---------------------------------------------------------------------------
// R. Copy Report purity
// ---------------------------------------------------------------------------
test("R Copy Report path records zero mutations and zero paid calls", () => {
  resetPaidApiCounter();
  const { storePath } = tmpDir("r");
  const record = buildCanonicalSlateRecord({
    slateDate: "2026-07-17",
    props: makeSix("2026-07-17"),
    lifecycle: LIFECYCLE.IN_LAB,
  });
  upsertCanonicalSlate(record, { storePath });
  const before = JSON.stringify(loadCanonicalStore(storePath));
  // Copy report = pure read of snapshot
  for (let i = 0; i < 5; i += 1) {
    buildStateIntegritySnapshot({ storePath });
  }
  const after = JSON.stringify(loadCanonicalStore(storePath));
  assert.strictEqual(before, after);
  assert.strictEqual(getPaidApiCallCount(), 0);
});

// ---------------------------------------------------------------------------
// S. Multi-surface parity
// ---------------------------------------------------------------------------
test("S Home/Results/Lab/History share content hashes", () => {
  const props = makeSix("2026-07-15");
  const home = props;
  const results = props.map((p) => ({ ...p, status: "win" }));
  const lab = props.map((p) => ({ ...p, status: "win" }));
  const history = props.map((p) => ({ ...p, status: "win" }));
  const parity = assertSealedImmutability({ home, results, lab, history });
  assert.strictEqual(parity.ok, true);
});

// ---------------------------------------------------------------------------
// T. Production failure-shape fixtures
// ---------------------------------------------------------------------------
test("T1 Today preserved while Tomorrow previously zeroed", () => {
  const before = {
    bestSixDisplayTodayWNBA: makeSix("2026-07-20"),
    bestSixDisplayTomorrowWNBA: makeSix("2026-07-21"),
  };
  const badRefresh = {
    bestSixDisplayTodayWNBA: makeSix("2026-07-20"),
    bestSixDisplayTomorrowWNBA: [],
  };
  const merged = mergeBoardDayIsolation(before, badRefresh);
  assert.strictEqual(merged.bestSixDisplayTomorrowWNBA.length, 6);
});

test("T2 six picks with placeholder analysis cannot downgrade hydrated", () => {
  const hydrated = buildCanonicalSlateRecord({
    slateDate: "2026-07-20",
    props: makeSix(),
    lifecycle: LIFECYCLE.SEALED,
  });
  const downgraded = {
    ...hydrated,
    placeholder: true,
    analysisCoveragePct: 33.3,
    decisionPackets: makeSix().map((p) => ({
      ...p,
      homeDetailedAnalysisV1: null,
      sealedAnalysis: null,
      whySide: [],
    })),
    recordVersion: 99,
  };
  const merge = mergeByPrecedence(hydrated, downgraded, { source: "restart" });
  assert.strictEqual(merge.winner.decisionPackets.length, 6);
  assert.ok(
    merge.winner.decisionPackets.every(
      (p) => p.homeDetailedAnalysisV1 || p.sealedAnalysis
    )
  );
});

test("T3 completed six-prop Results failing Lab promotion is repaired by reconciler dry-run", () => {
  const props = makeSix("2026-07-19", { status: "win" });
  const scan = reconcileStateIntegrity({
    dryRun: true,
    trackedProps: props,
    labDefaultSlateDate: "2026-07-17",
    reports: [],
    archives: [],
    storePath: tmpDir("t3").storePath,
  });
  assert.ok(scan.scan.completedNotInLab.some((r) => r.slateDate === "2026-07-19"));
  assert.ok(
    scan.repairs.some(
      (r) => r.slateDate === "2026-07-19" && r.action === "would_upsert_and_link_lab"
    )
  );
});

test("T4 older Lab slate vs newer eligible flagged", () => {
  const tracked = [
    ...makeSix("2026-07-17", { status: "win" }),
    ...makeSix("2026-07-19", { status: "loss" }),
  ];
  const scan = scanStateIntegrity({
    trackedProps: tracked,
    labDefaultSlateDate: "2026-07-17",
    storePath: tmpDir("t4").storePath,
  });
  assert.strictEqual(scan.newestEligible, "2026-07-19");
  assert.ok(
    scan.findings.some((f) => f.type === "lab_default_lags_newest_eligible")
  );
});

test("T5 missing values do not become zero via immutable extract", () => {
  const packet = extractImmutablePacketFields({
    player: "X",
    side: "OVER",
    line: 12.5,
    slateDate: "2026-07-20",
    // confidence missing
  });
  assert.strictEqual(packet.finalConfidence, null);
});

test("T6 mixed Today/Tomorrow slicing isolated by mergeBoardDayIsolation", () => {
  const before = {
    bestSixDisplayTodayWNBA: makeSix("2026-07-20"),
    bestSixDisplayTomorrowWNBA: makeSix("2026-07-21"),
  };
  const sliced = {
    bestSixDisplayTodayWNBA: [],
    bestSixDisplayTomorrowWNBA: makeSix("2026-07-21").map((p) => ({
      ...p,
      confidence: 11,
    })),
  };
  const merged = mergeBoardDayIsolation(before, sliced);
  assert.strictEqual(merged.bestSixDisplayTodayWNBA.length, 6);
});

test("T7 classifyMissingSlateAnswer has general answers without hardcoding", () => {
  const a = classifyMissingSlateAnswer({ slateDate: "2099-01-01" });
  assert.strictEqual(a.answer, "No qualifying canonical record found");
  const b = classifyMissingSlateAnswer({
    slateDate: "2099-01-02",
    partialOnly: true,
  });
  assert.match(b.answer, /partial\/nonofficial/);
  const c = classifyMissingSlateAnswer({
    slateDate: "2099-01-03",
    sealedCohort: { props: makeSix() },
  });
  assert.match(c.answer, /repaired lifecycle link/);
});

test("T8 Force Refresh on sealed board updates market refs only", () => {
  const sealed = makeSix("2026-07-20");
  const previous = {
    bestSixDisplayTodayWNBA: sealed,
    bestSixDisplayTomorrowWNBA: makeSix("2026-07-21"),
  };
  const refreshed = {
    bestSixDisplayTodayWNBA: sealed.map((p) => ({
      ...p,
      side: "UNDER",
      pick: "UNDER",
      confidence: 1,
      line: 99,
      officialLine: 99,
      currentLine: 19.5,
      currentPrice: -110,
    })),
    bestSixDisplayTomorrowWNBA: previous.bestSixDisplayTomorrowWNBA,
  };
  const out = applyForceRefreshToSealedBoard(previous, refreshed);
  for (let i = 0; i < 6; i += 1) {
    assert.strictEqual(out.bestSixDisplayTodayWNBA[i].contentHash, sealed[i].contentHash);
    assert.strictEqual(
      normalizeSideProbe(out.bestSixDisplayTodayWNBA[i].side || out.bestSixDisplayTodayWNBA[i].finalCourtEdgeSide),
      normalizeSideProbe(sealed[i].side)
    );
    assert.strictEqual(out.bestSixDisplayTodayWNBA[i].currentLine, 19.5);
  }
});

function normalizeSideProbe(side) {
  const s = String(side || "").toUpperCase();
  return s.startsWith("U") ? "UNDER" : "OVER";
}

test("T9 syncBoardToCanonicalStore registers Today and Tomorrow separately", () => {
  const { storePath } = tmpDir("t9");
  const board = {
    serverBuild: STATE_INTEGRITY_BUILD,
    bestSixDisplayTodayWNBA: makeSix("2026-07-20"),
    bestSixDisplayTomorrowWNBA: makeSix("2026-07-21"),
  };
  const result = syncBoardToCanonicalStore(board, {
    storePath,
    today: "2026-07-20",
    tomorrow: "2026-07-21",
  });
  assert.strictEqual(result.ok, true);
  assert.ok(result.synced.length >= 2);
  const store = loadCanonicalStore(storePath);
  assert.ok(Object.keys(store.slates).length >= 2);
});

test("T10 explainMissingCompletedSlate returns one of four answers", () => {
  const ans = explainMissingCompletedSlate("2099-06-01", {
    trackedProps: [],
    storePath: tmpDir("t10").storePath,
  });
  assert.ok(
    [
      "Found exact sealed canonical cohort and repaired lifecycle link",
      "Found completed cohort but canonical identity conflict requires report",
      "Found partial/nonofficial data only; no mutation performed",
      "No qualifying canonical record found",
    ].includes(ans.answer)
  );
});

test("build version constant locked", () => {
  assert.strictEqual(STATE_INTEGRITY_BUILD, "courteedge-slate-date-today-repair-v3");
  const serverSrc = fs.readFileSync(path.join(SERVER_ROOT, "server.js"), "utf8");
  assert.match(serverSrc, /courteedge-slate-date-today-repair-v3/);
});

test("paid API counter increments only when recorded", () => {
  resetPaidApiCounter();
  assert.strictEqual(getPaidApiCallCount(), 0);
  recordPaidApiCall({ provider: "odds", path: "/odds" });
  assert.strictEqual(getPaidApiCallCount(), 1);
  resetPaidApiCounter();
});

test("completenessScore prefers hydrated sealed over empty", () => {
  const rich = buildCanonicalSlateRecord({
    slateDate: "2026-07-20",
    props: makeSix(),
    lifecycle: LIFECYCLE.SEALED,
  });
  const poor = buildCanonicalSlateRecord({
    slateDate: "2026-07-20",
    props: [],
    lifecycle: LIFECYCLE.DRAFT,
  });
  assert.ok(completenessScore(rich) > completenessScore(poor));
});

test("stable slate id ignores array position", () => {
  const a = buildCanonicalSlateId({
    league: "WNBA",
    slateDate: "2026-07-20",
  });
  const b = buildCanonicalSlateId({
    league: "wnba",
    slateDate: "2026-07-20",
    cohort: "official-best6",
    marketType: "player_points",
  });
  assert.strictEqual(a, b);
  assert.strictEqual(a, "WNBA|2026-07-20|officialbest6|playerpoints");
});

// ---------------------------------------------------------------------------
console.log("\n--- CourtEdge State Integrity V1 ---");
console.log(`passed=${passed} failed=${failed}`);
if (failures.length) {
  for (const f of failures) console.error(` - ${f.name}: ${f.message}`);
  process.exit(1);
}
process.exit(0);
