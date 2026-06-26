/**
 * WNBA candidate data integrity audit — surfaces missing/weak/unavailable paths.
 */
import {
  resolveWnbaTeamId,
  teamsMatch,
  formatWnbaTeamDisplay,
  listWnbaTeamAliases,
} from "./wnbaTeamAliasResolver.js";
import { resolveStableWnbaPlayerId } from "./wnbaPlayerIdResolver.js";

export const DATA_INTEGRITY_VERSION = "wnba-data-integrity-v1";

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function issue({
  key,
  status,
  severity = "low",
  message = "",
  repairable = false,
  meta = {},
}) {
  return { key, status, severity, message, repairable, meta };
}

function deriveOverall(score = 0, issues = []) {
  const high = issues.filter((i) => i.severity === "high").length;
  const critical = issues.filter(
    (i) => i.status === "MISSING" && ["playerId", "seasonStats", "last5"].includes(i.key)
  ).length;

  if (score < 50 || high >= 2 || critical >= 2) return "BAD";
  if (score < 82 || issues.length > 0) return "PARTIAL";
  return "GOOD";
}

export function auditWnbaDataIntegrity(context = {}) {
  const {
    playerName = "",
    playerId = "",
    team = "",
    opponent = "",
    last5 = [],
    matchupGames = [],
    matchupAverage = null,
    seasonAverage = 0,
    availabilityGate = {},
    defenseResult = {},
    prop = {},
    playerState = {},
    ballPlayerResolved = false,
    stablePlayerIdUsed = false,
  } = context;

  const issues = [];
  const teamId = resolveWnbaTeamId(team);
  const opponentTeamId = resolveWnbaTeamId(opponent);
  const stableId = resolveStableWnbaPlayerId(playerName);
  const resolvedPlayerId = String(playerId || stableId || "");

  if (!resolvedPlayerId) {
    issues.push(
      issue({
        key: "playerId",
        status: ballPlayerResolved ? "LOOKUP_FAILED" : "MISSING",
        severity: "high",
        message: "No stable BallDontLie player id",
        repairable: Boolean(stableId),
        meta: { stableOverrideAvailable: Boolean(stableId) },
      })
    );
  } else {
    issues.push(
      issue({
        key: "playerId",
        status: "OK",
        severity: "low",
        message: stablePlayerIdUsed
          ? `Stable player id ${resolvedPlayerId}`
          : `Player id ${resolvedPlayerId}`,
        repairable: false,
        meta: { playerId: resolvedPlayerId, stablePlayerIdUsed },
      })
    );
  }

  if (!teamId) {
    issues.push(
      issue({
        key: "team",
        status: "LOOKUP_FAILED",
        severity: "medium",
        message: `Could not resolve team alias for ${team || "unknown"}`,
        repairable: true,
      })
    );
  }

  if (!opponentTeamId) {
    issues.push(
      issue({
        key: "opponent",
        status: "LOOKUP_FAILED",
        severity: "medium",
        message: `Could not resolve opponent alias for ${opponent || "unknown"}`,
        repairable: true,
      })
    );
  }

  const seasonPts = num(playerState.seasonPoints ?? seasonAverage);
  if (seasonPts <= 0) {
    issues.push(
      issue({
        key: "seasonStats",
        status: "MISSING",
        severity: "medium",
        message: "Missing season points",
        repairable: false,
      })
    );
  }

  if (last5.length < 3) {
    issues.push(
      issue({
        key: "last5",
        status: last5.length ? "WEAK" : "MISSING",
        severity: last5.length ? "low" : "medium",
        message: `Only ${last5.length} recent games`,
        repairable: false,
        meta: { games: last5.length },
      })
    );
  }

  const matchupCount = matchupGames.length;
  const hasMatchup = matchupCount > 0 || num(matchupAverage) > 0;
  if (!hasMatchup) {
    const aliasNote =
      teamId && opponentTeamId
        ? ` (${formatWnbaTeamDisplay(teamId)} vs ${formatWnbaTeamDisplay(opponentTeamId)})`
        : "";
    issues.push(
      issue({
        key: "matchup",
        status: opponentTeamId ? "MISSING" : "LOOKUP_FAILED",
        severity: "medium",
        message: `No opponent matchup history${aliasNote}`,
        repairable: Boolean(opponentTeamId),
        meta: {
          opponentTeamId,
          teamId,
          opponentAliases: listWnbaTeamAliases(opponent),
          lookupMethod: "teamId-bidirectional",
        },
      })
    );
  } else {
    issues.push(
      issue({
        key: "matchup",
        status: matchupCount >= 2 ? "OK" : "WEAK",
        severity: matchupCount >= 2 ? "low" : "low",
        message:
          matchupCount >= 2
            ? `${matchupCount} opponent games (${num(matchupAverage).toFixed(1)} avg)`
            : `Thin opponent sample (${matchupCount} game)`,
        repairable: false,
        meta: { gamesFound: matchupCount, average: num(matchupAverage) },
      })
    );
  }

  const availabilityMissing = Boolean(availabilityGate.availabilityDataMissing);
  const availabilityRisk = Boolean(availabilityGate.availabilityRisk);
  const availabilityStatus =
    availabilityGate.availabilitySourceStatus ||
    availabilityGate.sourceStatus ||
    (availabilityMissing ? "SOURCE_UNAVAILABLE" : "OK");

  if (availabilityMissing) {
    issues.push(
      issue({
        key: "availability",
        status: availabilityStatus,
        severity: "medium",
        message:
          availabilityGate.availabilityMessage ||
          "WNBA availability feed missing — uncertainty treated as risk",
        repairable: false,
        meta: {
          treatedAsRisk: availabilityRisk,
          statusLevel: availabilityGate.statusLevel || "UNKNOWN",
        },
      })
    );
  } else if (availabilityRisk) {
    issues.push(
      issue({
        key: "availability",
        status: availabilityGate.statusLevel || "RISK",
        severity: "high",
        message:
          availabilityGate.dangerReasons?.[0] ||
          "Availability risk flagged from injury feed",
        repairable: false,
      })
    );
  }

  if (num(defenseResult.defenseScore) <= 0 && !defenseResult.context) {
    issues.push(
      issue({
        key: "defense",
        status: "MISSING",
        severity: "low",
        message: "Opponent defense context missing",
        repairable: false,
      })
    );
  }

  if (num(prop.bookCount) <= 0) {
    issues.push(
      issue({
        key: "market",
        status: "MISSING",
        severity: "medium",
        message: "No book line data",
        repairable: false,
      })
    );
  }

  const weights = {
    playerId: 15,
    seasonStats: 15,
    last5: 20,
    matchup: 10,
    availability: 10,
    defense: 10,
    market: 10,
    team: 5,
    opponent: 5,
  };

  let score = 100;
  for (const item of issues) {
    if (item.status === "OK") continue;
    const w = weights[item.key] || 5;
    if (item.status === "MISSING" || item.status === "LOOKUP_FAILED") {
      score -= item.severity === "high" ? w : w * 0.6;
    } else if (item.status === "WEAK" || item.status === "SOURCE_UNAVAILABLE") {
      score -= w * 0.35;
    }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));

  const overall = deriveOverall(score, issues.filter((i) => i.status !== "OK"));

  return {
    version: DATA_INTEGRITY_VERSION,
    dataIntegrityVersion: DATA_INTEGRITY_VERSION,
    overall,
    score,
    player: {
      name: playerName,
      id: resolvedPlayerId || null,
      stableIdUsed: stablePlayerIdUsed,
      resolvedFrom: stablePlayerIdUsed
        ? "stable_override"
        : resolvedPlayerId
          ? "balldontlie"
          : "unresolved",
    },
    teams: {
      team: {
        raw: team,
        teamId: teamId || null,
        display: formatWnbaTeamDisplay(teamId || team),
        aliases: listWnbaTeamAliases(team),
      },
      opponent: {
        raw: opponent,
        teamId: opponentTeamId || null,
        display: formatWnbaTeamDisplay(opponentTeamId || opponent),
        aliases: listWnbaTeamAliases(opponent),
      },
      teamsMatchVerified: Boolean(teamId && opponentTeamId && !teamsMatch(teamId, opponentTeamId)),
    },
    matchup: {
      gamesFound: matchupCount,
      average: num(matchupAverage) || null,
      opponentTeamId: opponentTeamId || null,
      lookupMethod: "teamId-bidirectional",
    },
    availability: {
      status: availabilityGate.statusLevel || "UNKNOWN",
      sourceStatus: availabilityStatus,
      dataMissing: availabilityMissing,
      treatedAsRisk: availabilityRisk,
      message: availabilityMissing
        ? "Availability uncertainty increases risk"
        : availabilityRisk
          ? "Injury feed flagged risk"
          : "Feed present",
    },
    issues: issues.filter((i) => i.status !== "OK"),
    issueCount: issues.filter((i) => i.status !== "OK").length,
    auditAt: new Date().toISOString(),
  };
}

export function summarizeDataIntegrityForDisplay(dataIntegrity = {}) {
  const overall = String(dataIntegrity.overall || "PARTIAL").toUpperCase();
  return {
    label: overall,
    score: dataIntegrity.score ?? null,
    compact: `Data: ${overall}`,
  };
}
