/**
 * Shadow counterfactual for Two-Slate Deep Calibration V1.
 * Does NOT mutate Product Truth / frozen 8/13 or 8/14 records.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  trainDecisionEngineV2,
  selectOfficialMembershipV2,
  scoreCandidateV2,
  fitStatProjectionModels,
} from "../../services/courtEdgeDecisionEngineV2.js";
import { buildDecisionCorpusV2 } from "../../services/courtEdgeDecisionCorpusV2.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = path.join(__dirname, "../..");
const ROOT = path.join(
  SERVER_ROOT,
  "research",
  "courteedge-two-slate-deep-calibration-v1"
);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeJson(p, obj) {
  ensureDir(path.dirname(p));
  fs.writeFileSync(p, JSON.stringify(obj, null, 2));
}

function keyOf(r) {
  const player = String(r.playerName || r.player || "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  const side = String(r.side || r.selectedSide || "").toUpperCase();
  return `${player}|${r.propType}|${side}|${r.line}`;
}

function gradeOf(r) {
  return String(r.grade || r.result?.grade || "PENDING").toUpperCase();
}

function wl(rows) {
  const g = rows.filter((r) => {
    const x = gradeOf(r);
    return x === "WIN" || x === "LOSS";
  });
  const w = g.filter((r) => gradeOf(r) === "WIN").length;
  const l = g.filter((r) => gradeOf(r) === "LOSS").length;
  return {
    WIN: w,
    LOSS: l,
    PUSH: rows.filter((r) => gradeOf(r) === "PUSH").length,
    n: g.length,
    hit: g.length ? Number((w / g.length).toFixed(4)) : null,
    record: `${w}-${l}`,
  };
}

function sideSplit(rows) {
  return {
    OVER: rows.filter((r) => String(r.side || "").toUpperCase().startsWith("O"))
      .length,
    UNDER: rows.filter((r) =>
      String(r.side || "").toUpperCase().startsWith("U")
    ).length,
  };
}

function toPacket(row) {
  return {
    playerName: row.playerName || row.player,
    player: row.playerName || row.player,
    propType: row.propType,
    selectedSide: row.side,
    side: row.side,
    line: row.line,
    projection: row.projection,
    fairLine: row.fairLine,
    rawWinProbability: row.predictedProbability,
    predictedProbability: row.predictedProbability,
    safetyScore: row.safetyScore,
    SafetyScore: row.safetyScore,
    risk: row.risk,
    gameId: row.gameId || row.eventId,
    team: row.team,
    opponent: row.opponent,
    boardCandidate: true,
    expectedMinutes: row.expectedMinutes,
  };
}

function main() {
  const corpus = buildDecisionCorpusV2({ persist: false });
  const engine = trainDecisionEngineV2({ corpus });
  const priors = corpus.residualPriors || {};
  const models = fitStatProjectionModels(corpus.rows || [], priors);

  const biasAudit = {
    REBOUNDS: {
      modelBias: models.REBOUNDS?.projectionBias,
      priorBias: priors.REBOUNDS?.bias,
      gradedBetN: models.REBOUNDS?.gradedBetN,
      source: models.REBOUNDS?.source,
    },
    ASSISTS: {
      modelBias: models.ASSISTS?.projectionBias,
      priorBias: priors.ASSISTS?.bias,
      gradedBetN: models.ASSISTS?.gradedBetN,
      source: models.ASSISTS?.source,
    },
    POINTS: {
      modelBias: models.POINTS?.projectionBias,
      gradedBetN: models.POINTS?.gradedBetN,
      source: models.POINTS?.source,
    },
  };

  const alanna = scoreCandidateV2(
    {
      propType: "ASSISTS",
      selectedSide: "UNDER",
      line: 2.5,
      projection: 1.7,
      rawWinProbability: 0.750219,
      risk: "HIGH",
    },
    engine
  );

  const pregame = JSON.parse(
    fs.readFileSync(path.join(ROOT, "00-freeze/pregame-full-50.json"), "utf8")
  );
  const graded = JSON.parse(
    fs.readFileSync(path.join(ROOT, "01-aug14-final-50/full-50-graded.json"), "utf8")
  );
  const trustedFreeze = JSON.parse(
    fs.readFileSync(path.join(ROOT, "00-freeze/pregame-trusted-15.json"), "utf8")
  );

  const gradeByKey = new Map();
  for (const r of graded.records || []) {
    gradeByKey.set(keyOf(r), r);
  }

  const rows = (pregame.records || []).map((p) => {
    const g = gradeByKey.get(keyOf(p)) || {};
    return {
      ...p,
      grade: g.result?.grade || g.grade || p.grade,
      actual: g.result?.actual ?? g.actual ?? null,
      Trusted: Boolean(p.trustedMembership || p.officialSelected),
      Best: Boolean(p.bestAvailableMembership),
    };
  });

  // Trusted flags from freeze trusted list
  const trustedKeys = new Set(
    (trustedFreeze.records || trustedFreeze.rows || []).map((r) => keyOf(r))
  );
  for (const r of rows) {
    if (trustedKeys.has(keyOf(r))) r.Trusted = true;
  }

  const packets = rows.map(toPacket);
  const membership = selectOfficialMembershipV2(packets, {
    engine,
    qualityProbFloor: engine.qualityProbFloor,
  });

  const selected = membership.selectedPackets || [];
  const selectedKeys = new Set(selected.map((p) => keyOf(p)));

  const shadowTrusted = rows.filter((r) => selectedKeys.has(keyOf(r)));
  const originalTrusted = rows.filter((r) => r.Trusted);

  const rescored = rows
    .map((r) => {
      const s = scoreCandidateV2(toPacket(r), engine);
      return {
        player: r.playerName || r.player,
        propType: r.propType,
        side: r.side,
        line: r.line,
        grade: gradeOf(r),
        predictedProbability: r.predictedProbability,
        oldDecisionScoreV2: r.decisionScoreV2,
        newDecisionScoreV2: s.modelWinProbability,
        signedGap: s.signedGap,
        correctedProjection: s.correctedProjection,
        TrustedOriginal: r.Trusted,
        TrustedShadow: selectedKeys.has(keyOf(r)),
      };
    })
    .sort((a, b) => b.newDecisionScoreV2 - a.newDecisionScoreV2);

  const top15 = rescored.slice(0, 15);
  const kept = shadowTrusted.filter((r) => r.Trusted);
  const added = shadowTrusted.filter((r) => !r.Trusted);
  const removed = originalTrusted.filter((r) => !selectedKeys.has(keyOf(r)));

  // Ranking lift: Full vs topK by new score
  const rankedLift = {};
  for (const k of [1, 3, 5, 10, 15]) {
    rankedLift[`top${k}`] = wl(top15.slice(0, k).map((r) => ({ grade: r.grade })));
  }
  // Fix - use rescored for topK
  for (const k of [1, 3, 5, 10, 15]) {
    rankedLift[`top${k}`] = wl(rescored.slice(0, k).map((r) => ({ grade: r.grade })));
  }
  rankedLift.full = wl(rows);
  rankedLift.shadowTrusted = wl(shadowTrusted);
  rankedLift.originalTrusted = wl(originalTrusted);

  const underMeanNew = (() => {
    const u = rescored.filter((r) => r.side === "UNDER");
    const o = rescored.filter((r) => r.side === "OVER");
    const mean = (arr, f) =>
      arr.length
        ? Number((arr.reduce((s, x) => s + f(x), 0) / arr.length).toFixed(4))
        : null;
    return {
      underNewP: mean(u, (x) => x.newDecisionScoreV2),
      overNewP: mean(o, (x) => x.newDecisionScoreV2),
      underOldP: mean(u, (x) => x.oldDecisionScoreV2),
      overOldP: mean(o, (x) => x.oldDecisionScoreV2),
      underPredP: mean(u, (x) => x.predictedProbability),
      overPredP: mean(o, (x) => x.predictedProbability),
    };
  })();

  const out = {
    biasAudit,
    alannaUnderRepro: {
      modelWinProbability: alanna.modelWinProbability,
      correctedProjection: alanna.correctedProjection,
      signedGap: alanna.signedGap,
      invertedBeforeFix: true,
      invertedAfterFix: alanna.correctedProjection > 4,
    },
    sideScoreMeans: underMeanNew,
    originalTrusted: {
      n: originalTrusted.length,
      sideSplit: sideSplit(originalTrusted),
      record: wl(originalTrusted),
    },
    shadowTrusted: {
      n: shadowTrusted.length,
      sideSplit: sideSplit(shadowTrusted),
      record: wl(shadowTrusted),
      qualityProbFloor: membership.qualityProbFloor,
      highPolicy: membership.highPolicy,
      exposureSoftPenalties: membership.exposureSoftPenalties,
      rows: shadowTrusted.map(
        (r) =>
          `${r.playerName || r.player} ${r.side} ${r.line} ${r.propType} ${gradeOf(r)}`
      ),
    },
    top15ByNewScore: {
      sideSplit: sideSplit(top15),
      underCount: top15.filter((r) => r.side === "UNDER").length,
      record: wl(top15.map((r) => ({ grade: r.grade }))),
      rows: top15.map((r) => ({
        player: r.player,
        propType: r.propType,
        side: r.side,
        line: r.line,
        grade: r.grade,
        newP: r.newDecisionScoreV2,
        oldP: r.oldDecisionScoreV2,
      })),
    },
    rankingLift: rankedLift,
    membershipDelta: {
      kept: kept.map(
        (r) =>
          `${r.playerName || r.player} ${r.side} ${r.line} ${r.propType} ${gradeOf(r)}`
      ),
      added: added.map(
        (r) =>
          `${r.playerName || r.player} ${r.side} ${r.line} ${r.propType} ${gradeOf(r)}`
      ),
      removed: removed.map(
        (r) =>
          `${r.playerName || r.player} ${r.side} ${r.line} ${r.propType} ${gradeOf(r)}`
      ),
    },
    productTruthMutated: false,
  };

  writeJson(
    path.join(ROOT, "27-counterfactual", "aug14-shadow-after-calibration.json"),
    out
  );
  writeJson(
    path.join(ROOT, "22-historical", "bias-prior-audit-after-fix.json"),
    biasAudit
  );
  writeJson(path.join(ROOT, "26-implementation", "engine-stat-models-after.json"), {
    trainedAt: engine.trainedAt,
    qualityProbFloor: engine.qualityProbFloor,
    statModels: engine.statModels,
    probModel: engine.probModel,
  });

  const modelPath = path.join(SERVER_ROOT, "decision-engine-v2-model.json");
  fs.writeFileSync(modelPath, JSON.stringify(engine, null, 2));

  console.log(
    JSON.stringify(
      {
        alannaP: alanna.modelWinProbability,
        corrected: alanna.correctedProjection,
        biasAudit,
        sideScoreMeans: underMeanNew,
        shadowTrusted: out.shadowTrusted,
        top15Sides: out.top15ByNewScore.sideSplit,
        rankingLift: rankedLift,
        delta: {
          kept: kept.length,
          added: added.length,
          removed: removed.length,
        },
        modelPersisted: modelPath,
      },
      null,
      2
    )
  );
}

main();
