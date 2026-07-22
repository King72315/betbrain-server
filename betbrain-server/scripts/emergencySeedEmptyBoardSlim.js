/**
 * Slim emergency seed — only essential board fields (avoids 27MB upload hang).
 * node scripts/emergencySeedEmptyBoardSlim.js <picks.json>
 */
import fs from "fs";
import path from "path";

const SOURCE = process.env.API_URL || "https://betbrain-server-1.onrender.com";
const SERVER_BUILD = "courteedge-home-analysis-hydrate-v1";
const file = process.argv[2];
if (!file) {
  console.error("Usage: node scripts/emergencySeedEmptyBoardSlim.js <picks.json>");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));

function slimPick(p = {}) {
  return {
    ...p,
    // Keep last5 / matchupGames / seasonAverage for analysis rebuild.
    // Drop only bulky nested blobs that are not required for Home display restore.
    courtEdgePlayerEvidence: p.courtEdgePlayerEvidence
      ? {
          schemaVersion: p.courtEdgePlayerEvidence.schemaVersion,
          recentForm: p.courtEdgePlayerEvidence.recentForm,
          roleAndVolume: p.courtEdgePlayerEvidence.roleAndVolume,
          matchup: p.courtEdgePlayerEvidence.matchup,
          dataQuality: p.courtEdgePlayerEvidence.dataQuality,
          identity: p.courtEdgePlayerEvidence.identity,
        }
      : undefined,
    wnbaDataCard: p.wnbaDataCard
      ? {
          version: p.wnbaDataCard.version,
          dataMode: p.wnbaDataCard.dataMode,
          bookLine: p.wnbaDataCard.bookLine,
          bookCount: p.wnbaDataCard.bookCount,
          injuryAvailability: p.wnbaDataCard.injuryAvailability,
          last5: p.wnbaDataCard.last5,
        }
      : undefined,
    scoreLedger: undefined,
    decisionDataIntelligence: p.decisionDataIntelligence
      ? {
          flipFirstLabels: p.decisionDataIntelligence.flipFirstLabels,
          availabilityImpact: p.decisionDataIntelligence.availabilityImpact,
        }
      : undefined,
  };
}

function slimGame(g = {}) {
  const cands = (g.allGeneratedCandidates || []).map(slimPick);
  return {
    id: g.id || g.gameId,
    gameId: g.gameId || g.id,
    oddsEventId: g.oddsEventId,
    league: g.league,
    dayBucket: g.dayBucket,
    dateLabel: g.dateLabel,
    date: g.date,
    commenceTime: g.commenceTime || g.time,
    homeTeam: g.homeTeam || g.home,
    awayTeam: g.awayTeam || g.away,
    home: g.home || g.homeTeam,
    away: g.away || g.awayTeam,
    rawHomeTeam: g.rawHomeTeam,
    rawAwayTeam: g.rawAwayTeam,
    game: g.game,
    picks: (g.picks || []).map(slimPick),
    allGeneratedCandidates: cands,
    rawPropCount: g.rawPropCount,
    consensusPropCount: g.consensusPropCount,
    rejectedPickCount: g.rejectedPickCount,
    rejectedSample: g.rejectedSample,
    playableCandidateCount: g.playableCandidateCount,
    allCandidateCount: g.allCandidateCount,
  };
}

const display = raw.bestSixDisplayWNBA || [];
const tomorrowFromDisplay = display.filter(
  (p) => String(p.dayBucket || "").toUpperCase() === "TOMORROW"
);

const board = {
  ok: true,
  serverBuild: SERVER_BUILD,
  boardSchemaVersion: raw.boardSchemaVersion || "courtedge-board-schema-v2",
  lastUpdated: new Date().toISOString(),
  controlledBestSixVersion: raw.controlledBestSixVersion,
  controlledBestSixAudit: raw.controlledBestSixAudit,
  filterAudit: raw.filterAudit,
  bestSixWNBA: (raw.bestSixWNBA || []).map(slimPick),
  bestSixNBA: raw.bestSixNBA || [],
  bestSixDisplayWNBA: display.map(slimPick),
  bestSixDisplayNBA: raw.bestSixDisplayNBA || [],
  bestSixDisplayTodayWNBA: (raw.bestSixDisplayTodayWNBA || []).map(slimPick),
  bestSixDisplayTodayNBA: raw.bestSixDisplayTodayNBA || [],
  bestSixDisplayTomorrowWNBA: (
    raw.bestSixDisplayTomorrowWNBA?.length
      ? raw.bestSixDisplayTomorrowWNBA
      : tomorrowFromDisplay
  ).map(slimPick),
  bestSixDisplayTomorrowNBA: raw.bestSixDisplayTomorrowNBA || [],
  topProps: (raw.topProps || []).map(slimPick),
  topWNBAProps: (raw.topWNBAProps || []).map(slimPick),
  topNBAProps: raw.topNBAProps || [],
  generatedProps: (raw.generatedProps || []).map(slimPick),
  boardCappedProps: (raw.boardCappedProps || []).map(slimPick),
  games: (raw.games || []).map(slimGame),
  wnbaGames: (raw.wnbaGames || raw.games || []).map(slimGame),
  nbaGames: raw.nbaGames || [],
  todayCandidateCount: raw.todayCandidateCount,
  tomorrowCandidateCount: raw.tomorrowCandidateCount,
};

const payload = JSON.stringify({
  confirm: true,
  emergencyEmptyBoardSeed: true,
  reason: "home-completion-emergency-slim-seed",
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
  data = { preview: text.slice(0, 800) };
}
console.log(JSON.stringify({ status: res.status, data }, null, 2));
if (!res.ok) process.exit(1);
