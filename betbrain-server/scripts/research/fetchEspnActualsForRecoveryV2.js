/**
 * Fetch ESPN WNBA box-score points for recovery dates (NOT Odds API).
 * historicalProviderCalls (Odds) = 0
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, "../..");
const OUT = path.join(
  SERVER,
  "research",
  "empirical-safe-prop-v2",
  "exports",
  "COURTEDGE_ESPN_ACTUALS_INDEX_V2.json"
);

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

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "BetBrain-CourtEdge-research/1.0" },
  });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function parseBoxPlayers(summary, gameDate, eventId) {
  const groups = summary?.boxscore?.players || [];
  const out = [];
  for (const group of groups) {
    const team = group?.team?.displayName || group?.team?.abbreviation || "";
    const statGroup = (group.statistics || []).find((s) =>
      Array.isArray(s?.athletes)
    );
    if (!statGroup) continue;
    const keys = Array.isArray(statGroup.keys) ? statGroup.keys : [];
    const ptsIdx = keys.indexOf("points");
    for (const ath of statGroup.athletes || []) {
      if (ath.didNotPlay) continue;
      const name =
        ath.athlete?.displayName ||
        ath.athlete?.fullName ||
        ath.athlete?.shortName;
      const pts =
        ptsIdx >= 0 ? num(ath.stats?.[ptsIdx]) : num(ath.stats?.[keys.length - 1]);
      if (!name || pts == null) continue;
      out.push({
        date: gameDate,
        player: name,
        playerKey: cleanName(name),
        points: pts,
        team,
        eventId: String(eventId || ""),
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
  for (const ev of events) {
    const id = ev.id;
    const status = ev.status?.type?.name || ev.status?.type?.state;
    // Prefer finals; still grab if completed
    if (
      status &&
      !/final|post/i.test(String(status)) &&
      ev.status?.type?.completed !== true
    ) {
      continue;
    }
    const summary = await fetchJson(`${ESPN_SUMMARY}?event=${id}`);
    rows.push(...parseBoxPlayers(summary, date, id));
    await new Promise((r) => setTimeout(r, 150));
  }
  return rows;
}

async function main() {
  const dates = [
    "2026-07-15",
    "2026-07-19",
    "2026-07-20",
    "2026-07-21",
    "2026-07-22",
    "2026-07-25",
    "2026-07-26",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-08-03",
    "2026-08-06",
  ];
  const byKey = {};
  const byDate = {};
  let espnCalls = 0;
  for (const d of dates) {
    try {
      console.log("fetch", d);
      const rows = await fetchDate(d);
      espnCalls += 1 + new Set(rows.map((r) => r.eventId)).size; // approx
      byDate[d] = rows.length;
      for (const r of rows) {
        byKey[`${r.date}|${r.playerKey}`] = r;
      }
      console.log(" ", d, rows.length);
    } catch (e) {
      console.log("fail", d, e.message);
      byDate[d] = 0;
    }
  }
  const payload = {
    build: "courteedge-empirical-low-medium-prop-finder-v2",
    note: "ESPN public box scores for rejected-candidate grading. Odds historicalProviderCalls=0.",
    oddsHistoricalProviderCalls: 0,
    espnResearchFetches: espnCalls,
    dates,
    byDate,
    count: Object.keys(byKey).length,
    byKey,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2));
  console.log("wrote", OUT, "count", payload.count);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
