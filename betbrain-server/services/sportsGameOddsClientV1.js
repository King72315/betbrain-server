/**
 * SportsGameOdds v2 client for CourtEdge.
 * Auth: x-api-key (proven TennisEdge / research convention).
 * Never logs key values. CourtEdge does not crash if SGO is down.
 */
import https from "https";
import { CONFIG } from "../config.js";

export const SGO_CLIENT_VERSION = "courtedge-sgo-client-v1";
export const SGO_API_BASE = "https://api.sportsgameodds.com/v2";

export const SGO_STATES = Object.freeze({
  HEALTHY: "HEALTHY",
  NOT_CONFIGURED: "NOT_CONFIGURED",
  UNREACHABLE_FROM_CURRENT_NETWORK: "UNREACHABLE_FROM_CURRENT_NETWORK",
  AUTH_REJECTED: "AUTH_REJECTED",
  RATE_LIMITED: "RATE_LIMITED",
  NO_WNBA_DATA: "NO_WNBA_DATA",
  PROVIDER_ERROR: "PROVIDER_ERROR",
});

const CACHE = new Map();
const counters = {
  requests: 0,
  retries: 0,
  cacheHits: 0,
  lastStatus: null,
  lastState: SGO_STATES.NOT_CONFIGURED,
};

export function resolveSportsGameOddsKey(env = process.env) {
  const raw =
    env.SPORTSGAMEODDS_KEY ||
    env.SGO_KEY ||
    env.TENNIS_SPORTSGAMEODDS_KEY ||
    "";
  return String(raw || "").trim();
}

export function isSgoConfigured(env = process.env) {
  return Boolean(resolveSportsGameOddsKey(env) || CONFIG.SPORTSGAMEODDS_KEY);
}

export function classifySgoError({ status = null, errorCode = null, errorMessage = "" } = {}) {
  const code = String(errorCode || "").toUpperCase();
  const msg = String(errorMessage || "").toUpperCase();
  if (status === 401 || status === 403) return SGO_STATES.AUTH_REJECTED;
  if (status === 429) return SGO_STATES.RATE_LIMITED;
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ENOTFOUND" ||
    code === "ECONNREFUSED" ||
    code === "TIMEOUT" ||
    msg.includes("ECONNRESET") ||
    msg.includes("FETCH FAILED")
  ) {
    return SGO_STATES.UNREACHABLE_FROM_CURRENT_NETWORK;
  }
  if (status == null) return SGO_STATES.UNREACHABLE_FROM_CURRENT_NETWORK;
  if (status >= 500) return SGO_STATES.PROVIDER_ERROR;
  return SGO_STATES.PROVIDER_ERROR;
}

function cacheKey(pathname) {
  return String(pathname || "");
}

function getJson(url, { headers = {}, timeoutMs = 20000 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const req = https.get(
      url,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "CourtEdge-SGO-Client-V1",
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = text ? JSON.parse(text) : null;
          } catch {
            json = null;
          }
          resolve({
            status: res.statusCode,
            ms: Date.now() - started,
            json,
            errorCode: null,
          });
        });
      }
    );
    req.on("error", (err) =>
      resolve({
        status: null,
        ms: Date.now() - started,
        json: null,
        errorCode: err.code || "NETWORK",
        errorMessage: err.message,
      })
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({
        status: null,
        ms: Date.now() - started,
        json: null,
        errorCode: "TIMEOUT",
        errorMessage: "TIMEOUT",
      });
    });
  });
}

function rowsOf(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.data)) return json.data;
  if (json?.data && typeof json.data === "object") return Object.values(json.data);
  return [];
}

export async function sgoGet(pathname, options = {}) {
  const key = resolveSportsGameOddsKey(options.env) || CONFIG.SPORTSGAMEODDS_KEY;
  if (!key) {
    counters.lastState = SGO_STATES.NOT_CONFIGURED;
    return {
      ok: false,
      state: SGO_STATES.NOT_CONFIGURED,
      status: null,
      data: [],
      configured: false,
    };
  }

  const cacheMs = options.cacheMs ?? 60_000;
  const ck = cacheKey(pathname);
  const hit = CACHE.get(ck);
  if (hit && Date.now() - hit.at < cacheMs) {
    counters.cacheHits += 1;
    return { ...hit.value, cacheHit: true };
  }

  const url = `${SGO_API_BASE}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  let last = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt) {
      counters.retries += 1;
      await new Promise((r) => setTimeout(r, 250 * 2 ** attempt));
    }
    counters.requests += 1;
    last = await getJson(url, { headers: { "x-api-key": key } });
    counters.lastStatus = last.status;
    if (last.status >= 200 && last.status < 300) break;
    if (last.status === 401 || last.status === 403 || last.status === 429) break;
    if (last.status != null && last.status < 500 && last.status !== null) break;
  }

  if (last.status >= 200 && last.status < 300) {
    const data = rowsOf(last.json);
    const state = data.length ? SGO_STATES.HEALTHY : SGO_STATES.NO_WNBA_DATA;
    counters.lastState = state;
    const value = {
      ok: true,
      state,
      status: last.status,
      data,
      configured: true,
      ms: last.ms,
    };
    CACHE.set(ck, { at: Date.now(), value });
    return value;
  }

  const state = classifySgoError(last);
  counters.lastState = state;
  return {
    ok: false,
    state,
    status: last.status,
    data: [],
    configured: true,
    ms: last.ms,
    errorCode: last.errorCode || null,
  };
}

export function getSgoHealth() {
  return {
    version: SGO_CLIENT_VERSION,
    configured: isSgoConfigured(),
    state: isSgoConfigured() ? counters.lastState : SGO_STATES.NOT_CONFIGURED,
    lastStatus: counters.lastStatus,
    requests: counters.requests,
    retries: counters.retries,
    cacheHits: counters.cacheHits,
  };
}

export function inspectSgoWnbaCapabilities(events = []) {
  const fields = {
    events: events.length,
    startTimes: 0,
    homeAway: 0,
    moneyline: 0,
    spread: 0,
    total: 0,
    fairOdds: 0,
    bookOdds: 0,
    bookNames: new Set(),
    timestamps: 0,
    finalScore: 0,
  };
  for (const ev of events) {
    if (ev?.status?.startsAt || ev?.startsAt) fields.startTimes += 1;
    if (ev?.teams?.home && ev?.teams?.away) fields.homeAway += 1;
    if (ev?.status?.startsAt || ev?.info?.startsAt) fields.timestamps += 1;
    const homeScore = ev?.teams?.home?.score ?? ev?.status?.homeScore;
    const awayScore = ev?.teams?.away?.score ?? ev?.status?.awayScore;
    if (homeScore != null && awayScore != null) fields.finalScore += 1;
    const odds = ev?.odds && typeof ev.odds === "object" ? ev.odds : {};
    for (const odd of Object.values(odds)) {
      const stat = String(odd?.statID || odd?.oddID || "").toLowerCase();
      if (odd?.fairOdds != null) fields.fairOdds += 1;
      if (odd?.bookOdds != null) fields.bookOdds += 1;
      if (/moneyline|ml_|_ml|win-/.test(stat)) fields.moneyline += 1;
      if (/spread|handicap/.test(stat)) fields.spread += 1;
      if (/total|overunder|ou-/.test(stat) && !/player/.test(stat)) fields.total += 1;
      const byBook = odd?.byBookmaker && typeof odd.byBookmaker === "object" ? odd.byBookmaker : {};
      for (const id of Object.keys(byBook)) fields.bookNames.add(id);
    }
  }
  return {
    ...fields,
    bookNames: [...fields.bookNames].sort(),
  };
}

export async function fetchSgoWnbaEvents({ startsAfter, startsBefore, limit = 25 } = {}) {
  const qs = new URLSearchParams({
    leagueID: "WNBA",
    oddsAvailable: "true",
    limit: String(limit),
  });
  if (startsAfter) qs.set("startsAfter", startsAfter);
  if (startsBefore) qs.set("startsBefore", startsBefore);
  return sgoGet(`/events?${qs.toString()}`);
}

export function resetSgoClientForTests() {
  CACHE.clear();
  counters.requests = 0;
  counters.retries = 0;
  counters.cacheHits = 0;
  counters.lastStatus = null;
  counters.lastState = SGO_STATES.NOT_CONFIGURED;
}
