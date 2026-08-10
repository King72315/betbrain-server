/**
 * Official confidence / risk ownership — Direction × C2 (control-plane V1).
 */
import assert from "assert";
import {
  resolveOfficialDisplayMetaV1,
  selectOfficialBoardFromProbabilitySafetyV1,
} from "../engines/probabilitySafetyV1/index.js";

let passed = 0;
function ok(name, cond) {
  assert.ok(cond, name);
  passed += 1;
  console.log("PASS", name);
}

{
  const lowStrong = resolveOfficialDisplayMetaV1({
    directionDecision: "OVER",
    directionAdmission: "PRIMARY",
    directionConfidence: "STRONG",
    c2Risk: "LOW",
    reliabilityProbability: 0.9,
    trustScore: 85,
    rawWinProbability: 0.78,
  });
  ok("LOW risk label", lowStrong.riskLabel === "Low Risk");
  ok("confidence elevated", lowStrong.finalConfidence >= 70);
  ok("admission PRIMARY", lowStrong.directionAdmission === "PRIMARY");
  ok("displayConfidence present", Number.isFinite(lowStrong.displayConfidence));
  ok("signal demoted", lowStrong.signalStrength == null);
  ok("one risk", lowStrong.c2Risk === lowStrong.trueRisk);
}

{
  const medWeak = resolveOfficialDisplayMetaV1({
    directionDecision: "OVER",
    directionAdmission: "PRIMARY",
    directionConfidence: "WEAK",
    c2Risk: "MEDIUM",
    reliabilityProbability: 0.7,
    trustScore: 60,
    rawWinProbability: 0.7,
  });
  ok("MEDIUM risk label", medWeak.riskLabel === "Medium Risk");
}

{
  const guess = resolveOfficialDisplayMetaV1({
    directionDecision: "UNDER",
    directionAdmission: "BEST_GUESS",
    directionConfidence: "NONE",
    c2Risk: "MEDIUM",
    reliabilityProbability: 0.9,
    rawWinProbability: 0.9,
  });
  ok("BEST_GUESS admission", guess.directionAdmission === "BEST_GUESS");
  ok("BEST_GUESS confidence capped", guess.finalConfidence <= 52);
}

{
  const board = selectOfficialBoardFromProbabilitySafetyV1(
    [
      {
        playerName: "Display Meta Player",
        playerId: "dmp1",
        eventId: "evt-dmp",
        team: "SEA",
        opponent: "LAS",
        slateDate: "2026-08-10",
        line: 14.5,
        projection: 19.5,
        fairLine: 18.5,
        bookCount: 3,
        availabilityStatus: "ACTIVE",
        expectedMinutes: 30,
        roleStabilityScore: 75,
        minutesStabilityScore: 85,
      },
      {
        playerName: "Display Meta Player 2",
        playerId: "dmp2",
        eventId: "evt-dmp2",
        team: "CHI",
        opponent: "NYL",
        slateDate: "2026-08-10",
        line: 12.5,
        projection: 16.5,
        fairLine: 15.5,
        bookCount: 3,
        availabilityStatus: "ACTIVE",
        expectedMinutes: 28,
        roleStabilityScore: 70,
        minutesStabilityScore: 80,
      },
    ],
    {
      empiricalDirectionV1: true,
      empiricalSafePropV2: true,
      requestedSlateDate: "2026-08-10",
      simulationCount: 600,
    }
  );
  ok("board has Official", (board.selectedProps || []).length >= 2);
  const p = board.selectedProps[0];
  ok("official has riskOwner", Boolean(p.riskOwner));
  ok("official has displayConfidence", Number.isFinite(p.displayConfidence));
  ok("official c2Risk", Boolean(p.c2Risk || p.trueRisk));
  ok("officialSelected", p.officialSelected === true);
}

console.log(`\n${passed} tests passed`);
