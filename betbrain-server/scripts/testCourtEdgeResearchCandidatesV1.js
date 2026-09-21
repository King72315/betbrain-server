import assert from "assert/strict";
import {
  aliasContaminationFlags,
  normalizeWnbaTeamExact,
  projectAstA,
  projectAstC,
  projectRebA,
  projectRebC,
  predictWinnerA,
  predictWinnerC,
  applyTemperature,
} from "../engines/wnba/researchCandidatesV1/index.js";
import { normalizeWnbaTeam } from "../engines/wnba/winnersV1/constants.js";

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

test("exact alias maps tempo to TOR and storm to SEA", () => {
  assert.equal(normalizeWnbaTeamExact("Toronto Tempo").id, "TOR");
  assert.equal(normalizeWnbaTeamExact("tempo").id, "TOR");
  assert.equal(normalizeWnbaTeamExact("Seattle Storm").id, "SEA");
  assert.equal(normalizeWnbaTeamExact("storm").id, "SEA");
  assert.equal(normalizeWnbaTeamExact("SEA").id, "SEA");
  assert.equal(normalizeWnbaTeamExact("TOR").id, "TOR");
});

test("exact alias does not substring-map Toronto composites to SEA", () => {
  const bad = normalizeWnbaTeamExact("Toronto Storm");
  assert.equal(bad.id, null);
  assert.ok(bad.flags.includes("TOR_SEA_COMPOSITE") || bad.flags.includes("UNRESOLVED_TEAM"));
  assert.ok(aliasContaminationFlags("torontostorm").includes("TOR_SEA_COMPOSITE"));
});

test("production exact alias refuses Toronto/Storm composites", () => {
  const prod = normalizeWnbaTeam("Toronto Storm");
  assert.equal(prod, null);
});

test("AST-A is minutes × recent rate", () => {
  const out = projectAstA({
    player: { recentMin: 30, seasonMin: 30, recentAst: 6, seasonAst: 4, n: 10 },
  });
  assert.equal(out.projection, 6);
  assert.equal(out.id, "AST-A");
});

test("AST-C is deterministic for the same pre-match context", () => {
  const ctx = {
    player: {
      recentMin: 32,
      seasonMin: 30,
      recentAst: 5.5,
      seasonAst: 5,
      n: 12,
      starterShare: 0.9,
      recentStarterShare: 0.9,
      last5MinCv: 0.1,
      games: [],
    },
    role: { role: "PRIMARY_CREATOR", primaryCreator: true, secondaryCreator: false, ballHandlingUnstable: false },
    teammateFgPct: 0.44,
    highVolumeScorerOut: false,
    pace: 97,
    daysSinceLastGame: 2,
  };
  assert.deepEqual(projectAstC(ctx), projectAstC(ctx));
});

test("REB-A is minutes × recent rate", () => {
  const out = projectRebA({
    player: { recentMin: 30, seasonMin: 30, recentReb: 9, seasonReb: 7, n: 8 },
  });
  assert.equal(out.projection, 9);
});

test("REB-C missed-shot boost is pre-match and deterministic", () => {
  const ctx = {
    player: { recentMin: 28, seasonMin: 28, recentReb: 8, seasonReb: 8, n: 10, starterShare: 0.8, games: [] },
    opponentMissRate: 0.58,
    leagueMissRate: 0.52,
    playerRebShare: 0.28,
    teamRebounders: 2,
    teammateHighReboundOut: false,
    rebRole: { likelyInteriorMinutes: true, smallBallRole: false },
    daysSinceLastGame: 2,
  };
  const a = projectRebC(ctx);
  const b = projectRebC(ctx);
  assert.deepEqual(a, b);
  assert.ok(a.projection > 8);
});

test("Winner-A is PD + home and Winner-C temperature flattens extremes", () => {
  const home = { games: 20, pd: 80, pf: 1700, pa: 1540, recentPd: [8, 6, 4, 10, 2], elo: 1900 };
  const away = { games: 20, pd: -40, pf: 1500, pa: 1580, recentPd: [-2, -4, 1], elo: 1300 };
  const a = predictWinnerA(home, away, { homeIntercept: 0.23 });
  const c = predictWinnerC(home, away, { homeIntercept: 0.23, hfaElo: 40, temperature: 1.45 });
  assert.ok(a.pHome > 0.5);
  assert.ok(c.pHome < 0.99);
  assert.ok(applyTemperature(0.99, 1.8) < 0.96);
});

if (failed) {
  console.error(`${failed} failed`);
  process.exit(1);
}
console.log("ALL PASS");
