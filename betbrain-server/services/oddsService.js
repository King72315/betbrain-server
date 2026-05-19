import fetch from "node-fetch";
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
    "oklahoma city thunder": "okc",
    "minnesota timberwolves": "min",
    "boston celtics": "bos",
    "new york knicks": "nyk",
    "cleveland cavaliers": "cle",
    "san antonio spurs": "sas",
    "los angeles lakers": "lal",
    "los angeles clippers": "lac",
  };

  return map[v] || clean(v);
}

export async function fetchOddsEvents() {
  if (!API_KEY) {
    console.log("ODDS_KEY missing");
    return [];
  }

  try {
    const url =
      `${ODDS_BASE}/events?apiKey=${API_KEY}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.log("ODDS EVENTS ERROR:", res.status);
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.log("FETCH ODDS EVENTS ERROR:", err.message);
    return [];
  }
}

export async function findOddsEventForGame(game) {
  const events = await fetchOddsEvents();

  const gameHome = normalizeTeam(game.homeTeam || game.home);
  const gameAway = normalizeTeam(game.awayTeam || game.away);

  return (
    events.find((event) => {
      const eventHome = normalizeTeam(event.home_team);
      const eventAway = normalizeTeam(event.away_team);

      const normal =
        gameHome === eventHome && gameAway === eventAway;

      const flipped =
        gameHome === eventAway && gameAway === eventHome;

      return normal || flipped;
    }) || null
  );
}

export async function fetchPointsPropsForEvent(eventId) {
  if (!API_KEY || !eventId) return [];

  try {
    const url =
      `${ODDS_BASE}/events/${eventId}/odds` +
      `?apiKey=${API_KEY}` +
      `&regions=us` +
      `&markets=player_points` +
      `&oddsFormat=american`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.log("POINT PROPS ERROR:", res.status);
      return [];
    }

    const props = [];

    for (const book of data.bookmakers || []) {
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

    return props;
  } catch (err) {
    console.log("FETCH POINT PROPS ERROR:", err.message);
    return [];
  }
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