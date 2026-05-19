import fetch from "node-fetch";
import { CONFIG } from "../config.js";

const SPORTS_BASE = "https://api.sportsdata.io/api/nba";
const API_KEY = CONFIG.SPORTS_KEY;

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function formatDate(date = new Date()) {
  return new Date(date).toISOString().split("T")[0];
}

export async function fetchFinalPlayerStats(date = new Date()) {
  if (!API_KEY) {
    console.log("RESULT SERVICE: SPORTS_KEY missing");
    return [];
  }

  try {
    const formattedDate = formatDate(date);

    const url =
      `${SPORTS_BASE}/stats/json/PlayerGameStatsByDate/${formattedDate}` +
      `?key=${API_KEY}`;

    const res = await fetch(url);
    const data = await res.json();

    if (!res.ok) {
      console.log("FINAL PLAYER STATS ERROR:", res.status);
      return [];
    }

    return Array.isArray(data) ? data : [];
  } catch (err) {
    console.log("FETCH FINAL PLAYER STATS ERROR:", err.message);
    return [];
  }
}

export function findPlayerResult(savedPick, playerStats = []) {
  const targetPlayer = clean(savedPick.player);
  const targetTeam = clean(savedPick.team);

  return (
    playerStats.find((stat) => {
      const playerName = clean(
        stat.Name ||
          stat.PlayerName ||
          stat.FullName ||
          ""
      );

      const team = clean(stat.Team || "");

      return (
        playerName === targetPlayer &&
        (!targetTeam || team === targetTeam)
      );
    }) || null
  );
}

export function gradePointsPick(savedPick, statResult) {
  if (!statResult) return null;

  const actualPoints = Number(statResult.Points || 0);
  const line = Number(savedPick.line || 0);
  const side = savedPick.pick || savedPick.side;

  const push = actualPoints === line;

  const hit =
    side === "Over"
      ? actualPoints > line
      : actualPoints < line;

  return {
    ...savedPick,
    actualPoints,
    status: push ? "push" : hit ? "win" : "loss",
    gradedAt: new Date().toISOString(),
  };
}