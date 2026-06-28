import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const BDL_BASE = "https://api.balldontlie.io/wnba/v1";
const CACHE_MS = 5 * 60 * 1000;

export const AVAILABILITY_SERVICE_VERSION = "wnba-availability-active-v1";

const FEED_MISSING_MESSAGE =
  "WNBA availability feed missing — uncertainty treated as risk";
const ACTIVE_NOT_LISTED_MESSAGE = "Active — not on injury report";

let injuryCache = {
  loadedAt: 0,
  rows: [],
  feedFetchOk: false,
  httpStatus: null,
  rowCount: 0,
  errorReason: null,
};

function clean(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function fullPlayerName(player = {}) {
  return `${player?.first_name || ""} ${player?.last_name || ""}`.trim();
}

export function classifyWnbaInjuryStatus(raw = "") {
  const status = String(raw || "").trim().toLowerCase();
  if (!status) return { level: "UNKNOWN", label: "Unknown" };

  if (
    status.includes("out") ||
    status.includes("inactive") ||
    status.includes("suspended") ||
    status.includes("injured reserve")
  ) {
    return { level: "OUT", label: raw };
  }

  if (status.includes("doubtful") || status.includes("limited")) {
    return { level: "LIMITED", label: raw };
  }

  if (
    status.includes("questionable") ||
    status.includes("game time") ||
    status.includes("gtd") ||
    status.includes("probable") ||
    status.includes("day-to-day") ||
    status.includes("day to day")
  ) {
    return { level: "QUESTIONABLE", label: raw };
  }

  if (status.includes("active") || status.includes("available")) {
    return { level: "ACTIVE", label: raw };
  }

  return { level: "UNKNOWN", label: raw };
}

function snapshotFeed(cache = injuryCache) {
  return {
    rows: cache.rows,
    feedFetchOk: cache.feedFetchOk,
    httpStatus: cache.httpStatus,
    rowCount: cache.rowCount,
    errorReason: cache.errorReason,
  };
}

async function fetchInjuryRowsFromApi({ playerIds = [], perPage = 100 } = {}) {
  const params = new URLSearchParams();
  params.set("per_page", String(perPage));
  for (const id of playerIds) {
    if (id) params.append("player_ids[]", String(id));
  }

  const url = `${BDL_BASE}/player_injuries?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: CONFIG.BALLDONTLIE_KEY },
  });

  if (!res.ok) {
    return {
      rows: [],
      feedFetchOk: false,
      httpStatus: res.status,
      rowCount: 0,
      errorReason: `http_${res.status}`,
    };
  }

  const payload = await res.json();
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return {
    rows,
    feedFetchOk: true,
    httpStatus: res.status,
    rowCount: rows.length,
    errorReason: null,
  };
}

export async function fetchWnbaInjuryFeed({ playerId = "" } = {}) {
  if (!CONFIG.BALLDONTLIE_KEY) {
    return {
      rows: [],
      feedFetchOk: false,
      httpStatus: null,
      rowCount: 0,
      errorReason: "missing_api_key",
    };
  }

  const now = Date.now();
  const cacheFresh =
    now - injuryCache.loadedAt < CACHE_MS && injuryCache.feedFetchOk;

  if (playerId) {
    try {
      const targeted = await fetchInjuryRowsFromApi({
        playerIds: [playerId],
        perPage: 25,
      });
      if (targeted.feedFetchOk) {
        return targeted;
      }
      if (cacheFresh) {
        return snapshotFeed();
      }
    } catch (err) {
      if (cacheFresh) {
        return snapshotFeed();
      }
      return {
        rows: injuryCache.rows,
        feedFetchOk: false,
        httpStatus: injuryCache.httpStatus,
        rowCount: injuryCache.rowCount,
        errorReason: String(err?.message || err || "network_error"),
      };
    }
  }

  if (cacheFresh) {
    return snapshotFeed();
  }

  try {
    const feed = await fetchInjuryRowsFromApi({ perPage: 100 });
    if (feed.feedFetchOk) {
      injuryCache = { loadedAt: now, ...feed };
    }
    return feed;
  } catch (err) {
    if (injuryCache.feedFetchOk && injuryCache.rows.length) {
      return snapshotFeed();
    }
    return {
      rows: [],
      feedFetchOk: false,
      httpStatus: null,
      rowCount: 0,
      errorReason: String(err?.message || err || "network_error"),
    };
  }
}

export function resetWnbaInjuryCacheForTests() {
  injuryCache = {
    loadedAt: 0,
    rows: [],
    feedFetchOk: false,
    httpStatus: null,
    rowCount: 0,
    errorReason: null,
  };
}

function matchInjuryRow(rows = [], { playerId = "", playerName = "" } = {}) {
  const id = String(playerId || "");
  const nameKey = clean(playerName);

  return (
    rows.find((row) => {
      const rowId = String(row?.player?.id || row?.player_id || "");
      if (id && rowId && rowId === id) return true;
      const rowName = clean(fullPlayerName(row?.player || {}));
      return nameKey && rowName && rowName === nameKey;
    }) || null
  );
}

function buildFeedUnavailableResult(feed = {}) {
  return {
    applicable: true,
    status: "unknown",
    statusLevel: "UNKNOWN",
    statusLabel: "Unknown",
    availabilityStatus: "UNKNOWN",
    availabilityDataMissing: true,
    availabilityRisk: true,
    availabilitySourceStatus: "SOURCE_UNAVAILABLE",
    availabilityMessage: FEED_MISSING_MESSAGE,
    feedFetchOk: false,
    feedHttpStatus: feed.httpStatus ?? null,
    feedRowCount: feed.rowCount ?? 0,
    feedErrorReason: feed.errorReason ?? null,
    dangerPressure: 0.08,
    dangerReasons: ["WNBA injury feed unavailable — uncertainty treated as risk"],
    noPlay: false,
    noPlayReasons: [],
    blocksOfficial: false,
    officialCapTier: null,
    injuryRow: null,
    source: AVAILABILITY_SERVICE_VERSION,
  };
}

function buildActiveNotListedResult(feed = {}) {
  return {
    applicable: true,
    status: "active",
    statusLevel: "ACTIVE",
    statusLabel: "Active",
    availabilityStatus: "ACTIVE",
    availabilityDataMissing: false,
    availabilityRisk: false,
    availabilitySourceStatus: "OK",
    availabilityMessage: ACTIVE_NOT_LISTED_MESSAGE,
    feedFetchOk: true,
    feedHttpStatus: feed.httpStatus ?? null,
    feedRowCount: feed.rowCount ?? 0,
    feedErrorReason: null,
    dangerPressure: 0,
    dangerReasons: [],
    noPlay: false,
    noPlayReasons: [],
    blocksOfficial: false,
    officialCapTier: null,
    injuryRow: null,
    source: AVAILABILITY_SERVICE_VERSION,
  };
}

export function buildWnbaAvailabilityEvaluation({
  feed = {},
  playerId = "",
  playerName = "",
  league = "WNBA",
} = {}) {
  if (String(league).toUpperCase() !== "WNBA") {
    return {
      applicable: false,
      status: "N/A",
      statusLevel: "N/A",
      dangerPressure: 0,
      dangerReasons: [],
      noPlay: false,
      noPlayReasons: [],
      source: AVAILABILITY_SERVICE_VERSION,
    };
  }

  if (!feed.feedFetchOk) {
    return buildFeedUnavailableResult(feed);
  }

  const injury = matchInjuryRow(feed.rows || [], { playerId, playerName });
  const rawStatus =
    injury?.status ||
    injury?.injury_status ||
    injury?.comment ||
    injury?.description ||
    "";

  if (!injury && !rawStatus) {
    return buildActiveNotListedResult(feed);
  }

  const { level, label } = classifyWnbaInjuryStatus(rawStatus);

  const dangerReasons = [];
  const noPlayReasons = [];
  let dangerPressure = 0;
  let noPlay = false;
  let blocksOfficial = false;
  let officialCapTier = null;
  let availabilityDataMissing = false;
  let availabilityRisk = false;

  if (level === "OUT" || level === "LIMITED") {
    availabilityRisk = true;
    dangerReasons.push(`WNBA injury: ${label || "out/inactive/limited/doubtful"}`);
    dangerPressure = level === "OUT" ? 0.55 : 0.35;
    noPlay = level === "OUT";
    blocksOfficial = true;
    if (noPlay) {
      noPlayReasons.push("Player unavailable (BDL injury OUT/INACTIVE)");
    } else {
      noPlayReasons.push("Player limited/doubtful — official blocked");
    }
  } else if (level === "QUESTIONABLE") {
    availabilityRisk = true;
    dangerReasons.push(`WNBA questionable: ${label}`);
    dangerPressure = 0.2;
    officialCapTier = "WATCHLIST";
    blocksOfficial = true;
  } else if (level === "UNKNOWN") {
    availabilityRisk = true;
    dangerReasons.push(`WNBA unclear availability: ${label || "unknown status"}`);
    dangerPressure = 0.08;
  }

  return {
    applicable: true,
    status: rawStatus || "unknown",
    statusLevel: level,
    statusLabel: label,
    availabilityStatus: level,
    availabilityDataMissing,
    availabilityRisk,
    availabilitySourceStatus: availabilityDataMissing ? "SOURCE_UNAVAILABLE" : "OK",
    availabilityMessage: availabilityDataMissing ? FEED_MISSING_MESSAGE : "",
    feedFetchOk: true,
    feedHttpStatus: feed.httpStatus ?? null,
    feedRowCount: feed.rowCount ?? (feed.rows || []).length,
    feedErrorReason: null,
    dangerPressure,
    dangerReasons,
    noPlay,
    noPlayReasons,
    blocksOfficial,
    officialCapTier,
    injuryRow: injury
      ? {
          playerId: injury?.player?.id || injury?.player_id || null,
          status: rawStatus,
        }
      : null,
    source: AVAILABILITY_SERVICE_VERSION,
  };
}

export async function evaluateWnbaAvailability({
  playerId = "",
  playerName = "",
  league = "WNBA",
} = {}) {
  const feed = await fetchWnbaInjuryFeed({ playerId });
  return buildWnbaAvailabilityEvaluation({
    feed,
    playerId,
    playerName,
    league,
  });
}
