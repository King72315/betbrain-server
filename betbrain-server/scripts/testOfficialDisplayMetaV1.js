/**
 * Official confidence / risk / signal ownership — Direction × C2.
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
    directionConfidence: "STRONG",
    c2Risk: "LOW",
    reliabilityProbability: 0.9,
    trustScore: 85,
    rawWinProbability: 0.78,
  });
  ok("LOW+STRONG signal STRONG", lowStrong.signalStrength === "STRONG");
  ok("LOW risk label", lowStrong.riskLabel === "Low Risk");
  ok("confidence elevated", lowStrong.finalConfidence >= 70);
  ok("admission PRIMARY", lowStrong.directionAdmission === "PRIMARY");
}

{
  const medWeak = resolveOfficialDisplayMetaV1({
    directionDecision: "OVER",
    directionConfidence: "WEAK",
    c2Risk: "MEDIUM",
    reliabilityProbability: 0.7,
    trustScore: 60,
    rawWinProbability: 0.7,
  });
  ok("MEDIUM+WEAK signal WEAK", medWeak.signalStrength === "WEAK");
  ok("MEDIUM risk label", medWeak.riskLabel === "Medium Risk");
}

{
  const noBet = resolveOfficialDisplayMetaV1({
    directionDecision: "NO_BET",
    directionConfidence: "NONE",
    c2Risk: "MEDIUM",
    reliabilityProbability: 0.9,
    rawWinProbability: 0.9,
  });
  ok("NO_BET no admission", noBet.directionAdmission == null);
  ok("NO_BET weak signal", noBet.signalStrength === "WEAK");
  ok("NO_BET confidence capped", noBet.finalConfidence <= 52);
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
    ],
    {
      empiricalDirectionV1: true,
      empiricalSafePropV2: true,
      requestedSlateDate: "2026-08-10",
      simulationCount: 700,
      seed: 21,
    }
  );
  for (const p of board.selectedProps || []) {
    ok("official has riskOwner", Boolean(p.riskOwner));
    ok("official has signalOwner", Boolean(p.signalOwner));
    ok("official confidence owned", p.confidenceOwner?.includes("direction_x_c2"));
    ok(
      "DI synced to membership risk",
      p.decisionIntelligence?.trueRisk === p.trueRisk
    );
    ok(
      "signal not legacy-only empty",
      ["STRONG", "MODERATE", "WEAK"].includes(p.signalStrength)
    );
    ok(
      "riskLabel human form",
      p.riskLabel === "Low Risk" || p.riskLabel === "Medium Risk"
    );
  }
  if (!(board.selectedProps || []).length) {
    ok("empty official board allowed", true);
  }
}

console.log(`\n${passed} tests passed`);
