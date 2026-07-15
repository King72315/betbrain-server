/**
 * Same-snapshot before/after comparison for courteedge-evidence-rank-v1.
 * Uses frozen /picks slim candidates (same odds/stat snapshot).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  selectBestSixDisplay,
  selectTopTwoFromBestSix,
  computeSafetyScore,
} from "../engines/topProps/controlledBestSixSelector.js";
import {
  evaluateSlateSameTeamOpportunity,
  applySameTeamOpportunityAdjustments,
  resolveImpliedTeamTotal,
} from "../engines/wnba/playerIntelligence/sameTeamOpportunityEngineV1.js";
import { applyEvidenceFinalConfidenceToPick } from "../engines/wnba/playerIntelligence/evidenceFinalConfidenceV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

const slimPath = path.join(
  root,
  "slate-snapshots",
  "freeze-2026-07-15-candidates-slim.json"
);
const slim = JSON.parse(fs.readFileSync(slimPath, "utf8"));

function sideOf(p) {
  return String(p.side || p.pick || "").toUpperCase();
}

function gapOf(p) {
  const proj = Number(p.projection);
  const line = Number(p.line);
  if (!Number.isFinite(proj) || !Number.isFinite(line)) return null;
  return sideOf(p).startsWith("U") ? line - proj : proj - line;
}

function hydrateImplied(pick) {
  const implied = resolveImpliedTeamTotal(pick);
  if (!(implied > 0)) return pick;
  return {
    ...pick,
    impliedTeamTotal: implied,
    impliedTeamTotalAudit: { value: implied, source: "home_away_resolve" },
    wnbaGameContext: {
      ...(pick.wnbaGameContext || {}),
      impliedTeamTotal: implied,
    },
  };
}

function summarize(p, rank = null) {
  return {
    rank,
    player: p.player,
    team: p.team,
    day: p.dayBucket || p.dateLabel || null,
    side: p.side || p.pick,
    line: p.line,
    projection: p.projection,
    gap: gapOf(p) ?? p.projectionGap ?? null,
    confidence: p.confidence ?? p.finalConfidence,
    flip:
      p.flipFirstAction ||
      p.decisionDataIntelligence?.flipFirstDecision?.action ||
      p.flipAction ||
      null,
    teamOpp:
      p.sameTeamOpportunityStatus ||
      p.sameTeamOpportunityAudit?.status ||
      null,
    trust: p.projectionTrustMultiplier ?? 1,
    collPenalty: p.slateCollisionPenalty ?? 0,
    evidencePenalty: p.evidenceRankPenalty ?? p.bothSidesWeakRankingPenalty ?? 0,
    bestPropScore: p.bestPropScore ?? p.pickScore ?? null,
    safety: Number(computeSafetyScore(p).toFixed(2)),
    flipped: Boolean(p.sameTeamOpportunityFlipEligible || p.flipFirstFlipped),
  };
}

const candidates = [];
for (const g of slim.games || []) {
  for (const raw of g.allGeneratedCandidates || g.picks || []) {
    candidates.push(
      hydrateImplied({
        ...raw,
        league: raw.league || "WNBA",
        dayBucket: raw.dayBucket || g.dayBucket,
        dateLabel: raw.dateLabel || g.dateLabel,
        game: raw.game || g.game,
        gameId: raw.gameId || g.gameId,
        isStarted: false,
        noPlay: false,
      })
    );
  }
}

const beforeBestSix = (slim.beforeBestSixDisplayWNBA || []).map((p, i) =>
  summarize(p, i + 1)
);

const oppEval = evaluateSlateSameTeamOpportunity(candidates);
const boardAfter = selectBestSixDisplay(candidates, "WNBA");
const afterBestSix = (boardAfter.bestSix || []).map((p, i) => summarize(p, i + 1));
const top = selectTopTwoFromBestSix(boardAfter.bestSix || [], "WNBA");
const afterTop = (top.topProps || []).map((p, i) => summarize(p, i + 1));

const focusNames = ["Stewart", "Ionescu", "Shepard", "Bueckers", "Howard", "Mitchell"];
const focusProps = candidates
  .filter((p) => focusNames.some((n) => String(p.player || "").includes(n)))
  .map((p) => {
    const adjusted = applySameTeamOpportunityAdjustments([p], oppEval)[0] || p;
    const withConf = applyEvidenceFinalConfidenceToPick(adjusted, {
      sameTeamOpportunity: adjusted.sameTeamOpportunityAudit,
    });
    return summarize({
      ...withConf,
      bestPropScore: withConf.bestPropScore ?? 50,
    });
  });

const beforeByKey = Object.fromEntries(
  beforeBestSix.map((p) => [`${p.player}|${p.line}|${String(p.side).toUpperCase()}`, p])
);
const afterByKey = Object.fromEntries(
  afterBestSix.map((p) => [`${p.player}|${p.line}|${String(p.side).toUpperCase()}`, p])
);
const allKeys = new Set([...Object.keys(beforeByKey), ...Object.keys(afterByKey)]);
const propDiffs = [...allKeys].map((k) => {
  const b = beforeByKey[k];
  const a = afterByKey[k];
  return {
    key: k,
    player: (a || b).player,
    beforeRank: b?.rank ?? null,
    afterRank: a?.rank ?? null,
    beforeConf: b?.confidence ?? null,
    afterConf: a?.confidence ?? null,
    beforeSide: b?.side ?? null,
    afterSide: a?.side ?? null,
    beforeFlip: b?.flip ?? null,
    afterFlip: a?.flip ?? null,
    afterOpp: a?.teamOpp ?? null,
    afterTrust: a?.trust ?? null,
    dropped: Boolean(b && !a),
    entered: Boolean(a && !b),
  };
});

const todayCandidates = candidates.filter((p) => String(p.dayBucket).toUpperCase() === "TODAY");
const tomorrowCandidates = candidates.filter(
  (p) => String(p.dayBucket).toUpperCase() === "TOMORROW"
);

const report = {
  generatedAt: new Date().toISOString(),
  beforeBuild: slim.serverBuild,
  afterBuild: "courteedge-evidence-rank-v1",
  freezeUpdated: slim.lastUpdated,
  candidateCount: candidates.length,
  todayCount: todayCandidates.length,
  tomorrowCount: tomorrowCandidates.length,
  sameTeamClusters: oppEval.teamClusters,
  beforeBestSix,
  afterBestSix,
  afterTop,
  propDiffs,
  focusCluster: focusProps,
  notes: [
    "Before ranks/confidence from frozen /picks at capture (courteedge-player-intel-v1).",
    "After ranks from same candidate projections/lines via evidence-final confidence + same-team opportunity + BOTH_SIDES_WEAK ranking.",
    "Implied team totals resolved from home/away game context when pick-level impliedTeamTotal was null.",
  ],
};

const outPath = path.join(
  root,
  "slate-snapshots",
  "evidence-rank-comparison-2026-07-15.json"
);
fs.writeFileSync(outPath, JSON.stringify(report, null, 2));

function printTable(title, rows) {
  console.log(`\n=== ${title} ===`);
  for (const r of rows) {
    console.log(
      `#${r.rank || "-"} ${r.player} ${r.side} ${r.line} | day=${r.day} conf=${r.confidence} gap=${r.gap} flip=${r.flip} opp=${r.teamOpp} trust=${r.trust} penalty=${r.collPenalty || r.evidencePenalty} safety=${r.safety}`
    );
  }
}

printTable("BEFORE Best 6", beforeBestSix);
printTable("AFTER Best 6", afterBestSix);
printTable("AFTER Top", afterTop);
console.log("\n=== Clusters ===");
console.log(JSON.stringify(oppEval.teamClusters, null, 2));
console.log("\n=== Focus props (Stewart/Ionescu/Shepard/Bueckers + Howard/Mitchell) ===");
console.log(JSON.stringify(focusProps, null, 2));
console.log("\n=== Diffs ===");
console.log(JSON.stringify(propDiffs, null, 2));
console.log(`\nwrote ${outPath}`);
