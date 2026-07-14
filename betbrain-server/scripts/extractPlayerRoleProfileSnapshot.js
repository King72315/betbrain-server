/**
 * Build a compact tomorrow WNBA fixture from a frozen /picks dump.
 * Usage:
 *   node betbrain-server/scripts/extractPlayerRoleProfileSnapshot.js [picksJson] [slateDate]
 */
import fs from "fs";
import path from "path";

const SRC =
  process.argv[2] ||
  path.resolve(".tmp-poll-picks-0713-after.json");
const SLATE = process.argv[3] || "2026-07-14";

function slimCandidate(p, membership) {
  return {
    player: p.player,
    side: p.side || p.pick,
    line: p.line,
    league: "WNBA",
    team: p.team || p.playerState?.team || null,
    opponent: p.opponent || p.playerState?.opponent || null,
    game: p.game || p.gameId || null,
    gameDate: p.gameDate || p.date,
    commenceTime: p.commenceTime || p.playerState?.commenceTime || null,
    bookCount: p.bookCount ?? p.playerState?.bookCount ?? null,
    confidence: p.confidence ?? p.finalConfidence ?? null,
    projection: p.projection ?? null,
    bestPropScore: p.bestPropScore ?? p.pickScore ?? null,
    pickScore: p.pickScore ?? p.bestPropScore ?? null,
    winProbability: p.winProbability ?? null,
    dangerGateCount:
      p.dangerGateCount ?? p.decisionIntelligence?.dangerGateCount ?? null,
    minutesStabilityScore: p.minutesStabilityScore ?? null,
    volumeStabilityScore: p.volumeStabilityScore ?? null,
    trackingEligibility:
      p.trackingEligibility ||
      p.wnbaTrackingDecision ||
      p.decisionIntelligence?.trackEligibility ||
      null,
    decisionIntelligence: p.decisionIntelligence
      ? {
          dangerGateCount: p.decisionIntelligence.dangerGateCount ?? null,
          repairScore: p.decisionIntelligence.repairScore ?? null,
          riskDebts: p.decisionIntelligence.riskDebts || [],
          killReasons: p.decisionIntelligence.killReasons || [],
          minutesStabilityScore:
            p.decisionIntelligence.minutesStabilityScore ?? null,
          volumeStabilityScore:
            p.decisionIntelligence.volumeStabilityScore ?? null,
          trackEligibility: p.decisionIntelligence.trackEligibility ?? null,
          bestSixPromoted: p.decisionIntelligence.bestSixPromoted ?? false,
          promotionReasons: p.decisionIntelligence.promotionReasons || [],
        }
      : null,
    roleChange: p.roleChange || null,
    playerState: p.playerState
      ? {
          seasonPoints: p.playerState.seasonPoints,
          recentPoints: p.playerState.recentPoints,
          seasonMinutes: p.playerState.seasonMinutes,
          recentMinutes: p.playerState.recentMinutes,
          seasonFGA: p.playerState.seasonFGA,
          recentFGA: p.playerState.recentFGA,
          seasonFTA: p.playerState.seasonFTA,
          recentFTA: p.playerState.recentFTA,
          gameDate: p.playerState.gameDate,
        }
      : null,
    recentMinutes: p.recentMinutes ?? p.playerState?.recentMinutes ?? null,
    recentFGA: p.recentFGA ?? p.playerState?.recentFGA ?? null,
    recentFTA: p.recentFTA ?? p.playerState?.recentFTA ?? null,
    last5Average: p.last5Average ?? p.playerState?.recentPoints ?? null,
    seasonAverage: p.seasonAverage ?? p.playerState?.seasonPoints ?? null,
    wnbaDataCard: p.wnbaDataCard
      ? {
          last5: p.wnbaDataCard.last5 || null,
        }
      : null,
    inBestSixDisplay: membership.inBestSixDisplay,
    inTopProps: membership.inTopProps,
  };
}

function keyOf(p) {
  return [p.player, p.side || p.pick, p.line].join("|");
}

function main() {
  if (!fs.existsSync(SRC)) {
    console.error(JSON.stringify({ ok: false, reason: "missing source", SRC }));
    process.exit(1);
  }
  const j = JSON.parse(fs.readFileSync(SRC, "utf8"));
  const bestSix = j.bestSixDisplayWNBA || [];
  const top = [...(j.topWNBAProps || []), ...(j.topProps || [])];
  const pools = [
    ...(j.boardCappedProps || []),
    ...bestSix,
    ...top,
  ];

  const seen = new Set();
  const candidates = [];
  for (const p of pools) {
    if ((p.gameDate || p.date) !== SLATE) continue;
    if (String(p.league || "").toUpperCase() !== "WNBA" && !p.wnbaDataCard) {
      continue;
    }
    const k = keyOf(p);
    if (seen.has(k)) continue;
    seen.add(k);
    candidates.push(
      slimCandidate(p, {
        inBestSixDisplay: bestSix.some((x) => keyOf(x) === k),
        inTopProps: top.some((x) => keyOf(x) === k),
      })
    );
  }

  const originalBestSix = bestSix
    .filter((p) => (p.gameDate || p.date) === SLATE)
    .map((p) => ({ player: p.player, side: p.side || p.pick, line: p.line }));
  const originalTop2 = top
    .filter((p) => (p.gameDate || p.date) === SLATE)
    .slice(0, 2)
    .map((p) => ({ player: p.player, side: p.side || p.pick, line: p.line }));

  const out = {
    ok: true,
    slateDate: SLATE,
    league: "WNBA",
    sourceFile: path.resolve(SRC),
    capturedAt: new Date().toISOString(),
    sourceLastUpdated: j.lastUpdated || null,
    note:
      "Compact same-snapshot fixture for offline playerRoleProfile before/after. No live mutation.",
    originalBestSixDisplay: originalBestSix,
    originalTop2: originalTop2,
    candidateCount: candidates.length,
    candidates,
  };

  fs.mkdirSync(path.resolve("betbrain-server/scripts/fixtures"), {
    recursive: true,
  });
  const outPath = path.resolve(
    `betbrain-server/scripts/fixtures/player-role-profile-wnba-${SLATE}-snapshot.json`
  );
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        ok: true,
        outPath,
        bytes: fs.statSync(outPath).size,
        candidateCount: candidates.length,
        originalBestSix,
        originalTop2,
      },
      null,
      2
    )
  );
}

main();
