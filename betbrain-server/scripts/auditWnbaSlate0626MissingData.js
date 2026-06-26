/**
 * Audit WNBA 6/26 slate missing data — per-candidate integrity + recovery.
 * Usage: node betbrain-server/scripts/auditWnbaSlate0626MissingData.js [picksJsonPath]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { auditWnbaDataIntegrity } from "../engines/wnba/wnbaDataIntegrityV1.js";
import {
  attemptWnbaDataRecovery,
  attachDataRecoveryToIntegrity,
  classifyIntegrityIssue,
  RECOVERY_CLASS,
} from "../engines/wnba/wnbaDataRecoveryV1.js";
import {
  findBallPlayer,
  fetchPlayerStats,
  fetchLast5,
  fetchLast3VsOpponent,
  probeWnbaMatchupLookup,
} from "../services/ballService.js";
import { resolveWnbaTeamId } from "../engines/wnba/wnbaTeamAliasResolver.js";
import { resolveStableWnbaPlayerId } from "../engines/wnba/wnbaPlayerIdResolver.js";
import { evaluateWnbaAvailability } from "../services/wnbaAvailabilityService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SLATE_DATE = process.argv[3] || "2026-06-26";
const picksPath =
  process.argv[2] ||
  path.join(__dirname, "../../.tmp-prod-wnba-picks-0626.json");

function collectCandidatesFromPicksFile(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const games = raw.games || [];
  const seen = new Set();
  const candidates = [];

  for (const game of games) {
    const pool = game.allGeneratedCandidates || game.picks || [];
    for (const pick of pool) {
      const key = [
        pick.player,
        pick.team,
        pick.opponent,
        pick.line,
        pick.side || pick.pick,
      ].join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        ...pick,
        slateDate: pick.slateDate || game.date,
        gameDate: game.date,
        commenceTime: game.commenceTime || game.time,
        league: pick.league || "WNBA",
      });
    }
  }

  return candidates.filter(
    (p) =>
      String(p.league || "").toUpperCase() === "WNBA" &&
      String(p.slateDate || p.gameDate || "").startsWith(SLATE_DATE)
  );
}

async function liveAuditCandidate(pick) {
  const playerName = pick.player;
  const team = resolveWnbaTeamId(pick.team) || pick.team;
  const opponent = resolveWnbaTeamId(pick.opponent) || pick.opponent;
  const beforeTime = pick.commenceTime || `${SLATE_DATE}T23:59:59Z`;

  const ballPlayer = await findBallPlayer(playerName, "WNBA");
  const stableId = resolveStableWnbaPlayerId(playerName);
  const playerId = String(ballPlayer?.id || stableId || "");
  const last5 = await fetchLast5(playerName, "WNBA", { beforeTime });
  const matchupProbe = await probeWnbaMatchupLookup({
    playerName,
    playerId,
    playerTeam: team,
    opponent,
    beforeTime,
  });
  const matchupGames = await fetchLast3VsOpponent(
    playerName,
    opponent,
    "WNBA",
    { beforeTime, playerTeam: team }
  );
  const seasonGames = await fetchPlayerStats(playerName, "WNBA");
  const seasonAverage = seasonGames.length
    ? seasonGames.reduce((s, g) => s + Number(g.points || 0), 0) /
      seasonGames.length
    : 0;
  const matchupAverage = matchupGames.length
    ? Number(
        (
          matchupGames.reduce((s, g) => s + Number(g.points || 0), 0) /
          matchupGames.length
        ).toFixed(1)
      )
    : null;
  const availabilityGate = await evaluateWnbaAvailability({
    playerId,
    playerName,
    league: "WNBA",
  });

  const ctx = {
    playerName,
    playerId,
    team,
    opponent,
    last5,
    matchupGames,
    matchupAverage,
    seasonAverage,
    availabilityGate,
    defenseResult: pick.defenseResult || {},
    prop: { line: pick.line, bookCount: pick.bookCount || 1 },
    playerState: {
      matchupAverage,
      seasonPoints: seasonAverage,
    },
    ballPlayerResolved: Boolean(ballPlayer),
    stablePlayerIdUsed: Boolean(stableId && String(ballPlayer?.id) === stableId),
    beforeTime,
    evaluateAvailability: evaluateWnbaAvailability,
  };

  const preAudit = auditWnbaDataIntegrity(ctx);
  const { dataRecovery, dataIntegrity, context } = await attemptWnbaDataRecovery(
    ctx,
    preAudit
  );
  const finalIntegrity = attachDataRecoveryToIntegrity(
    dataIntegrity,
    dataRecovery
  );

  return {
    pick,
    live: {
      ballPlayer: ballPlayer
        ? { id: ballPlayer.id, name: `${ballPlayer.first_name} ${ballPlayer.last_name}` }
        : null,
      stableId: stableId || null,
      last5Count: last5.length,
      matchupCount: matchupGames.length,
      seasonGameCount: seasonGames.length,
      seasonAverage,
      matchupAverage,
      availability: availabilityGate,
    },
    cached: {
      dataIntegrity: pick.dataIntegrity || pick.wnbaDataCard?.dataIntegrity,
      dataRecovery: pick.dataRecovery || pick.wnbaDataCard?.dataRecovery,
    },
    postRecovery: {
      dataIntegrity: finalIntegrity,
      dataRecovery,
      context,
    },
  };
}

function buildTableRows(audit) {
  const rows = [];
  const { pick, live, cached, postRecovery } = audit;
  const di = postRecovery.dataIntegrity;
  const dr = postRecovery.dataRecovery;

  const issueKeys = new Set((di.issues || []).map((i) => i.key));
  const cachedIssues = cached.dataIntegrity?.issues || [];

  for (const issue of di.issues || []) {
    const cls =
      dr.classifications?.[issue.key] ||
      classifyIntegrityIssue(issue, postRecovery.context);
    const cachedIssue = cachedIssues.find((i) => i.key === issue.key);
    const wasFixed =
      cachedIssue &&
      cachedIssue.status !== "OK" &&
      issue.status === "OK"
        ? "yes (recovery)"
        : cachedIssue && cachedIssue.status === issue.status
          ? "no (pre-existing)"
          : "n/a (live audit)";

    let sourceAttempted = "balldontlie";
    let sourceResponse = "";
    if (issue.key === "playerId") {
      sourceAttempted = "balldontlie / stable_override";
      sourceResponse = live.ballPlayer
        ? `id=${live.ballPlayer.id}`
        : live.stableId
          ? `stable=${live.stableId}`
          : "no match";
    } else if (issue.key === "seasonStats") {
      sourceResponse = `${live.seasonGameCount} season games, avg=${live.seasonAverage}`;
    } else if (issue.key === "last5") {
      sourceResponse = `${live.last5Count} games`;
    } else if (issue.key === "matchup") {
      sourceResponse = `${live.matchupCount} vs ${pick.opponent}`;
    } else if (issue.key === "availability") {
      sourceAttempted = "wnba_availability_feed";
      sourceResponse = live.availability?.availabilitySourceStatus || "SOURCE_UNAVAILABLE";
    } else if (issue.key === "defense") {
      sourceAttempted = "defense_score_engine";
      sourceResponse = "no opponent defense context";
    }

    const attempt = (dr.attempts || []).find((a) => a.field === issue.key);
    const fixMade =
      attempt?.success
        ? `yes — ${attempt.source}`
        : cls?.startsWith("FIXABLE")
          ? "code exists; not resolved this run"
          : "no — needs fallback or unavailable";

    rows.push({
      player: pick.player,
      team: pick.team,
      opponent: pick.opponent,
      missingField: issue.key,
      whyMissing: issue.message,
      sourceAttempted,
      sourceResponse,
      classification: cls || RECOVERY_CLASS.TRUE_SOURCE_UNAVAILABLE,
      fixMade,
      stillMissing: issue.status !== "OK" ? "yes" : "no",
      stillMissingWhy:
        issue.status !== "OK"
          ? issue.meta
            ? JSON.stringify(issue.meta)
            : issue.message
          : "",
      eligibilityImpact:
        ["playerId", "seasonStats", "last5", "availability", "market"].includes(
          issue.key
        )
          ? "may block tracking gate"
          : "reader/DI context only",
    });
  }

  if (!issueKeys.size) {
    rows.push({
      player: pick.player,
      team: pick.team,
      opponent: pick.opponent,
      missingField: "(none)",
      whyMissing: "All integrity fields OK after live audit + recovery",
      sourceAttempted: "balldontlie",
      sourceResponse: `score=${di.score} overall=${di.overall}`,
      classification: "OK",
      fixMade: dr.fixableFailuresResolved
        ? `recovery resolved ${dr.fixableFailuresResolved}`
        : "n/a",
      stillMissing: "no",
      stillMissingWhy: "",
      eligibilityImpact: "none",
    });
  }

  return rows;
}

async function main() {
  if (!fs.existsSync(picksPath)) {
    console.error("Picks file not found:", picksPath);
    process.exit(1);
  }

  const candidates = collectCandidatesFromPicksFile(picksPath);
  console.log(`Auditing ${candidates.length} WNBA candidates for ${SLATE_DATE}`);
  console.log("Source:", picksPath);
  console.log("=".repeat(72));

  const allRows = [];
  const summaries = [];

  for (const pick of candidates) {
    const audit = await liveAuditCandidate(pick);
    const rows = buildTableRows(audit);
    allRows.push(...rows);
    summaries.push({
      player: pick.player,
      side: pick.side || pick.pick,
      line: pick.line,
      cachedOverall: audit.cached.dataIntegrity?.overall,
      liveOverall: audit.postRecovery.dataIntegrity.overall,
      liveScore: audit.postRecovery.dataIntegrity.score,
      fixableFound: audit.postRecovery.dataRecovery.fixableFailuresFound,
      fixableResolved: audit.postRecovery.dataRecovery.fixableFailuresResolved,
      unrecovered: audit.postRecovery.dataRecovery.unrecoveredFields,
      trueUnavailable: audit.postRecovery.dataRecovery.trueUnavailableFields,
      reader: pick.wnbaReader?.decision,
    });
  }

  const outPath = path.join(
    __dirname,
    "../COURTEDGE_0626_MISSING_DATA_AUDIT.json"
  );
  fs.writeFileSync(
    outPath,
    JSON.stringify({ slateDate: SLATE_DATE, candidates: summaries, rows: allRows }, null, 2)
  );

  console.log("\nPer-candidate summary:");
  for (const s of summaries) {
    console.log(
      `  ${s.player} ${s.side} ${s.line} | cached=${s.cachedOverall || "?"} live=${s.liveOverall} (${s.liveScore}) fix=${s.fixableResolved}/${s.fixableFound} reader=${s.reader || "?"}`
    );
  }

  console.log("\nMissing field counts:");
  const fieldCounts = {};
  for (const r of allRows) {
    if (r.stillMissing === "yes") {
      fieldCounts[r.missingField] = (fieldCounts[r.missingField] || 0) + 1;
    }
  }
  console.log(JSON.stringify(fieldCounts, null, 2));
  console.log("\nWrote:", outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
