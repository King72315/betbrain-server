import fetch from "node-fetch";
import { CONFIG } from "../config.js";

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

function formatDate(date = new Date()) {
  if (!date) return new Date().toISOString().split("T")[0];

  const parsed = new Date(date);

  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString().split("T")[0];
  }

  return parsed.toISOString().split("T")[0];
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

async function fetchJSON(url, label, headers = {}) {
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
    console.log(`${label} ERROR:`, err.message);
    return null;
  }
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

  const allStats = [];
  let cursor = null;

  for (let page = 1; page <= 5; page++) {
    const cursorParam = cursor ? `&cursor=${cursor}` : "";

    const url =
      `${base}/player_stats?dates[]=${formattedDate}` +
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

function getPickDate(savedPick = {}) {
  const dateSource =
    savedPick.gameDate ||
    savedPick.date ||
    savedPick.commenceTime ||
    savedPick.time ||
    savedPick.createdAt ||
    null;

  return dateSource ? formatDate(dateSource) : "";
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

function getStatTeam(stat = {}, league = "NBA") {
  if (stat.team) return normalizeTeam(stat.team, league);

  return normalizeTeam(
    stat.Team || stat.TeamAbbreviation || stat.rawTeam || "",
    league
  );
}

function getStatLeague(stat = {}) {
  return normalizeLeague(stat.league || "NBA");
}

function playerMatches(savedPick = {}, stat = {}) {
  const targetPlayer = clean(savedPick.player);
  const statPlayer = clean(getStatPlayerName(stat));

  if (!targetPlayer || !statPlayer) return false;

  return targetPlayer === statPlayer;
}

function teamMatches(savedPick = {}, stat = {}) {
  const league = normalizeLeague(savedPick.league || stat.league || "NBA");

  const targetTeam = normalizeTeam(savedPick.team || "", league);
  const statTeam = getStatTeam(stat, league);

  if (!targetTeam || !statTeam) return true;

  return targetTeam === statTeam;
}

function dateMatches(savedPick = {}, stat = {}) {
  const pickDate = getPickDate(savedPick);
  const statDate = getStatDate(stat);

  if (!pickDate || !statDate) return false;

  return pickDate === statDate;
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

export function gradePointsPick(savedPick, statResult) {
  if (!statResult) {
    return {
      ...savedPick,
      status: "pending",
      pendingReason:
        savedPick.pendingReason ||
        "No exact game stat match found for pick date and league",
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