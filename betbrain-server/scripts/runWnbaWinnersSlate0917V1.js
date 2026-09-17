/**
 * Produce the real 2026-09-17 CT WNBA Winner slate.
 * Never prints API keys. Does not remint Product Truth.
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
import { persistWinnerSlate } from "../services/wnbaWinnerStoreV1.js";
import { normalizeWnbaTeam, slateDateCT } from "../engines/wnba/winnersV1/constants.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SLATE = "2026-09-17";
const TEAM_GAMES = path.join(ROOT, "research/courteedge-wnba-winners-v1/10-team-games.json");
const HIST = path.join(ROOT, "research/courteedge-wnba-winners-v1/20-historical.json");
const OUT = path.join(ROOT, "research/courteedge-wnba-winners-v1/30-slate-2026-09-17.json");
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
    if (res.status === 401 || res.status === 403) {
      return { configured: true, network: "HEALTHY", auth: "REJECTED", events: 0, data: [] };
    }
    if (!res.ok) return { configured: true, network: "ERROR", auth: "UNKNOWN", events: 0, data: [], status: res.status };
    const data = await res.json();
    return { configured: true, network: "HEALTHY", auth: "VALID", events: Array.isArray(data) ? data.length : 0, data: Array.isArray(data) ? data : [] };
  } catch (err) {
    const code = err?.cause?.code || err?.code || "";
    const network = String(code).includes("ECONNRESET") || String(err.message).includes("fetch failed")
      ? "UNREACHABLE"
      : "ERROR";
    return { configured: true, network, auth: "UNKNOWN", events: 0, data: [], errorCode: code || null };
  }
}

async function probeBdl() {
  const configured = Boolean(CONFIG.BALLDONTLIE_KEY);
  if (!configured) return { configured: false, network: "UNKNOWN", auth: "UNKNOWN" };
  try {
    const res = await fetch("https://api.balldontlie.io/wnba/v1/teams?per_page=1", {
      headers: { Authorization: CONFIG.BALLDONTLIE_KEY },
    });
    if (res.status === 401 || res.status === 403) return { configured: true, network: "HEALTHY", auth: "REJECTED" };
    if (res.ok) return { configured: true, network: "HEALTHY", auth: "VALID" };
    return { configured: true, network: "ERROR", auth: "UNKNOWN", status: res.status };
  } catch (err) {
    const code = err?.cause?.code || "";
    return {
      configured: true,
      network: String(code).includes("ECONNRESET") ? "UNREACHABLE" : "ERROR",
      auth: "UNKNOWN",
      errorCode: code || null,
    };
  }
}

async function fetchEspnSlate(date) {
  const ymd = date.replace(/-/g, "");
  const res = await fetch(
    `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${ymd}`,
    { headers: { "User-Agent": "CourtEdge-WnbaWinners-V1" } }
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
      commenceTime: ev.date || comp?.date,
      homeTeam: normalizeWnbaTeam(home?.team?.abbreviation),
      awayTeam: normalizeWnbaTeam(away?.team?.abbreviation),
      homeName: home?.team?.displayName,
      awayName: away?.team?.displayName,
      homeScore: home?.score != null ? Number(home.score) : null,
      awayScore: away?.score != null ? Number(away.score) : null,
      seasonPhase: /playoff/i.test(ev.season?.slug || "") ? "PLAYOFF" : "REGULAR_SEASON",
    };
  });
}

const hist = fs.existsSync(HIST) ? JSON.parse(fs.readFileSync(HIST, "utf8")) : null;
const officialPromotion = false;
const games = fs.existsSync(TEAM_GAMES) ? JSON.parse(fs.readFileSync(TEAM_GAMES, "utf8")) : [];
const walked = walkForward(games.filter((g) => String(g.date) < SLATE));

const espnEvents = await fetchEspnSlate(SLATE);
const odds = await probeOdds();
const bdl = await probeBdl();
const sgoConfigured = isSgoConfigured();
const sgo = sgoConfigured
  ? await fetchSgoWnbaEvents({
      startsAfter: "2026-09-17T05:00:00Z",
      startsBefore: "2026-09-18T10:00:00Z",
      limit: 20,
    })
  : { ok: false, state: SGO_STATES.NOT_CONFIGURED, data: [], configured: false };
const sgoNet = classifyNet(sgo);
const sgoCaps = inspectSgoWnbaCapabilities(sgo.data || []);

const slate = espnEvents.length
  ? buildFullWinnerSlate(espnEvents, {
      slateDate: SLATE,
      season: "2026",
      states: walked.states,
      homeCourt: walked.homeCourt || hist?.homeCourt,
      oddsEvents: odds.data || [],
      sgoEvents: sgo.data || [],
      officialPromotion,
      fetchedAt: new Date().toISOString(),
    })
  : {
      slateDateCT: SLATE,
      officialPromotion: false,
      productionMode: "TEST_ONLY",
      fullSlate: [],
      topWinners: [],
      testWinners: [],
      officialWinners: [],
      noGames: true,
    };

const persisted = persistWinnerSlate(slate);
const truth = sha(TRUTH);

const out = {
  slateDateCT: SLATE,
  todayAuthority: slateDateCT(new Date()),
  providers: {
    oddsApi: {
      configured: odds.configured,
      network: odds.network,
      auth: odds.auth,
      wnbaEventsFound: odds.events,
    },
    balldontlie: {
      configured: bdl.configured,
      network: bdl.network,
      auth: bdl.auth,
    },
    sgo: {
      configured: sgoConfigured,
      network: sgoNet.network,
      auth: sgoNet.auth,
      state: sgo.state,
      wnbaEventsFound: (sgo.data || []).length,
      moneylineEvents: sgoCaps.moneyline,
      capabilities: sgoCaps,
      health: getSgoHealth(),
    },
  },
  historical: hist,
  officialPromotion: "INSUFFICIENT",
  productionMode: "TEST_ONLY",
  gameCount: espnEvents.length,
  slate: persisted.slate,
  productTruthHash: truth,
  productTruthUnchanged: truth === LOCKED || truth === hist?.productTruthHash,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log(JSON.stringify({
  gameCount: out.gameCount,
  productionMode: out.productionMode,
  official: (slate.officialWinners || []).length,
  test: (slate.testWinners || []).length,
  providers: out.providers,
  games: espnEvents.map((g) => `${g.awayName} @ ${g.homeName}`),
}, null, 2));
