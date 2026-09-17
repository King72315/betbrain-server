import {
  WNBA_WINNER_MODEL_VERSION,
  clampProb,
  logistic,
  normalizePair,
  normalizeWnbaTeam,
} from "./constants.js";

const START_ELO = 1500;
const K = 18;

export function emptyTeamState() {
  return {
    elo: START_ELO,
    wins: 0,
    losses: 0,
    pd: 0,
    games: 0,
    recentPd: [],
    lastDate: null,
  };
}

export function fitHomeCourt(games = []) {
  const decided = games.filter((g) => g.homeScore != null && g.awayScore != null && g.homeScore !== g.awayScore);
  if (!decided.length) return { homeWinRate: null, hfaElo: 40, intercept: 0.08 };
  const hw = decided.filter((g) => g.homeScore > g.awayScore).length;
  const rate = hw / decided.length;
  const intercept = Math.log(Math.max(0.05, Math.min(0.95, rate)) / (1 - Math.max(0.05, Math.min(0.95, rate))));
  const hfaElo = (400 * Math.log10(rate / (1 - rate))) || 40;
  return { homeWinRate: Number(rate.toFixed(4)), hfaElo: Number(hfaElo.toFixed(2)), intercept: Number(intercept.toFixed(4)) };
}

function restDays(prev, next) {
  if (!prev || !next) return null;
  const a = new Date(`${prev}T12:00:00-05:00`).getTime();
  const b = new Date(`${next}T12:00:00-05:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function predictElo(homeState, awayState, hfaElo = 40) {
  const diff = homeState.elo + hfaElo - awayState.elo;
  return clampProb(1 / (1 + 10 ** (-diff / 400)));
}

export function predictRecord(homeState, awayState) {
  const hr = homeState.games ? homeState.wins / homeState.games : 0.5;
  const ar = awayState.games ? awayState.wins / awayState.games : 0.5;
  if (hr === ar) return 0.5;
  return hr > ar ? 0.56 : 0.44;
}

export function predictPointDiff(homeState, awayState, recent = false) {
  const h = recent
    ? avg(homeState.recentPd)
    : homeState.games
      ? homeState.pd / homeState.games
      : 0;
  const a = recent
    ? avg(awayState.recentPd)
    : awayState.games
      ? awayState.pd / awayState.games
      : 0;
  return clampProb(logistic((h - a) / 12));
}

function avg(xs = []) {
  const n = xs.filter((x) => Number.isFinite(x));
  if (!n.length) return 0;
  return n.reduce((s, x) => s + x, 0) / n.length;
}

export function predictWinnerV1(homeState, awayState, extras = {}) {
  const hfa = extras.hfaElo ?? 40;
  const homeIntercept = extras.homeIntercept ?? 0.08;
  const pElo = predictElo(homeState, awayState, hfa);
  const pSeason = predictPointDiff(homeState, awayState, false);
  const pRecent = predictPointDiff(homeState, awayState, true);
  const games = Math.min(homeState.games, awayState.games);
  const recentW = games >= 20 ? 0.15 : games >= 11 ? 0.22 : games >= 6 ? 0.28 : 0.18;
  const seasonW = games >= 20 ? 0.25 : games >= 11 ? 0.22 : 0.18;
  const eloW = 1 - recentW - seasonW;
  let logit =
    eloW * Math.log(pElo / (1 - pElo)) +
    seasonW * Math.log(pSeason / (1 - pSeason)) +
    recentW * Math.log(pRecent / (1 - pRecent)) +
    homeIntercept * 0.35;
  if (extras.restHome != null && extras.restAway != null) {
    const restGap = Math.max(-3, Math.min(3, extras.restHome - extras.restAway));
    if (Math.abs(restGap) >= 2) logit += restGap * 0.03;
  }
  const pair = normalizePair(logistic(logit));
  return {
    ...pair,
    components: { pElo, pSeason, pRecent, eloW, seasonW, recentW },
    modelVersion: WNBA_WINNER_MODEL_VERSION,
  };
}

export function applyResult(state, scored, allowed, date) {
  const next = {
    ...state,
    recentPd: [...state.recentPd],
  };
  const margin = scored - allowed;
  const expected = 1 / (1 + 10 ** (-0 / 400));
  void expected;
  const win = scored > allowed;
  const mov = Math.log(1 + Math.abs(margin));
  next.elo = state.elo + K * mov * (win ? 1 : -1) * 0.35;
  next.games += 1;
  next.pd += margin;
  if (win) next.wins += 1;
  else next.losses += 1;
  next.recentPd.push(margin);
  if (next.recentPd.length > 10) next.recentPd.shift();
  next.lastDate = date;
  return next;
}

export function walkForward(games = [], options = {}) {
  const hfa = options.homeCourt || fitHomeCourt(games);
  const states = new Map();
  const get = (id) => states.get(id) || emptyTeamState();
  const rows = [];
  for (const g of games) {
    const homeId = normalizeWnbaTeam(g.homeTeam);
    const awayId = normalizeWnbaTeam(g.awayTeam);
    if (!homeId || !awayId || g.homeScore == null || g.awayScore == null) continue;
    const hs = get(homeId);
    const as = get(awayId);
    const restHome = restDays(hs.lastDate, g.date);
    const restAway = restDays(as.lastDate, g.date);
    const pHomeAlways = 0.5 + (hfa.homeWinRate != null ? hfa.homeWinRate - 0.5 : 0.04);
    const pRecord = predictRecord(hs, as);
    const pPd = predictPointDiff(hs, as, false);
    const pRecent = predictPointDiff(hs, as, true);
    const pElo = predictElo(hs, as, hfa.hfaElo);
    const v1 = predictWinnerV1(hs, as, {
      hfaElo: hfa.hfaElo,
      homeIntercept: hfa.intercept,
      restHome,
      restAway,
    });
    const homeWon = g.homeScore > g.awayScore;
    rows.push({
      ...g,
      homeTeam: homeId,
      awayTeam: awayId,
      homeWon,
      pHomeAlways: clampProb(pHomeAlways),
      pRecord,
      pPd,
      pRecent,
      pElo,
      pV1: v1.pHome,
      restHome,
      restAway,
      sampleGames: Math.min(hs.games, as.games),
    });
    states.set(homeId, applyResult(hs, g.homeScore, g.awayScore, g.date));
    states.set(awayId, applyResult(as, g.awayScore, g.homeScore, g.date));
  }
  return { rows, homeCourt: hfa, states };
}

export function snapshotStates(states) {
  const out = {};
  for (const [id, st] of states.entries()) {
    out[id] = {
      elo: Number(st.elo.toFixed(1)),
      wins: st.wins,
      losses: st.losses,
      games: st.games,
      pd: st.pd,
      recentPd: st.recentPd.slice(-5),
      lastDate: st.lastDate,
    };
  }
  return out;
}
