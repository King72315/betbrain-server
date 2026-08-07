/**
 * Replay Aug 4 fillers + Aug 5 reconstructed four through new architecture (diagnostic).
 * Does NOT rewrite sealed Official history.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildCanonicalPlayerForecastPacketV1 } from "../engines/probabilitySafetyV1/index.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const aug4Fillers = [
  { playerName: "Marina Mabrey", side: "OVER", line: 18.5, team: "torontotempo", projection: 19.2, fairLine: 17.0, avgMinutesL5: 28, seasonMinutes: 27, bookCount: 3, avgPointsL5: 17, avgPoints: 16, expectedFGA: 11, blowoutRisk: 35, availabilityStatus: "ACTIVE" },
  { playerName: "Gabby Williams", side: "OVER", line: 14.5, team: "goldenstatevalkyries", projection: 15.1, fairLine: 13.5, avgMinutesL5: 26, seasonMinutes: 25, bookCount: 3, avgPointsL5: 13, avgPoints: 12, expectedFGA: 9, blowoutRisk: 40, availabilityStatus: "ACTIVE" },
  { playerName: "Julie Allemand", side: "UNDER", line: 6.5, team: "torontotempo", projection: 5.8, fairLine: 7.2, avgMinutesL5: 18, seasonMinutes: 20, bookCount: 2, avgPointsL5: 6, avgPoints: 7, expectedFGA: 5, blowoutRisk: 30, availabilityStatus: "ACTIVE" },
  { playerName: "Veronica Burton", side: "UNDER", line: 12.5, team: "goldenstatevalkyries", projection: 11.8, fairLine: 13.0, avgMinutesL5: 24, seasonMinutes: 26, bookCount: 3, avgPointsL5: 11, avgPoints: 12, expectedFGA: 8, blowoutRisk: 35, availabilityStatus: "ACTIVE" },
];

const aug5Four = [
  { playerName: "Rhyne Howard", side: "UNDER", line: 17.5, team: "atlantadream", projection: 12.9, fairLine: 14.0, avgMinutesL5: 32, seasonMinutes: 33, bookCount: 4, avgPointsL5: 14, avgPoints: 16, expectedFGA: 12, blowoutRisk: 25, availabilityStatus: "ACTIVE", isStarter: true },
  { playerName: "Kelsey Plum", side: "OVER", line: 16.5, team: "phoenixmercury", projection: 21.6, fairLine: 19.5, avgMinutesL5: 30, seasonMinutes: 31, bookCount: 4, avgPointsL5: 18, avgPoints: 17, expectedFGA: 13, blowoutRisk: 30, availabilityStatus: "ACTIVE", isStarter: true, recentRoleChange: true, keyTeammateReturning: true },
  { playerName: "Nneka Ogwumike", side: "UNDER", line: 18.5, team: "losangelessparks", projection: 16.1, fairLine: 17.0, avgMinutesL5: 28, seasonMinutes: 29, bookCount: 3, avgPointsL5: 16, avgPoints: 17, expectedFGA: 11, blowoutRisk: 35, availabilityStatus: "ACTIVE" },
  { playerName: "Flau'jae Johnson", side: "OVER", line: 15.5, team: "seattlestorm", projection: 17.1, fairLine: 16.0, avgMinutesL5: 22, seasonMinutes: 18, bookCount: 2, avgPointsL5: 14, avgPoints: 12, expectedFGA: 10, blowoutRisk: 40, availabilityStatus: "ACTIVE" },
];

function classify(list, label) {
  return list.map((p, i) => {
    const pkt = buildCanonicalPlayerForecastPacketV1(
      { ...p, league: "WNBA", pick: p.side },
      { seed: 4000 + i, simulationCount: 2500 }
    );
    const sidePkt = pkt.selectedSide === "OVER" ? pkt.overPacket : pkt.underPacket;
    return {
      label,
      player: p.playerName,
      requestedSide: p.side,
      selectedSide: pkt.selectedSide,
      line: p.line,
      risk: pkt.risk?.risk,
      officialEligible: pkt.risk?.officialEligible,
      safetyScore: pkt.safety?.finalSafetyScore,
      rawWinProbability: pkt.probability?.rawWinProbability,
      projectionEdge: sidePkt?.projectionEdge,
      conflictIndex: pkt.uncertainty?.conflictIndex,
      minutesStability: pkt.minutesModel?.minutesStabilityScore,
      roleStability: pkt.roleModel?.roleStabilityScore,
      marketQuality: pkt.market?.marketQualityScore,
      failedLowReasons: pkt.risk?.failedLowReasons,
      failedMediumReasons: pkt.risk?.failedMediumReasons,
      note: "DIAGNOSTIC_REPLAY_ONLY — does not rewrite Official history",
    };
  });
}

const out = {
  build: "courteedge-probability-safety-true-low-risk-architecture-v1",
  aug4Fillers: classify(aug4Fillers, "AUG4_FILLER"),
  aug5ReconstructedFour: classify(aug5Four, "AUG5_INTENDED_CLEAR_SIDE_RECONSTRUCTION"),
  august5OfficialHistoryRewritten: false,
};

const dest = path.join(ROOT, "_probability_safety_aug4_aug5_replay.json");
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
console.log("Wrote", dest);
