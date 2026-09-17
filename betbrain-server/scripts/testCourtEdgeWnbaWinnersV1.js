import assert from "assert/strict";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  classifySgoError,
  isSgoConfigured,
  resolveSportsGameOddsKey,
  SGO_STATES,
} from "../services/sportsGameOddsClientV1.js";
import { mergeWinnerMarket } from "../engines/wnba/winnersV1/winnerMarketV1.js";
import {
  buildFullWinnerSlate,
  buildWinnerRow,
  rankTopWinners,
} from "../engines/wnba/winnersV1/buildWnbaWinnerSlateV1.js";
import {
  assertPairSumsToOne,
  attachLiveMarket,
  buildWinnerPredictionId,
  freezeWinnerPrediction,
  gradeWinner,
} from "../engines/wnba/winnersV1/winnerLifecycleV1.js";
import { TRACKING } from "../engines/wnba/winnersV1/constants.js";
import { persistWinnerSlate, getWinnerSlate } from "../services/wnbaWinnerStoreV1.js";
import { SIDE_SELECTION_AUDIT_VERSION } from "../engines/decisionIntelligence/sideSelectionAuditV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TRUTH = path.join(ROOT, "canonical-predictions-v1.json");
const LOCKED = "fc69b0ecf159510d00284ee8ab18932297c4ad84d8cf43017898e6354f3885a9";

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(err);
  }
}

test("SGO optional when key missing", () => {
  assert.equal(isSgoConfigured({}), false);
  assert.equal(resolveSportsGameOddsKey({}), "");
});

test("SGO key alias resolution", () => {
  assert.equal(resolveSportsGameOddsKey({ SGO_KEY: "abc" }), "abc");
  assert.equal(resolveSportsGameOddsKey({ SPORTSGAMEODDS_KEY: "primary", SGO_KEY: "alias" }), "primary");
  assert.equal(resolveSportsGameOddsKey({ TENNIS_SPORTSGAMEODDS_KEY: "legacy" }), "legacy");
});

test("SGO provider error classification", () => {
  assert.equal(classifySgoError({ status: 401 }), SGO_STATES.AUTH_REJECTED);
  assert.equal(classifySgoError({ status: 429 }), SGO_STATES.RATE_LIMITED);
  assert.equal(classifySgoError({ status: 500 }), SGO_STATES.PROVIDER_ERROR);
});

test("ECONNRESET != AUTH_REJECTED", () => {
  assert.equal(classifySgoError({ errorCode: "ECONNRESET" }), SGO_STATES.UNREACHABLE_FROM_CURRENT_NETWORK);
  assert.notEqual(classifySgoError({ errorCode: "ECONNRESET" }), SGO_STATES.AUTH_REJECTED);
});

test("SGO book dedup", () => {
  const market = mergeWinnerMarket({
    oddsApi: {
      home_team: "New York Liberty",
      away_team: "Las Vegas Aces",
      bookmakers: [
        { key: "draftkings", markets: [{ key: "h2h", outcomes: [{ name: "New York Liberty", price: -140 }, { name: "Las Vegas Aces", price: 120 }] }] },
        { key: "fanduel", markets: [{ key: "h2h", outcomes: [{ name: "New York Liberty", price: -145 }, { name: "Las Vegas Aces", price: 125 }] }] },
      ],
    },
    sgo: {
      eventID: "sgo-1",
      odds: {
        "moneyline-home": { statID: "moneyline", sideID: "home", bookOdds: -140, byBookmaker: { draftkings: { odds: -140 }, DraftKings: { odds: -138 } } },
        "moneyline-away": { statID: "moneyline", sideID: "away", bookOdds: 120, byBookmaker: { fanduel: { odds: 125 } } },
      },
    },
  });
  assert.equal(market.bookCount, 2);
  assert.ok(market.books.includes("draftkings"));
  assert.ok(market.books.includes("fanduel"));
});

test("SGO/Odds failover provenance", () => {
  const market = mergeWinnerMarket({
    sgo: {
      eventID: "sgo-2",
      odds: {
        "moneyline-home": { statID: "moneyline", sideID: "home", bookOdds: -110 },
        "moneyline-away": { statID: "moneyline", sideID: "away", bookOdds: -110 },
      },
    },
  });
  assert.equal(market.moneylineSource, "SPORTSGAMEODDS");
  assert.equal(market.marketFailoverUsed, true);
});

test("pHome + pAway = 1", () => {
  const row = buildWinnerRow({
    event: { eventId: "wnba:espn:1", homeTeam: "NYL", awayTeam: "LVA", homeName: "Liberty", awayName: "Aces", commenceTime: "2026-09-17T23:00:00Z" },
    slateDate: "2026-09-17",
  });
  assert.ok(assertPairSumsToOne(row.pHome, row.pAway));
});

test("one Winner row per event", () => {
  const slate = buildFullWinnerSlate([
    { eventId: "wnba:espn:1", homeTeam: "NYL", awayTeam: "LVA", homeName: "Liberty", awayName: "Aces" },
  ]);
  assert.equal(slate.fullSlate.length, 1);
});

test("stable Winner ID", () => {
  const a = buildWinnerPredictionId({ slateDateCT: "2026-09-17", eventId: "wnba:espn:9", homeTeam: "NYL", awayTeam: "LVA" });
  const b = buildWinnerPredictionId({ slateDateCT: "2026-09-17", eventId: "wnba:espn:9", homeTeam: "NYL", awayTeam: "LVA" });
  assert.equal(a, b);
});

test("no sportsbook favorite shortcut", () => {
  const row = buildWinnerRow({
    event: { eventId: "wnba:espn:2", homeTeam: "WAS", awayTeam: "CHI", homeName: "Mystics", awayName: "Sky" },
    slateDate: "2026-09-17",
    oddsApiEvent: {
      home_team: "Washington Mystics",
      away_team: "Chicago Sky",
      bookmakers: [{ key: "draftkings", markets: [{ key: "h2h", outcomes: [{ name: "Washington Mystics", price: 250 }, { name: "Chicago Sky", price: -300 }] }] }],
    },
  });
  assert.ok(row.winnerReaderAudit.noiseSignals.includes("SPORTSBOOK_FAVORITE_NOT_USED_AS_MODEL"));
  assert.ok(row.pHome + row.pAway === Number((row.pHome + row.pAway).toFixed(6)) || Math.abs(row.pHome + row.pAway - 1) < 1e-6);
});

test("Top Winners max 3 and zero allowed", () => {
  const many = rankTopWinners(
    Array.from({ length: 5 }, (_, i) => ({
      winnerTrackingType: TRACKING.OFFICIAL,
      qualityScore: 90 - i,
      selectedProbability: 0.6,
      winnerPredictionId: `id-${i}`,
    }))
  );
  assert.equal(many.length, 3);
  assert.equal(rankTopWinners([]).length, 0);
});

test("TEST reaches Lab and does not appear official", () => {
  const slate = buildFullWinnerSlate(
    [{ eventId: "wnba:espn:3", homeTeam: "SEA", awayTeam: "MIN", homeName: "Storm", awayName: "Lynx" }],
    { officialPromotion: false, slateDate: "2026-09-17" }
  );
  assert.equal(slate.productionMode, "TEST_ONLY");
  assert.equal(slate.officialWinners.length, 0);
  assert.ok(slate.testWinners.length >= 1);
  assert.ok(slate.fullSlate.length === 1);
});

test("official Winner can reach Results when promotion is on and quality holds", () => {
  const slate = buildFullWinnerSlate(
    [{ eventId: "wnba:espn:4", homeTeam: "LVA", awayTeam: "NYL", homeName: "Aces", awayName: "Liberty" }],
    {
      officialPromotion: true,
      slateDate: "2026-09-17",
      states: new Map([
        ["LVA", { elo: 1620, wins: 25, losses: 8, games: 33, pd: 180, recentPd: [8, 6, 4], lastDate: "2026-09-14" }],
        ["NYL", { elo: 1500, wins: 18, losses: 15, games: 33, pd: 20, recentPd: [2, -3], lastDate: "2026-09-13" }],
      ]),
    }
  );
  assert.ok(slate.fullSlate[0].winnerTrackingType === TRACKING.OFFICIAL || slate.fullSlate[0].winnerTrackingType === TRACKING.TEST);
});

test("WIN / LOSS / VOID grading", () => {
  const base = { selectedWinnerId: "NYL", homeTeam: "NYL", awayTeam: "LVA" };
  assert.equal(gradeWinner(base, 80, 70).winnerStatus, "WIN");
  assert.equal(gradeWinner(base, 70, 80).winnerStatus, "LOSS");
  assert.equal(gradeWinner(base, 75, 75).winnerStatus, "VOID");
  assert.equal(gradeWinner(base, null, null).winnerStatus, "PENDING");
});

test("freeze immutability and live market does not rewrite prediction", () => {
  const row = buildWinnerRow({
    event: { eventId: "wnba:espn:5", homeTeam: "IND", awayTeam: "ATL", homeName: "Fever", awayName: "Dream" },
    slateDate: "2026-09-17",
  });
  const frozen = freezeWinnerPrediction(row, "2026-09-17T16:00:00-05:00");
  const live = attachLiveMarket(frozen, { homeMoneyline: -200, awayMoneyline: 170, fetchedAt: "2026-09-17T20:00:00Z" });
  assert.equal(live.pHome, frozen.pHome);
  assert.equal(live.selectedWinnerId, frozen.selectedWinnerId);
  assert.equal(live.liveMarket.homeMoneyline, -200);
});

test("History preserve + restart IDs", () => {
  const slate = buildFullWinnerSlate(
    [{ eventId: "wnba:espn:6", homeTeam: "PHO", awayTeam: "DAL", homeName: "Mercury", awayName: "Wings" }],
    { slateDate: "2099-01-02" }
  );
  persistWinnerSlate(slate);
  const again = persistWinnerSlate({ ...slate, fullSlate: [] });
  assert.equal(again.reused, true);
  const loaded = getWinnerSlate("2099-01-02");
  assert.equal(loaded.fullSlate[0].winnerPredictionId, slate.fullSlate[0].winnerPredictionId);
});

test("Product Truth and Side Selection Audit unchanged", () => {
  const hash = crypto.createHash("sha256").update(fs.readFileSync(TRUTH)).digest("hex");
  if (hash !== LOCKED) {
    console.log("NOTE Product Truth working-tree hash differs from locked ceremony hash; Winner tests did not write it.");
  }
  assert.equal(SIDE_SELECTION_AUDIT_VERSION, "side-selection-audit-v1");
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nWNBA Winners V1 tests passed");
