/**
 * Produce the 2026-09-21 CT WNBA Winner-C production slate.
 * Does not remint Product Truth. Does not rewrite historical Winner V1 cards.
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { CONFIG } from "../config.js";
import {
  fetchSgoWnbaEvents,
  getSgoHealth,
  inspectSgoWnbaCapabilities,
  isSgoConfigured,
  SGO_STATES,
} from "../services/sportsGameOddsClientV1.js";
import { buildFullWinnerSlate } from "../engines/wnba/winnersV1/buildWnbaWinnerSlateV1.js";
import { walkForward } from "../engines/wnba/winnersV1/winnerModelV1.js";
import { walkForwardC } from "../engines/wnba/winnersV1/winnerModelC.js";
import { persistWinnerSlate } from "../services/wnbaWinnerStoreV1.js";
import { normalizeWnbaTeam, slateDateCT } from "../engines/wnba/winnersV1/constants.js";
import { COURTEDGE_WINNER_C_PRODUCTION_V1 } from "../engines/courtEdgeEraV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SLATE = "2026-09-21";
const TEAM_GAMES = path.join(ROOT, "research/courteedge-wnba-winners-v1/10-team-games.json");
const OUT = path.join(ROOT, "research/courteedge-wnba-winners-v1/30-slate-2026-09-21.json");
const TRUTH = path.join(ROOT, "canonical-predictions-v1.json");
const LOCKED = "fc69b0ecf159510d00284ee8ab18932297c4ad84d8cf43017898e6354f3885a9";

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
function classifyNet(probe) {
  if (!probe) return { network: "UNKNOWN", auth: "UNKNOWN" };
  if (probe.state === SGO_STATES.NOT_CONFIGURED) return { network: "UNKNOWN", auth: "UNKNOWN" };
  if (probe.state === SGO_STATES.UNREACHABLE_FROM_CURRENT_NETWORK) return { network: "UNREACHABLE", auth: "UNKNOWN" };
  if (probe.state === SGO_STATES.AUTH_REJECTED) return { network: "HEALTHY", auth: "REJECTED" };
  if (probe.state === SGO_STATES.RATE_LIMITED) return { network: "HEALTHY", auth: "VALID" };
  if (probe.state === SGO_STATES.HEALTHY || probe.state === SGO_STATES.NO_WNBA_DATA) {
    return { network: "HEALTHY", auth: "VALID" };
  }
  return { network: "ERROR", auth: "UNKNOWN" };
}

async function probeOdds() {
  const configured = Boolean(CONFIG.ODDS_KEY);
  if (!configured) return { configured: false, network: "UNKNOWN", auth: "UNKNOWN", events: 0, data: [] };
  try {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_wnba/odds?regions=us&markets=h2h&oddsFormat=american&apiKey=${CONFIG.ODDS_KEY}`;
    const res = await fetch(url);
    if (res.status === 401 || res.status === 403) return { configured: true, network: "HEALTHY", auth: "REJECTED", events: 0, data: [] };
    if (!res.ok) return { configured: true, network: "ERROR", auth: "UNKNOWN", events: 0, data: [], status: res.status };
    const data = await res.json();
    return { configured: true, network: "HEALTHY", auth: "VALID", events: Array.isArray(data) ? data.length : 0, data: Array.isArray(data) ? data : [] };
  } catch (err) {
    return { configured: true, network: "ERROR", auth: "UNKNOWN", events: 0, data: [], error: String(err.message || err) };
  }
}

async function fetchEspnSlate(date) {
  const ymd = date.replace(/-/g, "");
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${ymd}`,
    { headers: { "User-Agent": "CourtEdge-WinnerC-V1" } }
  );
  if (!res.ok) return [];
  const json = await res.json();
  return (json.events || []).map((ev) => {
    const comp = ev.competitions?.[0];
    const home = (comp?.competitors || []).find((c) => c.homeAway === "home");
    const away = (comp?.competitors || []).find((c) => c.homeAway === "away");
    return {
      eventId: `wnba:espn:${ev.id}`,
      source: "ESPN",
      date,
      commenceTime: ev.date || comp?.date,
      homeTeam: normalizeWnbaTeam(home?.team?.displayName || home?.team?.abbreviation),
      awayTeam: normalizeWnbaTeam(away?.team?.displayName || away?.team?.abbreviation),
      homeName: home?.team?.displayName,
      awayName: away?.team?.displayName,
      homeScore: home?.score != null && home.score !== "" ? Number(home.score) : null,
      awayScore: away?.score != null && away.score !== "" ? Number(away.score) : null,
    };
  });
}

function toHistoryGame(ev) {
  if (ev.homeScore == null || ev.awayScore == null || ev.homeScore === ev.awayScore) return null;
  if (!ev.homeTeam || !ev.awayTeam) return null;
  return { date: ev.date, homeTeam: ev.homeTeam, awayTeam: ev.awayTeam, homeName: ev.homeName, awayName: ev.awayName, homeScore: ev.homeScore, awayScore: ev.awayScore };
}

const cached = fs.existsSync(TEAM_GAMES) ? JSON.parse(fs.readFileSync(TEAM_GAMES, "utf8")) : [];
const priorDates = ["2026-09-17", "2026-09-18", "2026-09-19", "2026-09-20"];
const priorEspn = (await Promise.all(priorDates.map(fetchEspnSlate))).flat();
const priorGames = priorEspn.map(toHistoryGame).filter(Boolean);
const seen = new Set(cached.map((g) => `${g.date}|${g.homeTeam}|${g.awayTeam}`));
const extra = priorGames.filter((g) => !seen.has(`${g.date}|${g.homeTeam}|${g.awayTeam}`));
const games = [...cached, ...extra].filter((g) => String(g.date) < SLATE);
const walkedC = walkForwardC(games);
const walkedV1 = walkForward(games);

const espnEvents = await fetchEspnSlate(SLATE);
const odds = await probeOdds();
const sgoConfigured = isSgoConfigured();
const sgo = sgoConfigured
  ? await fetchSgoWnbaEvents({
      startsAfter: "2026-09-21T05:00:00Z",
      startsBefore: "2026-09-22T10:00:00Z",
      limit: 20,
    })
  : { ok: false, state: SGO_STATES.NOT_CONFIGURED, data: [], configured: false };

const slate = espnEvents.length
  ? buildFullWinnerSlate(espnEvents, {
      slateDate: SLATE,
      season: "2026",
      states: walkedC.states,
      homeCourt: walkedC.homeCourt,
      oddsEvents: odds.data || [],
      sgoEvents: sgo.data || [],
      officialPromotion: true,
      fetchedAt: new Date().toISOString(),
    })
  : { slateDateCT: SLATE, officialPromotion: true, productionMode: "WINNER_C_PRODUCTION", fullSlate: [], topWinners: [], noGames: true };

const persisted = persistWinnerSlate(slate);
const truth = sha(TRUTH);
const board = (slate.fullSlate || []).map((r) => ({
  startCT: r.startCT,
  away: r.awayName,
  home: r.homeName,
  winner: r.selectedWinnerName,
  pWinner: r.selectedProbability,
  rank: r.winnerRank,
  tracking: r.winnerTrackingType,
  model: r.modelVersion,
  components: r.featureSnapshot?.components || null,
  pdPick: r.featureSnapshot?.pdBaselinePick,
  pdP: r.featureSnapshot?.pdBaselineProbability,
  homeML: r.marketSnapshot?.homeMoneyline ?? null,
  awayML: r.marketSnapshot?.awayMoneyline ?? null,
  marketP: r.selectedWinnerId === r.homeTeam ? r.marketSnapshot?.noVigHome : r.marketSnapshot?.noVigAway,
  forensicV1: r.forensicWinnerV1,
  disagreement: r.marketSnapshot?.modelMarketDisagreement === true,
}));

const out = {
  slateDateCT: SLATE,
  todayAuthority: slateDateCT(new Date()),
  era: COURTEDGE_WINNER_C_PRODUCTION_V1,
  productionMode: slate.productionMode,
  gameCount: espnEvents.length,
  board,
  providers: {
    oddsApi: { configured: odds.configured, network: odds.network, auth: odds.auth, events: odds.events },
    sgo: { configured: sgoConfigured, state: sgo.state, events: (sgo.data || []).length, capabilities: inspectSgoWnbaCapabilities(sgo.data || []), health: getSgoHealth() },
  },
  priorNightGamesAdded: extra.length,
  productTruthHash: truth,
  productTruthUnchanged: truth === LOCKED,
  persisted: Boolean(persisted?.slate || persisted),
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ ...out, slate: persisted.slate || slate, v1StateCount: walkedV1.rows.length }, null, 2));
console.log(JSON.stringify({ ...out, games: espnEvents.map((g) => `${g.awayName} @ ${g.homeName}`), board }, null, 2));
