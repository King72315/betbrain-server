import assert from "assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { normalizeWnbaTeam } from "../engines/wnba/winnersV1/constants.js";
import { walkForwardC, predictWinnerC, WINNER_C_TEMPERATURE } from "../engines/wnba/winnersV1/winnerModelC.js";
import { buildFullWinnerSlate, rankTopWinners } from "../engines/wnba/winnersV1/buildWnbaWinnerSlateV1.js";
import { TRACKING } from "../engines/wnba/winnersV1/constants.js";
import { selectOfficialMembershipV1 } from "../engines/courtEdgeControlPlaneV1/selectOfficialMembershipV1.js";
import { buildShadowBoards } from "../engines/wnba/shadow/rebAstShadowBoardV1.js";
import { persistShadowBoards, getShadowSlate, persistShadowBoardsFromGames } from "../services/courtEdgeMarketShadowStoreV1.js";
import { COURTEDGE_WINNER_C_PRODUCTION_V1 } from "../engines/courtEdgeEraV1.js";
import { isOfficialTrackingPick } from "../services/trackedPropService.js";
import {
  BLOCKED_MISSING_PLAYER_HISTORY,
  inspectPtsHistoryInputs,
  shouldBlockOfficialPtsPublication,
} from "../engines/courtEdgePtsHistoryGateV1.js";
import {
  persistWinnerSlate,
  getWinnerSlate,
  computeWinnerFreezeHash,
} from "../services/wnbaWinnerStoreV1.js";
import { sanitizeHomeBoardForLifecycle } from "../services/slateScopeService.js";
import {
  matchPlayerOnTonightRoster,
  parseEspnAthleteGameLog,
} from "../services/courtEdgeWnbaTonightRosterV1.js";
import {
  persistOfficialPtsFreeze,
  getOfficialPtsSlate,
  computeOfficialPtsFreezeHash,
  officialPtsBoardOverlay,
} from "../services/courtEdgeOfficialPtsStoreV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEAM_GAMES = path.join(ROOT, "research/courteedge-wnba-winners-v1/10-team-games.json");

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

test("Toronto Tempo cannot map to SEA", () => {
  assert.equal(normalizeWnbaTeam("Toronto Tempo"), "TOR");
  assert.equal(normalizeWnbaTeam("tempo"), "TOR");
  assert.equal(normalizeWnbaTeam("Seattle Storm"), "SEA");
  assert.equal(normalizeWnbaTeam("Toronto Storm"), null);
  assert.equal(normalizeWnbaTeam("torontostorm"), null);
});

test("Winner-C historical 2026 validation reproduces 189-89", () => {
  const games = JSON.parse(fs.readFileSync(TEAM_GAMES, "utf8"));
  const { rows } = walkForwardC(games);
  const val = rows.filter((r) => r.date >= "2026-01-01");
  let w = 0;
  let extreme = 0;
  for (const r of val) {
    const pickHome = r.pC >= 0.5;
    if (pickHome === r.homeWon) w += 1;
    const sel = pickHome ? r.pC : 1 - r.pC;
    if (sel >= 0.9) extreme += 1;
  }
  assert.equal(val.length, 278);
  assert.equal(w, 189);
  assert.equal(val.length - w, 89);
  assert.equal(extreme, 0);
});

test("Winner-C owns production on 2026-09-21 and V1 is forensic", () => {
  const slate = buildFullWinnerSlate(
    [{ eventId: "wnba:espn:era", homeTeam: "LVA", awayTeam: "NYL", homeName: "Aces", awayName: "Liberty" }],
    {
      slateDate: "2026-09-21",
      states: new Map([
        ["LVA", { elo: 1620, wins: 25, losses: 8, games: 33, pd: 180, pf: 2800, pa: 2500, recentPd: [8, 6, 4], lastDate: "2026-09-14" }],
        ["NYL", { elo: 1500, wins: 18, losses: 15, games: 33, pd: 20, pf: 2500, pa: 2480, recentPd: [2, -3], lastDate: "2026-09-13" }],
      ]),
    }
  );
  assert.equal(slate.productionMode, "WINNER_C_PRODUCTION");
  assert.equal(slate.fullSlate[0].modelVersion, COURTEDGE_WINNER_C_PRODUCTION_V1);
  assert.equal(slate.fullSlate[0].productionOwner, COURTEDGE_WINNER_C_PRODUCTION_V1);
  assert.ok(slate.fullSlate[0].forensicWinnerV1);
  assert.equal(slate.fullSlate[0].winnerTrackingType, TRACKING.OFFICIAL);
  assert.ok(slate.fullSlate[0].selectedProbability < 0.9);
  assert.equal(slate.fullSlate[0].featureSnapshot.components.temperature, WINNER_C_TEMPERATURE);
});

test("pre-era Winner slates remain V1 TEST unless promoted", () => {
  const slate = buildFullWinnerSlate(
    [{ eventId: "wnba:espn:old", homeTeam: "SEA", awayTeam: "MIN", homeName: "Storm", awayName: "Lynx" }],
    { officialPromotion: false, slateDate: "2026-09-17" }
  );
  assert.equal(slate.productionMode, "TEST_ONLY");
  assert.equal(slate.fullSlate[0].modelVersion, "courtedge-wnba-winner-model-v1");
});

test("unresolved team identity issues no Winner", () => {
  const rowSlate = buildFullWinnerSlate(
    [{ eventId: "wnba:espn:bad", homeTeam: "Toronto Storm", awayTeam: "MIN", homeName: "Toronto Storm", awayName: "Lynx" }],
    { slateDate: "2026-09-21" }
  );
  assert.equal(rowSlate.fullSlate[0].winnerTrackingType, TRACKING.NO_PICK);
});

test("Official membership demotes REB/AST without PTS refill", () => {
  const packets = [
    { propType: "POINTS", officialRankScore: 0.9, c2Risk: "LOW", boardCandidate: true, selectedSide: "UNDER", line: 18.5, playerName: "A", slateDate: "2026-09-21" },
    { propType: "POINTS", officialRankScore: 0.8, c2Risk: "LOW", boardCandidate: true, selectedSide: "OVER", line: 12.5, playerName: "B", slateDate: "2026-09-21" },
    { propType: "ASSISTS", officialRankScore: 0.95, c2Risk: "LOW", boardCandidate: true, selectedSide: "OVER", line: 5.5, playerName: "C", slateDate: "2026-09-21" },
    { propType: "REBOUNDS", officialRankScore: 0.94, c2Risk: "LOW", boardCandidate: true, selectedSide: "UNDER", line: 8.5, playerName: "D", slateDate: "2026-09-21" },
  ].map((p) => ({
    ...p,
    membership: { boardCandidate: true, directionAdmission: "PRIMARY", analysisEligible: true },
    risk: { risk: p.c2Risk },
    reliabilityProbability: p.officialRankScore,
  }));
  const result = selectOfficialMembershipV1(packets, { requestedSlateDate: "2026-09-21", forceLegacySelector: true });
  assert.ok(result.selectedPackets.every((p) => p.propType === "POINTS"));
  assert.equal(result.selectedPackets.length, 2);
  assert.ok(result.shadowDemotedCount >= 1);
});

test("empty shadow freeze is not immutable so a later complete board can persist", () => {
  const date = "2099-03-01";
  const shadowFile = path.join(ROOT, "data", "courtedge-shadow-reb-ast-v1.json");
  if (fs.existsSync(shadowFile)) {
    const cur = JSON.parse(fs.readFileSync(shadowFile, "utf8"));
    if (cur.slates) delete cur.slates[date];
    fs.writeFileSync(shadowFile, JSON.stringify(cur, null, 2));
  }
  const empty = persistShadowBoards({ slateDateCT: date, packets: [], fetchedAt: "2026-09-21T00:00:00Z" });
  assert.equal(empty.immutable, false);
  const filled = persistShadowBoards({
    slateDateCT: date,
    packets: [{ propType: "ASSISTS", playerName: "Z", line: 4.5, side: "OVER", projection: 5, last5: [{ minutes: 30, assists: 5 }] }],
    fetchedAt: "2026-09-21T00:01:00Z",
  });
  assert.equal(filled.ast.analyzed, 1);
  assert.equal(filled.immutable, true);
  assert.equal(getShadowSlate(date).ast.analyzed, 1);
});

test("shadow boards never mark official", () => {
  const boards = buildShadowBoards([
    { propType: "ASSISTS", playerName: "X", line: 4.5, side: "OVER", projection: 5.2, last5: [{ minutes: 30, assists: 5, rebounds: 3 }], seasonAssists: 4, seasonMinutes: 28 },
    { propType: "REBOUNDS", playerName: "Y", line: 7.5, side: "UNDER", projection: 6.8, last5: [{ minutes: 32, assists: 2, rebounds: 8 }], seasonRebounds: 7, seasonMinutes: 30 },
    { propType: "POINTS", playerName: "Z", line: 20, side: "OVER", projection: 22 },
  ]);
  assert.equal(boards.ast.analyzed, 1);
  assert.equal(boards.reb.analyzed, 1);
  assert.equal(boards.ast.rows[0].official, false);
  assert.equal(boards.ast.rows[0].label, "NOT OFFICIAL / RESEARCH ONLY");
  assert.ok(boards.ast.rows[0].candidates["AST-C"]);
  assert.ok(boards.reb.rows[0].candidates["REB-A"]);
});

test("era REB/AST never enter Official W/L even if officialSelected leaked", () => {
  assert.equal(
    isOfficialTrackingPick({
      slateDate: "2026-09-21",
      propType: "ASSISTS",
      officialSelected: true,
      trackingType: "OFFICIAL",
    }),
    false
  );
  assert.equal(
    isOfficialTrackingPick({
      slateDate: "2026-08-10",
      propType: "ASSISTS",
      officialSelected: true,
      trackingType: "OFFICIAL",
    }),
    true
  );
});

test("missing PTS history blocks Official publication", () => {
  const miss = inspectPtsHistoryInputs({ last5: [], seasonAverage: 0, playerState: {} });
  assert.equal(miss.hydrated, false);
  assert.equal(miss.blockReason, BLOCKED_MISSING_PLAYER_HISTORY);
  assert.equal(
    shouldBlockOfficialPtsPublication({
      propType: "POINTS",
      last5: [],
      seasonAverage: 0,
      last5Average: 0,
    }),
    true
  );
});

test("populated PTS history is not blocked", () => {
  const ok = inspectPtsHistoryInputs({
    last5: [{ points: 14 }, { points: 18 }, { points: 12 }],
    seasonAverage: 15.2,
    playerState: { seasonPoints: 15.2 },
  });
  assert.equal(ok.hydrated, true);
  assert.equal(
    shouldBlockOfficialPtsPublication({
      propType: "POINTS",
      last5: [{ points: 14 }],
      seasonAverage: 15,
    }),
    false
  );
});

test("Winner-C durable persist restores identical freezeHash after local wipe", () => {
  const slate = {
    slateDateCT: "2099-02-01",
    version: "COURTEDGE_WINNER_C_PRODUCTION_V1",
    productionMode: "WINNER_C_PRODUCTION",
    fullSlate: [
      {
        winnerPredictionId: "WNBA|WINNER|2099-02-01|x|ATL|NYL",
        selectedWinnerId: "ATL",
        selectedWinnerName: "Atlanta Dream",
        selectedProbability: 0.5326,
        pHome: 0.4674,
        pAway: 0.5326,
        modelVersion: "COURTEDGE_WINNER_C_PRODUCTION_V1",
        winnerTrackingType: TRACKING.OFFICIAL,
      },
    ],
  };
  const file = path.join(ROOT, "data", "wnba-winners-v1.json");
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    if (existing.slates) delete existing.slates["2099-02-01"];
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  }
  const first = persistWinnerSlate(slate);
  assert.equal(first.reused, false);
  assert.ok(first.slate.freezeHash);
  assert.equal(first.slate.freezeHash, computeWinnerFreezeHash(slate));
  const store = JSON.parse(fs.readFileSync(file, "utf8"));
  delete store.slates["2099-02-01"];
  fs.writeFileSync(file, JSON.stringify(store, null, 2));
  const mirror = path.join(ROOT, ".durable-mirror-v1", "wnba-winners.json");
  assert.equal(fs.existsSync(mirror), true);
  const mirrored = JSON.parse(fs.readFileSync(mirror, "utf8"));
  fs.writeFileSync(file, JSON.stringify(mirrored, null, 2));
  const restored = getWinnerSlate("2099-02-01");
  assert.equal(restored.freezeHash, first.slate.freezeHash);
  assert.equal(restored.fullSlate[0].selectedWinnerId, "ATL");
  assert.equal(restored.fullSlate[0].selectedProbability, 0.5326);
});

test("September 21 display does not inherit August 5 sealed props", () => {
  const board = sanitizeHomeBoardForLifecycle(
    {
      selectedPropsTodayWNBA: [
        { player: "Rhyne Howard", slateDate: "2026-08-05", officialSelected: true, propType: "POINTS", line: 16.5 },
      ],
      officialMembership: [
        { player: "Rhyne Howard", slateDate: "2026-08-05", officialSelected: true, propType: "POINTS", line: 16.5 },
      ],
      games: [],
      bestSixDisplayTodayWNBA: [],
    },
    { todayLocalDate: "2026-09-21", trackedProps: [], reports: [], archives: [], lockedSlates: [] }
  );
  const today = board.selectedPropsTodayWNBA || [];
  assert.ok(today.every((p) => p.slateDate !== "2026-08-05"));
});

test("PTS-only Official does not suppress REB/AST shadow collection", () => {
  const persisted = persistShadowBoardsFromGames({
    slateDateCT: "2099-02-02",
    games: [
      {
        league: "WNBA",
        shadowLinePackets: [
          { player: "A", propType: "REBOUNDS", line: 8.5, side: "UNDER", projection: 7.2 },
          { player: "B", propType: "ASSISTS", line: 4.5, side: "OVER", projection: 5.1 },
        ],
        allGeneratedCandidates: [
          { player: "C", propType: "POINTS", line: 20, side: "UNDER", officialSelected: true },
        ],
        shadowMarketAudit: { rawCounts: { POINTS: 4, REBOUNDS: 2, ASSISTS: 2 } },
      },
    ],
  });
  assert.ok(persisted.reb.analyzed >= 1);
  assert.ok(persisted.ast.analyzed >= 1);
  assert.equal(persisted.official, false);
  assert.equal(persisted.immutable, true);
});

test("tonight roster uniquely maps a player when BDL is empty", () => {
  const players = [
    { name: "Jonquel Jones", firstName: "Jonquel", lastName: "Jones", teamId: "newyorkliberty", espnAthleteId: "2999101" },
    { name: "Rhyne Howard", firstName: "Rhyne", lastName: "Howard", teamId: "atlantadream", espnAthleteId: "1" },
  ];
  const hit = matchPlayerOnTonightRoster(
    "Jonquel Jones",
    players,
    "newyorkliberty",
    "atlantadream"
  );
  assert.equal(hit.teamId, "newyorkliberty");
  assert.equal(hit.espnAthleteId, "2999101");
  const miss = matchPlayerOnTonightRoster("Not On Slate", players, "newyorkliberty", "atlantadream");
  assert.equal(miss, null);
});

test("ambiguous roster last-name on both teams does not invent a team", () => {
  const players = [
    { name: "Alex Smith", firstName: "Alex", lastName: "Smith", teamId: "newyorkliberty", espnAthleteId: "1" },
    { name: "Alex Smith", firstName: "Alex", lastName: "Smith", teamId: "atlantadream", espnAthleteId: "2" },
  ];
  assert.equal(
    matchPlayerOnTonightRoster("Alex Smith", players, "newyorkliberty", "atlantadream"),
    null
  );
});

test("ESPN gamelog parser hydrates last5 points", () => {
  const parsed = parseEspnAthleteGameLog({
    labels: ["MIN", "PTS", "REB", "AST", "FG", "FT"],
    events: {
      a: { gameDate: "2026-09-19T00:00:00.000+00:00", team: { abbreviation: "NY" }, opponent: { abbreviation: "ATL" } },
    },
    seasonTypes: [{
      categories: [{ events: [{ eventId: "a", stats: ["30", "18", "10", "2", "8-17", "1-1"] }] }],
    }],
  });
  assert.equal(parsed[0].points, 18);
  assert.equal(parsed[0].minutes, 30);
  assert.equal(parsed[0].fga, 17);
  assert.equal(inspectPtsHistoryInputs({ last5: parsed, seasonAverage: 18 }).hydrated, true);
});

test("Official PTS freeze restores identical hash after local wipe", () => {
  const board = {
    bestSixDisplayTodayWNBA: [
      {
        player: "Jonquel Jones",
        propType: "POINTS",
        side: "UNDER",
        line: 14.5,
        projection: 16.2,
        last5: [{ points: 18 }, { points: 11 }],
        last5Average: 14.5,
        seasonAverage: 15.1,
        probability: 0.61,
        risk: "MEDIUM",
        officialSelected: true,
        slateDate: "2099-04-01",
      },
    ],
  };
  const file = path.join(ROOT, "data", "courtedge-official-pts-v1.json");
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    if (existing.slates) delete existing.slates["2099-04-01"];
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  }
  const first = persistOfficialPtsFreeze({ slateDateCT: "2099-04-01", board });
  assert.equal(first.ok, true);
  assert.equal(first.reused, false);
  const hash = first.slate.freezeHash;
  assert.equal(hash, computeOfficialPtsFreezeHash("2099-04-01", first.slate.cards));
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    delete existing.slates["2099-04-01"];
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  }
  const overlay = officialPtsBoardOverlay("2099-04-01");
  assert.equal(overlay, null);
  persistOfficialPtsFreeze({ slateDateCT: "2099-04-01", board });
  const restored = getOfficialPtsSlate("2099-04-01");
  assert.equal(restored.freezeHash, hash);
  assert.equal(restored.cards[0].player, "Jonquel Jones");
  if (fs.existsSync(file)) {
    const existing = JSON.parse(fs.readFileSync(file, "utf8"));
    delete existing.slates["2099-04-01"];
    fs.writeFileSync(file, JSON.stringify(existing, null, 2));
  }
});

test("Winner-C rank uses pWinner", () => {
  const ranked = rankTopWinners([
    { winnerTrackingType: TRACKING.OFFICIAL, selectedProbability: 0.71, qualityScore: 40, winnerPredictionId: "a" },
    { winnerTrackingType: TRACKING.OFFICIAL, selectedProbability: 0.58, qualityScore: 90, winnerPredictionId: "b" },
  ], { rankByProbability: true });
  assert.equal(ranked[0].winnerPredictionId, "a");
});

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("ALL PASS");
