/**
 * Ultra-slim emergency seed for empty Render boards (<1MB).
 * node scripts/emergencySeedEmptyBoardUltra.js <picks.json>
 */
import fs from "fs";
import path from "path";

const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const SERVER_BUILD = "courteedge-home-analysis-hydrate-v1";
const file = process.argv[2];
if (!file) process.exit(1);

const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));

function mini(p = {}) {
  const l5Pts = Array.isArray(p.last5)
    ? p.last5.map((g) => (typeof g === "number" ? g : g?.points)).filter((v) => v != null)
    : p.homeDetailedAnalysisV1?.recentPerformance?.last5Points || [];
  return {
    player: p.player,
    team: p.team,
    opponent: p.opponent,
    league: p.league || "WNBA",
    line: p.line,
    side: p.side || p.pick,
    pick: p.pick || p.side,
    confidence: p.confidence,
    riskLabel: p.riskLabel,
    projection: p.projection,
    dayBucket: p.dayBucket,
    dateLabel: p.dateLabel,
    commenceTime: p.commenceTime,
    game: p.game,
    gameId: p.gameId,
    oddsEventId: p.oddsEventId,
    bookCount: p.bookCount,
    marketQuality: p.marketQuality,
    displayWhy: p.displayWhy,
    trackingEligibility: p.trackingEligibility || "TRACK",
    originalModelSide: p.originalModelSide,
    sameTeamArbitrationFlip: p.sameTeamArbitrationFlip,
    sameTeamArbitration: p.sameTeamArbitration,
    // Preserve L5 points so post-seed hydrate / analysis rebuild has form.
    last5: l5Pts.length ? l5Pts.map((points) => ({ points })) : undefined,
    decisionIntelligence: {
      trackEligibility: "TRACK",
      trueRisk: p.decisionIntelligence?.trueRisk || p.trueRisk || "MEDIUM",
      simpleExplanation: p.displayWhy || p.decisionIntelligence?.simpleExplanation,
      naturalGateReason: p.naturalGateReason || p.decisionIntelligence?.naturalGateReason,
    },
    providerIdentity: p.providerIdentity,
    homeDetailedAnalysisV1: p.homeDetailedAnalysisV1
      ? {
          schemaVersion: p.homeDetailedAnalysisV1.schemaVersion,
          buildVersion: p.homeDetailedAnalysisV1.buildVersion,
          propSnapshot: p.homeDetailedAnalysisV1.propSnapshot,
          availability: p.homeDetailedAnalysisV1.availability,
          finalDecision: p.homeDetailedAnalysisV1.finalDecision,
          marketAnalysis: {
            compactResult: p.homeDetailedAnalysisV1.marketAnalysis?.compactResult,
            openingLine: p.homeDetailedAnalysisV1.marketAnalysis?.openingLine,
            selectedSealedLine: p.homeDetailedAnalysisV1.marketAnalysis?.selectedSealedLine,
            currentLine: p.homeDetailedAnalysisV1.marketAnalysis?.currentLine,
          },
          recentPerformance: {
            last5Points: p.homeDetailedAnalysisV1.recentPerformance?.last5Points || l5Pts,
            last5Average: p.homeDetailedAnalysisV1.recentPerformance?.last5Average,
            last10Points: p.homeDetailedAnalysisV1.recentPerformance?.last10Points,
            last10Average: p.homeDetailedAnalysisV1.recentPerformance?.last10Average,
            last10SampleSize: p.homeDetailedAnalysisV1.recentPerformance?.last10SampleSize,
            seasonAverage: p.homeDetailedAnalysisV1.recentPerformance?.seasonAverage,
          },
          dataQuality: {
            coverage: p.homeDetailedAnalysisV1.dataQuality?.coverage,
            fetchedAt: p.homeDetailedAnalysisV1.dataQuality?.fetchedAt,
            shellAnalysis: p.homeDetailedAnalysisV1.dataQuality?.shellAnalysis,
            analysisComplete: p.homeDetailedAnalysisV1.dataQuality?.analysisComplete,
          },
        }
      : undefined,
    weakButPlayable: p.weakButPlayable,
    bestSixEligibility: p.bestSixEligibility,
    controlledBestSixRank: p.controlledBestSixRank,
    topPickRank: p.topPickRank,
  };
}

const today = (raw.bestSixDisplayTodayWNBA || []).map(mini);
const display = (raw.bestSixDisplayWNBA || []).map(mini);
const tom =
  (raw.bestSixDisplayTomorrowWNBA?.length
    ? raw.bestSixDisplayTomorrowWNBA
    : display.filter((p) => String(p.dayBucket).toUpperCase() === "TOMORROW")
  ).map(mini);

const games = (raw.games || []).map((g) => ({
  id: g.id || g.gameId,
  gameId: g.gameId || g.id,
  oddsEventId: g.oddsEventId,
  league: g.league || "WNBA",
  dayBucket: g.dayBucket,
  dateLabel: g.dateLabel,
  date: g.date,
  commenceTime: g.commenceTime || g.time,
  homeTeam: g.homeTeam || g.home,
  awayTeam: g.awayTeam || g.away,
  home: g.home || g.homeTeam,
  away: g.away || g.awayTeam,
  game: g.game,
  rawPropCount: g.rawPropCount,
  consensusPropCount: g.consensusPropCount,
  rejectedPickCount: g.rejectedPickCount,
  allGeneratedCandidates: (g.allGeneratedCandidates || []).map(mini),
  picks: (g.picks || []).map(mini),
}));

const board = {
  ok: true,
  serverBuild: SERVER_BUILD,
  boardSchemaVersion: "courtedge-board-schema-v2",
  lastUpdated: new Date().toISOString(),
  controlledBestSixVersion: raw.controlledBestSixVersion,
  controlledBestSixAudit: raw.controlledBestSixAudit,
  bestSixWNBA: today,
  bestSixNBA: [],
  bestSixDisplayWNBA: display,
  bestSixDisplayNBA: [],
  bestSixDisplayTodayWNBA: today,
  bestSixDisplayTodayNBA: [],
  bestSixDisplayTomorrowWNBA: tom,
  bestSixDisplayTomorrowNBA: [],
  topProps: (raw.topWNBAProps || raw.topProps || []).map(mini),
  topWNBAProps: (raw.topWNBAProps || []).map(mini),
  topNBAProps: [],
  generatedProps: today,
  games,
  wnbaGames: games,
  nbaGames: [],
  todayCandidateCount: today.length,
  tomorrowCandidateCount: tom.length,
};

const payload = JSON.stringify({
  confirm: true,
  emergencyEmptyBoardSeed: true,
  reason: "home-completion-emergency-ultra-seed",
  board,
});
console.log("payload_bytes", payload.length);

const res = await fetch(`${SOURCE}/admin/seed-board-cache`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: payload,
});
const text = await res.text();
let data;
try {
  data = JSON.parse(text);
} catch {
  data = { preview: text.slice(0, 500) };
}
console.log(JSON.stringify({ status: res.status, data }, null, 2));
if (!res.ok) process.exit(1);
