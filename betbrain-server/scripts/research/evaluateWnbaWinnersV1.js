/**
 * Build team-game history, walk-forward baselines, and Winner V1 metrics.
 * Does not remint Product Truth. Does not change player-prop sides.
 */
import fs from "fs";
import path from "path";
import readline from "readline";
import crypto from "crypto";
import { fileURLToPath } from "url";
import {
  P_BANDS,
  brier,
  logLoss,
  normalizeWnbaTeam,
  slateDateCT,
} from "../../engines/wnba/winnersV1/constants.js";
import { fitHomeCourt, walkForward } from "../../engines/wnba/winnersV1/winnerModelV1.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const JSONL = path.join(ROOT, "research/courteedge-wnba-calibration-rebuild-v1/warehouse/wnba-player-games-2024-26.jsonl");
const CACHE = path.join(ROOT, "research/courteedge-wnba-winners-v1/10-team-games.json");
const OUT = path.join(ROOT, "research/courteedge-wnba-winners-v1/20-historical.json");
const TRUTH = path.join(ROOT, "canonical-predictions-v1.json");
const LOCKED = "fc69b0ecf159510d00284ee8ab18932297c4ad84d8cf43017898e6354f3885a9";

function sha(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function pack(rows, key) {
  const y = rows.filter((r) => r.homeWon != null);
  let w = 0;
  let br = 0;
  let ll = 0;
  for (const r of y) {
    const p = r[key];
    const pickHome = p >= 0.5;
    const hit = pickHome === r.homeWon;
    if (hit) w += 1;
    br += brier(pickHome ? p : 1 - p, hit);
    ll += logLoss(pickHome ? p : 1 - p, hit);
  }
  return {
    n: y.length,
    wl: `${w}-${y.length - w}`,
    hit: y.length ? Number((w / y.length).toFixed(4)) : null,
    brier: y.length ? Number((br / y.length).toFixed(4)) : null,
    logLoss: y.length ? Number((ll / y.length).toFixed(4)) : null,
  };
}

function topN(rows, n, key = "pV1") {
  const byDate = new Map();
  for (const r of rows) {
    const d = r.date;
    if (!byDate.has(d)) byDate.set(d, []);
    byDate.get(d).push(r);
  }
  let w = 0;
  let m = 0;
  for (const list of byDate.values()) {
    const ranked = [...list].sort((a, b) => Math.abs(b[key] - 0.5) - Math.abs(a[key] - 0.5)).slice(0, n);
    for (const r of ranked) {
      const p = r[key];
      const hit = (p >= 0.5) === r.homeWon;
      m += 1;
      if (hit) w += 1;
    }
  }
  return { n: m, wl: `${w}-${m - w}`, hit: m ? Number((w / m).toFixed(4)) : null };
}

function bands(rows, key = "pV1") {
  const out = {};
  for (const b of P_BANDS) {
    const xs = rows.filter((r) => {
      const p = r[key] >= 0.5 ? r[key] : 1 - r[key];
      return p >= b.lo && p < b.hi;
    });
    out[b.key] = pack(xs, key);
  }
  return out;
}

async function loadPlayerEvents() {
  const byEvent = new Map();
  if (!fs.existsSync(JSONL)) return [];
  const rl = readline.createInterface({ input: fs.createReadStream(JSONL), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (row.quarantine) continue;
    const eventId = row.eventId || row.providerEventId;
    const team = normalizeWnbaTeam(row.team);
    const pts = Number(row.PTS);
    if (!eventId || !team || !Number.isFinite(pts)) continue;
    if (!byEvent.has(eventId)) {
      byEvent.set(eventId, { eventId, date: row.date, season: row.season, teams: {} });
    }
    const ev = byEvent.get(eventId);
    ev.teams[team] = (ev.teams[team] || 0) + pts;
  }
  return [...byEvent.values()];
}

async function fetchScoreboard(date) {
  const ymd = String(date).replace(/-/g, "");
  const url = `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard?dates=${ymd}`;
  const res = await fetch(url, { headers: { "User-Agent": "CourtEdge-WnbaWinners-V1" } });
  if (!res.ok) return [];
  const json = await res.json();
  const games = [];
  for (const ev of json?.events || []) {
    const comp = ev.competitions?.[0];
    const comps = comp?.competitors || [];
    const home = comps.find((c) => c.homeAway === "home");
    const away = comps.find((c) => c.homeAway === "away");
    if (!home || !away) continue;
    games.push({
      eventId: `wnba:espn:${ev.id}`,
      date,
      homeTeam: normalizeWnbaTeam(home.team?.abbreviation || home.team?.shortDisplayName),
      awayTeam: normalizeWnbaTeam(away.team?.abbreviation || away.team?.shortDisplayName),
      homeName: home.team?.displayName,
      awayName: away.team?.displayName,
      homeScore: home.score != null ? Number(home.score) : null,
      awayScore: away.score != null ? Number(away.score) : null,
      commenceTime: ev.date || comp?.date,
      season: String(date).slice(0, 4),
    });
  }
  return games;
}

async function buildTeamGames() {
  if (fs.existsSync(CACHE)) {
    return JSON.parse(fs.readFileSync(CACHE, "utf8"));
  }
  const events = await loadPlayerEvents();
  const dates = [...new Set(events.map((e) => e.date).filter((d) => d && d >= "2025-05-01"))].sort();
  const games = [];
  for (let i = 0; i < dates.length; i += 6) {
    const chunk = dates.slice(i, i + 6);
    const parts = await Promise.all(chunk.map((d) => fetchScoreboard(d).catch(() => [])));
    for (const list of parts) games.push(...list);
  }
  const decided = games.filter((g) => g.homeScore != null && g.awayScore != null);
  fs.mkdirSync(path.dirname(CACHE), { recursive: true });
  fs.writeFileSync(CACHE, JSON.stringify(decided));
  return decided;
}

const hash = sha(TRUTH);
if (hash !== LOCKED) {
  console.error("Product Truth hash is not the locked fingerprint; continuing Winner research without rewriting it.");
}

const games = await buildTeamGames();
games.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.eventId).localeCompare(String(b.eventId)));
const g2025 = games.filter((g) => String(g.season || g.date).startsWith("2025"));
const g2026 = games.filter((g) => String(g.season || g.date).startsWith("2026"));
const walked = walkForward(games);
const rows = walked.rows;
const r2026 = rows.filter((r) => String(r.date).startsWith("2026"));

function bestSimple(row) {
  return (row.pElo + row.pPd) / 2;
}
const withBlend = rows.map((r) => ({ ...r, pBlend: bestSimple(r) }));

const report = {
  generatedAt: new Date().toISOString(),
  slateDateCT: slateDateCT(new Date()),
  productTruthHash: hash,
  productTruthLocked: hash === LOCKED,
  games: { all: games.length, y2025: g2025.length, y2026: g2026.length },
  homeCourt: walked.homeCourt,
  baselines: {
    HOME: pack(rows, "pHomeAlways"),
    BETTER_RECORD: pack(rows, "pRecord"),
    POINT_DIFF: pack(rows, "pPd"),
    ELO: pack(rows, "pElo"),
    BEST_SIMPLE_BLEND: pack(withBlend, "pBlend"),
    WINNER_V1: pack(rows, "pV1"),
  },
  winnerV1_2026: pack(r2026, "pV1"),
  top1: topN(rows, 1),
  top2: topN(rows, 2),
  top3: topN(rows, 3),
  bands: bands(rows),
  windows: {
    "1-5": pack(rows.filter((r) => r.sampleGames <= 5), "pV1"),
    "6-10": pack(rows.filter((r) => r.sampleGames >= 6 && r.sampleGames <= 10), "pV1"),
    "11-20": pack(rows.filter((r) => r.sampleGames >= 11 && r.sampleGames <= 20), "pV1"),
    "20+": pack(rows.filter((r) => r.sampleGames >= 20), "pV1"),
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
fs.writeFileSync(
  path.join(ROOT, "research/courteedge-wnba-winners-v1/21-states.json"),
  JSON.stringify({ homeCourt: walked.homeCourt, note: "end-of-history states omitted; slate runner rebuilds walk-forward" })
);
console.log(JSON.stringify({ games: report.games, baselines: report.baselines, top1: report.top1, homeCourt: report.homeCourt }, null, 2));
