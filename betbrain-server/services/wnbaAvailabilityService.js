import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const BDL_BASE = "https://api.balldontlie.io/wnba/v1";
const CACHE_MS = 5 * 60 * 1000;

let injuryCache = { loadedAt: 0, rows: [] };

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
    status.includes("probable")
  ) {
    return { level: "QUESTIONABLE", label: raw };
  }

  if (status.includes("active") || status.includes("available")) {
    return { level: "ACTIVE", label: raw };
  }

  return { level: "UNKNOWN", label: raw };
}

async function fetchInjuryRows() {
  if (!CONFIG.BALLDONTLIE_KEY) return [];

  const now = Date.now();
  if (now - injuryCache.loadedAt < CACHE_MS && injuryCache.rows.length) {
    return injuryCache.rows;
  }

  try {
    const url = `${BDL_BASE}/player_injuries?per_page=100`;
    const res = await fetch(url, {
      headers: { Authorization: CONFIG.BALLDONTLIE_KEY },
    });
    if (!res.ok) return injuryCache.rows;

    const payload = await res.json();
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    injuryCache = { loadedAt: now, rows };
    return rows;
  } catch {
    return injuryCache.rows;
  }
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

export async function evaluateWnbaAvailability({
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
      source: "wnba-availability-v1",
    };
  }

  const rows = await fetchInjuryRows();
  const injury = matchInjuryRow(rows, { playerId, playerName });
  const rawStatus =
    injury?.status ||
    injury?.injury_status ||
    injury?.comment ||
    injury?.description ||
    "";
  const { level, label } = classifyWnbaInjuryStatus(rawStatus);

  const dangerReasons = [];
  const noPlayReasons = [];
  let dangerPressure = 0;
  let noPlay = false;
  let blocksOfficial = false;
  let officialCapTier = null;
  let availabilityDataMissing = false;
  let availabilityRisk = false;

  if (!injury && !rawStatus) {
    return {
      applicable: true,
      status: "unknown",
      statusLevel: "UNKNOWN",
      statusLabel: "Unknown",
      availabilityStatus: "UNKNOWN",
      availabilityDataMissing: true,
      availabilityRisk: false,
      dangerPressure: 0,
      dangerReasons: [],
      noPlay: false,
      noPlayReasons: [],
      blocksOfficial: false,
      officialCapTier: null,
      injuryRow: null,
      source: "wnba-availability-v1",
    };
  }

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
    availabilityDataMissing = true;
    availabilityRisk = false;
  }

  return {
    applicable: true,
    status: rawStatus || "unknown",
    statusLevel: level,
    statusLabel: label,
    availabilityStatus: level,
    availabilityDataMissing,
    availabilityRisk,
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
    source: "wnba-availability-v1",
  };
}
