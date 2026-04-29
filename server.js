const express = require("express");
const cors = require("cors");
const axios = require("axios");

const app = express();
app.use(cors());

const SPORTS_KEY = process.env.SPORTS_KEY;
const ODDS_KEY = process.env.ODDS_KEY;

const STATS_BASE = "https://api.sportsdata.io/v3/nba/stats/json";
const ODDS_BASE = "https://api.the-odds-api.com/v4/sports/basketball_nba";

console.log("SPORTSDATA KEY LOADED:", SPORTS_KEY.includes("PASTE") ? "NO" : "YES");
console.log("ODDS KEY LOADED:", ODDS_KEY.includes("PASTE") ? "NO" : "YES");

const clean = (v) =>
  String(v || "").toLowerCase().replace(/[^a-z0-9]/g, "");

const addDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};

const teamMap = {
  ATL: "atlantahawks", BOS: "bostonceltics", BKN: "brooklynnets",
  CHA: "charlottehornets", CHI: "chicagobulls", CLE: "clevelandcavaliers",
  DAL: "dallasmavericks", DEN: "denvernuggets", DET: "detroitpistons",
  GSW: "goldenstatewarriors", HOU: "houstonrockets", IND: "indianapacers",
  LAC: "losangelesclippers", LAL: "losangeleslakers", MEM: "memphisgrizzlies",
  MIA: "miamiheat", MIL: "milwaukeebucks", MIN: "minnesotatimberwolves",
  NOP: "neworleanspelicans", NYK: "newyorkknicks", OKC: "oklahomacitythunder",
  ORL: "orlandomagic", PHI: "philadelphia76ers", PHO: "phoenixsuns",
  POR: "portlandtrailblazers", SAC: "sacramentokings", SAS: "sanantoniospurs",
  TOR: "torontoraptors", UTA: "utahjazz", WAS: "washingtonwizards",
};

const fetchSportsData = async (url) => {
  try {
    const res = await axios.get(url, {
      headers: { "Ocp-Apim-Subscription-Key": SPORTS_KEY },
    });
    return res.data || [];
  } catch (err) {
    console.log("SportsData error:", err.response?.data || err.message);
    return [];
  }
};

const fetchOddsAPI = async (url) => {
  try {
    const res = await axios.get(url);
    return res.data || [];
  } catch (err) {
    console.log("OddsAPI error:", err.response?.data || err.message);
    return [];
  }
};

const getGamesForDate = async (dateLabel, dateValue) => {
  const games = await fetchSportsData(`${STATS_BASE}/GamesByDate/${dateValue}`);
  const events = await fetchOddsAPI(`${ODDS_BASE}/events?apiKey=${ODDS_KEY}`);

  return (games || []).map((game) => {
    const home = teamMap[game.HomeTeam] || clean(game.HomeTeam);
    const away = teamMap[game.AwayTeam] || clean(game.AwayTeam);

    const matchedEvent = (events || []).find((e) => {
      const eventHome = clean(e.home_team);
      const eventAway = clean(e.away_team);

      return (
        (eventHome === home && eventAway === away) ||
        (eventHome === away && eventAway === home)
      );
    });

    return {
      ...game,
      dateLabel,
      gameDate: dateValue,
      oddsEventID: matchedEvent?.id || null,
    };
  });
};

app.get("/games", async (req, res) => {
  const todayGames = await getGamesForDate("Today", addDays(0));
  const tomorrowGames = await getGamesForDate("Tomorrow", addDays(1));

  res.json([...todayGames, ...tomorrowGames]);
});

app.get("/players", async (req, res) => {
  const data = await fetchSportsData(`${STATS_BASE}/PlayerSeasonStats/2026`);
  res.json(Array.isArray(data) ? data : []);
});

app.get("/injuries", async (req, res) => {
  const data = await fetchSportsData(`${STATS_BASE}/Injuries`);
  res.json(Array.isArray(data) ? data : []);
});

app.get("/player-log/:playerID", async (req, res) => {
  const { playerID } = req.params;

  const regular = await fetchSportsData(
    `${STATS_BASE}/PlayerGameStatsByPlayer/2026/${playerID}`
  );

  const playoffs = await fetchSportsData(
    `${STATS_BASE}/PlayerGameStatsByPlayer/2026POST/${playerID}`
  );

  res.json({
    regular: Array.isArray(regular) ? regular : [],
    playoffs: Array.isArray(playoffs) ? playoffs : [],
  });
});

app.get("/props/:gameID", async (req, res) => {
  const { gameID } = req.params;

  if (!gameID || gameID === "null" || gameID === "undefined") {
    return res.json([]);
  }

  const markets = [
    "player_points",
    "player_rebounds",
    "player_assists",
    "player_threes",
  ].join(",");

  const url =
    `${ODDS_BASE}/events/${gameID}/odds` +
    `?apiKey=${ODDS_KEY}` +
    `&regions=us` +
    `&markets=${markets}` +
    `&oddsFormat=american`;

  const data = await fetchOddsAPI(url);
  const formatted = [];

  for (const book of data.bookmakers || []) {
    for (const market of book.markets || []) {
      const type =
        market.key === "player_rebounds"
          ? "Rebounds"
          : market.key === "player_assists"
          ? "Assists"
          : market.key === "player_threes"
          ? "Threes"
          : "Points";

      const grouped = {};

      for (const outcome of market.outcomes || []) {
        const player = outcome.description;
        const line = outcome.point;

        if (!player || !line) continue;

        const key = `${player}-${type}-${line}`;

        if (!grouped[key]) {
          grouped[key] = {
            player,
            type,
            line,
            sportsbook: book.title,
            overOdds: null,
            underOdds: null,
          };
        }

        if (outcome.name === "Over") grouped[key].overOdds = outcome.price;
        if (outcome.name === "Under") grouped[key].underOdds = outcome.price;
      }

      formatted.push(...Object.values(grouped));
    }
  }

  res.json(formatted);
});

const PORT = process.env.PORT || 5000;

app.get("/", (req, res) => {
  res.send("BetBrain API is running");
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});