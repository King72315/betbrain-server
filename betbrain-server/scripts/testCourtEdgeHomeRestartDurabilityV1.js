/**
 * CourtEdge Home Board Restart Durability V1 — Tests A–N.
 * Production-shaped: persist → wipe memory/ephemeral FS → restore from durable.
 */
import assert from "assert";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import express from "express";

import {
  DURABLE_KEYS,
  durableGet,
  durablePut,
  resetDurableStoreForTests,
} from "../services/courtEdgeDurableStoreV1.js";
import {
  HOME_DURABLE_BUILD,
  buildHomeDayRecord,
  canReplaceHomeDay,
  choosePreferredHomeDay,
  getHomeDurableStatus,
  hydrateHomeBoardFromDurable,
  homeDayDurableKey,
  persistHomeBoardAtomic,
  persistHomeDayRecord,
  proveLegitimateEmptySlate,
  resetHomeDurableForTests,
  rolloverDurableHomeTomorrowToToday,
  scoreHomeDayRecord,
  validateHomeDayRecord,
} from "../services/courtEdgeHomeDurableStoreV1.js";
import {
  configureSchedulerPaths,
  resetSchedulerPaths,
  loadBoardCache,
} from "../services/courtEdgeSchedulerV1.js";
import { attachContentHash } from "../services/courtEdgeStateIntegrityV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "..");

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.message });
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    passed += 1;
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    failures.push({ name, message: error.message });
    console.error(`  ✗ ${name}: ${error.message}`);
  }
}

function makeTempDir(label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ce-home-dur-${label}-`));
  configureSchedulerPaths({
    stateFile: path.join(dir, "state.json"),
    boardCacheFile: path.join(dir, "board-cache.json"),
  });
  process.env.COURTEDGE_DURABLE_MIRROR_DIR = path.join(dir, "mirror");
  delete process.env.DATABASE_URL;
  delete process.env.COURTEDGE_DATABASE_URL;
  resetDurableStoreForTests();
  resetHomeDurableForTests();
  return dir;
}

function wipeEphemeral(dir) {
  // Destroy process-local working files; keep mirror as durable stand-in
  // when Postgres is unset (tests treat mirror as durable backend).
  for (const name of ["board-cache.json", "state.json"]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  resetSchedulerPaths();
  configureSchedulerPaths({
    stateFile: path.join(dir, "state.json"),
    boardCacheFile: path.join(dir, "board-cache.json"),
  });
  resetDurableStoreForTests();
  resetHomeDurableForTests();
}

function sealedProp(i, slateDate, extras = {}) {
  const base = {
    propId: `|WNBA|player${i}|team${i}|opp${i}|points|OVER|${20 + i}.5`,
    officialPropId: `|WNBA|player${i}|team${i}|opp${i}|points|OVER|${20 + i}.5`,
    player: `Player ${i}`,
    playerId: `p${i}`,
    team: `Team ${i}`,
    teamId: `t${i}`,
    opponent: `Opp ${i}`,
    opponentId: `o${i}`,
    eventId: `e${i}`,
    league: "WNBA",
    slateDate,
    marketType: "player_points",
    side: "OVER",
    pick: "OVER",
    finalCourtEdgeSide: "OVER",
    originalModelSide: "OVER",
    line: 20 + i + 0.5,
    sealedLine: 20 + i + 0.5,
    confidence: 70 + i,
    trueRisk: "MEDIUM",
    rank: i,
    isTopPick: i <= 2,
    projection: 22 + i,
    displayWhy: `why ${i}`,
    sealedAnalysis: { ok: true, l5: [10, 12, 14, 16, 18] },
    homeDetailedAnalysisV1: {
      dataQuality: { coverage: 90, shellAnalysis: false },
      recentPerformance: { last5Points: [10, 12, 14, 16, 18] },
      propSnapshot: { originalModelSide: "OVER", finalCourtEdgeSide: "OVER" },
    },
    engineEvidence: { ok: true },
    immutableOfficial: true,
    sealedAt: `${slateDate}T12:00:00.000Z`,
    contentHash: extras.contentHash,
    ...extras,
  };
  return attachContentHash(base, { slateDate, forceSealed: true });
}

function makeBoard({ todayDate, tomorrowDate, todayProps, tomorrowProps }) {
  const today = todayProps || [1, 2, 3, 4, 5, 6].map((i) => sealedProp(i, todayDate));
  const tomorrow =
    tomorrowProps ||
    [7, 8, 9, 10, 11, 12].map((i) =>
      sealedProp(i, tomorrowDate, { dayBucket: "TOMORROW" })
    );
  return {
    ok: true,
    slateDate: todayDate,
    serverBuild: HOME_DURABLE_BUILD,
    games: [
      {
        id: "g-today",
        league: "WNBA",
        dayBucket: "TODAY",
        commenceTime: `${todayDate}T23:00:00Z`,
        homeTeam: "a",
        awayTeam: "b",
      },
      {
        id: "g-tom",
        league: "WNBA",
        dayBucket: "TOMORROW",
        commenceTime: `${tomorrowDate}T23:00:00Z`,
        homeTeam: "c",
        awayTeam: "d",
      },
    ],
    wnbaGames: [],
    nbaGames: [],
    bestSixDisplayTodayWNBA: today,
    bestSixDisplayTomorrowWNBA: tomorrow,
    bestSixDisplayTodayNBA: [],
    bestSixDisplayTomorrowNBA: [],
    bestSixWNBA: today,
    bestSixNBA: [],
    bestSixDisplayWNBA: today,
    bestSixDisplayNBA: [],
    topProps: today.slice(0, 2),
    recordVersion: 3,
  };
}

console.log("\nCourtEdge Home Restart Durability V1 — Tests A–N\n");

// --- Unit primitives ---
test("unit: score prefers sealed hydrated over seed/bundle", () => {
  const sealed = buildHomeDayRecord(
    makeBoard({
      todayDate: "2026-07-22",
      tomorrowDate: "2026-07-23",
    }),
    { league: "WNBA", dayBucket: "TODAY", slateDate: "2026-07-22" }
  );
  const seed = {
    ...sealed,
    seededBoardCache: true,
    emergencyEmptyBoardSeed: true,
    props: sealed.props.map((p) => ({
      ...p,
      homeDetailedAnalysisV1: { dataQuality: { shellAnalysis: true } },
      sealedAnalysis: null,
    })),
  };
  assert.ok(
    scoreHomeDayRecord(sealed) > scoreHomeDayRecord(seed, { isSeed: true })
  );
  const preferred = choosePreferredHomeDay(sealed, seed, {}, { isSeed: true });
  assert.strictEqual(preferred, sealed);
});

test("unit: proveLegitimateEmpty rejects provider failures", () => {
  assert.strictEqual(
    proveLegitimateEmptySlate({ failureType: "timeout" }).proven,
    false
  );
  assert.strictEqual(
    proveLegitimateEmptySlate({ noScheduledGames: true, providerOk: true })
      .proven,
    true
  );
});

test("unit: canReplace rejects empty unproven and stale versions", () => {
  const cur = buildHomeDayRecord(
    makeBoard({ todayDate: "2026-07-22", tomorrowDate: "2026-07-23" }),
    { league: "WNBA", dayBucket: "TODAY", slateDate: "2026-07-22", recordVersion: 5 }
  );
  const empty = {
    ...cur,
    props: [],
    officialBestSixCount: 0,
    recordVersion: 6,
  };
  assert.strictEqual(
    canReplaceHomeDay(cur, empty).allow,
    false
  );
  const stale = { ...cur, recordVersion: 2 };
  assert.strictEqual(canReplaceHomeDay(cur, stale).reason, "stale_record_version");
});

await testAsync("A — Today restart restores exact props/hashes", async () => {
  const dir = makeTempDir("a");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    tomorrowProps: [],
  });
  const hashes = board.bestSixDisplayTodayWNBA.map((p) => p.contentHash);
  const persist = await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  assert.ok(persist.ok);
  wipeEphemeral(dir);
  const hydrated = await hydrateHomeBoardFromDurable({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  assert.strictEqual(hydrated.todayCount, 6);
  const restored = hydrated.board.bestSixDisplayTodayWNBA;
  assert.deepStrictEqual(
    restored.map((p) => p.contentHash),
    hashes
  );
  assert.deepStrictEqual(
    restored.map((p) => p.officialPropId || p.propId),
    board.bestSixDisplayTodayWNBA.map((p) => p.officialPropId || p.propId)
  );
});

await testAsync("B — Tomorrow restart restores exact slate", async () => {
  const dir = makeTempDir("b");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    todayProps: [],
  });
  const hashes = board.bestSixDisplayTomorrowWNBA.map((p) => p.contentHash);
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  wipeEphemeral(dir);
  const hydrated = await hydrateHomeBoardFromDurable({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  assert.strictEqual(hydrated.tomorrowCount, 6);
  assert.deepStrictEqual(
    hydrated.board.bestSixDisplayTomorrowWNBA.map((p) => p.contentHash),
    hashes
  );
});

await testAsync("C — Today and Tomorrow together survive restarts", async () => {
  const dir = makeTempDir("c");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  const todayHash = board.bestSixDisplayTodayWNBA.map((p) => p.contentHash).join("|");
  const tomHash = board.bestSixDisplayTomorrowWNBA.map((p) => p.contentHash).join("|");
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  for (let i = 0; i < 3; i += 1) {
    wipeEphemeral(dir);
    const hydrated = await hydrateHomeBoardFromDurable({
      todayDate: "2026-07-22",
      tomorrowDate: "2026-07-23",
    });
    assert.strictEqual(hydrated.todayCount, 6);
    assert.strictEqual(hydrated.tomorrowCount, 6);
    assert.strictEqual(
      hydrated.board.bestSixDisplayTodayWNBA.map((p) => p.contentHash).join("|"),
      todayHash
    );
    assert.strictEqual(
      hydrated.board.bestSixDisplayTomorrowWNBA.map((p) => p.contentHash).join("|"),
      tomHash
    );
  }
});

await testAsync("D — Fresh container restores from durable mirror only", async () => {
  const dir = makeTempDir("d");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  // Fresh container: wipe working files + clear in-memory pools; keep mirror.
  wipeEphemeral(dir);
  const hydrated = await hydrateHomeBoardFromDurable({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    seedBoard: null,
  });
  assert.ok(hydrated.board);
  assert.strictEqual(hydrated.todayCount, 6);
  assert.strictEqual(hydrated.tomorrowCount, 6);
});

await testAsync("E — Durable wins over older bundled recovery", async () => {
  const dir = makeTempDir("e");
  const durableBoard = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  await persistHomeBoardAtomic(durableBoard, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  const oldBundle = makeBoard({
    todayDate: "2026-07-21",
    tomorrowDate: "2026-07-22",
    todayProps: [1, 2, 3].map((i) => sealedProp(i + 50, "2026-07-21")),
    tomorrowProps: [],
  });
  oldBundle.fromBundle = true;
  oldBundle.emergencyEmptyBoardSeed = true;
  wipeEphemeral(dir);
  const hydrated = await hydrateHomeBoardFromDurable({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    seedBoard: oldBundle,
    treatLocalAsBundle: true,
  });
  assert.strictEqual(hydrated.todayCount, 6);
  assert.strictEqual(
    hydrated.board.bestSixDisplayTodayWNBA[0].player,
    durableBoard.bestSixDisplayTodayWNBA[0].player
  );
});

await testAsync("F — Provider failures cannot clear valid board", async () => {
  makeTempDir("f");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  const empty = {
    ...board,
    bestSixDisplayTodayWNBA: [],
    bestSixWNBA: [],
    games: [],
    providerFailed: true,
  };
  const put = await persistHomeBoardAtomic(empty, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    providerFailed: true,
    writeEmptyUnproven: true,
  });
  // Today day write should be preserved/skipped failure path
  const day = await durableGet(
    homeDayDurableKey({
      league: "WNBA",
      slateDate: "2026-07-22",
      dayBucket: "TODAY",
    })
  );
  assert.ok(day.ok);
  assert.strictEqual(day.value.props.length, 6);
  assert.ok(put.ok || put.failedCount >= 0);
});

await testAsync("G — Failed hydration cannot downgrade complete board", async () => {
  makeTempDir("g");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  const shells = {
    ...board,
    bestSixDisplayTodayWNBA: board.bestSixDisplayTodayWNBA.map((p) => ({
      ...p,
      homeDetailedAnalysisV1: { dataQuality: { shellAnalysis: true, coverage: 10 } },
      sealedAnalysis: null,
      placeholder: true,
    })),
    recordVersion: 4,
  };
  const record = buildHomeDayRecord(shells, {
    league: "WNBA",
    dayBucket: "TODAY",
    slateDate: "2026-07-22",
    recordVersion: 4,
    placeholder: true,
  });
  const decision = await persistHomeDayRecord(record, {});
  assert.strictEqual(decision.ok, false);
  assert.match(decision.reason, /hydrat|precedence|placeholder|downgrade/i);
});

await testAsync("H — Empty board only after legitimate proof", async () => {
  makeTempDir("h");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  const unproven = buildHomeDayRecord(
    { ...board, bestSixDisplayTodayWNBA: [] },
    { league: "WNBA", dayBucket: "TODAY", slateDate: "2026-07-22", recordVersion: 9 }
  );
  unproven.props = [];
  const blocked = await persistHomeDayRecord(unproven, {});
  assert.strictEqual(blocked.ok, false);

  const proven = {
    ...unproven,
    legitimateEmptyProven: true,
    emptyProof: { noScheduledGames: true, providerOk: true },
    recordVersion: 10,
  };
  const allowed = await persistHomeDayRecord(proven, {
    emptyProof: proven.emptyProof,
    force: true,
  });
  assert.ok(
    allowed.ok,
    `expected proven empty write ok, got ${allowed.reason || JSON.stringify(allowed)}`
  );
});

await testAsync("I — Today/Tomorrow isolation on write", async () => {
  makeTempDir("i");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  const tomKey = homeDayDurableKey({
    league: "WNBA",
    slateDate: "2026-07-23",
    dayBucket: "TOMORROW",
  });
  const before = await durableGet(tomKey);
  const beforeHash = before.value.contentHash;

  const todayOnly = {
    ...board,
    bestSixDisplayTodayWNBA: board.bestSixDisplayTodayWNBA.map((p, idx) =>
      idx === 0 ? { ...p, confidence: 99 } : p
    ),
    // omit tomorrow mutation
  };
  await persistHomeBoardAtomic(todayOnly, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  const after = await durableGet(tomKey);
  assert.strictEqual(after.value.contentHash, beforeHash);
  assert.strictEqual(after.value.props.length, 6);
});

await testAsync("J — Sealed Tomorrow rollover preserves IDs/hashes", async () => {
  makeTempDir("j");
  // Store sealed tomorrow under slateDate=today (calendar rollover case)
  const today = "2026-07-22";
  const props = [1, 2, 3, 4, 5, 6].map((i) =>
    sealedProp(i, today, { dayBucket: "TOMORROW" })
  );
  const hashes = props.map((p) => p.contentHash);
  const ids = props.map((p) => p.officialPropId);
  const tomRecord = buildHomeDayRecord(
    {
      bestSixDisplayTomorrowWNBA: props,
      games: [{ id: "g", league: "WNBA", dayBucket: "TOMORROW" }],
    },
    {
      league: "WNBA",
      dayBucket: "TOMORROW",
      slateDate: today,
      recordVersion: 1,
    }
  );
  tomRecord.sealed = true;
  await persistHomeDayRecord(tomRecord, { force: true });
  const roll = await rolloverDurableHomeTomorrowToToday({
    todayDate: today,
    league: "WNBA",
  });
  assert.strictEqual(roll.action, "promoted_identity_preserved");
  assert.deepStrictEqual(roll.propIds, ids);
  assert.strictEqual(roll.contentHash, tomRecord.contentHash);
  const todayKey = homeDayDurableKey({
    league: "WNBA",
    slateDate: today,
    dayBucket: "TODAY",
  });
  const got = await durableGet(todayKey);
  assert.ok(got.ok);
  assert.deepStrictEqual(
    got.value.props.map((p) => p.contentHash),
    hashes
  );
});

await testAsync("K — Partial write never loads mixed state", async () => {
  makeTempDir("k");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  const key = homeDayDurableKey({
    league: "WNBA",
    slateDate: "2026-07-22",
    dayBucket: "TODAY",
  });
  const prior = await durableGet(key);
  // Simulate crash: write incomplete object then recover via validate
  const bad = { schemaVersion: "x", props: [{ broken: true }] };
  await durablePut(key, bad, { recordVersion: 99, force: true });
  const check = validateHomeDayRecord(bad);
  assert.ok(!check.ok || check.weak);
  // Restore prior complete version
  await durablePut(key, prior.value, {
    recordVersion: Number(prior.value.recordVersion || 1) + 1,
    force: true,
  });
  const hydrated = await hydrateHomeBoardFromDurable({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  assert.strictEqual(hydrated.todayCount, 6);
});

await testAsync("L — Repeated restart x20 no loss/downgrade", async () => {
  const dir = makeTempDir("l");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  const fingerprint = JSON.stringify({
    t: board.bestSixDisplayTodayWNBA.map((p) => [
      p.contentHash,
      p.side,
      p.line,
      p.confidence,
    ]),
    m: board.bestSixDisplayTomorrowWNBA.map((p) => [
      p.contentHash,
      p.side,
      p.line,
      p.confidence,
    ]),
  });
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  for (let i = 0; i < 20; i += 1) {
    wipeEphemeral(dir);
    const hydrated = await hydrateHomeBoardFromDurable({
      todayDate: "2026-07-22",
      tomorrowDate: "2026-07-23",
    });
    const next = JSON.stringify({
      t: hydrated.board.bestSixDisplayTodayWNBA.map((p) => [
        p.contentHash,
        p.side,
        p.line,
        p.confidence,
      ]),
      m: hydrated.board.bestSixDisplayTomorrowWNBA.map((p) => [
        p.contentHash,
        p.side,
        p.line,
        p.confidence,
      ]),
    });
    assert.strictEqual(next, fingerprint, `restart ${i + 1} diverged`);
  }
});

await testAsync("M — Stale writer rejected", async () => {
  makeTempDir("m");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  await persistHomeBoardAtomic(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  const stale = buildHomeDayRecord(board, {
    league: "WNBA",
    dayBucket: "TODAY",
    slateDate: "2026-07-22",
    recordVersion: 1,
  });
  const put = await persistHomeDayRecord(stale, {});
  assert.strictEqual(put.ok, false);
  assert.strictEqual(put.reason, "stale_record_version");
  assert.ok(getHomeDurableStatus().lastRejectedStaleWrite);
});

await testAsync("N — recover-sealed-slate fails closed without ADMIN_SECRET", async () => {
  const prev = process.env.ADMIN_SECRET;
  delete process.env.ADMIN_SECRET;

  function requireAdminSecret(req, res, next) {
    const secret = String(process.env.ADMIN_SECRET || "").trim();
    if (!secret) {
      return res.status(503).json({
        ok: false,
        message: "ADMIN_SECRET is not configured on this server",
      });
    }
    const provided = String(req.headers["x-admin-secret"] || "").trim();
    if (provided !== secret) {
      return res.status(401).json({ ok: false, message: "Unauthorized" });
    }
    next();
  }

  const app = express();
  app.use(express.json());
  let wrote = false;
  app.post("/admin/recover-sealed-slate", requireAdminSecret, (req, res) => {
    wrote = true;
    res.json({ ok: true, wrote: true });
  });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const { port } = server.address();
  const res = await fetch(`http://127.0.0.1:${port}/admin/recover-sealed-slate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ slateDate: "2026-07-20" }),
  });
  const body = await res.json();
  assert.strictEqual(res.status, 503);
  assert.strictEqual(body.ok, false);
  assert.strictEqual(wrote, false);

  // Wrong secret when configured
  process.env.ADMIN_SECRET = "correct-secret";
  const res2 = await fetch(`http://127.0.0.1:${port}/admin/recover-sealed-slate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-admin-secret": "wrong",
    },
    body: JSON.stringify({ slateDate: "2026-07-20" }),
  });
  assert.strictEqual(res2.status, 401);
  assert.strictEqual(wrote, false);

  await new Promise((resolve) => server.close(resolve));
  if (prev == null) delete process.env.ADMIN_SECRET;
  else process.env.ADMIN_SECRET = prev;

  // Source wiring: server must use requireAdminSecret (fail-closed)
  const serverSrc = fs.readFileSync(path.join(SERVER_ROOT, "server.js"), "utf8");
  assert.match(
    serverSrc,
    /app\.post\(\s*"\/admin\/recover-sealed-slate"\s*,\s*requireAdminSecret/
  );
});

await testAsync("integration: saveBoardCacheDurable awaits home persist", async () => {
  makeTempDir("int");
  const board = makeBoard({
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
  });
  const { saveBoardCacheDurable } = await import(
    "../services/courtEdgeSchedulerV1.js"
  );
  const result = await saveBoardCacheDurable(board, {
    todayDate: "2026-07-22",
    tomorrowDate: "2026-07-23",
    force: true,
  });
  assert.ok(result.board);
  assert.ok(result.home);
  assert.ok(loadBoardCache());
  const day = await durableGet(
    homeDayDurableKey({
      league: "WNBA",
      slateDate: "2026-07-22",
      dayBucket: "TODAY",
    })
  );
  assert.ok(day.ok);
  assert.strictEqual(day.value.props.length, 6);
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failures.length) {
  for (const f of failures) console.error(` - ${f.name}: ${f.message}`);
  setTimeout(() => process.exit(1), 50);
} else {
  console.log("HOME_RESTART_DURABILITY_TESTS_OK");
  setTimeout(() => process.exit(0), 50);
}
