/**
 * Same-snapshot before/after for Player Role Profile v1.
 * Replays profile calibration on frozen pick payloads — no live refresh / no prod mutation.
 *
 * Usage:
 *   node betbrain-server/scripts/comparePlayerRoleProfileSnapshot.js [picksJsonPath]
 */
import fs from "fs";
import path from "path";
import {
  buildPlayerRoleProfile,
  buildPlayerProfileCalibration,
  CALIBRATION_CAPS,
} from "../engines/playerRoleProfileV1.js";
import { projectWnbaPoints } from "../engines/wnba/wnbaProjectionEngine.js";
import { computeSafetyScore } from "../engines/topProps/controlledBestSixSelector.js";

function num(v, fb = null) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fb;
}

function loadPicks(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const pools = [];
  if (Array.isArray(raw)) pools.push(...raw);
  if (Array.isArray(raw.props)) pools.push(...raw.props);
  if (Array.isArray(raw.topProps)) pools.push(...raw.topProps);
  if (Array.isArray(raw.bestSix)) pools.push(...raw.bestSix);
  if (Array.isArray(raw.candidates)) pools.push(...raw.candidates);
  if (Array.isArray(raw.wnbaProps)) pools.push(...raw.wnbaProps);
  if (raw.byLeague?.WNBA) {
    const w = raw.byLeague.WNBA;
    if (Array.isArray(w)) pools.push(...w);
    if (Array.isArray(w.props)) pools.push(...w.props);
    if (Array.isArray(w.bestSix)) pools.push(...w.bestSix);
    if (Array.isArray(w.topProps)) pools.push(...w.topProps);
  }
  // Controlled best six boards
  for (const key of ["homeBestSix", "controlledBestSix", "displayBestSix"]) {
    if (Array.isArray(raw[key])) pools.push(...raw[key]);
  }
  const seen = new Set();
  const uniq = [];
  for (const p of pools) {
    if (!p || typeof p !== "object") continue;
    if (String(p.league || "").toUpperCase() !== "WNBA" && !p.wnbaDataCard) continue;
    const k = `${p.player}|${p.line}|${p.side || p.pick}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  return uniq;
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
  // Fallback synthetic window from averages (marked as fallback)
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

function comparePick(pick) {
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

  const beforeProj = projectWnbaPoints({
    seasonMinutes: seasonMinutes || 0,
    recentMinutes: recentMinutes || 0,
    seasonFGA: seasonFga || 0,
    recentFGA: recentFga || 0,
    seasonFTA: seasonFta || 0,
    recentFTA: recentFta || 0,
    seasonPoints: seasonPoints || 0,
    recentPoints: recentPoints || 0,
    roleChange: pick.roleChange || {},
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

  const afterProj = projectWnbaPoints({
    seasonMinutes: seasonMinutes || 0,
    recentMinutes: recentMinutes || 0,
    seasonFGA: seasonFga || 0,
    recentFGA: recentFga || 0,
    seasonFTA: seasonFta || 0,
    recentFTA: recentFta || 0,
    seasonPoints: seasonPoints || 0,
    recentPoints: recentPoints || 0,
    roleChange: pick.roleChange || {},
    profileCalibration: calibration,
  });

  const confBefore = num(pick.confidence ?? pick.finalConfidence, null);
  const confAfter =
    confBefore === null
      ? null
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

  const pickBefore = { ...pick, playerProfileCalibration: null };
  const pickAfter = {
    ...pick,
    playerRoleProfile: profile,
    playerProfileCalibration: calibration,
    projection: afterProj.projection,
    confidence: confAfter ?? pick.confidence,
  };

  return {
    player: pick.player,
    side: pick.side || pick.pick,
    line,
    bookCount: pick.bookCount ?? null,
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
    overRequiredEdgeAdj: calibration.overRequiredEdgeAdjustment,
    underRequiredEdgeAdj: calibration.underRequiredEdgeAdjustment,
    rankingAdjustment: calibration.rankingAdjustment,
    riskDebtIds: calibration.riskDebtIds,
    riskRepairIds: calibration.riskRepairIds,
    calibrationReasons: calibration.calibrationReasons,
    safetyBefore: Number(computeSafetyScore(pickBefore).toFixed(1)),
    safetyAfter: Number(computeSafetyScore(pickAfter).toFixed(1)),
    maxProjCap: CALIBRATION_CAPS.maxProjectionMovement,
  };
}

function main() {
  const arg = process.argv[2];
  const candidates = [
    arg,
    path.resolve("betbrain-server/.player-role-profile-snapshot.json"),
    path.resolve(".tmp-poll-picks-0713-after.json"),
    path.resolve(".tmp-live-picks.json"),
    path.resolve(".tmp-prod-picks-0712-live.json"),
  ].filter(Boolean);

  let file = null;
  let picks = [];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      try {
        picks = loadPicks(c);
        if (picks.length) {
          file = c;
          break;
        }
      } catch {
        /* try next */
      }
    }
  }

  if (!file || !picks.length) {
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

  const rows = picks.map(comparePick);
  const sorted = [...rows].sort(
    (a, b) => Math.abs(b.profileProjectionDelta) - Math.abs(a.profileProjectionDelta)
  );

  const out = {
    ok: true,
    snapshotFile: file,
    candidateCount: rows.length,
    generatedAt: new Date().toISOString(),
    note:
      "Offline same-snapshot replay of playerRoleProfileV1 calibration. Not a live refresh.",
    rows: sorted,
    bestSixHint: sorted.slice(0, 6).map((r) => ({
      player: r.player,
      side: r.side,
      line: r.line,
      delta: r.profileProjectionDelta,
      role: `${r.roleStability}/${r.scoringVolume}/${r.roleDirection}`,
      safetyDelta: Number((r.safetyAfter - r.safetyBefore).toFixed(1)),
    })),
  };

  const outPath = path.resolve(
    "betbrain-server/.player-role-profile-before-after.json"
  );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ok: true, outPath, candidateCount: rows.length }, null, 2));
  for (const r of sorted.slice(0, 12)) {
    console.log(
      `${r.player} ${r.side} ${r.line} | ${r.roleStability}/${r.scoringVolume}/${r.scoringVolatility}/${r.roleDirection} | proj ${r.projectionBefore}->${r.projectionAfter} (Δ${r.profileProjectionDelta}) conf ${r.confidenceBefore}->${r.confidenceAfter}`
    );
  }
}

main();
