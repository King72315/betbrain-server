import assert from "node:assert/strict";
import { attachOfficialPropGrades, evaluateGradingBlock, gradePointsPick } from "../services/resultService.js";

const frozen = {
  player: "Sabrina Ionescu",
  side: "Under",
  line: 15.5,
  officialLine: 15.5,
  propType: "POINTS",
  latestLine: 18.5,
};

const under = gradePointsPick(frozen, { points: 12, player: "Sabrina Ionescu" });
assert.equal(under.grade, "WIN");
assert.equal(under.gameStatus, "FINAL");
assert.equal(under.line, 15.5);
assert.equal(under.actualStat, 12);

const overMiss = gradePointsPick({ ...frozen, side: "Over", officialLine: 15.5, line: 15.5 }, { points: 12 });
assert.equal(overMiss.grade, "LOSS");
assert.equal(overMiss.line, 15.5);

const push = gradePointsPick({ ...frozen, officialLine: 12, line: 12 }, { points: 12 });
assert.equal(push.grade, "PUSH");

const missing = gradePointsPick(frozen, { player: "Sabrina Ionescu", minutes: 30 });
assert.equal(missing.status, "pending");
assert.equal(missing.grade, undefined);
assert.equal(missing.actualStat, null);

const dnp = gradePointsPick(frozen, { didNotPlay: true });
assert.equal(dnp.grade, "VOID");

const blocked = evaluateGradingBlock(
  { slateDate: "2026-09-23", player: "Sabrina Ionescu" },
  new Date("2026-09-24T04:00:00.000Z")
);
assert.equal(blocked.blocked, false);

const future = evaluateGradingBlock(
  { slateDate: "2026-09-25", commenceTime: "2026-09-25T23:00:00.000Z" },
  new Date("2026-09-24T04:00:00.000Z")
);
assert.equal(future.blocked, true);

const stamped = attachOfficialPropGrades(
  [{ player: "Sabrina Ionescu", side: "Under", line: 15.5, officialLine: 15.5, propType: "POINTS" }],
  [{ player: "Sabrina Ionescu", side: "Under", line: 18.5, officialLine: 15.5, propType: "POINTS", status: "win", actualStat: 12 }]
);
assert.equal(stamped[0].grade, "WIN");
assert.equal(stamped[0].gameStatus, "FINAL");
assert.equal(stamped[0].line, 15.5);

console.log("official prop grade seal ok");
