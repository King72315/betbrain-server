/**
 * Same-snapshot before/after for Player Role Profile v1.
 * Replays profile calibration on a frozen fixture — no live refresh / no prod mutation.
 *
 * Toggle (replay-script only; does not change live defaults):
 *   applyPlayerRoleProfile=false → old path (profileCalibration omitted / no-op)
 *   applyPlayerRoleProfile=true  → new path (build + apply calibration, ±1.5 cap)
 *
 * Usage:
 *   node betbrain-server/scripts/comparePlayerRoleProfileSnapshot.js [fixtureJson]
 */
import fs from "fs";
import path from "path";
import {
  buildPlayerRoleProfile,
  buildPlayerProfileCalibration,
  CALIBRATION_CAPS,
} from "../engines/playerRoleProfileV1.js";
import { projectWnbaPoints } from "../engines/wnba/wnbaProjectionEngine.js";
import {
  computeSafetyScore,
  BEST_SIX_LIMIT,
  TOP_TWO_LIMIT,
  MAX_TEAM_IN_BEST_SIX,
  MAX_GAME_IN_BEST_SIX,
} from "../engines/topProps/controlledBestSixSelector.js";

function num(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function clean(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function loadFixture(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (Array.isArray(raw.candidates) && raw.candidates.length) {
    return {
      meta: {
        slateDate: raw.slateDate || null,
        sourceFile: raw.sourceFile || filePath,
        sourceLastUpdated: raw.sourceLastUpdated || null,
        originalBestSix: raw.originalBestSixDisplay || raw.originalBestSix || [],
        originalTop2: raw.originalTop2 || [],
      },
      picks: raw.candidates,
    };
  }

  const pools = [];
  if (Array.isArray(raw)) pools.push(...raw);
  if (Array.isArray(raw.props)) pools.push(...raw.props);
  if (Array.isArray(raw.topProps)) pools.push(...raw.topProps);
  if (Array.isArray(raw.bestSix)) pools.push(...raw.bestSix);
  if (Array.isArray(raw.candidates)) pools.push(...raw.candidates);
  if (Array.isArray(raw.wnbaProps)) pools.push(...raw.wnbaProps);
  if (Array.isArray(raw.bestSixDisplayWNBA)) {
    pools.push(...raw.bestSixDisplayWNBA);
  }
  if (Array.isArray(raw.boardCappedProps)) pools.push(...raw.boardCappedProps);
  if (Array.isArray(raw.topWNBAProps)) pools.push(...raw.topWNBAProps);
  if (raw.byLeague?.WNBA) {
    const w = raw.byLeague.WNBA;
    if (Array.isArray(w)) pools.push(...w);
    if (Array.isArray(w.props)) pools.push(...w.props);
    if (Array.isArray(w.bestSix)) pools.push(...w.bestSix);
    if (Array.isArray(w.topProps)) pools.push(...w.topProps);
  }
  for (const key of ["homeBestSix", "controlledBestSix", "displayBestSix"]) {
    if (Array.isArray(raw[key])) pools.push(...raw[key]);
  }

  const seen = new Set();
  const uniq = [];
  for (const p of pools) {
    if (!p || typeof p !== "object") continue;
    if (String(p.league || "").toUpperCase() !== "WNBA" && !p.wnbaDataCard) {
      continue;
    }
    const k = `${p.player}|${p.line}|${p.side || p.pick}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  return {
    meta: {
      slateDate: null,
      sourceFile: filePath,
      sourceLastUpdated: raw.lastUpdated || null,
      originalBestSix: (raw.bestSixDisplayWNBA || []).map((p) => ({
        player: p.player,
        side: p.side || p.pick,
        line: p.line,
      })),
      originalTop2: (raw.topWNBAProps || raw.topProps || [])
        .slice(0, 2)
        .map((p) => ({
          player: p.player,
          side: p.side || p.pick,
          line: p.line,
        })),
    },
    picks: uniq,
  };
}

function inferGamesFromPick(pick = {}) {
  const card = pick.wnbaDataCard || {};
  const pointsList = card.last5?.pointsList || [];
  if (pointsList.length) {
    const min = num(card.last5?.minutes, 24) || 24;
    const fga = num(card.last5?.fga, 9) || 9;
    const fta = num(card.last5?.fta, 2) || 2;
    return pointsList.map((pts, i) => ({
      date: `snap-${i}`,
      points: num(pts, 0) || 0,
      minutes: min,
      fga,
      fta,
    }));
  }
  const ps = pick.playerState || {};
  const minutes = num(ps.recentMinutes ?? pick.recentMinutes, 0) || 0;
  const points = num(ps.recentPoints ?? pick.last5Average, 0) || 0;
  const fga = num(ps.recentFGA ?? pick.recentFGA, 0) || 0;
  const fta = num(ps.recentFTA ?? pick.recentFTA, 0) || 0;
  if (minutes <= 0 && points <= 0 && fga <= 0) return [];
  return Array.from({ length: 5 }, (_, i) => ({
    date: `avg-${i}`,
    minutes,
    points,
    fga,
    fta,
  }));
}

/**
 * @param {object} pick
 * @param {{ applyPlayerRoleProfile?: boolean }} options
 *   applyPlayerRoleProfile=false → old engine (no calibration)
 *   applyPlayerRoleProfile=true  → new engine (calibration on)
 */
function comparePick(pick, options = {}) {
  const applyPlayerRoleProfile = options.applyPlayerRoleProfile !== false;
  const ps = pick.playerState || {};
  const games = inferGamesFromPick(pick);
  const seasonMinutes = num(ps.seasonMinutes, null);
  const seasonFga = num(ps.seasonFGA, null);
  const seasonFta = num(ps.seasonFTA, null);
  const seasonPoints = num(ps.seasonPoints ?? pick.seasonAverage, null);
  const recentMinutes = num(ps.recentMinutes ?? pick.recentMinutes, null);
  const recentFga = num(ps.recentFGA ?? pick.recentFGA, null);
  const recentFta = num(ps.recentFTA ?? pick.recentFTA, null);
  const recentPoints = num(ps.recentPoints ?? pick.last5Average, null);

  const baseArgs = {
    seasonMinutes: seasonMinutes || 0,
    recentMinutes: recentMinutes || 0,
    seasonFGA: seasonFga || 0,
    recentFGA: recentFga || 0,
    seasonFTA: seasonFta || 0,
    recentFTA: recentFta || 0,
    seasonPoints: seasonPoints || 0,
    recentPoints: recentPoints || 0,
    roleChange: pick.roleChange || {},
  };

  // Always compute uncalibrated baseline = "before" / old path.
  const beforeProj = projectWnbaPoints({
    ...baseArgs,
    profileCalibration: null,
  });

  const profile = buildPlayerRoleProfile({
    last5: games,
    seasonMinutes,
    seasonFga,
    seasonFta,
    seasonPoints,
    expectedMinutes: beforeProj.expectedMinutes,
    expectedFga: beforeProj.expectedFGA,
    expectedFta: beforeProj.expectedFTA,
    bookCount: pick.bookCount,
    roleChange: pick.roleChange || {},
  });

  const calibration = buildPlayerProfileCalibration(profile, {
    side: String(pick.side || pick.pick || "").toUpperCase(),
  });

  const afterProj = applyPlayerRoleProfile
    ? projectWnbaPoints({
        ...baseArgs,
        profileCalibration: calibration,
      })
    : projectWnbaPoints({
        ...baseArgs,
        profileCalibration: null,
      });

  const confBefore = num(pick.confidence ?? pick.finalConfidence, null);
  const confAfter =
    !applyPlayerRoleProfile || confBefore === null
      ? confBefore
      : Math.max(
          30,
          Math.min(92, Math.round(confBefore + (calibration.confidenceAdjustment || 0)))
        );

  const line = num(pick.line ?? pick.sportsbookLine, 0) || 0;
  const side = String(pick.side || pick.pick || "").toUpperCase();
  const gapBefore =
    line > 0
      ? side.includes("UNDER")
        ? line - beforeProj.projection
        : beforeProj.projection - line
      : null;
  const gapAfter =
    line > 0
      ? side.includes("UNDER")
        ? line - afterProj.projection
        : afterProj.projection - line
      : null;

  const pickBefore = {
    ...pick,
    projection: beforeProj.projection,
    confidence: confBefore,
    playerProfileCalibration: null,
    playerRoleProfile: null,
  };
  const pickAfter = {
    ...pick,
    projection: afterProj.projection,
    confidence: confAfter ?? pick.confidence,
    playerRoleProfile: applyPlayerRoleProfile ? profile : null,
    playerProfileCalibration: applyPlayerRoleProfile ? calibration : null,
  };

  return {
    player: pick.player,
    side: pick.side || pick.pick,
    line,
    team: pick.team || null,
    game: pick.game || null,
    gameDate: pick.gameDate || pick.date || null,
    bookCount: pick.bookCount ?? null,
    inBestSixDisplay: Boolean(pick.inBestSixDisplay),
    inTopProps: Boolean(pick.inTopProps),
    roleStability: profile.roleStability,
    minutesLevel: profile.minutesLevel,
    scoringVolume: profile.scoringVolume,
    shotVolumeStability: profile.shotVolumeStability,
    scoringVolatility: profile.scoringVolatility,
    roleDirection: profile.roleDirection,
    profileConfidence: profile.profileConfidence,
    profileSampleSize: profile.profileSampleSize,
    fallbackUsed: profile.fallbackUsed,
    projectionBefore: beforeProj.projection,
    projectionAfter: afterProj.projection,
    profileProjectionDelta: Number(
      (afterProj.projection - beforeProj.projection).toFixed(2)
    ),
    confidenceBefore: confBefore,
    confidenceAfter: confAfter,
    gapBefore: gapBefore !== null ? Number(gapBefore.toFixed(2)) : null,
    gapAfter: gapAfter !== null ? Number(gapAfter.toFixed(2)) : null,
    overRequiredEdgeAdj: applyPlayerRoleProfile
      ? calibration.overRequiredEdgeAdjustment
      : 0,
    underRequiredEdgeAdj: applyPlayerRoleProfile
      ? calibration.underRequiredEdgeAdjustment
      : 0,
    rankingAdjustment: applyPlayerRoleProfile
      ? calibration.rankingAdjustment
      : 0,
    riskDebtIds: applyPlayerRoleProfile ? calibration.riskDebtIds : [],
    riskRepairIds: applyPlayerRoleProfile ? calibration.riskRepairIds : [],
    calibrationReasons: applyPlayerRoleProfile
      ? calibration.calibrationReasons
      : ["applyPlayerRoleProfile=false — calibration skipped"],
    safetyBefore: Number(computeSafetyScore(pickBefore).toFixed(1)),
    safetyAfter: Number(computeSafetyScore(pickAfter).toFixed(1)),
    maxProjCap: CALIBRATION_CAPS.maxProjectionMovement,
    applyPlayerRoleProfile,
    _pickBefore: pickBefore,
    _pickAfter: pickAfter,
  };
}

function selectBySafetyCaps(rows, scoreKey, limit = BEST_SIX_LIMIT) {
  const sorted = [...rows].sort((a, b) => b[scoreKey] - a[scoreKey]);
  const selected = [];
  const teamCount = new Map();
  const gameCount = new Map();
  for (const row of sorted) {
    if (selected.length >= limit) break;
    const team = clean(row.team || "");
    const game = clean(row.game || "");
    if (team && (teamCount.get(team) || 0) >= MAX_TEAM_IN_BEST_SIX) continue;
    if (game && (gameCount.get(game) || 0) >= MAX_GAME_IN_BEST_SIX) continue;
    selected.push(row);
    if (team) teamCount.set(team, (teamCount.get(team) || 0) + 1);
    if (game) gameCount.set(game, (gameCount.get(game) || 0) + 1);
  }
  return selected;
}

function summarizeBoard(rows) {
  return rows.map((r, i) => ({
    rank: i + 1,
    player: r.player,
    side: r.side,
    line: r.line,
    team: r.team,
    safety: r._score,
    projection: r._proj,
    confidence: r._conf,
    role: `${r.roleStability}/${r.scoringVolume}/${r.roleDirection}`,
    profileProjectionDelta: r.profileProjectionDelta,
    rankingAdjustment: r.rankingAdjustment,
    reasons: r.calibrationReasons,
  }));
}

function boardDiff(before, after) {
  const beforeKeys = before.map((r) => `${r.player}|${r.side}|${r.line}`);
  const afterKeys = after.map((r) => `${r.player}|${r.side}|${r.line}`);
  return {
    membershipUnchanged:
      beforeKeys.length === afterKeys.length &&
      beforeKeys.every((k, i) => k === afterKeys[i]),
    orderUnchanged: beforeKeys.join("||") === afterKeys.join("||"),
    dropped: beforeKeys.filter((k) => !afterKeys.includes(k)),
    added: afterKeys.filter((k) => !beforeKeys.includes(k)),
    beforeKeys,
    afterKeys,
  };
}

function main() {
  const arg = process.argv[2];
  const candidates = [
    arg,
    path.resolve(
      "betbrain-server/scripts/fixtures/player-role-profile-wnba-2026-07-14-snapshot.json"
    ),
    path.resolve("betbrain-server/.player-role-profile-snapshot.json"),
    path.resolve(".tmp-poll-picks-0713-after.json"),
    path.resolve(".tmp-live-picks.json"),
  ].filter(Boolean);

  let file = null;
  let loaded = null;
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      try {
        loaded = loadFixture(c);
        if (loaded.picks.length) {
          file = c;
          break;
        }
      } catch {
        /* try next */
      }
    }
  }

  if (!file || !loaded?.picks?.length) {
    console.log(
      JSON.stringify(
        {
          ok: false,
          reason:
            "No usable WNBA candidate snapshot found — do not fabricate tomorrow slate.",
          tried: candidates,
        },
        null,
        2
      )
    );
    process.exit(0);
  }

  // True same-snapshot: run once with profile off (old) and once with profile on (new)
  const beforeRows = loaded.picks.map((p) =>
    comparePick(p, { applyPlayerRoleProfile: false })
  );
  const afterRows = loaded.picks.map((p) =>
    comparePick(p, { applyPlayerRoleProfile: true })
  );

  // Candidate table uses after-row profile labels + both proj/conf/safety
  const candidateTable = afterRows.map((after, i) => {
    const before = beforeRows[i];
    return {
      player: after.player,
      side: after.side,
      line: after.line,
      team: after.team,
      gameDate: after.gameDate,
      bookCount: after.bookCount,
      roleStability: after.roleStability,
      minutesLevel: after.minutesLevel,
      scoringVolume: after.scoringVolume,
      shotVolumeStability: after.shotVolumeStability,
      scoringVolatility: after.scoringVolatility,
      roleDirection: after.roleDirection,
      profileConfidence: after.profileConfidence,
      profileSampleSize: after.profileSampleSize,
      fallbackUsed: after.fallbackUsed,
      projectionBefore: before.projectionBefore,
      projectionAfter: after.projectionAfter,
      profileProjectionDelta: after.profileProjectionDelta,
      confidenceBefore: before.confidenceBefore,
      confidenceAfter: after.confidenceAfter,
      gapBefore: before.gapBefore,
      gapAfter: after.gapAfter,
      rankingAdjustment: after.rankingAdjustment,
      overRequiredEdgeAdj: after.overRequiredEdgeAdj,
      underRequiredEdgeAdj: after.underRequiredEdgeAdj,
      riskDebtIds: after.riskDebtIds,
      riskRepairIds: after.riskRepairIds,
      calibrationReasons: after.calibrationReasons,
      safetyBefore: before.safetyBefore,
      safetyAfter: after.safetyAfter,
      safetyDelta: Number((after.safetyAfter - before.safetyBefore).toFixed(1)),
      inOriginalBestSixDisplay: after.inBestSixDisplay,
      inOriginalTopProps: after.inTopProps,
      maxProjCap: after.maxProjCap,
    };
  });

  const rankedBefore = beforeRows.map((r) => ({
    ...r,
    _score: r.safetyBefore,
    _proj: r.projectionBefore,
    _conf: r.confidenceBefore,
  }));
  const rankedAfter = afterRows.map((r) => ({
    ...r,
    _score: r.safetyAfter,
    _proj: r.projectionAfter,
    _conf: r.confidenceAfter,
  }));

  const bestSixBefore = selectBySafetyCaps(rankedBefore, "_score", BEST_SIX_LIMIT);
  const bestSixAfter = selectBySafetyCaps(rankedAfter, "_score", BEST_SIX_LIMIT);
  const top2Before = bestSixBefore.slice(0, TOP_TWO_LIMIT);
  const top2After = bestSixAfter.slice(0, TOP_TWO_LIMIT);

  const out = {
    ok: true,
    snapshotFile: path.resolve(file),
    slateDate: loaded.meta.slateDate,
    sourceLastUpdated: loaded.meta.sourceLastUpdated,
    candidateCount: candidateTable.length,
    generatedAt: new Date().toISOString(),
    note:
      "Offline same-snapshot before/after: applyPlayerRoleProfile false vs true. Not a live refresh.",
    toggle: {
      before: "applyPlayerRoleProfile=false (profileCalibration omitted — old path)",
      after: "applyPlayerRoleProfile=true (calibration applied, ±1.5 hard cap)",
      liveDefaultUnchanged: true,
    },
    originalSnapshotMembership: {
      bestSixDisplay: loaded.meta.originalBestSix,
      top2: loaded.meta.originalTop2,
    },
    candidateTable: candidateTable.sort(
      (a, b) => Math.abs(b.profileProjectionDelta) - Math.abs(a.profileProjectionDelta)
    ),
    bestSixBefore: summarizeBoard(bestSixBefore),
    bestSixAfter: summarizeBoard(bestSixAfter),
    bestSixDiff: boardDiff(bestSixBefore, bestSixAfter),
    top2Before: summarizeBoard(top2Before),
    top2After: summarizeBoard(top2After),
    top2Diff: boardDiff(top2Before, top2After),
  };

  const outPath = path.resolve(
    "betbrain-server/scripts/fixtures/player-role-profile-before-after-2026-07-14.json"
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  // Keep root copy for prior report path compatibility (compact)
  const legacyPath = path.resolve(
    "betbrain-server/.player-role-profile-before-after.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  fs.writeFileSync(legacyPath, JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        legacyPath,
        candidateCount: out.candidateCount,
        bestSixDiff: out.bestSixDiff,
        top2Diff: out.top2Diff,
      },
      null,
      2
    )
  );
  console.log("\n-- Candidate table --");
  for (const r of out.candidateTable) {
    console.log(
      `${r.player} ${r.side} ${r.line} | ${r.roleStability}/${r.scoringVolume}/${r.scoringVolatility}/${r.roleDirection} | proj ${r.projectionBefore}->${r.projectionAfter} (Δ${r.profileProjectionDelta}) conf ${r.confidenceBefore}->${r.confidenceAfter} safety ${r.safetyBefore}->${r.safetyAfter} | ${r.calibrationReasons.join("; ")}`
    );
  }
  console.log("\n-- Best 6 before --");
  for (const r of out.bestSixBefore) {
    console.log(`${r.rank}. ${r.player} ${r.side} ${r.line} safety=${r.safety}`);
  }
  console.log("-- Best 6 after --");
  for (const r of out.bestSixAfter) {
    console.log(`${r.rank}. ${r.player} ${r.side} ${r.line} safety=${r.safety}`);
  }
  console.log("\n-- Top 2 before --");
  for (const r of out.top2Before) {
    console.log(`${r.rank}. ${r.player} ${r.side} ${r.line} safety=${r.safety}`);
  }
  console.log("-- Top 2 after --");
  for (const r of out.top2After) {
    console.log(`${r.rank}. ${r.player} ${r.side} ${r.line} safety=${r.safety}`);
  }
}

main();
