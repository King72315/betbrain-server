/**
 * Shadow replay: 06/22 live board from /wnba-picks or /top-props.
 * Read-only — does not track to Results.
 *
 * Usage:
 *   node betbrain-server/scripts/replayWnbaShadow0622.js [baseUrl]
 */
import { applyWnbaShadowRecalibration } from "../engines/wnbaShadowEngine.js";

const BASE =
  process.argv[2] || process.env.API_URL || "https://betbrain-server-1.onrender.com";

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

function flattenPicks(payload = {}) {
  const picks = [];
  const games =
    payload.gameCards ||
    payload.games ||
    payload.wnbaGames ||
    payload.topWNBAProps ||
    payload.topProps ||
    [];

  if (Array.isArray(games) && games.length && games[0]?.picks) {
    for (const game of games) {
      for (const pick of game.picks || []) {
        picks.push({ ...pick, league: pick.league || game.league || "WNBA" });
      }
    }
    return picks;
  }

  if (Array.isArray(games)) {
    return games.filter((p) => String(p.league || "").toUpperCase() === "WNBA");
  }

  return [];
}

async function loadWnbaPicks() {
  try {
    const wnba = await fetchJson("/wnba-picks");
    const picks = flattenPicks(wnba);
    if (picks.length) return { source: "/wnba-picks", picks };
  } catch (err) {
    console.log("wnba-picks unavailable:", err.message);
  }

  const top = await fetchJson("/top-props");
  const picks = flattenPicks(top).filter(
    (p) => String(p.league || "").toUpperCase() === "WNBA"
  );
  return { source: "/top-props", picks };
}

const { source, picks } = await loadWnbaPicks();

console.log(`\n=== WNBA Shadow Replay 06/22 (live board) ===`);
console.log(`Source: ${BASE}${source}`);
console.log(`WNBA picks: ${picks.length}\n`);

const results = picks.map((pick) => {
  const shadow = applyWnbaShadowRecalibration(pick);
  return {
    player: pick.player,
    side: pick.side || pick.pick,
    line: pick.line ?? pick.sportsbookLine,
    gameDate: pick.gameDate || pick.date,
    officialTier: pick.tier,
    shadowTier: shadow?.shadowTier ?? pick.tier,
    officialPickScore: pick.pickScore,
    shadowPickScore: shadow?.shadowPickScore ?? pick.pickScore,
    gap: shadow?.gapEval?.gap,
    gapPasses: shadow?.gapEval?.passes,
    lineMovementAgainstSide: shadow?.lineMovementAgainstSide,
    fairLineSuppressed: shadow?.fairLineShadow?.fairLineBoostSuppressed,
    shadowReasons: shadow?.shadowTierReasons || [],
  };
});

for (const row of results) {
  console.log(
    `${row.player} ${row.side} ${row.line} | tier ${row.officialTier}→${row.shadowTier} | score ${row.officialPickScore}→${row.shadowPickScore} | gap=${row.gap} pass=${row.gapPasses}`
  );
}

console.log("\n--- Summary ---");
console.log(`Total WNBA board props: ${results.length}`);
console.log(
  `Would demote tier: ${results.filter((r) => r.officialTier !== r.shadowTier).length}`
);
console.log(
  `Gap floor fails: ${results.filter((r) => r.gapPasses === false).length}`
);
console.log(
  `Fair line suppressed: ${results.filter((r) => r.fairLineSuppressed).length}`
);
