import fetch from "node-fetch";
import { CONFIG } from "../config.js";
import { verifyPickGameIsFinal } from "./gameFinalVerificationService.js";

const SPORTS_KEY = CONFIG.SPORTS_KEY;
const SPORTS_WNBA_BASE = "https://api.sportsdata.io/v3/wnba/stats/json";
const ESPN_WNBA_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard";
const ESPN_WNBA_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary";

const dateStatsCache = new Map();
const espnEventCache = new Map();

function clean(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
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

function espnDateParam(queryDate = "") {
  return String(queryDate || "").replace(/-/g, "");
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

function normalizeEspnTeam(team = {}) {
  const display = String(team.displayName || "").trim();
  const locationName = `${team.location || ""} ${team.name || ""}`.trim();

  return (
    normalizeWnbaTeam(display) ||
    normalizeWnbaTeam(locationName) ||
    normalizeWnbaTeam(team.abbreviation || "")
  );
}

function parseMadeAttempted(value = "") {
  const match = String(value || "").match(/^(\d+)-(\d+)$/);

  if (!match) return { made: 0, attempted: 0 };

  return { made: num(match[1]), attempted: num(match[2]) };
}

function parseEspnMinutes(value = "") {
  const raw = String(value || "").trim();

  if (!raw || raw === "--" || raw === "DNP") return 0;

  if (raw.includes(":")) {
    const [m, s] = raw.split(":").map(Number);
    return Number((num(m) + num(s) / 60).toFixed(1));
  }

  return num(raw);
}

async function fetchJSON(url, label, headers = {}) {
  try {
    console.log(`${label} URL:`, url);

    const res = await fetch(url, { headers });
    const data = await res.json();

    console.log(`${label} STATUS:`, res.status);
    console.log(
      `${label} COUNT:`,
      Array.isArray(data) ? data.length : data?.data?.length ?? "object"
    );

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

function normalizeSportsDataWnbaStat(stat = {}, fallbackDate = "") {
  return {
    source: "SportsData-WNBA",
    league: "WNBA",
    date: getSlateDateKey(stat.Day || stat.DateTime || stat.GameDate || fallbackDate),
    player: stat.Name || stat.PlayerName || stat.FullName || "",
    playerKey: clean(stat.Name || stat.PlayerName || stat.FullName || ""),
    team: normalizeWnbaTeam(stat.Team || stat.TeamAbbreviation || ""),
    opponent: normalizeWnbaTeam(
      stat.Opponent || stat.OpponentTeam || stat.OpponentAbbreviation || ""
    ),
    points: num(stat.Points),
    minutes: num(stat.Minutes || stat.MinutesPlayed),
    fga: num(stat.FieldGoalsAttempted || stat.FGA),
    fta: num(stat.FreeThrowsAttempted || stat.FTA),
    fg3a: num(stat.ThreePointersAttempted || stat.ThreePointAttempts || stat.FG3A),
    gameId: stat.GameID || stat.GlobalGameID || "",
    raw: stat,
  };
}

function normalizeEspnPlayerStat({
  athleteEntry = {},
  statGroup = {},
  teamKey = "",
  opponentKey = "",
  gameDate = "",
  eventId = "",
}) {
  const athlete = athleteEntry.athlete || {};
  const keys = Array.isArray(statGroup.keys) ? statGroup.keys : [];
  const values = Array.isArray(athleteEntry.stats) ? athleteEntry.stats : [];
  const statMap = {};

  keys.forEach((key, index) => {
    statMap[key] = values[index];
  });

  const points = num(statMap.points);
  const minutes = parseEspnMinutes(statMap.minutes);
  const fgPair = parseMadeAttempted(statMap["fieldGoalsMade-fieldGoalsAttempted"]);
  const ftPair = parseMadeAttempted(statMap["freeThrowsMade-freeThrowsAttempted"]);
  const fg3Pair = parseMadeAttempted(
    statMap["threePointFieldGoalsMade-threePointFieldGoalsAttempted"]
  );

  return {
    source: "ESPN-WNBA",
    league: "WNBA",
    date: gameDate,
    player: athlete.displayName || athlete.fullName || athlete.shortName || "",
    playerKey: clean(athlete.displayName || athlete.fullName || ""),
    team: teamKey,
    opponent: opponentKey,
    points,
    minutes,
    fga: fgPair.attempted,
    fta: ftPair.attempted,
    fg3a: fg3Pair.attempted,
    gameId: eventId ? String(eventId) : "",
    raw: {
      athlete,
      statMap,
      eventId,
    },
  };
}

function parseEspnBoxScorePlayers(summary = {}, gameDate = "", eventId = "") {
  const playerGroups = summary?.boxscore?.players;

  if (!Array.isArray(playerGroups) || !playerGroups.length) return [];

  const stats = [];

  for (const group of playerGroups) {
    const teamKey = normalizeEspnTeam(group?.team || {});
    const opponentKey =
      playerGroups
        .map((entry) => normalizeEspnTeam(entry?.team || {}))
        .find((key) => key && key !== teamKey) || "";

    const statGroup = (group.statistics || []).find((entry) =>
      Array.isArray(entry?.athletes)
    );

    if (!statGroup) continue;

    for (const athleteEntry of statGroup.athletes || []) {
      const didNotPlay = Boolean(athleteEntry.didNotPlay);

      if (didNotPlay) continue;

      stats.push(
        normalizeEspnPlayerStat({
          athleteEntry,
          statGroup,
          teamKey,
          opponentKey,
          gameDate,
          eventId,
        })
      );
    }
  }

  return stats.filter((stat) => stat.player && stat.date);
}

function eventMatchesPickTeams(event = {}, teamA = "", teamB = "") {
  const comp = event?.competitions?.[0];
  const competitors = comp?.competitors || [];
  const eventTeams = competitors
    .map((entry) => normalizeEspnTeam(entry?.team || {}))
    .filter(Boolean);

  if (!teamA || !teamB || eventTeams.length < 2) return false;

  return eventTeams.includes(teamA) && eventTeams.includes(teamB);
}

function eventMatchesQueryDate(event = {}, queryDate = "") {
  const comp = event?.competitions?.[0];
  const eventDate = getSlateDateKey(comp?.date || event?.date || "");

  return Boolean(queryDate && eventDate && eventDate === queryDate);
}

function eventIsFinal(event = {}) {
  const status = event?.competitions?.[0]?.status || event?.status || {};
  const state = String(status?.type?.state || "").toLowerCase();
  const completed = Boolean(status?.type?.completed);

  return state === "post" || completed;
}

async function findEspnFinalEvent(queryDate = "", teamA = "", teamB = "") {
  const cacheKey = `${queryDate}:${teamA}:${teamB}`;

  if (espnEventCache.has(cacheKey)) {
    return espnEventCache.get(cacheKey);
  }

  const url = `${ESPN_WNBA_SCOREBOARD}?dates=${espnDateParam(queryDate)}`;
  const data = await fetchJSON(url, `ESPN WNBA SCOREBOARD ${queryDate}`);

  const events = Array.isArray(data?.events) ? data.events : [];
  const match =
    events.find(
      (event) =>
        eventIsFinal(event) &&
        eventMatchesQueryDate(event, queryDate) &&
        eventMatchesPickTeams(event, teamA, teamB)
    ) || null;

  espnEventCache.set(cacheKey, match);
  return match;
}

export async function fetchWnbaOfficialStatsByDate(queryDate = "") {
  const dateKey = getSlateDateKey(queryDate);

  if (!dateKey) return [];

  if (dateStatsCache.has(`official:${dateKey}`)) {
    return dateStatsCache.get(`official:${dateKey}`);
  }

  if (!SPORTS_KEY) {
    console.log("WNBA OFFICIAL FALLBACK: SPORTS_KEY missing");
    dateStatsCache.set(`official:${dateKey}`, []);
    return [];
  }

  const url = `${SPORTS_WNBA_BASE}/PlayerGameStatsByDate/${dateKey}`;
  const data = await fetchJSON(url, `WNBA OFFICIAL STATS ${dateKey}`, {
    "Ocp-Apim-Subscription-Key": SPORTS_KEY,
  });

  const stats = (Array.isArray(data) ? data : []).map((row) =>
    normalizeSportsDataWnbaStat(row, dateKey)
  );

  dateStatsCache.set(`official:${dateKey}`, stats);
  return stats;
}

export async function fetchEspnWnbaStatsByDate(queryDate = "", teamA = "", teamB = "") {
  const dateKey = getSlateDateKey(queryDate);
  const cacheKey = `espn:${dateKey}:${teamA}:${teamB}`;

  if (!dateKey) return [];

  if (dateStatsCache.has(cacheKey)) {
    return dateStatsCache.get(cacheKey);
  }

  const event = await findEspnFinalEvent(dateKey, teamA, teamB);

  if (!event?.id) {
    dateStatsCache.set(cacheKey, []);
    return [];
  }

  const url = `${ESPN_WNBA_SUMMARY}?event=${event.id}`;
  const summary = await fetchJSON(url, `ESPN WNBA SUMMARY ${event.id}`);

  const stats = parseEspnBoxScorePlayers(summary, dateKey, event.id);

  dateStatsCache.set(cacheKey, stats);
  return stats;
}

export async function fetchWnbaFallbackStatsForPick(savedPick = {}, helpers = {}) {
  const queryDates = helpers.getPickQueryDates?.(savedPick) || [];
  const getPickTeams = helpers.getPickTeams;
  const findPlayerResult = helpers.findPlayerResult;

  if (!queryDates.length || !getPickTeams || !findPlayerResult) {
    return {
      statResult: null,
      officialRowCount: 0,
      espnRowCount: 0,
      officialAttempted: false,
      espnAttempted: false,
    };
  }

  const gameFinalCheck = await verifyPickGameIsFinal(savedPick);

  if (!gameFinalCheck.gameFinal) {
    return {
      statResult: null,
      officialRowCount: 0,
      espnRowCount: 0,
      officialAttempted: false,
      espnAttempted: false,
      gameNotFinal: true,
    };
  }

  const { teamA, teamB } = getPickTeams(savedPick, "WNBA");
  let officialRowCount = 0;
  let espnRowCount = 0;
  let officialAttempted = false;
  let espnAttempted = false;
  let statResult = null;

  for (const queryDate of queryDates) {
    if (statResult) break;

    officialAttempted = true;
    const officialStats = await fetchWnbaOfficialStatsByDate(queryDate);
    officialRowCount = Math.max(officialRowCount, officialStats.length);

    statResult = findPlayerResult(savedPick, officialStats, {
      playerFallbackAttempted: true,
      wnbaOfficialFallback: true,
    });

    if (statResult) break;
  }

  for (const queryDate of queryDates) {
    if (statResult) break;

    espnAttempted = true;
    const espnStats = await fetchEspnWnbaStatsByDate(queryDate, teamA, teamB);
    espnRowCount = Math.max(espnRowCount, espnStats.length);

    statResult = findPlayerResult(savedPick, espnStats, {
      playerFallbackAttempted: true,
      espnFallback: true,
    });
  }

  return {
    statResult,
    officialRowCount,
    espnRowCount,
    officialAttempted,
    espnAttempted,
  };
}
