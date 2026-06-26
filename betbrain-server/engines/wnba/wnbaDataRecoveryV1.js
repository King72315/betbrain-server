/**
 * WNBA data recovery v1 — attempt fixable missing data after integrity audit.
 * Does not lower gates or force picks; only repairs lookup/cache/alias paths.
 */
import { auditWnbaDataIntegrity } from "./wnbaDataIntegrityV1.js";
import {
  resolveWnbaTeamId,
  listWnbaTeamAliases,
} from "./wnbaTeamAliasResolver.js";
import { resolveStableWnbaPlayerId } from "./wnbaPlayerIdResolver.js";
import {
  findBallPlayer,
  fetchPlayerStats,
  fetchLast5,
  fetchLast3VsOpponent,
  probeWnbaMatchupLookup,
  bustBallCachesForPlayer,
} from "../../services/ballService.js";
import {
  MATCHUP_LOOKUP_CLASS,
  mapProbeToRecoveryClass,
} from "./wnbaMatchupLookupV1.js";

export const DATA_RECOVERY_VERSION = "wnba-data-recovery-v1";

export const RECOVERY_CLASS = {
  TRUE_SOURCE_UNAVAILABLE: "TRUE_SOURCE_UNAVAILABLE",
  TRUE_NO_PLAYER_H2H: "TRUE_NO_PLAYER_H2H",
  FIXABLE_LOOKUP_FAILURE: "FIXABLE_LOOKUP_FAILURE",
  FIXABLE_ALIAS_FAILURE: "FIXABLE_ALIAS_FAILURE",
  FIXABLE_PLAYER_ID_FAILURE: "FIXABLE_PLAYER_ID_FAILURE",
  FIXABLE_DATE_RANGE_FAILURE: "FIXABLE_DATE_RANGE_FAILURE",
  FIXABLE_CACHE_FAILURE: "FIXABLE_CACHE_FAILURE",
  FIXABLE_PARSER_FAILURE: "FIXABLE_PARSER_FAILURE",
  NEEDS_FALLBACK_SOURCE: "NEEDS_FALLBACK_SOURCE",
};

export { MATCHUP_LOOKUP_CLASS };

const ELIGIBILITY_BLOCKING_KEYS = new Set([
  "playerId",
  "seasonStats",
  "last5",
  "availability",
  "market",
]);

function num(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function avg(values = []) {
  const nums = values.map(num).filter((v) => Number.isFinite(v));
  if (!nums.length) return 0;
  return nums.reduce((sum, v) => sum + v, 0) / nums.length;
}

export function classifyIntegrityIssue(issue = {}, context = {}) {
  const { key, status, repairable } = issue;
  const { ballPlayerResolved = false } = context;

  if (status === "OK") return null;
  if (status === "WEAK") return null;

  if (key === "playerId") {
    if (resolveStableWnbaPlayerId(context.playerName)) {
      return RECOVERY_CLASS.FIXABLE_PLAYER_ID_FAILURE;
    }
    if (!ballPlayerResolved) {
      return RECOVERY_CLASS.FIXABLE_LOOKUP_FAILURE;
    }
    return RECOVERY_CLASS.TRUE_SOURCE_UNAVAILABLE;
  }

  if (key === "team" || key === "opponent") {
    return repairable
      ? RECOVERY_CLASS.FIXABLE_ALIAS_FAILURE
      : RECOVERY_CLASS.TRUE_SOURCE_UNAVAILABLE;
  }

  if (key === "seasonStats" || key === "last5") {
    if (!context.playerId && !resolveStableWnbaPlayerId(context.playerName)) {
      return RECOVERY_CLASS.FIXABLE_PLAYER_ID_FAILURE;
    }
    return RECOVERY_CLASS.FIXABLE_CACHE_FAILURE;
  }

  if (key === "matchup") {
    if (status === "LOOKUP_FAILED" || repairable) {
      const probeClass = context.matchupProbe?.classification;
      if (probeClass === MATCHUP_LOOKUP_CLASS.WRONG_QUERY_KEY_SUSPECTED) {
        return RECOVERY_CLASS.FIXABLE_LOOKUP_FAILURE;
      }
      if (probeClass === MATCHUP_LOOKUP_CLASS.FALLBACK_WNBA_MATCHUP_REQUIRED) {
        return RECOVERY_CLASS.FIXABLE_LOOKUP_FAILURE;
      }
      if (repairable && !probeClass) {
        return RECOVERY_CLASS.FIXABLE_ALIAS_FAILURE;
      }
      return RECOVERY_CLASS.FIXABLE_ALIAS_FAILURE;
    }

    const probeClass =
      context.matchupProbe?.classification ||
      issue.meta?.matchupLookupClass ||
      null;

    if (probeClass) {
      const mapped = mapProbeToRecoveryClass(probeClass);
      if (mapped === "TRUE_NO_PLAYER_H2H") {
        return RECOVERY_CLASS.TRUE_NO_PLAYER_H2H;
      }
      if (mapped === "NEEDS_FALLBACK_SOURCE") {
        return RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE;
      }
      if (mapped === "FIXABLE_LOOKUP_FAILURE") {
        return RECOVERY_CLASS.FIXABLE_LOOKUP_FAILURE;
      }
    }

    const hasResolvedTeams = Boolean(
      issue.meta?.opponentTeamId && issue.meta?.teamId
    );
    const hasPlayerContext = Boolean(
      context.playerId ||
        resolveStableWnbaPlayerId(context.playerName) ||
        context.ballPlayerResolved
    );

    if (hasResolvedTeams && hasPlayerContext) {
      if (probeClass === MATCHUP_LOOKUP_CLASS.PLAYER_DID_NOT_PLAY_IN_MATCHUP) {
        return RECOVERY_CLASS.TRUE_NO_PLAYER_H2H;
      }
      if (probeClass === MATCHUP_LOOKUP_CLASS.BALL_GAME_LOOKUP_EMPTY) {
        return RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE;
      }
      if (probeClass === MATCHUP_LOOKUP_CLASS.MATCHUP_GAMES_EXIST) {
        return RECOVERY_CLASS.FIXABLE_LOOKUP_FAILURE;
      }
      return RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE;
    }
    return RECOVERY_CLASS.FIXABLE_LOOKUP_FAILURE;
  }

  if (key === "availability") {
    if (status === "SOURCE_UNAVAILABLE") {
      return RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE;
    }
    return RECOVERY_CLASS.TRUE_SOURCE_UNAVAILABLE;
  }

  if (key === "defense") {
    return RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE;
  }

  if (key === "market") {
    return RECOVERY_CLASS.TRUE_SOURCE_UNAVAILABLE;
  }

  return repairable
    ? RECOVERY_CLASS.FIXABLE_LOOKUP_FAILURE
    : RECOVERY_CLASS.TRUE_SOURCE_UNAVAILABLE;
}

function resolveTeamViaAliases(rawTeam = "") {
  const direct = resolveWnbaTeamId(rawTeam);
  if (direct) return direct;

  for (const alias of listWnbaTeamAliases(rawTeam)) {
    const resolved = resolveWnbaTeamId(alias);
    if (resolved) return resolved;
  }
  return "";
}

function deriveSeasonProfile(games = []) {
  if (!games.length) {
    return {
      seasonAverage: 0,
      seasonMinutes: 0,
      seasonFGA: 0,
      seasonFTA: 0,
    };
  }
  return {
    seasonAverage: avg(games.map((g) => g.points)),
    seasonMinutes: avg(games.map((g) => g.minutes)),
    seasonFGA: avg(games.map((g) => g.fga)),
    seasonFTA: avg(games.map((g) => g.fta)),
  };
}

function buildEmptyRecovery() {
  return {
    version: DATA_RECOVERY_VERSION,
    dataRecoveryVersion: DATA_RECOVERY_VERSION,
    attempted: false,
    recoveredFields: [],
    unrecoveredFields: [],
    trueUnavailableFields: [],
    fallbackSourcesUsed: [],
    fixableFailuresFound: 0,
    fixableFailuresResolved: 0,
    stillBlockingEligibility: [],
    wouldEligibilityImproveAfterRecovery: false,
    classifications: {},
    attempts: [],
    recoveredAt: null,
  };
}

function blockingKeysFromAudit(audit = {}) {
  return (audit.issues || [])
    .filter((i) => ELIGIBILITY_BLOCKING_KEYS.has(i.key))
    .filter((i) => i.status !== "OK")
    .map((i) => i.key);
}

/**
 * Attempt recovery for fixable integrity issues. Returns merged context + recovery meta.
 */
export async function attemptWnbaDataRecovery(context = {}, dataIntegrity = null) {
  const recovery = buildEmptyRecovery();
  const audit =
    dataIntegrity ||
    auditWnbaDataIntegrity({
      ...context,
      playerId: context.playerId || "",
    });

  const fixableIssues = (audit.issues || []).filter((issue) => {
    const cls = classifyIntegrityIssue(issue, context);
    if (!cls) return false;
    recovery.classifications[issue.key] = cls;
    if (cls === RECOVERY_CLASS.TRUE_SOURCE_UNAVAILABLE) {
      recovery.trueUnavailableFields.push(issue.key);
      return false;
    }
    recovery.fixableFailuresFound += 1;
    return true;
  });

  if (!fixableIssues.length) {
    recovery.stillBlockingEligibility = blockingKeysFromAudit(audit);
    return { context, dataIntegrity: audit, dataRecovery: recovery };
  }

  recovery.attempted = true;
  const merged = { ...context };
  const beforeBlocking = blockingKeysFromAudit(audit);

  for (const issue of fixableIssues) {
    const cls = recovery.classifications[issue.key];
    const attempt = { field: issue.key, classification: cls, success: false, source: null };

    try {
      if (issue.key === "playerId") {
        bustBallCachesForPlayer(merged.playerName, "WNBA");
        const stableId = resolveStableWnbaPlayerId(merged.playerName);
        const ballPlayer = await findBallPlayer(merged.playerName, "WNBA");
        const recoveredId = String(ballPlayer?.id || stableId || "");
        if (recoveredId) {
          merged.playerId = recoveredId;
          merged.ballPlayerResolved = Boolean(ballPlayer || stableId);
          merged.stablePlayerIdUsed = Boolean(
            stableId && String(ballPlayer?.id || stableId) === stableId
          );
          attempt.success = true;
          attempt.source = stableId && !ballPlayer ? "stable_override" : "balldontlie";
          if (stableId && !ballPlayer) {
            recovery.fallbackSourcesUsed.push("stable_player_id_override");
          }
        }
      }

      if (issue.key === "team" || issue.key === "opponent") {
        const raw = issue.key === "team" ? merged.team : merged.opponent;
        const resolved = resolveTeamViaAliases(raw);
        if (resolved) {
          merged[issue.key] = resolved;
          attempt.success = true;
          attempt.source = "alias_resolver";
          recovery.fallbackSourcesUsed.push("wnba_team_alias_resolver");
        }
      }

      if (
        issue.key === "seasonStats" ||
        issue.key === "last5" ||
        issue.key === "matchup"
      ) {
        if (!merged.playerId) {
          const stableId = resolveStableWnbaPlayerId(merged.playerName);
          const ballPlayer = await findBallPlayer(merged.playerName, "WNBA");
          merged.playerId = String(ballPlayer?.id || stableId || merged.playerId || "");
        }

        if (cls === RECOVERY_CLASS.FIXABLE_CACHE_FAILURE) {
          bustBallCachesForPlayer(merged.playerName, "WNBA");
          recovery.fallbackSourcesUsed.push("ball_cache_bust");
        }

        const beforeTime = merged.beforeTime || merged.game?.commenceTime || null;
        const resolvedOpponent =
          resolveTeamViaAliases(merged.opponent) || merged.opponent;
        const resolvedPlayerTeam =
          resolveTeamViaAliases(merged.team) || merged.team;

        const matchupProbe = await probeWnbaMatchupLookup({
          playerName: merged.playerName,
          playerId: merged.playerId,
          playerTeam: resolvedPlayerTeam,
          opponent: resolvedOpponent,
          beforeTime,
        });
        merged.matchupProbe = matchupProbe;

        const seasonGames = await fetchPlayerStats(merged.playerName, "WNBA");
        const last5 = await fetchLast5(merged.playerName, "WNBA", { beforeTime });
        const matchupGames = await fetchLast3VsOpponent(
          merged.playerName,
          resolvedOpponent,
          "WNBA",
          { beforeTime, playerTeam: resolvedPlayerTeam }
        );

        merged.last5 = last5;
        merged.matchupGames = matchupGames;
        merged.bdlSeasonGames = seasonGames;

        const profile = deriveSeasonProfile(seasonGames);
        merged.seasonAverage = profile.seasonAverage;
        merged.playerState = {
          ...(merged.playerState || {}),
          seasonPoints: profile.seasonAverage,
          seasonMinutes: profile.seasonMinutes,
          seasonFGA: profile.seasonFGA,
          seasonFTA: profile.seasonFTA,
          matchupAverage: matchupGames.length
            ? Number(avg(matchupGames.map((g) => g.points)).toFixed(1))
            : merged.playerState?.matchupAverage ?? null,
          playerId: merged.playerId,
        };

        const recoveredSomething =
          (issue.key === "seasonStats" && profile.seasonAverage > 0) ||
          (issue.key === "last5" && last5.length >= 3) ||
          (issue.key === "matchup" && matchupGames.length > 0);

        if (recoveredSomething) {
          attempt.success = true;
          attempt.source = "balldontlie_stats";
        } else if (seasonGames.length === 0 && merged.playerId) {
          recovery.classifications[issue.key] = RECOVERY_CLASS.FIXABLE_DATE_RANGE_FAILURE;
        }
      }

      if (issue.key === "availability" && cls === RECOVERY_CLASS.NEEDS_FALLBACK_SOURCE) {
        if (merged.playerId && merged.evaluateAvailability) {
          const avail = await merged.evaluateAvailability({
            playerId: merged.playerId,
            playerName: merged.playerName,
            league: "WNBA",
          });
          if (avail && !avail.availabilityDataMissing) {
            merged.availabilityGate = avail;
            attempt.success = true;
            attempt.source = "wnba_availability_retry";
            recovery.fallbackSourcesUsed.push("wnba_availability_feed");
          }
        }
      }
    } catch (err) {
      attempt.error = err.message;
    }

    recovery.attempts.push(attempt);
    if (attempt.success) {
      recovery.recoveredFields.push(issue.key);
      recovery.fixableFailuresResolved += 1;
    } else if (!recovery.trueUnavailableFields.includes(issue.key)) {
      recovery.unrecoveredFields.push(issue.key);
    }
  }

  const postAudit = auditWnbaDataIntegrity({
    playerName: merged.playerName,
    playerId: merged.playerId,
    team: merged.team,
    opponent: merged.opponent,
    last5: merged.last5 || [],
    matchupGames: merged.matchupGames || [],
    matchupAverage: merged.playerState?.matchupAverage,
    seasonAverage: merged.seasonAverage ?? merged.playerState?.seasonPoints ?? 0,
    availabilityGate: merged.availabilityGate || {},
    defenseResult: merged.defenseResult || {},
    prop: merged.prop || {},
    playerState: merged.playerState || {},
    ballPlayerResolved: merged.ballPlayerResolved,
    stablePlayerIdUsed: merged.stablePlayerIdUsed,
    matchupProbe: merged.matchupProbe || null,
  });

  recovery.stillBlockingEligibility = blockingKeysFromAudit(postAudit);
  recovery.wouldEligibilityImproveAfterRecovery =
    recovery.fixableFailuresResolved > 0 &&
    (postAudit.score > audit.score ||
      recovery.stillBlockingEligibility.length < beforeBlocking.length);
  recovery.recoveredAt = new Date().toISOString();

  return {
    context: merged,
    dataIntegrity: postAudit,
    dataRecovery: recovery,
    beforeIntegrity: audit,
  };
}

export function attachDataRecoveryToIntegrity(dataIntegrity = {}, dataRecovery = {}) {
  return {
    ...dataIntegrity,
    dataRecovery,
    dataRecoveryVersion: DATA_RECOVERY_VERSION,
  };
}

export function summarizeRecoveryForDisplay(dataRecovery = {}) {
  const resolved = Number(dataRecovery.fixableFailuresResolved || 0);
  const found = Number(dataRecovery.fixableFailuresFound || 0);
  if (!dataRecovery.attempted) {
    return found > 0 ? `Recovery: ${found} fixable pending` : "Recovery: none needed";
  }
  if (resolved === found && found > 0) {
    return `Recovery: ${resolved}/${found} fixed`;
  }
  return `Recovery: ${resolved}/${found} fixed, ${(dataRecovery.unrecoveredFields || []).length} open`;
}
