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
import { persistShadowBoards, getShadowSlate } from "../services/courtEdgeMarketShadowStoreV1.js";
import { COURTEDGE_WINNER_C_PRODUCTION_V1 } from "../engines/courtEdgeEraV1.js";
import { isOfficialTrackingPick } from "../services/trackedPropService.js";

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
  const date = "2099-01-01";
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
