import fetch from "node-fetch";
import { CONFIG } from "../config.js";
import { fetchPlayerStats } from "./ballService.js";
import { fetchWnbaFallbackStatsForPick } from "./wnbaGradingFallbackService.js";
import { verifyPickGameIsFinal } from "./gameFinalVerificationService.js";

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

  const points = num(stat.Points);
  const fga = num(stat.FieldGoalsAttempted || stat.FGA);
  const fta = num(stat.FreeThrowsAttempted || stat.FTA);
  const fgm = num(stat.FieldGoalsMade || stat.FGM);
  const fg3m = num(stat.ThreePointersMade || stat.ThreePointMade || stat.FG3M);
  const fg3a = num(stat.ThreePointersAttempted || stat.ThreePointAttempts || stat.FG3A);
  const ftm = num(stat.FreeThrowsMade || stat.FTM);
  const fgPct =
    fga > 0 && fgm != null ? Number(((fgm / fga) * 100).toFixed(1)) : num(stat.FieldGoalsPercentage);
  const fg3Pct =
    fg3a > 0 && fg3m != null
      ? Number(((fg3m / fg3a) * 100).toFixed(1))
      : num(stat.ThreePointersPercentage);
  const tsDenom = fga != null && fta != null ? 2 * (fga + 0.44 * fta) : null;
  const tsPct =
    tsDenom && tsDenom > 0 && points != null
      ? Number(((points / tsDenom) * 100).toFixed(1))
      : null;

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

    points,
    minutes: num(stat.Minutes || stat.MinutesPlayed),
    fga,
    fta,
    fg3a,
    fgm,
    fg3m,
    ftm,
    fgPct,
    fg3Pct,
    tsPct,
    starter:
      stat.Started === true || String(stat.Started || "").toLowerCase() === "true"
        ? true
        : stat.Started === false
          ? false
          : null,
    teamScore: num(
      stat.TeamScore ??
        (String(stat.HomeOrAway || "").toUpperCase() === "HOME"
          ? stat.HomeTeamScore
          : stat.AwayTeamScore)
    ),
    opponentScore: num(
      stat.OpponentScore ??
        (String(stat.HomeOrAway || "").toUpperCase() === "HOME"
          ? stat.AwayTeamScore
          : stat.HomeTeamScore)
    ),

    raw: stat,
  };
}

function normalizeBallStat(stat = {}, league = "WNBA") {
  const player = fullBallPlayerName(stat.player);
  const game = stat.game || {};
  const points = num(stat.pts ?? stat.points);
  const fga = num(stat.fga ?? stat.field_goal_attempts);
  const fta = num(stat.fta ?? stat.free_throw_attempts);
  const fgm = num(stat.fgm ?? stat.field_goals_made);
  const fg3m = num(stat.fg3m ?? stat.three_pointers_made);
  const fg3a = num(stat.fg3a ?? stat.three_point_attempts);
  const ftm = num(stat.ftm ?? stat.free_throws_made);
  const minutes = parseBallMinutes(stat.min ?? stat.minutes);
  const fgPct =
    fga > 0 && fgm != null
      ? Number(((fgm / fga) * 100).toFixed(1))
      : num(stat.fg_pct ?? stat.field_goal_percentage);
  const fg3Pct =
    fg3a > 0 && fg3m != null
      ? Number(((fg3m / fg3a) * 100).toFixed(1))
      : num(stat.fg3_pct ?? stat.three_point_percentage);
  const tsDenom = fga != null && fta != null ? 2 * (fga + 0.44 * fta) : null;
  const tsPct =
    tsDenom && tsDenom > 0 && points != null
      ? Number(((points / tsDenom) * 100).toFixed(1))
      : null;

  const homeScore = num(game.home_team_score);
  const awayScore = num(game.visitor_team_score);
  const playerTeamId = stat.team?.id;
  const homeTeamId = game.home_team?.id ?? game.home_team_id;
  const isHome =
    playerTeamId != null && homeTeamId != null
      ? Number(playerTeamId) === Number(homeTeamId)
      : null;
  const teamScore =
    isHome === true ? homeScore : isHome === false ? awayScore : null;
  const opponentScore =
    isHome === true ? awayScore : isHome === false ? homeScore : null;
  const startPos = String(stat.start_position || stat.starter || "").trim();

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

    points,
    minutes,
    fga,
    fta,
    fg3a,
    fgm,
    fg3m,
    ftm,
    fgPct,
    fg3Pct,
    tsPct,
    starter: startPos ? startPos !== "" && startPos.toUpperCase() !== "BENCH" : null,
    startPosition: startPos || null,
    teamScore,
    opponentScore,
    gameMargin:
      teamScore != null && opponentScore != null ? teamScore - opponentScore : null,
    dnp: minutes === 0 || minutes == null,
    restrictionNote: null,

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
    savedPick.slateDate ||
    savedPick.resultsSlateDate ||
    savedPick.canonicalSlateDateCT ||
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

  const slateDate =
    savedPick.slateDate ||
    savedPick.resultsSlateDate ||
    savedPick.canonicalSlateDateCT ||
    "";

  if (slateDate) {
    const normalized = getSlateDateKey(slateDate) || formatDate(slateDate);

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

const FINAL_UNGRADED_MIN_ATTEMPTS = 3;

/**
 * Exact rejection dimension for one candidate row vs a pick.
 * Does not loosen matching — diagnostics only.
 */
export function diagnoseStatMatchRejection(savedPick = {}, stat = {}, options = {}) {
  const league = normalizeLeague(savedPick.league || stat.league || "NBA");
  const queryDates = options.queryDates || getPickQueryDates(savedPick);
  const reasons = [];

  const target = {
    player: savedPick.player || savedPick.playerName || "",
    team: normalizeTeam(savedPick.team || "", league),
    opponent: normalizeTeam(savedPick.opponent || "", league),
    eventId: String(savedPick.gameId || savedPick.eventId || ""),
    queryDates,
  };

  const candidate = {
    player: getStatPlayerName(stat),
    team: getStatTeam(stat, league),
    opponent: getStatOpponent(stat, league),
    date: getStatDate(stat) || stat.date || "",
    eventId: String(
      stat.raw?.game?.id ||
        stat.raw?.GameID ||
        stat.raw?.game_id ||
        stat.gameId ||
        ""
    ),
    points: num(stat.points ?? stat.pts),
    source: stat.source || "",
  };

  if (getStatLeague(stat) !== league) {
    reasons.push("LEAGUE_MISMATCH");
  }

  const candidateDateKey = String(candidate.date || "").slice(0, 10);
  if (!candidateDateKey || !queryDates.includes(candidateDateKey)) {
    reasons.push("DATE_MISMATCH");
  }

  const pickForPlayer = {
    ...savedPick,
    player: target.player || savedPick.player,
  };
  if (!playerMatches(pickForPlayer, { ...stat, player: candidate.player })) {
    reasons.push("PLAYER_NAME_MISMATCH");
  }

  if (!candidate.team) {
    reasons.push("TEAM_MISSING");
  } else if (target.team && candidate.team !== target.team) {
    reasons.push("TEAM_MISMATCH");
  }

  if (
    target.opponent &&
    candidate.opponent &&
    candidate.opponent !== target.opponent
  ) {
    reasons.push("OPPONENT_MISMATCH");
  }

  if (target.eventId && candidate.eventId && target.eventId !== candidate.eventId) {
    // Odds hash vs BDL/ESPN numeric IDs are different namespaces — annotate only.
    // Do not hard-reject; date+team identity is the production matcher.
    reasons.push("EVENT_ID_NAMESPACE_DIFF");
  }

  // Hard rejects only — namespace diffs are informational and do not block PASS.
  const hard = reasons.filter((r) => r !== "EVENT_ID_NAMESPACE_DIFF");
  const passed = hard.length === 0;

  return {
    target,
    candidate,
    rejectedBecause: hard,
    notes: reasons.includes("EVENT_ID_NAMESPACE_DIFF")
      ? ["event_id_cross_provider_namespace"]
      : [],
    passed,
  };
}

export function buildMatchRejectionDiagnostics(
  savedPick = {},
  playerStats = [],
  options = {}
) {
  const queryDates = options.queryDates || getPickQueryDates(savedPick);
  const limit = Math.max(0, Number(options.limit ?? 40));
  const rows = Array.isArray(playerStats) ? playerStats : [];
  const diagnostics = [];
  const histogram = {};

  for (const stat of rows) {
    const entry = diagnoseStatMatchRejection(savedPick, stat, { queryDates });
    const key = entry.passed
      ? "PASS"
      : entry.rejectedBecause.join("+") || "UNKNOWN";
    histogram[key] = (histogram[key] || 0) + 1;

    if (diagnostics.length < limit) {
      diagnostics.push(entry);
      if (!entry.passed) {
        console.log("RESULT MATCH REJECTED CANDIDATE:", {
          target: entry.target,
          candidate: entry.candidate,
          rejectedBecause: entry.rejectedBecause,
        });
      }
    }
  }

  return {
    targetPlayer: savedPick.player || savedPick.playerName || "",
    targetTeam: savedPick.team || "",
    targetEventId: savedPick.gameId || savedPick.eventId || "",
    queryDates,
    candidateCount: rows.length,
    histogram,
    samples: diagnostics,
  };
}

const GAME_LIKELY_FINISHED_MS = 3 * 60 * 60 * 1000;

export function getPickStartTime(savedPick = {}) {
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

export function getTodayLocalDate(now = new Date()) {
  return now.toLocaleDateString("en-CA", {
    timeZone: CONFIG.TIMEZONE || "America/Chicago",
  });
}

export function getPickSlateDate(savedPick = {}) {
  if (savedPick.slateDate) {
    return getSlateDateKey(savedPick.slateDate);
  }

  return getPickDate(savedPick) || getSlateDateCT(savedPick.commenceTime || savedPick.time);
}

export function isFutureSlateDate(slateDate, today = getTodayLocalDate()) {
  const value = String(slateDate || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return value > today;
}

export function isCommenceTimeInFuture(savedPick = {}, now = new Date()) {
  const commenceSource = savedPick.commenceTime || savedPick.time || null;
  if (!commenceSource) return false;

  const parsed = new Date(commenceSource);
  if (Number.isNaN(parsed.getTime())) return false;

  return parsed.getTime() > now.getTime();
}

/** Hard guard — block grading for future slates/games or before game start. */
export function evaluateGradingBlock(savedPick = {}, now = new Date()) {
  const today = getTodayLocalDate(now);
  const slateDate = getPickSlateDate(savedPick);
  const gameStarted = isPickGameStarted(savedPick, now);
  const gameLikelyFinished = isPickLikelyFinished(savedPick, now);
  const blockedByFutureGame = isFutureSlateDate(slateDate, today);
  const blockedByCommenceTime = isCommenceTimeInFuture(savedPick, now);
  const blockedByGameNotStarted = !gameStarted;

  const blocked =
    blockedByFutureGame ||
    blockedByCommenceTime ||
    blockedByGameNotStarted;

  return {
    blocked,
    reason: blockedByFutureGame
      ? "future_slate"
      : blockedByCommenceTime
        ? "commence_in_future"
        : blockedByGameNotStarted
          ? "game_not_started"
          : null,
    slateDate,
    today,
    gameStarted,
    gameLikelyFinished,
    blockedByFutureGame,
    blockedByCommenceTime,
    blockedByGameNotStarted,
  };
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

function getPickOpponent(savedPick = {}, league = "NBA") {
  const cleanLeague = normalizeLeague(league || savedPick.league || "NBA");
  return normalizeTeam(savedPick.opponent || "", cleanLeague);
}

function getStatOpponent(stat = {}, league = "NBA") {
  const cleanLeague = normalizeLeague(league || stat.league || "NBA");

  if (stat.opponent) {
    return normalizeTeam(String(stat.opponent), cleanLeague);
  }

  return normalizeTeam(
    stat.Opponent ||
      stat.OpponentTeam ||
      stat.OpponentAbbreviation ||
      stat.rawOpponent ||
      "",
    cleanLeague
  );
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
  const targetOpponent = getPickOpponent(savedPick, league);
  const statTeam = getStatTeam(stat, league);
  const statOpponent = getStatOpponent(stat, league);
  const { teamA, teamB } = getPickTeams(savedPick, league);

  if (!statTeam) return false;

  if (targetTeam) {
    if (statTeam !== targetTeam) return false;

    if (targetOpponent && statOpponent && statOpponent !== targetOpponent) {
      return false;
    }

    return true;
  }

  if (teamA && teamB) {
    const inGame = statTeam === teamA || statTeam === teamB;

    if (!inGame) return false;

    if (targetOpponent && statOpponent && statOpponent !== targetOpponent) {
      return false;
    }

    return true;
  }

  return false;
}

function buildMatchConfidence(savedPick = {}, stat = {}, matchContext = {}) {
  const league = normalizeLeague(savedPick.league || stat.league || "NBA");
  const targetTeam = normalizeTeam(savedPick.team || "", league);
  const targetOpponent = getPickOpponent(savedPick, league);
  const statTeam = getStatTeam(stat, league);
  const statOpponent = getStatOpponent(stat, league);
  const pickGameId = savedPick.gameId || savedPick.eventId || "";
  const statGameId =
    stat.raw?.game?.id ||
    stat.raw?.GameID ||
    stat.raw?.game_id ||
    stat.gameId ||
    "";

  let confidence = "low";
  const reasons = [];

  if (!dateMatches(savedPick, stat)) {
    return { confidence: "rejected", reasons: ["date_mismatch"] };
  }

  if (!playerMatches(savedPick, stat)) {
    return { confidence: "rejected", reasons: ["player_mismatch"] };
  }

  if (!teamMatches(savedPick, stat)) {
    return { confidence: "rejected", reasons: ["team_mismatch"] };
  }

  if (pickGameId && statGameId && String(pickGameId) === String(statGameId)) {
    confidence = "high";
    reasons.push("game_id_match");
  } else if (targetTeam && statTeam === targetTeam) {
    confidence = targetOpponent && statOpponent === targetOpponent ? "high" : "medium";
    reasons.push(
      targetOpponent && statOpponent === targetOpponent
        ? "team_opponent_match"
        : "team_match_only"
    );
  } else {
    confidence = "medium";
    reasons.push("game_label_team_match");
  }

  if (matchContext.playerFallbackAttempted && !matchContext.wnbaOfficialFallback && !matchContext.espnFallback) {
    // Date+team verified matches stay medium. Only demote unverified high→medium.
    // Never demote medium→low here — that falsely withheld Aug 8 Young/Boston
    // when BDL opponent was blank (team_match_only) despite correct points rows.
    if (confidence === "high") {
      confidence = "medium";
    }
    reasons.push("player_stats_fallback");
  }

  if (matchContext.wnbaOfficialFallback) {
    reasons.push("wnba_official_fallback");
  }

  if (matchContext.espnFallback) {
    reasons.push("espn_boxscore_fallback");
  }

  return { confidence, reasons };
}

function attachMatchMeta(savedPick = {}, stat = {}, matchContext = {}) {
  if (!stat) return null;

  const { confidence, reasons } = buildMatchConfidence(savedPick, stat, matchContext);
  const statGameId =
    stat.raw?.game?.id ||
    stat.raw?.GameID ||
    stat.raw?.game_id ||
    stat.gameId ||
    "";

  return {
    matchedSource: stat.source || "unknown",
    matchedDate: getStatDate(stat) || stat.date || "",
    matchedGameId: statGameId ? String(statGameId) : "",
    matchedConfidence: confidence,
    matchedReasons: reasons,
  };
}

function dateMatches(savedPick = {}, stat = {}) {
  const queryDates = getPickQueryDates(savedPick);
  const statDate = getStatDate(stat);

  if (!queryDates.length || !statDate) return false;

  return queryDates.includes(statDate);
}

export function findPlayerResult(savedPick, playerStats = [], matchContext = {}) {
  const league = normalizeLeague(savedPick.league || "NBA");

  const candidates = playerStats
    .filter((stat) => getStatLeague(stat) === league)
    .filter((stat) => playerMatches(savedPick, stat))
    .filter((stat) => teamMatches(savedPick, stat));

  const exactDateMatch = candidates.find((stat) => dateMatches(savedPick, stat));

  if (exactDateMatch) {
    const matchMeta = attachMatchMeta(savedPick, exactDateMatch, matchContext);

    if (matchMeta?.matchedConfidence === "low") {
      console.log("RESULT MATCH LOW CONFIDENCE:", {
        player: savedPick.player,
        league,
        pickDate: getPickDate(savedPick),
        ...matchMeta,
      });
    }

    return { ...exactDateMatch, matchMeta };
  }

  if (candidates.length) {
    console.log("RESULT MATCH REJECTED - NO EXACT DATE:", {
      player: savedPick.player,
      league,
      pickDate: getPickDate(savedPick),
      queryDates: getPickQueryDates(savedPick),
      candidateDates: candidates.map((c) => c.date),
    });
  } else {
    console.log("NO PLAYER RESULT FOUND:", {
      player: savedPick.player,
      team: savedPick.team,
      opponent: savedPick.opponent,
      league,
      pickDate: getPickDate(savedPick),
      queryDates: getPickQueryDates(savedPick),
      availableMatches: playerStats
        .filter(
          (stat) => clean(getStatPlayerName(stat)) === clean(savedPick.player)
        )
        .map((stat) => ({
          player: getStatPlayerName(stat),
          league: getStatLeague(stat),
          team: stat.team,
          opponent: getStatOpponent(stat, league),
          date: stat.date,
          points: stat.points,
        })),
    });
  }

  return null;
}

function hasWnbaPlayerStatHistory(extras = {}) {
  return (
    Number(extras.fallbackRowCount || 0) > 0 ||
    Number(extras.officialRowCount || 0) > 0 ||
    Number(extras.espnRowCount || 0) > 0
  );
}

function buildPendingReason(savedPick = {}, playerStats = [], statResult = null, extras = {}) {
  if (statResult) return null;

  const hasPlayerHistory = hasWnbaPlayerStatHistory(extras);
  const gameFinal = Boolean(extras.gameFinalCheck?.gameFinal);
  const attempts = Number(extras.resolveAttemptCount || savedPick.resolveAttemptCount || 0);

  if (
    gameFinal &&
    attempts >= FINAL_UNGRADED_MIN_ATTEMPTS &&
    !statResult
  ) {
    return [
      "FINAL_UNGRADED",
      "Game final verified.",
      "Player stat lookup failed.",
      `BDL rows: ${Number(extras.fallbackRowCount || 0)}`,
      `ESPN rows: ${Number(extras.espnRowCount || 0)}`,
      `Official rows: ${Number(extras.officialRowCount || 0)}`,
      `Resolve attempts: ${attempts}`,
    ].join(" ");
  }

  if (!Array.isArray(playerStats) || playerStats.length === 0) {
    if ((isPickLikelyFinished(savedPick) || gameFinal) && hasPlayerHistory) {
      return "Game final, awaiting official player stat row from source.";
    }

    return "Final player stats unavailable from source";
  }

  if (isPickLikelyFinished(savedPick) || gameFinal) {
    if (hasPlayerHistory) {
      return "Game final, awaiting official player stat row from source.";
    }

    return "Game final, but player stat row unavailable from source";
  }

  return "No exact game stat match found for pick date and league";
}

function buildResolveDebug(savedPick = {}, playerStats = [], statResult = null, extras = {}) {
  const queryDates = getPickQueryDates(savedPick);
  const pendingReason = buildPendingReason(savedPick, playerStats, statResult, extras);
  const now = extras.now ? new Date(extras.now) : new Date();
  const gradingBlock = evaluateGradingBlock(savedPick, now);
  const gameFinalCheck = extras.gameFinalCheck || {};
  const finalUngraded =
    Boolean(gameFinalCheck.gameFinal) &&
    !statResult &&
    Number(extras.resolveAttemptCount || savedPick.resolveAttemptCount || 0) >=
      FINAL_UNGRADED_MIN_ATTEMPTS;

  return {
    player: savedPick.player || "",
    gameDate: savedPick.gameDate || savedPick.date || "",
    commenceTime: savedPick.commenceTime || savedPick.time || "",
    resolvedSlateDate: getPickDate(savedPick),
    slateDate: savedPick.slateDate || getPickDate(savedPick),
    queryDates,
    batchQueryDates: extras.batchQueryDates || queryDates,
    playerFallbackAttempted: Boolean(extras.playerFallbackAttempted),
    wnbaOfficialFallbackAttempted: Boolean(extras.wnbaOfficialFallbackAttempted),
    espnFallbackAttempted: Boolean(extras.espnFallbackAttempted),
    batchRowCount: Array.isArray(playerStats) ? playerStats.length : 0,
    fallbackRowCount: Number(extras.fallbackRowCount || 0),
    officialRowCount: Number(extras.officialRowCount || 0),
    espnRowCount: Number(extras.espnRowCount || 0),
    matchedPlayerRow: Boolean(statResult),
    matchedSource: statResult?.matchMeta?.matchedSource || statResult?.source || "",
    matchedDate: statResult?.matchMeta?.matchedDate || statResult?.date || "",
    matchVerified:
      Boolean(statResult) &&
      (statResult?.matchMeta?.matchedConfidence === "high" ||
        statResult?.matchMeta?.matchedConfidence === "medium"),
    matchRejectionDiagnostics: extras.matchRejectionDiagnostics || null,
    gameStarted: gradingBlock.gameStarted,
    gameLikelyFinished: gradingBlock.gameLikelyFinished,
    blockedByFutureGame: gradingBlock.blockedByFutureGame,
    blockedByCommenceTime: gradingBlock.blockedByCommenceTime,
    blockedByGameNotStarted: gradingBlock.blockedByGameNotStarted,
    gameStatus: gameFinalCheck.gameStatus || extras.gameStatus || "",
    gameFinal: Boolean(gameFinalCheck.gameFinal),
    blockedByGameNotFinal: Boolean(gameFinalCheck.blockedByGameNotFinal),
    blockedByLiveGame: Boolean(gameFinalCheck.blockedByLiveGame),
    gameFinalVerifiedSource: gameFinalCheck.verifiedSource || extras.gameFinalVerifiedSource || "",
    blocked: gradingBlock.blocked || Boolean(gameFinalCheck.blockedByGameNotFinal),
    finalUngraded,
    pendingReason,
    at: now.toISOString(),
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
    return {
      statResult: null,
      fallbackRowCount: 0,
      matchRejectionDiagnostics: null,
    };
  }

  const games = await fetchPlayerStats(savedPick.player, league);

  if (!games.length) {
    return {
      statResult: null,
      fallbackRowCount: 0,
      matchRejectionDiagnostics: null,
    };
  }

  // Convert BDL season games into stat-shaped rows for shared diagnostics.
  const asStats = games.map((game) => ({
    source: "BallDontLie",
    league,
    date: getSlateDateKey(game.date),
    player: savedPick.player,
    team: game.team || "",
    opponent: game.opponent || "",
    points: num(game.points),
    minutes: num(game.minutes),
    fga: num(game.fga),
    fta: num(game.fta),
    fg3a: num(game.fg3a),
    gameId: game.raw?.game?.id || "",
    raw: game.raw || game,
  }));

  const match = games.find((game) => {
    const gameDate = getSlateDateKey(game.date);

    if (!queryDates.includes(gameDate)) return false;

    const gameTeam = normalizeTeam(game.team || "", league);
    const gameOpponent = normalizeTeam(game.opponent || "", league);
    const mockStat = {
      league,
      team: gameTeam,
      opponent: gameOpponent,
    };

    return teamMatches(savedPick, mockStat);
  });

  if (!match) {
    const matchRejectionDiagnostics = buildMatchRejectionDiagnostics(
      savedPick,
      asStats,
      { queryDates, limit: 40 }
    );
    console.log("BDL FALLBACK MATCH FAILED:", {
      player: savedPick.player,
      team: savedPick.team,
      eventId: savedPick.gameId || savedPick.eventId,
      queryDates,
      fallbackRowCount: games.length,
      histogram: matchRejectionDiagnostics.histogram,
    });
    return {
      statResult: null,
      fallbackRowCount: games.length,
      matchRejectionDiagnostics,
    };
  }

  return {
    statResult: ballGameToStatResult(savedPick, match, league),
    fallbackRowCount: games.length,
    matchRejectionDiagnostics: null,
  };
}

export async function resolvePlayerStatForPick(savedPick = {}, batchStats = null, options = {}) {
  const now = new Date();
  const gradingBlock = evaluateGradingBlock(savedPick, now);

  if (gradingBlock.blocked) {
    const pendingReason = gradingBlock.blockedByFutureGame
      ? "Future slate/game — grading blocked until slate date"
      : "Game not started yet.";

    const resolveDebug = buildResolveDebug(savedPick, batchStats || [], null, {
      now,
      gradingBlocked: true,
    });

    return {
      statResult: null,
      pendingReason,
      resolveDebug,
      gradingNotes: pendingReason,
      matchVerified: false,
      resultConfidence: null,
      matchedDate: "",
      matchedGameId: "",
      matchedSource: "",
      gradingBlocked: true,
    };
  }

  const gameFinalCheck =
    options.gameFinalOverride ||
    (await verifyPickGameIsFinal(savedPick));

  if (!gameFinalCheck.gameFinal) {
    const pendingReason = "Game not final yet.";

    return {
      statResult: null,
      pendingReason,
      resolveDebug: buildResolveDebug(savedPick, batchStats || [], null, {
        now,
        gameFinalCheck,
        gradingBlocked: true,
      }),
      gradingNotes: pendingReason,
      matchVerified: false,
      resultConfidence: null,
      matchedDate: "",
      matchedGameId: "",
      matchedSource: "",
      gradingBlocked: true,
    };
  }

  const league = normalizeLeague(savedPick.league || "NBA");
  const queryDates = getPickQueryDates(savedPick);

  let stats = batchStats;
  let playerFallbackAttempted = false;
  let fallbackRowCount = 0;
  let wnbaOfficialFallbackAttempted = false;
  let espnFallbackAttempted = false;
  let officialRowCount = 0;
  let espnRowCount = 0;
  let matchRejectionDiagnostics = null;

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

  let statResult = findPlayerResult(savedPick, stats, {
    playerFallbackAttempted: false,
  });

  if (statResult?.matchMeta?.matchedConfidence === "low") {
    const gradingNotes =
      "Weak stat match (low confidence) — grading withheld until verified";
    console.log("RESULT WEAK MATCH WITHHELD:", {
      player: savedPick.player,
      league,
      ...statResult.matchMeta,
    });

    return {
      statResult: null,
      pendingReason: gradingNotes,
      resolveDebug: buildResolveDebug(savedPick, stats, null, {
        batchQueryDates: queryDates,
        playerFallbackAttempted: false,
        fallbackRowCount: 0,
        weakMatchWithheld: true,
        matchMeta: statResult.matchMeta,
      }),
      gradingNotes,
      matchVerified: false,
      resultConfidence: "low",
    };
  }

  if (!statResult && (league === "WNBA" || league === "NBA")) {
    playerFallbackAttempted = true;

    const fallback = await fetchBallPlayerStatForPick(savedPick);

    statResult = fallback.statResult;
    fallbackRowCount = fallback.fallbackRowCount;
    matchRejectionDiagnostics = fallback.matchRejectionDiagnostics || null;

    if (statResult) {
      statResult.matchMeta = attachMatchMeta(savedPick, statResult, {
        playerFallbackAttempted: true,
      });

      if (statResult.matchMeta?.matchedConfidence === "low") {
        console.log("RESULT FALLBACK MATCH LOW CONFIDENCE:", {
          player: savedPick.player,
          league,
          ...statResult.matchMeta,
        });

        return {
          statResult: null,
          pendingReason:
            "Weak fallback stat match (low confidence) — grading withheld",
          resolveDebug: buildResolveDebug(savedPick, stats, null, {
            batchQueryDates: queryDates,
            playerFallbackAttempted: true,
            fallbackRowCount,
            wnbaOfficialFallbackAttempted,
            espnFallbackAttempted,
            officialRowCount,
            espnRowCount,
            weakMatchWithheld: true,
            matchMeta: statResult.matchMeta,
            matchRejectionDiagnostics,
            gameFinalCheck,
            resolveAttemptCount: options.resolveAttemptCount,
          }),
          gradingNotes:
            "Weak fallback stat match (low confidence) — grading withheld",
          matchVerified: false,
          resultConfidence: "low",
        };
      }
    }
  }

  if (!statResult && league === "WNBA") {
    const wnbaFallback = await fetchWnbaFallbackStatsForPick(savedPick, {
      getPickQueryDates,
      getPickTeams,
      findPlayerResult,
    });

    wnbaOfficialFallbackAttempted = wnbaFallback.officialAttempted;
    espnFallbackAttempted = wnbaFallback.espnAttempted;
    officialRowCount = wnbaFallback.officialRowCount;
    espnRowCount = wnbaFallback.espnRowCount;

    if (wnbaFallback.statResult) {
      statResult = wnbaFallback.statResult;

      if (statResult.matchMeta?.matchedConfidence === "low") {
        console.log("RESULT WNBA FALLBACK MATCH LOW CONFIDENCE:", {
          player: savedPick.player,
          league,
          ...statResult.matchMeta,
        });

        return {
          statResult: null,
          pendingReason:
            "Weak fallback stat match (low confidence) — grading withheld",
          resolveDebug: buildResolveDebug(savedPick, stats, null, {
            batchQueryDates: queryDates,
            playerFallbackAttempted,
            fallbackRowCount,
            wnbaOfficialFallbackAttempted,
            espnFallbackAttempted,
            officialRowCount,
            espnRowCount,
            weakMatchWithheld: true,
            matchMeta: statResult.matchMeta,
            matchRejectionDiagnostics,
            gameFinalCheck,
            resolveAttemptCount: options.resolveAttemptCount,
          }),
          gradingNotes:
            "Weak fallback stat match (low confidence) — grading withheld",
          matchVerified: false,
          resultConfidence: "low",
        };
      }
    }
  } else if (statResult?.matchMeta?.matchedConfidence === "low") {
    console.log("RESULT BATCH MATCH LOW CONFIDENCE:", {
      player: savedPick.player,
      league,
      ...statResult.matchMeta,
    });
  }

  if (!statResult && !matchRejectionDiagnostics && Array.isArray(stats) && stats.length) {
    matchRejectionDiagnostics = buildMatchRejectionDiagnostics(savedPick, stats, {
      queryDates,
      limit: 40,
    });
  }

  const pendingReason = buildPendingReason(savedPick, stats, statResult, {
    fallbackRowCount,
    officialRowCount,
    espnRowCount,
    gameFinalCheck,
    resolveAttemptCount: options.resolveAttemptCount,
  });
  const resolveDebug = buildResolveDebug(savedPick, stats, statResult, {
    batchQueryDates: queryDates,
    playerFallbackAttempted,
    fallbackRowCount,
    wnbaOfficialFallbackAttempted,
    espnFallbackAttempted,
    officialRowCount,
    espnRowCount,
    gameFinalCheck,
    matchRejectionDiagnostics,
    resolveAttemptCount: options.resolveAttemptCount,
  });

  const matchMeta = statResult?.matchMeta || {};
  const resultConfidence = matchMeta.matchedConfidence || (statResult ? "medium" : null);
  const matchVerified =
    Boolean(statResult) &&
    (matchMeta.matchedConfidence === "high" ||
      matchMeta.matchedConfidence === "medium");

  console.log("RESULT RESOLVE DEBUG:", resolveDebug);

  return {
    statResult,
    pendingReason,
    resolveDebug,
    gradingNotes: null,
    matchVerified,
    resultConfidence,
    matchedDate: matchMeta.matchedDate || statResult?.date || "",
    matchedGameId: matchMeta.matchedGameId || "",
    matchedSource: matchMeta.matchedSource || statResult?.source || "",
    finalUngraded: Boolean(resolveDebug.finalUngraded),
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
  const side = String(
    savedPick.side ||
      savedPick.pick ||
      savedPick.lockedSide ||
      savedPick.currentEngineSide ||
      ""
  ).toLowerCase();

  if (side === "over" || side.startsWith("over")) return "Over";
  if (side === "under" || side.startsWith("under")) return "Under";

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
      gradingNotes: options.gradingNotes || savedPick.gradingNotes || null,
      resolveDebug: options.resolveDebug || savedPick.resolveDebug || null,
      matchVerified: options.matchVerified ?? savedPick.matchVerified ?? false,
      resultConfidence:
        options.resultConfidence ?? savedPick.resultConfidence ?? null,
      actualStat: null,
      actualPoints: null,
      finalPoints: null,
      result: null,
      resultMargin: null,
      margin: null,
    };
  }

  const actualPoints = getActualPoints(statResult);
  const line = num(
    savedPick.officialLine ?? savedPick.pickLine ?? savedPick.line ?? savedPick.sportsbookLine
  );
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

  const minutes = statResult.minutes ?? null;
  const fga = num(statResult.fga);
  const fta = num(statResult.fta);
  const fgm = num(statResult.fgm);
  const fg3a = num(statResult.fg3a);
  const fg3m = num(statResult.fg3m);
  const ftm = num(statResult.ftm);
  const fgPct =
    statResult.fgPct ??
    (fga > 0 && fgm != null ? Number(((fgm / fga) * 100).toFixed(1)) : null);
  const fg3Pct =
    statResult.fg3Pct ??
    (fg3a > 0 && fg3m != null ? Number(((fg3m / fg3a) * 100).toFixed(1)) : null);
  const tsDenom = fga != null && fta != null ? 2 * (fga + 0.44 * fta) : null;
  const tsPct =
    statResult.tsPct ??
    (tsDenom && tsDenom > 0
      ? Number(((actualPoints / tsDenom) * 100).toFixed(1))
      : null);
  const teamScore = num(statResult.teamScore);
  const opponentScore = num(statResult.opponentScore);

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
    gradingNotes: options.gradingNotes || null,
    matchVerified:
      options.matchVerified ??
      (statResult.matchMeta?.matchedConfidence === "high" ||
        statResult.matchMeta?.matchedConfidence === "medium"),
    resultConfidence:
      options.resultConfidence || statResult.matchMeta?.matchedConfidence || "medium",
    matchedDate: statResult.matchMeta?.matchedDate || statResult.date || "",
    matchedGameId: statResult.matchMeta?.matchedGameId || "",
    matchedSource: statResult.matchMeta?.matchedSource || statResult.source || "unknown",

    resultMeta: {
      source: statResult.source || "unknown",
      league: statResult.league || savedPick.league || "",
      date: statResult.date || "",
      team: statResult.team || "",
      opponent: statResult.opponent || "",
      minutes,
      fga,
      fta,
      fg3a,
      fgm,
      fg3m,
      ftm,
      fgPct,
      fg3Pct,
      tsPct,
      starter: statResult.starter ?? null,
      startPosition: statResult.startPosition ?? null,
      teamScore,
      opponentScore,
      gameMargin:
        statResult.gameMargin ??
        (teamScore != null && opponentScore != null ? teamScore - opponentScore : null),
      dnp: Boolean(statResult.dnp) || minutes === 0,
      points: actualPoints,
      matchedSource: statResult.matchMeta?.matchedSource || statResult.source || "unknown",
      matchedDate: statResult.matchMeta?.matchedDate || statResult.date || "",
      matchedGameId: statResult.matchMeta?.matchedGameId || "",
      matchedConfidence: statResult.matchMeta?.matchedConfidence || "medium",
      matchedReasons: statResult.matchMeta?.matchedReasons || [],
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