/**
 * CourtEdge Result-Driven Decision Engine V2
 *
 * Single ranking authority: modelWinProbability / decisionScoreV2
 * No label vetoes, no min-fill, no side/stat quotas.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  buildDecisionCorpusV2,
  loadDecisionCorpusV2,
} from "./courtEdgeDecisionCorpusV2.js";
import { hasCompleteTrustedPacketV3 } from "./courtEdgeHomeProductTruthSectionsV3.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SERVER_ROOT = path.join(__dirname, "..");

export const DECISION_ENGINE_V2_BUILD =
  "courteedge-result-driven-decision-engine-v2";

export const OFFICIAL_BOARD_MAX_V2 = null; // no forced Trusted volume ceiling — quality cliff only
/** @deprecated V3: Home membership no longer fills to a fixed count. */
export const HOME_BOARD_MAX_V2 = 10;
/** Soft floor used only as quality cliff — NEVER a forced minimum count. */
export const DEFAULT_QUALITY_PROB_FLOOR = 0.52;

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp01(x) {
  return Math.min(1, Math.max(0, x));
}

function logistic(x) {
  if (x >= 20) return 1;
  if (x <= -20) return 0;
  return 1 / (1 + Math.exp(-x));
}

function mean(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return v.reduce((s, x) => s + x, 0) / v.length;
}

function mae(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return v.reduce((s, x) => s + Math.abs(x), 0) / v.length;
}

function rmse(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  if (!v.length) return null;
  return Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length);
}

function std(xs) {
  const v = xs.filter((x) => Number.isFinite(x));
  if (v.length < 2) return null;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

function normPropType(raw) {
  const s = String(raw || "POINTS").toUpperCase();
  if (s.includes("ASSIST") || s === "AST") return "ASSISTS";
  if (s.includes("REBOUND") || s === "REB") return "REBOUNDS";
  return "POINTS";
}

function normSide(raw) {
  const s = String(raw || "").toUpperCase();
  if (s.startsWith("U")) return "UNDER";
  if (s.startsWith("O")) return "OVER";
  return null;
}

function stableId(packet = {}) {
  return String(
    packet.canonicalPropId ||
      packet.marketKey ||
      packet.playerKey ||
      [
        packet.playerName || packet.player,
        packet.propType || packet.stat,
        packet.selectedSide || packet.side,
        packet.line,
      ].join("|")
  );
}

function riskCode(packet = {}) {
  const raw =
    (typeof packet.risk === "string" ? packet.risk : null) ||
    packet.risk?.risk ||
    packet.c2Risk ||
    packet.trueRisk ||
    packet.RiskV2 ||
    "";
  const r = String(raw).toUpperCase();
  if (r.includes("LOW")) return "LOW";
  if (r.includes("MEDIUM") || r.includes("MED")) return "MEDIUM";
  if (r.includes("HIGH")) return "HIGH";
  return null;
}

/**
 * Fit per-stat projection residual models from CLEAN graded rows.
 * REB/AST may also use static residual priors (projection-error warehouse).
 */
export function fitStatProjectionModels(rows = [], residualPriors = {}) {
  const models = {};
  for (const propType of ["POINTS", "REBOUNDS", "ASSISTS"]) {
    const subset = rows.filter(
      (r) =>
        r.propType === propType &&
        Number.isFinite(r.projectionError) &&
        (r.grade === "WIN" || r.grade === "LOSS" || r.grade === "PUSH" || Number.isFinite(r.actual))
    );
    const errors = subset.map((r) => r.projectionError).filter((e) => Number.isFinite(e));
    const prior = residualPriors?.[propType] || null;
    let biasEst = mean(errors);
    let maeEst = mae(errors);
    let rmseEst = rmse(errors);
    let residualStd = std(errors);
    let n = errors.length;
    let source = "corpus";

    // Never borrow across stats. Only fill sparse REB/AST from same-stat prior.
    if ((n < 30 || residualStd == null || residualStd < 0.25) && prior) {
      biasEst = Number.isFinite(biasEst) ? biasEst : num(prior.bias);
      maeEst = Number.isFinite(maeEst) ? maeEst : num(prior.mae);
      rmseEst = Number.isFinite(rmseEst) ? rmseEst : num(prior.rmse);
      residualStd =
        Number.isFinite(residualStd) && residualStd >= 0.25
          ? residualStd
          : num(prior.rmse) || num(prior.mae) || 1.5;
      n = Math.max(n, num(prior.n) || 0);
      source = n > errors.length ? "corpus+prior" : "prior";
    }

    // POINTS fallback if corpus empty
    if (!Number.isFinite(residualStd) || residualStd < 0.25) {
      residualStd = propType === "POINTS" ? 4.5 : propType === "REBOUNDS" ? 2.3 : 1.7;
      source = source === "corpus" ? "default" : source;
    }
    if (!Number.isFinite(biasEst)) biasEst = 0;
    if (!Number.isFinite(maeEst)) maeEst = residualStd * 0.75;
    if (!Number.isFinite(rmseEst)) rmseEst = residualStd;

    const gradedBetN = rows.filter(
      (r) =>
        r.propType === propType && (r.grade === "WIN" || r.grade === "LOSS")
    ).length;
    models[propType] = {
      propType,
      n,
      gradedBetN,
      projectionBias: Number(biasEst.toFixed(4)),
      projectionMAE: Number(maeEst.toFixed(4)),
      projectionRMSE: Number(rmseEst.toFixed(4)),
      residualStd: Number(residualStd.toFixed(4)),
      source,
    };
  }
  return models;
}

/**
 * Fit logistic P(win | normalizedStrength [, enginePrior]) on train rows.
 */
export function fitWinProbabilityModel(rows = [], statModels = {}) {
  const graded = rows.filter(
    (r) =>
      (r.grade === "WIN" || r.grade === "LOSS") &&
      Number.isFinite(r.projection) &&
      Number.isFinite(r.line) &&
      r.side
  );
  // Grid search intercept / slope on holdout-safe train set.
  let best = { intercept: 0.15, slope: 0.55, priorWeight: 0.25, brier: Infinity };
  const candidates = [];
  for (const intercept of [-0.2, 0, 0.15, 0.3]) {
    for (const slope of [0.35, 0.55, 0.75, 1.0]) {
      for (const priorWeight of [0, 0.15, 0.25, 0.4]) {
        candidates.push({ intercept, slope, priorWeight });
      }
    }
  }
  for (const c of candidates) {
    let sum = 0;
    let n = 0;
    for (const r of graded) {
      const scored = scoreRowFeatures(r, statModels, c);
      const y = r.grade === "WIN" ? 1 : 0;
      sum += (scored.modelWinProbability - y) ** 2;
      n += 1;
    }
    if (!n) continue;
    const brier = sum / n;
    if (brier < best.brier) best = { ...c, brier };
  }

  // Empirical hit-rate by strength bucket for calibration curve report.
  const buckets = {};
  for (const r of graded) {
    const scored = scoreRowFeatures(r, statModels, best);
    const b = Math.min(9, Math.max(0, Math.floor(scored.modelWinProbability * 10)));
    if (!buckets[b]) buckets[b] = { n: 0, wins: 0 };
    buckets[b].n += 1;
    if (r.grade === "WIN") buckets[b].wins += 1;
  }
  const calibrationCurve = Object.keys(buckets)
    .map(Number)
    .sort((a, b) => a - b)
    .map((b) => ({
      bin: `${b / 10}-${(b + 1) / 10}`,
      n: buckets[b].n,
      hitRate: Number((buckets[b].wins / buckets[b].n).toFixed(4)),
    }));

  return {
    ...best,
    trainN: graded.length,
    trainBrier: Number(best.brier.toFixed(4)),
    calibrationCurve,
  };
}

function scoreRowFeatures(row, statModels, probModel) {
  const propType = normPropType(row.propType);
  const side = normSide(row.side);
  const model = statModels[propType] || statModels.POINTS;
  const projection = num(row.projection);
  const line = num(row.line);
  const corrected =
    projection == null ? null : projection + (model?.projectionBias || 0);
  const signedGap =
    corrected == null || line == null || !side
      ? null
      : side === "OVER"
        ? corrected - line
        : line - corrected;
  const residualStd = model?.residualStd || 1;
  const rawStrength = signedGap == null ? 0 : signedGap / residualStd;
  // Winsorize extreme gaps — huge projection misses are often model failure, not edge.
  const cap =
    propType === "POINTS" ? 2.25 : propType === "REBOUNDS" ? 1.75 : 1.6;
  const normalizedProjectionStrength = Math.max(-cap, Math.min(cap, rawStrength));

  const enginePrior = (() => {
    const p = num(row.probability ?? row.predictedProbability ?? row.rawWinProbability);
    if (p == null) return null;
    return p > 1 ? clamp01(p / 100) : clamp01(p);
  })();

  const intercept = probModel?.intercept ?? 0.15;
  const slope = probModel?.slope ?? 0.55;
  // Sparse graded bet outcomes for a stat → rely less on residual z, more on prior.
  const gradedN = num(model?.gradedBetN) ?? num(model?.n) ?? 0;
  const sparseStat = propType !== "POINTS" && gradedN < 40;
  const effectivePriorWeight = sparseStat
    ? Math.min(0.55, (probModel?.priorWeight ?? 0.25) + 0.25)
    : probModel?.priorWeight ?? 0.25;
  const effectiveSlope = sparseStat ? slope * 0.65 : slope;

  let logit = intercept + effectiveSlope * normalizedProjectionStrength;
  // Risk/safety are FEATURES — soft log-odds nudge, never veto.
  const risk = riskCode(row);
  if (risk === "LOW") logit += 0.08;
  else if (risk === "HIGH") logit -= 0.05;
  const minutes = num(row.expectedMinutes);
  if (minutes != null) {
    if (minutes < 12) logit -= 0.2;
    else if (minutes >= 28) logit += 0.05;
  }
  // Extreme raw strength beyond cap without dense same-stat bet history → distrust.
  if (Math.abs(rawStrength) > cap && sparseStat) {
    logit -= 0.35;
  }
  if (row.marketHistoryIntegrity === "CONTAMINATED_LEGACY_IDENTITY") {
    logit -= 0.2;
  }
  let modelWinProbability = logistic(logit);
  if (enginePrior != null && effectivePriorWeight > 0) {
    modelWinProbability =
      (1 - effectivePriorWeight) * modelWinProbability +
      effectivePriorWeight * enginePrior;
  }
  modelWinProbability = clamp01(modelWinProbability);
  return {
    propType,
    side,
    correctedProjection: corrected,
    signedGap,
    normalizedProjectionStrength: Number(normalizedProjectionStrength.toFixed(4)),
    rawNormalizedStrength: Number(rawStrength.toFixed(4)),
    modelWinProbability: Number(modelWinProbability.toFixed(4)),
    decisionScoreV2: Number(modelWinProbability.toFixed(4)),
    residualStd,
    enginePrior,
    sparseStat,
  };
}

export function trainDecisionEngineV2(options = {}) {
  const corpus =
    options.corpus ||
    loadDecisionCorpusV2({ rebuild: options.rebuildCorpus === true, persist: false });
  const cutoffDate = options.trainThroughDate || null;
  const rows = (corpus.rows || []).filter((r) => {
    if (!cutoffDate) return true;
    return String(r.slateDateCt) <= String(cutoffDate);
  });
  const graded = rows.filter((r) => r.grade === "WIN" || r.grade === "LOSS");
  const statModels = fitStatProjectionModels(rows, corpus.residualPriors || {});
  const probModel = fitWinProbabilityModel(graded, statModels);
  // Quality floor from train: probability below which precision collapses.
  const scored = graded
    .map((r) => ({ ...r, ...scoreRowFeatures(r, statModels, probModel) }))
    .sort((a, b) => b.decisionScoreV2 - a.decisionScoreV2);
  let qualityProbFloor = DEFAULT_QUALITY_PROB_FLOOR;
  if (scored.length >= 20) {
    // Use P at which cumulative precision from top ranks stays >= 0.55 when possible.
    let wins = 0;
    for (let i = 0; i < Math.min(scored.length, 40); i++) {
      if (scored[i].grade === "WIN") wins += 1;
      const prec = wins / (i + 1);
      if (i >= 3 && prec < 0.55) {
        qualityProbFloor = Math.max(
          DEFAULT_QUALITY_PROB_FLOOR,
          scored[i].modelWinProbability
        );
        break;
      }
    }
  }
  return {
    build: DECISION_ENGINE_V2_BUILD,
    trainedAt: new Date().toISOString(),
    trainThroughDate: cutoffDate,
    trainRows: rows.length,
    trainGraded: graded.length,
    byPropType: {
      POINTS: graded.filter((r) => r.propType === "POINTS").length,
      REBOUNDS: graded.filter((r) => r.propType === "REBOUNDS").length,
      ASSISTS: graded.filter((r) => r.propType === "ASSISTS").length,
    },
    statModels,
    probModel,
    qualityProbFloor: Number(qualityProbFloor.toFixed(4)),
    residualPriors: corpus.residualPriors || {},
  };
}

export function scoreCandidateV2(packet = {}, engine = null) {
  const eng = engine || getCachedEngine();
  const propType = normPropType(
    packet.propType || packet.canonicalPropType || packet.stat || packet.market
  );
  const side = normSide(
    packet.selectedSide || packet.side || packet.pick || packet.boardSide
  );
  const projection = num(
    packet.projection ??
      (side === "OVER"
        ? packet.overPacket?.projection
        : packet.underPacket?.projection) ??
      packet.projectedTotal
  );
  const line = num(packet.line ?? packet.sportsbookLine ?? packet.marketLine);
  const row = {
    propType,
    side,
    projection,
    line,
    probability:
      packet.rawWinProbability ??
      packet.probability?.rawWinProbability ??
      packet.selectedSideProbability ??
      packet.predictedProbability ??
      packet.reliabilityProbability ??
      packet.displayConfidence,
    risk: riskCode(packet),
    expectedMinutes:
      packet.expectedMinutes ?? packet.minutesModel?.expectedMinutes,
    bookCount: packet.bookCount ?? packet.market?.bookCount,
    marketHistoryIntegrity: packet.marketHistoryIntegrity || null,
    openingLineUsable: packet.openingLineUsable,
  };
  const scored = scoreRowFeatures(row, eng.statModels, eng.probModel);
  return {
    ...scored,
    propType,
    side,
    projection,
    line,
    decisionAuthority: DECISION_ENGINE_V2_BUILD,
  };
}

function isValidBoardCandidate(packet = {}) {
  if (packet.boardCandidate === false) return false;
  if (packet.membership?.boardCandidate === false) return false;
  const side = normSide(
    packet.selectedSide || packet.side || packet.pick || packet.membership?.boardSide
  );
  const line = num(packet.line ?? packet.sportsbookLine);
  const projection = num(packet.projection);
  if (!side || line == null) return false;
  // Must be PTS/REB/AST
  const pt = normPropType(packet.propType || packet.stat || packet.market);
  if (!["POINTS", "REBOUNDS", "ASSISTS"].includes(pt)) return false;
  // Prefer packets with a projection; allow fairLine as weak fallback for Full.
  if (projection == null && num(packet.fairLine) == null) return false;
  return true;
}

/** Trusted/Official requires the complete canonical stack (fail closed). */
function isTrustedPacketComplete(packet = {}, options = {}) {
  return hasCompleteTrustedPacketV3(packet, options).ok;
}

function duplicateMarketKey(packet = {}) {
  const player = String(packet.playerName || packet.player || "")
    .toLowerCase()
    .replace(/\s+/g, "-");
  const propType = normPropType(packet.propType || packet.stat);
  const line = num(packet.line ?? packet.sportsbookLine);
  return `${player}|${propType}|${line}`;
}

/**
 * DEPRECATED for production Home membership (V3).
 * Global quality rank only — no PTS/REB/AST round-robin forced balance.
 * Prefer courtEdgeHomeProductTruthSectionsV3 for Home sections.
 */
export function selectHomeBoardCrossMarketV2(packets = [], options = {}) {
  const engine = options.engine || getCachedEngine();
  const maxBoard = num(options.maxBoard); // null/undefined = no display trunc
  const trustIncoming = options.trustIncomingScores === true;
  const scored = (Array.isArray(packets) ? packets : [])
    .map((p) => {
      if (
        trustIncoming &&
        Number.isFinite(Number(p.decisionScoreV2 ?? p.modelWinProbability))
      ) {
        const pt = normPropType(p.propType || p.stat);
        const side = normSide(p.selectedSide || p.side || p.pick);
        const score = Number(p.decisionScoreV2 ?? p.modelWinProbability);
        return {
          ...p,
          propType: pt,
          selectedSide: side,
          modelWinProbability: score,
          decisionScoreV2: score,
          decisionAuthority: DECISION_ENGINE_V2_BUILD,
          officialRankScore: score,
        };
      }
      const s = scoreCandidateV2(p, engine);
      return {
        ...p,
        propType: s.propType,
        selectedSide: s.side || p.selectedSide || p.side,
        projection: s.projection ?? p.projection,
        correctedProjection: s.correctedProjection,
        normalizedProjectionStrength: s.normalizedProjectionStrength,
        modelWinProbability: s.modelWinProbability,
        decisionScoreV2: s.decisionScoreV2,
        decisionAuthority: DECISION_ENGINE_V2_BUILD,
        officialRankScore: s.decisionScoreV2,
      };
    })
    .filter(
      (p) =>
        p.selectedSide &&
        p.line != null &&
        ["POINTS", "REBOUNDS", "ASSISTS"].includes(p.propType)
    )
    .sort((a, b) => {
      if (b.decisionScoreV2 !== a.decisionScoreV2) {
        return b.decisionScoreV2 - a.decisionScoreV2;
      }
      return stableId(a).localeCompare(stableId(b));
    });

  const seen = new Set();
  const unique = [];
  for (const p of scored) {
    const key = duplicateMarketKey(p);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(p);
  }

  const selected =
    maxBoard != null && maxBoard > 0 ? unique.slice(0, maxBoard) : unique;

  return {
    controlPlaneBuild: DECISION_ENGINE_V2_BUILD,
    boardSizePolicy: "GLOBAL_QUALITY_NO_STAT_WEAVE_V3",
    officialBoardMin: 0,
    officialBoardMax: maxBoard ?? null,
    homeBoardMax: maxBoard ?? null,
    selectedPackets: selected,
    boardCandidates: unique,
    byMarketSelected: {
      POINTS: selected.filter((p) => p.propType === "POINTS").length,
      REBOUNDS: selected.filter((p) => p.propType === "REBOUNDS").length,
      ASSISTS: selected.filter((p) => p.propType === "ASSISTS").length,
    },
    decisionAuthority: DECISION_ENGINE_V2_BUILD,
    forcedStatBalance: false,
    marketBalancedWeave: false,
  };
}

/**
 * Official membership = strongest calibrated COMPLETE predictions only.
 * No minimum fill. No forced volume ceiling (quality cliff only).
 * Incomplete odds-only packets cannot become Trusted.
 */
export function selectOfficialMembershipV2(packets = [], options = {}) {
  const engine = options.engine || getCachedEngine();
  const maxBoardRaw = num(options.maxBoard);
  const maxBoard =
    maxBoardRaw != null && maxBoardRaw > 0
      ? maxBoardRaw
      : Number.POSITIVE_INFINITY;
  const qualityFloor =
    num(options.qualityProbFloor) ?? engine.qualityProbFloor ?? DEFAULT_QUALITY_PROB_FLOOR;
  const packetGateOpts = {
    allowMissingEnvironmentFields: options.allowMissingEnvironmentFields === true,
  };

  const scoredPool = (Array.isArray(packets) ? packets : [])
    .filter(isValidBoardCandidate)
    .map((p) => {
      const scored = scoreCandidateV2(p, engine);
      // Contaminated market history soft-penalizes probability (feature, not veto).
      let pWin = scored.modelWinProbability;
      if (p.marketHistoryIntegrity === "CONTAMINATED_LEGACY_IDENTITY") {
        pWin = clamp01(pWin - 0.08);
      }
      if (p.openingLineUsable === false) {
        pWin = clamp01(pWin - 0.03);
      }
      const complete = isTrustedPacketComplete(
        {
          ...p,
          projection: scored.projection ?? p.projection,
          fairLine: p.fairLine,
          selectedSide: scored.side || p.selectedSide || p.side,
          modelWinProbability: pWin,
        },
        packetGateOpts
      );
      return {
        ...p,
        propType: scored.propType,
        selectedSide: scored.side || p.selectedSide || p.side,
        projection: scored.projection ?? p.projection,
        correctedProjection: scored.correctedProjection,
        normalizedProjectionStrength: scored.normalizedProjectionStrength,
        modelWinProbability: Number(pWin.toFixed(4)),
        decisionScoreV2: Number(pWin.toFixed(4)),
        decisionAuthority: DECISION_ENGINE_V2_BUILD,
        officialSelected: false,
        officialRankScore: Number(pWin.toFixed(4)),
        c2Risk: riskCode(p) || p.c2Risk || "HIGH",
        trustedPacketComplete: complete,
      };
    })
    .sort((a, b) => {
      if (b.decisionScoreV2 !== a.decisionScoreV2) {
        return b.decisionScoreV2 - a.decisionScoreV2;
      }
      return stableId(a).localeCompare(stableId(b));
    });

  // Duplicate-market integrity: keep strongest per player|propType|line.
  const seenMarkets = new Set();
  const unique = [];
  for (const p of scoredPool) {
    const key = duplicateMarketKey(p);
    if (seenMarkets.has(key)) continue;
    seenMarkets.add(key);
    unique.push(p);
  }

  const selected = [];
  for (const p of unique) {
    if (selected.length >= maxBoard) break;
    // Incomplete packets stay Full/Best Available — never Trusted.
    if (!p.trustedPacketComplete) continue;
    // Quality cliff: first seat can be alone; later seats need floor.
    if (selected.length === 0) {
      if (p.modelWinProbability < qualityFloor) break;
      selected.push(p);
      continue;
    }
    if (p.modelWinProbability < qualityFloor) break;
    // Material drop-off vs previous rank.
    const prev = selected[selected.length - 1];
    if (prev.modelWinProbability - p.modelWinProbability > 0.12 && p.modelWinProbability < 0.58) {
      break;
    }
    selected.push(p);
  }

  const selectedIds = new Set(selected.map((p) => stableId(p)));
  const withFlags = unique.map((p) => {
    const officialSelected = selectedIds.has(stableId(p));
    return {
      ...p,
      officialSelected,
      officialEligible: officialSelected,
      membership: {
        ...(p.membership || {}),
        analysisEligible: p.membership?.analysisEligible !== false,
        boardCandidate: true,
        officialSelected,
        officialEligible: officialSelected,
        decisionAuthority: DECISION_ENGINE_V2_BUILD,
      },
      membershipQualificationStatus: officialSelected
        ? "DECISION_ENGINE_V2_RANK"
        : !p.trustedPacketComplete
          ? "INCOMPLETE_TRUSTED_PACKET"
          : "BELOW_V2_QUALITY_CLIFF",
    };
  });

  const selectedPackets = withFlags
    .filter((p) => p.officialSelected)
    .sort((a, b) => b.decisionScoreV2 - a.decisionScoreV2);

  return {
    controlPlaneBuild: DECISION_ENGINE_V2_BUILD,
    boardSizePolicy: "QUALITY_RANK_NO_MINIMUM",
    highPolicy: "NO_HIGH_MINIMUM_FILL",
    officialBoardMin: 0,
    officialBoardMax: maxBoard,
    boardCandidateCount: unique.length,
    officialCount: selectedPackets.length,
    lowCount: selectedPackets.filter((p) => p.c2Risk === "LOW").length,
    mediumCount: selectedPackets.filter((p) => p.c2Risk === "MEDIUM").length,
    highFillCount: 0,
    thinSlate: unique.length === 0,
    thinSlateReason: unique.length === 0 ? "NO_VALID_BOARD_CANDIDATES" : null,
    qualityProbFloor: qualityFloor,
    selectedPackets,
    boardCandidates: withFlags,
    teamQuota: false,
    sideQuota: false,
    decisionAuthority: DECISION_ENGINE_V2_BUILD,
    labelsRemovedFromAuthority: [
      "HIGH_MINIMUM_FILL",
      "SAFEST_2_TO_6",
      "BOARD_ONLY",
      "TRACK",
      "WATCHLIST",
      "PREMIUM",
      "PLAYABLE",
      "LEAN",
      "DIRECTION_BEST_GUESS",
      "PRIMARY",
    ],
  };
}

/* -------------------- walk-forward validation -------------------- */

function hitRate(rows) {
  const graded = rows.filter((r) => r.grade === "WIN" || r.grade === "LOSS");
  if (!graded.length) return null;
  return Number(
    (graded.filter((r) => r.grade === "WIN").length / graded.length).toFixed(4)
  );
}

function brierOf(rows) {
  const graded = rows.filter(
    (r) =>
      (r.grade === "WIN" || r.grade === "LOSS") &&
      Number.isFinite(r.modelWinProbability)
  );
  if (!graded.length) return null;
  let sum = 0;
  for (const r of graded) {
    const y = r.grade === "WIN" ? 1 : 0;
    sum += (r.modelWinProbability - y) ** 2;
  }
  return Number((sum / graded.length).toFixed(4));
}

function topKHitRates(rankedGraded, ks = [1, 2, 3, 4, 5, 6]) {
  const out = {};
  for (const k of ks) {
    const slice = rankedGraded.slice(0, k);
    out[`top${k}`] = hitRate(slice);
    out[`top${k}N`] = slice.filter((r) => r.grade === "WIN" || r.grade === "LOSS").length;
  }
  return out;
}

/**
 * Chronological walk-forward: train on older dates, validate on later.
 * Offline validation only (not shadow mode).
 */
export function walkForwardValidateV2(options = {}) {
  const corpus =
    options.corpus ||
    buildDecisionCorpusV2({ persist: options.persistCorpus === true });
  const dates = (corpus.dates || []).filter(Boolean).sort();
  if (dates.length < 3) {
    return {
      ok: false,
      reason: "INSUFFICIENT_DATES",
      dates,
      build: DECISION_ENGINE_V2_BUILD,
    };
  }
  // Holdout = last ~30% of dates (at least 2).
  const holdoutStartIdx = Math.max(2, Math.floor(dates.length * 0.7));
  const trainDates = dates.slice(0, holdoutStartIdx);
  const holdoutDates = dates.slice(holdoutStartIdx);
  const trainThrough = trainDates[trainDates.length - 1];

  const engine = trainDecisionEngineV2({
    corpus,
    trainThroughDate: trainThrough,
  });

  const holdoutRows = (corpus.rows || []).filter((r) =>
    holdoutDates.includes(r.slateDateCt)
  );
  const scoredHoldout = holdoutRows
    .filter((r) => r.grade === "WIN" || r.grade === "LOSS")
    .map((r) => ({ ...r, ...scoreRowFeatures(r, engine.statModels, engine.probModel) }))
    .sort((a, b) => {
      if (a.slateDateCt !== b.slateDateCt) {
        return String(a.slateDateCt).localeCompare(String(b.slateDateCt));
      }
      return b.decisionScoreV2 - a.decisionScoreV2;
    });

  // Per-slate V2 board vs current Official membership.
  const bySlate = new Map();
  for (const r of scoredHoldout) {
    if (!bySlate.has(r.slateDateCt)) bySlate.set(r.slateDateCt, []);
    bySlate.get(r.slateDateCt).push(r);
  }

  const slateComparisons = [];
  const v2Picks = [];
  const currentOfficial = [];
  for (const [slateDateCt, slateRows] of bySlate.entries()) {
    const ranked = [...slateRows].sort(
      (a, b) => b.decisionScoreV2 - a.decisionScoreV2
    );
    const membership = selectOfficialMembershipV2(ranked, {
      engine,
      allowMissingEnvironmentFields: true,
    });
    const v2Selected = membership.selectedPackets;
    const cur = slateRows.filter((r) => r.officialSelected || r.membership === "OFFICIAL");
    slateComparisons.push({
      slateDateCt,
      candidateN: slateRows.length,
      currentOfficialN: cur.length,
      v2OfficialN: v2Selected.length,
      currentHitRate: hitRate(cur),
      v2HitRate: hitRate(v2Selected),
      currentWins: cur.filter((r) => r.grade === "WIN").length,
      currentLosses: cur.filter((r) => r.grade === "LOSS").length,
      v2Wins: v2Selected.filter((r) => r.grade === "WIN").length,
      v2Losses: v2Selected.filter((r) => r.grade === "LOSS").length,
    });
    v2Picks.push(...v2Selected);
    currentOfficial.push(...cur);
  }

  // Global ranking quality on holdout (all candidates ranked by V2).
  const globalRanked = [...scoredHoldout].sort(
    (a, b) => b.decisionScoreV2 - a.decisionScoreV2
  );
  // Current selector rank proxy: official first, then officialRankScore/probability.
  const currentRanked = [...scoredHoldout].sort((a, b) => {
    const ao = a.officialSelected || a.membership === "OFFICIAL" ? 1 : 0;
    const bo = b.officialSelected || b.membership === "OFFICIAL" ? 1 : 0;
    if (bo !== ao) return bo - ao;
    return (num(b.officialRankScore) || num(b.probability) || 0) -
      (num(a.officialRankScore) || num(a.probability) || 0);
  });

  const projMaeBefore = mae(
    scoredHoldout.map((r) => r.projectionError).filter((e) => e != null)
  );
  const projMaeAfter = mae(
    scoredHoldout.map((r) => {
      const m = engine.statModels[r.propType];
      if (!Number.isFinite(r.actual) || !Number.isFinite(r.projection)) return null;
      return r.actual - (r.projection + (m?.projectionBias || 0));
    })
  );

  const currentBoardHit = hitRate(currentOfficial);
  const v2BoardHit = hitRate(v2Picks);
  const currentBrier = (() => {
    const xs = currentOfficial.filter((r) => Number.isFinite(r.probability));
    if (!xs.length) return null;
    let sum = 0;
    for (const r of xs) {
      const p = r.probability > 1 ? r.probability / 100 : r.probability;
      sum += (clamp01(p) - (r.grade === "WIN" ? 1 : 0)) ** 2;
    }
    return Number((sum / xs.length).toFixed(4));
  })();
  const v2Brier = brierOf(v2Picks);

  const improvesHit =
    v2BoardHit != null &&
    currentBoardHit != null &&
    v2BoardHit > currentBoardHit + 0.001;
  const improvesBrier =
    v2Brier != null && currentBrier != null && v2Brier < currentBrier - 0.001;
  const improvesTop = (() => {
    const a = topKHitRates(globalRanked);
    const b = topKHitRates(currentRanked);
    let wins = 0;
    let comps = 0;
    for (const k of [1, 2, 3, 4, 5, 6]) {
      if (a[`top${k}`] != null && b[`top${k}`] != null) {
        comps += 1;
        if (a[`top${k}`] >= b[`top${k}`]) wins += 1;
      }
    }
    return comps > 0 && wins >= Math.ceil(comps / 2);
  })();

  const pass = Boolean(improvesHit || (improvesTop && improvesBrier) || (improvesHit && improvesTop));

  return {
    ok: true,
    pass,
    build: DECISION_ENGINE_V2_BUILD,
    trainThroughDate: trainThrough,
    trainDates,
    holdoutDates,
    engineSummary: {
      trainGraded: engine.trainGraded,
      byPropType: engine.byPropType,
      statModels: engine.statModels,
      probModel: {
        intercept: engine.probModel.intercept,
        slope: engine.probModel.slope,
        priorWeight: engine.probModel.priorWeight,
        trainBrier: engine.probModel.trainBrier,
      },
      qualityProbFloor: engine.qualityProbFloor,
    },
    projectionCalibration: {
      maeBefore: projMaeBefore == null ? null : Number(projMaeBefore.toFixed(4)),
      maeAfter: projMaeAfter == null ? null : Number(projMaeAfter.toFixed(4)),
    },
    probabilityCalibration: {
      currentOfficialBrier: currentBrier,
      v2BoardBrier: v2Brier,
      holdoutAllCandidatesBrier: brierOf(scoredHoldout),
    },
    boardComparison: {
      currentOfficial: {
        n: currentOfficial.length,
        hitRate: currentBoardHit,
        wins: currentOfficial.filter((r) => r.grade === "WIN").length,
        losses: currentOfficial.filter((r) => r.grade === "LOSS").length,
      },
      decisionEngineV2: {
        n: v2Picks.length,
        hitRate: v2BoardHit,
        wins: v2Picks.filter((r) => r.grade === "WIN").length,
        losses: v2Picks.filter((r) => r.grade === "LOSS").length,
      },
    },
    topKHitRates: {
      decisionEngineV2: topKHitRates(globalRanked),
      currentSelectorProxy: topKHitRates(currentRanked),
    },
    slateComparisons,
    promotion: {
      liveAuthority: pass,
      reason: pass
        ? "HOLDOUT_IMPROVED_VS_CURRENT_SELECTOR"
        : "HOLDOUT_DID_NOT_BEAT_CURRENT_SELECTOR",
    },
  };
}

/* -------------------- Aug 12 autopsy -------------------- */

export function autopsyAug12V2(options = {}) {
  const corpus =
    options.corpus || loadDecisionCorpusV2({ rebuild: true, persist: false });
  // Train excluding Aug 12 so autopsy is not in-sample for that slate.
  const engine = trainDecisionEngineV2({
    corpus,
    trainThroughDate: "2026-08-11",
  });
  const aug12 = (corpus.rows || []).filter((r) => r.slateDateCt === "2026-08-12");
  const scored = aug12
    .map((r) => ({ ...r, ...scoreRowFeatures(r, engine.statModels, engine.probModel) }))
    .sort((a, b) => b.decisionScoreV2 - a.decisionScoreV2);

  const oldOfficial = scored.filter(
    (r) => r.officialSelected || r.membership === "OFFICIAL"
  );
  const v2Membership = selectOfficialMembershipV2(scored, {
    engine,
    allowMissingEnvironmentFields: true,
  });
  const winnersLeftBehind = scored.filter(
    (r) =>
      r.grade === "WIN" &&
      !(r.officialSelected || r.membership === "OFFICIAL")
  );
  const losersSelected = oldOfficial.filter((r) => r.grade === "LOSS");

  const misleading = losersSelected.map((loser) => {
    const better = winnersLeftBehind
      .filter((w) => w.decisionScoreV2 > loser.decisionScoreV2)
      .slice(0, 8)
      .map((w) => ({
        player: w.player,
        propType: w.propType,
        side: w.side,
        line: w.line,
        projection: w.projection,
        normalizedProjectionStrength: w.normalizedProjectionStrength,
        modelWinProbability: w.modelWinProbability,
        oldOfficialRankScore: w.officialRankScore,
        oldProbability: w.probability,
        risk: w.risk,
      }));
    return {
      player: loser.player,
      propType: loser.propType,
      side: loser.side,
      line: loser.line,
      projection: loser.projection,
      actual: loser.actual,
      grade: loser.grade,
      oldSignals: {
        officialRankScore: loser.officialRankScore,
        probability: loser.probability,
        safetyScore: loser.safetyScore,
        risk: loser.risk,
      },
      v2Signals: {
        normalizedProjectionStrength: loser.normalizedProjectionStrength,
        modelWinProbability: loser.modelWinProbability,
        correctedProjection: loser.correctedProjection,
        decisionScoreV2: loser.decisionScoreV2,
      },
      whyLikelyMisleading: [
        "Old selector used risk-tier + min-fill / label authority, not calibrated cross-stat strength.",
        loser.propType === "ASSISTS" &&
        Number(loser.rawNormalizedStrength || loser.normalizedProjectionStrength) > 1.5
          ? "ASSISTS projection gap looked enormous vs line, but same-stat graded bet sample was tiny — extreme gap was a projection miss risk, not proven edge."
          : null,
        loser.normalizedProjectionStrength != null &&
        loser.normalizedProjectionStrength < 0.35
          ? "Normalized projection strength was weak once residual scale is applied."
          : null,
        loser.marketHistoryIntegrity === "CONTAMINATED_LEGACY_IDENTITY"
          ? "Market history integrity was contaminated (feature, not a label veto)."
          : null,
        loser.probability != null &&
        Number(loser.probability) > 0.9 &&
        loser.grade === "LOSS"
          ? "Engine prior probability was overconfident relative to actual outcome."
          : null,
      ].filter(Boolean),
      strongerPregameWinnersLeftBehind: better,
    };
  });

  return {
    build: DECISION_ENGINE_V2_BUILD,
    slateDateCt: "2026-08-12",
    note: "PRE-GAME variables only. Aug 12 is a case study, not sole calibration source.",
    oldOfficialRanking: oldOfficial
      .sort((a, b) => (b.officialRankScore || 0) - (a.officialRankScore || 0))
      .map((r, i) => ({
        rank: i + 1,
        player: r.player,
        propType: r.propType,
        side: r.side,
        line: r.line,
        projection: r.projection,
        officialRankScore: r.officialRankScore,
        probability: r.probability,
        risk: r.risk,
        grade: r.grade,
        actual: r.actual,
      })),
    v2Ranking: scored.map((r, i) => ({
      rank: i + 1,
      player: r.player,
      propType: r.propType,
      side: r.side,
      line: r.line,
      projection: r.projection,
      normalizedProjectionStrength: r.normalizedProjectionStrength,
      modelWinProbability: r.modelWinProbability,
      decisionScoreV2: r.decisionScoreV2,
      membershipOld: r.membership,
      v2Official: v2Membership.selectedPackets.some(
        (s) => stableId(s) === stableId(r) || (s.player === r.player && s.line === r.line && s.propType === r.propType)
      ),
      grade: r.grade,
      actual: r.actual,
    })),
    v2OfficialBoard: v2Membership.selectedPackets.map((r, i) => ({
      rank: i + 1,
      player: r.player,
      propType: r.propType,
      side: r.selectedSide || r.side,
      line: r.line,
      projection: r.projection,
      modelWinProbability: r.modelWinProbability,
      grade: r.grade,
    })),
    winnersLeftBehind: winnersLeftBehind.map((r) => ({
      player: r.player,
      propType: r.propType,
      side: r.side,
      line: r.line,
      projection: r.projection,
      modelWinProbability: r.modelWinProbability,
      normalizedProjectionStrength: r.normalizedProjectionStrength,
      oldOfficialRankScore: r.officialRankScore,
      grade: r.grade,
    })),
    losersSelectedAnalysis: misleading,
    researchSummary: {
      wins: scored.filter((r) => r.membership === "RESEARCH" && r.grade === "WIN").length,
      losses: scored.filter((r) => r.membership === "RESEARCH" && r.grade === "LOSS").length,
      voids: scored.filter((r) => r.grade === "VOID").length,
      unresolved: scored.filter((r) => r.grade === "UNRESOLVED" || r.grade === "PENDING").length,
    },
  };
}

/* -------------------- daily learning -------------------- */

export function buildDailyLearningReportV2(slateDateCt, options = {}) {
  const corpus =
    options.corpus || loadDecisionCorpusV2({ rebuild: true, persist: false });
  const engine = options.engine || trainDecisionEngineV2({ corpus });
  const slateRows = (corpus.rows || [])
    .filter((r) => r.slateDateCt === slateDateCt)
    .map((r) => ({ ...r, ...scoreRowFeatures(r, engine.statModels, engine.probModel) }))
    .sort((a, b) => b.decisionScoreV2 - a.decisionScoreV2);

  const official = slateRows.filter(
    (r) => r.officialSelected || r.membership === "OFFICIAL"
  );
  const byStat = {};
  for (const pt of ["POINTS", "REBOUNDS", "ASSISTS"]) {
    const xs = official.filter((r) => r.propType === pt);
    byStat[pt] = {
      wins: xs.filter((r) => r.grade === "WIN").length,
      losses: xs.filter((r) => r.grade === "LOSS").length,
      hitRate: hitRate(xs),
      projectionMAE: mae(xs.map((r) => r.projectionError)),
    };
  }

  const report = {
    build: DECISION_ENGINE_V2_BUILD,
    slateDateCt,
    updatedAt: new Date().toISOString(),
    overall: {
      wins: official.filter((r) => r.grade === "WIN").length,
      losses: official.filter((r) => r.grade === "LOSS").length,
      hitRate: hitRate(official),
      brier: brierOf(
        official.map((r) => ({
          ...r,
          modelWinProbability: r.modelWinProbability,
        }))
      ),
      projectionMAE: mae(official.map((r) => r.projectionError)),
    },
    byPropType: byStat,
    topRankedRecords: topKHitRates(slateRows),
    winnersLeftBehind: slateRows.filter(
      (r) => r.grade === "WIN" && !(r.officialSelected || r.membership === "OFFICIAL")
    ),
    losersRankedTooHigh: official.filter((r) => r.grade === "LOSS"),
  };

  if (options.persist !== false) {
    const dir = path.join(SERVER_ROOT, "decision-learning-daily-v2");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${slateDateCt}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2));
    report.persistedTo = file;
  }
  return report;
}

/* -------------------- engine cache / persistence -------------------- */

let _cachedEngine = null;

export function getCachedEngine() {
  if (_cachedEngine) return _cachedEngine;
  const file = path.join(SERVER_ROOT, "decision-engine-v2-model.json");
  if (fs.existsSync(file)) {
    try {
      _cachedEngine = JSON.parse(fs.readFileSync(file, "utf8"));
      return _cachedEngine;
    } catch {
      /* retrain */
    }
  }
  _cachedEngine = trainDecisionEngineV2({ rebuildCorpus: true });
  try {
    fs.writeFileSync(file, JSON.stringify(_cachedEngine, null, 2));
  } catch {
    /* ignore */
  }
  return _cachedEngine;
}

export function retrainAndPersistDecisionEngineV2(options = {}) {
  const corpus = buildDecisionCorpusV2({ persist: true });
  const engine = trainDecisionEngineV2({ corpus, ...options });
  const file = path.join(SERVER_ROOT, "decision-engine-v2-model.json");
  fs.writeFileSync(file, JSON.stringify(engine, null, 2));
  _cachedEngine = engine;
  return { engine, corpusSummary: {
    count: corpus.count,
    gradedCount: corpus.gradedCount,
    byPropType: corpus.byPropType,
    gradedByPropType: corpus.gradedByPropType,
    dates: corpus.dates,
  } };
}

export function isDecisionEngineV2LiveEnabled() {
  // Live after holdout pass artifact exists OR explicit env override.
  if (process.env.COURTEDGE_DECISION_ENGINE_V2 === "0") return false;
  if (process.env.COURTEDGE_DECISION_ENGINE_V2 === "1") return true;
  const gate = path.join(SERVER_ROOT, "decision-engine-v2-promotion.json");
  if (!fs.existsSync(gate)) return false;
  try {
    const g = JSON.parse(fs.readFileSync(gate, "utf8"));
    return g.liveAuthority === true && g.pass === true;
  } catch {
    return false;
  }
}

export function persistPromotionGate(validation) {
  const gate = {
    build: DECISION_ENGINE_V2_BUILD,
    updatedAt: new Date().toISOString(),
    pass: Boolean(validation.pass),
    liveAuthority: Boolean(validation.pass),
    reason: validation.promotion?.reason || null,
    boardComparison: validation.boardComparison || null,
    holdoutDates: validation.holdoutDates || [],
    checkpointRollbackTag: "courteedge-pre-decision-engine-v2",
  };
  const file = path.join(SERVER_ROOT, "decision-engine-v2-promotion.json");
  fs.writeFileSync(file, JSON.stringify(gate, null, 2));
  return gate;
}
