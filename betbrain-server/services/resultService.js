import fetch from "node-fetch";
import { CONFIG } from "../config.js";
import { fetchPlayerStats } from "./ballService.js";

const SPORTS_BASE = "https://api.sportsdata.io/api/nba";
const SPORTS_KEY = CONFIG.SPORTS_KEY;
const BALL_KEY = CONFIG.BALLDONTLIE_KEY;

const BALL_BASES = {
  NBA: "https://api.balldontlie.io/v1",
  WNBA: "https://api.balldontlie.io/wnba/v1",
};

function clean(value = "") {
  return String(value)
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

function formatDate(date = new Date()) {
  if (!date) return getSlateDateKey(new Date());

  const direct = getSlateDateKey(date);

  if (direct) return direct;

  return getSlateDateKey(new Date());
}

function normalizeLeague(value = "NBA") {
  const league = String(value || "NBA").toUpperCase();

  if (league === "WNBA") return "WNBA";

  return "NBA";
}

function normalizeTeam(value = "", league = "NBA") {
  const raw = String(value || "").trim();
  const v = raw.toLowerCase();
  const c = clean(raw);

  const nbaMap = {
    "atlanta hawks": "atl",
    "boston celtics": "bos",
    "brooklyn nets": "bkn",
    "charlotte hornets": "cha",
    "chicago bulls": "chi",
    "cleveland cavaliers": "cle",
    "dallas mavericks": "dal",
    "denver nuggets": "den",
    "detroit pistons": "det",
    "golden state warriors": "gs",
    "houston rockets": "hou",
    "indiana pacers": "ind",
    "los angeles clippers": "lac",
    "los angeles lakers": "lal",
    "memphis grizzlies": "mem",
    "miami heat": "mia",
    "milwaukee bucks": "mil",
    "minnesota timberwolves": "min",
    "new orleans pelicans": "no",
    "new york knicks": "ny",
    "oklahoma city thunder": "okc",
    "orlando magic": "orl",
    "philadelphia 76ers": "phi",
    "phoenix suns": "phx",
    "portland trail blazers": "por",
    "sacramento kings": "sac",
    "san antonio spurs": "sa",
    "toronto raptors": "tor",
    "utah jazz": "uta",
    "washington wizards": "was",

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

    atlantadream: "atlantadream",
    chicagosky: "chicagosky",
    connecticutsun: "connecticutsun",
    dallaswings: "dallaswings",
    goldenstatevalkyries: "goldenstatevalkyries",
    indianafever: "indianafever",
    lasvegasaces: "lasvegasaces",
    losangelessparks: "losangelessparks",
    minnesotalynx: "minnesotalynx",
    newyorkliberty: "newyorkliberty",
    phoenixmercury: "phoenixmercury",
    seattlestorm: "seattlestorm",
    washingtonmystics: "washingtonmystics",
    torontotempo: "torontotempo",
    portlandfire: "portlandfire",

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
    lasparks: "losangelessparks",
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

  if (league === "WNBA") {
    return wnbaMap[v] || wnbaMap[c] || c;
  }

  return nbaMap[v] || nbaMap[c] || c;
}

function fullBallPlayerName(player = {}) {
  return `${player?.first_name || ""} ${player?.last_name || ""}`.trim();
}

function normalizeBallTeam(team = {}) {
  return clean(`${team?.city || ""}${team?.name || ""}`);
}

function normalizeBallGameTeam(team = {}) {
  return clean(`${team?.city || ""}${team?.name || ""}`);
}

function getBallOpponent(stat = {}) {
  const playerTeam = normalizeBallTeam(stat.team);
  const home = normalizeBallGameTeam(stat.game?.home_team);
  const away = normalizeBallGameTeam(stat.game?.visitor_team);

  if (playerTeam && home && playerTeam === home) return away;
  if (playerTeam && away && playerTeam === away) return home;

  return home || away || "";
}

async function fetchJSON(url, label, headers = {}, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`${label} URL:`, url);

      const res = await fetch(url, { headers });
      const data = await res.json();

      console.log(`${label} STATUS:`, res.status);
      console.log(`${label} RAW COUNT:`, data?.data?.length ?? data?.length ?? "null");

      if (!res.ok) {
        console.log(`${label} ERROR BODY:`, data);
        return null;
      }

      return data;
    } catch (err) {
      console.log(`${label} ATTEMPT ${attempt} ERROR:`, err.message);

      if (attempt === retries) return null;

      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }

  return null;
}

function normalizeSportsDataStat(stat = {}, date = new Date()) {
  const player =
    stat.Name ||
    stat.PlayerName ||
    stat.FullName ||
    stat.Player ||
    "";

  const team = normalizeTeam(stat.Team || stat.TeamAbbreviation || "", "NBA");

  const opponent = normalizeTeam(
    stat.Opponent ||
      stat.OpponentTeam ||
      stat.OpponentAbbreviation ||
      "",
    "NBA"
  );

  return {
    source: "SportsData",
    league: "NBA",
    date: formatDate(stat.Day || stat.DateTime || stat.GameDate || date),

    player,
    playerKey: clean(player),

    team,
    rawTeam: stat.Team || stat.TeamAbbreviation || "",

    opponent,
    rawOpponent:
      stat.Opponent ||
      stat.OpponentTeam ||
      stat.OpponentAbbreviation ||
      "",

    points: num(stat.Points),
    minutes: num(stat.Minutes || stat.MinutesPlayed),
    fga: num(stat.FieldGoalsAttempted || stat.FGA),
    fta: num(stat.FreeThrowsAttempted || stat.FTA),
    fg3a: num(stat.ThreePointersAttempted || stat.ThreePointAttempts || stat.FG3A),

    raw: stat,
  };
}

function normalizeBallStat(stat = {}, league = "WNBA") {
  const player = fullBallPlayerName(stat.player);

  return {
    source: "BallDontLie",
    league,
    date: formatDate(stat.game?.date || stat.date),

    player,
    playerKey: clean(player),

    team: normalizeBallTeam(stat.team),
    rawTeam: stat.team?.abbreviation || "",

    opponent: getBallOpponent(stat),
    rawOpponent: "",

    points: num(stat.pts ?? stat.points),
    minutes: parseBallMinutes(stat.min ?? stat.minutes),
    fga: num(stat.fga ?? stat.field_goal_attempts),
    fta: num(stat.fta ?? stat.free_throw_attempts),
    fg3a: num(stat.fg3a ?? stat.three_point_attempts),

    raw: stat,
  };
}

function parseBallMinutes(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;

  const str = String(value);

  if (str.includes(":")) {
    const [m, s] = str.split(":").map(Number);
    return Number((m + s / 60).toFixed(1));
  }

  return num(str);
}

async function fetchSportsDataNBAFinalStats(date = new Date()) {
  if (!SPORTS_KEY) {
    console.log("RESULT SERVICE: SPORTS_KEY missing");
    return [];
  }

  const formattedDate = formatDate(date);

  const url =
    `${SPORTS_BASE}/stats/json/PlayerGameStatsByDate/${formattedDate}` +
    `?key=${SPORTS_KEY}`;

  const data = await fetchJSON(url, `FINAL PLAYER STATS NBA ${formattedDate}`);

  if (!Array.isArray(data)) return [];

  return data.map((stat) => normalizeSportsDataStat(stat, date));
}

async function fetchBallFinalStatsByDate(date = new Date(), league = "WNBA") {
  if (!BALL_KEY) {
    console.log(`RESULT SERVICE: BALLDONTLIE_KEY missing for ${league}`);
    return [];
  }

  const cleanLeague = normalizeLeague(league);
  const base = BALL_BASES[cleanLeague];

  if (!base) return [];

  const formattedDate = formatDate(date);
  const seasonYear = formattedDate ? Number(formattedDate.slice(0, 4)) : new Date().getFullYear();

  const allStats = [];
  let cursor = null;

  for (let page = 1; page <= 5; page++) {
    const cursorParam = cursor ? `&cursor=${cursor}` : "";

    const url =
      `${base}/player_stats?dates[]=${formattedDate}` +
      `&seasons[]=${seasonYear}` +
      `&per_page=100${cursorParam}`;

    const data = await fetchJSON(
      url,
      `FINAL PLAYER STATS ${cleanLeague} ${formattedDate} PAGE ${page}`,
      { Authorization: BALL_KEY }
    );

    if (!data) break;

    const stats = Array.isArray(data?.data) ? data.data : [];

    allStats.push(...stats);

    cursor = data?.meta?.next_cursor;

    if (!cursor || !stats.length) break;
  }

  return allStats.map((stat) => normalizeBallStat(stat, cleanLeague));
}

export async function fetchFinalPlayerStats(date = new Date(), options = {}) {
  const leagueOption = options.league
    ? normalizeLeague(options.league)
    : "ALL";

  const stats = [];

  if (leagueOption === "ALL" || leagueOption === "NBA") {
    const nbaStats = await fetchSportsDataNBAFinalStats(date);
    stats.push(...nbaStats);
  }

  if (leagueOption === "ALL" || leagueOption === "WNBA") {
    const wnbaStats = await fetchBallFinalStatsByDate(date, "WNBA");
    stats.push(...wnbaStats);
  }

  console.log("FINAL PLAYER STATS NORMALIZED:", {
    date: formatDate(date),
    leagueOption,
    count: stats.length,
    nba: stats.filter((s) => s.league === "NBA").length,
    wnba: stats.filter((s) => s.league === "WNBA").length,
  });

  return stats;
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

export function getPickQueryDates(savedPick = {}) {
  const dates = new Set();

  const gameDate = savedPick.gameDate || savedPick.date || "";

  if (gameDate) {
    const normalized = getSlateDateKey(gameDate) || formatDate(gameDate);

    if (normalized) dates.add(normalized);
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

const GAME_LIKELY_FINISHED_MS = 3 * 60 * 60 * 1000;

function getPickStartTime(savedPick = {}) {
  const commenceSource = savedPick.commenceTime || savedPick.time || null;

  if (commenceSource) {
    const parsed = new Date(commenceSource);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const pickDate = getPickDate(savedPick);

  if (pickDate) {
    const parsed = new Date(`${pickDate}T12:00:00Z`);

    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return null;
}

export function isPickGameStarted(savedPick = {}, now = new Date()) {
  const startTime = getPickStartTime(savedPick);

  if (!startTime) return false;

  return now.getTime() >= startTime.getTime();
}

export function isPickLikelyFinished(
  savedPick = {},
  now = new Date(),
  bufferMs = GAME_LIKELY_FINISHED_MS
) {
  const startTime = getPickStartTime(savedPick);

  if (!startTime) return false;

  return now.getTime() >= startTime.getTime() + bufferMs;
}

function getStatDate(stat = {}) {
  return stat.date ? formatDate(stat.date) : "";
}

function getStatPlayerName(stat = {}) {
  return (
    stat.player ||
    stat.Name ||
    stat.PlayerName ||
    stat.FullName ||
    stat.Player ||
    ""
  );
}

function getPickTeams(savedPick = {}, league = "NBA") {
  const cleanLeague = normalizeLeague(league || savedPick.league || "NBA");
  const game = String(savedPick.game || "");
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

function getStatTeam(stat = {}, league = "NBA") {
  const cleanLeague = normalizeLeague(league || stat.league || "NBA");

  if (stat.team) {
    return normalizeTeam(String(stat.team), cleanLeague);
  }

  return normalizeTeam(
    stat.Team || stat.TeamAbbreviation || stat.rawTeam || "",
    cleanLeague
  );
}

function getStatLeague(stat = {}) {
  return normalizeLeague(stat.league || "NBA");
}

function playerMatches(savedPick = {}, stat = {}) {
  const targetPlayer = clean(savedPick.player);
  const statPlayer = clean(getStatPlayerName(stat));

  if (!targetPlayer || !statPlayer) return false;

  if (targetPlayer === statPlayer) return true;

  const targetParts = String(savedPick.player || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const statParts = getStatPlayerName(stat).trim().split(/\s+/).filter(Boolean);

  if (!targetParts.length || !statParts.length) return false;

  const targetLast = clean(targetParts[targetParts.length - 1]);
  const statLast = clean(statParts[statParts.length - 1]);

  if (targetLast !== statLast) return false;

  const targetFirst = clean(targetParts[0]);
  const statFirst = clean(statParts[0]);

  return (
    targetFirst === statFirst ||
    statFirst.startsWith(targetFirst.slice(0, 3)) ||
    targetFirst.startsWith(statFirst.slice(0, 3))
  );
}

function teamMatches(savedPick = {}, stat = {}) {
  const league = normalizeLeague(savedPick.league || stat.league || "NBA");

  const targetTeam = normalizeTeam(savedPick.team || "", league);
  const statTeam = getStatTeam(stat, league);
  const { teamA, teamB } = getPickTeams(savedPick, league);

  if (!targetTeam && !teamA && !teamB) return true;
  if (!statTeam) return true;

  if (targetTeam && statTeam === targetTeam) return true;

  if (teamA && teamB) {
    return statTeam === teamA || statTeam === teamB;
  }

  return false;
}

function dateMatches(savedPick = {}, stat = {}) {
  const queryDates = getPickQueryDates(savedPick);
  const statDate = getStatDate(stat);

  if (!queryDates.length || !statDate) return false;

  return queryDates.includes(statDate);
}

export function findPlayerResult(savedPick, playerStats = []) {
  const league = normalizeLeague(savedPick.league || "NBA");

  const candidates = playerStats
    .filter((stat) => getStatLeague(stat) === league)
    .filter((stat) => playerMatches(savedPick, stat))
    .filter((stat) => teamMatches(savedPick, stat));

  const exactDateMatch = candidates.find((stat) => dateMatches(savedPick, stat));

  if (exactDateMatch) return exactDateMatch;

  if (candidates.length) {
    console.log("RESULT MATCH REJECTED - NO EXACT DATE:", {
      player: savedPick.player,
      league,
      pickDate: getPickDate(savedPick),
      candidateDates: candidates.map((c) => c.date),
    });
  } else {
    console.log("NO PLAYER RESULT FOUND:", {
      player: savedPick.player,
      team: savedPick.team,
      league,
      pickDate: getPickDate(savedPick),
      availableMatches: playerStats
        .filter(
          (stat) => clean(getStatPlayerName(stat)) === clean(savedPick.player)
        )
        .map((stat) => ({
          player: getStatPlayerName(stat),
          league: getStatLeague(stat),
          team: stat.team,
          date: stat.date,
          points: stat.points,
        })),
    });
  }

  return null;
}

function buildPendingReason(savedPick = {}, playerStats = [], statResult = null) {
  if (statResult) return null;

  if (!Array.isArray(playerStats) || playerStats.length === 0) {
    return "Final player stats unavailable from source";
  }

  if (isPickLikelyFinished(savedPick)) {
    return "Game final, but player stat row unavailable from source";
  }

  return "No exact game stat match found for pick date and league";
}

function buildResolveDebug(savedPick = {}, playerStats = [], statResult = null, extras = {}) {
  const queryDates = getPickQueryDates(savedPick);
  const pendingReason = buildPendingReason(savedPick, playerStats, statResult);

  return {
    player: savedPick.player || "",
    gameDate: savedPick.gameDate || savedPick.date || "",
    commenceTime: savedPick.commenceTime || savedPick.time || "",
    resolvedSlateDate: getPickDate(savedPick),
    queryDates,
    batchQueryDates: extras.batchQueryDates || queryDates,
    playerFallbackAttempted: Boolean(extras.playerFallbackAttempted),
    batchRowCount: Array.isArray(playerStats) ? playerStats.length : 0,
    fallbackRowCount: Number(extras.fallbackRowCount || 0),
    matchedPlayerRow: Boolean(statResult),
    pendingReason,
    at: new Date().toISOString(),
  };
}

function ballGameToStatResult(savedPick = {}, game = {}, league = "WNBA") {
  const pickDate = getPickDate(savedPick);

  return {
    source: "BallDontLie",
    league,
    date: getSlateDateKey(game.date) || pickDate,
    player: savedPick.player,
    playerKey: clean(savedPick.player),
    team: normalizeTeam(game.team || savedPick.team || "", league),
    opponent: normalizeTeam(game.opponent || savedPick.opponent || "", league),
    points: num(game.points),
    minutes: num(game.minutes),
    fga: num(game.fga),
    fta: num(game.fta),
    fg3a: num(game.fg3a),
    raw: game.raw || game,
  };
}

async function fetchBallPlayerStatForPick(savedPick = {}) {
  const league = normalizeLeague(savedPick.league || "WNBA");
  const queryDates = getPickQueryDates(savedPick);

  if (!queryDates.length || !savedPick.player) {
    return { statResult: null, fallbackRowCount: 0 };
  }

  const games = await fetchPlayerStats(savedPick.player, league);

  if (!games.length) {
    return { statResult: null, fallbackRowCount: 0 };
  }

  const match = games.find((game) => {
    const gameDate = getSlateDateKey(game.date);

    if (!queryDates.includes(gameDate)) return false;

    const gameTeam = normalizeTeam(game.team || "", league);
    const mockStat = {
      league,
      team: gameTeam,
    };

    return teamMatches(savedPick, mockStat);
  });

  if (!match) {
    return { statResult: null, fallbackRowCount: games.length };
  }

  return {
    statResult: ballGameToStatResult(savedPick, match, league),
    fallbackRowCount: games.length,
  };
}

export async function resolvePlayerStatForPick(savedPick = {}, batchStats = null) {
  const league = normalizeLeague(savedPick.league || "NBA");
  const queryDates = getPickQueryDates(savedPick);

  let stats = batchStats;
  let playerFallbackAttempted = false;
  let fallbackRowCount = 0;

  if (!stats) {
    stats = [];

    for (const queryDate of queryDates) {
      const dateStats = await fetchFinalPlayerStats(
        new Date(`${queryDate}T12:00:00Z`),
        { league }
      );

      stats.push(...dateStats);
    }
  }

  let statResult = findPlayerResult(savedPick, stats);

  if (!statResult && (league === "WNBA" || league === "NBA")) {
    playerFallbackAttempted = true;

    const fallback = await fetchBallPlayerStatForPick(savedPick);

    statResult = fallback.statResult;
    fallbackRowCount = fallback.fallbackRowCount;
  }

  const pendingReason = buildPendingReason(savedPick, stats, statResult);
  const resolveDebug = buildResolveDebug(savedPick, stats, statResult, {
    batchQueryDates: queryDates,
    playerFallbackAttempted,
    fallbackRowCount,
  });

  console.log("RESULT RESOLVE DEBUG:", resolveDebug);

  return {
    statResult,
    pendingReason,
    resolveDebug,
  };
}

function getActualPoints(statResult = {}) {
  return num(
    statResult.points ??
      statResult.Points ??
      statResult.pts ??
      statResult.actualPoints ??
      0
  );
}

function normalizeSide(savedPick = {}) {
  const side = String(savedPick.side || savedPick.pick || "").toLowerCase();

  if (side === "over") return "Over";
  if (side === "under") return "Under";

  return "";
}

export function gradePointsPick(savedPick, statResult, options = {}) {
  if (!statResult) {
    return {
      ...savedPick,
      status: "pending",
      pendingReason:
        options.pendingReason ||
        savedPick.pendingReason ||
        "No exact game stat match found for pick date and league",
      resolveDebug: options.resolveDebug || savedPick.resolveDebug || null,
      actualStat: null,
      actualPoints: null,
      finalPoints: null,
      result: null,
      resultMargin: null,
      margin: null,
    };
  }

  const actualPoints = getActualPoints(statResult);
  const line = num(savedPick.line || savedPick.sportsbookLine);
  const side = normalizeSide(savedPick);

  if (!side || !line) {
    console.log("GRADE PICK FAILED - BAD SIDE OR LINE:", {
      player: savedPick.player,
      side,
      line,
    });

    return {
      ...savedPick,
      status: "pending",
      pendingReason: "Missing side or line for grading",
    };
  }

  const push = actualPoints === line;

  const hit =
    side === "Over"
      ? actualPoints > line
      : actualPoints < line;

  const status = push ? "push" : hit ? "win" : "loss";

  const resultMargin =
    side === "Over"
      ? actualPoints - line
      : line - actualPoints;

  const gradedAt = new Date().toISOString();

  return {
    ...savedPick,

    side,
    pick: side,

    actualStat: actualPoints,
    actualPoints,
    finalPoints: actualPoints,
    result: actualPoints,

    status,
    hit: status === "win",
    push,

    margin: Number(resultMargin.toFixed(1)),
    resultMargin: Number(resultMargin.toFixed(1)),
    resultSource: statResult.source || "unknown",

    gradedAt,
    resolvedAt: gradedAt,
    pendingReason: null,

    resultMeta: {
      source: statResult.source || "unknown",
      league: statResult.league || savedPick.league || "",
      date: statResult.date || "",
      team: statResult.team || "",
      opponent: statResult.opponent || "",
      minutes: statResult.minutes ?? null,
      fga: statResult.fga ?? null,
      fta: statResult.fta ?? null,
      fg3a: statResult.fg3a ?? null,
      points: actualPoints,
    },
  };
}

export { getPickDate, formatDate };

export function getPickStatsCacheKey(league = "NBA", date = "") {
  return `${String(league || "NBA").toUpperCase()}:${date || "unknown"}`;
}

export async function primePickStatsCache(savedPick = {}, statsCache = new Map()) {
  const league = String(savedPick.league || "NBA").toUpperCase();
  const queryDates = getPickQueryDates(savedPick);

  for (const queryDate of queryDates) {
    const cacheKey = getPickStatsCacheKey(league, queryDate);

    if (statsCache.has(cacheKey)) continue;

    const stats = await fetchFinalPlayerStats(
      queryDate ? new Date(`${queryDate}T12:00:00Z`) : new Date(),
      { league }
    );

    statsCache.set(cacheKey, stats);
  }

  return statsCache;
}

export function getCachedStatsForPick(savedPick = {}, statsCache = new Map()) {
  const league = String(savedPick.league || "NBA").toUpperCase();
  const queryDates = getPickQueryDates(savedPick);
  const merged = [];

  for (const queryDate of queryDates) {
    const cacheKey = getPickStatsCacheKey(league, queryDate);
    merged.push(...(statsCache.get(cacheKey) || []));
  }

  return merged;
}

export function buildResultSummary(picks = []) {
  const resolved = picks.filter((pick) =>
    ["win", "loss", "push"].includes(String(pick.status || "").toLowerCase())
  );

  const wins = resolved.filter((p) => p.status === "win").length;
  const losses = resolved.filter((p) => p.status === "loss").length;
  const pushes = resolved.filter((p) => p.status === "push").length;

  const gradedTotal = wins + losses;

  return {
    total: resolved.length,
    wins,
    losses,
    pushes,
    accuracy:
      gradedTotal > 0
        ? Number(((wins / gradedTotal) * 100).toFixed(1))
        : 0,
  };
}