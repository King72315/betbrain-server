import fetch from "node-fetch";
import { CONFIG } from "../config.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cleanTeamKey(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeTeamKey(team = "") {
  return cleanTeamKey(team);
}

function getOpponentPointsAllowed(teamRecord = {}) {
  const games = num(teamRecord.Games || teamRecord.GamesPlayed || 0);

  const oppPpg = num(
    teamRecord.OpponentPointsPerGame ||
      teamRecord.OpponentPPG ||
      teamRecord.PointsAllowedPerGame ||
      0
  );

  if (oppPpg > 0 && oppPpg < 140) return oppPpg;

  const oppPoints = num(
    teamRecord.OpponentPoints ||
      teamRecord.PointsAllowed ||
      teamRecord.OpponentScore ||
      0
  );

  if (oppPoints > 0 && games > 0) {
    return Number((oppPoints / games).toFixed(1));
  }

  return 0;
}

function getPace(teamRecord = {}) {
  return num(teamRecord.Pace || teamRecord.PossessionsPerGame || 0);
}

export function buildTeamStatsMap(teamStats = []) {
  const map = new Map();

  for (const team of teamStats) {
    const key = normalizeTeamKey(
      team.Team || team.Key || team.Name || team.rawTeam || ""
    );
    if (key) map.set(key, team);
  }

  return map;
}

export function computeDefenseScore({
  opponentTeam = "",
  teamStatsMap = null,
  league = "NBA",
} = {}) {
  const defaultResult = {
    defenseScore: 50,
    source: "default",
    opponentPPG: null,
    pace: null,
    reasons: ["Defense score defaulted — no team stats wired"],
  };

  if (league !== "NBA" || !teamStatsMap || !opponentTeam) {
    return defaultResult;
  }

  const key = normalizeTeamKey(opponentTeam);
  const teamRecord = teamStatsMap.get(key);

  if (!teamRecord) {
    return {
      ...defaultResult,
      reasons: [`No team season stats for opponent ${opponentTeam}`],
    };
  }

  const opponentPPG = getOpponentPointsAllowed(teamRecord);
  const pace = getPace(teamRecord);

  if (opponentPPG <= 0) {
    return {
      ...defaultResult,
      reasons: ["Team stats found but points-allowed unavailable"],
    };
  }

  const leagueAvg = 114;
  let defenseScore = clamp(
    Math.round(50 + (opponentPPG - leagueAvg) * 2.5),
    20,
    80
  );

  const reasons = [
    `Opponent allows ${opponentPPG.toFixed(1)} PPG (${opponentPPG >= leagueAvg ? "above" : "below"} league avg)`,
  ];

  if (pace >= 102) {
    defenseScore = clamp(defenseScore + 4, 20, 85);
    reasons.push(`Fast pace (${pace.toFixed(1)}) adds scoring environment support`);
  } else if (pace > 0 && pace <= 96) {
    defenseScore = clamp(defenseScore - 4, 15, 80);
    reasons.push(`Slow pace (${pace.toFixed(1)}) suppresses scoring environment`);
  }

  return {
    defenseScore,
    source: "team_season_stats",
    opponentPPG,
    pace: pace || null,
    reasons,
  };
}

function describeShape(value, depth = 0) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    const sample = value[0];
    return `array(len=${value.length}${sample ? `, item=${describeShape(sample, depth + 1)}` : ""})`;
  }
  if (typeof value !== "object") return typeof value;
  if (depth >= 2) return `object(keys=${Object.keys(value).length})`;
  const keys = Object.keys(value).slice(0, 12);
  const parts = keys.map((key) => `${key}:${describeShape(value[key], depth + 1)}`);
  return `object{${parts.join(", ")}}`;
}

function extractWnbaDefenseCandidate(record = {}) {
  const opponentPPG = getOpponentPointsAllowed(record);
  const pace = getPace(record);
  if (opponentPPG <= 0) return null;

  const leagueAvg = 82;
  const shadowDefenseScore = clamp(
    Math.round(50 + (opponentPPG - leagueAvg) * 2.2),
    20,
    80
  );

  return {
    shadowDefenseScore,
    opponentPPG,
    pace: pace || null,
    source: "wnba_shadow_probe",
  };
}

/**
 * Shadow-only probe of BDL/Odds/SportsData shapes for WNBA team defense.
 * Logs response shapes internally; returns sanitized summary (no API keys).
 */
export async function probeWnbaDefenseDataSources(opponentTeam = "") {
  const summary = {
    opponentTeam,
    bdl: { attempted: false, status: null, shape: null, matched: false },
    shadowDefenseScore: null,
    opponentPPG: null,
    pace: null,
    logSummary: "",
  };

  const key = normalizeTeamKey(opponentTeam);
  if (!key) {
    summary.logSummary = "WNBA defense probe skipped — no opponent team";
    return summary;
  }

  try {
    summary.bdl.attempted = true;
    const url = `https://api.balldontlie.io/wnba/v1/team_season_averages?season=2025`;
    const res = await fetch(url, {
      headers: CONFIG.BALLDONTLIE_KEY
        ? { Authorization: CONFIG.BALLDONTLIE_KEY }
        : {},
    });
    summary.bdl.status = res.status;

    if (res.ok) {
      const payload = await res.json();
      const rows = Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload)
          ? payload
          : [];
      summary.bdl.shape = describeShape(payload);

      const match =
        rows.find((row) => {
          const teamKey = normalizeTeamKey(
            row?.team?.full_name ||
              row?.team?.name ||
              row?.team?.abbreviation ||
              row?.Team ||
              row?.Name ||
              ""
          );
          return teamKey && (teamKey === key || teamKey.includes(key) || key.includes(teamKey));
        }) || null;

      if (match) {
        summary.bdl.matched = true;
        const candidate = extractWnbaDefenseCandidate(match);
        if (candidate) {
          summary.shadowDefenseScore = candidate.shadowDefenseScore;
          summary.opponentPPG = candidate.opponentPPG;
          summary.pace = candidate.pace;
        }
      }
    }
  } catch (err) {
    summary.bdl.shape = `error:${String(err.message || err)}`;
  }

  summary.logSummary = [
    `BDL WNBA team_season_averages status=${summary.bdl.status}`,
    `shape=${summary.bdl.shape || "n/a"}`,
    `matched=${summary.bdl.matched}`,
    summary.shadowDefenseScore
      ? `shadowDefenseScore=${summary.shadowDefenseScore} oppPPG=${summary.opponentPPG}`
      : "shadowDefenseScore=unavailable",
  ].join(" | ");

  console.log("WNBA DEFENSE SHADOW PROBE:", summary.logSummary);

  return summary;
}
