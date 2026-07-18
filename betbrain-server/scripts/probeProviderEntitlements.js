/**
 * Live provider entitlement probe — NEVER logs API keys or Authorization values.
 * Usage: node scripts/probeProviderEntitlements.js
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { CONFIG } from "../config.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const FIXTURE_DIR = path.join(ROOT, "test-fixtures", "provider-entitlements");
const SUMMARY_PATH = path.join(ROOT, ".tmp-provider-entitlement-probe.json");
const PROD_HEALTH = "https://betbrain-server-1.onrender.com/health";

const SECRET_KEYS = new Set([
  "apikey",
  "api_key",
  "api-key",
  "key",
  "authorization",
  "ocp-apim-subscription-key",
  "x-api-key",
  "token",
  "secret",
  "password",
  "odds_key",
  "sports_key",
  "balldontlie_key",
]);

function keyLoaded(v) {
  return v && String(v).trim() ? "YES" : "NO";
}

function redactDeep(value, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.slice(0, 3).map((v) => redactDeep(v, depth + 1));
  }
  if (typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEYS.has(String(k).toLowerCase())) {
      out[k] = "[REDACTED]";
      continue;
    }
    if (typeof v === "string" && /Bearer\s+\S+/i.test(v)) {
      out[k] = "[REDACTED]";
      continue;
    }
    out[k] = redactDeep(v, depth + 1);
  }
  return out;
}

function sampleFields(row) {
  if (!row || typeof row !== "object") return null;
  return Object.keys(row).slice(0, 12);
}

function scrambleHeuristic(data) {
  const rows = Array.isArray(data)
    ? data
    : data && typeof data === "object" && Array.isArray(data.data)
      ? data.data
      : data
        ? [data]
        : [];
  if (!rows.length) {
    return { lookScrambled: null, reason: "empty_or_non_array", sampleSize: 0 };
  }
  const sample = rows.slice(0, 8);
  let numeric = 0;
  let zeroOrNull = 0;
  for (const row of sample) {
    if (!row || typeof row !== "object") continue;
    for (const [k, v] of Object.entries(row)) {
      if (SECRET_KEYS.has(k.toLowerCase())) continue;
      if (typeof v === "number") {
        numeric += 1;
        if (v === 0) zeroOrNull += 1;
      } else if (v == null) {
        numeric += 1;
        zeroOrNull += 1;
      }
    }
  }
  const ratio = numeric ? zeroOrNull / numeric : 0;
  const lookScrambled = numeric >= 5 && ratio >= 0.85;
  return {
    lookScrambled,
    zeroOrNullRatio: Number(ratio.toFixed(3)),
    numericFieldsChecked: numeric,
    sampleSize: sample.length,
    reason: lookScrambled
      ? "high_zero_or_null_ratio"
      : numeric < 5
        ? "insufficient_numeric_fields"
        : "values_look_populated",
  };
}

function truncatePayload(data) {
  if (Array.isArray(data)) return redactDeep(data.slice(0, 3));
  if (data && typeof data === "object") {
    const copy = { ...data };
    if (Array.isArray(copy.data)) copy.data = copy.data.slice(0, 3);
    return redactDeep(copy);
  }
  return redactDeep(data);
}

async function saveFixture(name, meta, data) {
  const file = path.join(FIXTURE_DIR, `${name}.json`);
  const payload = {
    savedAt: new Date().toISOString(),
    ...meta,
    body: truncatePayload(data),
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2));
  return file;
}

async function probe(name, url, options = {}) {
  const started = Date.now();
  const headers = { ...(options.headers || {}), Accept: "application/json" };
  // Strip any accidental key leakage from logged URL
  const safeUrl = String(url).replace(/([?&](?:apiKey|key|api_key)=)[^&]*/gi, "$1REDACTED");
  try {
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(25000),
    });
    const text = await res.text();
    let data = null;
    let parseError = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (e) {
      parseError = e.message;
    }
    const count = Array.isArray(data)
      ? data.length
      : data && Array.isArray(data.data)
        ? data.data.length
        : null;
    const first =
      Array.isArray(data) && data[0]
        ? data[0]
        : data && Array.isArray(data.data) && data.data[0]
          ? data.data[0]
          : data && typeof data === "object"
            ? data
            : null;
    const scramble = scrambleHeuristic(data);
    const result = {
      name,
      status: res.status,
      ok: res.ok,
      ms: Date.now() - started,
      url: safeUrl,
      count,
      sampleFields: sampleFields(first),
      parseError,
      bodyPreview:
        !data && text
          ? String(text)
              .slice(0, 180)
              .replace(/[A-Za-z0-9_\-]{24,}/g, "[REDACTED_TOKEN]")
          : null,
      scramble,
      errorMessage:
        data && typeof data === "object" && (data.message || data.error)
          ? String(data.message || data.error).slice(0, 200)
          : null,
    };
    await saveFixture(
      name.replace(/[^a-zA-Z0-9_-]+/g, "_").toLowerCase(),
      {
        name,
        status: res.status,
        url: safeUrl,
        count,
        scramble,
      },
      data
    );
    return result;
  } catch (err) {
    return {
      name,
      status: null,
      ok: false,
      ms: Date.now() - started,
      url: safeUrl,
      count: null,
      sampleFields: null,
      error: String(err.message || err).slice(0, 200),
      scramble: { lookScrambled: null, reason: "request_failed" },
    };
  }
}

function todayYmd() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function main() {
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  const matrix = {
    probedAt: new Date().toISOString(),
    keysPresent: {
      oddsKeyLoaded: keyLoaded(CONFIG.ODDS_KEY),
      ballKeyLoaded: keyLoaded(CONFIG.BALLDONTLIE_KEY),
      sportsKeyLoaded: keyLoaded(CONFIG.SPORTS_KEY),
    },
    prodHealth: null,
    odds: [],
    bdl: [],
    sportsData: [],
  };

  // --- Prod health (no secrets) ---
  try {
    const hr = await fetch(PROD_HEALTH, { signal: AbortSignal.timeout(20000) });
    const hj = await hr.json();
    matrix.prodHealth = {
      status: hr.status,
      serverBuild: hj.serverBuild || null,
      config: {
        sportsKeyLoaded: hj.config?.sportsKeyLoaded ?? null,
        oddsKeyLoaded: hj.config?.oddsKeyLoaded ?? null,
        ballKeyLoaded: hj.config?.ballKeyLoaded ?? null,
        environment: hj.config?.environment ?? null,
      },
    };
  } catch (err) {
    matrix.prodHealth = { status: null, error: String(err.message || err).slice(0, 200) };
  }

  // --- A. Odds API ---
  const oddsKey = CONFIG.ODDS_KEY || "";
  for (const sport of ["basketball_nba", "basketball_wnba"]) {
    const eventsUrl = `https://api.the-odds-api.com/v4/sports/${sport}/events?apiKey=${oddsKey}`;
    const events = await probe(`odds_${sport}_events`, eventsUrl);
    matrix.odds.push(events);

    let eventId = null;
    try {
      const fixturePath = path.join(
        FIXTURE_DIR,
        `odds_${sport}_events.json`
      );
      if (fs.existsSync(fixturePath)) {
        const fx = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
        eventId = fx?.body?.[0]?.id || null;
      }
    } catch {
      /* ignore */
    }

    if (eventId) {
      const oddsUrl =
        `https://api.the-odds-api.com/v4/sports/${sport}/events/${eventId}/odds` +
        `?apiKey=${oddsKey}&regions=us&markets=player_points&oddsFormat=american`;
      matrix.odds.push(
        await probe(`odds_${sport}_player_points`, oddsUrl)
      );
    } else {
      matrix.odds.push({
        name: `odds_${sport}_player_points`,
        status: null,
        ok: false,
        skipped: true,
        reason: "no_event_id_from_events_probe",
      });
    }
  }

  // --- B. BallDontLie ---
  const bdlHeaders = { Authorization: CONFIG.BALLDONTLIE_KEY || "" };
  const bdlProbes = [
    ["bdl_wnba_teams", "https://api.balldontlie.io/wnba/v1/teams"],
    [
      "bdl_wnba_team_season_averages_2025",
      "https://api.balldontlie.io/wnba/v1/team_season_averages?season=2025",
    ],
    [
      "bdl_wnba_team_season_averages_2026",
      "https://api.balldontlie.io/wnba/v1/team_season_averages?season=2026",
    ],
    [
      "bdl_wnba_players_search_stewart",
      "https://api.balldontlie.io/wnba/v1/players?search=Stewart",
    ],
    ["bdl_nba_teams", "https://api.balldontlie.io/v1/teams"],
    ["bdl_wnba_player_injuries", "https://api.balldontlie.io/wnba/v1/player_injuries"],
    ["bdl_wnba_injuries_alt", "https://api.balldontlie.io/wnba/v1/injuries"],
  ];

  for (const [name, url] of bdlProbes) {
    matrix.bdl.push(await probe(name, url, { headers: bdlHeaders }));
  }

  // Sample player_stats using first Stewart player id if available
  let stewartId = null;
  try {
    const fx = JSON.parse(
      fs.readFileSync(
        path.join(FIXTURE_DIR, "bdl_wnba_players_search_stewart.json"),
        "utf8"
      )
    );
    stewartId = fx?.body?.data?.[0]?.id || fx?.body?.[0]?.id || null;
  } catch {
    /* ignore */
  }
  if (stewartId) {
    matrix.bdl.push(
      await probe(
        "bdl_wnba_player_stats_sample",
        `https://api.balldontlie.io/wnba/v1/player_stats?player_ids[]=${stewartId}&per_page=5`,
        { headers: bdlHeaders }
      )
    );
  } else {
    matrix.bdl.push({
      name: "bdl_wnba_player_stats_sample",
      status: null,
      ok: false,
      skipped: true,
      reason: "no_stewart_player_id",
    });
  }

  // --- C. SportsData ---
  const sdHeaders = {
    "Ocp-Apim-Subscription-Key": CONFIG.SPORTS_KEY || "",
  };
  const seasonYear = new Date().getUTCFullYear(); // NBA ending-year style often current or +1; try both
  const sdDate = todayYmd();

  const sdProbes = [
    [
      "sd_wnba_scores_teams",
      "https://api.sportsdata.io/v3/wnba/scores/json/Teams",
    ],
    [
      "sd_wnba_stats_players",
      "https://api.sportsdata.io/v3/wnba/stats/json/Players",
    ],
    [
      "sd_wnba_scores_players",
      "https://api.sportsdata.io/v3/wnba/scores/json/Players",
    ],
    [
      "sd_nba_team_season_stats",
      `https://api.sportsdata.io/v3/nba/scores/json/TeamSeasonStats/${seasonYear}`,
    ],
    [
      "sd_nba_team_season_stats_prev",
      `https://api.sportsdata.io/v3/nba/scores/json/TeamSeasonStats/${seasonYear - 1}`,
    ],
    [
      "sd_nba_player_projections_by_date",
      `https://api.sportsdata.io/api/nba/fantasy/json/PlayerGameProjectionStatsByDate/${sdDate}`,
    ],
    // WNBA projection-style endpoints (best-effort)
    [
      "sd_wnba_player_game_projection_by_date",
      `https://api.sportsdata.io/v3/wnba/projections/json/PlayerGameProjectionStatsByDate/${sdDate}`,
    ],
    [
      "sd_wnba_fantasy_projection_by_date",
      `https://api.sportsdata.io/v3/wnba/stats/json/PlayerGameProjectionStatsByDate/${sdDate}`,
    ],
  ];

  for (const [name, url] of sdProbes) {
    matrix.sportsData.push(await probe(name, url, { headers: sdHeaders }));
  }

  // Compact matrix rows for console + summary
  function row(r) {
    return {
      name: r.name,
      status: r.status,
      ok: r.ok ?? false,
      count: r.count ?? null,
      sampleFields: r.sampleFields || null,
      scramble: r.scramble || null,
      skipped: r.skipped || false,
      reason: r.reason || null,
      error: r.error || r.errorMessage || null,
      ms: r.ms ?? null,
      url: r.url || null,
    };
  }

  const summary = {
    probedAt: matrix.probedAt,
    localKeysPresent: matrix.keysPresent,
    prodHealth: matrix.prodHealth,
    matrix: {
      odds: matrix.odds.map(row),
      bdl: matrix.bdl.map(row),
      sportsData: matrix.sportsData.map(row),
    },
    fixtureDir: "betbrain-server/test-fixtures/provider-entitlements/",
    summaryPath: "betbrain-server/.tmp-provider-entitlement-probe.json",
    note: "Sanitized fixtures truncate arrays to <=3 rows; Authorization and key query params redacted.",
  };

  fs.writeFileSync(SUMMARY_PATH, JSON.stringify(summary, null, 2));

  // Console matrix (no secrets)
  console.log("=== PROVIDER ENTITLEMENT PROBE ===");
  console.log("Local keys:", JSON.stringify(matrix.keysPresent));
  console.log("Prod health:", JSON.stringify(matrix.prodHealth));
  console.log("\n--- ODDS ---");
  for (const r of summary.matrix.odds) {
    console.log(
      `${r.name} | status=${r.status} | count=${r.count} | fields=${(r.sampleFields || []).join(",") || "-"} | skipped=${!!r.skipped}`
    );
  }
  console.log("\n--- BDL ---");
  for (const r of summary.matrix.bdl) {
    console.log(
      `${r.name} | status=${r.status} | count=${r.count} | fields=${(r.sampleFields || []).join(",") || "-"} | err=${r.error || "-"}`
    );
  }
  console.log("\n--- SPORTSDATA ---");
  for (const r of summary.matrix.sportsData) {
    const scr = r.scramble?.lookScrambled;
    console.log(
      `${r.name} | status=${r.status} | count=${r.count} | scrambled=${scr} | fields=${(r.sampleFields || []).join(",") || "-"} | err=${r.error || "-"}`
    );
  }
  console.log("\nWrote:", SUMMARY_PATH);
  console.log("Fixtures:", FIXTURE_DIR);
}

main().catch((err) => {
  console.error("PROBE FATAL:", String(err.message || err).slice(0, 300));
  process.exit(1);
});
