import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import {
  applyVerifiedFinals,
  captureFrozenOfficialSlate,
  configureFrozenSlateFile,
  getFrozenSlate,
  recoverSep23FrozenSlate,
  reconcilePendingFrozenSlates,
  slateRecord,
} from "../services/courtEdgeFrozenSlateV1.js";

const file = path.join(os.tmpdir(), `frozen-slate-${process.pid}.json`);
configureFrozenSlateFile(file);
fs.rmSync(file, { force: true });

const date = "2026-09-25";
const propId = "WNBA|PROP|2026-09-25|evt-1|Sabrina Ionescu|POINTS|15.5|Under";
const winnerId = "WNBA|WINNER|2026-09-25|evt-9|DAL|SEA";
const frozen = captureFrozenOfficialSlate({
  slateDateCT: date,
  props: [{
    predictionId: propId,
    eventId: "evt-1",
    player: "Sabrina Ionescu",
    side: "Under",
    line: 15.5,
    officialLine: 15.5,
    probability: 0.62,
    confidence: 70,
    risk: "MEDIUM",
    rank: 1,
    commenceTime: "2026-09-25T00:00:00.000Z",
    officialSelected: true,
  }],
  winners: [{
    predictionId: winnerId,
    eventId: "wnba:espn:evt-9",
    awayTeam: "Dallas Wings",
    homeTeam: "Seattle Storm",
    selectedWinnerName: "Dallas Wings",
    selectedWinnerId: "Dallas Wings",
    probability: 0.63,
    confidence: 71,
    risk: "MEDIUM",
    rank: 1,
    commenceTime: "2026-09-25T02:00:00.000Z",
  }],
});
assert.equal(frozen.ok, true);
const saved = getFrozenSlate(date);
assert.equal(saved.props[0].predictionId, propId);
assert.equal(saved.props[0].line, 15.5);
assert.equal(saved.winners[0].predictionId, winnerId);
assert.ok(saved.freezeId);

configureFrozenSlateFile(file);
const reloaded = getFrozenSlate(date);
assert.equal(reloaded.props[0].predictionId, propId);
assert.equal(reloaded.props[0].line, 15.5);
assert.equal(reloaded.winners[0].selectedWinnerName, "Dallas Wings");

const graded = applyVerifiedFinals(date, {
  winners: [{ eventId: "wnba:espn:evt-9", homeScore: 91, awayScore: 103 }],
  props: [{ predictionId: propId, stat: { points: 12, player: "Sabrina Ionescu" } }],
});
assert.equal(graded.slate.winners[0].grade, "WIN");
assert.equal(graded.slate.props[0].grade, "WIN");
assert.equal(graded.slate.props[0].line, 15.5);

captureFrozenOfficialSlate({
  slateDateCT: date,
  props: [{ predictionId: propId, side: "Over", line: 18.5, officialLine: 18.5, grade: "PENDING" }],
  winners: [{ predictionId: winnerId, selectedWinnerName: "Seattle Storm", grade: "PENDING" }],
});
const locked = getFrozenSlate(date);
assert.equal(locked.props[0].side, "Under");
assert.equal(locked.props[0].line, 15.5);
assert.equal(locked.props[0].grade, "WIN");
assert.equal(locked.winners[0].grade, "WIN");
assert.equal(locked.winners[0].selectedWinnerName, "Dallas Wings");

configureFrozenSlateFile(file);
const afterRestart = getFrozenSlate(date);
assert.equal(afterRestart.props[0].grade, "WIN");
assert.equal(afterRestart.winners[0].grade, "WIN");
assert.equal(slateRecord(afterRestart.winners).text, "1-0-0-0");
assert.equal(slateRecord(afterRestart.props).text, "1-0-0-0");

const pendingFile = path.join(os.tmpdir(), `frozen-pending-${process.pid}.json`);
configureFrozenSlateFile(pendingFile);
captureFrozenOfficialSlate({
  slateDateCT: "2026-09-26",
  winners: [{
    predictionId: "w-pending",
    eventId: "wnba:espn:55",
    awayTeam: "Dallas Wings",
    homeTeam: "Seattle Storm",
    selectedWinnerName: "Dallas Wings",
    selectedWinnerId: "Dallas Wings",
    commenceTime: "2020-01-01T00:00:00.000Z",
  }],
});
const job = await reconcilePendingFrozenSlates({
  fetchScoreboard: async () => [{
    id: "55",
    competitions: [{
      status: { type: { completed: true, state: "post" } },
      competitors: [
        { homeAway: "home", score: "90" },
        { homeAway: "away", score: "100" },
      ],
    }],
  }],
});
assert.equal(job.updated, 1);
assert.equal(getFrozenSlate("2026-09-26").winners[0].grade, "WIN");

configureFrozenSlateFile(file);
const sep23 = recoverSep23FrozenSlate();
assert.equal(sep23.slate.winners[0].grade, "WIN");
assert.equal(sep23.slate.winners[1].grade, "WIN");
assert.equal(slateRecord(sep23.slate.winners).text, "2-0-0-0");
assert.equal(sep23.slate.props.length, 0);
assert.equal(sep23.slate.unrecoverable[0].reason, "ORIGINAL_OFFICIAL_PROP_PACKET_MISSING");

fs.rmSync(file, { force: true });
fs.rmSync(pendingFile, { force: true });
console.log("frozen slate restart seal ok");
