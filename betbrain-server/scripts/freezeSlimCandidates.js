/**
 * Build a circular-safe slim candidate freeze from a full /picks dump.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function safeClone(obj, depth = 5) {
  const seen = new WeakSet();
  function rec(v, d) {
    if (v == null || typeof v !== "object") return v;
    if (seen.has(v)) return undefined;
    if (d <= 0) return undefined;
    seen.add(v);
    if (Array.isArray(v)) {
      return v.map((x) => rec(x, d - 1)).filter((x) => x !== undefined);
    }
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "parent" || k === "root") continue;
      try {
        const c = rec(val, d - 1);
        if (c !== undefined) out[k] = c;
      } catch {
        /* skip */
      }
    }
    return out;
  }
  return rec(obj, depth);
}

const src =
  process.argv[2] ||
  path.join(ROOT, "slate-snapshots", "freeze-2026-07-15-before-evidence-rank.json");
const dest =
  process.argv[3] ||
  path.join(ROOT, "slate-snapshots", "freeze-2026-07-15-candidates-slim.json");

let raw = fs.readFileSync(src, "utf8");
if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
const r = JSON.parse(raw);
const games = [];

for (const g of r.games || []) {
  const pool = g.allGeneratedCandidates?.length
    ? g.allGeneratedCandidates
    : g.picks || [];
  const picks = pool.map((p) => {
    const card = p.wnbaDataCard || {};
    const reader = p.wnbaReader || {};
    return {
      player: p.player,
      team: p.team,
      opponent: p.opponent,
      league: p.league || "WNBA",
      side: p.side || p.pick,
      pick: p.pick || p.side,
      line: p.line,
      projection: p.projection,
      confidence: p.confidence,
      finalConfidence: p.finalConfidence,
      dataConfidence: p.dataConfidence,
      directionalConfidence: p.directionalConfidence,
      dayBucket: p.dayBucket || g.dayBucket,
      game: p.game || g.game,
      gameId: p.gameId || g.gameId,
      dateLabel: p.dateLabel || g.dateLabel,
      flipFirstAction:
        p.flipFirstAction ||
        p.decisionDataIntelligence?.flipFirstDecision?.action ||
        null,
      projectionGap: reader.projectionGap ?? p.projectionGap ?? null,
      overGap: reader.overGap ?? null,
      underGap: reader.underGap ?? null,
      overCaseScore: reader.overCase?.score ?? null,
      underCaseScore: reader.underCase?.score ?? null,
      impliedTeamTotal:
        p.impliedTeamTotalAudit?.value ||
        p.wnbaGameContext?.impliedTeamTotal ||
        card.gameEnvironment?.impliedTeamTotal ||
        null,
      expectedFGA:
        p.expectedFGA ||
        card.projection?.expectedFGA ||
        card.last5?.fga ||
        null,
      expectedFTA:
        p.expectedFTA ||
        card.projection?.expectedFTA ||
        card.last5?.fta ||
        null,
      recentMinutes: card.last5?.minutes ?? p.recentMinutes ?? null,
      marketQuality: p.marketQuality ?? card.marketQuality ?? null,
      bookCount: p.bookCount ?? card.bookCount ?? null,
      lineSpread: p.lineSpread ?? card.lineSpread ?? null,
      roleStabilityScore:
        p.playerRoleProfile?.roleStabilityScore ||
        card.playerRoleProfile?.roleStabilityScore ||
        null,
      usageProfile:
        p.playerRoleProfile?.usageProfile ||
        card.playerRoleProfile?.usageProfile ||
        null,
      profileConfidence:
        p.playerRoleProfile?.profileConfidence ||
        card.playerRoleProfile?.profileConfidence ||
        null,
      riskDebtCodes: (p.decisionIntelligence?.riskDebts || [])
        .map((d) => d.code || d)
        .filter(Boolean),
      trueRisk: p.decisionIntelligence?.trueRisk || p.trueRisk || null,
      trackEligibility: p.decisionIntelligence?.trackEligibility || null,
      influenceAdj:
        p.decisionDataIntelligence?.finalInfluence?.confidenceAdjustment ??
        null,
      marketSideImpact:
        p.decisionDataIntelligence?.marketIntelligence?.sideImpact || null,
      marketWarning:
        p.decisionDataIntelligence?.marketIntelligence?.marketWarning || false,
      projectionQualityStatus:
        p.decisionDataIntelligence?.projectionQuality?.status || null,
      wnbaDataCard: safeClone(card, 5),
      wnbaReader: safeClone(reader, 5),
      wnbaGameContext: safeClone(p.wnbaGameContext || {}, 4),
      playerRoleProfile: safeClone(
        p.playerRoleProfile || card.playerRoleProfile || {},
        4
      ),
      playerProfileCalibration: safeClone(
        p.playerProfileCalibration || card.playerProfileCalibration || {},
        4
      ),
      decisionDataIntelligence: safeClone(p.decisionDataIntelligence || {}, 4),
      decisionIntelligence: safeClone(p.decisionIntelligence || {}, 4),
      initialSide: p.initialSide || null,
      volumeDangerGates: safeClone(p.volumeDangerGates || {}, 3),
      isStarted: false,
      noPlay: false,
    };
  });
  games.push({
    gameId: g.gameId,
    game: g.game,
    league: g.league || "WNBA",
    dayBucket: g.dayBucket,
    dateLabel: g.dateLabel,
    homeTeam: g.homeTeam,
    awayTeam: g.awayTeam,
    commenceTime: g.commenceTime,
    isStarted: false,
    picks,
    allGeneratedCandidates: picks,
  });
}

const beforeBestSixDisplayWNBA = (r.bestSixDisplayWNBA || []).map((p, i) => ({
  rank: i + 1,
  player: p.player,
  side: p.side || p.pick,
  line: p.line,
  projection: p.projection,
  confidence: p.confidence,
  dayBucket: p.dayBucket,
  team: p.team,
  flip:
    p.flipFirstAction ||
    p.decisionDataIntelligence?.flipFirstDecision?.action ||
    null,
  sameTeamOpportunityStatus: p.sameTeamOpportunityStatus || null,
  slateCollisionPenalty: p.slateCollisionPenalty || 0,
}));

const out = {
  serverBuild: r.serverBuild,
  lastUpdated: r.lastUpdated,
  beforeBestSixDisplayWNBA,
  games,
};

fs.writeFileSync(dest, JSON.stringify(out));
const count = games.reduce((s, g) => s + g.picks.length, 0);
process.stdout.write(
  `wrote ${dest} bytes=${fs.statSync(dest).size} candidates=${count} best6=${beforeBestSixDisplayWNBA.length}\n`
);
for (const row of beforeBestSixDisplayWNBA) {
  process.stdout.write(
    `BEFORE ${row.rank}|${row.player}|${row.side}|${row.line}|conf=${row.confidence}|day=${row.dayBucket}|flip=${row.flip}\n`
  );
}
for (const g of games.filter((x) => x.dayBucket === "TOMORROW")) {
  process.stdout.write(`TOMORROW ${g.game}\n`);
  for (const p of g.picks) {
    process.stdout.write(
      `  ${p.player}|${p.side}|${p.line}|proj=${p.projection}|conf=${p.confidence}|flip=${p.flipFirstAction}|implied=${p.impliedTeamTotal}|fga=${p.expectedFGA}\n`
    );
  }
}
