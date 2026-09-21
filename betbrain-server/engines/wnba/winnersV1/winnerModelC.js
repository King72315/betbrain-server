/**
 * Winner-C production model. Coefficients are locked to the validated research candidate.
 * Sportsbook market is never an input.
 */
import { clampProb, logistic, normalizePair, normalizeWnbaTeam } from "./constants.js";
import {
  emptyTeamState,
  fitHomeCourt,
  predictElo,
  predictPointDiff,
  predictWinnerV1,
} from "./winnerModelV1.js";
import { COURTEDGE_WINNER_C_PRODUCTION_V1 } from "../../courtEdgeEraV1.js";

export const WNBA_WINNER_C_MODEL_VERSION = COURTEDGE_WINNER_C_PRODUCTION_V1;
export const WINNER_C_ELO_W = 0.28;
export const WINNER_C_SEASON_W = 0.47;
export const WINNER_C_RECENT_W = 0.25;
export const WINNER_C_TEMPERATURE = 1.45;
export const WINNER_C_HOME_INTERCEPT_SCALE = 0.35;
const K = 18;

function restDays(prev, next) {
  if (!prev || !next) return null;
  const a = new Date(`${prev}T12:00:00-05:00`).getTime();
  const b = new Date(`${next}T12:00:00-05:00`).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86400000);
}

export function emptyWinnerCState() {
  return {
    ...emptyTeamState(),
    pf: 0,
    pa: 0,
  };
}

export function applyWinnerCResult(state, scored, allowed, oppElo, date) {
  const next = { ...state, recentPd: [...(state.recentPd || [])] };
  const margin = scored - allowed;
  const win = scored > allowed ? 1 : 0;
  const expected = 1 / (1 + 10 ** (-((state.elo - oppElo) / 400)));
  const mov = Math.log(1 + Math.abs(margin));
  next.elo = state.elo + K * (win - expected) * (1 + 0.2 * mov);
  next.games += 1;
  next.pd += margin;
  next.pf = (state.pf || 0) + scored;
  next.pa = (state.pa || 0) + allowed;
  if (win) next.wins += 1;
  else next.losses += 1;
  next.recentPd.push(margin);
  if (next.recentPd.length > 10) next.recentPd.shift();
  next.lastDate = date;
  return next;
}

export function predictWinnerC(homeState, awayState, extras = {}) {
  const hfa = extras.hfaElo ?? 40;
  const intercept = extras.homeIntercept ?? 0.08;
  const pElo = predictElo(homeState, awayState, hfa);
  const pSeason = predictPointDiff(homeState, awayState, false);
  const pRecent = predictPointDiff(homeState, awayState, true);
  let logit =
    WINNER_C_ELO_W * Math.log(pElo / (1 - pElo)) +
    WINNER_C_SEASON_W * Math.log(pSeason / (1 - pSeason)) +
    WINNER_C_RECENT_W * Math.log(pRecent / (1 - pRecent)) +
    intercept * WINNER_C_HOME_INTERCEPT_SCALE;
  if (extras.restHome != null && extras.restAway != null) {
    const restGap = Math.max(-3, Math.min(3, extras.restHome - extras.restAway));
    if (Math.abs(restGap) >= 2) logit += restGap * 0.03;
  }
  const temperature = extras.temperature ?? WINNER_C_TEMPERATURE;
  const pair = normalizePair(logistic(logit / temperature));
  return {
    ...pair,
    components: {
      pElo,
      pSeason,
      pRecent,
      eloW: WINNER_C_ELO_W,
      seasonW: WINNER_C_SEASON_W,
      recentW: WINNER_C_RECENT_W,
      temperature,
      homeIntercept: intercept,
      kind: "FIXED_ELO_PD_CALIBRATED",
    },
    modelVersion: WNBA_WINNER_C_MODEL_VERSION,
  };
}

export function walkForwardC(games = [], options = {}) {
  const hfa = options.homeCourt || fitHomeCourt(games);
  const states = new Map();
  const get = (id) => states.get(id) || emptyWinnerCState();
  const rows = [];
  for (const g of games) {
    const homeId = normalizeWnbaTeam(g.homeTeam || g.homeName);
    const awayId = normalizeWnbaTeam(g.awayTeam || g.awayName);
    if (!homeId || !awayId || g.homeScore == null || g.awayScore == null) continue;
    const hs = get(homeId);
    const as = get(awayId);
    const restHome = restDays(hs.lastDate, g.date);
    const restAway = restDays(as.lastDate, g.date);
    const extras = {
      hfaElo: hfa.hfaElo,
      homeIntercept: hfa.intercept,
      restHome,
      restAway,
      temperature: WINNER_C_TEMPERATURE,
    };
    const c = predictWinnerC(hs, as, extras);
    const v1 = predictWinnerV1(hs, as, extras);
    const pPd = predictPointDiff(hs, as, false);
    const homeWon = g.homeScore > g.awayScore;
    rows.push({
      ...g,
      homeTeam: homeId,
      awayTeam: awayId,
      homeWon,
      pC: c.pHome,
      pV1: v1.pHome,
      pPd,
      components: c.components,
      restHome,
      restAway,
    });
    states.set(homeId, applyWinnerCResult(hs, g.homeScore, g.awayScore, as.elo, g.date));
    states.set(awayId, applyWinnerCResult(as, g.awayScore, g.homeScore, hs.elo, g.date));
  }
  return { rows, homeCourt: hfa, states, modelVersion: WNBA_WINNER_C_MODEL_VERSION };
}
