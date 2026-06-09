import dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

async function test(name, url, headers = {}) {
  try {
    const res = await fetch(url, { headers });
    const text = await res.text();

    console.log("\n====================");
    console.log(name);
    console.log("STATUS:", res.status);
    console.log("BODY:", text.slice(0, 500));
  } catch (err) {
    console.log(name, "FAILED:", err.message);
  }
}

await test(
  "Odds Sports",
  `https://api.the-odds-api.com/v4/sports/?apiKey=${process.env.ODDS_KEY}`
);

await test(
  "BallDontLie WNBA Players",
  "https://api.balldontlie.io/wnba/v1/players",
  {
    Authorization: process.env.BALLDONTLIE_KEY,
  }
);

await test(
  "BallDontLie WNBA Stats",
  "https://api.balldontlie.io/wnba/v1/player_stats",
  {
    Authorization: process.env.BALLDONTLIE_KEY,
  }
);

await test(
  "SportsData WNBA Players",
  "https://api.sportsdata.io/v3/wnba/stats/json/Players",
  {
    "Ocp-Apim-Subscription-Key": process.env.SPORTS_KEY,
  }
);

await test(
  "SportsData WNBA Teams",
  "https://api.sportsdata.io/v3/wnba/scores/json/teams",
  {
    "Ocp-Apim-Subscription-Key": process.env.SPORTS_KEY,
  }
);


console.log("\n====================");
console.log("TEST: SportsGameOdds WNBA Players");

const sgPlayers = await fetch(
  "https://api.sportsgameodds.com/v2/players/?league=WNBA",
  {
    headers: {
      "x-api-key": process.env.SPORTSGAMEODDS_KEY,
    },
  }
);

console.log("STATUS:", sgPlayers.status);
console.log("BODY:", (await sgPlayers.text()).slice(0, 500));

console.log("\n====================");
console.log("TEST: RapidAPI");

const rapidRes = await fetch(
  "https://api-basketball.p.rapidapi.com/leagues",
  {
    headers: {
      "X-RapidAPI-Key": process.env.RAPIDAPI_KEY,
      "X-RapidAPI-Host": "api-basketball.p.rapidapi.com",
    },
  }
);

console.log("STATUS:", rapidRes.status);
console.log("BODY:", (await rapidRes.text()).slice(0, 500));