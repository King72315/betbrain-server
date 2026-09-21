/**
 * Tonight's WNBA game rosters (ESPN) — identity fallback when BDL is down.
 * Does not change PTS formulas. Only resolves team + athlete id + game logs.
 */
import { resolveWnbaTeamId, teamsMatch } from "../engines/wnba/wnbaTeamAliasResolver.js";

const ESPN_SCOREBOARD =
  "https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/scoreboard";
const ESPN_ROSTER = (teamId) =>
  `https://site.api.espn.com/apis/site/v2/sports/basketball/wnba/teams/${teamId}/roster`;
const ESPN_GAMELOG = (athleteId) =>
  `https://site.web.api.espn.com/apis/common/v3/sports/basketball/wnba/athletes/${athleteId}/gamelog`;

const rosterCache = new Map();
const logCache = new Map();

function clean(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function splitName(playerName = "") {
  const parts = String(playerName).trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") || "" };
}

async function fetchJson(url, label) {
  const res = await fetch(url, {
    headers: { "User-Agent": "CourtEdge-TonightRoster-V1" },
  });
  if (!res.ok) {
    console.log(`${label} STATUS:`, res.status);
    return null;
  }
  return res.json();
}

function flattenRosterAthletes(payload) {
  const out = [];
  const walk = (node) => {
    if (!node) return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.fullName || node.displayName) {
      out.push({
        espnAthleteId: String(node.id || node.athleteId || ""),
        name: node.fullName || node.displayName,
        firstName: node.firstName || "",
        lastName: node.lastName || "",
      });
    }
    if (node.items) walk(node.items);
    if (node.athletes) walk(node.athletes);
  };
  walk(payload?.athletes || payload?.roster || payload);
  return out;
}

export function matchPlayerOnTonightRoster(playerName, players = [], homeId = "", awayId = "") {
  const want = clean(playerName);
  if (!want || !players.length) return null;
  const { firstName, lastName } = splitName(playerName);
  const firstPrefix = clean(firstName).slice(0, 3);
  const last = clean(lastName);

  const exact = players.filter((p) => clean(p.name) === want);
  const pool = exact.length
    ? exact
    : players.filter((p) => {
        const pl = clean(p.lastName || splitName(p.name).lastName);
        const pf = clean(p.firstName || splitName(p.name).firstName);
        if (!last || pl !== last) return false;
        if (!firstPrefix) return true;
        return pf.startsWith(firstPrefix) || firstPrefix.startsWith(pf.slice(0, 3));
      });

  const onGame = pool.filter(
    (p) => teamsMatch(p.teamId, homeId) || teamsMatch(p.teamId, awayId)
  );
  const use = onGame.length ? onGame : homeId || awayId ? [] : pool;
  const teams = [...new Set(use.map((p) => p.teamId).filter(Boolean))];
  if (use.length === 1 && teams.length === 1) return use[0];
  if (teams.length === 1 && use.length >= 1) return use[0];
  return null;
}

export function parseEspnAthleteGameLog(json) {
  const labels = (json?.labels || []).map((l) => String(l || "").toUpperCase());
  const idx = (name) => labels.indexOf(name);
  const iMin = idx("MIN");
  const iPts = idx("PTS");
  const iReb = idx("REB");
  const iAst = idx("AST");
  const iFg = idx("FG");
  const iFt = idx("FT");
  const i3 = idx("3PT");
  const eventsById = json?.events || {};
  const rows = [];
  for (const cat of json?.seasonTypes?.[0]?.categories || []) {
    for (const ev of cat.events || []) {
      const meta = eventsById[ev.eventId] || {};
      const stats = ev.stats || [];
      const pair = (i) => {
        const raw = i >= 0 ? String(stats[i] || "") : "";
        if (!raw.includes("-")) return { made: 0, att: 0 };
        const [m, a] = raw.split("-").map(Number);
        return { made: Number.isFinite(m) ? m : 0, att: Number.isFinite(a) ? a : 0 };
      };
      const minutes = Number(iMin >= 0 ? stats[iMin] : 0) || 0;
      const fg = pair(iFg);
      const ft = pair(iFt);
      const t3 = pair(i3);
      rows.push({
        date: String(meta.gameDate || meta.date || "").slice(0, 10),
        team: resolveWnbaTeamId(meta.team) || "",
        opponent: resolveWnbaTeamId(meta.opponent) || "",
        opponentTeamId: resolveWnbaTeamId(meta.opponent) || "",
        points: Number(iPts >= 0 ? stats[iPts] : 0) || 0,
        rebounds: Number(iReb >= 0 ? stats[iReb] : 0) || 0,
        assists: Number(iAst >= 0 ? stats[iAst] : 0) || 0,
        minutes,
        fga: fg.att,
        fta: ft.att,
        fg3a: t3.att,
        played: minutes > 0,
        source: "ESPN_GAMELOG",
      });
    }
  }
  return rows.filter((g) => g.date).sort((a, b) => (a.date < b.date ? 1 : -1));
}

export async function prefetchWnbaTonightRosters(slateDate) {
  const date = String(slateDate || "").slice(0, 10);
  if (!date) return { date, games: [], players: [] };
  if (rosterCache.has(date)) return rosterCache.get(date);
  const ymd = date.replace(/-/g, "");
  const board = await fetchJson(`${ESPN_SCOREBOARD}?dates=${ymd}`, "ESPN TONIGHT SCOREBOARD");
  const games = [];
  const players = [];
  for (const ev of board?.events || []) {
    const comp = ev.competitions?.[0];
    const home = (comp?.competitors || []).find((c) => c.homeAway === "home");
    const away = (comp?.competitors || []).find((c) => c.homeAway === "away");
    const homeId = resolveWnbaTeamId(home?.team || home?.team?.abbreviation);
    const awayId = resolveWnbaTeamId(away?.team || away?.team?.abbreviation);
    const homeEspnId = home?.team?.id || home?.id;
    const awayEspnId = away?.team?.id || away?.id;
    const gamePlayers = [];
    for (const [espnTeamId, teamId] of [
      [homeEspnId, homeId],
      [awayEspnId, awayId],
    ]) {
      if (!espnTeamId || !teamId) continue;
      const roster = await fetchJson(ESPN_ROSTER(espnTeamId), `ESPN ROSTER ${teamId}`);
      for (const ath of flattenRosterAthletes(roster)) {
        const row = { ...ath, teamId, espnTeamId: String(espnTeamId) };
        gamePlayers.push(row);
        players.push(row);
      }
    }
    games.push({
      eventId: ev.id,
      homeId,
      awayId,
      players: gamePlayers,
    });
  }
  const payload = { date, games, players, fetchedAt: new Date().toISOString() };
  rosterCache.set(date, payload);
  console.log("TONIGHT ROSTER PREFETCH:", {
    date,
    games: games.length,
    players: players.length,
  });
  return payload;
}

export function resolveTeamFromTonightRoster(playerName, game = {}, roster = null) {
  const homeId = resolveWnbaTeamId(
    game.homeTeam || game.home || game.rawHomeTeam || ""
  );
  const awayId = resolveWnbaTeamId(
    game.awayTeam || game.away || game.rawAwayTeam || ""
  );
  const date = String(game.date || roster?.date || "").slice(0, 10);
  const cached = roster || (date ? rosterCache.get(date) : null);
  if (!cached) return null;
  const gameRow =
    (cached.games || []).find(
      (g) =>
        (homeId && awayId && teamsMatch(g.homeId, homeId) && teamsMatch(g.awayId, awayId)) ||
        (homeId && awayId && teamsMatch(g.homeId, awayId) && teamsMatch(g.awayId, homeId))
    ) || null;
  const players = gameRow?.players || cached.players || [];
  return matchPlayerOnTonightRoster(playerName, players, homeId, awayId);
}

export async function fetchEspnAthleteGameLog(espnAthleteId) {
  const id = String(espnAthleteId || "").trim();
  if (!id) return [];
  if (logCache.has(id)) return logCache.get(id);
  const json = await fetchJson(ESPN_GAMELOG(id), `ESPN GAMELOG ${id}`);
  const rows = json ? parseEspnAthleteGameLog(json) : [];
  if (rows.length) logCache.set(id, rows);
  return rows;
}

export function resetTonightRosterForTests() {
  rosterCache.clear();
  logCache.clear();
}

export function seedTonightRosterForTests(date, payload) {
  rosterCache.set(String(date), payload);
}
