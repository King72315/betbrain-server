import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const BALL_KEY = CONFIG.BALLDONTLIE_KEY;
const SPORTS_KEY = CONFIG.SPORTS_KEY;

const BALL_BASES = {
  NBA: "https://api.balldontlie.io/v1",
  WNBA: "https://api.balldontlie.io/wnba/v1",
};

const SPORTS_SCORES_BASE = {
  NBA: "https://api.sportsdata.io/v3/nba/scores/json",
  WNBA: "https://api.sportsdata.io/v3/wnba/scores/json",
};

const ESPN_WNBA_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard";

const verificationCache = new Map();

function clean(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeLeague(value = "NBA") {
  return String(value || "NBA").toUpperCase() === "WNBA" ? "WNBA" : "NBA";
}

function normalizeWnbaTeam(value = "") {
  const raw = String(value || "").trim();
  const v = raw.toLowerCase();
  const c = clean(raw);

  const wnbaMap = {
    "atlanta dream": "atlantadream",
    "chicago sky": "chicagosky",
    "connecticut sun": "connecticutsun",
    "dallas wings": "dallaswings",
    "golden state valkyries": "goldenstatevalkyries",
    "indiana fever": "indianafever",
    "las vegas aces": "lasvegasaces",
    "los angeles sparks": "losangelessparks",
    "minnesota lynx": "minnesotalynx",
    "new york liberty": "newyorkliberty",
    "phoenix mercury": "phoenixmercury",
    "seattle storm": "seattlestorm",
    "washington mystics": "washingtonmystics",
    "toronto tempo": "torontotempo",
    "portland fire": "portlandfire",
    atl: "atlantadream",
    chi: "chicagosky",
    con: "connecticutsun",
    conn: "connecticutsun",
    dal: "dallaswings",
    gs: "goldenstatevalkyries",
    gsv: "goldenstatevalkyries",
    ind: "indianafever",
    lv: "lasvegasaces",
    lva: "lasvegasaces",
    las: "lasvegasaces",
    la: "losangelessparks",
    min: "minnesotalynx",
    ny: "newyorkliberty",
    nyl: "newyorkliberty",
    phx: "phoenixmercury",
    pho: "phoenixmercury",
    sea: "seattlestorm",
    was: "washingtonmystics",
    wash: "washingtonmystics",
    tor: "torontotempo",
    tempo: "torontotempo",
    por: "portlandfire",
    fire: "portlandfire",
  };

  return wnbaMap[v] || wnbaMap[c] || c;
}

function normalizeNbaTeam(value = "") {
  const raw = String(value || "").trim();
  const v = raw.toLowerCase();
  const c = clean(raw);

  const nbaMap = {
    atl: "atl",
    bos: "bos",
    bkn: "bkn",
    brk: "bkn",
    cha: "cha",
    chi: "chi",
    cle: "cle",
    dal: "dal",
    den: "den",
    det: "det",
    gsw: "gs",
    gs: "gs",
    hou: "hou",
    ind: "ind",
    lac: "lac",
    lal: "lal",
    mem: "mem",
    mia: "mia",
    mil: "mil",
    min: "min",
    nop: "no",
    no: "no",
    nyk: "ny",
    ny: "ny",
    okc: "okc",
    orl: "orl",
    phi: "phi",
    phx: "phx",
    por: "por",
    sac: "sac",
    sas: "sa",
    sa: "sa",
    tor: "tor",
    uta: "uta",
    was: "was",
  };

  return nbaMap[v] || nbaMap[c] || c;
}

function normalizeTeam(value = "", league = "NBA") {
  return league === "WNBA" ? normalizeWnbaTeam(value) : normalizeNbaTeam(value);
}

function getSlateDateKey(dateInput) {
  if (!dateInput) return "";

  const raw = String(dateInput).trim();
  const direct = raw.match(/^(\d{4}-\d{2}-\d{2})/);

  if (direct) return direct[1];

  const parsed = new Date(dateInput);

  if (Number.isNaN(parsed.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: CONFIG.TIMEZONE || "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(parsed);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return year && month && day ? `${year}-${month}-${day}` : "";
}

function formatDate(dateInput) {
  if (!dateInput) return getSlateDateKey(new Date());

  const direct = getSlateDateKey(dateInput);
  if (direct) return direct;

  return getSlateDateKey(new Date());
}

function getSlateDateCT(commenceTime) {
  const source = commenceTime || "";
  if (!source) return "";

  const parsed = new Date(source);
  if (Number.isNaN(parsed.getTime())) {
    return String(source).slice(0, 10);
  }

  return parsed.toLocaleDateString("en-CA", {
    timeZone: CONFIG.TIMEZONE || "America/Chicago",
  });
}

function getPickDate(savedPick = {}) {
  const dateSource =
    savedPick.gameDate ||
    savedPick.date ||
    savedPick.commenceTime ||
    savedPick.time ||
    null;

  return dateSource ? formatDate(dateSource) : "";
}

function getPickQueryDates(savedPick = {}) {
  const dates = new Set();
  const gameDate = savedPick.gameDate || savedPick.date || "";

  if (gameDate) {
    const normalized = getSlateDateKey(gameDate) || formatDate(gameDate);
    if (normalized) dates.add(normalized);
  }

  // Canonical CT slate date must participate in Final lookups (many research
  // rows only carry slateDate / resultsSlateDate without commenceTime).
  for (const key of [
    "slateDate",
    "slateDateCt",
    "canonicalSlateDateCT",
    "resultsSlateDate",
    "cohortSlateDate",
  ]) {
    const raw = String(savedPick[key] || "").slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) dates.add(raw);
  }

  const commence = savedPick.commenceTime || savedPick.time || "";
  if (commence) {
    const ctDate = getSlateDateCT(commence);
    if (ctDate) dates.add(ctDate);

    const utcDate = getSlateDateKey(commence);
    if (utcDate) dates.add(utcDate);
  }

  const primary = getPickDate(savedPick);
  if (primary) dates.add(primary);

  return [...dates].filter(Boolean);
}

function getPickTeams(savedPick = {}, league = "NBA") {
  const cleanLeague = normalizeLeague(league || savedPick.league || "NBA");
  const game = String(savedPick.game || savedPick.gameLabel || "");
  const parts = game.split(/\s+vs\s+/i).map((part) => part.trim()).filter(Boolean);

  if (parts.length === 2) {
    return {
      teamA: normalizeTeam(parts[0], cleanLeague),
      teamB: normalizeTeam(parts[1], cleanLeague),
    };
  }

  return {
    teamA: normalizeTeam(savedPick.team || "", cleanLeague),
    teamB: normalizeTeam(savedPick.opponent || "", cleanLeague),
  };
}

function normalizeBallGameTeam(team = {}) {
  return clean(`${team?.city || ""}${team?.name || ""}`);
}

function normalizeEspnTeam(team = {}) {
  const display = String(team.displayName || "").trim();
  const locationName = `${team.location || ""} ${team.name || ""}`.trim();

  return (
    normalizeWnbaTeam(display) ||
    normalizeWnbaTeam(locationName) ||
    normalizeWnbaTeam(team.abbreviation || "")
  );
}

function parseStatus(value = "") {
  return String(value || "").trim();
}

function statusIsFinal(status = "") {
  const normalized = parseStatus(status).toLowerCase();

  return (
    normalized === "final" ||
    normalized === "post" ||
    normalized === "closed" ||
    normalized.includes("final") ||
    normalized === "f/ot" ||
    normalized === "f"
  );
}

function statusIsLive(status = "") {
  const normalized = parseStatus(status).toLowerCase();

  if (!normalized || statusIsFinal(status)) return false;

  return (
    normalized.includes("progress") ||
    normalized.includes("live") ||
    normalized === "in" ||
    normalized === "halftime" ||
    normalized.includes("half")
  );
}

function teamsMatchPair(teamA = "", teamB = "", left = "", right = "") {
  if (!teamA || !teamB || !left || !right) return false;

  return (
    (left === teamA && right === teamB) ||
    (left === teamB && right === teamA)
  );
}

async function fetchJSON(url, label, headers = {}) {
  try {
    console.log(`${label} URL:`, url);

    const res = await fetch(url, { headers });
    const data = await res.json();

    console.log(`${label} STATUS:`, res.status);

    if (!res.ok) {
      console.log(`${label} ERROR BODY:`, data);
      return null;
    }

    return data;
  } catch (err) {
    console.log(`${label} FAILED:`, err.message);
    return null;
  }
}

function providerResult(source, status, gameId = "") {
  const parsedStatus = parseStatus(status);

  return {
    source,
    status: parsedStatus,
    gameId: gameId ? String(gameId) : "",
    isFinal: statusIsFinal(parsedStatus),
    isLive: statusIsLive(parsedStatus),
  };
}

async function checkBdlGameFinal(queryDate, teamA, teamB, league, pickGameId = "") {
  if (!BALL_KEY) return null;

  const cacheKey = `bdl:${league}:${queryDate}:${teamA}:${teamB}:${pickGameId}`;

  if (verificationCache.has(cacheKey)) {
    return verificationCache.get(cacheKey);
  }

  const base = BALL_BASES[league];
  if (!base) return null;

  const url = `${base}/games?dates[]=${queryDate}&per_page=100`;
  const data = await fetchJSON(url, `BDL GAMES ${league} ${queryDate}`, {
    Authorization: BALL_KEY,
  });

  const games = Array.isArray(data?.data) ? data.data : [];
  const match =
    games.find((game) => {
      if (pickGameId && String(game?.id || "") === String(pickGameId)) {
        return true;
      }

      const home = normalizeBallGameTeam(game?.home_team);
      const away = normalizeBallGameTeam(game?.visitor_team);

      return teamsMatchPair(teamA, teamB, home, away);
    }) || null;

  if (!match) {
    return null;
  }

  const result = providerResult(
    "BallDontLie",
    match?.status || "",
    match?.id || pickGameId
  );

  if (result.isFinal) {
    verificationCache.set(cacheKey, result);
  }
  return result;
}

function espnDateParam(queryDate = "") {
  return String(queryDate || "").replace(/-/g, "");
}

async function checkEspnGameFinal(queryDate, teamA, teamB) {
  const cacheKey = `espn:${queryDate}:${teamA}:${teamB}`;

  if (verificationCache.has(cacheKey)) {
    return verificationCache.get(cacheKey);
  }

  const url = `${ESPN_WNBA_SCOREBOARD}?dates=${espnDateParam(queryDate)}`;
  const data = await fetchJSON(url, `ESPN WNBA SCOREBOARD ${queryDate}`);
  const events = Array.isArray(data?.events) ? data.events : [];

  const match =
    events.find((event) => {
      const comp = event?.competitions?.[0];

      const competitors = comp?.competitors || [];
      const eventTeams = competitors
        .map((entry) => normalizeEspnTeam(entry?.team || {}))
        .filter(Boolean);

      if (eventTeams.length < 2) return false;

      return (
        eventTeams.includes(teamA) &&
        eventTeams.includes(teamB)
      );
    }) || null;

  if (!match) {
    return null;
  }

  const status = match?.competitions?.[0]?.status || match?.status || {};
  const state = parseStatus(status?.type?.state || status?.type?.name || "");
  const completed = Boolean(status?.type?.completed);
  const parsedStatus = completed || state.toLowerCase() === "post" ? "Final" : state;

  const result = providerResult("ESPN", parsedStatus, match?.id || "");

  if (result.isFinal) {
    verificationCache.set(cacheKey, result);
  }
  return result;
}

async function checkSportsDataGameFinal(queryDate, teamA, teamB, league, pickGameId = "") {
  if (!SPORTS_KEY) return null;

  const cacheKey = `sportsdata:${league}:${queryDate}:${teamA}:${teamB}:${pickGameId}`;

  if (verificationCache.has(cacheKey)) {
    return verificationCache.get(cacheKey);
  }

  const base = SPORTS_SCORES_BASE[league];
  if (!base) return null;

  const url = `${base}/GamesByDate/${queryDate}`;
  const data = await fetchJSON(url, `SPORTSDATA GAMES ${league} ${queryDate}`, {
    "Ocp-Apim-Subscription-Key": SPORTS_KEY,
  });

  const games = Array.isArray(data) ? data : [];
  const match =
    games.find((game) => {
      const gameId = game?.GameID || game?.GlobalGameID || game?.ScoreID || "";

      if (pickGameId && String(gameId) === String(pickGameId)) {
        return true;
      }

      const home = normalizeTeam(game?.HomeTeam || game?.Home || "", league);
      const away = normalizeTeam(game?.AwayTeam || game?.Away || "", league);

      return teamsMatchPair(teamA, teamB, home, away);
    }) || null;

  if (!match) {
    return null;
  }

  const result = providerResult(
    "SportsData",
    match?.Status || match?.GameStatus || "",
    match?.GameID || match?.GlobalGameID || pickGameId
  );

  if (result.isFinal) {
    verificationCache.set(cacheKey, result);
  }
  return result;
}

/** Verify provider/scoreboard reports the pick's game as FINAL before grading. */
export async function verifyPickGameIsFinal(savedPick = {}) {
  const league = normalizeLeague(savedPick.league || "NBA");
  const queryDates = getPickQueryDates(savedPick);
  const { teamA, teamB } = getPickTeams(savedPick, league);
  const pickGameId = savedPick.gameId || savedPick.eventId || "";

  const providerResults = [];

  for (const queryDate of queryDates) {
    const bdl = await checkBdlGameFinal(queryDate, teamA, teamB, league, pickGameId);
    if (bdl) providerResults.push(bdl);
  }

  if (league === "WNBA") {
    for (const queryDate of queryDates) {
      const espn = await checkEspnGameFinal(queryDate, teamA, teamB);
      if (espn) providerResults.push(espn);
    }
  }

  for (const queryDate of queryDates) {
    const sportsData = await checkSportsDataGameFinal(
      queryDate,
      teamA,
      teamB,
      league,
      pickGameId
    );
    if (sportsData) providerResults.push(sportsData);
  }

  const finalProviders = providerResults.filter((entry) => entry.isFinal);
  const liveProviders = providerResults.filter((entry) => entry.isLive);
  const gameFinal = finalProviders.length > 0;
  const blockedByLiveGame = !gameFinal && liveProviders.length > 0;
  const blockedByGameNotFinal = !gameFinal;

  const primary =
    finalProviders[0] ||
    liveProviders[0] ||
    providerResults[0] ||
    null;

  return {
    gameFinal,
    gameStatus: primary?.status || "unknown",
    blockedByGameNotFinal,
    blockedByLiveGame,
    verifiedSource: finalProviders[0]?.source || null,
    providers: providerResults,
  };
}

export function clearGameFinalVerificationCache() {
  verificationCache.clear();
}
