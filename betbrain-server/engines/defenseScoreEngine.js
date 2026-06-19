import { clean } from "../services/sportsDataService.js";

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeTeamKey(team = "") {
  return clean(String(team || ""));
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
