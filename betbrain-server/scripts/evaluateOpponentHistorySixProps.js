/**
 * Re-evaluate current 6 Results props with opponent history comparison.
 * Usage: node betbrain-server/scripts/evaluateOpponentHistorySixProps.js
 */
import {
  fetchLast5,
  fetchLast3VsOpponent,
  probeWnbaMatchupLookup,
  findBallPlayer,
} from "../services/ballService.js";
import { resolveStableWnbaPlayerId } from "../engines/wnba/wnbaPlayerIdResolver.js";
import { resolveWnbaTeamId } from "../engines/wnba/wnbaTeamAliasResolver.js";
import {
  evaluateOpponentHistoryComparison,
  buildOpponentHistoryCompactLabel,
} from "../engines/decisionIntelligence/opponentHistoryComparisonV1.js";
import {
  runFlipFirstDecisionPipeline,
} from "../engines/decisionIntelligence/decisionDataIntelligenceV1.js";
import { evaluatePropDecisionIntelligenceV1 } from "../engines/decisionIntelligence/propDecisionIntelligenceV1.js";
import { readWnbaProp } from "../engines/wnba/wnbaReaderEngine.js";
import { evaluateWnbaTrackingEligibility } from "../engines/wnba/wnbaResultsQualityGate.js";

const SIX_PROPS = [
  { player: "Jessica Shepard", side: "Over", line: 13.5, team: "minnesotalynx", opponent: "indianafever" },
  { player: "Azzi Fudd", side: "Over", line: 14.5, team: "indianafever", opponent: "connecticutsun" },
  { player: "Veronica Burton", side: "Under", line: 11.5, team: "indianafever", opponent: "connecticutsun" },
  { player: "Leonie Fiebich", side: "Over", line: 10.5, team: "newyorkliberty", opponent: "seattlestorm" },
  { player: "Kamilla Cardoso", side: "Over", line: 12.5, team: "dallaswings", opponent: "phoenixmercury" },
  { player: "Sydney Taylor", side: "Over", line: 14.5, team: "phoenixmercury", opponent: "dallaswings" },
];

function baseCard(entry, last5, matchupGames) {
  const pointsList = last5.map((g) => Number(g.points || 0));
  return {
    version: "wnba-data-card-v2",
    player: entry.player,
    team: entry.team,
    opponent: entry.opponent,
    propType: "Points",
    bookLine: entry.line,
    currentLine: entry.line,
    last5: {
      points: pointsList.length
        ? Number((pointsList.reduce((s, p) => s + p, 0) / pointsList.length).toFixed(1))
        : null,
      pointsList,
      minutes: last5.length
        ? Number((last5.reduce((s, g) => s + Number(g.minutes || 0), 0) / last5.length).toFixed(1))
        : null,
      fga: last5.length
        ? Number((last5.reduce((s, g) => s + Number(g.fga || 0), 0) / last5.length).toFixed(1))
        : null,
      games: last5.length,
    },
    projection: { projection: entry.line },
    fairLine: { fairLine: entry.line, fairLineSide: entry.side.toUpperCase(), fairLineEdge: 0, fairLineQuality: 50 },
    dataMissingFlags: [],
    injuryAvailability: { level: "ACTIVE", availabilityDataMissing: false },
    matchupGames,
  };
}

async function evaluateOne(entry) {
  const last5 = await fetchLast5(entry.player, "WNBA");
  const player = await findBallPlayer(entry.player, "WNBA");
  const playerId = String(player?.id || resolveStableWnbaPlayerId(entry.player) || "");
  const probe = await probeWnbaMatchupLookup({
    playerName: entry.player,
    playerId,
    playerTeam: resolveWnbaTeamId(entry.team),
    opponent: resolveWnbaTeamId(entry.opponent),
  });
  const matchupGames =
    probe.matchupGames?.length > 0
      ? probe.matchupGames.slice(0, 5)
      : await fetchLast3VsOpponent(entry.player, entry.opponent, "WNBA", {
          playerTeam: entry.team,
          maxGames: 5,
        });

  const card = baseCard(entry, last5, matchupGames);
  const reader = readWnbaProp(card);
  let pick = {
    player: entry.player,
    team: entry.team,
    opponent: entry.opponent,
    line: entry.line,
    side: entry.side,
    pick: entry.side,
    stat: "Points",
    league: "WNBA",
    engineHandled: "WNBA_V2",
    wnbaDataCard: card,
    wnbaReader: reader,
    initialSide: entry.side.toUpperCase().startsWith("U") ? "UNDER" : "OVER",
    last5,
    matchupGames,
    confidence: 55,
    riskLabel: "Medium Risk",
  };

  const beforeSide = pick.side;
  const beforeConfidence = pick.confidence;
  const beforeRisk = pick.riskLabel;

  pick = runFlipFirstDecisionPipeline(pick, { dataCard: card, reader, last5, matchupGames });
  const gate = evaluateWnbaTrackingEligibility(pick, card, reader);
  const di = evaluatePropDecisionIntelligenceV1(pick, { dataCard: card, reader, gate });
  const ohc = pick.opponentHistoryComparison || evaluateOpponentHistoryComparison(pick, {
    dataCard: card,
    last5,
    matchupGames,
    line: entry.line,
    side: entry.side,
  });

  return {
    player: entry.player,
    originalSide: beforeSide,
    newSide: pick.side,
    sideFlipped: String(beforeSide).toUpperCase() !== String(pick.side).toUpperCase(),
    oldConfidence: beforeConfidence,
    newConfidence: pick.confidence ?? beforeConfidence,
    oldRisk: beforeRisk,
    newRisk: di.riskAfterDecision || pick.riskLabel,
    opponentGamesFound: ohc.opponentHistory?.gamesFound ?? 0,
    opponentGamesUsed: ohc.opponentHistory?.gamesUsed ?? 0,
    recentLast5PointsAvg: ohc.recentForm?.pointsAvg,
    opponentHistoryPointsAvg: ohc.opponentHistory?.pointsAvg,
    recentHitRateVsLine: ohc.recentForm?.hitRateVsLine,
    opponentHitRateVsLine: ohc.opponentHistory?.hitRateVsLine,
    comparisonResult: ohc.opponentHistory?.noHistory
      ? "no history"
      : ohc.comparison?.finalImpact?.toLowerCase() || "neutral",
    agreement: ohc.comparison?.agreement,
    flipSignal: ohc.comparison?.flipSignal,
    label: buildOpponentHistoryCompactLabel(ohc),
    trueRisk: di.trueRisk,
    trackEligibility: di.trackEligibility,
    reasonForChange: ohc.comparison?.reasons?.[0] || ohc.opponentHistory?.reasons?.[0] || "No change",
    flipFirstAction: pick.flipFirstDecision?.action,
  };
}

async function main() {
  const results = [];
  for (const entry of SIX_PROPS) {
    try {
      const row = await evaluateOne(entry);
      results.push(row);
      console.log(JSON.stringify(row, null, 2));
    } catch (err) {
      console.error(`Error evaluating ${entry.player}:`, err.message);
      results.push({ player: entry.player, error: err.message });
    }
  }
  return results;
}

main()
  .then((results) => {
    console.log("\n=== SUMMARY ===");
    console.log(JSON.stringify(results, null, 2));
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
