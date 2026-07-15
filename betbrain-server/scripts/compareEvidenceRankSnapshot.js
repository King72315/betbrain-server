/**
 * Same-snapshot before/after comparison for evidence-rank-v1.
 * Uses frozen /picks payload candidates; re-ranks with current selector.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { selectBestSixDisplay, computeSafetyScore } from "../engines/topProps/controlledBestSixSelector.js";
import { evaluateSlateSameTeamOpportunity } from "../engines/wnba/playerIntelligence/sameTeamOpportunityEngineV1.js";
import { applyEvidenceFinalConfidenceToPick } from "../engines/wnba/playerIntelligence/evidenceFinalConfidenceV1.js";
import { applySameTeamOpportunityAdjustments } from "../engines/wnba/playerIntelligence/sameTeamOpportunityEngineV1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const beforeRaw = JSON.parse(
  fs.readFileSync(path.join(root, ".tmp-evidence-before-raw.json"), "utf8")
);
const candidates = JSON.parse(
  fs.readFileSync(path.join(root, ".tmp-evidence-before-candidates.json"), "utf8")
);

function sideOf(p) {
  return String(p.side || p.pick || "").toUpperCase();
}
function gapOf(p) {
  const proj = Number(p.projection);
  const line = Number(p.line);
  if (!Number.isFinite(proj) || !Number.isFinite(line)) return null;
  return sideOf(p).startsWith("U") ? line - proj : proj - line;
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
    gap: gapOf(p),
    confidence: p.confidence ?? p.finalConfidence,
    flip: p.flipFirstAction || p.decisionDataIntelligence?.flipFirstDecision?.action || null,
    teamOpp:
      p.sameTeamOpportunityStatus ||
      p.sameTeamOpportunityAudit?.status ||
      p.decisionDataIntelligence?.sameTeamOpportunity?.status ||
      null,
    trust: p.projectionTrustMultiplier ?? 1,
    collPenalty: p.slateCollisionPenalty ?? 0,
    evidencePenalty: p.evidenceRankPenalty ?? p.bothSidesWeakRankingPenalty ?? 0,
    bestPropScore: p.bestPropScore ?? p.pickScore,
    safety: Number(computeSafetyScore(p).toFixed(2)),
    flipped: Boolean(p.sameTeamOpportunityFlipEligible || p.flipFirstFlipped),
  };
}

function beforeBestSix() {
  return (beforeRaw.bestSixDisplayWNBA || beforeRaw.bestSixWNBA || []).map((p, i) =>
    summarize(p, i + 1)
  );
}

function beforeTop() {
  return (beforeRaw.topWNBAProps || beforeRaw.topProps || []).map((p, i) =>
    summarize(p, i + 1)
  );
}

// Enrich dayBucket on game-sourced candidates that lost it
for (const p of candidates) {
  if (!p.dayBucket && !p.dateLabel) {
    // Try match from before Best 6 / board
    const hit = [...(beforeRaw.bestSixDisplayWNBA || []), ...(beforeRaw.boardCappedProps || [])].find(
      (x) => x.player === p.player && Number(x.line) === Number(p.line)
    );
    if (hit) p.dayBucket = hit.dayBucket || hit.dateLabel;
  }
  if (!p.league) p.league = "WNBA";
}

const oppEval = evaluateSlateSameTeamOpportunity(candidates);
const adjusted = applySameTeamOpportunityAdjustments(candidates, oppEval).map((p) =>
  applyEvidenceFinalConfidenceToPick(p, {
    sameTeamOpportunity: p.sameTeamOpportunityAudit || p.slateCollisionAudit,
  })
);

const display = selectBestSixDisplay(adjusted.length ? adjusted : candidates, "WNBA");
const afterBestSix = (display.bestSix || []).map((p, i) => summarize(p, i + 1));

// Top = first 1–2 by safety among Best 6 (mirror prod limit)
const afterTop = [...afterBestSix]
  .sort((a, b) => b.safety - a.safety)
  .slice(0, 2)
  .map((p, i) => ({ ...p, rank: i + 1 }));

const beforeByKey = Object.fromEntries(
  beforeBestSix().map((p) => [`${p.player}|${p.line}|${p.side}`, p])
);
const afterByKey = Object.fromEntries(
  afterBestSix.map((p) => [`${p.player}|${p.line}|${p.side}`, p])
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
    beforeOpp: b?.teamOpp ?? null,
    afterOpp: a?.teamOpp ?? null,
    afterTrust: a?.trust ?? null,
    dropped: Boolean(b && !a),
    entered: Boolean(a && !b),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  beforeBuild: beforeRaw.serverBuild,
  afterBuild: "courteedge-evidence-rank-v1",
  candidateCount: candidates.length,
  sameTeamClusters: oppEval.teamClusters,
  beforeBestSix: beforeBestSix(),
  afterBestSix,
  beforeTop: beforeTop(),
  afterTop,
  propDiffs,
  notes: [
    "Before ranks/confidence from frozen /picks (running server at capture time).",
    "After ranks from same candidate projections/lines re-scored via evidence-final confidence + same-team opportunity + BOTH_SIDES_WEAK ranking.",
    "Stewart/Ionescu/Shepard/Bueckers cluster not present on this frozen slate; Fever / Lynx / Tempo / Fire Over clusters evaluated instead.",
  ],
};

fs.writeFileSync(
  path.join(root, ".tmp-evidence-rank-comparison.json"),
  JSON.stringify(report, null, 2)
);

console.log(JSON.stringify(report, null, 2));
