/**
 * Build and persist a Winner-C production slate for a CT date.
 * Historical frozen slates are never rewritten.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "../config.js";
import {
  fetchSgoWnbaEvents,
  getSgoHealth,
  inspectSgoWnbaCapabilities,
  isSgoConfigured,
  SGO_STATES,
} from "./sportsGameOddsClientV1.js";
import { buildFullWinnerSlate } from "../engines/wnba/winnersV1/buildWnbaWinnerSlateV1.js";
import { walkForward } from "../engines/wnba/winnersV1/winnerModelV1.js";
import { walkForwardC } from "../engines/wnba/winnersV1/winnerModelC.js";
import { persistWinnerSlate, getWinnerSlate } from "./wnbaWinnerStoreV1.js";
import { normalizeWnbaTeam, slateDateCT } from "../engines/wnba/winnersV1/constants.js";
import { COURTEDGE_WINNER_C_PRODUCTION_V1, isCourtEdgePtsWinnerCEra } from "../engines/courtEdgeEraV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEAM_GAMES = path.join(ROOT, "research/courteedge-wnba-winners-v1/10-team-games.json");

export function wnbaEventOwnedBySlate(commenceTime, slateDate) {
  return slateDateCT(commenceTime) === String(slateDate || "");
}

function nextCalendarDay(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

async function fetchEspnSlate(date) {
  const days = [date, nextCalendarDay(date)];
  const batches = await Promise.all(
    days.map(async (day) => {
      const ymd = String(day).replace(/-/g, "");
      const res = await fetch(
        `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${ymd}`,
        { headers: { "User-Agent": "CourtEdge-WinnerC-V1" } }
      );
      if (!res.ok) return [];
      const json = await res.json();
      return json.events || [];
    })
  );
  const seen = new Set();
  const events = [];
  for (const ev of batches.flat()) {
    if (!ev?.id || seen.has(String(ev.id))) continue;
    const comp = ev.competitions?.[0];
    const commenceTime = ev.date || comp?.date;
    if (!wnbaEventOwnedBySlate(commenceTime, date)) continue;
    seen.add(String(ev.id));
    const home = (comp?.competitors || []).find((c) => c.homeAway === "home");
    const away = (comp?.competitors || []).find((c) => c.homeAway === "away");
    events.push({
      eventId: `wnba:espn:${ev.id}`,
      source: "ESPN",
      date: slateDateCT(commenceTime),
      commenceTime,
      homeTeam: normalizeWnbaTeam(home?.team?.displayName || home?.team?.abbreviation),
      awayTeam: normalizeWnbaTeam(away?.team?.displayName || away?.team?.abbreviation),
      homeName: home?.team?.displayName,
      awayName: away?.team?.displayName,
      homeScore: home?.score != null && home.score !== "" ? Number(home.score) : null,
      awayScore: away?.score != null && away.score !== "" ? Number(away.score) : null,
    });
  }
  return events;
}

function toHistoryGame(ev) {
  if (ev.homeScore == null || ev.awayScore == null || ev.homeScore === ev.awayScore) return null;
  if (!ev.homeTeam || !ev.awayTeam) return null;
  return {
    date: ev.date,
    homeTeam: ev.homeTeam,
    awayTeam: ev.awayTeam,
    homeName: ev.homeName,
    awayName: ev.awayName,
    homeScore: ev.homeScore,
    awayScore: ev.awayScore,
  };
}

async function probeOdds() {
  if (!CONFIG.ODDS_KEY) return { configured: false, data: [] };
  try {
    const url = `https://api.the-odds-api.com/v4/sports/basketball_wnba/odds?regions=us&markets=h2h&oddsFormat=american&apiKey=${CONFIG.ODDS_KEY}`;
    const res = await fetch(url);
    if (!res.ok) return { configured: true, data: [] };
    const data = await res.json();
    return { configured: true, data: Array.isArray(data) ? data : [] };
  } catch {
    return { configured: true, data: [] };
  }
}

export async function buildAndPersistWinnerCSlate(slateDate = slateDateCT(new Date())) {
  const date = String(slateDate);
  if (!isCourtEdgePtsWinnerCEra(date)) {
    return { ok: false, error: "NOT_WINNER_C_ERA", slateDateCT: date };
  }
  const existing = getWinnerSlate(date);
  if (existing?.frozen === true) {
    return { ok: true, reused: true, frozen: true, slate: existing };
  }

  const cached = fs.existsSync(TEAM_GAMES) ? JSON.parse(fs.readFileSync(TEAM_GAMES, "utf8")) : [];
  const priorDates = [];
  const start = new Date(`${date}T12:00:00-05:00`);
  for (let i = 1; i <= 5; i += 1) {
    const d = new Date(start.getTime() - i * 86400000);
    priorDates.push(slateDateCT(d));
  }
  const priorEspn = (await Promise.all(priorDates.map(fetchEspnSlate))).flat();
  const priorGames = priorEspn.map(toHistoryGame).filter(Boolean);
  const seen = new Set(cached.map((g) => `${g.date}|${g.homeTeam}|${g.awayTeam}`));
  const extra = priorGames.filter((g) => !seen.has(`${g.date}|${g.homeTeam}|${g.awayTeam}`));
  const games = [...cached, ...extra].filter((g) => String(g.date) < date);
  const walkedC = walkForwardC(games);
  const walkedV1 = walkForward(games);

  const espnEvents = await fetchEspnSlate(date);
  const odds = await probeOdds();
  const sgoConfigured = isSgoConfigured();
  const next = new Date(new Date(`${date}T12:00:00-05:00`).getTime() + 86400000);
  const sgo = sgoConfigured
    ? await fetchSgoWnbaEvents({
        startsAfter: `${date}T05:00:00Z`,
        startsBefore: `${slateDateCT(next)}T10:00:00Z`,
        limit: 20,
      })
    : { ok: false, state: SGO_STATES.NOT_CONFIGURED, data: [], configured: false };

  const slate = espnEvents.length
    ? buildFullWinnerSlate(espnEvents, {
        slateDate: date,
        season: "2026",
        states: walkedC.states,
        homeCourt: walkedC.homeCourt,
        oddsEvents: odds.data || [],
        sgoEvents: sgo.data || [],
        officialPromotion: true,
        fetchedAt: new Date().toISOString(),
      })
    : {
        slateDateCT: date,
        officialPromotion: true,
        productionMode: "WINNER_C_PRODUCTION",
        fullSlate: [],
        topWinners: [],
        noGames: true,
      };

  const persisted = persistWinnerSlate(slate);
  return {
    ok: true,
    reused: persisted?.reused === true,
    frozen: persisted?.frozen === true,
    era: COURTEDGE_WINNER_C_PRODUCTION_V1,
    slateDateCT: date,
    gameCount: espnEvents.length,
    v1ForensicRows: walkedV1.rows.length,
    providers: {
      oddsApi: { configured: odds.configured, events: (odds.data || []).length },
      sgo: {
        configured: sgoConfigured,
        state: sgo.state,
        events: (sgo.data || []).length,
        capabilities: inspectSgoWnbaCapabilities(sgo.data || []),
        health: getSgoHealth(),
      },
    },
    slate: persisted?.slate || slate,
  };
}
