import dotenv from "dotenv";
import fetch from "node-fetch";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const BDL_BASE = "https://api.balldontlie.io/wnba/v1";
const ODDS_SPORT = "basketball_wnba";
const SPORTS_WNBA = "https://api.sportsdata.io/v3/wnba";

function describeShape(value, depth = 0) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    const sample = value[0];
    return `array(len=${value.length}${sample ? `, item=${describeShape(sample, depth + 1)}` : ""})`;
  }
  if (typeof value !== "object") return typeof value;
  if (depth >= 2) return `object(keys=${Object.keys(value).length})`;
  const keys = Object.keys(value).slice(0, 14);
  const parts = keys.map((key) => `${key}:${describeShape(value[key], depth + 1)}`);
  return `object{${parts.join(", ")}}`;
}

function sampleFields(record = {}, keys = []) {
  const out = {};
  for (const key of keys) {
    if (record?.[key] !== undefined) out[key] = record[key];
  }
  return out;
}

async function probe({ name, url, headers = {}, parse = "json" }) {
  const result = {
    name,
    url: url.replace(process.env.ODDS_KEY || "", "[ODDS_KEY]"),
    configured: true,
    status: null,
    ok: false,
    shape: null,
    sample: null,
    error: null,
  };

  try {
    const res = await fetch(url, { headers });
    result.status = res.status;
    result.ok = res.ok;

    if (parse === "json") {
      const payload = await res.json();
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : payload?.bookmakers || payload?.events || null;
      result.shape = describeShape(payload);
      if (Array.isArray(rows) && rows.length > 0) {
        result.sample = describeShape(rows[0]);
      } else if (payload && typeof payload === "object") {
        result.sample = describeShape(payload);
      }
    } else {
      const text = await res.text();
      result.shape = `text(len=${text.length})`;
    }
  } catch (err) {
    result.error = String(err.message || err);
  }

  return result;
}

function missingKeyResult(name, keyName) {
  return {
    name,
    configured: false,
    status: null,
    ok: false,
    shape: null,
    sample: null,
    error: `${keyName} not configured`,
  };
}

async function main() {
  const season = new Date().getFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const results = [];

  const bdlKey = process.env.BALLDONTLIE_KEY || "";
  const oddsKey = process.env.ODDS_KEY || "";
  const sportsKey = process.env.SPORTS_KEY || "";

  const bdlHeaders = bdlKey ? { Authorization: bdlKey } : {};

  const bdlTests = [
    { name: "BDL WNBA teams", url: `${BDL_BASE}/teams?per_page=5` },
    { name: "BDL WNBA games", url: `${BDL_BASE}/games?dates[]=${today}&per_page=5` },
    {
      name: "BDL WNBA team_season_averages",
      url: `${BDL_BASE}/team_season_averages?season=${season}&per_page=5`,
    },
    {
      name: "BDL WNBA player_injuries",
      url: `${BDL_BASE}/player_injuries?per_page=5`,
    },
    { name: "BDL WNBA players", url: `${BDL_BASE}/players?per_page=5` },
    {
      name: "BDL WNBA player_stats",
      url: `${BDL_BASE}/player_stats?per_page=5&season=${season}`,
    },
  ];

  for (const test of bdlTests) {
    if (!bdlKey) {
      results.push(missingKeyResult(test.name, "BALLDONTLIE_KEY"));
      continue;
    }
    results.push(await probe({ ...test, headers: bdlHeaders }));
  }

  const oddsBase = `https://api.the-odds-api.com/v4/sports/${ODDS_SPORT}`;
  const oddsTests = [
    {
      name: "Odds API WNBA events",
      url: `${oddsBase}/events?apiKey=${oddsKey}`,
    },
  ];

  for (const test of oddsTests) {
    if (!oddsKey) {
      results.push(missingKeyResult(test.name, "ODDS_KEY"));
      continue;
    }
    const eventProbe = await probe(test);
    results.push(eventProbe);

    let eventId = null;
    if (eventProbe.ok) {
      try {
        const res = await fetch(test.url);
        const payload = await res.json();
        eventId = payload?.[0]?.id || null;
      } catch {
        eventId = null;
      }
    }

    const marketTests = [
      { name: "Odds API WNBA spreads", markets: "spreads" },
      { name: "Odds API WNBA totals", markets: "totals" },
      { name: "Odds API WNBA moneyline", markets: "h2h" },
      { name: "Odds API WNBA player_points", markets: "player_points" },
    ];

    for (const market of marketTests) {
      if (!eventId) {
        results.push({
          name: market.name,
          configured: true,
          status: null,
          ok: false,
          shape: null,
          sample: null,
          error: "no WNBA event id available for market probe",
        });
        continue;
      }

      results.push(
        await probe({
          name: market.name,
          url: `${oddsBase}/events/${eventId}/odds?apiKey=${oddsKey}&regions=us&markets=${market.markets}&oddsFormat=american`,
        })
      );
    }
  }

  const sportsTests = [
    {
      name: "SportsData WNBA teams",
      url: `${SPORTS_WNBA}/scores/json/teams`,
    },
    {
      name: "SportsData WNBA players",
      url: `${SPORTS_WNBA}/stats/json/Players`,
    },
    {
      name: "SportsData WNBA team season stats",
      url: `${SPORTS_WNBA}/stats/json/TeamSeasonStats/${season}`,
    },
    {
      name: "SportsData WNBA player game stats by date",
      url: `${SPORTS_WNBA}/stats/json/PlayerGameStatsByDate/${today}`,
    },
  ];

  for (const test of sportsTests) {
    if (!sportsKey) {
      results.push(missingKeyResult(test.name, "SPORTS_KEY"));
      continue;
    }
    results.push(
      await probe({
        ...test,
        headers: { "Ocp-Apim-Subscription-Key": sportsKey },
      })
    );
  }

  const summary = {
    ranAt: new Date().toISOString(),
    keys: {
      BALLDONTLIE_KEY: bdlKey ? "configured" : "missing",
      ODDS_KEY: oddsKey ? "configured" : "missing",
      SPORTS_KEY: sportsKey ? "configured" : "missing",
    },
    results: results.map((row) => ({
      name: row.name,
      configured: row.configured,
      status: row.status,
      ok: row.ok,
      shape: row.shape,
      sample: row.sample,
      error: row.error,
    })),
    working: results.filter((r) => r.ok).map((r) => r.name),
    failed: results
      .filter((r) => r.configured && !r.ok)
      .map((r) => ({ name: r.name, status: r.status, error: r.error })),
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err.message || err) }));
  process.exit(1);
});
