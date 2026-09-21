/**
 * Winner research candidates. Production Winner V1 is not replaced.
 * Point differential remains the baseline that candidates must beat.
 */
import { clampProb, logistic, normalizePair } from "../winnersV1/constants.js";
import { emptyTeamState, fitHomeCourt, predictElo, predictPointDiff, predictWinnerV1 } from "../winnersV1/winnerModelV1.js";
import { normalizeWnbaTeamExact } from "./teamIdentityV1.js";

export const WINNER_CANDIDATE_BUILD = "courteedge-winner-candidates-v1";

const START_ELO = 1500;
const K = 18;

function avg(xs = []) {
  const n = xs.filter((x) => Number.isFinite(x));
  if (!n.length) return 0;
  return n.reduce((s, x) => s + x, 0) / n.length;
}

function restDays(prev, next) {
  if (!prev || !next) return null;
  const a = new Date(`${prev}T12:00:00-05:00`).getTime();
  const b = new Date(`${next}T12:00:00-05:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

function emptyPlus() {
  return {
    ...emptyTeamState(),
    pf: 0,
    pa: 0,
  };
}

function applyV1(state, scored, allowed, date) {
  const next = { ...state, recentPd: [...state.recentPd] };
  const margin = scored - allowed;
  const win = scored > allowed;
  const mov = Math.log(1 + Math.abs(margin));
  next.elo = state.elo + K * mov * (win ? 1 : -1) * 0.35;
  next.games += 1;
  next.pd += margin;
  next.pf += scored;
  next.pa += allowed;
  if (win) next.wins += 1;
  else next.losses += 1;
  next.recentPd.push(margin);
  if (next.recentPd.length > 10) next.recentPd.shift();
  next.lastDate = date;
  return next;
}

/** Opponent-adjusted Elo — standard expected-score update. */
function applyFixedElo(state, scored, allowed, oppElo, date) {
  const next = { ...state, recentPd: [...state.recentPd] };
  const margin = scored - allowed;
  const win = scored > allowed ? 1 : 0;
  const expected = 1 / (1 + 10 ** (-((state.elo - oppElo) / 400)));
  const mov = Math.log(1 + Math.abs(margin));
  next.elo = state.elo + K * (win - expected) * (1 + 0.2 * mov);
  next.games += 1;
  next.pd += margin;
  next.pf += scored;
  next.pa += allowed;
  if (win) next.wins += 1;
  else next.losses += 1;
  next.recentPd.push(margin);
  if (next.recentPd.length > 10) next.recentPd.shift();
  next.lastDate = date;
  return next;
}

function pythag(pf, pa, games, exp = 10.25) {
  if (!games || pf <= 0 || pa <= 0) return 0.5;
  const a = (pf / games) ** exp;
  const b = (pa / games) ** exp;
  return clampProb(a / (a + b));
}

export function predictWinnerA(homeState, awayState, extras = {}) {
  const intercept = extras.homeIntercept ?? 0.08;
  const h = homeState.games ? homeState.pd / homeState.games : 0;
  const a = awayState.games ? awayState.pd / awayState.games : 0;
  const p = clampProb(logistic((h - a) / 12 + intercept * 0.35));
  return { ...normalizePair(p), components: { kind: "PD_HOME" } };
}

export function predictWinnerB(homeState, awayState, extras = {}) {
  const intercept = extras.homeIntercept ?? 0.08;
  const pSeason = pythag(homeState.pf, homeState.pa, homeState.games);
  const pAway = pythag(awayState.pf, awayState.pa, awayState.games);
  const pRecent = predictPointDiff(homeState, awayState, true);
  const seasonLogit = Math.log(pSeason / (1 - pSeason)) - Math.log(pAway / (1 - pAway));
  const recentLogit = Math.log(pRecent / (1 - pRecent));
  const logit = 0.62 * seasonLogit + 0.38 * recentLogit + intercept * 0.35;
  return { ...normalizePair(logistic(logit)), components: { pSeason, pAway, pRecent, kind: "PYTHAG_RECENT_HOME" } };
}

export function predictWinnerC(homeState, awayState, extras = {}) {
  const hfa = extras.hfaElo ?? 40;
  const intercept = extras.homeIntercept ?? 0.08;
  const pElo = predictElo(homeState, awayState, hfa);
  const pSeason = predictPointDiff(homeState, awayState, false);
  const pRecent = predictPointDiff(homeState, awayState, true);
  const eloW = 0.28;
  const seasonW = 0.47;
  const recentW = 0.25;
  let logit =
    eloW * Math.log(pElo / (1 - pElo)) +
    seasonW * Math.log(pSeason / (1 - pSeason)) +
    recentW * Math.log(pRecent / (1 - pRecent)) +
    intercept * 0.35;
  if (extras.restHome != null && extras.restAway != null) {
    const restGap = Math.max(-3, Math.min(3, extras.restHome - extras.restAway));
    if (Math.abs(restGap) >= 2) logit += restGap * 0.03;
  }
  const temperature = extras.temperature ?? 1.45;
  const pair = normalizePair(logistic(logit / temperature));
  return {
    ...pair,
    components: { pElo, pSeason, pRecent, eloW, seasonW, recentW, temperature, kind: "FIXED_ELO_PD_CALIBRATED" },
  };
}

export function applyTemperature(p, temperature) {
  if (!Number.isFinite(p) || p <= 0 || p >= 1) return 0.5;
  const logit = Math.log(p / (1 - p));
  return clampProb(logistic(logit / (temperature || 1)));
}

export function walkForwardCandidates(games = [], options = {}) {
  const hfa = options.homeCourt || fitHomeCourt(games);
  const statesV1 = new Map();
  const statesC = new Map();
  const get = (map, id) => map.get(id) || emptyPlus();
  const rows = [];
  let contaminated = 0;
  for (const g of games) {
    const homeRes = normalizeWnbaTeamExact(g.homeTeam);
    const awayRes = normalizeWnbaTeamExact(g.awayTeam);
    const flags = [...homeRes.flags, ...awayRes.flags];
    if (flags.length) contaminated += 1;
    const homeId = homeRes.id;
    const awayId = awayRes.id;
    if (!homeId || !awayId || g.homeScore == null || g.awayScore == null) continue;
    const hs = get(statesV1, homeId);
    const as = get(statesV1, awayId);
    const hc = get(statesC, homeId);
    const ac = get(statesC, awayId);
    const restHome = restDays(hs.lastDate, g.date);
    const restAway = restDays(as.lastDate, g.date);
    const extras = { hfaElo: hfa.hfaElo, homeIntercept: hfa.intercept, restHome, restAway, temperature: options.temperature ?? 1.45 };
    const v1 = predictWinnerV1(hs, as, extras);
    const a = predictWinnerA(hs, as, extras);
    const b = predictWinnerB(hs, as, extras);
    const c = predictWinnerC(hc, ac, extras);
    const pPd = predictPointDiff(hs, as, false);
    const pElo = predictElo(hs, as, hfa.hfaElo);
    const homeWon = g.homeScore > g.awayScore;
    rows.push({
      ...g,
      homeTeam: homeId,
      awayTeam: awayId,
      homeWon,
      identityFlags: flags,
      pV1: v1.pHome,
      pA: a.pHome,
      pB: b.pHome,
      pC: c.pHome,
      pPd,
      pElo,
      restHome,
      restAway,
      sampleGames: Math.min(hs.games, as.games),
    });
    statesV1.set(homeId, applyV1(hs, g.homeScore, g.awayScore, g.date));
    statesV1.set(awayId, applyV1(as, g.awayScore, g.homeScore, g.date));
    statesC.set(homeId, applyFixedElo(hc, g.homeScore, g.awayScore, ac.elo, g.date));
    statesC.set(awayId, applyFixedElo(ac, g.awayScore, g.homeScore, hc.elo, g.date));
  }
  return { rows, homeCourt: hfa, contaminated, build: WINNER_CANDIDATE_BUILD };
}
