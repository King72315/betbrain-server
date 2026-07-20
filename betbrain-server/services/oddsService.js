import axios from "axios";
import { CONFIG } from "../config.js";
import { recordPaidApiCall } from "./courtEdgeStateIntegrityV1.js";

const ODDS_SPORT_KEYS = {
  NBA: "basketball_nba",
  WNBA: "basketball_wnba",
};

const API_KEY = CONFIG.ODDS_KEY;

const EVENT_CACHE = new Map();
const EVENT_CACHE_MS = 2 * 60 * 1000;

function getOddsBase(league = "NBA") {
  const sportKey = ODDS_SPORT_KEYS[league] || ODDS_SPORT_KEYS.NBA;

  return `https://api.the-odds-api.com/v4/sports/${sportKey}`;
}

function clean(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
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

function getCentralDateKey(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);

  if (Number.isNaN(date.getTime())) return "";

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value;
  const month = parts.find((p) => p.type === "month")?.value;
  const day = parts.find((p) => p.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

function getTargetCentralDateKey(daysAhead = 0) {
  // Add days in America/Chicago calendar space (not server-local setDate),
  // using a CT noon anchor to avoid DST midnight skew.
  const todayCt = getCentralDateKey(new Date());
  if (!todayCt) return "";
  const [y, m, d] = todayCt.split("-").map(Number);
  const noonUtcGuess = new Date(Date.UTC(y, m - 1, d, 17, 0, 0));
  // Re-sync so the CT calendar day of the anchor matches todayCt, then add days.
  let anchor = noonUtcGuess;
  for (let i = 0; i < 3; i += 1) {
    const got = getCentralDateKey(anchor);
    if (got === todayCt) break;
    const deltaDays =
      got > todayCt ? -1 : got < todayCt ? 1 : 0;
    anchor = new Date(anchor.getTime() + deltaDays * 24 * 60 * 60 * 1000);
  }
  const target = new Date(
    anchor.getTime() + Number(daysAhead || 0) * 24 * 60 * 60 * 1000
  );
  return getCentralDateKey(target);
}

function getMinutesUntilStart(commenceTime) {
  const start = new Date(commenceTime).getTime();

  if (!Number.isFinite(start)) return null;

  return Math.round((start - Date.now()) / 1000 / 60);
}

async function oddsGet(url, params = {}, label = "ODDS REQUEST") {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const { data } = await axios.get(url, {
        params,
        timeout: 20000,
        headers: {
          "User-Agent": "BetBrain-V2",
          Accept: "application/json",
        },
      });
      try {
        recordPaidApiCall({
          provider: "the-odds-api",
          label,
          attempt,
          // Never log apiKey — params may contain it.
          hasApiKeyParam: Boolean(params?.apiKey),
        });
      } catch {
        // Accounting must never break odds fetches.
      }

      return data;
    } catch (err) {
      console.log(`${label} ATTEMPT ${attempt} FAILED:`, err.message);

      if (attempt === 3) return null;

      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  return null;
}

function uniqueEvents(events = []) {
  const seen = new Set();

  return events.filter((event) => {
    if (!event?.id || seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

export async function fetchOddsEvents(league = "NBA", options = {}) {
  if (!API_KEY) {
    console.log("ODDS_KEY missing");
    return [];
  }

  const cacheKey = `${league}-events`;
  const cached = EVENT_CACHE.get(cacheKey);

  if (!options.force && cached && Date.now() - cached.time < EVENT_CACHE_MS) {
    return cached.data;
  }

  const data = await oddsGet(
    `${getOddsBase(league)}/events`,
    { apiKey: API_KEY },
    `FETCH ODDS EVENTS (${league})`
  );

  const events = uniqueEvents(Array.isArray(data) ? data : []);

  console.log(`ODDS EVENTS FOUND (${league}):`, events.length);

  EVENT_CACHE.set(cacheKey, {
    time: Date.now(),
    data: events,
  });

  return events;
}

export async function findOddsEventForGame(
  game,
  league = "NBA",
  providedEvents = null
) {
  const events = providedEvents || (await fetchOddsEvents(league));

  const gameHome = normalizeTeam(game.homeTeam || game.home, league);
  const gameAway = normalizeTeam(game.awayTeam || game.away, league);

  const match =
    events.find((event) => {
      const eventHome = normalizeTeam(event.home_team, league);
      const eventAway = normalizeTeam(event.away_team, league);

      return (
        (gameHome === eventHome && gameAway === eventAway) ||
        (gameHome === eventAway && gameAway === eventHome)
      );
    }) || null;

  if (!match) {
    console.log("NO ODDS EVENT MATCH:", {
      league,
      game: game.game,
      gameHome,
      gameAway,
      availableEvents: events.slice(0, 8).map((event) => ({
        id: event.id,
        home: normalizeTeam(event.home_team, league),
        away: normalizeTeam(event.away_team, league),
        rawHome: event.home_team,
        rawAway: event.away_team,
      })),
    });
  }

  return match;
}

export function computeBlowoutRiskFromSpread(spreadAbs) {
  if (spreadAbs === null || spreadAbs === undefined) return 50;

  const abs = Math.abs(Number(spreadAbs));

  if (!Number.isFinite(abs)) return 50;

  // Higher score = more blowout risk (compareOverUnderRisk triggers at >= 70).
  // Pick'em (~0) → ~25; tight (~3) → ~37; moderate (~7) → ~53; wide (~12+) → ~73+.
  return Math.max(20, Math.min(90, Math.round(25 + abs * 4)));
}

function medianNumeric(values = []) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function fetchConsensusMarketPoints(eventId, league = "NBA", marketKey = "spreads") {
  if (!API_KEY || !eventId) {
    return null;
  }

  const data = await oddsGet(
    `${getOddsBase(league)}/events/${eventId}/odds`,
    {
      apiKey: API_KEY,
      regions: "us",
      markets: marketKey,
      oddsFormat: "american",
    },
    `FETCH GAME ${marketKey.toUpperCase()} (${league})`
  );

  if (!data) return null;

  const points = [];

  for (const book of data?.bookmakers || []) {
    for (const market of book.markets || []) {
      if (market.key !== marketKey) continue;

      for (const outcome of market.outcomes || []) {
        const point = Number(outcome.point);
        if (Number.isFinite(point)) {
          points.push(marketKey === "spreads" ? Math.abs(point) : point);
        }
      }
    }
  }

  const median = medianNumeric(points);
  return median === null ? null : Number(median.toFixed(1));
}

export async function fetchConsensusGameSpread(eventId, league = "NBA") {
  return fetchConsensusMarketPoints(eventId, league, "spreads");
}

export async function fetchConsensusGameTotal(eventId, league = "NBA") {
  return fetchConsensusMarketPoints(eventId, league, "totals");
}

export async function fetchPointsPropsForEvent(eventId, league = "NBA") {
  if (!API_KEY || !eventId) {
    console.log("FETCH POINT PROPS SKIPPED:", {
      league,
      eventId,
      reason: !API_KEY ? "missing ODDS_KEY" : "missing eventId",
    });
    return [];
  }

  const data = await oddsGet(
    `${getOddsBase(league)}/events/${eventId}/odds`,
    {
      apiKey: API_KEY,
      regions: "us",
      markets: "player_points",
      oddsFormat: "american",
    },
    `FETCH POINT PROPS (${league})`
  );

  if (!data) {
    console.log("FETCH POINT PROPS EMPTY RESPONSE:", { league, eventId });
    return [];
  }

  const props = [];
  const rejected = [];
  let playerPointOutcomes = 0;

  for (const book of data?.bookmakers || []) {
    for (const market of book.markets || []) {
      if (market.key !== "player_points") continue;

      for (const outcome of market.outcomes || []) {
        playerPointOutcomes += 1;

        const player = outcome.description;
        const side = outcome.name;
        const line = Number(outcome.point);
        const odds = Number(outcome.price);

        if (!player) {
          rejected.push({ reason: "missing player name", outcome: outcome.name });
          continue;
        }

        if (!["Over", "Under"].includes(side)) {
          rejected.push({ player, reason: "invalid side", side });
          continue;
        }

        if (!Number.isFinite(line)) {
          rejected.push({ player, side, reason: "invalid line" });
          continue;
        }

        if (!Number.isFinite(odds)) {
          rejected.push({ player, side, line, reason: "invalid odds" });
          continue;
        }

        props.push({
          player,
          playerKey: clean(player),
          side,
          line,
          odds,
          sportsbook: book.title || book.key,
          sportsbookKey: book.key,
          eventId,
          league,
        });
      }
    }
  }

  console.log(`POINT PROPS FOUND (${league}):`, {
    eventId,
    bookmakers: data?.bookmakers?.length || 0,
    playerPointOutcomes,
    accepted: props.length,
    rejected: rejected.length,
    rejectedSample: rejected.slice(0, 5),
  });

  return props;
}

function average(arr = []) {
  const nums = arr.map(Number).filter(Number.isFinite);

  if (!nums.length) return null;

  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function chooseMainLine(lines = []) {
  const nums = lines.map(Number).filter(Number.isFinite);

  if (!nums.length) return null;

  const sorted = [...nums].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 1) {
    return sorted[middle];
  }

  return Number(((sorted[middle - 1] + sorted[middle]) / 2).toFixed(1));
}

function chooseClosestLine(lines = [], targetLine) {
  const nums = [...new Set(lines.map(Number).filter(Number.isFinite))];

  if (!nums.length || targetLine === null) return null;

  return nums.sort((a, b) => {
    const aDiff = Math.abs(a - targetLine);
    const bDiff = Math.abs(b - targetLine);

    if (aDiff !== bDiff) return aDiff - bDiff;

    return b - a;
  })[0];
}

function buildMarketProfile({
  bookCount = 0,
  consensusBookCount = 0,
  overBookCount = 0,
  underBookCount = 0,
  lineSpread = 0,
  hasBothSides = false,
}) {
  // Composite market trust score — downstream evidenceReliability uses marketQuality
  // as the single book/market weight; do not also weight bookCount/consensusBookCount.
  let marketQuality = 50;
  const warnings = [];
  const strengths = [];

  if (bookCount >= 10) {
    marketQuality += 20;
    strengths.push("Strong book coverage");
  } else if (bookCount >= 6) {
    marketQuality += 12;
    strengths.push("Good book coverage");
  } else if (bookCount >= 3) {
    marketQuality += 5;
  } else {
    marketQuality -= 15;
    warnings.push("Low book coverage");
  }

  if (consensusBookCount >= 6) {
    marketQuality += 10;
    strengths.push("Good line agreement");
  } else if (consensusBookCount <= 2) {
    marketQuality -= 10;
    warnings.push("Weak line agreement");
  }

  if (lineSpread <= 0.5) {
    marketQuality += 10;
    strengths.push("Tight market line");
  } else if (lineSpread <= 1.5) {
    marketQuality += 4;
  } else {
    marketQuality -= 12;
    warnings.push("Wide line spread across books");
  }

  if (!hasBothSides) {
    marketQuality -= 20;
    warnings.push("Missing Over/Under side coverage");
  }

  if (overBookCount === 0 || underBookCount === 0) {
    marketQuality -= 15;
    warnings.push("One side has no usable odds");
  }

  marketQuality = Math.max(0, Math.min(100, Math.round(marketQuality)));

  let marketGrade = "WEAK";
  if (marketQuality >= 80) marketGrade = "STRONG";
  else if (marketQuality >= 65) marketGrade = "GOOD";
  else if (marketQuality >= 50) marketGrade = "FAIR";

  return {
    marketQuality,
    marketGrade,
    marketStrengths: strengths,
    marketWarnings: warnings,
  };
}

export function buildConsensusPointProps(rawProps = []) {
  const byPlayer = {};
  const rejected = [];

  for (const prop of rawProps) {
    const key = prop.playerKey;

    if (!byPlayer[key]) {
      byPlayer[key] = {
        player: prop.player,
        playerKey: prop.playerKey,
        allLines: [],
        books: new Set(),
        booksByLine: {},
        oversByLine: {},
        undersByLine: {},
        overBooksByLine: {},
        underBooksByLine: {},
      };
    }

    const line = Number(prop.line);

    if (!Number.isFinite(line)) continue;

    const lineKey = String(line);

    byPlayer[key].allLines.push(line);
    byPlayer[key].books.add(prop.sportsbook);

    if (!byPlayer[key].booksByLine[lineKey]) {
      byPlayer[key].booksByLine[lineKey] = new Set();
    }

    if (!byPlayer[key].oversByLine[lineKey]) {
      byPlayer[key].oversByLine[lineKey] = [];
    }

    if (!byPlayer[key].undersByLine[lineKey]) {
      byPlayer[key].undersByLine[lineKey] = [];
    }

    if (!byPlayer[key].overBooksByLine[lineKey]) {
      byPlayer[key].overBooksByLine[lineKey] = new Set();
    }

    if (!byPlayer[key].underBooksByLine[lineKey]) {
      byPlayer[key].underBooksByLine[lineKey] = new Set();
    }

    byPlayer[key].booksByLine[lineKey].add(prop.sportsbook);

    if (prop.side === "Over") {
      byPlayer[key].oversByLine[lineKey].push(prop.odds);
      byPlayer[key].overBooksByLine[lineKey].add(prop.sportsbook);
    }

    if (prop.side === "Under") {
      byPlayer[key].undersByLine[lineKey].push(prop.odds);
      byPlayer[key].underBooksByLine[lineKey].add(prop.sportsbook);
    }
  }

  const results = Object.values(byPlayer)
    .map((item) => {
      const mainLine = chooseMainLine(item.allLines);

      if (mainLine === null) {
        rejected.push({ player: item.player, reason: "no main line" });
        return null;
      }

      const availableLines = [...new Set(item.allLines)]
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

      const closestLine = chooseClosestLine(availableLines, mainLine);

      if (closestLine === null) {
        rejected.push({ player: item.player, reason: "no closest line" });
        return null;
      }

      const lineKey = String(closestLine);

      const overOddsArray = item.oversByLine[lineKey] || [];
      const underOddsArray = item.undersByLine[lineKey] || [];

      const overAverage = average(overOddsArray);
      const underAverage = average(underOddsArray);

      const overBookCount = item.overBooksByLine[lineKey]?.size || 0;
      const underBookCount = item.underBooksByLine[lineKey]?.size || 0;
      const consensusBookCount = item.booksByLine[lineKey]?.size || 0;
      const bookCount = item.books.size;

      const lineSpread =
        availableLines.length > 1
          ? Number(
              (
                Math.max(...availableLines) - Math.min(...availableLines)
              ).toFixed(1)
            )
          : 0;

      const hasBothSides = overBookCount > 0 && underBookCount > 0;

      const market = buildMarketProfile({
        bookCount,
        consensusBookCount,
        overBookCount,
        underBookCount,
        lineSpread,
        hasBothSides,
      });

      return {
        player: item.player,
        playerKey: item.playerKey,
        stat: "Points",

        line: Number(closestLine),
        consensusLine: Number(mainLine),
        availableLines,

        overOdds:
          overAverage !== null ? Math.round(overAverage) : null,

        underOdds:
          underAverage !== null ? Math.round(underAverage) : null,

        bookCount,
        consensusBookCount,
        overBookCount,
        underBookCount,
        lineSpread,
        hasBothSides,

        marketQuality: market.marketQuality,
        marketGrade: market.marketGrade,
        marketStrengths: market.marketStrengths,
        marketWarnings: market.marketWarnings,
      };
    })
    .filter(Boolean);

  console.log("CONSENSUS POINT PROPS:", {
    rawCount: rawProps.length,
    players: results.length,
    rejected: rejected.length,
    rejectedSample: rejected.slice(0, 5),
  });

  return results;
}

export async function fetchOddsGameCards(
  league = "NBA",
  daysAhead = null,
  options = {}
) {
  const events = await fetchOddsEvents(league, options);

  const targetDate =
    daysAhead === null || daysAhead === undefined
      ? null
      : getTargetCentralDateKey(daysAhead);

  const cards = events
    .map((event) => {
      const commenceTime = event.commence_time || "";
      const centralDate = getCentralDateKey(commenceTime);
      const minutesUntilStart = getMinutesUntilStart(commenceTime);

      const homeTeam = normalizeTeam(event.home_team, league);
      const awayTeam = normalizeTeam(event.away_team, league);

      return {
        id: event.id,
        gameId: event.id,

        date: centralDate,
        utcDate: commenceTime?.slice(0, 10) || "",
        time: commenceTime,
        commenceTime,

        minutesUntilStart,
        isStarted:
          typeof minutesUntilStart === "number"
            ? minutesUntilStart <= 0
            : false,

        homeTeam,
        awayTeam,
        home: homeTeam,
        away: awayTeam,

        rawHomeTeam: event.home_team,
        rawAwayTeam: event.away_team,

        game: `${awayTeam.toUpperCase()} vs ${homeTeam.toUpperCase()}`,
        league,
        oddsEventId: event.id,
      };
    })
    .filter((card) => {
      if (!targetDate) return true;
      return card.date === targetDate;
    })
    .sort((a, b) => new Date(a.commenceTime) - new Date(b.commenceTime));

  console.log(`ODDS GAME CARDS (${league})`, {
    daysAhead,
    targetDate,
    count: cards.length,
    games: cards.map((card) => ({
      game: card.game,
      date: card.date,
      time: card.time,
      isStarted: card.isStarted,
    })),
  });

  return cards;
}