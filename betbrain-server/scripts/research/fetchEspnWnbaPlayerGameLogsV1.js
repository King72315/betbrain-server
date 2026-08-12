/**
 * Fetch ESPN WNBA player-game logs with PTS/REB/AST/MIN (NOT Odds API).
 * Writes a chronological warehouse for offline REB/AST calibration.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "../..");
const OUT_DIR = path.join(
  SERVER,
  "research",
  "courteedge-gold-learning-v1",
  "reb-ast-historical-calibration-v1"
);
const OUT = path.join(OUT_DIR, "espn-player-game-logs-v1.json");

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard";
const ESPN_SUMMARY =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/summary";

function cleanName(n) {
  return String(n || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseMinutes(v) {
  if (v == null) return null;
  if (typeof v === "number") return v;
  const s = String(v);
  if (s.includes(":")) {
    const [m, sec] = s.split(":");
    return num(m) + (num(sec) || 0) / 60;
  }
  return num(s);
}

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "BetBrain-CourtEdge-reb-ast-calib/1.0" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function ymdList(start, end) {
  const out = [];
  const d = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function parseBoxPlayers(summary, gameDate, eventId) {
  const groups = summary?.boxscore?.players || [];
  const teamKeys = groups.map(
    (g) => g?.team?.abbreviation || g?.team?.displayName || ""
  );
  const out = [];
  for (let gi = 0; gi < groups.length; gi += 1) {
    const group = groups[gi];
    const team =
      group?.team?.abbreviation || group?.team?.displayName || "";
    const opponent = teamKeys.find((_, i) => i !== gi) || "";
    const homeAway =
      summary?.boxscore?.teams?.[gi]?.homeAway ||
      (gi === 0 ? "away" : "home");
    const statGroup = (group.statistics || []).find((s) =>
      Array.isArray(s?.athletes)
    );
    if (!statGroup) continue;
    const keys = Array.isArray(statGroup.keys) ? statGroup.keys : [];
    const idx = (k) => keys.indexOf(k);
    for (const ath of statGroup.athletes || []) {
      if (ath.didNotPlay) continue;
      const name =
        ath.athlete?.displayName ||
        ath.athlete?.fullName ||
        ath.athlete?.shortName;
      const stats = ath.stats || [];
      const minutes = parseMinutes(stats[idx("minutes")]);
      if (!name || minutes == null || minutes <= 0) continue;
      const points = num(stats[idx("points")]);
      const rebounds = num(stats[idx("rebounds")]);
      const assists = num(stats[idx("assists")]);
      const oreb = num(stats[idx("offensiveRebounds")]);
      const dreb = num(stats[idx("defensiveRebounds")]);
      out.push({
        date: gameDate,
        eventId: String(eventId || ""),
        playerId: String(ath.athlete?.id || ""),
        player: name,
        playerKey: cleanName(name),
        team,
        opponent,
        homeAway,
        minutes: Number(minutes.toFixed(2)),
        points,
        rebounds,
        assists,
        offensiveRebounds: oreb,
        defensiveRebounds: dreb,
        starterStatus: ath.starter === true ? "STARTER" : "BENCH",
        source: "ESPN_BOXSCORE",
      });
    }
  }
  return out;
}

async function fetchDate(date) {
  const ymd = date.replace(/-/g, "");
  const board = await fetchJson(`${ESPN_SCOREBOARD}?dates=${ymd}`);
  const events = board?.events || [];
  const rows = [];
  let calls = 1;
  for (const ev of events) {
    const status = ev.status?.type?.name || ev.status?.type?.state;
    if (
      status &&
      !/final|post/i.test(String(status)) &&
      ev.status?.type?.completed !== true
    ) {
      continue;
    }
    const summary = await fetchJson(`${ESPN_SUMMARY}?event=${ev.id}`);
    calls += 1;
    rows.push(...parseBoxPlayers(summary, date, ev.id));
    await new Promise((r) => setTimeout(r, 120));
  }
  return { rows, calls, eventCount: events.length };
}

async function main() {
  const start = process.env.ESPN_START || "2026-05-16";
  const end = process.env.ESPN_END || "2026-08-11";
  const dates = ymdList(start, end);
  const all = [];
  let espnCalls = 0;
  const byDate = {};
  for (const d of dates) {
    try {
      const { rows, calls, eventCount } = await fetchDate(d);
      espnCalls += calls;
      byDate[d] = { rows: rows.length, events: eventCount };
      all.push(...rows);
      if (eventCount > 0) {
        console.log(d, "events", eventCount, "rows", rows.length);
      }
    } catch (e) {
      byDate[d] = { rows: 0, events: 0, error: e.message };
      console.log("fail", d, e.message);
    }
  }
  // Dedup by date|eventId|playerKey
  const map = new Map();
  for (const r of all) {
    map.set(`${r.date}|${r.eventId}|${r.playerKey}`, r);
  }
  const rows = [...map.values()].sort((a, b) =>
    a.date === b.date
      ? String(a.playerKey).localeCompare(b.playerKey)
      : a.date.localeCompare(b.date)
  );
  const payload = {
    build: "espn-wnba-player-game-logs-v1",
    note: "ESPN public boxes — Odds historicalProviderCalls=0",
    oddsHistoricalProviderCalls: 0,
    espnResearchFetches: espnCalls,
    start,
    end,
    count: rows.length,
    byDate,
    rows,
  };
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload));
  console.log("wrote", OUT, "count", rows.length, "espnCalls", espnCalls);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
