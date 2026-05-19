import axios from "axios";
import { CONFIG } from "../config.js";

const ODDS_BASE =
  "https://api.the-odds-api.com/v4/sports/basketball_nba";

const API_KEY = CONFIG.ODDS_KEY;

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeTeam(value = "") {
  const v = String(value).toLowerCase();

  const map = {
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

  nyk: "ny",
  sas: "sa",
  gsw: "gs",
  nop: "no",
};

  return map[v] || clean(v);
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

      return data;
    } catch (err) {
      console.log(`${label} ATTEMPT ${attempt} FAILED:`, err.message);

      if (attempt === 3) {
        return null;
      }

      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
    }
  }

  return null;
}

export async function fetchOddsEvents() {
  if (!API_KEY) {
    console.log("ODDS_KEY missing");
    return [];
  }

  const data = await oddsGet(
    `${ODDS_BASE}/events`,
    { apiKey: API_KEY },
    "FETCH ODDS EVENTS"
  );

  const events = Array.isArray(data) ? data : [];

  console.log("ODDS EVENTS FOUND:", events.length);

  return events;
}

export async function findOddsEventForGame(game) {
  const events = await fetchOddsEvents();

  const gameHome = normalizeTeam(game.homeTeam || game.home);
  const gameAway = normalizeTeam(game.awayTeam || game.away);

  return (
    events.find((event) => {
      const eventHome = normalizeTeam(event.home_team);
      const eventAway = normalizeTeam(event.away_team);

      return (
        (gameHome === eventHome && gameAway === eventAway) ||
        (gameHome === eventAway && gameAway === eventHome)
      );
    }) || null
  );
}

export async function fetchPointsPropsForEvent(eventId) {
  if (!API_KEY || !eventId) return [];

  const data = await oddsGet(
    `${ODDS_BASE}/events/${eventId}/odds`,
    {
      apiKey: API_KEY,
      regions: "us",
      markets: "player_points",
      oddsFormat: "american",
    },
    "FETCH POINT PROPS"
  );

  const props = [];

  for (const book of data?.bookmakers || []) {
    for (const market of book.markets || []) {
      if (market.key !== "player_points") continue;

      for (const outcome of market.outcomes || []) {
        if (!outcome.description || !outcome.point) continue;

        props.push({
          player: outcome.description,
          playerKey: clean(outcome.description),
          side: outcome.name,
          line: Number(outcome.point),
          odds: Number(outcome.price),
          sportsbook: book.title || book.key,
          eventId,
        });
      }
    }
  }

  console.log("POINT PROPS FOUND:", props.length);

  return props;
}

export function buildConsensusPointProps(rawProps = []) {
  const grouped = {};

  for (const prop of rawProps) {
    const key = `${prop.playerKey}-${prop.line}`;

    if (!grouped[key]) {
      grouped[key] = {
        player: prop.player,
        playerKey: prop.playerKey,
        line: prop.line,
        overs: [],
        unders: [],
        books: new Set(),
      };
    }

    grouped[key].books.add(prop.sportsbook);

    if (prop.side === "Over") grouped[key].overs.push(prop.odds);
    if (prop.side === "Under") grouped[key].unders.push(prop.odds);
  }

  return Object.values(grouped).map((item) => {
    const avg = (arr) =>
      arr.length
        ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length)
        : null;

    return {
      player: item.player,
      playerKey: item.playerKey,
      stat: "Points",
      line: item.line,
      overOdds: avg(item.overs),
      underOdds: avg(item.unders),
      bookCount: item.books.size,
    };
  });
}