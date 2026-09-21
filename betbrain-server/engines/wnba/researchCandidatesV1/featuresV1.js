/**
 * Leak-free pre-match features from ESPN warehouse rows.
 * Research-only. Never writes Product Truth.
 */
export const RESEARCH_FEATURES_BUILD = "courteedge-research-features-v1";

export function num(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

export function mean(xs) {
  const a = xs.filter((x) => x != null && Number.isFinite(x));
  if (!a.length) return null;
  return a.reduce((s, x) => s + x, 0) / a.length;
}

export function blend(recent, season, w = 0.6) {
  if (recent != null && season != null) return w * recent + (1 - w) * season;
  return recent ?? season ?? null;
}

export function expRecency(xs, decay = 0.85) {
  const a = xs.filter((x) => x != null && Number.isFinite(x));
  if (!a.length) return null;
  let w = 1;
  let sw = 0;
  let s = 0;
  for (let i = a.length - 1; i >= 0; i -= 1) {
    s += a[i] * w;
    sw += w;
    w *= decay;
  }
  return sw ? s / sw : null;
}

export function stdev(xs) {
  const a = xs.filter((x) => x != null && Number.isFinite(x));
  if (a.length < 2) return null;
  const m = mean(a);
  const v = a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length;
  return Math.sqrt(v);
}

export function cleanName(n) {
  return String(n || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function priorGames(games = [], date) {
  return games.filter((g) => g.date < date && !g.didNotPlay && num(g.MIN) > 0);
}

export function playedOn(games = [], date) {
  return games.find((g) => g.date === date && !g.didNotPlay && num(g.MIN) > 0) || null;
}

export function summarizePlayer(games = []) {
  const n = games.length;
  const mins = games.map((g) => num(g.MIN));
  const last5 = games.slice(-5);
  const last10 = games.slice(-10);
  const last3 = games.slice(-3);
  const seasonMin = mean(mins);
  const recentMin = mean(last5.map((g) => num(g.MIN)));
  const seasonPts = mean(games.map((g) => num(g.PTS)));
  const recentPts = mean(last5.map((g) => num(g.PTS)));
  const seasonReb = mean(games.map((g) => num(g.REB)));
  const recentReb = mean(last5.map((g) => num(g.REB)));
  const seasonAst = mean(games.map((g) => num(g.AST)));
  const recentAst = mean(last5.map((g) => num(g.AST)));
  const seasonFga = mean(games.map((g) => num(g.FGA)));
  const recentFga = mean(last5.map((g) => num(g.FGA)));
  const seasonFta = mean(games.map((g) => num(g.FTA)));
  const recentFta = mean(last5.map((g) => num(g.FTA)));
  const seasonFgm = mean(games.map((g) => num(g.FGM)));
  const recentFgm = mean(last5.map((g) => num(g.FGM)));
  const starterShare = n ? games.filter((g) => g.starterStatus === "STARTER").length / n : null;
  const recentStarterShare = last5.length
    ? last5.filter((g) => g.starterStatus === "STARTER").length / last5.length
    : null;
  return {
    n,
    seasonMin,
    recentMin,
    expMin: expRecency(mins),
    seasonPts,
    recentPts,
    seasonReb,
    recentReb,
    seasonAst,
    recentAst,
    seasonFga,
    recentFga,
    seasonFta,
    recentFta,
    seasonFgm,
    recentFgm,
    seasonFgPct: seasonFga > 0 ? seasonFgm / seasonFga : null,
    recentFgPct: recentFga > 0 ? recentFgm / recentFga : null,
    starterShare,
    recentStarterShare,
    minCv: seasonMin > 0 && stdev(mins) != null ? stdev(mins) / seasonMin : null,
    last5MinCv: recentMin > 0 && stdev(last5.map((g) => num(g.MIN))) != null
      ? stdev(last5.map((g) => num(g.MIN))) / recentMin
      : null,
    lastDate: n ? games[n - 1].date : null,
    team: n ? games[n - 1].team : null,
    last5,
    last10,
    last3,
    games,
  };
}

export function rate(stat, minutes) {
  if (stat == null || minutes == null || minutes <= 0) return null;
  return stat / minutes;
}

export function classifyAstRole(player, teamAst36 = null) {
  const ast36 = rate(player.recentAst ?? player.seasonAst, player.recentMin ?? player.seasonMin);
  const per36 = ast36 == null ? null : ast36 * 36;
  const start = player.recentStarterShare ?? player.starterShare ?? 0;
  let role = "LOW_CREATION_ROLE";
  if (per36 != null && start >= 0.5 && per36 >= 5.5) role = "PRIMARY_CREATOR";
  else if (per36 != null && start >= 0.5 && per36 >= 3.5) role = "SECONDARY_CREATOR";
  else if (per36 != null && start < 0.5 && per36 >= 4.0) role = "BENCH_HANDLER";
  else if (start >= 0.5 && (per36 == null || per36 >= 2.0)) role = "STARTING_CONNECTOR";
  if (teamAst36 != null && per36 != null) {
    if (per36 >= teamAst36 * 1.35 && start >= 0.5) role = "PRIMARY_CREATOR";
    else if (per36 >= teamAst36 && start >= 0.5) role = "SECONDARY_CREATOR";
  }
  const unstable =
    player.starterShare != null &&
    player.recentStarterShare != null &&
    Math.abs(player.recentStarterShare - player.starterShare) >= 0.4;
  return {
    role,
    ast36: per36 == null ? null : Number(per36.toFixed(3)),
    primaryCreator: role === "PRIMARY_CREATOR",
    secondaryCreator: role === "SECONDARY_CREATOR",
    ballHandlingUnstable: Boolean(unstable),
  };
}

export function classifyRebRole(player) {
  const reb36 = rate(player.recentReb ?? player.seasonReb, player.recentMin ?? player.seasonMin);
  const per36 = reb36 == null ? null : reb36 * 36;
  return {
    reb36: per36 == null ? null : Number(per36.toFixed(3)),
    likelyInteriorMinutes: per36 != null && per36 >= 8,
    smallBallRole: per36 != null && per36 < 4.5,
  };
}

export function daysBetween(prev, next) {
  if (!prev || !next) return null;
  const a = new Date(`${prev}T12:00:00-05:00`).getTime();
  const b = new Date(`${next}T12:00:00-05:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

/**
 * Pre-match teammate absence: last appearance ≥ 6 days before slate,
 * or last logged game was a DNP. Uses only games before `date`.
 */
export function teammateAbsenceFlags(teammateGamesByKey, team, date, predicate) {
  let out = 0;
  let returning = 0;
  for (const games of teammateGamesByKey.values()) {
    const prior = games.filter((g) => g.date < date && g.team === team);
    if (!prior.length) continue;
    const played = prior.filter((g) => !g.didNotPlay && num(g.MIN) > 0);
    if (!played.length) continue;
    const summary = summarizePlayer(played);
    if (!predicate(summary)) continue;
    const last = prior[prior.length - 1];
    const gap = daysBetween(last.date, date);
    const lastDnp = Boolean(last.didNotPlay);
    if (lastDnp || (gap != null && gap >= 6)) out += 1;
    else if (gap != null && gap >= 3 && gap < 6 && !lastDnp) returning += 1;
  }
  return { out, returning };
}
