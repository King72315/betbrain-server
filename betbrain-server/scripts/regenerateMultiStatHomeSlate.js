/**
 * ODDS-ONLY DIAGNOSTIC TOOL — NOT production Product Truth authority.
 *
 * CourtEdge Grade-A Recovery V3:
 * This script bypasses projection → fair → Safety → Risk and must NOT write
 * production Trusted/Home Product Truth unless explicitly opted in for
 * forensic rematerialization.
 *
 * Usage (diagnostic only):
 *   COURTEDGE_ALLOW_ODDS_ONLY_DIAGNOSTIC=1 node scripts/regenerateMultiStatHomeSlate.js [YYYY-MM-DD]
 *
 * Without the env flag, this script exits without mutating stores.
 */
import {
  buildConsensusPlayerProps,
  fetchOddsGameCards,
  fetchPlayerPropMarketsForEvent,
  findOddsEventForGame,
} from "../services/oddsService.js";
import { normalizePropTypeV1 } from "../engines/wnba/propTypeV1.js";
import {
  buildCanonicalPredictionRecord,
  upsertCanonicalPredictionRecords,
  purgeCanonicalRecordsForSlate,
} from "../services/courtEdgeCanonicalPredictionRecordV1.js";
import { getTodayLocalDate } from "../services/slateScopeService.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED =
  String(process.env.COURTEDGE_ALLOW_ODDS_ONLY_DIAGNOSTIC || "")
    .trim()
    .toLowerCase() === "1" ||
  String(process.env.COURTEDGE_ALLOW_ODDS_ONLY_DIAGNOSTIC || "")
    .trim()
    .toLowerCase() === "true";

const slateDateCt = String(process.argv[2] || getTodayLocalDate()).slice(0, 10);

if (!ALLOWED) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        blocked: true,
        reason: "ODDS_ONLY_REGENERATE_BLOCKED_FROM_PRODUCTION",
        message:
          "regenerateMultiStatHomeSlate.js is diagnostic-only (projection/Safety/Risk null). Set COURTEDGE_ALLOW_ODDS_ONLY_DIAGNOSTIC=1 to write RESEARCH diagnostic rows only — never Trusted/Official.",
        slateDateCt,
      },
      null,
      2
    )
  );
  process.exit(2);
}

function impliedFromAmerican(odds) {
  const n = Number(odds);
  if (!Number.isFinite(n) || n === 0) return null;
  if (n > 0) return 100 / (n + 100);
  return -n / (-n + 100);
}

function pickSideAndProb(prop = {}) {
  const pOver = impliedFromAmerican(prop.overOdds);
  const pUnder = impliedFromAmerican(prop.underOdds);
  if (pOver == null && pUnder == null) {
    return { side: "OVER", prob: 0.5 };
  }
  if (pOver == null) return { side: "UNDER", prob: pUnder };
  if (pUnder == null) return { side: "OVER", prob: pOver };
  return pOver >= pUnder
    ? { side: "OVER", prob: pOver }
    : { side: "UNDER", prob: pUnder };
}

/** V3: no per-stat truncation — all consensus props with proven propType. */
function selectAllValidMarkets(propsAll) {
  const out = [];
  for (const p of Array.isArray(propsAll) ? propsAll : []) {
    const pt = normalizePropTypeV1(p.propType || p.stat);
    if (!pt) continue;
    out.push({
      ...p,
      propType: pt,
      canonicalPropType: pt,
      stat:
        pt === "REBOUNDS" ? "Rebounds" : pt === "ASSISTS" ? "Assists" : "Points",
    });
  }
  return out;
}

const games = await fetchOddsGameCards("WNBA", { daysFrom: 0, daysTo: 1 });
const todayGames = (games || []).filter(
  (g) => String(g.date || g.slateDate || "").slice(0, 10) === slateDateCt
);

const candidates = [];
const byTypeRaw = { POINTS: 0, REBOUNDS: 0, ASSISTS: 0 };

for (const game of todayGames.length ? todayGames : games || []) {
  const oddsEvent = await findOddsEventForGame(game, "WNBA");
  if (!oddsEvent?.id) continue;
  const raw = await fetchPlayerPropMarketsForEvent(oddsEvent.id, "WNBA", [
    "player_points",
    "player_rebounds",
    "player_assists",
  ]);
  const consensus = buildConsensusPlayerProps(raw);
  const analyzed = selectAllValidMarkets(consensus);
  for (const prop of analyzed) {
    const pt = normalizePropTypeV1(prop.propType || prop.stat);
    if (!pt) continue;
    byTypeRaw[pt] = (byTypeRaw[pt] || 0) + 1;
    const { side, prob } = pickSideAndProb(prop);
    const mq = Number(prop.marketQuality || 0) / 100;
    const books = Math.min(1, Number(prop.bookCount || 0) / 6);
    const decisionScoreV2 = Number(
      (0.7 * (prob || 0.5) + 0.2 * mq + 0.1 * books).toFixed(4)
    );
    candidates.push({
      league: "WNBA",
      slateDate: slateDateCt,
      slateDateCt,
      playerName: prop.player || prop.playerName,
      team: prop.team || game.homeTeam || game.awayTeam,
      opponent: prop.opponent,
      gameId: oddsEvent.id,
      propType: pt,
      canonicalPropType: pt,
      stat: prop.stat,
      marketType: prop.marketType || prop.marketKey,
      side,
      pick: side,
      selectedSide: side,
      line: prop.line,
      projection: null,
      fairLine: null,
      safetyScore: null,
      risk: null,
      predictedProbability: prob,
      modelWinProbability: decisionScoreV2,
      decisionScoreV2,
      membership: "RESEARCH",
      officialSelected: false,
      trackingType: "RESEARCH",
      boardCandidate: true,
      bookCount: prop.bookCount,
      marketQuality: prop.marketQuality,
      overOdds: prop.overOdds,
      underOdds: prop.underOdds,
      reconstructionConfidence: "CLEAN_PROSPECTIVE",
      diagnosticOddsOnly: true,
      productionAuthority: false,
      decisionAuthority: "ODDS_ONLY_DIAGNOSTIC_NOT_PRODUCTION",
      game: game.game || `${game.awayTeam} vs ${game.homeTeam}`,
    });
  }
}

const records = candidates
  .map((s) => buildCanonicalPredictionRecord(s))
  .filter((b) => b?.ok && b.record)
  .map((b) => ({
    ...b.record,
    membership: "RESEARCH",
    officialSelected: false,
    diagnosticOddsOnly: true,
    productionAuthority: false,
    modelWinProbability: candidates.find(
      (c) =>
        c.playerName === b.record.playerName &&
        c.propType === b.record.propType &&
        Number(c.line) === Number(b.record.line)
    )?.modelWinProbability,
    decisionScoreV2: candidates.find(
      (c) =>
        c.playerName === b.record.playerName &&
        c.propType === b.record.propType &&
        Number(c.line) === Number(b.record.line)
    )?.decisionScoreV2,
  }));

const purge = purgeCanonicalRecordsForSlate(slateDateCt, {
  membership: "RESEARCH",
});
const upsert = upsertCanonicalPredictionRecords(records);

const outDir = path.join(
  __dirname,
  "..",
  "research",
  "courteedge-grade-a-recovery-v3",
  "05-canonical-pipeline"
);
fs.mkdirSync(outDir, { recursive: true });
const artifact = {
  ok: true,
  diagnosticOnly: true,
  productionAuthority: false,
  slateDateCt,
  note: "Odds-only RESEARCH diagnostic rows — incomplete packet; cannot be Trusted",
  gamesConsidered: (todayGames.length ? todayGames : games || []).length,
  candidatesByMarket: byTypeRaw,
  candidateTotal: candidates.length,
  purge,
  upserted: upsert,
};
fs.writeFileSync(
  path.join(outDir, `odds-only-diagnostic-${slateDateCt}.json`),
  JSON.stringify(artifact, null, 2)
);

console.log(JSON.stringify(artifact, null, 2));
